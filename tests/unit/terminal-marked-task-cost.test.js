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
import { COST_SHARE_KEYS } from '../../lib/kpi-stats.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY_MS);

const doneMarker = (days) => ({ message: '[done] landed it', timestamp: daysAgo(days).toISOString() });
const skippedMarker = (days) => ({ message: '[skipped] human-continued session (phase)', timestamp: daysAgo(days).toISOString() });

// `harness` is the REPORTED harness on the payload (LIN-4134); it defaults to claude-code.
function usageEntry({ costUsd, lane = null, days, harness = 'claude-code' }) {
  // No reported harness still needs a model: a payload with no recognised field parses to nothing.
  const payload = harness === null ? { model: 'claude-haiku-5-5', lane } : { harness, lane };
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
        feedback: [usageEntry({ costUsd: 1.5, lane: 'api', days: 3, harness: 'opencode' }), doneMarker(2.9)]
      }),
      row({
        id: 'a2', rootItemId: 'a1', issueIdentifier: 'LIN-1', harness: 'opencode', dispatchedAt: daysAgo(2.5),
        feedback: [usageEntry({ costUsd: 2.5, lane: 'api', days: 2.5, harness: 'opencode' }), doneMarker(2.4)]
      })
    ];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.pricedTicketCount, 1);
    assert.equal(result.pricedTicketCostUsd, 4);
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
    assert.equal(result.pricedTicketCostUsd, 5, 'must take the LAST entry (5), not sum (1+5=6)');
  });

});

describe('computeTerminalMarkedTaskCost — unpriced exclusion', () => {
  test('a resolved issue with no usage at all is unpriced, excluded from the sum, never counted as $0', () => {
    const rows = [row({
      id: 'e1', issueIdentifier: 'LIN-5', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)] // done, but no [usage] entry ever posted
    })];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.attributableLineageShare, 1, 'the one lineage ran and is attributed');
    assert.equal(result.pricedTicketCount, 0);
    assert.equal(result.pricedTicketCostUsd, null, 'must be null, never 0, when nothing is priced');
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
    assert.equal(result.pricedTicketCount, 1, 'only the fully priced ticket enters the priced population');
    assert.equal(result.pricedTicketCostUsd, 7, 'the priced issue\'s cost must not be zeroed out by the unpriced sibling');
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
    // Review repro at PR head: the second lineage's $0 contribution was invisible.
    assert.equal(result.pricedTicketCount, 0, 'the partially-priced issue must not enter the priced population');
    assert.equal(result.pricedTicketCostUsd, null, 'a partially-priced issue\'s partial sum must not be presented as its full cost');
  });

  test('F1b: an opencode lineage with one unpriceable row among priced ones must flag unpriced, not silently sum only the priced rows', () => {
    const r1 = row({
      id: 'f1b-1', rootItemId: 'f1b-1', issueIdentifier: 'LIN-101', harness: 'opencode', dispatchedAt: daysAgo(3),
      feedback: [usageEntry({ costUsd: 1, lane: 'api', days: 3, harness: 'opencode' })]
    });
    const r2 = row({
      id: 'f1b-2', rootItemId: 'f1b-1', issueIdentifier: 'LIN-101', harness: 'opencode', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ lane: 'api', days: 2, harness: 'opencode' })] // no costUsd, no model — unpriceable
    });
    const r3 = row({
      id: 'f1b-3', rootItemId: 'f1b-1', issueIdentifier: 'LIN-101', harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 2, lane: 'api', days: 1, harness: 'opencode' }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([r1, r2, r3], NOW);
    // Review repro at PR head: the middle row's failure to price was invisible.
    assert.equal(result.pricedTicketCount, 0, 'a lineage with any unpriceable row must not enter the priced population');
    assert.equal(result.pricedTicketCostUsd, null, 'a partially-priced lineage\'s partial sum must not be presented as its full cost');
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
    // Review repro at PR head: the whole lineage vanished, numerator and
    // denominator both, with no trace.
    assert.equal(result.pricedTicketCount, 1, 'plan: issueIdentifier must be set from any row carrying one, not just the earliest');
    assert.equal(result.pricedTicketCostUsd, 9);
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
    assert.equal(forward.pricedTicketCostUsd, reversed.pricedTicketCostUsd, 'rowUsage order must not change the last-wins result');
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
    assert.equal(result.pricedTicketCount, 1, 'lineage count is 2, but the ticket count is 1: both lineages deliver the same ticket');
    assert.equal(result.pricedTicketCostUsd, 5, 'both lineages\' cost sums into the one ticket');
  });
});

describe('computeTerminalMarkedTaskCost — zero-T degradation', () => {
  test('an empty instance degrades every share and the priced figure to null, never NaN, never 0', () => {
    const result = computeTerminalMarkedTaskCost([], NOW);
    // A count is a genuine 0; the figures and the shares over T are null.
    assert.equal(result.pricedTicketCount, 0);
    assert.equal(result.pricedTicketCostUsd, null);
    assert.equal(result.closeOutLineageShare, null);
    assert.equal(result.evidenceLinkedShare, null);
    assert.equal(result.opencodeSummedShare, null);
    assert.equal(result.unknownHarnessShare, null);
    assert.equal(result.pricedLineageShare, null);
    assert.equal(result.attributableLineageShare, null);
    assert.equal(result.captureRateShare, null);
    for (const key of [
      'pricedTicketCostUsd', 'closeOutLineageShare', 'evidenceLinkedShare',
      'opencodeSummedShare', 'unknownHarnessShare',
      'pricedLineageShare', 'attributableLineageShare', 'captureRateShare',
      'pricedTicketCount'
    ]) {
      assert.ok(!Number.isNaN(result[key]), `${key} must not be NaN`);
    }
  });

  test('a lineage with no terminal marker (unresolved) contributes nothing — T stays 0', () => {
    const rows = [row({
      id: 'k1', issueIdentifier: 'LIN-13', harness: 'claude-code', dispatchedAt: daysAgo(1), feedback: []
    })];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.closeOutLineageShare, null, 'T stays 0, so every share is null');
    assert.equal(result.pricedTicketCount, 0);
    assert.equal(result.pricedTicketCostUsd, null);
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

  test('unknownHarnessShare reflects issues whose usage reports no harness (LIN-4134: the reported harness, not the requested one)', () => {
    const known = row({
      id: 'n1', issueIdentifier: 'LIN-18', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const unknown = row({
      id: 'n2', issueIdentifier: 'LIN-19', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1, harness: null }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([known, unknown], NOW);
    assert.equal(result.unknownHarnessShare, 0.5);
  });

  test('opencodeSummedShare reflects issues whose lineage used the sum reduce', () => {
    const opencode = row({
      id: 'o1', issueIdentifier: 'LIN-20', harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, lane: 'api', days: 1, harness: 'opencode' }), doneMarker(0.9)]
    });
    const claude = row({
      id: 'o2', issueIdentifier: 'LIN-21', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 1 }), doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([opencode, claude], NOW);
    assert.equal(result.opencodeSummedShare, 0.5);
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
      feedback: [usageEntry({ costUsd: 2, lane: 'api', days: 1, harness: 'opencode' }), usageEntry({ lane: 'api', days: 0.5, harness: 'opencode' }), doneMarker(0.4)]
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

  test('a `[skipped]` lineage is benign and counts toward neither ranLineages nor attributableLineageShare — same exclusion computeDispatchOutcomes applies', () => {
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
  });

  test('realistic proportions (round 2 ledger row 6): when most done issues have a partially-priced lineage, the priced figure covers a visibly small minority of T', () => {
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
        usageEntry({ costUsd: 3, lane: 'api', days: 1, harness: 'opencode' }),
        usageEntry({ lane: 'api', days: 0.7, harness: 'opencode' }), // unpriceable turn
        doneMarker(0.6)
      ]
    });
    const rows = [clean, partial(1), partial(2), partial(3), partial(4)];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.pricedTicketCount, 1, '4 of 5 tickets are excluded from the priced population');
    assert.equal(result.pricedTicketCostUsd, 8, 'the priced figure is computed over the ONE fully-priced ticket — a small-sample figure presented as the headline');
    assert.equal(result.pricedLineageShare, 0.2, 'declared coverage makes the small-sample risk visible: only 1 of 5 usage-bearing lineages is fully priced');
    assert.equal(result.attributableLineageShare, 1, 'all 5 ran lineages carry an issueIdentifier in this fixture');
  });

  test('zero usage-bearing lineages degrades pricedLineageShare to null, never NaN/0 (distinct from the T-wide zero-T case)', () => {
    const neverPosted = row({
      id: 'aa1', issueIdentifier: 'LIN-400', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.9)]
    });
    const result = computeTerminalMarkedTaskCost([neverPosted], NOW);
    assert.equal(result.closeOutLineageShare, 0, 'T is non-zero: a real 0, not null');
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
  test('a worker-lane lineage\'s OTHER done tickets are counted as priced tickets, and the lane\'s spend is never split between them', () => {
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

    assert.equal(result.pricedTicketCount, 3, 'the anchor plus the two lane-landed tickets');
    assert.equal(result.pricedTicketCostUsd, 12, 'the lane\'s spend is counted once, not split per landed ticket');
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
    assert.equal(result.pricedTicketCount, 1, 'blocked/refused tickets never landed — only the anchor counts');
  });

  test('a lane-landed ticket that ALSO has its own separate lineage is not double-counted', () => {
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
    assert.equal(result.pricedTicketCount, 2, 'LIN-820 and LIN-821 — LIN-821 counted once, though its own lineage and the lane both name it');
    assert.equal(result.pricedTicketCostUsd, 11, '8 (LIN-820) + 3 (LIN-821 own lineage) — never LIN-821 counted or priced twice');
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
    assert.equal(result.pricedTicketCount, 0, 'an unresolved lineage contributes nothing, same as before LIN-2253');
    assert.equal(result.closeOutLineageShare, null, 'and no ticket reaches T');
  });

  test('review fix: a lane-landed ticket whose OWN anchor lineage is still in-flight is counted once, through its lane', () => {
    // The adversarial case the LIN-2253 review caught: `issues` is populated
    // ONLY from DONE lineages, so a naive `issues.has(identifier)` check
    // cannot see an in-flight (unresolved) anchor lineage and would
    // misclassify LIN-841 as noLineage — conflating "has a lineage, still
    // running" (an in-flight disclosure, not this one) with "no lineage at all"
    // (this ticket's actual mechanism).
    const laneA = row({
      id: 'laneA', issueIdentifier: 'LIN-840', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [
        usageEntry({ costUsd: 5, days: 1.5 }),
        { kind: 'evidence', message: 'evidence', timestamp: daysAgo(1.4).toISOString() },
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
    assert.equal(result.pricedTicketCount, 2, 'LIN-840 and LIN-841 — LIN-841 is counted once, through the lane that landed it');
    assert.equal(result.pricedTicketCostUsd, 5, 'LIN-841\'s in-flight spend stays out of the priced figure — its own lineage has not resolved, and it is not folded in');
    // T is one ticket here (LIN-840): LIN-841 has an anchor of its own, so the
    // lane-landed reconciliation must not add it to T a second time.
    assert.equal(result.evidenceLinkedShare, 1, 'T is 1: the evidenced anchor is the whole denominator');
  });
});

describe('computeTerminalMarkedTaskCost — LIN-2418: denominator excludes noLineage issues', () => {
  // Fixture per the ticket's own Measured table: one lane whose anchor
  // (LIN-9000) runs on an unknown harness (and also lands N no-lineage
  // extras as its worker-lane ticket walk), plus one separate `opencode`
  // anchor (LIN-9001). Base fleet (N=0) is exactly these two anchors, so
  // base.pricedTicketCount === 2, one per anchor.
  function buildFleet(n) {
    const laneExtras = [];
    for (let i = 0; i < n; i++) {
      laneExtras.push(ticketMarker(`LIN-92${String(i).padStart(2, '0')}`, 'done', 1));
    }
    const lane = row({
      id: 'lin2418-lane', issueIdentifier: 'LIN-9000', harness: null, dispatchedAt: daysAgo(2),
      feedback: [
        usageEntry({ costUsd: 10, days: 1.5, harness: null }),
        ticketMarker('LIN-9000', 'done', 1.2),
        ...laneExtras,
        doneMarker(0.8)
      ]
    });
    const opencodeAnchor = row({
      id: 'lin2418-opencode', issueIdentifier: 'LIN-9001', harness: 'opencode', dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 5, lane: 'api', days: 0.9, harness: 'opencode' }), doneMarker(0.5)]
    });
    return [lane, opencodeAnchor];
  }

  test('P1 — unknownHarnessShare/opencodeSummedShare are invariant under a growing noLineage population', () => {
    const base = computeTerminalMarkedTaskCost(buildFleet(0), NOW);

    const results = [0, 2, 23].map(n => ({ n, result: computeTerminalMarkedTaskCost(buildFleet(n), NOW) }));

    // Mandatory non-vacuity guard: without this, a degenerate "fix" that
    // simply stops counting lane-landed tickets in T would pass the
    // invariance assertions below and silently undo LIN-2253.
    for (const { n, result } of results) {
      assert.equal(result.pricedTicketCount, base.pricedTicketCount + n, `pricedTicketCount must grow by N at N=${n}`);
    }

    const [n0, n2, n23] = results;
    assert.equal(n2.result.unknownHarnessShare, n0.result.unknownHarnessShare, 'unknownHarnessShare must not move as noLineage tickets are added (N=2 vs N=0)');
    assert.equal(n23.result.unknownHarnessShare, n0.result.unknownHarnessShare, 'unknownHarnessShare must not move as noLineage tickets are added (N=23 vs N=0)');
    assert.equal(n2.result.opencodeSummedShare, n0.result.opencodeSummedShare, 'opencodeSummedShare must not move as noLineage tickets are added (N=2 vs N=0)');
    assert.equal(n23.result.opencodeSummedShare, n0.result.opencodeSummedShare, 'opencodeSummedShare must not move as noLineage tickets are added (N=23 vs N=0)');

    // LIN-2419: absolute anchors, so this fixture pins WHICH truthful value
    // it is invariant at, not just that it doesn't move. The two-anchor base
    // fleet is LIN-9000 (harness: null — provenance UNKNOWN for
    // opencodeSummed, known-true for unknownHarness) and LIN-9001 (harness:
    // 'opencode' — known-true for opencodeSummed, known-false for
    // unknownHarness). opencodeSummedShare's known population is LIN-9001
    // alone (1/1 = 1), a truthful narrowing from the pre-LIN-2419 0.5 that
    // silently treated LIN-9000's unknown provenance as a known "not
    // opencode-summed". unknownHarnessShare's known population is both
    // anchors (1/2 = 0.5) — unchanged from the old LIN-2418 outcome.
    assert.equal(n0.result.opencodeSummedShare, 1, 'of the one issue whose harness is known, all of it was opencode-summed');
    assert.equal(n0.result.unknownHarnessShare, 0.5, 'must match the pre-LIN-2419 LIN-2418 outcome exactly');
  });

  test('P1b (LIN-2419) — opencodeSummedShare stays truthful as unknown-harness (but lineage-bearing) anchors grow; the regression LIN-2418 never covered', () => {
    // Fleet: 1 opencode anchor + 1 claude-code anchor + M lineage-bearing
    // anchors with harness: null, and ZERO noLineage tickets anywhere — this
    // is the dimension LIN-2418's exclusion never touched (it only ever
    // excluded lane-landed, no-lineage tickets). At HEAD (pre-LIN-2419) this
    // fixture collapses opencodeSummedShare 0.5 -> 0.25 -> 0.04 across
    // M = 0 -> 2 -> 23 — the same 12.5x dilution LIN-2253 Rev 2's R1 finding
    // measured, live on `main` today with no lane-landed ticket in sight.
    function buildFleet(m) {
      const opencodeAnchor = row({
        id: 'p1b-opencode', issueIdentifier: 'LIN-9400', harness: 'opencode', dispatchedAt: daysAgo(2),
        feedback: [usageEntry({ costUsd: 1, lane: 'api', days: 1.9, harness: 'opencode' }), doneMarker(1.8)]
      });
      const claudeAnchor = row({
        id: 'p1b-claude', issueIdentifier: 'LIN-9401', harness: 'claude-code', dispatchedAt: daysAgo(2),
        feedback: [usageEntry({ costUsd: 1, days: 1.9 }), doneMarker(1.8)]
      });
      const unknownAnchors = [];
      for (let i = 0; i < m; i++) {
        const id = `LIN-95${String(i).padStart(2, '0')}`;
        unknownAnchors.push(row({
          id: `p1b-unknown-${i}`, issueIdentifier: id, harness: null, dispatchedAt: daysAgo(1),
          feedback: [usageEntry({ costUsd: 1, days: 0.9, harness: null }), doneMarker(0.8)]
        }));
      }
      return [opencodeAnchor, claudeAnchor, ...unknownAnchors];
    }

    const results = [0, 2, 23].map(m => ({ m, result: computeTerminalMarkedTaskCost(buildFleet(m), NOW) }));

    for (const { m, result } of results) {
      // Non-vacuity: this must be a lineage-bearing population growing, not
      // the LIN-2418 lane-landed one — a "fix" that only re-implements
      // LIN-2418's exclusion cannot satisfy this and the share assertion
      // below at the same time.
      assert.equal(result.pricedTicketCount, 2 + m, `pricedTicketCount must grow by M at M=${m}`);
      assert.equal(result.opencodeSummedShare, 0.5, `opencodeSummedShare must stay truthful (1 of 2 known-harness anchors) at M=${m} — HEAD collapses this to 0.5/0.25/0.04`);
    }

    // Co-assertion the fixture is genuinely live and the two shares are
    // independent: unknownHarnessShare DOES move as the unknown-harness
    // population grows (it is denominated over ALL lineage-bearing issues,
    // known-harness and unknown-harness alike), unlike opencodeSummedShare
    // (denominated only over the known-harness subset).
    const [m0, m2, m23] = results;
    assert.equal(m0.result.unknownHarnessShare, 0, 'M=0: no unknown-harness anchors yet');
    assert.equal(m2.result.unknownHarnessShare, 0.5, 'M=2: 2 of 4 anchors are unknown-harness');
    assert.equal(m23.result.unknownHarnessShare, 0.92, 'M=23: 23 of 25 anchors are unknown-harness');
  });

  test('LIN-2419 fold — an issue carrying both an opencode lineage and a null-harness lineage stays known-true for opencodeSummed, never demoted to unknown', () => {
    // Pins Kleene strong-OR against the rejected "unknown dominates true"
    // variant: a genuinely known approximation must never be demoted to
    // unknown by a sibling lineage's ignorance.
    // Two SEPARATE lineages (distinct rootItemId) sharing one issueIdentifier
    // — an issue can carry more than one DONE lineage (module doc, `:203-206`)
    // — not two rows merged into one lineage (a single lineage's harness is
    // captured from its earliest row only, kpi-stats.js `:515-521`, so two
    // rows under one rootItemId could never disagree on harness).
    const opencodeLineage = row({
      id: 'fold-opencode', rootItemId: 'fold-opencode', issueIdentifier: 'LIN-9600', harness: 'opencode', dispatchedAt: daysAgo(2),
      feedback: [usageEntry({ costUsd: 1, lane: 'api', days: 1.9, harness: 'opencode' }), doneMarker(1.8)]
    });
    const unknownLineage = row({
      id: 'fold-unknown', rootItemId: 'fold-unknown', issueIdentifier: 'LIN-9600', harness: null, dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 0.9, harness: null }), doneMarker(0.8)]
    });
    const control = row({
      id: 'fold-control', issueIdentifier: 'LIN-9601', harness: null, dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 0.9, harness: null }), doneMarker(0.8)]
    });
    const result = computeTerminalMarkedTaskCost([opencodeLineage, unknownLineage, control], NOW);

    assert.equal(result.pricedTicketCount, 2, 'non-vacuity: two distinct tickets, one mixed-lineage and one control');
    // The mixed issue (LIN-9600) is known-opencode-summed; the control
    // (LIN-9601, harness: null only) is unknown — so the known population is
    // exactly {LIN-9600}, and it is a known true.
    assert.equal(result.opencodeSummedShare, 1, 'the mixed issue must count as known-true, not unknown — Kleene OR, true dominates');
  });

  test('P2 — a fleet where every issue is noLineage publishes null, never 0, for both shares', () => {
    // A bare worker-lane kickoff with no issueIdentifier on the dispatch row
    // (legal: ticketMarkers are harvested before the issue-less `continue`)
    // lands 3 tickets whose own lineage never existed — T is entirely
    // noLineage, so the denominator this ticket fixes is exactly 0.
    const bareLane = row({
      id: 'lin2418-bare-lane', issueIdentifier: undefined, harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [
        ticketMarker('LIN-9300', 'done', 0.9),
        ticketMarker('LIN-9301', 'done', 0.9),
        ticketMarker('LIN-9302', 'done', 0.9),
        doneMarker(0.8)
      ]
    });
    const result = computeTerminalMarkedTaskCost([bareLane], NOW);

    assert.equal(result.closeOutLineageShare, 0, 'non-vacuity: T is 3 (all lane-landed), so this share is a real 0, not null');

    // `!== 0` is explicitly not sufficient — the distinction between a
    // genuine 0 and an absent value is the point (the render-side pin went
    // with the public cost card in LIN-3703).
    assert.equal(result.unknownHarnessShare, null, 'must be null, not 0, over a population the system knows nothing about');
    assert.equal(result.opencodeSummedShare, null, 'must be null, not 0, over a population the system knows nothing about');
  });

  test('P2b (LIN-2419) — every issue HAS a lineage, but none declares a harness: opencodeSummedShare publishes null, never a confident 0', () => {
    // The other decisive shape the ticket names: at HEAD (pre-LIN-2419) this
    // fleet publishes opencodeSummedShare: 0 — a definite "no approximation
    // anywhere" — beside unknownHarnessShare: 1, two mutually contradictory
    // claims about the same population's provenance. Every issue here has a
    // real lineage (no lane-landed ticket, unlike P2 above), so the old
    // `lineageBearingCount` denominator would have included every one of
    // them and averaged their known-false-by-seed opencodeSummed into a
    // false, confident 0.
    const anchors = [0, 1, 2].map(i => row({
      id: `p2b-${i}`, issueIdentifier: `LIN-97${String(i).padStart(2, '0')}`, harness: null, dispatchedAt: daysAgo(1),
      feedback: [usageEntry({ costUsd: 1, days: 0.9, harness: null }), doneMarker(0.8)]
    }));
    const result = computeTerminalMarkedTaskCost(anchors, NOW);

    assert.equal(result.pricedTicketCount, 3, 'non-vacuity: three anchored tickets, each with a real lineage — this is NOT the P2 shape');
    assert.equal(result.unknownHarnessShare, 1, 'every declared lineage has no harness — a genuine, known 1');
    assert.equal(result.opencodeSummedShare, null, 'must be null — the system has no known-harness issue to say yes or no about, never a confident 0');
  });
});

describe('computeTerminalMarkedTaskCost — LIN-2253 (narrowed): pricedTicketCount', () => {
  test('degenerate no-lane regression: with no lanes, each anchor is its own one-ticket component', () => {
    const rows = [
      row({
        id: 'deg1', issueIdentifier: 'LIN-960', harness: 'claude-code', dispatchedAt: daysAgo(1),
        feedback: [usageEntry({ costUsd: 4, days: 1 }), doneMarker(0.9)]
      }),
      row({
        id: 'deg2', issueIdentifier: 'LIN-961', harness: 'claude-code', dispatchedAt: daysAgo(1),
        feedback: [usageEntry({ costUsd: 6, days: 1 }), doneMarker(0.9)]
      })
    ];
    const result = computeTerminalMarkedTaskCost(rows, NOW);
    assert.equal(result.pricedTicketCount, 2, 'no lane tickets exist, so every anchor founds its own single-ticket component');
    assert.equal(result.pricedTicketCostUsd, 10);
  });

  test('lane pricing: an anchor + 3 lane-landed tickets, all priced through the one lineage, counts all 4 tickets', () => {
    const lane = row({
      id: 'lane-pricing', issueIdentifier: 'LIN-970', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [
        usageEntry({ costUsd: 20, days: 1.5 }),
        ticketMarker('LIN-970', 'done', 1.3),
        ticketMarker('LIN-971', 'done', 1.2),
        ticketMarker('LIN-972', 'done', 1.1),
        ticketMarker('LIN-973', 'done', 1),
        doneMarker(0.9)
      ]
    });
    const result = computeTerminalMarkedTaskCost([lane], NOW);
    assert.equal(result.pricedTicketCount, 4, 'the anchor plus its 3 lane-landed tickets — never lane ÷ 1');
    assert.equal(result.pricedTicketCostUsd, 20, 'the one lineage\'s cost is counted once across its four tickets');
  });

  test('component transitivity: a lane sharing a ticket with a NOT-fully-priced lineage excludes the WHOLE component, not just the unpriced half', () => {
    const lane = row({
      id: 'transitivity-lane', issueIdentifier: 'LIN-980', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [
        usageEntry({ costUsd: 6, days: 1.5 }),
        ticketMarker('LIN-980', 'done', 1.2),
        ticketMarker('LIN-981', 'done', 1),
        doneMarker(0.9)
      ]
    });
    // LIN-981 ALSO has its own separate lineage — DONE, but never priced.
    const unpricedOwnLineage = row({
      id: 'transitivity-own981', rootItemId: 'transitivity-own981', issueIdentifier: 'LIN-981', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.8)] // no usage posted at all
    });
    const result = computeTerminalMarkedTaskCost([lane, unpricedOwnLineage], NOW);
    assert.equal(result.pricedTicketCount, 0, 'the merged {LIN-980, LIN-981} component has an unpriced member, so NEITHER ticket counts — never a partial numerator over a full-weight denominator');
    assert.equal(result.pricedTicketCostUsd, null, 'no included component to sum over');
  });

});

describe('computeTerminalMarkedTaskCost — LIN-2253 review F1 (Request Changes): headline numerator/denominator population parity', () => {
  test('pricedTicketCostUsd is null when the only component is excluded — the headline must go dark, not read a stale number', () => {
    const lane = row({
      id: 'f1-blackout-lane', issueIdentifier: 'LIN-9410', harness: 'claude-code', dispatchedAt: daysAgo(2),
      feedback: [
        usageEntry({ costUsd: 6, days: 1.5 }),
        ticketMarker('LIN-9410', 'done', 1.2),
        ticketMarker('LIN-9411', 'done', 1),
        doneMarker(0.9)
      ]
    });
    const unpricedOwnLineage = row({
      id: 'f1-blackout-own', rootItemId: 'f1-blackout-own', issueIdentifier: 'LIN-9411', harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [doneMarker(0.8)] // DONE, no usage ever posted
    });
    const result = computeTerminalMarkedTaskCost([lane, unpricedOwnLineage], NOW);
    assert.equal(result.pricedTicketCount, 0, 'the merged {LIN-9410, LIN-9411} component has an unpriced member, so it is excluded');
    assert.equal(result.pricedTicketCostUsd, null, 'the headline numerator must be null here — NOT costUsd\'s 6 — there is no included component to attribute it to');
  });

  test('contaminated vs. control: a sibling\'s own unpriced lineage must not let its excluded component\'s spend leak into the headline numerator', () => {
    // Contaminated: LIN-9420's lane lands LIN-9421, which ALSO has its own
    // separate, unpriced lineage — the whole {LIN-9420,LIN-9421} component is excluded
    // from pricedTicketCount, but F20's $6 stays in the per-issue-fold
    // costUsd via its own anchor issue (a DIFFERENT inclusion rule). Three
    // clean, $10-each anchors sit alongside it, never merged into any lane —
    // the true cost of every INCLUDED ticket is exactly $10.
    function buildFleet({ contaminated }) {
      const lane = row({
        id: 'f1-c-lane', issueIdentifier: 'LIN-9420', harness: 'claude-code', dispatchedAt: daysAgo(2),
        feedback: [
          usageEntry({ costUsd: 6, days: 1.5 }),
          ticketMarker('LIN-9420', 'done', 1.2),
          ticketMarker('LIN-9421', 'done', 1),
          doneMarker(0.9)
        ]
      });
      const rows = [lane];
      if (contaminated) {
        rows.push(row({
          id: 'f1-c-own', rootItemId: 'f1-c-own', issueIdentifier: 'LIN-9421', harness: 'claude-code', dispatchedAt: daysAgo(1),
          feedback: [doneMarker(0.8)] // DONE, no usage ever posted — the contaminating sibling
        }));
      }
      for (const n of [1, 2, 3]) {
        rows.push(row({
          id: `f1-c-clean${n}`, issueIdentifier: `LIN-F3${n}`, harness: 'claude-code', dispatchedAt: daysAgo(1),
          feedback: [usageEntry({ costUsd: 10, days: 1 }), doneMarker(0.9)]
        }));
      }
      return rows;
    }

    const contaminated = computeTerminalMarkedTaskCost(buildFleet({ contaminated: true }), NOW);
    // pricedTicketCount (component fold): the {LIN-9420,LIN-9421} component is
    // excluded (F21's own lineage is unpriced) — only the 3 clean singleton
    // components count.
    assert.equal(contaminated.pricedTicketCount, 3);
    // The fix: pricedTicketCostUsd sums ONLY the INCLUDED components — the 3
    // clean anchors' $30, never F20's excluded $6 — so the headline reads
    // the true $10.00/ticket rate the clean population actually costs.
    assert.equal(contaminated.pricedTicketCostUsd, 30);
    assert.equal(contaminated.pricedTicketCostUsd / contaminated.pricedTicketCount, 10);

    const control = computeTerminalMarkedTaskCost(buildFleet({ contaminated: false }), NOW);
    // Control: LIN-9421 has no lineage of its own at all, so the {LIN-9420,LIN-9421}
    // component has only ONE member lineage (F20's, fully priced) — the
    // component IS included, contributing both of its tickets.
    assert.equal(control.pricedTicketCount, 5, '{LIN-9420,LIN-9421} (2 tickets) plus 3 clean singletons');
    assert.equal(control.pricedTicketCostUsd, 36, 'uncontaminated: the lane and its three clean anchors are all included');
  });
});

describe('computeTerminalMarkedTaskCost — LIN-2253 review F4: issue-less overhead lineages must never join a priced component', () => {
  test('an issue-less DONE lineage with [ticket] markers never founds or joins a priced component, so its landed tickets never enter pricedTicketCount/pricedTicketCostUsd', () => {
    // The invariant is enforced only by statement ordering in the
    // implementation (the component-eligible push happens strictly after
    // the issue-less `continue`) — this fixture is the regression guard the
    // review found unpinned (mutation M6 survived): reordering those two
    // lines must break this test.
    const bareLane = row({
      id: 'f4-bare-lane', issueIdentifier: undefined, harness: 'claude-code', dispatchedAt: daysAgo(1),
      feedback: [
        usageEntry({ costUsd: 15, days: 0.95 }),
        ticketMarker('LIN-9440', 'done', 0.9),
        ticketMarker('LIN-9441', 'done', 0.9),
        doneMarker(0.8)
      ]
    });
    const result = computeTerminalMarkedTaskCost([bareLane], NOW);
    assert.equal(result.closeOutLineageShare, 0, 'both landed tickets are in T (a real 0, not null), per the existing ticket-marker walk');
    assert.equal(result.pricedTicketCount, 0, 'the issue-less lineage must never found or join a priced component');
    assert.equal(result.pricedTicketCostUsd, null, 'no included component exists to attribute any cost to');
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

describe('computeTerminalMarkedTaskCost — output contract (LIN-4129)', () => {
  // Every key here is either published (the /kpis cost block reads windowDays,
  // pricedTicketCount, pricedTicketCostUsd and COST_SHARE_KEYS) or a shares
  // denominator's own input. A new field must be published or this test says so.
  test('the output carries exactly the published keys, and no other', () => {
    const keys = Object.keys(computeTerminalMarkedTaskCost([], NOW)).sort();
    assert.deepEqual(keys, ['windowDays', 'pricedTicketCount', 'pricedTicketCostUsd', ...COST_SHARE_KEYS].sort());
  });
});
