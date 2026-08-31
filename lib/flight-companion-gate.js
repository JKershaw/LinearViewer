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
// this module.
const LANE_KEYS = ['working', 'silent', 'blocked', 'terminal', 'queued', 'resolved', 'unknown'];

// A THIRD instance-key family alongside sweep:v1:/pass:v1: (lib/observer-pass.js:60-61).
// Duplicated rather than imported — see the file header.
export const COMPANION_INSTANCE_PREFIX = 'companion:v1:';

// 3x OBSERVER_SWEEP_INTERVAL_MS (server.js:597, 60_000), under
// OBSERVER_PASS_INTERVAL_MS (server.js:648, 15 * 60 * 1000). The
// hash-identical short-circuit already makes an unchanged census free, so
// the floor's only job is bounding the rate of genuine change.
export const DEFAULT_COMPANION_FLOOR_MS = 180_000;

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
 * census document. Pure. `attentionKeys` are identity tuples ONLY —
 * `since` is deliberately excluded, since it moves on any heartbeat and
 * would defeat every downstream identity comparison.
 *
 * @param {Object} currentCensusDoc - `observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s result (never `null` here — callers must check first).
 * @returns {{lanes: Object<string, number>, attentionKeys: Array<[string,string,string]>, attentionCount: number, truncated: boolean, censusRev: number}}
 */
export function buildCompanionSnapshot(currentCensusDoc) {
  const state = currentCensusDoc.state || {};
  const lanes = { ...state.lanes };
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
 * The deterministic pre-call gate (LIN-2431 §3-§4). Pure — no store calls,
 * no I/O, no clock reads. First-match-wins over six branches; every branch
 * other than `spend` returns `nextRecord: null` (structural, not caller
 * discipline — the write-nothing-on-false invariant the whole design rests
 * on). `surface` is always `false` whenever `spend` is `false`.
 *
 * Precedence, first match wins:
 *   1. no-census    — currentCensusDoc == null
 *   2. no-companion — companionDoc == null (F4: a backend-fault read, not
 *                     the seeded-null-fields seed state — a legitimately
 *                     never-seeded instance arrives as COMPANION_SEED_STATE
 *                     via the caller's ensureSeeded, never as a raw null)
 *   3. hash-identical — companionDoc.lastCensusStateHash === currentCensusDoc.stateHash
 *   4. floor        — companionDoc.lastTurnAt != null && now - lastTurnAt < floorMs
 *   5. no-delta     — hash differs but attentionKeys set is unchanged AND terminalDelta <= 0
 *   6. spend        — every prior check passed
 *
 * @param {Object} params
 * @param {Object|null} params.currentCensusDoc - `observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s result, or `null`.
 * @param {Object|null} params.companionDoc - the companion's own unwrapped record (this module's shape, e.g. `COMPANION_SEED_STATE`), or `null` on a backend-fault read.
 * @param {number|Date} params.now - injected clock; never read internally.
 * @param {number} [params.floorMs] - defaults to `DEFAULT_COMPANION_FLOOR_MS`.
 * @returns {{spend: boolean, surface: boolean, reason: string, nextRecord: Object|null}}
 */
export function shouldSpendTurn({ currentCensusDoc, companionDoc, now, floorMs = DEFAULT_COMPANION_FLOOR_MS }) {
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

  return {
    spend: true,
    surface,
    reason: 'spend',
    nextRecord: {
      v: 1,
      lastCensusStateHash: currentCensusDoc.stateHash,
      lastCensusSnapshot: currentSnapshot,
      lastTurnAt: new Date(nowMs).toISOString(),
      notes: companionDoc.notes || ''
    }
  };
}
