/**
 * LIN-4201 (piece 4 of LIN-4195): the records-first cost read.
 *
 * Witnesses for the one decision in lib/cost-read.js (`lineageUsageOf`, D7 + review note 9), the required
 * `requestRows` argument (review note 2), the narrow rule for a record lineage (review note 3) and the run page's
 * placement of a record figure:
 *
 *  - a lineage with records reads them, and its same-harness snapshots are ignored (no double count, case (f));
 *  - a lineage with no records reads its snapshots exactly as before;
 *  - per-harness scoping: a snapshot of a harness with no records still counts;
 *  - `readCost`, `lineageRecords`, `lineageFigureOf` and `buildRunView` throw without `requestRows`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readCost, lineageRecords, lineageFigureOf } from '../../lib/cost-read.js';
import { buildRunView } from '../../lib/run-view.js';

const NOW = Date.UTC(2026, 10, 4, 12);
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600 * 1000).toISOString();

/** A `[usage]` snapshot entry. `costUsd` is native, so the snapshot's figure is exactly it. */
const snapshot = (hoursAgo, { harness = 'claude-code', model = 'claude-opus-5-5', costUsd, inputTokens = 1000 } = {}) => ({
  kind: 'usage', timestamp: at(hoursAgo),
  message: `[usage] ${JSON.stringify({ harness, model, inputTokens, outputTokens: 10, lane: null, ...(costUsd !== undefined && { costUsd }) })}`,
});
/** A taken dispatch row of lineage `anchor`. */
const row = (id, anchor, hoursAgo, entries = [], extra = {}) => ({
  _id: id, id, rootItemId: anchor, issueIdentifier: 'LIN-1', kind: 'implementation', status: 'taken',
  dispatchedAt: at(hoursAgo), feedback: entries.map(entry => ({ rootItemId: anchor, ...entry })), ...extra,
});
/** A request record as the loader returns it (relabelled to its posting row's current anchor). */
const rec = (anchor, requestId, hoursAgo, fields = {}) => ({
  rootItemId: anchor, itemId: anchor, requestId, at: at(hoursAgo), updatedAt: at(hoursAgo),
  harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high',
  inputTokens: 1000, outputTokens: 10, ...fields,
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const sessionOf = (result, anchor) => result.workerSessions.find(s => s.rootItemId === anchor);

describe('the decision: a lineage with records reads its records', () => {
  test('case (f), resumed across the deploy: an old snapshot plus the full record set reads the records, counted once', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { costUsd: 0.30 })]), row('r2', 'r1', 2, [snapshot(2, { costUsd: 0.50 })])];
    // The records cover everything the snapshots covered and more (the session's later turns).
    const requestRows = [rec('r1', 'm1', 5, { costUsd: 0.20 }), rec('r1', 'm2', 4, { costUsd: 0.30 }), rec('r1', 'm3', 1, { costUsd: 0.25 })];
    const result = readCost({ fetchedRows: rows, requestRows });
    close(sessionOf(result, 'r1').costUsd, 0.75);
    close(result.totalUsd, 0.75);
  });

  test('a lineage with no records reads its snapshots exactly as before, beside a lineage that has records', () => {
    const snapshotOnly = [row('s1', 's1', 6, [snapshot(6, { costUsd: 0.40 })]), row('s2', 's1', 3, [snapshot(3, { costUsd: 0.90 })])];
    const withRecords = [row('r1', 'r1', 5, [snapshot(5, { costUsd: 9 })])];
    const before = readCost({ fetchedRows: snapshotOnly, requestRows: [] });
    const after = readCost({ fetchedRows: [...snapshotOnly, ...withRecords], requestRows: [rec('r1', 'm1', 5, { costUsd: 0.1 })] });
    assert.deepEqual(sessionOf(after, 's1'), sessionOf(before, 's1'));
    close(sessionOf(after, 's1').costUsd, 0.90); // the last running total, as before
    close(sessionOf(after, 'r1').costUsd, 0.1);
  });

  test('a lineage\'s figure ignores records of another lineage', () => {
    const rows = [row('a', 'a', 4, [snapshot(4, { costUsd: 0.2 })])];
    const result = readCost({ fetchedRows: rows, requestRows: [rec('elsewhere', 'm1', 4, { costUsd: 5 })] });
    close(sessionOf(result, 'a').costUsd, 0.2);
  });

  test('labels come from the records: the cost-dominant model, the latest record\'s harness and effort', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { model: 'claude-haiku-5-5', costUsd: 1 })])];
    const requestRows = [
      rec('r1', 'm1', 5, { model: 'claude-opus-5-5', costUsd: 0.9, effort: 'high' }),
      rec('r1', 'm2', 1, { model: 'claude-haiku-5-5', costUsd: 0.1, effort: 'low' }),
    ];
    const session = sessionOf(readCost({ fetchedRows: rows, requestRows }), 'r1');
    assert.equal(session.model, 'claude-opus-5-5');
    assert.equal(session.effort, 'low');
    assert.equal(session.harness, 'claude-code');
  });

  test('an unpriced record withholds the lineage figure and names the model (never a partial)', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { costUsd: 1 })])];
    const result = readCost({ fetchedRows: rows, requestRows: [rec('r1', 'm1', 5, { costUsd: 0.5 }), rec('r1', 'm2', 4, { model: 'mystery-model' })] });
    assert.equal(sessionOf(result, 'r1').costUsd, null);
    assert.deepEqual(result.unpriced, ['mystery-model']);
    assert.equal(result.totalUsd, null);
  });

  test('a lineage with records and no usage-bearing row is priced, not no-telemetry', () => {
    const rows = [row('r1', 'r1', 5, [])];
    const result = readCost({ fetchedRows: rows, requestRows: [rec('r1', 'm1', 5, { costUsd: 0.4 })] });
    assert.equal(result.noTelemetryCount, 0);
    close(sessionOf(result, 'r1').costUsd, 0.4);
  });
});

describe('per-harness scoping (review note 9)', () => {
  test('an opencode delta row beside claude-code records keeps its spend; the claude-code snapshot is ignored', () => {
    const rows = [
      row('r1', 'r1', 6, [snapshot(6, { harness: 'opencode', costUsd: 0.25 })]),
      row('r2', 'r1', 4, [snapshot(4, { harness: 'claude-code', costUsd: 7 })]),
    ];
    const requestRows = [rec('r1', 'm1', 4, { costUsd: 0.10 }), rec('r1', 'm2', 3, { costUsd: 0.05 })];
    const result = readCost({ fetchedRows: rows, requestRows });
    close(sessionOf(result, 'r1').costUsd, 0.25 + 0.15);
  });

  test('opencode records set aside opencode deltas, and leave a claude-code running total counted', () => {
    const rows = [
      row('r1', 'r1', 6, [snapshot(6, { harness: 'opencode', costUsd: 0.25 })]),
      row('r2', 'r1', 5, [snapshot(5, { harness: 'opencode', costUsd: 0.25 })]),
      row('r3', 'r1', 4, [snapshot(4, { harness: 'claude-code', costUsd: 2 })]),
    ];
    const result = readCost({ fetchedRows: rows, requestRows: [rec('r1', 'o1', 6, { harness: 'opencode', costUsd: 0.6 })] });
    close(sessionOf(result, 'r1').costUsd, 0.6 + 2);
  });

  test('a record with no harness reads as claude-code, so it sets claude-code snapshots aside', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { harness: 'claude-code', costUsd: 3 })])];
    const result = readCost({ fetchedRows: rows, requestRows: [rec('r1', 'm1', 5, { harness: undefined, costUsd: 0.2 })] });
    close(sessionOf(result, 'r1').costUsd, 0.2);
  });

  test('a snapshot with no reported harness is a claude-code running total, set aside by claude-code records', () => {
    const noHarness = { kind: 'usage', timestamp: at(5), message: `[usage] ${JSON.stringify({ model: 'claude-opus-5-5', inputTokens: 5, outputTokens: 1, lane: null, costUsd: 4 })}` };
    const result = readCost({ fetchedRows: [row('r1', 'r1', 5, [noHarness])], requestRows: [rec('r1', 'm1', 5, { costUsd: 0.2 })] });
    close(sessionOf(result, 'r1').costUsd, 0.2);
  });

  test('an unpriced remaining snapshot withholds the combined figure', () => {
    const rows = [row('r1', 'r1', 6, [snapshot(6, { harness: 'opencode', model: 'mystery-model' })])];
    const result = readCost({ fetchedRows: rows, requestRows: [rec('r1', 'm1', 5, { costUsd: 0.2 })] });
    assert.equal(sessionOf(result, 'r1').costUsd, null);
    assert.deepEqual(result.unpriced, ['mystery-model']);
  });
});

describe('review note 3: a record lineage is never incomplete', () => {
  // `identityRows` names a true member the fetch did not return (a capped or windowed read).
  const missingMember = { _id: 'r0', rootItemId: 'r1', status: 'taken', kind: 'implementation', issueIdentifier: 'LIN-1', dispatchedAt: at(30) };

  test('a missing member does not withhold a record figure', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { costUsd: 1 })])];
    const [record] = lineageRecords({ fetchedRows: rows, identityRows: [missingMember], requestRows: [rec('r1', 'm1', 5, { costUsd: 0.3 })] });
    assert.equal(record.missing.length, 1);
    assert.equal(record.incomplete, false);
    assert.equal(record.fold.source, 'records');
  });

  test('the same missing member withholds the snapshot figure of a lineage without records (the narrow rule, as before)', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { harness: 'opencode', costUsd: 1 })])];
    const [record] = lineageRecords({ fetchedRows: rows, identityRows: [missingMember], requestRows: [] });
    assert.equal(record.incomplete, true);
  });

  test('a lineage that still counts an opencode delta beside its records keeps the narrow rule for that delta', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { harness: 'opencode', costUsd: 1 })])];
    const [record] = lineageRecords({ fetchedRows: rows, identityRows: [missingMember], requestRows: [rec('r1', 'm1', 5, { costUsd: 0.3 })] });
    assert.equal(record.incomplete, true);
  });

  test('lineageRecords exposes each lineage\'s request records', () => {
    const requestRows = [rec('r1', 'm1', 5, { costUsd: 0.3 })];
    const [record] = lineageRecords({ fetchedRows: [row('r1', 'r1', 5)], requestRows });
    assert.deepEqual(record.requests, requestRows);
  });
});

describe('requestRows is required (review note 2): each entry point throws without it', () => {
  const rows = [row('r1', 'r1', 5, [snapshot(5, { costUsd: 1 })])];
  for (const missing of [undefined, null, 'records']) {
    test(`readCost throws on requestRows = ${String(missing)}`, () => {
      assert.throws(() => readCost({ fetchedRows: rows, requestRows: missing }), { name: 'TypeError', message: /readCost: requestRows is required/ });
    });
    test(`lineageRecords throws on requestRows = ${String(missing)}`, () => {
      assert.throws(() => lineageRecords({ fetchedRows: rows, requestRows: missing }), { name: 'TypeError', message: /lineageRecords: requestRows is required/ });
    });
    test(`lineageFigureOf throws on requestRows = ${String(missing)}`, () => {
      assert.throws(() => lineageFigureOf(rows, { requestRows: missing }), { name: 'TypeError', message: /lineageFigureOf: requestRows is required/ });
    });
    test(`buildRunView throws on requestRows = ${String(missing)}`, () => {
      assert.throws(() => buildRunView({ loops: [] }, { requestRows: missing }), { name: 'TypeError', message: /buildRunView: requestRows is required/ });
    });
  }
  test('the throws hold with no options object at all', () => {
    assert.throws(() => readCost(), /requestRows is required/);
    assert.throws(() => lineageRecords(), /requestRows is required/);
    assert.throws(() => lineageFigureOf(rows), /requestRows is required/);
    assert.throws(() => buildRunView({ loops: [] }), /requestRows is required/);
  });
  test('[] is a real answer: no records, every lineage reads its snapshots', () => {
    close(readCost({ fetchedRows: rows, requestRows: [] }).totalUsd, 1);
  });
});

describe('the run page places a record figure on purpose', () => {
  test('lineageFigureOf: the figure sits on the latest record\'s posting row', () => {
    const rows = [row('r1', 'r1', 5), row('r2', 'r1', 3), row('r3', 'r1', 1)];
    const figure = lineageFigureOf(rows, { requestRows: [rec('r1', 'm1', 5, { costUsd: 0.1 }), { ...rec('r1', 'm2', 2, { costUsd: 0.2 }), itemId: 'r2' }] });
    close(figure.costUsd, 0.3);
    assert.equal(figure.lastIndex, 1);
  });

  test('lineageFigureOf: a posting row the caller did not pass puts the figure on the last row', () => {
    const rows = [row('r1', 'r1', 5), row('r2', 'r1', 3)];
    const figure = lineageFigureOf(rows, { requestRows: [{ ...rec('r1', 'm1', 1, { costUsd: 0.1 }), itemId: 'not-on-page' }] });
    assert.equal(figure.lastIndex, 1);
  });

  test('lineageFigureOf: with no records the figure is the snapshot fold\'s, on its counted row, as before', () => {
    const rows = [row('r1', 'r1', 5, [snapshot(5, { costUsd: 0.4 })]), row('r2', 'r1', 3)];
    const figure = lineageFigureOf(rows, { requestRows: [] });
    close(figure.costUsd, 0.4);
    assert.equal(figure.lastIndex, 0);
  });

  test('buildRunView: a step with records shows its records figure on the loop that posted the latest record', () => {
    const loop = (loopId, hoursAgo, entries = []) => ({
      loopId, lineageId: 'L1', kind: 'implementation', dispatchedAt: at(hoursAgo), feedback: entries, terminalStatus: 'done',
    });
    const session = { sessionId: 's', seedIssue: 'LIN-1', loops: [loop('L1', 5, [snapshot(5, { costUsd: 8 })]), loop('L2', 2)] };
    const requestRows = [{ ...rec('L1', 'm1', 5, { costUsd: 0.1 }), itemId: 'L1' }, { ...rec('L1', 'm2', 2, { costUsd: 0.2 }), itemId: 'L2' }];
    const view = buildRunView(session, { now: NOW, requestRows });
    const [step] = view.steps;
    assert.equal(step.cost.status, 'priced');
    close(step.cost.usd, 0.3);
    assert.equal(step.cost.finalLoopId, 'L2');
  });

  test('buildRunView: records of another lineage do not reach a step', () => {
    const session = { sessionId: 's', seedIssue: 'LIN-1', loops: [{ loopId: 'L1', lineageId: 'L1', kind: 'implementation', dispatchedAt: at(5), feedback: [snapshot(5, { costUsd: 0.4 })], terminalStatus: 'done' }] };
    const view = buildRunView(session, { now: NOW, requestRows: [rec('other', 'm1', 5, { costUsd: 9 })] });
    close(view.steps[0].cost.usd, 0.4);
  });
});

describe('review note 1: the /kpis harness shares read a record lineage from its records', async () => {
  const { computeTerminalMarkedTaskCost } = await import('../../lib/terminal-marked-task-cost.js');
  const done = (hoursAgo) => ({ message: '[done] landed', timestamp: at(hoursAgo) });
  const asOf = new Date(NOW);

  test('a record-only lineage has a known harness and is not delta-summed', () => {
    const rows = [row('r1', 'r1', 5, [done(4.9)])];
    const figures = computeTerminalMarkedTaskCost(rows, asOf, { requestRows: [rec('r1', 'm1', 5, { costUsd: 0.2 })] });
    assert.equal(figures.unknownHarnessShare, 0);
    assert.equal(figures.opencodeSummedShare, 0);
  });

  test('the same lineage with no records is unknown-harness, as before', () => {
    const figures = computeTerminalMarkedTaskCost([row('r1', 'r1', 5, [done(4.9)])], asOf, { requestRows: [] });
    assert.equal(figures.unknownHarnessShare, 1);
    assert.equal(figures.opencodeSummedShare, null);
  });

  test('records beside a counted opencode delta: delta-summed, as the figure is', () => {
    const rows = [row('r1', 'r1', 6, [snapshot(6, { harness: 'opencode', costUsd: 0.25 })]), row('r2', 'r1', 5, [done(4.9)])];
    const figures = computeTerminalMarkedTaskCost(rows, asOf, { requestRows: [rec('r1', 'm1', 5, { costUsd: 0.2 })] });
    assert.equal(figures.opencodeSummedShare, 1);
    assert.equal(figures.unknownHarnessShare, 0);
  });

  test('a claude-code snapshot set aside by records is not what makes the lineage known or summed', () => {
    const rows = [row('r1', 'r1', 6, [snapshot(6, { harness: 'claude-code', costUsd: 3 }), done(5.9)])];
    const figures = computeTerminalMarkedTaskCost(rows, asOf, { requestRows: [rec('r1', 'm1', 5, { costUsd: 0.2 })] });
    assert.equal(figures.opencodeSummedShare, 0);
    close(figures.pricedTicketCostUsd, 0.2);
  });
});

describe('a lineage that counts records and another harness\'s snapshots is labelled by its cost-dominant part', () => {
  test('an opencode delta that outweighs the records keeps naming the lineage', () => {
    const rows = [row('r1', 'r1', 6, [snapshot(6, { harness: 'opencode', model: 'openrouter/qwen-3', costUsd: 0.25 })])];
    const session = sessionOf(readCost({ fetchedRows: rows, requestRows: [rec('r1', 'm1', 5, { costUsd: 0.04 })] }), 'r1');
    assert.equal(session.harness, 'opencode');
    assert.equal(session.model, 'openrouter/qwen-3');
    close(session.costUsd, 0.29);
  });

  test('records that outweigh the delta name it', () => {
    const rows = [row('r1', 'r1', 6, [snapshot(6, { harness: 'opencode', model: 'openrouter/qwen-3', costUsd: 0.01 })])];
    const session = sessionOf(readCost({ fetchedRows: rows, requestRows: [rec('r1', 'm1', 5, { costUsd: 0.5, effort: 'max' })] }), 'r1');
    assert.equal(session.harness, 'claude-code');
    assert.equal(session.model, 'claude-opus-5-5');
    assert.equal(session.effort, 'max');
  });
});
