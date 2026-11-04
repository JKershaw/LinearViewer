/**
 * LIN-4201: the one request-records loader (lib/request-usage-loader.js), over a fake store's `listForAnchors`.
 * The store's own read (posting row, current anchor, one record per request) is pinned by the LIN-4198/LIN-4212
 * tests; these pin what the loader adds: dedupe, batching, grouping rows by workspace, and the required-loader throw.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requestUsageLoader, requireRequestUsageLoader, REQUEST_ROWS_BATCH_SIZE } from '../../lib/request-usage-loader.js';

function fakeStore() {
  const calls = [];
  return {
    calls,
    listForAnchors: async (urlKey, anchors) => {
      calls.push({ urlKey, anchors: [...anchors] });
      return anchors.map(anchor => ({ rootItemId: anchor, requestId: `${urlKey}:${anchor}` }));
    },
  };
}

describe('requestUsageLoader.forAnchors', () => {
  test('dedupes anchors, drops empty ones, and returns the store\'s records', async () => {
    const store = fakeStore();
    const out = await requestUsageLoader(store).forAnchors('acme', ['a', 'b', 'a', '', null, undefined]);
    assert.deepEqual(store.calls, [{ urlKey: 'acme', anchors: ['a', 'b'] }]);
    assert.deepEqual(out.map(r => r.requestId), ['acme:a', 'acme:b']);
  });

  test('accepts any iterable of anchors (a Set from anchorsOfRows)', async () => {
    const store = fakeStore();
    await requestUsageLoader(store).forAnchors('acme', new Set(['x']));
    assert.deepEqual(store.calls, [{ urlKey: 'acme', anchors: ['x'] }]);
  });

  test('no anchors or no urlKey: no store read, no records', async () => {
    const store = fakeStore();
    const loader = requestUsageLoader(store);
    assert.deepEqual(await loader.forAnchors('acme', []), []);
    assert.deepEqual(await loader.forAnchors('', ['a']), []);
    assert.deepEqual(store.calls, []);
  });

  test('batches anchors so one query\'s $in stays bounded, and keeps every record', async () => {
    const store = fakeStore();
    const anchors = Array.from({ length: REQUEST_ROWS_BATCH_SIZE * 2 + 1 }, (_, i) => `a${i}`);
    const out = await requestUsageLoader(store).forAnchors('acme', anchors);
    assert.deepEqual(store.calls.map(c => c.anchors.length), [REQUEST_ROWS_BATCH_SIZE, REQUEST_ROWS_BATCH_SIZE, 1]);
    assert.equal(out.length, anchors.length);
  });
});

describe('requestUsageLoader.forRows', () => {
  test('groups the rows\' anchors by each row\'s own urlKey (the instance-wide /kpis read)', async () => {
    const store = fakeStore();
    await requestUsageLoader(store).forRows([
      { urlKey: 'acme', rootItemId: 'r1' },
      { urlKey: 'acme', rootItemId: 'r1' },
      { urlKey: 'beta', _id: 'b1' },
      { urlKey: 'acme', id: 'r2', rootItemId: null },
    ]);
    assert.deepEqual(store.calls, [{ urlKey: 'acme', anchors: ['r1', 'r2'] }, { urlKey: 'beta', anchors: ['b1'] }]);
  });

  test('a row with no urlKey takes the given one; with neither it is skipped', async () => {
    const store = fakeStore();
    const loader = requestUsageLoader(store);
    await loader.forRows([{ rootItemId: 'r1' }], { urlKey: 'acme' });
    await loader.forRows([{ rootItemId: 'r2' }]);
    assert.deepEqual(store.calls, [{ urlKey: 'acme', anchors: ['r1'] }]);
  });
});

describe('the loader is required', () => {
  test('requestUsageLoader refuses a store without listForAnchors', () => {
    assert.throws(() => requestUsageLoader(undefined), /a store with listForAnchors is required/);
    assert.throws(() => requestUsageLoader({}), /a store with listForAnchors is required/);
  });

  test('requireRequestUsageLoader names the caller that was wired without one', () => {
    assert.throws(() => requireRequestUsageLoader(undefined, 'GET /api/proxy/cost'), { name: 'TypeError', message: /GET \/api\/proxy\/cost: the request-usage loader is required/ });
    assert.throws(() => requireRequestUsageLoader({ forAnchors() {} }, 'x'), /is required/);
    const loader = requestUsageLoader(fakeStore());
    assert.equal(requireRequestUsageLoader(loader, 'x'), loader);
  });
});

describe('volume (LIN-4201 beat 3: found by the steady-state timing run)', () => {
  test('a quarter of a million records come back without overflowing the call stack', async () => {
    const big = Array.from({ length: 250_000 }, (_, i) => ({ rootItemId: 'r1', requestId: `m${i}` }));
    const store = { listForAnchors: async () => big };
    const loader = requestUsageLoader(store);
    assert.equal((await loader.forAnchors('acme', ['r1'])).length, big.length);
    assert.equal((await loader.forRows([{ urlKey: 'acme', rootItemId: 'r1' }])).length, big.length);
  });
});
