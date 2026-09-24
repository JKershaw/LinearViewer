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
 * A THIRD blind spot closed later (LIN-2992): a proxy-AWARE client
 * (`lib/openrouter.js`'s `customFetch`, `lib/proxy-fetch.js`'s
 * `createProxyFetch`) routes through `HTTPS_PROXY`/`HTTP_PROXY` via
 * `https-proxy-agent`, so the socket this guard sees connects to the proxy's
 * own host:port, not to the real destination. When the proxy listens on
 * loopback — as it does in Harbour cloud-agent containers — that connect read
 * as loopback and a live, billable call passed as clean. `defaultIsLoopback`
 * now also treats a connect matching the CURRENT `HTTPS_PROXY`/`HTTP_PROXY`/
 * `https_proxy`/`http_proxy` endpoint (env read at connect time, matched by
 * host and port) as an escape, whatever host the proxy happens to listen on.
 *
 * WHY `net.Socket.prototype.connect`, and not the module functions. An earlier
 * version wrapped `net.connect` / `net.createConnection` / `tls.connect` — the
 * module exports — and that is NODE-VERSION DEPENDENT. Node 20's
 * `_http_agent.js` does `Agent.prototype.createConnection = net.createConnection`
 * at module load, capturing the function reference, so patching the export
 * afterwards is invisible to every `http.request`. Node 25 resolves it at call
 * time and IS observed. The result was a guard that covered a class on the
 * author's machine and not in CI — which CI caught, on the very run that first
 * enforced this gate.
 *
 * The prototype method is the choke point all of them funnel through, verified
 * by probe: `http.request` (on both Node behaviours), undici's `fetch`, a real
 * `tls.connect`, and a bare `new net.Socket().connect()` — which the module-level
 * version could not see either, and which was documented as a known limit until
 * this closed it.
 *
 * LOOPBACK IS NOT RECORDED, and that is what makes this usable. The unit
 * suite's house pattern is `app.listen(0, '127.0.0.1')` plus a real `fetch`
 * against it (CLAUDE.md), so a guard counting every socket would report
 * hundreds of legitimate connections and carry no signal. What `connections`
 * holds is escapes.
 *
 * KNOWN LIMIT, stated rather than left to be discovered: a hostname is
 * classified by STRING, so a non-loopback name that RESOLVES to 127.0.0.1
 * counts as an escape. Unix sockets are loopback in both call shapes
 * (`{ path }` has no host; the bare-string form is recognised by its leading
 * `/` in `defaultIsLoopback`). `ALL_PROXY`/`NO_PROXY` are not read — no
 * `lib/` client or `https-proxy-agent` honours either, so there is nothing to
 * classify against.
 *
 * @param {Object} [opts]
 * @param {(host: string|null, port: number|null) => boolean} [opts.isLoopback] -
 *   override the loopback predicate (for testing this guard itself). A
 *   single-argument override keeps working unchanged — the `port` argument is
 *   simply ignored by a function that doesn't declare it.
 * @returns {{connections: Array<{host: string|null, port: number|null, kind: string}>, restore: () => void}}
 */
export function guardSockets({ isLoopback = defaultIsLoopback } = {}) {
  const connections = [];
  const originalConnect = net.Socket.prototype.connect;

  function destinationOf(args) {
    // `Socket.prototype.connect` is called BOTH ways. Node's own
    // `net.createConnection` runs `normalizeArgs` and passes the resulting
    // ARRAY — `[options, callback]` — as a single argument, while a caller
    // doing `socket.connect(port, host)` passes the raw overload. Unwrapping
    // the array is not a nicety: without it every host reads `undefined`, and
    // since a missing host counts as loopback the guard would report ZERO
    // escapes for everything. A gate that always passes is worse than no gate,
    // and this is how close that came to shipping.
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (first && typeof first === 'object') {
      return { host: first.host || first.hostname || null, port: first.port ?? null };
    }
    if (typeof first === 'number') {
      return { host: typeof args[1] === 'string' ? args[1] : null, port: first };
    }
    if (typeof first === 'string') {
      // A unix-socket path; there is no port in this shape.
      return { host: first, port: null };
    }
    return { host: null, port: null };
  }

  net.Socket.prototype.connect = function guardedSocketConnect(...args) {
    const { host, port } = destinationOf(args);
    if (!isLoopback(host, port)) connections.push({ host, port, kind: 'net.Socket.connect' });
    return originalConnect.apply(this, args);
  };

  let restored = false;
  return {
    connections,
    restore() {
      if (restored) return;
      restored = true;
      net.Socket.prototype.connect = originalConnect;
    },
  };
}

/**
 * Parse one `HTTPS_PROXY`-shaped value into its `{ host, port }` endpoint, or
 * `null` if it doesn't name one. Accepts a full URL (`http://host:port`) or a
 * bare `host:port` — `https-proxy-agent` and the `lib/` clients that build one
 * both accept either shape, so the guard must too. IPv6 brackets are
 * stripped so the parsed host matches what `net.Socket.prototype.connect`
 * actually receives as `host`/`hostname` (unbracketed).
 *
 * @param {string} spec
 * @returns {{host: string, port: number}|null}
 */
function parseProxyEndpoint(spec) {
  const raw = (spec || '').trim();
  if (!raw) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) return null;
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  return { host, port };
}

/**
 * The set of proxy endpoints ("host:port" strings) the process is currently
 * configured to route through, read at CALL TIME rather than cached — tests
 * mutate `HTTPS_PROXY`/etc. in-process (`next-run`, `openrouter`,
 * `proxy-attachment-relay`, `recommend-*`), and a cached read would go stale
 * the moment the first such test ran after this module loaded.
 *
 * EXPORTED for the same reason `defaultIsLoopback` is: so a caller that wants
 * the raw set (rather than the loopback predicate) doesn't have to
 * reimplement the four-spelling union.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Set<string>} entries shaped `"host:port"`
 */
export function proxyEndpoints(env = process.env) {
  const specs = [env.HTTPS_PROXY, env.HTTP_PROXY, env.https_proxy, env.http_proxy];
  const endpoints = new Set();
  for (const spec of specs) {
    const endpoint = parseProxyEndpoint(spec);
    if (endpoint) endpoints.add(`${endpoint.host}:${endpoint.port}`);
  }
  return endpoints;
}

/**
 * Hosts that are not an escape: the suite's own in-process servers.
 *
 * EXPORTED because `scripts/assert-unit-suite-hermetic.mjs` generates a
 * standalone watcher that must classify identically. It had its own copy, the
 * two drifted the moment this one learned about unix sockets, and the script
 * then flagged a legitimate test as an escape. Two instruments disagreeing
 * about what they measure is the defect class this whole ticket is about, so
 * they now share one function rather than a convention.
 *
 * `port` is optional so existing single-argument callers/overrides are
 * unaffected; it is only consulted for the proxy-endpoint check below, which
 * needs it to tell a proxy connect apart from an ordinary loopback server on
 * a different port (LIN-2992). `env` defaults to `process.env` for both real
 * call sites; it is a parameter (not a hardcoded `proxyEndpoints()` call) so
 * this file's own tests can exercise the proxy-matching branch against a
 * fabricated env object — proving the parsing/matching logic without
 * mutating real `process.env`, which the generated whole-suite watcher reads
 * too and would otherwise flag the test's own local server as a genuine
 * escape when run under `test:hermetic`.
 */
export function defaultIsLoopback(host, port, env = process.env) {
  if (!host) return true;
  // A unix-socket path, passed as a bare string to net.connect('/tmp/x.sock').
  // It never leaves the machine, so it is not an escape — and the `{ path }`
  // form already lands in the `!host` branch above, so both shapes agree.
  if (host.startsWith('/')) return true;
  // A connect to the CURRENT proxy endpoint is never loopback, even though its
  // host is typically 127.0.0.1: it is the socket a proxy-aware client
  // (lib/openrouter.js, lib/proxy-fetch.js) opens on the way to a real,
  // possibly billable, remote destination. Checked BEFORE the loopback-literal
  // return below, or a proxy listening on 127.0.0.1 would never reach this
  // branch. Matched by host AND port so an ordinary in-process test server on
  // a different port is unaffected.
  if (proxyEndpoints(env).has(`${host}:${port}`)) return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}
