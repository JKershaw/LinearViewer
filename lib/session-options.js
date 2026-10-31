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

// LIN-619: the session secret. The default is public (it is in this file), so
// it signs cookies anyone can forge; it is only acceptable outside production.
// The other entries are the example values published in `.env.example` and
// `README.md`, which `cp .env.example .env` would copy into place, plus the
// repo's CI/Playwright test values and the `scripts/env-check.sh` hint.
export const DEFAULT_SESSION_SECRET = 'dev-secret-change-in-production';
const PUBLISHED_SESSION_SECRETS = new Set([
  DEFAULT_SESSION_SECRET,
  'change-this-to-a-random-string',
  'any-random-string-for-sessions',
  'generate-a-secure-random-string',
  'test-secret-for-ci',
  'test-secret-for-playwright',
  'your-secret-here'
]);

/**
 * Resolves the secret that signs session cookies (LIN-619).
 *
 * Under `NODE_ENV === 'production'` a secret that is unset, blank, or a
 * published placeholder throws, with a message naming SESSION_SECRET, so the
 * caller can refuse to boot. The comparison trims whitespace; the value
 * returned is the one given. Any other environment falls back to
 * DEFAULT_SESSION_SECRET when unset or empty (`usedDefault: true`), as before.
 *
 * @param {Object} [env=process.env] - only `NODE_ENV` and `SESSION_SECRET` are read
 * @returns {{ secret: string, usedDefault: boolean }}
 */
export function resolveSessionSecret(env = process.env) {
  const given = env.SESSION_SECRET;
  if (env.NODE_ENV === 'production') {
    if (!given?.trim() || PUBLISHED_SESSION_SECRETS.has(given.trim())) {
      throw new Error(
        'SESSION_SECRET is required when NODE_ENV=production: set it to a random value, not blank and not an example value from .env.example or README.md'
      );
    }
    return { secret: given, usedDefault: false };
  }
  if (!given) return { secret: DEFAULT_SESSION_SECRET, usedDefault: true };
  return { secret: given, usedDefault: false };
}

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
