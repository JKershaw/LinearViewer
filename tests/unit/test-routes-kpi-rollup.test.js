/**
 * LIN-3732: the e2e-only /test/seed-kpi-rollup and /test/clear-kpi-rollup routes
 * (routes/test.js). Seeding writes part A's row shape; clearing removes one
 * urlKey's rows and never the marker doc or another workspace's rows.
 *
 * Run with: node --test tests/unit/test-routes-kpi-rollup.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createTestRoutes } from '../../routes/test.js';

function getHandler(router, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods.get);
  assert.ok(layer, `GET ${path} is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function call(router, path, query = {}) {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; }
  };
  await getHandler(router, path)({ query }, res);
  return res;
}

describe('routes/test.js — kpi-daily-rollup fixtures (LIN-3732)', () => {
  let client;
  let dir;
  let rollup;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'test-routes-kpi-rollup-'));
    client = new MangoClient(dir);
    await client.connect();
    rollup = client.db('rollup').collection('kpi-daily-rollup');
  });
  after(async () => {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('seeds one row in the part A shape, and seeding the same day again replaces the count', async () => {
    const router = createTestRoutes({ kpiDailyRollupCollection: rollup });
    assert.equal((await call(router, '/test/seed-kpi-rollup', { urlKey: 'k1', day: '2026-04-01', done: '2' })).statusCode, 200);
    await call(router, '/test/seed-kpi-rollup', { urlKey: 'k1', day: '2026-04-01', done: '5' });
    const rows = await rollup.find({ urlKey: 'k1' }, { projection: { _id: 0 } }).toArray();
    assert.deepEqual(rows, [{ urlKey: 'k1', day: '2026-04-01', done: 5, failed: 0, aborted: 0, dispatches: 0 }]);
  });

  test('refuses a bad day, a missing urlKey and a non-count done', async () => {
    const router = createTestRoutes({ kpiDailyRollupCollection: rollup });
    for (const query of [{ urlKey: 'k1', day: 'soon', done: '1' }, { day: '2026-04-01', done: '1' }, { urlKey: 'k1', day: '2026-04-01', done: 'x' }, { urlKey: 'k1', day: '2026-04-01', done: '-1' }]) {
      assert.equal((await call(router, '/test/seed-kpi-rollup', query)).statusCode, 400, JSON.stringify(query));
    }
  });

  test('clear deletes only that urlKey, leaving the marker doc and other workspaces', async () => {
    const router = createTestRoutes({ kpiDailyRollupCollection: rollup });
    await rollup.insertOne({ _id: 'last-complete-day', through: '2026-04-01' });
    await call(router, '/test/seed-kpi-rollup', { urlKey: 'k2', day: '2026-04-02', done: '1' });
    await call(router, '/test/clear-kpi-rollup', { urlKey: 'k1' });
    assert.equal(await rollup.countDocuments({ urlKey: 'k1' }), 0);
    assert.equal(await rollup.countDocuments({ urlKey: 'k2' }), 1);
    assert.equal(await rollup.countDocuments({ _id: 'last-complete-day' }), 1);
    assert.equal((await call(router, '/test/clear-kpi-rollup', {})).statusCode, 400, 'no urlKey would clear nothing silently');
  });

  test('both handlers answer 500 when the collection is not wired', async () => {
    const router = createTestRoutes({});
    assert.equal((await call(router, '/test/seed-kpi-rollup', { urlKey: 'k', day: '2026-04-01', done: '1' })).statusCode, 500);
    assert.equal((await call(router, '/test/clear-kpi-rollup', { urlKey: 'k' })).statusCode, 500);
  });
});
