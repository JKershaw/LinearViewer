/**
 * Unit tests for lib/task-cost.js (LIN-1775)
 *
 * Run with: node --test tests/unit/task-cost.test.js
 *
 * `buildTaskCost` is pure — no store, no network, no clock — so these tests
 * construct dispatch-row fixtures directly in the `/dispatch` list route's
 * formatted shape and assert on the aggregation.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskCost } from '../fixtures/task-cost-adapter.js';

// A `[usage]` feedback entry. `costUsd` is embedded directly in the payload
// (parseUsagePayload prefers a native cost over deriving one), so tests can
// pin an exact price without needing a real model-pricing rate. Omit it (and
// use a model the catalog does not price) to exercise the unpriced path.
function usageEntry({ model = 'anthropic/claude-sonnet-5', costUsd, timestamp, rootItemId, effort } = {}) {
  const payload = { model };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  if (effort !== undefined) payload.effort = effort;
  const entry = { kind: 'usage', timestamp, message: `[usage] ${JSON.stringify(payload)}` };
  if (rootItemId) entry.rootItemId = rootItemId;
  return entry;
}

function row({ id, status = 'taken', dispatchedAt, feedback = [], kind = 'implementation', rootItemId } = {}) {
  return { id, status, dispatchedAt, feedback, kind, rootItemId };
}

const EMPTY_APP = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };

describe('buildTaskCost — lineage de-duplication', () => {
  test('a follow-up chain sharing one rootItemId is counted ONCE, not once per row', () => {
    // A cumulative usage snapshot: the follow-up's own total (costUsd 5) already
    // includes the original's spend, per the runner's cumulative-per-Stop contract.
    // Naive per-row summing would double it to 8 (3 + 5).
    const base = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [usageEntry({ costUsd: 3, timestamp: '2026-08-01T10:05:00Z' })]
    });
    const followUp = row({
      id: 'b', dispatchedAt: '2026-08-01T10:10:00Z', rootItemId: 'root1',
      feedback: [usageEntry({ costUsd: 5, timestamp: '2026-08-01T10:20:00Z', rootItemId: 'root1' })]
    });

    const result = buildTaskCost({ ownRows: [base, followUp], appSummary: EMPTY_APP });

    assert.equal(result.workerSessions.length, 1);
    assert.equal(result.pricedUsd, 5); // last-wins over the merged lineage, never 3 + 5
    assert.equal(result.totalUsd, 5);
    assert.deepEqual(result.unpriced, []);
    assert.equal(result.noTelemetryCount, 0);
  });

  test('siblings fetched via siblingRowsByAnchor merge the same way as same-issue own rows', () => {
    const base = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [usageEntry({ costUsd: 3, timestamp: '2026-08-01T10:05:00Z' })]
    });
    const sibling = row({
      id: 'b', dispatchedAt: '2026-08-01T10:10:00Z', rootItemId: 'root1',
      feedback: [usageEntry({ costUsd: 9, timestamp: '2026-08-01T10:20:00Z', rootItemId: 'root1' })]
    });
    const siblingRowsByAnchor = new Map([['root1', [sibling]]]);

    const result = buildTaskCost({ ownRows: [base], siblingRowsByAnchor, appSummary: EMPTY_APP });

    assert.equal(result.workerSessions.length, 1);
    assert.equal(result.pricedUsd, 9);
  });

  test('a row appearing in both own rows and siblingRowsByAnchor is not merged twice', () => {
    const base = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [usageEntry({ costUsd: 3, timestamp: '2026-08-01T10:05:00Z' })]
    });
    const followUp = row({
      id: 'b', dispatchedAt: '2026-08-01T10:10:00Z', rootItemId: 'root1',
      feedback: [usageEntry({ costUsd: 5, timestamp: '2026-08-01T10:20:00Z', rootItemId: 'root1' })]
    });
    // The unscoped sibling batch fetch can legitimately re-return the same
    // same-issue follow-up row that's already in ownRows.
    const siblingRowsByAnchor = new Map([['root1', [followUp]]]);

    const result = buildTaskCost({ ownRows: [base, followUp], siblingRowsByAnchor, appSummary: EMPTY_APP });

    assert.equal(result.workerSessions.length, 1);
    assert.equal(result.pricedUsd, 5); // not double-applied
  });

  test('two independent lineages (distinct roots) are both counted', () => {
    const a = row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ costUsd: 3 })] });
    const b = row({ id: 'b', dispatchedAt: '2026-08-01T11:00:00Z', rootItemId: 'root2', feedback: [usageEntry({ costUsd: 4 })] });

    const result = buildTaskCost({ ownRows: [a, b], appSummary: EMPTY_APP });

    assert.equal(result.workerSessions.length, 2);
    assert.equal(result.pricedUsd, 7);
  });
});

describe('buildTaskCost — unpriced / missing-telemetry handling', () => {
  test('an unpriced model is tracked in `unpriced`, not folded into pricedUsd as 0', () => {
    const a = row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ model: 'no-such-model/vX', timestamp: '2026-08-01T10:05:00Z' })] });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.equal(result.pricedUsd, 0);
    assert.equal(result.totalUsd, null);
    assert.deepEqual(result.unpriced, ['no-such-model/vX']);
    assert.equal(result.workerSessions[0].costUsd, null);
    assert.equal(result.workerSessions[0].model, 'no-such-model/vX');
  });

  test('a `taken` row with no usage telemetry at all increments noTelemetryCount, not unpriced', () => {
    const a = row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [{ message: '[done] finished' }] });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.equal(result.noTelemetryCount, 1);
    assert.deepEqual(result.unpriced, []);
    assert.equal(result.totalUsd, null);
    assert.equal(result.workerSessions[0].model, null);
    assert.equal(result.workerSessions[0].costUsd, null);
  });

  test('queued/cancelled/expired rows never ran and are excluded entirely', () => {
    const queued = row({ id: 'a', status: 'queued', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ costUsd: 99 })] });
    const cancelled = row({ id: 'b', status: 'cancelled', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root2', feedback: [usageEntry({ costUsd: 99 })] });
    const expired = row({ id: 'c', status: 'expired', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root3', feedback: [usageEntry({ costUsd: 99 })] });

    const result = buildTaskCost({ ownRows: [queued, cancelled, expired], appSummary: EMPTY_APP });

    assert.equal(result.workerSessions.length, 0);
    assert.equal(result.pricedUsd, 0);
    assert.equal(result.noTelemetryCount, 0);
    // LIN-2253 review: none of these rows ever ran, so zero taken lineages
    // resolve — the same shape as "no data at all" for this issue, and
    // totalUsd must reflect that (null), not a confirmed $0.
    assert.equal(result.noLineage, true);
    assert.equal(result.totalUsd, null);
  });
});

describe('buildTaskCost — totalUsd null-vs-priced gating', () => {
  const priced = () => row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ costUsd: 10 })] });

  test('fully priced worker + fully priced app calls → totalUsd = pricedUsd + appCalls.costUsd', () => {
    const result = buildTaskCost({ ownRows: [priced()], appSummary: { calls: 2, costUsd: 0.5, unpricedCalls: 0, byFeature: [] } });
    assert.equal(result.pricedUsd, 10);
    assert.equal(result.totalUsd, 10.5);
  });

  test('an unpriced worker model nulls totalUsd even when app calls are fully priced', () => {
    const unpricedRow = row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ model: 'no-such-model/vX' })] });
    const result = buildTaskCost({ ownRows: [unpricedRow], appSummary: { calls: 1, costUsd: 0.1, unpricedCalls: 0, byFeature: [] } });
    assert.equal(result.totalUsd, null);
  });

  test('a noTelemetryCount > 0 nulls totalUsd even when everything else is priced', () => {
    const noTelemetryRow = row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [] });
    const result = buildTaskCost({ ownRows: [priced(), { ...noTelemetryRow, id: 'b', rootItemId: 'root2' }], appSummary: { calls: 1, costUsd: 0.1, unpricedCalls: 0, byFeature: [] } });
    assert.equal(result.totalUsd, null);
    assert.equal(result.pricedUsd, 10); // priced() row's spend is still visible
  });

  test('appCalls.unpricedCalls > 0 nulls totalUsd even when every worker session is priced', () => {
    const result = buildTaskCost({ ownRows: [priced()], appSummary: { calls: 2, costUsd: 0.1, unpricedCalls: 1, byFeature: [] } });
    assert.equal(result.totalUsd, null);
    assert.equal(result.pricedUsd, 10);
  });

  test('missing appSummary defaults to the empty shape and does not throw', () => {
    const result = buildTaskCost({ ownRows: [priced()] });
    assert.equal(result.totalUsd, 10);
    assert.deepEqual(result.appCalls, EMPTY_APP);
  });

  test('LIN-2253: no rows at all → noLineage, totalUsd null — never a vacuous $0', () => {
    // Zero `taken` rows is exactly what a lane-landed, non-anchor ticket
    // looks like (LIN-2253): it has no dispatch row of its own. An empty
    // set trivially satisfies "everything priced", so before the fix this
    // read as a confirmed $0 rather than "no data for this issue at all".
    const result = buildTaskCost({ ownRows: [] });
    assert.equal(result.pricedUsd, 0);
    assert.equal(result.totalUsd, null);
    assert.equal(result.noLineage, true);
    assert.deepEqual(result.workerSessions, []);
  });

  test('a real lineage sets noLineage false, even when it is unpriced', () => {
    const unpricedRow = row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ model: 'no-such-model/vX' })] });
    const result = buildTaskCost({ ownRows: [unpricedRow], appSummary: EMPTY_APP });
    assert.equal(result.noLineage, false);
    assert.equal(result.totalUsd, null);
  });
});

describe('buildTaskCost — worker-session audit fields', () => {
  test('`kind` passes through per lineage (e.g. autopilot rows are labeled, not excluded)', () => {
    const autopilotRow = row({ id: 'a', kind: 'autopilot', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ costUsd: 3.32 })] });
    const result = buildTaskCost({ ownRows: [autopilotRow], appSummary: EMPTY_APP });
    assert.equal(result.workerSessions[0].kind, 'autopilot');
    assert.equal(result.pricedUsd, 3.32);
  });

  test('`rootItemId` is exposed on each worker session for lineage auditability', () => {
    const a = row({ id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1', feedback: [usageEntry({ costUsd: 1 })] });
    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });
    assert.equal(result.workerSessions[0].rootItemId, 'root1');
  });
});

// LIN-2615 review gate item 4: `effort`/`durationMs` had zero test coverage
// (mutation F stripped both fields on both branches with a fully green
// suite). These pin both fields on the priced and no-telemetry branches,
// plus the documented null guards for unavailable/invalid completion timing
// and a negative-duration case.
describe('buildTaskCost — effort + durationMs surface (LIN-2615)', () => {
  test('priced branch: effort and durationMs are derived from usage + the terminal marker timestamp', () => {
    const a = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [
        usageEntry({ effort: 'high', costUsd: 1.5, timestamp: '2026-08-01T10:09:30Z' }),
        { message: '[done] finished', timestamp: '2026-08-01T10:09:40Z' }
      ]
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.equal(result.workerSessions[0].effort, 'high');
    // 10:00:00 -> 10:09:40 terminal marker = 580000ms.
    assert.equal(result.workerSessions[0].durationMs, 580000);
  });

  test('priced branch: an absent usage.effort surfaces as null, not undefined', () => {
    const a = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [
        usageEntry({ costUsd: 1 }),
        { message: '[done] finished', timestamp: '2026-08-01T10:05:00Z' }
      ]
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.strictEqual(result.workerSessions[0].effort, null);
  });

  test('no-telemetry branch: effort is null (no usage row to derive from); durationMs still derives from the terminal marker alone', () => {
    const a = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [{ message: '[done] finished', timestamp: '2026-08-01T10:05:00Z' }]
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.equal(result.noTelemetryCount, 1);
    assert.strictEqual(result.workerSessions[0].effort, null);
    // durationMs is derived from dispatchedAt + the terminal marker's own
    // timestamp — independent of whether a `[usage]` entry exists at all.
    assert.strictEqual(result.workerSessions[0].durationMs, 300000);
  });

  test('no-telemetry branch: durationMs is null too when there is no terminal marker either', () => {
    const a = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: []
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.equal(result.noTelemetryCount, 1);
    assert.strictEqual(result.workerSessions[0].effort, null);
    assert.strictEqual(result.workerSessions[0].durationMs, null);
  });

  test('durationMs is null when no terminal marker exists yet (completedAt unavailable)', () => {
    const a = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [usageEntry({ costUsd: 1, timestamp: '2026-08-01T10:05:00Z' })]
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.strictEqual(result.workerSessions[0].durationMs, null);
  });

  test('durationMs is null when dispatchedAt is missing, even with a terminal marker', () => {
    const a = row({
      id: 'a', dispatchedAt: undefined, rootItemId: 'root1',
      feedback: [
        usageEntry({ costUsd: 1 }),
        { message: '[done] finished', timestamp: '2026-08-01T10:05:00Z' }
      ]
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.strictEqual(result.workerSessions[0].durationMs, null);
  });

  test('durationMs is null when the terminal timestamp is an unparseable date (invalid completion timing)', () => {
    const a = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [
        usageEntry({ costUsd: 1 }),
        { message: '[done] finished', timestamp: 'not-a-real-date' }
      ]
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.strictEqual(result.workerSessions[0].durationMs, null);
  });

  test('durationMs is null (never negative) when the terminal marker predates dispatchedAt', () => {
    const a = row({
      id: 'a', dispatchedAt: '2026-08-01T10:00:00Z', rootItemId: 'root1',
      feedback: [
        usageEntry({ costUsd: 1 }),
        { message: '[done] finished', timestamp: '2026-08-01T09:59:00Z' }
      ]
    });

    const result = buildTaskCost({ ownRows: [a], appSummary: EMPTY_APP });

    assert.strictEqual(result.workerSessions[0].durationMs, null);
  });
});

// LIN-4136: one fold over a lineage's rows. Tokens and cost describe the same counted rows, and an
// unreadable usage is never replaced by an earlier readable one.
describe('buildTaskCost — one fold over a lineage\'s rows (LIN-4136)', () => {
  const at = (hour) => `2026-11-01T${hour}:00:00.000Z`;
  const payload = (anchor, body) => ({ kind: 'usage', rootItemId: anchor, timestamp: at('10'), message: `[usage] ${JSON.stringify(body)}` });
  const snapshot = (costUsd, extra = {}) => ({ harness: 'claude-code', model: 'claude-sonnet-5', costUsd, ...extra });
  const delta = (costUsd, extra = {}) => ({ harness: 'opencode', model: 'claude-sonnet-5', costUsd, ...extra });
  const UNREADABLE = (anchor) => ({ kind: 'usage', rootItemId: anchor, timestamp: at('10'), message: '[usage] {not json' });

  test('an unreadable last row withholds the lineage figure: the earlier snapshot is not shown as priced', () => {
    const r1 = row({ id: 'r1', rootItemId: 'A', dispatchedAt: at('09'), feedback: [payload('A', snapshot(5))] });
    const r2 = row({ id: 'r2', rootItemId: 'A', dispatchedAt: at('10'), feedback: [UNREADABLE('A')] });
    const cost = buildTaskCost({ ownRows: [r1, r2] });
    assert.equal(cost.workerSessions.length, 1);
    assert.equal(cost.workerSessions[0].costUsd, null);
    assert.equal(cost.workerSessions[0].telemetry, true, 'the run did post usage, so it is not "no telemetry"');
    assert.equal(cost.unreadableCount, 1);
    assert.equal(cost.noTelemetryCount, 0);
    assert.equal(cost.pricedUsd, 0);
    assert.equal(cost.totalUsd, null);
  });

  test('an unreadable row that is the only usage: unreadable, not no-telemetry', () => {
    const r1 = row({ id: 'r1', rootItemId: 'B', dispatchedAt: at('09'), feedback: [UNREADABLE('B')] });
    const cost = buildTaskCost({ ownRows: [r1] });
    assert.equal(cost.unreadableCount, 1);
    assert.equal(cost.noTelemetryCount, 0);
    assert.equal(cost.totalUsd, null);
  });

  test('opencode deltas across rows sum, one per row', () => {
    const r1 = row({ id: 'r1', rootItemId: 'C', dispatchedAt: at('09'), feedback: [payload('C', delta(1))] });
    const r2 = row({ id: 'r2', rootItemId: 'C', dispatchedAt: at('10'), feedback: [payload('C', delta(2))] });
    const cost = buildTaskCost({ ownRows: [r1, r2] });
    assert.equal(cost.workerSessions[0].costUsd, 3);
    assert.equal(cost.pricedUsd, 3);
    assert.equal(cost.totalUsd, 3);
  });

  test('one row with two usage entries counts only its last entry, never their sum', () => {
    const r1 = row({ id: 'r1', rootItemId: 'D', dispatchedAt: at('09'), feedback: [payload('D', delta(1)), payload('D', delta(2))] });
    const cost = buildTaskCost({ ownRows: [r1] });
    assert.equal(cost.workerSessions[0].costUsd, 2);
  });

  test('a snapshot, then a delta: the snapshot and the delta both count', () => {
    const r1 = row({ id: 'r1', rootItemId: 'E', dispatchedAt: at('09'), feedback: [payload('E', snapshot(5))] });
    const r2 = row({ id: 'r2', rootItemId: 'E', dispatchedAt: at('10'), feedback: [payload('E', delta(1))] });
    const cost = buildTaskCost({ ownRows: [r1, r2] });
    assert.equal(cost.workerSessions[0].costUsd, 6);
    assert.equal(cost.pricedUsd, 6);
  });

  test('the labels come from the lineage\'s last counted row, the row whose figure is shown', () => {
    const r1 = row({ id: 'r1', rootItemId: 'F', dispatchedAt: at('09'), feedback: [payload('F', snapshot(5, { model: 'claude-haiku-5-5' }))] });
    const r2 = row({ id: 'r2', rootItemId: 'F', dispatchedAt: at('10'), feedback: [payload('F', delta(1, { effort: 'high' }))] });
    const [session] = buildTaskCost({ ownRows: [r1, r2] }).workerSessions;
    assert.equal(session.harness, 'opencode');
    assert.equal(session.model, 'claude-sonnet-5');
    assert.equal(session.effort, 'high');
  });

  test('an unpriced row in a mixed lineage: its model is listed, and the total is withheld', () => {
    const r1 = row({ id: 'r1', rootItemId: 'G', dispatchedAt: at('09'), feedback: [payload('G', snapshot(5))] });
    const r2 = row({ id: 'r2', rootItemId: 'G', dispatchedAt: at('10'), feedback: [payload('G', { harness: 'opencode', model: 'mystery-model-zz' })] });
    const cost = buildTaskCost({ ownRows: [r1, r2] });
    assert.equal(cost.workerSessions[0].costUsd, null);
    assert.deepEqual(cost.unpriced, ['mystery-model-zz']);
    assert.equal(cost.pricedUsd, 0);
    assert.equal(cost.totalUsd, null);
  });
});
