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
import net from 'net';
import tls from 'tls';

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

// ---------------------------------------------------------------------------
// Socket-level guard (LIN-1880)
// ---------------------------------------------------------------------------

/**
 * Guard at the TRANSPORT layer instead of the request layer.
 *
 * `guardNetwork` above patches `http(s).request`, which is blind to native
 * `fetch`: undici opens its own socket and never touches those exports. That
 * blindness was not theoretical — the unit suite was opening 8 live TLS
 * connections to `api.linear.app:443` on every run (measured at `44ffe713`),
 * and `guardNetwork` reported zero the whole time. So did an external counting
 * proxy, for a different reason: Node's `fetch` ignores `HTTPS_PROXY` unless
 * given a dispatcher, so proxy-based counting cannot see it either. Two
 * instruments, one blind spot each, the same escape invisible to both.
 *
 * This one wraps `net.connect` / `net.createConnection` / `tls.connect`, which
 * every transport in the process must go through — including undici. It
 * therefore covers BOTH classes at once, which is what LIN-1880 asked for.
 *
 * LOOPBACK IS NOT RECORDED, and that is the whole reason this is usable. The
 * unit suite's own house pattern is `app.listen(0, '127.0.0.1')` plus a real
 * `fetch` against it (CLAUDE.md), so a guard that counted every socket would
 * report hundreds of legitimate connections and be useless as a signal. What
 * `connections` holds is escapes.
 *
 * KNOWN LIMIT, stated rather than left to be discovered: a hostname is
 * classified by string, so a non-loopback name that RESOLVES to 127.0.0.1
 * counts as an escape, and a unix-socket connection (no host) counts as
 * loopback. Neither shape appears in this suite.
 *
 * @param {Object} [opts]
 * @param {(host: string|null) => boolean} [opts.isLoopback] - override the
 *   loopback predicate (for testing this guard itself).
 * @returns {{connections: Array<{host: string|null, port: number|null, kind: string}>, restore: () => void}}
 */
export function guardSockets({ isLoopback = defaultIsLoopback } = {}) {
  const connections = [];
  const originals = {
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    tlsConnect: tls.connect,
  };

  function destinationOf(args) {
    const first = args[0];
    if (first && typeof first === 'object') {
      return { host: first.host || first.hostname || null, port: first.port ?? null };
    }
    if (typeof first === 'number') {
      return { host: typeof args[1] === 'string' ? args[1] : null, port: first };
    }
    if (typeof first === 'string') {
      // A path (unix socket) or a host string; either way there is no port here.
      return { host: first, port: null };
    }
    return { host: null, port: null };
  }

  function record(kind, args) {
    const { host, port } = destinationOf(args);
    if (!isLoopback(host)) connections.push({ host, port, kind });
  }

  net.connect = function guardedNetConnect(...args) {
    record('net.connect', args);
    return originals.netConnect.apply(net, args);
  };
  net.createConnection = function guardedNetCreateConnection(...args) {
    record('net.createConnection', args);
    return originals.netCreateConnection.apply(net, args);
  };
  tls.connect = function guardedTlsConnect(...args) {
    record('tls.connect', args);
    return originals.tlsConnect.apply(tls, args);
  };

  let restored = false;
  return {
    connections,
    restore() {
      if (restored) return;
      restored = true;
      net.connect = originals.netConnect;
      net.createConnection = originals.netCreateConnection;
      tls.connect = originals.tlsConnect;
    },
  };
}

/** Hosts that are not an escape: the suite's own in-process servers. */
function defaultIsLoopback(host) {
  if (!host) return true;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}
