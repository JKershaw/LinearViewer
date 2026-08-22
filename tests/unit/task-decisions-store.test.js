/**
 * Unit tests for lib/task-decisions-store.js (LIN-2197 Phase 2)
 *
 * Run with: node --test tests/unit/task-decisions-store.test.js
 *
 * Exercises the real TaskDecisionsStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface. Covers: the deterministic content-keyed
 * `_id`, the outcome-stamped re-scan behaviour (a terminal row is never
 * silently overwritten, a non-terminal one refreshes, a genuine content
 * change proceeds as a new row), `getStatus` returning the latest row
 * regardless of outcome, zero-finding persistence, and the per-task cap.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';

// Minimal in-memory mock of the collection surface the store uses, mirroring
// tests/unit/task-snapshot-store.test.js's mock.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.issueId !== undefined && doc.issueId !== query.issueId) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
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

const URL_KEY = 'ws1';
const ISSUE_ID = '11111111-2222-3333-4444-555555555555';
const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function sampleDecision(overrides = {}) {
  return {
    decision_id: 'scan_11111111_aaaaaaaaaaaa',
    question: 'Which auth strategy should this use?',
    options: [{ id: 'a', label: 'OAuth' }, { id: 'b', label: 'API key' }],
    free_text: false,
    ...overrides
  };
}

describe('TaskDecisionsStore.buildId', () => {
  test('is deterministic over (issueId, inputHash), namespaced under scan_', () => {
    const id1 = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const id2 = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    assert.equal(id1, id2);
    assert.equal(id1, 'scan_11111111_aaaaaaaaaaaa');
  });

  test('a different hash for the same issue produces a different id', () => {
    const idA = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const idB = TaskDecisionsStore.buildId(ISSUE_ID, HASH_B);
    assert.notEqual(idA, idB);
  });
});

describe('TaskDecisionsStore.recordScan / getStatus', () => {
  let collection, store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('records a persisted decision and reports it via getStatus', async () => {
    const decision = sampleDecision();
    const record = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, issueIdentifier: 'LIN-2197',
      inputHash: HASH_A, decision
    });
    assert.equal(record.id, 'scan_11111111_aaaaaaaaaaaa');
    assert.deepEqual(record.decision, decision);
    assert.equal(record.outcome, null);

    const status = await store.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(status.id, record.id);
    assert.deepEqual(status.decision, decision);
  });

  test('records a zero-finding scan as decision: null, distinct from never-scanned', async () => {
    const record = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, issueIdentifier: 'LIN-2197',
      inputHash: HASH_A, decision: null
    });
    assert.equal(record.decision, null);

    const status = await store.getStatus(URL_KEY, ISSUE_ID);
    assert.notEqual(status, null); // a real row exists...
    assert.equal(status.decision, null); // ...that just found nothing

    const neverScanned = await store.getStatus(URL_KEY, 'no-such-issue');
    assert.equal(neverScanned, null);
  });

  test('re-scanning unchanged content (same hash, no outcome) refreshes the same row', async () => {
    await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A,
      decision: sampleDecision({ question: 'first pass' })
    });
    const second = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A,
      decision: sampleDecision({ question: 'second pass, same hash' })
    });
    assert.equal(second.id, 'scan_11111111_aaaaaaaaaaaa');
    assert.equal(second.decision.question, 'second pass, same hash');

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, 1); // refreshed in place, not duplicated
  });

  test('a genuine content change (new hash) produces a new row, not a collision', async () => {
    const first = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision()
    });
    const second = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B,
      decision: sampleDecision({ decision_id: 'scan_11111111_bbbbbbbbbbbb' })
    });
    assert.notEqual(first.id, second.id);

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, 2);

    // getStatus reports the latest (newest scannedAt) row.
    const status = await store.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(status.id, second.id);
  });

  test('recordScan at an existing outcome-stamped id discards the new result and returns the row unchanged', async () => {
    await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A,
      decision: sampleDecision({ question: 'original' })
    });
    // Seed a terminal outcome directly onto that row (markOutcome is a later phase's job).
    const _id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const stamped = collection._docs.find(d => d._id === _id);
    stamped.outcome = 'dismissed';
    stamped.outcomeAt = new Date('2026-08-20T00:00:00.000Z');

    const result = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A,
      decision: sampleDecision({ question: 'a fresh LLM result for the SAME unchanged content' })
    });

    assert.equal(result.id, _id);
    assert.equal(result.outcome, 'dismissed');
    assert.equal(result.decision.question, 'original'); // new result discarded, not persisted
    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, 1); // never duplicated either
  });

  test('getStatus on an outcome-stamped current row returns it with outcome set, not null', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const _id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const stamped = collection._docs.find(d => d._id === _id);
    stamped.outcome = 'answered';
    stamped.outcomeAt = new Date('2026-08-21T00:00:00.000Z');

    const status = await store.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(status.outcome, 'answered');
    assert.equal(status.outcomeAt, '2026-08-21T00:00:00.000Z');
    assert.notEqual(status, null);
  });

  test('a content change past an outcome-stamped row supersedes it with a new live row (D2)', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const _id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const stamped = collection._docs.find(d => d._id === _id);
    stamped.outcome = 'dismissed';
    stamped.outcomeAt = new Date();

    const fresh = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B,
      decision: sampleDecision({ decision_id: 'scan_11111111_bbbbbbbbbbbb', question: 'new content, new question' })
    });
    assert.equal(fresh.outcome, null);
    assert.equal(fresh.decision.question, 'new content, new question');

    const status = await store.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(status.id, fresh.id); // the new row is now current, old dismissed row untouched but not current
    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, 2);
  });

  test('scoped per workspace: same issueId under a different urlKey is independent', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const otherWorkspaceStatus = await store.getStatus('ws2', ISSUE_ID);
    assert.equal(otherWorkspaceStatus, null);
  });

  test('returns null on missing required fields rather than throwing', async () => {
    assert.equal(await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID }), null); // no inputHash
    assert.equal(await store.recordScan({ issueId: ISSUE_ID, inputHash: HASH_A }), null); // no urlKey
    assert.equal(await store.getStatus(null, ISSUE_ID), null);
    assert.equal(await store.getStatus(URL_KEY, null), null);
  });

  test('per-task cap prunes the oldest distinct-hash rows beyond maxPerTask', async () => {
    const capped = new TaskDecisionsStore({ collection, maxPerTask: 2 });
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: 'h1'.padEnd(64, '0'), decision: null });
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: 'h2'.padEnd(64, '0'), decision: null });
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: 'h3'.padEnd(64, '0'), decision: null });

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, 2);
    // The newest two survive; the oldest (h1) is pruned.
    const survivingIds = rows.map(r => r._id).sort();
    const expected = [
      TaskDecisionsStore.buildId(ISSUE_ID, 'h2'.padEnd(64, '0')),
      TaskDecisionsStore.buildId(ISSUE_ID, 'h3'.padEnd(64, '0'))
    ].sort();
    assert.deepEqual(survivingIds, expected);
  });
});
