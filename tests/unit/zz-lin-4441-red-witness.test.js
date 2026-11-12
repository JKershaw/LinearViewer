// THROWAWAY (LIN-4441): fails only in the proxy arm, which alone sets CLOCK_SHIFT_DAYS. Proves ci-success goes red. Reverted in the next commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('LIN-4441 red witness: fails only when the proxy arm sets CLOCK_SHIFT_DAYS', () => {
  if (process.env.CLOCK_SHIFT_DAYS === '400') assert.fail('LIN-4441 deliberate red in the unit-proxy job');
});
