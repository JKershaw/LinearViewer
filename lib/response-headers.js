/**
 * Response headers every deployment should send (LIN-3692, for LIN-3643).
 *
 * Both are Express middleware factories and host-neutral: they work the same
 * behind Railway, another host, or none.
 *
 *   - `hstsHeader()`: `Strict-Transport-Security: max-age=31536000`, and
 *     nothing more. No `preload`, and no `includeSubDomains` (`os.harbour.cat`
 *     is a separate host). Sent only under `NODE_ENV=production` for a request
 *     the proxy says arrived over https: the redirect's own expression
 *     (`x-forwarded-proto`), not Express's derived secure flag. `NODE_ENV` is
 *     read per request so a test can flip it.
 *   - `defaultCacheControl()`: `Cache-Control: private, no-store` on any
 *     response whose route set none, so no shared cache can hold a
 *     Host-derived or per-visitor page. Done in a `writeHead` wrapper, because
 *     Node lets `writeHead` arguments override a preset header: it therefore
 *     checks only `res.getHeader('Cache-Control')` and never looks at its
 *     arguments, so a route that sets the header late (before the first
 *     write) or through `writeHead` itself still wins.
 *
 * Mount order lives in server.js (pinned by tests/unit/response-headers.test.js):
 * HSTS after the https redirect, the cache default after `express.static`.
 * Static files, `/health` and the redirect are therefore untouched.
 */

const HSTS_VALUE = 'max-age=31536000';
const DEFAULT_CACHE_CONTROL = 'private, no-store';

/**
 * @param {{ env?: Object }} [options]
 * @returns {import('express').RequestHandler}
 */
export function hstsHeader({ env = process.env } = {}) {
  return (req, res, next) => {
    if (env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', HSTS_VALUE);
    }
    next();
  };
}

/** @returns {import('express').RequestHandler} */
export function defaultCacheControl() {
  return (req, res, next) => {
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      // Restore first so a second writeHead call (which Node rejects itself)
      // is never wrapped twice.
      res.writeHead = writeHead;
      if (!res.headersSent && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', DEFAULT_CACHE_CONTROL);
      }
      return writeHead.apply(this, args);
    };
    next();
  };
}
