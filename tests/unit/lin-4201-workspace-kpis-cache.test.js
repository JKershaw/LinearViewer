/**
 * LIN-4201: the workspace KPIs page's per-workspace stale-while-revalidate cache (lib/workspace-kpis-cache.js). The
 * records-first read loads the window's request records (about +1.35 s at steady-state volume), so the page serves its
 * last read for up to 60 s and refreshes in the background, as /kpis does (lib/kpi-page.js).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceKpisCache } from '../../lib/workspace-kpis-cache.js';
import { KPI_CACHE_MS } from '../../lib/kpi-page.js';

function harness() {
  let clock = 1_000;
  const reads = [];
  let release;
  let gate = Promise.resolve();
  const cache = createWorkspaceKpisCache({
    collect: async (urlKey) => { reads.push(urlKey); await gate; return { urlKey, n: reads.length }; },
    now: () => clock,
    logger: { error: () => {} },
  });
  return {
    cache, reads,
    tick: (ms) => { clock += ms; },
    hold: () => { gate = new Promise((resolve) => { release = resolve; }); },
    release: () => release(),
  };
}

describe('the workspace KPIs cache', () => {
  test('a cold key awaits one read; a fresh one is served without reading again', async () => {
    const h = harness();
    assert.deepEqual(await h.cache.get('a'), { urlKey: 'a', n: 1 });
    h.tick(KPI_CACHE_MS - 1);
    assert.deepEqual(await h.cache.get('a'), { urlKey: 'a', n: 1 });
    assert.deepEqual(h.reads, ['a']);
  });

  test('a stale key is served at once from the last read while one background refresh runs', async () => {
    const h = harness();
    await h.cache.get('a');
    h.tick(KPI_CACHE_MS + 1);
    h.hold();
    assert.deepEqual(await h.cache.get('a'), { urlKey: 'a', n: 1 }, 'stale served, not awaited');
    assert.deepEqual(await h.cache.get('a'), { urlKey: 'a', n: 1 }, 'a second request joins the same refresh');
    assert.deepEqual(h.reads, ['a', 'a']);
    h.release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await h.cache.get('a'), { urlKey: 'a', n: 2 });
  });

  test('concurrent cold requests for one key make one read; keys are separate', async () => {
    const h = harness();
    const [one, two, other] = await Promise.all([h.cache.get('a'), h.cache.get('a'), h.cache.get('b')]);
    assert.equal(one, two);
    assert.equal(other.urlKey, 'b');
    assert.deepEqual(h.reads.sort(), ['a', 'b']);
  });

  test('clear empties one key only; countFor says what it holds', async () => {
    const h = harness();
    await h.cache.get('a');
    await h.cache.get('b');
    h.cache.clear({ urlKey: 'a' });
    assert.equal(h.cache.countFor({ urlKey: 'a' }), 0);
    assert.equal(h.cache.countFor({ urlKey: 'b' }), 1);
    await h.cache.get('a');
    assert.deepEqual(h.reads, ['a', 'b', 'a']);
  });

  test('a failed first read throws to the caller; a failed refresh keeps the last good read', async () => {
    let fail = true;
    let clock = 0;
    const cache = createWorkspaceKpisCache({ collect: async () => { if (fail) throw new Error('db down'); return { ok: true }; }, now: () => clock, logger: { error: () => {} } });
    await assert.rejects(cache.get('a'), /db down/);
    fail = false;
    assert.deepEqual(await cache.get('a'), { ok: true });
    fail = true;
    clock += KPI_CACHE_MS + 1;
    assert.deepEqual(await cache.get('a'), { ok: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await cache.get('a'), { ok: true });
  });

  test('a read is required', () => {
    assert.throws(() => createWorkspaceKpisCache({}), /collect is required/);
  });
});
