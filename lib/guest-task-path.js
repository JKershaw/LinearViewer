/**
 * Public-path predicates for the auth-middleware exemptions. The one predicate
 * both middlewares use is `isAuthExemptPath` (LIN-3346); it is built from the
 * building blocks below, each of which is also exported:
 *   - `isGuestTaskPath` (LIN-3330) for the `/t/:token` guest task page;
 *   - `isPublicLibraryPath` (LIN-3344) for the `/library/…` Library, `/sitemap.xml`
 *     and `/robots.txt`.
 *
 * A public page lives at one of these paths and carries no session, so it must
 * skip the two auth middlewares that would otherwise mint or refresh a login
 * for a signed-out visitor: PAT auto-login (`lib/pat-session.js`) and the
 * global token-refresh `app.use` in `server.js`. Both call `isAuthExemptPath`,
 * so the two exemptions cannot drift again. The name is the reason: this
 * module was once a refresh-only list that PAT never called, and the two
 * lists diverged (LIN-3346).
 *
 * TRAILING SLASH on purpose: the public share prefix is `/t/`, not every root
 * that happens to start with `t` — `/test/`, `/terms` and the bare `/t` are NOT
 * guest paths. Exempting the whole `/t/` prefix (not only well-formed tokens)
 * keeps junk like `/t/x` from triggering PAT auto-login; the route 404s it
 * without touching the store.
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
 * `/sitemap.xml` and `/robots.txt` are exempted here; their routes are in
 * `routes/library.js` (Part B, LIN-3345). The exemption keeps Part B from
 * touching the auth surface a second time.
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
 * The ONE auth-exemption predicate (LIN-3346): the paths that must skip session
 * mint (PAT auto-login, `lib/pat-session.js`) and token refresh (the `app.use`
 * in `server.js`). Both call this; neither keeps a list of its own.
 *
 * Matching is Express's own: Express routes case-insensitively and ignores one
 * trailing slash, while `req.path` keeps both as typed. So the path is
 * lowercased and one trailing slash is stripped, and nothing else. No
 * percent-decoding and no `//` collapsing: Express 404s `/%74/x` and `//t/x`,
 * so they must stay non-exempt.
 *
 * The prefix exemptions (`/auth/`, `/runner-kit/`, `/t/`) are tested BEFORE the
 * slash is stripped, because their trailing slash is part of the prefix:
 * stripping first would turn `/t/` into `/t`, which is not a guest path.
 *
 * `/test/` is deliberately NOT here. It is a test harness that writes the
 * session itself, not a public page, and PAT keeps it as one named clause
 * beside this call. Putting it here would also change token refresh on `/test/`.
 *
 * The landing routes (`/`, `/swipe`, `/swim`, `/ship`) are NOT exempt: they
 * redirect a signed-in visitor into the workspace. Bearer APIs (`/api/proxy/*`,
 * `/api/dispatch/*`) are a different class and stay out.
 *
 * @param {string} path - `req.path`
 * @returns {boolean} true when the route must skip auth mint/refresh
 */
export function isAuthExemptPath(path) {
  if (typeof path !== 'string') return false;
  const p = path.toLowerCase();
  if (isGuestTaskPath(p) || p.startsWith('/auth/') || p.startsWith('/runner-kit/')) return true;
  const s = p.endsWith('/') ? p.slice(0, -1) : p;
  return (
    s === '/logout' ||
    s === '/privacy' ||
    s === '/terms' ||
    s === '/styleguide' ||
    s === '/kpis' ||
    s === '/templates' ||
    /^\/archive\/\d+$/.test(s) ||
    isPublicLibraryPath(s)
  );
}
