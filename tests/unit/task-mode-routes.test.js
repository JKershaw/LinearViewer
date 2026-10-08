/**
 * LIN-2942 — route-level: the ladder's mode record.
 *
 * 1. The session dispatch route's optional `entryRung`: recorded as one
 *    `act:'dispatch'` event carrying the created item's id, only after the item
 *    exists; absent ⇒ the route behaves and responds exactly as before (the
 *    characterization below); out of vocabulary, or on an abort / follow-up ⇒ 400
 *    and nothing created or recorded; a failing record never fails the dispatch.
 * 2. POST /workspace/:urlKey/api/task-mode — the client's press record: session
 *    account stamped by the server, vocabulary enforced, never a dispatch.
 * 3. GET /workspace/:urlKey/api/task-mode/:issueIdentifier — the session
 *    account's mode for a task across its merge group.
 *
 * A stub workspaceFromUrl establishes req.workspace + req.session so the
 * session-authed handlers run without real auth (the dispatch-route-model
 * pattern). Reads and writes in sections 2–3 go through a real TaskModeStore on
 * a real MangoDB engine.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createTaskModeRoutes } from '../../routes/task-mode.js';
import { TaskModeStore } from '../../lib/task-mode-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const DISPATCH_PATH = '/workspace/acme/api/dispatch';
const TASK_MODE_PATH = '/workspace/acme/api/task-mode';
const FOLLOW_UP_ID = '11111111-2222-4333-8444-555555555555';

function stubWorkspaceFromUrl(session) {
  return (req, res, next) => {
    req.workspace = { urlKey: req.params.urlKey };
    req.session = session;
    next();
  };
}

function recordingTaskModeStore(impl) {
  const calls = [];
  return {
    calls,
    record(event) {
      calls.push(event);
      return impl ? impl(event) : Promise.resolve({ ...event });
    }
  };
}

function buildDispatchApp({ taskModeStore = null, session = { accountId: 'acct-1' }, captured = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.items = [...(captured.items || []), item];
        return { _id: 'disp-1', dispatchedAt: '2026-10-02T00:00:00.000Z', ...item };
      }
    },
    dispatchTokenStore: {},
    // A provider outside the dangling-referent guard's set, so an
    // issueIdentifier never reaches a provider lookup.
    provider: { name: 'unit-test' },
    workspaceFromUrl: stubWorkspaceFromUrl(session),
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    taskModeStore
  }));
  return app;
}

function buildTaskModeApp({ taskModeStore, accountStore = null, session = { accountId: 'acct-1' } }) {
  const app = express();
  app.use(express.json());
  app.use(createTaskModeRoutes({ taskModeStore, accountStore, workspaceFromUrl: stubWorkspaceFromUrl(session) }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, text, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const TASK_BODY = { prompt: 'run me', promptName: 'Implement', issueId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', issueIdentifier: 'LIN-42' };

describe('LIN-2942 — session dispatch route, entryRung', () => {
  test('characterization: without entryRung the response is exactly today\'s and nothing is recorded', async () => {
    const store = recordingTaskModeStore();
    const captured = {};
    const res = await call(buildDispatchApp({ taskModeStore: store, captured }), 'post', DISPATCH_PATH, TASK_BODY);

    assert.equal(res.status, 201, res.text);
    assert.equal(res.text, JSON.stringify({
      success: true,
      item: {
        id: 'disp-1',
        promptName: 'Implement',
        kind: 'implementation',
        issueIdentifier: 'LIN-42',
        target: 'cli',
        dispatchedAt: '2026-10-02T00:00:00.000Z',
        consumerLastSeenAt: null,
        maxSessionsPerTask: null
      },
      warning: 'No consumer has ever polled this workspace — this dispatch was enqueued but may sit unclaimed until a runner starts.'
    }));
    assert.equal(captured.items.length, 1);
    assert.equal(captured.items[0].dispatchedBy, 'acct-1');
    assert.equal(store.calls.length, 0);
  });

  test('with entryRung the response and the dispatch row are byte-identical to the request without it', async () => {
    const without = {};
    const withRung = {};
    const a = await call(buildDispatchApp({ taskModeStore: recordingTaskModeStore(), captured: without }), 'post', DISPATCH_PATH, TASK_BODY);
    const b = await call(buildDispatchApp({ taskModeStore: recordingTaskModeStore(), captured: withRung }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step' });

    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.text, a.text);
    const strip = ({ dispatchedAt, ...rest }) => rest;
    assert.deepEqual(strip(withRung.items[0]), strip(without.items[0]));
    assert.equal('entryRung' in withRung.items[0], false);
  });

  test('a run-step dispatch records one act:dispatch event carrying the created item\'s id', async () => {
    const store = recordingTaskModeStore();
    const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step' });

    assert.equal(res.status, 201, res.text);
    assert.deepEqual(store.calls, [{
      accountId: 'acct-1',
      urlKey: 'acme',
      issueId: TASK_BODY.issueId,
      issueIdentifier: 'LIN-42',
      rung: 'run-step',
      ready: true,
      needs: null,
      act: 'dispatch',
      dispatchId: 'disp-1',
      surface: null
    }]);
    assert.equal(res.body.item.id, store.calls[0].dispatchId);
  });

  test('a run-task dispatch records rung run-task', async () => {
    const store = recordingTaskModeStore();
    const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, { ...TASK_BODY, kind: 'autopilot', entryRung: 'run-task' });
    assert.equal(res.status, 201, res.text);
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].rung, 'run-task');
  });

  test('a dispatch records the surface it was pressed from (LIN-2944 P1)', async () => {
    const store = recordingTaskModeStore();
    const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step', surface: 'home' });
    assert.equal(res.status, 201, res.text);
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].surface, 'home', 'the route records the caller surface, not null');
  });

  test('an unknown surface is a 400 and nothing is created or recorded', async () => {
    const store = recordingTaskModeStore();
    const captured = {};
    const res = await call(buildDispatchApp({ taskModeStore: store, captured }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step', surface: 'mobile' });
    assert.equal(res.status, 400, res.text);
    assert.match(res.body.error, /surface must be one of: swipe, home/);
    assert.equal((captured.items || []).length, 0, 'nothing enqueued');
    assert.equal(store.calls.length, 0, 'nothing recorded');
  });

  test('an absent or null surface still dispatches and records null (other callers)', async () => {
    for (const surface of [undefined, null]) {
      const store = recordingTaskModeStore();
      const body = { ...TASK_BODY, entryRung: 'run-step' };
      if (surface !== undefined) body.surface = surface;
      const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, body);
      assert.equal(res.status, 201, res.text);
      assert.equal(store.calls[0].surface, null);
    }
  });

  test('the event lands in a real store, readable as the task\'s mode', async () => {
    const harness = createMangoTmpdir('lin-2942-dispatch-');
    await harness.connect();
    try {
      const realStore = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
      const res = await call(buildDispatchApp({ taskModeStore: realStore }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step' });
      assert.equal(res.status, 201, res.text);
      let mode;
      for (let i = 0; i < 50; i++) {
        mode = await realStore.getTaskMode({ accountIds: ['acct-1'], urlKey: 'acme', issueIdentifier: 'LIN-42' });
        if (mode.events.length) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.deepEqual({ rung: mode.taken.rung, dispatchId: mode.taken.dispatchId }, { rung: 'run-step', dispatchId: res.body.item.id });
    } finally {
      await harness.close();
    }
  });

  for (const [name, entryRung] of [['copy (not a dispatching rung)', 'copy'], ['an unknown rung', 'run-everything'], ['a non-string', 7]]) {
    test(`entryRung of ${name} is a 400 and nothing is created or recorded`, async () => {
      const store = recordingTaskModeStore();
      const captured = {};
      const res = await call(buildDispatchApp({ taskModeStore: store, captured }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung });
      assert.equal(res.status, 400, res.text);
      assert.match(res.body.error, /entryRung must be one of: run-step, run-task/);
      assert.equal(captured.items, undefined);
      assert.equal(store.calls.length, 0);
    });
  }

  for (const [name, extra] of [
    ['a followUpTo', { followUpTo: FOLLOW_UP_ID }],
    ['an abort', { abort: true, abortTo: FOLLOW_UP_ID, prompt: undefined }],
  ]) {
    test(`entryRung on ${name} is a 400 and nothing is created or recorded`, async () => {
      const store = recordingTaskModeStore();
      const captured = {};
      const res = await call(buildDispatchApp({ taskModeStore: store, captured }), 'post', DISPATCH_PATH, { ...TASK_BODY, ...extra, entryRung: 'run-step' });
      assert.equal(res.status, 400, res.text);
      assert.match(res.body.error, /entryRung is only valid on a fresh dispatch/);
      assert.equal(captured.items, undefined);
      assert.equal(store.calls.length, 0);
    });
  }

  test('a followUpTo without entryRung still dispatches and records nothing', async () => {
    const store = recordingTaskModeStore();
    const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, { prompt: 'carry on', followUpTo: FOLLOW_UP_ID });
    assert.notEqual(res.status, 400, res.text);
    assert.equal(store.calls.length, 0);
  });

  test('entryRung without issueIdentifier is a 400', async () => {
    const store = recordingTaskModeStore();
    const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, { prompt: 'run me', entryRung: 'run-step' });
    assert.equal(res.status, 400, res.text);
    assert.match(res.body.error, /entryRung requires issueIdentifier/);
    assert.equal(store.calls.length, 0);
  });

  test('entryRung: null is treated as absent', async () => {
    const store = recordingTaskModeStore();
    const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: null });
    assert.equal(res.status, 201, res.text);
    assert.equal(store.calls.length, 0);
  });

  test('a record that rejects or throws never fails the dispatch', async () => {
    for (const impl of [
      () => Promise.reject(new Error('db down')),
      () => { throw new Error('db down'); },
    ]) {
      const store = recordingTaskModeStore(impl);
      const res = await call(buildDispatchApp({ taskModeStore: store }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step' });
      assert.equal(res.status, 201, res.text);
      assert.equal(res.body.item.id, 'disp-1');
      assert.equal(store.calls.length, 1);
    }
  });

  // LIN-3383: a session with no account can no longer dispatch to a runner
  // target at all (owner-only enqueue, fail closed), so nothing is recorded
  // because nothing is dispatched.
  test('no session account: the dispatch is refused (GRANT_OWNERLESS) and nothing is recorded', async () => {
    const store = recordingTaskModeStore();
    const res = await call(buildDispatchApp({ taskModeStore: store, session: { linearUserId: 'u1' } }), 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step' });
    assert.equal(res.status, 503, res.text);
    assert.equal(store.calls.length, 0);
  });

  test('a failed dispatch records nothing', async () => {
    const store = recordingTaskModeStore();
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
    // LIN-3383: owner-only runner enqueue — this fixture acts as the workspace owner.
    workspaceOwnerCheck: async () => ({ status: 'owner' }),
      dispatchQueueStore: { addItem: async () => { throw new Error('queue down'); } },
      dispatchTokenStore: {},
      provider: { name: 'unit-test' },
      workspaceFromUrl: stubWorkspaceFromUrl({ accountId: 'acct-1' }),
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null,
      taskModeStore: store
    }));
    const res = await call(app, 'post', DISPATCH_PATH, { ...TASK_BODY, entryRung: 'run-step' });
    assert.equal(res.status, 500, res.text);
    assert.equal(store.calls.length, 0);
  });
});

describe('LIN-2942 — POST and GET /workspace/:urlKey/api/task-mode', () => {
  const harness = createMangoTmpdir('lin-2942-task-mode-routes-');
  let store;
  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(() => {
    store = new TaskModeStore({ collection: harness.freshDb().collection('task-mode-events') });
  });

  const COPY = { rung: 'copy', ready: true, act: 'copy', surface: 'swipe', issueId: 'uuid-42', issueIdentifier: 'LIN-42' };

  test('POST records the press for the session account and workspace, answering 204 with no body', async () => {
    const res = await call(buildTaskModeApp({ taskModeStore: store }), 'post', TASK_MODE_PATH, {
      ...COPY, accountId: 'someone-else', urlKey: 'other-ws', at: '2001-01-01T00:00:00.000Z'
    });
    assert.equal(res.status, 204);
    assert.equal(res.text, '');

    const mine = await store.getTaskMode({ accountIds: ['acct-1'], urlKey: 'acme', issueIdentifier: 'LIN-42' });
    assert.deepEqual(mine.events.map(e => `${e.rung}/${e.act}/${e.surface}`), ['copy/copy/swipe']);
    assert.ok(new Date(mine.entry.at).getFullYear() > 2001);
    const forged = await store.getTaskMode({ accountIds: ['someone-else'], urlKey: 'other-ws', issueIdentifier: 'LIN-42' });
    assert.equal(forged.events.length, 0);
  });

  test('POST records a press on a not-set-up rung with its needs', async () => {
    const res = await call(buildTaskModeApp({ taskModeStore: store }), 'post', TASK_MODE_PATH, {
      rung: 'run-step', ready: false, needs: 'dispatch', act: 'press', surface: 'swipe', issueIdentifier: 'LIN-42'
    });
    assert.equal(res.status, 204, res.text);
    const mode = await store.getTaskMode({ accountIds: ['acct-1'], urlKey: 'acme', issueIdentifier: 'LIN-42' });
    assert.deepEqual(mode.entry && { rung: mode.entry.rung, ready: mode.entry.ready }, { rung: 'run-step', ready: false });
    assert.equal(mode.events[0].needs, 'dispatch');
  });

  test('POST without a session account is a 401 and records nothing', async () => {
    const res = await call(buildTaskModeApp({ taskModeStore: store, session: { linearUserId: 'u1' } }), 'post', TASK_MODE_PATH, COPY);
    assert.equal(res.status, 401, res.text);
    assert.equal((await store.listForAccount(['acct-1'])).length, 0);
  });

  for (const [name, body, pattern] of [
    ['act:dispatch (the client never records a dispatch)', { ...COPY, rung: 'run-step', act: 'dispatch', dispatchId: 'd-1' }, /act must be one of: press, copy/],
    ['a dispatchId on a press', { ...COPY, rung: 'run-task', act: 'press', dispatchId: 'd-1' }, /dispatchId is not accepted here/],
    ['an unknown rung', { ...COPY, rung: 'run-everything' }, /rung must be one of/],
    ['an unknown surface', { ...COPY, surface: 'mobile' }, /surface must be one of/],
    ['a not-ready press without needs', { ...COPY, ready: false, act: 'press' }, /needs must be one of/],
    ['no issueIdentifier', { ...COPY, issueIdentifier: undefined }, /issueIdentifier is required/],
    ['no act', { ...COPY, act: undefined }, /act must be one of/],
  ]) {
    test(`POST with ${name} is a 400 and records nothing`, async () => {
      const res = await call(buildTaskModeApp({ taskModeStore: store }), 'post', TASK_MODE_PATH, body);
      assert.equal(res.status, 400, res.text);
      assert.match(res.body.error, pattern);
      assert.equal((await store.listForAccount(['acct-1'])).length, 0);
    });
  }

  test('GET returns the account\'s entry for the task', async () => {
    const app = buildTaskModeApp({ taskModeStore: store });
    await call(app, 'post', TASK_MODE_PATH, { ...COPY, rung: 'run-task', ready: false, needs: 'proxy', act: 'press' });
    await call(app, 'post', TASK_MODE_PATH, COPY);
    const res = await call(app, 'get', `${TASK_MODE_PATH}/LIN-42`);

    assert.equal(res.status, 200, res.text);
    assert.deepEqual({ rung: res.body.entry.rung, ready: res.body.entry.ready }, { rung: 'run-task', ready: false });
    assert.equal(res.body.taken.rung, 'copy');
    assert.equal(res.body.furthest, 'run-task');
    assert.equal(res.body.events.length, 2);
    assert.deepEqual(res.body.coverage, { surfaces: ['swipe', 'home'] });
  });

  test('GET spans the canonical account\'s merge group and nobody else', async () => {
    await store.record({ ...COPY, accountId: 'merged-away', urlKey: 'acme', rung: 'run-step', ready: false, needs: 'dispatch', act: 'press' });
    await new Promise(resolve => setTimeout(resolve, 3));
    await store.record({ ...COPY, accountId: 'canonical', urlKey: 'acme' });
    await store.record({ ...COPY, accountId: 'stranger', urlKey: 'acme' });
    const accountStore = {
      resolveCanonicalAccountId: async (id) => (id === 'stale-session' ? 'canonical' : id),
      listMergedAccounts: async (id) => (id === 'canonical' ? [{ _id: 'stale-session' }, { _id: 'merged-away' }] : [])
    };
    const res = await call(buildTaskModeApp({ taskModeStore: store, accountStore, session: { accountId: 'stale-session' } }), 'get', `${TASK_MODE_PATH}/LIN-42`);

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.events.length, 2);
    assert.equal(res.body.entry.rung, 'run-step');
    assert.equal(res.body.taken.rung, 'copy');
  });

  test('GET narrows to the session account when canonicalization fails', async () => {
    await store.record({ ...COPY, accountId: 'acct-1', urlKey: 'acme' });
    await store.record({ ...COPY, accountId: 'merged-away', urlKey: 'acme' });
    const accountStore = {
      resolveCanonicalAccountId: async () => { throw new Error('cycle detected'); },
      listMergedAccounts: async () => [{ _id: 'merged-away' }]
    };
    const res = await call(buildTaskModeApp({ taskModeStore: store, accountStore }), 'get', `${TASK_MODE_PATH}/LIN-42`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.events.length, 1);
  });

  test('GET without a session account is a 401', async () => {
    await store.record({ ...COPY, accountId: 'acct-1', urlKey: 'acme' });
    const res = await call(buildTaskModeApp({ taskModeStore: store, session: { linearUserId: 'u1' } }), 'get', `${TASK_MODE_PATH}/LIN-42`);
    assert.equal(res.status, 401, res.text);
    assert.equal(res.body.entry, undefined);
  });

  test('GET for a task with no events returns the empty mode', async () => {
    const res = await call(buildTaskModeApp({ taskModeStore: store }), 'get', `${TASK_MODE_PATH}/LIN-404`);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body, { entry: null, taken: null, furthest: null, events: [], coverage: { surfaces: ['swipe', 'home'] } });
  });
});

/**
 * LIN-2952 characterization: the exact account set `resolveAccountGroup` hands
 * to the read. The funnel route (LIN-2952) reuses this same resolution, so the
 * expansion order/dedup and the throw-narrowing are pinned here before the
 * funnel route is added. Capture the query on a stub store instead of asserting
 * through real events, so the set itself — not just its length — is pinned.
 */
describe('LIN-2952 characterization — resolveAccountGroup expansion (via the GET route)', () => {
  function capturingStore() {
    const captured = {};
    return {
      captured,
      async getTaskMode(query) {
        captured.query = query;
        return { entry: null, taken: null, furthest: null, events: [], coverage: { surfaces: ['swipe'] } };
      }
    };
  }

  test('reads the deduplicated {canonical, merged, session} set for one workspace task', async () => {
    const taskModeStore = capturingStore();
    const accountStore = {
      resolveCanonicalAccountId: async (id) => (id === 'stale-session' ? 'canonical' : id),
      listMergedAccounts: async (id) => (id === 'canonical' ? [{ _id: 'stale-session' }, { _id: 'merged-away' }] : [])
    };
    const res = await call(
      buildTaskModeApp({ taskModeStore, accountStore, session: { accountId: 'stale-session' } }),
      'get',
      `${TASK_MODE_PATH}/LIN-42`
    );

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(taskModeStore.captured.query.accountIds, ['canonical', 'stale-session', 'merged-away']);
    assert.equal(taskModeStore.captured.query.urlKey, 'acme');
    assert.equal(taskModeStore.captured.query.issueIdentifier, 'LIN-42');
  });

  test('narrows to the session account alone when canonicalization throws', async () => {
    const taskModeStore = capturingStore();
    const accountStore = {
      resolveCanonicalAccountId: async () => { throw new Error('cycle detected'); },
      listMergedAccounts: async () => [{ _id: 'merged-away' }]
    };
    const res = await call(
      buildTaskModeApp({ taskModeStore, accountStore, session: { accountId: 'stale-session' } }),
      'get',
      `${TASK_MODE_PATH}/LIN-42`
    );

    assert.equal(res.status, 200, res.text);
    assert.deepEqual(taskModeStore.captured.query.accountIds, ['stale-session']);
  });
});
