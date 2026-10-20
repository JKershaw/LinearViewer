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
import { buildDispatchByDay, loadDispatchHistory, loadProxyBins, tallyLabels, windowsAt } from '../../lib/kpi-stats.js';
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

// LIN-3711: the per-day series behind the trend charts.
const sum = values => values.reduce((total, n) => total + n, 0);
const at = (n, hour = 9) => daysAgo(n, hour).toISOString();
const usage = costUsd => ({ kind: 'usage', message: `[usage] ${JSON.stringify({ harness: 'claude-code', costUsd })}`, timestamp: at(0) });
const lineageRow = (urlKey, id, { kind = 'implementation', started, done = null, skipped = false, cost = null }) => ({
  _id: id,
  rootItemId: id,
  urlKey,
  kind,
  harness: 'claude-code',
  status: 'taken',
  issueIdentifier: `SECRET-${id}`,
  dispatchedAt: daysAgo(started),
  feedback: [
    ...(cost === null ? [] : [usage(cost)]),
    ...(done === null ? [] : [{ message: '[done] prompt-text-canary', timestamp: at(done) }]),
    ...(skipped ? [{ message: '[skipped] human', timestamp: at(started) }] : [])
  ]
});

async function seedTrends(urlKey) {
  await collections.dispatchHistory.insertMany([
    lineageRow(urlKey, 'a-slow', { started: 3, done: 1, cost: 1.5 }), // started day -3, done day -1
    lineageRow(urlKey, 'a-quick', { started: 0, done: 0, cost: 0.25 }),
    lineageRow(urlKey, 'a-unpriced', { kind: 'review', started: 3, done: 3 }),
    lineageRow(urlKey, 'a-skipped', { started: 3, skipped: true, cost: 99 }),
    lineageRow(urlKey, 'a-auto', { kind: 'autopilot', started: 10 }),
    lineageRow(urlKey, 'a-old-1', { kind: 'only-in-uncovered-days', started: 29 }),
    lineageRow(urlKey, 'a-old-2', { kind: 'only-in-uncovered-days', started: 28 }),
    lineageRow(urlKey, 'a-wk0', { kind: 'review', started: 27 })
  ]);
  await collections.agentStatus.insertMany([
    { urlKey, dispatchId: 'a-slow', status: 'completed', timestamp: daysAgo(2) },
    { urlKey, dispatchId: 'a-slow', status: 'completed', timestamp: daysAgo(2) }
  ]);
  await collections.proxyEvents.insertMany([
    { urlKey, method: 'GET', endpoint: '/api/proxy/issues/LIN-1', status: 200, timestamp: daysAgo(2) }
  ]);
}

describe('collectWorkspaceKpis daily series (LIN-3711)', () => {
  test('each daily series sums to its 30d card total, on one 30-day axis', async () => {
    await seedTrends(A);
    const stats = await run(A);
    const { daily } = stats;
    assert.equal(daily.days.length, 30);
    for (const key of ['dispatches', 'autopilotRuns', 'agentActions', 'done']) assert.equal(daily[key].length, 30, key);
    assert.equal(sum(daily.dispatches), stats.activity.last30.dispatches);
    assert.equal(sum(daily.autopilotRuns), stats.activity.last30.autopilotRuns);
    assert.equal(sum(daily.agentActions), stats.activity.last30.agentActions);
    assert.equal(daily.agentActions[27], 3, 'one proxy call plus two agent-status reports, two days ago');
  });

  test('done is counted on the day of the done marker, not the start; unfinished work is not done', async () => {
    await seedTrends(A);
    const { daily } = await run(A);
    assert.equal(daily.done[28], 1, 'a-slow started 3 days ago, done yesterday');
    assert.equal(daily.done[29], 1, 'a-quick done today');
    assert.equal(daily.done[26], 1, 'a-unpriced done 3 days ago');
    assert.equal(sum(daily.done), 3);
  });

  test('runs by kind: four 7-day weeks, top 3 kinds plus other, the two oldest days in no week', async () => {
    await seedTrends(A);
    const { runsByKind } = (await run(A)).daily;
    assert.deepEqual(runsByKind.weeks, ['2026-05-14', '2026-05-21', '2026-05-28', '2026-06-04']);
    assert.ok(runsByKind.kinds.every(({ counts }) => counts.length === 4));
    const labels = runsByKind.kinds.map(({ label }) => label);
    assert.ok(!labels.includes('only-in-uncovered-days'), 'a kind seen only in the uncovered days takes no legend slot');
    assert.deepEqual(labels, ['implementation', 'review', 'autopilot']);
    assert.equal(sum(runsByKind.kinds.map(({ counts }) => sum(counts))), 6, '8 dispatches minus the 2 oldest days');
    assert.deepEqual(runsByKind.kinds.find(({ label }) => label === 'review').counts, [1, 0, 0, 1], 'review: day -27 (week 1) and day -3 (week 4)');
  });

  test('more than 3 kinds fold into other; the limit parameter defaults to the public 5', async () => {
    await collections.dispatchHistory.insertMany(['k1', 'k2', 'k3', 'k4', 'k1', 'k2', 'k1'].map((kind, i) => lineageRow(A, `m${i}`, { kind, started: 2 })));
    const { runsByKind } = (await run(A)).daily;
    assert.deepEqual(runsByKind.kinds.map(({ label }) => label), ['k1', 'k2', 'k3', 'other']);
    assert.equal(sum(runsByKind.kinds.find(({ label }) => label === 'other').counts), 1);

    const windows = windowsAt(NOW);
    const docs = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'].map(kind => ({ kind, dispatchedAt: daysAgo(2) }));
    const tally = tallyLabels(docs, 'kind');
    assert.deepEqual(buildDispatchByDay(docs, tally, windows), buildDispatchByDay(docs, tally, windows, 5));
    assert.equal(buildDispatchByDay(docs, tally, windows).kinds.length, 6, 'five kinds plus other');
    assert.equal(buildDispatchByDay(docs, tally, windows, 3).kinds.length, 4, 'three kinds plus other');
  });

  test('cost: by the start day, unpriced never $0, skipped excluded, priced N of M', async () => {
    await seedTrends(A);
    await collections.dispatchHistory.insertOne({ ...lineageRow(A, 'a-now', { started: 0, cost: 0.5 }), dispatchedAt: NOW });
    const { cost } = (await run(A)).daily;
    assert.equal(cost.perDay.length, 30);
    assert.equal(cost.perDay[26], 1.5, 'a-slow started 3 days ago');
    assert.equal(cost.perDay[29], 0.75, 'a-quick plus a-now: a dispatch stamped exactly now is not dropped');
    assert.equal(sum(cost.perDay), 2.25, 'the skipped lineage cost 99 and is left out');
    assert.equal(cost.pricedCount, 3);
    assert.equal(cost.lineageCount, 8, '9 lineages less the skipped one');
  });

  test('cost buckets on the UTC day: 23:59Z and 00:00Z land on different days', async () => {
    const lateYesterday = new Date(Date.UTC(2026, 5, 9, 23, 59));
    const midnight = new Date(Date.UTC(2026, 5, 10, 0, 0));
    const rows = [['late', lateYesterday, 2], ['mid', midnight, 3]].map(([id, dispatchedAt, cost]) => ({
      ...lineageRow(A, id, { started: 1, cost }), dispatchedAt
    }));
    await collections.dispatchHistory.insertMany(rows);
    const { cost } = (await run(A)).daily;
    assert.equal(cost.perDay[28], 2);
    assert.equal(cost.perDay[29], 3);
  });

  test('workspace B moves nothing in A, and no B identifier, issue or prompt text appears in A', async () => {
    await seedTrends(A);
    const before = (await run(A)).daily;
    await collections.dispatchHistory.insertMany([
      lineageRow(B, 'b-1', { kind: 'b-only-kind', started: 2, done: 1, cost: 40 }),
      lineageRow(B, 'b-2', { kind: 'b-only-kind', started: 1, done: 0, cost: 2 })
    ]);
    await collections.agentStatus.insertOne({ urlKey: B, dispatchId: 'b-1', status: 'completed', timestamp: daysAgo(1) });
    await collections.proxyEvents.insertOne({ urlKey: B, method: 'GET', endpoint: '/api/proxy/issues/LIN-9', status: 200, timestamp: daysAgo(1) });
    assert.deepEqual((await run(A)).daily, before);

    const json = JSON.stringify(before);
    assert.doesNotMatch(json, new RegExp(B));
    assert.doesNotMatch(json, /b-only-kind/);
    assert.doesNotMatch(json, /SECRET-/);
    assert.doesNotMatch(json, /prompt-text-canary/);

    const b = (await run(B)).daily;
    assert.equal(sum(b.cost.perDay), 42);
    assert.equal(sum(b.done), 2);
  });

  test('a workspace with no trend data gets zero-filled series, not missing ones', async () => {
    await seedWorkspace(A, { queued: 1 });
    const { daily } = await run(A);
    assert.equal(sum(daily.done), 0);
    assert.deepEqual(daily.cost, { perDay: new Array(30).fill(0), pricedCount: 0, lineageCount: 1 });
  });
});
