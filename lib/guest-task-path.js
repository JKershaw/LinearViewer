/**
 * Public-path predicates for the auth-middleware exemptions (LIN-3330, then
 * the Library predicate in LIN-3344): `isGuestTaskPath` for the `/t/:token`
 * guest task page and `isPublicLibraryPath` for the `/library/…` Library.
 *
 * The public guest task page lives under `/t/:token` (`routes/task-share.js`).
 * A request to that path carries no session, so it must skip the two auth
 * middlewares that would otherwise mint or refresh a login for a signed-out
 * visitor: PAT auto-login (`lib/pat-session.js`) and the global token-refresh
 * `app.use` in `server.js`. Both import THIS predicate, so the two exemptions
 * cannot drift (the reason `65068a26` had extracted `isTokenRefreshExempt`).
 *
 * TRAILING SLASH on purpose: the public share prefix is `/t/`, not every root
 * that happens to start with `t` — `/test/`, `/terms`, `/templates` and the
 * bare `/t` are NOT exempt. Exempting the whole `/t/` prefix (not only
 * well-formed tokens) keeps junk like `/t/x` from triggering PAT auto-login;
 * the route 404s it without touching the store.
 *
 * @param {string} path - `req.path`
 * @returns {boolean} true when the route must skip auth mint/refresh
 */
export function isGuestTaskPath(path) {
  return typeof path === 'string' && path.startsWith('/t/');
}

/**
 * Public Library path predicate (LIN-3344, Part A of LIN-3342).
 *
 * The Library (`routes/library.js`) is a public, session-less surface under
 * `/library/…`. Like `/t/`, a request to it must skip the two auth
 * middlewares — PAT auto-login (`lib/pat-session.js`) and the global
 * token-refresh `app.use` in `server.js` — or a signed-out reader would be
 * handed a session. Both import THIS predicate so the two exemptions cannot
 * drift (LIN-3330's pattern).
 *
 * CASE-INSENSITIVE on purpose: Express routes case-insensitively, so
 * `/Library/x` serves a Library page; a case-sensitive predicate would let
 * that page through while still minting a PAT session for it. Lowercasing
 * first keeps serving and exemption in step.
 *
 * `/sitemap.xml` and `/robots.txt` are exempted here although their routes ship
 * in Part B (LIN-3345): until then they 404 and the exemption is inert, and it
 * keeps Part B from touching the auth surface a second time.
 *
 * LOOKALIKES are NOT exempt: `/libraryfoo`, `/librarian`, `/api/library` and
 * `/library.md`-style prefixes all fall outside `/library` and `/library/…`.
 *
 * @param {string} path - `req.path`
 * @returns {boolean} true when the route must skip auth mint/refresh
 */
export function isPublicLibraryPath(path) {
  if (typeof path !== 'string') return false;
  const p = path.toLowerCase();
  return (
    p === '/library' ||
    p.startsWith('/library/') ||
    p === '/sitemap.xml' ||
    p === '/robots.txt'
  );
}

/**
 * The server token-refresh `app.use`'s skip predicate (LIN-3330 review, ledger 1).
 *
 * `server.js` previously inlined these literals at the `app.use`. Extracting
 * them lets a behaviour table cover the whole exemption — most importantly the
 * `isGuestTaskPath` clause — without a running server, which a source-text
 * guard alone cannot (defeating the guest clause still matched the regex).
 *
 * @param {string} path - `req.path`
 * @returns {boolean} true when the route must skip token refresh
 */
export function isTokenRefreshExempt(path) {
  return (
    (typeof path === 'string' && path.startsWith('/auth/')) ||
    path === '/logout' ||
    path === '/privacy' ||
    path === '/terms' ||
    path === '/styleguide' ||
    path === '/kpis' ||
    path === '/templates' ||
    isGuestTaskPath(path) ||
    isPublicLibraryPath(path)
  );
}
