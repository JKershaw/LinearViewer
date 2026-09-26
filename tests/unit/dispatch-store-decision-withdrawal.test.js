/**
 * Unit tests for `'decision-withdrawn'`'s FEEDBACK_ENTRY_KINDS membership and
 * DispatchQueueStore#markDecisionWithdrawalReversed (LIN-2891/LIN-3035).
 *
 * markDecisionWithdrawalReversed is deliberately NOT addFeedback, and not a
 * copy of markDecisionAnswered either: it is the one decision-lifecycle
 * transition gated behind a pre-write TERMINAL check
 * (`_findDecisionWithdrawal`, lib/digest-feedback.js) — a never-withdrawn or
 * already-reversed `decisionId` must return `null` with NO append — plus a
 * NEW `{_id, urlKey, feedbackVersion}` CAS on the `$push` itself, because
 * (unlike addFeedback/markDecisionAnswered, which only gate ownership) this
 * write's correctness depends on the pre-check snapshot still holding at
 * write time. `'decision-withdrawal-reversed'` is kept OUT of
 * FEEDBACK_ENTRY_KINDS, exactly like `'decision-answer'`, so this store
 * method is structurally the only write path — no token can ever reach it.
 *
 * Subtask C (LIN-3036) extends this same file with the two read-side
 * adversarial cases.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore, FEEDBACK_ENTRY_KINDS } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';
import { getLoopsForWorkspace } from '../../lib/pipeline-loops.js';
import { collectUnansweredDecisions, isDecisionWithdrawn } from '../../lib/unanswered-decisions.js';
import { _findDecisionWithdrawal } from '../../lib/digest-feedback.js';

const URL_KEY = 'acme';

describe('FEEDBACK_ENTRY_KINDS membership (LIN-2891/LIN-3035)', () => {
  test('decision-withdrawn IS a member — the runner-facing sanitizer (routes/dispatch.js) must accept it', () => {
    assert.ok(FEEDBACK_ENTRY_KINDS.includes('decision-withdrawn'));
  });

  test('decision-withdrawal-reversed is NOT a member — session-auth-only, structurally like decision-answer', () => {
    assert.ok(!FEEDBACK_ENTRY_KINDS.includes('decision-withdrawal-reversed'));
  });
});

// ─── Mock-store behavior ────────────────────────────────────────────────────

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  return { store, collection, historyCollection };
}

async function withdrawnItem(store, { decisionId = 'd-1', reason = 'superseded by LIN-99' } = {}) {
  const item = await store.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42'
  });
  await store.takeItem(item._id, URL_KEY, 'token-a');
  await store.addFeedback(
    item._id,
    URL_KEY,
    { message: JSON.stringify({ decision_id: decisionId, reason }), kind: 'decision-withdrawn' },
    'token-a'
  );
  return item;
}

describe('DispatchQueueStore#markDecisionWithdrawalReversed', () => {
  test('success: appends a terminal decision-withdrawal-reversed entry and the withdrawal no longer reads as live', async () => {
    const { store, historyCollection } = makeStore();
    const item = await withdrawnItem(store, { decisionId: 'd-1' });

    const result = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd-1');
    assert.deepEqual(result, { success: true, feedbackCount: 2 });

    const stored = await historyCollection.findOne({ _id: item._id });
    const reversal = stored.feedback.find(e => e.kind === 'decision-withdrawal-reversed');
    assert.ok(reversal, 'a decision-withdrawal-reversed entry must be appended');
    assert.deepEqual(JSON.parse(reversal.message), { decision_id: 'd-1' });
    assert.equal(stored.feedbackVersion, 2, 'feedbackVersion must $inc alongside the $push, same as addFeedback/markDecisionAnswered');
    assert.equal(_findDecisionWithdrawal(stored.feedback, 'd-1'), null, 'the withdrawal must no longer read as live after reversal');
  });

  test('never-withdrawn: an unrelated decisionId returns null, no append', async () => {
    const { store, historyCollection } = makeStore();
    const item = await store.addItem(URL_KEY, { prompt: 'do the thing', kind: 'implementation', issueIdentifier: 'LIN-42' });
    await store.takeItem(item._id, URL_KEY, 'token-a');

    const result = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'never-withdrawn');
    assert.equal(result, null);

    const stored = await historyCollection.findOne({ _id: item._id });
    assert.equal((stored.feedback || []).length, 0, 'no entry must be appended for a decisionId that was never withdrawn');
  });

  // Review R2 (LIN-3035): the terminal pre-check's guard is
  // `!liveWithdrawal || liveWithdrawal.decisionId !== decisionId`. Every case
  // above only ever passes a decisionId that either matches the live
  // withdrawal or has no withdrawal at all, so a mutation that drops the
  // `.decisionId !== decisionId` comparison (leaving only `!liveWithdrawal`)
  // survives them all. This case pins the comparison itself: with 'd-1' live,
  // reversing the DIFFERENT 'd-2' must return null and append nothing — a
  // stray reversal entry for 'd-2' would permanently pre-immunise it against
  // any future withdrawal (A's reader collects reversedIds order-independently).
  test('decisionId mismatch: reversing a different decisionId than the one live-withdrawn returns null, no append', async () => {
    const { store, historyCollection } = makeStore();
    const item = await withdrawnItem(store, { decisionId: 'd-1' });

    const result = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd-2');
    assert.equal(result, null, 'reversing a decisionId other than the live-withdrawn one must return null');

    const stored = await historyCollection.findOne({ _id: item._id });
    assert.equal(
      stored.feedback.filter(e => e.kind === 'decision-withdrawal-reversed').length,
      0,
      'no reversal entry must be appended for the mismatched decisionId'
    );
    assert.equal(
      _findDecisionWithdrawal(stored.feedback, 'd-1')?.decisionId,
      'd-1',
      'the original d-1 withdrawal must still read as live'
    );
  });

  test('already-reversed: a second reversal of the same decisionId returns null, with no second entry appended', async () => {
    const { store, historyCollection } = makeStore();
    const item = await withdrawnItem(store, { decisionId: 'd-1' });

    const first = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd-1');
    assert.equal(first.success, true, 'sanity: the first reversal must succeed');

    const second = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd-1');
    assert.equal(second, null, 'reversing an already-reversed withdrawal must return null');

    const stored = await historyCollection.findOne({ _id: item._id });
    const reversals = stored.feedback.filter(e => e.kind === 'decision-withdrawal-reversed');
    assert.equal(reversals.length, 1, 'no second reversal entry must be appended');
  });

  test('wrong urlKey: returns null, no append (cross-workspace isolation)', async () => {
    const { store, historyCollection } = makeStore();
    const item = await withdrawnItem(store, { decisionId: 'd-1' });

    const result = await store.markDecisionWithdrawalReversed(item._id, 'someone-elses-workspace', 'd-1');
    assert.equal(result, null);

    const stored = await historyCollection.findOne({ _id: item._id });
    assert.equal(stored.feedback.filter(e => e.kind === 'decision-withdrawal-reversed').length, 0);
  });

  // Deterministic (non-timing-dependent) proof of the CAS guard's actual
  // job: a write that lands between the pre-check read and the $push must
  // invalidate the stale snapshot, so this call returns null rather than
  // blindly appending a reversal onto a doc that has moved on. The genuinely
  // concurrent version of this property is proven against real MongoDB below
  // (mock findOneAndUpdate calls are atomic by construction, so a real race
  // there would pass vacuously — see mongo-smoke.test.js's header for the
  // same reasoning applied to addFeedback).
  test('a write landing between the pre-check read and the CAS causes the reversal to lose the race and return null', async () => {
    const { store, historyCollection } = makeStore();
    const item = await withdrawnItem(store, { decisionId: 'd-1' });

    const originalFindOne = historyCollection.findOne.bind(historyCollection);
    let interleaved = false;
    historyCollection.findOne = async (query) => {
      const doc = await originalFindOne(query);
      if (!interleaved && query._id === item._id && !('feedbackVersion' in query)) {
        // This is markDecisionWithdrawalReversed's PRE-CHECK read (its only
        // findOne call keyed on {_id, urlKey}). Land a concurrent write here,
        // between that read and the CAS $push below, bumping feedbackVersion
        // out from under the snapshot just read.
        interleaved = true;
        await store.addFeedback(item._id, URL_KEY, { message: 'a concurrent heartbeat' }, 'token-a');
      }
      return doc;
    };

    const result = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd-1');
    assert.equal(result, null, 'a lost CAS must return null, never blindly append onto a stale snapshot');

    const stored = await originalFindOne({ _id: item._id });
    assert.equal(
      stored.feedback.filter(e => e.kind === 'decision-withdrawal-reversed').length,
      0,
      'no reversal entry must be appended when the CAS is lost'
    );
  });
});

// ─── Real-MongoDB race safety (the CAS) ────────────────────────────────────
//
// Mirrors mongo-smoke.test.js's guard exactly (LIN-1337): a mock's
// findOneAndUpdate is a single-body-per-call atomic operation by
// construction, so it cannot reproduce the interleavings a real engine can.
// This is session-fit catch #2 for LIN-3035 — the whole terminal-reversal
// property depends on this CAS actually holding under concurrent writers on
// real MongoDB, not merely on the mock.
const MONGO_URI = process.env.MONGODB_TEST_URI;
if (!MONGO_URI && process.env.CI) {
  throw new Error(
    'MONGODB_TEST_URI must be set in CI: the decision-withdrawal-reversed CAS race test must never silently skip'
  );
}

describe(
  'markDecisionWithdrawalReversed: CAS race safety (real MongoDB)',
  { skip: MONGO_URI ? false : 'MONGODB_TEST_URI not set; skipping real-Mongo race test (local dev)' },
  () => {
    let client;
    let db;
    let counter = 0;

    before(async () => {
      client = new MongoClient(MONGO_URI);
      await client.connect();
      db = client.db(`lin3035_withdrawal_${randomUUID().slice(0, 8)}`);
    });

    after(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });

    function freshStore(name) {
      return new DispatchQueueStore({
        collection: db.collection(`${name}-queue-${counter++}`),
        historyCollection: db.collection(`${name}-history-${counter++}`)
      });
    }

    test('20 concurrent reversal attempts for one live withdrawal: exactly one wins, exactly one reversal entry lands', async () => {
      const store = freshStore('race');
      const item = await store.addItem(URL_KEY, {
        prompt: 'do the thing',
        kind: 'implementation',
        issueIdentifier: 'LIN-42'
      });
      await store.takeItem(item._id, URL_KEY, 'token-a');
      await store.addFeedback(
        item._id,
        URL_KEY,
        { message: JSON.stringify({ decision_id: 'd-1', reason: 'superseded' }), kind: 'decision-withdrawn' },
        'token-a'
      );

      const N = 20;
      const results = await Promise.all(
        Array.from({ length: N }, () => store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd-1'))
      );

      const successes = results.filter((r) => r && r.success);
      assert.strictEqual(successes.length, 1, `exactly one of ${N} concurrent reversal attempts must win the CAS on real MongoDB`);

      const stored = await store.historyCollection.findOne({ _id: item._id });
      const reversals = (stored.feedback || []).filter((e) => e.kind === 'decision-withdrawal-reversed');
      assert.strictEqual(reversals.length, 1, 'exactly one reversal entry must be appended on real MongoDB, never a duplicate');
    });

    // A legacy row predates LIN-3009's feedbackVersion $inc and so has no
    // feedbackVersion field at all. The CAS filter reads
    // `{ _id, urlKey, feedbackVersion: doc.feedbackVersion }`, i.e.
    // `feedbackVersion: undefined` for such a row — this must still match
    // the absent field on real MongoDB (the driver sends `undefined` as
    // `null`, which matches "missing" with no `ignoreUndefined` set).
    test('a legacy row with no feedbackVersion field still reverses correctly on real MongoDB', async () => {
      const store = freshStore('legacy');
      const itemId = randomUUID();
      await store.historyCollection.insertOne({
        _id: itemId,
        urlKey: URL_KEY,
        status: 'taken',
        takenByTokenLabel: 'token-a',
        feedback: [
          { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd-1', reason: 'legacy row' }), timestamp: new Date() }
        ]
      });

      const result = await store.markDecisionWithdrawalReversed(itemId, URL_KEY, 'd-1');
      assert.ok(result && result.success, 'a legacy row missing feedbackVersion must still satisfy the CAS filter');

      const stored = await store.historyCollection.findOne({ _id: itemId });
      assert.strictEqual(
        stored.feedback.filter((e) => e.kind === 'decision-withdrawal-reversed').length,
        1
      );
    });
  }
);

// ─── Read-side adversarial cases (LIN-2891/LIN-3036 Surface 5) ──────────────
//
// These drive the REAL write path (DispatchQueueStore#addFeedback /
// #markDecisionWithdrawalReversed — the exact methods the route calls) and then
// read the result through the real derivation the feed uses
// (`getLoopsForWorkspace(..., {lean:true})` -> `collectUnansweredDecisions`).
//
// Both are READ-SIDE guarantees, deliberately NOT write-scope claims. A consumer
// token that has taken an item CAN write feedback onto it (the token retains
// access to every item it has ever taken, routes/dispatch.js's own docblock),
// so the guard against a forged or reversed stamp is that the read consults only
// the WITHDRAWING loop's OWN `withdrawal` field (Choice C) — never a lineage
// union, never a cross-loop lookup.
describe('read-side adversarial: item-scoped withdrawal discharge (LIN-3036)', () => {
  function decisionMessage(decisionId) {
    return `[decision] ${JSON.stringify({
      decision_id: decisionId,
      question: 'Proceed?',
      options: [{ id: 'a', label: 'Go' }, { id: 'b', label: 'Hold' }]
    })}`;
  }

  async function loopsForWorkspace(store, urlKey = URL_KEY) {
    const agentStatusStore = new AgentStatusStore({ collection: createMockCollection() });
    const loops = await getLoopsForWorkspace(urlKey, { dispatchStore: store, agentStatusStore, lean: true });
    return loops.map((l) => ({ ...l, workspaceUrlKey: urlKey }));
  }

  test('cross-loop forgery: a decision-withdrawn on item X carrying item Y\'s live decision_id does NOT discharge Y\'s row', async () => {
    const { store } = makeStore();

    // Item X raises its OWN decision d-X, then receives a decision-withdrawn
    // that names d-Y. A token that has taken X can land this entry (the write is
    // not the guard) — but it names a decision X does not carry.
    const x = await store.addItem(URL_KEY, { prompt: 'x', kind: 'implementation', issueIdentifier: 'LIN-42' });
    await store.takeItem(x._id, URL_KEY, 'token-a');
    await store.addFeedback(x._id, URL_KEY, { kind: 'decision', message: decisionMessage('d-X') }, 'token-a');
    await store.addFeedback(
      x._id, URL_KEY,
      { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd-Y', reason: 'forged onto X' }) },
      'token-a'
    );

    // Item Y carries its live decision d-Y and NO withdrawal of its own.
    const y = await store.addItem(URL_KEY, { prompt: 'y', kind: 'implementation', issueIdentifier: 'LIN-43' });
    await store.takeItem(y._id, URL_KEY, 'token-a');
    await store.addFeedback(y._id, URL_KEY, { kind: 'decision', message: decisionMessage('d-Y') }, 'token-a');

    const loops = await loopsForWorkspace(store);
    const loopX = loops.find((l) => l.loopId === String(x._id));
    const loopY = loops.find((l) => l.loopId === String(y._id));
    assert.ok(loopX && loopY, 'sanity: both items reconstruct as loops');
    assert.strictEqual(loopY.withdrawal, null, 'sanity: Y carries no withdrawal of its own');
    assert.strictEqual(
      isDecisionWithdrawn(loopX), false,
      "X's withdrawal names d-Y, not X's own d-X — the item-scoped predicate refuses it"
    );

    const rows = collectUnansweredDecisions({ loops }, { now: new Date() });
    const ids = rows.map((r) => r.decision.decision_id);
    assert.ok(ids.includes('d-Y'), "Y's row must still be unanswered — a forged stamp on X cannot discharge it");
    assert.ok(ids.includes('d-X'), "X's own d-X row is likewise untouched — the forgery discharges nothing");
  });

  test('multi-decision row (LIN-2891 F1): a later withdrawal of a moot d1 does not reopen the withdrawn current d2, and each live withdrawal reverses independently', async () => {
    const { store } = makeStore();

    // One item raises d1, then d2 (the CURRENT ruling), withdraws d2, then
    // withdraws the now-moot d1. Under the pre-F1 scalar read the last write
    // (d1) became the row's `withdrawal`, reopening d2.
    const item = await store.addItem(URL_KEY, { prompt: 'multi', kind: 'implementation', issueIdentifier: 'LIN-60' });
    await store.takeItem(item._id, URL_KEY, 'token-a');
    await store.addFeedback(item._id, URL_KEY, { kind: 'decision', message: decisionMessage('d1') }, 'token-a');
    await store.addFeedback(item._id, URL_KEY, { kind: 'decision', message: decisionMessage('d2') }, 'token-a');
    await store.addFeedback(item._id, URL_KEY, { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd2', reason: 'd2 retracted' }) }, 'token-a');
    await store.addFeedback(item._id, URL_KEY, { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd1', reason: 'd1 moot, retracted later' }) }, 'token-a');

    let loops = await loopsForWorkspace(store);
    const loop = () => loops.find((l) => l.loopId === String(item._id));
    assert.strictEqual(loop()?.decision?.decision_id, 'd2', 'sanity: the current decision is d2');
    assert.strictEqual(loop()?.withdrawal?.decisionId, 'd2', 'the row\'s withdrawal names the current d2, never the later moot d1');
    assert.strictEqual(isDecisionWithdrawn(loop()), true, 'the current d2 stays withdrawn — the moot d1 withdrawal must not reopen it');
    assert.deepStrictEqual(
      collectUnansweredDecisions({ loops }, { now: new Date() }),
      [],
      'd2 is discharged, so the row is not unanswered'
    );
    const resolved = collectUnansweredDecisions({ loops }, { now: new Date(), includeResolved: true });
    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].resolution.outcome, 'withdrawn');
    assert.strictEqual(resolved[0].resolution.reason, 'd2 retracted', 'the surfaced reason is d2\'s, not the moot d1\'s');

    // Reversal of the CURRENT live withdrawal (d2) succeeds and reopens the row.
    const reversedD2 = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd2');
    assert.ok(reversedD2?.success, 'the current live withdrawal (d2) must be reversible');
    loops = await loopsForWorkspace(store);
    assert.strictEqual(isDecisionWithdrawn(loop()), false, 'reversing d2 reopens the row');
    const rows = collectUnansweredDecisions({ loops }, { now: new Date() });
    assert.strictEqual(rows.length, 1, 'd2 is open again after reversal');
    assert.strictEqual(rows[0].decision.decision_id, 'd2');

    // The moot d1 withdrawal is ALSO still independently reversible (its own pair),
    // even though it was never the row's current decision — LIN-3035 ledger L6.
    const reversedD1 = await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd1');
    assert.ok(reversedD1?.success, 'the moot d1 withdrawal is still live and independently reversible');
    assert.strictEqual(await store.markDecisionWithdrawalReversed(item._id, URL_KEY, 'd1'), null, 'a second reversal of d1 is terminal-rejected');
  });

  test('sibling after reversal: a reversed withdrawal on loop A does not block a fresh, independently-reasoned withdrawal on loop B for the same decision id; A\'s own pair stays discharged-false forever', async () => {
    const { store } = makeStore();

    // Loop A raises d-1, withdraws it, then the withdrawal is REVERSED. The
    // reversal is terminal for the pair (A, d-1).
    const a = await store.addItem(URL_KEY, { prompt: 'a', kind: 'implementation', issueIdentifier: 'LIN-50' });
    await store.takeItem(a._id, URL_KEY, 'token-a');
    await store.addFeedback(a._id, URL_KEY, { kind: 'decision', message: decisionMessage('d-1') }, 'token-a');
    await store.addFeedback(
      a._id, URL_KEY,
      { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd-1', reason: 'A retracted it' }) },
      'token-a'
    );
    const reversedA = await store.markDecisionWithdrawalReversed(a._id, URL_KEY, 'd-1');
    assert.ok(reversedA?.success, "sanity: A's withdrawal is reversed");

    // Loop B is a later re-raise in the SAME lineage carrying d-1 again, with a
    // FRESH, independently-reasoned withdrawal. A's reversal must not immunise B.
    const b = await store.addItem(URL_KEY, { prompt: 'b', kind: 'implementation', issueIdentifier: 'LIN-50', rootItemId: a._id });
    await store.takeItem(b._id, URL_KEY, 'token-a');
    await store.addFeedback(b._id, URL_KEY, { kind: 'decision', message: decisionMessage('d-1') }, 'token-a');
    await store.addFeedback(
      b._id, URL_KEY,
      { kind: 'decision-withdrawn', message: JSON.stringify({ decision_id: 'd-1', reason: 'B retracted it independently' }) },
      'token-a'
    );

    // Pin the dispatch order explicitly: `addItem` stamps `dispatchedAt` at
    // creation, but A and B can land in the SAME millisecond, and the
    // content-loop tie-break is by `loopId` (a random UUID) — so without this
    // the group's content loop would be nondeterministic and this test flaky.
    // B must be the later-dispatched, content-loop member.
    await store.historyCollection.updateOne({ _id: a._id }, { $set: { dispatchedAt: new Date(Date.now() - 120000) } });
    await store.historyCollection.updateOne({ _id: b._id }, { $set: { dispatchedAt: new Date(Date.now() - 60000) } });

    let loops = await loopsForWorkspace(store);
    const loopA = () => loops.find((l) => l.loopId === String(a._id));
    const loopB = () => loops.find((l) => l.loopId === String(b._id));
    assert.ok(loopA() && loopB(), 'sanity: both lineage members reconstruct');
    assert.strictEqual(isDecisionWithdrawn(loopA()), false, "A's reversed pair reads discharged-false");
    assert.strictEqual(isDecisionWithdrawn(loopB()), true, "B's fresh withdrawal is live, independent of A's reversal");

    assert.deepStrictEqual(
      collectUnansweredDecisions({ loops }, { now: new Date() }),
      [],
      'the group discharges via B\'s live withdrawal — A\'s reversal does not block it'
    );
    const resolved = collectUnansweredDecisions({ loops }, { now: new Date(), includeResolved: true });
    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].resolution.outcome, 'withdrawn');
    assert.strictEqual(
      resolved[0].resolution.reason, 'B retracted it independently',
      "the surfaced resolution is B's own independently-reasoned withdrawal, never A's reversed one"
    );

    // Reverse B too: the row re-opens, and A still reads discharged-false —
    // its reversal is terminal and untouched by anything on B.
    const reversedB = await store.markDecisionWithdrawalReversed(b._id, URL_KEY, 'd-1');
    assert.ok(reversedB?.success, "sanity: B's withdrawal is reversible independently");
    loops = await loopsForWorkspace(store);
    assert.strictEqual(isDecisionWithdrawn(loopA()), false, "A's own pair stays discharged-false forever");
    const rows = collectUnansweredDecisions({ loops }, { now: new Date() });
    assert.strictEqual(rows.length, 1, 'with both withdrawals reversed, d-1 is open again');
    assert.strictEqual(rows[0].decision.decision_id, 'd-1');
  });
});
