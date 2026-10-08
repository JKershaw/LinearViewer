/**
 * Owner-only runner enqueue gate (LIN-3383, S1.4 of LIN-2954).
 *
 * Only a workspace's owner may queue work for a runner-consumed target
 * (`cli`, `web`). This is the one helper every SESSION-side entry that reaches
 * the queue calls, before any write, provider call or run gate. It is NOT in
 * `createDispatchItem`: that factory also serves proxy and orchestrator callers
 * that have no session (they are token-scoped by `requireGrant('dispatch')`).
 *
 * The owner verdict comes from the one hoisted `workspaceOwnerCheck`
 * (server.js) — never construct a second owner checker. `dash` and `local` are
 * not runner-consumed and return before the seam is consulted.
 *
 * Fail-closed: a missing accountId, an absent/throwing seam and an ownerless
 * workspace are all refusals (shared with the mint gates).
 */

import { resolveOwnerMintRefusal } from './owner-mint-refusals.js';

export const RUNNER_TARGETS = Object.freeze(['cli', 'web']);

/** The store defaults an absent target to `cli` (lib/dispatch-store.js). */
export function isRunnerTarget(target) {
  return RUNNER_TARGETS.includes(target ?? 'cli');
}

/**
 * Resolve the refusal for a session-side enqueue, or `null` when allowed.
 * Never throws.
 *
 * @param {Object} args
 * @param {Function|null} [args.ownerCheck] - the hoisted workspace-owner seam
 * @param {string} [args.workspaceId] - route-resolved workspace id (never body)
 * @param {string} [args.accountId] - session account id (never body)
 * @param {string} [args.target] - queue target; absent means `cli`
 * @returns {Promise<{code: string, status: number, category: string, retryable: boolean, error: string}|null>}
 */
export async function resolveRunnerEnqueueRefusal({ ownerCheck, workspaceId, accountId, target } = {}) {
  if (!isRunnerTarget(target)) return null;
  return resolveOwnerMintRefusal({
    ownerCheck,
    workspaceId,
    accountId,
    ownerOnlyCode: 'RUNNER_ENQUEUE_OWNER_ONLY'
  });
}

/**
 * Throwing form: resolves normally when allowed, otherwise throws an Error
 * carrying `{code, status, category, retryable}`.
 */
export async function assertRunnerEnqueueAllowed(args = {}) {
  const refusal = await resolveRunnerEnqueueRefusal(args);
  if (!refusal) return;
  const err = new Error(refusal.error);
  err.code = refusal.code;
  err.status = refusal.status;
  err.category = refusal.category;
  err.retryable = refusal.retryable;
  err.runnerEnqueueRefusal = true;
  throw err;
}

export function isRunnerEnqueueRefusal(err) {
  return !!(err && err.runnerEnqueueRefusal === true);
}
