/**
 * LIN-4178 W6 (plan review note 2): the cost card's lineage set and the outcome rate's lineage set, asserted
 * as they are, not as the plan first wrote them.
 *
 * The outcome grouping keeps every non-abort row's lineage, never-ran rows included; the cost population
 * keeps only lineages with a member that ran (`taken`, not an abort). So at any commit the cost set is a
 * subset of the outcome set, and equals the outcome lineages that have at least one member. This file uses
 * only modules that exist at the baseline (9e397e6b), so the same assertion runs there before the change.
 *
 * Run with: node --test tests/unit/cost-read-outcome-sets.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, NOW_MS } from '../fixtures/cost-replay/corpus.js';
import { groupDispatchLineages } from '../../lib/dispatch-lineage.js';
import { groupLineageMembership } from '../../lib/lineage-membership.js';
import { readHorizonStart } from '../../lib/read-horizon.js';

const now = new Date(NOW_MS);
const DAY = 24 * 60 * 60 * 1000;
const windowStart = NOW_MS - 30 * DAY;

/** The horizon rows the public /kpis reads (loadDispatchHistory on the 30-day horizon, kpi-stats.js readSources). */
function horizonRows() {
  const corpus = buildCorpus();
  const since = readHorizonStart(now).getTime();
  return [...corpus.history, ...corpus.queue].filter(row => new Date(row.dispatchedAt).getTime() >= since);
}

describe('W6 (review note 2): the cost card and the outcome rate select the same lineages', () => {
  test('the cost set is a subset of the outcome set, and equals the outcome lineages with a member in the window', () => {
    const rows = horizonRows();
    const outcomes = groupDispatchLineages(rows);
    const members = groupLineageMembership(rows);

    // The cost card's population: a lineage with a member in the window, not skipped (the S11 rule).
    const costSet = new Set();
    for (const [anchor, membership] of members) {
      const start = membership.start;
      if (start === null || start < windowStart || start > NOW_MS) continue;
      if (outcomes.get(anchor)?.status === 'skipped') continue;
      costSet.add(anchor);
    }

    // The outcome rate's lineages that have at least one member in the window, not skipped.
    const outcomeWithMember = new Set();
    for (const anchor of outcomes.keys()) {
      const membership = members.get(anchor);
      if (!membership) continue;
      const start = membership.start;
      if (start === null || start < windowStart || start > NOW_MS) continue;
      if (outcomes.get(anchor).status === 'skipped') continue;
      outcomeWithMember.add(anchor);
    }

    for (const anchor of costSet) assert.ok(outcomes.has(anchor), `cost lineage ${anchor} is in the outcome grouping`);
    assert.deepEqual([...costSet].sort(), [...outcomeWithMember].sort());
    assert.ok(costSet.size > 0, 'the corpus has cost lineages');
  });

  test('the outcome grouping keeps never-ran lineages that the cost set does not (so the subset is strict)', () => {
    const rows = horizonRows();
    const outcomes = groupDispatchLineages(rows);
    const members = groupLineageMembership(rows);
    const neverRan = [...outcomes.keys()].filter(anchor => !members.has(anchor));
    assert.ok(neverRan.length > 0, 'the corpus has a queued (never-ran) lineage');
  });
});
