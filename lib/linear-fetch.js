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
 *     lib/proxy-fetch.js / LIN-399). Reads are idempotent, so they retry;
 *   - inside-out diagnostics that fire ONLY on a terminal connection drop
 *     (see defaultDiagnostics): a secret-free dump of the error shape, attempt
 *     count, elapsed time, and — crucially — what api.linear.app actually
 *     resolves to (IPv4 vs IPv6) plus the runtime's DNS result order, so the
 *     IPv6 / Happy-Eyeballs routing hypothesis can be confirmed or ruled out
 *     from production logs instead of guessed at.
 *
 * What counts as a "transient network error" is NOT re-derived here: we defer
 * to classifyUpstreamError() in lib/errors.js (the same classifier the error
 * page uses), so the retry trigger and the user-facing diagnosis can never
 * drift apart. A request that fails our own per-attempt timeout is also treated
 * as transient; a caller-initiated abort is propagated immediately, never
 * retried.
 */
import dns from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { classifyUpstreamError } from './errors.js';
import { isGraphQLMutation } from './proxy-fetch.js';

const DEFAULT_MAX_RETRIES = 2; // up to 3 attempts total
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_TIMEOUT_MS = 15_000;
const DNS_DIAG_TIMEOUT_MS = 2_000; // the diagnostic itself must never stall the error

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
 * Distil a thrown fetch error into a flat, secret-free shape. undici nests the
 * real cause (the outer message is often just "fetch failed"), so we surface
 * both layers' name/message/code. Never touches headers or body — no tokens.
 */
export function summarizeError(error, { timedOut = false } = {}) {
  return {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    causeCode: error?.cause?.code,
    causeMessage: error?.cause?.message,
    timedOut,
  };
}

/**
 * Resolve a host to its A/AAAA records, preserving the OS-returned order
 * (`verbatim`) so the log reflects what Happy Eyeballs would actually try
 * first. Guarded by its own short timeout: a broken resolver must not turn the
 * diagnostic into a second hang. Returns human-readable strings, never throws.
 */
async function resolveHostAddresses(host, { timeoutMs = DNS_DIAG_TIMEOUT_MS } = {}) {
  let timer;
  try {
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('dns lookup timed out')), timeoutMs);
    });
    const records = await Promise.race([
      dnsLookup(host, { all: true, verbatim: true }),
      guard,
    ]);
    return records.map(r => `${r.address} (IPv${r.family})`);
  } catch (e) {
    return [`lookup failed: ${e.message}`];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Inside-out diagnostics for a TERMINAL Linear connection drop — the moment a
 * request is about to become a LINEAR_UNREACHABLE page. Emits one structured,
 * secret-free log line: error shape, attempts, elapsed time, whether an egress
 * proxy is configured, the live DNS picture for the host, and the runtime's DNS
 * result order. Everything here is safe to surface (same discipline as
 * lib/errors.js): host + public facts only, never Authorization / body bytes.
 *
 * @param {Object} ctx
 * @param {string} ctx.url
 * @param {*} ctx.error
 * @param {boolean} ctx.timedOut
 * @param {boolean} ctx.mutation
 * @param {number} ctx.attempts
 * @param {number} ctx.elapsedMs
 * @param {Console} [ctx.logger]
 */
export async function defaultDiagnostics({ url, error, timedOut, mutation, attempts, elapsedMs, logger = console }) {
  let host;
  try { host = new URL(url).host; } catch { host = String(url); }

  const proxyConfigured = !!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    || process.env.https_proxy || process.env.http_proxy);
  const dns_ = await resolveHostAddresses(host);

  logger.error?.('[linear-fetch] Linear unreachable after retries — connection diagnostics', {
    host,
    error: summarizeError(error, { timedOut }),
    attempts,
    elapsedMs,
    mutation,
    proxyConfigured,
    dns: dns_,
    runtime: {
      node: process.version,
      // Names the IPv6 / Happy-Eyeballs suspect directly: 'ipv4first' vs
      // 'verbatim' decides whether undici dials AAAA records ahead of A.
      dnsResultOrder: dns.getDefaultResultOrder?.() ?? 'unknown',
    },
  });
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
  // Fallback for runtimes without AbortSignal.any: bridge both sources onto a
  // controller we own.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (callerSignal.aborted || timeoutSignal.aborted) controller.abort();
  callerSignal.addEventListener('abort', onAbort, { once: true });
  timeoutSignal.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

/**
 * Build a fetch-compatible function that adds per-attempt timeouts, bounded
 * retries, and terminal-failure diagnostics around a base fetch (defaults to
 * global fetch). Drop-in for graphql-request's `fetch` option.
 *
 * @param {Function} [baseFetch] - underlying fetch (default: global fetch)
 * @param {Object} [opts]
 * @param {number} [opts.maxRetries=2]    - retry attempts after the first try
 * @param {number} [opts.baseDelayMs=300] - exponential-backoff base delay
 * @param {number} [opts.timeoutMs=15000] - per-attempt request timeout
 * @param {Function} [opts.sleepFn=sleep] - injectable delay (for tests)
 * @param {Function} [opts.diagnostics]   - terminal-drop diagnostic (for tests)
 * @param {Console}  [opts.logger=console]- where retry warnings are emitted
 * @returns {Function} fetch(url, options)
 */
// Transport override hook (LIN-1880). Mirrors `setFetchImpl` in
// lib/openrouter.js and `setProxyFetchImpl` in lib/proxy-fetch.js — the same
// decoupling-via-module-hook shape LIN-1848 established, deliberately NOT a
// `globalThis.fetch` mock.
//
// Why a hook and not the existing `baseFetch` parameter, which already looks
// like a seam. `createLinearFetch` captures `baseFetch` at CONSTRUCTION, and
// `lib/providers/linear/index.js` builds its instance once at MODULE SCOPE
// (`const linearFetch = createLinearFetch()`). By the time a test could pass
// an argument, the transport is already bound. The parameter is a seam for
// whoever constructs the instance; this hook is the seam for everyone else.
//
// Why not a `globalThis.fetch` mock, which would also work here: the default
// parameter reads `globalThis.fetch` at construction too, so swapping the
// global after module load is not observed either. LIN-1848 hit the same wall
// and the ticket for this change (LIN-1880) names the global mock as the
// approach to avoid.
//
// Resolved PER CALL, inside the retry loop, so an override set after the
// provider's module-scope instance exists still takes effect — that is the
// whole point, and a construction-time resolution would silently not work.
let _linearFetchImplOverride = null;

/**
 * Register a function to use as the Linear transport for every call site,
 * overriding the base fetch each `createLinearFetch` instance captured. Pass
 * null to clear. Default null, so production behaviour is unchanged.
 * @param {Function|null} fn
 */
export function setLinearFetchImpl(fn) {
  _linearFetchImplOverride = typeof fn === 'function' ? fn : null;
}

/** The override currently registered, or null. Exported for assertions. */
export function getLinearFetchImpl() {
  return _linearFetchImplOverride;
}

export function createLinearFetch(baseFetch = globalThis.fetch, {
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sleepFn = sleep,
  diagnostics = defaultDiagnostics,
  logger = console,
} = {}) {
  return async function linearFetch(url, options = {}) {
    const mutation = isGraphQLMutation(options);
    const callerSignal = options.signal;
    const startedAt = Date.now();
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const signal = combineSignals(callerSignal, timeoutController.signal);

      try {
        // Resolved per attempt, not per construction — see setLinearFetchImpl.
        const transport = _linearFetchImplOverride || baseFetch;
        return await transport(url, { ...options, signal });
      } catch (error) {
        lastError = error;

        // Caller aborted (request cancelled / navigated away) — never retry,
        // and not this error, so no diagnostics.
        if (callerSignal?.aborted) throw error;

        const timedOut = timeoutController.signal.aborted;
        const transient = timedOut || isTransientNetworkError(error);

        if (attempt < maxRetries && transient && !mutation) {
          logger.warn?.(
            `[linear-fetch] transient Linear connection drop (attempt ${attempt + 1}/${maxRetries + 1}), retrying`,
            summarizeError(error, { timedOut })
          );
          await sleepFn(baseDelayMs * Math.pow(2, attempt));
          continue;
        }

        // Terminal connection drop — emit rich, inside-out diagnostics right
        // before this becomes a LINEAR_UNREACHABLE page. Only for THIS error:
        // a non-transient (auth/internal) failure logs nothing extra here.
        if (transient) {
          try {
            await diagnostics({
              url, error, timedOut, mutation,
              attempts: attempt + 1,
              elapsedMs: Date.now() - startedAt,
              logger,
            });
          } catch { /* diagnostics must never mask the original error */ }
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  };
}
