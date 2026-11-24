/**
 * LIN-3455 (B of LIN-3453): characterization of the B-scope timestamp helpers'
 * behaviour on JUNK input, written against the private `toMillis` / `tsOf` /
 * `ms` copies BEFORE they are swapped for `lib/utils/time.js#toEpochMs`.
 *
 * Run with: node --test tests/unit/lin-3455-epoch-ms-b-characterization.test.js
 *
 * Junk here is `undefined` (field absent) or `'not-a-date'`, NEVER `null`: both
 * give NaN on every raw-NaN copy and `null` on `toEpochMs`, whereas `null` is
 * epoch 0 on the old raw-NaN copies and missing afterwards (LIN-3453's
 * "null is missing, not epoch 0" rule, tested in the swap commit instead).
 *
 * Every assertion here must hold before AND after the swap. (The task-decisions
 * store and ruling predicate cases left with those modules, LIN-4541.)
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectiveCharactersStore } from '../../lib/collective-characters-store.js';
import { RunProposalsStore } from '../../lib/run-proposals-store.js';
import { SavedChatStore } from '../../lib/saved-chat-store.js';
import { ReportHistoryStore } from '../../lib/report-history-store.js';
import { ShipBiscuitHistoryStore } from '../../lib/ship-biscuit-history-store.js';
import { extractPrUrls, closeOutSummaryFor } from '../../lib/run-evidence.js';
import { recentRuns } from '../../lib/recent-runs.js';

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
const T3 = new Date('2026-10-03T00:00:00.000Z');

// ---------------------------------------------------------------------------
// 0-returning stores: junk reads as epoch 0, i.e. the OLDEST row.
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: 0-returning stores (junk sorts as epoch 0)', () => {
  test('collective-characters-store: recent eviction treats a junk createdAt as oldest, then breaks ties by seq', async () => {
    const collection = createMockCollection();
    const store = new CollectiveCharactersStore({ collection, maxRecent: 3 });
    collection._docs.push(
      { _id: 'new', urlKey: 'acme', kind: 'recent', createdAt: T3, seq: 1 },
      { _id: 'old', urlKey: 'acme', kind: 'recent', createdAt: T1, seq: 2 },
      { _id: 'junk-low-seq', urlKey: 'acme', kind: 'recent', createdAt: 'not-a-date', seq: 3 },
      { _id: 'junk-high-seq', urlKey: 'acme', kind: 'recent', seq: 4 }
    );
    await store._evictRecent('acme');
    assert.deepEqual(collection._docs.map(d => d._id).sort(), ['junk-high-seq', 'new', 'old']);
  });

  test('run-proposals-store: list() puts a junk proposedAt last (newest-first)', async () => {
    const collection = createMockCollection();
    const store = new RunProposalsStore({ collection });
    collection._docs.push(
      { _id: 'p-junk-s', urlKey: 'acme', runId: 'r1', proposedAt: 'not-a-date' },
      { _id: 'p-old', urlKey: 'acme', runId: 'r1', proposedAt: T1.toISOString() },
      { _id: 'p-new', urlKey: 'acme', runId: 'r1', proposedAt: T2.toISOString() }
    );
    assert.deepEqual((await store.list('acme', 'r1')).map(r => r.id), ['p-new', 'p-old', 'p-junk-s']);
  });

  test('saved-chat-store: listByTask() puts junk updatedAt last, junk ties break by seq', async () => {
    const collection = createMockCollection();
    const store = new SavedChatStore({ collection });
    const base = { urlKey: 'acme', accountId: 'u1', taskIdentifier: 'LIN-1' };
    collection._docs.push(
      { ...base, _id: 'c-junk-1', updatedAt: 'not-a-date', seq: 1 },
      { ...base, _id: 'c-junk-2', seq: 2 },
      { ...base, _id: 'c-old', updatedAt: T1.toISOString(), seq: 3 },
      { ...base, _id: 'c-new', updatedAt: T2.toISOString(), seq: 4 }
    );
    assert.deepEqual((await store.listByTask('acme', 'u1', 'LIN-1')).map(r => r.id), ['c-new', 'c-old', 'c-junk-2', 'c-junk-1']);
  });

  test('saved-chat-store: _docsFor() orders the same way', async () => {
    const collection = createMockCollection();
    const store = new SavedChatStore({ collection });
    const base = { urlKey: 'acme', accountId: 'u1' };
    collection._docs.push(
      { ...base, _id: 'c-junk', seq: 9 },
      { ...base, _id: 'c-old', updatedAt: T1.toISOString(), seq: 1 },
      { ...base, _id: 'c-new', updatedAt: T2.toISOString(), seq: 2 }
    );
    assert.deepEqual((await store._docsFor('acme', 'u1')).map(d => d._id), ['c-new', 'c-old', 'c-junk']);
  });
});

// ---------------------------------------------------------------------------
// Plain-sort history stores (raw NaN comparator): nothing about junk order is
// pinned, but valid rows must still come out newest-first and nothing may be
// dropped or thrown on a junk generatedAt.
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: plain-sort history stores', () => {
  for (const [name, Store] of [['report-history-store', ReportHistoryStore], ['ship-biscuit-history-store', ShipBiscuitHistoryStore]]) {
    test(`${name}: valid rows sort newest-first and a junk generatedAt row is kept, not dropped`, async () => {
      const collection = createMockCollection();
      const store = new Store({ collection });
      collection._docs.push(
        { _id: 'h-old', urlKey: 'acme', generatedAt: T1 },
        { _id: 'h-new', urlKey: 'acme', generatedAt: T3 }
      );
      assert.deepEqual((await store._docsSorted('acme')).map(d => d._id), ['h-new', 'h-old']);

      collection._docs.push({ _id: 'h-junk', urlKey: 'acme', generatedAt: 'not-a-date' });
      const docs = await store._docsSorted('acme');
      assert.deepEqual(docs.map(d => d._id).sort(), ['h-junk', 'h-new', 'h-old']);
    });
  }
});

// ---------------------------------------------------------------------------
// run-evidence: tsOf reads junk as 0
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: run-evidence tsOf', () => {
  const PR_A = 'https://github.com/acme/widget/pull/12';
  const PR_B = 'https://github.com/acme/gadget/pull/7';
  const c = (body, createdAt) => ({ body, createdAt });

  test('extractPrUrls: a comment with a junk createdAt sorts as oldest', () => {
    const urls = extractPrUrls([
      c(PR_A, 'not-a-date'),
      c(PR_B, T1.toISOString()),
    ]);
    assert.deepEqual(urls.map(u => u.url), [PR_B, PR_A]);
    const absent = extractPrUrls([{ body: PR_A }, c(PR_B, T1.toISOString())]);
    assert.deepEqual(absent.map(u => u.url), [PR_B, PR_A]);
  });

  // LIN-4520 (finding-9d0c053a): the close-out is a run record, ended at `at`, its account in fields.account. The junk-instant
  // rules are the same: a junk instant reads as 0.
  const closeOut = (text, at) => ({ at, fields: { stage: 'close-out', account: `## Close-out\n${text}` } });
  test('closeOutSummaryFor: a junk review at (0, falsy) applies no review cutoff', () => {
    const out = closeOutSummaryFor([closeOut('done', T1.toISOString())], { at: 'not-a-date' });
    assert.deepEqual(out, { at: T1.toISOString(), text: 'done' });
  });
  test('closeOutSummaryFor: a junk close-out at reads as 0, so it is skipped once a review time is set', () => {
    const review = { at: T1.toISOString() };
    assert.equal(closeOutSummaryFor([closeOut('junk', 'not-a-date')], review), null);
    assert.deepEqual(closeOutSummaryFor([closeOut('junk', 'not-a-date'), closeOut('later', T2.toISOString())], review), { at: T2.toISOString(), text: 'later' });
  });
  test('closeOutSummaryFor: a junk-dated close-out never displaces a dated one (0 < best)', () => {
    const out = closeOutSummaryFor([closeOut('dated', T2.toISOString()), closeOut('junk', 'not-a-date')], null);
    assert.deepEqual(out, { at: T2.toISOString(), text: 'dated' });
  });
});

// ---------------------------------------------------------------------------
// recent-runs: junk `at` reads as Infinity (sorts newest)
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: recent-runs ordering with a junk at', () => {
  const run = (kind, dispatchedAt) => ({ kind, status: 'pending', dispatchedAt, feedback: [] });
  test("a pending run with an unparseable dispatchedAt ('not-a-date') sorts last (newest) of the dated ones", () => {
    const out = recentRuns([run('review', 'not-a-date'), run('plan', T1.toISOString()), run('implementation', T2.toISOString())]);
    assert.deepEqual(out.map(r => r.stage), ['plan', 'implementation', 'review']);
  });
  test('an absent dispatchedAt (undefined) sorts last too, and two junk rows keep their input order', () => {
    const out = recentRuns([run('review'), run('plan', T1.toISOString()), run('close-out', 'not-a-date'), run('implementation', T2.toISOString())]);
    assert.deepEqual(out.map(r => r.stage), ['plan', 'implementation', 'review', 'close-out']);
  });
});
