#!/usr/bin/env node
/**
 * scripts/wall-clock-summary.mjs  (LIN-987 v1)
 *
 * "Where does the time go?" — a read-only wall-clock summary of autopilot work,
 * built entirely from data the workspace API proxy already exposes. No schema
 * change, no new instrumentation: it reconstructs per-step wall-clock from the
 * dispatch history's `dispatchedAt` / `completedAt` / `resolvedAt` timestamps and
 * buckets each step by its `kind` into the lifecycle phases the ticket names —
 *
 *   BEFORE the diff  (build the idea → a spec an agent can implement)
 *   THE diff         (kind:'implementation' — the core nugget)
 *   AFTER the diff   (confirmation & paperwork: review / close-out / retro)
 *   ORCHESTRATION    (autopilot / wake / custom — the loop's own overhead)
 *
 * The phase→bucket map mirrors the PROMPT_TEMPLATES lifecycle vocabulary
 * (lib/prompt-template-defs.js) + the dispatch meta-kinds (lib/prompt-templates.js).
 *
 * Data source & honesty notes (verified against the live proxy for LIN-987):
 *  - `completedAt` is the server's terminal-marker time (lib/dispatch-terminal.js
 *    deriveCompletedAt), NOT the take time. A step with no terminal marker yet has
 *    null completedAt and is reported as OPEN (excluded from duration sums).
 *  - `resolvedAt` is the take/claim time; queue-wait = resolvedAt - dispatchedAt.
 *  - The list endpoint returns the most recent ~100 rows and projects away
 *    `sessionId`, so this v1 groups by `issueIdentifier` (the available unit) and
 *    reports on the retained recent window. Coverage is printed up front.
 *  - Worker/CLI token+cost usage is emitted NOWHERE today (llm-call-log is
 *    server-side only), so this report is wall-clock only. Tokens need a
 *    runner-side emission (see the LIN-987 research notes) before they can appear.
 *
 * Usage:
 *   PROXY_TOKEN=xxx node scripts/wall-clock-summary.mjs
 *   node scripts/wall-clock-summary.mjs --token xxx --base https://projects.jkershaw.com/api/proxy
 *   ... --json         emit machine-readable JSON instead of the text report
 *   ... --issue LIN-42 restrict to one issue
 */

// ─── phase → bucket map (mirrors the template lifecycle + dispatch meta-kinds) ──
const BUCKET_OF_KIND = {
  // BEFORE the diff — turning an idea into an implementable spec
  triage: 'before', research: 'before', scoping: 'before', design: 'before',
  spike: 'before', context: 'before', plan: 'before', breakdown: 'before',
  'look-into': 'before', blocked: 'before',
  // THE diff — the core nugget
  implementation: 'diff',
  // AFTER the diff — confirmation & paperwork
  review: 'after', 'close-out': 'after', retro: 'after',
  // ORCHESTRATION — the loop's own overhead, not task-phase work
  autopilot: 'orchestration', wake: 'orchestration', custom: 'orchestration',
  periodical: 'orchestration',
};
const BUCKET_LABEL = {
  before: 'BEFORE the diff  (idea → spec)',
  diff: 'THE diff         (implementation)',
  after: 'AFTER the diff   (confirm & paperwork)',
  orchestration: 'ORCHESTRATION    (autopilot/wake/custom)',
};
const BUCKET_ORDER = ['before', 'diff', 'after', 'orchestration'];
const bucketOf = (kind) => BUCKET_OF_KIND[kind] || 'orchestration';

// ─── tiny arg/format helpers ────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { base: process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
              token: process.env.PROXY_TOKEN || '', json: false, issue: null, limit: 100 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--json') a.json = true;
    else if (v === '--token') a.token = argv[++i];
    else if (v === '--base') a.base = argv[++i];
    else if (v === '--issue') a.issue = argv[++i];
    else if (v === '--limit') a.limit = parseInt(argv[++i], 10);
  }
  return a;
}
const ms = (a, b) => { const x = new Date(a).getTime(), y = new Date(b).getTime();
  return Number.isFinite(x) && Number.isFinite(y) ? y - x : null; };
function fmtDur(msVal) {
  if (msVal == null) return '   —   ';
  let s = Math.round(msVal / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—');
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

// ─── fetch dispatch history from the proxy ──────────────────────────────────
async function fetchItems({ base, token, limit, issue }) {
  const url = new URL(`${base}/dispatch`);
  url.searchParams.set('limit', String(limit));
  if (issue) url.searchParams.set('issueIdentifier', issue);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`proxy ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return { items: body.items || [], total: body.total ?? null };
}

// ─── aggregate ──────────────────────────────────────────────────────────────
function summarize(items) {
  const byBucket = {}, byKind = {}, byIssue = {};
  const queueWaits = [];
  let openCount = 0, spanMin = null, spanMax = null;

  for (const it of items) {
    const kind = it.kind || 'custom';
    const bucket = bucketOf(kind);
    const dur = it.completedAt ? ms(it.dispatchedAt, it.completedAt) : null;
    const qw = it.resolvedAt ? ms(it.dispatchedAt, it.resolvedAt) : null;
    if (qw != null && qw >= 0) queueWaits.push(qw);
    if (dur == null) openCount++;
    if (it.dispatchedAt) {
      spanMin = spanMin && spanMin < it.dispatchedAt ? spanMin : it.dispatchedAt;
      const end = it.completedAt || it.dispatchedAt;
      spanMax = spanMax && spanMax > end ? spanMax : end;
    }

    const B = (byBucket[bucket] ||= { steps: 0, active: 0, open: 0 });
    B.steps++; if (dur != null && dur >= 0) B.active += dur; else B.open++;

    const K = (byKind[kind] ||= { steps: 0, active: 0, open: 0, bucket });
    K.steps++; if (dur != null && dur >= 0) K.active += dur; else K.open++;

    if (it.issueIdentifier) {
      const I = (byIssue[it.issueIdentifier] ||= { steps: 0, active: 0, kinds: {}, first: null, last: null });
      I.steps++; if (dur != null && dur >= 0) I.active += dur;
      I.kinds[kind] = (I.kinds[kind] || 0) + 1;
      I.first = I.first && I.first < it.dispatchedAt ? I.first : it.dispatchedAt;
      const end = it.completedAt || it.dispatchedAt;
      I.last = I.last && I.last > end ? I.last : end;
    }
  }
  const totalActive = BUCKET_ORDER.reduce((s, b) => s + (byBucket[b]?.active || 0), 0);
  return { byBucket, byKind, byIssue, queueWaits, openCount, totalActive,
           span: { min: spanMin, max: spanMax }, steps: items.length };
}

// ─── render ─────────────────────────────────────────────────────────────────
function render(s, meta) {
  const L = [];
  L.push('');
  L.push('  WALL-CLOCK TIME SUMMARY — where does the time go?   (LIN-987 v1)');
  L.push('  ' + '─'.repeat(66));
  L.push(`  window: ${s.steps} recent dispatch steps` +
    (meta.total != null ? ` (of ${meta.total} retained)` : '') +
    `   ·   ${s.openCount} still open`);
  if (s.span.min) L.push(`  span:   ${s.span.min.slice(0, 16).replace('T', ' ')} → ${s.span.max.slice(0, 16).replace('T', ' ')} UTC`);
  L.push(`  active agent wall-clock (sum of completed step durations): ${fmtDur(s.totalActive)}`);
  L.push('');

  // Phase buckets — the headline
  L.push('  THE CORE NUGGET — active time by lifecycle phase');
  L.push('  ' + '─'.repeat(66));
  L.push(`  ${pad('phase', 42)} ${lpad('steps', 6)} ${lpad('active', 9)} ${lpad('share', 8)}`);
  for (const b of BUCKET_ORDER) {
    const B = s.byBucket[b]; if (!B) continue;
    L.push(`  ${pad(BUCKET_LABEL[b], 42)} ${lpad(B.steps, 6)} ${lpad(fmtDur(B.active), 9)} ${lpad(pct(B.active, s.totalActive), 8)}`);
  }
  // the pre/diff/post ratio, excluding orchestration
  const work = ['before', 'diff', 'after'].reduce((a, b) => a + (s.byBucket[b]?.active || 0), 0);
  const bd = s.byBucket.diff?.active || 0;
  L.push('  ' + '─'.repeat(66));
  L.push(`  of task work (excl. orchestration ${fmtDur(s.totalActive - work)}):`);
  L.push(`    before ${pct(s.byBucket.before?.active || 0, work)}  ·  diff ${pct(bd, work)}  ·  after ${pct(s.byBucket.after?.active || 0, work)}`);
  L.push('');

  // Per-kind detail
  L.push('  BY KIND');
  L.push('  ' + '─'.repeat(66));
  const kinds = Object.entries(s.byKind).sort((a, b) => b[1].active - a[1].active);
  L.push(`  ${pad('kind', 18)} ${pad('bucket', 14)} ${lpad('steps', 6)} ${lpad('active', 9)}`);
  for (const [k, K] of kinds)
    L.push(`  ${pad(k, 18)} ${pad(K.bucket, 14)} ${lpad(K.steps, 6)} ${lpad(fmtDur(K.active), 9)}`);
  L.push('');

  // Queue wait
  const qwMed = median(s.queueWaits);
  L.push('  QUEUE WAIT (dispatch → take)');
  L.push('  ' + '─'.repeat(66));
  L.push(`  median ${fmtDur(qwMed)} · max ${fmtDur(s.queueWaits.length ? Math.max(...s.queueWaits) : null)} · n=${s.queueWaits.length}`);
  L.push('');

  // Per-issue lifecycle rollup
  const issues = Object.entries(s.byIssue).sort((a, b) => b[1].active - a[1].active).slice(0, 12);
  if (issues.length) {
    L.push('  BY ISSUE (top 12 by active time)');
    L.push('  ' + '─'.repeat(66));
    L.push(`  ${pad('issue', 10)} ${lpad('steps', 5)} ${lpad('active', 9)} ${lpad('calendar', 9)}  phases`);
    for (const [id, I] of issues) {
      const cal = ms(I.first, I.last);
      const phases = Object.entries(I.kinds).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(' ');
      L.push(`  ${pad(id, 10)} ${lpad(I.steps, 5)} ${lpad(fmtDur(I.active), 9)} ${lpad(fmtDur(cal), 9)}  ${phases}`);
    }
    L.push('');
    L.push('  (active = summed step durations; calendar = first dispatch → last completion,');
    L.push('   so calendar − active ≈ human/idle gaps between an issue\'s steps.)');
  }
  L.push('');
  L.push('  NOTE: wall-clock only. Worker token/cost usage is not emitted anywhere');
  L.push('  today (llm-call-log tracks server-side calls only) — see LIN-987 notes.');
  L.push('');
  return L.join('\n');
}

// ─── main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.token) {
    console.error('error: set PROXY_TOKEN env var or pass --token <proxy readWrite/read token>');
    process.exit(2);
  }
  const { items, total } = await fetchItems(args);
  const s = summarize(items);
  if (args.json) {
    console.log(JSON.stringify({ meta: { total, steps: s.steps, openCount: s.openCount, span: s.span },
      byBucket: s.byBucket, byKind: s.byKind, byIssue: s.byIssue,
      queueWaitMedianMs: median(s.queueWaits), totalActiveMs: s.totalActive }, null, 2));
  } else {
    console.log(render(s, { total }));
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
