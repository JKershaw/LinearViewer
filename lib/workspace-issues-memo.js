/**
 * lib/workspace-issues-memo.js — the short memo of a workspace's issue set (server.js `fetchWorkspaceIssues`).
 *
 * A pure cache: a drill-in and the 5 s observation poll behind it would otherwise refetch the whole workspace. Keyed by
 * `workspace.id || workspace.urlKey`, with a 30 s TTL. Test-mode mock workspaces bypass it in the caller.
 *
 * LIN-4168: the memo is a per-key holder. `clear(ctx)` drops the entries for one workspace (by its id and its urlKey),
 * and drops everything when the reset has no workspace. The keyless `clearAll()` is the `/test/clear-workspace-issues-memo`
 * route's reset.
 */

/**
 * @param {Object} [deps]
 * @param {number} [deps.ttlMs=30000]
 * @param {Function} [deps.now] - () → epoch ms
 * @returns {{get: Function, set: Function, clear: Function, clearAll: Function, countFor: Function}}
 */
export function createWorkspaceIssuesMemo({ ttlMs = 30 * 1000, now = () => Date.now() } = {}) {
  /** @type {Map<string, {issues: Array, cachedAt: number}>} */
  const entries = new Map();

  /** The memo key for a workspace, or null when it has neither an id nor a urlKey. */
  const keyOf = (workspace) => (workspace && (workspace.id || workspace.urlKey)) || null;

  /**
   * A fresh memoised set for the workspace, or undefined on a miss or expiry.
   * @param {Object} workspace
   * @returns {Array|undefined}
   */
  function get(workspace) {
    const key = keyOf(workspace);
    if (!key) return undefined;
    const hit = entries.get(key);
    if (hit && now() - hit.cachedAt < ttlMs) return hit.issues;
    return undefined;
  }

  /**
   * @param {Object} workspace
   * @param {Array} issues
   */
  function set(workspace, issues) {
    const key = keyOf(workspace);
    if (key) entries.set(key, { issues, cachedAt: now() });
  }

  /**
   * Drop the entries for one workspace, matched by both its `id` and its `urlKey`, so an entry memoised under either
   * form goes. With no workspace in the context, drop everything: the memo is a pure cache, so that is always correct.
   * @param {{urlKey?: string, workspace?: Object|null}} ctx
   */
  function clear(ctx) {
    const workspace = ctx && ctx.workspace;
    if (!workspace) { entries.clear(); return; }
    if (workspace.id) entries.delete(workspace.id);
    if (ctx.urlKey) entries.delete(ctx.urlKey);
  }

  /** Drop every entry (the keyless test reset). */
  function clearAll() { entries.clear(); }

  /**
   * Entries memoised under this workspace's id or urlKey (fresh or stale): the key-state probe (LIN-4168).
   * @param {{urlKey?: string, workspace?: Object|null}} ctx
   * @returns {number}
   */
  function countFor(ctx) {
    const workspace = ctx && ctx.workspace;
    let n = 0;
    if (workspace && workspace.id && entries.has(workspace.id)) n += 1;
    if (ctx && ctx.urlKey && entries.has(ctx.urlKey)) n += 1;
    return n;
  }

  return { get, set, clear, clearAll, countFor };
}
