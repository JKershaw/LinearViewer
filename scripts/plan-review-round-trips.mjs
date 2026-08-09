#!/usr/bin/env node
/**
 * scripts/plan-review-round-trips.mjs  (LIN-1883 Session 1 — Implementation Plan v3)
 *
 * The network read behind the plan-review round-trips instrument. All analysis
 * lives in `lib/plan-review-round-trips.js` (pure, network-free, unit-tested);
 * this file only fetches, caches, and prints — same split as
 * `scripts/follow-on-ratio.mjs` / `lib/follow-on-ratio.js` and
 * `scripts/wall-clock-summary.mjs` / `lib/wall-clock-summary.js`.
 *
 * Usage:
 *   PROXY_TOKEN=xxx node scripts/plan-review-round-trips.mjs
 *
 *   ... --json               machine-readable result on stdout (the recorded artifact)
 *   ... --base <url>         proxy base (default $PROXY_BASE, else the live instance)
 *   ... --token <tok>        proxy token (default $PROXY_TOKEN)
 *   ... --cache <dir>        detail cache (default $TMPDIR/harbour-plan-review-round-trips-cache)
 *   ... --no-cache           ignore the on-disk cache and re-read everything (Session 2's posture)
 *   ... --ruler-change-at <ISO>  optional LIN-1859 ruler-change instant (b6c5e046) — when
 *                                 supplied, the result's diagnostics.rulerContamination
 *                                 flags R0 rows whose window straddles it
 *   ... --limit <n>          issues per list page (default 250, the proxy's max)
 *   ... --help
 *
 * NOT registered in package.json and not run by CI — deliberately, matching the
 * follow-on-ratio lineage. It is a manual instrument: run it, record the JSON,
 * and move on. Session 2 (LIN-1964) owns the durable baseline capture.
 *
 * ── THE READ PLAN ────────────────────────────────────────────────────────────
 * Per issue in the workspace:
 *   1. `GET /issues/{id}`                          — description (gateDue) + comments (tier A verdict)
 *   2. `GET /dispatch?issueIdentifier={id}&limit=…` — the H12-guarded SCOPED pipeline read (never
 *                                                      the unscoped list endpoint — LIN-1030)
 *   3. `GET /dispatch/{rowId}` per `plan-review`-kind row from (2) — feedback, for the tier B
 *      `DONE:` line
 * Steps 1 and 2 are one call each per issue; step 3 is one call per plan-review
 * row (roughly 1-2 per issue at the measured baseline shape). `--no-cache`
 * forces a full re-read for a pristine baseline (Session 2's posture); the
 * default run caches TERMINAL issues only, mirroring `follow-on-ratio.mjs`'s
 * cache-honesty note (a terminal issue can still accrue a new plan-review
 * comment, so a cached read can miss a late-posted verdict).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { computePlanReviewRoundTrips } from '../lib/plan-review-round-trips.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Terminal for CACHE purposes only — the metric reads state off the detail
// payload, same posture as follow-on-ratio.mjs.
const TERMINAL_STATES = ['completed', 'canceled', 'duplicate'];

const USAGE = `usage: PROXY_TOKEN=xxx node scripts/plan-review-round-trips.mjs \\
         [--json] [--no-cache] [--ruler-change-at <ISO>]
       [--base <url>] [--token <tok>] [--cache <dir>] [--limit <n>]`;

function parseArgs(argv) {
  const a = {
    base: process.env.PROXY_BASE || 'https://projects.jkershaw.com/api/proxy',
    token: process.env.PROXY_TOKEN || '',
    json: false, noCache: false, help: false,
    cache: join(tmpdir(), 'harbour-plan-review-round-trips-cache'),
    limit: 250,
    rulerChangeAt: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--json') a.json = true;
    else if (v === '--no-cache') a.noCache = true;
    else if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--token') a.token = argv[++i];
    else if (v === '--base') a.base = argv[++i];
    else if (v === '--cache') a.cache = argv[++i];
    else if (v === '--limit') a.limit = parseInt(argv[++i], 10) || 250;
    else if (v === '--ruler-change-at') a.rulerChangeAt = argv[++i];
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const pctOf = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const num = (x) => (x == null ? '—' : String(x));
const rateStr = (x) => (x == null ? '— (no data)' : x.toFixed(4));

// Progress and warnings go to stderr; ONLY the result goes to stdout, so
// `--json > baseline.json` yields a clean artifact.
const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

function readCodeVersion() {
  const files = ['lib/plan-review-round-trips.js', 'scripts/plan-review-round-trips.mjs'];
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

// ─── proxy fetch (same retry/backoff discipline as follow-on-ratio.mjs) ──────

async function getJson(url, token, { tries = 4, tolerate = false } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      lastErr = e;
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
      if (tolerate) return null;
      throw err;
    }
    return res.json();
  }
  if (tolerate) return null;
  throw lastErr || new Error(`rate-limited after ${tries} tries: ${url}`);
}

/**
 * Page `/issues` to exhaustion. Terminates ONLY on `hasNextPage === false` —
 * same discipline as follow-on-ratio.mjs's `listAllIssues` (this instrument's
 * denominator is a fold over an issue's WHOLE dispatch history, not creation
 * order, so an early stop would silently truncate it).
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

    if (info.hasNextPage && batch.length < limit) {
      log(`  ⚠ short page (${batch.length} < ${limit}) while hasNextPage is true — the endpoint may be clamping \`limit\``);
    }
    if (!info.hasNextPage) break;
    if (!batch.length) { log('  ⚠ empty page with hasNextPage true — stopping to avoid an endless loop'); break; }
    if (!info.endCursor) { log('  ⚠ hasNextPage true but no endCursor — cannot page further'); break; }
    if (++guard > 500) { log('  ⚠ page guard tripped at 500 pages — stopping'); break; }

    after = info.endCursor;
    await sleep(1100);
  }
  return { rows, pages };
}

/**
 * The full per-issue shape this instrument needs: description + comments
 * (`GET /issues/{id}`), then the SCOPED pipeline read
 * (`GET /dispatch?issueIdentifier=…` — never the unscoped list endpoint, the
 * LIN-1030 H12 guard), then one detail fetch per `plan-review`-kind row for
 * its `DONE:` feedback line.
 */
async function fetchIssuePlanReviewShape(row, { base, token, cache, noCache }, counters) {
  const terminal = TERMINAL_STATES.includes(row.state?.type);
  const cacheFile = join(cache, `${row.id}.json`);

  if (!noCache && terminal && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      counters.cached++;
      return cached;
    } catch { /* fall through to a live read */ }
  }

  const detail = await getJson(`${base}/issues/${row.id}`, token, { tolerate: true });
  counters.fetched++;
  await sleep(1100);
  if (!detail) return { failed: true, id: row.id, identifier: row.identifier || null };

  const listUrl = new URL(`${base}/dispatch`);
  listUrl.searchParams.set('issueIdentifier', detail.identifier || row.identifier);
  listUrl.searchParams.set('limit', '250');
  const dispatchList = await getJson(listUrl.toString(), token, { tolerate: true });
  counters.fetched++;
  await sleep(1100);
  const items = Array.isArray(dispatchList?.items) ? dispatchList.items : [];

  const rows = [];
  for (const item of items) {
    if (item.kind !== 'plan-review') {
      rows.push({ id: item.id, kind: item.kind, status: item.status, dispatchedAt: item.dispatchedAt, completedAt: item.completedAt });
      continue;
    }
    const rowDetail = await getJson(`${base}/dispatch/${item.id}`, token, { tolerate: true });
    counters.fetched++;
    await sleep(1100);
    rows.push({
      id: item.id, kind: item.kind, status: item.status,
      dispatchedAt: item.dispatchedAt, completedAt: item.completedAt,
      feedback: Array.isArray(rowDetail?.feedback) ? rowDetail.feedback : [],
    });
  }

  const shaped = {
    id: detail.id, identifier: detail.identifier,
    description: detail.description || '',
    comments: Array.isArray(detail.comments) ? detail.comments : [],
    rows,
  };

  if (!noCache && TERMINAL_STATES.includes(detail.state?.type)) {
    try { writeFileSync(cacheFile, JSON.stringify(shaped)); } catch { /* cache is best-effort */ }
  }
  return shaped;
}

async function fetchAll(listRows, args) {
  if (!args.noCache) mkdirSync(args.cache, { recursive: true });
  const issues = [];
  const skipped = [];
  const counters = { fetched: 0, cached: 0 };

  for (let i = 0; i < listRows.length; i++) {
    const row = listRows[i];
    if (!row || !row.id) { skipped.push({ id: row?.id ?? null, reason: 'list row carried no id' }); continue; }
    const shaped = await fetchIssuePlanReviewShape(row, args, counters);
    if (shaped.failed) {
      skipped.push({ id: shaped.id, identifier: shaped.identifier, reason: 'detail fetch failed after retries' });
      log(`  ⚠ skipped ${shaped.identifier || shaped.id} — detail fetch failed`);
    } else {
      issues.push(shaped);
    }
    if ((i + 1) % 25 === 0) {
      log(`  …issues ${i + 1}/${listRows.length} (${counters.fetched} calls, ${counters.cached} cached, ${skipped.length} skipped)`);
    }
  }
  log(`  read complete: ${issues.length}/${listRows.length} (${counters.fetched} calls, ${counters.cached} cached, ${skipped.length} skipped)`);
  return { issues, skipped, calls: counters.fetched };
}

// ─── render ──────────────────────────────────────────────────────────────────

function render(result, meta) {
  const L = [];
  L.push('');
  L.push('══ plan-review round trips — LIN-1883 baseline ════════════════════════════════');
  L.push(`  asOf         ${result.window.asOf}`);
  if (result.window.rulerChangeAt) L.push(`  rulerChangeAt ${result.window.rulerChangeAt}  (LIN-1859, b6c5e046)`);
  L.push(`  code         ${JSON.stringify(result.codeVersion?.files || null)}${result.codeVersion?.dirty ? '  ⚠ DIRTY TREE' : ''}`);
  L.push(`  scale        ${result.scale.issuesRead} issues read`);
  L.push('');
  L.push('  PRIMARY — first-pass approval rate');
  L.push('  ' + '─'.repeat(74));
  L.push(`    rate ${rateStr(result.primary.rate)}   n=${num(result.primary.numerator)} / d=${num(result.primary.denominator)}   ${result.primary.sufficient ? 'sufficient' : 'INSUFFICIENT'}`);
  L.push('');
  L.push('  ROUND-TRIP DISTRIBUTION (reported beside the primary, never as it)');
  L.push('  ' + '─'.repeat(74));
  L.push(`    n=${num(result.roundTrips.n)}  mean=${result.roundTrips.mean == null ? '—' : result.roundTrips.mean.toFixed(3)}  distribution=${JSON.stringify(result.roundTrips.distribution)}`);
  L.push('');
  L.push('  GATE-DUE / GATE-HONOURED (unconditioned series)');
  L.push('  ' + '─'.repeat(74));
  L.push(`    due=${num(result.gate.due)}  honoured=${num(result.gate.honoured)}  dueRate=${pctOf(result.gate.dueRate)}  honouredRate=${pctOf(result.gate.honouredRate)}  ${result.gate.sufficient ? 'sufficient' : 'INSUFFICIENT'} (floor ${result.gate.minDenominator})`);
  L.push('');
  if (!result.primary.sufficient) {
    L.push('  ⚠ INSUFFICIENT DATA on the primary rate. Record the baseline anyway — a null');
    L.push('    result is valid and informative — but do NOT read a later movement of this');
    L.push('    number as evidence either way.');
    L.push('');
  }
  L.push('  DIAGNOSTICS (so a re-read can attribute any move)');
  L.push('  ' + '─'.repeat(74));
  const d = result.diagnostics;
  L.push(`  no-genuine-attempt rows         ${num(d.noGenuineAttempt)}`);
  L.push(`  no-genuine-attempt issues       ${num(d.noGenuineAttemptIssues)}   (excluded from primary entirely)`);
  L.push(`  right-censored (first pass)     ${num(d.rightCensoredFirstPass)}   (excluded from primary — still open)`);
  L.push(`  reached but unresolved          ${num(d.reachedButUnresolvedFirstPass)}   (excluded from primary — done, no parseable verdict, no next row)`);
  L.push(`  verdict tier                    ${JSON.stringify(d.verdictTier)}`);
  L.push(`  cross-tier disagreements        ${JSON.stringify(d.crossTierDisagreements)}`);
  L.push(`  lineage bleed                   ${num(d.lineageBleed)}`);
  L.push(`  sub-windows (diagnostic-only)   ${num(d.subWindows)}`);
  if ('rulerContamination' in d) L.push(`  ruler contamination              ${num(d.rulerContamination)}`);
  L.push(`  skipped (fetch failed)          ${num(meta.skipped.length)}`);
  L.push('');
  L.push('  DEFINITION (pinned on LIN-1883 v3 — recorded so the re-read is apples-to-apples)');
  L.push('  ' + '─'.repeat(74));
  L.push(`  primary       ${result.definition.primaryRule}`);
  L.push(`  R0 walk       ${result.definition.r0EligibilityRule}`);
  L.push(`  extraction    ${result.definition.verdictExtraction}`);
  L.push(`  window        ${result.definition.windowBound}`);
  L.push(`  sufficiency   ${result.definition.sufficiencyFormula}`);
  L.push('');
  L.push(`  read: ${meta.calls} calls across ${result.scale.issuesRead} issues`);
  L.push('  Known limits are in the header of lib/plan-review-round-trips.js — read them');
  L.push('  before quoting this number.');
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

  log('plan-review round trips — full-workspace read');
  log(`  base ${args.base} · cache ${args.noCache ? 'disabled' : args.cache}`);

  log('listing issues (cursor-paged to exhaustion, no early stop)…');
  const { rows } = await listAllIssues(args);
  log(`  ${rows.length} issues listed`);

  log('per-issue read: detail + scoped dispatch pipeline + plan-review row detail…');
  const { issues, skipped, calls } = await fetchAll(rows, args);

  const asOf = iso(Date.now());
  const result = computePlanReviewRoundTrips(issues, {
    asOf,
    rulerChangeAt: args.rulerChangeAt || undefined,
    codeVersion: readCodeVersion(),
  });

  const meta = { calls, skipped, cache: args.noCache ? null : args.cache, listedIssues: rows.length };

  if (args.json) console.log(JSON.stringify({ ...result, meta }, null, 2));
  else console.log(render(result, meta));
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
