/**
 * lib/pipeline-loops.js
 *
 * Joins dispatch history + agent-status entries into "Loop" records (one
 * dispatch attempt, queued or archived, decorated with the agent-status entry
 * that falls inside its window; LIN-245) and groups Loops into "Sessions"
 * (LIN-591): one autopilot orchestrator plus the workers it spawned, follow-up
 * threads, and standalone cli/web dispatches.
 *
 * Data flow, one direction:
 *
 *   stores ──_fetchWorkspaceData──▶ rows ──_buildLoops──▶ Loop[] ──_buildSessions──▶ Session[]
 *
 * `_buildLoops` is: admit rows → harvest aborts → derive facts → bucket per
 * issue + match agent-status → Loop record. `_buildSessions` is a fixed series
 * of claiming passes (order matters) followed by one assembly step.
 *
 * Everything but `_fetchWorkspaceData` / `redigestHistoryRows` (the only store
 * readers; LIN-3384 redaction census pins them to this file) is pure. Module
 * state is `_warnedMalformedCauses` and nothing else.
 *
 * Lean mode (LIN-622/LIN-3011): the feed reads omit `prompt` and `feedback`,
 * and a Loop's facts come from the row's persisted `feedbackDigest`. A lean and
 * a non-lean build of the same rows must agree on every fact (W1 witness in
 * tests/unit/mongo-smoke.test.js; exemptions in scripts/lin3014/lib/exemptions.mjs).
 */

import { deriveCompletedAt, harvestAbortedTargets, feedbackWithHarvestedAbort } from './dispatch-terminal.js';
import { buildSessionTelemetry, parseHeartbeats, parseDecision } from './session-telemetry.js';
import {
  isDecisionAnswerEntry, isDecisionLifecycleStampEntry, _findLastDecision, _findDecisionAnswer,
  correlateDecisionCase, deriveLoopFacingFacts, isFreshDigest, digestFeedback,
  applyHarvestedAbortToDigest, resolvedDecisionEvents,
} from './digest-feedback.js';
import { READ_HORIZON_MS } from './read-horizon.js';
import { isSessionTarget } from './dispatch-targets.js';
import { toEpochMs } from './utils/time.js';

// The decision derivations live in lib/digest-feedback.js (LIN-3008, LIN-3022):
// `deriveLoopFacingFacts` and `digestFeedback` share them, and this file already
// imports from there, so the other direction would be a cycle. These three are
// re-exported as the same function objects for existing consumers.
export { isDecisionAnswerEntry, isDecisionLifecycleStampEntry, resolvedDecisionEvents };

// LIN-3161: the loop read's window is the shared read horizon, not a store TTL.
// Exported through `__internal` because tests and `live-console` reference it.
const LOOKBACK_MS = READ_HORIZON_MS;

// A row without an `issueIdentifier` is dropped, and warned about as malformed,
// unless its kind says otherwise.
//  - `wake` (LIN-2121): normally carries an identifier; a legacy or
//    identifier-less-edge wake is uninformative alone, so dropped silently.
//  - `autopilot` (LIN-2934 R1): a GENERAL (goal-only) kickoff has no identifier
//    by design and is the session anchor `_buildSessions` reads `maxTasks` from,
//    so it SURVIVES as an identifier-less Loop.
const SILENTLY_DROPPED_WITHOUT_ISSUE = new Set(['wake']);
const ANCHOR_KINDS_WITHOUT_ISSUE = new Set(['autopilot']);

// LIN-2232: Railway caps log ingestion at 500 lines/s and a warn per malformed
// row on every poll of this hot path saturated it. Each distinct cause (source,
// reason, row id) warns once per process. Module state, kept in THIS file so a
// query-string reload resets it.
const _warnedMalformedCauses = new Set();

function _warnMalformedOnce(cause, message, detail) {
  if (_warnedMalformedCauses.has(cause)) return;
  _warnedMalformedCauses.add(cause);
  console.warn(message, detail);
}

// Loops without an issue identifier bucket under `__anchor__:<loopId>` so each
// forms its own singleton bucket (LIN-2934 S5). Callers produce no identifier
// that starts with this prefix; one that did would be treated as an anchor.
const ANCHOR_BUCKET_PREFIX = '__anchor__:';

const _dateOrNull = (ms) => (ms == null ? null : new Date(ms));

// Ascending by `dispatchedAt` (unparseable = 0), then loopId, for determinism
// when two dispatches share a millisecond.
function _byDispatchedAt(a, b) {
  const ta = toEpochMs(a.dispatchedAt) ?? 0;
  const tb = toEpochMs(b.dispatchedAt) ?? 0;
  return ta !== tb ? ta - tb : String(a.loopId).localeCompare(String(b.loopId));
}

const _byTimestamp = (a, b) => (toEpochMs(a?.timestamp) ?? 0) - (toEpochMs(b?.timestamp) ?? 0);

function _groupBy(entries, keyOf) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry ? keyOf(entry) : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

/**
 * The instant a `decision_id` was FIRST raised in a loop's feedback, or null
 * (LIN-1736: the unanswered-age half of the escalation KPIs). Forward scan, so
 * a re-ask keeps its original instant, like `resolvedDecisionEvents`.
 *
 * @param {Array<{kind?: string, message?: string, timestamp?: string}>} feedback
 * @param {string} decisionId
 * @returns {string|null}
 */
export function firstRaisedAt(feedback, decisionId) {
  if (!Array.isArray(feedback) || !decisionId) return null;
  for (const entry of feedback) {
    if (entry?.kind !== 'decision') continue;
    if (parseDecision(entry?.message)?.decision_id === decisionId) return entry.timestamp || null;
  }
  return null;
}

// ─── Small derivations ───────────────────────────────────────────────────────

/**
 * A loop's terminal completion time: the value `_buildLoops` pre-derived
 * (`terminalCompletedAt`, present on every loop this module mints, lean or not),
 * else a scan of raw `feedback` for hand-built loops. Reading the pre-derived
 * value is what makes dropping lean `feedback[]` safe (LIN-622).
 *
 * @param {Object} loop
 * @returns {string|null}
 */
function _loopCompletedAt(loop) {
  if (loop && loop.terminalCompletedAt !== undefined) return loop.terminalCompletedAt;
  return deriveCompletedAt(loop?.feedback);
}

/**
 * `agentState` from the row's source, its history `status`, and the matched
 * agent-status `status` (free-form; unknown values read as running):
 *   live → queued · expired → error · cancelled → complete (operator removed it)
 *   taken + completed → complete · failed → error · blocked → waiting · else running
 *
 * @param {'live'|'history'} source
 * @param {string|null} historyStatus
 * @param {string|null} agentStatus
 * @returns {'queued'|'running'|'waiting'|'complete'|'error'}
 */
function _deriveAgentState(source, historyStatus, agentStatus) {
  if (source === 'live') return 'queued';
  if (historyStatus === 'expired') return 'error';
  if (historyStatus === 'cancelled') return 'complete';
  if (agentStatus === 'completed') return 'complete';
  if (agentStatus === 'failed') return 'error';
  if (agentStatus === 'blocked') return 'waiting';
  return 'running';
}

/** `stage`: agentAction → promptName → 'unknown' (the two share a vocabulary). */
function _deriveStage(agentAction, promptName) {
  return agentAction || promptName || 'unknown';
}

// The later-timestamped entry. An undated `best` is always replaced, so with
// every timestamp null the last entry wins; on equal timestamps the first stays.
function _latestByTimestamp(entries) {
  return entries.reduce((best, f) => {
    if (!best) return f;
    const bestMs = toEpochMs(best.timestamp);
    if (bestMs == null) return f;
    const ms = toEpochMs(f.timestamp);
    return ms != null && ms > bestMs ? f : best;
  }, null);
}

/**
 * The agent-status entry that decorates a Loop.
 *  1. Any entry whose `dispatchId` is this loop's id wins outright (latest by
 *     timestamp).
 *  2. Otherwise the latest entry inside `[dispatchedAt, upper]`, both ends
 *     inclusive, undated entries skipped, first of equal timestamps kept.
 * `upper` is `loop._upperDate` (resolvedAt, else the next same-issue dispatch,
 * so entries don't leak across iterations), else `nowDate`.
 *
 * @param {Object} loop - carries `loopId`, `_dispatchedAtDate`, `_upperDate`
 * @param {Array}  agentStatusForIssue
 * @param {Date}   nowDate
 * @returns {Object|null}
 */
function _matchAgentStatusToLoop(loop, agentStatusForIssue, nowDate) {
  if (!agentStatusForIssue || agentStatusForIssue.length === 0) return null;

  const exact = agentStatusForIssue.filter(f => f.dispatchId && f.dispatchId === loop.loopId);
  if (exact.length > 0) return _latestByTimestamp(exact);

  const lower = loop._dispatchedAtDate;
  const upper = loop._upperDate || nowDate;
  if (!lower || !upper) return null;
  const inWindow = agentStatusForIssue.filter((f) => {
    const ms = toEpochMs(f.timestamp);
    // Negated so an Invalid Date bound (comparisons all false) excludes nothing.
    return ms != null && !(ms < lower.getTime()) && !(ms > upper.getTime());
  });
  return _latestByTimestamp(inWindow);
}

// ─── Facts: terminal / wake / decision / telemetry ───────────────────────────

/**
 * Lean-path harvest (LIN-3011): `abortTo → [aborted] entry`, read from each
 * abort row's own `feedbackDigest.terminal` since the lean read has no feedback
 * to scan. A live item never has a digest, so contributes nothing.
 */
function _harvestAbortedTargetsFromDigests(items) {
  const map = new Map();
  for (const item of items) {
    if (!item || item.abort !== true || !item.abortTo) continue;
    const terminal = item.feedbackDigest?.terminal;
    if (terminal && terminal.status === 'aborted') map.set(item.abortTo, terminal.entry);
  }
  return map;
}

/**
 * A digest read back as the shape `deriveLoopFacingFacts` produces, so a lean
 * Loop is byte-identical to a non-lean one (W1 witness). The digest's
 * conventions differ from `buildRunTelemetry`'s: `evidence` vs
 * `producedArtifacts`, `ticketMarkers` (always present) vs `ticketWalk`
 * (omitted when empty), top-level `parkedWait`; this maps each back.
 *
 * `answeredDecisions` (LIN-3022): a digest from before that change has no such
 * key (not an array) and synthesizes one entry from the scalar, with null
 * raisedAt/resolvedAt/outcome, until the row is next re-digested. A genuine
 * empty array is an already-derived digest and is kept.
 * `withdrawal` has no legacy scalar: an absent key reads as null.
 * `withdrawalReversed` (LIN-3366) is three-state: `undefined` (key present with
 * that value) for a digest that lacks it; the ticket closer holds such a loop
 * out of every write.
 *
 * @param {Object} digest - the row's (possibly abort-harvested) feedbackDigest
 */
function _loopFactsFromDigest(digest) {
  const dt = digest.telemetry || {};
  const telemetry = {
    runtime: dt.runtime || { ms: null, dispatchedAt: null, completedAt: null, crossCheck: null },
    metrics: Array.isArray(dt.metrics) ? dt.metrics : [],
    producedArtifacts: Array.isArray(dt.evidence) ? dt.evidence : [],
  };
  if (dt.model) telemetry.model = dt.model;
  if (dt.usage) telemetry.usage = dt.usage;
  if (dt.resources) telemetry.resources = dt.resources;
  if (Array.isArray(dt.ticketMarkers) && dt.ticketMarkers.length) telemetry.ticketWalk = dt.ticketMarkers;
  if (digest.parkedWait) telemetry.parkedWait = digest.parkedWait;
  return {
    terminal: digest.terminal ?? null,
    wake: digest.wake ?? null,
    decision: digest.decision ?? null,
    decisionCase: digest.decisionCase ?? [],
    answeredDecisionId: digest.answeredDecisionId ?? null,
    answeredDecisions: Array.isArray(digest.answeredDecisions)
      ? digest.answeredDecisions
      : (digest.answeredDecisionId
        ? [{ decisionId: digest.answeredDecisionId, raisedAt: null, resolvedAt: null, outcome: null }]
        : []),
    withdrawal: digest.withdrawal ?? null,
    withdrawalReversed: typeof digest.withdrawalReversed === 'boolean' ? digest.withdrawalReversed : undefined,
    telemetry,
  };
}

/**
 * The feedback a row's facts derive from: its own feedback (empty when lean:
 * the lean build never reads raw feedback, LIN-3011) plus the `[aborted]` entry
 * of any abort that targeted it. Non-mutating; LIN-1257/1261: an abort row's
 * `[aborted]` marker lives on the ABORT row (no identifier, dropped at intake),
 * so it is attributed to the loop it targets, and an earlier abort never
 * overrides a later genuine terminal.
 */
function _harvestedFeedback(item, abortEntry, lean) {
  const own = !lean && Array.isArray(item.feedback) ? item.feedback : [];
  return feedbackWithHarvestedAbort(own, abortEntry);
}

/**
 * The loop-facing facts of one row, plus the digest's `toolPeak` (lean only:
 * the always-full-window peak, which `telemetry.metrics` may have trimmed;
 * non-lean callers recompute it exactly from untrimmed metrics).
 *
 * A lean row with a digest adapts the digest. Every other row, including a
 * lean row with NO digest (a queued live item, or a history row that vanished
 * during self-heal), derives from its harvested feedback, which for a lean
 * digest-less row is just the abort entry or nothing. That single path is what
 * lets an abort reach a digest-less lean target, as the non-lean build always
 * did; the previous hand-built "no digest" default dropped it.
 */
function _deriveFacts(item, abortEntry, lean) {
  const isoDispatchedAt = item.dispatchedAt || null;
  if (lean && item.feedbackDigest) {
    const digest = applyHarvestedAbortToDigest(item.feedbackDigest, abortEntry, isoDispatchedAt);
    return { facts: _loopFactsFromDigest(digest), toolPeak: item.feedbackDigest.telemetry?.toolPeak ?? null };
  }
  return { facts: deriveLoopFacingFacts(_harvestedFeedback(item, abortEntry, lean), isoDispatchedAt), toolPeak: null };
}

// ─── Loops ───────────────────────────────────────────────────────────────────

/**
 * One drop rule for live and history rows. Returns the pre-loop record, or null
 * for a row that is malformed or outside the window. In order:
 *  1. no `id` → warn once per cause.
 *  2. no `issueIdentifier` (unless an anchor kind) → drop; warn once, except
 *     `wake`.
 *  3. unparseable `dispatchedAt` → warn on EVERY call.
 *  4. older than the cutoff → drop silently (`horizon: 'all'` skips this, LIN-3328).
 * Abort rows carry no identifier (dispatch-store `expandCascadeAborts`) so they
 * always warn once under rule 2; that is existing behaviour.
 */
function _admitRow(item, source, { cutoffMs, unbounded }) {
  if (!item || !item.id) {
    _warnMalformedOnce(`${source}:no-id:${item?.id}`, `pipeline-loops: skipping malformed ${source} item`, item?.id);
    return null;
  }
  if (!item.issueIdentifier && !ANCHOR_KINDS_WITHOUT_ISSUE.has(item.kind)) {
    if (!SILENTLY_DROPPED_WITHOUT_ISSUE.has(item.kind)) {
      _warnMalformedOnce(`${source}:no-issueIdentifier:${item.id}`, `pipeline-loops: skipping malformed ${source} item`, item.id);
    }
    return null;
  }
  const dispatchedAt = _dateOrNull(toEpochMs(item.dispatchedAt));
  if (!dispatchedAt) {
    console.warn(`pipeline-loops: skipping ${source} item with invalid dispatchedAt`, item.id);
    return null;
  }
  if (!unbounded && dispatchedAt.getTime() < cutoffMs) return null;
  return {
    _source: source,
    _raw: item,
    _dispatchedAtDate: dispatchedAt,
    _resolvedAtDate: source === 'history' ? _dateOrNull(toEpochMs(item.resolvedAt)) : null,
    loopId: item.id,
    issueIdentifier: item.issueIdentifier || null,
  };
}

/**
 * Lineage instruments (LIN-1477): the metrics of every row sharing a lineage
 * (`rootItemId ?? id`), merged chronologically, from the rows THIS call fetched
 * (so partial on issue-scoped reads, LIN-1469 §6). Strictly additive: facts such
 * as terminal and wake still read a single loop's own feedback, so a sibling's
 * `[done]` can never mark another member terminal (LIN-1469 I1).
 *  - non-lean: the harvested feedback of each member, then `parseHeartbeats`.
 *  - lean (LIN-3011): each member's retained digest metrics, already parsed.
 * Returns `(loop) → { lineageId, lineageMetrics, lineageLastActivityMs }`.
 */
function _lineageIndex(rawLoops, abortedTargets, lean) {
  const byLineage = new Map();
  const lineageIdOf = (r) => r._raw.rootItemId ?? r.loopId;
  for (const r of rawLoops) {
    const entries = lean
      ? (Array.isArray(r._raw.feedbackDigest?.telemetry?.metrics) ? r._raw.feedbackDigest.telemetry.metrics : [])
      : _harvestedFeedback(r._raw, abortedTargets.get(r.loopId), false);
    const id = lineageIdOf(r);
    if (!byLineage.has(id)) byLineage.set(id, []);
    byLineage.get(id).push(...entries);
  }
  return (r) => {
    const lineageId = lineageIdOf(r);
    const chronological = [...(byLineage.get(lineageId) || [])].sort(_byTimestamp);
    const lineageMetrics = lean ? chronological : parseHeartbeats(chronological);
    let lineageLastActivityMs = null;
    for (const m of lineageMetrics) {
      const t = toEpochMs(m.timestamp);
      if (t != null && (lineageLastActivityMs == null || t > lineageLastActivityMs)) lineageLastActivityMs = t;
    }
    return { lineageId, lineageMetrics, lineageLastActivityMs };
  };
}

// The matched agent-status entry as Loop fields (null when none matched).
// `tokenId`/`tokenLabel` are the credential identity (LIN-1587 R2).
function _agentFields(match) {
  return {
    agentAction: match?.action || null,
    agentStatus: match?.status || null,
    agentSummary: match?.summary || null,
    agentTimestamp: match?.timestamp || null,
    agentTokenId: match?.tokenId || null,
    agentTokenLabel: match?.tokenLabel || null,
  };
}

/**
 * The Loop record. Key order is part of the contract callers see.
 * Shape rules readers depend on:
 *  - `terminalStatus`, `terminalCompletedAt`, `wakeMarker`, `decision`,
 *    `decisionCase` and the rest of the build-time facts are ALWAYS present,
 *    never `undefined`: consumers test `!== undefined` to mean "built here, do
 *    not rescan feedback" (routes/dashboard.js, `_loopCompletedAt`). The one
 *    exception is `withdrawalReversed`, copied as-is (`undefined` = legacy
 *    digest, LIN-3366).
 *  - `issueSource` is sparse (LIN-3335): absent for an unstamped legacy row.
 *  - `promptText` exists only when non-lean (5-30 KB/loop, LIN-622).
 *  - `feedback` is the row's own array when non-lean, a fresh `[]` when lean.
 */
function _loopRecord({ r, iteration, match, facts, toolPeak, lineage, lean }) {
  const item = r._raw;
  const { terminal, wake } = facts;
  const historyStatus = r._source === 'history' ? (item.status || null) : null;
  const archivedAt = r._source === 'history' ? (item.resolvedAt || null) : null;
  const agent = _agentFields(match);
  return {
    loopId: r.loopId,
    issueIdentifier: r.issueIdentifier,
    issueId: item.issueId || null,
    issueTitle: item.issueTitle || null,
    issueUrl: item.issueUrl || null,
    ...(item.issueSource != null ? { issueSource: item.issueSource } : {}),
    iteration,
    kind: item.kind || null,                      // PROMPT_TEMPLATES key or the 'autopilot' meta-kind
    sessionId: item.sessionId || null,            // spawning autopilot's dispatch id (LIN-591)
    sessionGroupId: item.sessionGroupId || null,  // durable follow-up group (LIN-1341)
    followUpTo: item.followUpTo || null,          // predecessor this resumes (LIN-415)
    maxTasks: item.maxTasks ?? null,              // budget, meaningful on the anchor (LIN-1751)
    promptName: item.promptName || null,
    ...(lean ? {} : { promptText: item.prompt || null }),
    // `|| null`: a numeric 0 (only reachable under horizon:'all') reports null.
    dispatchedAt: item.dispatchedAt || null,
    // takenAt and resolvedAt are one event in the current dispatch schema (LIN-245).
    takenAt: archivedAt,
    resolvedAt: archivedAt,
    dispatchedBy: item.dispatchedBy || null,
    target: item.target || null,
    repo: item.repo || null,
    feedback: !lean && Array.isArray(item.feedback) ? item.feedback : [],
    terminalStatus: terminal ? terminal.status : null,
    terminalCompletedAt: terminal ? (terminal.entry?.timestamp || null) : null,
    wakeMarker: wake ? wake.marker : null,
    waitingMessage: wake ? wake.waitingMessage : null,
    decision: facts.decision,
    decisionCase: facts.decisionCase,
    answeredDecisionId: facts.answeredDecisionId,   // kept for readers; admit/discharge reads the set below
    answeredDecisions: facts.answeredDecisions,     // LIN-3022
    withdrawal: facts.withdrawal,                   // LIN-2891/LIN-3034
    withdrawalReversed: facts.withdrawalReversed,   // LIN-3366
    source: r._source,
    historyStatus,
    bookkeeping: item.bookkeeping || null,          // fossil stamp (LIN-2653); the lean sweep reads it
    ...agent,
    agentState: _deriveAgentState(r._source, historyStatus, agent.agentStatus),
    stage: _deriveStage(agent.agentAction, item.promptName),
    telemetry: facts.telemetry,
    toolPeak,
    ...lineage,
  };
}

/**
 * Pure builder: pre-fetched live items, history items and agent-status entries
 * (in the formatted shape the stores return; dates may be ISO strings or
 * `Date`) → a flat Loop[], bucketed per issue (first-seen order) and ascending
 * by `dispatchedAt` within each. Never touches a store.
 *
 * Within an issue's bucket: sort, then each loop's window upper bound is its
 * `resolvedAt`, else the next loop's `dispatchedAt`, else `now`; `iteration` is
 * the 1-based position. A duplicate id across live and history yields two loops.
 *
 * @param {Object} input
 * @param {Array}  [input.liveItems]
 * @param {Array}  [input.historyItems]
 * @param {Array}  [input.agentStatusEntries]
 * @param {Date}   [input.now] - must be a Date (anything else throws TypeError)
 * @param {boolean} [input.lean] - derive from `feedbackDigest`, omit `promptText`
 * @param {'all'}  [input.horizon] - `'all'` drops the 30-day cutoff (LIN-3328)
 * @returns {Array<Object>}
 */
function _buildLoops({ liveItems = [], historyItems = [], agentStatusEntries = [], now = new Date(), lean = false, horizon } = {}) {
  const intake = { cutoffMs: now.getTime() - LOOKBACK_MS, unbounded: horizon === 'all' };

  // Harvested BEFORE intake: the abort row itself is dropped there.
  const abortedTargets = lean
    ? _harvestAbortedTargetsFromDigests([...liveItems, ...historyItems])
    : harvestAbortedTargets([...liveItems, ...historyItems]);

  const rawLoops = [];
  for (const [source, items] of [['live', liveItems], ['history', historyItems]]) {
    for (const item of items) {
      const admitted = _admitRow(item, source, intake);
      if (admitted) rawLoops.push(admitted);
    }
  }

  const lineageOf = _lineageIndex(rawLoops, abortedTargets, lean);

  const buckets = _groupBy(rawLoops, r => r.issueIdentifier ?? `${ANCHOR_BUCKET_PREFIX}${r.loopId}`);
  const statusByTask = _groupBy(agentStatusEntries, f => f.taskIdentifier);
  // LIN-2934 T2: an anchor bucket's key never equals a taskIdentifier (a general
  // run's workers report under a free-form one), so it looks entries up by
  // `dispatchId`, regardless of their taskIdentifier.
  const statusByDispatchId = _groupBy(agentStatusEntries, f => f.dispatchId);

  const result = [];
  for (const [bucketKey, loops] of buckets) {
    loops.sort((a, b) => (a._dispatchedAtDate.getTime() - b._dispatchedAtDate.getTime())
      || String(a.loopId).localeCompare(String(b.loopId)));
    loops.forEach((loop, i) => {
      loop._upperDate = loop._resolvedAtDate || loops[i + 1]?._dispatchedAtDate || now;
    });

    // An anchor bucket is a singleton, so loops[0] is the anchor itself.
    const statusForBucket = bucketKey.startsWith(ANCHOR_BUCKET_PREFIX)
      ? (statusByDispatchId.get(loops[0].loopId) || [])
      : (statusByTask.get(bucketKey) || []);

    loops.forEach((r, i) => {
      const { facts, toolPeak } = _deriveFacts(r._raw, abortedTargets.get(r.loopId), lean);
      result.push(_loopRecord({
        r,
        iteration: i + 1,
        match: _matchAgentStatusToLoop(r, statusForBucket, now),
        facts,
        toolPeak,
        lineage: lineageOf(r),
        lean,
      }));
    });
  }
  return result;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/**
 * Descendant/ancestor lookups over an injected, network-free issue graph
 * `{ parentOf: { [identifier]: parentIdentifier|null } }` (see `deriveIssueGraph`).
 * Both walks are cycle-safe and return `[]` when no graph is injected.
 *
 * @param {Object|null} issueGraph
 * @returns {{descendantsOf: function(string): string[], ancestorsOf: function(string): string[]}}
 */
function _hierarchyHelpers(issueGraph) {
  const parentOf = (issueGraph && issueGraph.parentOf) || {};
  const childrenOf = new Map();
  for (const [child, parent] of Object.entries(parentOf)) {
    if (!parent) continue;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(child);
  }

  const descendantsOf = (id) => {
    const out = [];
    const seen = new Set([id]);
    for (let frontier = [id]; frontier.length;) {
      const next = [];
      for (const node of frontier) {
        for (const child of childrenOf.get(node) || []) {
          if (seen.has(child)) continue;
          seen.add(child);
          out.push(child);
          next.push(child);
        }
      }
      frontier = next;
    }
    return out;
  };

  const ancestorsOf = (id) => {
    const out = [];
    const seen = new Set([id]);
    for (let cursor = parentOf[id] || null; cursor && !seen.has(cursor); cursor = parentOf[cursor] || null) {
      seen.add(cursor);
      out.push(cursor);
    }
    return out;
  };

  return { descendantsOf, ancestorsOf };
}

/**
 * An orchestrator's inference window: its `dispatchedAt` to its terminal marker
 * (`resolvedAt` is take-time, seconds after dispatch, LIN-400, so it is not the
 * end of a long run), or `now` while in flight.
 *
 * @returns {{start: Date|null, end: Date}}
 */
function _sessionWindow(autopilotLoop, now) {
  return {
    start: _dateOrNull(toEpochMs(autopilotLoop.dispatchedAt)),
    end: _dateOrNull(toEpochMs(_loopCompletedAt(autopilotLoop))) || now,
  };
}

/**
 * A session record from its loops. `dispatchedAt` is the anchor's when known,
 * else the earliest loop's. `completedAt` is the latest terminal completion, and
 * only once EVERY loop is terminal (LIN-637): one finished subtask must not
 * report a session done while siblings run.
 *
 * `taskPosition` ("n of N", LIN-2934 N1) is derived at read time and scoped to
 * the seam's own count (dispatch-store `countDistinctTasksForSession`): loops
 * with this `sessionId`, no `followUpTo`, not an abort, with an identifier. The
 * wider `ordered` set also holds the anchor and inference-attached loops and
 * would over-count ("task 11 of 10").
 *
 * @returns {{sessionId: string, seedIssue: string|null, tasksTouched: string[], loops: Object[], dispatchedAt: string|null, completedAt: string|null, telemetry: Object, taskPosition: ({count: number, maxTasks: number}|null)}}
 */
function _assembleSession(sessionId, anchorLoop, loops) {
  const ordered = [...loops].sort(_byDispatchedAt);
  const seedIssue = anchorLoop ? (anchorLoop.issueIdentifier || null) : null;

  const tasksTouched = [...new Set([seedIssue, ...ordered.map(l => l.issueIdentifier)].filter(Boolean))];
  const dispatchedAt = (anchorLoop && anchorLoop.dispatchedAt) || ordered[0]?.dispatchedAt || null;

  let completedAt = null;
  const completions = ordered.map(_loopCompletedAt);
  if (ordered.length && completions.every(c => c != null)) {
    const latestMs = completions.map(toEpochMs).filter(ms => ms != null).reduce((a, b) => Math.max(a, b), -Infinity);
    if (latestMs !== -Infinity) completedAt = new Date(latestMs).toISOString();
  }

  const telemetry = buildSessionTelemetry({ dispatchedAt, completedAt, loops: ordered });

  let taskPosition = null;
  if (anchorLoop && typeof anchorLoop.maxTasks === 'number' && anchorLoop.maxTasks >= 1) {
    const seamTasks = new Set(ordered
      .filter(l => l.sessionId === sessionId && l.followUpTo == null && l.abort !== true && !!l.issueIdentifier)
      .map(l => l.issueIdentifier));
    taskPosition = { count: seamTasks.size, maxTasks: anchorLoop.maxTasks };
  }

  return { sessionId, seedIssue, tasksTouched, loops: ordered, dispatchedAt, completedAt, telemetry, taskPosition };
}

/**
 * Who owns which loop while sessions are being claimed. A loop with an owner IS
 * claimed; passes ask `isFree` before claiming. `records` keeps insertion order
 * but nothing depends on it: the final sort is total over unique sessionIds.
 */
function _sessionLedger() {
  const records = new Map();   // sessionId → { anchorLoop, loopsById }
  const ownerOf = new Map();   // loopId → sessionId
  const attach = (loop, sessionId) => {
    ownerOf.set(loop.loopId, sessionId);
    records.get(sessionId).loopsById.set(loop.loopId, loop);
  };
  const open = (sessionId, anchorLoop, members) => {
    records.set(sessionId, { anchorLoop, loopsById: new Map() });
    for (const m of members) attach(m, sessionId);
  };
  // Open at `loop` itself; returns the new sessionId.
  const seedAt = (loop) => { open(loop.loopId, null, [loop]); return loop.loopId; };
  const attachFree = (members, sessionId) => {
    for (const f of members) if (!ownerOf.has(f.loopId)) attach(f, sessionId);
  };
  // Eligible to be seeded or joined by the stitch and standalone passes: cli/web
  // only (V1), never an orchestrator, and not an explicit-session worker (those
  // were claimed by pass 1 or 2).
  const isFree = (l) => !ownerOf.has(l.loopId) && l.kind !== 'autopilot' && !l.sessionId && isSessionTarget(l.target);
  return { records, ownerOf, attach, open, seedAt, attachFree, isFree };
}

// Pass 1. Each autopilot anchor takes its stamped workers, plus (inference) the
// unstamped loops on its seed, descendants or ancestors inside its window.
function _claimAutopilotSessions(ledger, loops, workersBySessionId, anchors, { issueGraph, now }) {
  const { descendantsOf, ancestorsOf } = _hierarchyHelpers(issueGraph);
  for (const ap of anchors) {
    const members = new Map([[ap.loopId, ap]]);
    for (const w of workersBySessionId.get(ap.loopId) || []) members.set(w.loopId, w);

    const { start, end } = _sessionWindow(ap, now);
    if (ap.issueIdentifier && start) {
      const issues = new Set([ap.issueIdentifier, ...descendantsOf(ap.issueIdentifier), ...ancestorsOf(ap.issueIdentifier)]);
      for (const l of loops) {
        const t = toEpochMs(l.dispatchedAt);
        if (members.has(l.loopId) || l.kind === 'autopilot' || (l.sessionId && l.sessionId !== ap.loopId)) continue;
        if (!issues.has(l.issueIdentifier) || t == null || t < start.getTime() || t > end.getTime()) continue;
        members.set(l.loopId, l);
      }
    }
    ledger.open(ap.loopId, ap, members.values());
  }
}

// Pass 2. Workers stamped for an anchor that aged out: anchorless sessions.
function _claimOrphanSessions(ledger, workersBySessionId, anchorIds) {
  for (const [sessionId, workers] of workersBySessionId) {
    if (anchorIds.has(sessionId)) continue;
    const unclaimed = new Map(workers.filter(w => !ledger.ownerOf.has(w.loopId)).map(w => [w.loopId, w]));
    if (unclaimed.size > 0) ledger.open(sessionId, null, unclaimed.values());
  }
}

// Pass 3a (LIN-1341). Where a durable `sessionGroupId`'s session is:
//  (a) a session key already → join it. An autopilot worker's group id is its
//      `sessionId`, so a reply to it lands on the orchestrator's session here.
//  (b) an in-window root nothing owns → seed a session at it.
//  (c) absent (root aged out) → the followers still coalesce into ONE anchorless
//      continuation rather than each going standalone.
// A group-key loop that is itself a follow-up is an unstamped intermediate hop
// (LIN-1393: `A <- B <- C(grp=B)` from before stamping), not a root, so the
// group merges into its real chain root's session instead of seeding a second
// one at B. Returns the sessionId, or null when the root exists but is owned by
// something incompatible (the followers then fall through to the standalone pass).
function _sessionForGroup(ledger, groupId, loopById, chainRootOf) {
  if (ledger.records.has(groupId)) return groupId;
  const anchor = loopById.get(groupId);
  if (!anchor) { ledger.open(groupId, null, []); return groupId; }
  let sessionId = null;
  if (anchor.followUpTo) {
    const root = chainRootOf(anchor);
    if (root && root.loopId !== anchor.loopId) {
      sessionId = ledger.ownerOf.get(root.loopId) ?? (ledger.isFree(root) ? ledger.seedAt(root) : null);
      if (sessionId && !ledger.ownerOf.has(anchor.loopId)) ledger.attach(anchor, sessionId);
    }
  }
  return sessionId ?? (ledger.isFree(anchor) ? ledger.seedAt(anchor) : null);
}

// Pass 3 (LIN-1292). A cli/web follow-up joins the session of its thread's root
// instead of surfacing as a standalone one.
function _stitchFollowUps(ledger, loops) {
  const loopById = new Map(loops.map(l => [l.loopId, l]));
  // The root of a `followUpTo` chain; null for a cycle (malformed, never trust
  // it) or a predecessor that aged out of the window.
  const chainRootOf = (loop) => {
    const seen = new Set();
    let cur = loop;
    while (cur.followUpTo) {
      if (seen.has(cur.loopId)) return null;
      seen.add(cur.loopId);
      cur = loopById.get(cur.followUpTo);
      if (!cur) return null;
    }
    return cur;
  };

  const followers = loops.filter(l => ledger.isFree(l) && l.followUpTo);

  for (const [groupId, members] of _groupBy(followers, l => l.sessionGroupId)) {
    const sessionId = _sessionForGroup(ledger, groupId, loopById, chainRootOf);
    if (sessionId) ledger.attachFree(members, sessionId);
  }

  // 3b. Legacy chain-walk for rows with no `sessionGroupId` (self-evicting
  //     within the 30-day window).
  const unstampedByRoot = new Map();
  for (const l of followers.filter(f => !f.sessionGroupId)) {
    const root = chainRootOf(l);
    if (!root || root.loopId === l.loopId) continue;
    if (!unstampedByRoot.has(root.loopId)) unstampedByRoot.set(root.loopId, []);
    unstampedByRoot.get(root.loopId).push(l);
  }
  for (const [rootId, members] of unstampedByRoot) {
    // The root may be a MEMBER of a session (an autopilot worker), not its key.
    const root = loopById.get(rootId);
    const sessionId = ledger.ownerOf.get(rootId) ?? (ledger.isFree(root) ? ledger.seedAt(root) : null);
    if (sessionId) ledger.attachFree(members, sessionId);
  }
}

// Most recent first; ties by sessionId.
function _bySessionRecency(a, b) {
  const ta = toEpochMs(a.dispatchedAt) ?? 0;
  const tb = toEpochMs(b.dispatchedAt) ?? 0;
  return ta !== tb ? tb - ta : String(a.sessionId).localeCompare(String(b.sessionId));
}

/**
 * Pure session builder: a flat Loop[] → sessions, most recent first (ties by
 * sessionId). Sessions hold the Loop objects they were given (the materializer
 * writes `issueTitle` through them), never copies.
 *
 * A session's `sessionId` is its anchor loop's `loopId`: for an autopilot, the
 * orchestrator's dispatch id, which it stamps on each worker (LIN-591).
 *
 * Claiming passes, in order. A loop belongs to the first pass that claims it:
 *  1. Autopilot anchors take every loop stamped with their `sessionId`, plus —
 *     the inference fallback for pre-`sessionId` data, needing a seed issue —
 *     unstamped, non-orchestrator loops on the seed, its descendants or its
 *     ancestors dispatched inside the anchor's window. Never stolen from
 *     another session.
 *  2. Orphan `sessionId` groups (anchor aged out): anchorless sessions.
 *  3. Follow-up stitch (LIN-1292): a cli/web loop with `followUpTo` joins the
 *     session of its thread's root instead of surfacing as a standalone one.
 *     3a (LIN-1341) uses the durable `sessionGroupId`; 3b is the legacy
 *     chain-walk for rows stamped before it existed.
 *  4. Standalone cli/web loops (LIN-1194), one single-loop session each, keyed
 *     by their own dispatch id (the id the per-session page and reply box
 *     resolve by). The Autopilot-vs-Sessions split is a read-time filter in
 *     routes/dashboard.js, not decided here.
 * Unscoped general autopilot runs have no seed, so only explicit `sessionId`
 * recovers their workers; concurrent runs over overlapping subtrees can
 * cross-attribute unstamped workers (LIN-591).
 *
 * @param {Array<Object>} loops
 * @param {Object} [opts]
 * @param {Object|null} [opts.issueGraph]
 * @param {Date} [opts.now]
 * @returns {Array<Object>}
 */
function _buildSessions(loops = [], { issueGraph = null, now = new Date() } = {}) {
  const ledger = _sessionLedger();
  const workersBySessionId = _groupBy(loops, l => l.sessionId);
  const anchors = loops.filter(l => l.kind === 'autopilot');

  _claimAutopilotSessions(ledger, loops, workersBySessionId, anchors, { issueGraph, now });
  _claimOrphanSessions(ledger, workersBySessionId, new Set(anchors.map(ap => ap.loopId)));
  _stitchFollowUps(ledger, loops);
  for (const l of loops) if (ledger.isFree(l)) ledger.open(l.loopId, null, [l]);

  return [...ledger.records]
    .map(([sessionId, { anchorLoop, loopsById }]) => _assembleSession(sessionId, anchorLoop, [...loopsById.values()]))
    .sort(_bySessionRecency);
}

// ─── I/O boundary ────────────────────────────────────────────────────────────

/**
 * Fetch what the builders need: the live queue, the history archive and
 * agent-status entries, in parallel.
 *
 * `issueIdentifier` is pushed DOWN into every read (LIN-613) so a single-issue
 * request reads only that issue's rows via the index. It is a selective
 * predicate, never a row cap (a blanket cap truncated reconstruction and was
 * removed on purpose). History and status are also windowed by `since`
 * (`now − LOOKBACK_MS`), the cutoff `_buildLoops` applies anyway, so the store
 * never materialises rows that would be dropped (LIN-622); `horizon: 'all'`
 * drops that window (LIN-3328). The live queue is never windowed: it is small.
 *
 * `lean` (LIN-3011) projects `prompt` and `feedback` out of the history read
 * and self-heals rows whose digest is missing or stale. Stores swallow their
 * own errors into empty results; a total failure propagates.
 *
 * @param {string} urlKey
 * @param {{dispatchStore: Object, agentStatusStore: Object}} deps
 * @param {{issueIdentifier?: string, lean?: boolean, horizon?: 'all'}} [opts]
 * @returns {Promise<{live: Array, history: Array, agentStatus: Array, timing: Object}>}
 */
async function _fetchWorkspaceData(urlKey, { dispatchStore, agentStatusStore }, { issueIdentifier, lean = false, horizon } = {}) {
  const since = horizon === 'all' ? null : new Date(Date.now() - LOOKBACK_MS);
  const itemOpts = issueIdentifier ? { issueIdentifier } : undefined;
  const historyOpts = {
    ...(issueIdentifier ? { issueIdentifier } : {}),
    ...(since ? { since } : {}),
    ...(lean ? { projection: { prompt: 0, feedback: 0 } } : {}),
  };
  const statusOpts = {
    ...(issueIdentifier ? { taskIdentifier: issueIdentifier } : {}),
    ...(since ? { since } : {}),
  };

  // Time each read without serialising them: a measurement must not become the
  // latency it measures. The ms ride back on `timing` (LIN-623).
  const timed = (p) => {
    const start = Date.now();
    return p.then(value => ({ value, ms: Date.now() - start }));
  };
  const [live, history, status] = await Promise.all([
    timed(Promise.resolve(dispatchStore.listItems(urlKey, itemOpts))),
    timed(Promise.resolve(dispatchStore.listHistory(urlKey, historyOpts))),
    timed(Promise.resolve(agentStatusStore.listStatus(urlKey, statusOpts))),
  ]);

  const liveRows = Array.isArray(live.value) ? live.value : [];
  const historyFetched = Array.isArray(history.value?.items) ? history.value.items : [];
  const statusRows = Array.isArray(status.value?.items) ? status.value.items : [];
  const historyRows = lean ? await _selfHealLeanHistory(historyFetched, dispatchStore) : historyFetched;

  return {
    live: liveRows,
    history: historyRows,
    agentStatus: statusRows,
    timing: {
      liveMs: live.ms,
      historyMs: history.ms,
      statusMs: status.ms,
      liveRows: liveRows.length,
      historyRows: historyRows.length,
      statusRows: statusRows.length,
      leanRead: lean,
    },
  };
}

/**
 * Self-heal (LIN-3011): a lean row whose `feedbackDigest` is missing or stale
 * has nothing to derive facts from, so it is re-read whole by `_id`
 * (`redigestHistoryRows`) and served with the fresh digest. Only runs when the
 * store exposes `historyCollection`; a test double without it predates digests.
 *
 * A re-read failure THROWS and fails the fill (R5): never a partial batch, a
 * dropped row or a silently nulled fact. A row `listHistory` found but the
 * re-read did not (a TTL/delete race) is served with its last-known digest and
 * logged, not dropped.
 */
async function _selfHealLeanHistory(historyRows, dispatchStore) {
  if (!dispatchStore?.historyCollection) return historyRows;
  const needsHeal = (item) => item?.id && !isFreshDigest(item);
  const staleIds = historyRows.filter(needsHeal).map(item => item.id);
  if (staleIds.length === 0) return historyRows;

  const healed = await redigestHistoryRows(staleIds, dispatchStore);
  return historyRows.map((item) => {
    if (!needsHeal(item)) return item;
    const fresh = healed.get(item.id);
    if (!fresh) {
      console.error(`Self-heal: row ${item.id} vanished between listHistory and the _id $in re-read (best-effort, likely a TTL/delete race) — serving it with its last-known (stale) digest.`);
      return item;
    }
    return { ...item, feedbackVersion: fresh.feedbackVersion, feedbackDigest: fresh.feedbackDigest };
  });
}

/**
 * Re-read history rows WHOLE by `_id` (prompt excluded), digest each, and when
 * `persist` write the digest back guarded on the row's own `feedbackVersion`
 * (best-effort: a write-back failure is logged only). Shared by the lean
 * self-heal and the ticket closer's legacy-digest verify. A re-read failure
 * propagates; an id whose row vanished is absent from the result.
 *
 * @param {string[]} ids
 * @param {Object} dispatchStore
 * @param {{persist?: boolean}} [opts]
 * @returns {Promise<Map<string, {feedbackVersion: number, feedbackDigest: Object}>>}
 */
export async function redigestHistoryRows(ids, dispatchStore, { persist = true } = {}) {
  const healed = new Map();
  if (!Array.isArray(ids) || ids.length === 0) return healed;
  const rawDocs = await dispatchStore.historyCollection
    .find({ _id: { $in: ids } }, { projection: { prompt: 0 } })
    .toArray();
  await Promise.all(rawDocs.map(async (raw) => {
    const version = raw.feedbackVersion ?? 0;
    const feedbackDigest = digestFeedback(raw, { now: Date.now() });
    feedbackDigest.version = version;
    if (persist) {
      try {
        await dispatchStore.historyCollection.updateOne(
          { _id: raw._id, feedbackVersion: raw.feedbackVersion ?? null },
          { $set: { feedbackDigest } }
        );
      } catch (err) {
        console.error('Error writing back healed feedbackDigest (best-effort):', err?.message || err);
      }
    }
    healed.set(raw._id, { feedbackVersion: version, feedbackDigest });
  }));
  return healed;
}

// ─── Public API ──────────────────────────────────────────────────────────────

function _requireStores({ dispatchStore, agentStatusStore }) {
  if (!dispatchStore || !agentStatusStore) {
    throw new Error('pipeline-loops: dispatchStore and agentStatusStore must be injected');
  }
}

/**
 * All Loops for one issue, `dispatchedAt` ascending, iteration 1-based across
 * live and historic dispatches. Never lean (the task page reads `promptText`).
 *
 * @param {string} urlKey
 * @param {string} issueIdentifier e.g. "LIN-42"
 * @param {Object} [deps] - `{ dispatchStore, agentStatusStore, horizon }`;
 *   `horizon: 'all'` bypasses the 30-day window (store `since` and build cutoff)
 *   so a task page shows a task's whole life.
 * @returns {Promise<Array<Object>>}
 */
export async function getLoopsForIssue(urlKey, issueIdentifier, deps = {}) {
  if (!urlKey || !issueIdentifier) return [];
  _requireStores(deps);
  const { dispatchStore, agentStatusStore, horizon } = deps;
  const { live, history, agentStatus } = await _fetchWorkspaceData(
    urlKey, { dispatchStore, agentStatusStore }, { issueIdentifier, horizon }
  );
  return _buildLoops({ liveItems: live, historyItems: history, agentStatusEntries: agentStatus, horizon });
}

/**
 * All Loops across a workspace (iteration per issue, not global). `lean`
 * omits `promptText` and projects `prompt`/`feedback` out of the read.
 *
 * @param {string} urlKey
 * @param {Object} [deps] - `{ dispatchStore, agentStatusStore, lean }`
 * @returns {Promise<Array<Object>>}
 */
export async function getLoopsForWorkspace(urlKey, deps = {}) {
  if (!urlKey) return [];
  _requireStores(deps);
  const { dispatchStore, agentStatusStore, lean = false } = deps;
  const { live, history, agentStatus } = await _fetchWorkspaceData(urlKey, { dispatchStore, agentStatusStore }, { lean });
  return _buildLoops({ liveItems: live, historyItems: history, agentStatusEntries: agentStatus, lean });
}

/**
 * The `issueGraph` the session inference fallback needs, from the canonical
 * issues the caller already hydrated (LIN-593): identifier → parent identifier,
 * null for an issue whose parent is outside the set.
 *
 * @param {Array<Object>} issues - `{ id, identifier, parent:{id} }`
 * @returns {{parentOf: Object<string,string|null>}}
 */
export function deriveIssueGraph(issues) {
  const byId = new Map();
  for (const issue of issues || []) {
    if (issue && issue.id) byId.set(issue.id, issue);
  }
  const nameOf = (issue) => issue.identifier || issue.id;
  const parentOf = {};
  for (const issue of byId.values()) {
    const parent = issue.parent?.id ? byId.get(issue.parent.id) : null;
    parentOf[nameOf(issue)] = parent ? nameOf(parent) : null;
  }
  return { parentOf };
}

/**
 * Autopilot (and standalone, follow-up) sessions for a workspace (LIN-591).
 * The inference fallback's hierarchy is injected (`deps.issueGraph`), never
 * fetched; omit it and the fallback attaches only each seed's own loops, while
 * explicit `sessionId` grouping is unaffected.
 *
 * @param {string} urlKey
 * @param {Object} [deps] - `{ dispatchStore, agentStatusStore, issueGraph, lean }`
 * @returns {Promise<Array<Object>>} most recent first
 */
export async function getSessionsForWorkspace(urlKey, deps = {}) {
  if (!urlKey) return [];
  _requireStores(deps);
  const { dispatchStore, agentStatusStore, issueGraph = null, lean = false } = deps;
  const { live, history, agentStatus, timing } = await _fetchWorkspaceData(urlKey, { dispatchStore, agentStatusStore }, { lean });
  const buildStart = Date.now();
  const loops = _buildLoops({ liveItems: live, historyItems: history, agentStatusEntries: agentStatus, lean });
  const sessions = _buildSessions(loops, { issueGraph });
  // Cold-path I/O-vs-CPU split (LIN-623); env-gated so normal polls stay quiet.
  if (lean && process.env.OBSERVATION_FEED_TIMING === '1') {
    const t = timing || {};
    console.log(
      `[LIN-623 obs-timing] ws=${urlKey} ` +
      `readMs={live:${t.liveMs},history:${t.historyMs},status:${t.statusMs}} ` +
      `rows={history:${t.historyRows},status:${t.statusRows},live:${t.liveRows}} ` +
      `buildMs=${Date.now() - buildStart} loops=${loops.length} sessions=${sessions.length} ` +
      `projectedPrompt=${t.leanRead === true}`
    );
  }
  return sessions;
}

/**
 * Sessions over a SUBSET of a workspace's issues (LIN-623), for the
 * materialized Observation read-model. The correctness boundary is the issue
 * SET, not the session: an agent-status window ends at the NEXT dispatch of the
 * same issue, so a session is reconstructed faithfully only when every dispatch
 * of every issue it touches is present. So each issue's full row set is read
 * (issue-scoped, indexed), unioned, and run through the same `_buildLoops` /
 * `_buildSessions` as the live feed; no `issueGraph` is injected, matching
 * `mergeSessions`.
 *
 * `extraItems` (LIN-2934): rows no per-issue query can reach, namely a GENERAL
 * autopilot anchor (no identifier). Each is in the `getItemStatus` shape with a
 * `status`: `'queued'` routes it to the live bucket, anything else to history.
 * For each identifier-less one, its agent-status rows are also fetched by
 * `dispatchId` (D1), since the per-issue `taskIdentifier` reads can never match
 * them, which keeps this path identical to `getSessionsForWorkspace`.
 *
 * @param {string} urlKey
 * @param {Object} deps - `{ dispatchStore, agentStatusStore }`
 * @param {Array<string>} issueIdentifiers
 * @param {{lean?: boolean, extraItems?: Array<Object>}} [opts]
 * @returns {Promise<Array<Object>>}
 */
export async function getSessionsForIssues(urlKey, deps = {}, issueIdentifiers = [], { lean = false, extraItems = [] } = {}) {
  if (!urlKey) return [];
  _requireStores(deps);
  const { dispatchStore, agentStatusStore } = deps;
  const ids = [...new Set((issueIdentifiers || []).filter(Boolean))];
  const extras = (extraItems || []).filter(item => item && item.id != null);
  if (ids.length === 0 && (!extraItems || extraItems.length === 0)) return [];

  const since = new Date(Date.now() - LOOKBACK_MS);
  const anchorItems = extras.filter(item => !item.issueIdentifier);
  const [perIssue, anchorStatus] = await Promise.all([
    Promise.all(ids.map(issueIdentifier =>
      _fetchWorkspaceData(urlKey, { dispatchStore, agentStatusStore }, { issueIdentifier, lean }))),
    Promise.all(anchorItems.map(item =>
      Promise.resolve(agentStatusStore.listStatus(urlKey, { dispatchId: item.id, since })))),
  ]);

  // Union by id (last write wins; extras override), then build ONCE so
  // iteration numbers and status windows match a whole-workspace build.
  const liveById = new Map();
  const historyById = new Map();
  const statusById = new Map();
  const putAll = (map, rows) => { for (const x of rows) if (x && x.id != null) map.set(x.id, x); };
  for (const r of perIssue) {
    putAll(liveById, r.live);
    putAll(historyById, r.history);
    putAll(statusById, r.agentStatus);
  }
  for (const r of anchorStatus) putAll(statusById, r?.items || []);
  for (const item of extras) (item.status === 'queued' ? liveById : historyById).set(item.id, item);

  const loops = _buildLoops({
    liveItems: [...liveById.values()],
    historyItems: [...historyById.values()],
    agentStatusEntries: [...statusById.values()],
    lean,
  });
  return _buildSessions(loops, { issueGraph: null });
}

// Internal exports for unit tests. Not part of the public contract.
export const __internal = {
  _loopCompletedAt,
  _deriveAgentState,
  _deriveStage,
  _matchAgentStatusToLoop,
  _buildLoops,
  _buildSessions,
  _hierarchyHelpers,
  _sessionWindow,
  _assembleSession,
  _fetchWorkspaceData,
  _findLastDecision,
  _findDecisionAnswer,
  correlateDecisionCase,
  LOOKBACK_MS,
};
