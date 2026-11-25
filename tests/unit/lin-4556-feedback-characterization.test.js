/**
 * LIN-4556 (LIN-4508 piece A), beat 1: characterization of an UN-KEYED feedback post as it
 * is today, written before masking or the keyed append change anything.
 *
 * The piece promises "un-keyed posts store exactly as today". These tests are that promise
 * made checkable: they pin the stored entry's key set and values, the append order, the
 * `[done]` / `[blocked]` marker handling, what a post to a closed or missing row answers
 * (the store's `null`, each route's 404), the validator's payload shape, and the exact
 * feedback object each route hands `addFeedback`. Each passed on unchanged code (main at
 * 4368dec9d) and must keep passing after the change.
 *
 * Deliberately NOT pinned here: that a secret is stored as posted. That is today's
 * behaviour but it is the defect piece A removes; the masking witnesses (beat 2) are
 * observed failing against it instead.
 *
 * A last block records how the test DB (@jkershaw/mangodb) evaluates the filters a keyed
 * append could use (finding-9cb8380b), so beat 3's guard is grounded in observed engine
 * behaviour rather than the plan's prose.
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
import { validateFeedbackBody } from '../../lib/dispatch-feedback-validation.js';
import { deriveTerminalStatus, findWakeEvent, isLineageClosingTerminal } from '../../lib/dispatch-terminal.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { ACME, buildApp, call } from './lib/proxy-fake-deps.js';

const URL_KEY = ACME;
const TOKEN = 'token-a';
const ROOT = '22222222-2222-4222-8222-222222222222';

function makeStore() {
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

async function takenItem(store, overrides = {}) {
  const item = await store.addItem(URL_KEY, { prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42', ...overrides });
  await store.takeItem(item._id, URL_KEY, TOKEN);
  return item;
}

const storedRow = (store, id) => store.historyCollection._docs.find((d) => d._id === id);

// ── The stored entry ────────────────────────────────────────────────────────

describe('LIN-4556 characterization: the stored un-keyed entry', () => {
  test('a bare message stores exactly {message, url:null, urlLabel:null, timestamp} and answers {success, feedbackCount}', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const before = Date.now();

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'working on it' }, TOKEN);

    assert.deepEqual(res, { success: true, feedbackCount: 1 });
    const row = storedRow(store, item._id);
    assert.equal(row.feedback.length, 1);
    const [entry] = row.feedback;
    assert.deepEqual(Object.keys(entry), ['message', 'url', 'urlLabel', 'timestamp'], 'key set AND order are today\'s');
    assert.equal(entry.message, 'working on it');
    assert.equal(entry.url, null);
    assert.equal(entry.urlLabel, null);
    assert.ok(entry.timestamp instanceof Date && entry.timestamp.getTime() >= before);
    assert.equal(row.feedbackVersion, 1);
    assert.equal(row.lineageFeedbackCount, 1);
  });

  test('url, urlLabel, kind and rootItemId are stored as given, kind and rootItemId only when present, in that key order', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(item._id, URL_KEY, {
      message: 'opened the PR', url: 'https://github.com/o/r/pull/1', urlLabel: 'PR #1', kind: 'status', rootItemId: ROOT
    }, TOKEN);

    const row = storedRow(store, item._id);
    const [entry] = row.feedback;
    assert.deepEqual(Object.keys(entry), ['message', 'url', 'urlLabel', 'timestamp', 'kind', 'rootItemId']);
    assert.equal(entry.url, 'https://github.com/o/r/pull/1');
    assert.equal(entry.urlLabel, 'PR #1');
    assert.equal(entry.kind, 'status');
    assert.equal(entry.rootItemId, ROOT);
    assert.equal(row.rootItemId, ROOT, 'rootItemId is reconciled onto the row in the same update (LIN-1468)');
  });

  test('empty-string url/urlLabel are stored as null; an absent kind/rootItemId leaves no key at all', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(item._id, URL_KEY, { message: 'm', url: '', urlLabel: '', kind: undefined, rootItemId: undefined }, TOKEN);

    const [entry] = storedRow(store, item._id).feedback;
    assert.equal(entry.url, null);
    assert.equal(entry.urlLabel, null);
    assert.ok(!('kind' in entry) && !('rootItemId' in entry) && !('key' in entry));
  });

  test('ordinary code prose and a multi-line assistant-text chunk are stored byte-for-byte', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const prose = '(assistant-text 1/2) Ran `npm test` in lib/dispatch-store.js; const token = req.headers.authorization;\nNext: fix the 404.';

    await store.addFeedback(item._id, URL_KEY, { message: prose, kind: 'assistant-text' }, TOKEN);

    assert.equal(storedRow(store, item._id).feedback[0].message, prose);
  });
});

// ── Order ───────────────────────────────────────────────────────────────────

describe('LIN-4556 characterization: ordering', () => {
  test('sequential posts append in post order and feedbackCount is the array length after each', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    const counts = [];
    for (const message of ['one', 'two', 'three']) {
      counts.push((await store.addFeedback(item._id, URL_KEY, { message }, TOKEN)).feedbackCount);
    }

    assert.deepEqual(counts, [1, 2, 3]);
    assert.deepEqual(storedRow(store, item._id).feedback.map((f) => f.message), ['one', 'two', 'three']);
  });

  test('the same un-keyed message posted twice stores two entries (no dedupe today: a retry duplicates)', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(item._id, URL_KEY, { message: 'same words', kind: 'assistant-text' }, TOKEN);
    const res = await store.addFeedback(item._id, URL_KEY, { message: 'same words', kind: 'assistant-text' }, TOKEN);

    assert.equal(res.feedbackCount, 2);
    assert.deepEqual(storedRow(store, item._id).feedback.map((f) => f.message), ['same words', 'same words']);
  });
});

// ── Markers ─────────────────────────────────────────────────────────────────

describe('LIN-4556 characterization: [done] / [blocked] markers', () => {
  test('a [done] line is stored verbatim and reads as the terminal; the row stays taken', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const done = '[done] PR opened https://github.com/o/r/pull/9';

    await store.addFeedback(item._id, URL_KEY, { message: done, url: 'https://github.com/o/r/pull/9' }, TOKEN);

    const row = storedRow(store, item._id);
    assert.equal(row.feedback[0].message, done);
    assert.equal(deriveTerminalStatus(row.feedback), 'done');
    assert.equal(isLineageClosingTerminal({ message: row.feedback[0].message }), true);
    assert.equal(findWakeEvent(row.feedback).marker, 'done');
    assert.equal(row.status, 'taken', 'a terminal marker does not change the row status');
  });

  test('a [blocked] line is stored verbatim: a wake event, not a terminal', async () => {
    const store = makeStore();
    const item = await takenItem(store);

    await store.addFeedback(item._id, URL_KEY, { message: '[blocked] need a person to pick a route' }, TOKEN);

    const row = storedRow(store, item._id);
    assert.equal(row.feedback[0].message, '[blocked] need a person to pick a route');
    assert.equal(deriveTerminalStatus(row.feedback), null, '[blocked] is a pause, never a completion');
    assert.equal(findWakeEvent(row.feedback).marker, 'blocked');
    assert.equal(row.status, 'taken');
  });

  test('a post after [done] is still accepted and appended (the row is still taken)', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    await store.addFeedback(item._id, URL_KEY, { message: '[done] finished' }, TOKEN);

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'a late assistant-text chunk', kind: 'assistant-text' }, TOKEN);

    assert.deepEqual(res, { success: true, feedbackCount: 2 });
    assert.deepEqual(storedRow(store, item._id).feedback.map((f) => f.message), ['[done] finished', 'a late assistant-text chunk']);
  });
});

// ── Closed and gone rows ────────────────────────────────────────────────────

describe('LIN-4556 characterization: closed and gone rows', () => {
  test('a bookkept (closed) row that is still taken accepts the post: the filter does not read bookkeeping', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    const stamp = await store.stampBookkeeping(URL_KEY, item._id, { by: 'test', reason: 'lineage-terminal' });
    assert.equal(stamp.ok, true);

    const res = await store.addFeedback(item._id, URL_KEY, { message: 'after close' }, TOKEN);

    assert.deepEqual(res, { success: true, feedbackCount: 1 });
  });

  for (const status of ['expired', 'cancelled', 'available']) {
    test(`a history row with status "${status}" answers null and is not written`, async () => {
      const store = makeStore();
      await store.historyCollection.insertOne({ _id: `row-${status}`, urlKey: URL_KEY, status, takenByTokenLabel: TOKEN });

      const res = await store.addFeedback(`row-${status}`, URL_KEY, { message: 'x' }, TOKEN);

      assert.equal(res, null);
      assert.ok(!('feedback' in storedRow(store, `row-${status}`)));
    });
  }

  test('a missing (gone, e.g. TTL-expired) row answers null', async () => {
    const store = makeStore();
    assert.equal(await store.addFeedback('11111111-1111-4111-8111-111111111111', URL_KEY, { message: 'x' }, TOKEN), null);
  });

  test('a row taken by another token answers null: ownership collapses into the same null', async () => {
    const store = makeStore();
    const item = await takenItem(store);
    assert.equal(await store.addFeedback(item._id, URL_KEY, { message: 'x' }, 'someone-else'), null);
    assert.ok(!('feedback' in storedRow(store, item._id)));
  });
});

// ── Validation ──────────────────────────────────────────────────────────────

describe('LIN-4556 characterization: validateFeedbackBody for an un-keyed post', () => {
  test('the payload is exactly {message, url, urlLabel, kind, rootItemId}, absent ones null/undefined', () => {
    const { value, error } = validateFeedbackBody({ message: 'm' });
    assert.equal(error, undefined);
    assert.deepEqual(Object.keys(value), ['message', 'url', 'urlLabel', 'kind', 'rootItemId']);
    assert.deepEqual(value, { message: 'm', url: null, urlLabel: null, kind: undefined, rootItemId: undefined });
  });

  // Beat 3 (LIN-4556) made `key` a known field (validated, passed through); this pinned "a key is dropped today"
  // until then. The un-keyed half is unchanged: an unknown field is still dropped, never refused.
  test('an unknown body field is dropped silently, never refused', () => {
    const { value, error } = validateFeedbackBody({ message: 'm', extra: 1 });
    assert.equal(error, undefined);
    assert.ok(!('extra' in value));
  });

  test('an unknown kind and a malformed rootItemId are dropped (LIN-1297), not refused', () => {
    const { value } = validateFeedbackBody({ message: 'm', kind: 'nope', rootItemId: 'not-a-uuid' });
    assert.equal(value.kind, undefined);
    assert.equal(value.rootItemId, undefined);
  });

  test('refusals keep their words: missing message, over-length message, control characters', () => {
    assert.equal(validateFeedbackBody({}).error, 'message is required and must be a string');
    assert.equal(validateFeedbackBody({ message: 'x'.repeat(2001) }).error, 'message exceeds maximum length of 2000');
    assert.equal(validateFeedbackBody({ message: 'a\x00b' }).error, 'message contains invalid characters');
    assert.equal(validateFeedbackBody({ message: 'm', url: 'javascript:alert(1)' }).error, 'url must use http or https protocol');
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

describe('LIN-4556 characterization: POST /api/dispatch/feedback/:itemId (dispatch-token route, real store)', () => {
  async function setup() {
    const store = makeStore();
    const tokens = new DispatchTokenStore({ collection: createMockCollection() });
    const { token } = await tokens.createToken(URL_KEY, TOKEN, 'acct-1');
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
    return { store, app, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  }

  test('a post to a taken row answers 200 {success, feedbackCount} and stores today\'s entry', async () => {
    const { store, app, headers } = await setup();
    const item = await takenItem(store);
    await serve(app, async (base) => {
      const res = await fetch(`${base}/api/dispatch/feedback/${item._id}`, { method: 'POST', headers, body: JSON.stringify({ message: 'hello' }) }); // beat 3: was `key: 'ignored-today'`; a key is now honoured
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { success: true, feedbackCount: 1 });
    });
    const [entry] = storedRow(store, item._id).feedback;
    assert.deepEqual(Object.keys(entry), ['message', 'url', 'urlLabel', 'timestamp']);
  });

  test('a post to a missing row answers 404 "Item not found or feedback not allowed"', async () => {
    const { app, headers } = await setup();
    await serve(app, async (base) => {
      const res = await fetch(`${base}/api/dispatch/feedback/11111111-1111-4111-8111-111111111111`, { method: 'POST', headers, body: JSON.stringify({ message: 'x' }) });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.match(JSON.stringify(body), /Item not found or feedback not allowed/);
    });
  });
});

describe('LIN-4556 characterization: POST /api/proxy/runner/feedback/:id (runner route, store fake)', () => {
  const ID = '00000000-0000-4000-8000-000000000000';
  function makeApp(feedbackResult) {
    const calls = [];
    const dispatchQueueStore = {
      pollAvailable: async () => [],
      takeItem: async () => null,
      addFeedback: async (id, urlKey, feedback, label, provision, ownership) => {
        calls.push({ id, urlKey, feedback, label, ownership });
        return feedbackResult;
      }
    };
    const app = buildApp({
      proxyTokenStore: {
        validateToken: async () => ({ tokenId: 't1', urlKey: URL_KEY, label: 'runner', scope: 'readWrite', createdBy: 'u1', grants: ['take', 'dispatch'] }),
        listTokens: async () => [],
        describeRejectionCause: async () => null
      },
      dispatchQueueStore,
      dispatchTokenStore: { listTokens: async () => [] },
      workspaceHaltStore: { getWorkspaceHalt: async () => null, getLastKnownHalt: () => null, setWorkspaceHalt: async () => {}, clearWorkspaceHalt: async () => {} }
    });
    return { app, calls };
  }

  // Beat 3: the body carried `key: 'k1'` and pinned it dropped; a key now passes through (tests/unit/lin-4556-keyed-feedback.test.js).
  test('hands addFeedback the validator payload as is with ownership {takenByTokenId}', async () => {
    const { app, calls } = makeApp({ success: true, feedbackCount: 3 });
    const res = await call(app, 'POST', `/api/proxy/runner/feedback/${ID}`, { body: { message: 'm', kind: 'assistant-text' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { success: true, feedbackCount: 3 });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].feedback, { message: 'm', url: null, urlLabel: null, kind: 'assistant-text', rootItemId: undefined });
    assert.equal(calls[0].ownership.takenByTokenId, 't1');
  });

  test('a store null (closed, gone or not yours) answers 404 "Item not found or feedback not allowed"', async () => {
    const { app } = makeApp(null);
    const res = await call(app, 'POST', `/api/proxy/runner/feedback/${ID}`, { body: { message: 'm' } });
    assert.equal(res.status, 404);
    assert.match(JSON.stringify(res.body), /Item not found or feedback not allowed/);
  });
});

// ── MangoDB operator probe (finding-9cb8380b), grounding beat 3 ─────────────

describe('LIN-4556 probe: how @jkershaw/mangodb evaluates a "no entry with this key" filter', () => {
  let dbDir;
  let client;
  let n = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin-4556-probe-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  // Each guard is tried as the filter of an append that should land once and then be refused.
  async function appendTwice(guard) {
    const coll = client.db(`probe_${n++}`).collection('rows');
    await coll.insertOne({ _id: 'a', feedback: [{ message: 'unkeyed' }] });
    const results = [];
    for (let i = 0; i < 2; i++) {
      results.push(await coll.findOneAndUpdate({ _id: 'a', ...guard('k1') }, { $push: { feedback: { message: `m${i}`, key: 'k1' } } }, { returnDocument: 'after' }));
    }
    const doc = await coll.findOne({ _id: 'a' });
    return { matched: results.map((r) => r !== null), stored: doc.feedback.filter((f) => f.key === 'k1').length };
  }

  test('{"feedback.key": {$ne: k}} does NOT guard on MangoDB: both appends land (real MongoDB would refuse the second)', async () => {
    const r = await appendTwice((k) => ({ 'feedback.key': { $ne: k } }));
    assert.deepEqual(r, { matched: [true, true], stored: 2 });
  });

  test('{"feedback.key": {$nin: [k]}} does NOT guard on MangoDB either', async () => {
    const r = await appendTwice((k) => ({ 'feedback.key': { $nin: [k] } }));
    assert.deepEqual(r, { matched: [true, true], stored: 2 });
  });

  test('{feedback: {$not: {$elemMatch: {key: k}}}} guards: the second append is refused', async () => {
    const r = await appendTwice((k) => ({ feedback: { $not: { $elemMatch: { key: k } } } }));
    assert.deepEqual(r, { matched: [true, false], stored: 1 });
  });

  test('{$nor: [{"feedback.key": k}]} guards: the second append is refused', async () => {
    const r = await appendTwice((k) => ({ $nor: [{ 'feedback.key': k }] }));
    assert.deepEqual(r, { matched: [true, false], stored: 1 });
  });

  test('$nor matches a row with no feedback array at all (first post on a fresh row lands)', async () => {
    const coll = client.db(`probe_${n++}`).collection('rows');
    await coll.insertOne({ _id: 'a' });
    const r = await coll.findOneAndUpdate({ _id: 'a', $nor: [{ 'feedback.key': 'k1' }] }, { $push: { feedback: { key: 'k1' } } }, { returnDocument: 'after' });
    assert.ok(r, 'a fresh row (no feedback field) must match');
  });

  test('$not/$elemMatch matches a row with no feedback array at all', async () => {
    const coll = client.db(`probe_${n++}`).collection('rows');
    await coll.insertOne({ _id: 'a' });
    const r = await coll.findOneAndUpdate({ _id: 'a', feedback: { $not: { $elemMatch: { key: 'k1' } } } }, { $push: { feedback: { key: 'k1' } } }, { returnDocument: 'after' });
    assert.ok(r, 'a fresh row (no feedback field) must match');
  });

  test('$nor guard holds under 20 concurrent twins: exactly one lands', async () => {
    const coll = client.db(`probe_${n++}`).collection('rows');
    await coll.insertOne({ _id: 'a', feedback: [] });
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      coll.findOneAndUpdate({ _id: 'a', $nor: [{ 'feedback.key': 'k1' }] }, { $push: { feedback: { key: 'k1' } } }, { returnDocument: 'after' })));
    const doc = await coll.findOne({ _id: 'a' });
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(doc.feedback.length, 1);
  });
});

// The mock collection (tests/fixtures/mock-collection.js) backs most store tests; record what it does too,
// since a keyed-append test on the mock would otherwise be a false witness.
describe('LIN-4556 probe: the mock collection and the same guards', () => {
  // Beat 3 taught the mock `$nor` (proven against MangoDB in tests/unit/lin-4556-keyed-feedback.test.js), so its row
  // now pins the guard working; `$not/$elemMatch`, which the store does not use, stays unmodelled and never matches.
  for (const [label, guard, expected] of [
    ['$nor', (k) => ({ $nor: [{ 'feedback.key': k }] }), { first: true, second: false, stored: 1 }],
    ['$not/$elemMatch', (k) => ({ feedback: { $not: { $elemMatch: { key: k } } } }), { first: false, second: false, stored: 0 }]
  ]) {
    test(`mock: ${label} -> ${JSON.stringify(expected)}`, async () => {
      const coll = createMockCollection();
      await coll.insertOne({ _id: 'a', feedback: [] });
      let outcome;
      try {
        const first = await coll.findOneAndUpdate({ _id: 'a', ...guard('k1') }, { $push: { feedback: { key: 'k1' } } }, { returnDocument: 'after' });
        const second = await coll.findOneAndUpdate({ _id: 'a', ...guard('k1') }, { $push: { feedback: { key: 'k1' } } }, { returnDocument: 'after' });
        outcome = { first: !!first, second: !!second, stored: (await coll.findOne({ _id: 'a' })).feedback.length };
      } catch (err) {
        outcome = { error: err.message };
      }
      // Observed at 4368dec9d: the mock matched neither guard, so even the FIRST append was refused.
      assert.deepEqual(outcome, expected);
    });
  }
});
