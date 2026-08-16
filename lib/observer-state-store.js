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
 *   rev:        number,       // CAS witness, starts at 1. Monotonic only
 *                              // *within a generation* — see "Generations and
 *                              // rev" below; it is not a durable per-instance
 *                              // identity across an eviction/re-seed boundary
 *   state:      *,            // the sweep's diagnosis payload (P1-3's shape).
 *                              // This store's persistence is agnostic to its
 *                              // shape, but the dedup hash below is not — see
 *                              // "Hashing non-plain values" for the guard
 *   stateHash:  string,       // sha256 over a key-sorted stringify of a
 *                              // canonicalized `state` (see hashState below),
 *                              // used to fold duplicate-tick dedup into the
 *                              // same CAS filter as the version check
 *   ledger:     Array,        // bounded transition history, newest last,
 *                              // capped at LEDGER_CAP entries ($slice on write)
 *   createdAt:  Date,         // when this generation's document was created
 *   updatedAt:  Date,         // last-*changed* stamp — moves only on a genuine
 *                              // advance() transition, never on a duplicate
 *                              // no-op tick or a plain ensureSeeded refresh
 *   lastSeenAt: Date          // last-*seen* stamp — refreshed by ensureSeeded
 *                              // on every call, whether or not the diagnosis
 *                              // changed. This, not updatedAt, is what
 *                              // cleanup() and INDEX_SPECS key liveness on
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
 *   `deleteMany({ lastSeenAt: { $lt: cutoff } })`, `RETENTION_IDLE_MS` old.
 *   Keyed on `lastSeenAt`, not `updatedAt` — see "Liveness vs. change" below;
 *   an actively-swept instance whose diagnosis is simply stable must never be
 *   evicted out from under it. Since exactly one document exists per active
 *   instance (not many-per-key like every capped precedent), this is a
 *   dead-instance eviction, not a keep-newest-N prune. Wired into the hourly
 *   `server.js` cleanup loop by a hand-added block (beat 3) — that loop is
 *   seven hand-written try/catch blocks, not a registry, so a store is only
 *   swept if a block names it.
 * - No TTL index anywhere in this design, per the house rule at
 *   `lib/db-indexes.js:11-15` (MangoDB has no TTL daemon; the hourly loop
 *   stays the sole, authoritative evictor).
 *
 * ## Liveness vs. change — `lastSeenAt` vs `updatedAt` (LIN-2129 review, F1)
 *
 * `updatedAt` is a last-*changed* stamp: nothing refreshes it except a
 * genuine `advance()` transition, so a duplicate-state tick (the store's own
 * designed steady state — see the CAS mechanism above) never touches it. A
 * `cleanup()` keyed on `updatedAt` would therefore delete a live instance
 * whose diagnosis simply hasn't changed in `RETENTION_IDLE_MS` — exactly the
 * quiet-workspace case this store exists to survive. `lastSeenAt` is the
 * separate liveness signal: `ensureSeeded()` refreshes it on *every* call,
 * whether or not the document already existed, and the sweep is expected to
 * call `ensureSeeded()` every tick regardless of whether the diagnosis
 * changed (see `ensureSeeded`'s own doc comment). `cleanup()` and the
 * `INDEX_SPECS` entry both key on `lastSeenAt` for this reason, leaving
 * `updatedAt` free to keep meaning "last changed", which is what a reader of
 * a versioned document expects it to mean. (The two-shape alternative —
 * having the duplicate-no-op branch of `advance()` bump `updatedAt` itself —
 * was rejected: it would blur "changed" and "seen" back into one field,
 * reopening this same ambiguity for the next reader.)
 *
 * ## Generations and `rev` — monotonic within a generation only (LIN-2129
 * review, F5)
 *
 * `rev` is **not** a durable, ever-increasing identity for an instance across
 * its whole lifetime. It is monotonic only *within one generation* — the
 * span between an `ensureSeeded()` that creates a document and a `cleanup()`
 * that deletes it. A `cleanup()` eviction followed by a later `ensureSeeded()`
 * re-seed starts a brand-new document, a brand-new generation, at `rev: 1`
 * again, with an empty ledger and a fresh `createdAt` — this is correct, not
 * a bug: a genuinely decommissioned instance re-appearing is meant to look
 * like a fresh start, not a continuation of history that no longer exists.
 * The residual: a CAS witness read before an eviction and replayed after the
 * re-seed can, in principle, find `rev` equal to its stale witness again in
 * the new generation and win a CAS against it — this is real but is now only
 * reachable for a **genuinely decommissioned** instance (idle past
 * `RETENTION_IDLE_MS` on `lastSeenAt`, i.e. actually evicted), never for a
 * live one, because F1's `lastSeenAt` refresh keeps every live instance out
 * of `cleanup()`'s reach in the first place. A consumer that needs a revision
 * identity stable across a possible re-seed (e.g. deriving a duration from
 * `rev` deltas) must additionally compare `createdAt` — two reads with the
 * same `createdAt` are the same generation; a changed `createdAt` means `rev`
 * restarted.
 *
 * ## Hashing non-plain values (LIN-2129 review, F2)
 *
 * `stableStringify` (`lib/recap-cache.js`) walks an object via `Object.keys`,
 * which is `[]` for a `Date` (and effectively so for a `Map`/`Set`, whose
 * entries aren't own-enumerable properties) — so a `Date`-only state change
 * would otherwise hash identically to its predecessor and get silently
 * classified a duplicate by the CAS filter's `stateHash: { $ne: nextHash }`
 * gate, writing nothing. `hashState()` below guards against this with a
 * local `canonicalizeForHash()` pre-pass — applied only to the hash input,
 * never to the stored `state` itself — that gives `Date`/`Map`/`Set` a real,
 * order-independent representation, and gives any other non-plain object
 * (a class instance with non-enumerable internal state) a fallback
 * representation combining its constructor name, its own enumerable
 * properties, and its `String()` coercion, so it is very unlikely to collapse
 * to the same blind `{}` two different instances would otherwise share. This
 * is a guard, not a proof of uniqueness for arbitrary exotic objects — a
 * docblock note alone was rejected because it leaves the classification
 * silently wrong for the exact payload shapes named above; P1-3's payload
 * contract should still prefer plain JSON-safe values where practical.
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

// Guards hashState() against stableStringify's blind spot: Object.keys() is
// `[]` for a Date (and gives only incidental own properties, never entries,
// for a Map/Set), so those types would otherwise collapse to `{}` and make a
// real state change look like a duplicate. See the module header's "Hashing
// non-plain values" section. Applied only to the hash input — never mutates
// or replaces the stored `state` itself.
function canonicalizeForHash(value) {
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Date) {
    return { __type: 'Date', __value: value.toISOString() };
  }
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) => [canonicalizeForHash(k), canonicalizeForHash(v)]);
    entries.sort((a, b) => stableStringify(a[0]).localeCompare(stableStringify(b[0])));
    return { __type: 'Map', __value: entries };
  }
  if (value instanceof Set) {
    const values = [...value.values()].map((v) => canonicalizeForHash(v));
    values.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
    return { __type: 'Set', __value: values };
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonicalizeForHash(v));
  }

  const proto = Object.getPrototypeOf(value);
  const own = {};
  for (const k of Object.keys(value)) own[k] = canonicalizeForHash(value[k]);

  if (proto !== Object.prototype && proto !== null) {
    // A class instance (or other exotic object) may keep its real state
    // outside own-enumerable properties (getters, private fields, internal
    // slots) — the general case of the Date/Map/Set blind spot. Fold in the
    // constructor name and a String() coercion alongside whatever IS
    // enumerable, so two differently-stated instances of the same shape are
    // very unlikely to collapse onto the same hash the way `new Date()`
    // silently did.
    return { __type: value.constructor?.name || 'Object', __own: own, __str: String(value) };
  }
  return own;
}

function hashState(state) {
  return crypto.createHash('sha256').update(stableStringify(canonicalizeForHash(state))).digest('hex');
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
   * Also the liveness refresh (LIN-2129 review, F1): every call — insert or
   * no-op alike — stamps `lastSeenAt`, which is what `cleanup()` keys on. The
   * sweep calling this every tick is what keeps a live, diagnosis-unchanged
   * instance out of retention's reach; see the module header's "Liveness vs.
   * change" section.
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
          $set: { lastSeenAt: now },
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
   * Evicts decommissioned instances: any document not seen past
   * `RETENTION_IDLE_MS`. Keyed on `lastSeenAt`, not `updatedAt` (LIN-2129
   * review, F1) — `updatedAt` only moves on a genuine transition, so keying
   * eviction on it would delete a live instance whose diagnosis is simply
   * stable. `ensureSeeded()` refreshing `lastSeenAt` every tick is what keeps
   * a live instance out of this sweep's reach; see the module header.
   * Swallow-and-neutral posture (`catch` → `0`) so a cleanup failure never
   * fails an otherwise-good state write.
   *
   * @returns {Promise<number>} count of removed documents
   */
  async cleanup() {
    try {
      const cutoff = new Date(Date.now() - RETENTION_IDLE_MS);
      const result = await this.collection.deleteMany({ lastSeenAt: { $lt: cutoff } });
      return result.deletedCount || 0;
    } catch (err) {
      console.error('Observer state cleanup error:', err);
      return 0;
    }
  }
}
