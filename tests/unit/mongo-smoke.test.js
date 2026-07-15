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
import { AccountStore } from '../../lib/account-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';

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

    // --- LIN-1338: linkIdentity cross-document race + unique backstop ---

    test('the accounts_identity_unique index (LIN-1338) builds on real MongoDB with unique and sparse set', async () => {
      const accountsSpec = INDEX_SPECS.find(
        (s) => s.collection === 'accounts' && s.options.name === 'accounts_identity_unique'
      );
      assert.ok(accountsSpec, 'expected an accounts_identity_unique spec in db-indexes.js');

      const { failed } = await ensureIndexes(db);
      const accountsFailure = failed.find((f) => f.collection === 'accounts');
      assert.strictEqual(
        accountsFailure,
        undefined,
        'the accounts index build should not fail against a clean real-Mongo db'
      );

      const indexes = await db.collection('accounts').listIndexes().toArray();
      const match = indexes.find((ix) => ix.name === 'accounts_identity_unique');
      assert.ok(match, 'accounts_identity_unique index should exist');
      assert.strictEqual(match.unique, true, 'accounts_identity_unique should be unique');
      assert.strictEqual(match.sparse, true, 'accounts_identity_unique should be sparse');
    });

    test('linkIdentity: 400 parallel links of the same identity to different accounts produce exactly one winner', async () => {
      const collection = freshCollection('accounts');
      await collection.createIndex(
        { 'identities.provider': 1, 'identities.scope': 1 },
        { unique: true, sparse: true, name: 'accounts_identity_unique' }
      );
      const store = new AccountStore({ collection });

      const accounts = await Promise.all(
        Array.from({ length: CONCURRENCY }, () => store.createAccount())
      );

      const results = await Promise.allSettled(
        accounts.map((account) => store.linkIdentity(account._id, 'github', 'shared/repo', {}))
      );

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.deepStrictEqual(
        rejected,
        [],
        `linkIdentity must never throw under concurrency, got ${rejected.length} rejection(s): ${rejected[0]?.reason}`
      );

      const fulfilled = results.map((r) => r.value);
      const winners = fulfilled.filter((r) => r.ok === true);
      const conflicts = fulfilled.filter((r) => r.ok === false && r.conflict);

      assert.strictEqual(winners.length, 1, 'exactly one concurrent linkIdentity call should win');
      assert.strictEqual(
        conflicts.length,
        CONCURRENCY - 1,
        'every other call should get an explicit conflict signal'
      );

      const winnerAccountId = winners[0].account._id;
      for (const conflict of conflicts) {
        assert.strictEqual(
          conflict.conflict.accountId,
          winnerAccountId,
          'every conflict should name the actual winning account'
        );
      }

      const holders = await collection
        .find({ identities: { $elemMatch: { provider: 'github', scope: 'shared/repo' } } })
        .toArray();
      assert.strictEqual(holders.length, 1, 'exactly one account should hold the identity');
      assert.strictEqual(holders[0]._id, winnerAccountId);
    });

    test('linkIdentity: conflict signal is correct for a non-first-element identity', async () => {
      // MangoDB's unique index is not multikey-aware (only checks the first
      // array element); real Mongo is. This pins the `$elemMatch` pre-check
      // path, which is what covers that gap, on the engine that can actually
      // prove it.
      const collection = freshCollection('accounts');
      await collection.createIndex(
        { 'identities.provider': 1, 'identities.scope': 1 },
        { unique: true, sparse: true, name: 'accounts_identity_unique' }
      );
      const store = new AccountStore({ collection });

      const accountA = await store.createAccount();
      const accountB = await store.createAccount();

      await store.linkIdentity(accountA._id, 'linear', 'org-1', {});
      await store.linkIdentity(accountA._id, 'github', 'owner/repo', {});

      const result = await store.linkIdentity(accountB._id, 'github', 'owner/repo', {});

      assert.strictEqual(result.ok, false);
      assert.deepStrictEqual(result.conflict, { accountId: accountA._id });
    });

    test('linkIdentity: two identity-less accounts can be created with the unique sparse index present', async () => {
      const collection = freshCollection('accounts');
      await collection.createIndex(
        { 'identities.provider': 1, 'identities.scope': 1 },
        { unique: true, sparse: true, name: 'accounts_identity_unique' }
      );
      const store = new AccountStore({ collection });

      const accountA = await store.createAccount();
      const accountB = await store.createAccount();

      assert.deepStrictEqual(accountA.identities, []);
      assert.deepStrictEqual(accountB.identities, []);

      assert.ok(await store.getAccount(accountA._id), 'account A should be retrievable');
      assert.ok(await store.getAccount(accountB._id), 'account B should be retrievable');
    });

    test('linkIdentity: concurrent different identities on the same account all survive (no clobber)', async () => {
      const collection = freshCollection('accounts');
      await collection.createIndex(
        { 'identities.provider': 1, 'identities.scope': 1 },
        { unique: true, sparse: true, name: 'accounts_identity_unique' }
      );
      const store = new AccountStore({ collection });
      const account = await store.createAccount();

      const identities = [
        ['linear', 'org-1'],
        ['github', 'owner/repo-a'],
        ['github', 'owner/repo-b']
      ];

      const results = await Promise.allSettled(
        identities.map(([provider, scope]) => store.linkIdentity(account._id, provider, scope, {}))
      );

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.deepStrictEqual(
        rejected,
        [],
        `linkIdentity must never throw under concurrency, got ${rejected.length} rejection(s): ${rejected[0]?.reason}`
      );

      const fulfilled = results.map((r) => r.value);
      assert.ok(
        fulfilled.every((r) => r.ok === true),
        'every concurrent link to the same account should succeed'
      );

      const fetched = await store.getAccount(account._id);
      assert.strictEqual(fetched.identities.length, identities.length, 'all identities should survive');
      for (const [provider, scope] of identities) {
        assert.ok(
          fetched.identities.some((i) => i.provider === provider && i.scope === scope),
          `expected (${provider}, ${scope}) to survive concurrent linking`
        );
      }
    });

    // --- LIN-1343: addFeedback atomic $push + terminalWakeEnqueued CAS ---
    //
    // account-store.test.js's concurrency pins run only against MangoDB (a
    // mock's findOneAndUpdate is atomic by construction there, so it never
    // vacuously "proves" real-engine correctness). Two things about this fix
    // are unproven against production MongoDB specifically: (1) the $push +
    // findOneAndUpdate/returnDocument:'after' shape actually appends under
    // concurrency there, and (2) $ne:true matches an ABSENT field there too
    // (the one genuinely new filter operator this ticket introduces —
    // terminalWakeEnqueued is absent-or-true, never false).

    function freshDispatchStore(name) {
      const collection = freshCollection(`${name}-queue`);
      const historyCollection = freshCollection(`${name}-history`);
      return new DispatchQueueStore({ collection, historyCollection });
    }

    test('addFeedback: 20 concurrent calls on one item all persist on real MongoDB (LIN-1343)', async () => {
      const store = freshDispatchStore('feedback-append');
      const item = await store.addItem('acme', {
        prompt: 'do the thing',
        kind: 'implementation',
        issueIdentifier: 'LIN-42'
      });
      await store.takeItem(item._id, 'acme', 'token-a');

      const N = 20;
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          store.addFeedback(item._id, 'acme', { message: `heartbeat ${i}` }, 'token-a')
        )
      );

      assert.ok(results.every((r) => r && r.success), 'every concurrent caller still reports success');
      const stored = await store.historyCollection.findOne({ _id: item._id });
      assert.strictEqual(
        stored.feedback.length,
        N,
        `all ${N} concurrent entries must be stored on real MongoDB, not just the last writer`
      );
    });

    test('addFeedback: terminalWakeEnqueued $ne:true CAS matches an absent field and enqueues exactly one wake on real MongoDB (LIN-1343)', async () => {
      const store = freshDispatchStore('feedback-wake');
      const child = await store.addItem('acme', {
        prompt: 'do the thing',
        kind: 'implementation',
        issueIdentifier: 'LIN-42',
        sessionId: 'parent-S1',
        subscription: 'everything'
      });
      await store.takeItem(child._id, 'acme', 'token-a');

      // child.terminalWakeEnqueued is ABSENT at this point (never initialised —
      // the ticket forbids a migration). If $ne:true failed to match an absent
      // field on real MongoDB, every one of these CAS attempts would report
      // matchedCount 0 and silently suppress the wake (LIN-1355's live failure
      // mode) instead of racing to exactly one winner.
      const N = 20;
      await Promise.all(
        Array.from({ length: N }, () =>
          store.addFeedback(child._id, 'acme', { message: '[done] shipped' }, 'token-a')
        )
      );

      const queued = await store.collection.find({ urlKey: 'acme', kind: 'wake' }).toArray();
      assert.strictEqual(
        queued.length,
        1,
        `exactly one wake must be enqueued for ${N} concurrent duplicate terminals on real MongoDB`
      );

      const edge = await store.historyCollection.findOne({ _id: child._id });
      assert.strictEqual(edge.terminalWakeEnqueued, true, 'the witness is durably set on the edge');
    });
  }
);
