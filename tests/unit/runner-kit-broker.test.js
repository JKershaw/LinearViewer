/**
 * LIN-3098 S1 — the runner kit's per-item credential broker
 * (`lib/runner-kit/broker.mjs`).
 *
 * A person's Claude Code session becomes their runner. Each item it runs goes
 * to a subagent, and the subagent reaches Harbour through this broker so it
 * never holds a token. What these tests pin, one group per S1 requirement:
 *
 *   - TRANSPORT: a mode-600 Unix socket inside a mode-700 directory, both
 *     checked with `fs.stat`. The directory is the portable control (BSD
 *     kernels don't reliably enforce a socket's own mode on connect); the
 *     socket mode is kept as well. macOS's 104-byte `sun_path` limit fails
 *     closed before anything is created.
 *   - REQUEST CHECKS: `Host: harbour-runner.invalid` only; `/api/proxy/*` only
 *     (never the mint endpoint); writes need `X-Harbour-Intent: write`.
 *   - CREDENTIAL: the bootstrap arrives on stdin and is exchanged by the broker
 *     itself; the working token appears in no argv, env, file or log output.
 *   - LIFETIME: a stale runner heartbeat (two consecutive normal ticks) closes
 *     the broker; a sleep gap restarts the grace window instead; the 48h cap
 *     closes it; SIGTERM closes it; `stopBroker` finds it by its token-free pid
 *     file and closes it.
 *
 * The upstream is a fake Harbour on 127.0.0.1 and every socket lives in a short
 * `mkdtemp` directory, so the file stays inside `test:hermetic` (Unix sockets
 * count as loopback: tests/fixtures/network-guard.js).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  mkdtempSync, rmSync, statSync, existsSync, readFileSync, readdirSync,
  mkdirSync, chmodSync, writeFileSync, utimesSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROKER_HOST,
  BROKER_STALE_MS,
  BROKER_CHECK_MS,
  BROKER_SLEEP_GAP_MS,
  BROKER_MAX_LIFETIME_MS,
  BROKER_MAX_BODY_BYTES,
  SUN_PATH_MAX_BYTES,
  kitPaths,
  credentialStore,
  brokerTransport,
  isProxiablePath,
  isHeartbeatStale,
  createLifetimeWatch,
  startBroker,
  stopBroker
} from '../../lib/runner-kit/broker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BROKER_BIN = join(ROOT, 'lib', 'runner-kit', 'broker.mjs');
const ITEM_ID = '0f3a9c2e-1b4d-4e8f-9a7b-2c6d8e0f1a3b';
const URL_KEY = 'acme';

// Short on purpose: the socket path must stay under the 104-byte sun_path
// limit, and `os.tmpdir()` can be long on its own (macOS's is ~50 bytes; a
// sandboxed TMPDIR can be longer), so prefer `/tmp` where it exists.
function shortTmp() {
  return mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'rk-'));
}

// F5: every socket test carries an explicit timeout, and every server and
// child the file opens is registered here and torn down in a file-level
// after(). A failed assertion that skips a test's own close() then fails the
// test instead of leaving a listener that keeps the file (and CI) alive.
const TIMEOUT = { timeout: 15_000 };
const live = { servers: new Set(), children: new Set() };
function track(server) {
  live.servers.add(server);
  return server;
}
after(() => {
  for (const server of live.servers) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close();
  }
  for (const child of live.children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

// Tokens are minted at runtime so no token-shaped literal sits in the repo for
// the secret scan to (rightly) flag.
function freshToken() {
  return randomBytes(32).toString('base64url');
}

/** A fake Harbour: a single-use bootstrap exchange plus an echo for everything else. */
async function fakeHarbour() {
  const bootstrap = freshToken();
  const working = freshToken();
  const seen = [];
  let exchanges = 0;
  const server = track(http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    if (req.url === '/api/proxy/token' && req.method === 'POST') {
      exchanges += 1;
      if (req.headers.authorization === `Bearer ${bootstrap}` && exchanges === 1) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: working, scope: 'readWrite', expiresAt: '2099-01-01T00:00:00.000Z' }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bootstrap spent' }));
      }
      return;
    }
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, method: req.method, url: req.url }));
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, bootstrap, working, seen,
    get exchanges() { return exchanges; },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

/** One HTTP request over the broker's Unix socket. */
function brokerRequest(socketPath, { method = 'GET', path, host = BROKER_HOST, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // An explicit Content-Length: Node sends a DELETE body neither chunked nor
    // length-framed otherwise, and the server reads it as a second request.
    const framing = body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {};
    const req = http.request({ socketPath, method, path, headers: { Host: host, ...framing, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Resolve true when nothing is listening on `socketPath` any more. */
function socketRefuses(socketPath) {
  return new Promise((resolve) => {
    const s = net.connect({ path: socketPath });
    s.on('connect', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(true));
  });
}

/** Every regular file under `dir`, recursively. */
function filesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Spawn the broker CLI with the bootstrap on stdin; resolve once it prints its ready line. */
function spawnBroker({ home, base, bootstrap, itemId = ITEM_ID, urlKey = URL_KEY }) {
  const child = spawn(process.execPath, [BROKER_BIN, 'serve', '--base', base, '--url-key', urlKey, '--item', itemId, '--home', home], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: home }
  });
  live.children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.stdin.end(`${bootstrap}\n`);
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`broker not ready: ${stderr}`)), 10_000);
    child.stdout.on('data', () => {
      const line = stdout.split('\n')[0];
      if (stdout.includes('\n')) {
        clearTimeout(timer);
        try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
      }
    });
    exited.then(({ code }) => { clearTimeout(timer); reject(new Error(`broker exited ${code} before ready: ${stderr}`)); });
  });
  return { child, ready, exited, output: () => stdout + stderr };
}

describe('constants', () => {
  test('the lifetime numbers are the plan\'s: 10 min stale, 48h cap, sleep gap well past one tick', () => {
    assert.equal(BROKER_HOST, 'harbour-runner.invalid');
    assert.equal(BROKER_STALE_MS, 10 * 60 * 1000);
    assert.equal(BROKER_MAX_LIFETIME_MS, 48 * 60 * 60 * 1000);
    assert.ok(BROKER_SLEEP_GAP_MS > BROKER_CHECK_MS, 'a sleep gap must be longer than a normal tick');
    assert.ok(BROKER_CHECK_MS * 2 < BROKER_STALE_MS, 'two checks fit inside the stale window');
    assert.equal(SUN_PATH_MAX_BYTES, 103, "macOS sun_path is 104 bytes including the NUL");
  });

  test('the default socket path is ~/.harbour-runner/s/<itemId8>.sock and well under the limit', () => {
    const p = kitPaths({ home: '/Users/someone/.harbour-runner', urlKey: URL_KEY, itemId: ITEM_ID });
    assert.equal(p.socket, '/Users/someone/.harbour-runner/s/0f3a9c2e.sock');
    assert.equal(p.socketDir, '/Users/someone/.harbour-runner/s');
    assert.equal(p.heartbeat, '/Users/someone/.harbour-runner/acme/runner.heartbeat');
    assert.equal(p.pidFile, `/Users/someone/.harbour-runner/acme/brokers/${ITEM_ID}.json`);
    assert.ok(Buffer.byteLength(p.socket) <= SUN_PATH_MAX_BYTES);
  });

  test('kitPaths refuses ids that could escape the kit directory', () => {
    assert.throws(() => kitPaths({ home: '/h', urlKey: '../etc', itemId: ITEM_ID }), /urlKey/);
    assert.throws(() => kitPaths({ home: '/h', urlKey: URL_KEY, itemId: '../../x' }), /itemId/);
    assert.throws(() => kitPaths({ home: '/h', urlKey: URL_KEY, itemId: 'short' }), /itemId/);
  });
});

describe('credentialStore: the one place the broker keeps its working token', () => {
  test('holds a token in memory and forgets it on clear', () => {
    const store = credentialStore();
    assert.equal(store.get(), null);
    const t = freshToken();
    store.set(t);
    assert.equal(store.get(), t);
    store.clear();
    assert.equal(store.get(), null);
  });

  test('the token does not surface through serialisation or inspection', () => {
    const store = credentialStore();
    const t = freshToken();
    store.set(t);
    assert.ok(!JSON.stringify(store).includes(t));
    assert.ok(!String(store).includes(t));
    assert.ok(!Object.values(store).some((v) => v === t));
  });
});

describe('brokerTransport: mode-600 socket inside a mode-700 directory', () => {
  test('dir is 700 and socket is 600, pinned with fs.stat', TIMEOUT, async () => {
    const tmp = shortTmp();
    try {
      const socketDir = join(tmp, 's');
      const socketPath = join(socketDir, 'abcd1234.sock');
      const server = track(http.createServer((req, res) => res.end('x')));
      const t = await brokerTransport({ server, socketDir, socketPath });
      const d = statSync(socketDir);
      const s = statSync(socketPath);
      assert.ok(d.isDirectory());
      assert.equal(d.mode & 0o777, 0o700, `dir mode ${(d.mode & 0o777).toString(8)}`);
      assert.ok(s.isSocket());
      assert.equal(s.mode & 0o777, 0o600, `socket mode ${(s.mode & 0o777).toString(8)}`);
      assert.equal(d.uid, process.getuid());
      await t.close();
      assert.equal(existsSync(socketPath), false, 'close removes the socket');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a pre-existing loose directory is tightened to 700 before the socket is bound', TIMEOUT, async () => {
    const tmp = shortTmp();
    try {
      const socketDir = join(tmp, 's');
      mkdirSync(socketDir, { mode: 0o755 });
      chmodSync(socketDir, 0o755);
      const server = track(http.createServer((req, res) => res.end('x')));
      const t = await brokerTransport({ server, socketDir, socketPath: join(socketDir, 'abcd1234.sock') });
      try {
        assert.equal(statSync(socketDir).mode & 0o777, 0o700);
      } finally {
        await t.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a path over the 104-byte sun_path limit fails closed and creates nothing', TIMEOUT, async () => {
    const tmp = shortTmp();
    try {
      const socketDir = join(tmp, 'x'.repeat(120));
      const socketPath = join(socketDir, 'abcd1234.sock');
      const server = http.createServer((req, res) => res.end('x'));
      await assert.rejects(brokerTransport({ server, socketDir, socketPath }), /sun_path|too long/i);
      assert.equal(existsSync(socketDir), false);
      assert.equal(server.listening, false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a live socket already at the path is refused (fail closed); a dead one is replaced', TIMEOUT, async () => {
    const tmp = shortTmp();
    try {
      const socketDir = join(tmp, 's');
      const socketPath = join(socketDir, 'abcd1234.sock');
      const first = await brokerTransport({ server: track(http.createServer((q, r) => r.end('1'))), socketDir, socketPath });
      await assert.rejects(
        brokerTransport({ server: track(http.createServer((q, r) => r.end('2'))), socketDir, socketPath }),
        /already listening|in use/i
      );
      await first.close();
      // A crashed broker (SIGKILL) leaves its socket file behind with nothing listening.
      const crashed = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(socketPath)}, () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'ignore'] });
      live.children.add(crashed);
      await new Promise((resolve) => crashed.stdout.once('data', resolve));
      crashed.kill('SIGKILL');
      await new Promise((resolve) => crashed.on('exit', resolve));
      assert.ok(existsSync(socketPath), 'the dead socket file is left behind');
      const second = await brokerTransport({ server: track(http.createServer((q, r) => r.end('2'))), socketDir, socketPath });
      const r = await brokerRequest(socketPath, { path: '/' });
      assert.equal(r.body, '2');
      await second.close();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('isProxiablePath', () => {
  const rows = [
    ['/api/proxy/dispatch/abc', true],
    ['/api/proxy/issues/LIN-1?x=1', true],
    ['/api/proxy/token', false],
    ['/api/proxy/token?x=1', false],
    // F1: Express 4 routes case-insensitively and non-strictly, so each of
    // these reaches POST /api/proxy/token on the real server.
    ['/api/proxy/token/', false],
    ['/api/proxy/token//', false],
    ['/api/proxy/Token', false],
    ['/api/proxy/TOKEN?x=1', false],
    ['/api/proxy/tOkEn/?x=1', false],
    ['/api/proxy//token', false],
    ['/api/proxy/tokens', true],
    ['/api/proxy/token/extra', true],
    ['/api/proxy/../admin', false],
    ['/api/proxy/%2e%2e/admin', false],
    ['/api/proxyx/foo', false],
    ['/api/dispatch/abc', false],
    ['/', false],
    ['http://evil.example/api/proxy/x', false],
    ['//evil.example/api/proxy/x', false],
    ['', false],
    [undefined, false]
  ];
  for (const [p, want] of rows) {
    test(`${JSON.stringify(p)} → ${want}`, () => {
      assert.equal(isProxiablePath(p), want);
    });
  }
});

describe('the broker over its socket (in-process)', () => {
  let tmp, harbour, broker, logLines;

  before(async () => {
    tmp = shortTmp();
    harbour = await fakeHarbour();
    logLines = [];
    broker = await startBroker({
      base: harbour.base,
      urlKey: URL_KEY,
      itemId: ITEM_ID,
      home: tmp,
      bootstrap: harbour.bootstrap,
      log: (line) => logLines.push(line),
      autoTick: false
    });
  }, TIMEOUT);

  after(async () => {
    await broker?.stop('test-done');
    await harbour?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('the broker exchanged the bootstrap exactly once, itself', () => {
    assert.equal(harbour.exchanges, 1);
  });

  test('a GET is forwarded with a bearer the client never sent', TIMEOUT, async () => {
    const before = harbour.seen.length;
    const r = await brokerRequest(broker.socketPath, { path: '/api/proxy/dispatch/abc?full=1' });
    assert.equal(r.status, 200);
    const got = harbour.seen[before];
    assert.equal(got.url, '/api/proxy/dispatch/abc?full=1');
    assert.equal(got.headers.authorization, `Bearer ${harbour.working}`);
    assert.ok(!r.body.includes(harbour.working));
  });

  test('a client-supplied Authorization is replaced, never forwarded', TIMEOUT, async () => {
    const before = harbour.seen.length;
    const r = await brokerRequest(broker.socketPath, { path: '/api/proxy/x', headers: { Authorization: 'Bearer attacker' } });
    assert.equal(r.status, 200);
    assert.equal(harbour.seen[before].headers.authorization, `Bearer ${harbour.working}`);
  });

  test('a wrong Host gets 403 and reaches nothing upstream', TIMEOUT, async () => {
    const before = harbour.seen.length;
    for (const host of ['localhost', '127.0.0.1', 'harbour-runner.invalid.evil', 'evil.example']) {
      const r = await brokerRequest(broker.socketPath, { path: '/api/proxy/x', host });
      assert.equal(r.status, 403, `host ${host}`);
    }
    assert.equal(harbour.seen.length, before);
  });

  test('a request with no Host at all gets 403 and reaches nothing upstream (F2)', TIMEOUT, async () => {
    const before = harbour.seen.length;
    // Node's http.request always adds a Host, so write the request by hand.
    const raw = await new Promise((resolve, reject) => {
      const s = net.connect({ path: broker.socketPath });
      let out = '';
      s.on('connect', () => s.write('GET /api/proxy/x HTTP/1.0\r\n\r\n'));
      s.on('data', (c) => { out += c; });
      s.on('end', () => resolve(out));
      s.on('error', reject);
    });
    assert.match(raw, /^HTTP\/1\.[01] 403 /);
    assert.equal(harbour.seen.length, before);
  });

  test('Host must match exactly: harbour-runner.invalid:80 is refused too (F2)', TIMEOUT, async () => {
    const before = harbour.seen.length;
    const r = await brokerRequest(broker.socketPath, { path: '/api/proxy/x', host: 'harbour-runner.invalid:80' });
    assert.equal(r.status, 403);
    assert.equal(harbour.seen.length, before);
  });

  test('a non-/api/proxy path gets 404; so does the mint endpoint', TIMEOUT, async () => {
    const before = harbour.seen.length;
    for (const path of ['/', '/api/dispatch/x', '/workspace/acme', '/api/proxy/../admin']) {
      const r = await brokerRequest(broker.socketPath, { path });
      assert.equal(r.status, 404, path);
    }
    for (const path of ['/api/proxy/token', '/api/proxy/token/', '/api/proxy/Token', '/api/proxy/TOKEN?x=1']) {
      const mint = await brokerRequest(broker.socketPath, { method: 'POST', path, headers: { 'X-Harbour-Intent': 'write' } });
      assert.equal(mint.status, 404, `${path}: the mint endpoint is never reachable through the broker`);
    }
    assert.equal(harbour.seen.length, before);
    assert.equal(harbour.exchanges, 1);
  });

  test('a write without X-Harbour-Intent: write gets 403 and reaches nothing upstream', TIMEOUT, async () => {
    const before = harbour.seen.length;
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const r = await brokerRequest(broker.socketPath, { method, path: '/api/proxy/dispatch/x/feedback', body: '{}', headers: { 'Content-Type': 'application/json' } });
      assert.equal(r.status, 403, method);
      assert.match(r.body, /X-Harbour-Intent: write/);
    }
    assert.equal(harbour.seen.length, before);
  });

  test('a write with the intent header is forwarded with its body and content type', TIMEOUT, async () => {
    const before = harbour.seen.length;
    const payload = JSON.stringify({ kind: 'status', message: '[done]' });
    const r = await brokerRequest(broker.socketPath, {
      method: 'POST',
      path: '/api/proxy/dispatch/x/feedback',
      body: payload,
      headers: { 'Content-Type': 'application/json', 'X-Harbour-Intent': 'write' }
    });
    assert.equal(r.status, 200);
    const got = harbour.seen[before];
    assert.equal(got.method, 'POST');
    assert.equal(got.body, payload);
    assert.equal(got.headers['content-type'], 'application/json');
    assert.equal(got.headers.authorization, `Bearer ${harbour.working}`);
  });

  test('the log carries method, path and status only; never a token', () => {
    assert.ok(logLines.length > 0);
    const all = logLines.join('\n');
    assert.ok(!all.includes(harbour.working));
    assert.ok(!all.includes(harbour.bootstrap));
    assert.match(all, /GET \/api\/proxy\/dispatch\/abc 200/);
    assert.match(all, /POST \/api\/proxy\/dispatch\/x\/feedback 403/);
  });

  test('the pid file holds pid, socket, itemId and startedAt, and no token', () => {
    const pid = JSON.parse(readFileSync(broker.pidFile, 'utf8'));
    assert.equal(pid.pid, process.pid);
    assert.equal(pid.socket, broker.socketPath);
    assert.equal(pid.itemId, ITEM_ID);
    assert.ok(Date.parse(pid.startedAt));
    const raw = readFileSync(broker.pidFile, 'utf8');
    assert.ok(!raw.includes(harbour.working));
    assert.ok(!raw.includes(harbour.bootstrap));
  });

  test('the working token is not in this process\'s env or argv', () => {
    assert.ok(!JSON.stringify(process.env).includes(harbour.working));
    assert.ok(!process.argv.join(' ').includes(harbour.working));
  });
});

describe('request body cap (F4)', () => {
  test('the default cap sits above Harbour\'s largest proxy body (14mb attachment upload)', () => {
    assert.ok(BROKER_MAX_BODY_BYTES >= 14 * 1024 * 1024);
    assert.ok(BROKER_MAX_BODY_BYTES <= 32 * 1024 * 1024);
  });

  test('a body over the cap gets 413 and reaches nothing upstream; one at the cap is forwarded', TIMEOUT, async () => {
    const tmp = shortTmp();
    const harbour = await fakeHarbour();
    let broker;
    try {
      broker = await startBroker({
        base: harbour.base, urlKey: URL_KEY, itemId: ITEM_ID, home: tmp,
        bootstrap: harbour.bootstrap, log: () => {}, autoTick: false, maxBodyBytes: 1024
      });
      const write = { 'Content-Type': 'text/plain', 'X-Harbour-Intent': 'write' };
      const over = await brokerRequest(broker.socketPath, { method: 'POST', path: '/api/proxy/x', body: 'a'.repeat(1025), headers: write });
      assert.equal(over.status, 413);
      assert.equal(harbour.seen.length, 0);
      // Streamed with no Content-Length: still capped.
      const chunked = await new Promise((resolve, reject) => {
        const req = http.request({ socketPath: broker.socketPath, method: 'POST', path: '/api/proxy/x', headers: { Host: BROKER_HOST, ...write } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        for (let i = 0; i < 4; i++) req.write('b'.repeat(512));
        req.end();
      });
      assert.equal(chunked, 413);
      assert.equal(harbour.seen.length, 0);
      const at = await brokerRequest(broker.socketPath, { method: 'POST', path: '/api/proxy/x', body: 'c'.repeat(1024), headers: write });
      assert.equal(at.status, 200);
      assert.equal(harbour.seen[0].body.length, 1024);
    } finally {
      await broker?.stop('test-done');
      await harbour.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('isHeartbeatStale (shared with the runner helper)', () => {
  const MAX = 10 * 60_000;
  const NOW = 1_000_000_000;
  const rows = [
    ['fresh heartbeat, normal tick', NOW - 60_000, 60_000, false],
    ['stale heartbeat, normal tick', NOW - MAX - 1, 60_000, true],
    ['exactly at the limit is still fresh', NOW - MAX, 60_000, false],
    ['stale heartbeat but the tick followed a sleep gap', NOW - MAX - 1, 60 * 60_000, false],
    ['missing heartbeat, normal tick', null, 60_000, true],
    ['missing heartbeat after a sleep gap', null, 60 * 60_000, false],
    ['clock went backwards', NOW - MAX - 1, -5_000, false]
  ];
  for (const [name, mtime, gap, want] of rows) {
    test(name, () => {
      assert.equal(isHeartbeatStale(mtime, NOW, MAX, gap, { sleepGapMs: BROKER_SLEEP_GAP_MS }), want);
    });
  }
});

describe('createLifetimeWatch', () => {
  const START = 1_000_000_000;
  const opts = { startedAtMs: START, staleMs: BROKER_STALE_MS, sleepGapMs: BROKER_SLEEP_GAP_MS, maxLifetimeMs: BROKER_MAX_LIFETIME_MS };

  test('one stale check is not enough; two consecutive normal-tick checks close', () => {
    const w = createLifetimeWatch(opts);
    const hb = START; // written at start, never again
    let now = START;
    const results = [];
    while (now < START + BROKER_STALE_MS + 5 * BROKER_CHECK_MS) {
      now += BROKER_CHECK_MS;
      results.push([now - START, w.tick({ nowMs: now, heartbeatMtimeMs: hb })]);
      if (results.at(-1)[1]) break;
    }
    const firstClose = results.find(([, r]) => r);
    assert.equal(firstClose[1], 'heartbeat-stale');
    // Stale from the first tick past 10 min; closes on the second.
    assert.equal(firstClose[0], BROKER_STALE_MS + 2 * BROKER_CHECK_MS);
  });

  test('a fresh heartbeat between stale checks resets the streak', () => {
    const w = createLifetimeWatch(opts);
    let now = START + BROKER_STALE_MS + BROKER_CHECK_MS;
    // Pretend we've been ticking normally up to here.
    for (let t = START + BROKER_CHECK_MS; t < now; t += BROKER_CHECK_MS) w.tick({ nowMs: t, heartbeatMtimeMs: t });
    assert.equal(w.tick({ nowMs: now, heartbeatMtimeMs: START }), null); // stale #1
    now += BROKER_CHECK_MS;
    assert.equal(w.tick({ nowMs: now, heartbeatMtimeMs: now - 1000 }), null); // fresh: streak resets
    now += BROKER_CHECK_MS;
    assert.equal(w.tick({ nowMs: now, heartbeatMtimeMs: START }), null); // stale #1 again
  });

  test('a sleep gap restarts the grace window, so a live item survives waking', () => {
    const w = createLifetimeWatch(opts);
    let now = START + BROKER_CHECK_MS;
    assert.equal(w.tick({ nowMs: now, heartbeatMtimeMs: START }), null);
    // The laptop sleeps for 8 hours; the heartbeat is now hours old.
    now += 8 * 60 * 60_000;
    assert.equal(w.tick({ nowMs: now, heartbeatMtimeMs: START }), null);
    // Normal ticks resume; the runner hasn't refreshed yet. The grace window
    // restarted at wake, so nothing closes for another 10 minutes.
    for (let i = 0; i < Math.floor(BROKER_STALE_MS / BROKER_CHECK_MS); i++) {
      now += BROKER_CHECK_MS;
      assert.equal(w.tick({ nowMs: now, heartbeatMtimeMs: START }), null, `tick ${i} after wake`);
    }
  });

  test('the 48h cap closes regardless of heartbeat', () => {
    const w = createLifetimeWatch(opts);
    const now = START + BROKER_MAX_LIFETIME_MS;
    assert.equal(w.tick({ nowMs: now - BROKER_CHECK_MS, heartbeatMtimeMs: now - BROKER_CHECK_MS }), null);
    assert.equal(w.tick({ nowMs: now, heartbeatMtimeMs: now }), 'max-lifetime');
  });

  test('the 48h cap also closes on the first tick after a long sleep', () => {
    const w = createLifetimeWatch(opts);
    assert.equal(w.tick({ nowMs: START + BROKER_MAX_LIFETIME_MS + 1, heartbeatMtimeMs: null }), 'max-lifetime');
  });
});

describe('lifetime against a real broker (in-process, fake clock)', () => {
  async function withBroker(fn) {
    const tmp = shortTmp();
    const harbour = await fakeHarbour();
    let clock = Date.now();
    const broker = await startBroker({
      base: harbour.base, urlKey: URL_KEY, itemId: ITEM_ID, home: tmp,
      bootstrap: harbour.bootstrap, log: () => {}, autoTick: false,
      now: () => clock
    });
    const hb = kitPaths({ home: tmp, urlKey: URL_KEY, itemId: ITEM_ID }).heartbeat;
    const touch = (ms) => { writeFileSync(hb, ''); utimesSync(hb, ms / 1000, ms / 1000); };
    try {
      await fn({ broker, harbour, tmp, touch, advance: (ms) => { clock += ms; }, now: () => clock });
    } finally {
      await broker.stop('test-done');
      await harbour.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  test('a stale heartbeat closes the socket and removes the pid file', TIMEOUT, async () => {
    await withBroker(async ({ broker, touch, advance, now }) => {
      touch(now());
      assert.equal(await socketRefuses(broker.socketPath), false);
      // Normal-length ticks; the runner never refreshes the heartbeat.
      for (let i = 0; i < BROKER_STALE_MS / BROKER_CHECK_MS + 2 && !broker.stopped; i++) {
        advance(BROKER_CHECK_MS);
        await broker.tick();
      }
      assert.equal(await broker.closed, 'heartbeat-stale');
      assert.equal(await socketRefuses(broker.socketPath), true);
      assert.equal(existsSync(broker.socketPath), false);
      assert.equal(existsSync(broker.pidFile), false);
    });
  });

  test('a simulated sleep gap does not close it', TIMEOUT, async () => {
    await withBroker(async ({ broker, touch, advance, now }) => {
      touch(now());
      advance(BROKER_CHECK_MS); await broker.tick();
      advance(6 * 60 * 60_000); await broker.tick(); // slept 6h
      advance(BROKER_CHECK_MS); await broker.tick();
      advance(BROKER_CHECK_MS); await broker.tick();
      assert.equal(broker.stopped, false);
      const r = await brokerRequest(broker.socketPath, { path: '/api/proxy/still-here' });
      assert.equal(r.status, 200);
    });
  });

  test('a heartbeat the runner keeps refreshing never closes it', TIMEOUT, async () => {
    await withBroker(async ({ broker, touch, advance, now }) => {
      for (let i = 0; i < 30; i++) { advance(BROKER_CHECK_MS); touch(now()); await broker.tick(); }
      assert.equal(broker.stopped, false);
    });
  });

  test('the maximum lifetime closes it', TIMEOUT, async () => {
    await withBroker(async ({ broker, touch, advance, now }) => {
      advance(BROKER_MAX_LIFETIME_MS);
      touch(now());
      await broker.tick();
      assert.equal(await broker.closed, 'max-lifetime');
      assert.equal(await socketRefuses(broker.socketPath), true);
    });
  });

  test('stop is idempotent and closes the socket', TIMEOUT, async () => {
    await withBroker(async ({ broker }) => {
      await broker.stop('manual');
      await broker.stop('again');
      assert.equal(broker.stopped, true);
      assert.equal(await broker.closed, 'manual');
      assert.equal(await socketRefuses(broker.socketPath), true);
    });
  });
});

describe('startBroker fails closed', () => {
  test('a failed exchange creates no socket and no pid file', TIMEOUT, async () => {
    const tmp = shortTmp();
    const harbour = await fakeHarbour();
    try {
      await assert.rejects(
        startBroker({ base: harbour.base, urlKey: URL_KEY, itemId: ITEM_ID, home: tmp, bootstrap: freshToken(), log: () => {}, autoTick: false }),
        (err) => /exchange/i.test(err.message) && !err.message.includes(harbour.working)
      );
      const p = kitPaths({ home: tmp, urlKey: URL_KEY, itemId: ITEM_ID });
      assert.equal(existsSync(p.socket), false);
      assert.equal(existsSync(p.pidFile), false);
    } finally {
      await harbour.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a transport failure never spends the single-use bootstrap', TIMEOUT, async () => {
    const tmp = shortTmp();
    const harbour = await fakeHarbour();
    const p = kitPaths({ home: tmp, urlKey: URL_KEY, itemId: ITEM_ID });
    const squatter = track(http.createServer((q, r) => r.end('squatter')));
    const held = await brokerTransport({ server: squatter, socketDir: p.socketDir, socketPath: p.socket });
    try {
      await assert.rejects(
        startBroker({ base: harbour.base, urlKey: URL_KEY, itemId: ITEM_ID, home: tmp, bootstrap: harbour.bootstrap, log: () => {}, autoTick: false }),
        /already listening/
      );
      assert.equal(harbour.exchanges, 0, 'the bootstrap is still unspent');
    } finally {
      await held.close();
      await harbour.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('an empty bootstrap is refused before any network call', TIMEOUT, async () => {
    const tmp = shortTmp();
    const harbour = await fakeHarbour();
    try {
      await assert.rejects(
        startBroker({ base: harbour.base, urlKey: URL_KEY, itemId: ITEM_ID, home: tmp, bootstrap: '  \n', log: () => {}, autoTick: false }),
        /bootstrap/i
      );
      assert.equal(harbour.exchanges, 0);
    } finally {
      await harbour.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a cleartext base that is not loopback is refused, so the bearer never crosses the network unencrypted', TIMEOUT, async () => {
    const tmp = shortTmp();
    try {
      await assert.rejects(
        startBroker({ base: 'http://harbour.example', urlKey: URL_KEY, itemId: ITEM_ID, home: tmp, bootstrap: freshToken(), log: () => {}, autoTick: false }),
        /https/i
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('the broker CLI (spawned, bootstrap on stdin)', () => {
  test('the token is never in argv, env, any file under the kit dir, or output', TIMEOUT, async () => {
    const home = shortTmp();
    const harbour = await fakeHarbour();
    const b = spawnBroker({ home, base: harbour.base, bootstrap: harbour.bootstrap });
    try {
      const ready = await b.ready;
      assert.equal(ready.ready, true);
      assert.equal(ready.pid, b.child.pid);
      // Exercise it so the log has lines in it.
      assert.equal((await brokerRequest(ready.socket, { path: '/api/proxy/dispatch/abc' })).status, 200);
      assert.equal((await brokerRequest(ready.socket, { method: 'POST', path: '/api/proxy/x', body: '{}' })).status, 403);
      assert.equal(harbour.seen[0].headers.authorization, `Bearer ${harbour.working}`);

      const secrets = [harbour.working, harbour.bootstrap];
      // argv, as the OS reports it.
      const argv = execFileSync('ps', ['-p', String(b.child.pid), '-o', 'command='], { encoding: 'utf8' });
      assert.match(argv, /broker\.mjs serve/);
      for (const s of secrets) assert.ok(!argv.includes(s), 'token in argv');
      // env: the broker was started without one and never sets one. On Linux
      // the kernel's copy is readable too.
      const environPath = `/proc/${b.child.pid}/environ`;
      if (existsSync(environPath)) {
        const environ = readFileSync(environPath, 'utf8');
        for (const s of secrets) assert.ok(!environ.includes(s), 'token in env');
      }
      // files: everything under the kit dir, pid file and log included.
      const files = filesUnder(home);
      assert.ok(files.some((f) => f.endsWith(`${ITEM_ID}.json`)), 'pid file written');
      assert.ok(files.some((f) => f.endsWith(`${ITEM_ID}.log`)), 'log written');
      for (const f of files) {
        const text = readFileSync(f, 'utf8');
        for (const s of secrets) assert.ok(!text.includes(s), `token in ${f}`);
      }
      const log = readFileSync(files.find((f) => f.endsWith('.log')), 'utf8');
      assert.match(log, /GET \/api\/proxy\/dispatch\/abc 200/);
      // output: stdout and stderr.
      for (const s of secrets) assert.ok(!b.output().includes(s), 'token in output');
    } finally {
      b.child.kill('SIGTERM');
      await b.exited;
      await harbour.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('the broker source never writes process.env', () => {
    const src = readFileSync(BROKER_BIN, 'utf8');
    assert.doesNotMatch(src, /process\.env(\.[A-Za-z_]+|\[[^\]]+\])\s*=[^=]/);
    assert.doesNotMatch(src, /Object\.assign\(\s*process\.env/);
  });

  test('SIGTERM closes it: socket and pid file are removed, exit 0', TIMEOUT, async () => {
    const home = shortTmp();
    const harbour = await fakeHarbour();
    const b = spawnBroker({ home, base: harbour.base, bootstrap: harbour.bootstrap });
    try {
      const ready = await b.ready;
      b.child.kill('SIGTERM');
      const { code } = await b.exited;
      assert.equal(code, 0);
      assert.equal(existsSync(ready.socket), false);
      assert.equal(existsSync(ready.pidFile), false);
    } finally {
      await harbour.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('stopBroker uses the pid file: closes it, removes the pid file and the socket', TIMEOUT, async () => {
    const home = shortTmp();
    const harbour = await fakeHarbour();
    const b = spawnBroker({ home, base: harbour.base, bootstrap: harbour.bootstrap });
    try {
      const ready = await b.ready;
      const result = await stopBroker({ home, urlKey: URL_KEY, itemId: ITEM_ID });
      assert.equal(result.found, true);
      assert.equal(result.signalled, true);
      const { code } = await b.exited;
      assert.equal(code, 0);
      assert.equal(existsSync(ready.socket), false);
      assert.equal(existsSync(ready.pidFile), false);
      assert.equal(await socketRefuses(ready.socket), true);
    } finally {
      if (b.child.exitCode === null) b.child.kill('SIGKILL');
      await harbour.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('stopBroker does not signal a pid that no longer owns the socket, but still cleans up', TIMEOUT, async () => {
    const home = shortTmp();
    try {
      const p = kitPaths({ home, urlKey: URL_KEY, itemId: ITEM_ID });
      mkdirSync(dirname(p.pidFile), { recursive: true, mode: 0o700 });
      // This test process's pid: alive, but not a broker. It must not be signalled.
      writeFileSync(p.pidFile, JSON.stringify({ pid: process.pid, socket: p.socket, itemId: ITEM_ID, startedAt: new Date().toISOString() }));
      const result = await stopBroker({ home, urlKey: URL_KEY, itemId: ITEM_ID });
      assert.equal(result.found, true);
      assert.equal(result.signalled, false);
      assert.equal(existsSync(p.pidFile), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('stopBroker never unlinks a live socket it did not stop (8-char prefix collision, F3)', TIMEOUT, async () => {
    const home = shortTmp();
    const harbour = await fakeHarbour();
    // Item B shares A's first 8 characters, so both map to the same socket path.
    const itemB = `${ITEM_ID.slice(0, 8)}-ffff-4fff-8fff-ffffffffffff`;
    let brokerA;
    try {
      brokerA = await startBroker({ base: harbour.base, urlKey: URL_KEY, itemId: ITEM_ID, home, bootstrap: harbour.bootstrap, log: () => {}, autoTick: false });
      const pB = kitPaths({ home, urlKey: URL_KEY, itemId: itemB });
      assert.equal(pB.socket, brokerA.socketPath);
      // B's broker is long gone: its pid file names a pid that isn't a broker.
      writeFileSync(pB.pidFile, JSON.stringify({ pid: process.pid, socket: pB.socket, itemId: itemB, startedAt: new Date().toISOString() }));
      const result = await stopBroker({ home, urlKey: URL_KEY, itemId: itemB });
      assert.equal(result.signalled, false);
      assert.equal(existsSync(pB.pidFile), false, "B's stale pid file is removed");
      assert.ok(existsSync(brokerA.socketPath), "A's live socket is left alone");
      assert.equal((await brokerRequest(brokerA.socketPath, { path: '/api/proxy/still-a' })).status, 200);
    } finally {
      await brokerA?.stop('test-done');
      await harbour.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('stopBroker with no pid file reports not found', TIMEOUT, async () => {
    const home = shortTmp();
    try {
      const result = await stopBroker({ home, urlKey: URL_KEY, itemId: ITEM_ID });
      assert.equal(result.found, false);
      assert.equal(result.signalled, false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a stdin bootstrap that fails to exchange exits non-zero with no token in its output', TIMEOUT, async () => {
    const home = shortTmp();
    const harbour = await fakeHarbour();
    const wrong = freshToken();
    const b = spawnBroker({ home, base: harbour.base, bootstrap: wrong });
    try {
      await assert.rejects(b.ready);
      const { code } = await b.exited;
      assert.notEqual(code, 0);
      assert.ok(!b.output().includes(wrong));
      assert.equal(existsSync(kitPaths({ home, urlKey: URL_KEY, itemId: ITEM_ID }).socket), false);
    } finally {
      await harbour.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
