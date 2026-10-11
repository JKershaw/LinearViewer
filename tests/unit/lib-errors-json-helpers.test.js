/**
 * LIN-3460: the shared JSON error helpers in lib/errors.js are the one place a
 * JSON error reply is written, so their wire shape is pinned here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { armKeepalive, FIRST_BYTE_TARGET_MS } from '../../lib/http-keepalive.js';
import { jsonError, keepaliveError, badRequest, unauthorized, notFound, serverError, serviceUnavailable } from '../../lib/errors.js';

function fakeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; }
  };
  return res;
}

describe('jsonError', () => {
  test('sends { error } with the given status and returns res', () => {
    const res = fakeRes();
    assert.equal(jsonError(res, 403, 'nope'), res);
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.stringify(res.body), '{"error":"nope"}');
  });

  test('spreads extra after error, preserving key order', () => {
    const res = fakeRes();
    jsonError(res, 429, 'slow down', { freeTier: { used: true }, code: 'X' });
    assert.equal(res.statusCode, 429);
    assert.equal(JSON.stringify(res.body), '{"error":"slow down","freeTier":{"used":true},"code":"X"}');
  });

  test('a null detail is kept as an explicit null', () => {
    const res = fakeRes();
    jsonError(res, 502, 'upstream', { detail: null });
    assert.equal(JSON.stringify(res.body), '{"error":"upstream","detail":null}');
  });
});

function keepaliveRes() {
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200, writes: [], writableEnded: false, writableFinished: false, destroyed: false,
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    flushHeaders() { return this; },
    write(chunk) { this.writes.push(chunk); return true; },
    json(b) { this.jsonBody = b; return this; },
    end(b) { this.endedWith = b; this.writableEnded = true; this.writableFinished = true; return this; }
  });
  return res;
}

describe('keepaliveError (LIN-3465)', () => {
  test('unflushed: replies with the given status and { error }', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const res = keepaliveRes();
    keepaliveError(armKeepalive(res), 503, 'x');
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.stringify(res.jsonBody), '{"error":"x"}');
  });

  test('unflushed: extra follows error in order, explicit null kept', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const res = keepaliveRes();
    keepaliveError(armKeepalive(res), 429, 'x', { code: 'C', detail: null });
    assert.equal(res.statusCode, 429);
    assert.equal(JSON.stringify(res.jsonBody), '{"error":"x","code":"C","detail":null}');
  });

  test('flushed: statusCode rides in the body, appended last', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_800_000_000_000 });
    const res = keepaliveRes();
    res.req = { get: () => String(Date.now() - FIRST_BYTE_TARGET_MS) };
    const ka = armKeepalive(res);
    t.mock.timers.tick(0);
    assert.equal(ka.flushed, true);
    keepaliveError(ka, 429, 'x', { code: 'C' });
    assert.equal(res.endedWith, '{"error":"x","code":"C","statusCode":429}');
  });

  test('returns what send returns and does not mutate extra', () => {
    const sentinel = {};
    const calls = [];
    const extra = Object.freeze({ a: 1 });
    const out = keepaliveError({ send: (...args) => { calls.push(args); return sentinel; } }, 500, 'e', extra);
    assert.equal(out, sentinel);
    assert.deepEqual(calls, [[500, { error: 'e', a: 1 }]]);
    assert.deepEqual(extra, { a: 1 });
  });
});

describe('named JSON helpers', () => {
  const cases = [
    ['badRequest', badRequest, 400, 'Bad request'],
    ['unauthorized', unauthorized, 401, 'Not authenticated'],
    ['notFound', notFound, 404, 'Not found'],
    ['serverError', serverError, 500, 'Internal server error'],
    ['serviceUnavailable', serviceUnavailable, 503, 'Service temporarily unavailable']
  ];
  for (const [name, helper, status, fallback] of cases) {
    test(`${name}.json sends ${status} with { error: message }`, () => {
      const res = fakeRes();
      assert.equal(helper.json(res, 'custom'), res);
      assert.equal(res.statusCode, status);
      assert.equal(JSON.stringify(res.body), '{"error":"custom"}');
    });
    test(`${name}.json falls back to its default message`, () => {
      const res = fakeRes();
      helper.json(res);
      assert.equal(res.statusCode, status);
      assert.deepEqual(res.body, { error: fallback });
    });
  }

  test('serverError/serviceUnavailable details become { message } and drop when falsy', () => {
    // Why replies carrying a `detail` key use jsonError, not these helpers.
    const withDetail = fakeRes();
    serverError.json(withDetail, 'boom', 'why');
    assert.equal(JSON.stringify(withDetail.body), '{"error":"boom","message":"why"}');
    const dropped = fakeRes();
    serviceUnavailable.json(dropped, 'down', null);
    assert.equal(JSON.stringify(dropped.body), '{"error":"down"}');
  });
});
