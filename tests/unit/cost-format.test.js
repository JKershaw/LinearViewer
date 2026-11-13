/**
 * LIN-4179 / LIN-4446: the one USD formatter, lib/cost-format.js. The browser runs these same bytes through the
 * module shim (public/cost-format-global.js, which imports /lib/cost-format.js, LIN-4471), so this file pins the rules the
 * browser inherits.
 *
 * Run with: node --test tests/unit/cost-format.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, sumWords } from '../../lib/cost-format.js';

/** One table of edges: the half-cent and half-ten-thousandth floors, the $1 fine boundary, signs, unknowns. */
const TABLE = [
  null, undefined, NaN, Infinity, -Infinity, '0.5', 0, -0,
  0.00004, 0.00005, 0.0001, 0.004, 0.005, 0.0049999, 0.0421, 0.5, 0.99995, 0.99999, 1, 1.005, 12.4, 1234.5,
  -1.5, -0.004, -0.00004,
];

describe('formatUsd: the rules', () => {
  test('cents by default, and a nonzero amount under half a cent reads <$0.01', () => {
    assert.equal(formatUsd(12.4), '$12.40');
    assert.equal(formatUsd(0.005), '$0.01');
    assert.equal(formatUsd(0.0049999), '<$0.01');
    assert.equal(formatUsd(0.004), '<$0.01');
    assert.equal(formatUsd(-0.004), '-<$0.01');
  });

  test('fine: four decimals under $1, and a nonzero amount under half a ten-thousandth reads <$0.0001', () => {
    assert.equal(formatUsd(0.0421, { fine: true }), '$0.0421');
    assert.equal(formatUsd(0.00005, { fine: true }), '$0.0001');
    assert.equal(formatUsd(0.00004, { fine: true }), '<$0.0001');
    assert.equal(formatUsd(-0.00004, { fine: true }), '-<$0.0001');
    assert.equal(formatUsd(1.005, { fine: true }), '$1.00');
  });

  test('null, undefined, non-finite and non-number values never return a dollar figure', () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, '0.5']) {
      assert.equal(formatUsd(value), null);
      assert.equal(formatUsd(value, { fine: true }), null);
    }
  });

  test('a complete zero is a real $0.00 (or $0.0000 with fine)', () => {
    assert.equal(formatUsd(0), '$0.00');
    assert.equal(formatUsd(-0), '$0.00');
    assert.equal(formatUsd(0, { fine: true }), '$0.0000');
  });

  test('every table input yields a string or null, and never a dollar figure for an unknown', () => {
    for (const fine of [false, true]) {
      for (const value of TABLE) {
        const words = formatUsd(value, { fine });
        const unknown = value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value);
        if (unknown) assert.equal(words, null, `input ${String(value)} fine=${fine}`);
        else assert.match(words, /^-?(<)?\$\d/, `input ${String(value)} fine=${fine} gave ${words}`);
      }
    }
  });
});

describe('sumWords: the figure rule in words (W5)', () => {
  test('complete: the USD figure, and a complete zero is $0.00', () => {
    assert.equal(sumWords({ usd: 0.33, priced: 5, unpriced: 0 }, { fine: true }), '$0.3300');
    assert.equal(sumWords({ usd: 0, priced: 1, unpriced: 0 }), '$0.00');
  });

  test('partly priced: the priced sum and the gap named, never a silent total', () => {
    assert.equal(sumWords({ usd: 12.4, priced: 3, unpriced: 2 }), '$12.40, 2 not priced');
  });

  test('nothing priced: "not priced", never $0.00', () => {
    assert.equal(sumWords({ usd: 0, priced: 0, unpriced: 4 }), 'not priced');
  });

  test('no inputs: "no data", distinct from a zero', () => {
    assert.equal(sumWords({ usd: 0, priced: 0, unpriced: 0 }), 'no data');
  });
});
