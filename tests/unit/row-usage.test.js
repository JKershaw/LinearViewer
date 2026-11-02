/** One answer to "what is this row's usage?" (LIN-4134): every cost reader must agree on each lineage. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage } from '../../lib/session-telemetry.js';
import { groupDispatchLineages } from '../../lib/dispatch-lineage.js';
import { reduceLineageCost, computeTerminalMarkedTaskCost } from '../../lib/terminal-marked-task-cost.js';
import { buildTaskCost } from '../../lib/task-cost.js';
import { windowedSpend } from '../../lib/weekly-budget.js';
import { buildRunView } from '../../lib/run-view.js';

const NOW = new Date('2026-11-02T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
// `reported` is the producer's harness stamp (null: none); no `costUsd` leaves the price to the rate card.
const usage = ({ reported = null, costUsd, days, model = 'claude-haiku-5-5', raw }) => ({
  kind: 'usage', timestamp: daysAgo(days).toISOString(),
  message: raw ?? `[usage] ${JSON.stringify({ model, inputTokens: 1000, outputTokens: 100, lane: null,
    ...(reported !== null && { harness: reported }), ...(costUsd !== undefined && { costUsd }) })}`
});
// A dispatch row of lineage `anchor`. `requested` is the REQUESTED harness and must never decide anything.
const row = (id, anchor, requested, days, entries) => ({
  _id: id, id, rootItemId: anchor, issueIdentifier: 'LIN-1', harness: requested, kind: 'implementation',
  status: 'taken', dispatchedAt: daysAgo(days),
  feedback: [...entries, { message: '[done] landed it', timestamp: daysAgo(days - 0.1).toISOString() }]
    .map(e => ({ rootItemId: anchor, ...e }))
});

// `expected` is every reader's figure; `reduceCostUsd` is the reducer's partial figure, when it has one.
const CASES = [
  { name: 'claude-code, one row', oneRow: true, expected: 5, rows: [
    row('c1', 'c1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 }), usage({ reported: 'claude-code', costUsd: 5, days: 2.9 })])] },
  { name: 'claude-code, two rows: last snapshot wins, never summed', expected: 5, rows: [
    row('c2', 'c2', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 })]),
    row('c2b', 'c2', 'claude-code', 2, [usage({ reported: 'claude-code', costUsd: 5, days: 2 })])] },
  { name: 'opencode deltas, one row', oneRow: true, expected: 2, rows: [
    row('o1', 'o1', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 2, days: 3 })])] },
  { name: 'opencode deltas, two rows: summed', expected: 3, rows: [
    row('o2', 'o2', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 })]),
    row('o2b', 'o2', 'opencode', 2, [usage({ reported: 'opencode', costUsd: 2, days: 2 })])] },
  { name: 'requested null, reported opencode, two rows: summed', expected: 3, rows: [
    row('g1', 'g1', null, 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 })]),
    row('g1b', 'g1', null, 2, [usage({ reported: 'opencode', costUsd: 2, days: 2 })])] },
  { name: 'no reported harness, one row: a running total', oneRow: true, expected: 4, rows: [
    row('u1', 'u1', 'claude-code', 3, [usage({ costUsd: 4, days: 3 })])] },
  { name: 'no reported harness, two rows: last-wins', expected: 3, rows: [
    row('u2', 'u2', null, 3, [usage({ costUsd: 1, days: 3 })]),
    row('u2b', 'u2', null, 2, [usage({ costUsd: 3, days: 2 })])] },
  { name: 'requested opencode, reported claude-code, two rows: last-wins', expected: 5, rows: [
    row('m1', 'm1', 'opencode', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 })]),
    row('m1b', 'm1', 'opencode', 2, [usage({ reported: 'claude-code', costUsd: 5, days: 2 })])] },
  { name: 'opencode deltas, one unpriceable: unpriced, never a partial sum', expected: null, reduceCostUsd: 1, rows: [
    row('p1', 'p1', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 })]),
    row('p1b', 'p1', 'opencode', 2, [usage({ reported: 'opencode', days: 2, model: 'unknown-model-zz' })])] },
  { name: 'last usage entry unparseable: no fall-back to an earlier entry', oneRow: true, expected: null, rows: [
    row('x1', 'x1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 }), usage({ raw: '[usage] {not json', days: 2.9 })])] }
];

describe('row usage: one answer, every reader (LIN-4134)', () => {
  for (const c of CASES) {
    test(c.name, () => {
      const rows = c.rows;
      const lineage = groupDispatchLineages(rows).get(rows[0].rootItemId);
      const reduced = reduceLineageCost(lineage);
      const spend = windowedSpend(groupDispatchLineages(rows), daysAgo(30).getTime(), NOW.getTime());
      const got = {
        reduceLineageCost: reduced.costUsd,
        computeTerminalMarkedTaskCost: computeTerminalMarkedTaskCost(rows, NOW).pricedTicketCostUsd,
        buildTaskCost: buildTaskCost({ ownRows: rows }).workerSessions[0].costUsd,
        windowedSpend: spend.pricedCount ? [...spend.byDay.values()].reduce((a, b) => a + b, 0) : null
      };
      for (const [reader, value] of Object.entries(got)) {
        if (reader === 'reduceLineageCost' && c.reduceCostUsd !== undefined) continue;
        assert.equal(value, c.expected, `${reader}: ${c.name}`);
      }
      if (c.reduceCostUsd !== undefined) {
        assert.equal(reduced.costUsd, c.reduceCostUsd, 'the reducer reports the priced part');
        assert.equal(reduced.fullyPriced, false, 'and flags it as not fully priced');
      }
      // The run page reads one loop per row, so it is checked for one-row lineages only: it
      // takes a lineage's LAST loop, not a sum (a documented LIN-4134 leftover).
      if (c.oneRow) {
        const loop = { loopId: rows[0].id, lineageId: rows[0].rootItemId, kind: 'implementation', terminalStatus: 'done',
          dispatchedAt: rows[0].dispatchedAt.toISOString(), telemetry: { usage: parseUsage(rows[0].feedback) } };
        const step = buildRunView({ seedIssue: 'LIN-1', loops: [loop] }, { now: NOW }).steps[0];
        assert.equal(step.cost.status === 'priced' ? step.cost.usd : null, c.expected, `run page: ${c.name}`);
      }
    });
  }
});
