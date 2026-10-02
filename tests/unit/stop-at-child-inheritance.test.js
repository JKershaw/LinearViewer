/**
 * Child-autopilot `stopAt` inheritance (LIN-3245 / LIN-2949 P1a, required
 * correction N1).
 *
 * A child autopilot can be launched two ways, and BOTH must inherit a parent
 * run's `stopAt: 'pr'` boundary through the SAME factory stamp in
 * `createDispatchItem` — never a second lookup in the kickoff route:
 *
 *   - the fused verb: POST /api/proxy/autopilot/kickoff with the parent's
 *     `sessionId`;
 *   - the two-step shape: GET-kickoff text, then plain POST /api/proxy/dispatch
 *     with `kind: 'autopilot'` and the parent's `sessionId`.
 *
 * Scaffolded like tests/unit/close-out-is-the-persons-relay.test.js (a REAL
 * DispatchQueueStore, so the seam actually runs).
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

function makeStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

function buildApp({ dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1', grants: ['dispatch'], workspaceId: 'ws-acme' }),
      createToken: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' }),
      mintGrantBootstrap: async () => ({ token: 'bootstrap-xyz', kind: 'bootstrap', scope: 'readWrite' })
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

// Run several requests against ONE live server so the kickoff body's embedded
// `${baseUrl}` (host:port) is identical across them — a fresh port per request
// would diff only on the port and mask a real regression.
async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };
  try {
    return await fn(post);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const DISPATCH = '/api/proxy/dispatch';
const KICKOFF = '/api/proxy/autopilot/kickoff';

async function seedParent(store, stopAt = 'pr') {
  const run = await store.addItem('acme', { prompt: 'launch the runner', kind: 'autopilot', issueIdentifier: 'LIN-1', stopAt });
  return run._id;
}

describe('LIN-3245 N1 — child autopilot stopAt inheritance', () => {
  test('fused verb: a child kickoff under a stopAt:pr parent is stamped stopAt:pr', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', sessionId: parentId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const child = await store.getItemStatus('acme', res.body.id);
    assert.equal(child.stopAt, 'pr');
    assert.equal(child.sessionId, parentId, 'sanity: the child row records the parent edge');
  });

  test('two-step shape: plain /dispatch kind:autopilot under a stopAt:pr parent is stamped stopAt:pr', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const res = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId, force: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const child = await store.getItemStatus('acme', res.body.id);
    assert.equal(child.stopAt, 'pr');
  });

  test('parent without stopAt: the child is NOT stamped (both launch shapes)', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, null);

    const fused = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', sessionId: parentId });
    assert.equal(fused.status, 201, JSON.stringify(fused.body));
    assert.strictEqual((await store.getItemStatus('acme', fused.body.id)).stopAt, null);

    const twoStep = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId, force: true });
    assert.equal(twoStep.status, 201, JSON.stringify(twoStep.body));
    assert.strictEqual((await store.getItemStatus('acme', twoStep.body.id)).stopAt, null);
  });

  test('a non-autopilot kind under a stopAt:pr parent is NOT stamped', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const res = await call(app, 'post', DISPATCH, { prompt: 'work on it', kind: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual((await store.getItemStatus('acme', res.body.id)).stopAt, null);
  });

  test('no parent sessionId: an autopilot child is NOT stamped', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });

    const res = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual((await store.getItemStatus('acme', res.body.id)).stopAt, null);
  });

  test('chain: a close-out under the stamped child\u2019s own sessionId is refused CLOSE_OUT_IS_THE_PERSONS', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, 'pr');

    const child = await call(app, 'post', DISPATCH, { prompt: 'kick off the child', kind: 'autopilot', issueIdentifier: 'LIN-1', target: 'cli', sessionId: parentId, force: true });
    assert.equal(child.status, 201, JSON.stringify(child.body));
    const childId = child.body.id;
    assert.equal((await store.getItemStatus('acme', childId)).stopAt, 'pr', 'sanity: the child inherited the boundary');

    const closeOut = await call(app, 'post', DISPATCH, { prompt: 'close it out', kind: 'close-out', issueIdentifier: 'LIN-1', target: 'cli', sessionId: childId });
    assert.equal(closeOut.status, 409, JSON.stringify(closeOut.body));
    assert.equal(closeOut.body.code, 'CLOSE_OUT_IS_THE_PERSONS');
  });
});

// LIN-3246 / LIN-2949 P1b: the fused kickoff verb passes the parent boundary into
// the child's PROMPT too, reading the same run row (`getItemStatus` by sessionId)
// the factory reads to stamp the child ROW — so the prompt and the row can never
// disagree. No body-level `stopAt`; it only inherits.
describe('LIN-3246 P1b — child autopilot stopAt PROMPT inheritance', () => {
  // addItem appends the child's own session-id self-ref block (whose id differs
  // per child), so compare the base prompt before that block.
  const basePrompt = (prompt) => prompt.split('\n\n---\n\n## Your autopilot session id')[0];

  test('parent without stopAt: the child prompt is byte-identical to the no-sessionId kickoff, both without the stop block', async () => {
    const store = makeStore();
    const app = buildApp({ dispatchQueueStore: store });
    const parentId = await seedParent(store, null);

    const { withParent, withoutParent } = await withServer(app, async (post) => ({
      withParent: await post(KICKOFF, { goal: 'ship it', target: 'cli', sessionId: parentId }),
      withoutParent: await post(KICKOFF, { goal: 'ship it', target: 'cli' }),
    }));
    assert.equal(withParent.status, 201, JSON.stringify(withParent.body));
    assert.equal(withoutParent.status, 201, JSON.stringify(withoutParent.body));

    const a = basePrompt((await store.getItemStatus('acme', withParent.body.id)).prompt);
    const b = basePrompt((await store.getItemStatus('acme', withoutParent.body.id)).prompt);
    assert.equal(a, b, 'no parent stopAt must not change the child prompt');
    assert.ok(a.includes("## The finish line: dispatch the close, don't merge inline"));
    assert.ok(!a.includes('including as a stepped beat'));
  });

  for (const variant of ['standard', 'stepper']) {
    test(`parent with stopAt:pr → the ${variant} child prompt carries the stop block and the row is stamped`, async () => {
      const store = makeStore();
      const app = buildApp({ dispatchQueueStore: store });
      const parentId = await seedParent(store, 'pr');

      const res = await call(app, 'post', KICKOFF, { goal: 'ship it', target: 'cli', sessionId: parentId, variant });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const child = await store.getItemStatus('acme', res.body.id);
      assert.equal(child.stopAt, 'pr', 'the child row is stamped from the same parent fact');
      assert.match(child.prompt, /stop at the PR/);
      assert.match(child.prompt, /including as a stepped beat/);
      assert.match(child.prompt, /ready for close-out/);
      assert.doesNotMatch(child.prompt, /dispatch the `close-out` step/);
      if (variant === 'stepper') assert.match(child.prompt, /STEPPER/);
    });
  }
});
