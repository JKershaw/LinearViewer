#!/usr/bin/env node
/**
 * Fleet fossil bookkeeping pass (LIN-2633; the reviewable code is LIN-2653 S1).
 *
 * Retires ancient silent/blocked dispatch history rows by writing the narrow
 * `bookkeeping: {at, by, reason}` stamp `DispatchQueueStore.stampBookkeeping`
 * owns (LIN-2653 beat 1). `status` is NEVER touched — twelve readers key on
 * it, and the rejected `status: 'expired'` draft would have been a two-sided
 * reclassification (in-flight → no-attempt). See LIN-2633's mechanism section.
 *
 * NOT a route, NOT autopilot-reachable, NOT auto-executed on boot or anywhere
 * else — this file has no import site in the app. An operator runs it by hand.
 *
 * Usage:
 *   node scripts/fossil-pass-lin2633.js              # DRY RUN — reports, writes nothing
 *   node scripts/fossil-pass-lin2633.js --execute     # writes the stamps
 *   node scripts/fossil-pass-lin2633.js --by <label>  # actor recorded on each stamp
 *
 * Same MONGODB_URI / HARBOUR_DATA_DIR convention as server.js. Run the dry run
 * FIRST and review its report. Running `--execute` against production is
 * LIN-2655's job and is gated on John's own recorded yes relayed by the runner;
 * a later approval is not retroactive authorization for an earlier run.
 *
 * ─── ALL SELECTION LIVES HERE, NOT IN THE STORE ───────────────────────────
 *
 * Revision 2 of the approved plan (LIN-2633) moved selection out of
 * `lib/dispatch-store.js` entirely. The store gained exactly one narrow,
 * single-row write that trusts its caller; there is no `silentSince` push-down,
 * no new `listHistory` option, and no lineage derivation inside the store. This
 * script is the layer that legitimately holds the whole read model (it has to,
 * to build the report), so the selection sits here, over data already fetched.
 *
 * ─── THE CRITERION, AND WHY EACH GATE EXISTS ──────────────────────────────
 *
 * A row is eligible only if EVERY one of these holds. They are ANDed, never
 * ORed, so each can only shrink the eligible set:
 *
 *   1. It is a `taken` history row (never a live/queued row, never
 *      cancelled/expired — those are already resolved).
 *   2. It is not already stamped (the pass is idempotent; the store's own
 *      filter re-enforces this at the write).
 *   3. `classifyLoop` puts it in the `silent` or `blocked` lane. Reusing
 *      `classifyLoop` wholesale — rather than reimplementing its checks — is
 *      what makes terminal rows and live rows fall out for free: a terminal
 *      row classifies `terminal` before the lane branches are reached. A
 *      `followUpTo`-superseded row does NOT fall through to `unknown` —
 *      `classifyLoop` still classifies it `silent`/`blocked` on its own stale
 *      activity signal, so it needs the separate explicit
 *      `superseded.has(loopId)` gate below (see that gate's comment,
 *      `:378`).
 *   4. GATE 2 (F1, the one clock): `now - loopLastActivityMs(loop) >
 *      FOSSIL_AGE_MS`. This is the IDENTICAL function over the IDENTICAL Loop
 *      record with the IDENTICAL strict `>` comparison that the census itself
 *      runs (`buildSweepPayload`, `lib/observer-sweep.js:271`, over
 *      `rankableSinceMs` = `loopLastActivityMs`). Agreement with the census is
 *      therefore an identity, not a coincidence at a shared constant — do not
 *      substitute an equivalent-looking quantity, and do not redefine
 *      `FOSSIL_AGE_MS` locally; it is imported.
 *   5. GATE 3 (F3, independent): the row's OWN raw `feedback[]` timestamps —
 *      any kind, unfiltered — must ALSO predate the threshold.
 *      `loopLastActivityMs`'s telemetry and lineage components are
 *      heartbeat-filtered (`parseHeartbeats` skips `kind: 'decision'`,
 *      `lib/session-telemetry.js:189`), so a row whose most recent activity is
 *      `[blocked]`, a decision entry or an `[evidence]` line contributes
 *      NOTHING to gate 2 and would look ancient to it. `blocked` is roughly
 *      half the target population and a blocked row's defining feedback is
 *      exactly such a non-heartbeat marker, so this is not a corner case.
 *      Reading with `lean: false` is what makes raw `feedback[]` available;
 *      the 60s sweep cannot afford that, an infrequent operator pass can.
 *   6. No live (`source: 'live'`, i.e. still-queued) sibling shares its
 *      `sessionGroupId` — belt-and-suspenders over the same already-fetched
 *      array, for the historical paths that do not set `followUpTo` reliably.
 *
 * `lineageLastActivityMs === null` (a lineage that never parsed a heartbeat) is
 * NOT special-cased, and this is deliberate — do not "fix" it. It reaches
 * `Math.max(dispatchedMs||0, agentMs||0, lastBeatMs||0, lineageMs||0)`
 * (`lib/live-console.js:224`) as a dropped contribution: it neither privileges
 * the row (it is not treated as "no activity, therefore stampable") nor
 * penalises it (it is not treated as "unknown, therefore live"). It is inert.
 * Safety for a genuinely-live-but-non-heartbeating sibling is carried by gates
 * 3 and 6 above, not by how lineage nullness is interpreted.
 *
 * Revision 1's "a failed liveness read defaults to live" guarantee is retired
 * because what replaced it is STRONGER, not weaker (N4): there is no per-row
 * liveness read left to fail. A `getLoopsForWorkspace` rejection throws and
 * that whole workspace stamps nothing. The residual per-row case — a row whose
 * activity cannot be established as a finite instant at all — is handled
 * positively below: eligibility REQUIRES proof of silence, so an inconclusive
 * row is left alone rather than swept up by an "unless proven live" default,
 * which on a failed read degrades to "stamp everything".
 *
 * Named residual, not hidden: a sibling that is itself actively RUNNING but
 * has atypically posted no heartbeat AND has no `sessionGroupId`-linked queue
 * entry is not independently guarded beyond gates 3 and 6. This is the same
 * shape of over-selection `lib/dispatch-store.js:971-976` already accepts as
 * harmless-by-construction for a read, and is strictly less likely here than
 * in Revision 1 (which had no own-row raw-activity gate at all). It is what
 * the dry-run report exists for an operator to sanity-check against the real
 * corpus, which no fixture can substitute for.
 */

import { MongoClient } from 'mongodb';
import { MangoClient } from '@jkershaw/mangodb';
import { execFileSync } from 'node:child_process';
import { DispatchQueueStore } from '../lib/dispatch-store.js';
import { AgentStatusStore } from '../lib/agent-status-store.js';
import { getLoopsForWorkspace } from '../lib/pipeline-loops.js';
import { computeSupersededLoopIds } from '../lib/loop-supersede.js';
import { classifyLoop, FOSSIL_AGE_MS } from '../lib/observer-sweep.js';
import { loopLastActivityMs, DEFAULT_LANE_STALE_MS } from '../lib/live-console.js';
import { deriveTerminalStatus } from '../lib/dispatch-terminal.js';

export const STAMP_REASON = 'fossil-pass-lin2633';

// Age buckets for the dry-run report, on `now - loopLastActivityMs(loop)`.
// `>30d` MUST come back empty: the history TTL (`historyTtl`, 30 days,
// `lib/dispatch-store.js:170`) and the loop lookback (`LOOKBACK_MS`, 30 days,
// `lib/pipeline-loops.js:32`) both bound the readable band, so a row older
// than that is already pruned or already outside the read. A NON-EMPTY `>30d`
// bucket is therefore a FINDING about one of those two bounds, not a row to
// stamp — report it, do not quietly stamp it.
export const AGE_BUCKETS = [
  { key: '7-10d', minDays: 7, maxDays: 10 },
  { key: '10-14d', minDays: 10, maxDays: 14 },
  { key: '14-21d', minDays: 14, maxDays: 21 },
  { key: '21-30d', minDays: 21, maxDays: 30 },
  { key: '>30d', minDays: 30, maxDays: Infinity }
];

// Every reason a row can be passed over, in the order the filter chain tests
// them. One row gets exactly one reason, so the counts partition the corpus.
export const SKIP_REASONS = [
  'not-taken',
  'already-stamped',
  'terminal',
  'not-silent-or-blocked',
  'superseded-by-follow-up',
  'lineage-alive',
  'own-row-recent-activity',
  'live-session-group-sibling',
  'inconclusive-activity'
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Epoch ms for a timestamp value, or `null` when it cannot be established.
 *
 * The script needs its own (N6): `live-console.js`'s `_epoch` is module-private
 * (`:125`) and is not exported, so the plan's bare `epoch(...)` had no source.
 * Returns `null` rather than 0 for an unparseable value on purpose — 0 is a
 * real instant (the epoch) and would read as "ancient, therefore stampable",
 * which is exactly the direction this pass must never guess in.
 *
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
export function epochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * GATE 3's quantity (F3): the most recent instant on the row's OWN raw
 * `feedback[]`, of ANY kind, unfiltered — heartbeats, `[blocked]`, decision
 * entries, `[evidence]`, anything. Falls back to the row's own `dispatchedAt`
 * when it has never been fed back on at all.
 *
 * REQUIRES A NON-LEAN READ, and the hazard is worth naming precisely: a lean
 * Loop carries `feedback: []` (`lib/pipeline-loops.js:730`), which lands on
 * the same `dispatchedAt` fallback a genuinely never-fed-back row uses — so a
 * lean read does not fail loudly here, it silently reduces gate 3 to "was this
 * row dispatched long ago", which for a fossil is always true. That would
 * defeat the whole F3 gate without any visible error. It is why
 * `runFossilPass` hardcodes `lean: false` at its one read site rather than
 * accepting a `lean` option, and why a caller driving `selectFossilRows`
 * directly must pass non-lean loops.
 *
 * @param {Object} loop - a non-lean Loop record
 * @returns {number|null} epoch ms, or null when it cannot be established
 */
export function ownRawLastActivityMs(loop) {
  if (!loop || typeof loop !== 'object') return null;
  const feedback = Array.isArray(loop.feedback) ? loop.feedback : [];
  if (feedback.length > 0) {
    let latest = null;
    for (const entry of feedback) {
      const ms = epochMs(entry && entry.timestamp);
      // An entry whose timestamp will not parse cannot be proven old, so the
      // whole row is inconclusive rather than silently ignoring that entry.
      if (ms == null) return null;
      if (latest == null || ms > latest) latest = ms;
    }
    return latest;
  }
  return epochMs(loop.dispatchedAt);
}

/**
 * GATE 6: does any OTHER loop in this same already-fetched read share this
 * row's `sessionGroupId` and is still live (queued)? Scans the array the
 * report was built from — never a second store query.
 *
 * NULL SEMANTICS (N3), stated rather than left implicit: a row whose own
 * `sessionGroupId` is null (every pre-LIN-1341 dispatch) matches NO sibling
 * here — nullness is not treated as a wildcard that could pair it with every
 * other unstamped legacy row. Both directions are safe, and this one is
 * chosen because the opposite reading would make a single legacy queued row
 * shield the entire legacy population from a pass that exists to retire it,
 * while the safety this gate provides is already carried independently by
 * gates 2 and 3 for such a row.
 *
 * @param {Object} loop
 * @param {Array<Object>} loops - the whole workspace read
 * @returns {boolean}
 */
export function hasLiveSessionGroupSibling(loop, loops) {
  const groupId = loop && loop.sessionGroupId;
  if (!groupId) return false;
  for (const other of loops || []) {
    if (!other || other.loopId === loop.loopId) continue;
    if (other.sessionGroupId === groupId && other.source === 'live') return true;
  }
  return false;
}

/**
 * Is this row PROVEN silent past `FOSSIL_AGE_MS` on both independent clocks?
 *
 * Expressed positively on purpose (and this is load-bearing, not a style
 * choice): the function answers "can I prove this row is silent?", never "did
 * I fail to find evidence it is alive?". The second phrasing degrades to
 * "stamp everything" the moment a read fails or a timestamp will not parse.
 * So every `null`/non-finite path below returns `false` — inconclusive is
 * treated as LIVE and the row is left unstamped.
 *
 * @param {Object} loop
 * @param {number} now - epoch ms
 * @returns {{silent: boolean, reason: string|null, lastActivityMs: number|null, ownRawMs: number|null}}
 */
export function isProvenSilent(loop, now) {
  const lastActivityMs = loopLastActivityMs(loop);
  // `loopLastActivityMs` returns 0 for a loop carrying no signal at all, and
  // 0 is indistinguishable here from a genuine epoch timestamp — neither can
  // be PROVEN to be this row's real last activity, so both are inconclusive.
  if (!Number.isFinite(lastActivityMs) || lastActivityMs <= 0) {
    return { silent: false, reason: 'inconclusive-activity', lastActivityMs: null, ownRawMs: null };
  }

  // GATE 2 (F1) — the census's own test, character for character.
  if (!(now - lastActivityMs > FOSSIL_AGE_MS)) {
    // Attribute the refusal honestly: recompute the same max WITHOUT the
    // lineage component. If the row's own signals alone would have passed,
    // then a lineage sibling's heartbeat is what is holding it alive.
    const ownSignalsMs = loopLastActivityMs({ ...loop, lineageLastActivityMs: null });
    const reason = (Number.isFinite(ownSignalsMs) && ownSignalsMs > 0 && now - ownSignalsMs > FOSSIL_AGE_MS)
      ? 'lineage-alive'
      : 'own-row-recent-activity';
    return { silent: false, reason, lastActivityMs, ownRawMs: null };
  }

  // GATE 3 (F3) — the row's own raw, unfiltered feedback.
  const ownRawMs = ownRawLastActivityMs(loop);
  if (ownRawMs == null) {
    return { silent: false, reason: 'inconclusive-activity', lastActivityMs, ownRawMs: null };
  }
  if (!(now - ownRawMs > FOSSIL_AGE_MS)) {
    return { silent: false, reason: 'own-row-recent-activity', lastActivityMs, ownRawMs };
  }

  return { silent: true, reason: null, lastActivityMs, ownRawMs };
}

/**
 * Which age bucket an age in ms falls in. Lower bound inclusive, upper
 * exclusive, so the boundaries cannot double-count.
 *
 * @param {number} ageMs
 * @returns {string} an AGE_BUCKETS key
 */
export function bucketForAge(ageMs) {
  const days = ageMs / DAY_MS;
  for (const bucket of AGE_BUCKETS) {
    if (days >= bucket.minDays && days < bucket.maxDays) return bucket.key;
  }
  return AGE_BUCKETS[AGE_BUCKETS.length - 1].key;
}

/**
 * THE SELECTION. Pure: no I/O, `now` injected, one workspace's loops in, the
 * eligible set and the fully-attributed skip set out.
 *
 * MERGED-SET UNIQUENESS ARGUMENT (N2 — required explicitly of any new
 * `computeSupersededLoopIds` caller by its own header, LIN-1728 R2 `c5cdbedc`,
 * and it transfers verbatim): this function is called with the loops of ONE
 * workspace, from ONE `getLoopsForWorkspace` call, never a merged
 * cross-workspace array. Every `loopId` in that array is a dispatch item
 * `_id` — a v4 UUID minted by `addItem` — so ids are unique within the array
 * by construction, and `followUpTo` values name ids from the same id space.
 * The function is therefore never at risk of the id-collision the header
 * warns a non-dispatch-backed or cross-session caller about. `runFossilPass`
 * below preserves this by iterating workspaces one at a time and never
 * concatenating their loops.
 *
 * @param {Object} params
 * @param {Array<Object>} params.loops - one workspace's NON-LEAN Loop records
 * @param {number} params.now - epoch ms, read once per pass
 * @param {number} [params.staleMs] - classifyLoop's working→silent threshold
 * @returns {{eligible: Array<Object>, skipped: Array<Object>, skippedCounts: Object, laneCounts: Object, bucketCounts: Object}}
 */
export function selectFossilRows({ loops, now, staleMs = DEFAULT_LANE_STALE_MS }) {
  const all = Array.isArray(loops) ? loops : [];
  const superseded = computeSupersededLoopIds(all);

  const eligible = [];
  const skipped = [];
  const skippedCounts = {};
  for (const reason of SKIP_REASONS) skippedCounts[reason] = 0;
  const laneCounts = { silent: 0, blocked: 0 };
  const bucketCounts = {};
  for (const bucket of AGE_BUCKETS) bucketCounts[bucket.key] = 0;

  const skip = (loop, reason, extra = {}) => {
    skipped.push({ loopId: loop.loopId, issue: loop.issueIdentifier || null, reason, ...extra });
    skippedCounts[reason] = (skippedCounts[reason] || 0) + 1;
  };

  for (const loop of all) {
    if (!loop || typeof loop !== 'object') continue;

    // A live/queued row is not a fossil, and neither is a cancelled/expired
    // one (already resolved). This is also what makes T6 structural rather
    // than incidental: `cancelled`/`expired` never reach any later gate.
    if (loop.source !== 'history' || loop.historyStatus !== 'taken') {
      skip(loop, 'not-taken');
      continue;
    }
    if (loop.bookkeeping) {
      skip(loop, 'already-stamped');
      continue;
    }
    // Terminal exclusion, checked explicitly against the row's own raw
    // feedback via the SAME derivation `foldPeriodicalRuns` uses
    // (`deriveTerminalStatus`, `lib/dispatch-terminal.js:126`) rather than
    // relying only on `classifyLoop`'s pre-baked `terminalStatus`. Both
    // routes agree; keeping this one explicit is what lets the report
    // attribute a terminal row to `terminal` instead of burying it in the
    // lane gate, and it is a second, independent witness that a `[done]` row
    // is never stamped.
    if (deriveTerminalStatus(loop.feedback) || loop.terminalStatus) {
      skip(loop, 'terminal');
      continue;
    }

    const lane = classifyLoop(loop, { superseded, now, staleMs });
    if (lane !== 'silent' && lane !== 'blocked') {
      skip(loop, 'not-silent-or-blocked', { lane });
      continue;
    }

    // A row some other loop names via `followUpTo` has been answered by a
    // successor; the fossil pass leaves it to that successor's own fate.
    //
    // THIS CHECK IS DELIBERATE AND THE PLAN SAID IT WAS UNNECESSARY. The
    // approved plan's settled design call 2 argues a superseded row "falls
    // through every other branch to `'unknown'` (`:118`) — not `silent`/
    // `blocked` — so it is automatically excluded from selection with no
    // separate check". That is FALSE at HEAD, and the repo's own pre-existing
    // test pins the opposite: `tests/unit/observer-sweep.test.js:341` asserts
    // a superseded blocked row classifies `'silent'` ("excluded from blocked,
    // x1 falls through to its own (stale) activity signal"). `silent` is a
    // SELECTED lane, so without this check a `followUpTo`-superseded row
    // would be stamped — which the plan's own T4 says must never happen.
    // Keeping the check is the conservative direction: it can only shrink the
    // eligible set. Reported on LIN-2653 rather than silently adapted.
    if (superseded.has(loop.loopId)) {
      skip(loop, 'superseded-by-follow-up', { lane });
      continue;
    }

    const proof = isProvenSilent(loop, now);
    if (!proof.silent) {
      skip(loop, proof.reason, { lane });
      continue;
    }

    if (hasLiveSessionGroupSibling(loop, all)) {
      skip(loop, 'live-session-group-sibling', { lane });
      continue;
    }

    const ageMs = now - proof.lastActivityMs;
    const bucket = bucketForAge(ageMs);
    laneCounts[lane] += 1;
    bucketCounts[bucket] += 1;
    eligible.push({
      loopId: loop.loopId,
      urlKey: loop.workspace?.urlKey || null,
      issue: loop.issueIdentifier || null,
      lane,
      ageMs,
      bucket,
      lastActivityMs: proof.lastActivityMs,
      ownRawMs: proof.ownRawMs
    });
  }

  return { eligible, skipped, skippedCounts, laneCounts, bucketCounts };
}

/**
 * Renders the paste-ready operator report an operator posts onto LIN-2654.
 * Pure — takes the accumulated selection, returns text.
 *
 * @param {Object} params
 * @param {Array<Object>} params.perWorkspace - `{urlKey, selection, readFailed}` per workspace
 * @param {number} params.now
 * @param {string|null} [params.headSha]
 * @param {boolean} [params.execute=false]
 * @param {Array<Object>} [params.stamped] - what was actually written (--execute only)
 * @returns {string}
 */
export function buildFossilReport({ perWorkspace, now, headSha = null, execute = false, stamped = [] }) {
  const lines = [];
  const bucketTotals = {};
  for (const bucket of AGE_BUCKETS) bucketTotals[bucket.key] = 0;
  const laneTotals = { silent: 0, blocked: 0 };
  const skipTotals = {};
  for (const reason of SKIP_REASONS) skipTotals[reason] = 0;
  let eligibleTotal = 0;
  let loopTotal = 0;
  const readFailures = [];

  for (const entry of perWorkspace) {
    if (entry.readFailed) {
      readFailures.push(entry.urlKey);
      continue;
    }
    const sel = entry.selection;
    eligibleTotal += sel.eligible.length;
    loopTotal += sel.eligible.length + sel.skipped.length;
    for (const key of Object.keys(bucketTotals)) bucketTotals[key] += sel.bucketCounts[key] || 0;
    for (const key of Object.keys(laneTotals)) laneTotals[key] += sel.laneCounts[key] || 0;
    for (const key of Object.keys(sel.skippedCounts)) {
      skipTotals[key] = (skipTotals[key] || 0) + sel.skippedCounts[key];
    }
  }

  const thresholdDays = FOSSIL_AGE_MS / DAY_MS;
  lines.push(`# Fossil bookkeeping pass — ${execute ? 'EXECUTE' : 'DRY RUN'} (LIN-2633)`);
  lines.push('');
  lines.push(`Run at: ${new Date(now).toISOString()}`);
  lines.push(`HEAD: ${headSha || '(unknown — not a git checkout)'}`);
  lines.push(`Workspaces read: ${perWorkspace.length - readFailures.length}${readFailures.length ? ` (${readFailures.length} FAILED: ${readFailures.join(', ')} — stamped nothing)` : ''}`);
  lines.push(`Loops examined: ${loopTotal}`);
  lines.push('');
  lines.push('## Criterion applied');
  lines.push('');
  lines.push(`A \`taken\`, unstamped, non-terminal history row whose \`classifyLoop\` lane is \`silent\` or \`blocked\`, AND`);
  lines.push(`  (a) \`now - loopLastActivityMs(loop) > FOSSIL_AGE_MS\`  (${thresholdDays}d, strict \`>\`, the identical test buildSweepPayload runs), AND`);
  lines.push(`  (b) \`now - ownRawLastActivityMs(loop) > FOSSIL_AGE_MS\`  (the row's own raw feedback[], any kind, unfiltered), AND`);
  lines.push(`  (c) no live (queued) sibling shares its sessionGroupId.`);
  lines.push('An inconclusive row (activity that cannot be established as a finite instant) is treated as LIVE and left alone.');
  lines.push('');
  lines.push(`## Would stamp: ${eligibleTotal}`);
  lines.push('');
  lines.push('By age bucket (on `now - loopLastActivityMs`):');
  for (const bucket of AGE_BUCKETS) {
    const note = bucket.key === '>30d' && bucketTotals[bucket.key] > 0
      ? '   <-- FINDING: history TTL and the loop lookback are both 30d, so this bucket should be EMPTY. Investigate before stamping; do not treat these as rows to retire.'
      : '';
    lines.push(`  ${bucket.key.padEnd(8)} ${String(bucketTotals[bucket.key]).padStart(5)}${note}`);
  }
  lines.push('');
  lines.push('By lane:');
  lines.push(`  silent   ${String(laneTotals.silent).padStart(5)}`);
  lines.push(`  blocked  ${String(laneTotals.blocked).padStart(5)}`);
  lines.push('');
  lines.push('## Would NOT touch');
  lines.push('');
  for (const reason of SKIP_REASONS) {
    lines.push(`  ${reason.padEnd(27)} ${String(skipTotals[reason] || 0).padStart(5)}`);
  }
  lines.push('');
  lines.push('  not-taken                   live/queued, or a cancelled/expired history row — already resolved');
  lines.push('  already-stamped             a previous pass stamped it; re-running is a no-op (idempotent)');
  lines.push('  terminal                    posted [done]/[failed]/[aborted]/[skipped] — finished, not a fossil');
  lines.push('  not-silent-or-blocked       classifyLoop put it in another lane (working/queued/resolved/unknown)');
  lines.push('  superseded-by-follow-up     another loop names it via followUpTo — its successor owns it now');
  lines.push('  lineage-alive               its own signals are old but a lineage sibling heartbeated inside the threshold');
  lines.push('  own-row-recent-activity     recent activity on its own raw feedback[] — the F3 gate ([blocked]/decision/[evidence])');
  lines.push('  live-session-group-sibling  a still-queued sibling shares its sessionGroupId');
  lines.push('  inconclusive-activity       activity could not be established as a finite instant — treated as LIVE, left alone');

  if (execute) {
    lines.push('');
    lines.push(`## Stamped: ${stamped.filter(s => s.ok).length} of ${stamped.length} attempted`);
    const refused = stamped.filter(s => !s.ok && s.disposition !== 'write-error');
    const writeErrors = stamped.filter(s => !s.ok && s.disposition === 'write-error');
    if (refused.length) {
      lines.push(`Refused by the store's own filter (already stamped, or no longer \`taken\`): ${refused.length}`);
      for (const row of refused.slice(0, 20)) lines.push(`  ${row.loopId} — ${row.reason}`);
      if (refused.length > 20) lines.push(`  … and ${refused.length - 20} more`);
    }
    if (writeErrors.length) {
      lines.push(`WRITE ERROR — still eligible after the attempt, so the write itself failed (not a benign refusal): ${writeErrors.length}`);
      for (const row of writeErrors.slice(0, 20)) lines.push(`  ${row.loopId} — ${row.reason}`);
      if (writeErrors.length > 20) lines.push(`  … and ${writeErrors.length - 20} more`);
    }
  } else {
    lines.push('');
    lines.push('Dry run — nothing was written. Re-run with --execute to write these stamps.');
  }

  return lines.join('\n');
}

/**
 * Runs the pass. Exported (rather than only invoked from `main`) so tests can
 * drive it directly against fixtures or a local tmpdir Mango instance without
 * shelling out.
 *
 * @param {Object} params
 * @param {Object} params.dispatchStore
 * @param {Object} params.agentStatusStore
 * @param {Array<string>} [params.urlKeys] - defaults to listObservedWorkspaceKeys()
 * @param {number} [params.now] - epoch ms, read ONCE and reused for the whole pass
 * @param {boolean} [params.execute=false] - false (default) writes nothing
 * @param {string|null} [params.by] - actor recorded on each stamp
 * @param {string|null} [params.headSha]
 * @param {(msg: string) => void} [params.log]
 * @returns {Promise<{report: string, perWorkspace: Array<Object>, stamped: Array<Object>, execute: boolean}>}
 */
export async function runFossilPass({
  dispatchStore,
  agentStatusStore,
  urlKeys = null,
  now = Date.now(),
  execute = false,
  by = null,
  headSha = null,
  log = () => {}
}) {
  const keys = urlKeys || await dispatchStore.listObservedWorkspaceKeys();
  log(`[fossil-pass] ${execute ? 'EXECUTE' : 'DRY RUN'} over ${keys.length} workspace(s)`);

  const perWorkspace = [];
  const stamped = [];

  for (const urlKey of keys) {
    let loops;
    try {
      // The same call sweepOneWorkspace makes (lib/observer-sweep.js:358),
      // but NON-lean: gate 3 needs raw feedback[]. A rejection here throws
      // out of the try and this workspace stamps NOTHING — there is no
      // partial-read path that could stamp against half a picture (N4).
      loops = await getLoopsForWorkspace(urlKey, { lean: false, dispatchStore, agentStatusStore });
    } catch (err) {
      log(`[fossil-pass] ${urlKey}: READ FAILED (${err?.message || err}) — stamping nothing for this workspace`);
      perWorkspace.push({ urlKey, readFailed: true, error: err?.message || String(err), selection: null });
      continue;
    }

    const selection = selectFossilRows({ loops, now });
    perWorkspace.push({ urlKey, readFailed: false, selection });
    log(`[fossil-pass] ${urlKey}: ${selection.eligible.length} eligible of ${loops.length} loop(s)`);

    if (!execute) continue;

    for (const row of selection.eligible) {
      const result = await dispatchStore.stampBookkeeping(urlKey, row.loopId, { by, reason: STAMP_REASON });
      const ok = result.ok === true;
      // F4 (LIN-2653 close-out): `stampBookkeeping`'s catch collapses a genuine
      // write error into the SAME `{ok:false, reason:'not-found'}` shape as an
      // ordinary "already stamped, or no longer taken" filter miss — correct
      // for the store's own never-throws contract (lib/dispatch-store.js:
      // ~1353-1370), but a report that renders every `!ok` row as "benign
      // refusal" would misreport a transient write failure as expected during
      // `--execute`. Distinguish downstream, without touching the store: a
      // row selected as eligible was `taken` with `bookkeeping: null` at
      // selection time, so if a fresh read finds it STILL matches that same
      // shape, the write never landed even though its own precondition still
      // holds — a write error, not a refusal. Any other current state (now
      // stamped, no longer `taken`) is the ordinary benign case.
      let disposition = null;
      if (!ok) {
        const current = await dispatchStore.getItemStatus(urlKey, row.loopId).catch(() => null);
        disposition = (current && current.status === 'taken' && !current.bookkeeping)
          ? 'write-error'
          : 'refused';
      }
      stamped.push({ urlKey, loopId: row.loopId, ok, reason: result.reason || null, disposition });
    }
  }

  const report = buildFossilReport({ perWorkspace, now, headSha, execute, stamped });
  return { report, perWorkspace, stamped, execute };
}

/**
 * Best-effort HEAD sha for the report. `execFileSync` with an argv array (never
 * a shell string), so nothing here is interpolatable.
 *
 * @returns {string|null}
 */
export function readHeadSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const execute = process.argv.includes('--execute');
  const byIndex = process.argv.indexOf('--by');
  const by = byIndex !== -1 ? (process.argv[byIndex + 1] || null) : null;

  const dbClient = process.env.MONGODB_URI
    ? new MongoClient(process.env.MONGODB_URI)
    : new MangoClient(process.env.HARBOUR_DATA_DIR || './data');
  await dbClient.connect();
  const db = dbClient.db('linear-viewer');

  try {
    const dispatchStore = new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
    const agentStatusStore = new AgentStatusStore({ collection: db.collection('foreman-status') });

    const { report } = await runFossilPass({
      dispatchStore,
      agentStatusStore,
      execute,
      by,
      headSha: readHeadSha(),
      log: (msg) => console.error(msg)
    });
    console.log(report);
  } finally {
    if (dbClient.close) await dbClient.close();
  }
}

// Only run when invoked directly (`node scripts/fossil-pass-lin2633.js`), never
// on import — this is what keeps the script test-importable with no side effect,
// and in particular means importing it can never open a database connection or
// write a stamp.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('[fossil-pass] failed:', err);
    process.exitCode = 1;
  });
}
