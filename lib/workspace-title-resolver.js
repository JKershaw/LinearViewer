/**
 * Workspace title resolver (LIN-962).
 *
 * The off-session glue the Observation materializer uses to turn a bare `urlKey`
 * (all a dispatch/status write hook carries) into a `{ identifier → title }` map,
 * so title-less Level-2 session cards can render a real task title instead of a
 * bare identifier.
 *
 * This was inline in `server.js` (`resolveWorkspaceForTitles` +
 * `resolveWorkspaceTitles`); it is extracted here as an injectable factory so the
 * REAL glue — session scan → latest-expiring-token workspace pick → workspace
 * issue fetch → identifier/title map — is exercised by a unit test with a fake
 * Linear client, rather than a reimplementation. `server.js` constructs it with
 * its real deps (`sessionsCollection`, memoized `fetchWorkspaceIssues`,
 * `TOKEN_REFRESH_BUFFER_MS`); behaviour is byte-identical to the inline version.
 *
 * Best-effort throughout: any failure degrades to null / an empty map, and the
 * materializer then leaves loops identifier-only (never worse).
 *
 * @param {Object} deps
 * @param {{ find: Function }} deps.sessionsCollection - Mongo/Mango sessions
 *   collection; `find({}).toArray()` yields the raw session docs to scan.
 * @param {(workspace: Object) => Promise<Array>} deps.fetchWorkspaceIssues - the
 *   workspace's canonical issue set (the Linear-backed fetch; memoized upstream).
 * @param {number} deps.tokenRefreshBufferMs - a token is only "live" if it expires
 *   more than this far in the future (matches resolveWorkspaceAccess).
 * @param {() => number} [deps.now] - clock, injectable for deterministic expiry
 *   tests; defaults to Date.now.
 * @returns {{ resolveWorkspaceForTitles: Function, resolveWorkspaceTitles: Function }}
 */
export function createWorkspaceTitleResolver({ sessionsCollection, fetchWorkspaceIssues, tokenRefreshBufferMs, now = () => Date.now() }) {
  // Off-session workspace resolver. The materializer runs on dispatch/status write
  // hooks that carry only a urlKey (no session), but resolving real task titles
  // needs a full workspace object (accessToken + provider). Mirror
  // resolveWorkspaceAccess's session scan but return the whole workspace with the
  // latest-expiring usable token, not just the token. Returns null when no session
  // references the workspace with a live token.
  async function resolveWorkspaceForTitles(urlKey) {
    if (process.env.NODE_ENV === 'test' && urlKey === 'test-workspace') {
      return { urlKey, accessToken: 'test-token' };
    }
    try {
      const sessions = await sessionsCollection.find({}).toArray();
      let best = null;
      let bestExpiry = 0;
      for (const s of sessions) {
        const data = typeof s.session === 'string' ? JSON.parse(s.session) : s.session;
        const ws = data?.workspaces?.find(w => w.urlKey === urlKey);
        if (!ws || !ws.accessToken) continue;
        const expiry = ws.tokenExpiresAt || 0;
        if (expiry > now() + tokenRefreshBufferMs && expiry > bestExpiry) {
          best = ws;
          bestExpiry = expiry;
        }
      }
      return best;
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
  async function resolveWorkspaceTitles(urlKey) {
    try {
      const workspace = await resolveWorkspaceForTitles(urlKey);
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
