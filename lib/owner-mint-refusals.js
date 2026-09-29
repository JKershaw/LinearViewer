/**
 * Shared owner-mint refusal vocabulary (LIN-3137 J5, extracted from the
 * LIN-3131 S2b.2 runner-copy mint so the two owner-gated session mints do not
 * drift).
 *
 * Two owner-gated session mints return the same four-code envelope:
 *   - the owner-checked runner copy on `POST /workspace/:urlKey/api/proxy/tokens`
 *     (routes/proxy-tokens-admin.js);
 *   - the legacy dispatch-token mint on
 *     `POST /workspace/:urlKey/api/dispatch/tokens` (routes/dispatch.js).
 *
 * This module owns the vocabulary only: the status/category/retryable for each
 * code, and the human `error` text (parameterised by `subject`). It does NOT
 * own either route's outcome→code mapping: the runner route still derives its
 * codes from the proxy token store's throws, while the dispatch route resolves
 * its outcome through `resolveOwnerMintRefusal` below. The parity test keeps the
 * two routes' wire shapes identical.
 *
 * Fail-closed: every outcome other than a positive owner verdict is a refusal,
 * and `resolveOwnerMintRefusal` never throws — an unexpected shape is mapped to
 * OWNER_CHECK_UNAVAILABLE rather than escaping the route's generic 500.
 */

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
 * @param {string} code - one of the four owner refusal codes
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
 * @returns {Promise<{code: string, status: number, category: string, retryable: boolean, error: string}|null>}
 */
export async function resolveOwnerMintRefusal({ ownerCheck, workspaceId, accountId, subject } = {}) {
  try {
    if (!accountId) {
      return ownerMintRefusal('GRANT_OWNERLESS', subject);
    }

    if (typeof ownerCheck !== 'function') {
      return ownerMintRefusal('OWNER_CHECK_UNAVAILABLE', subject);
    }

    let status;
    try {
      status = (await ownerCheck({ workspaceId, accountId }))?.status;
    } catch {
      return ownerMintRefusal('OWNER_CHECK_UNAVAILABLE', subject);
    }

    if (status === 'owner') return null;
    if (status === 'not-owner') return ownerMintRefusal('GRANT_OWNER_ONLY', subject);
    if (status === 'no-owner') return ownerMintRefusal('WORKSPACE_OWNER_UNSET', subject);
    return ownerMintRefusal('OWNER_CHECK_UNAVAILABLE', subject);
  } catch {
    return ownerMintRefusal('OWNER_CHECK_UNAVAILABLE', subject);
  }
}
