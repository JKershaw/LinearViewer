/**
 * LIN-3138 S1 (T2-i) — real-MongoDB pin for the declared-record take→archive
 * round trip (review finding L3, optional per the plan's Risks).
 *
 * Unit tests use tests/fixtures/mock-collection.js only. This file runs on the
 * CI real-`mongod` arm (`.github/workflows/test.yml`'s unit job sets
 * `MONGODB_TEST_URI: mongodb://localhost:27017` with a `mongo:8.0` service), so
 * the sparse `grantDeclaration`/`grantRefusal` key presence survives a REAL
 * driver `insertOne` and the queue→history archive hop, and reads back through
 * `getGrantDeclaration`. Guard mirrors tests/unit/mongo-smoke.test.js: a CI run
 * with no `MONGODB_TEST_URI` throws (never a silent zero-coverage pass); local
 * dev with no URI skips.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

const uri = process.env.MONGODB_TEST_URI;
if (!uri && process.env.CI) {
  throw new Error(
    'MONGODB_TEST_URI must be set in CI: the LIN-3138 declared take→archive round trip must never silently skip'
  );
}

const URL_KEY = 'lin3138-roundtrip';
const RECORD = {
  grants: ['dispatch'],
  ownerAccountId: 'owner-A',
  workspaceId: 'ws-A',
  profile: 'worker',
  site: 'site-A',
  declaredAt: '2026-09-29T00:00:00.000Z'
};

describe(
  'LIN-3138 — declared record survives a real-Mongo take→archive round trip',
  { skip: uri ? false : 'MONGODB_TEST_URI not set; skipping real-Mongo round trip (local dev)' },
  () => {
    let client;
    let db;
    let queue;
    let history;

    before(async () => {
      client = new MongoClient(uri);
      await client.connect();
      db = client.db(`lin3138_gd_${randomUUID()}`);
      queue = db.collection('dispatch-queue');
      history = db.collection('dispatch-history');
    });

    after(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });

    const store = () => new DispatchQueueStore({ collection: queue, historyCollection: history });

    test('sparse declared keys survive insertOne + take→archive and read back via getGrantDeclaration', async () => {
      await queue.deleteMany({});
      await history.deleteMany({});

      const s = store();
      const created = await s.addItem(URL_KEY, { prompt: 'run me', grantDeclaration: RECORD, grantRefusal: 'INVALID_GRANTS' });
      assert.equal('grantDeclaration' in created, false, 'addItem return strips the record (D9)');

      const queueDoc = await queue.findOne({ _id: created._id });
      assert.deepEqual(queueDoc.grantDeclaration, RECORD, 'the queue insertOne persisted the record');
      assert.equal(queueDoc.grantRefusal, 'INVALID_GRANTS');

      await s.takeItem(created._id, URL_KEY);
      assert.equal(await queue.findOne({ _id: created._id }), null, 'the row moved out of the queue');

      const histDoc = await history.findOne({ _id: created._id });
      assert.deepEqual(histDoc.grantDeclaration, RECORD, 'the archive allow-list kept the record');
      assert.equal(histDoc.grantRefusal, 'INVALID_GRANTS');

      assert.deepEqual(await s.getGrantDeclaration(URL_KEY, created._id), { state: 'record', record: RECORD });
      assert.deepEqual(await s.getGrantDeclaration('other-workspace', created._id), { state: 'row-missing' });
    });

    test('two rows in one workspace: each id resolves its OWN record; an unknown id is row-missing', async () => {
      await queue.deleteMany({});
      await history.deleteMany({});

      const A = { grants: ['dispatch'], ownerAccountId: 'owner-A', workspaceId: 'ws-A', profile: 'worker', site: 'site-A', declaredAt: 'A' };
      const B = { grants: ['take'], ownerAccountId: 'owner-B', workspaceId: 'ws-A', profile: 'worker', site: 'site-B', declaredAt: 'B' };
      const s = store();
      const rowA = await s.addItem(URL_KEY, { prompt: 'a', grantDeclaration: A });
      const rowB = await s.addItem(URL_KEY, { prompt: 'b', grantDeclaration: B });
      await s.takeItem(rowB._id, URL_KEY);
      assert.equal(await queue.findOne({ _id: rowA._id }) !== null, true, 'A stays active');
      assert.equal(await history.findOne({ _id: rowB._id }) !== null, true, 'B is archived');

      assert.deepEqual(await s.getGrantDeclaration(URL_KEY, rowA._id), { state: 'record', record: A });
      assert.deepEqual(await s.getGrantDeclaration(URL_KEY, rowB._id), { state: 'record', record: B });
      assert.deepEqual(await s.getGrantDeclaration(URL_KEY, 'unknown-id-xyz'), { state: 'row-missing' });
    });

    test('an undeclared row writes neither key (real-Mongo byte-identity)', async () => {
      await queue.deleteMany({});
      await history.deleteMany({});

      const s = store();
      const created = await s.addItem(URL_KEY, { prompt: 'plain' });
      const queueDoc = await queue.findOne({ _id: created._id });
      assert.equal('grantDeclaration' in queueDoc, false);
      assert.equal('grantRefusal' in queueDoc, false);

      await s.takeItem(created._id, URL_KEY);
      const histDoc = await history.findOne({ _id: created._id });
      assert.equal('grantDeclaration' in histDoc, false);
      assert.equal('grantRefusal' in histDoc, false);
    });
  }
);
