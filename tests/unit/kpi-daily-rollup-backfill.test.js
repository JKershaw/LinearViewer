/**
 * LIN-3724: the KPI daily rollup backfill (lib/kpi-daily-rollup.js `runBackfill`
 * and scripts/backfill-kpi-daily-rollup.mjs): dry run by default, the plan, the
 * range refusals, the loss figure, exit 2 and exit 3, and equality with the job.
 *
 * Real MangoDB over a tmpdir. Run with: node --test tests/unit/kpi-daily-rollup-backfill.test.js
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import {
  runBackfill, createKpiDailyRollupRun, ROLLUP_HISTORY_INDEX, ROLLUP_LOOKBACK_DAYS, BackfillError,
  dayStartMs, addDays, firstRollupDay
} from '../../lib/kpi-daily-rollup.js';
import { main, parseArgs, exitCodeOf } from '../../scripts/backfill-kpi-daily-rollup.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-20T13:00:00.000Z'); // first in-horizon day: 2026-09-21
const at = (day, time = '12:00:00') => `${day}T${time}.000Z`;
const quiet = { log() {} };

let seq = 0;
function row({ urlKey = 'ws-a', root, day, time = '12:00:00', terminal }) {
  const id = `b${++seq}`;
  return {
    _id: id, urlKey, rootItemId: root ?? id, status: 'taken', dispatchedAt: new Date(at(day, time)),
    feedback: terminal ? [{ message: `[${terminal[0]}] finished`, timestamp: terminal[1] }] : []
  };
}

const harness = createMangoTmpdir('lin-3724-backfill-');
before(() => harness.connect());
after(() => harness.close());

let db, history, rollup;
beforeEach(async () => {
  db = harness.freshDb();
  history = db.collection('dispatch-history');
  rollup = db.collection('kpi-daily-rollup');
  await history.createIndex(ROLLUP_HISTORY_INDEX);
  await rollup.createIndex({ urlKey: 1, day: 1 }, { unique: true });
});

/** A db handle whose dispatch-history aggregate() calls are counted. */
function countingDb(real) {
  const counter = { aggregates: 0 };
  return {
    counter,
    collection(name) {
      const col = real.collection(name);
      if (name !== 'dispatch-history') return col;
      return new Proxy(col, {
        get(target, prop) {
          if (prop === 'aggregate') return (...args) => { counter.aggregates++; return target.aggregate(...args); };
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  };
}

const seed = () => history.insertMany([
  row({ day: '2026-07-01' }),
  row({ day: '2026-07-10', terminal: ['done', at('2026-07-10', '15:00:00')] }),
  row({ day: '2026-07-20', terminal: ['failed', at('2026-07-20')] }),
  row({ urlKey: 'ws-b', day: '2026-08-02' })
]);
const rollupRows = async () => (await rollup.find({ day: { $exists: true } }).toArray())
  .map(({ _id, ...r }) => r).sort((a, b) => (a.urlKey + a.day).localeCompare(b.urlKey + b.day));

describe('runBackfill', () => {
  test('plan-only prints the plan and makes no history query', async () => {
    await seed();
    const counted = countingDb(db);
    const report = await runBackfill({ db: counted, now: NOW, planOnly: true, logger: quiet });
    assert.equal(counted.counter.aggregates, 0);
    const a = report.workspaces.find((w) => w.urlKey === 'ws-a');
    assert.equal(a.oldestDay, '2026-07-01');
    assert.equal(a.days[0], '2026-07-02');
    assert.equal(a.days.at(-1), '2026-09-20', 'the last unit is the day before the first in-horizon day');
    assert.equal(report.plannedQueries, report.workspaces.reduce((n, w) => n + w.days.length, 0));
    assert.deepEqual(a.shortLookbackDays, a.days.slice(0, ROLLUP_LOOKBACK_DAYS - 1), 'days within L of the oldest day are flagged');
  });

  test('planned query count equals the aggregates made, in both modes', async () => {
    await seed();
    for (const write of [false, true]) {
      const counted = countingDb(db);
      const report = await runBackfill({ db: counted, now: NOW, write, from: '2026-07-05', to: '2026-07-25', logger: quiet });
      assert.equal(counted.counter.aggregates, report.plannedQueries, `write=${write}`);
      assert.equal(report.queries, report.plannedQueries);
      assert.ok(report.plannedQueries > 0);
    }
  });

  test('every query carries $gte, $lt and urlKey', async () => {
    await seed();
    const pipelines = [];
    const spy = {
      collection(name) {
        const col = db.collection(name);
        if (name !== 'dispatch-history') return col;
        return new Proxy(col, {
          get(target, prop) {
            if (prop === 'aggregate') return (pipeline) => { pipelines.push(pipeline); return target.aggregate(pipeline); };
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
      }
    };
    await runBackfill({ db: spy, now: NOW, write: true, from: '2026-07-11', to: '2026-07-13', logger: quiet });
    assert.equal(pipelines.length, 3, 'three days, one workspace (ws-b has no history before its own oldest day + 1)');
    for (const [{ $match }] of pipelines) {
      assert.ok($match.dispatchedAt.$gte instanceof Date && $match.dispatchedAt.$lt instanceof Date);
      assert.equal(typeof $match.urlKey, 'string');
    }
    const day = dayStartMs('2026-07-11');
    const forA = pipelines.find(([{ $match }]) => $match.urlKey === 'ws-a')[0].$match.dispatchedAt;
    assert.equal(forA.$gte.getTime(), day - ROLLUP_LOOKBACK_DAYS * DAY_MS);
    assert.equal(forA.$lt.getTime(), day + 30 * DAY_MS);
  });

  test('the dry run writes nothing; --write writes', async () => {
    await seed();
    const dry = await runBackfill({ db, now: NOW, from: '2026-07-05', to: '2026-07-25', logger: quiet });
    assert.equal(dry.mode, 'dry-run');
    assert.deepEqual(await rollupRows(), []);
    const wrote = await runBackfill({ db, now: NOW, write: true, from: '2026-07-05', to: '2026-07-25', logger: quiet });
    assert.equal(wrote.mode, 'write');
    const rows = await rollupRows();
    assert.deepEqual(rows.find((r) => r.day === '2026-07-10'), { urlKey: 'ws-a', day: '2026-07-10', done: 1, failed: 0, aborted: 0, dispatches: 1 });
    assert.equal(rows.find((r) => r.day === '2026-07-20').failed, 1);
    assert.ok(!rows.some((r) => r.done + r.failed + r.aborted + r.dispatches === 0), 'no zero rows');
    // Idempotent.
    await runBackfill({ db, now: NOW, write: true, from: '2026-07-05', to: '2026-07-25', logger: quiet });
    assert.deepEqual(await rollupRows(), rows);
  });

  test('the dry run leaves the data directory byte-identical', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lin-3724-dry-'));
    const client = new MangoClient(dir);
    try {
      await client.connect();
      const d = client.db('linear-viewer');
      await d.collection('dispatch-history').createIndex(ROLLUP_HISTORY_INDEX);
      await d.collection('dispatch-history').insertMany([row({ day: '2026-07-01' }), row({ day: '2026-07-10', terminal: ['done', at('2026-07-10')] })]);
      const snapshot = () => {
        const out = {};
        const walk = (p) => { for (const name of readdirSync(p)) { const f = join(p, name); statSync(f).isDirectory() ? walk(f) : (out[f] = readFileSync(f, 'utf8')); } };
        walk(dir);
        return out;
      };
      const before = snapshot();
      await runBackfill({ db: d, now: NOW, logger: quiet });
      await runBackfill({ db: d, now: NOW, planOnly: true, logger: quiet });
      assert.deepEqual(snapshot(), before);
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--from/--to are refused, not clamped', async () => {
    await seed();
    const refused = (opts, pattern) => assert.rejects(
      runBackfill({ db, now: NOW, logger: quiet, ...opts }),
      (err) => err instanceof BackfillError && err.code === 4 && pattern.test(err.message)
    );
    await refused({ from: '2026-07-01' }, /outside the days/); // the oldest day itself
    await refused({ to: '2026-09-21' }, /outside the days/); // the first in-horizon day
    await refused({ from: '2026-07-05', to: '2026-07-04' }, /after --to/);
    await refused({ from: '2026-7-5' }, /YYYY-MM-DD/);
    await refused({ from: '2026-02-30' }, /YYYY-MM-DD/);
  });

  test('days within L of the oldest day are flagged and the oldest day is never a unit', async () => {
    await seed();
    const report = await runBackfill({ db, now: NOW, from: '2026-07-02', to: '2026-07-12', logger: quiet });
    const a = report.workspaces.find((w) => w.urlKey === 'ws-a');
    assert.ok(!a.days.includes('2026-07-01'));
    assert.deepEqual(a.shortLookbackDays, ['2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07']);
  });

  test('the dry run reports a lineage the lookback loses (a lower bound), and --write does not write it', async () => {
    const day = '2026-08-20';
    await history.insertMany([
      row({ day: '2026-07-01' }),
      // Latest terminal row dispatched 15 days before the day it finished: beyond L = 7, inside the audit window.
      row({ root: 'LOSS', day: addDays(day, -15), terminal: ['done', at(day, '03:00:00')] })
    ]);
    const dry = await runBackfill({ db, now: NOW, from: day, to: day, logger: quiet });
    assert.deepEqual(dry.differingDays, [{ urlKey: 'ws-a', day, done: 1, failed: 0, aborted: 0 }]);
    assert.deepEqual(dry.loss, { done: 1, failed: 0, aborted: 0 });
    await runBackfill({ db, now: NOW, write: true, from: day, to: day, logger: quiet });
    assert.equal((await rollupRows()).find((r) => r.day === day), undefined, 'the loss is what --write leaves out');
  });

  test('exit 3: the history index missing is refused before any read', async () => {
    const bare = harness.freshDb();
    await bare.collection('dispatch-history').insertMany([row({ day: '2026-07-01' })]);
    const counted = countingDb(bare);
    await assert.rejects(runBackfill({ db: counted, now: NOW, logger: quiet }), (err) => err.code === 3 && /index missing: see runbook/.test(err.message));
    assert.equal(counted.counter.aggregates, 0);
  });

  test('exit 3: an unreadable index state refuses too, it never passes as built (LIN-3811)', async () => {
    const unreadable = {
      collection: () => ({
        listIndexes: () => ({ toArray: async () => { throw Object.assign(new Error('network down'), { code: 6 }); } })
      })
    };
    const warnings = [];
    const noisy = { ...quiet, warn: (line) => warnings.push(line) };
    await assert.rejects(
      runBackfill({ db: unreadable, now: NOW, logger: noisy }),
      (err) => err.code === 3 && /could not be read/.test(err.message)
    );
    assert.ok(warnings.length > 0 && warnings.every((line) => /could not read indexes/.test(line)), 'the unknown-state warnings go through the backfill logger');
  });

  test('backfill equals the job\'s last write for a day past the horizon (a missing row is zero)', async () => {
    const D = '2026-08-10';
    await history.insertMany([
      row({ day: addDays(D, -40) }),
      row({ root: 'E1', day: addDays(D, -3), terminal: ['done', at(addDays(D, -3))] }),
      row({ root: 'E1', day: D, time: '23:00:00', terminal: ['done', at(addDays(D, 1), '01:00:00')] }),
      row({ day: addDays(D, -1), time: '22:00:00', terminal: ['failed', at(D, '02:00:00')] }),
      row({ urlKey: 'ws-b', day: addDays(D, -20) }),
      row({ urlKey: 'ws-b', day: D, terminal: ['aborted', at(D, '18:00:00')] }),
      row({ urlKey: 'ws-b', day: addDays(D, 2), terminal: ['done', at(addDays(D, 2))] })
    ]);
    // The job at now = start(D) + 30d has first = D, so its window equals the backfill's.
    const jobNow = dayStartMs(D) + 30 * DAY_MS;
    assert.equal(firstRollupDay(jobNow), D);
    await createKpiDailyRollupRun({ dispatchHistory: history, rollup, now: () => jobNow })();
    const jobRows = (await rollupRows()).filter((r) => r.day === D);

    const bfDb = harness.freshDb();
    await bfDb.collection('dispatch-history').createIndex(ROLLUP_HISTORY_INDEX);
    await bfDb.collection('dispatch-history').insertMany(await history.find({}).toArray());
    await runBackfill({ db: bfDb, now: dayStartMs(addDays(D, 1)) + 30 * DAY_MS, write: true, from: D, to: D, logger: quiet });
    const bfRows = (await bfDb.collection('kpi-daily-rollup').find({}).toArray()).map(({ _id, ...r }) => r).filter((r) => r.day === D);
    const keyed = (rows) => Object.fromEntries(rows.map((r) => [r.urlKey, r]));
    assert.ok(jobRows.length > 0);
    assert.deepEqual(keyed(bfRows), keyed(jobRows));
  });
});

describe('the production-shaped job write vs the backfill (Done-when 4, plan Finding 1)', () => {
  const D = '2026-08-10';
  // The job's last in-horizon tick for D: first tick after midnight of D+29, where firstRollupDay is still D.
  const lastTick = dayStartMs(addDays(D, 29)) + 60 * 60 * 1000;
  const backfillNow = dayStartMs(addDays(D, 1)) + 30 * DAY_MS;
  const keyed = (rows) => Object.fromEntries(rows.map((r) => [r.urlKey, r]));

  const seedLineages = () => history.insertMany([
    row({ day: addDays(D, -40) }),
    row({ urlKey: 'ws-b', day: addDays(D, -20) }),
    row({ root: 'P1', day: addDays(D, -2), terminal: ['done', at(addDays(D, -2))] }),
    row({ root: 'P2', day: D, time: '09:00:00', terminal: ['failed', at(D, '10:00:00')] }),
    row({ urlKey: 'ws-b', root: 'P3', day: D, terminal: ['aborted', at(D, '18:00:00')] })
  ]);

  async function jobThenBackfill(afterJob = async () => {}) {
    assert.equal(firstRollupDay(lastTick), D, 'the tick is D\'s last in-horizon run');
    await createKpiDailyRollupRun({ dispatchHistory: history, rollup, now: () => lastTick })();
    const jobRows = (await rollupRows()).filter((r) => r.day === D);
    await afterJob();
    const bfDb = harness.freshDb();
    await bfDb.collection('dispatch-history').createIndex(ROLLUP_HISTORY_INDEX);
    await bfDb.collection('dispatch-history').insertMany(await history.find({}).toArray());
    await runBackfill({ db: bfDb, now: backfillNow, write: true, from: D, to: D, logger: quiet });
    const bfRows = (await bfDb.collection('kpi-daily-rollup').find({}).toArray()).map(({ _id, ...r }) => r).filter((r) => r.day === D);
    return { jobRows, bfRows };
  }

  test('(a) no row dispatched after the job\'s last tick: the two are equal', async () => {
    await seedLineages();
    const { jobRows, bfRows } = await jobThenBackfill();
    assert.ok(jobRows.length > 0);
    assert.deepEqual(keyed(bfRows), keyed(jobRows));
  });

  test('(b) a follow-up of a D lineage dispatched in the final hour of the window, with a later terminal: they differ only on that lineage', async () => {
    await seedLineages();
    // Dispatched at start(D)+30d-1h: after the job's last tick, inside the backfill's window. It moves P2 from failed on D to done on D+29.
    const late = addDays(D, 29);
    const { jobRows, bfRows } = await jobThenBackfill(() => history.insertOne(row({ root: 'P2', day: late, time: '23:00:00', terminal: ['done', at(late, '23:30:00')] })));
    const job = keyed(jobRows);
    const bf = keyed(bfRows);
    assert.deepEqual(bf['ws-b'], job['ws-b'], 'a workspace with no late row agrees');
    assert.equal(job['ws-a'].failed, 1, 'the job never saw the late follow-up');
    assert.equal(bf['ws-a']?.failed ?? 0, 0, 'the backfill sees it and moves the lineage off D');
    const { failed: _jf, ...jobRest } = job['ws-a'];
    const { failed: _bf, ...bfRest } = bf['ws-a'] ?? { urlKey: 'ws-a', day: D, done: 0, aborted: 0, dispatches: 0 };
    assert.deepEqual(bfRest, jobRest, 'only the failed count differs (the late row\'s own dispatch is on D+29)');
  });
});

describe('scripts/backfill-kpi-daily-rollup.mjs', () => {
  test('exit 2 when neither MONGODB_URI nor HARBOUR_DATA_DIR is set', async () => {
    const lines = [];
    const orig = console.error;
    console.error = (...args) => lines.push(args.join(' '));
    try {
      assert.equal(await main([], {}), 2);
    } finally {
      console.error = orig;
    }
    assert.match(lines.join('\n'), /MONGODB_URI or HARBOUR_DATA_DIR/);
  });

  test('a missing index surfaces as a BackfillError with code 3 through main', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lin-3724-noindex-'));
    const out = process.stdout.write;
    try {
      await assert.rejects(main([], { HARBOUR_DATA_DIR: dir }), (err) => err.code === 3);
    } finally {
      process.stdout.write = out;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('unknown arguments are refused', async () => {
    await assert.rejects(main(['--drop-everything'], { HARBOUR_DATA_DIR: tmpdir() }), /unknown argument/);
  });

  test('argument errors are BackfillErrors carrying their message: unknown is 1, a valueless --from/--to is the range refusal 4', () => {
    assert.throws(() => parseArgs(['--drop-everything']), (err) => err instanceof BackfillError && err.code === 1 && /unknown argument --drop-everything/.test(err.message));
    for (const argv of [['--from'], ['--to'], ['--from', '--write'], ['--write', '--to']]) {
      assert.throws(() => parseArgs(argv), (err) => err instanceof BackfillError && err.code === 4 && /needs a YYYY-MM-DD value/.test(err.message), argv.join(' '));
    }
    assert.deepEqual(parseArgs(['--write', '--from', '2026-07-05', '--to', '2026-07-15']), { write: true, planOnly: false, from: '2026-07-05', to: '2026-07-15' });
  });

  test('the exit code comes from a BackfillError only: a driver error with an integer code (2, 4, 13) exits 1', () => {
    assert.equal(exitCodeOf(new BackfillError('index missing: see runbook', 3)), 3);
    assert.equal(exitCodeOf(new BackfillError('refused', 4)), 4);
    for (const code of [2, 4, 13, 18]) assert.equal(exitCodeOf(Object.assign(new Error('driver'), { code })), 1, `driver code ${code}`);
    assert.equal(exitCodeOf(new Error('plain')), 1);
    assert.equal(exitCodeOf(undefined), 1);
  });
});
