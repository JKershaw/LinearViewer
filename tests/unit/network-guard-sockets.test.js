/**
 * LIN-1880 — the socket-level guard, and the proof it sees what the
 * request-level one cannot.
 *
 * The unit suite opened 8 live TLS connections to `api.linear.app:443` on every
 * run while `guardNetwork` reported zero, because it patches `http(s).request`
 * and native `fetch` goes through undici without touching those exports. An
 * external counting proxy was equally blind, for its own reason: Node's `fetch`
 * ignores `HTTPS_PROXY` unless handed a dispatcher. Two instruments, one blind
 * spot each, the same escape invisible to both.
 *
 * So the first thing this file does is DEMONSTRATE the blindness rather than
 * assert it from the docs, and only then show the new guard catching the same
 * call. A guard adopted on the strength of a comment is how the previous one
 * came to be trusted for a class it could not see.
 *
 * Everything here talks to a local server, so the suite stays hermetic while
 * testing the very thing that measures hermeticity.
 *
 * Run with: node --test tests/unit/network-guard-sockets.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { guardNetwork, guardSockets, defaultIsLoopback, proxyEndpoints } from '../fixtures/network-guard.js';

/**
 * Save the current value (or absence) of `process.env[key]`, set `value`, and
 * return a restorer. Uses `hasOwnProperty` rather than `=== undefined` so a
 * key that was never set is deleted again rather than left as `'undefined'` —
 * the same pattern `lin-2353-feedback-triage-provider-ui.test.js` uses for its
 * own env pin, so a failure partway through a test can't leak a proxy var into
 * a sibling test.
 */
function withEnvVar(key, value) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  process.env[key] = value;
  return () => {
    if (had) process.env[key] = prev;
    else delete process.env[key];
  };
}

/**
 * Run `fn(origin)` against a server that exists only for this call.
 *
 * CONNECTION POOLING is why this exists, and it cost two debugging rounds.
 * Both transports reuse sockets — Node's default HTTP agent keep-alives them,
 * and undici does its own pooling — so once any test in this file has talked to
 * the shared server, a later test's request REUSES that socket and performs no
 * `net.createConnection` at all. A guard watching that second request correctly
 * records nothing, and a test asserting "it records something" fails for a
 * reason that has nothing to do with the guard.
 *
 * That is exactly how this surfaced. The first version did not await the
 * request, so it sometimes caught the very first connect and sometimes did not:
 * green locally, red in CI. Awaiting made it consistently red, which is what
 * exposed the pooling underneath the race. A fresh server per assertion means a
 * fresh port, so a new connection is unavoidable.
 *
 * The mirror-image hazard matters more: a "records NOTHING" assertion under a
 * reused socket passes VACUOUSLY every time. That is a vacuous pass hiding
 * inside the file whose whole subject is vacuous passes, so those tests get a
 * fresh server too rather than only the ones that would fail loudly.
 */
async function withFreshServer(fn) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}`);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
}

/** Drive a real `http.request` to completion, on its own connection. */
function httpRequestOnce(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { agent: false }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.end();
  });
}

let server;
let origin;

before(async () => {
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('LIN-1880: guardNetwork is blind to native fetch — demonstrated, not assumed', () => {
  test('a fetch() that really happens is reported as zero attempts by the request-level guard', async () => {
    await withFreshServer(async (url) => {
      const guard = guardNetwork();
      try {
        const res = await fetch(url);
        // Precondition: the request genuinely happened. Without this the zero
        // below would be the trivially correct answer to "no request was made".
        assert.equal(res.status, 200, 'the fetch must actually reach the local server');
      } finally {
        guard.restore();
      }
      assert.deepEqual(
        guard.attempts, [],
        'guardNetwork sees nothing here — this is the blind spot LIN-1880 exists for, not a bug in this test'
      );
    });
  });

  test('guardNetwork DOES still see a direct http.request — so it is not simply broken', async () => {
    // The other half. If the assertion above passed because the guard were
    // inert, this would fail too, and the demonstration would prove nothing.
    await withFreshServer(async (url) => {
      const guard = guardNetwork();
      try {
        await httpRequestOnce(url);
      } finally {
        guard.restore();
      }
      assert.equal(guard.attempts.length, 1, 'the request-level guard still observes its own class');
    });
  });
});

describe('LIN-1880: guardSockets sees the transport layer', () => {
  test('records a non-loopback connection attempt', async () => {
    // Forced through the loopback predicate rather than by contacting a real
    // remote host: this suite must stay hermetic even while proving it can
    // detect a leak. `isLoopback: () => false` makes the local connection
    // classify exactly as a remote one would.
    await withFreshServer(async (url) => {
      const guard = guardSockets({ isLoopback: () => false });
      try {
        await fetch(url);
      } finally {
        guard.restore();
      }
      assert.ok(
        guard.connections.length > 0,
        'a native fetch must be visible at the socket layer — the whole point of this guard'
      );
      assert.equal(guard.connections[0].host, '127.0.0.1');
      assert.equal(guard.connections[0].kind, 'net.Socket.connect');
    });
  });

  test('does NOT record loopback by default, or the guard would be unusable here', async () => {
    // The suite's house pattern is `app.listen(0, '127.0.0.1')` + a real fetch
    // against it. A guard that counted those would report hundreds of
    // legitimate connections and carry no signal at all.
    //
    // AWAITED deliberately. A non-awaited request restores the guard before the
    // socket is attempted, so this "records nothing" assertion would pass
    // whether the guard worked or not — a vacuous pass hiding inside a test
    // whose whole subject is vacuous passes.
    await withFreshServer(async (url) => {
      const guard = guardSockets();
      try {
        await httpRequestOnce(url);
      } finally {
        guard.restore();
      }
      assert.deepEqual(guard.connections, [], '127.0.0.1 is not an escape');
    });
  });

  test('records a direct http.request too — the OTHER class it claims to cover', async () => {
    // The module's selling point is covering BOTH classes the earlier
    // instruments missed between them. The fetch test above proves the undici
    // half; without this the `http(s).request` half rests on the loopback test,
    // which would pass even if guardSockets were blind to it entirely. Review
    // named that gap.
    await withFreshServer(async (url) => {
      const guard = guardSockets({ isLoopback: () => false });
      try {
        await httpRequestOnce(url);
      } finally {
        guard.restore();
      }
      assert.ok(
        guard.connections.length > 0,
        'a direct http.request must also be visible at the socket layer'
      );
    });
  });

  test('a unix-socket path is loopback in BOTH call shapes', () => {
    // Review found the doc and the code claiming opposite things here, so both
    // shapes are pinned — and they reach different branches, which is why one
    // test was not enough.
    //
    // `net.connect('/path')` goes through normalizeArgs and arrives as
    // `[{ path }]`, which has no host and is loopback via the `!host` branch.
    // A DIRECT `new net.Socket().connect('/path')` arrives as a raw string and
    // is only loopback because of the leading-`/` check in defaultIsLoopback.
    // Verified: the first shape alone leaves that check dead code, so removing
    // it broke nothing and the test passed vacuously.
    const viaModule = guardSockets();
    try {
      const sock = net.connect('/tmp/lin-1880-nonexistent.sock');
      sock.on('error', () => {});
      sock.destroy();
    } finally {
      viaModule.restore();
    }
    assert.deepEqual(viaModule.connections, [], 'net.connect(path) — the {path} shape');

    const viaPrototype = guardSockets();
    try {
      const sock = new net.Socket();
      sock.on('error', () => {});
      sock.connect('/tmp/lin-1880-nonexistent.sock');
      sock.destroy();
    } finally {
      viaPrototype.restore();
    }
    assert.deepEqual(viaPrototype.connections, [], 'socket.connect(path) — the raw-string shape');
  });

  test('restore() puts the real transport back, and is idempotent', () => {
    // The guard patches ONE thing — `net.Socket.prototype.connect` — because
    // that is the choke point every transport funnels through. Patching the
    // module exports instead was Node-version dependent and is what made this
    // file green locally and red in CI; see the comment on guardSockets.
    const before = net.Socket.prototype.connect;

    const guard = guardSockets();
    assert.notEqual(net.Socket.prototype.connect, before, 'the guard actually patched the prototype');
    guard.restore();
    guard.restore(); // second call must be a no-op, not a re-restore of a patched fn
    assert.equal(net.Socket.prototype.connect, before, 'prototype restored');
  });
});

/**
 * Wire a fabricated env object into `defaultIsLoopback` via `guardSockets`'
 * override seam, rather than mutating real `process.env`. `guardSockets`'
 * `isLoopback` option only ever receives `(host, port)`, never `env` — so a
 * FAKE env is closed over here and threaded through as `defaultIsLoopback`'s
 * own third, testing-only parameter.
 *
 * This is deliberate, not incidental: the tests below make a REAL local
 * connect to prove the wiring end-to-end, and this suite runs under
 * `test:hermetic`'s own instance of this exact guard (installed at the whole
 * -process level via `--import`). If these tests set the REAL
 * `HTTPS_PROXY`/etc. to match that real connect, the whole-suite watcher
 * would — correctly, by the very design this ticket adds — also see it as an
 * escape, and this file would start failing `test:hermetic` despite testing
 * exactly the intended, contained behavior. Routing the fake config through
 * `env` instead keeps the proxy-endpoint match entirely local to the guard
 * instance under test.
 */
function guardWithFakeProxyEnv(fakeEnv) {
  return guardSockets({ isLoopback: (host, port) => defaultIsLoopback(host, port, fakeEnv) });
}

describe('LIN-2992: proxy-endpoint connects are escapes', () => {
  test('a connect to the configured HTTPS_PROXY host:port is recorded, even though the host is 127.0.0.1', async () => {
    // This is the bug: a proxy-aware client's socket connects to the PROXY,
    // not to the real destination, and the proxy commonly listens on
    // loopback. Pointing a fake HTTPS_PROXY at a real local server and
    // connecting to it directly reproduces exactly the socket shape a
    // proxy-aware client would open — same host, same port.
    await withFreshServer(async (url) => {
      const { port } = new URL(url);
      const guard = guardWithFakeProxyEnv({ HTTPS_PROXY: `http://127.0.0.1:${port}` });
      try {
        await fetch(url);
      } finally {
        guard.restore();
      }
      assert.ok(
        guard.connections.some((c) => c.host === '127.0.0.1' && String(c.port) === String(port)),
        'a connect to the configured proxy endpoint must be reported as an escape'
      );
    });
  });

  test('an ordinary loopback server on a DIFFERENT port stays clean with a proxy configured elsewhere', async () => {
    await withFreshServer(async (url) => {
      const { port } = new URL(url);
      // Point the fake proxy at a port that is NOT the test server's port.
      const otherPort = Number(port) === 65535 ? Number(port) - 1 : Number(port) + 1;
      const guard = guardWithFakeProxyEnv({ HTTPS_PROXY: `http://127.0.0.1:${otherPort}` });
      try {
        await httpRequestOnce(url);
      } finally {
        guard.restore();
      }
      assert.deepEqual(guard.connections, [], 'a loopback server on another port is not the configured proxy');
    });
  });

  test('all four proxy-variable spellings are each individually recognized', async () => {
    for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) {
      await withFreshServer(async (url) => {
        const { port } = new URL(url);
        const guard = guardWithFakeProxyEnv({ [key]: `http://127.0.0.1:${port}` });
        try {
          await fetch(url);
        } finally {
          guard.restore();
        }
        assert.ok(
          guard.connections.some((c) => c.host === '127.0.0.1' && String(c.port) === String(port)),
          `${key} must be recognized as a proxy endpoint`
        );
      });
    }
  });

  test('scheme default ports and bracketed IPv6 are parsed correctly', () => {
    assert.ok(
      proxyEndpoints({ HTTPS_PROXY: 'https://proxy.example' }).has('proxy.example:443'),
      'https:// with no explicit port defaults to 443'
    );
    assert.ok(
      proxyEndpoints({ HTTP_PROXY: 'http://proxy.example' }).has('proxy.example:80'),
      'http:// with no explicit port defaults to 80'
    );
    assert.ok(
      proxyEndpoints({ HTTPS_PROXY: 'http://[::1]:9999' }).has('::1:9999'),
      'IPv6 brackets are stripped so the host matches connect() args'
    );
    assert.ok(
      proxyEndpoints({ HTTPS_PROXY: '127.0.0.1:8080' }).has('127.0.0.1:8080'),
      'a bare host:port with no scheme is accepted'
    );
  });

  test('env is read at connect time, not at guard-construction time', async () => {
    await withFreshServer(async (url) => {
      const { port } = new URL(url);
      const fakeEnv = {}; // empty at guard-construction time
      const guard = guardWithFakeProxyEnv(fakeEnv);
      fakeEnv.HTTPS_PROXY = `http://127.0.0.1:${port}`; // set AFTER construction
      try {
        await fetch(url);
      } finally {
        guard.restore();
      }
      assert.ok(
        guard.connections.some((c) => c.host === '127.0.0.1' && String(c.port) === String(port)),
        'a proxy var set after the guard is constructed must still be honoured'
      );
    });
  });

  test('the real HTTPS_PROXY/HTTP_PROXY/https_proxy/http_proxy vars are read when env is not overridden', () => {
    // The tests above inject a fake env to keep this file hermetic-safe (see
    // guardWithFakeProxyEnv). This test proves defaultIsLoopback's DEFAULT
    // parameter really is process.env, using a tight save/restore window with
    // no socket connect in it — so nothing here is visible to the whole-suite
    // watcher, but the real-env code path is still pinned.
    const restore = withEnvVar('HTTPS_PROXY', 'http://127.0.0.1:0');
    try {
      assert.equal(defaultIsLoopback('127.0.0.1', 0), false, 'must consult real process.env by default');
    } finally {
      restore();
    }
    assert.equal(defaultIsLoopback('127.0.0.1', 0), true, 'restored env: back to an ordinary loopback address');
  });

  test('a custom single-argument isLoopback override still works unchanged', async () => {
    // The existing house pattern in this file (`isLoopback: () => false`) takes
    // no arguments at all. Passing (host, port) to it must not break — JS
    // simply ignores the extra argument.
    await withFreshServer(async (url) => {
      const guard = guardSockets({ isLoopback: () => false });
      try {
        await fetch(url);
      } finally {
        guard.restore();
      }
      assert.ok(guard.connections.length > 0, 'a zero-arg override must still receive and correctly classify the call');
    });
  });

  test('defaultIsLoopback still treats ordinary loopback literals as loopback when no proxy is configured', () => {
    // An explicit empty env, not the ambient process.env: this file itself
    // runs under `test:hermetic:proxy`, which sets real HTTPS_PROXY/HTTP_PROXY
    // to a dead port for the whole process, so process.env cannot be assumed
    // proxy-free here.
    const noProxyEnv = {};
    assert.equal(proxyEndpoints(noProxyEnv).size, 0, 'precondition: the fabricated env has no proxy vars');
    assert.equal(defaultIsLoopback('127.0.0.1', 12345, noProxyEnv), true);
    assert.equal(defaultIsLoopback('localhost', 80, noProxyEnv), true);
    assert.equal(defaultIsLoopback('::1', 443, noProxyEnv), true);
    assert.equal(defaultIsLoopback('example.com', 443, noProxyEnv), false);
  });
});

describe('LIN-1880: the Linear transport seam', () => {
  test('setLinearFetchImpl is honoured by an instance built BEFORE the override was set', async () => {
    // This is the property the fix turns on, and the reason a `globalThis.fetch`
    // mock does not work here. `lib/providers/linear/index.js` builds its
    // transport once at module scope; a test body always runs afterwards. If
    // the override were resolved at construction, it would silently do nothing
    // — which is indistinguishable from working, until you measure sockets.
    const { createLinearFetch, setLinearFetchImpl } = await import('../../lib/linear-fetch.js');

    const instance = createLinearFetch(); // built first, exactly as the provider does
    let reached = false;
    setLinearFetchImpl(async () => { reached = true; return new Response('{}', { status: 200 }); });
    try {
      await instance('https://api.linear.app/graphql', { method: 'POST' });
    } finally {
      setLinearFetchImpl(null);
    }
    assert.equal(reached, true, 'an override set after construction must still take effect');
  });

  test('clearing the override restores the captured base transport', async () => {
    const { createLinearFetch, setLinearFetchImpl, getLinearFetchImpl } = await import('../../lib/linear-fetch.js');
    let baseCalls = 0;
    const base = async () => { baseCalls += 1; return new Response('{}', { status: 200 }); };
    const instance = createLinearFetch(base);

    setLinearFetchImpl(async () => new Response('{}', { status: 200 }));
    await instance('https://api.linear.app/graphql', {});
    assert.equal(baseCalls, 0, 'the override wins while set');

    setLinearFetchImpl(null);
    assert.equal(getLinearFetchImpl(), null);
    await instance('https://api.linear.app/graphql', {});
    assert.equal(baseCalls, 1, 'clearing the override falls back to the constructed base');
  });
});
