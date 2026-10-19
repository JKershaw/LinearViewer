/**
 * LIN-3703: the /kpis route's cache (lib/kpi-page.js), moved out of server.js.
 *
 * Run with: node --test tests/unit/kpi-page.test.js
 *
 * The four behaviours (LIN-3002 pins them end to end in kpis.spec.js): a cold
 * cache waits for the first read; a warm one answers at once and refreshes in
 * the background, one at a time; a failed refresh keeps the last good snapshot;
 * the 500 page only when there is no snapshot. Plus: a renderer that threw is
 * not called a second time.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createKpiPage, KPI_CACHE_MS } from '../../lib/kpi-page.js';

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { res.body = body; return res; };
  return res;
}

function deferred() {
  const d = {};
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
}

function build({ collect, render = view => `page:${view.n}`, clock = { t: 1_000_000 } } = {}) {
  const page = createKpiPage({
    collect,
    render,
    renderError: () => 'error page',
    now: () => clock.t
  });
  return { page, clock };
}

const get = async page => { const res = fakeRes(); await page.handler({}, res); return res; };

describe('createKpiPage', () => {
  let logs;
  const original = { log: console.log, error: console.error, warn: console.warn };
  beforeEach(() => {
    logs = { log: [], error: [], warn: [] };
    for (const level of Object.keys(logs)) console[level] = (...args) => logs[level].push(args.map(String).join(' '));
  });
  afterEach(() => Object.assign(console, original));

  test('cold cache: the first request waits for the read and renders it', async () => {
    const gate = deferred();
    const { page } = build({ collect: () => gate.promise });
    let settled = false;
    const pending = get(page).then(res => { settled = true; return res; });
    await new Promise(r => setImmediate(r));
    assert.strictEqual(settled, false, 'still waiting on the first read');
    gate.resolve({ n: 1 });
    const res = await pending;
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, 'page:1');
    assert.ok(logs.log.some(line => /^KPI stats collected in \d+ms$/.test(line)), logs.log.join('|'));
  });

  test('fresh cache: answers from the snapshot without reading again', async () => {
    let reads = 0;
    const { page, clock } = build({ collect: async () => ({ n: ++reads }) });
    await get(page);
    clock.t += KPI_CACHE_MS;
    assert.strictEqual((await get(page)).body, 'page:1');
    assert.strictEqual(reads, 1);
  });

  test('warm but stale: serves the old snapshot at once and refreshes once in the background, however many requests arrive', async () => {
    let reads = 0;
    const gate = deferred();
    const { page, clock } = build({ collect: () => (++reads === 1 ? Promise.resolve({ n: 1 }) : gate.promise) });
    await get(page);
    clock.t += KPI_CACHE_MS + 1;

    const [a, b, c] = await Promise.all([get(page), get(page), get(page)]);
    assert.deepStrictEqual([a.body, b.body, c.body], ['page:1', 'page:1', 'page:1']);
    assert.strictEqual(reads, 2, 'one refresh in flight, not three');

    gate.resolve({ n: 2 });
    await new Promise(r => setImmediate(r));
    assert.strictEqual((await get(page)).body, 'page:2');
    assert.strictEqual(reads, 2);
  });

  test('a failed background refresh keeps the last good snapshot and logs the failure', async () => {
    let reads = 0;
    const { page, clock } = build({ collect: async () => { if (++reads === 1) return { n: 1 }; throw new Error('boom'); } });
    await get(page);
    clock.t += KPI_CACHE_MS + 1;
    const res = await get(page);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, 'page:1');
    await new Promise(r => setImmediate(r));
    assert.ok(logs.error.some(line => line.startsWith('KPI background refresh failed:')), logs.error.join('|'));
    assert.strictEqual((await get(page)).body, 'page:1', 'still serving the good snapshot');
  });

  test('500 only with no snapshot: a failed first read returns the error page and logs it', async () => {
    const { page } = build({ collect: async () => { throw new Error('boom'); } });
    const res = await get(page);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body, 'error page');
    assert.ok(logs.error.some(line => line.startsWith('Failed to render KPIs page:')), logs.error.join('|'));
  });

  test('a renderer that throws is not called again: the request goes straight to the 500 page', async () => {
    let renders = 0;
    const { page } = build({
      collect: async () => ({ n: 1 }),
      render: () => { renders++; throw new Error('render boom'); }
    });
    const res = await get(page);
    assert.strictEqual(renders, 1, 'the renderer ran once');
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(res.body, 'error page');
    assert.ok(logs.error.some(line => line.startsWith('Failed to render KPIs page:')));
  });

  test('reset() empties the cache; reset("stale") keeps the snapshot but backdates it', async () => {
    let reads = 0;
    const { page } = build({ collect: async () => ({ n: ++reads }) });
    await get(page);
    page.reset('stale');
    assert.strictEqual((await get(page)).body, 'page:1', 'stale snapshot served');
    await new Promise(r => setImmediate(r));
    assert.strictEqual(reads, 2, 'and refreshed behind it');
    page.reset();
    assert.strictEqual((await get(page)).body, 'page:3', 'cold again: waits for a new read');
  });
});
