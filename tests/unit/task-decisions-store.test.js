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
  // Minimal `$in`/`$ne` support (real MongoDB/MangoDB shape) — only what
  // listUnansweredForWorkspaces' `{ urlKey: { $in: urlKeys }, outcome: null,
  // decision: { $ne: null } }` query needs (LIN-2227: the filter moved from a
  // JS post-filter into the query itself).
  function matchesField(docValue, queryValue) {
    if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
      return queryValue.$in.includes(docValue);
    }
    if (queryValue && typeof queryValue === 'object' && '$ne' in queryValue) {
      return docValue !== queryValue.$ne;
    }
    return docValue === queryValue;
  }
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && !matchesField(doc.urlKey, query.urlKey)) return false;
    if (query.issueId !== undefined && doc.issueId !== query.issueId) return false;
    if (query.outcome !== undefined && !matchesField(doc.outcome ?? null, query.outcome)) return false;
    if (query.decision !== undefined && !matchesField(doc.decision ?? null, query.decision)) return false;
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

  // LIN-2211 ruling: a decision-bearing, unanswered row is prune-EXEMPT,
  // unconditionally — the opposite polarity from the pre-LIN-2211 behaviour
  // this test used to assert (`rows.length === 1`, only the newest survived).
  // Both rows here are live unanswered rulings, so both now survive even
  // though `maxPerTask: 1` is exceeded: an escalation queue must never
  // silently drop a question that was asked of a human, unlike a cache.
  test('decision-bearing unanswered rows both survive a prune at maxPerTask: 1 (LIN-2211)', async () => {
    const capped = new TaskDecisionsStore({ collection, maxPerTask: 1 });
    const first = await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const second = await capped.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B,
      decision: sampleDecision({ decision_id: 'scan_11111111_bbbbbbbbbbbb' })
    });

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, 2, 'the cap is intentionally exceeded — both live unanswered rulings survive');
    const ids = rows.map(r => r._id).sort();
    assert.deepEqual(ids, [first.id, second.id].sort());

    const status = await capped.getStatus(URL_KEY, ISSUE_ID);
    assert.equal(status.id, second.id); // getStatus still falls back to the newest when no hash given
  });

  test('an outcome-stamped row survives a capacity prune even when pushed past maxPerTask (LIN-2197 Phase 5, L2)', async () => {
    const capped = new TaskDecisionsStore({ collection, maxPerTask: 2 });
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const idA = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const rowA = collection._docs.find(d => d._id === idA);
    rowA.outcome = 'dismissed';
    rowA.outcomeAt = new Date();

    // Push three more distinct-hash scans past the cap — without the L2 fix,
    // the dismissed row A would fall off the newest-`maxPerTask` slice and be
    // deleted, so a later revert to A's exact content would re-escalate an
    // already-dismissed ruling (the false-escalation failure this feature is
    // measured against). Churn rows are zero-finding (LIN-2211: a
    // decision-bearing churn row would now be exempt too, under the broader
    // ruling, and would no longer exercise ordinary eviction) so this test
    // still proves real eviction happens around the exempt dismissed row.
    for (const h of ['h1', 'h2', 'h3']) {
      await capped.recordScan({
        urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: h.padEnd(64, '0'),
        decision: null
      });
    }

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    const ids = rows.map(r => r._id);
    assert.ok(ids.includes(idA), 'the dismissed row must survive the prune');
    // Pruning runs after every single recordScan, so capacity (2) is
    // re-established each time: the dismissed row A (exempt, never counted
    // against the cap) plus whichever single zero-finding row is newest at
    // that moment — h1 and h2 are each evicted in turn as a later churn row
    // arrives, only h3 (the last one written) survives alongside A.
    assert.equal(rows.length, 2);
    assert.ok(ids.includes(TaskDecisionsStore.buildId(ISSUE_ID, 'h3'.padEnd(64, '0'))));
    assert.ok(!ids.includes(TaskDecisionsStore.buildId(ISSUE_ID, 'h1'.padEnd(64, '0'))));
    assert.ok(!ids.includes(TaskDecisionsStore.buildId(ISSUE_ID, 'h2'.padEnd(64, '0'))));

    // getStatus at A's exact hash still finds the (never-deleted) dismissed row.
    const afterRevert = await capped.getStatus(URL_KEY, ISSUE_ID, HASH_A);
    assert.equal(afterRevert.id, idA);
    assert.equal(afterRevert.outcome, 'dismissed');
  });

  test('a decision-bearing unanswered row survives the prune even N+1 deep past maxPerTask (LIN-2211)', async () => {
    const N = 3;
    const capped = new TaskDecisionsStore({ collection, maxPerTask: N });
    const ids = [];
    for (let i = 0; i <= N; i++) {
      const hash = `live${i}`.padEnd(64, '0');
      const record = await capped.recordScan({
        urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: hash,
        decision: sampleDecision({ decision_id: `scan_11111111_live${i}` })
      });
      ids.push(record.id);
    }

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    assert.equal(rows.length, N + 1, 'every decision-bearing unanswered row survives, cap exceeded by one');
    const survivingIds = rows.map(r => r._id).sort();
    assert.deepEqual(survivingIds, [...ids].sort());
  });

  // Seeds the zero-finding row as the OLDER of the two non-exempt rows
  // (LIN-2230 review fix) — not as the newest/current row. The pre-fix
  // version of this test seeded the zero-finding row newest and asserted
  // its own eviction, which pinned the LIN-2230 regression (recordScan
  // evicting the row it had just written) rather than proving bucket
  // ordering. A third, decision-bearing-unanswered row is recorded last so
  // the newest row in play is exempt for an unrelated reason (LIN-2211's
  // unconditional decision-bearing exemption) and the assertion never
  // depends on evicting whatever recordScan just wrote.
  test('zero-finding rows evict before terminal rows when both are present and capacity is exceeded', async () => {
    const capped = new TaskDecisionsStore({ collection, maxPerTask: 2 });
    // Oldest: a terminal (dismissed) row.
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const idTerminal = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    collection._docs.find(d => d._id === idTerminal).outcome = 'dismissed';
    collection._docs.find(d => d._id === idTerminal).outcomeAt = new Date();

    // Middle: a zero-finding row — older than the row recorded next, so it
    // is never the newest/current row when the evicting prune runs.
    const idZero = TaskDecisionsStore.buildId(ISSUE_ID, HASH_B);
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B, decision: null });

    // Newest: a decision-bearing unanswered row. Its own write pushes the
    // task to 3 rows against maxPerTask: 2 — bucket 1 (zero-finding) must
    // absorb the eviction ahead of bucket 2 (terminal), even though the
    // terminal row is chronologically older than the zero-finding one.
    await capped.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: 'h3'.padEnd(64, '0'),
      decision: sampleDecision({ decision_id: 'scan_11111111_h3' })
    });

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    const ids = rows.map(r => r._id);
    assert.ok(ids.includes(idTerminal), 'the terminal row is not evicted while a zero-finding row remains');
    assert.ok(!ids.includes(idZero), 'the zero-finding row is evicted ahead of the terminal row');
  });

  // LIN-2230 review fix: recordScan's own freshly-written zero-finding row
  // must never be a candidate for the eviction its own upsert triggers —
  // otherwise "scan found nothing" is unrecordable at capacity, and
  // getStatus falls back to an older row, permanently pinning the task
  // 'stale' (docs/escalation-philosophy.md's false-escalation failure).
  // Reachability condition (per the ticket): count(terminal) +
  // count(decision-bearing unanswered) >= maxPerTask, with docs.length
  // already > maxPerTask before the write below.
  test('recordScan never evicts the zero-finding row it just wrote, even at capacity (LIN-2230)', async () => {
    const capped = new TaskDecisionsStore({ collection, maxPerTask: 2 });
    // Fill the cap with decision-bearing unanswered rows (the production
    // steady state LIN-2230 identifies as reachable at the real cap of 50).
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    await capped.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B,
      decision: sampleDecision({ decision_id: 'scan_11111111_bbbbbbbbbbbb' })
    });

    // One ordinary scan finds nothing — this is the row under test.
    const zeroHash = 'zerofinding0'.padEnd(64, '0');
    const zero = await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: zeroHash, decision: null });

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    const ids = rows.map(r => r._id);
    assert.ok(ids.includes(zero.id), 'the just-written zero-finding row must persist, not be pruned by its own recordScan');

    // getStatus at the exact current hash still finds it — the scan panel
    // reports fresh, not a stale fallback to an older ruling.
    const status = await capped.getStatus(URL_KEY, ISSUE_ID, zeroHash);
    assert.equal(status.id, zero.id);
    assert.equal(status.inputHash, zeroHash);
    assert.equal(status.decision, null);
  });

  test('terminal rows evict oldest-first once zero-finding rows are exhausted', async () => {
    const capped = new TaskDecisionsStore({ collection, maxPerTask: 2 });
    // Two terminal rows, oldest first — both fit under the cap so neither
    // is evicted by virtue of position, only by bucket priority later.
    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const idOldTerminal = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    collection._docs.find(d => d._id === idOldTerminal).outcome = 'dismissed';
    collection._docs.find(d => d._id === idOldTerminal).outcomeAt = new Date();

    await capped.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_B, decision: sampleDecision({ decision_id: 'scan_11111111_hb' }) });
    const idNewTerminal = TaskDecisionsStore.buildId(ISSUE_ID, HASH_B);
    collection._docs.find(d => d._id === idNewTerminal).outcome = 'answered';
    collection._docs.find(d => d._id === idNewTerminal).outcomeAt = new Date();

    // No zero-finding rows exist, so a third row (itself exempt, being
    // decision-bearing and unanswered) pushes the count past maxPerTask: 2
    // with an empty bucket 1 — eviction falls straight to bucket 2, taking
    // the OLDER terminal row.
    await capped.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: 'h3'.padEnd(64, '0'),
      decision: sampleDecision({ decision_id: 'scan_11111111_h3' })
    });

    const rows = collection._docs.filter(d => d.urlKey === URL_KEY && d.issueId === ISSUE_ID);
    const ids = rows.map(r => r._id);
    assert.ok(!ids.includes(idOldTerminal), 'the older terminal row is evicted first');
    assert.ok(ids.includes(idNewTerminal), 'the newer terminal row survives');
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

// LIN-2226 (folded in from LIN-2223): line-for-line mirror of
// TaskSnapshotStore.clear's own test (tests/unit/task-snapshot-store.test.js,
// "clear removes a workspace history") — the method itself is a mirror of
// TaskSnapshotStore.clear (same guard, same deleteMany({urlKey}), same
// log-and-return-0), so its test should be too.
describe('TaskDecisionsStore.clear', () => {
  test('clear removes a workspace\'s scan rows', async () => {
    const collection = createMockCollection();
    const store = new TaskDecisionsStore({ collection });
    await store.recordScan({ urlKey: 'ws', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const removed = await store.clear('ws');
    assert.equal(removed, 1);
    assert.equal(await store.getStatus('ws', ISSUE_ID), null);
  });

  test('an unconfigured store or missing urlKey degrades to 0, never throws', async () => {
    const unconfigured = new TaskDecisionsStore({});
    assert.equal(await unconfigured.clear('ws'), 0);
    const collection = createMockCollection();
    const store = new TaskDecisionsStore({ collection });
    assert.equal(await store.clear(undefined), 0);
  });
});

// LIN-2270: the verification counterpart to clear — a `clear` call that
// silently targets the wrong urlKey leaves `getStatus` still returning null
// for THAT workspace's own issues (there are none there), so it never
// surfaced clear's real bug. `count` reads back every row for a urlKey
// regardless of outcome, which is what a caller needs to prove a clear
// actually emptied the store rather than assuming it.
describe('TaskDecisionsStore.count (LIN-2270)', () => {
  test('counts every row for a urlKey, including outcome-stamped ones, and ignores other workspaces', async () => {
    const collection = createMockCollection();
    const store = new TaskDecisionsStore({ collection });
    const a = await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    await store.markOutcome({ urlKey: 'ws-a', issueId: ISSUE_ID, id: a.id, outcome: 'answered' });
    await store.recordScan({ urlKey: 'ws-a', issueId: '99999999-8888-7777-6666-555555555555', inputHash: HASH_A, decision: sampleDecision() });
    await store.recordScan({ urlKey: 'ws-b', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });

    assert.equal(await store.count('ws-a'), 2);
    assert.equal(await store.count('ws-b'), 1);
    assert.equal(await store.count('ws-nonexistent'), 0);
  });

  test('a clear that targets the wrong urlKey leaves count non-zero for the real one — the exact LIN-2270 bug shape', async () => {
    const collection = createMockCollection();
    const store = new TaskDecisionsStore({ collection });
    await store.recordScan({ urlKey: 'local-workspace-w0', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });

    // The pre-fix hook cleared this key instead of the one fixtures actually write to.
    await store.clear('test-workspace-w0');
    assert.equal(await store.count('local-workspace-w0'), 1, 'clearing the wrong key must not remove the real residue');

    // The fix: clear the key fixtures actually use.
    await store.clear('local-workspace-w0');
    assert.equal(await store.count('local-workspace-w0'), 0);
  });

  test('an unconfigured store or missing urlKey degrades to 0, never throws', async () => {
    const unconfigured = new TaskDecisionsStore({});
    assert.equal(await unconfigured.count('ws'), 0);
    const collection = createMockCollection();
    const store = new TaskDecisionsStore({ collection });
    assert.equal(await store.count(undefined), 0);
  });
});

describe('TaskDecisionsStore.listUnansweredForWorkspaces (LIN-2215)', () => {
  let collection, store;
  const ISSUE_ID_2 = '22222222-3333-4444-5555-666666666666';
  const ISSUE_ID_3 = '33333333-4444-5555-6666-777777777777';

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('an empty workspace set returns an empty list without touching the collection', async () => {
    assert.deepEqual(await store.listUnansweredForWorkspaces([]), []);
    assert.deepEqual(await store.listUnansweredForWorkspaces(), []);
  });

  test('spans multiple workspaces, decision-bearing and unanswered rows only', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    await store.recordScan({ urlKey: 'ws-b', issueId: ISSUE_ID_2, inputHash: HASH_A, decision: sampleDecision({ decision_id: 'scan_22222222_aaaaaaaaaaaa' }) });
    // A third workspace, not in the requested set — must not appear.
    await store.recordScan({ urlKey: 'ws-c', issueId: ISSUE_ID_3, inputHash: HASH_A, decision: sampleDecision({ decision_id: 'scan_33333333_aaaaaaaaaaaa' }) });

    const rows = await store.listUnansweredForWorkspaces(['ws-a', 'ws-b']);
    assert.equal(rows.length, 2);
    assert.deepEqual(new Set(rows.map(r => r.urlKey)), new Set(['ws-a', 'ws-b']));
  });

  test('excludes a row already stamped answered or dismissed', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const idA = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    await store.markOutcome({ urlKey: 'ws-a', issueId: ISSUE_ID, id: idA, outcome: 'answered' });

    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID_2, inputHash: HASH_A, decision: sampleDecision({ decision_id: 'scan_22222222_aaaaaaaaaaaa' }) });
    const idB = TaskDecisionsStore.buildId(ISSUE_ID_2, HASH_A);
    await store.markOutcome({ urlKey: 'ws-a', issueId: ISSUE_ID_2, id: idB, outcome: 'dismissed' });

    // A third, still-unanswered row must be the only one returned.
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID_3, inputHash: HASH_A, decision: sampleDecision({ decision_id: 'scan_33333333_aaaaaaaaaaaa' }) });

    const rows = await store.listUnansweredForWorkspaces(['ws-a']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].issueId, ISSUE_ID_3);
  });

  test('excludes a persisted zero-finding row (decision: null) — nothing to rule on', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: null });
    const rows = await store.listUnansweredForWorkspaces(['ws-a']);
    assert.deepEqual(rows, []);
  });

  test('does NOT dedup to latest-per-issue — multiple rescans of the same issue all come back (the predicate owns that reduction)', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision({ question: 'first scan' }) });
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_B, decision: sampleDecision({ decision_id: 'scan_11111111_bbbbbbbbbbbb', question: 'second scan, new content' }) });

    const rows = await store.listUnansweredForWorkspaces(['ws-a']);
    assert.equal(rows.length, 2, 'both rows for the same (urlKey, issueId) are returned raw — dedup is the predicate\'s job, not the store\'s');
    assert.deepEqual(new Set(rows.map(r => r.decision.question)), new Set(['first scan', 'second scan, new content']));
  });

  test('an unconfigured store (no collection) degrades to an empty list', async () => {
    const unconfigured = new TaskDecisionsStore({});
    assert.deepEqual(await unconfigured.listUnansweredForWorkspaces(['ws-a']), []);
  });
});

// LIN-1736: the task-bound half of the escalation KPIs' time-to-response and
// false-escalation inputs.
describe('TaskDecisionsStore.listResolvedForWorkspaces (LIN-1736)', () => {
  let collection, store;
  const ISSUE_ID_2 = '22222222-3333-4444-5555-666666666666';

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('an empty workspace set returns an empty list without touching the collection', async () => {
    assert.deepEqual(await store.listResolvedForWorkspaces([], 0), []);
    assert.deepEqual(await store.listResolvedForWorkspaces(undefined, 0), []);
  });

  test('spans multiple workspaces, resolved rows only — excludes unanswered and zero-finding rows', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const idA = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    await store.markOutcome({ urlKey: 'ws-a', issueId: ISSUE_ID, id: idA, outcome: 'answered' });

    // Still-unanswered — must not appear.
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID_2, inputHash: HASH_A, decision: sampleDecision({ decision_id: 'scan_22222222_aaaaaaaaaaaa' }) });
    // Zero-finding — must not appear.
    await store.recordScan({ urlKey: 'ws-b', issueId: ISSUE_ID, inputHash: HASH_B, decision: null });

    const rows = await store.listResolvedForWorkspaces(['ws-a', 'ws-b'], 0);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'answered');
  });

  test('excludes rows outside the requested workspace set', async () => {
    await store.recordScan({ urlKey: 'ws-c', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    await store.markOutcome({ urlKey: 'ws-c', issueId: ISSUE_ID, id, outcome: 'dismissed' });

    assert.deepEqual(await store.listResolvedForWorkspaces(['ws-a'], 0), []);
  });

  test('sinceMs filters by outcomeAt — an older resolution is excluded', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    await store.markOutcome({ urlKey: 'ws-a', issueId: ISSUE_ID, id, outcome: 'answered' });

    // Directly control outcomeAt (markOutcome stamps `new Date()` internally,
    // not clock-injectable) — mirrors this test file's own direct-doc-poke
    // convention elsewhere for timing-sensitive setup.
    const doc = collection._docs.find(d => d._id === id);
    doc.outcomeAt = new Date('2026-01-01T00:00:00.000Z');

    const cutoff = new Date('2026-06-01T00:00:00.000Z').getTime();
    assert.deepEqual(await store.listResolvedForWorkspaces(['ws-a'], cutoff), []);
    assert.equal((await store.listResolvedForWorkspaces(['ws-a'], 0)).length, 1);
  });

  test('an unconfigured store (no collection) degrades to an empty list', async () => {
    const unconfigured = new TaskDecisionsStore({});
    assert.deepEqual(await unconfigured.listResolvedForWorkspaces(['ws-a'], 0), []);
  });
});

describe('TaskDecisionsStore basisHash (LIN-2241 tier 1)', () => {
  let collection, store;
  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('a supplied basisHash and basisVersion round-trip through recordScan and getStatus', async () => {
    await store.recordScan({
      urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A,
      basisHash: 'basis-abc', basisVersion: 7, decision: sampleDecision()
    });
    const status = await store.getStatus('ws-a', ISSUE_ID, HASH_A);
    assert.equal(status.basisHash, 'basis-abc');
    assert.equal(status.basisVersion, 7);
  });

  test('an omitted basisVersion persists as null, not 0', async () => {
    // 0 would be a legal BASIS_VERSION, so coercing "absent" into it would
    // make an unversioned row claim a version it never had. `null` is refused
    // by the comparability gate in lib/scan-fingerprint.js exactly as an
    // unrecognised version is; 0 would not be.
    await store.recordScan({
      urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A,
      basisHash: 'basis-abc', decision: sampleDecision()
    });
    const status = await store.getStatus('ws-a', ISSUE_ID, HASH_A);
    assert.equal(status.basisVersion, null);
  });

  test('an omitted basisHash persists as null — UNKNOWN, never a stand-in value', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    const status = await store.getStatus('ws-a', ISSUE_ID, HASH_A);
    assert.equal(status.basisHash, null);
  });

  test('a legacy row with no basisHash field at all reads as null, not undefined', async () => {
    // The real migration case: rows written before this field existed. The
    // rulings feed reads the tri-state strictly, so `undefined` leaking out
    // here would be a contract break.
    collection._docs.push({
      _id: TaskDecisionsStore.buildId(ISSUE_ID, HASH_A),
      urlKey: 'ws-a', issueId: ISSUE_ID, issueIdentifier: 'LIN-1',
      inputHash: HASH_A, decision: sampleDecision(), scannedAt: new Date(), seq: 0,
      outcome: null, outcomeAt: null
    });
    const status = await store.getStatus('ws-a', ISSUE_ID, HASH_A);
    assert.equal(status.basisHash, null);
    assert.equal(status.basisVersion, null);
  });

  test('basisHash surfaces on the bulk unanswered read the rulings feed uses', async () => {
    await store.recordScan({
      urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A,
      basisHash: 'basis-abc', decision: sampleDecision()
    });
    const rows = await store.listUnansweredForWorkspaces(['ws-a']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].basisHash, 'basis-abc');
  });

  test('the row _id still derives from inputHash alone — basisHash never touches identity', async () => {
    // Identity is load-bearing: buildId feeds both the document `_id` and, via
    // lib/scan.js, the decision's own decision_id. Two scans of the same
    // content must collide on one row even if the basis digest differs.
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, basisHash: 'basis-1', decision: sampleDecision() });
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, basisHash: 'basis-2', decision: sampleDecision() });
    assert.equal(collection._docs.filter(d => d.urlKey === 'ws-a').length, 1);
    assert.equal(collection._docs[0]._id, TaskDecisionsStore.buildId(ISSUE_ID, HASH_A));
  });
});

describe('TaskDecisionsStore recordScan — dueBasisHash (LIN-2649 WS2)', () => {
  let collection, store;
  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('a supplied dueBasisHash round-trips through recordScan and getStatus, alongside the unaffected basisHash', async () => {
    await store.recordScan({
      urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A,
      basisHash: 'basis-abc', basisVersion: 7, dueBasisHash: 'due-abc', decision: sampleDecision()
    });
    const status = await store.getStatus('ws-a', ISSUE_ID, HASH_A);
    assert.equal(status.dueBasisHash, 'due-abc');
    assert.equal(status.basisHash, 'basis-abc');
    assert.equal(status.basisVersion, 7);
  });

  test('an omitted dueBasisHash persists as null — UNKNOWN, never a stand-in value; no other recordScan caller changes', async () => {
    await store.recordScan({ urlKey: 'ws-a', issueId: ISSUE_ID, inputHash: HASH_A, basisHash: 'basis-abc', decision: sampleDecision() });
    const status = await store.getStatus('ws-a', ISSUE_ID, HASH_A);
    assert.equal(status.dueBasisHash, null);
    assert.equal(status.basisHash, 'basis-abc'); // unaffected — backward-compatible
  });

  test('a legacy row with no dueBasisHash field at all reads as null, not undefined', async () => {
    collection._docs.push({
      _id: TaskDecisionsStore.buildId(ISSUE_ID, HASH_A),
      urlKey: 'ws-a', issueId: ISSUE_ID, issueIdentifier: 'LIN-1',
      inputHash: HASH_A, decision: sampleDecision(), scannedAt: new Date(), seq: 0,
      outcome: null, outcomeAt: null
    });
    const status = await store.getStatus('ws-a', ISSUE_ID, HASH_A);
    assert.equal(status.dueBasisHash, null);
  });
});

describe('TaskDecisionsStore recordScan — [F-2] terminal-row due-basis patch (LIN-2649 WS2)', () => {
  let collection, store;
  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  async function terminalRow({ dueBasisHash = null } = {}) {
    await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A,
      basisHash: 'basis-frozen', basisVersion: 5, dueBasisHash, decision: sampleDecision()
    });
    const id = TaskDecisionsStore.buildId(ISSUE_ID, HASH_A);
    const stamped = await store.markOutcome({ urlKey: URL_KEY, issueId: ISSUE_ID, id, outcome: 'dismissed' });
    return { id, stamped };
  }

  test('scanning a terminal row with unchanged content patches dueBasisHash/basisVersion and leaves outcome/outcomeAt/decision/basisHash byte-identical', async () => {
    const { stamped } = await terminalRow({ dueBasisHash: null });

    const patched = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A,
      basisHash: 'basis-DIFFERENT-should-be-ignored', basisVersion: 99,
      dueBasisHash: 'due-fresh', decision: sampleDecision({ question: 'a different question, also ignored' })
    });

    // Changed: exactly dueBasisHash + basisVersion.
    assert.equal(patched.dueBasisHash, 'due-fresh');
    assert.equal(patched.basisVersion, 99);

    // Preserved byte-identical: outcome/outcomeAt/decision/basisHash — the
    // terminal-row invariant holds by field list, not by convention.
    assert.equal(patched.outcome, stamped.outcome);
    assert.equal(patched.outcomeAt, stamped.outcomeAt);
    assert.deepEqual(patched.decision, stamped.decision);
    assert.equal(patched.basisHash, stamped.basisHash);
    assert.equal(patched.basisHash, 'basis-frozen'); // never the "DIFFERENT" value passed in

    // The $set field list on the underlying write was exactly {dueBasisHash, basisVersion}.
    const doc = collection._docs.find(d => d._id === TaskDecisionsStore.buildId(ISSUE_ID, HASH_A));
    assert.equal(doc.outcome, 'dismissed');
    assert.equal(doc.decision.question, sampleDecision().question);
    assert.equal(doc.basisHash, 'basis-frozen');

    // Confirmed via getStatus too — not just the return value.
    const status = await store.getStatus(URL_KEY, ISSUE_ID, HASH_A);
    assert.equal(status.dueBasisHash, 'due-fresh');
    assert.equal(status.basisVersion, 99);
    assert.equal(status.outcome, 'dismissed');
  });

  test('re-scanning a terminal row with the SAME dueBasisHash is a no-op — no spurious write', async () => {
    const { stamped } = await terminalRow({ dueBasisHash: 'due-same' });

    const result = await store.recordScan({
      urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A,
      dueBasisHash: 'due-same', decision: sampleDecision()
    });
    assert.equal(result.dueBasisHash, 'due-same');
    assert.equal(result.basisVersion, stamped.basisVersion); // untouched, not overwritten with undefined/null
  });

  test('re-scanning a terminal row with NO dueBasisHash supplied leaves the stored one untouched', async () => {
    await terminalRow({ dueBasisHash: 'due-existing' });

    const result = await store.recordScan({ urlKey: URL_KEY, issueId: ISSUE_ID, inputHash: HASH_A, decision: sampleDecision() });
    assert.equal(result.dueBasisHash, 'due-existing');
  });
});

describe('TaskDecisionsStore.listCandidatesForWorkspace (LIN-2649 WS2)', () => {
  let collection, store;
  const ID_A = '11111111-1111-1111-1111-111111111111';
  const ID_B = '22222222-2222-2222-2222-222222222222';
  const ID_C = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskDecisionsStore({ collection });
  });

  test('due list only contains issueIds with a prior row — never-scanned C is absent by construction', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ID_A, inputHash: HASH_A, decision: sampleDecision() });
    await store.recordScan({ urlKey: URL_KEY, issueId: ID_B, inputHash: HASH_A, decision: sampleDecision() });
    // ID_C is deliberately never scanned.

    const page = await store.listCandidatesForWorkspace(URL_KEY, {});
    const issueIds = page.items.map(r => r.issueId).sort();
    assert.deepEqual(issueIds, [ID_A, ID_B].sort());
    assert.ok(!issueIds.includes(ID_C));
    assert.equal(page.totalCandidateCount, 2);
  });

  test('only the latest row per issueId is returned when a task has multiple scan rows', async () => {
    await store.recordScan({ urlKey: URL_KEY, issueId: ID_A, inputHash: HASH_A, dueBasisHash: 'old', decision: sampleDecision() });
    await store.recordScan({ urlKey: URL_KEY, issueId: ID_A, inputHash: HASH_B, dueBasisHash: 'new', decision: sampleDecision() });

    const page = await store.listCandidatesForWorkspace(URL_KEY, {});
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].dueBasisHash, 'new');
    assert.equal(page.totalCandidateCount, 1);
  });

  test('a workspace with no scanned tasks returns an empty page, not an error', async () => {
    const page = await store.listCandidatesForWorkspace(URL_KEY, {});
    assert.deepEqual(page.items, []);
    assert.equal(page.nextCursor, null);
    assert.equal(page.totalCandidateCount, 0);
  });

  test('pagination: nextCursor/hasMore across a page boundary, no overlap, no gap, and totalCandidateCount counts the whole population', async () => {
    // Three distinct-issueId rows, each with a distinct scannedAt so ordering
    // is deterministic without relying on real-clock timing.
    collection._docs.push(
      { _id: 's1', urlKey: URL_KEY, issueId: ID_A, issueIdentifier: 'LIN-1', inputHash: HASH_A, decision: sampleDecision(), scannedAt: new Date('2026-01-01T00:00:00.000Z'), seq: 0, outcome: null, outcomeAt: null },
      { _id: 's2', urlKey: URL_KEY, issueId: ID_B, issueIdentifier: 'LIN-2', inputHash: HASH_A, decision: sampleDecision(), scannedAt: new Date('2026-01-02T00:00:00.000Z'), seq: 0, outcome: null, outcomeAt: null },
      { _id: 's3', urlKey: URL_KEY, issueId: ID_C, issueIdentifier: 'LIN-3', inputHash: HASH_A, decision: sampleDecision(), scannedAt: new Date('2026-01-03T00:00:00.000Z'), seq: 0, outcome: null, outcomeAt: null }
    );

    const page1 = await store.listCandidatesForWorkspace(URL_KEY, { limit: 2 });
    assert.deepEqual(page1.items.map(r => r.issueId), [ID_A, ID_B]);
    assert.ok(page1.nextCursor);
    assert.equal(page1.totalCandidateCount, 3);

    const page2 = await store.listCandidatesForWorkspace(URL_KEY, { limit: 2, cursor: page1.nextCursor });
    assert.deepEqual(page2.items.map(r => r.issueId), [ID_C]);
    assert.equal(page2.nextCursor, null); // last page
    assert.equal(page2.totalCandidateCount, 3);

    // No overlap, no gap across the two pages.
    const allIssueIds = [...page1.items, ...page2.items].map(r => r.issueId);
    assert.deepEqual(allIssueIds, [ID_A, ID_B, ID_C]);
  });

  test('ordering is (scannedAt asc, issueId asc)', async () => {
    collection._docs.push(
      { _id: 's1', urlKey: URL_KEY, issueId: ID_C, issueIdentifier: 'LIN-3', inputHash: HASH_A, decision: sampleDecision(), scannedAt: new Date('2026-01-01T00:00:00.000Z'), seq: 0, outcome: null, outcomeAt: null },
      { _id: 's2', urlKey: URL_KEY, issueId: ID_A, issueIdentifier: 'LIN-1', inputHash: HASH_A, decision: sampleDecision(), scannedAt: new Date('2026-01-01T00:00:00.000Z'), seq: 0, outcome: null, outcomeAt: null }
    );
    // Same scannedAt — tie-break is issueId ascending.
    const page = await store.listCandidatesForWorkspace(URL_KEY, {});
    assert.deepEqual(page.items.map(r => r.issueId), [ID_A, ID_C]);
  });

  test('a different workspace\'s rows never appear', async () => {
    await store.recordScan({ urlKey: 'other-ws', issueId: ID_A, inputHash: HASH_A, decision: sampleDecision() });
    const page = await store.listCandidatesForWorkspace(URL_KEY, {});
    assert.deepEqual(page.items, []);
  });
});
