/**
 * [F-5] WS1 ledger -> WS2 due-basis round-trip (LIN-2649 WS2, LIN-2665 beat 4).
 *
 * Discharges WS1 close-out ledger item 4: prior coverage of
 * `HarbourCommentsStore` and `dueBasisFromContext`/`dueBasisHashFromContext`
 * each exercised their own module in isolation — no test proved the ledger's
 * `wereRecordedByHarbour` output actually answers the question WS2's
 * `dueBasisHash` filter asks of it. This file wires the REAL store (over the
 * same hand-rolled in-memory Mango collection shape
 * tests/unit/harbour-comments-store.test.js uses — no fake, no stub, no
 * literal `Set` built by hand) through to the real fingerprint functions, end
 * to end, exercising WS1's already-landed `_id`-based lookup (LIN-2664, `main`
 * at `da180162`) rather than the pre-fix field-filter query shape.
 *
 * Run with: node --test tests/unit/harbour-comment-due-basis-roundtrip.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { HarbourCommentsStore } from '../../lib/harbour-comments-store.js';
import { dueBasisFromContext, dueBasisHashFromContext } from '../../lib/scan-fingerprint.js';

// Line-for-line the same hand-rolled mock collection as
// tests/unit/harbour-comments-store.test.js — deliberately not re-derived, so
// this test exercises the identical collection contract that module's own
// suite already pins.
function createMockCollection() {
  const docs = [];
  function matchesField(docValue, queryValue) {
    if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
      return queryValue.$in.includes(docValue);
    }
    return docValue === queryValue;
  }
  function matches(doc, query) {
    for (const key of Object.keys(query)) {
      if (!matchesField(doc[key], query[key])) return false;
    }
    return true;
  }
  return {
    _docs: docs,
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) {
        Object.assign(docs[idx], update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (opts.upsert) {
        docs.push({ ...(update.$set || {}), ...(update.$setOnInsert || {}) });
        return { matchedCount: 0, modifiedCount: 0, upsertedId: update.$set?._id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
  };
}

function makeContext(comments) {
  return {
    issue: {
      title: 'Scan-due surfacing',
      description: 'The queue should clear itself when the task has moved on.',
      state: { name: 'In Progress', type: 'started' }
    },
    comments,
    children: [],
    parent: null
  };
}

const URL_KEY = 'acme';
const COMMENT_X = { id: 'harbour-x', body: 'Closing this out — no action needed.', createdAt: '2026-09-05T09:00:00.000Z' };
const COMMENT_Y = { id: 'c-y', body: 'John: use option B.', createdAt: '2026-09-01T09:00:00.000Z' };

describe('WS1 ledger -> WS2 dueBasisHash round trip (LIN-2649, discharges WS1 close-out ledger item 4)', () => {
  test('the ledger filter and a literal deletion are indistinguishable to dueBasisHash', async () => {
    const collection = createMockCollection();
    const store = new HarbourCommentsStore({ collection });

    // Step 1: record({ urlKey, commentId: X }) for one id.
    const recorded = await store.record({ urlKey: URL_KEY, commentId: COMMENT_X.id });
    assert.ok(recorded, 'record() must succeed against a real store');

    // Step 2: wereRecordedByHarbour(urlKey, [commentX, commentY]) returns a
    // Set that is EXACTLY {X} — exact membership, not just `.has(X)`.
    const recordedCommentIds = await store.wereRecordedByHarbour(URL_KEY, [COMMENT_X, COMMENT_Y]);
    assert.deepStrictEqual(recordedCommentIds, new Set([COMMENT_X.id]));

    // Step 3: feed THAT RETURNED SET (not a hand-built one) into
    // dueBasisFromContext and assert the projection keeps Y and drops X.
    const withBoth = makeContext([COMMENT_X, COMMENT_Y]);
    const basis = dueBasisFromContext(withBoth, { recordedCommentIds });
    assert.deepStrictEqual(basis.comments.map(c => c.id), [COMMENT_Y.id]);

    // Step 4: dueBasisHashFromContext over that context EQUALS the hash of
    // the same context with X physically removed — the ledger filter and a
    // literal deletion must be indistinguishable to the digest. Assert hash
    // equality directly, not just projection equality.
    const withoutXPhysicallyRemoved = makeContext([COMMENT_Y]);
    assert.strictEqual(
      dueBasisHashFromContext(withBoth, { recordedCommentIds }),
      dueBasisHashFromContext(withoutXPhysicallyRemoved, {}),
      'the ledger-filtered hash and the physically-deleted hash must be byte-identical'
    );
  });

  test('the negative direction: with an empty ledger the returned Set is empty and X is included — fail-open', async () => {
    const collection = createMockCollection();
    const store = new HarbourCommentsStore({ collection });
    // Deliberately never call record() — this workspace's ledger is empty.

    // Step 5: with an EMPTY ledger the Set is empty, and X is INCLUDED in the
    // due-basis (nothing filtered) — the fail-open direction: an absent/empty
    // ledger can only ever make dueBasisHash read as MORE due, never less.
    const recordedCommentIds = await store.wereRecordedByHarbour(URL_KEY, [COMMENT_X, COMMENT_Y]);
    assert.deepStrictEqual(recordedCommentIds, new Set());

    const withBoth = makeContext([COMMENT_X, COMMENT_Y]);
    const basis = dueBasisFromContext(withBoth, { recordedCommentIds });
    assert.deepStrictEqual(basis.comments.map(c => c.id).sort(), [COMMENT_X.id, COMMENT_Y.id].sort());

    // And the hash therefore differs from the "X excluded" hash above —
    // fail-open changes the answer, it does not silently match it.
    const withoutX = makeContext([COMMENT_Y]);
    assert.notStrictEqual(
      dueBasisHashFromContext(withBoth, { recordedCommentIds }),
      dueBasisHashFromContext(withoutX, {})
    );
  });
});
