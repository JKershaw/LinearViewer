/**
 * Unit tests for lib/weekly-budget.js: `windowedSpend` (LIN-2118, LIN-4129)
 *
 * Run with: node --test tests/unit/weekly-budget.test.js
 *
 * The weekly burn gauge these tests once covered was removed in LIN-4129 (no
 * reader). `windowedSpend` is pure: dispatch rows in, per-UTC-day spend out.
 * Per-day bucketing and the skipped-lineage exclusion are pinned through the
 * workspace KPIs in tests/unit/workspace-kpi-stats.test.js; the window bounds
 * and the partial-pricing exclusion are pinned here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { windowedSpend } from '../../lib/weekly-budget.js';
import { groupDispatchLineages } from '../../lib/dispatch-lineage.js';
import { lineageRecords as lineageRecords__unplumbed } from '../../lib/cost-read.js';
import { NO_REQUEST_RECORDS, withDefaults } from '../fixtures/request-usage-loader.js';
import { lineageRecordsOf } from '../fixtures/cost-read-cores.js';
// LIN-4201: these tests read snapshot-only lineages, so they pass "no request records" explicitly (plumbing only).
const lineageRecords = lineageRecordsOf;


const SINCE = Date.parse('2026-08-20T06:00:00.000Z');
const NOW = Date.parse('2026-08-20T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_KEY = '2026-08-20';

function usageEntry({ costUsd, at, harness = 'claude-code' }) {
  const payload = { harness, lane: null };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  return { kind: 'usage', message: `[usage] ${JSON.stringify(payload)}`, timestamp: at };
}

function row({ id, rootItemId = id, issueIdentifier, harness = 'claude-code', dispatchedAt, feedback = [] }) {
  return { _id: id, rootItemId, issueIdentifier, harness, kind: 'implementation', status: 'taken', dispatchedAt, feedback };
}

function spendIn(rows, sinceMs = SINCE, nowMs = NOW) {
  return windowedSpend(lineageRecords({ fetchedRows: rows, identityRows: [], outcomes: groupDispatchLineages(rows) }), sinceMs, nowMs);
}

describe('windowedSpend — window bounds', () => {
  test('a lineage that starts before sinceMs is excluded', () => {
    const at = new Date(SINCE - 1).toISOString();
    const result = spendIn([row({ id: 'early', issueIdentifier: 'LIN-1', dispatchedAt: at, feedback: [usageEntry({ costUsd: 5, at })] })]);
    assert.equal(result.lineageCount, 0);
    assert.equal(result.pricedCount, 0);
    assert.equal(result.byDay.size, 0);
  });

  test('a lineage that starts exactly at sinceMs is included (lower bound is inclusive)', () => {
    const at = new Date(SINCE).toISOString();
    const result = spendIn([row({ id: 'start', issueIdentifier: 'LIN-2', dispatchedAt: at, feedback: [usageEntry({ costUsd: 5, at })] })]);
    assert.equal(result.lineageCount, 1);
    assert.equal(result.byDay.get(DAY_KEY), 5);
  });

  test('a lineage that starts exactly at nowMs is excluded (upper bound is half-open)', () => {
    const at = new Date(NOW).toISOString();
    const result = spendIn([row({ id: 'now', issueIdentifier: 'LIN-3', dispatchedAt: at, feedback: [usageEntry({ costUsd: 5, at })] })]);
    assert.equal(result.lineageCount, 0);
    assert.equal(result.byDay.size, 0);
  });

  test('a lineage one millisecond before nowMs is included', () => {
    const at = new Date(NOW - 1).toISOString();
    const result = spendIn([row({ id: 'justbefore', issueIdentifier: 'LIN-4', dispatchedAt: at, feedback: [usageEntry({ costUsd: 5, at })] })]);
    assert.equal(result.lineageCount, 1);
    assert.equal(result.pricedCount, 1);
  });
});

describe('windowedSpend — partial pricing', () => {
  test('an opencode lineage with one unpriced row is counted in lineageCount only, never in pricedCount or byDay', () => {
    const first = new Date(SINCE + HOUR_MS).toISOString();
    const second = new Date(SINCE + 2 * HOUR_MS).toISOString();
    const rows = [
      row({ id: 'p1', rootItemId: 'partial', issueIdentifier: 'LIN-5', harness: 'opencode', dispatchedAt: first, feedback: [usageEntry({ costUsd: 2, at: first, harness: 'opencode' })] }),
      row({ id: 'p2', rootItemId: 'partial', issueIdentifier: 'LIN-5', harness: 'opencode', dispatchedAt: second, feedback: [usageEntry({ at: second, harness: 'opencode' })] })
    ];
    const result = spendIn(rows);
    assert.equal(result.lineageCount, 1, 'the lineage is in the window');
    assert.equal(result.pricedCount, 0, 'but it is not fully priced');
    assert.equal(result.byDay.size, 0, 'so its priced row adds nothing to the day bar either');
  });
});
