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
    },
    // Mirrors lib/observation-sessions-store.js's real-driver usage: `$set` +
    // `{upsert: true}` only — the only shape the store ever calls with.
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) {
        Object.assign(docs[idx], update.$set || {});
        return { matchedCount: 1, modifiedCount: 1, upsertedId: null };
      }
      if (opts.upsert) {
        const doc = { ...(update.$set || {}) };
        docs.push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedId: doc._id };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
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

  test('the current live (unanswered) row survives a prune at maxPerTask: 1', async () => {
    const capped = new TaskDecisionsStore({ collection, maxPerTask: 1 });
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const second = await capped.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B,
      decision: sampleDecision({ decision_id: 'scan_11111111_bbbbbbbbbbbb' })
    });

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]._id, second.id); // the live row, not the pruned-away first one

    const status = await capped.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(status.id, second.id);
  });
});

describe('TaskDecisionsStore canonical-UUID guard', () => {
  let collection, store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('recordScan rejects a non-UUID issueId rather than keying a row under it', async () => {
    const result = await store.recordScan({
      urlKey: URL_KEY, issueId: 'LIN-2197', inputHash: HASH_A, decision: sampleDecision()
    });
    assert.equal(result, null);
    assert.equal(collection._docs.length, 0, 'nothing durable was written under the identifier fallback');
  });

  test('getStatus rejects a non-UUID issueId (never silently reports a row keyed under one)', async () => {
    // Seed a row as if something had bypassed the guard.
    collection._docs.push({
      _id: 'scan_LIN-2197_aaaaaaaaaaaa', urlKey: URL_KEY, issueId: 'LIN-2197',
      issueIdentifier: 'LIN-2197', inputHash: HASH_A, decision: sampleDecision(),
      scannedAt: new Date(), seq: 0, outcome: null, outcomeAt: null
    });
    const status = await store.getStatus(URL_KEY, 'LIN-2197');
    assert.equal(status, null, 'a durable ruling written under an identifier key must not be findable via the guarded path either');
  });

  test('markOutcome rejects a non-UUID issueId', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const _id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const result = await store.markOutcome({ urlKey: URL_KEY, issueId: 'LIN-2197', id: _id, outcome: 'dismissed' });
    assert.equal(result, null);
  });
});

describe('TaskDecisionsStore.getStatus content-revert agreement (Phase 4 ledger item 4)', () => {
  let collection, store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('getStatus(urlKey, issueId, inputHash) prefers the exact-hash row over "latest scanned"', async () => {
    // Dismiss content A, then scan changed content B (B is now the newest row).
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision({ question: 'A-question' }) });
    const idA = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const rowA = collection._docs.find(d => d._id === idA);
    rowA.outcome = 'dismissed';
    rowA.outcomeAt = new Date('2026-08-21T00:00:00.000Z');

    await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B,
      decision: sampleDecision({ decision_id: 'scan_11111111_bbbbbbbbbbbb', question: 'B-question' })
    });

    // Without a hash, getStatus reports the newest row overall (B) — unchanged legacy behaviour.
    const legacy = await store.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(legacy.decision.question, 'B-question');

    // Content reverts to A. A caller re-fetching context and hashing it again gets HASH_A,
    // and a POST scan at that hash would find and return the dismissed row A (recordScan's
    // own terminal-row-preserved branch). getStatus, told the CURRENT hash is HASH_A, must
    // agree — not keep reporting B just because B was scanned more recently.
    const afterRevert = await store.getStatus(URL_KEY, ISSUE_ID, HASH_A);
    assert.equal(afterRevert.id, idA);
    assert.equal(afterRevert.outcome, 'dismissed');
    assert.equal(afterRevert.decision.question, 'A-question');
  });

  test('getStatus with an inputHash matching no row falls back to the latest scanned row ("stale")', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const status = await store.getStatus(URL_KEY, ISSUE_ID, 'c'.repeat(64));
    assert.equal(status.inputHash, HASH_A, 'falls back to the only row that exists, distinguishable by its own inputHash not matching the caller\'s');
  });
});

describe('TaskDecisionsStore.markOutcome', () => {
  let collection, store;

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('stamps a row with an outcome and returns the updated record', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);

    const record = await store.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id, outcome: 'dismissed' });
    assert.equal(record.outcome, 'dismissed');
    assert.ok(record.outcomeAt);

    const status = await store.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(status.outcome, 'dismissed');
  });

  test('is idempotent: a second stamp on an already-terminal row is a no-op (first stamp wins)', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);

    const first = await store.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id, outcome: 'dismissed' });
    const second = await store.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id, outcome: 'answered' });
    assert.equal(second.outcome, 'dismissed', 'the first stamp wins; a second call cannot flip it');
    assert.equal(second.outcomeAt, first.outcomeAt);
  });

  test('returns null for a non-existent row, a bad outcome value, or missing fields', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);

    assert.equal(await store.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id: 'scan_nope_nope', outcome: 'dismissed' }), null);
    assert.equal(await store.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id, outcome: 'archived' }), null);
    assert.equal(await store.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id, outcome: 'dismissed' }) && true, true); // sanity: valid call still works
    assert.equal(await store.markOutcome({ issueId: ISSUE_ID, id, outcome: 'dismissed' }), null); // no urlKey
  });
});
