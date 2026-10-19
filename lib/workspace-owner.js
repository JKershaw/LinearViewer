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
 *   anything else          — an unrecognised answer (null, a primitive, a
 *                             function, an unknown or missing `status`) is
 *                             `unavailable`, the same as a throw.
 *
 * Callers never read `.status` off the raw answer themselves: they go through
 * `readOwnerStatus` / `isOwnerAnswer` below (LIN-3648). A gate that has to turn
 * a throw into a refusal makes the seam call through `readOwnerSeamStatus`
 * (LIN-3673), the total entry point, instead of placing its own `try`.
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

/**
 * Reads the contract above off a seam answer (LIN-3648): returns
 * 'owner' | 'not-owner' | 'no-owner', or 'unavailable' for anything else.
 * Shape first: null, undefined, primitives and functions are 'unavailable' and
 * their `status` is never read. `status` is read exactly once, and only off a
 * non-function object (arrays included). The read is deliberately not wrapped
 * in a try: a throwing `status` getter propagates. It is handed an answer that
 * the caller has already obtained, so it cannot cover the seam call itself;
 * a caller that must fail closed on a throw uses `readOwnerSeamStatus`, which
 * makes the call and catches (LIN-3655: a getter throw is a throw too).
 *
 * @param {*} answer - whatever the owner seam returned
 * @returns {'owner'|'not-owner'|'no-owner'|'unavailable'}
 */
export function readOwnerStatus(answer) {
  if (answer === null || typeof answer !== 'object') return 'unavailable';
  const { status } = answer;
  return status === 'owner' || status === 'not-owner' || status === 'no-owner' ? status : 'unavailable';
}

/**
 * The shared owner predicate (LIN-3648): true only for an answer whose
 * recognised status is 'owner'. Every other answer fails closed.
 *
 * @param {*} answer - whatever the owner seam returned
 * @returns {boolean}
 */
export function isOwnerAnswer(answer) {
  return readOwnerStatus(answer) === 'owner';
}

/**
 * The total owner check (LIN-3673): makes the seam call and reads its answer,
 * and never throws, whatever the call does. This is the one place a seam throw
 * becomes a verdict, so no gate places its own `try` around the seam (two of
 * the older placements were wrong: LIN-3654, LIN-3655).
 *
 * It takes a thunk, not the seam, so each gate's own call expression stays at
 * the gate (`() => ownerCheck({ workspaceId, accountId })`); a non-function
 * seam therefore still throws the same TypeError there, now carried as `error`.
 * A sync throw, a rejection, a thenable whose `then` throws and a throwing
 * `status` getter on the answer all read as 'unavailable' with `threw: true`.
 * An unrecognised answer (null, a primitive, a function, an unknown status) is
 * also 'unavailable' but with `threw: false`: gates differ in what they do with
 * the two (a task-share link answers 503 for a throw and 404 for the other,
 * the runner page words its warn differently), so the distinction is carried.
 *
 * `threw` is its own flag because a thrown value can be `undefined`. `error` is
 * the thrown value untouched: it is never read, formatted or tested here, since
 * some thrown values (a revoked Proxy, `Object.create(null)`) throw when
 * formatted. It does not log; each gate logs its own line from the carried value.
 *
 * @param {function(): *} thunk - makes the seam call and returns its answer (or promise)
 * @returns {Promise<{status: 'owner'|'not-owner'|'no-owner'|'unavailable', threw: boolean, error: *}>}
 */
export async function readOwnerSeamStatus(thunk) {
  try {
    return { status: readOwnerStatus(await thunk()), threw: false, error: undefined };
  } catch (error) {
    return { status: 'unavailable', threw: true, error };
  }
}
