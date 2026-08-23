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
const skippedMarker = (days) => ({ message: '[skipped] human-continued session (phase)', timestamp: daysAgo(days).toISOString() });

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
    // F4/F5 (gap-beat 2): the two new USD lines and two new coverage shares
    // must degrade the same way — null, never 0/NaN, when there is nothing
    // in the category to report.
    assert.equal(result.inFlightUsd, null);
    assert.equal(result.overheadUsd, null);
    assert.equal(result.pricedLineageShare, null);
    assert.equal(result.attributableLineageShare, null);
    assert.equal(result.captureRateShare, null);
    for (const key of [
      'costUsd', 'cashUsd', 'unknownLaneUsd', 'closeOutLineageShare', 'evidenceLinkedShare',
      'opencodeSummedShare', 'unknownHarnessShare', 'inFlightUsd', 'overheadUsd',
      'pricedLineageShare', 'attributableLineageShare', 'captureRateShare'
    ]) {
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

describe('computeTerminalMarkedTaskCost — F4 (LIN-1957 review round 2, Request Changes): in-flight and overhead spend must be published, not silently invisible', () => {
  test('inFlightUsd counts windowed spend on an unresolved (no terminal marker) lineage, and does NOT fold into costUsd', () => {
    const inFlight = row({
      id: 'p1', issueIdentifier: 'LIN-200', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 50, lane: 'api', days: 1 })] // no terminal marker: still running
    });
    const resolved = row({
      id: 'p2', issueIdentifier: 'LIN-201', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ costUsd: 10, lane: 'api', days: 2 }), doneMarker(1.9)]
    });
    const result = computeTerminalMarkedTaskCost([inFlight, resolved], NOW);
    assert.equal(result.issueCount, 1, 'the in-flight lineage must not enter the T denominator');
    assert.equal(result.costUsd, 10, 'in-flight spend must never fold into the resolved-task numerator');
    assert.equal(result.inFlightUsd, 50);
  });

  test('overheadUsd counts windowed spend on a done, issue-less dispatch (autopilot/Collective/ad-hoc), and does NOT fold into costUsd', () => {
    const issueLess = row({
      id: 'q1', issueIdentifier: undefined, kind: 'autopilot', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 30, lane: 'api', days: 1 }), doneMarker(0.9)]
    });
    const resolved = row({
      id: 'q2', issueIdentifier: 'LIN-202', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ costUsd: 10, lane: 'api', days: 2 }), doneMarker(1.9)]
    });
    const result = computeTerminalMarkedTaskCost([issueLess, resolved], NOW);
    assert.equal(result.issueCount, 1, 'the issue-less dispatch must not enter the T denominator');
    assert.equal(result.costUsd, 10, 'overhead spend must never fold into the resolved-task numerator');
    assert.equal(result.overheadUsd, 30);
  });

  test('round 2\'s own reproduction: one resolved issue ($10), one in-flight lineage ($50), one issue-less dispatch ($30) — $80 of $90 must now be visible', () => {
    const resolved = row({
      id: 'r1', issueIdentifier: 'LIN-203', harness: 'claude-code', dispatchedAt: daysAgo(3),
      feedback: [usageEntry({ costUsd: 10, lane: 'api', days: 3 }), doneMarker(2.9)]
    });
    const inFlight = row({
      id: 'r2', issueIdentifier: 'LIN-204', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ costUsd: 50, lane: 'api', days: 2 })]
    });
    const issueLess = row({
      id: 'r3', issueIdentifier: undefined, kind: 'autopilot', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 30, lane: 'api', days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([resolved, inFlight, issueLess], NOW);
    assert.equal(result.issueCount, 1);
    assert.equal(result.costUsd, 10);
    assert.equal(result.inFlightUsd, 50);
    assert.equal(result.overheadUsd, 30);
    assert.equal(result.costUsd + result.inFlightUsd + result.overheadUsd, 90, 'all $90 of windowed spend is now accounted for across the three published lines');
  });

  test('an unpriced in-flight lineage is excluded from inFlightUsd, never counted as $0 — degrades to null when it is the only in-flight lineage', () => {
    const unpricedInFlight = row({
      id: 's1', issueIdentifier: 'LIN-205', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [] // still running, nothing posted yet
    });
    const result = computeTerminalMarkedTaskCost([unpricedInFlight], NOW);
    assert.equal(result.inFlightUsd, null, 'must be null, not 0 — an unpriced lineage is not zero spend');
  });

  test('a partially-priced (opencode, one unpriceable row) in-flight lineage is excluded from inFlightUsd entirely, not summed from what did price', () => {
    const partiallyPriced = row({
      id: 't1', issueIdentifier: 'LIN-206', harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 4, lane: 'api', days: 1 }), usageEntry({ lane: 'api', days: 0.5 })] // second row unpriceable, still running
    });
    const result = computeTerminalMarkedTaskCost([partiallyPriced], NOW);
    assert.equal(result.inFlightUsd, null, 'a partially-priced in-flight lineage must be excluded wholesale, same fullyPriced discipline as costUsd');
  });

  test('an unpriced issue-less dispatch is excluded from overheadUsd, never counted as $0', () => {
    const unpricedOverhead = row({
      id: 'u1', issueIdentifier: undefined, kind: 'autopilot', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)] // done, but no usage ever posted
    });
    const result = computeTerminalMarkedTaskCost([unpricedOverhead], NOW);
    assert.equal(result.overheadUsd, null, 'must be null, not 0');
  });
});

describe('computeTerminalMarkedTaskCost — F5 (LIN-1957 review round 2, Request Changes): declared coverage over the whole lineage population', () => {
  test('pricedLineageShare = fully-priced ÷ usage-bearing lineages — a lineage that never posted usage at all does not count against it', () => {
    const neverPosted = row({
      id: 'v1', issueIdentifier: 'LIN-207', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const fullyPriced = row({
      id: 'v2', issueIdentifier: 'LIN-208', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 5, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([neverPosted, fullyPriced], NOW);
    assert.equal(result.pricedLineageShare, 1, 'the never-posted lineage is not usage-bearing, so it is excluded from this ratio\'s denominator');
  });

  test('pricedLineageShare falls when a usage-bearing lineage is only partially priced', () => {
    const partiallyPriced = row({
      id: 'w1', issueIdentifier: 'LIN-209', harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 2, lane: 'api', days: 1 }), usageEntry({ lane: 'api', days: 0.5 }), doneMarker(0.4)]
    });
    const fullyPriced = row({
      id: 'w2', issueIdentifier: 'LIN-210', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 5, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([partiallyPriced, fullyPriced], NOW);
    assert.equal(result.pricedLineageShare, 0.5, 'one of two usage-bearing lineages is fully priced');
  });

  test('attributableLineageShare = attributable ÷ ran lineages, over the WHOLE population (done, in-flight, and issue-less alike)', () => {
    const doneAttributed = row({
      id: 'x1', issueIdentifier: 'LIN-211', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const inFlightAttributed = row({
      id: 'x2', issueIdentifier: 'LIN-212', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 })]
    });
    const doneIssueLess = row({
      id: 'x3', issueIdentifier: undefined, kind: 'autopilot', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([doneAttributed, inFlightAttributed, doneIssueLess], NOW);
    assert.equal(result.attributableLineageShare, 0.667, '2 of 3 ran lineages carry an issueIdentifier — the in-flight lineage counts toward "ran" too');
  });

  test('a `[skipped]` lineage is benign and counts toward neither ranLineages/attributableLineageShare nor inFlightUsd — same exclusion computeDispatchOutcomes applies', () => {
    const skipped = row({
      id: 'y1', issueIdentifier: undefined, harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 999, lane: 'api', days: 1 }), skippedMarker(0.9)]
    });
    const attributed = row({
      id: 'y2', issueIdentifier: 'LIN-213', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([skipped, attributed], NOW);
    assert.equal(result.attributableLineageShare, 1, 'the skipped lineage must not dilute the denominator');
    assert.equal(result.inFlightUsd, null, 'a skipped lineage\'s spend must not leak into inFlightUsd either');
  });

  test('realistic proportions (round 2 ledger row 6): when most done issues have a partially-priced lineage, costUsd is computed over a visibly small minority of T', () => {
    // 5 done, attributable issues. 1 is fully priced. 4 each have ONE
    // unpriceable opencode row alongside a priced one — realistic partial
    // pricing, not "never posted usage at all" (that failure mode is
    // covered separately above and correctly does not count against
    // pricedLineageShare's denominator).
    const clean = row({
      id: 'z0', issueIdentifier: 'LIN-300', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 8, lane: 'api', days: 1 }), doneMarker(0.9)]
    });
    const partial = (n) => row({
      id: `z${n}`, issueIdentifier: `LIN-30${n}`, harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [
        usageEntry({ costUsd: 3, lane: 'api', days: 1 }),
        usageEntry({ lane: 'api', days: 0.7 }), // unpriceable turn
        doneMarker(0.6)
      ]
    });
    const rows = [clean, partial(1), partial(2), partial(3), partial(4)];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.issueCount, 5, 'T is 5 — the gate does not shrink the denominator');
    assert.equal(result.unpriced, 4, '4 of 5 issues are excluded from every dollar sum');
    assert.equal(result.costUsd, 8, 'costUsd is computed over the ONE fully-priced issue — a small-sample figure presented as the headline');
    assert.equal(result.pricedLineageShare, 0.2, 'declared coverage makes the small-sample risk visible: only 1 of 5 usage-bearing lineages is fully priced');
    assert.equal(result.attributableLineageShare, 1, 'all 5 ran lineages carry an issueIdentifier in this fixture');
  });

  test('zero usage-bearing lineages degrades pricedLineageShare to null, never NaN/0 (distinct from the T-wide zero-T case)', () => {
    const neverPosted = row({
      id: 'aa1', issueIdentifier: 'LIN-400', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([neverPosted], NOW);
    assert.equal(result.issueCount, 1, 'T is non-zero');
    assert.equal(result.pricedLineageShare, null, 'usageBearingLineages is 0, so this must degrade to null, not divide-by-zero to NaN or read as 0');
  });
});

describe('computeTerminalMarkedTaskCost — LIN-1959: captureRateShare, the true capture rate', () => {
  test('captureRateShare = usage-bearing ÷ ran lineages — the SAME ran-lineages denominator attributableLineageShare uses', () => {
    const usageBearing = row({
      id: 'bb1', issueIdentifier: 'LIN-500', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 4, days: 1 }), doneMarker(0.9)]
    });
    const neverPosted1 = row({
      id: 'bb2', issueIdentifier: 'LIN-501', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const neverPosted2 = row({
      id: 'bb3', issueIdentifier: 'LIN-502', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([usageBearing, neverPosted1, neverPosted2], NOW);
    assert.equal(result.attributableLineageShare, 1, 'sanity: all 3 ran lineages carry an issueIdentifier');
    assert.equal(result.captureRateShare, 0.333, 'only 1 of 3 ran lineages ever posted usage at all');
  });

  test('the named honesty scenario: pricedLineageShare alone reads 100% while captureRateShare exposes the real capture loss', () => {
    // Every lineage that DID post usage is fully priced (pricedLineageShare
    // = 1, "priced lineages 100%"), but only a fraction of everything that
    // actually ran ever posted usage in the first place. pricedLineageShare's
    // own denominator (usage-bearing lineages) cannot see that gap; this is
    // the field that does.
    const priced = row({
      id: 'cc1', issueIdentifier: 'LIN-503', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 4, days: 1 }), doneMarker(0.9)]
    });
    const silent = (n) => row({
      id: `cc${n}`, issueIdentifier: `LIN-50${n}`, harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const rows = [priced, silent(4), silent(5), silent(6)];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.pricedLineageShare, 1, 'every usage-bearing lineage (just the one) is fully priced — reads as 100%');
    assert.equal(result.captureRateShare, 0.25, 'only 1 of 4 ran lineages posted any usage at all — the true capture rate');
  });

  test('a `[skipped]` lineage counts toward neither ranLineages nor captureRateShare\'s denominator, same exclusion attributableLineageShare applies', () => {
    const skipped = row({
      id: 'dd1', issueIdentifier: undefined, harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 999, lane: 'api', days: 1 }), skippedMarker(0.9)]
    });
    const usageBearing = row({
      id: 'dd2', issueIdentifier: 'LIN-600', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([skipped, usageBearing], NOW);
    assert.equal(result.captureRateShare, 1, 'the skipped lineage must not dilute the denominator');
  });

  test('zero usage-bearing lineages over a non-empty ran population degrades to a genuine 0, not null', () => {
    const neverPosted = row({
      id: 'ee1', issueIdentifier: 'LIN-700', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([neverPosted], NOW);
    assert.equal(result.captureRateShare, 0, 'ranLineages is 1 (non-zero), so this is a real 0, distinct from the null zero-ranLineages case');
  });
});

const ticketMarker = (identifier, state, days) => ({
  message: `[ticket] ${identifier} ${state}`,
  timestamp: daysAgo(days).toISOString()
});

describe('computeTerminalMarkedTaskCost — LIN-2253: lane-landed, no-lineage tickets', () => {
  test('a worker-lane lineage\'s OTHER done tickets are counted in T, flagged noLineage, and never priced', () => {
    const lane = row({
      id: 'lane1', issueIdentifier: 'LIN-800', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [
        ticketMarker('LIN-800', 'started', 2),
        usageEntry({ costUsd: 12, days: 1.5 }),
        ticketMarker('LIN-800', 'done', 1.2),
        ticketMarker('LIN-801', 'done', 1),
        ticketMarker('LIN-802', 'done', 0.9),
        doneMarker(0.8)
      ]
    });
    const result = computeTerminalMarkedTaskCost([lane], NOW);

    assert.equal(result.issueCount, 3, 'the anchor plus the two lane-landed tickets');
    assert.equal(result.noLineageCount, 2);
    assert.equal(result.unpriced, 2, 'the two no-lineage tickets — the anchor itself IS fully priced');
    assert.equal(result.costUsd, 12, 'the lane spend stays attributed to the anchor only — no invented per-ticket split');
  });

  test('a marker in a non-"done" state is never counted as a landed ticket', () => {
    const lane = row({
      id: 'lane2', issueIdentifier: 'LIN-810', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [
        usageEntry({ costUsd: 5, days: 1 }),
        ticketMarker('LIN-810', 'done', 0.9),
        ticketMarker('LIN-811', 'blocked', 0.9),
        ticketMarker('LIN-812', 'refused', 0.9),
        doneMarker(0.8)
      ]
    });
    const result = computeTerminalMarkedTaskCost([lane], NOW);
    assert.equal(result.issueCount, 1, 'blocked/refused tickets never landed — only the anchor counts');
    assert.equal(result.noLineageCount, 0);
  });

  test('a lane-landed ticket that ALSO has its own separate lineage is not double-counted or flagged noLineage', () => {
    const lane = row({
      id: 'lane3', issueIdentifier: 'LIN-820', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [
        usageEntry({ costUsd: 8, days: 1.5 }),
        ticketMarker('LIN-820', 'done', 1.2),
        ticketMarker('LIN-821', 'done', 1),
        doneMarker(0.9)
      ]
    });
    // LIN-821 ALSO shows up as its own anchor elsewhere (e.g. a later,
    // independent re-dispatch) — this is the case a naive first-pass add
    // would double-count.
    const ownLineage = row({
      id: 'own821', rootItemId: 'own821', issueIdentifier: 'LIN-821', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 3, days: 0.8 }), doneMarker(0.5)]
    });
    const result = computeTerminalMarkedTaskCost([lane, ownLineage], NOW);
    assert.equal(result.issueCount, 2, 'LIN-820 and LIN-821 — LIN-821 counted once, via its own lineage');
    assert.equal(result.noLineageCount, 0, 'LIN-821 has a real lineage, so it must not be flagged noLineage');
    assert.equal(result.costUsd, 11, '8 (LIN-820) + 3 (LIN-821 own lineage) — never LIN-821 counted or priced twice');
  });

  test('a lane-landed ticket from an UNRESOLVED (non-done) lineage is not counted at all', () => {
    const inFlight = row({
      id: 'lane4', issueIdentifier: 'LIN-830', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [
        usageEntry({ costUsd: 2, days: 0.9 }),
        ticketMarker('LIN-831', 'done', 0.8)
        // no terminal [done]/[failed]/etc marker — the lineage itself never resolved
      ]
    });
    const result = computeTerminalMarkedTaskCost([inFlight], NOW);
    assert.equal(result.issueCount, 0, 'an unresolved lineage contributes nothing, same as before LIN-2253');
    assert.equal(result.noLineageCount, 0);
  });

  test('review fix: a lane-landed ticket whose OWN anchor lineage is still in-flight is NOT flagged noLineage', () => {
    // The adversarial case the LIN-2253 review caught: `issues` is populated
    // ONLY from DONE lineages, so a naive `issues.has(identifier)` check
    // cannot see an in-flight (unresolved) anchor lineage and would
    // misclassify LIN-841 as noLineage — conflating "has a lineage, still
    // running" (already disclosed via inFlightUsd) with "no lineage at all"
    // (this ticket's actual mechanism).
    const laneA = row({
      id: 'laneA', issueIdentifier: 'LIN-840', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [
        usageEntry({ costUsd: 5, days: 1.5 }),
        ticketMarker('LIN-840', 'done', 1.2),
        ticketMarker('LIN-841', 'done', 1),
        doneMarker(0.9)
      ]
    });
    // LIN-841 has its own real anchor lineage — dispatched, in-window, but
    // still IN-FLIGHT (no terminal marker at all).
    const inFlightOwnLineage = row({
      id: 'own841', rootItemId: 'own841', issueIdentifier: 'LIN-841', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 4, days: 0.9 })]
    });
    const result = computeTerminalMarkedTaskCost([laneA, inFlightOwnLineage], NOW);
    assert.equal(result.issueCount, 1, 'only LIN-840 (the DONE anchor) reaches T — LIN-841\'s own lineage has not resolved yet');
    assert.equal(result.noLineageCount, 0, 'LIN-841 has a real (in-flight) lineage — must not be flagged noLineage');
    assert.equal(result.costUsd, 5, 'LIN-841\'s in-flight spend stays out of costUsd (F4 — see inFlightUsd), never folded in nor invented as a noLineage $0');
    assert.equal(result.inFlightUsd, 4, 'LIN-841\'s own lineage spend is visible via the existing in-flight disclosure, not silently dropped');
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
