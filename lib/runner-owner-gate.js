/**
 * Owner-only runner gate (LIN-3383 enqueue, generalised by LIN-3398 to every
 * session-side runner action: enqueue, halt, delete, trim, dispatch-token revoke).
 *
 * Only a workspace's owner may act on a runner-consumed target
 * (`cli`, `web`). This is the one helper every SESSION-side entry that reaches
 * the runner calls, before any write, provider call or run gate. It is NOT in
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
import { jsonError } from './errors.js';

export const RUNNER_TARGETS = Object.freeze(['cli', 'web']);

/** The store defaults an absent target to `cli` (lib/dispatch-store.js). */
export function isRunnerTarget(target) {
  return RUNNER_TARGETS.includes(target ?? 'cli');
}

/**
 * Resolve the refusal for a session-side runner action, or `null` when allowed.
 * Never throws.
 *
 * @param {Object} args
 * @param {Function|null} [args.ownerCheck] - the hoisted workspace-owner seam
 * @param {string} [args.workspaceId] - route-resolved workspace id (never body)
 * @param {string} [args.accountId] - session account id (never body)
 * @param {string} [args.target] - queue target; absent means `cli`
 * @returns {Promise<{code: string, status: number, category: string, retryable: boolean, error: string}|null>}
 */
export async function resolveRunnerOwnerRefusal({ ownerCheck, workspaceId, accountId, target } = {}) {
  if (!isRunnerTarget(target)) return null;
  return resolveOwnerMintRefusal({
    ownerCheck,
    workspaceId,
    accountId,
    ownerOnlyCode: 'RUNNER_OWNER_ONLY'
  });
}

/**
 * Throwing form: resolves normally when allowed, otherwise throws an Error
 * carrying `{code, status, category, retryable}`.
 */
export async function assertRunnerOwnerAllowed(args = {}) {
  const refusal = await resolveRunnerOwnerRefusal(args);
  if (!refusal) return;
  const err = new Error(refusal.error);
  err.code = refusal.code;
  err.status = refusal.status;
  err.category = refusal.category;
  err.retryable = refusal.retryable;
  err.runnerOwnerRefusal = true;
  throw err;
}

export function isRunnerOwnerRefusal(err) {
  return !!(err && err.runnerOwnerRefusal === true);
}

/**
 * Shared responder for a refusal from `resolveRunnerOwnerRefusal`: logs one
 * line and sends the `{error, code, category, retryable}` envelope. Callers
 * with a bespoke refusal shape (a 201 body, a 403-to-422 remap, structured
 * seat/tool refusals) do not use it. Never echoes anything but the refusal.
 *
 * @param {import('express').Response} res
 * @param {{code: string, status: number, category: string, retryable: boolean, error: string}} refusal
 */
export function sendRunnerRefusal(res, refusal) {
  console.warn(`Runner action refused: ${refusal.code} — LIN-3398`);
  return jsonError(res, refusal.status, refusal.error, {
    code: refusal.code,
    category: refusal.category,
    retryable: refusal.retryable
  });
}
