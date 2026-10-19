import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { followUpTarget } from '../../lib/dispatch-targets.js';

describe('followUpTarget (LIN-3672, LIN-3677)', () => {
  const rows = [
    ['web', 'web'],
    ['cli', 'cli'],
    ['dash', null],
    ['local', null],
    [null, 'cli'],
    [undefined, 'cli'],
    ['', 'cli'],
    ['carrier-pigeon', null],
    [42, null],
    [{}, null],
    [['web'], null],
    [false, null],
    [0, null],
  ];
  for (const [input, expected] of rows) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(followUpTarget(input), expected);
    });
  }
});
