/**
 * ownerless-token-policy.js — the single switch governing whether Harbour still
 * tolerates OWNERLESS tokens (`createdBy: null`), extracted so the two seams that
 * must agree about it (routes/dispatch.js's broker-token mint and
 * lib/proxy-preamble.js's bootstrap provisioning) read the same policy instead of
 * importing each other. LIN-1448.
 *
 * ## What an ownerless token is, and why it cannot work
 *
 * LIN-1366 scopes workspace-token selection to the calling token's owner and fails
 * closed when there is none: `selectOwnerWorkspaceToken`'s `scoped && !ownerAccountId`
 * guard can never match a real accountId, so a token minted with `createdBy: null`
 * is dead on arrival at every workspace-scoped verb — while still returning 200 on
 * the handful of verbs that never resolve a workspace (`/instructions`,
 * `/agent/status`, `/dispatch`). It is a credential that looks alive and is not.
 *
 * ## Why it is a switch and not a deletion
 *
 * LIN-1447 added a compat lane so `POST /api/dispatch/broker-token` mints for an
 * ownerless caller rather than 503ing, because the host runner authenticates with
 * exactly such a pre-LIN-1397 consumer token. LIN-1448 is its cleanup, whose stated
 * exit condition — "remove once no ownerless tokens remain in use / after the lane
 * has been cold for a safe window" — turned out to be unsatisfiable: that lane is
 * the ONLY minter of the `refire-broker` label, so it never goes cold on its own.
 * It is also the confirmed root cause of a ~100-minute halt of four autopilot trees
 * on 2026-07-25 (LIN-1576), because ownerlessness is INHERITED: the exchanged
 * working token copies it, and so does anything the resulting worker itself mints.
 *
 * So the fix is ordered, and only its first step is Harbour's to take:
 *
 *   1. Re-issue the runner's own dispatch token as OWNED — an on-host operator
 *      action (create a token while signed in, which stamps `req.session.accountId`,
 *      then point the runner at it). `GET /workspace/:urlKey/api/dispatch/tokens`
 *      reports `hasOwner` so "are any ownerless tokens still live?" is answerable
 *      before, and after, the swap.
 *   2. Set `DISPATCH_OWNERLESS_BROKER_COMPAT=off`, which is what this module reads.
 *
 * Doing 2 before 1 would 503 the runner's own mints. So the default is compat-ON:
 * a deploy of this code alone changes no minting behaviour, and the operator opts
 * into strictness once the rotation is done.
 *
 * ## Fails safe, deliberately asymmetric
 *
 * Only an explicit, recognised off-value turns strictness on. Unset, empty, or a
 * typo all leave the compat lane running — accidental strictness costs the runner
 * its mint path (LIN-1447's original outage), while accidental leniency is the
 * status quo this ticket is already managing. Never invert this default without
 * completing step 1 first.
 *
 * Read per call, never captured at module load, so the flag is flippable by
 * restarting with a new env value and testable without module-cache games.
 */

const OFF_VALUES = new Set(['off', 'false', '0', 'no']);

/**
 * Is the LIN-1447 ownerless compat lane still active?
 *
 * @returns {boolean} true (the default) while ownerless tokens are tolerated —
 *   minted where LIN-1447 minted them, and merely warned about elsewhere; false
 *   once `DISPATCH_OWNERLESS_BROKER_COMPAT` is explicitly off, which restores
 *   strict owner-required minting at every seam.
 */
export function ownerlessCompatEnabled() {
  const raw = String(process.env.DISPATCH_OWNERLESS_BROKER_COMPAT ?? '').trim().toLowerCase();
  return !OFF_VALUES.has(raw);
}
