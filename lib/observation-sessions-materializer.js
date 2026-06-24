/**
 * Observation sessions materializer (LIN-623).
 *
 * Keeps the durable `observation-sessions` read-model current by recomputing the
 * sessions a write touches, at write time. Wired into `DispatchQueueStore` and
 * `AgentStatusStore` via their `onWrite` hooks (server.js); every recompute reuses
 * the SAME pure builders the live feed runs (`getSessionsForIssues` →
 * `_buildLoops`/`_buildSessions`), so the projection can never drift from the live
 * reconstruction.
 *
 * Two correctness pillars:
 *
 *  1. **Recompute unit = the issue SET a session touches, not the session.**
 *     `_buildLoops` derives each agent-status match window from the *next dispatch
 *     of the same issue*, so a session is only faithful when EVERY dispatch of
 *     EVERY issue it touches is present. We therefore expand each target session to
 *     its full issue closure (seed + every explicit worker's issue, discovered via
 *     the {urlKey, sessionId} index) and build over that whole closure.
 *
 *  2. **Only upsert TARGET sessions.** Building over a closure can surface *other*
 *     sessions that merely share an issue but whose own closure isn't fully loaded;
 *     those would be partial/wrong, so we write only the sessions we set out to
 *     rebuild. A target that no longer reconstructs (all its rows aged out) has its
 *     doc removed.
 *
 * Why explicit-`sessionId` recompute is byte-identical to the full build, while the
 * historical inference path is not at risk: modern runs forward-stamp `sessionId`
 * (LIN-599), so their grouping is order-independent — restricting the build to the
 * touched issues yields identical session docs. Pre-`sessionId` historical sessions
 * are reconstructed only by inference and are static (they receive no new writes),
 * so they are *only ever* materialized by `backfillWorkspace` (a full live build,
 * byte-identical) and never hit this incremental path. The read-miss live fallback
 * is the final backstop for any workspace not yet backfilled.
 *
 * All work is best-effort and fully detached: a failure here must never affect the
 * dispatch/status write it rode in on. Per-key coalescing collapses the frequent
 * heartbeat writes (feedback / agent-status) into bounded rebuild work.
 */

import { getSessionsForIssues, getSessionsForWorkspace } from './pipeline-loops.js';

/**
 * @param {Object} deps
 * @param {Object} deps.dispatchStore
 * @param {Object} deps.agentStatusStore
 * @param {Object} deps.observationSessionsStore
 * @returns {{rebuildForWrite: Function, backfillWorkspace: Function}}
 */
export function createObservationMaterializer({ dispatchStore, agentStatusStore, observationSessionsStore }) {
  if (!dispatchStore || !agentStatusStore || !observationSessionsStore) {
    throw new Error('observation materializer: dispatchStore, agentStatusStore and observationSessionsStore are required');
  }
  const loopDeps = { dispatchStore, agentStatusStore };

  // Optional, late-assigned background hook (LIN-632): fire-and-forget summary
  // precompute when a session is (re)materialized, so the first user click on
  // "Summarise this session" is usually a cache hit. Held in a settable slot so
  // it can be wired AFTER the summary cache store exists (mirroring the store
  // `onWrite` late-assignment in server.js). The hook itself owns the
  // terminal-only gate, the cache check, and graceful skip when no key is set —
  // the materializer just offers it every upserted target session.
  const summaryPrecompute = { fn: null };

  // ── Per-key coalescing for incremental rebuilds ──────────────────────────────
  // Heartbeat writes (dispatch feedback / agent-status) fire very frequently. If a
  // rebuild for a key is already running, mark it dirty and let a single trailing
  // run capture the latest state, rather than piling up redundant concurrent work.
  const inflight = new Map();
  function coalesce(key, fn) {
    const existing = inflight.get(key);
    if (existing) {
      existing.dirty = true;
      return existing.tail;
    }
    const entry = { dirty: false };
    const runOnce = () => Promise.resolve()
      .then(fn)
      .catch(err => console.error('observation materializer rebuild error:', err?.message || err));
    const loop = () => runOnce().then(() => {
      if (entry.dirty) { entry.dirty = false; return loop(); }
      inflight.delete(key);
    });
    entry.tail = loop();
    inflight.set(key, entry);
    return entry.tail;
  }

  // ── Backfill in-flight guard ─────────────────────────────────────────────────
  // A one-time full build per workspace; collapse the burst of read-miss polls
  // (every 5s until the marker is set) into one run.
  const backfillInflight = new Map();

  /**
   * Discover the autopilot session ids that touch a given issue: every dispatch on
   * that issue is either an autopilot anchor (its own id is the session id) or a
   * worker that carries the spawning session's id.
   *
   * @param {string} urlKey
   * @param {string} issueIdentifier
   * @returns {Promise<Set<string>>}
   */
  async function _sessionsTouchingIssue(urlKey, issueIdentifier) {
    const targets = new Set();
    const [hist, live] = await Promise.all([
      dispatchStore.listHistory(urlKey, { issueIdentifier }),
      Promise.resolve(dispatchStore.listItems(urlKey, { issueIdentifier }))
    ]);
    const rows = [...(hist.items || []), ...(live || [])];
    for (const row of rows) {
      if (row.kind === 'autopilot') targets.add(row.id);
      if (row.sessionId) targets.add(row.sessionId);
    }
    return targets;
  }

  /**
   * The full set of issues a session touches: its seed (the anchor dispatch's
   * issue) plus every explicit worker's issue, discovered via the {urlKey,
   * sessionId} index across both history and the live queue.
   *
   * @param {string} urlKey
   * @param {string} sessionId
   * @param {Set<string>} into - accumulate issue identifiers here
   */
  async function _collectSessionIssues(urlKey, sessionId, into) {
    const [anchor, hist, live] = await Promise.all([
      Promise.resolve(dispatchStore.getItemStatus(urlKey, sessionId)),
      dispatchStore.listHistory(urlKey, { sessionId }),
      Promise.resolve(dispatchStore.listItems(urlKey, { sessionId }))
    ]);
    if (anchor && anchor.issueIdentifier) into.add(anchor.issueIdentifier);
    for (const it of hist.items || []) if (it.issueIdentifier) into.add(it.issueIdentifier);
    for (const it of live || []) if (it.issueIdentifier) into.add(it.issueIdentifier);
  }

  async function _doRebuild(urlKey, { sessionId, issueIdentifier }) {
    // 1. Resolve which sessions to rebuild.
    const targets = new Set();
    if (sessionId) {
      targets.add(sessionId);
    } else if (issueIdentifier) {
      for (const s of await _sessionsTouchingIssue(urlKey, issueIdentifier)) targets.add(s);
    }
    if (targets.size === 0) return; // write doesn't belong to any feed session

    // 2. Expand every target to its full issue closure (correctness pillar 1).
    const issueClosure = new Set();
    if (issueIdentifier) issueClosure.add(issueIdentifier);
    for (const s of targets) await _collectSessionIssues(urlKey, s, issueClosure);
    if (issueClosure.size === 0) {
      // No discoverable issues for the target(s) — their rows are gone; drop docs.
      for (const s of targets) await observationSessionsStore.removeSession(urlKey, s);
      return;
    }

    // 3. Rebuild over the closure using the SAME builders the live feed runs.
    const built = await getSessionsForIssues(urlKey, loopDeps, [...issueClosure], { lean: true });
    const builtById = new Map(built.map(s => [s.sessionId, s]));

    // 4. Persist ONLY the target sessions (correctness pillar 2).
    for (const s of targets) {
      const session = builtById.get(s);
      if (session) {
        await observationSessionsStore.upsertSession(urlKey, session);
        // 5. Best-effort background summary precompute (LIN-632). Fully detached:
        // a failure here must never affect the read-model write it rode in on.
        if (summaryPrecompute.fn) {
          Promise.resolve(summaryPrecompute.fn(urlKey, session)).catch(() => {});
        }
      } else {
        await observationSessionsStore.removeSession(urlKey, s);
      }
    }
  }

  /**
   * Recompute the read-model for the session(s) a write touches. Fire-and-forget
   * safe (the store hooks already detach + swallow); returns a promise for tests.
   *
   * @param {string} urlKey
   * @param {{sessionId?: string|null, issueIdentifier?: string|null}} payload
   * @returns {Promise<void>}
   */
  function rebuildForWrite(urlKey, { sessionId = null, issueIdentifier = null } = {}) {
    if (!urlKey || (!sessionId && !issueIdentifier)) return Promise.resolve();
    const key = `${urlKey}::${sessionId || `issue:${issueIdentifier}`}`;
    return coalesce(key, () => _doRebuild(urlKey, { sessionId, issueIdentifier }));
  }

  /**
   * One-time full build for a workspace (lazy-on-miss; doubles as the migration).
   * Reuses the live `getSessionsForWorkspace` build verbatim — byte-identical by
   * construction — then sets the backfill marker so a genuinely-empty workspace
   * stops re-fanning to the live path on every poll.
   *
   * @param {string} urlKey
   * @returns {Promise<void>}
   */
  function backfillWorkspace(urlKey) {
    if (!urlKey) return Promise.resolve();
    if (backfillInflight.has(urlKey)) return backfillInflight.get(urlKey);
    const p = (async () => {
      const sessions = await getSessionsForWorkspace(urlKey, { ...loopDeps, lean: true });
      for (const s of sessions) await observationSessionsStore.upsertSession(urlKey, s);
      await observationSessionsStore.setBackfillMarker(urlKey);
    })()
      .catch(err => console.error('observation backfill error:', err?.message || err))
      .finally(() => backfillInflight.delete(urlKey));
    backfillInflight.set(urlKey, p);
    return p;
  }

  return {
    rebuildForWrite,
    backfillWorkspace,
    // Late-assignable background summary precompute hook (LIN-632). Setting a
    // non-function (e.g. null) disables it. Read at call time inside _doRebuild.
    set precomputeSessionSummary(fn) { summaryPrecompute.fn = (typeof fn === 'function') ? fn : null; },
    get precomputeSessionSummary() { return summaryPrecompute.fn; }
  };
}
