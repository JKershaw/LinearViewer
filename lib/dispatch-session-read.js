/**
 * lib/dispatch-session-read.js
 *
 * The one shared "read ONE session by id" path over the dispatch store (LIN-3812,
 * LIN-3810's tenth member class). Callers used to rebuild the WHOLE workspace
 * (`getSessionsForWorkspace`, non-lean, 30 days of prompts and feedback) just to
 * `.find` one session id. `pointReadSession` is the issue-scoped, index-backed
 * read LIN-1022 built in routes/dashboard.js, lifted here so every caller shares it.
 *
 * Use this for a session of the DISPATCH store (workspace-scoped rows). The
 * Observation read-model (`lib/observation-sessions-store.js`) is a different,
 * materialized store with its own point read; reach for that one when the caller
 * wants the feed's lean projection of a session.
 */
import { getSessionsForIssues, getSessionsForWorkspace } from './pipeline-loops.js';

/**
 * Issue-scoped point-read of ONE session by id, WITHOUT the whole-workspace
 * fallback. Returns the NON-lean session (feedback[] intact) built by
 * `getSessionsForIssues`, byte-identical to the whole-workspace build restricted
 * to the session's issues, or null when issue-scoping cannot produce it.
 *
 * A `sessionId`-first session is exactly {the root dispatch (id === sessionId)}
 * U {dispatches stamped `sessionId`}. Both are `{urlKey, sessionId}`-indexed
 * reads and project to `issueIdentifier` only.
 *
 * @param {string} urlKey
 * @param {string} sessionId
 * @param {{dispatchStore: Object, agentStatusStore: Object}} deps - the loop deps
 * @returns {Promise<Object|null>}
 */
export async function pointReadSession(urlKey, sessionId, deps) {
  const { dispatchStore } = deps;
  const ids = new Set();
  // The root/orchestrator dispatch (id===sessionId) carries no self-referential
  // `sessionId`, so the sessionId-scoped reads below won't surface it - fetch its
  // own `issueIdentifier` (the seed) directly. Defensive: a store without
  // getItemStatus (test fakes) just contributes nothing here.
  const root = typeof dispatchStore.getItemStatus === 'function'
    ? await Promise.resolve(dispatchStore.getItemStatus(urlKey, sessionId)).catch(() => null)
    : null;
  // LIN-2934 (S6): a GENERAL (goal-only) autopilot anchor's own row carries no
  // `issueIdentifier`, so it can never land in `ids` and is otherwise invisible
  // to getSessionsForIssues' per-issue queries - same anchor-aware construction
  // the materializer's `_collectSessionIssues`/`anchorsOut` already use (see
  // getSessionsForIssues' own `extraItems` doc).
  let anchorExtraItem = null;
  if (root?.issueIdentifier) {
    ids.add(root.issueIdentifier);
  } else if (root && root.kind === 'autopilot') {
    anchorExtraItem = root;
  }
  // LIN-3975 (review finding 1): a wake (or reply) on another issue that continues this run carries the
  // run's `sessionGroupId` (inherited from its anchor) but no `sessionId` stamp, so the `sessionId` reads
  // above never see its issue. The group read adds those issues, so the rebuilt session holds the attempt
  // the task page links to it. `sessionGroupId` is the group key the ledger joins by (`_sessionForGroup`).
  const projection = { issueIdentifier: 1 };
  const [live, hist, liveGroup, histGroup] = await Promise.all([
    Promise.resolve(dispatchStore.listItems(urlKey, { sessionId, projection })).catch(() => []),
    Promise.resolve(dispatchStore.listHistory(urlKey, { sessionId, projection })).catch(() => ({ items: [] })),
    Promise.resolve(dispatchStore.listItems(urlKey, { sessionGroupId: sessionId, projection })).catch(() => []),
    Promise.resolve(dispatchStore.listHistory(urlKey, { sessionGroupId: sessionId, projection })).catch(() => ({ items: [] }))
  ]);
  for (const r of [...(Array.isArray(live) ? live : []), ...(Array.isArray(liveGroup) ? liveGroup : [])]) {
    if (r?.issueIdentifier) ids.add(r.issueIdentifier);
  }
  for (const r of [...(hist?.items || []), ...(histGroup?.items || [])]) if (r?.issueIdentifier) ids.add(r.issueIdentifier);

  if (!ids.size && !anchorExtraItem) return null;
  const rebuilt = await getSessionsForIssues(urlKey, deps, [...ids], {
    lean: false,
    extraItems: anchorExtraItem ? [anchorExtraItem] : []
  });
  return rebuilt.find(s => String(s.sessionId) === String(sessionId)) || null;
}

/**
 * One session by id: the point read, then (unless `fallback: false`) the
 * whole-workspace read for the cases the point read cannot reach - a historical
 * inference-grouped session (no explicit `sessionId` stamps) or one whose loops
 * carry no `issueIdentifier`. The fallback uses the caller's own `deps`, so a
 * caller that enriches its whole-workspace read (e.g. with an `issueGraph`) keeps
 * that. Found / not-found is therefore identical to the old whole-workspace
 * `.find`; only the common case got cheap.
 *
 * @param {string} urlKey
 * @param {string} sessionId
 * @param {Object} deps - `{dispatchStore, agentStatusStore, ...}` as `getSessionsForWorkspace` takes
 * @param {{fallback?: boolean}} [opts]
 * @returns {Promise<Object|null>}
 */
export async function readSessionById(urlKey, sessionId, deps, { fallback = true } = {}) {
  const hit = await pointReadSession(urlKey, sessionId, deps);
  if (hit || !fallback) return hit;
  const sessions = await getSessionsForWorkspace(urlKey, deps);
  return sessions.find(s => String(s.sessionId) === String(sessionId)) || null;
}
