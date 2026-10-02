/**
 * Root-route token-refresh exemption (LIN-3243, extracted from server.js).
 *
 * The global middleware in server.js skips `ensureValidToken` for a small set
 * of auth-free roots. This predicate is extracted so its behaviour is
 * unit-testable without booting the server (a source-literal guard cannot tell
 * `startsWith('/s/')` from the over-broad `startsWith('/s')`, which would sweep
 * in `/swipe`, `/settings`, `/styleguide`, `/ship` and `/swim`).
 *
 * The `/s/` entry is TRAILING-SLASH on purpose: it is the public share route
 * prefix, not every root that happens to start with `s`.
 *
 * @param {string} path - `req.path`
 * @returns {boolean} true when the route must skip token refresh
 */
export function isTokenRefreshExempt(path) {
  return (
    path.startsWith('/auth/') ||
    path === '/logout' ||
    path === '/privacy' ||
    path === '/terms' ||
    path === '/styleguide' ||
    path === '/kpis' ||
    path === '/templates' ||
    path.startsWith('/s/')
  );
}
