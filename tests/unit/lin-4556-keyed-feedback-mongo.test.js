/**
 * LIN-4556 — the keyed feedback append, witnessed on a real MongoDB.
 *
 * `addFeedback` (lib/dispatch-store.js) appends a keyed post only if no entry on the row holds
 * that key, decided by a `$nor: [{ 'feedback.key': key }]` clause inside the ONE atomic
 * findOneAndUpdate. tests/unit/lin-4556-keyed-feedback.test.js proves it on MangoDB and the mock;
 * this file proves it on `mongod`, so the "MongoDB and MangoDB alike" claim is a tested one.
 * It runs on the CI real-`mongod` arm (`mongo:8.0` service, `MONGODB_TEST_URI` set there).
 *
 * Guard mirrors tests/unit/lin-3130-taken-by-token-id-mongo.test.js: a CI run with no
 * `MONGODB_TEST_URI` throws (never a silent zero-coverage pass); local dev with no URI skips.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const uri = process.env.MONGODB_TEST_URI;
if (!uri && process.env.CI) {
  throw new Error(
    'MONGODB_TEST_URI must be set in CI: the LIN-4556 keyed-append real-MongoDB witness must never silently skip'
  );
}

const URL_KEY = 'acme';
const ROW_ID = '55555555-5555-4555-8555-555555555555';
const LABEL = 'runner-label';
const TOKEN_ID = 'tok-runner-1';

describe(
  'LIN-4556 — keyed feedback append, real-MongoDB semantics',
  { skip: uri ? false : 'MONGODB_TEST_URI not set; skipping real-Mongo witness (local dev)' },
  () => {
    let client;
    let db;
    let history;

    before(async () => {
      client = new MongoClient(uri);
      await client.connect();
      db = client.db(`lin4556_keyed_${randomUUID()}`);
      history = db.collection('dispatch-history');
    });

    after(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });

    function store() {
      return new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    }

    const post = (message, key, extra = {}) =>
      store().addFeedback(ROW_ID, URL_KEY, { message, key, ...extra }, LABEL, null, { takenByTokenId: TOKEN_ID });

    async function seedTakenRow(takenByTokenId = TOKEN_ID) {
      await history.deleteMany({});
      await history.insertOne({ _id: ROW_ID, urlKey: URL_KEY, status: 'taken', takenByTokenLabel: LABEL, takenByTokenId });
    }

    const stored = async () => (await history.findOne({ _id: ROW_ID })).feedback ?? [];

    test('a keyed post sent twice stores one entry; the second answers duplicate', async () => {
      await seedTakenRow();

      const first = await post('hello', 'k-1');
      const second = await post('hello', 'k-1');

      assert.deepEqual(first, { success: true, feedbackCount: 1 });
      assert.deepEqual(second, { success: true, feedbackCount: 1, duplicate: true });
      const entries = await stored();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].key, 'k-1');
    });

    test('20 concurrent keyed twins store exactly one entry', async () => {
      await seedTakenRow();

      const results = await Promise.all(Array.from({ length: 20 }, () => post('same words', 'k-twin')));

      assert.ok(results.every((r) => r?.success === true), 'every twin is acknowledged');
      assert.equal(results.filter((r) => !r.duplicate).length, 1, 'exactly one twin appended');
      assert.equal(results.filter((r) => r.duplicate === true).length, 19, 'the other 19 answered duplicate');
      const entries = await stored();
      assert.equal(entries.filter((e) => e.key === 'k-twin').length, 1);
      assert.equal(entries.length, 1);
    });

    test('two distinct keys both append', async () => {
      await seedTakenRow();

      const a = await post('one', 'k-a');
      const b = await post('two', 'k-b');

      assert.equal(a.duplicate, undefined);
      assert.equal(b.duplicate, undefined);
      assert.deepEqual((await stored()).map((e) => e.key), ['k-a', 'k-b']);
    });

    test('an un-keyed post appends every time, as before', async () => {
      await seedTakenRow();

      await post('same', undefined);
      await post('same', undefined);

      const entries = await stored();
      assert.equal(entries.length, 2);
      assert.ok(entries.every((e) => !('key' in e)), 'no key stored on an un-keyed post');
    });

    test('a keyed post to a row another token took returns null (404), not duplicate', async () => {
      await seedTakenRow('tok-someone-else');

      const res = await post('mine?', 'k-x');

      assert.equal(res, null);
      assert.equal((await stored()).length, 0);
    });
  }
);
