/**
 * lib/pipeline-loops.js
 *
 * Pure-function library that joins dispatch history + agent-status entries into
 * "Loop" records — the derived primary entity used by the Pipeline view.
 *
 * A Loop is one dispatch attempt (queued or archived) decorated with whichever
 * agent-status entry falls inside its timestamp window. The dispatch history
 * `_id` is the Loop's identity. Agent entries are matched by:
 *
 *   1. Exact `dispatchId` back-reference, if the agent-status writer included one.
 *   2. Otherwise: `taskIdentifier` equality + timestamp window
 *      (`dispatchedAt ≤ f.timestamp ≤ resolvedAt ?? nextDispatchAt ?? now`).
 *
 * The library does not introduce any persisted schema. It reads from
 * `dispatch-store` (live queue + history archive) and `agent-status-store`, then
 * derives `agentState`, `stage`, and per-issue 1-indexed `iteration` numbers.
 *
 * See LIN-245 for the design plan and rationale.
 *
 * Session reconstruction (LIN-591) layers on top: `getSessionsForWorkspace`
 * groups Loops into *autopilot sessions* — one orchestrator dispatch plus every
 * worker dispatch it spawned, even across the many tasks an epic descent or a
 * `breakdown` spin-off touches. It is `sessionId`-first with a network-free
 * inference fallback for historical (pre-`sessionId`) data; the hierarchy the
 * fallback needs is INJECTED, never fetched, so this module stays pure.
 */

import { deriveCompletedAt, findTerminalFeedback, findWakeEvent, harvestAbortedTargets, feedbackWithHarvestedAbort } from './dispatch-terminal.js';
import { buildRunTelemetry, buildSessionTelemetry, parseHeartbeats, parseDecision } from './session-telemetry.js';

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

// The wake markers that mean a run is *paused waiting on a human*, as opposed to
// the terminal wake markers (done/complete/failed/aborted). Rolling these up to a
// session-level "waiting on user" state is the LIN-1005 human-facing surface.
//
// ONLY `[blocked]` belongs here: it is a genuine "a human must unblock me" pause.
// `[pending]` is deliberately EXCLUDED (LIN-1025): despite being a non-terminal
// wake marker, its documented meaning (LIN-843, dispatch-terminal.js) is an
// agent-to-agent *orchestrator handoff* — a stepper beat pausing at a holdable
// boundary so the orchestrator advances the next beat — NOT a request for user
// input. Surfacing it on the "Waiting on you — needs your input" banner was a
// false positive. `[pending]` still wakes the orchestrator via the SEPARATE
// WAKE_FEEDBACK_REGEX (dispatch-terminal.js); that path is untouched. Mirror any
// change here in routes/dashboard.js (loopIsWaiting).
const WAITING_WAKE_MARKERS = new Set(['blocked']);

// ─── Decision derivation (LIN-2182 / H3) ──────────────────────────────────────

/**
 * Scan `feedback` backwards for the last entry with `kind === 'decision'` whose
 * message parses via H2's `parseDecision`, returning both the parsed object and
 * its index (or `{ decision: null, decisionEntryIndex: -1 }` when none parse).
 *
 * Deliberately NOT `parseDecisions(feedback).at(-1)`: `parseDecisions` dedupes
 * into a `Map`, which gives last-wins *value* but first-appearance *position* —
 * the tail of that array is not the chronologically last decision. The backward
 * scan mirrors the house idiom already used by this field's neighbours,
 * `findWakeEvent`/`findTerminalFeedback` (dispatch-terminal.js), and supplies
 * `correlateDecisionCase`'s index by construction.
 *
 * "Most recent unanswered by decision_id" (the ticket's original wording)
 * reduces to "most recent": answeredness is not expressible in the current
 * feedback-entry shape (no per-entry id, no answer reference), and the
 * authoritative parent LIN-1725:206-212 rules that H2/H3 derive `decision` as
 * always-unanswered until the answer sink (LIN-2154) round-trips a
 * `decision_id` — which, as of LIN-2154's first landed slice, it still does
 * not (the ruling response is a Linear comment, not a feedback-array entry).
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @returns {{decision: Object|null, decisionEntryIndex: number}}
 */
function _findLastDecision(feedback) {
  if (!Array.isArray(feedback)) return { decision: null, decisionEntryIndex: -1 };
  for (let i = feedback.length - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (entry?.kind !== 'decision') continue;
    const decision = parseDecision(entry?.message);
    if (decision) return { decision, decisionEntryIndex: i };
  }
  return { decision: null, decisionEntryIndex: -1 };
}

/**
 * Pure helper: the maximal contiguous run of `kind: 'assistant-text'` entries
 * immediately preceding `decisionEntryIndex`, as an array of message strings
 * (not pre-joined — H5/LIN-2184 owns rendering and pre-joining would discard
 * chunk boundaries). Truncates on ANY non-`assistant-text` kind, not an
 * enumerated blocklist — the heartbeat reaper is a concurrent writer in
 * another process and feedback order is `$push` arrival order, so an
 * unexpected kind can land in the gap; degrade to `[]` rather than reaching
 * past a break.
 *
 * No clock, no I/O, no closure over build state — correlation is POSITIONAL
 * only (LIN-1535): `assistant-text` entries carry no id and no route to one,
 * and `_buildLoops` has no caller-supplied clock a timestamp rule could use.
 *
 * @param {Array<{kind?: string, message?: string}>} feedback
 * @param {number} decisionEntryIndex
 * @returns {Array<string>}
 */
function correlateDecisionCase(feedback, decisionEntryIndex) {
  if (!Array.isArray(feedback) || !Number.isInteger(decisionEntryIndex)) return [];
  const run = [];
  for (let i = decisionEntryIndex - 1; i >= 0; i--) {
    const entry = feedback[i];
    if (entry?.kind !== 'assistant-text') break;
    run.push(entry?.message || '');
  }
  run.reverse();
  return run;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

/**
 * Coerce a Date | ISO-string | timestamp number to a `Date`. Returns `null`
 * if the value is missing or invalid. Never throws.
 *
 * Stores emit ISO strings via their `_formatItem` helpers, but tests and
 * future callers may pass `Date` directly — handle both.
 *
 * @param {Date|string|number|null|undefined} v
 * @returns {Date|null}
 */
function _toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The terminal-marker completion timestamp for a loop, preferring the value
 * `_buildLoops` pre-derived at build time (`terminalCompletedAt`, present on
 * every loop this module mints — lean or not). Falls back to scanning raw
 * `feedback[]` for loops built outside `_buildLoops` (e.g. hand-built test
 * fixtures). Letting session assembly read this is what makes the lean
 * `feedback[]` drop safe (LIN-622).
 *
 * @param {Object} loop
 * @returns {string|null}
 */
function _loopCompletedAt(loop) {
  if (loop && loop.terminalCompletedAt !== undefined) return loop.terminalCompletedAt;
  return deriveCompletedAt(loop?.feedback);
}

// ─── Derivations ─────────────────────────────────────────────────────────────

/**
 * Derive an `agentState` value from a dispatch record's source collection,
 * its `status` (history only), and the matched agent-status entry's `status`.
 *
 * Truth table (see LIN-245 plan, section 3):
 *
 *   live queue                                            → 'queued'
 *   history + status:'expired'                            → 'error'
 *   history + status:'cancelled'                          → 'complete'
 *   history + status:'taken' + no agent-status match           → 'running'
 *   history + status:'taken' + agentStatus 'completed'        → 'complete'
 *   history + status:'taken' + agentStatus 'failed'           → 'error'
 *   history + status:'taken' + agentStatus 'blocked'          → 'waiting'
 *   history + status:'taken' + agent-status <other free-form>  → 'running'
 *
 * Agent `status` is a free-form string (not enum-enforced) — unknown
 * values fall through to `running` rather than crash. `cancelled` is treated
 * as terminal-good because the operator explicitly removed the item.
 *
 * @param {'live'|'history'} source
 * @param {string|null} historyStatus     - dispatch row `status` (history only)
 * @param {string|null} agentStatus     - matched agent-status entry `status`, or null
 * @returns {'queued'|'running'|'waiting'|'complete'|'error'}
 */
function _deriveAgentState(source, historyStatus, agentStatus) {
  if (source === 'live') return 'queued';

  if (historyStatus === 'expired') return 'error';
  if (historyStatus === 'cancelled') return 'complete';

  // historyStatus === 'taken' (or anything else from history) — decorate by agent-status
  if (agentStatus === 'completed') return 'complete';
  if (agentStatus === 'failed') return 'error';
  if (agentStatus === 'blocked') return 'waiting';

  // No agent-status match, or unrecognised agent-status string → still running.
  return 'running';
}

/**
 * Derive a `stage` label for a Loop. Falls back through the chain:
 *
 *   agentAction → promptName → 'unknown'
 *
 * Both vocabularies share the same keys (`plan`, `breakdown`, `implementation`,
 * `review`, etc. — see `lib/prompt-template-defs.js`) so no mapping is needed.
 * `promptName` is always set by `dispatch-store.addItem()`, so the `'unknown'`
 * branch is purely defensive against malformed records.
 *
 * @param {string|null} agentAction
 * @param {string|null} promptName
 * @returns {string}
 */
function _deriveStage(agentAction, promptName) {
  return agentAction || promptName || 'unknown';
}

// ─── Join logic ──────────────────────────────────────────────────────────────

/**
 * Find the agent-status entry that decorates a given Loop.
 *
 * Strategy:
 *  1. Exact match — if any agent-status entry has `dispatchId === loop.loopId`,
 *     pick the one with the latest `timestamp`. This branch is dormant for
 *     v1 callers (the playbook does not yet write `dispatchId`) but light
 *     up automatically when consumers start forwarding it.
 *  2. Window match — among entries whose `timestamp` falls in
 *     `[dispatchedAt, upper]`, pick the latest by `timestamp`.
 *
 * `upper` is the loop's `resolvedAt` if archived, otherwise the next loop's
 * `dispatchedAt` for the same issue (so agent-status entries don't leak forward
 * across iterations), otherwise `now`.
 *
 * @param {Object} loop                       - Loop being decorated
 * @param {Array}  agentStatusForIssue            - agent-status entries pre-filtered to this issue
 * @param {Date}   nowDate                    - current time (injectable for tests)
 * @returns {Object|null}                     - matched agent-status entry doc or null
 */
function _matchAgentStatusToLoop(loop, agentStatusForIssue, nowDate) {
  if (!agentStatusForIssue || agentStatusForIssue.length === 0) return null;

  // 1. Exact-match by dispatchId — overrides window matching when present.
  const exact = agentStatusForIssue.filter(f => f.dispatchId && f.dispatchId === loop.loopId);
  if (exact.length > 0) {
    return exact.reduce((latest, f) => {
      const ft = _toDate(f.timestamp);
      const lt = latest ? _toDate(latest.timestamp) : null;
      if (!lt) return f;
      if (!ft) return latest;
      return ft.getTime() > lt.getTime() ? f : latest;
    }, null);
  }

  // 2. Window match — bounds are inclusive on both ends.
  const lower = loop._dispatchedAtDate;
  const upper = loop._upperDate || nowDate;
  if (!lower || !upper) return null;

  let best = null;
  let bestTime = -Infinity;
  for (const f of agentStatusForIssue) {
    const ft = _toDate(f.timestamp);
    if (!ft) continue;
    if (ft.getTime() < lower.getTime()) continue;
    if (ft.getTime() > upper.getTime()) continue;
    if (ft.getTime() > bestTime) {
      best = f;
      bestTime = ft.getTime();
    }
  }
  return best;
}

/**
 * Pure builder: takes pre-fetched live items, history items, and agentStatus
 * entries (already scoped to a workspace, optionally pre-filtered to a single
 * issue) and returns a flat array of Loop objects sorted by `dispatchedAt`
 * ascending within each issue.
 *
 * The function never touches stores. All inputs must already be in the
 * formatted shape produced by `dispatch-store._formatItem` /
 * `_formatHistoryItem` / `agent-status-store.listStatus`. Dates may be ISO
 * strings or `Date` instances; `_toDate` normalises both.
 *
 * @param {Object} input
 * @param {Array}  input.liveItems            - dispatch live queue items
 * @param {Array}  input.historyItems         - dispatch history items
 * @param {Array}  input.agentStatusEntries       - agent-status entries
 * @param {Date}   [input.now]                - injectable "now" for testing
 * @returns {Array<Object>}                   - flat Loop[] across all issues
 */
function _buildLoops({ liveItems = [], historyItems = [], agentStatusEntries = [], now = new Date(), lean = false } = {}) {
  const cutoff = new Date(now.getTime() - LOOKBACK_MS);

  // LIN-1257: attribute an abort's terminality to the loop it TARGETS, not to the
  // abort row itself. Simple Dispatcher posts the terminal `[aborted]` marker to
  // the abort item's OWN dispatch row, which carries `issueIdentifier: null` and is
  // therefore dropped by the reconstruction guards below (live/history) — so the
  // original target row (named by `abortTo`) never sees a terminal marker and keeps
  // rendering its last running heartbeat. Harvest each abort row's own `[aborted]`
  // entry into a map keyed by `abortTo` BEFORE those drops; further down, when
  // building the surviving target loop (`loopId === abortTo`), that entry is
  // appended to a LOCAL copy of its feedback so the single existing terminal
  // derivation (`findTerminalFeedback`) yields `terminalStatus: 'aborted'` with
  // zero changes to derivation code. Only a genuine `[aborted]` status is harvested
  // — a `[skipped]` (human-continued session; the runner refused the cancel) is
  // deliberately excluded, since nothing actually ended there. Scan BOTH lists: the
  // abort row is typically in history (status: aborted) while its target is still
  // live (status: taken). `loopId === item.id`, so `abortTo` matches the surviving
  // target loop directly — no mapping layer. The harvest + F1 append-guard live in
  // dispatch-terminal.js as ONE shared rule so this reconstruction consumer and the
  // proxy read boundary can't drift (LIN-1261).
  const abortedTargets = harvestAbortedTargets([...liveItems, ...historyItems]);

  // Normalise dispatch rows into a uniform pre-loop shape, dropping malformed
  // and out-of-window rows. Tag the source so derivation knows which path to take.
  const rawLoops = [];

  for (const item of liveItems) {
    if (!item || !item.id || !item.issueIdentifier) {
      console.warn('pipeline-loops: skipping malformed live item', item?.id);
      continue;
    }
    const dispatchedAt = _toDate(item.dispatchedAt);
    if (!dispatchedAt) {
      console.warn('pipeline-loops: skipping live item with invalid dispatchedAt', item.id);
      continue;
    }
    if (dispatchedAt.getTime() < cutoff.getTime()) continue;
    rawLoops.push({
      _source: 'live',
      _raw: item,
      _dispatchedAtDate: dispatchedAt,
      _resolvedAtDate: null,
      loopId: item.id,
      issueIdentifier: item.issueIdentifier
    });
  }

  for (const item of historyItems) {
    if (!item || !item.id || !item.issueIdentifier) {
      console.warn('pipeline-loops: skipping malformed history item', item?.id);
      continue;
    }
    const dispatchedAt = _toDate(item.dispatchedAt);
    if (!dispatchedAt) {
      console.warn('pipeline-loops: skipping history item with invalid dispatchedAt', item.id);
      continue;
    }
    if (dispatchedAt.getTime() < cutoff.getTime()) continue;
    rawLoops.push({
      _source: 'history',
      _raw: item,
      _dispatchedAtDate: dispatchedAt,
      _resolvedAtDate: _toDate(item.resolvedAt),
      loopId: item.id,
      issueIdentifier: item.issueIdentifier
    });
  }

  // LIN-1477: build an in-memory lineage→feedback aggregate from the feedback
  // rows already fetched above — zero extra reads. `lineageId = item.rootItemId
  // ?? item.id` (never backfilled; see dispatch-store.js:31), so a pre-LIN-1468
  // row with no `rootItemId` is its own lineage of one. This index is STRICTLY
  // additive and feeds only `lineageMetrics`/`lineageLastActivityMs` below — it
  // is never passed to `findWakeEvent`/`findTerminalFeedback`, which must keep
  // reading a single loop's own feedback so a sibling's `[done]` can never mark
  // another lineage member terminal (LIN-1469 I1 / the LIN-1461 sibling-collapse
  // bug this must not reintroduce).
  //
  // Built globally across every raw loop THIS CALL fetched: `getLoopsForWorkspace`
  // (all issues) yields a true cross-issue aggregate, while `getLoopsForIssue` /
  // `getSessionsForIssues` (issue-scoped reads, see their JSDoc below) naturally
  // degrade to an issue-scoped PARTIAL aggregate — rows outside the queried issue
  // set were never fetched, so they can't be counted. That degradation is the
  // accepted, closed decision from LIN-1469 §6: never worse than today's
  // behaviour, so it is left as a natural consequence of scoped reads rather than
  // special-cased here.
  const lineageFeedbackById = new Map();
  for (const r of rawLoops) {
    const lineageId = r._raw.rootItemId ?? r.loopId;
    const rawFeedback = Array.isArray(r._raw.feedback) ? r._raw.feedback : [];
    const harvested = feedbackWithHarvestedAbort(rawFeedback, abortedTargets.get(r.loopId));
    if (!lineageFeedbackById.has(lineageId)) lineageFeedbackById.set(lineageId, []);
    lineageFeedbackById.get(lineageId).push(...harvested);
  }

  // Group by issue so we can compute per-issue iteration numbers and so live
  // loops can borrow the next dispatch's timestamp as their upper bound.
  const byIssue = new Map();
  for (const r of rawLoops) {
    if (!byIssue.has(r.issueIdentifier)) byIssue.set(r.issueIdentifier, []);
    byIssue.get(r.issueIdentifier).push(r);
  }

  // Pre-group agent-status entries by taskIdentifier for cheap per-loop matching.
  const agentStatusByIssue = new Map();
  for (const f of agentStatusEntries) {
    if (!f || !f.taskIdentifier) continue;
    if (!agentStatusByIssue.has(f.taskIdentifier)) agentStatusByIssue.set(f.taskIdentifier, []);
    agentStatusByIssue.get(f.taskIdentifier).push(f);
  }

  const result = [];

  for (const [issueIdentifier, loops] of byIssue) {
    // Sort ascending by dispatchedAt; tie-break on loopId for determinism
    // when two dispatches share a millisecond timestamp.
    loops.sort((a, b) => {
      const ta = a._dispatchedAtDate.getTime();
      const tb = b._dispatchedAtDate.getTime();
      if (ta !== tb) return ta - tb;
      return String(a.loopId).localeCompare(String(b.loopId));
    });

    // Compute upper bound for each loop: resolvedAt for archived; for live,
    // the next loop's dispatchedAt (open follow-up window) or `now`.
    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i];
      if (loop._resolvedAtDate) {
        loop._upperDate = loop._resolvedAtDate;
      } else if (i + 1 < loops.length) {
        loop._upperDate = loops[i + 1]._dispatchedAtDate;
      } else {
        loop._upperDate = now;
      }
    }

    const agentStatusForIssue = agentStatusByIssue.get(issueIdentifier) || [];

    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i];
      const item = loop._raw;
      const agentStatusMatch = _matchAgentStatusToLoop(loop, agentStatusForIssue, now);

      const agentAction = agentStatusMatch ? agentStatusMatch.action || null : null;
      const agentStatus = agentStatusMatch ? agentStatusMatch.status || null : null;
      const agentSummary = agentStatusMatch ? agentStatusMatch.summary || null : null;
      const agentTimestamp = agentStatusMatch ? (agentStatusMatch.timestamp || null) : null;
      // LIN-1587 R2: carry the credential identity off the matched agent-status
      // entry onto the loop. Small scalars, so — unlike feedback[]/promptText —
      // they ride the always-present set below, not behind `lean ? {} : {…}`.
      const agentTokenId = agentStatusMatch ? (agentStatusMatch.tokenId || null) : null;
      const agentTokenLabel = agentStatusMatch ? (agentStatusMatch.tokenLabel || null) : null;

      const historyStatus = loop._source === 'history' ? (item.status || null) : null;
      const agentState = _deriveAgentState(loop._source, historyStatus, agentStatus);
      const stage = _deriveStage(agentAction, item.promptName);

      const rawFeedback = Array.isArray(item.feedback) ? item.feedback : [];
      // LIN-1257/LIN-1261: if an abort targeted THIS loop (its `abortTo` matches
      // our `loopId`), append the harvested `[aborted]` entry to a LOCAL copy of the
      // feedback so the existing derivation below marks the loop terminal. This is
      // non-mutating (the stored dispatch record is untouched); the synthetic entry
      // is last, so `findTerminalFeedback` (scan-from-end, last-wins) picks it up.
      // The F1 guard inside the shared helper refuses the append when the target
      // already ends in a LATER genuine terminal, so an earlier abort can never
      // override a `[done]`/`[failed]` or rewind `completedAt`.
      const feedback = feedbackWithHarvestedAbort(rawFeedback, abortedTargets.get(loop.loopId));
      // Pre-derive the terminal facts the feed needs — "did this finish, and
      // when?" — from feedback ONCE here, at build time, regardless of `lean`.
      // The lean feed can then drop raw `feedback[]` (the dominant per-row bytes
      // on a long autopilot run — the heartbeat / [evidence] log) and still
      // answer those questions without re-scanning: `enrichLoop` /
      // `effectiveAgentState` (routes/dashboard.js) and session assembly
      // (`_sessionWindow` / `_assembleSession`) prefer these fields. This is the
      // LIN-313 'widen the model' move — bake the derivation, don't re-read the
      // witness (LIN-622).
      const terminal = findTerminalFeedback(feedback);
      // Pre-derive the *waiting* fact the same way (LIN-1005). `findWakeEvent`
      // returns the LAST wake marker; a run is waiting-on-a-human only when that
      // latest marker is a pause signal (`[blocked]`/`[pending]`) rather than a
      // terminal one — a `[blocked]` followed by a later `[done]` is finished,
      // not waiting. Baked here so the lean feed can roll a session up to
      // "waiting on user" WITHOUT re-scanning the raw feedback it drops (LIN-622),
      // exactly like `terminalStatus` above.
      const wake = findWakeEvent(feedback);
      const wakeMarker = wake ? wake.marker : null;
      const feedbackWaiting = wakeMarker != null && WAITING_WAKE_MARKERS.has(wakeMarker);

      // Pre-derive the decision facts the same way (LIN-2182 / H3): baked here,
      // from the post-harvest `feedback` local (never `rawFeedback` — the
      // harvested `[aborted]` append changes array length and would corrupt
      // `decisionEntryIndex`, LIN-1261), so lean and non-lean loops carry the
      // SAME `decision`/`decisionCase` without re-scanning raw feedback.
      const { decision, decisionEntryIndex } = _findLastDecision(feedback);
      const decisionCase = decision ? correlateDecisionCase(feedback, decisionEntryIndex) : [];

      // LIN-1477: lineage-scoped instruments, additive alongside per-run
      // `telemetry` below. `lineageId` never replaces `loopId` — every consumer
      // that requires a stable per-item id (abortTo join, run-summary cache
      // keys, reply targeting, this builder's own Map/Set dedupe, sessionId
      // minting) keeps reading `loopId` untouched.
      const lineageId = item.rootItemId ?? loop.loopId;
      const lineageFeedback = lineageFeedbackById.get(lineageId) || [];
      // Chronological across the lineage, not fetch/iteration order — sibling
      // runs' feedback can interleave once unioned.
      const sortedLineageFeedback = [...lineageFeedback].sort((a, b) => {
        const ta = _toDate(a?.timestamp)?.getTime() ?? 0;
        const tb = _toDate(b?.timestamp)?.getTime() ?? 0;
        return ta - tb;
      });
      const lineageMetrics = parseHeartbeats(sortedLineageFeedback);
      let lineageLastActivityMs = null;
      for (const m of lineageMetrics) {
        const t = _toDate(m.timestamp)?.getTime();
        if (t != null && (lineageLastActivityMs == null || t > lineageLastActivityMs)) {
          lineageLastActivityMs = t;
        }
      }

      result.push({
        loopId: loop.loopId,
        issueIdentifier: loop.issueIdentifier,
        issueId: item.issueId || null,
        issueTitle: item.issueTitle || null,
        issueUrl: item.issueUrl || null,
        iteration: i + 1,
        // `kind` is the stable dispatch classification (a PROMPT_TEMPLATES key, or
        // the explicit meta-kind 'autopilot' for orchestrator kickoffs — see
        // lib/prompt-templates.js DISPATCH_META_KINDS). Carried through so views
        // can tell an autopilot session apart from a single worker step (LIN-509).
        kind: item.kind || null,
        // The autopilot dispatchId that spawned this worker, when stamped
        // (LIN-591). The primary key for grouping loops into an autopilot
        // session; null on the autopilot orchestrator loop itself and on any
        // pre-LIN-591 (historical) dispatch.
        sessionId: item.sessionId || null,
        // Durable session-group id (LIN-1341), when stamped. `_buildSessions`
        // groups a follow-up loop by this, O(1), in preference to walking the
        // followUpTo chain; null on any pre-LIN-1341 (historical) dispatch, which
        // falls back to that chain-walk instead. See dispatch-store.js's schema
        // comment for the full precedence rule.
        sessionGroupId: item.sessionGroupId || null,
        // The predecessor dispatch id this item resumes as a follow-up, when set
        // (LIN-415). Session assembly (`_buildSessions`) walks this chain to
        // stitch a follow-up's loop back into its original session instead of
        // letting it surface as its own standalone session (LIN-1292).
        followUpTo: item.followUpTo || null,
        promptName: item.promptName || null,
        // `promptText` is the full prompt body (5–30 KB/loop) and is the dominant
        // avoidable allocation on a 30-day history. The sessions/loops feed never
        // reads it (it's projected away downstream), so the feed-reconstruction
        // consumers pass `lean: true` to omit it entirely. The run-summary path
        // (run-summary.js / run-summary-cache.hashLoop) still needs it, so the
        // default keeps it (LIN-622).
        ...(lean ? {} : { promptText: item.prompt || null }),
        dispatchedAt: item.dispatchedAt || null,
        // takenAt and resolvedAt collapse into the same event in the current
        // dispatch schema (see LIN-245 research). Both surfaces are exposed
        // for forward-compat with the design doc, mapped from the same field.
        takenAt: loop._source === 'history' ? (item.resolvedAt || null) : null,
        resolvedAt: loop._source === 'history' ? (item.resolvedAt || null) : null,
        dispatchedBy: item.dispatchedBy || null,
        target: item.target || null,
        repo: item.repo || null,
        // `lean` drops the raw heartbeat/[evidence] log — the dominant per-row
        // bytes — once its derived facts (below + telemetry) are baked. The feed
        // never reads raw feedback; the full paths (run-summary/pipeline/Swipe)
        // don't pass `lean`, so they keep it (LIN-622).
        feedback: lean ? [] : feedback,
        // Build-time terminal facts, always present (lean and non-lean) so
        // consumers read these instead of re-scanning feedback (LIN-622).
        terminalStatus: terminal ? terminal.status : null,
        terminalCompletedAt: terminal ? (terminal.entry?.timestamp || null) : null,
        // Build-time waiting facts (LIN-1005), always present (lean and non-lean)
        // so both the lean cross-workspace feed and the non-lean session page
        // derive the SAME "waiting on user" truth without re-reading feedback.
        // `waitingMessage` carries the blocked/pending text so the UI can show the
        // actual message (V1 treats live questions and close-out blockers alike,
        // differentiating by content, not by a manufactured UI category).
        wakeMarker,
        waitingMessage: feedbackWaiting ? (wake.entry?.message || null) : null,
        // Build-time decision facts (LIN-2182 / H3), always present (lean and
        // non-lean) — `decision: null` / `decisionCase: []` when absent, NEVER
        // `undefined` and never a conditional spread. Four build-discriminators
        // use `!== undefined` to mean "was this loop built by `_buildLoops`, or
        // must I rescan raw feedback?" (routes/dashboard.js:158/278/352, and
        // this file's own `_loopCompletedAt` at :146); on a lean loop `feedback`
        // is `[]`, so a rescan would silently yield nothing. `decision` derives
        // to `null` in production until LIN-2187 supplies a schema-shaped
        // payload — see the row-17-style pin in tests/unit/pipeline-loops.test.js.
        decision,
        decisionCase,
        source: loop._source,
        historyStatus,
        agentAction,
        agentStatus,
        agentSummary,
        agentTimestamp,
        agentTokenId,
        agentTokenLabel,
        agentState,
        stage,
        // Per-run telemetry: runtime (dispatchedAt → terminal completion),
        // activity metrics, produced artifacts, and model? — all read-only
        // derivations of this loop's feedback (LIN-594). Built here from the raw
        // feedback BEFORE the lean drop, so the feed keeps its metric chips even
        // when raw feedback is not retained.
        telemetry: buildRunTelemetry({
          dispatchedAt: item.dispatchedAt || null,
          feedback
        }),
        // Lineage-aware instruments (LIN-1477), additional to the per-run
        // `telemetry` above which stays per-item and truthful (LIN-1469 I4).
        // `lineageId` is `item.rootItemId ?? loop.loopId` — read-only derived,
        // never persisted/backfilled. `lineageMetrics`/`lineageLastActivityMs`
        // are heartbeat-only aggregates across every loop sharing this lineage
        // (see the lineageFeedbackById build above); `lineageLastActivityMs` is
        // epoch ms, or null when the lineage has no parsed heartbeat yet.
        lineageId,
        lineageMetrics,
        lineageLastActivityMs
      });
    }
  }

  return result;
}

// ─── Session reconstruction (LIN-591) ────────────────────────────────────────

/**
 * Build descendant/ancestor lookups from an injected, network-free issue graph.
 *
 * The graph is supplied by the caller (the dashboard already hydrates the
 * canonical issue set and can derive parent links from it, e.g. via
 * `lib/context-graph.js`), so this module never fetches a hierarchy and stays
 * pure. Accepted shape:
 *
 *   { parentOf: { [identifier]: parentIdentifier|null } }
 *
 * `descendantsOf(id)` returns every identifier transitively parented under `id`;
 * `ancestorsOf(id)` walks the parent chain upward. Both are cycle-safe and
 * return empty arrays when no graph is injected (the fallback then attaches only
 * the seed issue's own loops).
 *
 * @param {Object|null} issueGraph
 * @returns {{descendantsOf: function(string): string[], ancestorsOf: function(string): string[]}}
 */
function _hierarchyHelpers(issueGraph) {
  const parentOf = (issueGraph && issueGraph.parentOf) || {};
  // Invert parent → children once for descendant BFS.
  const childrenOf = new Map();
  for (const [child, parent] of Object.entries(parentOf)) {
    if (!parent) continue;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(child);
  }

  const descendantsOf = (id) => {
    const out = [];
    const seen = new Set([id]);
    let frontier = [id];
    while (frontier.length) {
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
    let cursor = parentOf[id] || null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      out.push(cursor);
      cursor = parentOf[cursor] || null;
    }
    return out;
  };

  return { descendantsOf, ancestorsOf };
}

/**
 * The inference window for an autopilot orchestrator loop: from its
 * `dispatchedAt` to its truthful completion time. `resolvedAt` is take-time
 * (lands seconds after dispatch — see LIN-400) so it is NOT the end of a
 * long-lived orchestrator run; the terminal feedback marker is. An in-flight
 * run (no terminal marker yet) stays open to `now`.
 *
 * @param {Object} autopilotLoop
 * @param {Date}   now
 * @returns {{start: Date|null, end: Date}}
 */
function _sessionWindow(autopilotLoop, now) {
  const start = _toDate(autopilotLoop.dispatchedAt);
  const end = _toDate(_loopCompletedAt(autopilotLoop)) || now;
  return { start, end };
}

/**
 * Assemble a session record from its constituent loops.
 *
 * `dispatchedAt` is the anchor (orchestrator) dispatch time when known, else the
 * earliest loop's; `completedAt` is the latest truthful completion time across
 * the session's loops (terminal feedback marker, NOT take-time), null while any
 * tracked work is still unfinished.
 *
 * @param {string}        sessionId
 * @param {Object|null}   anchorLoop  - the kind:'autopilot' orchestrator loop, if present
 * @param {Array<Object>} loops
 * @returns {{sessionId: string, seedIssue: string|null, tasksTouched: string[], loops: Object[], dispatchedAt: string|null, completedAt: string|null}}
 */
function _assembleSession(sessionId, anchorLoop, loops) {
  const ordered = [...loops].sort((a, b) => {
    const ta = _toDate(a.dispatchedAt)?.getTime() ?? 0;
    const tb = _toDate(b.dispatchedAt)?.getTime() ?? 0;
    if (ta !== tb) return ta - tb;
    return String(a.loopId).localeCompare(String(b.loopId));
  });

  const seedIssue = anchorLoop ? (anchorLoop.issueIdentifier || null) : null;

  // tasksTouched: distinct issue identifiers, seed first then first-seen order.
  const tasksTouched = [];
  const seenTasks = new Set();
  for (const id of [seedIssue, ...ordered.map(l => l.issueIdentifier)]) {
    if (id && !seenTasks.has(id)) { seenTasks.add(id); tasksTouched.push(id); }
  }

  const dispatchedAt = (anchorLoop && anchorLoop.dispatchedAt) || ordered[0]?.dispatchedAt || null;

  // completedAt = latest terminal completion across loops, but ONLY once EVERY
  // tracked loop is terminal; null while any loop is still unfinished (LIN-637).
  // A session with several subtasks must not report done because one subtask
  // emitted a terminal marker while siblings are still running.
  let completedAt = null;
  if (ordered.length && ordered.every(l => _loopCompletedAt(l) != null)) {
    let completedAtMs = -Infinity;
    for (const l of ordered) {
      const c = _toDate(_loopCompletedAt(l));
      if (c && c.getTime() > completedAtMs) { completedAt = c.toISOString(); completedAtMs = c.getTime(); }
    }
  }

  // Session-level telemetry (LIN-594): runtime from the assembled window, with
  // metrics / produced artifacts / model? aggregated across the session's loops.
  const telemetry = buildSessionTelemetry({ dispatchedAt, completedAt, loops: ordered });

  return { sessionId, seedIssue, tasksTouched, loops: ordered, dispatchedAt, completedAt, telemetry };
}

/**
 * Pure session builder: groups a flat Loop[] into autopilot sessions.
 *
 * Identity: a session's `sessionId` is the autopilot orchestrator's dispatch id
 * — which is that orchestrator loop's own `loopId`, and exactly the value the
 * autopilot stamps onto each worker's `sessionId` (LIN-591). So a forward-
 * stamped run and an inference-reconstructed run share one stable id.
 *
 * Two attachment paths, unioned per session (deduped by `loopId`):
 *   1. Explicit (`sessionId`-first): every loop whose `sessionId` equals the
 *      orchestrator's `loopId`. Authoritative — works across ALL targets and
 *      regardless of hierarchy (the epic-descent / breakdown spin-off case).
 *   2. Inference fallback (historical, no `sessionId`): worker loops whose
 *      issue is the seed, a descendant, or an ancestor of the seed AND whose
 *      `dispatchedAt` falls within the orchestrator's run window. A loop already
 *      stamped for a DIFFERENT session is never stolen.
 *
 * Orphan `sessionId` groups (workers referencing an orchestrator that has aged
 * out of the 30-day window) are emitted as anchorless sessions (seedIssue null).
 *
 * A third, independent attachment (LIN-1292): a loop carrying `followUpTo` (a
 * human follow-up reply, or any resumed cli/web dispatch) is stitched into the
 * session of the loop at the ROOT of its `followUpTo` chain — so a follow-up
 * discussion rejoins its original thread instead of surfacing as its own
 * standalone session (below). This is keyed on `followUpTo`, not `sessionId`,
 * so it composes independently of passes 1-2 and needs no producer change (see
 * the stitch pass below for the full rationale).
 *
 * Named heuristic limits (documented, not hidden — see LIN-591): unscoped
 * (general) autopilot runs have no seed, so inference cannot recover their
 * workers — only explicit `sessionId` does; non-hierarchical spin-offs (a new
 * sibling/related issue, not a breakdown child) fall outside the descendant
 * walk; concurrent runs over overlapping subtrees can cross-attribute un-stamped
 * workers.
 *
 * @param {Array<Object>} loops
 * @param {Object} [opts]
 * @param {Object|null} [opts.issueGraph] - injected hierarchy; see `_hierarchyHelpers`
 * @param {Date}   [opts.now]
 * @returns {Array<Object>} sessions, most-recent dispatch first
 */
function _buildSessions(loops = [], { issueGraph = null, now = new Date() } = {}) {
  const { descendantsOf, ancestorsOf } = _hierarchyHelpers(issueGraph);

  const autopilotLoops = loops.filter(l => l.kind === 'autopilot');

  // Workers grouped by the explicit sessionId they carry.
  const workersBySessionId = new Map();
  for (const l of loops) {
    if (!l.sessionId) continue;
    if (!workersBySessionId.has(l.sessionId)) workersBySessionId.set(l.sessionId, []);
    workersBySessionId.get(l.sessionId).push(l);
  }

  const claimed = new Set(); // loopIds already attached to a session
  // loopId -> the sessionId of the record that owns it. Lets the LIN-1292
  // stitch pass find a root loop's session even when the root is a MEMBER of
  // that session (e.g. an autopilot worker), not the session's own key.
  const sessionIdByLoopId = new Map();
  // sessionId -> { anchorLoop: Object|null, loopsById: Map<loopId, loop> }.
  // Assembly (`_assembleSession`) is deferred to the very end so the LIN-1292
  // stitch pass can append loops to a pass-1/2 session's set before its
  // derived fields (tasksTouched/completedAt/telemetry) are computed once.
  const records = new Map();

  for (const ap of autopilotLoops) {
    const sessionId = ap.loopId;
    const sessionLoops = new Map([[ap.loopId, ap]]); // orchestrator is the anchor

    // 1. Explicit sessionId workers.
    for (const w of workersBySessionId.get(sessionId) || []) {
      sessionLoops.set(w.loopId, w);
    }

    // 2. Inference fallback — only meaningful when the seed issue is known.
    const seed = ap.issueIdentifier;
    if (seed) {
      const { start, end } = _sessionWindow(ap, now);
      if (start) {
        const candidates = new Set([seed, ...descendantsOf(seed), ...ancestorsOf(seed)]);
        for (const l of loops) {
          if (sessionLoops.has(l.loopId)) continue;
          if (l.kind === 'autopilot') continue;          // never absorb another orchestrator
          if (l.sessionId && l.sessionId !== sessionId) continue; // owned by another session
          if (!candidates.has(l.issueIdentifier)) continue;
          const t = _toDate(l.dispatchedAt);
          if (!t) continue;
          if (t.getTime() < start.getTime() || t.getTime() > end.getTime()) continue;
          sessionLoops.set(l.loopId, l);
        }
      }
    }

    for (const id of sessionLoops.keys()) { claimed.add(id); sessionIdByLoopId.set(id, sessionId); }
    records.set(sessionId, { anchorLoop: ap, loopsById: sessionLoops });
  }

  // Orphan explicit-sessionId groups: workers whose orchestrator isn't present.
  for (const [sessionId, workers] of workersBySessionId) {
    if (autopilotLoops.some(ap => ap.loopId === sessionId)) continue;
    const unclaimed = workers.filter(w => !claimed.has(w.loopId));
    if (unclaimed.length === 0) continue;
    for (const w of unclaimed) { claimed.add(w.loopId); sessionIdByLoopId.set(w.loopId, sessionId); }
    records.set(sessionId, { anchorLoop: null, loopsById: new Map(unclaimed.map(w => [w.loopId, w])) });
  }

  // 2.5 Follow-up thread stitch (LIN-1292). A follow-up reply (the reply box,
  //     or any resumed cli/web dispatch) carries `followUpTo` pointing at the
  //     dispatch it resumes, but posts with NO `sessionId` — so without this
  //     pass it would fall to pass 3 below as its own standalone session,
  //     reading as a vanished discussion. Resolve each unclaimed follow-up loop
  //     to the ROOT of its `followUpTo` chain (walking through intermediate
  //     follow-ups too, so a chained A<-B<-C thread all lands on A) and attach
  //     it to the root's session — an existing pass-1/2 session when the root
  //     is already claimed, or a freshly-anchored session at the root otherwise
  //     (pre-empting pass 3 for both the root and its followers). A chain whose
  //     root has aged out of the lookback window (not present in `loopById`)
  //     falls through to pass 3 unchanged — today's degraded-but-safe behaviour.
  const loopById = new Map(loops.map(l => [l.loopId, l]));
  const resolveChainRoot = (loop) => {
    const seen = new Set();
    let current = loop;
    while (current.followUpTo) {
      if (seen.has(current.loopId)) return null; // cycle guard — malformed chain, never trust it
      seen.add(current.loopId);
      const parent = loopById.get(current.followUpTo);
      if (!parent) return null; // predecessor aged out of the window — can't stitch
      current = parent;
    }
    return current;
  };

  // 2.5a Durable-group follow-up stitch (LIN-1341). A loop stamped with
  //      `sessionGroupId` groups by direct id equality — O(1), no chain walk —
  //      instead of pass 2.5b's `resolveChainRoot` below. This composes with (does
  //      not override) passes 1-2: an autopilot worker's own group id is minted as
  //      its `sessionId` (dispatch-store.js addItem), so a reply inheriting that
  //      worker's group id already equals the orchestrator session's own key, and
  //      lands there via the `records.get(groupId)` branch below with no special
  //      casing. Three cases per group id:
  //        (a) it's already a session's key (records.has) → attach there;
  //        (b) it's an in-window, not-yet-owned root loop (loopById.get) → seed a
  //            fresh session there, mirroring pass 2.5b's root-creation rule
  //            (cli/web only, never an orchestrator);
  //        (c) neither — the root aged out of the lookback window, or its own
  //            claim is owned by something incompatible — the group's followers
  //            still coalesce into ONE anchorless continuation (seedIssue null)
  //            rather than each falling back to pass 3 as its own standalone
  //            session. This is the approved "root aged out" behavior (flagged
  //            for review): the durable id outlives the window even when the
  //            root loop itself no longer does.
  //
  //      Deploy-boundary straddle merge (LIN-1393, fixing a gap the LIN-1341
  //      review found and close-out never actually discharged): a group id is
  //      only the *immediate* parent's id, so a chain that was already
  //      multi-hop and unstamped when this shipped resolves its first
  //      post-deploy reply's group id to that unstamped intermediate hop, not
  //      the chain's true root — e.g. `A(unstamped) <- B(unstamped) <-
  //      C(stamped, grp=B)`. Left alone, this pass would seed a fresh session
  //      at B (case (b) above) and sever A into its own session, reintroducing
  //      the exact "follow-up shown as a separate task" symptom LIN-1341 fixed.
  //      So before treating the group id as a root, check whether the group-key
  //      loop itself has a `followUpTo` — if so it is not a true root; walk it
  //      to its real chain root (`resolveChainRoot`, same helper pass 2.5b
  //      uses) and merge the group id's session into the root's, rather than
  //      seeding a separate one. Self-limiting: once every hop in a chain is
  //      stamped, a group id already equals the true root (LIN-1341 factory
  //      inheritance copies the parent's own group id), so this only fires for
  //      un-stamped rows and shrinks toward unreachable within the 30-day window.
  const stampedFollowersByGroupId = new Map();
  const unstampedFollowUpLoops = [];
  for (const l of loops) {
    if (claimed.has(l.loopId)) continue;
    if (l.kind === 'autopilot') continue;
    if (l.sessionId) continue;
    if (l.target !== 'cli' && l.target !== 'web') continue;
    if (!l.followUpTo) continue;
    if (l.sessionGroupId) {
      if (!stampedFollowersByGroupId.has(l.sessionGroupId)) stampedFollowersByGroupId.set(l.sessionGroupId, []);
      stampedFollowersByGroupId.get(l.sessionGroupId).push(l);
    } else {
      unstampedFollowUpLoops.push(l);
    }
  }

  for (const [groupId, followers] of stampedFollowersByGroupId) {
    let record = records.get(groupId);
    let ownerSessionId = groupId;
    if (!record) {
      const anchor = loopById.get(groupId);
      if (anchor && anchor.followUpTo) {
        // LIN-1393: the group-key loop is itself a follow-up, not a true root
        // (an unstamped intermediate hop from before this field existed).
        // Resolve to the real chain root and merge there instead of seeding a
        // separate session at `anchor`.
        const root = resolveChainRoot(anchor);
        if (root && root.loopId !== anchor.loopId) {
          const rootOwnerSessionId = sessionIdByLoopId.get(root.loopId);
          if (rootOwnerSessionId) {
            record = records.get(rootOwnerSessionId);
            ownerSessionId = rootOwnerSessionId;
          } else if (!claimed.has(root.loopId) && root.kind !== 'autopilot' &&
              (root.target === 'cli' || root.target === 'web')) {
            ownerSessionId = root.loopId;
            claimed.add(root.loopId);
            sessionIdByLoopId.set(root.loopId, ownerSessionId);
            record = { anchorLoop: null, loopsById: new Map([[root.loopId, root]]) };
            records.set(ownerSessionId, record);
          }
          if (record && !claimed.has(anchor.loopId)) {
            claimed.add(anchor.loopId);
            sessionIdByLoopId.set(anchor.loopId, ownerSessionId);
            record.loopsById.set(anchor.loopId, anchor);
          }
        }
      }
      if (!record && anchor && !claimed.has(groupId) && anchor.kind !== 'autopilot' &&
          (anchor.target === 'cli' || anchor.target === 'web')) {
        ownerSessionId = groupId;
        claimed.add(groupId);
        sessionIdByLoopId.set(groupId, ownerSessionId);
        record = { anchorLoop: null, loopsById: new Map([[groupId, anchor]]) };
        records.set(ownerSessionId, record);
      } else if (!record && !anchor) {
        // Root aged out of the window (or was never a loop at all — an
        // intermediate legacy hop that self-healed onto this group id). The
        // group is still durable, so its in-window followers coalesce.
        ownerSessionId = groupId;
        record = { anchorLoop: null, loopsById: new Map() };
        records.set(ownerSessionId, record);
      }
      // else: the root loop exists but is owned by an incompatible session
      // (claimed elsewhere, or excluded by kind/target) — leave these followers
      // unclaimed; like today, they fall through to pass 3 individually.
    }
    if (!record) continue;
    for (const f of followers) {
      if (claimed.has(f.loopId)) continue;
      claimed.add(f.loopId);
      sessionIdByLoopId.set(f.loopId, ownerSessionId);
      record.loopsById.set(f.loopId, f);
    }
  }

  // 2.5b Legacy chain-walk stitch — the transitional fallback for loops with no
  //      `sessionGroupId` (pre-LIN-1341 rows). Un-stamped rows self-evict within
  //      the 30-day window, so this pass shrinks toward unreachable rather than
  //      needing a migration. Unchanged from before LIN-1341.
  const followersByRootId = new Map();
  for (const l of unstampedFollowUpLoops) {
    const root = resolveChainRoot(l);
    if (!root || root.loopId === l.loopId) continue;
    if (!followersByRootId.has(root.loopId)) followersByRootId.set(root.loopId, []);
    followersByRootId.get(root.loopId).push(l);
  }

  for (const [rootLoopId, followers] of followersByRootId) {
    // The root may be a MEMBER of an existing session (e.g. an autopilot
    // worker), not that session's own key — resolve via the loop→session
    // index rather than assuming `rootLoopId` is itself a session id.
    let ownerSessionId = sessionIdByLoopId.get(rootLoopId);
    let record = ownerSessionId ? records.get(ownerSessionId) : null;
    if (!record) {
      if (claimed.has(rootLoopId)) continue; // root claimed but untracked — leave followers to pass 3
      const root = loopById.get(rootLoopId);
      if (!root) continue;
      if (root.kind === 'autopilot') continue; // orchestrators are never a stitch root
      if (root.target !== 'cli' && root.target !== 'web') continue; // cli/web only (V1)
      ownerSessionId = rootLoopId;
      claimed.add(rootLoopId);
      sessionIdByLoopId.set(rootLoopId, ownerSessionId);
      record = { anchorLoop: null, loopsById: new Map([[rootLoopId, root]]) };
      records.set(ownerSessionId, record);
    }
    for (const f of followers) {
      if (claimed.has(f.loopId)) continue;
      claimed.add(f.loopId);
      sessionIdByLoopId.set(f.loopId, ownerSessionId);
      record.loopsById.set(f.loopId, f);
    }
  }

  // 3. Standalone single-loop sessions (LIN-1194). A user-dispatched, non-autopilot
  //    cli/web prompt already produces a Loop (`_buildLoops` emits one per dispatch
  //    regardless of `kind`), but with no `sessionId` and `kind !== 'autopilot'` it
  //    is claimed by NEITHER an autopilot orchestrator (pass 1) nor an explicit-
  //    sessionId worker group (pass 2) nor a follow-up stitch (pass 2.5) — so today
  //    it never becomes a session and never reaches the Observation surface. Emit
  //    each such still-unclaimed loop as its OWN single-loop session keyed by its
  //    own dispatch id (`loop.loopId`), mirroring how an autopilot anchor already
  //    uses its `loopId` as the sessionId — exactly the id the per-session page +
  //    reply box resolve by (LIN-1003/1004), so the drill-down/reply path serves a
  //    standalone session with no new plumbing. This is additive: passes 1-2.5
  //    already claimed every loop they group, so no existing session's loop set
  //    changes and no loop is double-emitted. `dash`/`local` targets are excluded
  //    (V1) — they have no live session identity, matching the `followUpTo`/
  //    Collective cli/web-only constraint. The Autopilot vs Sessions split is a
  //    DERIVED read-time filter (routes/dashboard.js), NOT this builder, so
  //    standalone sessions never leak into the existing autopilot feed.
  for (const l of loops) {
    if (claimed.has(l.loopId)) continue;
    if (l.kind === 'autopilot') continue;              // orchestrators handled in pass 1
    if (l.sessionId) continue;                          // explicit-session workers are pass 2
    if (l.target !== 'cli' && l.target !== 'web') continue; // cli/web only (V1)
    claimed.add(l.loopId);
    records.set(l.loopId, { anchorLoop: null, loopsById: new Map([[l.loopId, l]]) });
  }

  const sessions = [];
  for (const [sessionId, record] of records) {
    sessions.push(_assembleSession(sessionId, record.anchorLoop, [...record.loopsById.values()]));
  }

  // Most-recent session first (dashboard-friendly); tie-break on sessionId.
  sessions.sort((a, b) => {
    const ta = _toDate(a.dispatchedAt)?.getTime() ?? 0;
    const tb = _toDate(b.dispatchedAt)?.getTime() ?? 0;
    if (ta !== tb) return tb - ta;
    return String(a.sessionId).localeCompare(String(b.sessionId));
  });

  return sessions;
}

// ─── I/O boundary ────────────────────────────────────────────────────────────

/**
 * Fetch all data needed to build Loops for a workspace.
 *
 * Issues three parallel reads against the stores:
 *   - dispatch live queue          (`listItems`)
 *   - dispatch history archive     (windowed to the 30-day lookback)
 *   - agent-status entries         (windowed to the 30-day lookback)
 *
 * When `issueIdentifier` is supplied the filter is pushed DOWN into each store
 * read (LIN-613) so a single-issue request reads only that issue's rows via the
 * supporting index, instead of pulling the whole workspace's 30-day log and
 * narrowing it in JS. Crucially this is NOT a `limit`/cap — the prior blanket
 * cap was deliberately removed (regression-guarded) because it truncated loop
 * reconstruction; this is a selective predicate, so per-issue correctness holds.
 *
 * The history + agent-status reads are ALSO windowed by a `since` predicate
 * (`now − LOOKBACK_MS`), pushed into the query so rows older than the lookback
 * (and any cleanup-lag backlog) are never materialised. This is the same cutoff
 * `_buildLoops` already applies in JS — moving it server-side bounds peak memory
 * without changing which loops are reconstructed (LIN-622). The live queue is
 * left unwindowed: it holds only pending/active dispatches and is already small.
 *
 * Stores already swallow internal errors and return empty arrays, so this
 * function only needs to handle the structural unwrap. Total failure
 * (e.g., DB unreachable for all three) is allowed to propagate.
 *
 * @param {string} urlKey
 * @param {Object} deps
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {Object} [opts]
 * @param {string} [opts.issueIdentifier] - Scope every read to one Linear issue.
 * @param {boolean} [opts.lean=false] - Feed path: project the heavy, feed-unused
 *   `prompt` field out of the history read so the cold whole-workspace scan stops
 *   transferring/deserialising it (LIN-623). Safe because `_buildLoops` only reads
 *   `item.prompt` on the non-lean branch (it becomes `promptText`); the lean feed
 *   drops it anyway. `feedback` is NOT projected away — telemetry/terminal facts
 *   are still derived from it at build time.
 * @returns {Promise<{live: Array, history: Array, agentStatus: Array, timing: Object}>}
 */
async function _fetchWorkspaceData(urlKey, { dispatchStore, agentStatusStore }, { issueIdentifier, lean = false } = {}) {
  const since = new Date(Date.now() - LOOKBACK_MS);
  // Live queue: left unscoped except for the per-issue filter (it is small and
  // current). History + agent-status: windowed by `since` so the store never
  // materialises rows the 30-day cutoff would discard anyway.
  const itemOpts = issueIdentifier ? { issueIdentifier } : undefined;
  const historyOpts = issueIdentifier ? { issueIdentifier, since } : { since };
  const statusOpts = issueIdentifier ? { taskIdentifier: issueIdentifier, since } : { since };
  // Lean feed read: exclude `prompt` at the query so a real DB never transfers it
  // (LIN-623). Column exclusion only — same rows, so the LIN-615 truncation-
  // footgun guard (no row cap) is untouched, and non-lean callers (no `lean`) get
  // byte-identical full documents.
  if (lean) historyOpts.projection = { prompt: 0 };

  // Time each read WITHOUT serialising them — the reads stay parallel (a real
  // measurement must not become the latency it measures). Per-read ms + row
  // counts ride back on `timing` for the cold-path instrumentation (LIN-623);
  // it's an additive field existing callers ignore.
  const timed = (p) => {
    const start = Date.now();
    return p.then(value => ({ value, ms: Date.now() - start }));
  };
  const [live, history, status] = await Promise.all([
    timed(Promise.resolve(dispatchStore.listItems(urlKey, itemOpts))),
    timed(Promise.resolve(dispatchStore.listHistory(urlKey, historyOpts))),
    timed(Promise.resolve(agentStatusStore.listStatus(urlKey, statusOpts)))
  ]);

  const liveArr = Array.isArray(live.value) ? live.value : [];
  const historyArr = Array.isArray(history.value?.items) ? history.value.items : [];
  const agentStatusArr = Array.isArray(status.value?.items) ? status.value.items : [];

  return {
    live: liveArr,
    history: historyArr,
    agentStatus: agentStatusArr,
    timing: {
      liveMs: live.ms,
      historyMs: history.ms,
      statusMs: status.ms,
      liveRows: liveArr.length,
      historyRows: historyArr.length,
      statusRows: agentStatusArr.length,
      leanRead: lean
    }
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Reconstruct all Loops for a single Linear issue in a workspace.
 *
 * Returns a chronologically ordered (`dispatchedAt` ascending) array of Loop
 * records covering up to the last 30 days. Iteration numbers are 1-indexed
 * and counted across both live and historic dispatches.
 *
 * @param {string} urlKey
 * @param {string} issueIdentifier   e.g. "LIN-42"
 * @param {Object} [deps]            test-injection hook
 * @param {Object} [deps.dispatchStore]
 * @param {Object} [deps.agentStatusStore]
 * @returns {Promise<Array<Object>>}
 */
export async function getLoopsForIssue(urlKey, issueIdentifier, deps = {}) {
  if (!urlKey || !issueIdentifier) return [];
  const { dispatchStore, agentStatusStore } = deps;
  if (!dispatchStore || !agentStatusStore) {
    throw new Error('pipeline-loops: dispatchStore and agentStatusStore must be injected');
  }
  // The reads are scoped to this issue at the store/query layer (LIN-613), so
  // each array already contains only this issue's rows — no JS re-filter (and no
  // whole-workspace download) needed.
  const { live, history, agentStatus } = await _fetchWorkspaceData(
    urlKey,
    { dispatchStore, agentStatusStore },
    { issueIdentifier }
  );
  return _buildLoops({
    liveItems: live,
    historyItems: history,
    agentStatusEntries: agentStatus
  });
}

/**
 * Reconstruct all Loops across every issue in a workspace, suitable for the
 * Pipeline snapshot/state-builder. Flat list, with iteration numbers per
 * issue (not global).
 *
 * @param {string} urlKey
 * @param {Object} [deps]            test-injection hook
 * @param {Object} [deps.dispatchStore]
 * @param {Object} [deps.agentStatusStore]
 * @param {boolean} [deps.lean=false] - omit heavy feed-unused fields (promptText); LIN-622
 * @returns {Promise<Array<Object>>}
 */
export async function getLoopsForWorkspace(urlKey, deps = {}) {
  if (!urlKey) return [];
  const { dispatchStore, agentStatusStore, lean = false } = deps;
  if (!dispatchStore || !agentStatusStore) {
    throw new Error('pipeline-loops: dispatchStore and agentStatusStore must be injected');
  }
  // `lean` both omits the heavy `promptText` per output loop (LIN-622) AND projects
  // `prompt` out of the history read so it is never fetched (LIN-623).
  const { live, history, agentStatus } = await _fetchWorkspaceData(urlKey, { dispatchStore, agentStatusStore }, { lean });
  // `lean` omits the heavy, feed-unused `promptText` per loop (LIN-622). The
  // run-summary/pipeline paths leave it at the default (full) — they read it.
  return _buildLoops({ liveItems: live, historyItems: history, agentStatusEntries: agentStatus, lean });
}

/**
 * Derive the `issueGraph` that `getSessionsForWorkspace`'s inference fallback
 * needs, from the canonical issue set the caller already hydrated (LIN-593).
 *
 * Sessions key hierarchy by human identifier (loops carry `issueIdentifier`), so
 * the map is identifier → parentIdentifier. Issues whose parent is outside the
 * set map to null (root within the set). Without this, the fallback degrades to
 * attaching only each seed's own loops.
 *
 * @param {Array<Object>} issues - Canonical issues (`{ id, identifier, parent:{id} }`).
 * @returns {{parentOf: Object<string,string|null>}}
 */
export function deriveIssueGraph(issues) {
  const byId = new Map();
  for (const issue of issues || []) {
    if (issue && issue.id) byId.set(issue.id, issue);
  }
  const parentOf = {};
  for (const issue of byId.values()) {
    const id = issue.identifier || issue.id;
    const parent = issue.parent?.id ? byId.get(issue.parent.id) : null;
    parentOf[id] = parent ? (parent.identifier || parent.id) : null;
  }
  return { parentOf };
}

/**
 * Reconstruct autopilot **sessions** for a workspace (LIN-591).
 *
 * Builds the workspace's Loops, then groups them into sessions: one autopilot
 * orchestrator dispatch plus every worker dispatch it spawned — across all the
 * tasks an epic descent or `breakdown` spin-off touches. `sessionId`-first, with
 * a network-free inference fallback for historical data (see `_buildSessions`).
 *
 * The fallback's hierarchy walk needs the issue graph, which this network-free
 * module does not hold — the caller injects it (`deps.issueGraph`, shape
 * `{ parentOf: { [identifier]: parentIdentifier } }`, derivable from the
 * canonical issue set the dashboard already hydrates). Omit it and the fallback
 * attaches only each seed issue's own loops; explicit `sessionId` grouping is
 * unaffected.
 *
 * @param {string} urlKey
 * @param {Object} [deps]
 * @param {Object} [deps.dispatchStore]
 * @param {Object} [deps.agentStatusStore]
 * @param {Object|null} [deps.issueGraph] - injected hierarchy for inference fallback
 * @param {boolean} [deps.lean=false] - omit heavy feed-unused fields (promptText); LIN-622
 * @returns {Promise<Array<Object>>} session records, most-recent first
 */
export async function getSessionsForWorkspace(urlKey, deps = {}) {
  if (!urlKey) return [];
  const { dispatchStore, agentStatusStore, issueGraph = null, lean = false } = deps;
  if (!dispatchStore || !agentStatusStore) {
    throw new Error('pipeline-loops: dispatchStore and agentStatusStore must be injected');
  }
  // `lean` projects `prompt` out of the cold history read (LIN-623) in addition to
  // omitting `promptText` from output loops (LIN-622); mergeSessions opts in.
  // Single-session on-demand paths (session-summary/session-context) keep the
  // default (full document, prompt retained).
  const { live, history, agentStatus, timing } = await _fetchWorkspaceData(
    urlKey, { dispatchStore, agentStatusStore }, { lean }
  );
  const buildStart = Date.now();
  const loops = _buildLoops({ liveItems: live, historyItems: history, agentStatusEntries: agentStatus, lean });
  const sessions = _buildSessions(loops, { issueGraph });
  // Cold-path instrumentation (LIN-623): the I/O-vs-CPU split on a real cold
  // `linearviewer` load. Off by default (env-gated) so normal polls stay quiet;
  // when on it prints per-read ms, row counts, and build ms for one workspace.
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
 * Reconstruct autopilot sessions for a SUBSET of a workspace's issues (LIN-623).
 *
 * The materialized Observation read-model recomputes only the sessions a write
 * touches, not the whole 30-day log. The correctness boundary is the issue SET,
 * NOT the session: `_buildLoops` derives each agent-status match window from *the
 * next dispatch of the same issue* (`_matchAgentStatusToLoop`), so a session's
 * loops are reconstructed faithfully only when EVERY dispatch of EVERY issue that
 * session touches is present. Recomputing one session in isolation would widen
 * those windows and could mis-attribute an agent-status row when an issue spans
 * multiple sessions (or has a manual dispatch).
 *
 * So this entrypoint reads each issue's FULL row set (issue-scoped, index-backed —
 * the same per-issue `_fetchWorkspaceData` path `getLoopsForIssue` uses), unions
 * them, and runs the SAME pure `_buildLoops`/`_buildSessions` the live feed runs.
 * Because it reuses the builders verbatim, the projection cannot drift from the
 * live reconstruction — it *is* the live reconstruction, restricted to the issues.
 * No `issueGraph` is injected (matching `mergeSessions`, which omits it): explicit
 * `sessionId` grouping carries the feed and the inference fallback degrades to each
 * seed's own loops.
 *
 * @param {string} urlKey
 * @param {Object} deps  - { dispatchStore, agentStatusStore }
 * @param {Array<string>} issueIdentifiers - the issue set to reconstruct over
 * @param {Object} [opts]
 * @param {boolean} [opts.lean=false]
 * @returns {Promise<Array<Object>>} session records over the given issues
 */
export async function getSessionsForIssues(urlKey, deps = {}, issueIdentifiers = [], { lean = false } = {}) {
  if (!urlKey) return [];
  const { dispatchStore, agentStatusStore } = deps;
  if (!dispatchStore || !agentStatusStore) {
    throw new Error('pipeline-loops: dispatchStore and agentStatusStore must be injected');
  }
  const ids = [...new Set((issueIdentifiers || []).filter(Boolean))];
  if (ids.length === 0) return [];

  // Read each issue's full row set in parallel (issue-scoped, indexed). Union the
  // rows — deduping by id defensively — then build ONCE over the union, so the
  // per-issue iteration numbers and agent-status windows are computed exactly as a
  // whole-workspace build would (each issue contributes ALL of its rows).
  const perIssue = await Promise.all(
    ids.map(issueIdentifier =>
      _fetchWorkspaceData(urlKey, { dispatchStore, agentStatusStore }, { issueIdentifier, lean })
    )
  );

  const liveById = new Map();
  const historyById = new Map();
  const statusById = new Map();
  for (const r of perIssue) {
    for (const x of r.live) if (x && x.id != null) liveById.set(x.id, x);
    for (const x of r.history) if (x && x.id != null) historyById.set(x.id, x);
    for (const x of r.agentStatus) if (x && x.id != null) statusById.set(x.id, x);
  }

  const loops = _buildLoops({
    liveItems: [...liveById.values()],
    historyItems: [...historyById.values()],
    agentStatusEntries: [...statusById.values()],
    lean
  });
  return _buildSessions(loops, { issueGraph: null });
}

// Internal exports for unit tests. Not part of the public contract — callers
// outside this module's tests should not import these.
export const __internal = {
  _toDate,
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
  correlateDecisionCase,
  LOOKBACK_MS
};
