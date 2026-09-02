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
 * `a5a7728a`) — sweep liveness is a separate concern owned by LIN-2438.
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

// Derived, not chosen: DEFAULT_MAX_TOOL_ITERATIONS (4, openrouter.js:1352) x
// REQUEST_TIMEOUT_MS (120_000, openrouter.js:27) = 480_000 worst-case turn
// duration, plus headroom -> 600_000 (LIN-2442). This is the reservation
// lease's lifetime: how long a route's eager, pre-model-call `advance()`
// (routes/flight-companion.js) may hold `turnReservedUntil` before a turn
// that never reaches a terminal `done` frame self-expires and the next
// eligible turn re-surfaces the still-uncommitted delta.
export const RESERVATION_LEASE_MS = 600_000;

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
 * @returns {{spend: boolean, surface: boolean, reason: string, nextRecord: Object|null, reserveRecord?: Object}}
 */
export function shouldSpendTurn({ currentCensusDoc, companionDoc, now, floorMs = DEFAULT_COMPANION_FLOOR_MS, leaseMs = RESERVATION_LEASE_MS }) {
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
    return { spend: false, surface: false, reason: 'hash-identical', nextRecord: null };
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
      return { spend: false, surface: false, reason: 'no-delta', nextRecord: null };
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
      notes: companionDoc.notes || ''
    }
  };
}
