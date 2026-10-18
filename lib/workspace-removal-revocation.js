/**
 * LIN-3421: what an account's removal of a workspace revokes beyond the owner
 * credential. Composes the three per-store "revoke what this account made for
 * this key" operations so `routes/workspace.js` takes one dependency.
 *
 * Only the removing account's own rows for the one urlKey go: proxy tokens and
 * dispatch tokens by `createdBy`, `/t/` links by `ownerAccountId` (soft, via
 * `revokedAt`). Other accounts' rows for the same key are untouched, as are
 * ownerless dispatch rows. Grant-bearing proxy lineages (the runner) go only
 * when the removing account OWNS the workspace (LIN-3409's owner-only rule);
 * any doubt about ownership fails closed to leaving them.
 *
 * Not used by logout, involuntary removals or single-binding unlink: those keep
 * today's behaviour (LIN-3421 out of scope).
 */

import { isOwnerAnswer } from './workspace-owner.js';

/**
 * @param {Object} deps
 * @param {{revokeByCreator: Function}} [deps.proxyTokenStore]
 * @param {{revokeByCreator: Function}} [deps.dispatchTokenStore]
 * @param {{revokeByOwner: Function}} [deps.taskShareStore]
 * @param {function({workspaceId: string, accountId: string}): Promise<{status: string}>} [deps.workspaceOwnerCheck]
 * @param {function(string): Promise<string>} [deps.resolveCanonicalAccountId]
 * @returns {{revoke: function({urlKey: string, workspaceId?: string, accountId: string}): Promise<Object>}}
 */
export function createWorkspaceRemovalRevoker({
  proxyTokenStore,
  dispatchTokenStore,
  taskShareStore,
  workspaceOwnerCheck,
  resolveCanonicalAccountId
} = {}) {
  async function accountIdsFor(accountId) {
    const ids = [accountId];
    if (typeof resolveCanonicalAccountId === 'function') {
      try {
        const canonical = await resolveCanonicalAccountId(accountId);
        // A merged-away alias may still be in `createdBy`; cover both ids.
        if (canonical && canonical !== accountId) ids.push(canonical);
      } catch (err) {
        console.error('Workspace removal: canonical account lookup failed:', err?.message || err);
      }
    }
    return ids;
  }

  async function isOwner(workspaceId, accountId) {
    if (typeof workspaceOwnerCheck !== 'function' || !workspaceId) return false;
    try {
      const answer = await workspaceOwnerCheck({ workspaceId, accountId });
      return isOwnerAnswer(answer);
    } catch (err) {
      console.error('Workspace removal: owner check failed:', err?.message || err);
      return false;
    }
  }

  // Each store runs on its own so one failing never blocks the others, or the
  // credential delete the caller does around this.
  async function attempt(label, fn) {
    try {
      return await fn();
    } catch (err) {
      console.error(`Workspace removal: ${label} revoke failed:`, err?.message || err);
      return 0;
    }
  }

  return {
    async revoke({ urlKey, workspaceId = null, accountId }) {
      const counts = { proxyTokens: 0, dispatchTokens: 0, taskShareLinks: 0 };
      if (!urlKey || !accountId) return counts;
      const accountIds = await accountIdsFor(accountId);
      // Owner check runs before any delete.
      const includeGrantBearing = await isOwner(workspaceId, accountId);

      if (proxyTokenStore?.revokeByCreator) {
        counts.proxyTokens = await attempt('proxy token', () =>
          proxyTokenStore.revokeByCreator(urlKey, accountIds, { includeGrantBearing }));
      }
      if (dispatchTokenStore?.revokeByCreator) {
        counts.dispatchTokens = await attempt('dispatch token', () =>
          dispatchTokenStore.revokeByCreator(urlKey, accountIds));
      }
      if (taskShareStore?.revokeByOwner) {
        counts.taskShareLinks = await attempt('task share link', () =>
          taskShareStore.revokeByOwner(urlKey, accountIds));
      }
      return counts;
    }
  };
}
