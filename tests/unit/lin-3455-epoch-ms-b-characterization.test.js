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
 * Every assertion here must hold before AND after the swap. The one deliberate
 * input change that is not pinned here is an Invalid Date *instance* in
 * unanswered-decisions (NaN -> 0), which the parent plan names as a change.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CollectiveCharactersStore } from '../../lib/collective-characters-store.js';
import { RunProposalsStore } from '../../lib/run-proposals-store.js';
import { SavedChatStore } from '../../lib/saved-chat-store.js';
import { ReportHistoryStore } from '../../lib/report-history-store.js';
import { ShelvedRulingsStore } from '../../lib/shelved-rulings-store.js';
import { ShipBiscuitHistoryStore } from '../../lib/ship-biscuit-history-store.js';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';
import { TaskSnapshotStore } from '../../lib/task-snapshot-store.js';
import { collectUnansweredDecisions } from '../../lib/unanswered-decisions.js';
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
// shelved-rulings-store:122 — `NaN <= now` is false, so a junk resurfaceAt is
// NOT a lapse.
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: shelved-rulings-store lapseCount', () => {
  const NOW = new Date('2026-10-10T12:00:00.000Z');
  const HOUR = 3600 * 1000;
  async function lapseAfterRewriting(resurfaceAt) {
    const collection = createMockCollection();
    const store = new ShelvedRulingsStore({ collection });
    await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'waiting', resurfaceInMs: HOUR, now: NOW });
    collection._docs[0].resurfaceAt = resurfaceAt;
    if (resurfaceAt === undefined) delete collection._docs[0].resurfaceAt;
    const again = await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'waiting', resurfaceInMs: HOUR, now: NOW });
    return again.lapseCount;
  }

  test('control: a resurfaceAt in the past counts a lapse', async () => {
    assert.equal(await lapseAfterRewriting(new Date(NOW.getTime() - HOUR)), 1);
  });
  test('control: a resurfaceAt in the future does not', async () => {
    assert.equal(await lapseAfterRewriting(new Date(NOW.getTime() + HOUR)), 0);
  });
  test("junk resurfaceAt ('not-a-date') does not count a lapse", async () => {
    assert.equal(await lapseAfterRewriting('not-a-date'), 0);
  });
  test('absent resurfaceAt (undefined) does not count a lapse', async () => {
    assert.equal(await lapseAfterRewriting(undefined), 0);
  });
});

// ---------------------------------------------------------------------------
// task-decisions-store
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: task-decisions-store', () => {
  const ISSUE = '11111111-1111-4111-8111-111111111111';
  let collection, store;
  const row = (id, issueId, extra = {}) => ({ _id: id, urlKey: 'acme', issueId, outcome: null, decision: { decision_id: id }, ...extra });
  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  describe('listNewestScanPerTask (:595 `>` newest-then-filter reduction)', () => {
    const pick = async () => (await store.listNewestScanPerTask(['acme']))['acme::t1'].scannedAt;

    test('two junk rows: the first one stays (junk > junk is false)', async () => {
      collection._docs.push(row('a', 't1', { scannedAt: 'not-a-date' }), row('b', 't1'));
      assert.equal(await pick(), 'not-a-date');
    });
    test('junk first, then valid: the junk row sticks (valid > junk is false)', async () => {
      collection._docs.push(row('a', 't1', { scannedAt: 'not-a-date' }), row('b', 't1', { scannedAt: T2.toISOString() }));
      assert.equal(await pick(), 'not-a-date');
    });
    test('valid first, then junk: the valid row stays (junk > valid is false)', async () => {
      collection._docs.push(row('a', 't1', { scannedAt: T2.toISOString() }), row('b', 't1', { scannedAt: 'not-a-date' }));
      assert.equal(await pick(), T2.toISOString());
    });
    test('control: two valid rows, the newer wins', async () => {
      collection._docs.push(row('a', 't1', { scannedAt: T1.toISOString() }), row('b', 't1', { scannedAt: T2.toISOString() }));
      assert.equal(await pick(), T2.toISOString());
    });
  });

  describe('listResolvedForWorkspaces (:634 `>= cutoff`)', () => {
    const resolved = (id, outcomeAt) => row(id, 't1', { outcome: 'answered', outcomeAt, scannedAt: T1 });
    test('a junk outcomeAt is excluded under a finite cutoff', async () => {
      collection._docs.push(resolved('ok', T2), resolved('bad-s', 'not-a-date'), resolved('bad-u', undefined));
      const out = await store.listResolvedForWorkspaces(['acme'], T1.getTime());
      assert.deepEqual(out.map(r => r.id), ['ok']);
    });
    test('a junk outcomeAt is excluded even with no cutoff at all', async () => {
      collection._docs.push(resolved('ok', T2), resolved('bad-s', 'not-a-date'), resolved('bad-u', undefined));
      const out = await store.listResolvedForWorkspaces(['acme'], undefined);
      assert.deepEqual(out.map(r => r.id), ['ok']);
    });
  });

  describe('listCandidatesForWorkspace (:685-700 `>` and `===` tie-breaks, :693 sort)', () => {
    test('two junk rows for one issue: the first one stays (neither > nor === holds)', async () => {
      collection._docs.push(
        row('first', 'issue-x', { scannedAt: 'not-a-date', seq: 1 }),
        row('second', 'issue-x', { seq: 2 })
      );
      const { items } = await store.listCandidatesForWorkspace('acme');
      assert.deepEqual(items.map(r => r.id), ['first']);
    });
    test('junk first then valid for one issue: the junk row sticks', async () => {
      collection._docs.push(
        row('junk', 'issue-x', { scannedAt: 'not-a-date', seq: 1 }),
        row('valid', 'issue-x', { scannedAt: T2, seq: 2 })
      );
      const { items } = await store.listCandidatesForWorkspace('acme');
      assert.deepEqual(items.map(r => r.id), ['junk']);
    });
    test('valid first then junk for one issue: the valid row stays', async () => {
      collection._docs.push(
        row('valid', 'issue-x', { scannedAt: T2, seq: 1 }),
        row('junk', 'issue-x', { scannedAt: 'not-a-date', seq: 2 })
      );
      const { items } = await store.listCandidatesForWorkspace('acme');
      assert.deepEqual(items.map(r => r.id), ['valid']);
    });

    test('a junk-scannedAt candidate falls through to the issueId tiebreak, not to epoch 0 (stays between its neighbours)', async () => {
      collection._docs.push(
        row('c', 'issue-c', { scannedAt: T2 }),
        row('b', 'issue-b'),
        row('a', 'issue-a', { scannedAt: T1 })
      );
      const { items, totalCandidateCount } = await store.listCandidatesForWorkspace('acme');
      assert.equal(totalCandidateCount, 3);
      assert.deepEqual(items.map(r => r.issueId), ['issue-a', 'issue-b', 'issue-c']);
    });

    test('cursor paging: the junk row is dropped from later pages, valid rows page through in order', async () => {
      collection._docs.push(
        row('c', 'issue-c', { scannedAt: T2 }),
        row('b', 'issue-b', { scannedAt: 'not-a-date' }),
        row('a', 'issue-a', { scannedAt: T1 })
      );
      const page1 = await store.listCandidatesForWorkspace('acme', { limit: 1 });
      assert.deepEqual(page1.items.map(r => r.issueId), ['issue-a']);
      assert.ok(page1.nextCursor);
      const page2 = await store.listCandidatesForWorkspace('acme', { limit: 5, cursor: page1.nextCursor });
      assert.deepEqual(page2.items.map(r => r.issueId), ['issue-c']);
      assert.equal(page2.nextCursor, null);
    });
  });

  describe('_docsFor / getStatus newest-first (:721 sort `|| seq`)', () => {
    test('a junk-scannedAt row with the highest seq stays first; valid rows keep scannedAt order', async () => {
      collection._docs.push(
        row('t1', ISSUE, { scannedAt: T1, seq: 1 }),
        row('t2', ISSUE, { scannedAt: T2, seq: 2 }),
        row('junk', ISSUE, { scannedAt: 'not-a-date', seq: 3 })
      );
      assert.deepEqual((await store._docsFor('acme', ISSUE)).map(d => d._id), ['junk', 't2', 't1']);
      assert.equal((await store.getStatus('acme', ISSUE)).id, 'junk');
    });
    test('an absent scannedAt (undefined) with the highest seq behaves the same', async () => {
      collection._docs.push(
        row('t1', ISSUE, { scannedAt: T1, seq: 1 }),
        row('t2', ISSUE, { scannedAt: T2, seq: 2 }),
        row('junk', ISSUE, { seq: 3 })
      );
      assert.deepEqual((await store._docsFor('acme', ISSUE)).map(d => d._id), ['junk', 't2', 't1']);
    });
  });
});

// ---------------------------------------------------------------------------
// task-snapshot-store (:300 listByWorkspace, :330 _docsFor — `|| seq` sorts)
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: task-snapshot-store newest-first', () => {
  const snap = (id, extra = {}) => ({ _id: id, urlKey: 'acme', taskIdentifier: 'LIN-1', ...extra });
  test('listByWorkspace: a junk-capturedAt row with the highest seq stays first', async () => {
    const collection = createMockCollection();
    const store = new TaskSnapshotStore({ collection });
    collection._docs.push(
      snap('s1', { capturedAt: T1, seq: 1 }),
      snap('s2', { capturedAt: T2, seq: 2 }),
      snap('junk', { capturedAt: 'not-a-date', seq: 3 })
    );
    const { items } = await store.listByWorkspace('acme');
    assert.deepEqual(items.map(r => r.id), ['junk', 's2', 's1']);
  });
  test('_docsFor / latest: the same with an absent capturedAt', async () => {
    const collection = createMockCollection();
    const store = new TaskSnapshotStore({ collection });
    collection._docs.push(
      snap('s1', { capturedAt: T1, seq: 1 }),
      snap('s2', { capturedAt: T2, seq: 2 }),
      snap('junk', { seq: 3 })
    );
    assert.deepEqual((await store._docsFor('acme', 'LIN-1')).map(d => d._id), ['junk', 's2', 's1']);
    assert.equal((await store.latest('acme', 'LIN-1')).id, 'junk');
  });
  test('control: valid rows with the same capturedAt order by seq', async () => {
    const collection = createMockCollection();
    const store = new TaskSnapshotStore({ collection });
    collection._docs.push(snap('a', { capturedAt: T1, seq: 1 }), snap('b', { capturedAt: T1, seq: 2 }));
    assert.deepEqual((await store._docsFor('acme', 'LIN-1')).map(d => d._id), ['b', 'a']);
  });
});

// ---------------------------------------------------------------------------
// unanswered-decisions: taskDecisionScannedAtMs / _dispatchedAtMs read junk as 0
// ---------------------------------------------------------------------------
describe('LIN-3455 characterization: unanswered-decisions', () => {
  const NOW = new Date('2026-10-10T12:00:00.000Z');
  const dec = (id) => ({ decision_id: id, question: 'Proceed?' });
  const taskDecision = (id, extra = {}) => ({
    id: `scan-${id}`, urlKey: 'acme', issueId: 'task-1', issueIdentifier: 'LIN-9',
    inputHash: 'h', decision: dec(id), outcome: null, outcomeAt: null, ...extra
  });
  const surfaced = (taskDecisions, newestScanByTask) =>
    collectUnansweredDecisions({ taskDecisions, newestScanByTask }, { now: NOW }).map(r => r.decision.decision_id);

  test('junk then valid scannedAt: the valid row is newer than junk (0) and wins', () => {
    assert.deepEqual(surfaced([taskDecision('junk', { scannedAt: 'not-a-date' }), taskDecision('valid', { scannedAt: T1.toISOString() })]), ['valid']);
  });
  test('valid then junk scannedAt: the valid row stays', () => {
    assert.deepEqual(surfaced([taskDecision('valid', { scannedAt: T1.toISOString() }), taskDecision('junk')]), ['valid']);
  });
  test('two junk scannedAt rows: the first stays (0 > 0 is false)', () => {
    assert.deepEqual(surfaced([taskDecision('first', { scannedAt: 'not-a-date' }), taskDecision('second')]), ['first']);
  });
  test('a newer outcome-bearing scan drops the candidate; a junk-scannedAt one does not', () => {
    const cand = taskDecision('open', { scannedAt: T1.toISOString() });
    const newest = (scannedAt) => ({ 'acme::task-1': { urlKey: 'acme', issueId: 'task-1', outcome: 'answered', scannedAt } });
    assert.deepEqual(surfaced([cand], newest(T2.toISOString())), [], 'control: a strictly newer answered scan discharges it');
    assert.deepEqual(surfaced([cand], newest('not-a-date')), ['open'], 'junk newest scan reads as 0, not newer');
  });

  const loop = (loopId, extra = {}) => ({
    loopId, issueId: 'uuid-1', issueIdentifier: 'LIN-900', workspaceUrlKey: 'acme', target: 'cli',
    followUpTo: null, terminalStatus: null, terminalCompletedAt: null, wakeMarker: null, agentState: null,
    decision: null, decisionCase: [], answeredDecisions: [], ...extra
  });
  const stampLoop = (wakes) => {
    const root = loop('root', { dispatchedAt: '2026-10-01T00:00:00.000Z' });
    const members = wakes.map(([id, extra]) => loop(id, { lineageId: 'root', wakeMarker: 'blocked', decision: dec('dup'), ...extra }));
    const rows = collectUnansweredDecisions({ loops: [root, ...members] }, { now: NOW });
    assert.equal(rows.length, 1);
    return rows[0].stampLoopId;
  };

  test('content loop: a junk dispatchedAt is the oldest member (0), so a valid one is chosen', () => {
    assert.equal(stampLoop([['wake-z', {}], ['wake-a', { dispatchedAt: T1.toISOString() }]]), 'wake-a');
    assert.equal(stampLoop([['wake-a', { dispatchedAt: T1.toISOString() }], ['wake-z', { dispatchedAt: 'not-a-date' }]]), 'wake-a');
  });
  test('content loop: two junk dispatchedAt tie at 0 and the greater loopId wins', () => {
    assert.equal(stampLoop([['wake-1', {}], ['wake-2', { dispatchedAt: 'not-a-date' }]]), 'wake-2');
    assert.equal(stampLoop([['wake-2', {}], ['wake-1', { dispatchedAt: 'not-a-date' }]]), 'wake-2');
  });
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

  const closeOut = (text, createdAt) => c(`## Close-out\n${text}`, createdAt);
  test('closeOutSummaryFor: a junk review createdAt (0, falsy) applies no review cutoff', () => {
    const out = closeOutSummaryFor([closeOut('done', T1.toISOString())], { createdAt: 'not-a-date' });
    assert.deepEqual(out, { at: T1.toISOString(), text: 'done' });
  });
  test('closeOutSummaryFor: a junk close-out createdAt reads as 0, so it is skipped once a review time is set', () => {
    const review = { createdAt: T1.toISOString() };
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
