/**
 * experiments/replay-kit/lib/router/vclock.mjs (LIN-3851)
 *
 * The pump must fire a due virtual timer only once queued real setImmediate
 * callbacks have run, not after a fixed number of turns. A six-step
 * setImmediate chain plus a 1 ms virtual timer must see the whole chain first,
 * through both pumpUntil and drain.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import * as vclock from '../../experiments/replay-kit/lib/router/vclock.mjs';

const { real } = vclock.install();

function queueChain(order, steps) {
  const step = (i) => {
    order.push(`imm${i}`);
    if (i + 1 < steps) real.setImmediate(() => step(i + 1));
  };
  real.setImmediate(() => step(0));
}

const expected = ['imm0', 'imm1', 'imm2', 'imm3', 'imm4', 'imm5', 'timer'];

test('LIN-3851 pumpUntil: a setImmediate chain runs before a due virtual timer', async () => {
  const order = [];
  vclock.begin(1_000_000, []);
  try {
    queueChain(order, 6);
    setTimeout(() => order.push('timer'), 1);
    await vclock.pumpUntil(() => order.includes('timer'));
  } finally { vclock.end(); }
  assert.deepStrictEqual(order, expected);
});

test('LIN-3851 drain: a setImmediate chain runs before a due virtual timer', async () => {
  const order = [];
  vclock.begin(1_000_000, []);
  try {
    queueChain(order, 6);
    setTimeout(() => order.push('timer'), 1);
    await vclock.drain();
  } finally { vclock.end(); }
  assert.deepStrictEqual(order, expected);
});
