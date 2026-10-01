/**
 * require-grant.js — a pure middleware factory for grant-gated proxy mounts
 * (LIN-3129 S1 step 6 / LIN-3059 F1).
 *
 * It lives in `lib/`, not inside the `createProxyRoutes` closure, so it is
 * unit-testable without a mount and importable by any sub-router; the runner
 * (`take`) and enqueue (`dispatch`, LIN-3136) sub-routers take it as a dependency.
 *
 * It reads the grants `authenticateProxyToken` stamps on the request
 * (`req.proxyTokenGrants`), through the shared `hasGrant`, so the gate and the
 * store agree on one vocabulary. An absent, empty, missing or non-array grants
 * value fails closed. The refusal is `<NAME>_GRANT_REQUIRED`
 * (`TAKE_GRANT_REQUIRED`, `DISPATCH_GRANT_REQUIRED`) via the repo's `jsonError`,
 * shaped `{ category: 'auth', retryable: false }`.
 *
 * The refusal TEXT is per grant (LIN-3136 R3): `dispatch` gets guidance on how
 * to obtain an enqueue-capable token, so the mount keeps its literal
 * `requireGrant('dispatch')` call shape. A grant without an entry keeps the
 * generic sentence.
 */
import { jsonError } from './errors.js';
import { GRANTS, hasGrant } from './proxy-scopes.js';

/**
 * Per-grant refusal copy. It never names the workspace owner.
 */
export const GRANT_REFUSAL_COPY = Object.freeze({
  dispatch:
    'This token cannot enqueue work (no dispatch grant). Ask the workspace owner ' +
    'to copy the prompt again from the app (Autopilot, Flight Companion and ' +
    'Passage Planner copies carry the dispatch grant), or use the runner copy ' +
    'from Settings.'
});

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
  const message = GRANT_REFUSAL_COPY[name] || `This endpoint requires the "${name}" grant`;

  return function requireGrantMiddleware(req, res, next) {
    if (hasGrant(req.proxyTokenGrants, name)) {
      return next();
    }
    return jsonError(res, 403, message, {
      code,
      category: 'auth',
      retryable: false
    });
  };
}
