/**
 * Unit tests for lib/close-out-events-store.js (LIN-3248, P3 of LIN-2949; S16).
 *
 * Run with: node --test tests/unit/close-out-events-store.test.js
 *
 * Covers the append-only record contract: the full schema, a person/press split,
 * the open-ledger-item counts at merge, idempotency on `urlKey + prUrl +
 * headSha`, that recording never throws, and that reads are scoped and
 * fail-open. Reads run on a real MangoDB engine.
 */
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';
import { CloseOutEventsStore, validateCloseOutEvent, CLOSE_OUT_BY } from '../../lib/close-out-events-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const PR_URL = 'https://github.com/JKershaw/LinearViewer/pull/41';

const personMerge = (over = {}) => ({
  urlKey: 'ws',
  accountId: 'acct-1',
  issueId: 'uuid-42',
  issueIdentifier: 'LIN-42',
  by: 'person',
  prUrl: PR_URL,
  headSha: 'abc1234',
  merged: true,
  openItems: { inside: 1, outside: 2, unknown: 0, total: 3 },
  ...over,
});

const pressEvent = (over = {}) => ({
  urlKey: 'ws',
  accountId: 'acct-1',
  issueId: 'uuid-42',
  issueIdentifier: 'LIN-42',
  by: 'press',
  dispatchId: 'dispatch-9',
  prUrl: PR_URL,
  headSha: 'abc1234',
  merged: false,
  openItems: { inside: 0, outside: 0, unknown: 0, total: 0 },
  ...over,
});

const harness = createMangoTmpdir('lin-3248-close-out-events-');
before(() => harness.connect());
after(() => harness.close());

describe('vocabulary + validation', () => {
  test('CLOSE_OUT_BY is frozen and exactly person/press', () => {
    assert.deepStrictEqual([...CLOSE_OUT_BY], ['person', 'press']);
    assert.ok(Object.isFrozen(CLOSE_OUT_BY));
  });

  test('accepts a person merge and a press', () => {
    assert.strictEqual(validateCloseOutEvent(personMerge()), null);
    assert.strictEqual(validateCloseOutEvent(pressEvent()), null);
  });

  test('rejects out-of-vocabulary and broken invariants', () => {
    const cases = {
      'missing urlKey': personMerge({ urlKey: '' }),
      'missing issueIdentifier': personMerge({ issueIdentifier: null }),
      'missing prUrl': personMerge({ prUrl: undefined }),
      'unknown by': personMerge({ by: 'robot' }),
      'press without dispatchId': pressEvent({ dispatchId: null }),
      'person with a dispatchId': personMerge({ dispatchId: 'd-1' }),
      'merged not boolean': personMerge({ merged: 'yes' }),
      'negative count': personMerge({ openItems: { inside: -1, outside: 0, unknown: 0, total: 0 } }),
      'non-integer count': personMerge({ openItems: { inside: 0.5, outside: 0, unknown: 0, total: 1 } }),
      'missing openItems': personMerge({ openItems: null }),
      'oversized identifier': personMerge({ issueIdentifier: 'x'.repeat(201) }),
      'control characters': personMerge({ issueIdentifier: 'LIN-42\n' }),
    };
    for (const [name, event] of Object.entries(cases)) {
      assert.strictEqual(typeof validateCloseOutEvent(event), 'string', name);
    }
    assert.strictEqual(typeof validateCloseOutEvent(null), 'string');
  });
});

describe('CloseOutEventsStore.record', () => {
  let db;
  let store;

  beforeEach(() => {
    db = harness.freshDb();
    store = new CloseOutEventsStore({ collection: db.collection('close-out-events') });
  });

  test('stores one document per event with the full schema and a server timestamp', async () => {
    const before = Date.now();
    const doc = await store.record(personMerge());
    const [stored] = await db.collection('close-out-events').find({}).toArray();
    assert.deepStrictEqual(Object.keys(stored).sort(), [
      '_id', 'accountId', 'at', 'by', 'dispatchId', 'headSha', 'issueId', 'issueIdentifier', 'merged', 'openItems', 'prUrl', 'urlKey'
    ]);
    assert.strictEqual(stored._id, doc._id);
    assert.strictEqual(stored.by, 'person');
    assert.strictEqual(stored.dispatchId, null);
    assert.strictEqual(stored.merged, true);
    assert.deepStrictEqual(stored.openItems, { inside: 1, outside: 2, unknown: 0, total: 3 });
    assert.ok(new Date(stored.at).getTime() >= before);
  });

  test('records a press with its dispatchId', async () => {
    await store.record(pressEvent());
    const [stored] = await db.collection('close-out-events').find({}).toArray();
    assert.strictEqual(stored.by, 'press');
    assert.strictEqual(stored.dispatchId, 'dispatch-9');
    assert.strictEqual(stored.merged, false);
  });

  test('is idempotent on urlKey + prUrl + headSha + by: a repeat returns the first doc, no second row', async () => {
    const first = await store.record(personMerge());
    const second = await store.record(personMerge({ accountId: 'acct-2', openItems: { inside: 9, outside: 0, unknown: 0, total: 9 } }));
    assert.strictEqual(second._id, first._id);
    assert.strictEqual((await db.collection('close-out-events').find({}).toArray()).length, 1);
  });

  test('B2: a press followed by a person merge on the same head records TWO docs, and the merge carries merged + open counts', async () => {
    const press = await store.record(pressEvent({ merged: false }));
    const merge = await store.record(personMerge({ merged: true, openItems: { inside: 2, outside: 1, unknown: 0, total: 3 } }));
    assert.notStrictEqual(merge._id, press._id);
    const docs = await db.collection('close-out-events').find({}).toArray();
    assert.strictEqual(docs.length, 2);
    const mergeDoc = docs.find(d => d.by === 'person');
    assert.strictEqual(mergeDoc.merged, true);
    assert.deepStrictEqual(mergeDoc.openItems, { inside: 2, outside: 1, unknown: 0, total: 3 });
    // The key is scoped by `by`: each kind answers for itself on the same head.
    const personHit = await store.getByPr({ urlKey: 'ws', prUrl: PR_URL, headSha: 'abc1234', by: 'person' });
    const pressHit = await store.getByPr({ urlKey: 'ws', prUrl: PR_URL, headSha: 'abc1234', by: 'press' });
    assert.strictEqual(personHit._id, merge._id);
    assert.strictEqual(pressHit._id, press._id);
  });

  test('a different headSha is a new event', async () => {
    await store.record(personMerge());
    await store.record(personMerge({ headSha: 'def5678' }));
    assert.strictEqual((await db.collection('close-out-events').find({}).toArray()).length, 2);
  });

  test('an invalid event is not stored, returns null and does not throw', async () => {
    assert.strictEqual(await store.record(personMerge({ by: 'robot' })), null);
    assert.strictEqual(await store.record(undefined), null);
    assert.strictEqual((await db.collection('close-out-events').find({}).toArray()).length, 0);
  });

  test('a failing collection never throws: the unpersisted doc is still returned', async () => {
    const failing = new CloseOutEventsStore({
      collection: {
        findOne: async () => { throw new Error('db down'); },
        insertOne: async () => { throw new Error('db down'); },
      },
    });
    const doc = await failing.record(personMerge());
    assert.strictEqual(doc.by, 'person');
    assert.strictEqual(doc.prUrl, PR_URL);
  });
});

describe('CloseOutEventsStore reads', () => {
  let store;

  beforeEach(() => {
    store = new CloseOutEventsStore({ collection: harness.freshDb().collection('close-out-events') });
  });

  test('getByPr finds the idempotency key, scoped to the workspace', async () => {
    await store.record(personMerge());
    const found = await store.getByPr({ urlKey: 'ws', prUrl: PR_URL, headSha: 'abc1234', by: 'person' });
    assert.strictEqual(found.by, 'person');
    assert.strictEqual(await store.getByPr({ urlKey: 'other', prUrl: PR_URL, headSha: 'abc1234', by: 'person' }), null);
  });

  test('listForIssue returns the task\'s events oldest-first', async () => {
    await store.record(pressEvent({ headSha: 'one' }));
    await new Promise(resolve => setTimeout(resolve, 3));
    await store.record(personMerge({ headSha: 'two' }));
    await store.record(personMerge({ issueIdentifier: 'LIN-99', headSha: 'three' }));
    const events = await store.listForIssue({ urlKey: 'ws', issueIdentifier: 'LIN-42' });
    assert.deepStrictEqual(events.map(e => e.headSha), ['one', 'two']);
  });

  test('a failing collection never throws: reads return null / empty', async () => {
    const failing = new CloseOutEventsStore({ collection: { find: () => { throw new Error('db down'); }, findOne: () => { throw new Error('db down'); } } });
    assert.strictEqual(await failing.getByPr({ urlKey: 'ws', prUrl: PR_URL, headSha: 'abc1234', by: 'person' }), null);
    assert.deepStrictEqual(await failing.listForIssue({ urlKey: 'ws', issueIdentifier: 'LIN-42' }), []);
  });
});

describe('CloseOutEventsStore.clear', () => {
  test('deletes only the named workspace\'s events (the test-only clear seam)', async () => {
    const store = new CloseOutEventsStore({ collection: harness.freshDb().collection('close-out-events') });
    await store.record(personMerge());
    await store.record(personMerge({ urlKey: 'other-ws', prUrl: 'https://github.com/JKershaw/LinearViewer/pull/77' }));
    assert.strictEqual(await store.clear('ws'), 1);
    assert.strictEqual((await store.listForIssue({ urlKey: 'other-ws', issueIdentifier: 'LIN-42' })).length, 1);
    assert.strictEqual(await store.clear(''), 0);
  });
});
