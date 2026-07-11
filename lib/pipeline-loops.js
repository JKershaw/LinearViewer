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

import { deriveCompletedAt, findTerminalFeedback, findWakeEvent } from './dispatch-terminal.js';
import { buildRunTelemetry, buildSessionTelemetry } from './session-telemetry.js';

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
  // target loop directly — no mapping layer.
  const abortedTargets = new Map();
  for (const item of [...liveItems, ...historyItems]) {
    if (!item || item.abort !== true || !item.abortTo) continue;
    const terminal = findTerminalFeedback(Array.isArray(item.feedback) ? item.feedback : []);
    if (terminal && terminal.status === 'aborted') {
      abortedTargets.set(item.abortTo, terminal.entry);
    }
  }

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

      const historyStatus = loop._source === 'history' ? (item.status || null) : null;
      const agentState = _deriveAgentState(loop._source, historyStatus, agentStatus);
      const stage = _deriveStage(agentAction, item.promptName);

      const rawFeedback = Array.isArray(item.feedback) ? item.feedback : [];
      // LIN-1257: if an abort targeted THIS loop (its `abortTo` matches our
      // `loopId`), append the harvested `[aborted]` entry to a LOCAL copy of the
      // feedback so the existing derivation below marks the loop terminal. This is
      // non-mutating (the stored dispatch record is untouched); the synthetic entry
      // is last, so `findTerminalFeedback` (scan-from-end, last-wins) picks it up.
      const feedback = abortedTargets.has(loop.loopId)
        ? [...rawFeedback, abortedTargets.get(loop.loopId)]
        : rawFeedback;
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
        source: loop._source,
        historyStatus,
        agentAction,
        agentStatus,
        agentSummary,
        agentTimestamp,
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
        })
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
  const sessions = [];

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

    for (const id of sessionLoops.keys()) claimed.add(id);
    sessions.push(_assembleSession(sessionId, ap, [...sessionLoops.values()]));
  }

  // Orphan explicit-sessionId groups: workers whose orchestrator isn't present.
  for (const [sessionId, workers] of workersBySessionId) {
    if (autopilotLoops.some(ap => ap.loopId === sessionId)) continue;
    const unclaimed = workers.filter(w => !claimed.has(w.loopId));
    if (unclaimed.length === 0) continue;
    for (const w of unclaimed) claimed.add(w.loopId);
    sessions.push(_assembleSession(sessionId, null, unclaimed));
  }

  // 3. Standalone single-loop sessions (LIN-1194). A user-dispatched, non-autopilot
  //    cli/web prompt already produces a Loop (`_buildLoops` emits one per dispatch
  //    regardless of `kind`), but with no `sessionId` and `kind !== 'autopilot'` it
  //    is claimed by NEITHER an autopilot orchestrator (pass 1) nor an explicit-
  //    sessionId worker group (pass 2) — so today it never becomes a session and
  //    never reaches the Observation surface. Emit each such still-unclaimed loop as
  //    its OWN single-loop session keyed by its own dispatch id (`loop.loopId`),
  //    mirroring how an autopilot anchor already uses its `loopId` as the sessionId
  //    — exactly the id the per-session page + reply box resolve by (LIN-1003/1004),
  //    so the drill-down/reply path serves a standalone session with no new plumbing.
  //    This is additive: passes 1–2 already claimed every loop they group, so no
  //    existing session's loop set changes and no loop is double-emitted. `dash`/
  //    `local` targets are excluded (V1) — they have no live session identity, matching
  //    the `followUpTo`/Collective cli/web-only constraint. The Autopilot vs Sessions
  //    split is a DERIVED read-time filter (routes/dashboard.js), NOT this builder, so
  //    standalone sessions never leak into the existing autopilot feed.
  for (const l of loops) {
    if (claimed.has(l.loopId)) continue;
    if (l.kind === 'autopilot') continue;              // orchestrators handled in pass 1
    if (l.sessionId) continue;                          // explicit-session workers are pass 2
    if (l.target !== 'cli' && l.target !== 'web') continue; // cli/web only (V1)
    claimed.add(l.loopId);
    sessions.push(_assembleSession(l.loopId, null, [l]));
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
  LOOKBACK_MS
};
