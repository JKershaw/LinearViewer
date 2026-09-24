/**
 * LIN-2975 — route-level: POST /api/proxy/dispatch accepts an optional
 * `maxTasks` (int >= 1), validating with the exact rule/text
 * routes/dispatch.js already uses, storing it on the created item, and
 * echoing it on the 201 — parity with the session-authenticated route. Before
 * this fix the proxy route silently dropped `maxTasks`, so a launcher could
 * never declare a runner's task pool through the proxy: the field was
 * accepted, ignored, and never persisted.
 *
 * Scaffolded like proxy-kickoff-max-tasks.test.js (installHermeticLinearTransport
 * + a real DispatchQueueStore over createMockCollection + the `test-token`
 * sentinel so the LIN-2886 repo guard's fail-open path is exercised rather
 * than a live Linear call), but targets POST /api/proxy/dispatch itself
 * rather than the kickoff verb.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// LIN-1880: see proxy-kickoff-max-tasks.test.js's identical note — never
// restored for the life of this file, so the dispatch referent guard stays
// fail-open here too.
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

// Wraps a mock collection's insertOne with a call counter, so a 400 test can
// assert addItem never wrote anything (LIN-2975's pre-write-guard placement).
function makeSpiedStore() {
  const collection = createMockCollection();
  let insertCount = 0;
  const originalInsertOne = collection.insertOne.bind(collection);
  collection.insertOne = async (...args) => {
    insertCount++;
    return originalInsertOne(...args);
  };
  const store = new DispatchQueueStore({ collection, historyCollection: createMockCollection() });
  return { store, getInsertCount: () => insertCount };
}

describe('LIN-2975 — POST /api/proxy/dispatch maxTasks validation', () => {
  test('no maxTasks at all: stored null, byte-identical to today', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.maxTasks, null);
  });

  test('maxTasks: null is accepted and treated as no budget', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxTasks: null });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.maxTasks, null);
  });

  test('a valid integer maxTasks is accepted, stored, and echoed on the 201', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxTasks: 5 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.maxTasks, 5);

    const stored = await store.getItemStatus('acme', res.body.id);
    assert.equal(stored.maxTasks, 5);
  });

  for (const bad of [0, -1, 1.5, '5', true, {}, []]) {
    test(`maxTasks: ${JSON.stringify(bad)} is rejected 400 with the exact text, and addItem never runs`, async () => {
      const { store, getInsertCount } = makeSpiedStore();
      const app = buildApp({ dispatchQueueStore: store });
      const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxTasks: bad });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error, 'maxTasks must be an integer >= 1');
      assert.equal(getInsertCount(), 0, 'addItem must not write on a rejected maxTasks');
    });
  }
});

describe('LIN-2975 — end-to-end: a custom run declares a pool through the proxy', () => {
  test('a custom run with maxTasks: 2 admits two distinct sessionId-stamped workers, then refuses a third', async () => {
    const recordedEvents = [];
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store, recordedEvents });

    // The launcher declares the pool on a plain custom dispatch — exactly the
    // passage-runner launch shape this ticket was filed over (no kickoff verb
    // involved, proving proxy POST /dispatch alone can now bound a run).
    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxTasks: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.equal(run.body.maxTasks, 2);
    const sessionId = run.body.id;

    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));

    const t2 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-2', target: 'cli', sessionId
    });
    assert.equal(t2.status, 201, JSON.stringify(t2.body));

    const t3 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-3', target: 'cli', sessionId
    });
    assert.equal(t3.status, 409, JSON.stringify(t3.body));
    assert.equal(t3.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t3.body.bound, 'tasks', 'LIN-2934: the refusal body now names which bound fired');
    assert.equal(t3.body.maxTasks, 2);
    assert.equal(t3.body.sessionId, sessionId);

    // LIN-2934 (F1): the durable proxy-event note carries the bound
    // discriminator too, independent of the 409 body itself.
    const refusalEvent = recordedEvents.find(e => e.status === 409);
    assert.ok(refusalEvent, 'expected a durable proxy-event record for the refusal');
    assert.equal(refusalEvent.note, `BUDGET_EXHAUSTED tasks ${sessionId}`);
  });
});

describe('LIN-2934 — POST /api/proxy/dispatch maxSessionsPerTask validation', () => {
  test('no maxSessionsPerTask at all: stored null, byte-identical to today', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.maxSessionsPerTask, null);
  });

  test('a valid integer maxSessionsPerTask is accepted, stored, and echoed on the 201', async () => {
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store });
    const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxSessionsPerTask: 5 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.maxSessionsPerTask, 5);

    const stored = await store.getItemStatus('acme', res.body.id);
    assert.equal(stored.maxSessionsPerTask, 5);
  });

  for (const bad of [0, -1, 1.5, '5', true, {}, []]) {
    test(`maxSessionsPerTask: ${JSON.stringify(bad)} is rejected 400 with the exact text, and addItem never runs`, async () => {
      const { store, getInsertCount } = makeSpiedStore();
      const app = buildApp({ dispatchQueueStore: store });
      const res = await call(app, 'post', DISPATCH, { prompt: 'run me', target: 'cli', maxSessionsPerTask: bad });
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.equal(res.body.error, 'maxSessionsPerTask must be an integer >= 1');
      assert.equal(getInsertCount(), 0, 'addItem must not write on a rejected maxSessionsPerTask');
    });
  }
});

describe('LIN-2934 — end-to-end: a scoped one-task run bounded by maxSessionsPerTask', () => {
  test('a run with maxSessionsPerTask: 2 admits two fresh dispatches to ONE task, then refuses a third to that same task', async () => {
    const recordedEvents = [];
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store, recordedEvents });

    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxSessionsPerTask: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.equal(run.body.maxSessionsPerTask, 2);
    const sessionId = run.body.id;

    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));
    assert.deepEqual(t1.body.budgetPosition.sessionsPerTask, { count: 1, maxSessionsPerTask: 2 });

    const t2 = await call(app, 'post', DISPATCH, {
      prompt: 'review it', promptName: 'review', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t2.status, 201, JSON.stringify(t2.body));
    assert.deepEqual(t2.body.budgetPosition.sessionsPerTask, { count: 2, maxSessionsPerTask: 2 });

    // A THIRD dispatch to the SAME task is refused — unlike maxTasks, there is
    // no already-counted exemption, since this bound counts dispatches.
    const t3 = await call(app, 'post', DISPATCH, {
      prompt: 'close it out', promptName: 'close-out', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t3.status, 409, JSON.stringify(t3.body));
    assert.equal(t3.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t3.body.bound, 'sessionsPerTask');
    assert.equal(t3.body.taskDispatches, 2);
    assert.equal(t3.body.maxSessionsPerTask, 2);
    assert.equal(t3.body.sessionId, sessionId);

    const refusalEvent = recordedEvents.find(e => e.status === 409);
    assert.ok(refusalEvent);
    assert.equal(refusalEvent.note, `BUDGET_EXHAUSTED sessionsPerTask ${sessionId}`);

    // A dispatch to a DIFFERENT task under the same run is unaffected — the
    // bound is per-task, not run-wide.
    const other = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-2', target: 'cli', sessionId
    });
    assert.equal(other.status, 201, JSON.stringify(other.body));
  });
});

describe('LIN-2934 R2 — maxSessionsPerTask survives the queue→history archive hop, end to end', () => {
  test('a run whose kickoff row was taken (archived to history) before its bounded dispatches still enforces maxSessionsPerTask', async () => {
    const recordedEvents = [];
    const { store } = makeSpiedStore();
    const app = buildApp({ dispatchQueueStore: store, recordedEvents });

    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxSessionsPerTask: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    const sessionId = run.body.id;

    // Simulate the real lifecycle every other e2e case here skips: a real
    // run's kickoff row is typically TAKEN (and so archived to history) by
    // the runner within seconds of dispatch, well before its bounded worker
    // dispatches land. The guard's anchor read (getItemStatus, inside
    // dispatch-factory.js) must resolve maxSessionsPerTask through the
    // ARCHIVED branch (_formatHistoryItem), not only the still-queued branch
    // every other case in this file exercises.
    const taken = await store.takeItem(sessionId, 'acme');
    assert.ok(taken, 'sanity: the kickoff row was actually taken');
    const anchorStatus = await store.getItemStatus('acme', sessionId);
    assert.equal(anchorStatus.status, 'taken', 'sanity: resolved via the history branch, not the active queue');
    assert.equal(anchorStatus.maxSessionsPerTask, 2, 'sanity: the archived anchor still carries the bound');

    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 201, JSON.stringify(t1.body));
    assert.deepEqual(t1.body.budgetPosition.sessionsPerTask, { count: 1, maxSessionsPerTask: 2 });

    const t2 = await call(app, 'post', DISPATCH, {
      prompt: 'review it', promptName: 'review', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t2.status, 201, JSON.stringify(t2.body));
    assert.deepEqual(t2.body.budgetPosition.sessionsPerTask, { count: 2, maxSessionsPerTask: 2 });

    const t3 = await call(app, 'post', DISPATCH, {
      prompt: 'close it out', promptName: 'close-out', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t3.status, 409, JSON.stringify(t3.body));
    assert.equal(t3.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t3.body.bound, 'sessionsPerTask');
    assert.equal(t3.body.taskDispatches, 2);
    assert.equal(t3.body.maxSessionsPerTask, 2);
    assert.equal(t3.body.sessionId, sessionId);

    const refusalEvent = recordedEvents.find(e => e.status === 409);
    assert.ok(refusalEvent);
    assert.equal(refusalEvent.note, `BUDGET_EXHAUSTED sessionsPerTask ${sessionId}`);
  });
});

// LIN-2934 R4: the fail-closed path (a REAL countDistinctTasksForSession read
// error, N3) was only proven at the dispatch-factory unit level
// (tests/unit/dispatch-factory.test.js) — never at the route level, where the
// durable proxy-event note is actually written (routes/proxy.js's
// refuseIfBudgetExhausted -> logEvent). The 409 body's `bound` is pinned
// there, so the note's own `bound` interpolation was only pinned indirectly.
function makeBudgetReadFailureStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const originalFind = collection.find.bind(collection);
  // Target ONLY countDistinctTasksForSession's own query shape (dispatch-store.js:
  // `issueIdentifier: { $ne: null }`) — never findRecentFreshDispatch's (the
  // unrelated duplicate-dispatch guard, `issueIdentifier: <string>`, no `$ne`),
  // which also reads via collection.find and must keep working normally.
  collection.find = (query, opts) => {
    if (query && query.followUpTo === null && query.abort && query.abort.$ne === true
      && query.issueIdentifier && query.issueIdentifier.$ne === null) {
      throw new Error('simulated budget-count read failure');
    }
    return originalFind(query, opts);
  };
  return new DispatchQueueStore({ collection, historyCollection });
}

describe('LIN-2934 R4 — fail-closed budget-read failure, end to end (N3)', () => {
  test('a real count-read error fails CLOSED with bound: sessionsPerTask, and the durable note names it (single bound declared)', async () => {
    const recordedEvents = [];
    const store = makeBudgetReadFailureStore();
    const app = buildApp({ dispatchQueueStore: store, recordedEvents });

    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxSessionsPerTask: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    const sessionId = run.body.id;

    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 409, JSON.stringify(t1.body));
    assert.equal(t1.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t1.body.bound, 'sessionsPerTask', 'fails closed — never admits when the read itself is unverifiable');
    assert.strictEqual(t1.body.count, null);

    const refusalEvent = recordedEvents.find(e => e.status === 409);
    assert.ok(refusalEvent, 'the fail-closed refusal must still write a durable proxy-event note');
    assert.equal(refusalEvent.note, `BUDGET_EXHAUSTED sessionsPerTask ${sessionId}`,
      'the note must name the single declared bound, never interpolate undefined');
  });

  test('a real count-read error with BOTH bounds declared fails CLOSED with bound: unverified, and the durable note names it', async () => {
    const recordedEvents = [];
    const store = makeBudgetReadFailureStore();
    const app = buildApp({ dispatchQueueStore: store, recordedEvents });

    const run = await call(app, 'post', DISPATCH, { prompt: 'launch the runner', target: 'cli', maxTasks: 3, maxSessionsPerTask: 2 });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    const sessionId = run.body.id;

    const t1 = await call(app, 'post', DISPATCH, {
      prompt: 'work on it', promptName: 'implementation', issueIdentifier: 'LIN-1', target: 'cli', sessionId
    });
    assert.equal(t1.status, 409, JSON.stringify(t1.body));
    assert.equal(t1.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(t1.body.bound, 'unverified', 'the read failed before either bound could be evaluated — neither can be misattributed as "the one that fired"');
    assert.equal(t1.body.maxSessionsPerTask, 2, 'the fail-closed body still names maxSessionsPerTask when it is declared');

    const refusalEvent = recordedEvents.find(e => e.status === 409);
    assert.ok(refusalEvent);
    assert.equal(refusalEvent.note, `BUDGET_EXHAUSTED unverified ${sessionId}`);
  });
});
