/**
 * LIN-3130 S2a (beat 2) — runner proxy routes, the path-scoped `take` gate,
 * path-scope isolation, and the /api/dispatch/* regression.
 *
 * These drive the REAL `createProxyRoutes` composer over HTTP (the
 * `BASE_DEPS`/`buildApp`/`call` harness), because the mount — not the
 * sub-router factory in isolation — is what can drop a dependency or shadow a
 * path. The dispatch queue/token/halt/cache stores are supplied per-test
 * (beat 4 lifts `dispatchQueueStore`/`dispatchTokenStore`/`sessionsFeedCache`
 * into `BASE_DEPS`).
 *
 * Gate semantics: the runner mount's first statement is the PATH-SCOPED
 * `router.use('/api/proxy/runner', proxyLimiter, authenticateProxyToken,
 * requireGrant('take'))`. A bearer with no `take` grant is refused at the
 * mount; every other proxy path must fall through to its own handler.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const RUNNER_POLL = '/api/proxy/runner/poll';
const TAKE_ID = '00000000-0000-4000-8000-000000000000';
const RUNNER_TAKE = `/api/proxy/runner/take/${TAKE_ID}`;
const RUNNER_FEEDBACK = `/api/proxy/runner/feedback/${TAKE_ID}`;

// A grant-bearing runner token (the runner carries both grants per J2).
function runnerToken({ grants = ['take', 'dispatch'], scope = 'readWrite', createdBy = 'u1' } = {}) {
  return {
    tokenId: 't1',
    urlKey: ACME,
    label: 'runner',
    scope,
    createdBy,
    grants,
  };
}

/**
 * Build the real composer with a controllable runner-token store and dispatch
 * fakes. Returns the app plus recorded store calls.
 */
function makeRunnerApp({
  token = runnerToken(),
  items = [],
  taken = null,
  feedbackResult = { success: true, feedbackCount: 1 },
  dispatchTokens = [],
  halt = null,
  sessionsFeedCache = null,
  composerOverrides = {},
} = {}) {
  const calls = { pollAvailable: [], takeItem: [], addFeedback: [], validateToken: [] };
  const dispatchQueueStore = {
    pollAvailable: async (urlKey) => { calls.pollAvailable.push(urlKey); return items; },
    takeItem: async (id, urlKey, label) => { calls.takeItem.push([id, urlKey, label]); return taken; },
    addFeedback: async (id, urlKey, feedback, label, provision) => {
      calls.addFeedback.push({ id, urlKey, feedback, label, provision });
      return feedbackResult;
    },
  };
  const dispatchTokenStore = { listTokens: async () => dispatchTokens };
  const workspaceHaltStore = {
    getWorkspaceHalt: async () => halt,
    getLastKnownHalt: () => null,
    setWorkspaceHalt: async () => {},
    clearWorkspaceHalt: async () => {},
  };
  const proxyTokenStore = {
    validateToken: async (bearer) => { calls.validateToken.push(bearer); return token; },
    listTokens: async () => [],
    describeRejectionCause: async () => null,
  };
  const app = buildApp({
    proxyTokenStore,
    dispatchQueueStore,
    dispatchTokenStore,
    workspaceHaltStore,
    sessionsFeedCache,
    ...composerOverrides,
  });
  return { app, calls };
}

// ── Grant gate ──────────────────────────────────────────────────────────────

describe('LIN-3130 S2a — runner mount `take` grant gate', () => {
  for (const [name, token] of [
    ['readWrite token with no grants', runnerToken({ grants: [] })],
    ['worker-exchanged token (readWrite, no grants)', runnerToken({ grants: [], createdBy: 'u1' })],
    ['ownerless-grant token (createdBy null, grants emptied by the store)', runnerToken({ grants: [], createdBy: null })],
    ['a token carrying only `dispatch`', runnerToken({ grants: ['dispatch'] })],
  ]) {
    test(`${name} -> 403 TAKE_GRANT_REQUIRED on all three runner routes`, async () => {
      const { app } = makeRunnerApp({ token });

      const poll = await call(app, 'GET', RUNNER_POLL);
      assert.equal(poll.status, 403, `poll: ${JSON.stringify(poll.body)}`);
      assert.equal(poll.body.code, 'TAKE_GRANT_REQUIRED');
      assert.equal(poll.body.category, 'auth');
      assert.equal(poll.body.retryable, false);
      assert.ok(!('bootstrapToken' in poll.body), 'poll 403 must not leak a bootstrapToken');

      const take = await call(app, 'POST', RUNNER_TAKE, { body: {} });
      assert.equal(take.status, 403, `take: ${JSON.stringify(take.body)}`);
      assert.equal(take.body.code, 'TAKE_GRANT_REQUIRED');

      const feedback = await call(app, 'POST', RUNNER_FEEDBACK, { body: {} });
      assert.equal(feedback.status, 403, `feedback: ${JSON.stringify(feedback.body)}`);
      assert.equal(feedback.body.code, 'TAKE_GRANT_REQUIRED');
    });
  }

  test('a `take`-bearing token reaches the poll handler (gate is not a blanket 403)', async () => {
    const { app, calls } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), items: [{ id: 'd1' }] });
    const res = await call(app, 'GET', RUNNER_POLL);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(calls.pollAvailable, [ACME], 'the handler ran, so the gate let the request through');
  });
});

// ── Path scope ──────────────────────────────────────────────────────────────

describe('LIN-3130 S2a — the gate is path-scoped, not path-less', () => {
  test('a token without `take` still reaches GET /api/proxy/dispatch/halt normally', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: [] }) });
    const res = await call(app, 'GET', '/api/proxy/dispatch/halt');
    assert.equal(res.status, 200, `unrelated proxy route must be unaffected: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body, { halt: null });
  });

  test('a token without `take` still reaches GET /api/proxy/me normally', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: [] }) });
    const res = await call(app, 'GET', '/api/proxy/me');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.id, 'u1');
  });

  test('a neighbouring path /api/proxy/runner-x is NOT captured by the gate', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: [] }) });
    const res = await call(app, 'GET', '/api/proxy/runner-x');
    // No route matches it, and the path-scoped gate must not answer for it —
    // Express's own default 404, never the gate's 403.
    assert.equal(res.status, 404, `expected fall-through 404, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.notEqual(res.body?.code, 'TAKE_GRANT_REQUIRED');
  });

  test('a proxy route mounted AFTER the runner (flight-companion) is not gated by the runner gate', async () => {
    // The decisive path-scope probe: /api/proxy/flight-companion/* is mounted
    // after createProxyRunnerRoutes, so a PATH-LESS `router.use(gate)` inside
    // the runner sub-router would answer it (403) before it ever reaches the
    // flight-companion handler. A no-take token must reach the handler's own
    // 503 instead (BASE_DEPS carries no savedChatStore — the inventory row J
    // contract), proving the gate is scoped to /api/proxy/runner only.
    const { app } = makeRunnerApp({ token: runnerToken({ grants: [] }) });
    const res = await call(app, 'GET', '/api/proxy/flight-companion/transcripts');
    assert.equal(res.status, 503, `expected the handler's own 503, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body, { error: 'Saved chat transcripts store is not configured' });
  });
});

// ── Poll ────────────────────────────────────────────────────────────────────

describe('LIN-3130 S2a — GET /api/proxy/runner/poll', () => {
  test('empty queue, no halt -> exact { items, otherConsumerLastSeenAt }', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), items: [] });
    const res = await call(app, 'GET', RUNNER_POLL);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { items: [], otherConsumerLastSeenAt: null });
  });

  test('items + halt -> { items, halt, otherConsumerLastSeenAt }', async () => {
    const { app } = makeRunnerApp({
      token: runnerToken({ grants: ['take'] }),
      items: [{ id: 'd1' }, { id: 'd2' }],
      halt: { _id: ACME, mode: 'pause', setAt: '2026-01-01T00:00:00.000Z', setBy: 'alice' },
    });
    const res = await call(app, 'GET', RUNNER_POLL);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, {
      items: [{ id: 'd1' }, { id: 'd2' }],
      halt: { mode: 'pause', setAt: '2026-01-01T00:00:00.000Z', setBy: 'alice' },
      otherConsumerLastSeenAt: null,
    });
  });

  test('otherConsumerLastSeenAt is the dispatch tokens\' most recent lastUsedAt', async () => {
    const { app } = makeRunnerApp({
      token: runnerToken({ grants: ['take'] }),
      dispatchTokens: [
        { lastUsedAt: '2026-01-01T00:00:00.000Z' },
        { lastUsedAt: '2026-02-02T00:00:00.000Z' },
      ],
    });
    const res = await call(app, 'GET', RUNNER_POLL);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.otherConsumerLastSeenAt, '2026-02-02T00:00:00.000Z');
  });

  test('pollAvailable rejection still 500s (halt read is independently bounded)', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }) });
    // Force pollAvailable to throw by replacing the store after build is not
    // possible; build a dedicated app instead.
    const dispatchQueueStore = { pollAvailable: async () => { throw new Error('boom'); } };
    const app2 = buildApp({
      proxyTokenStore: { validateToken: async () => runnerToken({ grants: ['take'] }), listTokens: async () => [], describeRejectionCause: async () => null },
      dispatchQueueStore,
      dispatchTokenStore: { listTokens: async () => [] },
      workspaceHaltStore: { getWorkspaceHalt: async () => null, getLastKnownHalt: () => null },
    });
    void app;
    const res = await call(app2, 'GET', RUNNER_POLL);
    assert.equal(res.status, 500);
  });
});

// ── Take ────────────────────────────────────────────────────────────────────

describe('LIN-3130 S2a — POST /api/proxy/runner/take/:id', () => {
  test('a taken item -> { item, dispatchId }, and takeItem gets (id, urlKey, label)', async () => {
    const { app, calls } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), taken: { id: 'd1', prompt: 'x' } });
    const res = await call(app, 'POST', RUNNER_TAKE, { body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { item: { id: 'd1', prompt: 'x' }, dispatchId: 'd1' });
    assert.deepEqual(calls.takeItem, [[TAKE_ID, ACME, 'runner']]);
  });

  test('unknown/absent item -> 404 with the shared error body', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), taken: null });
    const res = await call(app, 'POST', RUNNER_TAKE, { body: {} });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.deepEqual(res.body, { error: 'Item not found or already taken' });
  });

  test('a non-UUID id -> 400 Invalid item ID format', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }) });
    const res = await call(app, 'POST', '/api/proxy/runner/take/not-a-uuid', { body: {} });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.deepEqual(res.body, { error: 'Invalid item ID format' });
  });
});

// ── Feedback ────────────────────────────────────────────────────────────────

describe('LIN-3130 S2a — POST /api/proxy/runner/feedback/:id', () => {
  test('a missing message -> 400 via the SHARED validator (no store touched)', async () => {
    const { app, calls } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }) });
    const res = await call(app, 'POST', RUNNER_FEEDBACK, { body: {} });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.deepEqual(res.body, { error: 'message is required and must be a string' });
    assert.equal(calls.addFeedback.length, 0, 'the validator runs before any store call');
  });

  test('feedback the store refuses -> 404 with the shared error body', async () => {
    const { app } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), feedbackResult: null });
    const res = await call(app, 'POST', RUNNER_FEEDBACK, { body: { message: 'done' } });
    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.deepEqual(res.body, { error: 'Item not found or feedback not allowed' });
  });

  test('accepted feedback -> store result echoed, addFeedback gets (id, urlKey, feedback, label, provisioner)', async () => {
    const { app, calls } = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), feedbackResult: { success: true, feedbackCount: 3 } });
    const res = await call(app, 'POST', RUNNER_FEEDBACK, { body: { message: '[done] shipped', kind: 'heartbeat' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { success: true, feedbackCount: 3 });
    assert.equal(calls.addFeedback.length, 1);
    assert.equal(calls.addFeedback[0].id, TAKE_ID);
    assert.equal(calls.addFeedback[0].urlKey, ACME);
    assert.equal(calls.addFeedback[0].label, 'runner');
    assert.equal(calls.addFeedback[0].feedback.message, '[done] shipped');
    assert.equal(calls.addFeedback[0].feedback.kind, 'heartbeat');
    assert.equal(typeof calls.addFeedback[0].provision, 'function', 'the wake provisioner is passed through');
  });

  test('decision-withdrawn clears sessionsFeedCache; an ordinary write does not', async () => {
    const cleared = [];
    const sessionsFeedCache = { clear: (k) => cleared.push(k) };

    const withdrawal = JSON.stringify({ decision_id: 'd-1', reason: 'superseded' });
    const a = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), sessionsFeedCache });
    const resA = await call(a.app, 'POST', RUNNER_FEEDBACK, { body: { message: withdrawal, kind: 'decision-withdrawn' } });
    assert.equal(resA.status, 200, JSON.stringify(resA.body));
    assert.deepEqual(cleared, [ACME]);

    const b = makeRunnerApp({ token: runnerToken({ grants: ['take'] }), sessionsFeedCache });
    const resB = await call(b.app, 'POST', RUNNER_FEEDBACK, { body: { message: 'heartbeat', kind: 'heartbeat' } });
    assert.equal(resB.status, 200, JSON.stringify(resB.body));
    assert.deepEqual(cleared, [ACME], 'an ordinary write must not clear the cache');
  });
});

// ── /api/dispatch/* regression ──────────────────────────────────────────────

describe('LIN-3130 S2a — /api/dispatch/* regression (consumer routes untouched)', () => {
  function dispatchApp({ halt = null, items = [] } = {}) {
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: { pollAvailable: async () => items },
      dispatchTokenStore: {
        validateToken: async (token) => (token === 'good' ? { urlKey: ACME, label: 'runner', createdBy: 'acct' } : null),
      },
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      workspaceHaltStore: halt ? { getWorkspaceHalt: async () => halt, getLastKnownHalt: () => null } : null,
    }));
    return app;
  }

  test('GET /api/dispatch/poll stays exactly { items } when no halt is set', async () => {
    const app = dispatchApp({ items: [{ id: 'd1' }] });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/dispatch/poll`, { headers: { Authorization: 'Bearer good' } });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.equal(text, JSON.stringify({ items: [{ id: 'd1' }] }), 'no otherConsumerLastSeenAt, no halt key');
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test('GET /api/dispatch/poll stays exactly { items, halt } when a halt is set', async () => {
    const haltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    const setAt = new Date('2026-01-01T00:00:00.000Z');
    await haltStore.setWorkspaceHalt(ACME, { mode: 'pause', setBy: 'alice', now: setAt });

    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: { pollAvailable: async () => [{ id: 'd1' }] },
      dispatchTokenStore: { validateToken: async () => ({ urlKey: ACME, label: 'runner', createdBy: 'acct' }) },
      workspaceFromUrl: (req, res, next) => next(),
      userPreferencesStore: {},
      workspaceHaltStore: haltStore,
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/dispatch/poll`, { headers: { Authorization: 'Bearer good' } });
      const text = await res.text();
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(text), { items: [{ id: 'd1' }], halt: { mode: 'pause', setAt: setAt.toISOString(), setBy: 'alice' } });
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
