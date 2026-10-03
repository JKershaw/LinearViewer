/**
 * lib/http-keepalive.js: the one keep-alive module behind every slow route (LIN-3293
 * wiring). Heroku's router gives a request 30s from when IT received it to the first
 * response byte, then a rolling 55s between bytes. The JSON framing therefore measures
 * its first-byte deadline from the router's X-Request-Start stamp (not from when the
 * handler got round to arming it), and sends a body byte with the flush rather than
 * bare headers. The SSE framing sends a comment line on the same cadence while a
 * stream is otherwise silent (the brief writer's 20-40s). clientGoneSignal turns a
 * client hang-up into an abort for the model calls.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
