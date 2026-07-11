/**
 * Unit tests for lib/task-done-cache.js (LIN-1258, Axis B).
 *
 * Run with: node --test tests/unit/task-done-cache.test.js
 *
 * The cache is the mechanism that enforces the Observation feed's no-Linear-read-
 * per-poll cost contract: an eligible touched task is read from the backend at
 * most once per TTL, so a repeat ~5s poll within the window costs ZERO reads.
 * These tests pin the exact read COUNT across cache hit / TTL expiry / throw,
 * with an injected clock so expiry is deterministic (no real timers).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createTaskDoneCache } from '../../lib/task-done-cache.js';

describe('task-done-cache (LIN-1258)', () => {
  test('a repeat get within the TTL does NOT re-read (0 additional backend reads)', async () => {
    let clock = 0;
    const cache = createTaskDoneCache({ ttlMs: 60000, now: () => clock });
    let reads = 0;
    const producer = async () => { reads++; return true; };

    assert.equal(await cache.get('ws::LIN-1', producer), true);
    assert.equal(reads, 1, 'first get pays exactly one backend read');

    // Repeated polls well within the 60s TTL — every one is a pure memory hit.
    clock = 5000;
    assert.equal(await cache.get('ws::LIN-1', producer), true);
    clock = 55000;
    assert.equal(await cache.get('ws::LIN-1', producer), true);
    assert.equal(reads, 1, 'no re-read within the TTL — the no-Linear-per-poll contract');
  });

  test('after the TTL expires the next get re-reads', async () => {
    let clock = 0;
    const cache = createTaskDoneCache({ ttlMs: 60000, now: () => clock });
    let reads = 0;
    const producer = async () => { reads++; return true; };

    await cache.get('ws::LIN-1', producer);
    assert.equal(reads, 1);

    clock = 60001; // just past the TTL
    await cache.get('ws::LIN-1', producer);
    assert.equal(reads, 2, 'a read past the TTL re-hydrates from the backend');
  });

  test('peek returns the fresh value on a hit and undefined on a miss/expiry (never produces)', async () => {
    let clock = 0;
    const cache = createTaskDoneCache({ ttlMs: 1000, now: () => clock });
    assert.equal(cache.peek('ws::LIN-1'), undefined, 'cold miss → undefined');

    await cache.get('ws::LIN-1', async () => true);
    assert.equal(cache.peek('ws::LIN-1'), true, 'warm hit → cached boolean, no produce');

    clock = 1001;
    assert.equal(cache.peek('ws::LIN-1'), undefined, 'expired entry → undefined');
  });

  test('a distinct key is an independent read (per-task keying)', async () => {
    const cache = createTaskDoneCache();
    let reads = 0;
    const producer = async () => { reads++; return false; };
    await cache.get('ws::LIN-1', producer);
    await cache.get('ws::LIN-2', producer);
    assert.equal(reads, 2, 'two different tasks → two reads');
  });

  test('a throwing producer propagates and is NOT cached (retried on a later poll)', async () => {
    const cache = createTaskDoneCache();
    await assert.rejects(() => cache.get('ws::LIN-1', async () => { throw new Error('backend down'); }));
    assert.equal(cache.peek('ws::LIN-1'), undefined, 'a thrown read leaves no cached entry');
    // The next poll can still succeed and cache a real value.
    assert.equal(await cache.get('ws::LIN-1', async () => true), true);
    assert.equal(cache.peek('ws::LIN-1'), true);
  });

  test('the resolved value is coerced to a boolean', async () => {
    const cache = createTaskDoneCache();
    assert.strictEqual(await cache.get('ws::LIN-1', async () => 1), true);
    assert.strictEqual(await cache.get('ws::LIN-2', async () => 0), false);
  });

  test('clear() drops all entries (test-reset seam)', async () => {
    const cache = createTaskDoneCache();
    await cache.get('ws::LIN-1', async () => true);
    cache.clear();
    assert.equal(cache.peek('ws::LIN-1'), undefined);
  });
});
