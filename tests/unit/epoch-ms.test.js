/**
 * Contract test for lib/utils/time.js `toEpochMs` (LIN-3454, part of LIN-3453).
 *
 * One tolerant timestamp parse replaces the private toMs/toMillis/_epoch
 * copies in lib/. The contract is `number | null`, never `NaN`: a Date, an
 * ISO/date string or a finite in-range number is epoch ms; everything else
 * (junk, '', null, undefined, booleans, objects, Invalid Date, ±Infinity,
 * NaN, out-of-range numbers) is `null`. `0` is a valid epoch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEpochMs } from '../../lib/utils/time.js';

const ISO = '2024-01-02T03:04:05.000Z';
const ISO_MS = Date.parse(ISO);
const MAX_MS = 8.64e15;

const TABLE = [
  ['valid Date', new Date(ISO), ISO_MS],
  ['Invalid Date instance', new Date('not-a-date'), null],
  ['ISO string', ISO, ISO_MS],
  ['junk string', 'not-a-date', null],
  ["empty string ''", '', null],
  ['null', null, null],
  ['undefined', undefined, null],
  ['0 (valid epoch)', 0, 0],
  ['positive number -> itself', 1717977600000, 1717977600000],
  ['negative number -> itself', -86400000, -86400000],
  ['true', true, null],
  ['false', false, null],
  ['plain object', {}, null],
  ['object with numeric valueOf', { valueOf: () => 1 }, null],
  ['array', [1], null],
  ['+Infinity', Infinity, null],
  ['-Infinity', -Infinity, null],
  ['NaN', NaN, null],
  ['8.64e15 (max time value)', MAX_MS, MAX_MS],
  ['8.64e15 + 1 (out of range)', MAX_MS + 1, null],
  ['-8.64e15 (min time value)', -MAX_MS, -MAX_MS],
  ['-8.64e15 - 1 (out of range)', -MAX_MS - 1, null],
];

for (const [label, input, expected] of TABLE) {
  test(`toEpochMs: ${label}`, () => {
    const got = toEpochMs(input);
    assert.ok(got === null || typeof got === 'number', 'returns number | null');
    assert.ok(!Number.isNaN(got), 'never NaN');
    assert.equal(got, expected);
  });
}

test('toEpochMs: 0 is a valid epoch, not missing (LIN-3453 changed cell)', () => {
  assert.equal(toEpochMs(0), 0);
  assert.equal(toEpochMs(new Date(0)), 0);
});

test('toEpochMs: booleans are missing, not 0/1 (LIN-3453 changed cell)', () => {
  assert.equal(toEpochMs(true), null);
  assert.equal(toEpochMs(false), null);
});
