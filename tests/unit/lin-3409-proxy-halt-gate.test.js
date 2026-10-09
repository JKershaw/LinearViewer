/**
 * LIN-3409 item 8 — POST/DELETE /api/proxy/dispatch/halt are owner-only, through
 * the REAL composed proxy router (createProxyRoutes) and the real halt handlers.
 *
 *  - an owner's token (a Proxy-page token minted after the workspace-id stamp, or an
 *    owner runner copy) halts and resumes;
 *  - a member's token gets 403 RUNNER_OWNER_ONLY and nothing is written;
 *  - a token with `workspaceId: null` gets 409 PROXY_TOKEN_UNBOUND with one true
 *    message, before the resolver (the seam is never consulted);
 *  - NEVER 503: every refusal reaches logEvent and the wire as <= 500 and no
 *    `[credential-rejected]` trail is emitted (the LIN-3025 constraint);
 *  - fail-closed once for the lane: the seam absent on halt is 500, no write;
 *  - GET stays read-only and ungated.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';

const PATH = '/api/proxy/dispatch/halt';
const UNBOUND_MESSAGE =
  'This token is not bound to a workspace, so it cannot halt the runner. ' +
  'Mint a new token on the Proxy page, or use the Dispatch page.';

function haltStoreSpy() {
  const writes = [];
  return {
    writes,
    store: {
      async getWorkspaceHalt() { return null; },
      async setWorkspaceHalt(...args) { writes.push(['set', ...args]); },
      async clearWorkspaceHalt(...args) { writes.push(['clear', ...args]); }
    }
  };
}

const token = ({ workspaceId = 'ws-acme', createdBy = 'owner-1', scope = 'readWrite' } = {}) => ({
  ...BASE_DEPS().proxyTokenStore,
  validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope, createdBy, workspaceId })
});

function harness({ tokenOpts, ownerCheck, withSeam = true } = {}) {
  const spy = haltStoreSpy();
  const events = [];
  const overrides = {
    workspaceHaltStore: spy.store,
    proxyTokenStore: token(tokenOpts),
    proxyEventStore: { ...BASE_DEPS().proxyEventStore, recordEvent: async (e) => { events.push(e); } }
  };
  if (withSeam) overrides.workspaceOwnerCheck = ownerCheck;
  return { app: buildApp(overrides), spy, events };
}

const OWNER_ONLY_IF_OWNER_1 = async ({ accountId }) => ({ status: accountId === 'owner-1' ? 'owner' : 'not-owner' });
const METHODS = [['POST', { body: { mode: 'pause' } }], ['DELETE', {}]];

describe('LIN-3409: proxy halt owner gate', () => {
  for (const [method, opts] of METHODS) {
    test(`${method}: the owner's token succeeds and writes; the seam is asked about the token's own workspace and creator`, async () => {
      const seen = [];
      const h = harness({ ownerCheck: async (args) => { seen.push(args); return OWNER_ONLY_IF_OWNER_1(args); } });
      const res = await call(h.app, method, PATH, opts);
      assert.equal(res.status, 200);
      assert.equal(h.spy.writes.length, 1);
      assert.deepEqual(seen, [{ workspaceId: 'ws-acme', accountId: 'owner-1' }]);
    });

    test(`${method}: a member's token gets 403 RUNNER_OWNER_ONLY with the shared copy and nothing is written`, async () => {
      const h = harness({ tokenOpts: { createdBy: 'member-2' }, ownerCheck: OWNER_ONLY_IF_OWNER_1 });
      const res = await call(h.app, method, PATH, opts);
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'RUNNER_OWNER_ONLY');
      assert.equal(res.body.error, "Only this workspace's owner can act on its runner.");
      assert.deepEqual(h.spy.writes, []);
    });

    test(`${method}: a workspaceId:null token gets 409 PROXY_TOKEN_UNBOUND (true copy), before the resolver, nothing written`, async () => {
      let seamCalls = 0;
      const h = harness({
        tokenOpts: { workspaceId: null },
        ownerCheck: async () => { seamCalls += 1; return { status: 'owner' }; }
      });
      const res = await call(h.app, method, PATH, opts);
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'PROXY_TOKEN_UNBOUND');
      assert.equal(res.body.error, UNBOUND_MESSAGE);
      assert.equal(seamCalls, 0, 'an unbound token is refused before the owner resolver, not by it');
      assert.deepEqual(h.spy.writes, []);
    });

    test(`${method}: fail-closed once for the lane — the seam absent is 500 (never 503) and writes nothing`, async () => {
      const h = harness({ ownerCheck: null });
      const res = await call(h.app, method, PATH, opts);
      assert.equal(res.status, 500);
      assert.equal(res.body.code, 'OWNER_CHECK_UNAVAILABLE');
      assert.deepEqual(h.spy.writes, []);
    });
  }

  test('createProxyRoutes with no workspaceOwnerCheck key at all fails closed the same way', async () => {
    const h = harness({ withSeam: false });
    const res = await call(h.app, 'POST', PATH, { body: { mode: 'pause' } });
    assert.equal(res.status, 500);
    assert.deepEqual(h.spy.writes, []);
  });

  test('an invalid mode is still a 400 before the gate (validation order unchanged)', async () => {
    let seamCalls = 0;
    const h = harness({ ownerCheck: async () => { seamCalls += 1; return { status: 'not-owner' }; } });
    const res = await call(h.app, 'POST', PATH, { body: { mode: 'resume' } });
    assert.equal(res.status, 400);
    assert.equal(seamCalls, 0);
  });

  test('GET is read-only and ungated: a member / unbound / seam-less token still reads', async () => {
    for (const tokenOpts of [{ createdBy: 'member-2' }, { workspaceId: null }, { scope: 'read' }]) {
      const h = harness({ tokenOpts, ownerCheck: null });
      const res = await call(h.app, 'GET', PATH);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { halt: null });
    }
  });
});

describe('LIN-3409: proxy halt refusals are never 503 (LIN-3025 credential-rejection trail)', () => {
  // Every refusal the gate can produce, with how to provoke it.
  const REFUSALS = [
    { code: 'GRANT_OWNERLESS',        tokenOpts: { createdBy: null },        ownerCheck: async () => ({ status: 'owner' }),     want: 500 },
    { code: 'OWNER_CHECK_UNAVAILABLE', tokenOpts: {},                          ownerCheck: async () => { throw new Error('down'); }, want: 500 },
    { code: 'WORKSPACE_OWNER_UNSET',  tokenOpts: {},                          ownerCheck: async () => ({ status: 'no-owner' }),   want: 409 },
    { code: 'RUNNER_OWNER_ONLY',      tokenOpts: {},                          ownerCheck: async () => ({ status: 'not-owner' }),  want: 403 },
    { code: 'PROXY_TOKEN_UNBOUND',    tokenOpts: { workspaceId: null },        ownerCheck: async () => ({ status: 'owner' }),     want: 409 }
  ];

  for (const [method, opts] of METHODS) {
    for (const r of REFUSALS) {
      test(`${method} ${r.code}: logEvent and the wire see ${r.want}, never 503, and no [credential-rejected] line`, async (t) => {
        const logged = [];
        const warn = t.mock.method(console, 'warn', (...a) => { logged.push(a.join(' ')); });
        const info = t.mock.method(console, 'log', (...a) => { logged.push(a.join(' ')); });
        const error = t.mock.method(console, 'error', (...a) => { logged.push(a.join(' ')); });
        const h = harness({ tokenOpts: r.tokenOpts, ownerCheck: r.ownerCheck });
        const res = await call(h.app, method, PATH, opts);
        warn.mock.restore(); info.mock.restore(); error.mock.restore();

        assert.equal(res.status, r.want);
        assert.equal(res.body.code, r.code);
        assert.notEqual(res.status, 503);
        const halt = h.events.filter(e => e.endpoint === PATH);
        assert.deepEqual(halt.map(e => e.status), [r.want], 'exactly one event, with the mapped status');
        assert.ok(!halt.some(e => e.status === 503));
        assert.ok(!logged.some(l => l.includes('credential-rejected')), `unexpected credential-rejection trail: ${logged.join(' | ')}`);
        assert.deepEqual(h.spy.writes, []);
      });
    }
  }
});
