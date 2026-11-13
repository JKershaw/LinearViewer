/**
 * LIN-4468 review (Finding 1 and Finding 2): a wake token carries the RESUMED parent's stage, and a
 * restricted follow-up through enqueueFollowUp carries its own kind's writes with the parent's ticket.
 *
 * A wake resumes the parent session (lib/dispatch-store.js `_deliverWake`), not the row that reported,
 * so its token must take the parent's kind and ticket on BOTH feedback routes: the dispatch route
 * (/api/dispatch/feedback/:itemId) and the runner route (/api/proxy/runner/feedback/:id). Every witness
 * here runs the real chain with no stub on the token path: a real DispatchQueueStore over mock
 * collections, a real ProxyTokenStore, mint -> exchange -> validate.
 *
 * The held-wake release (server.js, setWakeCredentialProvisionerFactory) is NOT covered here: its
 * factory receives no resumed-parent id, and that is an open DECISION on LIN-4448.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createProxyRunnerRoutes } from '../../routes/proxy-runner.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { enqueueFollowUp } from '../../lib/follow-up-dispatch.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const OWNER = 'account-A';
const RUNNER_TOKEN_ID = 'runner-token-1';

async function makeWorld() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  const tokenStore = new ProxyTokenStore({ collection: createMockCollection() });
  const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
  const { token: consumerToken } = await dispatchTokenStore.createToken(URL_KEY, 'consumer', OWNER);
  return { store, collection, historyCollection, tokenStore, dispatchTokenStore, consumerToken };
}

/** A parent session, taken so it lives in history as a real run does, on the stage and ticket it works. */
async function seedParent(world, { kind, issueIdentifier }) {
  const parent = await world.store.addItem(URL_KEY, { prompt: 'parent work', kind, issueIdentifier, harness: 'claude-code' });
  await world.store.takeItem(parent._id, URL_KEY, 'orchestrator');
  return parent._id;
}

/** A child reporting to `parentId`, taken by the consumer token (dispatch route) or the runner (runner route). */
async function seedChild(world, parentId, { kind, route }) {
  const child = await world.store.addItem(URL_KEY, {
    prompt: 'child work', kind, issueIdentifier: 'LIN-42', subscription: 'terminal-only', sessionId: parentId
  });
  if (route === 'dispatch') await world.store.takeItem(child._id, URL_KEY, 'consumer');
  else await world.store.takeItem(child._id, URL_KEY, 'runner', RUNNER_TOKEN_ID);
  return child._id;
}

function dispatchApp(world) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: world.store,
    dispatchTokenStore: world.dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: world.tokenStore
  }));
  return app;
}

function runnerApp(world) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRunnerRoutes({
    proxyLimiter: (req, res, next) => next(),
    authenticateProxyToken: (req, res, next) => {
      req.proxyUrlKey = URL_KEY;
      req.proxyTokenLabel = 'runner';
      req.proxyTokenId = RUNNER_TOKEN_ID;
      req.proxyCreatedBy = OWNER;
      next();
    },
    requireGrant: () => (req, res, next) => next(),
    logEvent: () => {},
    dispatchQueueStore: world.store,
    dispatchTokenStore: {},
    proxyTokenStore: world.tokenStore,
    workspaceHaltStore: {}
  }));
  return app;
}

async function post(app, path, body, bearer) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

/** The one wake row a feedback write enqueued for `parentId`. */
function wakeFor(world, parentId) {
  const wakes = [...world.collection._docs, ...world.historyCollection._docs]
    .filter(d => d.kind === 'wake' && d.followUpTo === parentId);
  assert.equal(wakes.length, 1, 'the wake enqueued exactly once');
  return wakes[0];
}

/** The stamp the wake's own bootstrap exchanges to: mint -> exchange -> validate, no stubs. */
async function exchangedStamp(world, bootstrapToken) {
  assert.ok(bootstrapToken, 'the wake carries its own bootstrap');
  const working = await world.tokenStore.exchangeBootstrapToken(bootstrapToken);
  assert.ok(working?.token, 'the wake bootstrap exchanges for a working token');
  const validated = await world.tokenStore.validateToken(working.token);
  return { writes: validated.writes, writesTarget: validated.writesTarget };
}

const ROUTES = {
  dispatch: { path: (id) => `/api/dispatch/feedback/${id}`, bearer: (world) => world.consumerToken, app: dispatchApp },
  runner: { path: (id) => `/api/proxy/runner/feedback/${id}`, bearer: () => 'runner-bearer', app: runnerApp }
};

for (const route of ['dispatch', 'runner']) {
  const { path, bearer, app } = ROUTES[route];

  describe(`LIN-4468 review F1 — ${route} route: the wake token takes the RESUMED parent's stage`, () => {
    test('a work parent woken by a restricted child mints an unrestricted wake (the parent\'s stage, not the child\'s)', async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { kind: 'implementation', issueIdentifier: 'LIN-9' });
      const childId = await seedChild(world, parentId, { kind: 'survey-task', route });
      const res = await post(app(world), path(childId), { message: '[done] surveyed' }, bearer(world));
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const stamp = await exchangedStamp(world, wakeFor(world, parentId).bootstrapToken);
      assert.deepEqual(stamp, { writes: null, writesTarget: null });
    });

    test('a restricted parent woken by a work child keeps its own stage and its own ticket, not the child\'s', async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { kind: 'look-into', issueIdentifier: 'LIN-9' });
      const childId = await seedChild(world, parentId, { kind: 'implementation', route });
      const res = await post(app(world), path(childId), { message: '[done] built' }, bearer(world));
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const stamp = await exchangedStamp(world, wakeFor(world, parentId).bootstrapToken);
      assert.deepEqual(stamp, { writes: 'none', writesTarget: 'LIN-9' });
    });

    test('a restricted parent woken by a restricted child takes the parent\'s stage, never the child\'s', async () => {
      const world = await makeWorld();
      const parentId = await seedParent(world, { kind: 'look-into', issueIdentifier: 'LIN-9' });
      const childId = await seedChild(world, parentId, { kind: 'survey-task', route });
      const res = await post(app(world), path(childId), { message: '[done] surveyed' }, bearer(world));
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const stamp = await exchangedStamp(world, wakeFor(world, parentId).bootstrapToken);
      assert.deepEqual(stamp, { writes: 'none', writesTarget: 'LIN-9' });
    });
  });
}

describe('LIN-4468 review F2 — enqueueFollowUp: a restricted kind takes its own writes and the parent\'s ticket', () => {
  async function followUp(world, { parentId, kind }) {
    return enqueueFollowUp({
      dispatchQueueStore: world.store,
      workspacePreferencesStore: null,
      proxyTokenStore: world.tokenStore,
      urlKey: URL_KEY,
      prompt: 'look at the ticket',
      baseUrl: 'http://127.0.0.1',
      dispatchedBy: OWNER,
      ownerCheck: async () => ({ status: 'owner' }),
      workspaceId: 'ws-1',
      followUpTo: parentId,
      target: 'cli',
      force: true,
      sessionId: parentId,
      kind
    });
  }

  test('a survey-task follow-up of a look-into parent on LIN-9 mints one-comment on LIN-9', async () => {
    const world = await makeWorld();
    const parentId = await seedParent(world, { kind: 'look-into', issueIdentifier: 'LIN-9' });
    const outcome = await followUp(world, { parentId, kind: 'survey-task' });
    assert.equal(outcome.status, 200, JSON.stringify(outcome.body));

    const row = world.collection._docs.find(d => d._id === outcome.body.itemId);
    const stamp = await exchangedStamp(world, row.bootstrapToken);
    assert.deepEqual(stamp, { writes: 'one-comment', writesTarget: 'LIN-9' }, 'its own kind\'s writes, the parent\'s ticket');
  });

  test('an implementation follow-up of a look-into parent is unstamped: it takes its own kind, not its parent\'s', async () => {
    const world = await makeWorld();
    const parentId = await seedParent(world, { kind: 'look-into', issueIdentifier: 'LIN-9' });
    const outcome = await followUp(world, { parentId, kind: 'implementation' });
    assert.equal(outcome.status, 200, JSON.stringify(outcome.body));

    const row = world.collection._docs.find(d => d._id === outcome.body.itemId);
    const stamp = await exchangedStamp(world, row.bootstrapToken);
    assert.deepEqual(stamp, { writes: null, writesTarget: null });
  });
});
