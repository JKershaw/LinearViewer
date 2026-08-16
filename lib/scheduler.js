/**
 * Leader-safe scheduler substrate (LIN-2128). Give Harbour a clock: a
 * recurring job runner that tolerates Railway running >1 instance without
 * double-firing a job's tick — a non-upsert CAS lease on one lock document
 * per named job, never a bare `setInterval`.
 *
 * Backend split: on real MongoDB, the CAS acquire is a genuine cross-process
 * exclusivity guarantee, proven server-side. On MangoDB (file-backed dev),
 * the package's concurrency primitive is an in-process mutex only — this
 * module never claims cross-process leader-safety there. The file backend's
 * actual safety net is LIN-2131's strict tick idempotency, a named external
 * dependency this module relies on and does not implement.
 *
 * Ownership boundary with a registered job: this module owns the timer, the
 * lease acquire/extend, and per-run error containment. A job supplies only
 * `run` — an async function taking no arguments, which may throw — and never
 * sees the lock document, the collection, or `now`.
 *
 * Lease shape: `findOneAndUpdate({_id, lockedUntil: {$lte: now}}, {$set:
 * {lockedUntil: now+leaseMs, owner}})`, non-upsert. `upsert: true` is never
 * used on this path — on MangoDB it inserts a second document sharing the
 * `_id` instead of losing the race (silent corruption); on real MongoDB it
 * turns a lost race into a thrown E11000. `owner` is unique per acquisition
 * attempt (a fresh UUID), not per instance, since it is load-bearing for the
 * extend-on-success guard below.
 *
 * A successful `run` extends the lease to `acquireTime + intervalMs`
 * (owner-guarded), rather than releasing it back to `now`. This is what
 * delivers "at most one execution per interval" — every other instance's
 * own, unsynchronized timer tick hits a `lockedUntil` still in the future
 * and loses the CAS — rather than merely "no two executions overlap", which
 * a release-on-success step would deliver instead. A thrown `run`, or a
 * crash mid-tick, writes nothing further: `lockedUntil` stays exactly where
 * the acquire wrote it (`acquireTime + leaseMs`) and self-heals there on the
 * next acquire attempt past that deadline. There is deliberately no separate
 * release-on-error write — an extra write on the failure path is one more
 * thing that can itself fail during shutdown.
 *
 * No TTL index, and no cleanup-loop registration: this lease shape holds
 * exactly one document per named job forever (acquisition only ever flips
 * `lockedUntil`/`owner` on the existing row), so there is nothing to evict.
 */
import { randomUUID } from 'crypto';

export class Scheduler {
  /**
   * @param {Object} options
   * @param {Object} options.collection - MongoDB/MangoDB collection holding one lock document per registered job.
   * @param {() => number} [options.now] - injected clock (epoch ms), for deterministic tests.
   * @param {Object} [options.logger=console] - logger with a `.warn` method. A throwing `run`, or a failed lease write, is logged here — never thrown, never left unhandled.
   */
  constructor(options = {}) {
    this.collection = options.collection;
    this.now = options.now || (() => Date.now());
    this.logger = options.logger || console;
    this.jobs = new Map();
    this.timers = new Map();
  }

  /**
   * Register a named recurring job and seed its lock document (insert-if-
   * absent — the seed write must never reset an already-held lease). Does
   * not arm the job's timer — call `start()` for that, once the process is
   * reachable.
   *
   * Seeding is an atomic upsert on the bare `{_id}` filter (`$setOnInsert`,
   * never touching an existing document's fields), not a bare `insertOne`
   * tolerating `err.code === 11000` — that shape relies on a uniquely
   * indexed `_id` to turn a duplicate seed into a thrown error, which
   * `scheduler-locks` deliberately has on neither backend. A bare `{_id}`
   * filter can't miss when the document exists, so this is safe despite the
   * CAS acquire's own ban on `upsert: true` (that ban is about a *compound*
   * filter there, which can miss and insert a duplicate — see `_tick`
   * below); precedent: `lib/workspace-store.js:61-65`. On MangoDB this
   * converges to exactly one document via the collection's own in-process
   * mutex serializing the read-modify-write cycle, not via a duplicate-key
   * throw. On real MongoDB the server's unique `_id` index does the same,
   * though a genuine concurrent-boot race (two instances registering the
   * same job at once) can still surface as a thrown E11000 on the losing
   * call — tolerated below, since it means a sibling boot already seeded
   * the row.
   *
   * @param {Object} job
   * @param {string} job.name - unique job name; the lock document's `_id` is `tick:<name>`.
   * @param {number} job.intervalMs - target period between successful runs; the once-per-interval guarantee this claims.
   * @param {number} job.leaseMs - bounds mid-tick self-preemption and crash-recovery exposure; size it comfortably under `intervalMs` and above the worst-case tick duration.
   * @param {() => Promise<void>} job.run - the job body. May throw; never receives the lock, the collection, or `now`.
   * @returns {Promise<void>}
   */
  async register({ name, intervalMs, leaseMs, run }) {
    if (!name) throw new Error('scheduler: register() requires a name');
    if (!intervalMs || intervalMs <= 0) {
      throw new Error(`scheduler: register("${name}") requires a positive intervalMs`);
    }
    if (!leaseMs || leaseMs <= 0) {
      throw new Error(`scheduler: register("${name}") requires a positive leaseMs`);
    }
    if (typeof run !== 'function') {
      throw new Error(`scheduler: register("${name}") requires a run function`);
    }
    if (this.jobs.has(name)) {
      throw new Error(`scheduler: job "${name}" is already registered`);
    }

    const lockId = `tick:${name}`;
    this.jobs.set(name, { name, intervalMs, leaseMs, run, lockId });

    try {
      await this.collection.updateOne(
        { _id: lockId },
        { $setOnInsert: { lockedUntil: 0 } },
        { upsert: true }
      );
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }

  /**
   * Arm every registered job's timer. Callers must wait until the process is
   * actually reachable (e.g. inside `app.listen`'s callback) before calling
   * this — arming earlier would let a tick begin acquiring and running
   * before a deploy host's readiness probe can pass. Idempotent per job: a
   * job whose timer is already armed is left alone.
   */
  start() {
    for (const job of this.jobs.values()) {
      if (this.timers.has(job.name)) continue;
      const timer = setInterval(() => {
        this._tick(job).catch((err) => {
          // _tick already catches every operational failure internally;
          // this is a last-resort net for a genuinely unexpected throw.
          this.logger.warn(`[scheduler] job "${job.name}" tick failed unexpectedly: ${err.message}`);
        });
      }, job.intervalMs);
      this.timers.set(job.name, timer);
    }
  }

  /**
   * Clear every armed timer. Does not, and cannot, cut off a tick already in
   * flight — that tick runs to completion on its own; its own `leaseMs` is
   * what bounds a stranded lease if its extend-on-success write never lands
   * (e.g. shutdown closes the DB client mid-write, which the tick's own
   * try/catch already absorbs rather than throwing unhandled).
   */
  stop() {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
  }

  async _tick(job) {
    const acquireTime = this.now();
    const owner = randomUUID();

    let acquired;
    try {
      acquired = await this.collection.findOneAndUpdate(
        { _id: job.lockId, lockedUntil: { $lte: acquireTime } },
        { $set: { lockedUntil: acquireTime + job.leaseMs, owner } },
        { returnDocument: 'after' }
      );
    } catch (err) {
      this.logger.warn(`[scheduler] job "${job.name}" acquire failed: ${err.message}`);
      return;
    }

    // A null return is a loss: either another instance currently holds the
    // lock (the ordinary case, every tick on every non-winning instance), or
    // the seed document is missing (should not happen once register() has
    // run — a caller bug, not an operational condition worth a query per
    // miss to distinguish).
    if (!acquired) return;

    try {
      await job.run();
      // Extend on success, owner-guarded: a harmless no-op if this holder's
      // own leaseMs already expired and another instance reclaimed the lock
      // first — it must never overwrite a newer holder's lease. Shares this
      // try/catch deliberately, not a separate one after it: a failure here
      // (e.g. the DB client already closed during shutdown) is caught and
      // logged exactly like a throwing `run`, self-healing on the `leaseMs`
      // bound rather than crashing the process or throwing unhandled.
      await this.collection.updateOne(
        { _id: job.lockId, owner },
        { $set: { lockedUntil: acquireTime + job.intervalMs } }
      );
    } catch (err) {
      this.logger.warn(`[scheduler] job "${job.name}" run failed: ${err.message}`);
    }
  }
}
