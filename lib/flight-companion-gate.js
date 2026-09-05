import { randomUUID } from 'node:crypto';

/**
 * lib/flight-companion-gate.js
 *
 * Flight Companion memory key + deterministic pre-call gate (LIN-2431,
 * Phase A §A.2 + §A.10). Owns the companion's OWN `ObserverStateStore`
 * instance key (`companion:v1:<urlKey>`, a THIRD family beside the existing
 * `sweep:v1:`/`pass:v1:` — `lib/observer-pass.js:60-61`) and the pure
 * function that decides whether an auto-wake turn may spend a model call.
 *
 * **Binding constraint (owned by the caller, LIN-2432, not this module):**
 * the gate must run BEFORE any model call on an auto-wake turn — on `false`
 * the caller returns a cheap "nothing to report" JSON response with no
 * model call, no SSE stream, no free-tier quota touched. This module has no
 * caller in scope: it delivers a pure function and a record shape only.
 *
 * `companion:v1:` reuses `ObserverStateStore`'s existing CAS `advance()`
 * contract — no new store, no new atomicity claim. This file duplicates the
 * instance-key constant rather than importing one from `lib/observer-pass.js`
 * (which mirrors `lib/observer-sweep.js`'s own key the same way, per the
 * drift-tripwire comment at `lib/observer-pass.js:56-59`) — the observer
 * pipeline's own convention is one file per pipeline stage, each restating
 * its own prefix rather than sharing a cross-module import.
 *
 * Pure by construction: zero imports, zero I/O, zero clock reads. `now` is
 * always an injected parameter (never `Date.now()` internally) — mirrors
 * `lib/observer-sweep.js:231-233`'s "absence throws loudly" discipline
 * rather than silently persisting a lie. `currentCensusDoc`/`companionDoc`
 * are consumed as plain data only, never imported from `observer-sweep.js`/
 * `observer-state-store.js`.
 *
 * **No census-staleness check.** The gate reads neither of the page's two
 * freshness stamps (`report.updatedAt`/`report.censusGroundedAt`) — both are
 * last-*changed*, not last-*seen*, and because a `false` gate result writes
 * nothing, a check built on either would permanently suppress the
 * unreported deltas on a quiet fleet the companion exists to surface. This
 * is a deliberate, named, unmitigated limitation (plan-review F1; operator
 * ruling `lin2431-freshness-criteria` = `accept_and_amend`, LIN-2431 comment
 * `a5a7728a`) — sweep liveness is a separate concern, owned by LIN-2438 and
 * implemented below as `withSweepLiveness`.
 *
 * **Sweep liveness (LIN-2438).** `currentCensusDoc.lastSeenAt` — the sweep's
 * own last-*seen* heartbeat, stamped once per completed tick by
 * `lib/observer-sweep.js` (after `advance()`, never on a throw or a lost
 * race) — is read ONLY to relabel a decision the seven-branch chain below has
 * ALREADY decided is `spend: false` for a "nothing to say" reason
 * (`hash-identical`/`no-delta`). It can never turn a `spend: true` into a
 * `spend: false`: the liveness check runs strictly after that decision, on
 * an object it does not feed back into. This is what preserves LIN-2431's F1
 * (plan-review finding, ratified by operator ruling `lin2431-freshness-
 * criteria`) — a real unreported delta is never suppressed, only ever mis-
 * labelled while genuinely absent. See `withSweepLiveness` below.
 *
 * `companionDoc` is the companion's OWN unwrapped record — this ticket's
 * own shape (`COMPANION_SEED_STATE`/the record shape below), the same shape
 * `nextRecord` returns — never the raw `ObserverStateStore` document
 * envelope. `currentCensusDoc` IS that raw envelope (the sweep's own stored
 * document, `{ state, stateHash, rev, ... }`), consumed the same way
 * `lib/observer-pass.js`'s `assessQuietPath` consumes its `censusDoc`
 * parameter.
 */

// The 7 census lanes, restated from lib/observer-sweep.js:32's LANE_KEYS —
// consumed as plain data (never imported), same discipline as the rest of
// this module. `buildCompanionSnapshot` PROJECTS through these keys rather
// than spreading `state.lanes` wholesale, so the persisted snapshot carries
// this module's own record shape (§2) rather than whatever the producer
// happens to emit: a producer-added key never reaches the record, and an
// absent one reads 0 rather than `undefined` — which would make
// `terminalDelta` NaN and silently defeat the `no-delta` fold, since
// `NaN <= 0` is false. The producer pre-initialises all 7 to 0 today
// (lib/observer-sweep.js:151), so this is drift insurance, not a behaviour
// change against a well-formed census.
const LANE_KEYS = ['working', 'silent', 'blocked', 'terminal', 'queued', 'resolved', 'unknown'];

// A THIRD instance-key family alongside sweep:v1:/pass:v1: (lib/observer-pass.js:60-61).
// Duplicated rather than imported — see the file header.
export const COMPANION_INSTANCE_PREFIX = 'companion:v1:';

// 3x OBSERVER_SWEEP_INTERVAL_MS (server.js:597, 60_000), under
// OBSERVER_PASS_INTERVAL_MS (server.js:648, 15 * 60 * 1000). The
// hash-identical short-circuit already makes an unchanged census free, so
// the floor's only job is bounding the rate of genuine change.
export const DEFAULT_COMPANION_FLOOR_MS = 180_000;

// Derived, not chosen — and the derivation LIN-2442 recorded here was WRONG
// (LIN-2447). It read DEFAULT_MAX_TOOL_ITERATIONS (4, openrouter.js) x
// REQUEST_TIMEOUT_MS (120_000, openrouter.js) = 480_000, "plus headroom ->
// 600_000". But `streamChatWithTools` runs up to 4 `runToolHop` calls, each
// bounded by its own REQUEST_TIMEOUT_MS, and then ALWAYS falls through to a
// final `streamChat` ("Final answer ALWAYS streams") — a 5th timeout. The real
// worst case for the model calls alone is therefore
// (DEFAULT_MAX_TOOL_ITERATIONS + 1) x REQUEST_TIMEOUT_MS = 600_000, which was
// EXACTLY the old lease: the documented headroom did not exist.
//
// 900_000 restores it — 1.5x the 600_000 model-call worst case. Pinned against
// openrouter.js's own live constants by tests/unit/flight-companion-gate.test.js,
// so raising either of them fails loudly here instead of silently eating the
// headroom again.
//
// State plainly what this bound is NOT: per-hop `executeTool` time is bounded
// by nothing at all (openrouter.js `await executeTool(...)` is unguarded), so
// a turn CAN still outlive any finite lease. That is why the lease is not the
// protection against a late commit — the reservation-scoped CAS in
// routes/flight-companion.js is (LIN-2447 item 2). The lease's job is to make
// outliving it rare; the CAS's job is to make it harmless.
export const RESERVATION_LEASE_MS = 900_000;

// 30x OBSERVER_SWEEP_INTERVAL_MS (server.js:597, 60_000). The sweep visits
// ONE round-robin workspace per tick (lib/observer-sweep.js's
// createObserverSweepRun), so a workspace's own visit period is
// 60s x |roster| — this bounds |roster| <= 15 with 2x headroom, and absorbs
// a process restart (a surviving scheduler lease delays the first post-boot
// tick by at most one interval) and a skipped tick. This is a BOUND, not an
// exact derivation — |roster| is invisible at the gate. That imprecision is
// acceptable only because of where this constant is used: withSweepLiveness
// can only relabel an already-spend:false decision (LIN-2438), so a horizon
// set too tight mislabels a tick that was already silent (noise,
// self-clearing on the next sweep visit) and a horizon set too loose merely
// delays detection — neither is a correctness failure.
export const DEFAULT_SWEEP_LIVENESS_HORIZON_MS = 1_800_000; // 30 min

/**
 * The never-turned seed record. Defined here, not written by this ticket —
 * the caller (LIN-2432) is responsible for `ensureSeeded(instanceKey,
 * COMPANION_SEED_STATE)` before its first `shouldSpendTurn` call for a
 * given `urlKey`.
 */
export const COMPANION_SEED_STATE = Object.freeze({
  v: 1,
  lastCensusStateHash: null,
  lastCensusSnapshot: null,
  lastTurnAt: null,
  turnReservedUntil: null,
  notes: ''
});

/**
 * Normalize an injected clock value (epoch ms, a `Date`, or an ISO string)
 * to epoch ms. Not exported — an internal helper only.
 *
 * @param {number|Date|string} value
 * @returns {number} epoch ms, or `NaN` if `value` cannot be resolved
 */
function toEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return new Date(value).getTime();
  return NaN;
}

/**
 * Two `attentionKeys` arrays are compared as SETS of identity tuples, never
 * position-by-position — "the set of tuples differs" (§4) is the plan's own
 * wording, and set comparison is the only reading of it that doesn't
 * silently assume a stable sort order across two unrelated census ticks.
 *
 * @param {Array<[string,string,string]>} a
 * @param {Array<[string,string,string]>} b
 * @returns {boolean}
 */
function attentionKeySetsEqual(a, b) {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((tuple) => JSON.stringify(tuple)));
  return b.every((tuple) => setA.has(JSON.stringify(tuple)));
}

/**
 * LIN-2438: relabel an ALREADY-`spend: false` "nothing to say" decision to
 * `reason: 'sweep-not-seen'` when the sweep's own last-*seen* heartbeat
 * (`censusDoc.lastSeenAt`) is older than `horizonMs`. Structurally incapable
 * of changing `spend`, `surface` or `nextRecord` — it only ever rewrites
 * `reason` and adds a diagnostic `sweepLastSeenAt` stamp on the object it is
 * handed, never called on the `spend: true` path. Not exported: an internal
 * helper called only from the two `shouldSpendTurn` return sites below.
 *
 * @param {{spend: boolean, surface: boolean, reason: string, nextRecord: null}} decision - an already-decided spend:false outcome
 * @param {Object} censusDoc - the raw sweep census document (`currentCensusDoc`)
 * @param {number} nowMs - injected clock, already normalized
 * @param {number} horizonMs
 * @returns {typeof decision | {spend: false, surface: false, reason: 'sweep-not-seen', sweepLastSeenAt: string, nextRecord: null}}
 */
function withSweepLiveness(decision, censusDoc, nowMs, horizonMs) {
  const seenMs = toEpochMs(censusDoc.lastSeenAt);
  if (!Number.isFinite(seenMs)) return decision; // no stamp -> say nothing new (fixture-inert, fail-safe)
  if (nowMs - seenMs < horizonMs) return decision; // quiet fleet, producer alive
  return { ...decision, reason: 'sweep-not-seen', sweepLastSeenAt: new Date(seenMs).toISOString() };
}

/**
 * Build the deterministic companion snapshot from the sweep's own stored
 * census document. Pure. `lanes` is projected through `LANE_KEYS` — exactly
 * the 7 lanes of §2's record shape, each defaulting to 0 — never a wholesale
 * copy of the producer's object. `attentionKeys` are identity tuples ONLY —
 * `since` is deliberately excluded, since it moves on any heartbeat and
 * would defeat every downstream identity comparison.
 *
 * @param {Object} currentCensusDoc - `observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s result (never `null` here — callers must check first).
 * @returns {{lanes: Object<string, number>, attentionKeys: Array<[string,string,string]>, attentionCount: number, truncated: boolean, censusRev: number}}
 */
export function buildCompanionSnapshot(currentCensusDoc) {
  const state = currentCensusDoc.state || {};
  const rawLanes = state.lanes || {};
  const lanes = Object.fromEntries(
    LANE_KEYS.map((key) => [key, Number.isFinite(rawLanes[key]) ? rawLanes[key] : 0])
  );
  const attention = Array.isArray(state.attention) ? state.attention : [];
  const attentionKeys = attention.map((row) => [row.loopId, row.lane, row.stage]);

  return {
    lanes,
    attentionKeys,
    attentionCount: attentionKeys.length,
    truncated: !!state.truncated,
    censusRev: currentCensusDoc.rev
  };
}

/**
 * The deterministic pre-call gate (LIN-2431 §3-§4, LIN-2442 §reserve/commit).
 * Pure — no store calls, no I/O, no clock reads. First-match-wins over seven
 * branches; every branch other than `spend` returns `nextRecord: null`
 * (structural, not caller discipline — the write-nothing-on-false invariant
 * the whole design rests on). `surface` is always `false` whenever `spend`
 * is `false`.
 *
 * Precedence, first match wins:
 *   1. no-census     — currentCensusDoc == null
 *   2. no-companion  — companionDoc == null (F4: a backend-fault read, not
 *                      the seeded-null-fields seed state — a legitimately
 *                      never-seeded instance arrives as COMPANION_SEED_STATE
 *                      via the caller's ensureSeeded, never as a raw null)
 *   3. turn-in-flight — companionDoc.turnReservedUntil != null && now < turnReservedUntil
 *                      (LIN-2442). Checked ABOVE hash-identical and floor: a
 *                      live reservation must block regardless of whether the
 *                      census has since changed (hash-identical would also
 *                      catch an unchanged census, but not one that changed
 *                      WHILE the reservation is still outstanding) or of how
 *                      long ago `lastTurnAt` was stamped (the 180s floor is
 *                      far shorter than the up-to-600s reservation lease, so
 *                      a slow in-flight turn must stay blocked past the
 *                      floor's own window).
 *   4. hash-identical — companionDoc.lastCensusStateHash === currentCensusDoc.stateHash
 *   5. floor         — companionDoc.lastTurnAt != null && now - lastTurnAt < floorMs
 *   6. no-delta      — hash differs but attentionKeys set is unchanged AND terminalDelta <= 0
 *   7. spend         — every prior check passed
 *
 * LIN-2438: branches 4 and 6 are each passed through `withSweepLiveness`
 * before returning, which MAY relabel `reason` to `'sweep-not-seen'` (and add
 * `sweepLastSeenAt`) when `currentCensusDoc.lastSeenAt` is older than
 * `sweepHorizonMs` — never touching `spend`/`surface`/`nextRecord`, and never
 * consulted on any other branch. See `withSweepLiveness`'s own docblock.
 *
 * On `spend`, the caller receives TWO records (LIN-2442's reserve/commit
 * split), not one: `reserveRecord` re-emits the PRIOR baseline unchanged
 * with a fresh `lastTurnAt` and a new `turnReservedUntil` lease deadline —
 * this is what the caller's eager, pre-model-call `advance()` must write, so
 * a turn that never reaches a terminal frame leaves the census baseline
 * untouched and self-expires. `nextRecord` is the commit record (unchanged
 * from before this ticket, plus `turnReservedUntil: null`) — the caller
 * writes this only after a terminal `done` frame.
 *
 * @param {Object} params
 * @param {Object|null} params.currentCensusDoc - `observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s result, or `null`.
 * @param {Object|null} params.companionDoc - the companion's own unwrapped record (this module's shape, e.g. `COMPANION_SEED_STATE`), or `null` on a backend-fault read.
 * @param {number|Date} params.now - injected clock; never read internally.
 * @param {number} [params.floorMs] - defaults to `DEFAULT_COMPANION_FLOOR_MS`.
 * @param {number} [params.leaseMs] - defaults to `RESERVATION_LEASE_MS`.
 * @param {number} [params.sweepHorizonMs] - defaults to `DEFAULT_SWEEP_LIVENESS_HORIZON_MS` (LIN-2438).
 * @returns {{spend: boolean, surface: boolean, reason: string, nextRecord: Object|null, reserveRecord?: Object, sweepLastSeenAt?: string}}
 */
export function shouldSpendTurn({
  currentCensusDoc,
  companionDoc,
  now,
  floorMs = DEFAULT_COMPANION_FLOOR_MS,
  leaseMs = RESERVATION_LEASE_MS,
  sweepHorizonMs = DEFAULT_SWEEP_LIVENESS_HORIZON_MS,
  reservationId = randomUUID()
}) {
  const nowMs = toEpochMs(now);
  if (!Number.isFinite(nowMs)) {
    throw new Error('flight-companion-gate: now (epoch ms or Date) is required');
  }

  if (currentCensusDoc == null) {
    return { spend: false, surface: false, reason: 'no-census', nextRecord: null };
  }

  if (companionDoc == null) {
    return { spend: false, surface: false, reason: 'no-companion', nextRecord: null };
  }

  if (companionDoc.turnReservedUntil != null && nowMs < toEpochMs(companionDoc.turnReservedUntil)) {
    return { spend: false, surface: false, reason: 'turn-in-flight', nextRecord: null };
  }

  if (companionDoc.lastCensusStateHash === currentCensusDoc.stateHash) {
    return withSweepLiveness({ spend: false, surface: false, reason: 'hash-identical', nextRecord: null }, currentCensusDoc, nowMs, sweepHorizonMs);
  }

  if (companionDoc.lastTurnAt != null && nowMs - toEpochMs(companionDoc.lastTurnAt) < floorMs) {
    return { spend: false, surface: false, reason: 'floor', nextRecord: null };
  }

  const currentSnapshot = buildCompanionSnapshot(currentCensusDoc);
  const priorSnapshot = companionDoc.lastCensusSnapshot;

  let surface;
  if (priorSnapshot == null) {
    // Seed turn: no baseline to diff against. An absent baseline is not
    // evidence of "nothing changed" — always spend, but surface only if
    // there's something worth telling the user about right now.
    surface = currentSnapshot.attentionCount > 0;
  } else {
    const attentionSetChanged = !attentionKeySetsEqual(currentSnapshot.attentionKeys, priorSnapshot.attentionKeys);
    // A negative terminal delta (a loop's terminal record aging out of the
    // 30-day rolling window, lib/pipeline-loops.js:32) is bookkeeping
    // noise, not a world change — folded into "nothing reportable", never
    // treated as spend-worthy.
    const terminalDelta = currentSnapshot.lanes.terminal - priorSnapshot.lanes.terminal;
    if (!attentionSetChanged && terminalDelta <= 0) {
      return withSweepLiveness({ spend: false, surface: false, reason: 'no-delta', nextRecord: null }, currentCensusDoc, nowMs, sweepHorizonMs);
    }
    surface = true;
  }

  const stampedNow = new Date(nowMs).toISOString();

  return {
    spend: true,
    surface,
    reason: 'spend',
    // The commit record — the caller writes this only after a terminal
    // `done` frame lands (LIN-2442). Carries the NEW baseline, same as
    // before this ticket, with the reservation cleared.
    nextRecord: {
      v: 1,
      lastCensusStateHash: currentCensusDoc.stateHash,
      lastCensusSnapshot: currentSnapshot,
      lastTurnAt: stampedNow,
      turnReservedUntil: null,
      reservationId: null,
      notes: companionDoc.notes || ''
    },
    // The reservation record — the caller's eager, pre-model-call
    // `advance()` writes THIS instead (LIN-2442), re-emitting the PRIOR
    // baseline unchanged so a turn that dies before committing never
    // consumes the delta it was reserving against.
    reserveRecord: {
      v: 1,
      lastCensusStateHash: companionDoc.lastCensusStateHash,
      lastCensusSnapshot: companionDoc.lastCensusSnapshot,
      lastTurnAt: stampedNow,
      turnReservedUntil: new Date(nowMs + leaseMs).toISOString(),
      // LIN-2447 items 2 and 3. Two purposes, one field:
      //
      // (2) It is what the caller's commit CAS matches on, so a turn that
      //     outlived its lease cannot clear a SUCCESSOR's live reservation or
      //     write its own stale baseline over the successor's. `turnReservedUntil`
      //     alone cannot do that job — see (3).
      //
      // (3) It makes two same-millisecond reservations distinguishable. Without
      //     it, two auto-wake turns evaluating the gate in the same millisecond
      //     build BYTE-IDENTICAL reserve records (same stampedNow, same
      //     re-emitted prior baseline, same lease deadline), which hash
      //     identically into `advance()`'s duplicate-identical-state branch —
      //     so it returned `true` to BOTH callers and both proceeded to a
      //     billable model call, defeating LIN-2435's double-spend guard at the
      //     tail. Distinct records mean one wins the CAS and the other loses.
      //
      // Injectable purely so tests stay deterministic, exactly like `now`.
      reservationId,
      notes: companionDoc.notes || ''
    }
  };
}
