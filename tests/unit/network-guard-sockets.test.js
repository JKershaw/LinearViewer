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
import { guardNetwork, guardSockets } from '../fixtures/network-guard.js';

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
