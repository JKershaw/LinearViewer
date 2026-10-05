/**
 * lib/http-keepalive.js: the one keep-alive module behind every slow route (LIN-3293
 * wiring). Heroku's router gives a request 30s from when IT received it to the first
 * response byte, then a rolling 55s between bytes. The JSON framing therefore measures
 * its first-byte deadline from the router's X-Request-Start stamp (not from when the
 * handler got round to arming it), and sends a body byte with the flush rather than
 * bare headers. The SSE framing sends a comment line on the same cadence while a
 * stream is otherwise silent (a slow routing call). clientGoneSignal turns a
 * client hang-up into an abort for the model calls.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import express from 'express';
import {
  armKeepalive, armSseKeepalive, clientGoneSignal, requestArrivedAt,
  FIRST_BYTE_TARGET_MS, HEARTBEAT_INTERVAL_MS
} from '../../lib/http-keepalive.js';

function makeRes(headers = null) {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200,
    headersSet: {},
    flushedAt: null,
    writes: [],
    writableEnded: false,
    writableFinished: false,
    destroyed: false,
    req: headers ? { get: (name) => headers[name.toLowerCase()] } : undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headersSet[k] = v; return this; },
    flushHeaders() { this.flushedAt = Date.now(); return this; },
    write(chunk) { this.writes.push(chunk); return true; },
    json(b) { this.jsonBody = b; return this; },
    end(b) { this.endedWith = b; this.writableEnded = true; this.writableFinished = true; return this; }
  });
  return res;
}

describe('requestArrivedAt (X-Request-Start)', () => {
  const now = 1_800_000_000_000;
  test('reads Heroku\'s epoch-milliseconds stamp', () => {
    assert.equal(requestArrivedAt({ get: () => String(now - 4000) }, now), now - 4000);
  });
  test('reads the t=<seconds> and microsecond forms other routers use', () => {
    assert.equal(requestArrivedAt({ get: () => `t=${(now - 2500) / 1000}` }, now), now - 2500);
    assert.equal(requestArrivedAt({ get: () => String((now - 1000) * 1000) }, now), now - 1000);
  });
  test('ignores a missing, malformed, future or stale stamp', () => {
    assert.equal(requestArrivedAt(undefined, now), null);
    assert.equal(requestArrivedAt({ get: () => undefined }, now), null);
    assert.equal(requestArrivedAt({ get: () => 'soon' }, now), null);
    assert.equal(requestArrivedAt({ get: () => String(now + 5000) }, now), null);
    assert.equal(requestArrivedAt({ get: () => String(now - 10 * 60_000) }, now), null);
  });
});

describe('armKeepalive (JSON framing)', () => {
  test('with a router stamp, the first byte goes out FIRST_BYTE_TARGET_MS after the request ARRIVED', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_800_000_000_000 });
    // The handler arms 6s after the router took the request (queueing + preamble).
    const res = makeRes({ 'x-request-start': String(Date.now() - 6000) });
    const ka = armKeepalive(res);
    t.mock.timers.tick(FIRST_BYTE_TARGET_MS - 6000 - 1);
    assert.equal(ka.flushed, false);
    t.mock.timers.tick(1);
    assert.equal(ka.flushed, true, 'flushed 20s after arrival, not 25s after arming');
    ka.stop();
  });

  test('the flush carries a body byte, not bare headers', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const res = makeRes();
    const ka = armKeepalive(res);
    t.mock.timers.tick(25_000);
    assert.equal(ka.flushed, true);
    assert.deepEqual(res.writes, [' '], 'one whitespace byte with the headers');
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
    assert.deepEqual(res.writes, [' ', ' ']);
    ka.stop();
  });

  test('without a stamp it keeps the old 25s-from-arming fallback', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const res = makeRes();
    const ka = armKeepalive(res);
    t.mock.timers.tick(24_999);
    assert.equal(ka.flushed, false);
    t.mock.timers.tick(1);
    assert.equal(ka.flushed, true);
    ka.stop();
  });

  test('send stops the keep-alive: nothing is flushed or written after the reply', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const res = makeRes();
    const ka = armKeepalive(res);
    ka.send(201, { ok: true });
    assert.deepEqual(res.jsonBody, { ok: true });
    assert.equal(res.statusCode, 201);
    t.mock.timers.tick(25_000 + HEARTBEAT_INTERVAL_MS * 2);
    assert.equal(res.flushedAt, null, 'no flush after the reply');
    assert.deepEqual(res.writes, []);
  });

  test('a reply made on res directly is never overwritten by the flush', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const res = makeRes();
    armKeepalive(res);
    res.status(404).json({ error: 'gone' });
    res.headersSent = true;
    t.mock.timers.tick(25_000);
    assert.equal(res.flushedAt, null);
    assert.equal(res.statusCode, 404, 'the flush did not reset the status');
    assert.deepEqual(res.writes, []);
  });

  test('the heartbeat stops when the response closes', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const res = makeRes();
    armKeepalive(res);
    t.mock.timers.tick(25_000);
    assert.deepEqual(res.writes, [' ']);
    res.emit('close');
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS * 3);
    assert.deepEqual(res.writes, [' '], 'no heartbeat after close');
  });

  test('a request already past the target flushes at once', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_800_000_000_000 });
    const res = makeRes({ 'x-request-start': String(Date.now() - 27_000) });
    const ka = armKeepalive(res);
    t.mock.timers.tick(0);
    assert.equal(ka.flushed, true);
    ka.send(404, { error: 'Issue not found' });
    assert.deepEqual(JSON.parse(res.endedWith), { error: 'Issue not found', statusCode: 404 });
    ka.stop();
  });
});

describe('armSseKeepalive (SSE framing)', () => {
  test('writes an SSE comment every HEARTBEAT_INTERVAL_MS until stopped', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const res = makeRes();
    const ka = armSseKeepalive(res);
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
    assert.deepEqual(res.writes, [': keepalive\n\n', ': keepalive\n\n']);
    ka.stop();
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS * 3);
    assert.equal(res.writes.length, 2);
  });

  // Runtime witness: a real stream on 127.0.0.1 that stays silent for several
  // intervals, read by the UI's REAL readSSEStream (sliced from public/common.js).
  test('a real silent stream carries comment lines the UI reader skips', async () => {
    const app = express();
    app.get('/stream', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.flushHeaders();
      const ka = armSseKeepalive(res, { intervalMs: 30 });
      setTimeout(() => {
        ka.stop();
        res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        res.end();
      }, 140);
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const url = `http://127.0.0.1:${server.address().port}/stream`;
    try {
      const raw = await (await fetch(url)).text();
      assert.ok(raw.split(': keepalive\n\n').length - 1 >= 3, `the silence was filled: ${JSON.stringify(raw)}`);

      const src = readFileSync(new URL('../../public/common.js', import.meta.url), 'utf8');
      const start = src.indexOf('window.readSSEStream = async function readSSEStream(');
      const end = src.indexOf('\n};', start) + 3;
      const sandbox = { TextDecoder, console };
      vm.runInContext(src.slice(start, end).replace('window.readSSEStream', 'var readSSEStream'), vm.createContext(sandbox));
      const events = [];
      await sandbox.readSSEStream(await fetch(url), (type, data) => events.push({ type, data }));
      // JSON round trip: the vm realm's objects are not this realm's.
      assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ type: 'done', data: { ok: true } }], 'the reader saw only the data event');
    } finally {
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
    }
  });

  test('stays quiet once the response has ended', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const res = makeRes();
    const ka = armSseKeepalive(res);
    res.end();
    t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
    assert.deepEqual(res.writes, []);
    ka.stop();
  });
});

describe('clientGoneSignal', () => {
  test('aborts when the connection closes before the response finished', () => {
    const res = makeRes();
    const gone = clientGoneSignal(res);
    assert.equal(gone.signal.aborted, false);
    res.emit('close');
    assert.equal(gone.signal.aborted, true);
    assert.equal(gone.gone, true);
  });

  test('does not abort on the normal close after a finished response', () => {
    const res = makeRes();
    const gone = clientGoneSignal(res);
    res.end('{}');
    res.emit('close');
    assert.equal(gone.signal.aborted, false);
    gone.release();
  });

  test('armed after the client has already gone, it aborts at once', () => {
    const res = makeRes();
    res.destroyed = true;
    const gone = clientGoneSignal(res);
    assert.equal(gone.gone, true, 'a hang-up before arming is not missed');
    gone.release();
  });

  test('armed after a finished response, it stays quiet', () => {
    const res = makeRes();
    res.end('{}');
    res.destroyed = true;
    const gone = clientGoneSignal(res);
    assert.equal(gone.gone, false);
    gone.release();
  });

  // Runtime witness: the client drops while the handler is still in its preamble
  // (prefs read, charge...), before it arms the signal (review follow-up, should-fix 1).
  test('a real client hang-up BEFORE arming is seen when the signal is armed', async () => {
    let result;
    const done = new Promise(resolve => { result = resolve; });
    const app = express();
    app.get('/late', async (req, res) => {
      await new Promise(r => setTimeout(r, 300));
      const gone = clientGoneSignal(res);
      result(gone.gone);
      gone.release();
      if (!res.writableEnded) res.end('ok');
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address();
    try {
      const ac = new AbortController();
      const pending = fetch(`http://127.0.0.1:${port}/late`, { signal: ac.signal }).catch(() => null);
      setTimeout(() => ac.abort(), 50);
      await pending;
      assert.equal(await done, true);
    } finally {
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
    }
  });

  test('a fake res with no event surface never aborts', () => {
    const gone = clientGoneSignal({});
    assert.equal(gone.signal.aborted, false);
    gone.release();
  });

  // Runtime witness: a real 127.0.0.1 server, a real client hang-up mid-request.
  test('a real client hang-up mid-request aborts the signal', async () => {
    let sawAbort;
    const aborted = new Promise(resolve => { sawAbort = resolve; });
    const app = express();
    app.get('/slow', (req, res) => {
      const gone = clientGoneSignal(res);
      gone.signal.addEventListener('abort', () => sawAbort(true));
      setTimeout(() => { if (!res.writableEnded) res.end('late'); }, 2000).unref();
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address();
    const ac = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/slow`, { signal: ac.signal }).catch(() => null);
    setTimeout(() => ac.abort(), 100);
    await pending;
    assert.equal(await Promise.race([aborted, new Promise(r => setTimeout(() => r(false), 1500))]), true);
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  });
});
