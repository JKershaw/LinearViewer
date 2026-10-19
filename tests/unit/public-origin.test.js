/**
 * LIN-3692: publicOrigin() is the one place an absolute URL's origin comes from.
 *
 * Run with: node --test tests/unit/public-origin.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { request } from 'node:http';
import { publicOrigin } from '../../lib/public-origin.js';

const NONE = {};
const fakeReq = (host, protocol = 'https') => ({ protocol, get: (name) => (name.toLowerCase() === 'host' ? host : undefined) });

// Neither variable may leak in from the runner's environment.
delete process.env.PUBLIC_ORIGIN;
delete process.env.EMAIL_LINK_ORIGIN;

describe('publicOrigin (LIN-3692)', () => {
  test('unset and empty are Host-derived, with no trailing slash', () => {
    assert.strictEqual(publicOrigin(fakeReq('harbour.example'), { env: NONE }), 'https://harbour.example');
    assert.strictEqual(publicOrigin(fakeReq('harbour.example'), { env: { PUBLIC_ORIGIN: '' } }), 'https://harbour.example');
    assert.strictEqual(publicOrigin(fakeReq('localhost:3000', 'http'), { env: NONE }), 'http://localhost:3000');
  });

  test('defaults to process.env', () => {
    assert.strictEqual(publicOrigin(fakeReq('harbour.example')), 'https://harbour.example');
  });

  test('PUBLIC_ORIGIN wins in every NODE_ENV; path and query are dropped', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      const env = { NODE_ENV, PUBLIC_ORIGIN: 'https://harbour.cat/some/path?q=1' };
      assert.strictEqual(publicOrigin(fakeReq('evil.example'), { env }), 'https://harbour.cat');
    }
  });

  test('the older alias alone is honoured; PUBLIC_ORIGIN beats it', () => {
    assert.strictEqual(publicOrigin(fakeReq('h.example'), { env: { EMAIL_LINK_ORIGIN: 'https://alias.example' } }), 'https://alias.example');
    assert.strictEqual(
      publicOrigin(fakeReq('h.example'), { env: { PUBLIC_ORIGIN: 'https://main.example', EMAIL_LINK_ORIGIN: 'https://alias.example' } }),
      'https://main.example'
    );
  });

  test('an invalid PUBLIC_ORIGIN behaves as unset: Host-derived, never null, alias not consulted', () => {
    const env = { PUBLIC_ORIGIN: 'harbour.cat', EMAIL_LINK_ORIGIN: 'https://alias.example' };
    assert.strictEqual(publicOrigin(fakeReq('h.example'), { env }), 'https://h.example');
    assert.strictEqual(publicOrigin(fakeReq('h.example'), { env: { PUBLIC_ORIGIN: 'javascript:alert(1)' } }), 'https://h.example');
  });

  test('safeHost keeps the malformed-host and missing-host fallback to harbour.cat', () => {
    const safe = { env: NONE, safeHost: true };
    assert.strictEqual(publicOrigin(fakeReq('harbour.example:8080'), safe), 'https://harbour.example:8080');
    assert.strictEqual(publicOrigin(fakeReq('evil.example/<x>'), safe), 'https://harbour.cat');
    assert.strictEqual(publicOrigin(fakeReq('a b'), safe), 'https://harbour.cat');
    assert.strictEqual(publicOrigin(fakeReq(undefined), safe), 'https://harbour.cat');
    assert.strictEqual(publicOrigin(fakeReq('evil.example/<x>'), { env: NONE }), 'https://evil.example/<x>', 'without safeHost the host is used as-is');
    assert.strictEqual(publicOrigin(fakeReq('evil.example/<x>'), { env: { PUBLIC_ORIGIN: 'https://harbour.cat' }, safeHost: true }), 'https://harbour.cat');
  });

  test('reads only req.protocol and req.get("host")', () => {
    const seen = [];
    const req = new Proxy({ protocol: 'https', get: (n) => { seen.push(n.toLowerCase()); return 'h.example'; } }, {
      get(t, k) { if (k !== 'protocol' && k !== 'get') throw new Error(`read req.${String(k)}`); return t[k]; },
    });
    assert.strictEqual(publicOrigin(req, { env: NONE }), 'https://h.example');
    assert.deepStrictEqual(seen, ['host']);
  });
});

describe('publicOrigin against a real forged Host header (LIN-3692)', () => {
  let server; let port;
  const saved = {};
  before(async () => {
    const app = express();
    app.get('/o', (req, res) => res.json({ origin: publicOrigin(req) }));
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));

  // fetch() ignores a Host override and would pass vacuously.
  const forged = () => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/o', headers: { host: 'evil.example' } }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve(JSON.parse(body).origin));
    });
    req.on('error', reject); req.end();
  });

  test('unset: the forged Host is reflected (today); set: the configured origin wins', async () => {
    saved.p = process.env.PUBLIC_ORIGIN;
    try {
      delete process.env.PUBLIC_ORIGIN;
      assert.strictEqual(await forged(), 'http://evil.example');
      process.env.PUBLIC_ORIGIN = 'https://harbour.cat';
      assert.strictEqual(await forged(), 'https://harbour.cat');
    } finally {
      if (saved.p === undefined) delete process.env.PUBLIC_ORIGIN; else process.env.PUBLIC_ORIGIN = saved.p;
    }
  });
});
