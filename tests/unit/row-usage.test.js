/**
 * One answer to "how does a lineage's usage add up?" (LIN-4134, LIN-4136): every cost reader must
 * agree on each lineage, and the run page is checked on the same rows as the others.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, readRowUsage } from '../../lib/session-telemetry.js';
import { groupDispatchLineages, joinCostLineages } from '../../lib/dispatch-lineage.js';
import { reduceLineageCost, computeTerminalMarkedTaskCost } from '../../lib/terminal-marked-task-cost.js';
import { buildTaskCost } from '../../lib/task-cost.js';
import { windowedSpend } from '../../lib/weekly-budget.js';
import { buildRunView } from '../../lib/run-view.js';
import { foldLineageUsage } from '../../lib/row-usage.js';

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

// `expected` is every reader's figure, the run page's included. `null` means not reported.
const CASES = [
  { name: 'claude-code, one row', expected: 5, rows: [
    row('c1', 'c1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 }), usage({ reported: 'claude-code', costUsd: 5, days: 2.9 })])] },
  { name: 'claude-code, two rows: last snapshot wins, never summed', expected: 5, rows: [
    row('c2', 'c2', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 })]),
    row('c2b', 'c2', 'claude-code', 2, [usage({ reported: 'claude-code', costUsd: 5, days: 2 })])] },
  { name: 'opencode deltas, one row', expected: 2, rows: [
    row('o1', 'o1', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 2, days: 3 })])] },
  { name: 'opencode, one row with two usage entries: the row counts its last entry', expected: 2, rows: [
    row('o3', 'o3', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 }), usage({ reported: 'opencode', costUsd: 2, days: 2.9 })])] },
  { name: 'opencode deltas, two rows: summed', expected: 3, rows: [
    row('o2', 'o2', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 })]),
    row('o2b', 'o2', 'opencode', 2, [usage({ reported: 'opencode', costUsd: 2, days: 2 })])] },
  { name: 'requested null, reported opencode, two rows: summed', expected: 3, rows: [
    row('g1', 'g1', null, 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 })]),
    row('g1b', 'g1', null, 2, [usage({ reported: 'opencode', costUsd: 2, days: 2 })])] },
  { name: 'no reported harness, one row: a running total', expected: 4, rows: [
    row('u1', 'u1', 'claude-code', 3, [usage({ costUsd: 4, days: 3 })])] },
  { name: 'no reported harness, two rows: last-wins', expected: 3, rows: [
    row('u2', 'u2', null, 3, [usage({ costUsd: 1, days: 3 })]),
    row('u2b', 'u2', null, 2, [usage({ costUsd: 3, days: 2 })])] },
  { name: 'requested opencode, reported claude-code, two rows: last-wins', expected: 5, rows: [
    row('m1', 'm1', 'opencode', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 })]),
    row('m1b', 'm1', 'opencode', 2, [usage({ reported: 'claude-code', costUsd: 5, days: 2 })])] },
  { name: 'delta, then a running total: the snapshot and the delta both count', expected: 6, rows: [
    row('d1', 'd1', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 })]),
    row('d1b', 'd1', 'claude-code', 2, [usage({ reported: 'claude-code', costUsd: 5, days: 2 })])] },
  { name: 'running total, then a delta: the last snapshot and the delta both count', expected: 6, rows: [
    row('r1', 'r1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 })]),
    row('r1b', 'r1', 'opencode', 2, [usage({ reported: 'opencode', costUsd: 5, days: 2 })])] },
  { name: 'two snapshots then a delta: only the last snapshot counts with the delta', expected: 8, rows: [
    row('s1', 's1', 'claude-code', 4, [usage({ reported: 'claude-code', costUsd: 1, days: 4 })]),
    row('s1b', 's1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 3, days: 3 })]),
    row('s1c', 's1', 'opencode', 2, [usage({ reported: 'opencode', costUsd: 5, days: 2 })])] },
  { name: 'opencode: an unpriced delta, then a priced one: unpriced, never a partial sum', expected: null, rows: [
    row('p2', 'p2', 'opencode', 3, [usage({ reported: 'opencode', days: 3, model: 'unknown-model-zz' })]),
    row('p2b', 'p2', 'opencode', 2, [usage({ reported: 'opencode', costUsd: 2, days: 2 })])] },
  { name: 'opencode deltas, one unpriceable: unpriced, never a partial sum', expected: null, rows: [
    row('p1', 'p1', 'opencode', 3, [usage({ reported: 'opencode', costUsd: 1, days: 3 })]),
    row('p1b', 'p1', 'opencode', 2, [usage({ reported: 'opencode', days: 2, model: 'unknown-model-zz' })])] },
  { name: 'last usage entry unparseable: no fall-back to an earlier entry', expected: null, rows: [
    row('x1', 'x1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 }), usage({ raw: '[usage] {not json', days: 2.9 })])] },
  { name: 'last row unreadable, an earlier snapshot before it: not the stale snapshot', expected: null, rows: [
    row('l1', 'l1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 })]),
    row('l1b', 'l1', 'claude-code', 2, [usage({ raw: '[usage] {not json', days: 2 })])] },
  { name: 'unreadable row, then a running total: the total supersedes it', expected: 5, rows: [
    row('v1', 'v1', 'claude-code', 3, [usage({ raw: '[usage] {not json', days: 3 })]),
    row('v1b', 'v1', 'claude-code', 2, [usage({ reported: 'claude-code', costUsd: 5, days: 2 })])] },
  { name: 'a trailing row with no usage: the lineage is what its usage rows say', expected: 1, rows: [
    row('t1', 't1', 'claude-code', 3, [usage({ reported: 'claude-code', costUsd: 1, days: 3 })]),
    row('t1b', 't1', 'claude-code', 2, [])] },
  { name: 'no row posted usage: not reported, never $0', expected: null, rows: [
    row('n1', 'n1', 'claude-code', 3, [])] }
];

describe('row usage: one answer, every reader (LIN-4134, LIN-4136)', () => {
  for (const c of CASES) {
    test(c.name, () => {
      const rows = c.rows;
      const lineage = joinCostLineages(rows, groupDispatchLineages(rows)).get(rows[0].rootItemId);
      const reduced = reduceLineageCost(lineage);
      const spend = windowedSpend(joinCostLineages(rows, groupDispatchLineages(rows)), daysAgo(30).getTime(), NOW.getTime());
      const got = {
        reduceLineageCost: reduced.costUsd,
        computeTerminalMarkedTaskCost: computeTerminalMarkedTaskCost(rows, NOW).pricedTicketCostUsd,
        buildTaskCost: buildTaskCost({ ownRows: rows }).workerSessions[0].costUsd,
        windowedSpend: spend.pricedCount ? [...spend.byDay.values()].reduce((a, b) => a + b, 0) : null
      };
      for (const [reader, value] of Object.entries(got)) assert.equal(value, c.expected, `${reader}: ${c.name}`);
      assert.equal(reduced.fullyPriced, c.expected !== null, `fullyPriced: ${c.name}`);

      // The run page reads one loop per row, from that row's own feedback (a lean loop carries none).
      const loops = rows.map(r => ({ loopId: r.id, lineageId: r.rootItemId, kind: 'implementation', terminalStatus: 'done',
        dispatchedAt: r.dispatchedAt.toISOString(), feedback: r.feedback }));
      const view = buildRunView({ seedIssue: 'LIN-1', loops }, { now: NOW });
      const step = view.steps[0];
      assert.equal(view.steps.length, 1, `one step: ${c.name}`);
      assert.equal(step.cost.status === 'priced' ? step.cost.usd : null, c.expected, `run page step: ${c.name}`);
      assert.equal(view.cost.status === 'total' ? view.cost.usd : null, c.expected, `run page header: ${c.name}`);
    });
  }
});

describe('foldLineageUsage: tokens and cost over the same counted rows (LIN-4136)', () => {
  const ABSENT = { state: 'absent', usage: null };
  const UNREADABLE = { state: 'unreadable', usage: null };
  const snapshot = (costUsd, inputTokens = 1000, extra = {}) => ({ state: 'present', usage: { harness: 'claude-code', model: 'claude-haiku-5-5', inputTokens, outputTokens: 0, costUsd, ...extra } });
  const delta = (costUsd, inputTokens = 100, extra = {}) => ({ state: 'present', usage: { harness: 'opencode', model: 'claude-haiku-5-5', inputTokens, outputTokens: 0, costUsd, ...extra } });

  test('no row posted usage: no-usage, and nothing to sum', () => {
    assert.deepEqual(foldLineageUsage([]), { completeness: 'no-usage', tokens: null, costUsd: null, unpricedModels: [], lastIndex: null, last: null });
    assert.equal(foldLineageUsage([ABSENT, ABSENT]).completeness, 'no-usage');
  });

  test('an unreadable row is not no-usage: it is unreadable, with no figure', () => {
    const folded = foldLineageUsage([UNREADABLE]);
    assert.equal(folded.completeness, 'unreadable');
    assert.equal(folded.tokens, null);
    assert.equal(folded.costUsd, null);
    assert.equal(folded.lastIndex, 0);
    assert.equal(folded.last, null);
  });

  test('a delta, then a running total: tokens and cost both sum over the snapshot and the delta', () => {
    const folded = foldLineageUsage([delta(1, 100), snapshot(5, 1000)]);
    assert.equal(folded.completeness, 'complete');
    assert.equal(folded.costUsd, 6);
    assert.equal(folded.tokens.inputTokens, 1100);
    assert.equal(folded.lastIndex, 1);
  });

  test('two snapshots then a delta: the earlier snapshot drops out of both tokens and cost', () => {
    const folded = foldLineageUsage([snapshot(1, 10), snapshot(3, 30), delta(5, 500)]);
    assert.equal(folded.costUsd, 8);
    assert.equal(folded.tokens.inputTokens, 530);
    assert.equal(folded.lastIndex, 2);
  });

  test('a running total then an unreadable row: unreadable, and the earlier snapshot is not the figure', () => {
    const folded = foldLineageUsage([snapshot(1), UNREADABLE]);
    assert.equal(folded.completeness, 'unreadable');
    assert.equal(folded.costUsd, null);
    assert.equal(folded.tokens, null);
  });

  test('an unreadable row then a delta: a delta does not clear it, so the lineage stays unreadable', () => {
    assert.equal(foldLineageUsage([UNREADABLE, delta(2)]).completeness, 'unreadable');
  });

  test('an unreadable row then a running total: the running total supersedes it', () => {
    const folded = foldLineageUsage([UNREADABLE, snapshot(5)]);
    assert.equal(folded.completeness, 'complete');
    assert.equal(folded.costUsd, 5);
    assert.equal(folded.lastIndex, 1);
  });

  test('a row with no price: unpriced, tokens summed over every counted row, cost null', () => {
    const folded = foldLineageUsage([snapshot(1, 1000), delta(null, 200, { model: 'mystery-model' })]);
    assert.equal(folded.completeness, 'unpriced');
    assert.equal(folded.costUsd, null);
    assert.equal(folded.tokens.inputTokens, 1200);
    assert.deepEqual(folded.unpricedModels, ['mystery-model']);
  });

  test('an unreadable row and an unpriced one: unreadable takes precedence', () => {
    const folded = foldLineageUsage([delta(null, 200, { model: 'mystery-model' }), UNREADABLE]);
    assert.equal(folded.completeness, 'unreadable');
    assert.equal(folded.tokens, null);
  });

  test('absent rows after the last running total are skipped', () => {
    const folded = foldLineageUsage([snapshot(4), ABSENT]);
    assert.equal(folded.completeness, 'complete');
    assert.equal(folded.costUsd, 4);
    assert.equal(folded.lastIndex, 0);
  });
});

describe('readRowUsage: absent and unreadable stay apart (LIN-4136)', () => {
  test('no usage entry is absent; an entry that does not parse is unreadable', () => {
    assert.deepEqual(readRowUsage([{ kind: 'heartbeat', message: 'x' }]), { state: 'absent', usage: null });
    assert.deepEqual(readRowUsage([{ kind: 'usage', message: '[usage] {not json' }]), { state: 'unreadable', usage: null });
  });

  test('parseUsage still collapses both to null, and reads the last entry only', () => {
    assert.equal(parseUsage([]), null);
    assert.equal(parseUsage([{ kind: 'usage', message: '[usage] {not json' }]), null);
    assert.equal(parseUsage([{ kind: 'usage', message: '[usage] {"inputTokens":1,"costUsd":2,"model":"claude-haiku-5-5"}' }]).costUsd, 2);
  });
});
