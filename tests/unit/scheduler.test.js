/**
 * Unit tests for lib/scheduler.js (LIN-2128), per plan §8.
 *
 * Every test states, in its name or a comment, what it proves and what it
 * cannot — the same-process MangoDB half of (a) passes because of the
 * package's in-process `Mutex` serializing the operation, NOT because the
 * CAS predicate held across processes (`tests/unit/dispatch-store-add-feedback-atomic.test.js:19-32`
 * is the precedent for naming that trap honestly). Only the real-MongoDB
 * cross-process test (b) proves genuine cross-process exclusivity.
 *
 * Backend split:
 *  - MangoDB (real, tmpdir-backed, always runs): (a)'s MangoDB half, (c), (d),
 *    (e), (f), (g), and the LIN-2131 idempotency-contract test (h). Fast,
 *    no external service, exercises the module's own logic.
 *  - Real MongoDB (`MONGODB_TEST_URI`, CI-provided, hard-fail-not-skip in CI
 *    per the `tests/unit/mongo-smoke.test.js` convention): (a)'s real-Mongo
 *    half and (b), the cross-process race — this ticket's headline
 *    acceptance criterion, and the only test in this file that a MangoDB
 *    run cannot stand in for.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { MongoClient } from 'mongodb';
import { Scheduler } from '../../lib/scheduler.js';

const silentLogger = { warn: () => {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────
// MangoDB-backed: same-process logic, fast, no external service required.
// ─────────────────────────────────────────────────────────────────────────

describe('scheduler (MangoDB)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'scheduler-test-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshCollection() {
    return client.db(`sched_${counter++}`).collection('scheduler-locks');
  }

  // --- (a), MangoDB half ---------------------------------------------------

  test(
    'same-process concurrent claim on MangoDB: N callers, exactly one non-null winner ' +
      '(passes here because MangoDB\'s in-process Mutex serializes the op — NOT proof the ' +
      'CAS predicate holds cross-process; see the real-Mongo race test for that)',
    async () => {
      const collection = freshCollection();
      await collection.insertOne({ _id: 'tick:claim', lockedUntil: 0 });
      const scheduler = new Scheduler({ collection, logger: silentLogger });
      let runs = 0;
      const job = {
        name: 'claim',
        lockId: 'tick:claim',
        intervalMs: 60_000,
        leaseMs: 10_000,
        run: async () => {
          runs++;
        }
      };

      await Promise.all(Array.from({ length: 20 }, () => scheduler._tick(job)));

      assert.strictEqual(runs, 1, 'exactly one of 20 concurrent callers should win');
      const docs = await collection.find({}).toArray();
      assert.strictEqual(docs.length, 1, 'no duplicate lock document under concurrency');
    }
  );

  // --- (c) once-per-interval: the extend-on-success property, plan-review F1 -----

  test(
    'extend-on-success delivers at most one execution per interval, not just non-overlap ' +
      '(plan-review F1 repro: two instances at a 5s phase offset, intervalMs=60s, leaseMs=10s, ' +
      'over 3 periods — the pre-fix release-on-success design executed 6 times here, not 3)',
    async () => {
      const collection = freshCollection();
      await collection.insertOne({ _id: 'tick:sweep', lockedUntil: 0 });

      let now = 0;
      const clock = () => now;
      let runs = 0;
      const job = {
        name: 'sweep',
        lockId: 'tick:sweep',
        intervalMs: 60_000,
        leaseMs: 10_000,
        run: async () => {
          runs++;
        }
      };
      const schedulerA = new Scheduler({ collection, now: clock, logger: silentLogger });
      const schedulerB = new Scheduler({ collection, now: clock, logger: silentLogger });

      // Instance A ticks on the 60s boundary; instance B 5s later on its own,
      // unsynchronized phase — exactly the scenario the plan-review measured.
      const tickPlan = [
        [0, schedulerA],
        [5_000, schedulerB],
        [60_000, schedulerA],
        [65_000, schedulerB],
        [120_000, schedulerA],
        [125_000, schedulerB]
      ];
      for (const [t, scheduler] of tickPlan) {
        now = t;
        await scheduler._tick(job);
      }

      assert.strictEqual(
        runs,
        3,
        'three periods must yield at most 3 executions (once per interval), not 6 — the bug the plan-review found and F1 fixed'
      );
    }
  );

  // --- (d) sizing edge: run() outlasting leaseMs -----------------------------

  test(
    'sizing edge: a run() that outlasts leaseMs lets another instance acquire+run within the ' +
      'same interval — characterized here, not enforced by the module (a sizing decision left ' +
      'to register()\'s caller, per the plan; documented in the JSDoc, not runtime-checked)',
    async () => {
      const collection = freshCollection();
      await collection.insertOne({ _id: 'tick:slow', lockedUntil: 0 });

      let now = 0;
      const clock = () => now;
      const events = [];

      let resolveSlowStarted;
      const slowStarted = new Promise((resolve) => {
        resolveSlowStarted = resolve;
      });
      let releaseSlowRun;
      const slowRunGate = new Promise((resolve) => {
        releaseSlowRun = resolve;
      });

      const slowJob = {
        name: 'slow',
        lockId: 'tick:slow',
        intervalMs: 60_000,
        leaseMs: 10_000,
        run: async () => {
          events.push('slow-start');
          resolveSlowStarted();
          await slowRunGate;
          events.push('slow-done');
        }
      };
      const fastJob = { ...slowJob, run: async () => events.push('fast-run') };

      const schedulerSlow = new Scheduler({ collection, now: clock, logger: silentLogger });
      const schedulerFast = new Scheduler({ collection, now: clock, logger: silentLogger });

      now = 0;
      const slowTickPromise = schedulerSlow._tick(slowJob);
      await slowStarted; // guarantees the acquire landed and run() is genuinely in flight

      now = 15_000; // past leaseMs (10_000), still well within intervalMs (60_000)
      await schedulerFast._tick(fastJob);
      assert.deepStrictEqual(events, ['slow-start', 'fast-run'], 'the fast instance must acquire once the slow holder\'s lease has expired, even though the slow run() is still in flight');

      const midDoc = await collection.findOne({ _id: 'tick:slow' });
      const fastOwner = midDoc.owner;

      // Let the slow run finish. Its extend-on-success write is owner-guarded
      // and must be a harmless no-op: it must never clobber the newer holder's lease.
      releaseSlowRun();
      await slowTickPromise;
      assert.deepStrictEqual(events, ['slow-start', 'fast-run', 'slow-done']);

      const finalDoc = await collection.findOne({ _id: 'tick:slow' });
      assert.strictEqual(
        finalDoc.owner,
        fastOwner,
        'the slow holder\'s late extend-on-success must not overwrite the newer holder\'s lease'
      );
      assert.strictEqual(
        finalDoc.lockedUntil,
        15_000 + 60_000,
        'the newer (fast) holder\'s extend value must stand, untouched by the stale extend'
      );
    }
  );

  // --- (e) error containment -------------------------------------------------

  test(
    '(e) error containment: a throwing run is caught, does not clear the interval, does not ' +
      'strand the lease past leaseMs, and the next tick still acquires',
    async () => {
      const collection = freshCollection();
      const warnings = [];
      const scheduler = new Scheduler({ collection, logger: { warn: (msg) => warnings.push(msg) } });

      let callCount = 0;
      await scheduler.register({
        name: 'flaky',
        intervalMs: 30,
        leaseMs: 15,
        run: async () => {
          callCount++;
          if (callCount === 1) throw new Error('boom');
        }
      });

      scheduler.start();
      await sleep(300); // generously bounded: several 30ms ticks at 15ms leaseMs
      scheduler.stop();

      assert.ok(
        callCount >= 2,
        `expected the interval to keep ticking past the first throw (at least 2 calls), got ${callCount}`
      );
      assert.ok(
        warnings.some((w) => w.includes('run failed')),
        'the throw must be logged via the injected logger, not swallowed silently'
      );
    }
  );

  // --- (f) timer stop ----------------------------------------------------------

  test('(f) stop() clears every armed timer directly, and is idempotent', async () => {
    const collection = freshCollection();
    const scheduler = new Scheduler({ collection, logger: silentLogger });
    await scheduler.register({ name: 'a', intervalMs: 1000, leaseMs: 500, run: async () => {} });
    await scheduler.register({ name: 'b', intervalMs: 1000, leaseMs: 500, run: async () => {} });

    scheduler.start();
    assert.strictEqual(scheduler.timers.size, 2, 'start() should arm one timer per registered job');

    scheduler.stop();
    assert.strictEqual(scheduler.timers.size, 0, 'stop() should clear every armed timer');

    // A second stop() must be harmless — a duplicate SIGTERM calling it twice
    // (LIN-1757 F3's noted re-entrancy case) must not throw.
    assert.doesNotThrow(() => scheduler.stop());
  });

  // --- (g) side-effect boundaries ------------------------------------------

  test(
    '(g) side effects: acquire and extend touch only the intended fields — no stray documents, no unrelated mutation',
    async () => {
      const collection = freshCollection();
      const scheduler = new Scheduler({ collection, logger: silentLogger });
      await scheduler.register({ name: 'clean', intervalMs: 60_000, leaseMs: 10_000, run: async () => {} });

      let docs = await collection.find({}).toArray();
      assert.strictEqual(docs.length, 1, 'register() must seed exactly one document');
      assert.deepStrictEqual(
        Object.keys(docs[0]).sort(),
        ['_id', 'lockedUntil'],
        'the seed document must carry only _id and lockedUntil'
      );

      const job = scheduler.jobs.get('clean');
      await scheduler._tick(job);

      docs = await collection.find({}).toArray();
      assert.strictEqual(docs.length, 1, 'a winning acquire must never create a second document');
      assert.deepStrictEqual(
        Object.keys(docs[0]).sort(),
        ['_id', 'lockedUntil', 'owner'],
        'acquire must add only owner alongside the existing fields'
      );

      const docAfterWin = docs[0];
      await scheduler._tick(job); // still within the interval: must lose and mutate nothing

      const docsAfterLoss = await collection.find({}).toArray();
      assert.strictEqual(docsAfterLoss.length, 1);
      assert.deepStrictEqual(
        docsAfterLoss[0],
        docAfterWin,
        'a losing acquire attempt must not mutate the document at all'
      );
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────
// (h) File-backend duplicate-tick idempotency — a LIN-2131 DEPENDENCY test.
// This exercises the contract the sweep must satisfy on MangoDB (where this
// scheduler cannot prove exclusivity, see lib/scheduler.js's header), not
// this ticket's own locking logic — no lock is involved below at all, and no
// real sweep is implemented; LIN-2131 owns that.
// ─────────────────────────────────────────────────────────────────────────

describe('sweep duplicate-tick idempotency contract (LIN-2131 dependency, not implemented by this ticket)', () => {
  let dbDir;
  let client;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'scheduler-idempotency-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  test(
    '(h) an idempotent stub sweep converges to the same state whether it fires once or twice — ' +
      'the shape (observation-derived key, $set not $inc/$push) LIN-2131 must have for the ' +
      'MangoDB residual double-fire risk to stay harmless',
    async () => {
      const db = client.db('idempotent');
      const observations = db.collection('observations');

      const idempotentStubSweep = async () => {
        await observations.updateOne(
          { _id: 'obs:example' },
          { $set: { lastSeenAt: 'fixed-value', diagnosis: 'stub-diagnosis' } },
          { upsert: true }
        );
      };

      await idempotentStubSweep();
      const afterOne = await observations.findOne({ _id: 'obs:example' });

      // Two more fires, unguarded by any lock — standing in for the accepted
      // MangoDB residual risk (§1 of the research): this is NOT exercising
      // the scheduler's own exclusion (tests (a)-(c) above do that), it is
      // exercising what a duplicate fire does to a correctly-shaped sweep.
      await idempotentStubSweep();
      await idempotentStubSweep();
      const afterThree = await observations.findOne({ _id: 'obs:example' });

      assert.deepStrictEqual(
        afterThree,
        afterOne,
        'a duplicate fire must converge to the identical state as a single fire — no observable side effect beyond a harmless duplicate write'
      );
      const all = await observations.find({}).toArray();
      assert.strictEqual(all.length, 1, 'no duplicate document should ever be created by a duplicate tick');
    }
  );

  test(
    '(h) contrast, not a scheduler assertion: a NON-idempotent stub ($inc) demonstrates what LIN-2131 must avoid — proves the test above would actually catch a regression',
    async () => {
      const db = client.db('non-idempotent');
      const counters = db.collection('counters');

      const nonIdempotentStubSweep = async () => {
        await counters.updateOne({ _id: 'ctr:example' }, { $inc: { count: 1 } }, { upsert: true });
      };

      await nonIdempotentStubSweep();
      const afterOne = await counters.findOne({ _id: 'ctr:example' });
      await nonIdempotentStubSweep();
      const afterTwo = await counters.findOne({ _id: 'ctr:example' });

      assert.notDeepStrictEqual(
        afterTwo,
        afterOne,
        'a $inc-shaped sweep genuinely diverges under a duplicate fire — the property (h) above is protecting against'
      );
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Real MongoDB: (a)'s real-Mongo half, and (b) — the cross-process race that
// is this ticket's headline acceptance criterion. Cannot be proven on
// MangoDB (see the module's own header comment on the backend split).
// ─────────────────────────────────────────────────────────────────────────

const mongoTestUri = process.env.MONGODB_TEST_URI;
if (!mongoTestUri && process.env.CI) {
  throw new Error(
    'MONGODB_TEST_URI must be set in CI: the LIN-2128 real-Mongo scheduler tests must never silently skip'
  );
}

describe(
  'scheduler (real MongoDB)',
  { skip: mongoTestUri ? false : 'MONGODB_TEST_URI not set; skipping real-Mongo scheduler tests (local dev)' },
  () => {
    let client;
    let db;
    let counter = 0;

    before(async () => {
      client = new MongoClient(mongoTestUri);
      await client.connect();
      db = client.db(`scheduler_smoke_${randomUUID().slice(0, 8)}`);
    });

    after(async () => {
      if (db) await db.dropDatabase();
      if (client) await client.close();
    });

    function freshCollection(name) {
      return db.collection(`${name}_${counter++}`);
    }

    // --- (a), real-Mongo half --------------------------------------------

    test(
      'same-process concurrent claim on real MongoDB: exactly one winner — this DOES prove the ' +
        'CAS predicate itself (server-side conditional match), not merely engine serialization',
      async () => {
        const collection = freshCollection('scheduler-locks');
        await collection.insertOne({ _id: 'tick:claim', lockedUntil: 0 });
        const scheduler = new Scheduler({ collection, logger: silentLogger });
        let runs = 0;
        const job = {
          name: 'claim',
          lockId: 'tick:claim',
          intervalMs: 60_000,
          leaseMs: 10_000,
          run: async () => {
            runs++;
          }
        };

        await Promise.all(Array.from({ length: 50 }, () => scheduler._tick(job)));

        assert.strictEqual(runs, 1, 'exactly one of 50 concurrent callers should win');
        const docs = await collection.find({}).toArray();
        assert.strictEqual(docs.length, 1, 'no duplicate lock document under concurrency');
      }
    );

    // --- (b) cross-process race — the headline acceptance criterion -----

    test(
      '(b) cross-process race: two separate OS processes racing the same claim against real ' +
        'mongod — exactly one wins (this ticket\'s headline acceptance criterion; reuses ' +
        'LIN-1757\'s spawn recipe and mongo-smoke.test.js\'s real-Mongo CAS precedent rather ' +
        'than inventing new infrastructure)',
      async () => {
        const lockCollection = freshCollection('scheduler-locks');
        const winnersCollection = freshCollection('race-winners');
        await lockCollection.insertOne({ _id: 'tick:race', lockedUntil: 0 });

        const workerPath = fileURLToPath(new URL('../fixtures/scheduler-race-worker.mjs', import.meta.url));
        // Both processes sleep until this shared instant before racing, so
        // they contend within a few ms of each other rather than in
        // whatever order the OS happened to schedule their startup.
        const raceAtMs = Date.now() + 500;

        const spawnWorker = (workerId) =>
          spawn(process.execPath, [
            workerPath,
            mongoTestUri,
            db.databaseName,
            lockCollection.collectionName,
            winnersCollection.collectionName,
            workerId,
            String(raceAtMs)
          ]);

        const waitForExit = (child, label) =>
          new Promise((resolve, reject) => {
            let stderr = '';
            child.stderr.on('data', (chunk) => {
              stderr += chunk;
            });
            child.on('error', reject);
            child.on('exit', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`worker ${label} exited with code ${code}: ${stderr}`));
            });
          });

        // Fired back to back, NOT awaited between them — a serialized spawn
        // (awaiting one child's exit before starting the next) would prove
        // nothing, since even a non-atomic CAS trivially produces one winner
        // when the two attempts never overlap in time.
        const child1 = spawnWorker('w1');
        const child2 = spawnWorker('w2');
        await Promise.all([waitForExit(child1, 'w1'), waitForExit(child2, 'w2')]);

        const winners = await winnersCollection.find({}).toArray();
        assert.strictEqual(
          winners.length,
          1,
          'exactly one of the two racing OS processes should have executed run() against real MongoDB'
        );

        const lockDocs = await lockCollection.find({}).toArray();
        assert.strictEqual(lockDocs.length, 1, 'no duplicate lock document, even across two racing processes');
      }
    );
  }
);
