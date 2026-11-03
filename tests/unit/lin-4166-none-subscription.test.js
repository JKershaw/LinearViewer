/**
 * LIN-4166 — a follow-up sent with `subscription: 'none'` is a question: none of its own events
 * mint a wake, while its answer still lands on its own row. Covers:
 *  - the EFFECT at the addFeedback seam (DispatchQueueStore): no wake for any wake event from a
 *    `none` row; no burn of the root edge's terminalWakeItems; a real follow-up chained after the
 *    question still wakes;
 *  - the ENTRANCE on the session lane (POST /api/dispatch): `none` refused without followUpTo.
 * The proxy and kickoff lanes are pinned in tests/unit/proxy-dispatch-subscribe.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { installHermeticLinearTransport } from '../fixtures/hermetic-linear.js';
installHermeticLinearTransport();
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const PARENT = 'parent-S1';
const FOLLOW_UP_ID = '99999999-8888-4777-8666-555555555555';
const drain = () => new Promise(resolve => setImmediate(resolve));

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  return { store, collection, historyCollection };
}

// Every wake row ever created (kind:'wake'), active and archived.
function wakesOf({ collection, historyCollection }) {
  return [...collection._docs, ...historyCollection._docs].filter(d => d.kind === 'wake');
}

// A row by id, wherever it sits now (active or history).
function rowOf({ collection, historyCollection }, id) {
  return [...collection._docs, ...historyCollection._docs].find(d => d._id === id);
}

// A worker under the parent autopilot: the root edge every follow-up resolves to.
async function takenWorker(store) {
  const worker = await store.addItem(URL_KEY, {
    prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42',
    sessionId: PARENT, subscription: 'everything'
  });
  await store.takeItem(worker._id, URL_KEY, 'token-a');
  return worker;
}

// A question to the worker: a follow-up row declaring `subscription: 'none'`.
async function takenQuestion(store, worker, overrides = {}) {
  const question = await store.addItem(URL_KEY, {
    prompt: 'what made this hard?', kind: 'custom', followUpTo: worker._id,
    issueIdentifier: 'LIN-42', subscription: 'none', ...overrides
  });
  await store.takeItem(question._id, URL_KEY, 'token-a');
  return question;
}

describe('LIN-4166 addFeedback: a `none` follow-up mints no wake on any of its events', () => {
  test("a question's [done] mints no wake; the answer lands on its row; the root edge is untouched", async () => {
    const env = makeStore();
    const worker = await takenWorker(env.store);

    // Sanity: the worker's own terminal still wakes the parent exactly once.
    await env.store.addFeedback(worker._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await drain();
    assert.equal(wakesOf(env).length, 1, 'the worker terminal wakes the parent');

    const edgeBefore = JSON.stringify({
      terminalWakeItems: rowOf(env, worker._id).terminalWakeItems || [],
      wakeWitnessMeta: rowOf(env, worker._id).wakeWitnessMeta || null
    });
    const question = await takenQuestion(env.store, worker);
    const res = await env.store.addFeedback(question._id, URL_KEY, { message: '[done] answered' }, 'token-a');
    await drain();

    assert.ok(res && res.success);
    assert.equal(wakesOf(env).length, 1, 'the question mints no second wake');
    assert.ok(
      (rowOf(env, question._id).feedback || []).some(f => f.message === '[done] answered'),
      'the answer lands on the question row'
    );
    const edgeAfter = JSON.stringify({
      terminalWakeItems: rowOf(env, worker._id).terminalWakeItems || [],
      wakeWitnessMeta: rowOf(env, worker._id).wakeWitnessMeta || null
    });
    assert.equal(edgeAfter, edgeBefore, 'no grant, witness or terminalWakeItems slot is burned by the suppressed wake');
    assert.ok(!(rowOf(env, worker._id).terminalWakeItems || []).includes(question._id), 'the question id never enters the edge witness set');
  });

  for (const message of ['[done] answered', '[failed] could not answer', '[blocked] need a ruling', '[pending] answer so far']) {
    test(`a question's ${message.split(']')[0]}] event mints no wake (LIN-4166)`, async () => {
      const env = makeStore();
      const worker = await takenWorker(env.store);
      const question = await takenQuestion(env.store, worker);

      await env.store.addFeedback(question._id, URL_KEY, { message }, 'token-a');
      await drain();

      assert.equal(wakesOf(env).length, 0, `no wake from ${message}`);
      assert.ok((rowOf(env, question._id).feedback || []).some(f => f.message === message), 'the event still lands on the row');
    });
  }

  test('a real follow-up chained after a question still wakes the parent (the gate keys on the producing row)', async () => {
    const env = makeStore();
    const worker = await takenWorker(env.store);
    await env.store.addFeedback(worker._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await drain();

    const question = await takenQuestion(env.store, worker);
    await env.store.addFeedback(question._id, URL_KEY, { message: '[done] answered' }, 'token-a');
    await drain();
    assert.equal(wakesOf(env).length, 1, 'the question alone adds nothing');

    // A later real follow-up: no subscription declared, so terminal-only, chained after the question.
    const real = await takenRealFollowUp(env.store, question._id);
    await env.store.addFeedback(real._id, URL_KEY, { message: '[done] real work done' }, 'token-a');
    await drain();

    const wakes = wakesOf(env);
    assert.equal(wakes.length, 2, 'the real follow-up mints its own wake');
    assert.ok(wakes.every(w => w.followUpTo === PARENT), 'both wakes address the parent autopilot');
  });
});

async function takenRealFollowUp(store, followUpTo) {
  const real = await store.addItem(URL_KEY, {
    prompt: 'now do the real rework', kind: 'custom', followUpTo, issueIdentifier: 'LIN-42'
  });
  await store.takeItem(real._id, URL_KEY, 'token-a');
  return real;
}

describe('LIN-4166 entrance (session lane): `none` needs a followUpTo', () => {
  function buildSessionApp(captured) {
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      dispatchQueueStore: {
        getGrantDeclaration: async () => ({ state: 'none' }),
        addItem: async (urlKey, item) => {
          captured.item = item;
          return { _id: 'disp-1', ...item };
        }
      },
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey };
        req.session = { accountId: 'u1', linearUserId: 'u1' };
        next();
      },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null,
      workspacePreferencesStore: undefined,
      dispatchPresetsStore: undefined
    }));
    return app;
  }

  async function post(app, body) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/workspace/acme/api/dispatch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } finally {
      server.close();
    }
  }

  test("a fresh dispatch with subscription 'none' is a 400 and enqueues nothing", async () => {
    const captured = {};
    const res = await post(buildSessionApp(captured), { prompt: 'do the thing', subscription: 'none' });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, "subscription 'none' requires followUpTo");
    assert.equal(captured.item, undefined, 'nothing is enqueued');
  });

  test("subscription 'none' with a null followUpTo is still a 400 (presence test, not truthiness)", async () => {
    const captured = {};
    const res = await post(buildSessionApp(captured), { prompt: 'do the thing', subscription: 'none', followUpTo: null });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, "subscription 'none' requires followUpTo");
    assert.equal(captured.item, undefined, 'nothing is enqueued');
  });

  test("subscription 'none' with a followUpTo passes the entrance rule and is stored as declared", async () => {
    const captured = {};
    const res = await post(buildSessionApp(captured), { prompt: 'what made this hard?', followUpTo: FOLLOW_UP_ID, subscription: 'none' });
    assert.notEqual(res.body.error, "subscription 'none' requires followUpTo", 'the rule does not refuse a follow-up');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.item.subscription, 'none');
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID);
  });
});
