/**
 * Unit tests for DispatchQueueStore#markDecisionAnswered (LIN-1728, decision 1).
 *
 * markDecisionAnswered is deliberately NOT addFeedback: it carries no
 * `status: 'taken'` / `takenByTokenLabel` gate, because a human Save
 * authenticates via session auth, not a runner token, and cannot satisfy
 * that precondition. `'decision-answer'` is kept OUT of FEEDBACK_ENTRY_KINDS
 * so the runner-facing sanitize step (routes/dispatch.js) can never accept
 * it — this store method is the only write path. These tests pin both the
 * write behaviour and that structural asymmetry.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore, FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';

const URL_KEY = 'acme';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  return new DispatchQueueStore({ collection, historyCollection });
}

async function takenItem(store, urlKey = URL_KEY) {
  const item = await store.addItem(urlKey, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42'
  });
  await store.takeItem(item._id, urlKey, 'token-a');
  return item;
}

describe('markDecisionAnswered (LIN-1728)', () => {
  test('"decision-answer" is NOT a recognized FEEDBACK_ENTRY_KINDS member', () => {
    assert.ok(!FEEDBACK_ENTRY_KINDS.includes('decision-answer'),
      'decision-answer must stay out of the runner-writable kind vocabulary — markDecisionAnswered is the only write path');
  });

  test('succeeds regardless of item status/takenByTokenLabel — no runner-token gate', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    // Simulate the item having moved past 'taken' (e.g. completed) and being
    // owned by a DIFFERENT token label than any caller here supplies.
    // addFeedback's filter (`{ status: 'taken', takenByTokenLabel: tokenLabel }`)
    // would refuse to match this doc; markDecisionAnswered carries no such gate.
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    doc.status = 'completed';
    doc.takenByTokenLabel = 'some-other-token';

    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    assert.ok(res && res.success);

    const updated = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(updated.feedback.length, 1);
    assert.equal(updated.feedback[0].kind, 'decision-answer');
    assert.deepEqual(JSON.parse(updated.feedback[0].message), { decision_id: 'd-1' });
    assert.ok(updated.feedback[0].timestamp instanceof Date);
  });

  test('refuses on a urlKey mismatch (wrong workspace)', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.markDecisionAnswered(item._id, 'some-other-workspace', 'd-1');
    assert.strictEqual(res, null);

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.ok(!doc.feedback || doc.feedback.length === 0, 'no entry written on a workspace mismatch');
  });

  test('refuses on an unknown itemId', async () => {
    const store = makeStore();
    await takenItem(store);

    const res = await store.markDecisionAnswered('not-a-real-id', URL_KEY, 'd-1');
    assert.strictEqual(res, null);
  });

  test('a second stamp appends rather than overwrites — feedback stays append-only', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-2');
    assert.ok(res && res.success);
    assert.equal(res.feedbackCount, 2);

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback.length, 2);
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1' });
    assert.deepEqual(JSON.parse(doc.feedback[1].message), { decision_id: 'd-2' });
  });

  // LIN-2225: a loop-backed ruling has no separate outcome column the way a
  // scan-produced task decision does, so a Rulings-page dismiss reuses this
  // SAME stamp with an explicit outcome — these pin that the two outcomes are
  // both written under the unchanged 'decision-answer' kind (so every existing
  // "hide this from the transcript" reader keeps working unmodified) while
  // staying distinguishable in the stamp's own message.
  test('outcome "dismissed" tags the stamp but keeps the same kind', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const res = await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'dismissed');
    assert.ok(res && res.success);

    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].kind, 'decision-answer');
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1', outcome: 'dismissed' });
  });

  test('omitting outcome (the pre-LIN-2225 call shape) writes the byte-identical {decision_id} message', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1');
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.equal(doc.feedback[0].message, '{"decision_id":"d-1"}');
  });

  test('any outcome other than "dismissed" (including "answered") falls back to the plain {decision_id} shape', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.markDecisionAnswered(item._id, URL_KEY, 'd-1', 'answered');
    const doc = store.historyCollection._docs.find(d => d._id === item._id);
    assert.deepEqual(JSON.parse(doc.feedback[0].message), { decision_id: 'd-1' });
  });
});

// ── Regression: the runner-facing feedback route must never accept this kind ──

function buildApp({ dispatchQueueStore, dispatchTokenStore }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore,
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: null
  }));
  return app;
}

async function call(app, method, path, body, bearerToken) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (bearerToken) opts.headers['Authorization'] = `Bearer ${bearerToken}`;
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

describe('LIN-1728: runner feedback route rejects kind:"decision-answer"', () => {
  test('a runner-token POST with kind:"decision-answer" is silently dropped, not persisted', async () => {
    const collection = createMockCollection();
    const historyCollection = createMockCollection();
    const dispatchQueueStore = new DispatchQueueStore({ collection, historyCollection });
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });

    const { token } = await dispatchTokenStore.createToken(URL_KEY, 'consumer', 'account-A');
    const item = await dispatchQueueStore.addItem(URL_KEY, {
      prompt: 'do the thing',
      kind: 'implementation',
      issueIdentifier: 'LIN-42'
    });
    await dispatchQueueStore.takeItem(item._id, URL_KEY, 'consumer');

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(
      app, 'post', `/api/dispatch/feedback/${item._id}`,
      { message: '{"decision_id":"d-1"}', kind: 'decision-answer' },
      token
    );

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const doc = [...collection._docs, ...historyCollection._docs].find(d => d._id === item._id);
    assert.ok(!('kind' in doc.feedback[0]), 'a runner token must never be able to write a decision-answer stamp via the feedback route');
  });
});
