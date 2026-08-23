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
import { buildTaskCost, anchorFor } from '../../lib/task-cost.js';

// A `[usage]` feedback entry. `costUsd` is embedded directly in the payload
// (parseUsagePayload prefers a native cost over deriving one), so tests can
// pin an exact price without needing a real model-pricing rate. Omit it (and
// use a model with no rate-card row) to exercise the unpriced path.
function usageEntry({ model = 'anthropic/claude-sonnet-5', costUsd, timestamp, rootItemId } = {}) {
  const payload = { model };
  if (costUsd !== undefined) payload.costUsd = costUsd;
  const entry = { kind: 'usage', timestamp, message: `[usage] ${JSON.stringify(payload)}` };
  if (rootItemId) entry.rootItemId = rootItemId;
  return entry;
}

function row({ id, status = 'taken', dispatchedAt, feedback = [], kind = 'implementation', rootItemId } = {}) {
  return { id, status, dispatchedAt, feedback, kind, rootItemId };
}

const EMPTY_APP = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };

describe('anchorFor', () => {
  test('prefers the row-level rootItemId', () => {
    assert.equal(anchorFor({ id: 'a', rootItemId: 'root1', feedback: [] }), 'root1');
  });

  test('falls back to the first feedback entry carrying rootItemId', () => {
    assert.equal(
      anchorFor({ id: 'a', feedback: [{ message: 'x' }, { rootItemId: 'root2' }] }),
      'root2'
    );
  });

  test('falls back to the row id when neither is present (legacy row)', () => {
    assert.equal(anchorFor({ id: 'a', feedback: [] }), 'a');
  });
});

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
