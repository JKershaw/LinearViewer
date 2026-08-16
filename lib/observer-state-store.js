/**
 * Durable observer-instance state store (LIN-2129, P1-2 of the LIN-2114
 * observer-harness epic). One current state document per observer instance,
 * versioned per sweep — never an accumulating transcript. The sweep (P1-3)
 * seeds an instance once, then advances it on every tick via a monotonic-`rev`
 * compare-and-set, so two concurrent sweeps for the same instance can never
 * silently clobber each other's diagnosis.
 *
 * Schema — one doc per observer instance:
 * {
 *   _id:        instanceKey,  // deterministic per-instance key; a second doc
 *                              // for the same instance is unrepresentable —
 *                              // every write path keys off this alone
 *   rev:        number,       // monotonic CAS witness, starts at 1
 *   state:      *,            // the sweep's diagnosis payload (P1-3's shape;
 *                              // this store is agnostic to its contents)
 *   stateHash:  string,       // sha256 over a key-sorted stringify of `state`,
 *                              // used to fold duplicate-tick dedup into the
 *                              // same CAS filter as the version check
 *   ledger:     Array,        // bounded transition history, newest last,
 *                              // capped at LEDGER_CAP entries ($slice on write)
 *   createdAt:  Date,
 *   updatedAt:  Date
 * }
 *
 * ## CAS mechanism (the `lib/owner-credential-store.js` `putIfRefreshToken`
 * shape, house idiom per LIN-1343/1357/1546/1698)
 *
 * `advance()` is a single conditional `updateOne(filter-including-the-CAS-
 * field, $set)`, gated on `matchedCount === 1` — no upsert, no read-modify-
 * write. Those two shapes reproduce LIN-1343's failure mode: 20 concurrent
 * `addFeedback` calls stored 1 result while every caller received
 * `{success: true}`, a silent-corruption bug with no error signal. An
 * unconditional upsert (last-writer-wins) and a JS-side read-then-write
 * "did it change" check are both rejected for the same reason — the write
 * itself stays unconditional either way.
 *
 * The witness is the monotonic `rev`, per the swap `putIfRefreshToken`'s own
 * docblock sanctions when value-equality on the CAS field isn't available.
 * Payload, hash, and timestamp move in the *same* `$set` as the version bump
 * (LIN-1698) — no follow-up write ever "finishes" the record. The dedup gate
 * (`stateHash: { $ne: nextHash }`) rides in the *same* filter as the version
 * check, so one atomic op performs both the CAS and the duplicate-tick no-op
 * — never a separate read-then-decide step, which would reopen the LIN-1343
 * shape.
 *
 * ## Never-throw result contract for `advance()`
 *
 * - Bad argument → synchronous `false`, before touching the DB.
 * - Lost race / stale witness / instance never seeded → `false`. These three
 *   collapse to one signal because the correct caller action is identical in
 *   all three: re-read via {@link ObserverStateStore#readCurrent}, then seed
 *   (if absent) or retry with the fresh `rev` (if someone else advanced).
 * - Duplicate/identical-state write → `true`, a no-op (no `rev` bump, no
 *   ledger entry) — nothing was lost or raced, so it is not a `false`.
 * - Backend error (thrown exception) → caught, logged, `null`. This is NOT
 *   safe to re-read-and-converge the way `false` is — it means the store
 *   itself may be unhealthy, so a caller should log/skip the tick rather than
 *   spin. `false` = re-read-and-converge; `null` = backend problem, don't spin.
 *
 * ## Retention — both halves (no existing store combines them; see LIN-2129's
 * research: `report-history`/`task-snapshot` cap inline with no `cleanup()`,
 * `llm-call-log`/`prompt-trace-store.js` ship a `cleanup()` nothing calls)
 *
 * - Inline cap on the write path: the ledger is capped at `LEDGER_CAP`
 *   entries via the same `$push`'s `$slice`, so a single instance's document
 *   cannot grow unbounded across its lifetime.
 * - `cleanup()`: an age-based sweep of decommissioned instances —
 *   `deleteMany({ updatedAt: { $lt: cutoff } })`, `RETENTION_IDLE_MS` old.
 *   Since exactly one document exists per active instance (not many-per-key
 *   like every capped precedent), this is a dead-instance eviction, not a
 *   keep-newest-N prune. Wired into the hourly `server.js` cleanup loop by a
 *   hand-added block (beat 3) — that loop is seven hand-written try/catch
 *   blocks, not a registry, so a store is only swept if a block names it.
 * - No TTL index anywhere in this design, per the house rule at
 *   `lib/db-indexes.js:11-15` (MangoDB has no TTL daemon; the hourly loop
 *   stays the sole, authoritative evictor).
 *
 * ## Dual-backend limits, stated honestly
 *
 * On real MongoDB the CAS is atomic across concurrent OS processes. On the
 * MangoDB file backend it is atomic only *within one Node process* (the
 * per-collection in-process mutex) — this store's CAS makes a double-fire
 * *survivable* (one side loses cleanly), it does not make double-firing
 * *impossible* across processes; that guarantee is LIN-2128's to make, not
 * this store's.
 */

import crypto from 'crypto';
import { stableStringify } from './recap-cache.js';

// Bounded transition history per instance. Duplicate ticks never consume a
// slot (the hash gate filters them out before the $push), so this covers
// LEDGER_CAP genuine diagnosis transitions regardless of tick cadence.
export const LEDGER_CAP = 50;

// cleanup() eviction window for decommissioned instances.
export const RETENTION_IDLE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashState(state) {
  return crypto.createHash('sha256').update(stableStringify(state)).digest('hex');
}

/**
 * Durable observer-instance state store. Mirrors `lib/owner-credential-store.js`
 * conventions: class + `constructor({collection})`, never-throw writes with a
 * distinguishable false/null, swallow-and-neutral reads.
 */
export class ObserverStateStore {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.collection - MongoDB/MangoDB collection ('observer-state')
   */
  constructor(options = {}) {
    this.collection = options.collection;
  }

  /**
   * Establishes the first document for an observer instance, idempotently.
   * `$setOnInsert` only ever applies on document creation, so concurrent seed
   * calls for a not-yet-existing instance race safely to exactly one winner —
   * the second racer's upsert sees `matchedCount === 1` and takes the plain-
   * update (no-op) branch. This is not the same risk class as an unconditional
   * upsert on the advance path: it establishes a document once and never
   * overwrites an existing one's fields.
   *
   * `advance()` never upserts — every instance must pass through this method
   * first (safe to call every tick). A tick against a never-seeded instance
   * gets a clean `false` from `advance()`, not a silent create.
   *
   * @param {string} instanceKey - deterministic per-instance identity
   * @param {*} initialState - the seed payload
   * @returns {Promise<Object|null>} the current document, or null on a bad
   *   argument or backend error
   */
  async ensureSeeded(instanceKey, initialState) {
    if (!instanceKey || initialState === undefined) return null;

    try {
      const now = new Date();
      await this.collection.updateOne(
        { _id: instanceKey },
        {
          $setOnInsert: {
            _id: instanceKey,
            rev: 1,
            state: initialState,
            stateHash: hashState(initialState),
            ledger: [],
            createdAt: now,
            updatedAt: now
          }
        },
        { upsert: true }
      );
      return await this.readCurrent(instanceKey);
    } catch (err) {
      console.error('Error seeding observer state:', err);
      return null;
    }
  }

  /**
   * Reads an observer instance's current state document. Swallow-and-neutral
   * posture, matching every read in the codebase: `null` on both "not found"
   * and "backend error" — a read has no distinguishable-failure obligation
   * the way a write does.
   *
   * @param {string} instanceKey
   * @returns {Promise<Object|null>}
   */
  async readCurrent(instanceKey) {
    if (!instanceKey) return null;

    try {
      const doc = await this.collection.findOne({ _id: instanceKey });
      return doc || null;
    } catch (err) {
      console.error('Error reading observer state:', err);
      return null;
    }
  }

  /**
   * Compare-and-set advance: writes `nextState` only if the stored document's
   * `rev` still equals `expectedRev` — the value a sweep read before deciding
   * what to write. See the module header for the full never-throw contract.
   *
   * @param {string} instanceKey
   * @param {number} expectedRev - the CAS witness, the `rev` the caller last observed
   * @param {*} nextState - the full state payload to write on a CAS win
   * @param {Object} [transitionMeta] - optional extra fields folded into this
   *   transition's ledger entry (e.g. a reason/source tag). Never allowed to
   *   override the entry's own `rev`/`at` control fields.
   * @returns {Promise<boolean|null>} true (advanced or a duplicate-state
   *   no-op), false (lost race, stale witness, or never-seeded instance), or
   *   null (backend error — do not treat as safe to re-read and converge)
   */
  async advance(instanceKey, expectedRev, nextState, transitionMeta = null) {
    if (!instanceKey || !Number.isInteger(expectedRev) || nextState === undefined) return false;

    try {
      const now = new Date();
      const nextHash = hashState(nextState);
      const meta = (transitionMeta && typeof transitionMeta === 'object') ? transitionMeta : {};

      const { matchedCount } = await this.collection.updateOne(
        { _id: instanceKey, rev: expectedRev, stateHash: { $ne: nextHash } },
        {
          $set: { state: nextState, stateHash: nextHash, rev: expectedRev + 1, updatedAt: now },
          $push: {
            ledger: {
              $each: [{ ...meta, rev: expectedRev + 1, at: now }],
              $slice: -LEDGER_CAP
            }
          }
        }
      );
      if (matchedCount === 1) return true;

      // matchedCount === 0 collapses two distinct causes: a lost race/stale
      // witness/missing instance, OR a duplicate identical-state write at the
      // current rev (the filter's own $ne gate excluded it from matching).
      // Disambiguate with a read, never a second write, so the CAS above
      // stays the sole write path.
      const current = await this.collection.findOne({ _id: instanceKey });
      if (current && current.rev === expectedRev && current.stateHash === nextHash) {
        return true; // duplicate/identical-state no-op
      }
      return false;
    } catch (err) {
      console.error('Error in observer state compare-and-set:', err);
      return null;
    }
  }

  /**
   * Evicts decommissioned instances: any document idle past
   * `RETENTION_IDLE_MS`. Swallow-and-neutral posture (`catch` → `0`) so a
   * cleanup failure never fails an otherwise-good state write.
   *
   * @returns {Promise<number>} count of removed documents
   */
  async cleanup() {
    try {
      const cutoff = new Date(Date.now() - RETENTION_IDLE_MS);
      const result = await this.collection.deleteMany({ updatedAt: { $lt: cutoff } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Observer state cleanup error:', err);
      return 0;
    }
  }
}
