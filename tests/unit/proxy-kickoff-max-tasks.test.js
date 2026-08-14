/**
 * LIN-1751 — route-level: POST /api/proxy/autopilot/kickoff accepts an
 * optional `maxTasks` (int >= 1), validates it up front (mirroring the
 * `presetId` precedent — see tests/unit/proxy-kickoff-presets.test.js), stores
 * it on the run, and enforces it at the dispatch-factory seam so a later
 * worker dispatch stamped with the run's own `sessionId` (its returned `id`)
 * is refused `409 BUDGET_EXHAUSTED` once it would be a genuinely new,
 * `maxTasks + 1`th distinct task.
 *
 * Mirrors the buildApp/call scaffolding in proxy-kickoff-presets.test.js, but
 * wires a REAL DispatchQueueStore (not an addItem-only fake) so the budget
 * enforcement — a real seam, not a mock — is actually exercised end to end.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function buildApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
    },
    proxyEventStore: { recordEvent: async () => {} },
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

const KICKOFF = '/api/proxy/autopilot/kickoff';
const DISPATCH = '/api/proxy/dispatch';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

describe('LIN-1751 — POST /api/proxy/autopilot/kickoff maxTasks validation', () => {
  test('no maxTasks at all: byte-identical to pre-LIN-1751 (no-budget regression)', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.maxTasks, null);
  });

  test('maxTasks: null is accepted and treated as no budget', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', maxTasks: null });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.maxTasks, null);
  });

  test('a valid maxTasks is accepted, stored, and echoed on the response', async () => {
    const app = buildApp({ dispatchQueueStore: makeStore() });
    const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', maxTasks: 50 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.maxTasks, 50);
  });

  for (const bad of [0, -1, 1.5, 'fifty', true, {}, []]) {
    test(`maxTasks: ${JSON.stringify(bad)} is rejected 400`, async () => {
      const app = buildApp({ dispatchQueueStore: makeStore() });
      const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', maxTasks: bad });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.ok(res.body.error);
    });
  }
});

describe('LIN-1751 — end-to-end budget enforcement at the dispatch seam', () => {
  test('a budgeted run admits up to maxTasks distinct tasks, then refuses the next with BUDGET_EXHAUSTED', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const kickoff = await call(app, 'post', KICKOFF, { goal: 'stack walk', target: 'cli', maxTasks: 2 });
    assert.equal(kickoff.status, 201, JSON.stringify(kickoff.body));
    const sessionId = kickoff.body.id;

    // Task 1 — admitted (count 0 -> 1).
    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));

    // Task 1's review — continues the SAME task, must never be refused even
    // once the budget is technically full (admitted below at count == budget).
    // Task 2 — admitted (count 1 -> 2, at budget).
    const t2 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-2', target: 'cli', sessionId
    });
    assert.equal(t2.status, 201, JSON.stringify(t2.body));

    // A dispatch continuing task 1 (its review) — admitted, budget is full but
    // this is not a NEW distinct task.
    const t1Review = await call(app, 'post', DISPATCH, {
      prompt: 'review it', promptName: 'review', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1Review.status, 201, JSON.stringify(t1Review.body),
      'a dispatch continuing an already-counted task must never be refused');

    // Task 3 — a genuinely NEW distinct task past the budget: refused.
    const t3 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-3', target: 'cli', sessionId
    });
    assert.equal(t3.status, 409, JSON.stringify(t3.body));
    assert.equal(t3.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t3.body.maxTasks, 2);
    assert.equal(t3.body.count, 2);
    assert.equal(t3.body.sessionId, sessionId);
  });

  test('wakes/beats/aborts under the same sessionId are never counted or refused', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const kickoff = await call(app, 'post', KICKOFF, { goal: 'stack walk', target: 'cli', maxTasks: 1 });
    const sessionId = kickoff.body.id;

    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));

    // Budget is now full (1/1). A follow-up beat on task 1's own dispatch is
    // never refused — followUpTo dispatches are structurally excluded.
    const beat = await call(app, 'post', DISPATCH, {
      prompt: 'one more thing', followUpTo: t1.body.id, sessionId
    });
    assert.equal(beat.status, 201, JSON.stringify(beat.body));

    // An abort under the same sessionId is never refused either.
    const abort = await call(app, 'post', DISPATCH, {
      abort: true, abortTo: t1.body.id, sessionId
    });
    assert.equal(abort.status, 201, JSON.stringify(abort.body));
  });

  test('a dispatch with no sessionId is never budget-refused, even under a fully-spent run', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const kickoff = await call(app, 'post', KICKOFF, { goal: 'stack walk', target: 'cli', maxTasks: 1 });
    const sessionId = kickoff.body.id;
    await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });

    // No sessionId at all — can't be tied to the budgeted run, so it is admitted.
    const untied = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-99', target: 'cli'
    });
    assert.equal(untied.status, 201, JSON.stringify(untied.body));
  });

  test('a kickoff with no maxTasks behaves exactly as today — unbounded', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const kickoff = await call(app, 'post', KICKOFF, { goal: 'stack walk', target: 'cli' });
    const sessionId = kickoff.body.id;

    for (const id of ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-4']) {
      const res = await call(app, 'post', DISPATCH, {
        prompt: 'work on it', promptName: 'implementation', issueIdentifier: id, target: 'cli', sessionId
      });
      assert.equal(res.status, 201, `${id}: ${JSON.stringify(res.body)}`);
    }
  });
});
