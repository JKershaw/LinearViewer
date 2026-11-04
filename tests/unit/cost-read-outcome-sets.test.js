/**
 * LIN-4178 W6 (plan review note 2): the cost card's lineage set and the outcome rate's lineage set, asserted
 * as they are, not as the plan first wrote them.
 *
 * The outcome grouping keeps every non-abort row's lineage, never-ran rows included; the cost population
 * keeps only lineages with a member that ran (`taken`, not an abort). So at any commit the cost set is a
 * subset of the outcome set, and equals the outcome lineages that have at least one member.
 *
 * The cost side is the population `computeTerminalMarkedTaskCost` actually summed over (its `countedAnchors`,
 * from terminalMarkedTaskCostDetail), not a rebuild of it. The outcome side is the rate's own dating
 * (`earliest` in the window, `skipped` excluded, as computeDispatchOutcomes reads it). The "has a taken
 * member" side is written out here from the row fields, not from the cost module's grouping, so the test
 * cannot agree with production by sharing its filter.
 *
 * Run with: node --test tests/unit/cost-read-outcome-sets.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorpus, NOW_MS } from '../fixtures/cost-replay/corpus.js';
import { groupDispatchLineages, OUTCOME_WINDOW_DAYS } from '../../lib/dispatch-lineage.js';
import { terminalMarkedTaskCostDetail } from '../../lib/terminal-marked-task-cost.js';
import { readHorizonStart } from '../../lib/read-horizon.js';

const now = new Date(NOW_MS);
const DAY = 24 * 60 * 60 * 1000;
const windowStart = NOW_MS - OUTCOME_WINDOW_DAYS * DAY;

/** The horizon rows the public /kpis reads (loadDispatchHistory on the 30-day horizon, kpi-stats.js readSources). */
function horizonRows() {
  const corpus = buildCorpus();
  const since = readHorizonStart(now).getTime();
  return [...corpus.history, ...corpus.queue].filter(row => new Date(row.dispatchedAt).getTime() >= since);
}

/**
 * The corpus holds no in-window `[skipped]` lineage, so the population's skipped filter would be unwitnessed there
 * (and changing the corpus would move the goldens). This row adds one: a run that was taken, then ended by a human
 * continuing the session (`[skipped]`, LIN-946). It has a taken member, so only the skipped rule keeps it out.
 */
const SKIPPED_ROW = {
  _id: 'sk', id: 'sk', rootItemId: 'sk', issueIdentifier: 'LIN-77', kind: 'implementation', status: 'taken', abort: false,
  dispatchedAt: new Date(NOW_MS - 3 * DAY).toISOString(),
  feedback: [{ kind: 'terminal', timestamp: new Date(NOW_MS - 3 * DAY).toISOString(), message: '[skipped] human-continued session s1 (review)' }],
};

/** The rows the W6 population is read over: the horizon, plus the in-window skipped lineage. */
function populationRows() {
  return [...horizonRows(), SKIPPED_ROW];
}

/** A row's lineage anchor, as lib/lineage-membership.js `anchorOf` reads it. */
const anchorOfRow = row => String(row.rootItemId || row._id || row.id);

/** The lineages the outcome rate counts: `earliest` in the window, and not skipped (computeDispatchOutcomes). */
function outcomeRateLineages(rows) {
  const counted = new Set();
  for (const [anchor, { earliest, status }] of groupDispatchLineages(rows)) {
    if (earliest === null || earliest < windowStart || earliest > NOW_MS) continue;
    if (status === 'skipped') continue;
    counted.add(anchor);
  }
  return counted;
}

/** The lineages with at least one member that ran: a row with status `taken` and no abort. */
function lineagesWithTakenMember(rows) {
  return new Set(rows.filter(row => row.status === 'taken' && row.abort !== true).map(anchorOfRow));
}

describe('W6 (review note 2): the cost card and the outcome rate select the same lineages', () => {
  test('the cost card counts exactly the outcome rate\'s lineages that have a taken member', () => {
    const rows = populationRows();
    const { countedAnchors } = terminalMarkedTaskCostDetail(rows, now);
    const outcomes = outcomeRateLineages(rows);
    const taken = lineagesWithTakenMember(rows);

    for (const anchor of countedAnchors) assert.ok(outcomes.has(anchor), `cost lineage ${anchor} is in the outcome rate`);
    const expected = [...outcomes].filter(anchor => taken.has(anchor));
    assert.deepEqual([...countedAnchors].sort(), expected.sort());
    assert.ok(countedAnchors.size > 0, 'the corpus has cost lineages');
  });

  test('a skipped lineage with a taken member is in neither set (the skipped rule, witnessed)', () => {
    const rows = populationRows();
    const { countedAnchors } = terminalMarkedTaskCostDetail(rows, now);
    assert.equal(groupDispatchLineages(rows).get('sk').status, 'skipped', 'the fixture is an in-window skipped lineage');
    assert.ok(lineagesWithTakenMember(rows).has('sk'), 'and it has a member that ran');
    assert.equal(countedAnchors.has('sk'), false, 'the cost card leaves it out');
    assert.equal(outcomeRateLineages(rows).has('sk'), false, 'the outcome rate leaves it out');
  });

  test('the outcome grouping keeps never-ran lineages that the cost card does not (so the subset is strict)', () => {
    const rows = populationRows();
    const { countedAnchors } = terminalMarkedTaskCostDetail(rows, now);
    const taken = lineagesWithTakenMember(rows);
    const neverRan = [...groupDispatchLineages(rows).keys()].filter(anchor => !taken.has(anchor) && !countedAnchors.has(anchor));
    assert.ok(neverRan.length > 0, 'the corpus has a queued (never-ran) lineage');
  });
});
