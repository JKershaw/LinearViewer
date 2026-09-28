/**
 * require-grant.js — a pure middleware factory for grant-gated proxy mounts
 * (LIN-3129 S1 step 6 / LIN-3059 F1).
 *
 * It lives in `lib/`, not inside the `createProxyRoutes` closure, so it is
 * unit-testable without a mount and importable by any sub-router — LIN-2884's
 * future mounts pass it in as a dependency (S1 adds no mount).
 *
 * It reads the grants `authenticateProxyToken` stamps on the request
 * (`req.proxyTokenGrants`), through the shared `hasGrant`, so the gate and the
 * store agree on one vocabulary. An absent, empty, missing or non-array grants
 * value fails closed. The refusal is `<NAME>_GRANT_REQUIRED`
 * (`TAKE_GRANT_REQUIRED`, `DISPATCH_GRANT_REQUIRED`) via the repo's `jsonError`,
 * shaped `{ category: 'auth', retryable: false }`.
 */
import { jsonError } from './errors.js';
import { GRANTS, hasGrant } from './proxy-scopes.js';

/**
 * Build the middleware that requires a named grant.
 *
 * @param {string} name - one of GRANTS ('take' | 'dispatch')
 * @returns {import('express').RequestHandler}
 * @throws {Error} when `name` is not a known grant — a programming error caught
 *   at mount time rather than on every request
 */
export function requireGrant(name) {
  if (!GRANTS.includes(name)) {
    throw new Error(
      `requireGrant: unknown grant "${name}" (known grants: ${GRANTS.join(', ')})`
    );
  }

  const code = `${name.toUpperCase()}_GRANT_REQUIRED`;

  return function requireGrantMiddleware(req, res, next) {
    if (hasGrant(req.proxyTokenGrants, name)) {
      return next();
    }
    return jsonError(res, 403, `This endpoint requires the "${name}" grant`, {
      code,
      category: 'auth',
      retryable: false
    });
  };
}
