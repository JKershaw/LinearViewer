/**
 * file-pointer reads numeric timestamps (LIN-3453 toEpochMs).
 *
 * The private toMs used Date.parse(value), which is NaN (so null) for an
 * epoch-ms number. The shared toEpochMs accepts a finite number as epoch ms,
 * so a row stamped with a number is now positioned instead of left undated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPilotRows } from '../../lib/file-pointer.js';

const row = (id, dispatchedAt) => ({
  id, kind: 'implementation', followUpTo: null, issueIdentifier: 'LIN-1', dispatchedAt, delivered: true
});

test('classifyPilotRows positions rows whose dispatchedAt is an epoch-ms number', () => {
  const t = Date.parse('2026-06-01T00:00:00.000Z');
  const out = classifyPilotRows([row('b', t + 3600000), row('a', t)]);
  assert.deepEqual(out.rows.map(r => r.id), ['a', 'b']);
});

test('classifyPilotRows still leaves junk dispatchedAt undated', () => {
  const out = classifyPilotRows([row('a', 'not-a-date'), row('b', undefined)]);
  assert.equal(out.rows.length, 0);
});
