/**
 * Real-MongoDB smoke + concurrency coverage (LIN-1337).
 *
 * Every other store test (workspace-store.test.js, account-workspace-store.test.js)
 * runs against a REAL MangoDB tmpdir instance, not a mock — but MangoDB itself
 * cannot prove what this file exists to prove: it never throws on a duplicate
 * `_id` (only real MongoDB does), and its in-process mutex makes concurrent
 * writers serialize for free, so races that are live in production MongoDB pass
 * trivially there. This suite runs against a real `mongod` instead.
 *
 * Uses a DEDICATED `MONGODB_TEST_URI`, never `MONGODB_URI` — reusing the runtime
 * var would mean a developer with a production URI in their `.env` runs the
 * 400-way concurrency probes below against production.
 *
 * Guard is hard-fail-in-CI, never silent-skip: a `CI`-set run with no
 * `MONGODB_TEST_URI` throws instead of quietly passing with zero real-Mongo
 * coverage (precedent for the paranoia: `c455f59`, a LIN-1327 test that "claimed
 * to guard ... but couldn't"). Local dev with no URI set explicitly skips.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { INDEX_SPECS, ensureIndexes } from '../../lib/db-indexes.js';
import { WorkspaceStore } from '../../lib/workspace-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

const uri = process.env.MONGODB_TEST_URI;
if (!uri && process.env.CI) {
  throw new Error(
    'MONGODB_TEST_URI must be set in CI: the Mongo smoke test must never silently skip'
  );
}

// Matches the research's own probe scale (354/400 concurrent binds threw
// E11000 against unpatched code) so this suite is measured at the scale the
// severity claim was made at, not a smaller one that might not reproduce it.
const CONCURRENCY = 400;

describe(
  'mongo-smoke (real MongoDB)',
  { skip: uri ? false : 'MONGODB_TEST_URI not set; skipping real-Mongo smoke tests (local dev)' },
  () => {
    let client;
    let db;
    let counter = 0;

    before(async () => {
      client = new MongoClient(uri);
      await client.connect();
      db = client.db(`mongo_smoke_${randomUUID().slice(0, 8)}`);
    });

    after(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });

    function freshCollection(name) {
      return db.collection(`${name}_${counter++}`);
    }

    // Engine witness: true on real MongoDB, false on MangoDB (which never
    // throws on a duplicate _id). If this suite is ever pointed at the wrong
    // engine, this is the assertion that fails and says so.
    test('engine witness: a bare duplicate _id insert throws on real MongoDB', async () => {
      const collection = freshCollection('engine-witness');
      const id = randomUUID();
      await collection.insertOne({ _id: id, v: 1 });

      await assert.rejects(
        () => collection.insertOne({ _id: id, v: 2 }),
        /E11000|duplicate key/i
      );
    });

    test('the four LIN-1328 indexes from db-indexes.js build on real MongoDB', async () => {
      const lin1328Specs = INDEX_SPECS.filter(
        (s) => s.collection === 'workspaces' || s.collection === 'account-workspaces'
      );
      assert.strictEqual(
        lin1328Specs.length,
        4,
        'expected exactly 4 LIN-1328 index specs in db-indexes.js (asserted here, not redesigned)'
      );

      const { failed } = await ensureIndexes(db);
      const lin1328Failures = failed.filter(
        (f) => f.collection === 'workspaces' || f.collection === 'account-workspaces'
      );
      assert.deepStrictEqual(
        lin1328Failures,
        [],
        'none of the 4 LIN-1328 index builds should fail against a clean real-Mongo db'
      );

      for (const spec of lin1328Specs) {
        const indexes = await db.collection(spec.collection).listIndexes().toArray();
        const match = indexes.find((ix) => JSON.stringify(ix.key) === JSON.stringify(spec.keySpec));
        assert.ok(match, `${spec.collection} is missing index ${JSON.stringify(spec.keySpec)}`);
        assert.strictEqual(
          !!match.unique,
          !!spec.options.unique,
          `${spec.collection} index ${JSON.stringify(spec.keySpec)} unique flag mismatch`
        );
      }
    });

    test('clean unique {accountId, workspaceId} creation succeeds against a real unique index', async () => {
      const collection = freshCollection('account-workspaces');
      await collection.createIndex({ accountId: 1, workspaceId: 1 }, { unique: true });
      const store = new AccountWorkspaceStore({ collection });

      const edge = await store.bindAccountToWorkspace(randomUUID(), randomUUID());
      assert.deepStrictEqual(
        new Set(Object.keys(edge)),
        new Set(['_id', 'accountId', 'workspaceId', 'createdAt'])
      );
    });

    test('createWorkspace: parallel duplicate creates produce exactly one record, no unhandled throw', async () => {
      const collection = freshCollection('workspaces');
      const store = new WorkspaceStore({ collection });
      const id = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, (_, i) =>
          store.createWorkspace({ id, name: `Attempt ${i}`, urlKey: `dup-${id}` })
        )
      );

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.deepStrictEqual(
        rejected,
        [],
        `createWorkspace must never throw under concurrency, got ${rejected.length} rejection(s): ${rejected[0]?.reason}`
      );

      const successes = results.filter((r) => r.status === 'fulfilled' && r.value.ok === true);
      assert.strictEqual(successes.length, 1, 'exactly one concurrent createWorkspace call should win');

      const all = await collection.find({ _id: id }).toArray();
      assert.strictEqual(all.length, 1, 'exactly one document should exist under this _id');
    });

    test('bindAccountToWorkspace: parallel duplicate binds produce exactly one edge, no unhandled throw', async () => {
      const collection = freshCollection('account-workspaces');
      // The unique index must exist BEFORE the concurrency probe, or the test
      // is not production-equivalent (and SERVER-18784 isn't reachable at all).
      await collection.createIndex({ accountId: 1, workspaceId: 1 }, { unique: true });
      const store = new AccountWorkspaceStore({ collection });
      const accountId = randomUUID();
      const workspaceId = randomUUID();

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () => store.bindAccountToWorkspace(accountId, workspaceId))
      );

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.deepStrictEqual(
        rejected,
        [],
        `bindAccountToWorkspace must never throw under concurrency, got ${rejected.length} rejection(s): ${rejected[0]?.reason}`
      );

      const edges = await collection.find({ accountId, workspaceId }).toArray();
      assert.strictEqual(edges.length, 1, 'exactly one edge should exist for this pair');
    });
  }
);
