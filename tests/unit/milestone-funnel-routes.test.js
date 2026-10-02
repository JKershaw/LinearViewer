/**
 * LIN-2952 — route-level: the per-account milestone-funnel query.
 *
 * GET /workspace/:urlKey/api/milestone-funnel returns the session account's own
 * five funnel steps (states + timestamps + coverage), the out-of-order flag, and
 * the task-mode record joined in. Proves: session auth; merge-group expansion
 * (data recorded under a merged-away id is found); throw-narrowing on a corrupt
 * chain; cross-account isolation; and the not-ready entry rule via the mode join.
 *
 * A stub workspaceFromUrl establishes req.workspace + req.session so the
 * session-authed handler runs without real auth. Every store is real (MangoDB),
 * including the AccountStore, so merge resolution is exercised, not stubbed.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMilestoneFunnelRoutes } from '../../routes/milestone-funnel.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { TaskModeStore } from '../../lib/task-mode-store.js';
import { FunnelEventStore } from '../../lib/funnel-event-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const PATH = '/workspace/acme/api/milestone-funnel';

const harness = createMangoTmpdir('lin-2952-funnel-routes-');
before(() => harness.connect());
after(() => harness.close());

function stubWorkspaceFromUrl(session) {
  return (req, res, next) => {
    req.workspace = { urlKey: req.params.urlKey };
    req.session = session;
    next();
  };
}

function freshWorld() {
  const db = harness.freshDb();
  return {
    accountStore: new AccountStore({ collection: db.collection('accounts') }),
    accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    taskModeStore: new TaskModeStore({ collection: db.collection('task-mode-events') }),
    funnelEventStore: new FunnelEventStore({ collection: db.collection('funnel-events') }),
    dispatchQueue: db.collection('dispatch-queue'),
    dispatchHistory: db.collection('dispatch-history')
  };
}

function buildApp(w, session = { accountId: 'acct-1' }, overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(createMilestoneFunnelRoutes({
    taskModeStore: w.taskModeStore,
    accountStore: w.accountStore,
    accountWorkspaceStore: w.accountWorkspaceStore,
    dispatchQueue: w.dispatchQueue,
    dispatchHistory: w.dispatchHistory,
    funnelEventStore: w.funnelEventStore,
    ...overrides,
    workspaceFromUrl: stubWorkspaceFromUrl(session)
  }));
  return app;
}

async function call(app, method, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: method.toUpperCase() });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, text, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const PAST = (msAgo) => new Date(Date.now() - msAgo);
const dispatchRow = (accountId, dispatchedAt, over = {}) => ({
  _id: `d-${Math.random().toString(36).slice(2)}`,
  urlKey: 'acme', dispatchedBy: accountId, dispatchedAt, abort: false, feedback: [], ...over
});

describe('LIN-2952 — GET /workspace/:urlKey/api/milestone-funnel', () => {
  test('without a session account is a 401', async () => {
    const w = freshWorld();
    const res = await call(buildApp(w, { linearUserId: 'u1' }), 'get', PATH);
    assert.equal(res.status, 401, res.text);
  });

  test('returns the signed-in account\'s five steps and the joined mode', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const loginAt = PAST(4000);
    await w.accountStore.collection.updateOne({ _id: a._id }, { $set: { createdAt: loginAt } });
    const connectedAt = PAST(3000);
    await w.accountWorkspaceStore.bindAccountToWorkspace(a._id, 'ws-1');
    await w.accountWorkspaceStore.collection.updateOne({ accountId: a._id }, { $set: { createdAt: connectedAt } });
    const goAt = PAST(2000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, goAt));
    const prAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, PAST(1500), {
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/9', timestamp: prAt }]
    }));
    await w.taskModeStore.record({
      accountId: a._id, urlKey: 'acme', issueId: null, issueIdentifier: 'LIN-1',
      rung: 'run-task', ready: false, needs: 'proxy', act: 'press', surface: 'swipe'
    });

    const res = await call(buildApp(w, { accountId: a._id }), 'get', PATH);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.accountId, a._id);
    assert.equal(res.body.urlKey, 'acme');
    assert.deepEqual(Object.keys(res.body.steps).sort(), ['connected', 'firstGo', 'login', 'mergeClicked', 'prOpened']);
    assert.equal(res.body.steps.login.at, loginAt.toISOString());
    assert.equal(res.body.steps.connected.at, connectedAt.toISOString());
    assert.equal(res.body.steps.firstGo.at, goAt.toISOString());
    assert.equal(res.body.steps.prOpened.at, prAt.toISOString());
    assert.equal(res.body.steps.mergeClicked.state, 'no-signal');
    assert.deepEqual(res.body.outOfOrder, []);
    // The mode join exposes the not-ready entry press (the settled entry rule).
    assert.equal(res.body.mode.entry.rung, 'run-task');
    assert.equal(res.body.mode.entry.ready, false);
  });

  test('expands the merge group: data recorded under a merged-away id is found', async () => {
    const w = freshWorld();
    const canonical = await w.accountStore.createAccount();
    const merged = await w.accountStore.createAccount();
    assert.equal((await w.accountStore.mergeAccounts(canonical._id, merged._id)).ok, true);
    const goAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(canonical._id, goAt));

    // Session on the MERGED-AWAY id; the dispatch lives under the survivor.
    const res = await call(buildApp(w, { accountId: merged._id }), 'get', PATH);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.steps.firstGo.at, goAt.toISOString());
  });

  test('R2: an instrumented merge-click read that throws is no-signal, not not-reached', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const res = await call(buildApp(w, { accountId: a._id }, {
      funnelEventStore: new FunnelEventStore({ collection: { find: () => { throw new Error('db down'); } } }),
      instrumentedSteps: ['merge-clicked']
    }), 'get', PATH);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.steps.mergeClicked.state, 'no-signal');
  });

  test('narrows to the session account when canonicalization throws (corrupt chain)', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const b = await w.accountStore.createAccount();
    await w.accountStore.collection.updateOne({ _id: a._id }, { $set: { mergedInto: b._id } });
    await w.accountStore.collection.updateOne({ _id: b._id }, { $set: { mergedInto: a._id } });
    const aGoAt = PAST(1000);
    await w.dispatchHistory.insertOne(dispatchRow(a._id, aGoAt));
    await w.dispatchHistory.insertOne(dispatchRow(b._id, PAST(5000))); // earlier, must NOT leak in

    const res = await call(buildApp(w, { accountId: a._id }), 'get', PATH);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.steps.firstGo.at, aGoAt.toISOString(), 'only the session account\'s own dispatch');
  });

  test('never includes another account\'s data', async () => {
    const w = freshWorld();
    const a = await w.accountStore.createAccount();
    const stranger = await w.accountStore.createAccount();
    await w.dispatchHistory.insertOne(dispatchRow(stranger._id, PAST(5000), {
      feedback: [{ kind: 'evidence', url: 'https://github.com/o/r/pull/1', timestamp: PAST(4000) }]
    }));

    const res = await call(buildApp(w, { accountId: a._id }), 'get', PATH);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.steps.firstGo.state, 'not-reached');
    assert.equal(res.body.steps.prOpened.state, 'not-reached');
  });
});
