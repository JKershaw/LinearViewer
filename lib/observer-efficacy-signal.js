/**
 * lib/observer-efficacy-signal.js
 *
 * Non-financial efficacy signal (LIN-2133, P1-6 of the LIN-2114 observer-
 * harness epic): two comparison arms, both additive and read-only, that
 * measure "did the observer notice, and did the thing get unstuck" — the
 * quantity $/day (`lib/weekly-budget.js`, LIN-2118) cannot see. Feeds P2's
 * shadow-run acceptance test (steering ruling #1); it does not itself gate
 * anything.
 *
 * ## Why this module does NOT use P1-2's ledger (lib/observer-state-store.js)
 *
 * LIN-2131's close-out handoff (LIN-2133's own comment thread) names four
 * load-bearing limits on the state store's ledger. This module sidesteps
 * all four by deriving the new-harness arm entirely from LIN-2132's shadow
 * log instead:
 *
 *  1. `attention[].since` is last-activity, a LOWER BOUND, never true
 *     blocked-since — there is no `wakeAt` counterpart. This module never
 *     claims otherwise: `detectionLagMs` below is explicitly documented as
 *     a lower-bound proxy, not true time-to-detect.
 *  2. `rev` is monotonic only within a generation — unused here entirely.
 *  3. The ledger is a ~30-minute recent-transitions buffer, and (4) a
 *     quiet-workspace can be evicted mid-observation, taking it with it.
 *     Neither limit applies to this module because it never reads the
 *     ledger: `lib/observer-shadow-log.js`'s own entries — one per tick a
 *     loop stays in the `blocked` attention lane, timestamped `recordedAt`,
 *     keyed by `loopId` — already form a per-loop time series on their own,
 *     bounded instead by THAT store's own retention
 *     (`MAX_ENTRIES_PER_WORKSPACE`/`RETENTION_IDLE_MS`, `lib/
 *     observer-shadow-log.js`), which is documented, not hidden.
 *
 * The shadow log's own continuity still rests on the sweep firing at all —
 * a workspace whose sweep instance was evicted (LIN-2131's item 4) simply
 * stops producing shadow-log entries too. That upstream risk is inherited,
 * not fixed here; LIN-2131 filed it as a decision to revisit, not a bug.
 *
 * ## The two arms
 *
 *  - **New harness** (`computeNewHarnessSignal`): from LIN-2132's shadow-log
 *    entries alone. `detectionLagMs` (lower-bound proxy, see above) and
 *    `stillBlockedObservedMs`/`relayCount` (how persistently a loop kept
 *    reappearing in the shadow log). Deliberately NO "intervention outcome"
 *    field: P1 makes no real intervention (LIN-2132's own invariant), so
 *    nothing it does can be said to have "helped" — fabricating a resolved/
 *    unresolved verdict here would be exactly the kind of unearned claim
 *    this codebase's ledger-item discipline (CLAUDE.md's close-out section)
 *    warns against.
 *  - **Incumbent** (`computeIncumbentSignal`): from a workspace's real,
 *    live loops (full, non-lean `getLoopsForWorkspace` — a lean read drops
 *    `feedback[]` entirely, `lib/pipeline-loops.js:646`). Per LIN-2133's own
 *    scope, any marker/status activity found here is attributed to the
 *    CURRENT Claude Code observer's real actions, since P1 writes neither
 *    dispatch feedback nor agent-status (LIN-2132's invariant). `timeToRespondMs`
 *    is the gap between a loop's first `[blocked]` wake marker and its next
 *    REAL feedback entry — LIN-2263 (F1): the runner posts its own bookkeeping
 *    (`kind: 'tool'`/`'usage'`) at the SAME Stop boundary as `[blocked]`
 *    (`hook.js`'s `postToolActivityDelta`/`postUsageSnapshot`), so the scan
 *    skips those kinds rather than taking the positionally-next entry —
 *    still a proxy for "when did something respond", not a verified causal
 *    link to any specific actor, but no longer mistaking the runner's own
 *    token-accounting write for a response. `resolved` reuses
 *    `deriveLifecycleStatus` (`lib/dispatch-terminal.js`) rather than
 *    reinventing marker parsing — true whenever the loop's CURRENT derived
 *    status is no longer `blocked`.
 *
 * Both arms are summarized the same way (`summarizeNumeric`) so they can be
 * placed side by side (`compareArms`) — but the two `*Ms` fields measure
 * different underlying quantities with different caveats (see above); this
 * module never collapses them into a single score, and a caller must not
 * either.
 *
 * All I/O here is read-only: `computeNewHarnessSignal`/`computeIncumbentSignal`
 * are pure; the `collect*` orchestration wrappers call only
 * `ObserverShadowLogStore#listByWorkspace` (LIN-2132) and
 * `getLoopsForWorkspace` (`lib/pipeline-loops.js`) — both reads over
 * already-stored Mongo/Mango data, no network call, no LLM call. Nothing in
 * this module writes anywhere.
 *
 * ## UI (deliberately out of scope this ticket)
 *
 * LIN-2133's own scope/testing section asks for a signal derivable from
 * already-stored data to feed P2's shadow-run acceptance test — not a
 * rendered surface. No UI is added here. The inherited constraint ("keep
 * this signal visibly distinct from LIN-2118's $ burn gauge wherever both
 * are shown") therefore has nothing to bite yet; whichever ticket first
 * renders this signal must honor it then.
 */

import { getLoopsForWorkspace } from './pipeline-loops.js';
import { deriveLifecycleStatus } from './dispatch-terminal.js';

// Matches WAKE_FEEDBACK_REGEX's `blocked` alternative (lib/dispatch-terminal.js)
// but scoped to just that one marker — this module only ever needs to find
// the FIRST `[blocked]` entry in a loop's feedback, which `dispatch-terminal.js`
// has no exported "first" scan for (only "last", via findWakeEvent/
// findTerminalFeedback). Not a new marker: the same leading-prefix contract,
// applied to the one marker this module's scope actually needs.
const BLOCKED_MARKER_RE = /^\s*\[blocked\]/i;

// LIN-2263 (F1): feedback-entry `kind`s the RUNNER posts at the same Stop
// boundary as `[blocked]` — `hook.js`'s `postToolActivityDelta` (`kind:
// 'tool'`, gated on TOOL_ACTIVITY_RELAY) and `postUsageSnapshot` (`kind:
// 'usage'`, gated on WORKER_USAGE_RELAY) both fire right after the
// `[blocked]` status entry, unconditionally on the flags. Neither is ever a
// response — it is the runner's own bookkeeping about the turn that just
// blocked — so the scan below must skip both regardless of which relay
// flags are on. Keyed on `kind`, never on position: the real response may
// be one bookkeeping entry away or several, and either flag can be off.
const RUNNER_BOOKKEEPING_KINDS = new Set(['usage', 'tool']);

/**
 * Scan forward from `fromIndex` (exclusive) for the first entry that is NOT
 * runner-emitted bookkeeping (see RUNNER_BOOKKEEPING_KINDS), or null if
 * every remaining entry is bookkeeping (or there are none) — i.e. no real
 * response has landed yet. An entry with no `kind` (pre-LIN-1475 data, or a
 * hand-built fixture) is treated as a real response, matching prior
 * behaviour for that data.
 *
 * @param {Array<{kind?: string}>} feedback
 * @param {number} fromIndex
 * @returns {Object|null}
 */
function findNextResponse(feedback, fromIndex) {
  for (let i = fromIndex + 1; i < feedback.length; i++) {
    if (!RUNNER_BOOKKEEPING_KINDS.has(feedback[i]?.kind)) return feedback[i];
  }
  return null;
}

function toMs(value) {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Summarize a numeric field across an array of rows, plus (when present) a
 * boolean `resolved` field. Null-safe: rows lacking the field, or carrying a
 * non-finite value, are excluded from the numeric aggregate but still count
 * toward `n`.
 *
 * @param {Array<Object>} rows
 * @param {string} field - the numeric field to aggregate (e.g. 'detectionLagMs')
 * @returns {{n: number, withMeasurement: number, avgMs: number|null, medianMs: number|null, resolvedCount: number|null, resolvedRate: number|null}}
 */
function summarizeNumeric(rows, field) {
  const values = rows.map((r) => r[field]).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const hasResolvedField = rows.some((r) => typeof r.resolved === 'boolean');
  const resolvedCount = hasResolvedField ? rows.filter((r) => r.resolved === true).length : null;
  return {
    n: rows.length,
    withMeasurement: values.length,
    avgMs: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    medianMs: values.length ? median(values) : null,
    resolvedCount,
    resolvedRate: hasResolvedField && rows.length ? resolvedCount / rows.length : null
  };
}

/**
 * Pure: derive the new-harness arm's efficacy signal from LIN-2132's shadow-
 * log entries. See the module header for why the ledger is not used and why
 * there is deliberately no "intervention outcome" field.
 *
 * LIN-2263 (F2): `ObserverShadowLogStore#_pruneToCapacity` evicts a
 * WORKSPACE's oldest shadow-log entries — across every loop, not per-loop —
 * once it holds `capacity` of them. When `shadowLogEntries` already sits at
 * (or past) that cap, some loop's own earliest tick may have been evicted,
 * so `firstDetectedAt`/`detectionLagMs` below can silently mean "oldest
 * SURVIVING observation" rather than true first detection (inflating
 * `detectionLagMs`, deflating `stillBlockedObservedMs`). Rather than guess
 * which loop was actually affected, this function reports `truncated: true`
 * on the whole result whenever that condition holds, so a caller can flag
 * the residue instead of trusting the numbers unconditionally past the cap.
 *
 * @param {Array<Object>} shadowLogEntries - `ObserverShadowLogStore#listByWorkspace().items`
 *   (or any array carrying `{loopId, issue, recordedAt, diagnosis:{since}}`)
 * @param {Object} [options]
 * @param {number} [options.capacity] - the store's per-workspace retention
 *   cap (`ObserverShadowLogStore#maxPerWorkspace`), if known. Omitted (or
 *   non-finite) means "unknown" — `truncated` then stays false rather than
 *   guessing.
 * @returns {{count: number, perLoop: Array<Object>, truncated: boolean, summary: Object}}
 */
export function computeNewHarnessSignal(shadowLogEntries, { capacity } = {}) {
  const entries = Array.isArray(shadowLogEntries) ? shadowLogEntries : [];
  const truncated = Number.isFinite(capacity) && entries.length >= capacity;
  const byLoop = new Map();
  for (const entry of entries) {
    if (!entry?.loopId) continue;
    if (!byLoop.has(entry.loopId)) byLoop.set(entry.loopId, []);
    byLoop.get(entry.loopId).push(entry);
  }

  const perLoop = [];
  for (const [loopId, loopEntries] of byLoop) {
    const sorted = [...loopEntries].sort((a, b) => (toMs(a.recordedAt) ?? 0) - (toMs(b.recordedAt) ?? 0));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const firstDetectedMs = toMs(first.recordedAt);
    const sinceMs = toMs(first.diagnosis?.since);
    const lastLoggedMs = toMs(last.recordedAt);

    perLoop.push({
      loopId,
      issue: first.issue ?? null,
      firstDetectedAt: first.recordedAt,
      lastLoggedAt: last.recordedAt,
      // Lower-bound proxy only — see the module header. Null when either
      // timestamp is unavailable/unparseable, never a fabricated 0.
      detectionLagMs: (firstDetectedMs != null && sinceMs != null) ? Math.max(0, firstDetectedMs - sinceMs) : null,
      // How long the harness kept re-flagging this loop as blocked, purely
      // as observed via repeat shadow-log entries — not a causal outcome.
      stillBlockedObservedMs: (firstDetectedMs != null && lastLoggedMs != null) ? Math.max(0, lastLoggedMs - firstDetectedMs) : null,
      relayCount: sorted.length
    });
  }

  return {
    count: perLoop.length,
    perLoop,
    // See the doc comment above: true when the entries handed to us already
    // sit at/past the store's retention cap, so firstDetectedAt/detectionLagMs/
    // stillBlockedObservedMs may be biased by eviction for any loop tracked
    // longer than the cap allows.
    truncated,
    summary: {
      detectionLag: summarizeNumeric(perLoop, 'detectionLagMs'),
      stillBlockedObserved: summarizeNumeric(perLoop, 'stillBlockedObservedMs')
    }
  };
}

/**
 * Find the FIRST `[blocked]` feedback entry, or null. See BLOCKED_MARKER_RE's
 * own comment for why this is a local, narrowly-scoped scan rather than a
 * reach into `lib/dispatch-terminal.js`'s internals.
 *
 * @param {Array<{message?: string, timestamp?: string}>} feedback
 * @returns {{index: number, entry: Object}|null}
 */
function findFirstBlockedMarker(feedback) {
  if (!Array.isArray(feedback)) return null;
  for (let i = 0; i < feedback.length; i++) {
    if (BLOCKED_MARKER_RE.test(feedback[i]?.message || '')) return { index: i, entry: feedback[i] };
  }
  return null;
}

/**
 * Pure: derive the incumbent arm's efficacy signal from a workspace's real,
 * live loops (full, non-lean — `feedback[]` must be present). A loop with no
 * `[blocked]` marker anywhere in its feedback contributes nothing (there is
 * no wake event to measure from).
 *
 * @param {Array<Object>} loops - non-lean `getLoopsForWorkspace()` output
 *   (each carrying a real `feedback[]`)
 * @returns {{count: number, perLoop: Array<Object>, summary: Object}}
 */
export function computeIncumbentSignal(loops) {
  const perLoop = [];
  for (const loop of loops || []) {
    const feedback = Array.isArray(loop?.feedback) ? loop.feedback : [];
    const first = findFirstBlockedMarker(feedback);
    if (!first) continue;

    const wakeAt = first.entry.timestamp ?? null;
    const next = findNextResponse(feedback, first.index);
    const respondedAt = next?.timestamp ?? null;
    const wakeMs = toMs(wakeAt);
    const respondedMs = toMs(respondedAt);

    perLoop.push({
      loopId: loop.loopId,
      issue: loop.issueIdentifier ?? null,
      wakeAt,
      respondedAt,
      timeToRespondMs: (wakeMs != null && respondedMs != null) ? Math.max(0, respondedMs - wakeMs) : null,
      // Reuses the existing, tested lifecycle derivation rather than
      // reinventing marker parsing — true once the loop's CURRENT derived
      // status has moved off `blocked` (a real terminal, or a real later
      // non-blocked wake event/resume).
      resolved: deriveLifecycleStatus(feedback) !== 'blocked'
    });
  }

  return {
    count: perLoop.length,
    perLoop,
    summary: {
      timeToRespond: summarizeNumeric(perLoop, 'timeToRespondMs')
    }
  };
}

/**
 * Bundle both arms side by side for a shadow-run comparison. Deliberately
 * NOT a single score: `detectionLagMs` (new harness) and `timeToRespondMs`
 * (incumbent) measure different quantities with different caveats — see the
 * module header. A caller (LIN-2139's future shadow-run acceptance test)
 * must read both summaries with their own documented meaning, not subtract
 * one from the other.
 *
 * @param {ReturnType<typeof computeNewHarnessSignal>} newHarnessSignal
 * @param {ReturnType<typeof computeIncumbentSignal>} incumbentSignal
 * @returns {{newHarness: Object, incumbent: Object, caveats: string[]}}
 */
export function compareArms(newHarnessSignal, incumbentSignal) {
  return {
    newHarness: newHarnessSignal,
    incumbent: incumbentSignal,
    caveats: [
      'newHarness.detectionLagMs is a lower-bound proxy (recordedAt - diagnosis.since), never true time-in-blocked.',
      'newHarness carries no intervention-outcome field: P1 makes no real intervention, so nothing it does can be said to have "helped".',
      'newHarness.truncated (LIN-2263/F2): true when the shadow log was read at/past its per-workspace retention cap (MAX_ENTRIES_PER_WORKSPACE) — firstDetectedAt/detectionLagMs/stillBlockedObservedMs for a loop tracked longer than the cap allows may be biased (inflated lag, deflated still-blocked span) by eviction of that loop\'s own earliest entries, not a genuine change in behaviour.',
      'incumbent.timeToRespondMs measures time to the next REAL feedback entry after a [blocked] marker (LIN-2263/F1: runner-emitted bookkeeping entries — kind "usage"/"tool" — are skipped), not a verified causal response.',
      'The two *Ms fields measure different quantities and must not be diffed against each other directly.'
    ]
  };
}

/**
 * Orchestration: read LIN-2132's shadow log for one workspace and compute
 * the new-harness arm. Read-only (ObserverShadowLogStore#listByWorkspace
 * only) — never calls recordActions or cleanup. Threads the store's own
 * `maxPerWorkspace` through as `capacity` (LIN-2263/F2) so
 * `computeNewHarnessSignal` can flag `truncated` — read off the store
 * instance itself rather than re-imported, since this module's own static-
 * import assertion pins it to zero imports from `./observer-shadow-log.js`.
 *
 * @param {string} urlKey
 * @param {Object} deps
 * @param {import('./observer-shadow-log.js').ObserverShadowLogStore} deps.observerShadowLogStore
 * @returns {Promise<ReturnType<typeof computeNewHarnessSignal>>}
 */
export async function collectNewHarnessSignal(urlKey, { observerShadowLogStore } = {}) {
  const { items } = await observerShadowLogStore.listByWorkspace(urlKey);
  return computeNewHarnessSignal(items, { capacity: observerShadowLogStore?.maxPerWorkspace });
}

/**
 * Orchestration: read a workspace's real, live loops (full feedback) and
 * compute the incumbent arm. Read-only — `getLoopsForWorkspace` issues no
 * write of any kind.
 *
 * @param {string} urlKey
 * @param {Object} deps
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @returns {Promise<ReturnType<typeof computeIncumbentSignal>>}
 */
export async function collectIncumbentSignal(urlKey, { dispatchStore, agentStatusStore } = {}) {
  const loops = await getLoopsForWorkspace(urlKey, { dispatchStore, agentStatusStore });
  return computeIncumbentSignal(loops);
}
