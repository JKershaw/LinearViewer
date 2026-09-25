/**
 * LIN-2180 (LIN-1725 H1) — accept-path coverage for the feedback-entry `kind`
 * sanitize step in routes/dispatch.js (POST /api/dispatch/feedback/:itemId).
 *
 * dispatch-store-feedback-kind.test.js pins the STORE's persistence shape
 * (DispatchQueueStore#addFeedback trusts whatever `kind` it is given — the
 * store is not the validation boundary). These tests instead drive the real
 * HTTP route, so they cover the actual failure mode this ticket exists to
 * close: `routes/dispatch.js`'s sanitize line
 * (`typeof kind === 'string' && FEEDBACK_ENTRY_KINDS.includes(kind) ? kind : undefined`)
 * silently drops any kind not in FEEDBACK_ENTRY_KINDS, with no error and no
 * log. Array membership alone (the LIN-1425/LIN-1427/LIN-2180 membership
 * tests) would not catch a kind that is listed but still rejected here by a
 * stale copy of the check, or a kind that is missing from the list but the
 * membership test itself typo'd around.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  return { store, collection, historyCollection };
}

function buildApp({ dispatchQueueStore, dispatchTokenStore, sessionsFeedCache }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore,
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore: null,
    sessionsFeedCache
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

async function takenItemViaToken({ dispatchQueueStore, dispatchTokenStore }) {
  const { token } = await dispatchTokenStore.createToken(URL_KEY, 'consumer', 'account-A');
  const item = await dispatchQueueStore.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42'
  });
  await dispatchQueueStore.takeItem(item._id, URL_KEY, 'consumer');
  return { token, itemId: item._id };
}

function storedFeedbackEntry(collection, historyCollection, itemId) {
  const doc = [...collection._docs, ...historyCollection._docs].find(d => d._id === itemId);
  return doc?.feedback?.[0];
}

describe('LIN-2180 — routes/dispatch.js feedback kind sanitize (accept path)', () => {
  test('kind:"decision" survives the sanitize step and persists on the stored feedback entry', async () => {
    const { store: dispatchQueueStore, collection, historyCollection } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`, { message: '[decision] ruling: proceed', kind: 'decision' }, token);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const entry = storedFeedbackEntry(collection, historyCollection, itemId);
    assert.equal(entry.kind, 'decision', 'the sanitize step must accept "decision", not drop it to undefined');
  });

  test('an unrecognized kind is still silently dropped (existing behavior preserved)', async () => {
    const { store: dispatchQueueStore, collection, historyCollection } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`, { message: 'plain feedback', kind: 'not-a-real-kind' }, token);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const entry = storedFeedbackEntry(collection, historyCollection, itemId);
    assert.ok(!('kind' in entry), 'an unrecognized kind must not be persisted');
  });
});

// LIN-2891/LIN-3035: kind:"decision-withdrawn" is a NEW FEEDBACK_ENTRY_KINDS
// member with its own required-shape gate (routes/dispatch.js, immediately
// before the sole addFeedback call) — malformed input must 400, never fall
// into the ":100" silent-drop behavior above. That existing test remains the
// regression witness for the merge-order hazard for every OTHER
// unrecognized/rejected kind; these cases cover the one kind with its own
// extra validation.
describe('LIN-2891/LIN-3035 — routes/dispatch.js kind:"decision-withdrawn" validation gate', () => {
  test('a well-formed decision-withdrawn message succeeds end to end and persists', async () => {
    const { store: dispatchQueueStore, collection, historyCollection } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`,
      { message: JSON.stringify({ decision_id: 'd-1', reason: 'superseded by LIN-99' }), kind: 'decision-withdrawn' },
      token);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    const entry = storedFeedbackEntry(collection, historyCollection, itemId);
    assert.equal(entry.kind, 'decision-withdrawn');
    assert.deepEqual(JSON.parse(entry.message), { decision_id: 'd-1', reason: 'superseded by LIN-99' });
  });

  test('a missing reason returns 400, not a silent drop', async () => {
    const { store: dispatchQueueStore, collection, historyCollection } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`,
      { message: JSON.stringify({ decision_id: 'd-1' }), kind: 'decision-withdrawn' },
      token);

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(storedFeedbackEntry(collection, historyCollection, itemId), undefined, 'nothing must be persisted on a 400');
  });

  test('an empty (whitespace-only) reason returns 400', async () => {
    const { store: dispatchQueueStore } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`,
      { message: JSON.stringify({ decision_id: 'd-1', reason: '   ' }), kind: 'decision-withdrawn' },
      token);

    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test('an empty decision_id returns 400', async () => {
    const { store: dispatchQueueStore } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`,
      { message: JSON.stringify({ decision_id: '', reason: 'valid reason' }), kind: 'decision-withdrawn' },
      token);

    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test('a malformed (non-JSON) message returns 400', async () => {
    const { store: dispatchQueueStore } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`,
      { message: 'not json', kind: 'decision-withdrawn' },
      token);

    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test('a successful decision-withdrawn add clears sessionsFeedCache for this urlKey', async () => {
    const { store: dispatchQueueStore } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const cleared = [];
    const sessionsFeedCache = { clear: (urlKey) => cleared.push(urlKey) };
    const app = buildApp({ dispatchQueueStore, dispatchTokenStore, sessionsFeedCache });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`,
      { message: JSON.stringify({ decision_id: 'd-1', reason: 'superseded' }), kind: 'decision-withdrawn' },
      token);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(cleared, [URL_KEY], 'a successful add must clear the cache for this urlKey exactly once');
  });

  test('a 400 (missing reason) does NOT clear sessionsFeedCache', async () => {
    const { store: dispatchQueueStore } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token, itemId } = await takenItemViaToken({ dispatchQueueStore, dispatchTokenStore });

    const cleared = [];
    const sessionsFeedCache = { clear: (urlKey) => cleared.push(urlKey) };
    const app = buildApp({ dispatchQueueStore, dispatchTokenStore, sessionsFeedCache });
    const res = await call(app, 'post', `/api/dispatch/feedback/${itemId}`,
      { message: JSON.stringify({ decision_id: 'd-1' }), kind: 'decision-withdrawn' },
      token);

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.deepEqual(cleared, [], 'a rejected write must never invalidate the cache');
  });
});
