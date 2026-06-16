/**
 * lib/pipeline-loops.js
 *
 * Pure-function library that joins dispatch history + foreman entries into
 * "Loop" records — the derived primary entity used by the Pipeline view.
 *
 * A Loop is one dispatch attempt (queued or archived) decorated with whichever
 * foreman status entry falls inside its timestamp window. The dispatch history
 * `_id` is the Loop's identity. Foreman entries are matched by:
 *
 *   1. Exact `dispatchId` back-reference, if the foreman writer included one.
 *   2. Otherwise: `taskIdentifier` equality + timestamp window
 *      (`dispatchedAt ≤ f.timestamp ≤ resolvedAt ?? nextDispatchAt ?? now`).
 *
 * The library does not introduce any persisted schema. It reads from
 * `dispatch-store` (live queue + history archive) and `foreman-store`, then
 * derives `agentState`, `stage`, and per-issue 1-indexed `iteration` numbers.
 *
 * See LIN-245 for the design plan and rationale.
 */

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

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

// ─── Derivations ─────────────────────────────────────────────────────────────

/**
 * Derive an `agentState` value from a dispatch record's source collection,
 * its `status` (history only), and the matched foreman entry's `status`.
 *
 * Truth table (see LIN-245 plan, section 3):
 *
 *   live queue                                            → 'queued'
 *   history + status:'expired'                            → 'error'
 *   history + status:'cancelled'                          → 'complete'
 *   history + status:'taken' + no foreman match           → 'running'
 *   history + status:'taken' + foreman 'completed'        → 'complete'
 *   history + status:'taken' + foreman 'failed'           → 'error'
 *   history + status:'taken' + foreman 'blocked'          → 'waiting'
 *   history + status:'taken' + foreman <other free-form>  → 'running'
 *
 * Foreman `status` is a free-form string (not enum-enforced) — unknown
 * values fall through to `running` rather than crash. `cancelled` is treated
 * as terminal-good because the operator explicitly removed the item.
 *
 * @param {'live'|'history'} source
 * @param {string|null} historyStatus     - dispatch row `status` (history only)
 * @param {string|null} foremanStatus     - matched foreman entry `status`, or null
 * @returns {'queued'|'running'|'waiting'|'complete'|'error'}
 */
function _deriveAgentState(source, historyStatus, foremanStatus) {
  if (source === 'live') return 'queued';

  if (historyStatus === 'expired') return 'error';
  if (historyStatus === 'cancelled') return 'complete';

  // historyStatus === 'taken' (or anything else from history) — decorate by foreman
  if (foremanStatus === 'completed') return 'complete';
  if (foremanStatus === 'failed') return 'error';
  if (foremanStatus === 'blocked') return 'waiting';

  // No foreman match, or unrecognised foreman status string → still running.
  return 'running';
}

/**
 * Derive a `stage` label for a Loop. Falls back through the chain:
 *
 *   foremanAction → promptName → 'unknown'
 *
 * Both vocabularies share the same keys (`plan`, `breakdown`, `implementation`,
 * `review`, etc. — see `lib/prompt-template-defs.js`) so no mapping is needed.
 * `promptName` is always set by `dispatch-store.addItem()`, so the `'unknown'`
 * branch is purely defensive against malformed records.
 *
 * @param {string|null} foremanAction
 * @param {string|null} promptName
 * @returns {string}
 */
function _deriveStage(foremanAction, promptName) {
  return foremanAction || promptName || 'unknown';
}

// ─── Join logic ──────────────────────────────────────────────────────────────

/**
 * Find the foreman entry that decorates a given Loop.
 *
 * Strategy:
 *  1. Exact match — if any foreman entry has `dispatchId === loop.loopId`,
 *     pick the one with the latest `timestamp`. This branch is dormant for
 *     v1 callers (the playbook does not yet write `dispatchId`) but light
 *     up automatically when consumers start forwarding it.
 *  2. Window match — among entries whose `timestamp` falls in
 *     `[dispatchedAt, upper]`, pick the latest by `timestamp`.
 *
 * `upper` is the loop's `resolvedAt` if archived, otherwise the next loop's
 * `dispatchedAt` for the same issue (so foreman entries don't leak forward
 * across iterations), otherwise `now`.
 *
 * @param {Object} loop                       - Loop being decorated
 * @param {Array}  foremanForIssue            - foreman entries pre-filtered to this issue
 * @param {Date}   nowDate                    - current time (injectable for tests)
 * @returns {Object|null}                     - matched foreman entry doc or null
 */
function _matchForemanToLoop(loop, foremanForIssue, nowDate) {
  if (!foremanForIssue || foremanForIssue.length === 0) return null;

  // 1. Exact-match by dispatchId — overrides window matching when present.
  const exact = foremanForIssue.filter(f => f.dispatchId && f.dispatchId === loop.loopId);
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
  for (const f of foremanForIssue) {
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
 * Pure builder: takes pre-fetched live items, history items, and foreman
 * entries (already scoped to a workspace, optionally pre-filtered to a single
 * issue) and returns a flat array of Loop objects sorted by `dispatchedAt`
 * ascending within each issue.
 *
 * The function never touches stores. All inputs must already be in the
 * formatted shape produced by `dispatch-store._formatItem` /
 * `_formatHistoryItem` / `foreman-store.listStatus`. Dates may be ISO
 * strings or `Date` instances; `_toDate` normalises both.
 *
 * @param {Object} input
 * @param {Array}  input.liveItems            - dispatch live queue items
 * @param {Array}  input.historyItems         - dispatch history items
 * @param {Array}  input.foremanEntries       - foreman status entries
 * @param {Date}   [input.now]                - injectable "now" for testing
 * @returns {Array<Object>}                   - flat Loop[] across all issues
 */
function _buildLoops({ liveItems = [], historyItems = [], foremanEntries = [], now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - LOOKBACK_MS);

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

  // Pre-group foreman entries by taskIdentifier for cheap per-loop matching.
  const foremanByIssue = new Map();
  for (const f of foremanEntries) {
    if (!f || !f.taskIdentifier) continue;
    if (!foremanByIssue.has(f.taskIdentifier)) foremanByIssue.set(f.taskIdentifier, []);
    foremanByIssue.get(f.taskIdentifier).push(f);
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

    const foremanForIssue = foremanByIssue.get(issueIdentifier) || [];

    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i];
      const item = loop._raw;
      const foremanMatch = _matchForemanToLoop(loop, foremanForIssue, now);

      const foremanAction = foremanMatch ? foremanMatch.action || null : null;
      const foremanStatus = foremanMatch ? foremanMatch.status || null : null;
      const foremanSummary = foremanMatch ? foremanMatch.summary || null : null;
      const foremanTimestamp = foremanMatch ? (foremanMatch.timestamp || null) : null;

      const historyStatus = loop._source === 'history' ? (item.status || null) : null;
      const agentState = _deriveAgentState(loop._source, historyStatus, foremanStatus);
      const stage = _deriveStage(foremanAction, item.promptName);

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
        promptName: item.promptName || null,
        promptText: item.prompt || null,
        dispatchedAt: item.dispatchedAt || null,
        // takenAt and resolvedAt collapse into the same event in the current
        // dispatch schema (see LIN-245 research). Both surfaces are exposed
        // for forward-compat with the design doc, mapped from the same field.
        takenAt: loop._source === 'history' ? (item.resolvedAt || null) : null,
        resolvedAt: loop._source === 'history' ? (item.resolvedAt || null) : null,
        dispatchedBy: item.dispatchedBy || null,
        target: item.target || null,
        repo: item.repo || null,
        feedback: Array.isArray(item.feedback) ? item.feedback : [],
        source: loop._source,
        historyStatus,
        foremanAction,
        foremanStatus,
        foremanSummary,
        foremanTimestamp,
        agentState,
        stage
      });
    }
  }

  return result;
}

// ─── I/O boundary ────────────────────────────────────────────────────────────

/**
 * Fetch all data needed to build Loops for a workspace.
 *
 * Issues three parallel reads against the stores:
 *   - dispatch live queue          (already unbounded by `listItems`)
 *   - dispatch history archive     (no `limit` → all rows)
 *   - foreman status entries       (no `limit` → all non-expired rows;
 *                                    pre-fixed in foreman-store.js)
 *
 * Stores already swallow internal errors and return empty arrays, so this
 * function only needs to handle the structural unwrap. Total failure
 * (e.g., DB unreachable for all three) is allowed to propagate.
 *
 * @param {string} urlKey
 * @param {Object} deps
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.foremanStore
 * @returns {Promise<{live: Array, history: Array, foreman: Array}>}
 */
async function _fetchWorkspaceData(urlKey, { dispatchStore, foremanStore }) {
  const [liveItems, historyResult, foremanResult] = await Promise.all([
    dispatchStore.listItems(urlKey),
    dispatchStore.listHistory(urlKey),
    foremanStore.listStatus(urlKey)
  ]);

  return {
    live: Array.isArray(liveItems) ? liveItems : [],
    history: Array.isArray(historyResult?.items) ? historyResult.items : [],
    foreman: Array.isArray(foremanResult?.items) ? foremanResult.items : []
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
 * @param {Object} [deps.foremanStore]
 * @returns {Promise<Array<Object>>}
 */
export async function getLoopsForIssue(urlKey, issueIdentifier, deps = {}) {
  if (!urlKey || !issueIdentifier) return [];
  const { dispatchStore, foremanStore } = deps;
  if (!dispatchStore || !foremanStore) {
    throw new Error('pipeline-loops: dispatchStore and foremanStore must be injected');
  }
  const { live, history, foreman } = await _fetchWorkspaceData(urlKey, { dispatchStore, foremanStore });
  return _buildLoops({
    liveItems: live.filter(x => x.issueIdentifier === issueIdentifier),
    historyItems: history.filter(x => x.issueIdentifier === issueIdentifier),
    foremanEntries: foreman.filter(f => f.taskIdentifier === issueIdentifier)
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
 * @param {Object} [deps.foremanStore]
 * @returns {Promise<Array<Object>>}
 */
export async function getLoopsForWorkspace(urlKey, deps = {}) {
  if (!urlKey) return [];
  const { dispatchStore, foremanStore } = deps;
  if (!dispatchStore || !foremanStore) {
    throw new Error('pipeline-loops: dispatchStore and foremanStore must be injected');
  }
  const { live, history, foreman } = await _fetchWorkspaceData(urlKey, { dispatchStore, foremanStore });
  return _buildLoops({ liveItems: live, historyItems: history, foremanEntries: foreman });
}

// Internal exports for unit tests. Not part of the public contract — callers
// outside this module's tests should not import these.
export const __internal = {
  _toDate,
  _deriveAgentState,
  _deriveStage,
  _matchForemanToLoop,
  _buildLoops,
  _fetchWorkspaceData,
  LOOKBACK_MS
};
