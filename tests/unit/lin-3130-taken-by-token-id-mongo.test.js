/**
 * LIN-3130 S2a — the real-MongoDB semantics pin for the ownership filter
 * `{ takenByTokenId: null }`.
 *
 * The legacy feedback branch depends on MongoDB matching an ABSENT field with
 * an explicit `null` equality predicate (every pre-existing history row has no
 * `takenByTokenId`). MangoDB 0.1.2 already behaves this way (pinned by
 * tests/unit/lin-3130-runner-ownership.test.js against a MangoDB tmpdir), but a
 * future engine/driver change could silently flip it — and `$exists: false`
 * would NOT be a safe substitute (it matches absent only, dropping
 * explicit-null legacy rows). This file runs on the CI real-`mongod` arm
 * (`mongo:8.0` service; `MONGODB_TEST_URI` is set there) so that cannot happen
 * unnoticed.
 *
 * Guard mirrors tests/unit/mongo-smoke.test.js: a CI run with no
 * `MONGODB_TEST_URI` throws (never a silent zero-coverage pass); local dev with
 * no URI skips.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { SESSION_TARGETS } from '../../lib/dispatch-targets.js';

const uri = process.env.MONGODB_TEST_URI;
if (!uri && process.env.CI) {
  throw new Error(
    'MONGODB_TEST_URI must be set in CI: the LIN-3130 {takenByTokenId: null} pin must never silently skip'
  );
}

const URL_KEY = 'acme';
const ROW_ID = '33333333-3333-4333-8333-333333333333';
const DASH_ID = '44444444-4444-4444-8444-444444444444';

describe(
  'LIN-3130 — { takenByTokenId: null } real-MongoDB semantics',
  { skip: uri ? false : 'MONGODB_TEST_URI not set; skipping real-Mongo pin (local dev)' },
  () => {
    let client;
    let db;
    let history;

    before(async () => {
      client = new MongoClient(uri);
      await client.connect();
      db = client.db(`lin3130_tbtid_${randomUUID()}`);
      history = db.collection('dispatch-history');
    });

    after(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });

    function store() {
      return new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: history });
    }

    test('raw filter: { takenByTokenId: null } matches absent AND explicit null, never a string id', async () => {
      await history.deleteMany({});
      await history.insertMany([
        { _id: 'absent', urlKey: URL_KEY, takenByTokenLabel: 'L', status: 'taken' },
        { _id: 'explicit', urlKey: URL_KEY, takenByTokenLabel: 'L', status: 'taken', takenByTokenId: null },
        { _id: 'string', urlKey: URL_KEY, takenByTokenLabel: 'L', status: 'taken', takenByTokenId: 'tok-1' },
      ]);

      const byNull = await history.find({ takenByTokenLabel: 'L', takenByTokenId: null }).toArray();
      assert.deepEqual(byNull.map(d => d._id).sort(), ['absent', 'explicit'], '{null} must match absent + explicit null');

      // Document WHY we do not rewrite the filter as $exists:false — it would
      // stop matching the explicit-null row.
      const byNotExists = await history.find({ takenByTokenLabel: 'L', takenByTokenId: { $exists: false } }).toArray();
      assert.deepEqual(byNotExists.map(d => d._id), ['absent'], '$exists:false matches absent only');
    });

    test('addFeedback legacy branch matches an ABSENT-field legacy row', async () => {
      await history.deleteMany({});
      await history.insertOne({ _id: ROW_ID, urlKey: URL_KEY, status: 'taken', takenByTokenLabel: 'legacy-label' });

      const res = await store().addFeedback(ROW_ID, URL_KEY, { message: 'legacy ok' }, 'legacy-label');
      assert.ok(res && res.success, 'the legacy filter must match an absent takenByTokenId on real MongoDB');
      const doc = await history.findOne({ _id: ROW_ID });
      assert.equal(doc.feedback.length, 1);
    });

    test('addFeedback legacy branch matches an EXPLICIT-null legacy row and rejects a runner row', async () => {
      await history.deleteMany({});
      await history.insertOne({ _id: ROW_ID, urlKey: URL_KEY, status: 'taken', takenByTokenLabel: 'runner-label', takenByTokenId: null });
      const legacy = await store().addFeedback(ROW_ID, URL_KEY, { message: 'legacy' }, 'runner-label');
      assert.ok(legacy && legacy.success, 'explicit null still satisfies the legacy branch');

      // Now a runner-taken row: same label, string id.
      await history.deleteMany({});
      await history.insertOne({ _id: ROW_ID, urlKey: URL_KEY, status: 'taken', takenByTokenLabel: 'runner-label', takenByTokenId: 'tok-runner-1' });

      const collision = await store().addFeedback(ROW_ID, URL_KEY, { message: 'wrong token' }, 'runner-label');
      assert.equal(collision, null, 'a label-sharing dispatch token must NOT satisfy the legacy branch on a runner row');

      const runner = await store().addFeedback(ROW_ID, URL_KEY, { message: 'right token' }, 'runner-label', null, { takenByTokenId: 'tok-runner-1' });
      assert.ok(runner && runner.success, 'the runner branch keys on its own takenByTokenId');
    });

    // LIN-3622: the runner take gate is `target: { $in: [...SESSION_TARGETS, null] }`
    // inside the atomic findOneAndDelete. The `null` is what lets a pre-field
    // row (no `target`, read as `cli`) through; the runner-ownership test only
    // proves that on MangoDB, so pin it on real mongod here.
    describe('LIN-3622 — takeItem({ targets }) real-MongoDB semantics', () => {
      let queue;

      before(() => {
        queue = db.collection('dispatch-queue');
      });

      function queued(id, extra = {}) {
        return { _id: id, urlKey: URL_KEY, prompt: 'p', expiresAt: new Date(Date.now() + 60_000), ...extra };
      }

      test('refuses a dash row without removing or archiving it', async () => {
        await queue.deleteMany({});
        await history.deleteMany({});
        await queue.insertOne(queued(DASH_ID, { target: 'dash' }));

        const taken = await store().takeItem(DASH_ID, URL_KEY, 'runner-label', 'tok-1', { targets: SESSION_TARGETS });

        assert.equal(taken, null, 'a dash row must not be claimed by a session-target take');
        assert.ok(await queue.findOne({ _id: DASH_ID }), 'the refused dash row must stay queued');
        assert.equal(await history.countDocuments({ _id: DASH_ID }), 0, 'a refused row must not be archived');
      });

      test('takes a row with an ABSENT target field (legacy row counts as cli) and deletes it', async () => {
        await queue.deleteMany({});
        await history.deleteMany({});
        await queue.insertOne(queued(ROW_ID));

        const taken = await store().takeItem(ROW_ID, URL_KEY, 'runner-label', 'tok-1', { targets: SESSION_TARGETS });

        assert.ok(taken, 'null in $in must match an absent target on real MongoDB');
        assert.equal(await queue.findOne({ _id: ROW_ID }), null, 'the taken row must be removed from the queue');
        assert.equal(await history.countDocuments({ _id: ROW_ID }), 1, 'the taken row must be archived');
      });

      test('without targets the same dash row is still taken (option stays opt-in)', async () => {
        await queue.deleteMany({});
        await history.deleteMany({});
        await queue.insertOne(queued(DASH_ID, { target: 'dash' }));

        const taken = await store().takeItem(DASH_ID, URL_KEY, 'dash-label', null);

        assert.ok(taken, 'dispatch-token and Harbour OS takes keep claiming dash rows');
      });
    });
  }
);
