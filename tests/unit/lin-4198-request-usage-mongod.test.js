/**
 * LIN-4198 (piece 1 of LIN-4195): the `request-usage` upsert against a REAL mongod.
 *
 * MangoDB restates the unique index and serialises writers, so it cannot show the
 * concurrent-insert race this store exists to survive. The witnesses here need a
 * real server: posting a request twice, a larger and a smaller repost, and two
 * concurrent batches with the same ids. The last witness proves the outcome: one
 * document per id, holding the largest values. It does not exercise the store's
 * E11000 retry: mongod >= 4.2 retries same-key upserts server-side, so that retry
 * is pinned by the unit test (lin-4198-request-usage-store.test.js), not by this file.
 *
 * Skips locally unless MONGODB_TEST_URI is set; fails hard in CI when it is not
 * (precedent: tests/unit/mongo-smoke.test.js, tests/unit/cost-read-usage-parity.test.js).
 * Run with: MONGODB_TEST_URI=mongodb://127.0.0.1:27017 node --test tests/unit/lin-4198-request-usage-mongod.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { RequestUsageStore, REQUEST_USAGE_COLLECTION } from '../../lib/request-usage-store.js';

const uri = process.env.MONGODB_TEST_URI;
if (!uri && process.env.CI) {
  throw new Error('lin-4198-request-usage-mongod: MONGODB_TEST_URI is not set in CI; the concurrent-upsert witness would silently not run');
}

const NOW = new Date('2026-11-04T03:00:00.000Z');
const LATER = new Date('2026-11-04T03:05:00.000Z');

const rec = (requestId, tokens = {}) => ({
  requestId,
  harness: 'claude-code',
  model: 'claude-haiku-5-5',
  effort: 'high',
  lane: 'build',
  agent: 'main',
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheCreation1hInputTokens: 0,
  cacheReadInputTokens: 0,
  ...tokens
});

describe(
  'request-usage upsert (real MongoDB)',
  { skip: uri ? false : 'MONGODB_TEST_URI not set; skipping real-Mongo request-usage tests (local dev)' },
  () => {
    let client;
    let db;
    let raw;
    let store;

    before(async () => {
      client = new MongoClient(uri);
      await client.connect();
      db = client.db(`request_usage_${randomUUID().slice(0, 8)}`);
      raw = db.collection(REQUEST_USAGE_COLLECTION);
      await raw.createIndex({ urlKey: 1, rootItemId: 1, requestId: 1 }, { unique: true });
      await raw.createIndex({ urlKey: 1, rootItemId: 1 });
      store = new RequestUsageStore({ collection: raw, historyCollection: db.collection('dispatch-history') });
    });

    after(async () => {
      try { await db?.dropDatabase(); } finally { await client?.close(); }
    });

    const post = (records, now = NOW) =>
      store.upsertRecords({ urlKey: 'ws-a', rootItemId: 'root-1', itemId: 'item-1', records, now });
    const docs = (requestId) => raw.find({ requestId }).toArray();

    test('posting a request twice leaves one document', async () => {
      await post([rec('msg_twice', { inputTokens: 10 })]);
      await post([rec('msg_twice', { inputTokens: 10 })], LATER);
      assert.equal((await docs('msg_twice')).length, 1);
    });

    test('a larger repost grows the document', async () => {
      await post([rec('msg_grow', { outputTokens: 10 })]);
      await post([rec('msg_grow', { outputTokens: 500 })], LATER);
      assert.equal((await docs('msg_grow'))[0].outputTokens, 500);
    });

    test('a smaller repost leaves the document unchanged', async () => {
      await post([rec('msg_shrink', { outputTokens: 500 })]);
      await post([rec('msg_shrink', { outputTokens: 10 })], LATER);
      assert.equal((await docs('msg_shrink'))[0].outputTokens, 500);
    });

    test('two concurrent batches with the same ids leave one document each, holding the largest values', async () => {
      // Fresh ids nobody has inserted yet, so both batches race the first insert.
      const ids = Array.from({ length: 20 }, (_, i) => `msg_race_${i}`);
      const batchA = ids.map((id, i) => rec(id, { inputTokens: 100 + i, outputTokens: 5 }));
      const batchB = ids.map((id, i) => rec(id, { inputTokens: 50 + i, outputTokens: 40 }));
      await Promise.all([post(batchA), post(batchB, LATER)]);
      for (const [i, id] of ids.entries()) {
        const found = await docs(id);
        assert.equal(found.length, 1, `${id} must be one document`);
        assert.equal(found[0].inputTokens, 100 + i, `${id} keeps the larger inputTokens`);
        assert.equal(found[0].outputTokens, 40, `${id} keeps the larger outputTokens`);
      }
    });
  }
);
