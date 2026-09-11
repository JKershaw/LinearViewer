/**
 * Unit tests for lib/dismissal-suggestions-store.js (LIN-2444)
 *
 * The load-bearing property is what this store does NOT do: a suggestion is a
 * view annotation, so nothing here may look like an answer. John's ruling is
 * that an agent may recommend a dismissal and never perform one, and the
 * structural guarantee behind that (LIN-1728: `decision-answer` is absent from
 * `FEEDBACK_ENTRY_KINDS`) is not this store's to weaken.
 *
 * Run with: node --test tests/unit/dismissal-suggestions-store.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { DismissalSuggestionsStore, attachStandingSuggestions } from '../../lib/dismissal-suggestions-store.js';

// Mirrors tests/unit/shelved-rulings-store.test.js's mock.
function createMockCollection() {
  const docs = [];
  function matchesField(docValue, queryValue) {
    if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
      return queryValue.$in.includes(docValue);
    }
    return docValue === queryValue;
  }
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && !matchesField(doc.urlKey, query.urlKey)) return false;
    return true;
  }
  return {
    _docs: docs,
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) {
        Object.assign(docs[idx], update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (opts.upsert) {
        docs.push({ ...(update.$set || {}) });
        return { matchedCount: 0, modifiedCount: 0, upsertedId: update.$set?._id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
  };
}

const NOW = new Date('2026-09-05T12:00:00.000Z');
const LATER = new Date('2026-09-05T13:00:00.000Z');

function makeStore() {
  const collection = createMockCollection();
  return { collection, store: new DismissalSuggestionsStore({ collection }) };
}

describe('DismissalSuggestionsStore.suggest', () => {
  let collection, store;
  beforeEach(() => { ({ collection, store } = makeStore()); });

  test('records a proposal keyed on (urlKey, decisionId)', async () => {
    const rec = await store.suggest({
      urlKey: 'acme', decisionId: 'd-1', reason: 'the task shipped', suggestedBy: 'lane-e', now: NOW
    });
    assert.equal(rec.urlKey, 'acme');
    assert.equal(rec.decisionId, 'd-1');
    assert.equal(rec.reason, 'the task shipped');
    assert.equal(rec.suggestedBy, 'lane-e');
    assert.equal(rec.withdrawn, false);
    assert.equal(rec.withdrawnAt, null);
    assert.equal(collection._docs.length, 1);
    assert.equal(collection._docs[0]._id, 'acme::d-1');
  });

  test('a reason is REQUIRED — an unexplained proposal is refused', async () => {
    // Same rule shelving already enforces (docs/escalation-philosophy.md §6):
    // a disposition nobody justified is one the operator cannot evaluate, so
    // agreeing to it would be a rubber stamp rather than a decision.
    for (const reason of [undefined, null, '', '   ', 42]) {
      assert.equal(await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason, suggestedBy: 'lane-e' }), null);
    }
    assert.equal(collection._docs.length, 0, 'nothing is written on a refused proposal');
  });

  test('attribution is REQUIRED — an anonymous proposal is refused', async () => {
    for (const suggestedBy of [undefined, null, '', '   ', 7]) {
      assert.equal(await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'done', suggestedBy }), null);
    }
    assert.equal(collection._docs.length, 0);
  });

  test('reason and attribution are trimmed', async () => {
    const rec = await store.suggest({
      urlKey: 'acme', decisionId: 'd-1', reason: '  spaced  ', suggestedBy: '  lane-e  ', now: NOW
    });
    assert.equal(rec.reason, 'spaced');
    assert.equal(rec.suggestedBy, 'lane-e');
  });

  test('re-suggesting overwrites in place rather than accumulating rows', async () => {
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'first', suggestedBy: 'a', now: NOW });
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'second', suggestedBy: 'b', now: LATER });
    assert.equal(collection._docs.length, 1);
    assert.equal(collection._docs[0].reason, 'second');
    assert.equal(collection._docs[0].suggestedBy, 'b');
  });

  test('a fresh proposal CLEARS a prior withdrawal', async () => {
    // A new argument with a new reason must reach the operator. Leaving it
    // suppressed because they once pressed Keep would silently swallow it.
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'first', suggestedBy: 'a', now: NOW });
    await store.withdraw({ urlKey: 'acme', decisionId: 'd-1', now: NOW });
    const again = await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'new evidence', suggestedBy: 'a', now: LATER });
    assert.equal(again.withdrawn, false);
    assert.equal(again.withdrawnAt, null);
  });

  test('two workspaces sharing a decisionId do not collide', async () => {
    // decisionId is agent-invented free text and is not globally unique — the
    // same composite-key reasoning lib/shelved-rulings-store.js records.
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'a', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'other', decisionId: 'd-1', reason: 'b', suggestedBy: 'y', now: NOW });
    assert.equal(collection._docs.length, 2);
    assert.deepEqual(collection._docs.map(d => d._id).sort(), ['acme::d-1', 'other::d-1']);
  });

  test('bad workspace/decision input is refused, and an unconfigured store degrades', async () => {
    assert.equal(await store.suggest({ decisionId: 'd-1', reason: 'r', suggestedBy: 'x' }), null);
    assert.equal(await store.suggest({ urlKey: 'acme', reason: 'r', suggestedBy: 'x' }), null);
    assert.equal(await store.suggest(), null);
    const unconfigured = new DismissalSuggestionsStore({});
    assert.equal(await unconfigured.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x' }), null);
  });
});

describe('DismissalSuggestionsStore.withdraw', () => {
  let collection, store;
  beforeEach(() => { ({ collection, store } = makeStore()); });

  test('marks the row withdrawn rather than deleting it', async () => {
    // "This was proposed and a human declined it" is the signal that tells you
    // proposals are being made badly. Deleting the row erases it.
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    const rec = await store.withdraw({ urlKey: 'acme', decisionId: 'd-1', now: LATER });
    assert.equal(rec.withdrawn, true);
    assert.equal(rec.withdrawnAt, LATER.toISOString());
    assert.equal(collection._docs.length, 1, 'the row is retained');
    assert.equal(collection._docs[0].reason, 'r', 'the original reason survives');
  });

  test('is idempotent — a second withdrawal does not move the timestamp', async () => {
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.withdraw({ urlKey: 'acme', decisionId: 'd-1', now: NOW });
    const second = await store.withdraw({ urlKey: 'acme', decisionId: 'd-1', now: LATER });
    assert.equal(second.withdrawnAt, NOW.toISOString(), 'first withdrawal wins');
  });

  test('withdrawing an absent suggestion is null, not a fabricated row', async () => {
    assert.equal(await store.withdraw({ urlKey: 'acme', decisionId: 'nope' }), null);
    assert.equal(collection._docs.length, 0);
  });

  test('LIN-2766: a decisionLoopId-scoped withdraw falls back to a legacy two-segment doc when no loop-scoped one exists', async () => {
    // The read side (attachStandingSuggestions/shelfGate) has always fallen
    // back to the legacy `${urlKey}::${decisionId}` doc for a loop-backed row.
    // withdraw() composed the loop-scoped `_id` only and returned null on a
    // miss — a Keep press on a legacy-suggested, loop-backed row 404s.
    await store.suggest({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', reason: 'stale', suggestedBy: 'agent', now: NOW });
    const rec = await store.withdraw({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '07509b1e', now: LATER });
    assert.notEqual(rec, null, 'withdraw must fall back to the legacy doc rather than reporting no match');
    assert.equal(rec.withdrawn, true);
    assert.equal(collection._docs.length, 1, 'the legacy row is retained (marked, not deleted), not duplicated');
    assert.equal(collection._docs[0]._id, 'acme::lin2384-f6-gate', 'the legacy _id is what was actually updated');
  });

  test('LIN-2766: a loop-scoped withdraw prefers the exact loop-scoped doc over a coexisting legacy one', async () => {
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'legacy', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', decisionLoopId: '07509b1e', reason: 'specific', suggestedBy: 'y', now: NOW });

    await store.withdraw({ urlKey: 'acme', decisionId: 'd-1', decisionLoopId: '07509b1e', now: LATER });

    const legacy = collection._docs.find(d => d._id === 'acme::d-1');
    const scoped = collection._docs.find(d => d._id === 'acme::07509b1e::d-1');
    assert.equal(scoped.withdrawn, true, 'the exact loop-scoped doc is the one withdrawn');
    assert.equal(legacy.withdrawn, false, 'the legacy doc must not be touched when a loop-scoped doc exists');
  });

  test('withdrawal does not touch any answer state — it only clears the offer', async () => {
    // The structural point of the whole ticket: neither suggest nor withdraw
    // may resemble an answer. This store writes exactly four fields beyond its
    // key, and none of them is an outcome.
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.withdraw({ urlKey: 'acme', decisionId: 'd-1', now: LATER });
    const doc = collection._docs[0];
    for (const forbidden of ['outcome', 'outcomeAt', 'answered', 'answeredDecisionId', 'decision-answer']) {
      assert.ok(!(forbidden in doc), `a suggestion row must never carry '${forbidden}'`);
    }
  });
});

describe('DismissalSuggestionsStore.listForWorkspaces', () => {
  let store;
  beforeEach(() => { ({ store } = makeStore()); });

  test('returns raw rows across a workspace set, INCLUDING withdrawn ones', async () => {
    // The store never reduces — the caller owns the "still standing" predicate,
    // the same convention ShelvedRulingsStore and TaskDecisionsStore follow, so
    // there is only ever one place that decides.
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'acme', decisionId: 'd-2', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.withdraw({ urlKey: 'acme', decisionId: 'd-2', now: NOW });
    await store.suggest({ urlKey: 'other', decisionId: 'd-3', reason: 'r', suggestedBy: 'x', now: NOW });

    const rows = await store.listForWorkspaces(['acme', 'other']);
    assert.equal(rows.length, 3);
    assert.equal(rows.filter(r => r.withdrawn).length, 1);
  });

  test('is scoped to the workspaces asked for', async () => {
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'other', decisionId: 'd-2', reason: 'r', suggestedBy: 'x', now: NOW });
    const rows = await store.listForWorkspaces(['acme']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].urlKey, 'acme');
  });

  test('an empty or missing workspace set is an empty list, never a full scan', async () => {
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    assert.deepEqual(await store.listForWorkspaces([]), []);
    assert.deepEqual(await store.listForWorkspaces(), []);
    assert.deepEqual(await store.listForWorkspaces(null), []);
  });

  test('an unconfigured store degrades to an empty list', async () => {
    const unconfigured = new DismissalSuggestionsStore({});
    assert.deepEqual(await unconfigured.listForWorkspaces(['acme']), []);
  });
});

describe('DismissalSuggestionsStore.clear', () => {
  test('removes only the named workspace and reports the count', async () => {
    const { store } = makeStore();
    await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'acme', decisionId: 'd-2', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'other', decisionId: 'd-3', reason: 'r', suggestedBy: 'x', now: NOW });

    assert.equal(await store.clear('acme'), 2);
    assert.deepEqual((await store.listForWorkspaces(['acme', 'other'])).map(r => r.decisionId), ['d-3']);
  });

  test('an unconfigured store or missing urlKey clears nothing', async () => {
    const { store } = makeStore();
    assert.equal(await store.clear(), 0);
    assert.equal(await new DismissalSuggestionsStore({}).clear('acme'), 0);
  });
});

// LIN-2756 — the ticket's live repro at the store layer: session `74869c9c`'s
// review loop `07509b1e` and close-out loop `0c912018` emit the SAME
// `decision_id`. A suggestion proposed against one loop's row must not
// silently apply to the other's.
describe('DismissalSuggestionsStore — per-loop identity (LIN-2756)', () => {
  let collection, store;
  beforeEach(() => { ({ collection, store } = makeStore()); });

  test('a decisionLoopId-scoped suggestion keys on the full triple, not just (urlKey, decisionId)', async () => {
    const rec = await store.suggest({
      urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '07509b1e', reason: 'shipped', suggestedBy: 'lane-e', now: NOW
    });
    assert.equal(rec.decisionLoopId, '07509b1e');
    assert.equal(collection._docs[0]._id, 'acme::07509b1e::lin2384-f6-gate');
  });

  test('two loops sharing (urlKey, decisionId) get independent suggestion rows', async () => {
    await store.suggest({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '07509b1e', reason: 'review pass done', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '0c912018', reason: 'close-out pass done', suggestedBy: 'x', now: NOW });

    assert.equal(collection._docs.length, 2, 'each loop must keep its own row, not collapse onto one shared (urlKey, decisionId) key');
    assert.deepEqual(collection._docs.map(d => d._id).sort(), ['acme::07509b1e::lin2384-f6-gate', 'acme::0c912018::lin2384-f6-gate']);
  });

  test('withdrawing one loop’s suggestion leaves the other loop’s standing', async () => {
    await store.suggest({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '07509b1e', reason: 'r', suggestedBy: 'x', now: NOW });
    await store.suggest({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '0c912018', reason: 'r', suggestedBy: 'x', now: NOW });

    const withdrawn = await store.withdraw({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '07509b1e', now: LATER });
    assert.equal(withdrawn.withdrawn, true);

    const rows = await store.listForWorkspaces(['acme']);
    const other = rows.find(r => r.decisionLoopId === '0c912018');
    assert.equal(other.withdrawn, false, "the close-out loop's suggestion must not be withdrawn by a Keep on the review loop's row");
  });

  test('omitting decisionLoopId keeps the legacy, workspace-wide two-segment shape — back-compat, not a refusal', async () => {
    const rec = await store.suggest({ urlKey: 'acme', decisionId: 'd-1', reason: 'r', suggestedBy: 'x', now: NOW });
    assert.equal(rec.decisionLoopId, null);
    assert.equal(collection._docs[0]._id, 'acme::d-1');
  });

  test('LIN-2766: a legacy suggestion attached to a loop-backed row via the read-side fallback is ACTUALLY withdrawn by that row\'s Keep — crossed read/write', async () => {
    // The ticket's own reproduction: attachStandingSuggestions (read side)
    // has always fanned a legacy doc out to every loop's row. Before the fix,
    // withdraw (write side) could not find that same doc via the loop-scoped
    // id it was pressed with — Keep 404d and the banner returned on the next
    // poll even though the client reported success.
    await store.suggest({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', reason: 'stale', suggestedBy: 'agent', now: NOW });
    const row = { anchor: { workspaceUrlKey: 'acme', loopId: '07509b1e' }, decision: { decision_id: 'lin2384-f6-gate' } };

    const before = attachStandingSuggestions([row], await store.listForWorkspaces(['acme']));
    assert.ok(before[0].suggestedDismissal, 'the legacy suggestion attaches to the loop-backed row (banner renders)');

    const withdrawn = await store.withdraw({ urlKey: 'acme', decisionId: 'lin2384-f6-gate', decisionLoopId: '07509b1e', now: LATER });
    assert.notEqual(withdrawn, null, 'Keep must not 404 on a legacy-shaped standing suggestion');

    const after = attachStandingSuggestions([row], await store.listForWorkspaces(['acme']));
    assert.equal(after[0].suggestedDismissal, null, 'the banner must be gone — the withdrawal actually took effect, not a false "already withdrawn"');
  });
});

describe('attachStandingSuggestions — loop-aware join (LIN-2756)', () => {
  function row(loopId, decisionId, urlKey = 'acme') {
    return { anchor: { workspaceUrlKey: urlKey, loopId }, decision: { decision_id: decisionId } };
  }
  function suggestion(over) {
    return { urlKey: 'acme', decisionId: 'lin2384-f6-gate', withdrawn: false, reason: 'r', suggestedBy: 'x', suggestedAt: NOW.toISOString(), decisionLoopId: null, ...over };
  }

  test('a loop-scoped suggestion attaches ONLY to its own loop’s row — the sibling stays null (LIN-2756 live repro)', () => {
    const rows = [row('07509b1e', 'lin2384-f6-gate'), row('0c912018', 'lin2384-f6-gate')];
    const suggestions = [suggestion({ decisionLoopId: '07509b1e', reason: 'review pass done' })];

    const [reviewRow, closeoutRow] = attachStandingSuggestions(rows, suggestions);
    assert.equal(reviewRow.suggestedDismissal?.reason, 'review pass done');
    assert.equal(closeoutRow.suggestedDismissal, null, "the close-out loop's row must not inherit the review loop's suggestion");
  });

  test('a legacy/workspace-wide suggestion (no decisionLoopId) still fans out to every loop sharing the id — documented back-compat', () => {
    const rows = [row('07509b1e', 'lin2384-f6-gate'), row('0c912018', 'lin2384-f6-gate')];
    const suggestions = [suggestion({ decisionLoopId: null })];

    const [reviewRow, closeoutRow] = attachStandingSuggestions(rows, suggestions);
    assert.ok(reviewRow.suggestedDismissal, 'a legacy suggestion still applies to every loop carrying the id');
    assert.ok(closeoutRow.suggestedDismissal, 'both loops see the same workspace-wide suggestion');
  });

  test('a loop-scoped suggestion for one loop does not fall back to the legacy row for a DIFFERENT loop that has its own', () => {
    const rows = [row('07509b1e', 'lin2384-f6-gate'), row('0c912018', 'lin2384-f6-gate')];
    const suggestions = [
      suggestion({ decisionLoopId: null, reason: 'legacy wide' }),
      suggestion({ decisionLoopId: '0c912018', reason: 'close-out specific' })
    ];

    const [reviewRow, closeoutRow] = attachStandingSuggestions(rows, suggestions);
    assert.equal(reviewRow.suggestedDismissal.reason, 'legacy wide', 'no loop-specific row for the review loop — falls back to legacy');
    assert.equal(closeoutRow.suggestedDismissal.reason, 'close-out specific', 'a loop-specific row wins over the legacy fallback');
  });

  test('a withdrawn suggestion never attaches, loop-scoped or legacy', () => {
    const rows = [row('07509b1e', 'lin2384-f6-gate')];
    const suggestions = [suggestion({ decisionLoopId: '07509b1e', withdrawn: true })];
    assert.equal(attachStandingSuggestions(rows, suggestions)[0].suggestedDismissal, null);
  });

  test('a task-bound row (loopId null, taskDecisionId set) matches on taskDecisionId', () => {
    const taskRow = { anchor: { workspaceUrlKey: 'acme', loopId: null, taskDecisionId: 'scan_abc' }, decision: { decision_id: 'd-task' } };
    const suggestions = [{ urlKey: 'acme', decisionId: 'd-task', decisionLoopId: 'scan_abc', withdrawn: false, reason: 'r', suggestedBy: 'x', suggestedAt: NOW.toISOString() }];
    assert.equal(attachStandingSuggestions([taskRow], suggestions)[0].suggestedDismissal.reason, 'r');
  });

  test('a different workspace sharing the same loopId+decisionId never attaches', () => {
    const rows = [row('07509b1e', 'lin2384-f6-gate', 'other-workspace')];
    const suggestions = [suggestion({ decisionLoopId: '07509b1e' })]; // urlKey: 'acme'
    assert.equal(attachStandingSuggestions(rows, suggestions)[0].suggestedDismissal, null);
  });
});
