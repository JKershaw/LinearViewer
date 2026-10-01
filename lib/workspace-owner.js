/**
 * Workspace-owner seam (LIN-3131, the S2b.1 slice of LIN-3059).
 *
 * `checkWorkspaceOwner({ workspaceId, accountId })` answers whether `accountId`
 * is a workspace's owner, keyed on the workspace identity. The owner is the
 * `role: 'owner'` account↔workspace edge introduced by #1601 / LIN-1892 S1 and
 * read through `AccountWorkspaceStore.getWorkspaceOwnerAccountId`; there is
 * deliberately no parallel owner field. Ownerless workspaces that predate the
 * owner mark are covered by the one-shot boot backfill in lib/owner-backfill.js
 * (LIN-3142). It is the function wired into `ProxyTokenStore`'s late-bound
 * owner-check seam, and both the owner-checked grant mint and the
 * exchange-time owner re-check call it.
 *
 * Contract (plan P1):
 *   { status: 'owner' }     — the account is the (canonicalised) owner
 *   { status: 'not-owner' } — a different account owns it, or no caller account
 *   { status: 'no-owner' }  — the workspace has no owner edge, or no workspace id
 *   a throw                 — owner resolution is unavailable (a corrupt
 *                             `mergedInto` chain, a failing store). The store
 *                             maps this to OWNER_CHECK_UNAVAILABLE, fail closed.
 *
 * Both sides are canonicalised through `resolveCanonicalAccountId`, so a
 * merged-away owner — or a caller whose account was merged — still compares
 * equal to its survivor. A corrupt chain (cycle / depth overflow) makes that
 * resolution throw, which is exactly the "unavailable" case: fail closed.
 */

/**
 * Build the owner-check seam function `ProxyTokenStore` expects, closing over
 * the stores it composes. In `server.js` the seam is late-bound this way, after
 * `accountWorkspaceStore` exists.
 *
 * @param {Object} deps
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} deps.accountWorkspaceStore
 * @param {import('./account-store.js').AccountStore} deps.accountStore
 * @returns {function({workspaceId?: string, accountId?: string}): Promise<{status: string}>}
 */
export function createWorkspaceOwnerCheck({ accountWorkspaceStore, accountStore } = {}) {
  return (args = {}) => checkWorkspaceOwner(args, { accountWorkspaceStore, accountStore });
}

/**
 * The seam body, dependency-injected so it is unit-testable with fakes as well
 * as the real stores. See the module header for the answer contract.
 *
 * @param {Object} args
 * @param {string} [args.workspaceId]
 * @param {string} [args.accountId]
 * @param {Object} deps
 * @param {import('./account-workspace-store.js').AccountWorkspaceStore} deps.accountWorkspaceStore
 * @param {import('./account-store.js').AccountStore} deps.accountStore
 * @returns {Promise<{status: 'owner'|'not-owner'|'no-owner'}>}
 */
export async function checkWorkspaceOwner({ workspaceId, accountId } = {}, { accountWorkspaceStore, accountStore } = {}) {
  // L2 carry-forward (LIN-3129 → LIN-3131): an absent workspace identity can
  // never resolve an owner. Fail closed here rather than letting an `undefined`
  // key reach the store, so the answer cannot depend on how a query engine
  // treats `{ workspaceId: undefined }`.
  if (!workspaceId) return { status: 'no-owner' };

  // No caller identity is never the owner (a grant-bearing document with a null
  // `createdBy` reaches here at exchange; it must not be treated as authority).
  if (!accountId) return { status: 'not-owner' };

  // `getWorkspaceOwnerAccountId` canonicalises the owner and returns `null` when
  // there is no owner edge; a corrupt `mergedInto` chain throws here and
  // propagates (→ unavailable, fail closed).
  const ownerAccountId = await accountWorkspaceStore.getWorkspaceOwnerAccountId(workspaceId, accountStore);
  if (!ownerAccountId) return { status: 'no-owner' };

  // Canonicalise the caller too, so a merged-away account compares against the
  // survivor the owner resolved to. A throw here is likewise "unavailable".
  const canonicalAccountId = await accountStore.resolveCanonicalAccountId(accountId);
  if (!canonicalAccountId) return { status: 'not-owner' };

  return canonicalAccountId === ownerAccountId ? { status: 'owner' } : { status: 'not-owner' };
}
