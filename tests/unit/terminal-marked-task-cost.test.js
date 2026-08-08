/**
 * Unit tests for lib/terminal-marked-task-cost.js (LIN-1957, Session 1 of LIN-1625)
 *
 * Run with: node --test tests/unit/terminal-marked-task-cost.test.js
 *
 * `computeTerminalMarkedTaskCost` is pure — no store, no network, no clock —
 * so these tests construct dispatch-row fixtures directly in the shape
 * `loadDispatchHistory`'s find-path fallback returns (the same shape
 * tests/unit/kpi-stats.test.js's outcome-metric tests use).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTerminalMarkedTaskCost } from '../../lib/terminal-marked-task-cost.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS);

const doneMarker = (days) => ({ message: '[done] landed it', timestamp: daysAgo(days).toISOString() });

function usageEntry({ costUsd, lane = null, days }) {
  const payload = { harness: 'irrelevant-to-payload-parsing', lane };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  return { kind: 'usage', message: `[usage] ${JSON.stringify(payload)}`, timestamp: daysAgo(days).toISOString() };
}

function row({ id, rootItemId = id, issueIdentifier, harness = null, kind = 'implementation', dispatchedAt, feedback = [] }) {
  return { _id: id, rootItemId, issueIdentifier, harness, kind, status: 'taken', dispatchedAt, feedback };
}

describe('computeTerminalMarkedTaskCost — the harness-conditional reduce', () => {
  test('opencode SUMS each contributing row\'s costUsd', () => {
    const rows = [
      row({
        id: 'a1', issueIdentifier: 'LIN-1', harness: 'opencode', dispatchedAt: daysAgo(3),
        feedback: [usageEntry({ costUsd: 1.5, lane: 'api', days: 3 }), doneMarker(2.9)]
      }),
      row({
        id: 'a2', rootItemId: 'a1', issueIdentifier: 'LIN-1', harness: 'opencode', dispatchedAt: daysAgo(2.5),
        feedback: [usageEntry({ costUsd: 2.5, lane: 'api', days: 2.5 }), doneMarker(2.4)]
      })
    ];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.issueCount, 1);
    assert.equal(result.costUsd, 4);
    assert.equal(result.cashUsd, 4);
  });

  test('claude-code takes the LAST entry only (last-wins) — summing would double-count the cumulative snapshot', () => {
    const rows = [row({
      id: 'b1', issueIdentifier: 'LIN-2', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [
        usageEntry({ costUsd: 1, lane: null, days: 1 }),
        usageEntry({ costUsd: 5, lane: null, days: 0.9 }), // cumulative snapshot supersedes the first
        doneMarker(0.8)
      ]
    })];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.costUsd, 5, 'must take the LAST entry (5), not sum (1+5=6)');
  });

  test('unknown (null) harness also takes last-wins, same as claude-code', () => {
    const rows = [row({
      id: 'c1', issueIdentifier: 'LIN-3', harness: null, dispatchedAt: daysAgo(1),
      feedback: [
        usageEntry({ costUsd: 1, days: 1 }),
        usageEntry({ costUsd: 3, days: 0.9 }),
        doneMarker(0.8)
      ]
    })];
    assert.equal(computeTerminalMarkedTaskCost(rows, NOW).costUsd, 3);
  });

  test('earliest-row-only harness still governs the reduce: a follow-up implying a different harness does not flip sum vs last-wins', () => {
    // Lineage's earliest row is claude-code (last-wins governs), even though
    // the follow-up row's own `harness` field claims opencode. This exercises
    // the SAME earliest-row-only capture beat 3 pinned at the accumulator
    // level, now proven to actually govern this module's reduce choice.
    const rows = [
      row({
        id: 'd1', issueIdentifier: 'LIN-4', harness: 'claude-code', dispatchedAt: daysAgo(3),
        feedback: [usageEntry({ costUsd: 1, days: 3 }), doneMarker(2.9)]
      }),
      row({
        id: 'd2', rootItemId: 'd1', issueIdentifier: 'LIN-4', harness: 'opencode', dispatchedAt: daysAgo(2),
        feedback: [usageEntry({ costUsd: 10, days: 2 }), doneMarker(1.9)]
      })
    ];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    // If harness were re-resolved per row (wrong), the lineage would look
    // opencode-sourced and sum to 11. Last-wins on the true (earliest-row)
    // claude-code harness gives 10 (the last entry only).
    assert.equal(result.costUsd, 10);
    assert.equal(result.opencodeSummedShare, 0, 'the lineage never used the sum reduce');
  });
});

describe('computeTerminalMarkedTaskCost — unpriced exclusion', () => {
  test('a resolved issue with no usage at all is unpriced, excluded from the sum, never counted as $0', () => {
    const rows = [row({
      id: 'e1', issueIdentifier: 'LIN-5', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)] // done, but no [usage] entry ever posted
    })];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.issueCount, 1);
    assert.equal(result.unpriced, 1);
    assert.equal(result.costUsd, null, 'must be null, never 0, when nothing is priced');
  });

  test('a partially-unpriced instance sums only what IS priced and still flags the unpriced issue', () => {
    const priced = row({
      id: 'f1', issueIdentifier: 'LIN-6', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 7, lane: 'api', days: 1 }), doneMarker(0.9)]
    });
    const unpriced = row({
      id: 'f2', issueIdentifier: 'LIN-7', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([priced, unpriced], NOW);
    assert.equal(result.issueCount, 2);
    assert.equal(result.unpriced, 1);
    assert.equal(result.costUsd, 7, 'the priced issue\'s cost must not be zeroed out by the unpriced sibling');
  });
});

describe('computeTerminalMarkedTaskCost — F1 (LIN-1957 review, Request Changes): partial pricing must never be silently counted as $0', () => {
  // The review's own repro at the PR head (#1090, 6c2eadd2): an issue/lineage
  // that is only PARTLY priced contributes a partial sum presented as full
  // cost, flagged nowhere. Approved plan (quoted twice in the review): "a row
  // with priced: false excludes that row's contribution and flags unpriced —
  // never counted as $0." Expected-red until fix-beat 2/3 lands.

  test('F1a: an issue with one priced lineage and a sibling lineage that never posted usage must flag unpriced, not silently present only the priced lineage\'s sum', () => {
    const priced = row({
      id: 'f1a-priced', rootItemId: 'f1a-priced', issueIdentifier: 'LIN-100', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ costUsd: 6, lane: 'api', days: 2 }), doneMarker(1.9)]
    });
    const neverPriced = row({
      id: 'f1a-unpriced', rootItemId: 'f1a-unpriced', issueIdentifier: 'LIN-100', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)] // done, but no [usage] entry ever posted
    });
    const result = computeTerminalMarkedTaskCost([priced, neverPriced], NOW);
    assert.equal(result.issueCount, 1);
    // Review repro at PR head: { issueCount: 1, costUsd: 6, unpriced: 0 } — the
    // second lineage's $0 contribution is invisible.
    assert.equal(result.unpriced, 1, 'the partially-priced issue must be flagged unpriced, not read as fully priced');
    assert.equal(result.costUsd, null, 'a partially-priced issue\'s partial sum must not be presented as its full cost');
  });

  test('F1b: an opencode lineage with one unpriceable row among priced ones must flag unpriced, not silently sum only the priced rows', () => {
    const r1 = row({
      id: 'f1b-1', rootItemId: 'f1b-1', issueIdentifier: 'LIN-101', harness: 'opencode', dispatchedAt: daysAgo(3),
      feedback: [usageEntry({ costUsd: 1, lane: 'api', days: 3 })]
    });
    const r2 = row({
      id: 'f1b-2', rootItemId: 'f1b-1', issueIdentifier: 'LIN-101', harness: 'opencode', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ lane: 'api', days: 2 })] // no costUsd, no model — unpriceable
    });
    const r3 = row({
      id: 'f1b-3', rootItemId: 'f1b-1', issueIdentifier: 'LIN-101', harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 2, lane: 'api', days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([r1, r2, r3], NOW);
    assert.equal(result.issueCount, 1);
    // Review repro at PR head: { issueCount: 1, costUsd: 3, unpriced: 0 } — the
    // middle row's failure to price is invisible.
    assert.equal(result.unpriced, 1, 'a lineage with any unpriceable row must be flagged unpriced');
    assert.equal(result.costUsd, null, 'a partially-priced lineage\'s partial sum must not be presented as its full cost');
  });
});

describe('computeTerminalMarkedTaskCost — F2 (LIN-1957 review, Request Changes): a null-identifier earliest row must not drop the lineage', () => {
  // Approved plan, Surface 2: "issueIdentifier — set from any row carrying
  // one." The implementation instead captures it from the earliest row only
  // (the same place it captures harness), and computeTerminalMarkedTaskCost
  // hard-drops a lineage with no issueIdentifier. Expected-red until
  // fix-beat 2/3 lands.

  test('F2: a lineage whose earliest retained row has no issueIdentifier, but a later contributing row does, must stay attributable', () => {
    const earliestNoId = row({
      id: 'f2-1', rootItemId: 'f2-1', issueIdentifier: undefined, harness: 'claude-code', dispatchedAt: daysAgo(3),
      feedback: [usageEntry({ costUsd: 4, days: 3 })]
    });
    const laterWithId = row({
      id: 'f2-2', rootItemId: 'f2-1', issueIdentifier: 'LIN-102', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ costUsd: 9, days: 2 }), doneMarker(1.9)]
    });
    const result = computeTerminalMarkedTaskCost([earliestNoId, laterWithId], NOW);
    // Review repro at PR head: { issueCount: 0, costUsd: null, ... } — the
    // whole lineage vanishes, numerator and denominator both, with no trace.
    assert.equal(result.issueCount, 1, 'plan: issueIdentifier must be set from any row carrying one, not just the earliest');
    assert.equal(result.costUsd, 9);
  });
});

describe('computeTerminalMarkedTaskCost — F3 (LIN-1957 review, should-fix): rowUsage must not be order-dependent', () => {
  // Every other accumulator field (earliest/status/harness/issueIdentifier)
  // resolves by explicit comparison; rowUsage appends in array order and the
  // claude-code/unknown arm takes the last element. The input
  // (`lib/kpi-stats.js:715`) is an unsorted concatenation of an unsorted
  // aggregate and an unsorted find, so array order is not guaranteed.
  // Expected-red until fix-beat 2/3 lands.

  test('F3: the same two rows in reversed array order must give the same costUsd', () => {
    const earlier = row({
      id: 'f3-1', rootItemId: 'f3-1', issueIdentifier: 'LIN-103', harness: 'claude-code', dispatchedAt: daysAgo(4),
      feedback: [usageEntry({ costUsd: 2, days: 4 })]
    });
    const later = row({
      id: 'f3-2', rootItemId: 'f3-1', issueIdentifier: 'LIN-103', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 11, days: 1 }), doneMarker(0.9)]
    });
    const forward = computeTerminalMarkedTaskCost([earlier, later], NOW);
    const reversed = computeTerminalMarkedTaskCost([later, earlier], NOW);
    // Review repro at PR head: $11 forward vs $2 reversed on this exact shape.
    assert.equal(forward.costUsd, reversed.costUsd, 'rowUsage order must not change the last-wins result');
  });
});

describe('computeTerminalMarkedTaskCost — lane split', () => {
  test('null lane maps to unknownLaneUsd, never defaulted to subscription', () => {
    const rows = [row({
      id: 'g1', issueIdentifier: 'LIN-8', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 4, lane: null, days: 1 }), doneMarker(0.9)]
    })];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.unknownLaneUsd, 4);
    assert.equal(result.cashUsd, 0, 'a null lane must never land in cashUsd');
  });

  test('a subscription lane contributes to the API-equivalent total but ZERO marginal cash', () => {
    const rows = [row({
      id: 'h1', issueIdentifier: 'LIN-9', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 3, lane: 'subscription', days: 1 }), doneMarker(0.9)]
    })];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.costUsd, 3, 'subscription-lane cost still counts toward the API-equivalent figure');
    assert.equal(result.cashUsd, 0);
    assert.equal(result.unknownLaneUsd, 0);
  });

  test('api and openrouter lanes both land in cashUsd', () => {
    const rows = [
      row({
        id: 'i1', issueIdentifier: 'LIN-10', harness: 'claude-code', dispatchedAt: daysAgo(1),
        feedback: [usageEntry({ costUsd: 2, lane: 'api', days: 1 }), doneMarker(0.9)]
      }),
      row({
        id: 'i2', issueIdentifier: 'LIN-11', harness: 'claude-code', dispatchedAt: daysAgo(1),
        feedback: [usageEntry({ costUsd: 3, lane: 'openrouter', days: 1 }), doneMarker(0.9)]
      })
    ];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.cashUsd, 5);
  });
});

describe('computeTerminalMarkedTaskCost — issue-level denominator', () => {
  test('an issue with TWO separate done lineages (a fresh re-dispatch, not a follow-up) is counted ONCE', () => {
    const rows = [
      row({
        id: 'j1', issueIdentifier: 'LIN-12', harness: 'claude-code', dispatchedAt: daysAgo(5),
        feedback: [usageEntry({ costUsd: 2, lane: 'api', days: 5 }), doneMarker(4.9)]
      }),
      // A genuinely SEPARATE dispatch (own rootItemId, no followUpTo) for the
      // same issue, e.g. re-opened and redone later — the ticket's own
      // measured claim: 82% of issues in the research probe had >1 lineage.
      row({
        id: 'j2', rootItemId: 'j2', issueIdentifier: 'LIN-12', harness: 'claude-code', dispatchedAt: daysAgo(1),
        feedback: [usageEntry({ costUsd: 3, lane: 'api', days: 1 }), doneMarker(0.9)]
      })
    ];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.issueCount, 1, 'lineage count is 2, but issue count (the denominator) is 1');
    assert.equal(result.costUsd, 5, 'both lineages\' cost sums into the one issue');
  });
});

describe('computeTerminalMarkedTaskCost — zero-T degradation', () => {
  test('an empty instance degrades the metric AND all four shares to null — never NaN, never 0', () => {
    const result = computeTerminalMarkedTaskCost([], NOW);
    assert.equal(result.issueCount, 0);
    assert.equal(result.costUsd, null);
    assert.equal(result.cashUsd, null);
    assert.equal(result.unknownLaneUsd, null);
    assert.equal(result.unpriced, 0);
    assert.equal(result.closeOutLineageShare, null);
    assert.equal(result.evidenceLinkedShare, null);
    assert.equal(result.opencodeSummedShare, null);
    assert.equal(result.unknownHarnessShare, null);
    for (const key of ['costUsd', 'cashUsd', 'unknownLaneUsd', 'closeOutLineageShare', 'evidenceLinkedShare', 'opencodeSummedShare', 'unknownHarnessShare']) {
      assert.ok(!Number.isNaN(result[key]), `${key} must not be NaN`);
    }
  });

  test('a lineage with no terminal marker (unresolved) contributes nothing — T stays 0', () => {
    const rows = [row({
      id: 'k1', issueIdentifier: 'LIN-13', harness: 'claude-code', dispatchedAt: daysAgo(1), feedback: []
    })];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.issueCount, 0);
    assert.equal(result.costUsd, null);
  });
});

describe('computeTerminalMarkedTaskCost — disclosure shares', () => {
  test('evidenceLinkedShare reflects issues with at least one kind:evidence entry', () => {
    const withEvidence = row({
      id: 'l1', issueIdentifier: 'LIN-14', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [
        { kind: 'evidence', message: 'link', timestamp: daysAgo(1).toISOString() },
        usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)
      ]
    });
    const without = row({
      id: 'l2', issueIdentifier: 'LIN-15', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([withEvidence, without], NOW);
    assert.equal(result.evidenceLinkedShare, 0.5);
  });

  test('closeOutLineageShare reflects issues whose lineage includes a close-out kind dispatch', () => {
    const withCloseOut = row({
      id: 'm1', issueIdentifier: 'LIN-16', kind: 'close-out', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const without = row({
      id: 'm2', issueIdentifier: 'LIN-17', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([withCloseOut, without], NOW);
    assert.equal(result.closeOutLineageShare, 0.5);
  });

  test('unknownHarnessShare reflects issues whose earliest row carries no harness', () => {
    const known = row({
      id: 'n1', issueIdentifier: 'LIN-18', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const unknown = row({
      id: 'n2', issueIdentifier: 'LIN-19', harness: null, dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([known, unknown], NOW);
    assert.equal(result.unknownHarnessShare, 0.5);
  });

  test('opencodeSummedShare reflects issues whose lineage used the sum reduce', () => {
    const opencode = row({
      id: 'o1', issueIdentifier: 'LIN-20', harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, lane: 'api', days: 1 }), doneMarker(0.9)]
    });
    const claude = row({
      id: 'o2', issueIdentifier: 'LIN-21', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([opencode, claude], NOW);
    assert.equal(result.opencodeSummedShare, 0.5);
  });
});

describe('computeTerminalMarkedTaskCost — naming discipline', () => {
  test('no "verified" or reserved synonym appears in any emitted field name', () => {
    const result = computeTerminalMarkedTaskCost([], NOW);
    for (const key of Object.keys(result)) {
      assert.ok(!/verif/i.test(key), `field name "${key}" must not reference "verified"`);
    }
  });
});
