/**
 * LIN-3495 — when a call to Harbour fails before any reply, the runner kit names
 * the cause the network gave (SELF_SIGNED_CERT_IN_CHAIN, ECONNREFUSED, ...) and
 * never says "unreachable". One function (`describeConnectFailure`, broker.mjs)
 * words it for the three sites: `exchangeBootstrap`, the broker's 502 reply and
 * `runner.mjs login`. Every upstream is an injected `fetchImpl`; no socket to
 * a real host is opened.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeConnectFailure, exchangeBootstrap, startBroker } from '../../lib/runner-kit/broker.mjs';
import { runCommand } from '../../lib/runner-kit/runner.mjs';

const TIMEOUT = { timeout: 15_000 };
const BEARER = 'Bearer sk-live-0123456789abcdef';

const tlsFailure = () => Object.assign(new TypeError('fetch failed'), {
  cause: Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })
});
const aggregateFailure = () => Object.assign(new AggregateError(
  [Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' })], 'all addresses failed'
), { code: undefined });
const leakyFailure = () => new TypeError(`fetch failed for https://harbour.example/api/proxy/token ${BEARER}`);
const throwing = (make) => async () => { throw make(); };

describe('describeConnectFailure', () => {
  test('prefers err.cause.code, then err.code, then the first aggregate code, then name', () => {
    assert.match(describeConnectFailure(tlsFailure()), /SELF_SIGNED_CERT_IN_CHAIN/);
    assert.match(describeConnectFailure(Object.assign(new Error('m'), { code: 'ENOTFOUND' })), /ENOTFOUND/);
    assert.match(describeConnectFailure(aggregateFailure()), /ECONNREFUSED/);
    assert.match(describeConnectFailure(new TypeError('m')), /TypeError/);
    assert.match(describeConnectFailure(undefined), /unknown error/);
  });

  test('never carries free text, a URL or a token, and never says unreachable', () => {
    const words = describeConnectFailure(leakyFailure());
    assert.doesNotMatch(words, /sk-live|Bearer|https?:|harbour\.example|unreachable/i);
    const odd = describeConnectFailure(Object.assign(new Error('m'), { code: `E ${BEARER}` }));
    assert.doesNotMatch(odd, /sk-live|Bearer/);
  });
});

describe('the three sites use it', () => {
  test('exchangeBootstrap names the cause', TIMEOUT, async () => {
    await assert.rejects(
      exchangeBootstrap({ base: 'http://127.0.0.1:1', bootstrap: 'b', fetchImpl: throwing(tlsFailure) }),
      (e) => e.message.startsWith('bootstrap exchange failed: ') && /SELF_SIGNED_CERT_IN_CHAIN/.test(e.message) && !/unreachable/.test(e.message)
    );
    await assert.rejects(
      exchangeBootstrap({ base: 'http://127.0.0.1:1', bootstrap: 'b', fetchImpl: throwing(aggregateFailure) }),
      /ECONNREFUSED/
    );
    await assert.rejects(
      exchangeBootstrap({ base: 'http://127.0.0.1:1', bootstrap: 'b', fetchImpl: throwing(leakyFailure) }),
      (e) => !/sk-live|Bearer|harbour\.example/.test(e.message)
    );
  });

  test('login names the cause', TIMEOUT, async () => {
    const home = mkdtempSync(join(tmpdir(), 'lin3495-'));
    try {
      const stdin = '- baseUrl: http://127.0.0.1:1\n- urlKey: acme\n- ownerAccountId: o1\n- bootstrap: boot-secret\n';
      await assert.rejects(
        runCommand(['login'], { home, stdin, fetchImpl: throwing(tlsFailure) }),
        (e) => e.message.startsWith('login failed: ') && /SELF_SIGNED_CERT_IN_CHAIN/.test(e.message) && !/unreachable/.test(e.message)
      );
      await assert.rejects(
        runCommand(['login'], { home, stdin, fetchImpl: throwing(leakyFailure) }),
        (e) => !/sk-live|Bearer|boot-secret|harbour\.example/.test(e.message)
      );
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test('the broker 502 names the cause', TIMEOUT, async () => {
    const home = mkdtempSync(join('/tmp', 'l3495-'));
    let calls = 0;
    const fetchImpl = async () => {
      if (calls++ === 0) return new Response(JSON.stringify({ token: 'working-token' }), { status: 200 });
      throw tlsFailure();
    };
    const broker = await startBroker({
      base: 'http://127.0.0.1:1', urlKey: 'acme', itemId: '0f3a9c2e-1b4d-4e8f-9a7b-2c6d8e0f1a3b',
      home, bootstrap: 'boot', log: () => {}, autoTick: false, fetchImpl
    });
    try {
      const r = await new Promise((resolve, reject) => {
        const req = http.request({
          socketPath: broker.socketPath, path: '/api/proxy/dispatch/abc', method: 'GET',
          headers: { Host: 'harbour-runner.invalid' }
        }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
      });
      assert.equal(r.status, 502);
      assert.match(r.body, /SELF_SIGNED_CERT_IN_CHAIN/);
      assert.doesNotMatch(r.body, /unreachable|working-token/);
    } finally {
      await broker.stop('test-done');
      rmSync(home, { recursive: true, force: true });
    }
  });
});
