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
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { ObserverStateStore } from '../../lib/observer-state-store.js';
import { LINEAGE_QUERY_LIMIT } from '../../routes/proxy.js';
import { establishAccount } from '../../lib/account-session.js';

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

    // --- LIN-1348: establishAccount mint-race orchestration (real MongoDB) ---
    //
    // linkIdentity's own cross-document race is already proven above
    // (:195-243). This proves the ORCHESTRATION layered on top in
    // lib/account-session.js: mint (:55-59) -> linkIdentity (:63) -> E11000
    // conflict (:64-76) -> deleteAccount orphan (:77) -> adopt winner (:78).
    // A naive witness (all ok:true, one holder, zero orphans) can false-green
    // on a schedule that happens to serialize into the existingOwner-reuse
    // branch and never actually reaches the E11000/adopt path at all — so
    // this also spies createAccount/deleteAccount call counts:
    // createAccountCalls>1 proves a genuine mint collision occurred, and
    // deleteAccountCalls===createAccountCalls-1 proves every losing minter's
    // orphan was cleaned up. A serialized schedule can't satisfy both (later
    // calls would see existingOwner and skip minting entirely, collapsing
    // createAccountCalls toward 1 and deleteAccountCalls toward 0).

    test('establishAccount: 400 concurrent first sign-ins for the SAME identity mint-race, conflict, and adopt on real MongoDB (LIN-1348)', async () => {
      const collection = freshCollection('accounts');
      await collection.createIndex(
        { 'identities.provider': 1, 'identities.scope': 1 },
        { unique: true, sparse: true, name: 'accounts_identity_unique' }
      );
      const accountStore = new AccountStore({ collection });
      const accountWorkspaceStore = new AccountWorkspaceStore({
        collection: freshCollection('account-workspaces')
      });

      let createAccountCalls = 0;
      let deleteAccountCalls = 0;
      const spiedStore = {
        createAccount: (...args) => {
          createAccountCalls++;
          return accountStore.createAccount(...args);
        },
        deleteAccount: (...args) => {
          deleteAccountCalls++;
          return accountStore.deleteAccount(...args);
        },
        findAccountByIdentity: (...args) => accountStore.findAccountByIdentity(...args),
        linkIdentity: (...args) => accountStore.linkIdentity(...args)
      };

      const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, () =>
          establishAccount({}, spiedStore, accountWorkspaceStore, 'github', 'race-identity', {}, 'ws-race')
        )
      );

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.deepStrictEqual(
        rejected,
        [],
        `establishAccount must never throw under concurrency, got ${rejected.length} rejection(s): ${rejected[0]?.reason}`
      );

      const fulfilled = results.map((r) => r.value);
      assert.ok(
        fulfilled.every((r) => r.ok === true),
        'every concurrent first sign-in for the same identity must succeed, no false conflict for a loser'
      );

      const winnerAccountId = fulfilled[0].accountId;
      assert.ok(
        fulfilled.every((r) => r.accountId === winnerAccountId),
        'every caller must land on the SAME winning account'
      );

      const holders = await collection
        .find({ identities: { $elemMatch: { provider: 'github', scope: 'race-identity' } } })
        .toArray();
      assert.strictEqual(holders.length, 1, 'exactly one account should hold the identity');
      assert.strictEqual(holders[0]._id, winnerAccountId);

      const allAccounts = await collection.find({}).toArray();
      assert.strictEqual(
        allAccounts.length,
        1,
        'no zero-identity orphan account should remain from a losing mint'
      );

      assert.ok(
        createAccountCalls > 1,
        `expected a genuine mint collision (multiple concurrent createAccount calls), got ${createAccountCalls}`
      );
      assert.strictEqual(
        deleteAccountCalls,
        createAccountCalls - 1,
        'every losing minter must clean up its own orphan (adoption path), and only the losers'
      );
    });

    // --- LIN-2285 close-out ledger item 1: merged-identity establishAccount
    // path on real MongoDB ---
    //
    // The primary LIN-2285 fix canonicalizes the merged side of an
    // account-merge decision inside `establishAccount`. The LIN-1348 test
    // above only drives the MINT-race path (`minted && conflict`); it never
    // touches `linkIdentity`'s duplicate-key (`err.code === 11000`) arm on an
    // EXISTING (non-minted) account, nor `_mergeIdentity`'s `arrayFilters`
    // write — both directly upstream of the ids this fix canonicalizes, and
    // both unexercised against real MongoDB per the implementation review's
    // "What CI Did Not Prove" ledger (item 1).

    test('establishAccount: same-account no-op re-link of an already-merged identity exercises _mergeIdentity\'s arrayFilters write on real MongoDB (LIN-2285)', async () => {
      const collection = freshCollection('accounts');
      await collection.createIndex(
        { 'identities.provider': 1, 'identities.scope': 1 },
        { unique: true, sparse: true, name: 'accounts_identity_unique' }
      );
      const accountStore = new AccountStore({ collection });
      const accountWorkspaceStore = new AccountWorkspaceStore({
        collection: freshCollection('account-workspaces')
      });

      const a = await accountStore.createAccount();
      await accountStore.linkIdentity(a._id, 'linear', 'viewer-a-real', { token: 'a-token' });
      const b = await accountStore.createAccount();
      await accountStore.linkIdentity(b._id, 'linear', 'viewer-b-real', { token: 'b-token-stale' });
      const merged = await accountStore.mergeAccounts(a._id, b._id, { accountWorkspaceStore });
      assert.strictEqual(merged.ok, true);

      // Session already on the canonical absorber A signs in with B's
      // (now merged-away) identity. Step 1(b)'s equality fallthrough
      // applies: resolvedOwnerId (A) === session.accountId (A), so this is a
      // same-account no-op — no conflict raised — and `accountId` stays raw
      // (B, the identity's real current owner) for the `linkIdentity` call
      // two lines later. B already owns this identity, so `linkIdentity`
      // routes to `_mergeIdentity`'s `arrayFilters` update, not the $push
      // branch.
      const session = { accountId: a._id };
      const result = await establishAccount(session, accountStore, accountWorkspaceStore, 'linear', 'viewer-b-real', { token: 'b-token-fresh' }, 'ws-real-noop');

      assert.strictEqual(result.ok, true, 'no conflict for the same-account no-op case');
      assert.strictEqual(result.accountId, a._id, 'canonicalized before the session write');
      assert.strictEqual(session.accountId, a._id);

      const bDoc = await accountStore.getAccount(b._id);
      const identity = bDoc.identities.find(i => i.provider === 'linear' && i.scope === 'viewer-b-real');
      assert.ok(identity, 'the identity is still registered on B — mergeAccounts never migrates identities[]');
      assert.strictEqual(identity.credentials.token, 'b-token-fresh', 'arrayFilters credentials merge actually wrote through on real MongoDB, not just MangoDB');
    });

    test('establishAccount: many pre-existing accounts racing to link the SAME new identity exercise linkIdentity\'s E11000 arm through the (c) race-sibling branch on real MongoDB (LIN-2285)', async () => {
      const collection = freshCollection('accounts');
      await collection.createIndex(
        { 'identities.provider': 1, 'identities.scope': 1 },
        { unique: true, sparse: true, name: 'accounts_identity_unique' }
      );
      const accountStore = new AccountStore({ collection });
      const accountWorkspaceStore = new AccountWorkspaceStore({
        collection: freshCollection('account-workspaces')
      });

      // Many DISTINCT, already-established accounts (none minted by this
      // call — every establishAccount call below takes the `!minted` branch)
      // race to link the same brand-new identity. Each sees no owner at its
      // own pre-check, so each attempts the guarded $push; the
      // `accounts_identity_unique` index lets only one through, and every
      // loser's push throws E11000. `linkIdentity: 400 parallel links`
      // (above) exercises the E11000 catch directly on `accountStore.linkIdentity`;
      // this exercises it through `establishAccount`'s (c) `!minted &&
      // linked.conflict` branch instead — what LIN-2285 changed — which a
      // 2-way race could dodge by resolving via the plain sequential
      // owner-check instead of the write-time catch, so this uses the same
      // order of magnitude as the file's other race tests to make a genuine
      // E11000 collision as close to certain as a real-Mongo race gets.
      const RACERS = 20;
      const contenders = await Promise.all(Array.from({ length: RACERS }, () => accountStore.createAccount()));

      const results = await Promise.allSettled(
        contenders.map((account, i) =>
          establishAccount({ accountId: account._id }, accountStore, accountWorkspaceStore, 'linear', 'race-real-id', {}, `ws-race-${i}`)
        )
      );

      assert.ok(results.every(r => r.status === 'fulfilled'), 'establishAccount must never throw under a real duplicate-key race');
      const outcomes = results.map(r => r.value);

      const winners = outcomes.filter(r => r.ok === true);
      const losers = outcomes.filter(r => r.ok === false);
      assert.strictEqual(winners.length, 1, 'exactly one racer wins the identity outright');
      assert.strictEqual(losers.length, RACERS - 1, 'every other racer observes a conflict rather than a silent double-link');
      assert.ok(losers.every(r => r.conflict), 'every loser gets a conflict, not a bare unhandled failure');
      assert.ok(losers.every(r => r.conflict.accountId === winners[0].accountId),
        'every loser\'s propagated conflict names the real winner, resolved via resolveCanonicalDegraded against real MongoDB');

      const holders = await collection
        .find({ identities: { $elemMatch: { provider: 'linear', scope: 'race-real-id' } } })
        .toArray();
      assert.strictEqual(holders.length, 1, 'exactly one account holds the identity after the race');
      assert.strictEqual(holders[0]._id, winners[0].accountId);
    });

    // --- LIN-1343/LIN-1357: addFeedback atomic $push + terminal-wake CAS ---
    //
    // account-store.test.js's concurrency pins run only against MangoDB (a
    // mock's findOneAndUpdate is atomic by construction there, so it never
    // vacuously "proves" real-engine correctness). Things unproven against
    // production MongoDB specifically: (1) the $push + findOneAndUpdate/
    // returnDocument:'after' shape actually appends under concurrency there,
    // (2) $ne:true matches an ABSENT field there too (terminalWakeEnqueued was
    // absent-or-true, never false), and (3, LIN-1357) the re-keyed witness —
    // `terminalWakeItems: { $ne: docId }` / `$addToSet` — CASes correctly per
    // producing item on real MongoDB, including two DISTINCT beat items on one
    // edge each winning their own slot under concurrent writers.

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

    test('addFeedback: terminalWakeItems $ne CAS matches an absent field and enqueues exactly one wake on real MongoDB (LIN-1343/LIN-1357)', async () => {
      const store = freshDispatchStore('feedback-wake');
      const child = await store.addItem('acme', {
        prompt: 'do the thing',
        kind: 'implementation',
        issueIdentifier: 'LIN-42',
        sessionId: 'parent-S1',
        subscription: 'everything'
      });
      await store.takeItem(child._id, 'acme', 'token-a');

      // child.terminalWakeItems is ABSENT at this point (never initialised —
      // the ticket forbids a migration). If array-$ne failed to match an absent
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
      assert.ok(
        (edge.terminalWakeItems || []).includes(child._id),
        'the witness set durably records the producing item on the edge'
      );
      assert.strictEqual(edge.terminalWakeItems.length, 1, 'one producing item, one slot — no duplicates from the N racers');

      // LIN-1698 Phase 1 (review ledger item 1): the witness SHAPE, read back
      // off real MongoDB. Every other shape assertion for wakeWitnessMeta runs
      // against the mock whose dot-path `$set` support this same change
      // authored — the mock proving itself. This is the one read-back that is
      // not circular: real Mongo applied the combined `$addToSet` + dot-path
      // `$set`, and the document it produced is asserted here.
      const witness = edge.wakeWitnessMeta?.[child._id];
      assert.ok(witness, 'real MongoDB seeded wakeWitnessMeta, keyed by the producing item id');

      // feedbackIndex is the CAS WINNER's own append position, and under N
      // concurrent racers the winner is not necessarily the first appender —
      // so this asserts the contract (a valid index pointing at a terminal
      // entry), never a fixed number. An earlier revision of this test pinned
      // it to 0; that passed locally and on the PR run and failed on main with
      // actual 3, because which racer wins the CAS is genuinely nondeterministic.
      assert.ok(
        Number.isInteger(witness.feedbackIndex) &&
          witness.feedbackIndex >= 0 &&
          witness.feedbackIndex < edge.feedback.length,
        `feedbackIndex ${witness.feedbackIndex} must index into the stored feedback array (length ${edge.feedback.length})`
      );
      assert.match(
        edge.feedback[witness.feedbackIndex].message,
        /^\[done\]/,
        'it indexes the terminal feedback entry that won the CAS'
      );
      assert.strictEqual(witness.attempt, 0, 'the implicit live-path slot');
      assert.strictEqual(
        witness.mintedWakeId,
        queued[0]._id,
        'stamped with the id of the wake row real MongoDB actually minted'
      );
      assert.ok(witness.lastAttemptAt instanceof Date, 'round-trips as a BSON date, not a string');

      // The row fields the archive hop must carry, present pre-claim on the
      // real engine (the mock covers the post-archive half).
      assert.strictEqual(queued[0].producingItemId, child._id);
      assert.strictEqual(queued[0].producingItemAttempt, 0);
    });

    // --- LIN-1470 (review ledger L2): the lineage `$in` query's real plan ---
    //
    // The list endpoint's lineage join issues, via listHistory:
    //   find({urlKey, rootItemId: {$in: anchors}}, {projection: {prompt: 0}})
    //     .sort({resolvedAt: -1}).skip(0).limit(LINEAGE_QUERY_LIMIT)
    // The review flagged that {urlKey, rootItemId} covers the PREDICATE but not
    // the {resolvedAt: -1} SORT, and predicted the real failure mode was "the
    // 32MB sort-memory limit erroring". Only real Mongo can answer that —
    // MangoDB has no query planner and no explain() — so it is answered here.

    // The exact query routes/proxy.js issues, with the cap imported from the
    // route module itself (LIN-1494 F2 tidy — no hand-mirrored constant).
    const lineageCursor = (collection, anchors) =>
      collection
        .find({ urlKey: 'acme', rootItemId: { $in: anchors } }, { projection: { prompt: 0 } })
        .sort({ resolvedAt: -1 })
        .skip(0)
        .limit(LINEAGE_QUERY_LIMIT);

    function findStage(stage, name) {
      if (!stage) return null;
      if (stage.stage === name) return stage;
      return findStage(stage.inputStage, name);
    }

    async function seedLineages(collection, { lineages, perLineage, noise }) {
      const anchors = [];
      const docs = [];
      for (let a = 0; a < lineages; a++) {
        const anchor = randomUUID();
        anchors.push(anchor);
        for (let m = 0; m < perLineage; m++) {
          docs.push({
            _id: randomUUID(), urlKey: 'acme', rootItemId: anchor, status: 'taken',
            dispatchedAt: new Date(Date.now() - m * 1000),
            resolvedAt: new Date(Date.now() - m * 500),
            // The multi-KB field `projection: {prompt: 0}` exists to keep out
            // (the H12/503 incidents f5a94a53/15ca7b47).
            prompt: 'x'.repeat(5000),
            feedback: [{ message: '[done] ok', timestamp: new Date(), rootItemId: anchor }]
          });
        }
      }
      for (let n = 0; n < noise; n++) {
        docs.push({
          _id: randomUUID(), urlKey: 'acme', rootItemId: randomUUID(), status: 'taken',
          resolvedAt: new Date(), prompt: 'x'.repeat(5000), feedback: []
        });
      }
      await collection.insertMany(docs);
      return anchors;
    }

    test('lineage $in query is served by the {urlKey, rootItemId} index, not a collection scan (LIN-1470 L2)', async () => {
      const collection = freshCollection('lineage-explain');
      // Build the index from the SHIPPED spec, so this can't drift from
      // db-indexes.js and quietly explain a different shape than production.
      const spec = INDEX_SPECS.find(
        (s) => s.collection === 'dispatch-history' &&
          JSON.stringify(s.keySpec) === JSON.stringify({ urlKey: 1, rootItemId: 1 })
      );
      assert.ok(spec, 'expected the {urlKey, rootItemId} dispatch-history spec (LIN-1468) in db-indexes.js');
      await collection.createIndex(spec.keySpec, spec.options);

      // 25 anchors x 8 rows = 200 lineage rows among 3000 unrelated rows —
      // a full page's worth of anchors fanned out in ONE $in, which is the
      // shape only the list endpoint produces (`_collectGroupFeedback` on the
      // `:id` seam sends a single anchor).
      const anchors = await seedLineages(collection, { lineages: 25, perLineage: 8, noise: 3000 });

      const explained = await lineageCursor(collection, anchors).explain('executionStats');
      const stats = explained.executionStats;

      const ixscan = findStage(stats.executionStages, 'IXSCAN');
      assert.ok(ixscan, 'the lineage query must be served by an index scan, not a COLLSCAN');
      assert.strictEqual(
        ixscan.indexName,
        'urlKey_1_rootItemId_1',
        'the lineage query must use the LIN-1468 {urlKey, rootItemId} index'
      );
      assert.strictEqual(
        findStage(stats.executionStages, 'COLLSCAN'),
        null,
        'no collection scan may appear in the winning plan'
      );

      // Cost is bounded by the MATCHED lineage, not by history size: 200 of
      // 3200 docs touched. This is the property the H12/503 incidents care about.
      assert.strictEqual(stats.nReturned, 200, 'exactly the seeded lineage rows come back');
      assert.strictEqual(stats.totalDocsExamined, 200, 'only matched lineage docs are fetched');
      assert.ok(
        stats.totalKeysExamined < 400,
        `index keys examined should track the matched set, got ${stats.totalKeysExamined}`
      );
    });

    test('the lineage sort is blocking but spills to disk rather than erroring (LIN-1470 L2 risk model)', async () => {
      const collection = freshCollection('lineage-sort');
      await collection.createIndex({ urlKey: 1, rootItemId: 1 });
      const anchors = await seedLineages(collection, { lineages: 25, perLineage: 8, noise: 0 });

      const sortStage = findStage(
        (await lineageCursor(collection, anchors).explain('executionStats')).executionStats.executionStages,
        'SORT'
      );

      // Confirms the review's structural read: {urlKey, rootItemId} does not
      // cover {resolvedAt: -1}, so Mongo sorts the matched set in memory. If a
      // future index ever covers the sort, this assertion should fail and be
      // removed DELIBERATELY rather than silently drifting.
      assert.ok(sortStage, 'the {resolvedAt: -1} sort is not index-covered, so a blocking SORT is expected');
      assert.strictEqual(sortStage.usedDisk, false, 'a realistic lineage sorts well within memory');

      // The review assumed a 32MB ceiling. Measured on the engine CI actually
      // runs (mongo:8.0), the blocking-sort budget is 100MB — and the `>=` is
      // deliberately loose so this pins the CLAIM (materially more headroom
      // than 32MB) rather than one server build's exact default.
      assert.ok(
        sortStage.memLimit >= 32 * 1024 * 1024,
        `blocking-sort budget should exceed the 32MB assumed in review, got ${sortStage.memLimit}`
      );
    });

    test('an OVER-budget lineage sort degrades to a disk spill, it does not throw (LIN-1470 L2)', async () => {
      // The review's stated worst case was the sort-memory limit ERRORING. That
      // is not this query's failure mode: `find()` blocking sorts have used
      // allowDiskUse-by-default since MongoDB 4.4, so exceeding the budget
      // degrades to a disk spill and still returns a complete result. Proven
      // by squeezing the budget rather than seeding 100MB of documents.
      const collection = freshCollection('lineage-sort-overflow');
      await collection.createIndex({ urlKey: 1, rootItemId: 1 });
      // 2001 rows — ONE over the cap — so the rows.length assertion below
      // proves `.limit(LINEAGE_QUERY_LIMIT)` actually clamps an over-cap
      // lineage, not merely that an at-cap lineage comes back whole (LIN-1492).
      const anchors = await seedLineages(collection, { lineages: 1, perLineage: 2001, noise: 0 });

      const paramName = 'internalQueryMaxBlockingSortMemoryUsageBytes';
      const original = (await db.admin().command({ getParameter: 1, [paramName]: 1 }))[paramName];
      try {
        await db.admin().command({ setParameter: 1, [paramName]: 200 * 1024 });

        const sortStage = findStage(
          (await lineageCursor(collection, anchors).explain('executionStats')).executionStats.executionStages,
          'SORT'
        );
        assert.strictEqual(sortStage.usedDisk, true, 'an over-budget sort should spill to disk');

        // The load-bearing half: the over-cap lineage is clamped to exactly
        // the cap — no throw, no over-cap rows leaking through.
        const rows = await lineageCursor(collection, anchors).toArray();
        assert.strictEqual(
          rows.length,
          LINEAGE_QUERY_LIMIT,
          'the spilled sort still returns the full capped result set rather than erroring'
        );
      } finally {
        // Restore before any later test observes a squeezed budget.
        await db.admin().command({ setParameter: 1, [paramName]: original });
      }
    });

    // --- LIN-2664 (F1): harbour-comments' _id-based lookup uses the
    // AUTOMATIC _id_ index, never a shipped INDEX_SPECS entry ---
    //
    // Unlike the lineage query above (which builds its index from a shipped
    // db-indexes.js spec, so it can't drift from production), harbour-comments
    // has NO spec to look up — lib/db-indexes.js's "Deliberately NOT indexed"
    // list documents it as relying on the automatic _id_ index every MongoDB
    // collection gets for free. This test asserts that reliance directly:
    // no createIndex call here at all.
    test('harbour-comments _id $in lookup (wereRecordedByHarbour) is served by the automatic _id_ index, not a collection scan (LIN-2664 F1)', async () => {
      const collection = freshCollection('harbour-comments');

      const urlKey = 'acme';
      const docs = [];
      const idKeys = [];
      for (let i = 0; i < 25; i++) {
        const commentId = randomUUID();
        const _id = `${urlKey}::${commentId}`;
        docs.push({ _id, urlKey, commentId, recordedAt: new Date() });
        idKeys.push(_id);
      }
      // Noise: a large unrelated population in the SAME collection, so an
      // accidental COLLSCAN would show up as touching far more docs than the
      // matched set.
      for (let n = 0; n < 3000; n++) {
        const commentId = randomUUID();
        docs.push({ _id: `other-workspace::${commentId}`, urlKey: 'other-workspace', commentId, recordedAt: new Date() });
      }
      await collection.insertMany(docs);

      // The exact query shape wereRecordedByHarbour issues (lib/harbour-comments-store.js).
      const explained = await collection.find({ _id: { $in: idKeys } }).explain('executionStats');
      const stats = explained.executionStats;

      const ixscan = findStage(stats.executionStages, 'IXSCAN');
      assert.ok(ixscan, 'the harbour-comments _id lookup must be served by an index scan, not a COLLSCAN');
      assert.strictEqual(
        ixscan.indexName,
        '_id_',
        'the lookup must use the automatic _id_ index — there is no shipped INDEX_SPECS entry to build one from'
      );
      assert.strictEqual(
        findStage(stats.executionStages, 'COLLSCAN'),
        null,
        'no collection scan may appear in the winning plan'
      );
      assert.strictEqual(stats.nReturned, 25, 'exactly the seeded ledger rows come back');
    });

    test('addFeedback: TWO DISTINCT beat items sharing one edge each win their own terminalWakeItems CAS slot on real MongoDB (LIN-1357)', async () => {
      // The regression this ticket fixes, proven against real MongoDB: a
      // multi-beat stepper's beat 1 and beat 2 are distinct dispatch ids that
      // both resolve to the SAME edge. Under the old per-edge boolean, beat 1's
      // terminal would burn the witness and beat 2's terminal would be silently
      // dropped before ever reaching the CAS. Each must now enqueue its own wake.
      const store = freshDispatchStore('feedback-wake-multibeat');
      const beat1 = await store.addItem('acme', {
        prompt: 'stepper beat 1', kind: 'research', issueIdentifier: 'LIN-1357',
        sessionId: 'parent-S1', subscription: 'everything'
      });
      await store.takeItem(beat1._id, 'acme', 'token-1');
      const beat2 = await store.addItem('acme', {
        prompt: 'stepper beat 2', kind: 'research', issueIdentifier: 'LIN-1357',
        followUpTo: beat1._id, sessionId: 'parent-S1', subscription: 'everything', force: true
      });
      await store.takeItem(beat2._id, 'acme', 'token-2');

      const N = 10;
      await Promise.all([
        ...Array.from({ length: N }, () =>
          store.addFeedback(beat1._id, 'acme', { message: '[done] beat 1 complete' }, 'token-1')),
        ...Array.from({ length: N }, () =>
          store.addFeedback(beat2._id, 'acme', { message: '[done] beat 2 complete' }, 'token-2'))
      ]);

      const queued = await store.collection.find({ urlKey: 'acme', kind: 'wake' }).toArray();
      assert.strictEqual(queued.length, 2, 'beat 1 and beat 2 each enqueue exactly one wake on real MongoDB');

      const edge = await store.historyCollection.findOne({ _id: beat1._id });
      assert.ok(edge.terminalWakeItems.includes(beat1._id) && edge.terminalWakeItems.includes(beat2._id));
      assert.strictEqual(edge.terminalWakeItems.length, 2, 'exactly the two distinct producing items');

      // LIN-1698 Phase 1 (review ledger item 1): the dot-path `$set` keeps
      // SIBLING witness entries on one shared edge doc — the specific way a
      // whole-field `$set` would silently destroy the earlier beat's witness.
      // Only a real engine can answer this; the mock's dot-path handling was
      // written by this same change.
      assert.deepStrictEqual(
        Object.keys(edge.wakeWitnessMeta).sort(),
        [beat1._id, beat2._id].sort(),
        'both beats hold their own witness entry — no sibling clobber on real MongoDB'
      );
      assert.strictEqual(edge.wakeWitnessMeta[beat1._id].attempt, 0);
      assert.strictEqual(edge.wakeWitnessMeta[beat2._id].attempt, 0);
    });

    // LIN-2297: the once-only guard/witness key becomes class-aware — bare
    // `doc._id` for a genuine terminal, `${doc._id}#blocked` for a blocked
    // wake. Confirmatory, not load-bearing: the underlying primitive (array
    // `$ne` against a string) is unchanged and already pinned above on real
    // Mongo; this closes the loop for the new composite-string value.
    test('addFeedback: [blocked] then [done] on ONE item mints two wakes and two distinct terminalWakeItems entries on real MongoDB (LIN-2297)', async () => {
      const store = freshDispatchStore('feedback-wake-blocked-then-done');
      const child = await store.addItem('acme', {
        prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-2297',
        sessionId: 'parent-S1', subscription: 'everything'
      });
      await store.takeItem(child._id, 'acme', 'token-a');

      await store.addFeedback(child._id, 'acme', { message: '[blocked] need a human' }, 'token-a');
      await store.addFeedback(child._id, 'acme', { message: '[done] finished after unblock' }, 'token-a');

      const queued = await store.collection.find({ urlKey: 'acme', kind: 'wake' }).toArray();
      assert.strictEqual(queued.length, 2, '[blocked] then [done] on the same row each mint their own wake on real MongoDB');

      const edge = await store.historyCollection.findOne({ _id: child._id });
      assert.deepStrictEqual(
        [...edge.terminalWakeItems].sort(),
        [child._id, `${child._id}#blocked`].sort(),
        'terminalWakeItems holds both the bare id (the genuine terminal) and the #blocked-suffixed id — the composite key CASes correctly as a distinct array member on real MongoDB'
      );
      assert.deepStrictEqual(
        Object.keys(edge.wakeWitnessMeta).sort(),
        [child._id, `${child._id}#blocked`].sort(),
        'wakeWitnessMeta holds both keys too — re-keyed together with terminalWakeItems, not left behind'
      );
    });

    // -----------------------------------------------------------------------
    // LIN-2079 (PR #1145 review ledger item 2): the `listHistory({status,
    // silentSince})` predicate on the engine production actually runs.
    //
    // The predicate shipped asserted only against MangoDB 0.1.2. Two of its
    // three load-bearing properties are ENGINE semantics that a mock proves
    // nothing about, and both were named in review as unpinned:
    //   (1) `$nor: [{'feedback.timestamp': {$gte: cutoff}}]` — dotted-path
    //       ARRAY traversal. The inner predicate matches a doc when ANY element
    //       matches, so `$nor` must exclude a row holding one old beat AND one
    //       fresh beat. Get this wrong and a live lineage reads as a tombstone.
    //   (2) an empty/absent `feedback` array has no element at or after any
    //       cutoff, so it must be SELECTED — that is the silent hard-stop
    //       zombie the ticket is named after.
    //   (3) BSON type fidelity: `feedback[].timestamp` must round-trip as a
    //       real Date, or `$gte: Date` compares across BSON types and silently
    //       over-selects. Written through the production write path here
    //       (`addItem` -> `takeItem` -> `addFeedback`), never hand-inserted.
    // `$nor` is the repo's first use of that operator, which is why the plan
    // demanded engine verification. Ten lines, as the review costed it.
    // -----------------------------------------------------------------------
    test('listHistory({status, silentSince}) selects silent rows and excludes live lineages on real MongoDB (LIN-2079)', async () => {
      const store = freshDispatchStore('silence-predicate');
      const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

      const claim = async (prompt) => {
        const item = await store.addItem('acme', { prompt, kind: 'implementation', issueIdentifier: 'LIN-2079' });
        await store.takeItem(item._id, 'acme', 'token-a');
        return item._id;
      };

      // Four claimed rows. `zombie` never posts anything; `oldBeat` and
      // `liveMixed` post before the cutoff; `live` and `liveMixed` post after.
      const zombie = await claim('hard-stopped, never reported');
      const oldBeat = await claim('reported once, then went silent');
      const live = await claim('reporting now');
      const liveMixed = await claim('reported before AND after the cutoff');

      await store.addFeedback(oldBeat, 'acme', { message: '[working] one beat, long ago' }, 'token-a');
      await store.addFeedback(liveMixed, 'acme', { message: '[working] an early beat' }, 'token-a');

      await tick();
      const cutoff = new Date();
      await tick();

      await store.addFeedback(live, 'acme', { message: '[working] still going' }, 'token-a');
      await store.addFeedback(liveMixed, 'acme', { message: '[working] and still going' }, 'token-a');

      // A silent row that is NOT `taken` — proves the status clause discriminates
      // independently. Hand-inserted deliberately: only its status matters, and
      // no store API archives straight to `cancelled` without a claim.
      await store.historyCollection.insertOne({
        _id: randomUUID(), urlKey: 'acme', status: 'cancelled',
        dispatchedAt: new Date(), resolvedAt: new Date(), feedback: []
      });

      // (3) type fidelity, asserted on a fresh read back OUT of real MongoDB.
      const storedLive = await store.historyCollection.findOne({ _id: live });
      assert.ok(
        storedLive.feedback[0].timestamp instanceof Date,
        'feedback[].timestamp must round-trip as a BSON date, or $gte compares across types'
      );

      const silent = await store.listHistory('acme', { status: 'taken', silentSince: cutoff, limit: 50 });
      const ids = silent.items.map((i) => i.id).sort();

      assert.deepStrictEqual(
        ids,
        [zombie, oldBeat].sort(),
        'exactly the never-reported row and the gone-silent row are selected on real MongoDB'
      );
      // `total` is a separate countDocuments over the SAME query, so this is
      // what proves both clauses executed in the ENGINE rather than as a JS
      // filter over an already-materialised page.
      assert.strictEqual(silent.total, 2, 'total reflects the predicate, so it was pushed into the query');

      // (1) the discriminating case, stated as its own assertion so a failure
      // names the property rather than just a set mismatch.
      assert.ok(
        !ids.includes(liveMixed),
        'a row holding one PRE-cutoff and one POST-cutoff beat is live: $nor array traversal must exclude it'
      );
      assert.ok(!ids.includes(live), 'a row beating after the cutoff is live');

      // The status clause: the cancelled row is silent by every measure and is
      // still excluded, and dropping `silentSince` widens to all three taken rows
      // — so silence, not status, is what narrowed the set above.
      const allTaken = await store.listHistory('acme', { status: 'taken', limit: 50 });
      assert.strictEqual(allTaken.total, 4, 'status alone returns every claimed row, including the live ones');
      assert.ok(
        allTaken.items.every((i) => i.id !== undefined) && !allTaken.items.some((i) => i.status === 'cancelled'),
        'the cancelled row never appears under status=taken, though it is silent'
      );
    });

    // -----------------------------------------------------------------------
    // LIN-1546: OwnerCredentialStore.putIfRefreshToken optimistic CAS on REAL
    // MongoDB. The owner-credential unit suite proves this on MangoDB; this
    // pins the load-bearing MangoDB-vs-Mongo-divergent behaviours on the engine
    // production actually runs: a field-filter CAS that MISSES yields
    // matchedCount 0 (not a thrown error, not a silent match), and a CAS on a
    // missing record NEVER upserts. Same class of divergence the dispatch-store
    // terminal-wake CAS smoke above guards.
    // -----------------------------------------------------------------------
    test('owner-credential CAS: win rotates in place, lose leaves the winner untouched, missing never upserts (real MongoDB)', async () => {
      const store = new OwnerCredentialStore({ collection: freshCollection('owner-credentials') });
      const accountId = randomUUID();
      const urlKey = `acme-${randomUUID().slice(0, 8)}`;

      // CAS on a MISSING record: false, and NO record is created (no upsert).
      const missWon = await store.putIfRefreshToken(accountId, urlKey, 'R0', {
        provider: 'linear', scope: 'org-1', token: 'a', refreshToken: 'R1', tokenExpiresAt: Date.now() + 3600_000,
      });
      assert.strictEqual(missWon, false, 'CAS on a missing record must miss on real MongoDB');
      assert.strictEqual(await store.get(accountId, urlKey), null, 'a CAS miss must not upsert on real MongoDB');

      // Seed R0, then a matching-witness CAS WINS and rotates in place.
      await store.put(accountId, urlKey, { provider: 'linear', scope: 'org-1', token: 'access-0', refreshToken: 'R0', tokenExpiresAt: Date.now() + 3600_000 });
      const won = await store.putIfRefreshToken(accountId, urlKey, 'R0', {
        provider: 'linear', scope: 'org-1', token: 'access-1', refreshToken: 'R1', tokenExpiresAt: Date.now() + 3600_000,
      });
      assert.strictEqual(won, true);
      assert.strictEqual((await store.get(accountId, urlKey)).refreshToken, 'R1');

      // A stale-witness CAS (loser still holding R0, but the record is now R1)
      // LOSES and leaves the winner's record intact.
      const lost = await store.putIfRefreshToken(accountId, urlKey, 'R0', {
        provider: 'linear', scope: 'org-1', token: 'access-loser', refreshToken: 'R_loser', tokenExpiresAt: Date.now() + 3600_000,
      });
      assert.strictEqual(lost, false, 'a stale-witness CAS must miss on real MongoDB');
      assert.strictEqual((await store.get(accountId, urlKey)).refreshToken, 'R1', 'the winner\'s credential is untouched by the loser');

      // Exactly one record exists throughout — no CAS ever forked a duplicate.
      const all = await store.collection.find({ accountId, urlKey }).toArray();
      assert.strictEqual(all.length, 1);
    });

    // -----------------------------------------------------------------------
    // LIN-2129: ObserverStateStore.advance() CAS on REAL MongoDB. The full unit
    // suite (tests/unit/observer-state-store.test.js) proves the CAS mechanics
    // and the three-way matchedCount===0 disambiguation on a real MangoDB
    // tmpdir; that file's own negative control proves a naive read-modify-write
    // loses concurrent writes even there. This pins the one property only a
    // real, multi-connection engine can answer: does the stale-writer-loses
    // outcome hold under GENUINE interleaving (not MangoDB's in-process mutex),
    // and does an N-way race still land on exactly one winner.
    // -----------------------------------------------------------------------
    test('ObserverStateStore.advance: stale writer loses and the winner\'s document is intact on real MongoDB', async () => {
      const store = new ObserverStateStore({ collection: freshCollection('observer-state') });
      const key = randomUUID();
      await store.ensureSeeded(key, { phase: 'idle' });

      const won = await store.advance(key, 1, { phase: 'winner' }, { source: 'writer-A' });
      assert.strictEqual(won, true);

      const lost = await store.advance(key, 1, { phase: 'loser' }, { source: 'writer-B' });
      assert.strictEqual(lost, false, 'a stale-witness CAS must miss on real MongoDB');

      const current = await store.readCurrent(key);
      assert.strictEqual(current.rev, 2);
      assert.deepStrictEqual(current.state, { phase: 'winner' }, 'the winner\'s payload must be untouched by the loser');
      assert.strictEqual(current.ledger.length, 1);
      assert.strictEqual(current.ledger[0].source, 'writer-A');
    });

    test('ObserverStateStore.advance: N-way concurrent race lands exactly one winner on real MongoDB', async () => {
      const store = new ObserverStateStore({ collection: freshCollection('observer-state') });
      const key = randomUUID();
      await store.ensureSeeded(key, { phase: 'idle' });

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => store.advance(key, 1, { phase: `racer-${i}` }))
      );

      const winners = results.filter((r) => r === true);
      assert.strictEqual(winners.length, 1, `exactly one of ${CONCURRENCY} concurrent advance() calls must win on real MongoDB`);

      const current = await store.readCurrent(key);
      assert.strictEqual(current.rev, 2, 'rev must land at expectedRev + 1, never expectedRev + N, under real concurrent writers');
      assert.strictEqual(current.ledger.length, 1);
    });
  }
);
