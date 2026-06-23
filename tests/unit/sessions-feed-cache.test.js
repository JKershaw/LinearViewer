import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionsFeedCache } from '../../lib/sessions-feed-cache.js';

// A tick helper that lets queued microtasks (the background refresh) settle.
const flush = () => new Promise(resolve => setImmediate(resolve));

describe('sessions-feed-cache: keyFor', () => {
  test('is order-independent over the workspace set', () => {
    const cache = createSessionsFeedCache();
    const a = cache.keyFor([{ urlKey: 'ws-b' }, { urlKey: 'ws-a' }]);
    const b = cache.keyFor([{ urlKey: 'ws-a' }, { urlKey: 'ws-b' }]);
    assert.equal(a, b);
  });

  test('different workspace sets get different keys', () => {
    const cache = createSessionsFeedCache();
    assert.notEqual(
      cache.keyFor([{ urlKey: 'ws-a' }]),
      cache.keyFor([{ urlKey: 'ws-a' }, { urlKey: 'ws-b' }])
    );
  });

  test('tolerates null/empty', () => {
    const cache = createSessionsFeedCache();
    assert.equal(cache.keyFor(), '');
    assert.equal(cache.keyFor([]), '');
  });
});

describe('sessions-feed-cache: get', () => {
  test('cold miss awaits the producer and caches the value', async () => {
    const cache = createSessionsFeedCache();
    let calls = 0;
    const produce = async () => { calls++; return ['v', calls]; };

    const first = await cache.get('k', produce);
    assert.deepEqual(first, ['v', 1]);
    assert.equal(calls, 1);

    // Within TTL: served from cache, producer not called again.
    const second = await cache.get('k', produce);
    assert.deepEqual(second, ['v', 1]);
    assert.equal(calls, 1, 'no re-scan within TTL');
  });

  test('concurrent cold callers collapse onto one production', async () => {
    const cache = createSessionsFeedCache();
    let calls = 0;
    let release;
    const gate = new Promise(r => { release = r; });
    const produce = async () => { calls++; await gate; return 'done'; };

    const p1 = cache.get('k', produce);
    const p2 = cache.get('k', produce);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(r1, 'done');
    assert.equal(r2, 'done');
    assert.equal(calls, 1, 'a burst of first polls triggers a single scan');
  });

  test('stale entry is served immediately while a single background refresh runs', async () => {
    let clock = 1000;
    const cache = createSessionsFeedCache({ ttlMs: 100, now: () => clock });
    let calls = 0;
    const produce = async () => { calls++; return `gen-${calls}`; };

    assert.equal(await cache.get('k', produce), 'gen-1');
    assert.equal(calls, 1);

    // Advance past the TTL: the next get returns the STALE value instantly and
    // kicks off exactly one background refresh.
    clock += 200;
    const stale = await cache.get('k', produce);
    assert.equal(stale, 'gen-1', 'stale value served immediately (no blocking)');

    await flush();
    assert.equal(calls, 2, 'one background refresh ran');

    // Subsequent get (still within the refreshed TTL) sees the new value.
    const refreshed = await cache.get('k', produce);
    assert.equal(refreshed, 'gen-2', 'background refresh updated the cache');
    assert.equal(calls, 2, 'no extra production for the fresh read');
  });

  test('only one background refresh is in flight at a time', async () => {
    let clock = 0;
    const cache = createSessionsFeedCache({ ttlMs: 10, now: () => clock });
    let calls = 0;
    let release;
    const produce = () => { calls++; return new Promise(r => { release = r; }); };

    // Prime cold (producer runs on a microtask, so flush before releasing it).
    const primed = cache.get('k', produce);
    await flush();
    release();
    await primed;
    assert.equal(calls, 1);

    // Go stale, then fire several reads before the refresh resolves.
    clock += 100;
    await cache.get('k', produce); // serves stale, starts refresh #2
    await flush();                 // let the background refresh invoke produce
    await cache.get('k', produce); // serves stale, refresh already in flight
    await cache.get('k', produce);
    assert.equal(calls, 2, 'concurrent stale reads share one refresh');
    release();
    await flush();
  });

  test('a failed cold production is not cached (next poll retries)', async () => {
    const cache = createSessionsFeedCache();
    let calls = 0;
    const produce = async () => { calls++; if (calls === 1) throw new Error('boom'); return 'ok'; };

    await assert.rejects(() => cache.get('k', produce), /boom/);
    // The failure was not cached: the next call retries from cold and succeeds.
    assert.equal(await cache.get('k', produce), 'ok');
    assert.equal(calls, 2);
  });

  test('a failed background refresh keeps serving the last good value', async () => {
    let clock = 0;
    const cache = createSessionsFeedCache({ ttlMs: 10, now: () => clock });
    let calls = 0;
    const produce = async () => { calls++; if (calls >= 2) throw new Error('refresh failed'); return 'good'; };

    assert.equal(await cache.get('k', produce), 'good');
    clock += 100;
    assert.equal(await cache.get('k', produce), 'good', 'stale-but-good served');
    await flush();
    assert.equal(calls, 2, 'refresh attempted');
    // Still serves the last good value despite the failed refresh.
    assert.equal(await cache.get('k', produce), 'good');
  });
});
