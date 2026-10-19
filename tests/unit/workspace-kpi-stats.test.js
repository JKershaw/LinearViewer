/**
 * LIN-3689 — collectWorkspaceKpis: one workspace's KPIs, on a real MangoDB.
 *
 * Run with: node --test tests/unit/workspace-kpi-stats.test.js
 *
 * Two workspaces share the same collections; every figure must equal the
 * single-workspace expectation and adding B must move nothing for A. The
 * find-mock in kpi-stats-pins.test.js ignores queries and so cannot witness a
 * filter; these tests can (MangoDB evaluates the `$match`/find filter).
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { collectWorkspaceKpis } from '../../lib/workspace-kpi-stats.js';
import { loadDispatchHistory, loadProxyBins } from '../../lib/kpi-stats.js';
import { MAX_REPORTS_PER_WORKSPACE } from '../../lib/report-history-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const A = 'ws-alpha';
const B = 'ws-bravo-secret';
const daysAgo = (n, hour = 9) => new Date(Date.UTC(2026, 5, 10 - n, hour));

const harness = createMangoTmpdir('lin-3689-ws-kpis-');
before(() => harness.connect());
after(() => harness.close());

let db;
let collections;
beforeEach(() => {
  db = harness.freshDb();
  collections = {
    dispatchQueue: db.collection('dispatch-queue'),
    dispatchHistory: db.collection('dispatch-history'),
    proxyEvents: db.collection('proxy-events'),
    agentStatus: db.collection('foreman-status'),
    reportHistory: db.collection('report-history'),
    customPrompts: db.collection('custom-prompts')
  };
});

/** Records every `find`/`aggregate` call while delegating to the real collection. */
function spied(collection, { hideAggregate = false } = {}) {
  const calls = { find: [], aggregate: [] };
  return new Proxy(collection, {
    get(target, prop) {
      if (prop === '__calls') return calls;
      if (prop === 'aggregate' && hideAggregate) return undefined;
      const value = target[prop];
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (prop === 'find' || prop === 'aggregate') calls[prop].push(args);
        return value.apply(target, args);
      };
    }
  });
}

async function seedWorkspace(urlKey, { queued = 0, taken = 0, autopilot = 0, proxy = 0, statuses = 0, prompts = 0, reports = 0 } = {}) {
  const hist = [];
  for (let i = 0; i < taken; i++) {
    hist.push({
      urlKey, status: 'taken', kind: 'implementation', dispatchedAt: daysAgo(1), resolvedAt: new Date(daysAgo(1).getTime() + 10 * 60000),
      issueIdentifier: `SECRET-${i}`, feedback: [{ message: 'prompt-text-canary', at: daysAgo(1) }]
    });
  }
  for (let i = 0; i < autopilot; i++) hist.push({ urlKey, status: 'expired', kind: 'autopilot', dispatchedAt: daysAgo(2), issueIdentifier: 'SECRET-AP' });
  if (hist.length) await collections.dispatchHistory.insertMany(hist);
  const queue = Array.from({ length: queued }, () => ({ urlKey, kind: 'review', dispatchedAt: daysAgo(0), issueIdentifier: 'SECRET-Q' }));
  if (queue.length) await collections.dispatchQueue.insertMany(queue);
  const events = Array.from({ length: proxy }, () => ({ urlKey, method: 'GET', endpoint: '/api/proxy/issues/LIN-1', status: 200, timestamp: daysAgo(1) }));
  if (events.length) await collections.proxyEvents.insertMany(events);
  const stat = Array.from({ length: statuses }, () => ({ urlKey, dispatchId: 'd1', status: 'completed', timestamp: daysAgo(1), summary: 'prompt-text-canary' }));
  if (stat.length) await collections.agentStatus.insertMany(stat);
  if (prompts) await collections.customPrompts.insertMany(Array.from({ length: prompts }, () => ({ urlKey, text: 'prompt-text-canary' })));
  if (reports) await collections.reportHistory.insertMany(Array.from({ length: reports }, () => ({ urlKey })));
}

const run = urlKey => collectWorkspaceKpis({ collections, urlKey, now: NOW });

describe('collectWorkspaceKpis (real MangoDB)', () => {
  test('figures equal the single-workspace expectation', async () => {
    await seedWorkspace(A, { queued: 1, taken: 2, autopilot: 1, proxy: 3, statuses: 2, prompts: 2, reports: 1 });
    const stats = await run(A);

    assert.equal(stats.generatedAt, NOW.toISOString());
    assert.deepEqual(stats.activity.last30, { agentActions: 5, dispatches: 4, autopilotRuns: 1, feedbackNotes: 2 });
    assert.deepEqual(stats.activity.last7, stats.activity.last30);
    assert.equal(stats.funnel.dispatched, 4);
    assert.equal(stats.funnel.taken, 2);
    assert.equal(stats.funnel.medianWaitMinutes, 10);
    assert.deepEqual(stats.kinds, [
      { label: 'implementation', count: 2 },
      { label: 'autopilot', count: 1 },
      { label: 'review', count: 1 }
    ]);
    assert.deepEqual(stats.stored, { customPrompts: 2, roadmapReports: 1, roadmapReportsCap: MAX_REPORTS_PER_WORKSPACE });
    assert.equal(stats.empty, false);
  });

  test('adding activity in workspace B moves nothing for A', async () => {
    await seedWorkspace(A, { queued: 1, taken: 2, proxy: 3, statuses: 1, prompts: 1, reports: 1 });
    const before = await run(A);
    await seedWorkspace(B, { queued: 5, taken: 4, autopilot: 3, proxy: 9, statuses: 6, prompts: 7, reports: 4 });
    const after = await run(A);
    assert.deepEqual(after, before);

    const b = await run(B);
    assert.equal(b.activity.last30.dispatches, 12);
    assert.equal(b.stored.customPrompts, 7);
  });

  test('an empty workspace is empty, with stored still reported', async () => {
    await seedWorkspace(B, { taken: 3 });
    await seedWorkspace(A, { prompts: 2 });
    const stats = await run(A);
    assert.equal(stats.empty, true);
    assert.equal(stats.activity.last30.dispatches, 0);
    assert.equal(stats.funnel.medianWaitMinutes, null);
    assert.equal(stats.stored.customPrompts, 2);
  });

  test('proxy or agent-status activity with no dispatches is not empty (the && rule)', async () => {
    await seedWorkspace(A, { proxy: 2 });
    const viaProxy = await run(A);
    assert.equal(viaProxy.empty, false);
    assert.equal(viaProxy.activity.last30.dispatches, 0);
    assert.ok(viaProxy.activity.last30.agentActions >= 1);

    await seedWorkspace(B, { statuses: 1 });
    const viaStatus = await run(B);
    assert.equal(viaStatus.empty, false);
    assert.equal(viaStatus.activity.last30.dispatches, 0);
    assert.ok(viaStatus.activity.last30.agentActions >= 1);
  });

  test('one dispatch with no proxy or agent-status rows is not empty (the && rule)', async () => {
    await seedWorkspace(A, { queued: 1 });
    const stats = await run(A);
    assert.equal(stats.empty, false);
    assert.equal(stats.activity.last30.dispatches, 1);
    assert.equal(stats.activity.last30.agentActions, 0);
  });

  test('an 8-day-old dispatch counts in 30d but not 7d', async () => {
    await collections.dispatchHistory.insertOne({ urlKey: A, status: 'expired', kind: 'implementation', dispatchedAt: daysAgo(8) });
    await collections.dispatchHistory.insertOne({ urlKey: A, status: 'expired', kind: 'implementation', dispatchedAt: daysAgo(6) });
    const stats = await run(A);
    assert.equal(stats.activity.last7.dispatches, 1);
    assert.equal(stats.activity.last30.dispatches, 2);
  });

  test('refuses to run without a urlKey (never an instance-wide read)', async () => {
    await assert.rejects(() => collectWorkspaceKpis({ collections, urlKey: undefined, now: NOW }), TypeError);
    await assert.rejects(() => collectWorkspaceKpis({ collections, urlKey: '', now: NOW }), TypeError);
  });

  test('output carries no other workspace key, issue identifier, prompt text or urlKeys field', async () => {
    await seedWorkspace(A, { queued: 1, taken: 1, proxy: 2, statuses: 1, prompts: 1 });
    await seedWorkspace(B, { taken: 2, proxy: 2 });
    const json = JSON.stringify(await run(A));
    assert.doesNotMatch(json, new RegExp(B));
    assert.doesNotMatch(json, /SECRET-/);
    assert.doesNotMatch(json, /prompt-text-canary/);
    assert.doesNotMatch(json, /urlKeys/);
    assert.doesNotMatch(json, new RegExp(A));
  });

  test('the history and proxy aggregations carry urlKey in their $match', async () => {
    const history = spied(collections.dispatchHistory);
    const proxy = spied(collections.proxyEvents);
    await collectWorkspaceKpis({ collections: { ...collections, dispatchHistory: history, proxyEvents: proxy }, urlKey: A, now: NOW });
    assert.equal(history.__calls.aggregate.length, 1);
    assert.equal(proxy.__calls.aggregate.length, 1);
    assert.equal(history.__calls.aggregate[0][0][0].$match.urlKey, A);
    assert.equal(proxy.__calls.aggregate[0][0][0].$match.urlKey, A);
  });

  test('every plain read filters on urlKey', async () => {
    const queue = spied(collections.dispatchQueue);
    const status = spied(collections.agentStatus);
    await collectWorkspaceKpis({ collections: { ...collections, dispatchQueue: queue, agentStatus: status }, urlKey: A, now: NOW });
    assert.deepEqual(queue.__calls.find[0], [{ urlKey: A }]);
    assert.equal(status.__calls.find[0][0].urlKey, A);
    assert.ok(status.__calls.find[0][0].timestamp.$gte instanceof Date);
  });
});

describe('the find fallback (a collection without aggregate) filters on urlKey too', () => {
  test('dispatch history', async () => {
    await seedWorkspace(A, { taken: 1 });
    await seedWorkspace(B, { taken: 2 });
    const history = spied(collections.dispatchHistory, { hideAggregate: true });
    const docs = await loadDispatchHistory(history, { since: daysAgo(30), urlKey: A });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].urlKey, A);
    assert.equal(history.__calls.find[0][0].urlKey, A);
  });

  test('proxy events', async () => {
    await seedWorkspace(A, { proxy: 1 });
    await seedWorkspace(B, { proxy: 4 });
    const proxy = spied(collections.proxyEvents, { hideAggregate: true });
    const bins = await loadProxyBins(proxy, { since: daysAgo(30), urlKey: A });
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 1);
    assert.equal(proxy.__calls.find[0][0].urlKey, A);
  });

  test('with no urlKey the filter has no urlKey key at all', async () => {
    const proxy = spied(collections.proxyEvents, { hideAggregate: true });
    const history = spied(collections.dispatchHistory, { hideAggregate: true });
    await loadProxyBins(proxy, { since: daysAgo(30) });
    await loadDispatchHistory(history, { since: daysAgo(30) });
    assert.equal('urlKey' in proxy.__calls.find[0][0], false);
    assert.equal('urlKey' in history.__calls.find[0][0], false);
  });
});
