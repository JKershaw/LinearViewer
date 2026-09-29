/**
 * The express-session options object (LIN-1892 S2-2, verdict 0def5b66 G1-a).
 *
 * One factory, used by `server.js` and by the unit tests that must run REAL
 * `express-session` with the server's own options (the email confirm's
 * login-CSRF and N2 tests). A copied literal in a test could drift from what
 * it claims to pin; the two properties those tests rest on are:
 *   - `saveUninitialized: false` — a refused request that stored nothing
 *     saves no session and sets no cookie;
 *   - `cookie.sameSite: 'lax'` — a cross-site POST arrives with no session
 *     cookie (Chrome's 2-minute Lax-POST allowance applies only to cookies
 *     with no SameSite attribute).
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_SECONDS * 1000;

/**
 * @param {Object} options
 * @param {import('express-session').Store} options.store
 * @param {string} options.secret
 * @param {Object} [options.env=process.env] - only `NODE_ENV` is read (secure cookies in production)
 * @returns {import('express-session').SessionOptions}
 */
export function createSessionOptions({ store, secret, env = process.env }) {
  // - resave: false - don't save session if unmodified
  // - saveUninitialized: false - don't create session until something is stored
  // - secure cookies only in production (requires HTTPS)
  // - sameSite: 'lax' - CSRF protection (prevents cookies on cross-origin POST)
  return {
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax'
    }
  };
}
