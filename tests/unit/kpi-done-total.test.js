/**
 * LIN-3732 — the running total of tasks finished, read from `kpi-daily-rollup`
 * (part A, LIN-3724) by both KPI collectors, on a real MangoDB.
 *
 * Run with: node --test tests/unit/kpi-done-total.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildDoneTotal, collectKpiStats, loadDoneRollup, toPublicKpis } from '../../lib/kpi-stats.js';
import { collectWorkspaceKpis } from '../../lib/workspace-kpi-stats.js';
import { ROLLUP_MARKER_ID } from '../../lib/kpi-daily-rollup.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const A = 'ws-alpha';
const B = 'ws-bravo-secret';

const harness = createMangoTmpdir('lin-3732-done-total-');
before(() => harness.connect());
after(() => harness.close());

const PUBLIC_NAMES = [
  'sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues',
  'dispatchQueue', 'dispatchHistory', 'dispatchTokens', 'proxyTokens', 'proxyEvents',
  'agentStatus', 'freeTier', 'recapCache', 'briefCache', 'reportHistory', 'kpiDailyRollup'
];

let db;
let rollup;
let publicBag;
let workspaceBag;
let warnings;
let originalWarn;
beforeEach(() => {
  db = harness.freshDb();
  rollup = db.collection('kpi-daily-rollup');
  publicBag = Object.fromEntries(PUBLIC_NAMES.map(name => [name, db.collection(name)]));
  publicBag.kpiDailyRollup = rollup;
  workspaceBag = {
    dispatchQueue: db.collection('dispatch-queue'),
    dispatchHistory: db.collection('dispatch-history'),
    proxyEvents: db.collection('proxy-events'),
    agentStatus: db.collection('foreman-status'),
    reportHistory: db.collection('report-history'),
    customPrompts: db.collection('custom-prompts'),
    closeOutEvents: db.collection('close-out-events'),
    kpiDailyRollup: rollup
  };
  warnings = [];
  originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
});
afterEach(() => { console.warn = originalWarn; });

const row = (urlKey, day, done) => ({ urlKey, day, done, failed: 0, aborted: 0, dispatches: 0 });
const marker = () => ({ _id: ROLLUP_MARKER_ID, through: '2026-06-09' });
const publicStats = () => collectKpiStats(publicBag, { now: NOW, milestoneFunnelDeps: {} });
const workspaceStats = urlKey => collectWorkspaceKpis({ collections: workspaceBag, urlKey, now: NOW });

/** A collection whose `aggregate` is hidden, so the public read takes the `find` path. */
const withoutAggregate = collection => new Proxy(collection, {
  get: (target, prop) => (prop === 'aggregate' ? undefined : (typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop]))
});

/** A collection whose chosen methods throw synchronously or reject. */
function failing(collection, { aggregate = false, find = false, sync = false } = {}) {
  const boom = () => { const err = new RangeError('secret-detail'); if (sync) throw err; return { toArray: () => Promise.reject(err) }; };
  return new Proxy(collection, {
    get(target, prop) {
      if (prop === 'aggregate') return aggregate ? boom : (find ? undefined : target.aggregate.bind(target));
      if (prop === 'find' && find) return boom;
      return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
    }
  });
}

async function seedTwoWorkspaces() {
  await rollup.insertMany([
    marker(),
    row(A, '2026-06-01', 2), row(B, '2026-06-01', 3),
    row(A, '2026-06-04', 1), row(B, '2026-06-05', 4),
    row(A, '2026-06-10', 9) // today: a snapshot, never counted
  ]);
}

describe('public: the instance sum by day (LIN-3732)', () => {
  for (const [label, wrap] of [['aggregate', c => c], ['find', withoutAggregate]]) {
    test(`two workspaces are summed per day, zero-filled, with no urlKey out (${label} path)`, async () => {
      await seedTwoWorkspaces();
      publicBag.kpiDailyRollup = wrap(rollup);
      const { doneTotal } = await publicStats();
      assert.deepEqual(doneTotal, { since: '2026-06-01', through: '2026-06-09', done: [5, 0, 0, 1, 4, 0, 0, 0, 0], total: 10 });
      const view = toPublicKpis(await publicStats());
      assert.deepEqual(view.doneTotal, doneTotal);
      assert.ok(!JSON.stringify(view).includes(B) && !JSON.stringify(view).includes(A) && !/urlKey/.test(JSON.stringify(view)));
    });

    test(`the marker doc never counts and today is excluded (${label} path)`, async () => {
      await rollup.insertMany([marker(), row(A, '2026-06-10', 5), row(A, '2026-06-12', 5)]);
      publicBag.kpiDailyRollup = wrap(rollup);
      assert.equal((await publicStats()).doneTotal, null, 'only the marker, today and a later day: no rows');
    });

    test(`loadDoneRollup returns no rows for the marker alone (${label} path)`, async () => {
      await rollup.insertMany([marker()]);
      assert.deepEqual(await loadDoneRollup(wrap(rollup)), []);
    });

    test(`a row whose day is not YYYY-MM-DD is ignored (${label} path)`, async () => {
      await rollup.insertMany([row(A, '2026-06-08', 2), row(A, '2026-05-1', 50), row(A, 'yesterday', 50), row(A, '2026-6-9', 50), row(A, '2026-06-09T00:00', 50)]);
      publicBag.kpiDailyRollup = wrap(rollup);
      assert.deepEqual((await publicStats()).doneTotal, { since: '2026-06-08', through: '2026-06-09', done: [2, 0], total: 2 });
    });
  }

  test('reads the rollup once per request: one aggregate on the aggregate path, one find on the find path', async () => {
    await seedTwoWorkspaces();
    const calls = [];
    const spy = collection => new Proxy(collection, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args) => { if (prop === 'find' || prop === 'aggregate') calls.push(prop); return value.apply(target, args); };
      }
    });
    publicBag.kpiDailyRollup = spy(rollup);
    await publicStats();
    assert.deepEqual(calls, ['aggregate']);
    calls.length = 0;
    publicBag.kpiDailyRollup = spy(withoutAggregate(rollup));
    await publicStats();
    assert.deepEqual(calls, ['find']);
  });

  test('no rows gives null, and the rest of the payload is intact', async () => {
    const stats = await publicStats();
    assert.equal(stats.doneTotal, null);
    assert.equal(toPublicKpis(stats).doneTotal, null);
    assert.equal(stats.daily.done.length, stats.proxyCategories.days.length);
  });
});

describe('workspace: filtered to its own urlKey (LIN-3732)', () => {
  test('A never sees B\'s days, and B\'s rows being present moves nothing for A', async () => {
    await seedTwoWorkspaces();
    const { daily } = await workspaceStats(A);
    assert.deepEqual(daily.doneTotal, { since: '2026-06-01', through: '2026-06-09', done: [2, 0, 0, 1, 0, 0, 0, 0, 0], total: 3 });
    const b = (await workspaceStats(B)).daily.doneTotal;
    assert.deepEqual(b.done, [3, 0, 0, 0, 4, 0, 0, 0, 0]);
  });

  test('a workspace with no rows has doneTotal null, and the marker never counts', async () => {
    await rollup.insertMany([marker(), row(B, '2026-06-01', 3)]);
    assert.equal((await workspaceStats(A)).daily.doneTotal, null);
  });

  test('the read is a find filtered on urlKey, with the day/done projection', async () => {
    const seen = [];
    workspaceBag.kpiDailyRollup = new Proxy(rollup, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args) => { if (prop === 'find' || prop === 'aggregate') seen.push({ prop, args }); return value.apply(target, args); };
      }
    });
    await workspaceStats(A);
    assert.deepEqual(seen, [{ prop: 'find', args: [{ urlKey: A }, { projection: { _id: 0, day: 1, done: 1 } }] }]);
  });

  test('a bag without kpiDailyRollup throws a TypeError', async () => {
    const { kpiDailyRollup: _omitted, ...without } = workspaceBag;
    await assert.rejects(() => collectWorkspaceKpis({ collections: without, urlKey: A, now: NOW }), { name: 'TypeError', message: /collectWorkspaceKpis/ });
  });
});

describe('a failing read soft-fails to null (LIN-3732)', () => {
  const cases = [
    ['a rejecting aggregate', { aggregate: true }],
    ['a rejecting find (public find path)', { find: true }],
    ['a synchronously throwing aggregate', { aggregate: true, sync: true }]
  ];
  for (const [label, mode] of cases) {
    test(`${label}: the public stats keep every other figure and log the class once`, async () => {
      await seedTwoWorkspaces();
      const healthy = await publicStats();
      warnings.length = 0;
      publicBag.kpiDailyRollup = failing(rollup, mode);
      const stats = await publicStats();
      assert.equal(stats.doneTotal, null);
      const { doneTotal: _a, generatedAt: _g, ...rest } = stats;
      const { doneTotal: _b, generatedAt: _h, ...healthyRest } = healthy;
      assert.deepEqual(rest, healthyRest);
      assert.deepEqual(warnings, ['kpi-stats: kpi-daily-rollup read failed: RangeError']);
    });
  }

  test('a failing find gives the workspace stats doneTotal null with one log line naming the class only', async () => {
    await seedTwoWorkspaces();
    workspaceBag.kpiDailyRollup = failing(rollup, { find: true });
    const stats = await workspaceStats(A);
    assert.equal(stats.daily.doneTotal, null);
    assert.equal(stats.empty, true, 'unchanged empty rule');
    assert.deepEqual(warnings, ['kpi-stats: kpi-daily-rollup read failed: RangeError']);
    assert.ok(!warnings.join().includes('secret-detail'));
  });

  test('only a missing handle throws (public)', async () => {
    const { kpiDailyRollup: _omitted, ...without } = publicBag;
    await assert.rejects(() => collectKpiStats(without, { now: NOW, milestoneFunnelDeps: {} }), TypeError);
    await assert.rejects(() => loadDoneRollup(undefined), TypeError);
  });
});

describe('buildDoneTotal (pure)', () => {
  const at = new Date('2026-06-10T00:00:00.000Z');
  test('today and later are dropped; since is the oldest day with a row; gaps are zero', () => {
    const total = buildDoneTotal([{ day: '2026-06-10', done: 7 }, { day: '2026-06-07', done: 2 }, { day: '2026-06-09', done: 1 }], at);
    assert.deepEqual(total, { since: '2026-06-07', through: '2026-06-09', done: [2, 0, 1], total: 3 });
  });
  test('yesterday is the UTC day before now, across a month boundary', () => {
    const total = buildDoneTotal([{ day: '2026-05-30', done: 1 }], new Date('2026-06-01T03:00:00.000Z'));
    assert.deepEqual(total, { since: '2026-05-30', through: '2026-05-31', done: [1, 0], total: 1 });
  });
  test('only today or later rows, or none: null', () => {
    assert.equal(buildDoneTotal([], at), null);
    assert.equal(buildDoneTotal([{ day: '2026-06-10', done: 1 }], at), null);
  });
});
