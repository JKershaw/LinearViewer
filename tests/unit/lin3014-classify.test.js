/**
 * scripts/lin3014/lib/classify.mjs (LIN-3014)
 *
 * Row-first classification of a before/after byte measurement. Covers the
 * 4 outcomes the corrected beat-4 classifier distinguishes (comment
 * `eca63aab`): column reduction, bytes increased at the same rows, no
 * change, and a row-count change (LIN-615 violation) — which must win even
 * when bytes also dropped.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { classify } from '../../scripts/lin3014/lib/classify.mjs';

test('LIN-3014 classify: same rows, fewer bytes -> COLUMN reduction', () => {
  const before = { label: 'BEFORE', rows: 7, bytes: 10000 };
  const after = { label: 'AFTER', rows: 7, bytes: 8000 };
  const result = classify(before, after);
  assert.strictEqual(result.kind, 'COLUMN reduction (same rows, fewer bytes)');
  assert.strictEqual(result.rowsEqual, true);
  assert.strictEqual(result.bytesSaved, 2000);
  assert.strictEqual(result.compare, 'BEFORE -> AFTER');
});

test('LIN-3014 classify: same rows, MORE bytes -> BYTES INCREASED (the digest-heavier-than-raw case)', () => {
  const before = { label: 'BEFORE', rows: 7, bytes: 6173 };
  const after = { label: 'AFTER', rows: 7, bytes: 9361 };
  const result = classify(before, after);
  assert.strictEqual(result.kind, 'BYTES INCREASED at same rows (digest outweighs dropped columns)');
  assert.strictEqual(result.rowsEqual, true);
  assert.strictEqual(result.bytesSaved, -3188);
});

test('LIN-3014 classify: same rows, same bytes -> no change', () => {
  const before = { label: 'BEFORE', rows: 3, bytes: 500 };
  const after = { label: 'AFTER', rows: 3, bytes: 500 };
  const result = classify(before, after);
  assert.strictEqual(result.kind, 'no change');
  assert.strictEqual(result.bytesSaved, 0);
});

test('LIN-3014 classify: a row-count change is a LIN-615 violation, even when bytes also dropped', () => {
  const before = { label: 'BEFORE', rows: 7, bytes: 10943 };
  const after = { label: 'PLANTED (hidden row filter)', rows: 6, bytes: 6333 };
  const result = classify(before, after);
  assert.strictEqual(result.kind, 'ROW-COUNT CHANGE 7->6: LIN-615 violation');
  assert.strictEqual(result.rowsEqual, false);
  assert.strictEqual(result.bytesSaved, 4610, 'bytesSaved is still reported, but kind must not read as a win');
});
