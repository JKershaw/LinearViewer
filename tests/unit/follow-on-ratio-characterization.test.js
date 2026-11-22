/**
 * Characterization of lib/follow-on-ratio.js over one fixed population (LIN-4519, P6 of LIN-4513).
 *
 * Written BEFORE the review-ledger diagnostic was retired, against the unchanged module, and kept green after. It pins
 * every reading the follow-on ratio takes from records or from the issue graph (the headline and its arms, the
 * denominator, the numerator, the matured and plan-scoped instruments, and the diagnostics that stand on their own),
 * so a change to the ledger cannot move any of them without this file saying so. The one comment-dependent reading
 * is not pinned here: it is the subject of follow-on-ratio.test.js (LIN-4519), and the fixture carries review text in
 * a description and in a comment so the independence of the two is exercised, not assumed.
 *
 * The fixture is inline and literal. The expected values were produced by running the pre-change module on it and
 * checked by hand against the pinned definition (see the comments on each source).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFollowOnRatio } from '../../lib/follow-on-ratio.js';
import { planFactsOf, planFactsNotMeasured } from '../../lib/records/plan-facts.js';

const COVERED = '2026-05-01T00:00:00.000Z';
const WINDOW = { windowStart: '2026-06-01T00:00:00.000Z', windowEnd: '2026-07-01T00:00:00.000Z', asOf: '2026-07-01T12:00:00.000Z' };
const PARENT = { id: 'parent-1', identifier: 'LIN-900' };
const stub = (id, identifier) => ({ id, identifier, title: identifier, state: { name: 'Todo', type: 'unstarted' } });
const out = (type, peer) => ({ id: `rel-o-${type}-${peer.id}`, type, relatedIssue: stub(peer.id, peer.identifier) });
const inv = (type, peer) => ({ id: `rel-i-${type}-${peer.id}`, type, issue: stub(peer.id, peer.identifier) });
const issue = (id, identifier, o = {}) => ({
  id, identifier, title: identifier, description: '', state: { name: 'Done', type: 'completed' }, trashed: null,
  createdAt: '2026-05-01T00:00:00.000Z', completedAt: null, parent: null, children: [], comments: [],
  relations: [], inverseRelations: [], ...o,
});
const P1 = { id: 'p1', identifier: 'LIN-201' }, P2 = { id: 'p2', identifier: 'LIN-202' }, P3 = { id: 'p3', identifier: 'LIN-203' };
const P4 = { id: 'p4', identifier: 'LIN-204' }, P5 = { id: 'p5', identifier: 'LIN-205' }, P6 = { id: 'p6', identifier: 'LIN-206' };
const C1 = { id: 'c1', identifier: 'LIN-301' };
const REVIEW = '## Review — LIN-101\n- finding one';

/**
 * The population. s1..s8 are the sources; the rest are peers, a child, and rows the module must refuse.
 * Reading the in-window sources: s1, s2, s3, s8 (s4 is before the window, s5 undated, s6 canceled, s7 trashed).
 */
function population() {
  return [
    // s1: planned; review text in the DESCRIPTION; outgoing P1 twice (one peer), inverse P2 (+15d, outside maturity).
    issue('s1', 'LIN-101', { completedAt: '2026-06-10T00:00:00.000Z', description: REVIEW,
      relations: [out('related', P1), out('related', P1)], inverseRelations: [inv('blocks', P2)] }),
    // s2: not planned; review text in a COMMENT only; duplicate-type excluded; P3 created before completion (no);
    // inverse P4 created after completion (yes, inside maturity).
    issue('s2', 'LIN-102', { completedAt: '2026-06-20T00:00:00.000Z',
      comments: [{ id: 'cm1', body: '## Review — LIN-102\n- finding', createdAt: '2026-06-20T00:00:00.000Z' }],
      relations: [out('duplicate', P1), out('related', P3)], inverseRelations: [inv('related', P4)] }),
    // s3: completed 6 days before the window shuts, so not matured; child C1 excluded; 'Blocks' normalised to P5;
    // a peer with no createdAt is unresolved.
    issue('s3', 'LIN-103', { completedAt: '2026-06-25T00:00:00.000Z', children: [{ id: C1.id, identifier: C1.identifier }],
      relations: [out('blocks', C1), out('Blocks', P5), out('blocks', { id: 'pU', identifier: 'LIN-299' })] }),
    // s4: completed before the window (scale only)
    issue('s4', 'LIN-104', { completedAt: '2026-05-20T00:00:00.000Z', relations: [out('related', P1)] }),
    // s5: state completed, no completedAt: undated
    issue('s5', 'LIN-105', { completedAt: null }),
    // s6: canceled inside the window: not verified-done
    issue('s6', 'LIN-106', { state: { name: 'Canceled', type: 'canceled' }, completedAt: '2026-06-15T00:00:00.000Z' }),
    // s7: trashed although its state reads completed
    issue('s7', 'LIN-107', { trashed: true, completedAt: '2026-06-15T00:00:00.000Z' }),
    // s8: planned; shares a parent with its peer P6 (so the shared-parent arm drops it); P6 created after the window
    issue('s8', 'LIN-108', { completedAt: '2026-06-30T23:00:00.000Z', parent: PARENT, relations: [out('related', P6)] }),
    // peers and the child (state completed by default: they are read as undated completions, counted, and kept out of D)
    issue('p1', 'LIN-201', { createdAt: '2026-06-12T00:00:00.000Z' }),
    issue('p2', 'LIN-202', { createdAt: '2026-06-25T00:00:00.000Z' }),
    issue('p3', 'LIN-203', { createdAt: '2026-06-19T00:00:00.000Z' }),
    issue('p4', 'LIN-204', { createdAt: '2026-06-27T00:00:00.000Z' }),
    issue('p5', 'LIN-205', { createdAt: '2026-06-26T00:00:00.000Z' }),
    issue('p6', 'LIN-206', { createdAt: '2026-07-01T12:00:00.000Z', parent: PARENT }),
    issue('c1', 'LIN-301', { createdAt: '2026-06-26T00:00:00.000Z' }),
    // a row with no id, and a second copy of s1 (deduped on entry)
    { identifier: 'LIN-NOID', state: { type: 'completed' } },
    issue('s1', 'LIN-101', { completedAt: '2026-06-10T00:00:00.000Z', description: REVIEW,
      relations: [out('related', P1), out('related', P1)], inverseRelations: [inv('blocks', P2)] }),
  ];
}

/** Plan facts: s1 and s8 planned, s2 unplanned, s3 not measured (its read failed). */
function planFacts() {
  return new Map([
    ['LIN-101', planFactsOf({ task: { id: 't101', kind: 'task' }, inside: [{ id: 'pl101', v: 1, kind: 'plan', state: 'kept', in: 't101', to: 'implementation' }] })],
    ['LIN-102', planFactsOf({ task: { id: 't102', kind: 'task' } })],
    ['LIN-103', planFactsNotMeasured('store down')],
    ['LIN-108', planFactsOf({ task: { id: 't108', kind: 'task' }, inside: [{ id: 'pl108', v: 1, kind: 'plan', state: 'kept', in: 't108', to: 'implementation' }] })],
  ]);
}

/**
 * The readings this change must NOT move. Stripped, never re-derived: what is removed is exactly the review-ledger
 * diagnostic and the fields that describe it (LIN-4519 retired it; see follow-on-ratio.test.js). Those are the only
 * output fields the change may touch, and each is listed here so it cannot change silently.
 */
function kept(r) {
  const { pctWithReviewLedger, pctWithReviewLedgerReason, ...diagnostics } = r.diagnostics;
  const { reviewLedgerMarker, reviewLedgerMarkerScope, reviewLedger, ...definition } = r.definition;
  return {
    ratio: r.ratio, numerator: r.numerator, denominator: r.denominator, distinctPeers: r.distinctPeers, sufficient: r.sufficient,
    arms: r.arms, matured7d: r.matured7d, planScoped: r.planScoped, primary: r.primary,
    diagnostics, definition, window: r.window, scale: r.scale, completeness: r.completeness,
  };
}

const EXPECTED = {
    "main": {
      "ratio": 1.25,
      "numerator": 5,
      "denominator": 4,
      "distinctPeers": 5,
      "sufficient": false,
      "arms": {
        "causalUnion": {
          "numerator": 5,
          "denominator": 4,
          "distinctPeers": 5,
          "ratio": 1.25,
          "sufficient": false
        },
        "causalOutgoing": {
          "numerator": 3,
          "denominator": 4,
          "distinctPeers": 3,
          "ratio": 0.75,
          "sufficient": false
        },
        "sharedParentExcluded": {
          "numerator": 4,
          "denominator": 4,
          "distinctPeers": 4,
          "ratio": 1,
          "sufficient": false
        }
      },
      "matured7d": {
        "numerator": 2,
        "denominator": 2,
        "distinctPeers": 2,
        "ratio": 1,
        "sufficient": false
      },
      "planScoped": {
        "numerator": 3,
        "denominator": 2,
        "distinctPeers": 3,
        "ratio": 1.5,
        "sufficient": false
      },
      "primary": {
        "numerator": 1,
        "denominator": 1,
        "distinctPeers": 1,
        "ratio": 1,
        "sufficient": false
      },
      "diagnostics": {
        "inWindowCompletions": 4,
        "meanRelationsPerCompleted": 2.25,
        "pctWithAnyRelation": 1,
        "pctPlanned": 0.6666666666666666,
        "plannedMeasured": 3,
        "plannedNotMeasured": 1,
        "plannedNotMeasuredReasons": {
          "store down": 1
        },
        "maturedSources": 2,
        "unresolvedPeers": 1,
        "undated": 9,
        "duplicateInputs": 1,
        "skipped": 1
      },
      "scale": {
        "totalIssues": 16,
        "totalCompleted": 14
      },
      "completeness": {
        "attempted": 18,
        "read": 17,
        "skipped": 1,
        "complete": false
      },
      "definition": {
        "pinnedOn": "LIN-1600",
        "relationTypesCounted": [
          "related",
          "blocks"
        ],
        "excluded": [
          "duplicate relations",
          "sub-issues (children)",
          "reopens"
        ],
        "numeratorRule": "peer.createdAt > source.completedAt",
        "denominatorRule": "state.type === 'completed'",
        "numeratorCounting": "qualifying peers summed per source; distinctPeers reported alongside (LIN-1600 §6(i) open)",
        "relationDirection": "union of outgoing + inverse, deduped by peer id (LIN-1600 §6(ii) open)",
        "maturityDays": 7,
        "plannedRule": "the task has, or had, a plan record or a piece (records; LIN-4504)",
        "plannedCoverageFrom": "2026-05-01T00:00:00.000Z"
      },
      "window": {
        "windowStart": "2026-06-01T00:00:00.000Z",
        "windowEnd": "2026-07-01T00:00:00.000Z",
        "asOf": "2026-07-01T12:00:00.000Z",
        "bounds": "[windowStart, windowEnd)"
      }
    },
    "pre": {
      "ratio": 1.25,
      "numerator": 5,
      "denominator": 4,
      "distinctPeers": 5,
      "sufficient": false,
      "arms": {
        "causalUnion": {
          "numerator": 5,
          "denominator": 4,
          "distinctPeers": 5,
          "ratio": 1.25,
          "sufficient": false
        },
        "causalOutgoing": {
          "numerator": 3,
          "denominator": 4,
          "distinctPeers": 3,
          "ratio": 0.75,
          "sufficient": false
        },
        "sharedParentExcluded": {
          "numerator": 4,
          "denominator": 4,
          "distinctPeers": 4,
          "ratio": 1,
          "sufficient": false
        }
      },
      "matured7d": {
        "numerator": 2,
        "denominator": 2,
        "distinctPeers": 2,
        "ratio": 1,
        "sufficient": false
      },
      "planScoped": {
        "numerator": 0,
        "denominator": 0,
        "distinctPeers": 0,
        "ratio": null,
        "sufficient": false
      },
      "primary": {
        "numerator": 0,
        "denominator": 0,
        "distinctPeers": 0,
        "ratio": null,
        "sufficient": false
      },
      "diagnostics": {
        "inWindowCompletions": 4,
        "meanRelationsPerCompleted": 2.25,
        "pctWithAnyRelation": 1,
        "pctPlanned": null,
        "plannedMeasured": 0,
        "plannedNotMeasured": 4,
        "plannedNotMeasuredReasons": {
          "no plan records before 2026-11-20": 4
        },
        "maturedSources": 2,
        "unresolvedPeers": 1,
        "undated": 9,
        "duplicateInputs": 1,
        "skipped": 0
      },
      "scale": {
        "totalIssues": 16,
        "totalCompleted": 14
      },
      "completeness": {
        "attempted": 17,
        "read": 17,
        "skipped": 0,
        "complete": true
      },
      "definition": {
        "pinnedOn": "LIN-1600",
        "relationTypesCounted": [
          "related",
          "blocks"
        ],
        "excluded": [
          "duplicate relations",
          "sub-issues (children)",
          "reopens"
        ],
        "numeratorRule": "peer.createdAt > source.completedAt",
        "denominatorRule": "state.type === 'completed'",
        "numeratorCounting": "qualifying peers summed per source; distinctPeers reported alongside (LIN-1600 §6(i) open)",
        "relationDirection": "union of outgoing + inverse, deduped by peer id (LIN-1600 §6(ii) open)",
        "maturityDays": 7,
        "plannedRule": "the task has, or had, a plan record or a piece (records; LIN-4504)",
        "plannedCoverageFrom": "2026-11-20T00:00:00.000Z"
      },
      "window": {
        "windowStart": "2026-06-01T00:00:00.000Z",
        "windowEnd": "2026-07-01T00:00:00.000Z",
        "asOf": "2026-07-01T12:00:00.000Z",
        "bounds": "[windowStart, windowEnd)"
      }
    }
  };

describe('characterization: the readings the review-ledger retirement must not move (LIN-4519)', () => {
  test('the headline, arms, companions, planned instruments and kept diagnostics match the pre-change output', () => {
    const r = computeFollowOnRatio(population(), { ...WINDOW, planFacts: planFacts(), planRecordsSince: COVERED, skipped: 1 });
    assert.deepEqual(kept(r), EXPECTED.main);
  });

  test('a window wholly before plan coverage reads every planned instrument as not measured, never 0', () => {
    const r = computeFollowOnRatio(population(), { ...WINDOW, planFacts: planFacts(), planRecordsSince: '2026-11-20T00:00:00.000Z' });
    assert.deepEqual(kept(r), EXPECTED.pre);
  });

  test('the top-level shape is unchanged', () => {
    const r = computeFollowOnRatio(population(), { ...WINDOW, planFacts: planFacts(), planRecordsSince: COVERED });
    assert.deepEqual(Object.keys(r).sort(), [
      'arms', 'codeVersion', 'completeness', 'definition', 'denominator', 'diagnostics', 'distinctPeers',
      'matured7d', 'minDenominator', 'minNumerator', 'numerator', 'planScoped', 'primary', 'ratio', 'scale', 'sufficient', 'window',
    ]);
  });

  test('comment and description text cannot move the denominator or the numerator', () => {
    // The same population with every review text removed: the kept readings are identical. The ledger diagnostic is
    // the only reading that ever read that text, and it is covered in follow-on-ratio.test.js.
    const stripped = population().map((i) => ({ ...i, description: i.description ? '' : i.description, comments: [] }));
    const withText = computeFollowOnRatio(population(), { ...WINDOW, planFacts: planFacts(), planRecordsSince: COVERED });
    const without = computeFollowOnRatio(stripped, { ...WINDOW, planFacts: planFacts(), planRecordsSince: COVERED });
    assert.deepEqual(kept(without), kept(withText));
  });
});
