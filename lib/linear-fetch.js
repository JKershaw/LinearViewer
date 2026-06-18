/**
 * lib/linear-fetch.js — resilient fetch for the Linear GraphQL boundary.
 *
 * The dashboard read path talks to api.linear.app via graphql-request over
 * Node's global fetch (undici) with no retry and no timeout, so a single
 * dropped keep-alive socket ("Premature close" / ECONNRESET) surfaces as a
 * full LINEAR_UNREACHABLE error page. (The retry logic in lib/proxy-fetch.js
 * only runs when HTTP_PROXY/HTTPS_PROXY is set — the plain Heroku egress path
 * has none.) This wraps a base fetch with:
 *
 *   - a per-attempt request timeout, so a hung / half-open socket fails fast
 *     (well before Heroku's 30s H12) instead of stalling the whole page;
 *   - bounded exponential-backoff retries on transient network errors, so a
 *     fresh connection is established rather than the drop reaching the user;
 *   - mutation safety: a write is never replayed once its body has been sent
 *     (an ECONNRESET after the write may have committed upstream — mirrors
 *     lib/proxy-fetch.js / LIN-399). Reads are idempotent, so they retry.
 *
 * What counts as a "transient network error" is NOT re-derived here: we defer
 * to classifyUpstreamError() in lib/errors.js (the same classifier the error
 * page uses), so the retry trigger and the user-facing diagnosis can never
 * drift apart. A request that fails our own per-attempt timeout is also treated
 * as transient; a caller-initiated abort is propagated immediately, never
 * retried.
 */
import { classifyUpstreamError } from './errors.js';
import { isGraphQLMutation } from './proxy-fetch.js';

const DEFAULT_MAX_RETRIES = 2; // up to 3 attempts total
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_TIMEOUT_MS = 15_000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A thrown fetch error is transient (worth retrying) when the shared classifier
 * sees it as a dropped/closed connection. Network failures arrive WITHOUT an
 * HTTP status, so classifyUpstreamError routes them to LINEAR_UNREACHABLE; a
 * real auth/internal error does not, and is not retried.
 *
 * @param {*} error - the caught error
 * @returns {boolean}
 */
export function isTransientNetworkError(error) {
  return classifyUpstreamError(error).code === 'LINEAR_UNREACHABLE';
}

/**
 * Combine the caller's AbortSignal (if any) with our per-attempt timeout signal,
 * so either source can abort the in-flight request.
 */
function combineSignals(callerSignal, timeoutSignal) {
  if (!callerSignal) return timeoutSignal;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([callerSignal, timeoutSignal]);
  }
  // Fallback for runtimes without AbortSignal.any: bridge the caller's abort
  // onto a controller we also drive from the timeout signal.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (callerSignal.aborted || timeoutSignal.aborted) controller.abort();
  callerSignal.addEventListener('abort', onAbort, { once: true });
  timeoutSignal.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

/**
 * Build a fetch-compatible function that adds per-attempt timeouts and bounded
 * retries around a base fetch (defaults to global fetch). Drop-in for
 * graphql-request's `fetch` option.
 *
 * @param {Function} [baseFetch] - underlying fetch (default: global fetch)
 * @param {Object} [opts]
 * @param {number} [opts.maxRetries=2]   - retry attempts after the first try
 * @param {number} [opts.baseDelayMs=300] - exponential-backoff base delay
 * @param {number} [opts.timeoutMs=15000] - per-attempt request timeout
 * @param {Function} [opts.sleepFn=sleep] - injectable delay (for tests)
 * @returns {Function} fetch(url, options)
 */
export function createLinearFetch(baseFetch = globalThis.fetch, {
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleepFn = sleep,
} = {}) {
  return async function linearFetch(url, options = {}) {
    const mutation = isGraphQLMutation(options);
    const callerSignal = options.signal;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const signal = combineSignals(callerSignal, timeoutController.signal);

      try {
        return await baseFetch(url, { ...options, signal });
      } catch (error) {
        lastError = error;

        // Caller aborted (request cancelled / navigated away) — never retry.
        if (callerSignal?.aborted) throw error;

        const timedOut = timeoutController.signal.aborted;
        const transient = timedOut || isTransientNetworkError(error);

        if (attempt < maxRetries && transient && !mutation) {
          await sleepFn(baseDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  };
}
