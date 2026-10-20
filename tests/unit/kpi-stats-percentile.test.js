/**
 * LIN-3713 — nearest-rank percentile beside the shared median.
 * Run with: node --test tests/unit/kpi-stats-percentile.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, percentile } from '../../lib/kpi-stats.js';

test('percentile is nearest-rank and null when empty', () => {
  assert.equal(percentile([], 0.9), null);
  assert.equal(percentile([7], 0.9), 7);
  assert.equal(percentile([3, 1, 2], 0.9), 3);
  assert.equal(percentile(Array.from({ length: 10 }, (_, i) => i + 1), 0.9), 9);
  assert.equal(percentile(Array.from({ length: 11 }, (_, i) => i + 1), 0.9), 10);
  assert.equal(percentile([1, 2, 3], 0), 1);
  // nearest-rank rounds up (ceil gives 6); Math.round would give 5
  assert.equal(percentile([1, 2, 3, 4, 5, 6], 0.9), 6);
});

test('median is exported and unchanged', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});
