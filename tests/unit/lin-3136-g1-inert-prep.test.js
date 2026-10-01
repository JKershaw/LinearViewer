/**
 * LIN-3136 G1 — the inert prep the dispatch-grant switch-on builds on.
 *
 * Nothing here is mounted or read by a launch site yet (G3 wires M1/M2/M4 and
 * G5 mounts `requireGrant('dispatch')`); these pins hold each piece's contract
 * on its own:
 *   1. R3: `requireGrant('dispatch')` refuses with guidance on how to get an
 *      enqueue-capable token, and `take` keeps its sentence byte for byte.
 *   2. `isCodedGrantRefusal`: the structural codes plus OWNER_CHECK_UNAVAILABLE.
 *   3. Finding A: `validateToken` returns the token's stored `workspaceId`, and
 *      the real `authenticateProxyToken` stamps it as `req.proxyWorkspaceId`.
 *   4. The B2 writer fixture (`tests/unit/lib/dispatch-writer.js`) mints through
 *      the production path without touching the test store's owner-check seam.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { requireGrant, GRANT_REFUSAL_COPY } from '../../lib/require-grant.js';
import {
  isCodedGrantRefusal, isStructuralGrantRefusal, STRUCTURAL_GRANT_REFUSAL_CODES
} from '../../lib/proxy-preamble.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { mintDispatchWriter, armDispatchWriterOnce } from './lib/dispatch-writer.js';

const R3_DISPATCH_COPY =
  'This token cannot enqueue work (no dispatch grant). Ask the workspace owner to copy ' +
  'the prompt again from the app (Autopilot, Flight Companion and Passage Planner copies ' +
  'carry the dispatch grant), or use the runner copy from Settings.';

async function listen(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function refusalFor(name, grants) {
  const app = express();
  app.post('/gated', (req, res, next) => { req.proxyTokenGrants = grants; next(); },
    requireGrant(name), (req, res) => res.status(201).json({ ok: true }));
  return listen(app, async (base) => {
    const res = await fetch(`${base}/gated`, { method: 'POST' });
    return { status: res.status, body: await res.json() };
  });
}

describe('LIN-3136 R3 — per-grant refusal copy in requireGrant', () => {
  test('dispatch refuses with the R3 guidance, coded DISPATCH_GRANT_REQUIRED', async () => {
    for (const grants of [[], ['take'], undefined]) {
      const res = await refusalFor('dispatch', grants);
      assert.equal(res.status, 403);
      assert.deepEqual(res.body, {
        error: R3_DISPATCH_COPY,
        code: 'DISPATCH_GRANT_REQUIRED',
        category: 'auth',
        retryable: false
      });
    }
  });

  test('take keeps its existing sentence byte for byte', async () => {
    const res = await refusalFor('take', ['dispatch']);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'This endpoint requires the "take" grant');
    assert.equal(res.body.code, 'TAKE_GRANT_REQUIRED');
  });

  test('the copy table is frozen and carries only the dispatch entry', () => {
    assert.ok(Object.isFrozen(GRANT_REFUSAL_COPY));
    assert.deepEqual(Object.keys(GRANT_REFUSAL_COPY), ['dispatch']);
    assert.equal(GRANT_REFUSAL_COPY.dispatch, R3_DISPATCH_COPY);
  });

  test('a holder of the grant still passes', async () => {
    const res = await refusalFor('dispatch', ['dispatch']);
    assert.equal(res.status, 201);
  });
});

describe('LIN-3136 — isCodedGrantRefusal', () => {
  const coded = (code) => Object.assign(new Error(`refused: ${code}`), { code });

  test('true for every structural code and for OWNER_CHECK_UNAVAILABLE', () => {
    for (const code of [...STRUCTURAL_GRANT_REFUSAL_CODES, 'OWNER_CHECK_UNAVAILABLE']) {
      assert.equal(isCodedGrantRefusal(coded(code)), true, code);
    }
  });

  test('false for an uncoded failure, another code, or nothing', () => {
    const attachFailed = Object.assign(new Error('mint failed'), { proxyAttachFailed: true });
    for (const err of [null, undefined, {}, new Error('boom'), attachFailed, coded('RATE_LIMITED'), coded('')]) {
      assert.equal(isCodedGrantRefusal(err), false, String(err?.code ?? err));
    }
  });

  test('isStructuralGrantRefusal is unchanged: the transient code is not structural', () => {
    assert.equal(isStructuralGrantRefusal(coded('OWNER_CHECK_UNAVAILABLE')), false);
  });
});

function buildStampApp(store) {
  const app = express();
  app.use(express.json());
  let captured = null;
  app.use((req, res, next) => { captured = req; next(); });
  app.use(createProxyRoutes({
    proxyTokenStore: store,
    proxyEventStore: { recordEvent: async () => {}, listEvents: async () => ({ events: [], total: 0 }), listCredentialHealth: async () => ({ tokens: [] }) },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return { app, captured: () => captured };
}

async function probeInstructions(app, token, query = '') {
  return listen(app, async (base) => {
    const res = await fetch(`${base}/api/proxy/instructions${query}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': 'ws-from-header' }
    });
    await res.text();
    return res.status;
  });
}

async function grantBearingToken(store, workspaceId = 'ws-1') {
  store.setOwnerCheck(async () => ({ status: 'owner' }));
  const bootstrap = await store.mintGrantBootstrap({
    urlKey: 'acme', workspaceId, ownerAccountId: 'account-A', grants: ['dispatch'], profile: 'worker'
  });
  return store.exchangeBootstrapToken(bootstrap.token);
}

describe('LIN-3136 Finding A — the caller token\'s workspaceId reaches the request', () => {
  test('validateToken returns the stored workspaceId of a grant-bearing working token', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    const working = await grantBearingToken(store, 'ws-1');
    const validated = await store.validateToken(working.token);
    assert.equal(validated.workspaceId, 'ws-1');
    assert.deepEqual(validated.grants, ['dispatch']);
  });

  test('validateToken returns workspaceId null for a token stored without one', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    const { token } = await store.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });
    const validated = await store.validateToken(token);
    assert.ok(Object.prototype.hasOwnProperty.call(validated, 'workspaceId'));
    assert.equal(validated.workspaceId, null);
  });

  test('authenticateProxyToken stamps req.proxyWorkspaceId from the token, never from the request', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    const working = await grantBearingToken(store, 'ws-1');
    const { app, captured } = buildStampApp(store);
    const status = await probeInstructions(app, working.token, '?workspaceId=ws-from-query');
    assert.equal(status, 200);
    assert.equal(captured().proxyWorkspaceId, 'ws-1');
  });

  test('a token with no stored workspaceId stamps null', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    const { token } = await store.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });
    const { app, captured } = buildStampApp(store);
    assert.equal(await probeInstructions(app, token), 200);
    assert.equal(captured().proxyWorkspaceId, null);
  });
});

describe('LIN-3136 B2 — the dispatch-writer fixture', () => {
  test('mints readWrite + [dispatch] through the production path, valid on the test store', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    const working = await mintDispatchWriter(store, { urlKey: 'acme', ownerAccountId: 'poster-B' });
    const validated = await store.validateToken(working.token);
    assert.equal(validated.scope, 'readWrite');
    assert.deepEqual(validated.grants, ['dispatch']);
    assert.equal(validated.createdBy, 'poster-B');
    assert.equal(validated.urlKey, 'acme');
    assert.equal(validated.workspaceId, 'ws-dispatch-writer');
  });

  test('leaves the test store\'s owner-check seam untouched', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    await mintDispatchWriter(store, { urlKey: 'acme', ownerAccountId: 'poster-B' });
    // The test store never had a seam wired, so its own grant mint still fails closed.
    await assert.rejects(
      store.mintGrantBootstrap({ urlKey: 'acme', workspaceId: 'ws-dispatch-writer', ownerAccountId: 'poster-B', grants: ['dispatch'] }),
      (err) => err.code === 'OWNER_CHECK_UNAVAILABLE'
    );
  });

  test('armDispatchWriterOnce swaps exactly the next createToken, then restores the real one', async () => {
    const store = new ProxyTokenStore({ collection: createMockCollection() });
    armDispatchWriterOnce(store, { ownerAccountId: 'account-A' });
    const first = await store.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });
    const second = await store.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });
    assert.deepEqual((await store.validateToken(first.token)).grants, ['dispatch']);
    assert.deepEqual((await store.validateToken(second.token)).grants, []);
    assert.equal(Object.prototype.hasOwnProperty.call(store, 'createToken'), false, 'the prototype method is back');
  });
});
