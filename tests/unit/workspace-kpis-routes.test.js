/**
 * LIN-3689 — route-level: GET /workspace/:urlKey/kpis.
 * Run with: node --test tests/unit/workspace-kpis-routes.test.js
 *
 * A stub workspaceFromUrl stands in for server.js's middleware (unit tests
 * cannot run it); the real redirect and 404 are witnessed in
 * tests/e2e/workspace-kpis.spec.js. Collections are real MangoDB.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceKpisRoutes } from '../../routes/workspace-kpis.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const harness = createMangoTmpdir('lin-3689-ws-kpis-routes-');
before(() => harness.connect());
after(() => harness.close());

function freshCollections() {
  const db = harness.freshDb();
  return {
    dispatchQueue: db.collection('dispatch-queue'),
    dispatchHistory: db.collection('dispatch-history'),
    proxyEvents: db.collection('proxy-events'),
    agentStatus: db.collection('foreman-status'),
    reportHistory: db.collection('report-history'),
    customPrompts: db.collection('custom-prompts'),
    closeOutEvents: db.collection('close-out-events'),
    kpiDailyRollup: db.collection('kpi-daily-rollup')
  };
}

/** A stub that picks the workspace itself, ignoring the URL, like the real one resolves from the session. */
const settingTo = (urlKey, name) => (req, _res, next) => {
  req.workspace = { urlKey, name };
  req.session = { workspaces: [{ urlKey, name }] };
  next();
};

const ending = (status, body) => (_req, res) => res.status(status).send(body);

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual' });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const build = (workspaceFromUrl, collections) => {
  const app = express();
  app.use(createWorkspaceKpisRoutes({ workspaceFromUrl, collections, now: () => NOW }));
  return app;
};

function spyOn(collections) {
  const reads = [];
  return {
    reads,
    collections: Object.fromEntries(Object.entries(collections).map(([name, col]) => [name, new Proxy(col, {
      get(target, prop) {
        const value = target[prop];
        return typeof value === 'function' ? (...args) => { reads.push(`${name}.${String(prop)}`); return value.apply(target, args); } : value;
      }
    })]))
  };
}

describe('GET /workspace/:urlKey/kpis', () => {
  test('200 with the page test ids', async () => {
    const collections = freshCollections();
    await collections.dispatchHistory.insertOne({ urlKey: 'ws-a', status: 'expired', kind: 'implementation', dispatchedAt: new Date('2026-06-09T09:00:00Z') });
    const res = await get(build(settingTo('ws-a', 'Alpha'), collections), '/workspace/ws-a/kpis');
    assert.equal(res.status, 200);
    assert.match(res.text, /data-testid="workspace-kpis-section-activity"/);
    assert.match(res.text, /data-testid="workspace-kpis-value-dispatches-30d">1</);
    assert.match(res.text, /<title>Alpha - KPIs<\/title>/);
  });

  test('LIN-3713: the page shows the merge-time card from this workspace\'s seeded events', async () => {
    const collections = freshCollections();
    const merged = new Date('2026-06-09T12:00:00Z');
    // the page's empty branch (no dispatches or agent actions) hides the funnel, so give it one dispatch
    await collections.dispatchHistory.insertOne({ urlKey: 'ws-a', status: 'expired', kind: 'implementation', dispatchedAt: merged });
    await collections.closeOutEvents.insertMany([2, 4, 6].map(h => ({
      _id: `e${h}`, urlKey: 'ws-a', by: 'person', merged: true, prUrl: `https://github.com/o/r/pull/${h}`, at: merged,
      prMergedAt: merged, prOpenedAt: new Date(merged.getTime() - h * 3600000)
    })));
    await collections.closeOutEvents.insertOne({ _id: 'other', urlKey: 'ws-b', by: 'person', merged: true, prUrl: 'https://github.com/o/r/pull/99', at: merged, prMergedAt: merged, prOpenedAt: new Date(merged.getTime() - 900 * 3600000) });
    const res = await get(build(settingTo('ws-a', 'Alpha'), collections), '/workspace/ws-a/kpis');
    assert.equal(res.status, 200);
    assert.match(res.text, /data-testid="workspace-kpis-card-merge-time"/);
    assert.match(res.text, /median 4h · p90 6h/);
    assert.match(res.text, /n = 3 merges · 30d/);
  });

  test('LIN-3732: the since line and embedded total come from this workspace\'s rollup rows only', async () => {
    const collections = freshCollections();
    await collections.dispatchHistory.insertOne({ urlKey: 'ws-a', status: 'expired', kind: 'implementation', dispatchedAt: new Date('2026-06-09T09:00:00Z') });
    const day = (urlKey, d, done) => ({ urlKey, day: d, done, failed: 0, aborted: 0, dispatches: 0 });
    await collections.kpiDailyRollup.insertMany([
      { _id: 'last-complete-day', through: '2026-06-09' },
      day('ws-a', '2026-04-02', 2), day('ws-a', '2026-04-04', 3), day('ws-b', '2026-03-01', 50)
    ]);
    const res = await get(build(settingTo('ws-a', 'Alpha'), collections), '/workspace/ws-a/kpis');
    assert.equal(res.status, 200);
    assert.match(res.text, /data-testid="workspace-kpis-done-since"[^>]*>Tasks done since 2 Apr 2026: 5</);
    assert.match(res.text, /"doneTotal":\{"since":"2026-04-02","through":"2026-06-09","done":\[2,0,3,/);
    assert.doesNotMatch(res.text, /1 Mar 2026/);
  });

  test('a workspaceFromUrl that ends the response means the handler never runs', async () => {
    for (const [status, body] of [[302, ''], [404, 'not found']]) {
      const spy = spyOn(freshCollections());
      const stub = (_req, res) => (status === 302 ? res.redirect('/') : res.status(status).send(body));
      const res = await get(build(stub, spy.collections), '/workspace/ws-a/kpis');
      assert.equal(res.status, status);
      assert.deepEqual(spy.reads, [], `no collection read on ${status}`);
    }
  });

  test('scope comes from req.workspace, not the URL or the query string', async () => {
    const collections = freshCollections();
    await collections.dispatchHistory.insertMany([
      { urlKey: 'ws-a', status: 'expired', kind: 'implementation', dispatchedAt: new Date('2026-06-09T09:00:00Z') },
      ...Array.from({ length: 4 }, () => ({ urlKey: 'ws-b', status: 'expired', kind: 'autopilot', dispatchedAt: new Date('2026-06-09T09:00:00Z') }))
    ]);
    const res = await get(build(settingTo('ws-a', 'Alpha'), collections), '/workspace/ws-b/kpis?urlKey=ws-b');
    assert.equal(res.status, 200);
    assert.match(res.text, /data-testid="workspace-kpis-value-dispatches-30d">1</);
    assert.match(res.text, /kind-row">implementation /);
    assert.equal(res.text.match(/workspace-kpis-kind-row/g).length, 1);
    assert.doesNotMatch(res.text, /ws-b/);
  });

  test('a failing read gives the error page, not a stack trace', async () => {
    const collections = freshCollections();
    collections.dispatchQueue = { find: () => { throw new Error('boom-secret'); } };
    const res = await get(build(settingTo('ws-a', 'Alpha'), collections), '/workspace/ws-a/kpis');
    assert.equal(res.status, 500);
    assert.doesNotMatch(res.text, /boom-secret/);
  });
});
