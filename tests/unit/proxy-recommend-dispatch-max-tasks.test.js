/**
 * LIN-2934 (R3/R4) — route-level: POST /api/proxy/recommend-and-dispatch's two
 * 201 response bodies (the verb-override arm, `kind` set — a plain `res.json`;
 * and the recommendation-derived/LLM arm — a `keepalive.send`) must echo the
 * declared budget bounds and `budgetPosition` too, matching the plain
 * POST /api/proxy/dispatch 201 (tests/unit/proxy-dispatch-max-tasks.test.js)
 * and routes/dispatch.js's 201. Before this fix neither arm echoed either
 * field: the kickoff prose calls this fused verb the orchestrator's MAIN
 * dispatch path, so its own "n of N" chip depends on the same seam the plain
 * /dispatch handler already exposed it on.
 *
 * Scaffolded like proxy-dispatch-max-tasks.test.js (a REAL DispatchQueueStore
 * over createMockCollection, so the dispatch-factory budget guard actually
 * runs) plus proxy-recommend-dispatch-subscribe.test.js's `kind` (override) /
 * no-`kind` (recommendation-derived, TEST-14 test-token descent, no live
 * OpenRouter call) split for exercising BOTH 201 arms.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp({ dispatchQueueStore, recordedEvents = null }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async (evt) => { if (recordedEvents) recordedEvents.push(evt); } },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

function makeStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
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
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const DISPATCH = '/api/proxy/dispatch';
const RECOMMEND_DISPATCH = '/api/proxy/recommend-and-dispatch';

describe('LIN-2934 R3 — recommend-and-dispatch 201s echo the declared bounds and budgetPosition', () => {
  test('verb-override arm (kind set): budgetPosition.sessionsPerTask is echoed on the 201', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxSessionsPerTask: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    const sessionId = run.body.id;

    const t1 = await call(app, 'post', RECOMMEND_DISPATCH, {
      issueIdentifier: 'TEST-1', kind: 'implementation', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));
    assert.equal(t1.body.override, true, 'sanity: this is the verb-override arm');
    assert.equal(t1.body.maxSessionsPerTask, null, 'sanity: the bound lives on the anchor row, not this worker row');
    assert.deepEqual(t1.body.budgetPosition.sessionsPerTask, { count: 1, maxSessionsPerTask: 2 });
  });

  test('verb-override arm (kind set): a refused third dispatch to the same task still 409s (unaffected by the new echo)', async () => {
    const recordedEvents = [];
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store, recordedEvents });

    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxSessionsPerTask: 1 });
    const sessionId = run.body.id;

    const t1 = await call(app, 'post', RECOMMEND_DISPATCH, { issueIdentifier: 'TEST-1', kind: 'implementation', sessionId });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));

    // A DIFFERENT kind, so this hits the budget guard rather than the
    // unrelated same-issue-same-kind DUPLICATE_DISPATCH cooldown.
    const t2 = await call(app, 'post', RECOMMEND_DISPATCH, { issueIdentifier: 'TEST-1', kind: 'review', sessionId });
    assert.equal(t2.status, 409, JSON.stringify(t2.body));
    assert.equal(t2.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t2.body.bound, 'sessionsPerTask');
  });

  test('recommendation-derived (LLM) arm (no kind, TEST-14 test-token descent): budgetPosition.sessionsPerTask is echoed on the 201', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxSessionsPerTask: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    const sessionId = run.body.id;

    // No `kind`: the test-token descent resolves TEST-14 to an `implement`
    // action deterministically (no live OpenRouter call), landing on the
    // keepalive-armed recommendation-derived creation seam.
    const t1 = await call(app, 'post', RECOMMEND_DISPATCH, { issueIdentifier: 'TEST-14', sessionId });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));
    assert.equal(t1.body.override, undefined, 'sanity: this is the LLM-derived arm, not the override arm');
    assert.deepEqual(t1.body.budgetPosition.sessionsPerTask, { count: 1, maxSessionsPerTask: 2 });
  });
});
