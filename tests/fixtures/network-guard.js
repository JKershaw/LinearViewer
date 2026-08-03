/**
 * Outbound-request counter for hermetic-suite tests (LIN-1848).
 *
 * Patches `http.request`/`https.request` (and their `.get` shorthands, which
 * Node implements as thin wrappers calling `.end()` for you) at the module
 * level so ANY code path in the process — including a proxy-conditioned
 * transport substitute a test's `global.fetch` mock can't see — is observed.
 * This is the acceptance witness the investigation calls for: a green test
 * can still leak a live request (see next-run.test.js's "an LLM failure still
 * yields the size-guaranteed set with no grouping"), so pass/fail alone is
 * not sufficient — callers must additionally assert zero attempts.
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
