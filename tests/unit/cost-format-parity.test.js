/**
 * LIN-4179 parity (plan "one formatter", W5): the server's `formatUsd` (lib/cost-format.js) and the browser's
 * (public/cost-format.js, loaded in a vm sandbox as its own IIFE) agree on every input in one table, in both modes.
 * The browser copy is a restatement, so this is the thing that keeps the two from drifting.
 *
 * It also pins W5 on both sides: null, undefined and non-finite values never return a dollar figure, and `sumWords`
 * never turns an unknown into $0.00.
 *
 * Run with: node --test tests/unit/cost-format-parity.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { formatUsd, sumWords } from '../../lib/cost-format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sandbox = { module: { exports: {} }, window: {} };
vm.runInNewContext(readFileSync(join(__dirname, '../../public/cost-format.js'), 'utf8'), sandbox, { filename: 'cost-format.js' });
const browser = sandbox.module.exports;

/** One table through both copies. Edges: the half-cent and half-ten-thousandth floors, the $1 fine boundary, signs, unknowns. */
export const TABLE = [
  null, undefined, NaN, Infinity, -Infinity, '0.5', 0, -0,
  0.00004, 0.00005, 0.0001, 0.004, 0.005, 0.0049999, 0.0421, 0.5, 0.99995, 0.99999, 1, 1.005, 12.4, 1234.5,
  -1.5, -0.004, -0.00004,
];

describe('formatUsd: the server and browser copies agree (W5)', () => {
  for (const fine of [false, true]) {
    test(`every table input, fine=${fine}`, () => {
      for (const value of TABLE) {
        assert.equal(browser.formatUsd(value, { fine }), formatUsd(value, { fine }), `input ${String(value)} fine=${fine}`);
      }
    });
  }

  test('null, undefined and non-finite values never return a dollar figure, on either side', () => {
    for (const value of [null, undefined, NaN, Infinity, '0.5']) {
      assert.equal(formatUsd(value), null);
      assert.equal(formatUsd(value, { fine: true }), null);
      assert.equal(browser.formatUsd(value), null);
      assert.equal(browser.formatUsd(value, { fine: true }), null);
    }
  });

  test('a complete zero is a real $0.00 (or $0.0000 with fine), on both sides', () => {
    assert.equal(formatUsd(0), '$0.00');
    assert.equal(formatUsd(0, { fine: true }), '$0.0000');
    assert.equal(browser.formatUsd(0), '$0.00');
    assert.equal(browser.formatUsd(0, { fine: true }), '$0.0000');
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
