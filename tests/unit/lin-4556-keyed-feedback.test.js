/**
 * LIN-4556 (LIN-4508 piece A), beat 3: the keyed feedback append.
 *
 * An optional `key` on a feedback post makes the post idempotent: the store appends only if no
 * entry on the row carries that key, decided inside the one atomic `findOneAndUpdate`
 * (`$nor: [{'feedback.key': key}]`). A post the row already holds answers
 * `{success: true, feedbackCount, duplicate: true}` and returns before the run-record step, the
 * wake and the closers. A post to a gone row or another token's row stays the null -> 404 it was.
 *
 * Where each test runs:
 *   - concurrency and the store's keyed append on real MangoDB (a tmpdir instance): the mock is
 *     atomic by construction, so a race can only be shown on an engine;
 *   - routes on the mock collection, which now models `$nor` and dot paths (equality only
 *     through an array; anything else throws). The fidelity block below runs the same guard
 *     scenarios on MangoDB and on the mock and requires identical outcomes, so a keyed mock test
 *     cannot pass vacuously (before LIN-4556 the mock matched no `$nor` filter at all and stored
 *     nothing).
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { MangoClient } from '@jkershaw/mangodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { validateFeedbackBody, FEEDBACK_KEY_ERROR, FEEDBACK_KEY_MAX_LENGTH } from '../../lib/dispatch-feedback-validation.js';
import { MASK } from '../../lib/mask-secrets.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { FIXTURE_SECRETS as F } from '../fixtures/secret-scan-fixtures.js';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';

const URL_KEY = ACME;
const LABEL = 'token-a';
const RUNNER_TOKEN_ID = 't1';
const KEY = '2a7ae34a-0000-4000-8000-000000000001:1204:1/1';

// ── One MangoDB tmpdir instance for the file ────────────────────────────────

let dbDir;
let client;
let dbN = 0;
before(async () => {
  dbDir = mkdtempSync(join(tmpdir(), 'lin-4556-keyed-'));
  client = new MangoClient(dbDir);
  await client.connect();
});
after(async () => {
  if (client?.close) await client.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

function mangoStore() {
  const db = client.db(`keyed_${dbN++}`);
  return new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
}
const mockStore = () => new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });

async function taken(store, { label = LABEL, tokenId = null, ...overrides } = {}) {
  const item = await store.addItem(URL_KEY, { prompt: 'p', kind: 'implementation', issueIdentifier: 'LIN-42', ...overrides });
  await store.takeItem(item._id, URL_KEY, label, tokenId);
  return item;
}
const rowOf = (store, id) => store.historyCollection.findOne({ _id: id });

// ── Mock fidelity: same scenarios, MangoDB and mock agree ───────────────────

describe('LIN-4556 fidelity: the mock evaluates the keyed guard as MangoDB does', () => {
  const guard = (k) => ({ $nor: [{ 'feedback.key': k }] });
  const scenarios = [
    ['append twice under the guard', [{ _id: 'a', feedback: [] }], async (c) => {
      const out = [];
      for (let i = 0; i < 2; i++) out.push(!!(await c.findOneAndUpdate({ _id: 'a', ...guard('k1') }, { $push: { feedback: { key: 'k1', m: i } } }, { returnDocument: 'after' })));
      return { matched: out, stored: (await c.findOne({ _id: 'a' })).feedback.length };
    }],
    ['a row with no feedback field matches', [{ _id: 'a' }], async (c) => !!(await c.findOne({ _id: 'a', ...guard('k1') }))],
    ['un-keyed entries and other keys do not block', [{ _id: 'a', feedback: [{ m: 'x' }, { key: 'k2' }] }], async (c) => !!(await c.findOne({ _id: 'a', ...guard('k1') }))],
    ['the held key blocks among others', [{ _id: 'a', feedback: [{ m: 'x' }, { key: 'k2' }, { key: 'k1' }] }], async (c) => !!(await c.findOne({ _id: 'a', ...guard('k1') }))],
    ['dot-path equality through the array finds the holder', [{ _id: 'a', feedback: [{ key: 'k1' }] }, { _id: 'b', feedback: [{ key: 'k2' }] }], async (c) => (await c.findOne({ 'feedback.key': 'k2' }))?._id ?? null],
    ['$nor with two clauses refuses when either matches', [{ _id: 'a', status: 'taken', feedback: [] }], async (c) => [
      !!(await c.findOne({ _id: 'a', $nor: [{ 'feedback.key': 'k1' }, { status: 'gone' }] })),
      !!(await c.findOne({ _id: 'a', $nor: [{ 'feedback.key': 'k1' }, { status: 'taken' }] }))
    ]],
    ['dot path through a plain object', [{ _id: 'a', meta: { owner: 'u1' } }], async (c) => [!!(await c.findOne({ 'meta.owner': 'u1' })), !!(await c.findOne({ 'meta.owner': 'u2' }))]]
  ];

  for (const [name, seed, run] of scenarios) {
    test(name, async () => {
      const mango = client.db(`fid_${dbN++}`).collection('rows');
      const mock = createMockCollection();
      for (const d of seed) { await mango.insertOne(structuredClone(d)); await mock.insertOne(structuredClone(d)); }
      const [m, k] = [await run(mango), await run(mock)];
      assert.deepEqual(k, m, `mock ${JSON.stringify(k)} must equal MangoDB ${JSON.stringify(m)}`);
    });
  }

  test('the expected guard outcomes hold (not merely equal): one append lands, the second is refused', async () => {
    const mock = createMockCollection();
    await mock.insertOne({ _id: 'a', feedback: [] });
    const first = await mock.findOneAndUpdate({ _id: 'a', ...guard('k1') }, { $push: { feedback: { key: 'k1' } } }, { returnDocument: 'after' });
    const second = await mock.findOneAndUpdate({ _id: 'a', ...guard('k1') }, { $push: { feedback: { key: 'k1' } } }, { returnDocument: 'after' });
    assert.ok(first, 'the first keyed append must land (a never-matching mock would fail here)');
    assert.equal(second, null);
    assert.equal((await mock.findOne({ _id: 'a' })).feedback.length, 1);
  });

  test('the mock refuses to model a negation through an array ($ne differs between engines)', async () => {
    const mock = createMockCollection();
    await mock.insertOne({ _id: 'a', feedback: [{ key: 'k1' }] });
    await assert.rejects(mock.findOne({ 'feedback.key': { $ne: 'k1' } }), /only plain equality is modelled/);
  });
});

// ── Validation ──────────────────────────────────────────────────────────────

describe('LIN-4556: validateFeedbackBody bounds the key', () => {
  test('a well-formed key is passed through, last in the payload', () => {
    const { value, error } = validateFeedbackBody({ message: 'm', key: KEY });
    assert.equal(error, undefined);
    assert.deepEqual(Object.keys(value), ['message', 'url', 'urlLabel', 'kind', 'rootItemId', 'key']);
    assert.equal(value.key, KEY);
  });

  test('a key of exactly the maximum length is accepted', () => {
    assert.equal(validateFeedbackBody({ message: 'm', key: 'a'.repeat(FEEDBACK_KEY_MAX_LENGTH) }).value.key.length, FEEDBACK_KEY_MAX_LENGTH);
  });

  test('null or absent key means no key, and the payload is today\'s', () => {
    for (const body of [{ message: 'm' }, { message: 'm', key: null }, { message: 'm', key: undefined }]) {
      const { value } = validateFeedbackBody(body);
      assert.deepEqual(Object.keys(value), ['message', 'url', 'urlLabel', 'kind', 'rootItemId']);
    }
  });

  for (const [why, key] of [
    ['empty', ''], ['a space inside', 'run 1'], ['a leading space', ' run-1'], ['a trailing newline', 'run-1\n'],
    ['too long', 'a'.repeat(FEEDBACK_KEY_MAX_LENGTH + 1)], ['a number', 42], ['an object', { k: 1 }], ['an array', ['k']],
    ['starts with punctuation', '-run'], ['a non-ASCII letter', 'rün-1'], ['a quote', 'run"1']
  ]) {
    test(`a key that is ${why} is refused with a clear message`, () => {
      assert.deepEqual(validateFeedbackBody({ message: 'm', key }), { error: FEEDBACK_KEY_ERROR });
    });
  }

  test('older refusals keep precedence: a bad message is reported before a bad key', () => {
    assert.equal(validateFeedbackBody({ key: '' }).error, 'message is required and must be a string');
  });
});

// ── The store's keyed append (MangoDB) ──────────────────────────────────────

describe('LIN-4556: addFeedback with a key (MangoDB)', () => {
  test('a keyed post sent twice stores one entry; the second is acknowledged as a duplicate', async () => {
    const store = mangoStore();
    const item = await taken(store);

    const first = await store.addFeedback(item._id, URL_KEY, { message: 'words', kind: 'assistant-text', key: KEY }, LABEL);
    const second = await store.addFeedback(item._id, URL_KEY, { message: 'words', kind: 'assistant-text', key: KEY }, LABEL);

    assert.deepEqual(first, { success: true, feedbackCount: 1 });
    assert.deepEqual(second, { success: true, feedbackCount: 1, duplicate: true });
    const row = await rowOf(store, item._id);
    assert.equal(row.feedback.length, 1);
    assert.equal(row.feedbackVersion, 1, 'the duplicate did not touch the row');
    assert.deepEqual(Object.keys(row.feedback[0]), ['message', 'url', 'urlLabel', 'timestamp', 'kind', 'key']);
  });

  test('20 concurrent keyed twins store exactly one entry, and every caller is told success', async () => {
    const store = mangoStore();
    const item = await taken(store);

    const results = await Promise.all(Array.from({ length: 20 }, () =>
      store.addFeedback(item._id, URL_KEY, { message: 'once', key: KEY }, LABEL)));

    assert.ok(results.every((r) => r?.success === true), JSON.stringify(results));
    assert.equal(results.filter((r) => !r.duplicate).length, 1, 'exactly one caller appended');
    assert.equal((await rowOf(store, item._id)).feedback.length, 1);
  });

  test('distinct keys each append; an un-keyed post beside them stores as today', async () => {
    const store = mangoStore();
    const item = await taken(store);

    await store.addFeedback(item._id, URL_KEY, { message: 'a', key: 'k:1' }, LABEL);
    await store.addFeedback(item._id, URL_KEY, { message: 'b', key: 'k:2' }, LABEL);
    await store.addFeedback(item._id, URL_KEY, { message: 'c' }, LABEL);
    await store.addFeedback(item._id, URL_KEY, { message: 'c' }, LABEL);

    const row = await rowOf(store, item._id);
    assert.deepEqual(row.feedback.map((f) => f.message), ['a', 'b', 'c', 'c']);
    assert.deepEqual(Object.keys(row.feedback[2]), ['message', 'url', 'urlLabel', 'timestamp']);
  });

  test('the key alone decides: a retry with different text under the same key is the duplicate', async () => {
    const store = mangoStore();
    const item = await taken(store);
    await store.addFeedback(item._id, URL_KEY, { message: 'first text', key: KEY }, LABEL);

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'other text', key: KEY }, LABEL);

    assert.equal(res.duplicate, true);
    assert.deepEqual((await rowOf(store, item._id)).feedback.map((f) => f.message), ['first text']);
  });

  test('(a) a keyed duplicate on a finished row (after [done]) is still acknowledged', async () => {
    const store = mangoStore();
    const item = await taken(store);
    await store.addFeedback(item._id, URL_KEY, { message: 'late words', key: KEY }, LABEL);
    await store.addFeedback(item._id, URL_KEY, { message: '[done] shipped' }, LABEL);

    assert.deepEqual(await store.addFeedback(item._id, URL_KEY, { message: 'late words', key: KEY }, LABEL), { success: true, feedbackCount: 2, duplicate: true });
  });

  test('(b) a keyed post to a gone row, or to a row another token took, is still null (the 404)', async () => {
    const store = mangoStore();
    const item = await taken(store);
    await store.addFeedback(item._id, URL_KEY, { message: 'held', key: KEY }, LABEL);

    assert.equal(await store.addFeedback(item._id, URL_KEY, { message: 'held', key: KEY }, 'someone-else'), null, 'another token never learns the key is held');
    assert.equal(await store.addFeedback('11111111-1111-4111-8111-111111111111', URL_KEY, { message: 'held', key: KEY }, LABEL), null);
    assert.equal(await store.addFeedback(item._id, 'other-workspace', { message: 'held', key: KEY }, LABEL), null);
  });

  test('a keyed duplicate [done] runs no run-record, wake or closer step, and the parent wakes once', async () => {
    const store = mangoStore();
    const child = await taken(store, { sessionId: 'parent-S1', subscription: 'everything' });
    const calls = { runRecords: 0, planWake: 0, deliverWake: 0, closeLineage: 0 };
    for (const [name, counter] of [['_runRecordsSeam', 'runRecords'], ['_planWake', 'planWake'], ['_deliverWake', 'deliverWake'], ['closeLineageRows', 'closeLineage']]) {
      const real = store[name].bind(store);
      store[name] = async (...args) => { if (name !== '_runRecordsSeam' || args[0] === 'onFeedback') calls[counter]++; return real(...args); };
    }

    const doneKey = `${KEY}:done`;
    const first = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped', rootItemId: '22222222-2222-4222-8222-222222222222', key: doneKey }, LABEL);
    const after1 = { ...calls };
    const second = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped', rootItemId: '22222222-2222-4222-8222-222222222222', key: doneKey }, LABEL);

    // The wake enqueue itself was already once-only per producing item (LIN-1357's CAS); what the
    // key adds is that the duplicate runs none of the post-append steps at all.
    assert.equal(after1.planWake, 1);
    assert.deepEqual(calls, after1, 'the duplicate ran none of the post-append steps');
    assert.equal((await rowOf(store, child._id)).feedback.length, 1);
    const wakes = await store.collection.find({ urlKey: URL_KEY, kind: 'wake' }).toArray();
    assert.equal(wakes.length, 1, 'exactly one wake');
    assert.equal(first.duplicate, undefined);
    assert.equal(second.duplicate, true);
  });
});

// ── Keyed continuation chunks (beat 2's seam) ───────────────────────────────

describe('LIN-4556: keyed assistant-text chunks keep the seam masking', () => {
  const pem = F.privateKey.split('\n');
  const c1 = `(assistant-text 1/2)\nHere is the key I found:\n${pem[0]}`;
  const c2 = `(assistant-text 2/2)\n${pem.slice(1).join('\n')}\nand that was the end.`;

  test('a keyed split-key pair sent in order is masked once; retrying chunk 2 (and then chunk 1) is acknowledged and changes nothing', async () => {
    const store = mangoStore();
    const item = await taken(store);
    const post = (message, key) => store.addFeedback(item._id, URL_KEY, { message, kind: 'assistant-text', key }, LABEL);

    assert.equal((await post(c1, 'run:7:1/2')).feedbackCount, 1);
    assert.equal((await post(c2, 'run:7:2/2')).feedbackCount, 2);
    const stored = (await rowOf(store, item._id)).feedback.map((f) => f.message);
    assert.equal(stored[1], `(assistant-text 2/2)\n${MASK}\nand that was the end.`);

    assert.deepEqual(await post(c2, 'run:7:2/2'), { success: true, feedbackCount: 2, duplicate: true });
    assert.deepEqual(await post(c1, 'run:7:1/2'), { success: true, feedbackCount: 2, duplicate: true });
    assert.deepEqual((await rowOf(store, item._id)).feedback.map((f) => f.message), stored, 'not double-masked, not re-seamed, not re-appended');
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

async function serve(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function proxyApp(store) {
  return buildApp({
    dispatchQueueStore: store,
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: RUNNER_TOKEN_ID, urlKey: URL_KEY, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants: ['take', 'dispatch'] }),
      listTokens: async () => [],
      describeRejectionCause: async () => null
    }
  });
}

async function readFeedback(store, id) {
  const res = await call(proxyApp(store), 'GET', `/api/proxy/dispatch/${id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.feedback;
}

describe('LIN-4556: both routes pass the key through; GET /api/proxy/dispatch/:id reads the single entry', () => {
  test('runner route: twice -> 200 then 200 duplicate, one entry; a malformed key is a 400', async () => {
    const store = mockStore();
    const item = await taken(store, { label: 'runner', tokenId: RUNNER_TOKEN_ID });
    const app = proxyApp(store);
    const path = `/api/proxy/runner/feedback/${item._id}`;

    const one = await call(app, 'POST', path, { body: { message: 'words', kind: 'assistant-text', key: KEY } });
    const two = await call(app, 'POST', path, { body: { message: 'words', kind: 'assistant-text', key: KEY } });
    const bad = await call(app, 'POST', path, { body: { message: 'words', key: 'has space' } });

    assert.deepEqual([one.status, one.body], [200, { success: true, feedbackCount: 1 }]);
    assert.deepEqual([two.status, two.body], [200, { success: true, feedbackCount: 1, duplicate: true }]);
    assert.equal(bad.status, 400);
    assert.match(JSON.stringify(bad.body), /key must be a string of 1-128 characters/);
    const fb = await readFeedback(store, item._id);
    assert.equal(fb.length, 1);
    assert.equal(fb[0].message, 'words');
  });

  test('dispatch-token route: twice -> 200 then 200 duplicate, one entry; a malformed key is a 400', async () => {
    const store = mockStore();
    const tokens = new DispatchTokenStore({ collection: createMockCollection() });
    const { token } = await tokens.createToken(URL_KEY, LABEL, 'acct-1');
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: store,
      dispatchTokenStore: tokens,
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY }; next(); },
      userPreferencesStore: {},
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      proxyTokenStore: { createToken: async () => ({ token: 'tok' }) }
    }));
    const item = await taken(store);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    await serve(app, async (base) => {
      const post = (body) => fetch(`${base}/api/dispatch/feedback/${item._id}`, { method: 'POST', headers, body: JSON.stringify(body) })
        .then(async (r) => [r.status, await r.json()]);
      assert.deepEqual(await post({ message: 'words', key: KEY }), [200, { success: true, feedbackCount: 1 }]);
      assert.deepEqual(await post({ message: 'words', key: KEY }), [200, { success: true, feedbackCount: 1, duplicate: true }]);
      const [status, body] = await post({ message: 'words', key: '' });
      assert.equal(status, 400);
      assert.match(JSON.stringify(body), /key must be a string of 1-128 characters/);
    });
    const fb = await readFeedback(store, item._id);
    assert.equal(fb.length, 1);
  });

  test('a keyed post to a row this token does not hold stays a 404 on the runner route', async () => {
    const store = mockStore();
    const item = await taken(store); // taken by a dispatch token, not the runner
    await store.addFeedback(item._id, URL_KEY, { message: 'held', key: KEY }, LABEL);

    const res = await call(proxyApp(store), 'POST', `/api/proxy/runner/feedback/${item._id}`, { body: { message: 'held', key: KEY } });

    assert.equal(res.status, 404);
  });
});
