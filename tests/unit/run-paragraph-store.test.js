/**
 * Unit tests for lib/run-paragraph-store.js (LIN-3253, LIN-2948 S3).
 *
 * Run with: node --test tests/unit/run-paragraph-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance because the store's claims ARE the index
 * posture and the persistence contract — a mock would encode the assumptions
 * instead of testing them. The load-bearing assertion is the NO-TTL one: the
 * paragraph must outlive every cache, so no `expireAfterSeconds` index may
 * exist on the collection and a backdated document must still read back.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { RunParagraphStore, InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';
import { ensureIndexes, INDEX_SPECS } from '../../lib/db-indexes.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

describe('RunParagraphStore.key', () => {
  test('composes urlKey:runId', () => {
    assert.equal(RunParagraphStore.key('ws', 'run-1'), 'ws:run-1');
  });
});

describe('InMemoryRunParagraphStore', () => {
  test('put then get round-trips the full schema', async () => {
    const store = new InMemoryRunParagraphStore();
    await store.put('ws', 'run-1', { inputHash: 'abc', paragraph: 'It went well.', model: 'small', final: true });
    const got = await store.get('ws', 'run-1');
    assert.equal(got.inputHash, 'abc');
    assert.equal(got.paragraph, 'It went well.');
    assert.equal(got.model, 'small');
    assert.equal(got.final, true);
    assert.ok(got.generatedAt instanceof Date);
  });

  test('miss returns null', async () => {
    const store = new InMemoryRunParagraphStore();
    assert.equal(await store.get('ws', 'nope'), null);
  });

  test('a later put replaces the stored paragraph', async () => {
    const store = new InMemoryRunParagraphStore();
    await store.put('ws', 'run-1', { inputHash: 'a', paragraph: 'First.', model: 'small' });
    await store.put('ws', 'run-1', { inputHash: 'b', paragraph: 'Second.', model: 'small', final: true });
    const got = await store.get('ws', 'run-1');
    assert.equal(got.inputHash, 'b');
    assert.equal(got.paragraph, 'Second.');
    assert.equal(got.final, true);
  });
});

describe('RunParagraphStore (durable, no TTL)', () => {
  const harness = createMangoTmpdir('run-paragraph-store-');
  let db;

  before(async () => {
    await harness.connect();
    db = harness.freshDb();
    await ensureIndexes(db);
  });

  after(() => harness.close());

  function freshStore() {
    return new RunParagraphStore({ collection: harness.freshDb().collection('run-paragraph') });
  }

  test('put then get round-trips the full schema', async () => {
    const store = freshStore();
    await store.put('ws', 'run-1', { inputHash: 'h1', paragraph: 'The run is in review.', model: 'small', final: false });
    const got = await store.get('ws', 'run-1');
    assert.equal(got.urlKey, 'ws');
    assert.equal(got.runId, 'run-1');
    assert.equal(got.inputHash, 'h1');
    assert.equal(got.paragraph, 'The run is in review.');
    assert.equal(got.model, 'small');
    assert.equal(got.final, false);

    const stored = await store.collection.findOne({ urlKey: 'ws', runId: 'run-1' });
    assert.ok(stored, 'the document is keyed by urlKey:runId');
  });

  test('a paragraph outlives every cache: a backdated generatedAt is never evicted', async () => {
    const store = new RunParagraphStore({ collection: db.collection('run-paragraph') });
    await store.put('ws', 'run-old', { inputHash: 'h', paragraph: 'Long ago.', model: 'small', final: true });
    // Far beyond any sibling cache TTL (7/30 days).
    await store.collection.updateOne({ urlKey: 'ws', runId: 'run-old' }, { $set: { generatedAt: new Date('2001-01-01T00:00:00.000Z') } });

    const got = await store.get('ws', 'run-old');
    assert.ok(got, 'an old paragraph still reads back — there is no TTL path');
    assert.equal(got.paragraph, 'Long ago.');
    assert.equal(got.generatedAt.toISOString(), '2001-01-01T00:00:00.000Z');
  });

  test('the urlKey:runId key is unique — a duplicate pair is refused', async () => {
    const store = new RunParagraphStore({ collection: db.collection('run-paragraph') });
    await store.put('ws', 'run-dup', { inputHash: 'h', paragraph: 'One.', model: 'small' });
    await assert.rejects(
      () => store.collection.insertOne({ urlKey: 'ws', runId: 'run-dup', paragraph: 'Two.' }),
      /duplicate key|E11000/i,
      'a second document with the same urlKey:runId is refused by the unique index'
    );
  });

  test('no TTL index exists on run-paragraph; the unique key index does', async () => {
    // Force the collection to exist so MangoDB lists its indexes.
    await db.collection('run-paragraph').insertOne({ urlKey: 'probe', runId: 'probe' });

    const list = await db.collection('run-paragraph').indexes();
    const ttl = list.find(idx => idx.expireAfterSeconds !== undefined);
    assert.equal(ttl, undefined, `run-paragraph must carry no TTL index, found ${JSON.stringify(ttl)}`);

    const keyIdx = list.find(idx => JSON.stringify(idx.key) === JSON.stringify({ urlKey: 1, runId: 1 }));
    assert.ok(keyIdx, 'the {urlKey:1, runId:1} index exists');
    assert.equal(keyIdx.unique, true, 'the key index enforces urlKey:runId uniqueness');
  });

  test('no INDEX_SPECS entry declares a TTL on run-paragraph (the LIN-610 no-TTL rule)', () => {
    const ttlSpecs = INDEX_SPECS.filter(
      s => s.collection === 'run-paragraph' && s.options && s.options.expireAfterSeconds !== undefined
    );
    assert.deepEqual(ttlSpecs, [], 'run-paragraph must not be declared with a TTL index');
  });
});
