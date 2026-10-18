/**
 * App-wide security headers (LIN-3420).
 *
 * Every HTML response gets a hash-based CSP, `X-Frame-Options: DENY` and
 * `nosniff`. The policy is enforced (not report-only) and `script-src` carries
 * no nonce and no `'unsafe-inline'`: each inline script the renderers emit is
 * pinned by the hash of its body, so a script injected into a page cannot run.
 * A new inline script must be hashed here, never exempted.
 *
 * Routes that set their own `Content-Security-Policy` (the Library, the email
 * confirm pages) keep it untouched; it is replaced, not merged.
 *
 * Known gaps, kept as today's behaviour: `img-src` allows `https:` (ticket
 * images come from any host) and there is no `form-action` (browsers apply it
 * to redirects, and OAuth POSTs redirect off-site).
 */

import { themePrepaintScriptHash, dataLoaderScriptHash, scriptBodyHash } from './components/page.js';
import { REPO_PICKER_FILTER_SCRIPT_BODY } from './render-pages.js';
import { MODEL_PRICING_SCRIPT_BODY } from './render-settings.js';

/** The hashes of every inline script body the app renders. */
export const INLINE_SCRIPT_HASHES = [
  themePrepaintScriptHash(),
  dataLoaderScriptHash(),
  scriptBodyHash(REPO_PICKER_FILTER_SCRIPT_BODY),
  scriptBodyHash(MODEL_PRICING_SCRIPT_BODY),
];

export const APP_CSP = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_SCRIPT_HASHES.map(h => `'${h}'`).join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Express middleware. Wraps `res.writeHead` so the decision sees the final
 * Content-Type and any CSP the route set: JSON, static and SSE responses stay
 * untouched.
 */
export function securityHeaders() {
  return (req, res, next) => {
    const writeHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      if (!res.headersSent && /^text\/html\b/i.test(String(res.getHeader('Content-Type') || ''))) {
        if (!res.getHeader('X-Content-Type-Options')) res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!res.getHeader('Content-Security-Policy')) {
          res.setHeader('Content-Security-Policy', APP_CSP);
          res.setHeader('X-Frame-Options', 'DENY');
        }
      }
      return writeHead.apply(this, args);
    };
    next();
  };
}
