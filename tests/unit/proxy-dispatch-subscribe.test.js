/**
 * LIN-881 — route-level: the WAKE half of a warm drip must not rely on the agent.
 *
 * Stepper warm-drip beats carried the HOLD (`waitForFollowUps:true`) but relied
 * on the orchestrating agent to hand-set the WAKE (`subscribe` + the head's
 * `sessionId`). When `subscribe` was omitted, the beat's terminal/`PENDING`
 * boundary woke nothing up-chain and every beat boundary deadlocked.
 *
 * The fix gives the two class members — plain `POST /api/proxy/dispatch` (stepper
 * beats) and `POST /api/proxy/autopilot/kickoff` (coordinator child-autopilot,
 * LIN-813) — the same server-side default `recommend-and-dispatch` already uses:
 * `subscribe` defaults ON whenever a `sessionId` is present, an explicit value
 * (true OR false) still wins, and a sessionless dispatch stays unsubscribed.
 *
 * The default lives in the route (subscribeResolved), so it is observed at the
 * dispatch seam by capturing the item handed to addItem. NODE_ENV=test applies
 * the test-token short-circuit and skips the module-level rate limiter.
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
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
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

describe('LIN-881 — plain /dispatch subscribe (wake half) default', () => {
  test('defaults subscribe:true when a sessionId is present', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', sessionId: SESSION_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.sessionId, SESSION_ID);
    assert.equal(captured.item.subscribe, true, 'a sessioned dispatch subscribes by default');
  });

  test('a warm-drip stepper beat (waitForFollowUps + followUpTo + sessionId) gets the WAKE without hand-setting it', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      // The exact shape of a live beat: HOLD present, followUpTo resumes the warm
      // session, sessionId is the head — but the agent omitted `subscribe`.
      prompt: 'beat 2/4', sessionId: SESSION_ID, followUpTo: FOLLOW_UP_ID,
      force: true, waitForFollowUps: true
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.waitForFollowUps, true, 'hold half still present');
    assert.equal(captured.item.subscribe, true, 'wake half now defaulted on — this is the LIN-881 regression fix');
  });

  test('does NOT subscribe when there is no sessionId (no head to wake)', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'one-shot' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, false, 'no sessionId → no subscribe default');
  });

  test('an explicit subscribe:false overrides the sessioned default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', sessionId: SESSION_ID, subscribe: false
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, false, 'explicit subscribe:false wins over the default');
  });

  test('an explicit subscribe:true on a non-sessioned dispatch is honoured', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', subscribe: true
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, true, 'explicit subscribe:true wins even without a sessionId');
  });

  test('rejects a non-boolean subscribe with 400', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing', subscribe: 'yes'
    });

    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});

describe('LIN-881 — /autopilot/kickoff subscribe (wake half) default', () => {
  test('a coordinator child-autopilot dispatch (sessionId present) subscribes by default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', {
      goal: 'ship LIN-1', sessionId: SESSION_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.sessionId, SESSION_ID);
    assert.equal(captured.item.subscribe, true, 'child dispatched by a coordinator wakes it by default');
  });

  test('a top-level kickoff (no sessionId) stays subscribe:false', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', { goal: 'walk the stack' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, false, 'no parent edge → single-head behavior unchanged');
  });

  test('an explicit subscribe:false overrides the sessioned default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/autopilot/kickoff', {
      goal: 'ship LIN-1', sessionId: SESSION_ID, subscribe: false
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.subscribe, false, 'explicit subscribe:false wins over the default');
  });
});
