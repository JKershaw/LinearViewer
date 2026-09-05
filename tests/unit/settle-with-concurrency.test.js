/**
 * Direct unit coverage for `settleWithConcurrency` (routes/dashboard.js),
 * exported for reuse by LIN-2666's `GET /workspace/:urlKey/api/scan-due` route.
 *
 * The helper had no direct test at HEAD (`grep -rl settleWithConcurrency tests/`
 * returned nothing before this file) — its three existing dashboard.js call
 * sites only exercised it incidentally. This buys the coverage the export needs
 * rather than assuming it: result order, rejection isolation, the concurrency
 * bound, an oversized limit, and empty input.
 *
 * Run with: node --test tests/unit/settle-with-concurrency.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { settleWithConcurrency } from '../../routes/dashboard.js';

// A deferred promise so a test can control exactly when an in-flight mapper
// call resolves, making the concurrency bound observable rather than assumed.
function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('settleWithConcurrency', () => {
  test('results preserve input order regardless of completion order', async () => {
    // Item 0 resolves LAST (longest delay) and item 2 resolves FIRST, so an
    // implementation that appended results in completion order (rather than
    // writing to the input index) would produce [2, 1, 0] here.
    const delays = [30, 15, 0];
    const results = await settleWithConcurrency([0, 1, 2], 3, async (i) => {
      await new Promise((r) => setTimeout(r, delays[i]));
      return `item-${i}`;
    });
    assert.deepStrictEqual(
      results.map(r => r.value),
      ['item-0', 'item-1', 'item-2']
    );
  });

  test('a rejecting task is isolated — does not reject the batch or other slots', async () => {
    const results = await settleWithConcurrency([1, 2, 3], 2, async (i) => {
      if (i === 2) throw new Error(`boom-${i}`);
      return `ok-${i}`;
    });
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].status, 'fulfilled');
    assert.strictEqual(results[0].value, 'ok-1');
    assert.strictEqual(results[1].status, 'rejected');
    assert.strictEqual(results[1].reason.message, 'boom-2');
    assert.strictEqual(results[2].status, 'fulfilled');
    assert.strictEqual(results[2].value, 'ok-3');
  });

  test('peak concurrent in-flight calls never exceeds the given limit', async () => {
    const LIMIT = 3;
    const items = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const gates = items.map(() => deferred());

    const run = settleWithConcurrency(items, LIMIT, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      assert.ok(inFlight <= LIMIT, `observed ${inFlight} in-flight, limit was ${LIMIT}`);
      await gates[i].promise;
      inFlight--;
      return i;
    });

    // Release one gate at a time; each release should let exactly one more
    // queued item start, keeping in-flight pinned at the limit until the tail.
    for (let released = 0; released < items.length; released++) {
      // Give pending microtasks/timers a tick to let workers pick up new items.
      await new Promise((r) => setTimeout(r, 5));
      gates[released].resolve();
    }

    await run;
    assert.strictEqual(peak, LIMIT, `expected peak in-flight to reach the limit ${LIMIT}, observed ${peak}`);
  });

  test('a limit greater than the item count runs everything without error', async () => {
    const results = await settleWithConcurrency([1, 2], 10, async (i) => i * 2);
    assert.deepStrictEqual(results.map(r => r.value), [2, 4]);
    assert.ok(results.every(r => r.status === 'fulfilled'));
  });

  test('empty input resolves to an empty array without invoking the mapper', async () => {
    let calls = 0;
    const results = await settleWithConcurrency([], 5, async () => { calls++; });
    assert.deepStrictEqual(results, []);
    assert.strictEqual(calls, 0);
  });
});
