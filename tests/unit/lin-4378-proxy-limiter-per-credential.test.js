/**
 * LIN-4378 — witness for proxyLimiter keying on a proven credential.
 *
 * On 8 November one session crawling the proxy used up the 60-a-minute budget
 * for its whole runner host, because `proxyLimiter` (routes/proxy.js) counted
 * per IP address and every session on a host shares one. The fix keys the same
 * limiter on `credential:<sha256(bearer)>` once that bearer has authenticated,
 * and on the client IP otherwise. The limiter still runs BEFORE auth, so a
 * bearer that has never authenticated (a junk one, a bootstrap) is counted
 * against the IP, and a revoked one goes back there on its first 401.
 *
 * These tests drive the real `createProxyRoutes` chain over a real
 * `ProxyTokenStore` (same construction as
 * tests/unit/lin-2944-p3-default-copy-token-limit.test.js). The limiter skips
 * under NODE_ENV=test, so the describe block flips it to 'development'. Its
 * store and the proven-credential record are module scope, so each case uses
 * its own client address via `trust proxy` + `X-Forwarded-For`.
 *
 * H1  two tokens on one address get their own budgets   (red before the fix)
 * H2  rotating junk bearers still hit the IP guard before auth, and a proven
 *     token from that exhausted address still passes      (red before the fix)
 * H3  a revoked token gets a 401, then counts against the IP again
 */
process.env.NODE_ENV = 'test';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const realNodeEnv = process.env.NODE_ENV;
const LIMIT = 60;
const PATH = '/api/proxy/agent/status';

const proxyTokenStore = new ProxyTokenStore({ collection: createMockCollection() });

function buildApp() {
  const app = express();
  // server.js sets the same; it is what lets each case pick its own address.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: { listStatus: async () => ({ entries: [], total: 0 }) },
    recapCacheStore: {}, briefCacheStore: {}, taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = { urlKey: 'acme', id: 'ws-1', provider: 'local' };
      next();
    },
    getWorkspaceAccessToken: () => null,
    resolveWorkspaceAccess: () => null,
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {}, freeTierStore: {}
  }));
  return app;
}

async function withServer(fn) {
  const server = buildApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const call = async (address, bearer) => {
    const res = await fetch(`http://127.0.0.1:${port}${PATH}`, {
      headers: { 'X-Forwarded-For': address, Authorization: `Bearer ${bearer}` }
    });
    await res.arrayBuffer();
    return { status: res.status, retryAfter: res.headers.get('retry-after'), limit: res.headers.get('ratelimit-limit') };
  };
  try {
    return await fn(call);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const mint = async (label) => proxyTokenStore.createToken('acme', { label, scope: 'read' });
const junk = () => `lhp_${randomBytes(24).toString('hex')}`;

describe('LIN-4378 — proxyLimiter counts per proven credential, per IP otherwise', () => {
  process.env.NODE_ENV = 'development';
  // Hundreds of 401s each log a `[credential-rejected]` line; keep the output readable.
  const realWarn = console.warn;
  console.warn = (...args) => { if (!String(args[0]).startsWith('[credential-rejected]')) realWarn(...args); };
  after(() => {
    console.warn = realWarn;
    if (realNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = realNodeEnv;
  });

  test('H1: two tokens on one address each get their own budget', async () => {
    const a = await mint('session-a');
    const b = await mint('session-b');
    await withServer(async (call) => {
      const address = '10.78.0.1';
      const statuses = [];
      let refused = null;
      for (let i = 0; i < LIMIT + 5 && !refused; i++) {
        const r = await call(address, a.token);
        statuses.push(r.status);
        if (r.status === 429) refused = r;
      }
      assert.ok(refused, `token A was never limited (statuses ${statuses.join(',')})`);
      assert.ok(Number(refused.retryAfter) > 0 && Number(refused.retryAfter) <= 60,
        `a limiter 429 carries a Retry-After of at most the window (got ${refused.retryAfter})`);
      assert.equal(refused.limit, String(LIMIT), 'the 429 carries RateLimit-Limit');

      const other = await call(address, b.token);
      assert.equal(other.status, 200, `token B on the same address must not be limited by A (got ${other.status})`);
      const again = await call(address, b.token);
      assert.equal(again.status, 200, 'B keeps answering from its own budget');

      // A's first request is counted against the address (it was not yet proven);
      // its next 60 against its own credential. The 62nd is refused.
      assert.equal(statuses.length, LIMIT + 2, `A's first 429 came at request #${statuses.length}`);
    });
  });

  test('H2: rotating junk bearers are refused before auth; a proven token still passes', async () => {
    const proven = await mint('session-proven');
    await withServer(async (call) => {
      assert.equal((await call('10.78.0.20', proven.token)).status, 200, 'the token proves itself from another address');

      const address = '10.78.0.2';
      const statuses = [];
      for (let i = 0; i < LIMIT + 1; i++) statuses.push((await call(address, junk())).status);
      assert.deepEqual(statuses.slice(0, LIMIT), Array(LIMIT).fill(401), 'the first 60 junk bearers reach auth and are rejected');
      assert.equal(statuses[LIMIT], 429, 'the 61st junk bearer is refused by the limiter, before auth: a fresh bearer buys no fresh budget');

      const ok = await call(address, proven.token);
      assert.equal(ok.status, 200, `a proven token is not limited by its address's junk traffic (got ${ok.status})`);
    });
  });

  test('H3: a revoked token gets a 401, then counts against the address again', async () => {
    const revoked = await mint('session-revoked');
    await withServer(async (call) => {
      assert.equal((await call('10.78.0.30', revoked.token)).status, 200, 'the token proves itself from another address');
      assert.equal(await proxyTokenStore.revokeToken('acme', revoked.tokenId), true);

      const address = '10.78.0.3';
      const first = await call(address, revoked.token);
      assert.equal(first.status, 401, 'the revoked token is rejected by auth');

      const statuses = [];
      for (let i = 0; i < LIMIT; i++) statuses.push((await call(address, revoked.token)).status);
      assert.deepEqual(statuses, Array(LIMIT).fill(401), 'after its 401 the revoked token draws on the address budget (60 more)');
      assert.equal((await call(address, junk())).status, 429, 'the address is now exhausted, so a junk bearer is refused');
      assert.equal((await call(address, revoked.token)).status, 429, 'and so is the revoked token');
    });
  });
});
