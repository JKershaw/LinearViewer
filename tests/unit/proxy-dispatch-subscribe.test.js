/**
 * LIN-901 — route-level: subscription is DECLARED on the edge (LIN-900 §6).
 *
 * §6: "A dispatcher MUST NOT reconstruct subscription intent from incidental
 * fields (e.g. 'has a sessionId'); it is declared, once, on the edge." So the old
 * LIN-881 `subscribe` default-on-when-sessioned is REMOVED: an undeclared edge is
 * always `terminal-only`, regardless of sessionId. A caller that wants a worker's
 * every event (incl. PENDING-external, each stepper beat) to wake it declares
 * `subscription: 'everything'` explicitly — the autopilot prompts are the sole
 * declarers. The value is a hard enum ('everything' | 'terminal-only'); any other
 * value is a 400 (no legacy boolean).
 *
 * The default lives in the route (subscriptionResolved), observed at the dispatch
 * seam by capturing the item handed to addItem. NODE_ENV=test applies the
 * test-token short-circuit and skips the module-level rate limiter.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      // LIN-1175: claude-code (default harness) dispatch now fails closed without a
      // mintable token; give the stub a minting createToken like production.
      createToken: async () => ({ token: "test-bootstrap", kind: "bootstrap", scope: "readWrite" }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const FOLLOW_UP_ID = '99999999-8888-7777-6666-555555555555';

describe('LIN-901 — plain /dispatch subscription is declared, not reconstructed (§6)', () => {
  test('a sessioned dispatch with NO declared subscription defaults to terminal-only (no !!sessionId reconstruction)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', sessionId: SESSION_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.sessionId, SESSION_ID);
    assert.equal(captured.item.subscription, 'terminal-only', 'sessionId no longer implies a subscription (§6 removes the LIN-881 reconstruction)');
  });

  test('a warm-drip stepper beat DECLARES subscription:everything and it is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      // The exact shape of a live beat: HOLD present, followUpTo resumes the warm
      // session, sessionId is the head, and the beat DECLARES the up-chain wake.
      prompt: 'beat 2/4', sessionId: SESSION_ID, followUpTo: FOLLOW_UP_ID,
      force: true, waitForFollowUps: true, subscription: 'everything'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.waitForFollowUps, true, 'hold half present');
    assert.equal(captured.item.subscription, 'everything', 'the declared wake half is honoured — the prompt is the sole declarer');
  });

  test('an explicit subscription:terminal-only is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', sessionId: SESSION_ID, subscription: 'terminal-only'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'terminal-only');
  });

  test('a non-sessioned dispatch with no declared subscription defaults to terminal-only', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'one-shot' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'terminal-only');
  });

  test('rejects an invalid subscription value with 400 (hard enum, no legacy boolean)', async () => {
    const app = buildApp({});
    for (const bad of ['yes', true, 'all', 'none', 1]) {
      const res = await call(app, 'post', '/api/proxy/dispatch', {
        prompt: 'do the thing', subscription: bad
      });
      assert.equal(res.status, 400, `subscription:${JSON.stringify(bad)} should be 400, got ${res.status}`);
      assert.match(res.body.error, /subscription must be one of/, 'names the enum in the error');
    }
  });
});

describe('LIN-901 — /autopilot/kickoff subscription is declared, not reconstructed (§6)', () => {
  test('a coordinator child-autopilot dispatch (sessionId present, undeclared) defaults to terminal-only', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', {
      goal: 'ship LIN-1', sessionId: SESSION_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.sessionId, SESSION_ID);
    assert.equal(captured.item.subscription, 'terminal-only', 'sessionId alone no longer subscribes to everything (§6)');
  });

  test('a coordinator that wants every child event DECLARES subscription:everything', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', {
      goal: 'ship LIN-1', sessionId: SESSION_ID, subscription: 'everything'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'everything', 'the coordinator declares the up-chain edge explicitly');
  });

  test('a top-level kickoff (no sessionId) defaults to terminal-only', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'walk the stack' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscription, 'terminal-only', 'single-head behavior unchanged');
  });

  test('rejects an invalid subscription value with 400', async () => {
    const app = buildApp({});
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', {
      goal: 'ship LIN-1', sessionId: SESSION_ID, subscription: true
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /subscription must be one of/);
  });
});
