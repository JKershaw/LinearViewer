import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { followUpTarget } from '../../lib/dispatch-targets.js';

describe('followUpTarget (LIN-3672)', () => {
  const rows = [
    ['web', 'web'],
    ['cli', 'cli'],
    ['dash', null],
    ['local', null],
    [null, 'cli'],
    [undefined, 'cli'],
    ['', 'cli'],
    ['carrier-pigeon', 'cli'],
    [42, 'cli'],
    [{}, 'cli'],
  ];
  for (const [input, expected] of rows) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(followUpTarget(input), expected);
    });
  }
});
