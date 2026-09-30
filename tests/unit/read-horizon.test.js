/**
 * Unit tests for lib/read-horizon.js
 *
 * Run with: node --test tests/unit/read-horizon.test.js
 *
 * Coverage:
 *   - The shared constants (READ_HORIZON_DAYS, READ_HORIZON_MS)
 *   - readHorizonStart arithmetic, for both accepted `now` shapes
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { READ_HORIZON_DAYS, READ_HORIZON_MS, readHorizonStart } from '../../lib/read-horizon.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('read-horizon constants', () => {
  test('READ_HORIZON_DAYS is 30', () => {
    assert.strictEqual(READ_HORIZON_DAYS, 30);
  });

  test('READ_HORIZON_MS is derived from READ_HORIZON_DAYS', () => {
    assert.strictEqual(READ_HORIZON_MS, READ_HORIZON_DAYS * DAY_MS);
  });
});

describe('readHorizonStart', () => {
  test('subtracts the horizon from an epoch-ms now and returns a Date', () => {
    const now = Date.UTC(2026, 4, 11, 12, 0, 0);
    const start = readHorizonStart(now);
    assert.ok(start instanceof Date);
    assert.strictEqual(start.getTime(), now - READ_HORIZON_MS);
    assert.strictEqual(start.toISOString(), '2026-04-11T12:00:00.000Z');
  });

  test('accepts a Date now', () => {
    const start = readHorizonStart(new Date('2026-05-11T12:00:00.000Z'));
    assert.strictEqual(start.toISOString(), '2026-04-11T12:00:00.000Z');
  });

  test('defaults now to the current clock', () => {
    const before = Date.now() - READ_HORIZON_MS;
    const start = readHorizonStart();
    const after = Date.now() - READ_HORIZON_MS;
    assert.ok(start.getTime() >= before && start.getTime() <= after);
  });
});
