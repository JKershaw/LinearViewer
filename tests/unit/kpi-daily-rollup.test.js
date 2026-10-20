/**
 * LIN-3724: KPI daily rollup, part A: counting rules, the daily job and its
 * marker gate, the bulk write, and the server.js registration.
 *
 * Real MangoDB over a tmpdir (tests/fixtures/mango-tmpdir.js).
 * Run with: node --test tests/unit/kpi-daily-rollup.test.js
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import {
  ROLLUP_LOOKBACK_DAYS, ROLLUP_MARKER_ID, rollupCountsByDay, writeRollupDays, createKpiDailyRollupRun,
  firstRollupDay, yesterdayKey, addDays
} from '../../lib/kpi-daily-rollup.js';
import { collectKpiStats } from '../../lib/kpi-stats.js';

// Tuesday 2026-10-20, 13:00 UTC. The read horizon starts 2026-09-20T13:00Z, so the first whole day is 2026-09-21.
const NOW = Date.parse('2026-10-20T13:00:00.000Z');
const FIRST = '2026-09-21';
const at = (day, time = '12:00:00') => `${day}T${time}.000Z`;

let seq = 0;
/** A history row; `terminal` is [marker, ISO time]. */
function row({ urlKey = 'ws-a', root, day, time = '12:00:00', terminal, ...rest }) {
  const id = `r${++seq}`;
  return {
    _id: id,
    urlKey,
    rootItemId: root ?? id,
    status: 'taken',
    dispatchedAt: new Date(at(day, time)),
    feedback: terminal ? [{ message: `[${terminal[0]}] finished`, timestamp: terminal[1] }] : [],
    ...rest
  };
}

const harness = createMangoTmpdir('lin-3724-rollup-');
before(() => harness.connect());
after(() => harness.close());

let db, history, rollup;
beforeEach(async () => {
  db = harness.freshDb();
  history = db.collection('dispatch-history');
  rollup = db.collection('kpi-daily-rollup');
  await rollup.createIndex({ urlKey: 1, day: 1 }, { unique: true });
});

const rowsOf = async (urlKey) => (await rollup.find({ urlKey }).toArray())
  .map(({ _id, ...rest }) => rest).sort((a, b) => a.day.localeCompare(b.day));
const dayRow = async (urlKey, day) => (await rowsOf(urlKey)).find((r) => r.day === day);
const runAt = (nowMs, extra = {}) => createKpiDailyRollupRun({ dispatchHistory: history, rollup, now: () => nowMs, ...extra })();

describe('day helpers', () => {
  test('the first whole day inside the horizon, and yesterday', () => {
    assert.equal(firstRollupDay(NOW), FIRST);
    assert.equal(firstRollupDay(Date.parse('2026-10-20T00:00:00.000Z')), '2026-09-20', 'a horizon on a day boundary is that day');
    assert.equal(yesterdayKey(NOW), '2026-10-19');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
});

describe('rollupCountsByDay', () => {
  const range = { from: '2026-10-01', to: '2026-10-10' };
  const byDay = (counts) => Object.fromEntries(counts.map((c) => [c.day, c]));

  test('every day in the range is present with zeros', () => {
    const counts = rollupCountsByDay([], range);
    assert.equal(counts.length, 10);
    assert.ok(counts.every((c) => c.done === 0 && c.failed === 0 && c.aborted === 0 && c.dispatches === 0));
  });

  test('a lineage done on D and again on D+5 counts once, on D+5', () => {
    const first = row({ root: 'L1', day: '2026-10-01', terminal: ['done', at('2026-10-01', '13:00:00')] });
    const followUp = row({ root: 'L1', day: '2026-10-06', terminal: ['done', at('2026-10-06', '09:00:00')] });
    const days = byDay(rollupCountsByDay([first, followUp], range));
    assert.equal(days['2026-10-01'].done, 0);
    assert.equal(days['2026-10-06'].done, 1);
    assert.equal(Object.values(days).reduce((n, c) => n + c.done, 0), 1);
    assert.equal(days['2026-10-01'].dispatches, 1);
    assert.equal(days['2026-10-06'].dispatches, 1, 'dispatches count rows, by their own day');
  });

  test('cross-midnight: dispatched 23:00, done 01:00 next day, lands on the day of the terminal', () => {
    const days = byDay(rollupCountsByDay(
      [row({ day: '2026-10-02', time: '23:00:00', terminal: ['done', at('2026-10-03', '01:00:00')] })], range
    ));
    assert.equal(days['2026-10-02'].done, 0);
    assert.equal(days['2026-10-03'].done, 1);
    assert.equal(days['2026-10-02'].dispatches, 1);
  });

  test('a late abort lands on the day of the abort, and the abort row counts as a dispatch', () => {
    const target = row({ _id: 'T1', day: '2026-10-02', time: '23:00:00' });
    const abort = row({ day: '2026-10-04', time: '00:30:00', abort: true, abortTo: 'T1', terminal: ['aborted', at('2026-10-04', '00:35:00')] });
    const days = byDay(rollupCountsByDay([target, abort], range));
    assert.equal(days['2026-10-04'].aborted, 1);
    assert.equal(days['2026-10-02'].aborted, 0);
    assert.equal(days['2026-10-04'].dispatches, 1, 'abort rows are dispatch rows');
  });

  test('failed and aborted are counted; skipped and a null statusMs are not', () => {
    const rows = [
      row({ day: '2026-10-03', terminal: ['failed', at('2026-10-03')] }),
      row({ day: '2026-10-03', terminal: ['aborted', at('2026-10-03')] }),
      row({ day: '2026-10-03', terminal: ['skipped', at('2026-10-03')] }),
      row({ day: '2026-10-03', terminal: ['done', 'not a time'] })
    ];
    const day = byDay(rollupCountsByDay(rows, range))['2026-10-03'];
    assert.deepEqual([day.done, day.failed, day.aborted, day.dispatches], [0, 1, 1, 4]);
  });

  test('rows outside the range count nowhere', () => {
    const days = rollupCountsByDay([row({ day: '2026-09-01', terminal: ['done', at('2026-09-01')] })], range);
    assert.ok(days.every((c) => c.done === 0 && c.dispatches === 0));
  });
});

describe('writeRollupDays', () => {
  const counts = (day, n) => ({ day, done: n, failed: 0, aborted: 0, dispatches: n });

  test('upserts with exactly the documented fields and is idempotent', async () => {
    await writeRollupDays(rollup, [{ urlKey: 'ws-a', days: [counts('2026-10-01', 2)] }]);
    await writeRollupDays(rollup, [{ urlKey: 'ws-a', days: [counts('2026-10-01', 2)] }]);
    assert.deepEqual(await rowsOf('ws-a'), [{ urlKey: 'ws-a', day: '2026-10-01', done: 2, failed: 0, aborted: 0, dispatches: 2 }]);
  });

  test('an all-zero day creates no row but overwrites an existing one', async () => {
    await writeRollupDays(rollup, [{ urlKey: 'ws-a', days: [counts('2026-10-01', 0), counts('2026-10-02', 3)] }]);
    assert.deepEqual((await rowsOf('ws-a')).map((r) => r.day), ['2026-10-02']);
    await writeRollupDays(rollup, [{ urlKey: 'ws-a', days: [counts('2026-10-02', 0)] }]);
    assert.deepEqual(await rowsOf('ws-a'), [{ urlKey: 'ws-a', day: '2026-10-02', done: 0, failed: 0, aborted: 0, dispatches: 0 }]);
  });

  test('writes use bulkWrite ordered:false with updateOne upserts', async () => {
    const calls = [];
    const fake = { bulkWrite: async (ops, opts) => { calls.push({ ops, opts }); } };
    await writeRollupDays(fake, [{ urlKey: 'ws-a', days: [counts('2026-10-01', 1), counts('2026-10-02', 0)] }]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].opts, { ordered: false });
    assert.deepEqual(calls[0].ops.map((o) => o.updateOne.upsert), [true, false]);
    assert.deepEqual(calls[0].ops[0].updateOne.filter, { urlKey: 'ws-a', day: '2026-10-01' });
  });

  test('a batch whose every write error is E11000 is retried once (driver and MangoDB entry shapes)', async () => {
    for (const writeErrors of [[{ code: 11000 }], [{ index: 0, error: { code: 11000 } }]]) {
      let attempts = 0;
      const fake = {
        bulkWrite: async () => {
          attempts++;
          if (attempts === 1) throw Object.assign(new Error('E11000 duplicate key'), { writeErrors });
        }
      };
      await writeRollupDays(fake, [{ urlKey: 'ws-a', days: [counts('2026-10-01', 1)] }]);
      assert.equal(attempts, 2);
    }
  });

  test('a second E11000, a mixed error or a plain error propagates', async () => {
    const dup = () => Object.assign(new Error('dup'), { writeErrors: [{ code: 11000 }] });
    for (const err of [dup(), Object.assign(new Error('mixed'), { writeErrors: [{ code: 11000 }, { code: 2 }] }), new Error('network')]) {
      let attempts = 0;
      const fake = { bulkWrite: async () => { attempts++; throw err; } };
      await assert.rejects(writeRollupDays(fake, [{ urlKey: 'ws-a', days: [counts('2026-10-01', 1)] }]), err);
      assert.equal(attempts, err.message === 'dup' ? 2 : 1);
    }
  });
});

describe('the daily job', () => {
  test('writes days first..today for a workspace, and a re-run changes nothing', async () => {
    await history.insertMany([row({ day: '2026-10-10', terminal: ['done', at('2026-10-10', '14:00:00')] })]);
    await runAt(NOW);
    const days = await rowsOf('ws-a');
    assert.deepEqual(await dayRow('ws-a', '2026-10-10'), { urlKey: 'ws-a', day: '2026-10-10', done: 1, failed: 0, aborted: 0, dispatches: 1 });
    assert.ok(days.every((r) => r.day >= FIRST && r.day <= '2026-10-20'));
    assert.equal(days.length, 1, 'zero days create no rows');

    // Force a second full run on the same data (stale marker): nothing changes.
    const rowsBefore = JSON.stringify(await rollup.find({ day: { $exists: true } }).sort({ day: 1 }).toArray());
    await rollup.deleteOne({ _id: ROLLUP_MARKER_ID });
    assert.equal((await runAt(NOW)).scanned, true);
    assert.equal(JSON.stringify(await rollup.find({ day: { $exists: true } }).sort({ day: 1 }).toArray()), rowsBefore);
  });

  test('a follow-up days after the first terminal moves the lineage to the later day', async () => {
    await history.insertMany([
      row({ root: 'L1', day: '2026-10-05', terminal: ['done', at('2026-10-05')] }),
      row({ root: 'L1', day: '2026-10-10', terminal: ['done', at('2026-10-10')] })
    ]);
    await runAt(NOW);
    assert.equal((await dayRow('ws-a', '2026-10-05')).done, 0, 'the earlier day is rewritten to zero, not left at 1');
    assert.equal((await dayRow('ws-a', '2026-10-10')).done, 1);
  });

  test('cross-midnight and late-abort lineages are counted with L = 7 and lost with L = 0', async () => {
    const dayBeforeFirst = addDays(FIRST, -1);
    const target = row({ day: dayBeforeFirst, time: '23:00:00' });
    await history.insertMany([
      row({ urlKey: 'ws-x', day: dayBeforeFirst, time: '23:00:00', terminal: ['done', at(FIRST, '01:00:00')] }),
      target,
      row({ urlKey: 'ws-a', day: FIRST, time: '00:30:00', abort: true, abortTo: target._id, terminal: ['aborted', at(FIRST, '00:35:00')] })
    ]);

    const lossy = db.collection('lossy-rollup');
    await createKpiDailyRollupRun({ dispatchHistory: history, rollup: lossy, now: () => NOW, lookbackDays: 0 })();
    const lossyRows = await lossy.find({ day: FIRST }).toArray();
    assert.ok(!lossyRows.some((r) => r.done > 0 || r.aborted > 0), `L = 0 misses both: ${JSON.stringify(lossyRows)}`);

    await runAt(NOW);
    assert.equal((await dayRow('ws-x', FIRST)).done, 1, 'cross-midnight terminal lands on its own day');
    assert.equal((await dayRow('ws-a', FIRST)).aborted, 1, 'the late abort lands on the abort day');
    assert.ok(ROLLUP_LOOKBACK_DAYS >= 1);
  });

  test('a lineage whose latest terminal row is older than L is missed (the stated loss mode)', async () => {
    const old = addDays(FIRST, -(ROLLUP_LOOKBACK_DAYS + 3));
    await history.insertMany([
      row({ root: 'L9', day: old, terminal: ['done', at(FIRST, '02:00:00')] })
    ]);
    await runAt(NOW);
    assert.equal(await dayRow('ws-a', FIRST), undefined);
  });

  test('a quiet workspace: its in-horizon rows go to zero, no new zero rows, frozen days stay', async () => {
    const frozen = addDays(FIRST, -3);
    await rollup.insertMany([
      { urlKey: 'ws-quiet', day: frozen, done: 4, failed: 0, aborted: 0, dispatches: 4 },
      { urlKey: 'ws-quiet', day: '2026-10-01', done: 2, failed: 1, aborted: 0, dispatches: 3 }
    ]);
    await history.insertMany([row({ urlKey: 'ws-busy', day: '2026-10-12', terminal: ['done', at('2026-10-12')] })]);
    await runAt(NOW);
    assert.deepEqual(await dayRow('ws-quiet', '2026-10-01'), { urlKey: 'ws-quiet', day: '2026-10-01', done: 0, failed: 0, aborted: 0, dispatches: 0 });
    assert.equal((await rowsOf('ws-quiet')).length, 2, 'no zero row was created for any other day');
    assert.equal((await dayRow('ws-quiet', frozen)).done, 4, 'a day that has left the horizon is not touched');
  });

  test('a skipped run is repaired by the next', async () => {
    await history.insertMany([row({ day: '2026-10-08', terminal: ['done', at('2026-10-08')] })]);
    await runAt(Date.parse('2026-10-09T01:00:00.000Z'));
    assert.equal((await dayRow('ws-a', '2026-10-08')).done, 1);
    // Days 10-10..10-17 were never run. A later row arrives for the same lineage.
    await history.insertMany([row({ urlKey: 'ws-a', root: 'late', day: '2026-10-15', terminal: ['done', at('2026-10-15')] })]);
    await runAt(NOW);
    assert.equal((await dayRow('ws-a', '2026-10-15')).done, 1);
    assert.equal((await dayRow('ws-a', '2026-10-08')).done, 1);
  });

  test('null statusMs and skipped lineages are uncounted by the job', async () => {
    await history.insertMany([
      row({ day: '2026-10-12', terminal: ['skipped', at('2026-10-12')] }),
      row({ day: '2026-10-12', terminal: ['done', 'garbage'] })
    ]);
    await runAt(NOW);
    assert.deepEqual(await dayRow('ws-a', '2026-10-12'), { urlKey: 'ws-a', day: '2026-10-12', done: 0, failed: 0, aborted: 0, dispatches: 2 });
  });

  test('the marker: two ticks on one UTC day make one scan, the next day makes one more, a failed run scans again', async () => {
    let aggregates = 0;
    const counting = new Proxy(history, {
      get(target, prop) {
        if (prop === 'aggregate') return (...args) => { aggregates++; return target.aggregate(...args); };
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const tick = (nowMs, extra = {}) => createKpiDailyRollupRun({ dispatchHistory: counting, rollup, now: () => nowMs, ...extra })();

    assert.equal((await tick(Date.parse('2026-10-20T00:30:00.000Z'))).scanned, true);
    assert.equal((await tick(Date.parse('2026-10-20T13:00:00.000Z'))).scanned, false);
    assert.equal(aggregates, 1, 'one aggregate for two ticks');
    assert.deepEqual(await rollup.findOne({ _id: ROLLUP_MARKER_ID }), { _id: ROLLUP_MARKER_ID, through: '2026-10-19' });

    assert.equal((await tick(Date.parse('2026-10-21T00:30:00.000Z'))).scanned, true);
    assert.equal(aggregates, 2);

    // A failed run leaves the marker alone, so the next tick scans again.
    const failing = { ...counting, aggregate: () => { throw new Error('boom'); }, find: () => { throw new Error('boom'); } };
    await assert.rejects(createKpiDailyRollupRun({ dispatchHistory: failing, rollup, now: () => Date.parse('2026-10-22T00:30:00.000Z') })(), /boom/);
    assert.equal((await rollup.findOne({ _id: ROLLUP_MARKER_ID })).through, '2026-10-20');
    assert.equal((await tick(Date.parse('2026-10-22T01:30:00.000Z'))).scanned, true);
    assert.equal(aggregates, 3);
  });

  test('the marker\'s `through` is taken at tick start: a run that crosses midnight is not marked complete for the day it did not see', async () => {
    const times = [Date.parse('2026-10-20T23:59:59.000Z')];
    const crossing = () => (times.length ? times.shift() : Date.parse('2026-10-21T00:00:30.000Z'));
    await createKpiDailyRollupRun({ dispatchHistory: history, rollup, now: crossing })();
    assert.equal((await rollup.findOne({ _id: ROLLUP_MARKER_ID })).through, '2026-10-19');
  });

  test('one aggregate per run, whatever the number of workspaces', async () => {
    await history.insertMany(['ws-a', 'ws-b', 'ws-c'].map((urlKey) => row({ urlKey, day: '2026-10-12', terminal: ['done', at('2026-10-12')] })));
    let aggregates = 0;
    const counting = new Proxy(history, {
      get(target, prop) {
        if (prop === 'aggregate') return (...args) => { aggregates++; return target.aggregate(...args); };
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    await createKpiDailyRollupRun({ dispatchHistory: counting, rollup, now: () => NOW })();
    assert.equal(aggregates, 1);
    assert.deepEqual((await rollup.distinct('urlKey', { day: { $gte: FIRST } })).sort(), ['ws-a', 'ws-b', 'ws-c']);
  });

  test('the marker coexists with the unique index and holds no urlKey or day', async () => {
    await runAt(NOW);
    await rollup.deleteOne({ _id: ROLLUP_MARKER_ID });
    await runAt(NOW);
    const marker = await rollup.findOne({ _id: ROLLUP_MARKER_ID });
    assert.deepEqual(Object.keys(marker).sort(), ['_id', 'through']);
    assert.equal(await rollup.countDocuments({ _id: ROLLUP_MARKER_ID }), 1);
  });
});

describe('agreement with the public page (collectKpiStats)', () => {
  const names = [
    'sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues', 'dispatchQueue',
    'dispatchTokens', 'proxyTokens', 'proxyEvents', 'agentStatus', 'freeTier', 'recapCache', 'briefCache', 'reportHistory', 'kpiDailyRollup'
  ];
  const stub = (rows = []) => ({
    find: () => ({ toArray: async () => rows }),
    countDocuments: async () => 0,
    aggregate: () => ({ toArray: async () => [] })
  });

  test('done summed over workspaces is >= daily.done everywhere and equal from first+L; dispatches differ by queue rows only', async () => {
    const queueRows = [
      { _id: 'q1', urlKey: 'ws-a', status: 'queued', dispatchedAt: new Date(at('2026-10-15')), rootItemId: 'q1' },
      { _id: 'q2', urlKey: 'ws-b', status: 'queued', dispatchedAt: new Date(at('2026-10-16')), rootItemId: 'q2' }
    ];
    await history.insertMany([
      row({ urlKey: 'ws-a', root: 'A1', day: '2026-10-05', terminal: ['done', at('2026-10-05')] }),
      row({ urlKey: 'ws-a', root: 'A1', day: '2026-10-09', terminal: ['done', at('2026-10-09')] }),
      row({ urlKey: 'ws-a', day: '2026-10-11', time: '23:00:00', terminal: ['done', at('2026-10-12', '01:00:00')] }),
      row({ urlKey: 'ws-b', day: '2026-10-12', terminal: ['failed', at('2026-10-12')] }),
      row({ urlKey: 'ws-b', day: '2026-10-13', terminal: ['done', at('2026-10-13')] }),
      row({ urlKey: 'ws-b', day: '2026-10-14', terminal: ['skipped', at('2026-10-14')] }),
      // Dispatched inside the 7 days before `first` but not inside the page's horizon: the rollup alone sees it.
      row({ urlKey: 'ws-b', day: addDays(FIRST, -2), terminal: ['done', at(addDays(FIRST, 1))] })
    ]);
    await runAt(NOW);

    const collections = Object.fromEntries(names.map((n) => [n, stub()]));
    collections.dispatchHistory = history;
    collections.dispatchQueue = stub(queueRows);
    const stats = await collectKpiStats(collections, { now: new Date(NOW), milestoneFunnelDeps: {} });
    const axis = stats.proxyCategories.days;
    assert.ok(Array.isArray(axis) && axis.length === 30);

    const sums = new Map();
    for (const r of await rollup.find({ day: { $exists: true } }).toArray()) {
      const sum = sums.get(r.day) ?? { done: 0, dispatches: 0 };
      sum.done += r.done; sum.dispatches += r.dispatches;
      sums.set(r.day, sum);
    }
    let comparedEqual = 0;
    axis.forEach((day, i) => {
      const rolled = sums.get(day)?.done ?? 0;
      assert.ok(rolled >= stats.daily.done[i], `${day}: rollup ${rolled} < page ${stats.daily.done[i]}`);
      if (day >= addDays(FIRST, ROLLUP_LOOKBACK_DAYS) && day <= '2026-10-19') {
        assert.equal(rolled, stats.daily.done[i], day);
        comparedEqual++;
      }
    });
    assert.ok(comparedEqual > 5);

    const rolledDispatches = [...sums.entries()].filter(([day]) => axis.includes(day)).reduce((n, [, s]) => n + s.dispatches, 0);
    const pageDispatches = stats.daily.dispatches.reduce((n, x) => n + x, 0);
    assert.equal(pageDispatches - rolledDispatches, queueRows.length, 'the page counts the queue rows, the rollup does not');
  });
});

describe('server.js registration (LIN-3724)', () => {
  const serverSrc = readFileSync(fileURLToPath(new URL('../../server.js', import.meta.url)), 'utf8');
  const site = serverSrc.slice(serverSrc.indexOf("name: 'kpi-daily-rollup'"));

  test('registered hourly with a 10 minute lease, un-awaited, with a catch saying it will NOT run this boot', () => {
    assert.ok(site.length > 0, 'registration site found');
    assert.match(serverSrc, /KPI_DAILY_ROLLUP_INTERVAL_MS = 60 \* 60 \* 1000/);
    assert.match(serverSrc, /KPI_DAILY_ROLLUP_LEASE_MS = 10 \* 60 \* 1000/);
    assert.match(serverSrc, /^scheduler\.register\(\{\n {2}name: 'kpi-daily-rollup'/m, 'not awaited');
    assert.match(site.slice(0, 700), /\.catch\(\(err\) => \{\n\s+console\.error\(`\[kpi-daily-rollup\][^`]*will NOT run this boot/);
  });
});
