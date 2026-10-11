/**
 * LIN-3455 (B of LIN-3453): "null is missing, not epoch 0".
 *
 * The five raw-NaN stores had no null check, so `new Date(null).getTime()` made
 * `null` a valid epoch 0. After the swap to `toEpochMs`, `null` is missing like
 * any other junk (LIN-3453 plan, revision 3/4). This is NOT a characterization:
 * it asserts the NEW contract and would fail on the old code. The sibling file
 * lin-3455-epoch-ms-b-characterization.test.js pins the unchanged junk cases.
 *
 * Run with: node --test tests/unit/lin-3455-epoch-ms-b-null.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ShelvedRulingsStore } from '../../lib/shelved-rulings-store.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';
import { TaskSnapshotStore } from '../../lib/task-snapshot-store.js';

// One generic in-memory collection: equality, $in, $ne on top-level fields.
function createMockCollection() {
  const docs = [];
  function matchesField(docValue, q) {
    if (q && typeof q === 'object' && !(q instanceof Date)) {
      if (Array.isArray(q.$in)) return q.$in.includes(docValue);
      if ('$ne' in q) return docValue !== q.$ne;
    }
    return docValue === q;
  }
  const matches = (doc, query = {}) => Object.entries(query).every(([k, v]) => matchesField(doc[k], v));
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update, opts = {}) {
      const doc = docs.find(d => matches(d, query));
      if (doc) { Object.assign(doc, update.$set || {}); return { matchedCount: 1, modifiedCount: 1 }; }
      if (opts.upsert) { docs.push({ ...(update.$set || {}) }); return { matchedCount: 0, modifiedCount: 0 }; }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

const T1 = new Date('2026-10-01T00:00:00.000Z');
const T2 = new Date('2026-10-02T00:00:00.000Z');

describe('null is missing, not epoch 0 (LIN-3453)', () => {
  test('shelved-rulings-store: a null resurfaceAt is not a lapse (it counted one as epoch 0)', async () => {
    const NOW = new Date('2026-10-10T12:00:00.000Z');
    const collection = createMockCollection();
    const store = new ShelvedRulingsStore({ collection });
    await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'waiting', resurfaceInMs: 3600000, now: NOW });
    collection._docs[0].resurfaceAt = null;
    const again = await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'waiting', resurfaceInMs: 3600000, now: NOW });
    assert.equal(again.lapseCount, 0);
  });

  describe('task-decisions-store', () => {
    const ISSUE = '11111111-1111-4111-8111-111111111111';
    const row = (id, issueId, extra = {}) => ({ _id: id, urlKey: 'acme', issueId, outcome: null, decision: { decision_id: id }, ...extra });

    test('a null outcomeAt is not in the resolved list, even with no cutoff', async () => {
      const collection = createMockCollection();
      const store = new TaskDecisionsStore({ collection });
      collection._docs.push(
        row('ok', 't1', { outcome: 'answered', outcomeAt: T2 }),
        row('nul', 't1', { outcome: 'answered', outcomeAt: null })
      );
      assert.deepEqual((await store.listResolvedForWorkspaces(['acme'], undefined)).map(r => r.id), ['ok']);
    });

    test('_docsFor: a null scannedAt behaves like junk and falls through to seq (it sorted as epoch 0, last)', async () => {
      const collection = createMockCollection();
      const store = new TaskDecisionsStore({ collection });
      collection._docs.push(
        row('t1', ISSUE, { scannedAt: T1, seq: 1 }),
        row('t2', ISSUE, { scannedAt: T2, seq: 2 }),
        row('nul', ISSUE, { scannedAt: null, seq: 3 })
      );
      assert.deepEqual((await store._docsFor('acme', ISSUE)).map(d => d._id), ['nul', 't2', 't1']);
    });

    test('listNewestScanPerTask: a null scannedAt never displaces a valid row', async () => {
      const collection = createMockCollection();
      const store = new TaskDecisionsStore({ collection });
      collection._docs.push(row('valid', 't1', { scannedAt: T1 }), row('nul', 't1', { scannedAt: null }));
      assert.equal((await store.listNewestScanPerTask(['acme']))['acme::t1'].scannedAt, T1.toISOString());
    });
  });

  test('task-snapshot-store: a null capturedAt orders by seq like junk (it sorted as epoch 0, last)', async () => {
    const collection = createMockCollection();
    const store = new TaskSnapshotStore({ collection });
    const snap = (id, extra) => ({ _id: id, urlKey: 'acme', taskIdentifier: 'LIN-1', ...extra });
    collection._docs.push(
      snap('s1', { capturedAt: T1, seq: 1 }),
      snap('s2', { capturedAt: T2, seq: 2 }),
      snap('nul', { capturedAt: null, seq: 3 })
    );
    assert.deepEqual((await store._docsFor('acme', 'LIN-1')).map(d => d._id), ['nul', 's2', 's1']);
    assert.deepEqual((await store.listByWorkspace('acme')).items.map(r => r.id), ['nul', 's2', 's1']);
  });
});
