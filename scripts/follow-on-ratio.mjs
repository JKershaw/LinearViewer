#!/usr/bin/env node
/**
 * scripts/follow-on-ratio.mjs  (LIN-1654 — LIN-1601 Phase 0 / LIN-1600 S6)
 *
 * The network read behind the follow-on task ratio: the "before" baseline
 * LIN-1600's falsifiable close is judged against one cycle after the
 * `plan-review` gate lands. All analysis lives in `lib/follow-on-ratio.js`
 * (pure, network-free, unit-tested); this file only fetches, caches, and prints.
 * Same split as `scripts/wall-clock-summary.mjs` / `lib/wall-clock-summary.js`
 * and `scripts/transcript-spend.mjs` / `lib/transcript-spend.js`.
 *
 * Usage:
 *   PROXY_TOKEN=xxx node scripts/follow-on-ratio.mjs \
 *     --window-start 2026-06-26T00:00:00Z --window-end 2026-07-26T00:00:00Z
 *
 *   ... --json               machine-readable result on stdout (the recorded artifact)
 *   ... --base <url>         proxy base (default $PROXY_BASE, else the live instance)
 *   ... --token <tok>        proxy token (default $PROXY_TOKEN)
 *   ... --cache <dir>        detail cache (default $TMPDIR/harbour-follow-on-cache)
 *   ... --no-cache           ignore the on-disk cache and re-read everything
 *   ... --limit <n>          issues per list page (default 250, the proxy's max)
 *   ... --help
 *
 * NOT registered in package.json and not run by CI — deliberately, matching the
 * lineage, which registers neither script. It is a manual instrument: run it,
 * record the JSON, and move on.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * A UNIFORM DETAIL PASS OVER EVERY ISSUE: ~7 list calls + ~1,555 detail calls
 * ≈ 1,562 requests, ~29 minutes at the 1.1s spacing below (the proxy caps at
 * 60/min). Research's cheaper "7 bulk + 1,035 detail" plan funded the
 * DENOMINATOR only — relation elements carry no peer `createdAt`
 * (`RELATIONS_QUERY`, `lib/providers/linear/index.js:1489-1502`), so the
 * numerator needs its own detail reads. At the measured peer density a uniform
 * pass is both cheaper and simpler than two waves, it makes every peer lookup
 * an in-memory join, and it leaves the whole workspace cached for the re-read.
 *
 * ── FOUR THINGS THIS SCRIPT DOES DELIBERATELY DIFFERENTLY ───────────────────
 *
 *  1. **The denominator check runs on the DETAIL payload, never the list.**
 *     The list payload carries `state` but no `trashed` field, while
 *     `GET /issues/{id}` returns 200 for a trashed issue with its state
 *     rewritten to `{name:'Trashed', type:'canceled'}` (`applyTrashedSignal`,
 *     `routes/proxy.js`). So a trashed ghost with a stale `completed` state
 *     would pass a list-side filter and fails the detail-side one for free.
 *     The list `state` is used ONLY to decide cache eligibility below — never
 *     to include or exclude an issue from the metric.
 *
 *  2. **No early stop.** Paging terminates on `pageInfo.hasNextPage` and
 *     nothing else. List order is by CREATION while the window anchors on
 *     COMPLETION, so "we're past the window, stop" would silently truncate the
 *     denominator — a long-lived issue created a year ago can complete today.
 *
 *  3. **It never calls `/api/proxy/dispatch`, and it verifies its page sizes.**
 *     That endpoint silently clamps `limit` to 100 with no `pageInfo`, no
 *     cursor and no total, so a caller asking for 250 gets 100 and cannot tell
 *     (both lineage scripts request 250 there and are capped). `/api/proxy/issues`
 *     genuinely honours 250 — but the honouring is checked rather than assumed:
 *     every page records requested-vs-returned, and a short page while
 *     `hasNextPage` is still true is reported loudly as a possible clamp.
 *
 *  4. **5xx is retried and a per-issue failure is tolerated.** The lineage's
 *     `getJson` retries only 429 and throws on anything else; a probe run for
 *     this ticket died at call ~90 on a transient 502. Over ~1,562 calls that
 *     is not hypothetical, and a lost run costs 29 minutes — worse, a silently
 *     shortened population would corrupt the baseline invisibly. Ids that fail
 *     every retry land in `diagnostics.skipped`, which the recorded result
 *     carries, so a truncated read is visible rather than hidden.
 *
 * ── CACHE HONESTY ───────────────────────────────────────────────────────────
 * Only TERMINAL issues are cached; open ones are always re-fetched. Note the
 * one way that rule is imperfect here: a terminal issue can still ACCRUE a new
 * relation (that is precisely what a follow-up is), so a cached detail can miss
 * an edge filed after it was cached. The trade is deliberate — it turns a
 * 29-minute re-read into a delta — and `--no-cache` forces a full re-read when
 * the numbers must be pristine. Use `--no-cache` for the recorded baseline.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { computeFollowOnRatio } from '../lib/follow-on-ratio.js';
import { classifyUpstreamError } from '../lib/errors.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Terminal for CACHE purposes only — never for the metric, which reads state
// off the detail payload (see note 1 in the header).
const TERMINAL_STATES = ['completed', 'canceled', 'duplicate'];

const USAGE = `usage: PROXY_TOKEN=xxx node scripts/follow-on-ratio.mjs \\
         --window-start <ISO> --window-end <ISO> [--json] [--no-cache]
       [--base <url>] [--token <tok>] [--cache <dir>] [--limit <n>]`;

// ─── args (hand-rolled, zero deps — the lineage idiom) ───────────────────────
function parseArgs(argv) {
  const a = {
    base: process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
    token: process.env.PROXY_TOKEN || '',
    windowStart: null, windowEnd: null,
    json: false, noCache: false, help: false,
    cache: join(tmpdir(), 'harbour-follow-on-cache'),
    limit: 250,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--json') a.json = true;
    else if (v === '--no-cache') a.noCache = true;
    else if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--token') a.token = argv[++i];
    else if (v === '--base') a.base = argv[++i];
    else if (v === '--cache') a.cache = argv[++i];
    else if (v === '--window-start') a.windowStart = argv[++i];
    else if (v === '--window-end') a.windowEnd = argv[++i];
    else if (v === '--limit') a.limit = parseInt(argv[++i], 10) || 250;
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const pctOf = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const num = (x) => (x == null ? '—' : String(x));
const ratio = (x) => (x == null ? '— (no data)' : x.toFixed(4));

// Progress and warnings go to stderr; ONLY the result goes to stdout, so
// `--json > baseline.json` yields a clean artifact.
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

/**
 * Freeze-list item 4: the commit SHA of both files, so a later rule change is
 * visible rather than silent. Read here rather than in the module, which is
 * shell-free by contract. A dirty tree is reported, because a SHA recorded
 * against uncommitted code is a lie.
 */
function readCodeVersion() {
  const files = ['lib/follow-on-ratio.js', 'scripts/follow-on-ratio.mjs'];
  const git = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const out = { files: {}, dirty: null };
  for (const f of files) {
    try { out.files[f] = git(['log', '-1', '--format=%H', '--', f]) || null; } catch { out.files[f] = null; }
  }
  try { out.dirty = git(['status', '--porcelain', '--', ...files]).length > 0; } catch { out.dirty = null; }
  if (out.dirty) log('  ⚠ working tree is dirty for the measured files — the recorded SHA does not describe the code that ran');
  if (Object.values(out.files).some((v) => !v)) log('  ⚠ could not resolve a commit SHA for every measured file');
  return out;
}

// ─── proxy fetch ─────────────────────────────────────────────────────────────

/**
 * One GET with Bearer auth, retried on 429 AND 5xx up to `tries` attempts with
 * a widening backoff. Returns null when `tolerate` is set and every attempt
 * failed AND the failure is classified retryable, so one bad issue cannot
 * lose a 29-minute pass; throws otherwise. A non-retryable failure (401/403
 * auth, 400/404/422, …) always throws regardless of `tolerate` — it is total
 * and will not improve on a re-read, so silently skipping it would corrupt
 * the published artifact instead of just costing a retry (LIN-1984).
 */
export async function getJson(url, token, { tries = 4, tolerate = false } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      lastErr = e; // network hiccup — same backoff as a 5xx
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.status >= 500) {
      lastErr = new Error(`proxy ${res.status} on ${url}`);
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      const err = new Error(`proxy ${res.status} on ${url}: ${body.slice(0, 200)}`);
      err.status = res.status;
      if (tolerate && classifyUpstreamError(err).retryable) return null;
      throw err;
    }
    return res.json();
  }
  if (tolerate) return null;
  throw lastErr || new Error(`rate-limited after ${tries} tries: ${url}`);
}

/**
 * Page `/issues` to exhaustion. Terminates ONLY on `hasNextPage === false` —
 * `endCursor` can still be non-null on the final page, and an early break keyed
 * on the window would truncate the denominator (list order is by creation).
 */
async function listAllIssues({ base, token, limit }) {
  const rows = [];
  const pages = [];
  let after = null;
  let guard = 0;
  for (;;) {
    const url = new URL(`${base}/issues`);
    url.searchParams.set('limit', String(limit));
    if (after) url.searchParams.set('after', after);

    const body = await getJson(url.toString(), token);
    const batch = Array.isArray(body.issues) ? body.issues : [];
    const info = body.pageInfo || {};
    pages.push({ requested: limit, returned: batch.length, hasNextPage: !!info.hasNextPage });
    rows.push(...batch);
    log(`  page ${pages.length}: requested ${limit}, returned ${batch.length}` +
        `${info.hasNextPage ? ' (more)' : ' (last)'} · ${rows.length} so far`);

    // Never assume a requested page size was honoured — /api/proxy/dispatch
    // silently clamps 250 → 100 and reports nothing. A short page while more
    // remain is that clamp's signature; say so rather than under-read quietly.
    if (info.hasNextPage && batch.length < limit) {
      log(`  ⚠ short page (${batch.length} < ${limit}) while hasNextPage is true — the endpoint may be clamping \`limit\``);
    }
    if (!info.hasNextPage) break;
    if (!batch.length) { log('  ⚠ empty page with hasNextPage true — stopping to avoid an endless loop'); break; }
    if (!info.endCursor) { log('  ⚠ hasNextPage true but no endCursor — cannot page further'); break; }
    if (++guard > 500) { log('  ⚠ page guard tripped at 500 pages — stopping'); break; }

    after = info.endCursor; // opaque: passed back verbatim, never parsed
    await sleep(1100);
  }
  return { rows, pages };
}

/**
 * Uniform detail pass over EVERY listed issue. The completed ones are the
 * denominator; the rest are the peer index, since a follow-up's own `createdAt`
 * lives only on its detail payload.
 */
async function fetchAllDetails(rows, { base, token, cache, noCache }) {
  if (!noCache) mkdirSync(cache, { recursive: true });
  const details = [];
  const skipped = [];
  let fetched = 0, cached = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.id) { skipped.push({ id: row?.id ?? null, reason: 'list row carried no id' }); continue; }

    // Cache eligibility only — the metric reads state off the DETAIL payload.
    const terminal = TERMINAL_STATES.includes(row.state?.type);
    const cacheFile = join(cache, `${row.id}.json`);

    let detail = null;
    if (!noCache && terminal && existsSync(cacheFile)) {
      try { detail = JSON.parse(readFileSync(cacheFile, 'utf8')); cached++; } catch { detail = null; }
    }
    if (!detail) {
      detail = await getJson(`${base}/issues/${row.id}`, token, { tolerate: true });
      fetched++;
      if (!detail) {
        skipped.push({ id: row.id, identifier: row.identifier || null, reason: 'detail fetch failed after retries' });
        log(`  ⚠ skipped ${row.identifier || row.id} — detail fetch failed`);
      } else if (!noCache && TERMINAL_STATES.includes(detail.state?.type)) {
        try { writeFileSync(cacheFile, JSON.stringify(detail)); } catch { /* cache is best-effort */ }
      }
      await sleep(1100); // stay under the proxy's 60/min cap
    }
    if (detail) details.push(detail);
    if ((i + 1) % 25 === 0) log(`  …details ${i + 1}/${rows.length} (${fetched} fetched, ${cached} cached, ${skipped.length} skipped)`);
  }
  log(`  details complete: ${details.length}/${rows.length} (${fetched} fetched, ${cached} cached, ${skipped.length} skipped)`);
  return { details, skipped };
}

// ─── render ──────────────────────────────────────────────────────────────────

function renderInstrument(label, r) {
  const flag = r.sufficient ? 'sufficient' : 'INSUFFICIENT';
  return `  ${label.padEnd(34)} ${ratio(r.ratio).padStart(12)}  ` +
         `n=${String(r.numerator).padStart(4)} / d=${String(r.denominator).padStart(5)}  ` +
         `peers=${String(r.distinctPeers).padStart(4)}  ${flag}`;
}

function render(result, meta) {
  const L = [];
  L.push('');
  L.push('══ follow-on task ratio — LIN-1600 S6 baseline ═══════════════════════════════');
  L.push(`  window   ${result.window.windowStart} → ${result.window.windowEnd}  ${result.window.bounds}`);
  L.push(`  asOf     ${result.window.asOf}`);
  L.push(`  code     ${JSON.stringify(result.codeVersion?.files || null)}${result.codeVersion?.dirty ? '  ⚠ DIRTY TREE' : ''}`);
  L.push(`  scale    ${result.scale.totalIssues} issues read · ${result.scale.totalCompleted} completed lifetime`);
  L.push('');
  L.push('  INSTRUMENTS                              ratio       counts');
  L.push('  ' + '─'.repeat(74));
  L.push(renderInstrument('headline (all completed)', result.arms.causalUnion));
  L.push(renderInstrument('7-day-matured companion', result.matured7d));
  L.push(renderInstrument('plan-scoped sub-ratio', result.planScoped));
  L.push(renderInstrument('PRIMARY (plan × matured)', result.primary));
  L.push('  ' + '─'.repeat(74));
  L.push(renderInstrument('arm: outgoing relations only', result.arms.causalOutgoing));
  L.push(renderInstrument('arm: shared-parent excluded', result.arms.sharedParentExcluded));
  L.push('');
  L.push(`  floors: denominator >= ${result.minDenominator} && numerator >= ${result.minNumerator}, evaluated per instrument.`);
  if (!result.sufficient) {
    L.push('  ⚠ INSUFFICIENT DATA for a delta on the headline instrument. Record the');
    L.push('    baseline anyway — a null result is valid and informative (LIN-1241) — but');
    L.push('    do NOT read a later movement of this number as evidence either way.');
  }
  L.push('');
  L.push('  DIAGNOSTICS (so a re-read can attribute any move)');
  L.push('  ' + '─'.repeat(74));
  const d = result.diagnostics;
  L.push(`  in-window completions          ${num(d.inWindowCompletions)}`);
  L.push(`  mean relations per completed    ${d.meanRelationsPerCompleted == null ? '—' : d.meanRelationsPerCompleted.toFixed(2)}   (union of both arms)`);
  L.push(`  with >=1 relation               ${pctOf(d.pctWithAnyRelation)}`);
  L.push(`  with a review ledger            ${pctOf(d.pctWithReviewLedger)}`);
  L.push(`  with a plan marker              ${pctOf(d.pctWithPlanMarker)}`);
  L.push(`  fully matured sources           ${num(d.maturedSources)}`);
  L.push(`  unresolved peers                ${num(d.unresolvedPeers)}   (relation present, peer createdAt unreadable)`);
  L.push(`  completed but undated           ${num(d.undated)}`);
  L.push(`  duplicate input rows            ${num(d.duplicateInputs)}   (deduped on entry; non-zero means the paged read double-returned)`);
  L.push(`  skipped (fetch failed)          ${num(d.skipped)}`);
  L.push('');
  L.push('  DEFINITION (pinned on LIN-1600 — recorded so the re-read is apples-to-apples)');
  L.push('  ' + '─'.repeat(74));
  L.push(`  denominator   ${result.definition.denominatorRule}, completedAt in ${result.window.bounds}`);
  L.push(`  numerator     ${result.definition.numeratorRule}`);
  L.push(`  relations     ${result.definition.relationTypesCounted.join(', ')} — ${result.definition.relationDirection}`);
  L.push(`  excluded      ${result.definition.excluded.join('; ')}`);
  L.push(`  counting      ${result.definition.numeratorCounting}`);
  L.push(`  maturity      ${result.definition.maturityDays} days`);
  L.push(`  plan marker   ${result.definition.planMarker}   (matched against the ${result.definition.planMarkerScope} only)`);
  L.push('');
  L.push(`  read: ${meta.listCalls} list calls + ${meta.detailCalls} detail reads`);
  L.push('  Known limits are in the header of lib/follow-on-ratio.js — read them before');
  L.push('  quoting this number. The causal rule excludes ~94% of qualifying edges by');
  L.push('  design, and every instrument here is underpowered at this workspace scale.');
  L.push('');
  return L.join('\n');
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }

  if (!args.token) {
    console.error('error: set PROXY_TOKEN env var or pass --token <proxy token>');
    process.exit(2);
  }
  if (!args.windowStart || !args.windowEnd) {
    console.error('error: --window-start and --window-end are REQUIRED absolute ISO instants.');
    console.error('       There is no "last 30 days" default on purpose: a moving window is not');
    console.error('       comparable across runs, which is the whole point of the baseline.');
    console.error(USAGE);
    process.exit(2);
  }

  log(`follow-on ratio — window ${args.windowStart} → ${args.windowEnd}`);
  log(`  base ${args.base} · cache ${args.noCache ? 'disabled' : args.cache}`);
  log('  NOTE: a full pass is ~1,562 calls, ~29 minutes at the proxy rate cap.');

  log('listing issues (cursor-paged to exhaustion, no early stop)…');
  const { rows, pages } = await listAllIssues(args);
  log(`  ${rows.length} issues listed across ${pages.length} pages`);

  log('uniform detail pass over every issue (denominator + peer index)…');
  const { details, skipped } = await fetchAllDetails(rows, args);

  const asOf = iso(Date.now()); // the read's own timestamp, recorded with the result
  const result = computeFollowOnRatio(details, {
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    asOf,
    skipped,
    codeVersion: readCodeVersion(),
  });

  const meta = {
    listCalls: pages.length,
    detailCalls: details.length,
    pages,
    skipped,
    cache: args.noCache ? null : args.cache,
    listedIssues: rows.length,
  };

  if (args.json) console.log(JSON.stringify({ ...result, meta }, null, 2));
  else console.log(render(result, meta));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e?.message || e); process.exit(1); });
}
