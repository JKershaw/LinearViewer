/**
 * Outbound-request counter for hermetic-suite tests (LIN-1848).
 *
 * Patches the `http.request`/`https.request` MODULE EXPORTS — i.e. only
 * direct calls to `http.request(...)`/`https.request(...)`. This is narrower
 * than it may look:
 *   - `http.get`/`https.get` are NOT observed — Node's `.get` calls the
 *     module-internal `request` function, not the exported one this patches.
 *   - Native `fetch` is NOT observed — it goes through undici and never
 *     touches `http(s).request` at all.
 * It DOES cover this ticket's escape class: both hand-rolled proxy
 * transports (`lib/openrouter.js`'s `customFetch`, `lib/proxy-fetch.js`'s
 * `singleFetch`) call `https.request` directly. A future call site that
 * bypasses the injectable seam with a bare `fetch` or `.get` call would NOT
 * be caught by this guard alone.
 *
 * This is the acceptance witness the investigation calls for: a green test
 * can still leak a live request (see next-run.test.js's "an LLM failure still
 * yields the size-guaranteed set with no grouping"), so pass/fail alone is
 * not sufficient — callers must additionally assert zero attempts. But the
 * inverse also holds: zero attempts here does not by itself prove no request
 * left the process by any means, only that none went via `http(s).request`.
 */
import http from 'http';
import https from 'https';

/**
 * Start guarding. Returns `{ attempts, restore() }`. `attempts` is a live
 * array — read its `.length` (or contents) any time before calling
 * `restore()`; each entry is `{ hostname, path }` naming the destination the
 * attempt targeted, for per-escape source attribution.
 *
 * @returns {{attempts: Array<{hostname:string, path:string}>, restore: () => void}}
 */
export function guardNetwork() {
  const attempts = [];
  const originals = {
    httpRequest: http.request,
    httpsRequest: https.request,
  };

  function record(originalFn, module, args) {
    const options = typeof args[0] === 'string' || args[0] instanceof URL
      ? new URL(String(args[0]))
      : (args[0] || {});
    attempts.push({
      hostname: options.hostname || options.host || null,
      path: options.pathname || options.path || null,
    });
    return originalFn.apply(module, args);
  }

  http.request = function guardedHttpRequest(...args) {
    return record(originals.httpRequest, http, args);
  };
  https.request = function guardedHttpsRequest(...args) {
    return record(originals.httpsRequest, https, args);
  };

  let restored = false;
  function restore() {
    if (restored) return;
    restored = true;
    http.request = originals.httpRequest;
    https.request = originals.httpsRequest;
  }

  return { attempts, restore };
}
