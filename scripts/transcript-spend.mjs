#!/usr/bin/env node
/**
 * scripts/transcript-spend.mjs  (LIN-1235, Track B / D3)
 *
 * The inside-view spend study. Joins Harbour's dispatch records (kind + terminal
 * outcome, via the workspace proxy) to the worker's own Claude Code session
 * transcript (`<sessionId>.jsonl`) and computes the per-session spend profile —
 * orientation / core / verify / rework — via lib/transcript-spend.js.
 *
 * The join key (LIN-824): a dispatch item's feedback carries
 *   `[working] Session launched (session: <8hex>, tty: …)`
 * whose <8hex> is the PREFIX of the transcript filename `<full-uuid>.jsonl`.
 *
 * Transcripts live wherever the dispatched sessions ran; default matches this
 * machine's simple-dispatcher workspaces. Override with --projects <dir>.
 *
 * Usage:
 *   PROXY_TOKEN=xxx node scripts/transcript-spend.mjs                 # full run
 *   ... --json                 machine-readable per-session + aggregate JSON
 *   ... --sample 35            cap to N joined sessions (spread across kinds/outcomes)
 *   ... --projects <dir>       transcript root (default ~/.claude/projects)
 *   ... --cache <dir>          dispatch-detail cache (default $TMPDIR/harbour-spend-cache)
 *   ... --no-cache             ignore the on-disk detail cache
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { parseTranscriptLines, sessionSpend, __internal } from '../lib/transcript-spend.js';
import { decomposeEffort } from '../lib/wall-clock-summary.js';

const BASE = process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy';
const TOKEN = process.env.PROXY_TOKEN;
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const AS_JSON = flag('--json');
const SAMPLE = parseInt(opt('--sample', '0'), 10) || 0;
const PROJECTS = opt('--projects', join(homedir(), '.claude', 'projects'));
const CACHE = opt('--cache', join(tmpdir(), 'harbour-spend-cache'));
const USE_CACHE = !flag('--no-cache');
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

const log = (...a) => { if (!AS_JSON) console.error(...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── proxy fetch (cached, rate-limited to the 60/min proxy cap) ──────────────
let calls = 0;
async function proxy(path) {
  const cacheFile = join(CACHE, path.replace(/[^\w.-]/g, '_') + '.json');
  if (USE_CACHE && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
  if (++calls % 55 === 0) { log('  …rate-limit pause 60s'); await sleep(60_000); }
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const body = await res.json();
  writeFileSync(cacheFile, JSON.stringify(body));
  return body;
}

const LAUNCH_RE = /session\s+launched\s*\(session:\s*([0-9a-f]{6,})/i;
function launchedPrefix(feedback = []) {
  for (const f of feedback) {
    const m = LAUNCH_RE.exec(f?.message || '');
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// ─── enumerate transcripts (main + subagents) ────────────────────────────────
function findTranscripts(root) {
  const out = new Map(); // full sessionId → { path, subagents:[] }
  let dirs = [];
  try { dirs = readdirSync(root).filter((d) => d.includes('workspaces-')); } catch { return out; }
  for (const d of dirs) {
    const dir = join(root, d);
    let files = [];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sid = f.replace('.jsonl', '');
      const rec = { path: join(dir, f), subagents: [] };
      const subDir = join(dir, sid, 'subagents');
      if (existsSync(subDir)) {
        try { rec.subagents = readdirSync(subDir).filter((x) => x.endsWith('.jsonl')).map((x) => join(subDir, x)); } catch {}
      }
      out.set(sid.toLowerCase(), rec);
    }
  }
  return out;
}

const OUTCOME = { done: 'done', failed: 'failed', aborted: 'aborted' };

async function main() {
  if (!TOKEN) { console.error('PROXY_TOKEN required'); process.exit(1); }

  log('Fetching dispatch records across statuses…');
  const statuses = ['done', 'failed', 'aborted', 'taken', 'queued'];
  const items = new Map();
  for (const st of statuses) {
    const { items: rows = [] } = await proxy(`/dispatch?status=${st}&limit=250`);
    for (const r of rows) items.set(r.id, r);
    log(`  ${st}: ${rows.length}`);
  }
  log(`  ${items.size} unique dispatch items`);

  log('Fetching item details (for join marker + kind + outcome)…');
  const joinByPrefix = new Map(); // 8hex prefix → dispatch meta
  let n = 0;
  for (const [id, row] of items) {
    let detail;
    try { detail = await proxy(`/dispatch/${id}`); } catch (e) { continue; }
    const prefix = launchedPrefix(detail.feedback);
    if (!prefix) continue;
    joinByPrefix.set(prefix, {
      id, kind: detail.kind || row.kind || 'unknown',
      status: detail.status || row.status,
      outcome: OUTCOME[detail.status] || detail.status || 'open',
      issue: detail.issueIdentifier || row.issueIdentifier || null,
      dispatchedAt: detail.dispatchedAt || row.dispatchedAt || null,
      // D2 (Track A) silhouette from the SAME feedback, via the repo's own
      // decomposeEffort — this is what we correlate against D3's token truth.
      d2: decomposeEffort({ dispatchedAt: detail.dispatchedAt, completedAt: detail.completedAt, feedback: detail.feedback }),
    });
    if (++n % 25 === 0) log(`  …${n} details`);
  }
  log(`  ${joinByPrefix.size} items carry a launch marker`);

  log(`Enumerating transcripts under ${PROJECTS}…`);
  const transcripts = findTranscripts(PROJECTS);
  log(`  ${transcripts.size} transcripts on disk`);

  // Join: for each dispatch prefix, find the transcript whose id starts with it.
  const byId = [...transcripts.keys()];
  let joined = [];
  for (const [prefix, meta] of joinByPrefix) {
    const full = byId.find((sid) => sid.startsWith(prefix));
    if (!full) continue;
    joined.push({ ...meta, ...transcripts.get(full), sessionId: full });
  }
  log(`  ${joined.length} sessions joined (dispatch ⋈ transcript)`);

  // Sample: spread across kind × outcome if requested.
  if (SAMPLE && joined.length > SAMPLE) {
    const buckets = new Map();
    for (const j of joined) {
      const k = `${j.kind}/${j.outcome}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(j);
    }
    const picked = [];
    let round = 0;
    while (picked.length < SAMPLE) {
      let added = false;
      for (const arr of buckets.values()) {
        if (arr[round]) { picked.push(arr[round]); added = true; if (picked.length >= SAMPLE) break; }
      }
      if (!added) break;
      round++;
    }
    joined = picked;
    log(`  sampled ${joined.length} across ${buckets.size} kind×outcome buckets`);
  }

  log('Parsing transcripts + computing spend…');
  const results = [];
  for (const j of joined) {
    try {
      const lines = readFileSync(j.path, 'utf8').split('\n');
      // Fold subagent transcripts into the same session's event stream.
      for (const sub of j.subagents) {
        try { lines.push(...readFileSync(sub, 'utf8').split('\n')); } catch {}
      }
      const spend = sessionSpend(parseTranscriptLines(lines), { sessionId: j.sessionId });
      // D2 onboarding share = onboarding ÷ (onboarding+active+waiting+wrapup), the
      // cheap outside-view analogue of D3's orientation ratio.
      const d2 = j.d2 || {};
      const d2Denom = (d2.onboardingMs || 0) + (d2.activeMs || 0) + (d2.waitingMs || 0) + (d2.wrapupMs || 0);
      const d2OnboardShare = d2Denom > 0 ? (d2.onboardingMs || 0) / d2Denom : null;
      results.push({ ...spend, kind: j.kind, outcome: j.outcome, issue: j.issue,
                     d2OnboardShare, d2HasBeats: !!d2.hasBeats,
                     sizeKb: Math.round(statSync(j.path).size / 1024), subagentCount: j.subagents.length });
    } catch (e) { log(`  skip ${j.sessionId.slice(0, 8)}: ${e.message}`); }
  }

  const report = buildReport(results);
  if (AS_JSON) { console.log(JSON.stringify({ sessions: results, report }, null, 2)); return; }
  printReport(results, report);
}

// ─── aggregation ─────────────────────────────────────────────────────────────
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);

/** Pearson correlation over paired [x,y]; null if <3 pairs or zero variance. */
function pearson(pairs) {
  const p = pairs.filter(([x, y]) => x != null && y != null);
  const n = p.length;
  if (n < 3) return { r: null, n };
  const mx = p.reduce((a, [x]) => a + x, 0) / n, my = p.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (sxx === 0 || syy === 0) return { r: null, n };
  return { r: sxy / Math.sqrt(sxx * syy), n };
}

function buildReport(results) {
  const editBearing = results.filter((r) => r.editBearing);
  const byKind = {}, byOutcome = {};
  for (const r of results) {
    (byKind[r.kind] ||= []).push(r);
    (byOutcome[r.outcome] ||= []).push(r);
  }
  const orientAll = (set, lens) => med(set.map((r) => r.orientation[lens]));
  return {
    n: results.length,
    editBearingN: editBearing.length,
    orientation: {
      all: { byCount: orientAll(results, 'byCount'), byResultBytes: orientAll(results, 'byResultBytes'), byOutputTokens: orientAll(results, 'byOutputTokens') },
      editBearing: { byCount: orientAll(editBearing, 'byCount'), byResultBytes: orientAll(editBearing, 'byResultBytes'), byOutputTokens: orientAll(editBearing, 'byOutputTokens') },
    },
    toolsBeforeFirstCore: med(editBearing.map((r) => r.toolsBeforeFirstCore)),
    reworkRate: med(editBearing.map((r) => (r.filesEdited.length ? r.reworkEditCount / r.filesEdited.length : 0))),
    verifyFailToEditTotal: results.reduce((a, r) => a + r.verifyFailToEdit, 0),
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, set]) => [k, {
      n: set.length, editBearing: set.filter((r) => r.editBearing).length,
      orientByBytes: orientAll(set, 'byResultBytes'), orientByCount: orientAll(set, 'byCount'),
    }])),
    byOutcome: Object.fromEntries(Object.entries(byOutcome).map(([k, set]) => [k, {
      n: set.length, orientByBytes: orientAll(set, 'byResultBytes'), orientByCount: orientAll(set, 'byCount'),
    }])),
    // H4: cross-session file-read duplication. Group sessions by issue; for each
    // issue touched by ≥2 sessions, measure how much each session's read-set
    // repeats files an EARLIER session on the same issue already read.
    h4: (() => {
      const byIssue = {};
      for (const r of results) if (r.issue) (byIssue[r.issue] ||= []).push(r);
      const multi = Object.entries(byIssue).filter(([, s]) => s.length >= 2);
      const overlaps = [];
      const details = [];
      for (const [issue, set] of multi) {
        const seen = new Set();
        let anyPrior = false;
        for (const r of set) {
          const reads = r.filesRead;
          if (anyPrior && reads.length) {
            const repeated = reads.filter((f) => seen.has(f)).length;
            overlaps.push(repeated / reads.length);
          }
          if (seen.size) anyPrior = true;
          for (const f of reads) seen.add(f);
          if (!anyPrior && reads.length) anyPrior = true;
        }
        details.push({ issue, sessions: set.length, kinds: set.map((r) => r.kind) });
      }
      return { multiIssueCount: multi.length, medianRepeatShare: med(overlaps), details };
    })(),
    // The prize: does the cheap D2 signal predict the expensive D3 truth?
    d2d3: {
      vsCount: pearson(results.map((r) => [r.d2OnboardShare, r.orientation.byCount])),
      vsBytes: pearson(results.map((r) => [r.d2OnboardShare, r.orientation.byResultBytes])),
      vsOutput: pearson(results.map((r) => [r.d2OnboardShare, r.orientation.byOutputTokens])),
      withD2N: results.filter((r) => r.d2OnboardShare != null).length,
    },
  };
}

function printReport(results, rep) {
  console.log(`\n══ Track B / D3 — inside-view spend (${rep.n} joined sessions, ${rep.editBearingN} edit-bearing) ══\n`);
  console.log('ORIENTATION RATIO (median), three lenses:');
  console.log(`  all sessions   — count ${pct(rep.orientation.all.byCount)} · result-bytes ${pct(rep.orientation.all.byResultBytes)} · output-tokens ${pct(rep.orientation.all.byOutputTokens)}`);
  console.log(`  edit-bearing   — count ${pct(rep.orientation.editBearing.byCount)} · result-bytes ${pct(rep.orientation.editBearing.byResultBytes)} · output-tokens ${pct(rep.orientation.editBearing.byOutputTokens)}`);
  console.log(`\nTime-to-first-core (edit-bearing): median ${rep.toolsBeforeFirstCore} tools before first Edit`);
  console.log(`Rework rate (extra edits ÷ files edited): median ${pct(rep.reworkRate)}`);
  console.log(`Verify-fail → edit loops (total): ${rep.verifyFailToEditTotal}`);
  console.log('\nBY KIND (orientation by result-bytes · by count · n · edit-bearing):');
  for (const [k, v] of Object.entries(rep.byKind).sort((a, b) => (b[1].orientByBytes || 0) - (a[1].orientByBytes || 0)))
    console.log(`  ${k.padEnd(16)} bytes ${pct(v.orientByBytes).padStart(4)} · count ${pct(v.orientByCount).padStart(4)} · n=${v.n} · edits=${v.editBearing}`);
  console.log('\nBY OUTCOME:');
  for (const [k, v] of Object.entries(rep.byOutcome))
    console.log(`  ${k.padEnd(10)} bytes ${pct(v.orientByBytes).padStart(4)} · count ${pct(v.orientByCount).padStart(4)} · n=${v.n}`);
  const h = rep.h4;
  console.log(`\nH4 — cross-session file-read duplication: ${h.multiIssueCount} issues with ≥2 sessions`);
  console.log(`  median share of a later session's reads that a PRIOR same-issue session already read: ${pct(h.medianRepeatShare)}`);
  for (const d of h.details) console.log(`    ${d.issue}: ${d.sessions} sessions [${d.kinds.join(', ')}]`);
  const d = rep.d2d3, rr = (x) => (x.r == null ? `n/a (n=${x.n})` : `r=${x.r.toFixed(2)} (n=${x.n})`);
  console.log(`\nD2↔D3 COMPARE — does cheap heartbeat onboarding-share predict token orientation? (${d.withD2N} sessions w/ beats)`);
  console.log(`  vs D3 by count:         ${rr(d.vsCount)}`);
  console.log(`  vs D3 by result-bytes:  ${rr(d.vsBytes)}`);
  console.log(`  vs D3 by output-tokens: ${rr(d.vsOutput)}`);
  console.log('\nPER-SESSION (top 30 by tool count):');
  console.log('  sid       kind            outcome   tools  O/C/V/Co/Sc/U            orient(B)  D2onb  edits  rework');
  for (const r of [...results].sort((a, b) => b.toolCount - a.toolCount).slice(0, 30)) {
    const c = r.toolCounts;
    const mix = `${c.ORIENT}/${c.CORE}/${c.VERIFY}/${c.COORD}/${c.SCAFFOLD}/${c.UNKNOWN}`;
    console.log(`  ${(r.sessionId || '????????').slice(0, 8)}  ${(r.kind || '?').padEnd(15)} ${(r.outcome || '?').padEnd(9)} ${String(r.toolCount).padStart(4)}  ${mix.padEnd(22)} ${pct(r.orientation.byResultBytes).padStart(5)}  ${pct(r.d2OnboardShare).padStart(5)}   ${String(r.filesEdited.length).padStart(3)}    ${r.reworkEditCount}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
