/**
 * Guest task-path predicate (LIN-3330, Subtask C of LIN-3324).
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
