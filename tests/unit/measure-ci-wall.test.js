/**
 * scripts/measure-ci-wall.mjs (LIN-4441): the CI wall-time summary is right on fixtures. The gh call is not exercised.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseWall } from '../../scripts/measure-ci-wall.mjs';

const run = (createdAt, minutes, extra = {}) => ({
  createdAt, updatedAt: new Date(Date.parse(createdAt) + minutes * 60000).toISOString(),
  conclusion: 'success', headBranch: 'main', ...extra,
});

test('median and mean of successful main runs; odd and even counts', () => {
  const runs = [run('2026-11-08T10:00:00Z', 8), run('2026-11-09T10:00:00Z', 6), run('2026-11-10T10:00:00Z', 10)];
  assert.deepEqual(summariseWall(runs), { runs: 3, medianMin: 8, meanMin: 8 });
  assert.deepEqual(summariseWall(runs.slice(0, 2)), { runs: 2, medianMin: 7, meanMin: 7 });
});

test('failed, non-main and out-of-window runs are excluded', () => {
  const runs = [
    run('2026-11-08T10:00:00Z', 8),
    run('2026-11-08T11:00:00Z', 99, { conclusion: 'failure' }),
    run('2026-11-08T12:00:00Z', 99, { headBranch: 'feat/x' }),
    run('2026-10-01T10:00:00Z', 99),
  ];
  assert.deepEqual(summariseWall(runs, { since: '2026-11-01T00:00:00Z' }), { runs: 1, medianMin: 8, meanMin: 8 });
});

test('an empty window reports no runs rather than a zero median', () => {
  assert.deepEqual(summariseWall([]), { runs: 0, medianMin: null, meanMin: null });
});
