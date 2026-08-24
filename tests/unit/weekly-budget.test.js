/**
 * Unit tests for lib/weekly-budget.js (LIN-2118)
 *
 * Run with: node --test tests/unit/weekly-budget.test.js
 *
 * `computeWeeklyBudgetGauge` is pure aside from its injectable `env` param —
 * no store, no network, no ambient clock — so these tests construct
 * dispatch-row fixtures directly, the same shape
 * tests/unit/terminal-marked-task-cost.test.js uses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeeklyBudgetGauge, currentWindowStartMs, DEFAULT_USD_PER_POINT } from '../../lib/weekly-budget.js';

// 2026-08-20T06:00:00Z is a real Thursday reset instant (matches the
// documented LIN-2087 checkpoint series' own reset day). NOW sits 6h into
// the window.
const RESET_ISO = '2026-08-20T06:00:00.000Z';
const NOW = new Date('2026-08-20T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

function usageEntry({ costUsd, lane = null, at }) {
  const payload = { harness: 'irrelevant-to-payload-parsing', lane };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  return { kind: 'usage', message: `[usage] ${JSON.stringify(payload)}`, timestamp: at };
}

function row({ id, rootItemId = id, issueIdentifier, harness = 'claude-code', dispatchedAt, feedback = [] }) {
  return { _id: id, rootItemId, issueIdentifier, harness, kind: 'implementation', status: 'taken', dispatchedAt, feedback };
}

describe('currentWindowStartMs', () => {
  test('a time just after the Thursday 06:00Z reset resolves to that same reset', () => {
    assert.equal(currentWindowStartMs(NOW), new Date(RESET_ISO).getTime());
  });

  test('a time just BEFORE the Thursday 06:00Z reset resolves to the PRIOR week\'s reset', () => {
    const justBefore = new Date('2026-08-20T05:59:00.000Z');
    assert.equal(currentWindowStartMs(justBefore), new Date('2026-08-13T06:00:00.000Z').getTime());
  });

  test('a mid-week time resolves to the preceding Thursday', () => {
    const sunday = new Date('2026-08-23T18:00:00.000Z');
    assert.equal(currentWindowStartMs(sunday), new Date('2026-08-20T06:00:00.000Z').getTime());
  });
});

describe('computeWeeklyBudgetGauge — degradation', () => {
  test('an empty instance degrades to null percent/rate/projection, never NaN/0-as-a-reading', () => {
    const result = computeWeeklyBudgetGauge([], NOW, {});
    assert.equal(result.percentConsumed, null);
    assert.equal(result.percentSource, 'none');
    // A real, meaningful zero — the recent window is well-defined (NOW is 6h
    // into the reset) and genuinely saw no spend, distinct from percentConsumed's
    // "none" (no baseline exists at all).
    assert.equal(result.burnRatePerHour, 0);
    assert.equal(result.projectedExhaustionAt, null);
    assert.equal(result.windowLineageCount, 0);
    assert.equal(result.windowPricedLineageShare, null);
    assert.equal(result.resetAt, RESET_ISO);
    assert.equal(result.nextResetAt, '2026-08-27T06:00:00.000Z');
    for (const key of Object.keys(result)) {
      if (typeof result[key] === 'number') assert.ok(!Number.isNaN(result[key]), `${key} must not be NaN`);
    }
  });
});

describe('computeWeeklyBudgetGauge — telemetry-only estimate (no operator checkpoint)', () => {
  test('percentConsumed = windowed spend ÷ usdPerPoint, sourced as telemetry-estimate', () => {
    const rows = [
      row({ id: 'a1', issueIdentifier: 'LIN-1', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT * 2, at: RESET_ISO })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, {});
    assert.equal(result.percentSource, 'telemetry-estimate');
    assert.equal(result.percentConsumed, 2, 'two points-worth of spend at the default calibration');
  });

  test('a lineage dispatched BEFORE the current reset is excluded from windowed spend', () => {
    const beforeReset = new Date(new Date(RESET_ISO).getTime() - HOUR_MS).toISOString();
    const rows = [
      row({ id: 'b1', issueIdentifier: 'LIN-2', dispatchedAt: beforeReset, feedback: [usageEntry({ costUsd: 999, at: beforeReset })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, {});
    assert.equal(result.percentConsumed, null, 'nothing in-window ran, so this is "none", not a real 0');
    assert.equal(result.windowLineageCount, 0);
  });

  test('an unpriced lineage is excluded from the sum and lowers windowPricedLineageShare, never counted as $0', () => {
    const rows = [
      row({ id: 'c1', issueIdentifier: 'LIN-3', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT, at: RESET_ISO })] }),
      row({ id: 'c2', issueIdentifier: 'LIN-4', dispatchedAt: RESET_ISO, feedback: [] }) // no usage ever posted
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, {});
    assert.equal(result.percentConsumed, 1, 'only the priced lineage counts toward the sum');
    assert.equal(result.windowLineageCount, 2, 'both lineages count toward the population...');
    assert.equal(result.windowPricedLineageShare, 0.5, '...but only half of them priced');
  });

  test('a `[skipped]`-terminal lineage is excluded entirely, same benign exclusion kpi-stats.js applies', () => {
    const skippedRow = row({
      id: 'd1', issueIdentifier: 'LIN-5', dispatchedAt: RESET_ISO,
      feedback: [usageEntry({ costUsd: 999, at: RESET_ISO }), { message: '[skipped] human-continued session', timestamp: RESET_ISO }]
    });
    const result = computeWeeklyBudgetGauge([skippedRow], NOW, {});
    assert.equal(result.windowLineageCount, 0);
    assert.equal(result.percentConsumed, null);
  });

  test('WEEKLY_BUDGET_USD_PER_POINT overrides the default calibration factor', () => {
    const rows = [
      row({ id: 'e1', issueIdentifier: 'LIN-6', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: 50, at: RESET_ISO })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, { WEEKLY_BUDGET_USD_PER_POINT: '25' });
    assert.equal(result.usdPerPoint, 25);
    assert.equal(result.percentConsumed, 2);
  });
});

describe('computeWeeklyBudgetGauge — operator checkpoint recalibration', () => {
  test('a checkpoint inside the current window anchors the estimate; telemetry fills only the gap SINCE it', () => {
    const checkpointAt = new Date(new Date(RESET_ISO).getTime() + 2 * HOUR_MS).toISOString(); // 08:00Z
    const rows = [
      // Spend BEFORE the checkpoint must not double-count against the anchored 40%.
      row({ id: 'f1', issueIdentifier: 'LIN-7', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT * 100, at: RESET_ISO })] }),
      // Spend AFTER the checkpoint is what telemetry should add on top of it.
      row({ id: 'f2', issueIdentifier: 'LIN-8', dispatchedAt: new Date(new Date(RESET_ISO).getTime() + 3 * HOUR_MS).toISOString(), feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT * 3, at: checkpointAt })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, {
      WEEKLY_BUDGET_CHECKPOINT_PERCENT: '40',
      WEEKLY_BUDGET_CHECKPOINT_AT: checkpointAt
    });
    assert.equal(result.percentSource, 'operator-reading');
    assert.equal(result.percentConsumed, 43, '40% anchor + 3 points of spend logged after the checkpoint');
    assert.equal(result.checkpoint.percent, 40);
    assert.equal(result.checkpoint.at, checkpointAt);
  });

  test('a checkpoint from a PRIOR (already-reset) window is ignored, not reinterpreted as "now"', () => {
    const staleAt = '2026-08-13T10:00:00.000Z'; // inside last week's window, not this one
    const rows = [
      row({ id: 'g1', issueIdentifier: 'LIN-9', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT, at: RESET_ISO })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, {
      WEEKLY_BUDGET_CHECKPOINT_PERCENT: '31',
      WEEKLY_BUDGET_CHECKPOINT_AT: staleAt
    });
    assert.equal(result.checkpoint, null, 'a checkpoint outside the current window must not be adopted');
    assert.equal(result.percentSource, 'telemetry-estimate', 'falls back to telemetry-from-zero instead');
    assert.equal(result.percentConsumed, 1);
  });

  test('a malformed checkpoint (non-numeric percent, or unparseable timestamp) degrades to null, never a crash', () => {
    const result = computeWeeklyBudgetGauge([], NOW, {
      WEEKLY_BUDGET_CHECKPOINT_PERCENT: 'not-a-number',
      WEEKLY_BUDGET_CHECKPOINT_AT: RESET_ISO
    });
    assert.equal(result.checkpoint, null);
  });
});

describe('computeWeeklyBudgetGauge — burn rate and projected exhaustion', () => {
  test('burn rate is derived from spend in the last 24h (or the whole elapsed window, if shorter)', () => {
    const rows = [
      row({ id: 'h1', issueIdentifier: 'LIN-10', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT * 6, at: RESET_ISO })] })
    ];
    // NOW is 6h into the window; all spend is "recent" (< 24h old).
    const result = computeWeeklyBudgetGauge(rows, NOW, {});
    assert.equal(result.burnRatePerHour, 1, '6 points over the 6 elapsed hours = 1 pt/hr');
  });

  test('projectedExhaustionAt = now + (100 - percentConsumed) / burnRatePerHour hours', () => {
    const rows = [
      row({ id: 'i1', issueIdentifier: 'LIN-11', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT * 6, at: RESET_ISO })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, {});
    // 1 pt/hr, 94 points remaining => 94h from NOW.
    const expected = new Date(NOW.getTime() + 94 * HOUR_MS).toISOString();
    assert.equal(result.projectedExhaustionAt, expected);
  });

  test('no burn rate (zero recent spend) never projects an exhaustion time', () => {
    const stale = new Date(NOW.getTime() - 25 * HOUR_MS).toISOString(); // outside the 24h recent window, but still stale > reset? use reset instead
    const rows = [
      row({ id: 'j1', issueIdentifier: 'LIN-12', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT * 6, at: RESET_ISO })] })
    ];
    // Force "now" far enough past reset that the last-24h recent window sees no spend.
    const laterNow = new Date(new Date(RESET_ISO).getTime() + 48 * HOUR_MS);
    const result = computeWeeklyBudgetGauge(rows, laterNow, {});
    assert.equal(result.burnRatePerHour, 0, 'no spend in the recent window');
    assert.equal(result.projectedExhaustionAt, null, 'a zero rate must never be divided by');
    void stale;
  });

  test('percentConsumed already >= 100 never projects a further exhaustion time', () => {
    const rows = [
      row({ id: 'k1', issueIdentifier: 'LIN-13', dispatchedAt: RESET_ISO, feedback: [usageEntry({ costUsd: DEFAULT_USD_PER_POINT * 150, at: RESET_ISO })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, NOW, {});
    assert.ok(result.percentConsumed >= 100);
    assert.equal(result.projectedExhaustionAt, null);
  });
});

describe('computeWeeklyBudgetGauge — per-day bars', () => {
  test('spend is bucketed by the UTC day of each lineage\'s earliest dispatch, within the current window only', () => {
    const day1 = RESET_ISO; // 2026-08-20
    const day2 = '2026-08-21T09:00:00.000Z';
    const rows = [
      row({ id: 'l1', issueIdentifier: 'LIN-14', dispatchedAt: day1, feedback: [usageEntry({ costUsd: 10, at: day1 })] }),
      row({ id: 'l2', issueIdentifier: 'LIN-15', dispatchedAt: day2, feedback: [usageEntry({ costUsd: 15, at: day2 })] })
    ];
    const twoDaysIn = new Date('2026-08-22T00:00:00.000Z');
    const result = computeWeeklyBudgetGauge(rows, twoDaysIn, {});
    const idx1 = result.dayBars.days.indexOf('2026-08-20');
    const idx2 = result.dayBars.days.indexOf('2026-08-21');
    assert.ok(idx1 !== -1 && idx2 !== -1);
    assert.equal(result.dayBars.costUsd[idx1], 10);
    assert.equal(result.dayBars.costUsd[idx2], 15);
  });

  test('day bars cover only elapsed days of the current window, never future days past "now"', () => {
    const result = computeWeeklyBudgetGauge([], NOW, {}); // NOW is 6h into the window, same UTC day as reset
    assert.deepEqual(result.dayBars.days, ['2026-08-20']);
  });

  test('today\'s spend is NOT dropped when "now" falls between 00:00Z and 06:00Z (LIN-2273)', () => {
    // Window starts Thu 2026-08-20 06:00Z. "now" is Sat 2026-08-22 03:00Z —
    // inside the 00:00Z-06:00Z band, BEFORE today's (Sat's) 06:00Z reset
    // hour, but today's calendar day has already started and already has
    // spend keyed under it in `byDay`. The old 06:00Z-anchored enumeration
    // stopped at Friday, silently dropping Saturday's $500 from the chart
    // even though the card's percentConsumed already reflects it.
    const now = new Date('2026-08-22T03:00:00.000Z');
    const thu = RESET_ISO; // 2026-08-20T06:00:00.000Z
    const fri = '2026-08-21T09:00:00.000Z';
    const satOvernight = '2026-08-22T01:30:00.000Z'; // inside the 00:00-06:00Z band
    const rows = [
      row({ id: 'm1', issueIdentifier: 'LIN-16', dispatchedAt: thu, feedback: [usageEntry({ costUsd: 40, at: thu })] }),
      row({ id: 'm2', issueIdentifier: 'LIN-17', dispatchedAt: fri, feedback: [usageEntry({ costUsd: 60, at: fri })] }),
      row({ id: 'm3', issueIdentifier: 'LIN-18', dispatchedAt: satOvernight, feedback: [usageEntry({ costUsd: 500, at: satOvernight })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, now, {});
    assert.deepEqual(result.dayBars.days, ['2026-08-20', '2026-08-21', '2026-08-22']);
    assert.deepEqual(result.dayBars.costUsd, [40, 60, 500]);
  });

  test('reset-day "now" (00:00Z-06:00Z, window not yet rolled over) still surfaces the partial day', () => {
    // "now" is Thu 2026-08-27 03:00Z — the morning OF the next reset, but
    // before the 06:00Z rollover, so the window is still last week's
    // (started Thu 2026-08-20 06:00Z). Spend logged overnight on the 27th
    // must still surface as its own day-bar rather than vanishing.
    const now = new Date('2026-08-27T03:00:00.000Z');
    const overnight = '2026-08-27T02:00:00.000Z';
    const rows = [
      row({ id: 'n1', issueIdentifier: 'LIN-19', dispatchedAt: overnight, feedback: [usageEntry({ costUsd: 25, at: overnight })] })
    ];
    const result = computeWeeklyBudgetGauge(rows, now, {});
    assert.equal(currentWindowStartMs(now), new Date(RESET_ISO).getTime(), 'still inside the window that started 2026-08-20');
    assert.ok(result.dayBars.days.includes('2026-08-27'), 'the partial reset-day bucket must be enumerated');
    const idx = result.dayBars.days.indexOf('2026-08-27');
    assert.equal(result.dayBars.costUsd[idx], 25);
  });
});
