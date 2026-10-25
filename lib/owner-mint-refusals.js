/**
 * Shared owner-mint refusal vocabulary (LIN-3137 J5, extracted from the
 * LIN-3131 S2b.2 runner-copy mint so the two owner-gated session mints do not
 * drift).
 *
 * Owner-gated session mints return the same four-code envelope (LIN-3383
 * adds a fifth, RUNNER_OWNER_ONLY, for the session-side runner
 * gate in lib/runner-owner-gate.js, which reuses the three fail-closed codes):
 *   - the owner-checked runner copy on `POST /workspace/:urlKey/api/proxy/tokens`
 *     (routes/proxy-tokens-admin.js);
 *   - the legacy dispatch-token mint on
 *     `POST /workspace/:urlKey/api/dispatch/tokens` (routes/dispatch.js).
 *
 * This module owns the vocabulary and the one outcome→code mapping: the
 * status/category/retryable for each code, the human `error` text
 * (parameterised by `subject`), and `resolveOwnerMintRefusal` below. Both routes
 * resolve through it (LIN-3673): the dispatch route directly, the runner route
 * via the proxy token store's grant-bootstrap mint, which throws its own
 * refusal error built from the returned record. The parity test still guards
 * the two routes' wire shapes end to end.
 *
 * Fail-closed: every outcome other than a positive owner verdict is a refusal,
 * and `resolveOwnerMintRefusal` never throws (unless a caller's own
 * `onOwnerCheckThrew` hook does) — an unexpected shape is mapped to
 * OWNER_CHECK_UNAVAILABLE rather than escaping the route's generic 500.
 */

import { readOwnerSeamStatus } from './workspace-owner.js';

/**
 * Per-code definition. `error` is a function of `subject` so the one
 * caller-specific sentence (GRANT_OWNER_ONLY) stays accurate per mint, while
 * every other field — and the other three sentences — are shared verbatim.
 */
const DEFINITIONS = Object.freeze({
  GRANT_OWNERLESS: Object.freeze({
    status: 503,
    category: 'auth',
    retryable: false,
    error: () => 'This session has no account owner'
  }),
  WORKSPACE_OWNER_UNSET: Object.freeze({
    status: 409,
    category: 'config',
    retryable: false,
    error: () => 'This workspace has no recorded owner'
  }),
  GRANT_OWNER_ONLY: Object.freeze({
    status: 403,
    category: 'auth',
    retryable: false,
    error: (subject) => `Only this workspace's owner can mint ${subject}`
  }),
  // LIN-3383 / LIN-3398: the not-owner verdict for a session-side action on a
  // runner target (enqueue, halt, delete, trim, dispatch-token revoke).
  // Deliberately not GRANT_OWNER_ONLY: that code's text says "mint" and the
  // grant-refusal catches / client copy read it as a credential refusal.
  RUNNER_OWNER_ONLY: Object.freeze({
    status: 403,
    category: 'auth',
    retryable: false,
    error: () => "Only this workspace's owner can act on its runner."
  }),
  // LIN-3833: the not-owner verdict for the read-only dispatch preview (the run control's routing
  // answer). Its own code, so the text names reading the routing, not minting a credential.
  PREVIEW_OWNER_ONLY: Object.freeze({
    status: 403,
    category: 'auth',
    retryable: false,
    error: () => "Only this workspace's owner can preview its dispatch routing."
  }),
  OWNER_CHECK_UNAVAILABLE: Object.freeze({
    status: 503,
    category: 'upstream',
    retryable: true,
    error: () => 'Owner verification is temporarily unavailable'
  })
});

/**
 * Look up one refusal by code. Returns `null` for an unknown code so a caller
 * can rethrow the original error (the runner route's convention) rather than
 * silently allowing through.
 *
 * @param {string} code - one of the owner refusal codes
 * @param {string} subject - the credential noun for GRANT_OWNER_ONLY (e.g.
 *   'a runner credential', 'a dispatch token')
 * @returns {{code: string, status: number, category: string, retryable: boolean, error: string}|null}
 */
export function ownerMintRefusal(code, subject) {
  const def = DEFINITIONS[code];
  if (!def) return null;
  return {
    code,
    status: def.status,
    category: def.category,
    retryable: def.retryable,
    error: def.error(subject)
  };
}

/**
 * Resolve a session owner check into a refusal, or `null` when the caller is the
 * owner. Never throws.
 *
 * Ordering matters: a missing `accountId` is refused as GRANT_OWNERLESS WITHOUT
 * consulting the seam, because the seam folds "no caller identity" into
 * `not-owner` — checking after the seam would mis-map it to GRANT_OWNER_ONLY.
 *
 * @param {Object} args
 * @param {Function|null} [args.ownerCheck] - `async ({workspaceId, accountId}) =>
 *   {status: 'owner'|'not-owner'|'no-owner'}`; null/non-function → unavailable
 * @param {string} [args.workspaceId] - the route-resolved workspace id (never body)
 * @param {string} [args.accountId] - the session account id (never body)
 * @param {string} [args.subject] - the credential noun for the GRANT_OWNER_ONLY text
 * @param {string} [args.ownerOnlyCode] - the code a `not-owner` verdict maps to
 *   (default GRANT_OWNER_ONLY, so the mint callers are unchanged). The
 *   fail-closed branches stay shared whatever this is.
 * @param {function(*): void} [args.onOwnerCheckThrew] - called with the thrown
 *   value when the seam call (or a status getter) threw, after the refusal is
 *   settled; default none. Only the grant mint passes it (its log line). It is
 *   not swallowed: a hook that throws rejects this function.
 * @returns {Promise<{code: string, status: number, category: string, retryable: boolean, error: string}|null>}
 */
export async function resolveOwnerMintRefusal({ ownerCheck, workspaceId, accountId, subject, ownerOnlyCode = 'GRANT_OWNER_ONLY', onOwnerCheckThrew } = {}) {
  let seam = null;
  try {
    if (!accountId) {
      return ownerMintRefusal('GRANT_OWNERLESS', subject);
    }

    if (typeof ownerCheck !== 'function') {
      return ownerMintRefusal('OWNER_CHECK_UNAVAILABLE', subject);
    }

    // LIN-3673: the seam call and the answer read are one total call. A throw
    // is 'unavailable' like any unrecognised answer; the carried error feeds the
    // caller's own hook (below), not this function's output.
    seam = await readOwnerSeamStatus(() => ownerCheck({ workspaceId, accountId }));
    const { status } = seam;

    if (status === 'owner') return null;
    if (status === 'not-owner') return ownerMintRefusal(ownerOnlyCode, subject);
    if (status === 'no-owner') return ownerMintRefusal('WORKSPACE_OWNER_UNSET', subject);
    return ownerMintRefusal('OWNER_CHECK_UNAVAILABLE', subject);
  } catch {
    return ownerMintRefusal('OWNER_CHECK_UNAVAILABLE', subject);
  } finally {
    // LIN-3673: the mint-only log line (LIN-3648/3655). It runs here, after the
    // try/catch above has settled, so a hook that throws (a thrown value whose
    // message cannot be formatted) escapes instead of being swallowed into
    // OWNER_CHECK_UNAVAILABLE: the mint's formatting escape is kept byte for
    // byte (an open question, not changed here).
    if (seam?.threw && typeof onOwnerCheckThrew === 'function') onOwnerCheckThrew(seam.error);
  }
}
