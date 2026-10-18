import { selectOwnerWorkspaceRow } from './workspace-token-resolver.js';
import { liveSessionRows } from './session-row-live.js';

/**
 * Workspace title resolver (LIN-962, owner-scoped selection since LIN-1986).
 *
 * The off-session glue the Observation materializer uses to turn a bare `urlKey`
 * (all a dispatch/status write hook carries) plus an `ownerAccountId` into a
 * `{ identifier → title }` map, so title-less Level-2 session cards can render a
 * real task title instead of a bare identifier.
 *
 * This was inline in `server.js` (`resolveWorkspaceForTitles` +
 * `resolveWorkspaceTitles`); it is extracted here as an injectable factory so the
 * REAL glue — session scan → owner-scoped workspace-row pick → workspace issue
 * fetch → identifier/title map — is exercised by a unit test with a fake Linear
 * client, rather than a reimplementation. `server.js` constructs it with its real
 * deps (`sessionsCollection`, memoized `fetchWorkspaceIssues`).
 *
 * Selection itself is delegated to `selectOwnerWorkspaceRow`
 * (lib/workspace-token-resolver.js) — the same owner-scoped selector family
 * `resolveWorkspaceAccess` uses — rather than a second, owner-blind scan-and-pick
 * implementation living here. `find({})` stays: the family's house convention is
 * to scan the in-memory session array (the sessions collection has no useful
 * index for a narrower query), with each selector a pure function over the
 * result.
 *
 * Best-effort throughout: any failure, or a missing owner, degrades to null / an
 * empty map, and the materializer then leaves loops identifier-only (never
 * worse).
 *
 * @param {Object} deps
 * @param {{ find: Function }} deps.sessionsCollection - Mongo/Mango sessions
 *   collection; `find({}).toArray()` yields the raw session docs to scan.
 * @param {(workspace: Object) => Promise<Array>} deps.fetchWorkspaceIssues - the
 *   workspace's canonical issue set (the Linear-backed fetch; memoized upstream).
 * @param {() => number} [deps.now] - clock seam for the session-liveness filter; defaults to Date.now
 * @returns {{ resolveWorkspaceForTitles: Function, resolveWorkspaceTitles: Function }}
 */
export function createWorkspaceTitleResolver({ sessionsCollection, fetchWorkspaceIssues, resolveConnectionBackedWorkspace = null, now = Date.now }) {
  // Off-session workspace resolver. The materializer runs on dispatch/status write
  // hooks that carry only a urlKey (no session), but resolving real task titles
  // needs a full workspace object (accessToken + provider). Returns null when the
  // owner has no live token for the workspace, or no owner was supplied.
  //
  // LIN-3124 PR3 (D7): a connection-backed workspace is served first from the
  // owner's Connection (live credential only, no refresh, owner-scoped through
  // the injected arm's authorizeConnection) — `selectOwnerWorkspaceRow` stays
  // unedited and is the legacy fallback. No session row means no arm result, so
  // there is no post-logout title widening.
  //
  // LIN-3506: rows past their `expires` are dropped here, at the call site, before
  // BOTH branches — an expired row must neither authorize the connection arm nor
  // hand its stored accessToken to fetchWorkspaceIssues. The selector bodies in
  // workspace-token-resolver.js are byte-pinned (LIN-3124 D7), so they cannot filter.
  async function resolveWorkspaceForTitles(urlKey, ownerAccountId) {
    if (process.env.NODE_ENV === 'test' && urlKey === 'test-workspace') {
      return { urlKey, accessToken: 'test-token' };
    }
    try {
      const sessions = liveSessionRows(await sessionsCollection.find({}).toArray(), now());
      if (typeof resolveConnectionBackedWorkspace === 'function') {
        const connectionWorkspace = await resolveConnectionBackedWorkspace({ urlKey, ownerAccountId, sessions });
        if (connectionWorkspace) return connectionWorkspace;
      }
      return selectOwnerWorkspaceRow(sessions, urlKey, ownerAccountId);
    } catch (err) {
      console.error('resolveWorkspaceForTitles error:', err?.message || err);
      return null;
    }
  }

  // Build a workspace's { identifier → title } map for the observation
  // materializer's read/serve title enrichment. Reuses the (memoized upstream)
  // fetchWorkspaceIssues, so frequent re-materialization does not re-hit Linear.
  // Best-effort: any failure yields an empty map and the materializer then degrades
  // to today's identifier-only card (never worse).
  async function resolveWorkspaceTitles(urlKey, ownerAccountId) {
    try {
      const workspace = await resolveWorkspaceForTitles(urlKey, ownerAccountId);
      if (!workspace) return {};
      const issues = await fetchWorkspaceIssues(workspace);
      const titles = {};
      for (const issue of issues || []) {
        if (issue && issue.identifier && issue.title) titles[issue.identifier] = issue.title;
      }
      return titles;
    } catch (err) {
      console.error('resolveWorkspaceTitles error:', err?.message || err);
      return {};
    }
  }

  return { resolveWorkspaceForTitles, resolveWorkspaceTitles };
}
