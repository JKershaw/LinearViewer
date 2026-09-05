/**
 * Unit tests for lib/flight-companion-gate.js (LIN-2431, Flight Companion
 * A.2/A.10).
 *
 * Run with: node --test tests/unit/flight-companion-gate.test.js
 *
 * Coverage, per the Implementation Plan §5:
 *   - buildCompanionSnapshot: the deterministic snapshot builder.
 *   - shouldSpendTurn's six-branch precedence (no-census, no-companion,
 *     hash-identical, floor, no-delta, spend), asserting `reason` AND
 *     `nextRecord` on every case (not just `spend`) so a branch returning
 *     the right boolean for the wrong reason fails — the LIN-2274
 *     mutation-blind-test scar this ticket is deliberately not repeating.
 *   - The floor boundary on both sides.
 *   - The write-nothing-on-false invariant, structurally, over every
 *     non-spend case above.
 *   - The multi-turn sequence witness: the gate opens exactly once.
 *   - The LANE_KEYS projection (close-out L1): the snapshot carries exactly
 *     the 7 lanes of the record shape, whatever the producer emits.
 *   - The injected-clock guard (close-out L2): a missing or non-finite `now`
 *     THROWS rather than silently falling back to `Date.now()`. Mirrors the
 *     precedent this module's header cites, tests/unit/observer-sweep.test.js's
 *     'ledger 9' assert.rejects case for `sweepOneWorkspace`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// LIN-2447: the lease derivation is pinned against openrouter.js's own live
// constant, not a copy of it.
import { DEFAULT_MAX_TOOL_ITERATIONS } from '../../lib/openrouter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { buildCompanionSnapshot, shouldSpendTurn, COMPANION_SEED_STATE, COMPANION_INSTANCE_PREFIX, DEFAULT_COMPANION_FLOOR_MS, RESERVATION_LEASE_MS, DEFAULT_SWEEP_LIVENESS_HORIZON_MS } from '../../lib/flight-companion-gate.js';

const ZERO_LANES = { working: 0, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 };

function lanes(overrides) {
  return { ...ZERO_LANES, ...overrides };
}

function attentionRow(loopId, lane, stage, since = '2026-08-31T00:00:00.000Z') {
  return { loopId, issue: `LIN-${loopId}`, lane, stage, since };
}

/** A raw sweep census store document (`observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s shape).
 * `attentionKeysFull` is OMITTED by default (undefined) — most fixtures below
 * deliberately exercise `buildCompanionSnapshot`'s pre-LIN-2619 fallback path
 * (a census doc that predates the field), which is what most of this file's
 * existing coverage was written against. Pass it explicitly to exercise the
 * real LIN-2619 field. */
function census({ stateHash, rev = 1, lanesState = ZERO_LANES, attention = [], truncated = false, attentionKeysFull } = {}) {
  return {
    state: { v: 1, lanes: lanesState, attention, truncated, ...(attentionKeysFull !== undefined ? { attentionKeysFull } : {}) },
    stateHash,
    rev
  };
}

/** A companion record — this module's own unwrapped shape. */
function companion(overrides) {
  return { ...COMPANION_SEED_STATE, ...overrides };
}

// ─── buildCompanionSnapshot ──────────────────────────────────────────────

describe('buildCompanionSnapshot', () => {
  test('projects lanes, attention identity tuples (excluding `since`), attentionCount, truncated, and censusRev', () => {
    const doc = census({
      stateHash: 'h1',
      rev: 7,
      lanesState: lanes({ blocked: 2, terminal: 3 }),
      attention: [attentionRow('loop-1', 'blocked', 'review'), attentionRow('loop-2', 'silent', 'waiting')],
      truncated: true
    });
    assert.deepStrictEqual(buildCompanionSnapshot(doc), {
      lanes: lanes({ blocked: 2, terminal: 3 }),
      attentionKeys: [
        ['loop-1', 'blocked', 'review'],
        ['loop-2', 'silent', 'waiting']
      ],
      // No `attentionKeysFull` on the census doc (a pre-LIN-2619 shape) ->
      // falls back to this same snapshot's own attentionKeys.
      attentionKeysFull: [
        ['loop-1', 'blocked', 'review'],
        ['loop-2', 'silent', 'waiting']
      ],
      attentionCount: 2,
      truncated: true,
      censusRev: 7
    });
  });

  test('LIN-2619: attentionKeysFull is sourced from the census doc\'s own field when present, independent of the (fossil-filtered) attentionKeys', () => {
    const doc = census({
      stateHash: 'h1',
      rev: 7,
      lanesState: lanes({ blocked: 1 }),
      // Only the fresh row is enumerated in `attention` — the fossil row was
      // collapsed into staleAttentionCount by the sweep (LIN-2619 beat 2),
      // but the sweep's own attentionKeysFull still carries its identity.
      attention: [attentionRow('loop-fresh', 'blocked', 'review')],
      attentionKeysFull: [['loop-fossil', 'blocked', 'review'], ['loop-fresh', 'blocked', 'review']]
    });
    const snapshot = buildCompanionSnapshot(doc);
    assert.deepStrictEqual(snapshot.attentionKeys, [['loop-fresh', 'blocked', 'review']]);
    assert.deepStrictEqual(snapshot.attentionKeysFull, [['loop-fossil', 'blocked', 'review'], ['loop-fresh', 'blocked', 'review']]);
  });

  test('empty attention -> attentionCount 0, empty attentionKeys', () => {
    const doc = census({ stateHash: 'h1', rev: 1 });
    assert.deepStrictEqual(buildCompanionSnapshot(doc).attentionKeys, []);
    assert.strictEqual(buildCompanionSnapshot(doc).attentionCount, 0);
  });

  // ── L1: the lane projection is through LANE_KEYS, not a wholesale copy ──
  // Both cases below pass trivially under a `{ ...state.lanes }` spread only
  // if the producer's object already happens to match the record shape; they
  // are here precisely because it might not.

  test('projects through LANE_KEYS: a producer-added lane key never reaches the snapshot', () => {
    const doc = census({
      stateHash: 'h1',
      rev: 1,
      lanesState: { ...lanes({ blocked: 2 }), zombie: 4, abandoned: 9 }
    });
    const snapshot = buildCompanionSnapshot(doc);
    assert.deepStrictEqual(Object.keys(snapshot.lanes).sort(), ['blocked', 'queued', 'resolved', 'silent', 'terminal', 'unknown', 'working']);
    assert.deepStrictEqual(snapshot.lanes, lanes({ blocked: 2 }));
  });

  test('projects through LANE_KEYS: an absent lane reads 0, never undefined — so terminalDelta stays a number', () => {
    // A census missing `terminal` entirely. Under a wholesale spread this
    // yields `terminal: undefined`, and `undefined - undefined` is NaN —
    // `NaN <= 0` is false, so the `no-delta` fold would silently stop firing.
    const doc = census({ stateHash: 'h1', rev: 1, lanesState: { working: 1 } });
    const snapshot = buildCompanionSnapshot(doc);
    assert.strictEqual(snapshot.lanes.terminal, 0);
    assert.deepStrictEqual(snapshot.lanes, lanes({ working: 1 }));

    // And the downstream consequence, asserted end-to-end rather than assumed:
    // two such censuses still fold to `no-delta` instead of spending.
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: buildCompanionSnapshot(doc) });
    const next = census({ stateHash: 'hNew', rev: 2, lanesState: { working: 1 } });
    const result = shouldSpendTurn({ currentCensusDoc: next, companionDoc, now: 1000 });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-delta', nextRecord: null });
  });
});

// ─── shouldSpendTurn: precedence + reason/nextRecord witnesses ──────────

describe('shouldSpendTurn: no-census / no-companion precedence', () => {
  test('currentCensusDoc == null -> false, reason no-census, nextRecord null', () => {
    const result = shouldSpendTurn({ currentCensusDoc: null, companionDoc: COMPANION_SEED_STATE, now: 1000 });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-census', nextRecord: null });
  });

  test('companionDoc == null (F4: backend-fault read) -> false, reason no-companion, nextRecord null', () => {
    const doc = census({ stateHash: 'h1' });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc: null, now: 1000 });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-companion', nextRecord: null });
  });

  test('both null -> no-census wins (first match, not no-companion)', () => {
    const result = shouldSpendTurn({ currentCensusDoc: null, companionDoc: null, now: 1000 });
    assert.strictEqual(result.reason, 'no-census');
  });
});

describe('shouldSpendTurn: census-delta true/false', () => {
  test('identical stateHash -> false, reason hash-identical, nextRecord null', () => {
    const doc = census({ stateHash: 'h1', lanesState: lanes({ working: 1 }) });
    const companionDoc = companion({ lastCensusStateHash: 'h1', lastCensusSnapshot: buildCompanionSnapshot(doc), lastTurnAt: null });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'hash-identical', nextRecord: null });
  });

  test('different hash, identical attentionKeys/terminal -> false, reason no-delta, nextRecord null', () => {
    const priorSnapshot = { lanes: lanes({ terminal: 2 }), attentionKeys: [['loop-1', 'blocked', 'review']], attentionCount: 1, truncated: false, censusRev: 1 };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 2 }), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-delta', nextRecord: null });
  });

  test('different hash, new attention tuple -> true, surface true, reason spend, nextRecord complete', () => {
    const priorSnapshot = { lanes: lanes({ terminal: 0 }), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null, notes: 'prior notes' });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 0 }), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 5000 });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.surface, true);
    assert.strictEqual(result.reason, 'spend');
    assert.deepStrictEqual(result.nextRecord, {
      v: 1,
      lastCensusStateHash: 'hNew',
      lastCensusSnapshot: buildCompanionSnapshot(doc),
      lastTurnAt: new Date(5000).toISOString(),
      turnReservedUntil: null,
      reservationId: null,
      notes: 'prior notes'
    });
    // LIN-2442: the reserve record re-emits the PRIOR baseline unchanged
    // (not the new one), carries a fresh lastTurnAt, and opens a lease.
    assert.deepStrictEqual(result.reserveRecord, {
      v: 1,
      lastCensusStateHash: 'hOld',
      lastCensusSnapshot: priorSnapshot,
      lastTurnAt: new Date(5000).toISOString(),
      turnReservedUntil: new Date(5000 + RESERVATION_LEASE_MS).toISOString(),
      reservationId: result.reserveRecord.reservationId, // LIN-2447, asserted for shape below
      notes: 'prior notes'
    });
    assert.match(result.reserveRecord.reservationId, /^[0-9a-f-]{36}$/, 'a per-turn nonce, defaulted from randomUUID');
  });

  test('removed attention tuple -> true, surface true, reason spend', () => {
    const priorSnapshot = { lanes: lanes({}), attentionKeys: [['loop-1', 'blocked', 'review']], attentionCount: 1, truncated: false, censusRev: 1 };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.surface, true);
    assert.strictEqual(result.reason, 'spend');
  });

  test('different hash, attentionKeys unchanged but terminal delta > 0 -> true, surface true', () => {
    const priorSnapshot = { lanes: lanes({ terminal: 1 }), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 3 }), attention: [] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.surface, true);
    assert.strictEqual(result.reason, 'spend');
    assert.strictEqual(result.nextRecord.lastCensusSnapshot.lanes.terminal, 3);
  });

  test('terminal delta < 0 only (window-expiry churn) -> false, reason no-delta — the F2-corrected case, not spend', () => {
    const priorSnapshot = { lanes: lanes({ terminal: 5 }), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 2 }), attention: [] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-delta', nextRecord: null });
  });

  test('seed turn, current census attentionCount === 0 -> true, reason spend, surface FALSE (the one reachable spend:true/surface:false case)', () => {
    const doc = census({ stateHash: 'hNew', rev: 1, lanesState: lanes({}), attention: [] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc: COMPANION_SEED_STATE, now: 1000 });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.reason, 'spend');
    assert.strictEqual(result.surface, false);
    assert.deepStrictEqual(result.nextRecord, {
      v: 1,
      lastCensusStateHash: 'hNew',
      lastCensusSnapshot: buildCompanionSnapshot(doc),
      lastTurnAt: new Date(1000).toISOString(),
      turnReservedUntil: null,
      reservationId: null,
      notes: ''
    });
    // Seed turn: no prior baseline, so the reserve record's baseline stays null too.
    assert.deepStrictEqual(result.reserveRecord, {
      v: 1,
      lastCensusStateHash: null,
      lastCensusSnapshot: null,
      lastTurnAt: new Date(1000).toISOString(),
      turnReservedUntil: new Date(1000 + RESERVATION_LEASE_MS).toISOString(),
      reservationId: result.reserveRecord.reservationId,
      notes: ''
    });
  });

  test('seed turn, current census attentionCount > 0 -> true, reason spend, surface true', () => {
    const doc = census({ stateHash: 'hNew', rev: 1, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc: COMPANION_SEED_STATE, now: 1000 });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.reason, 'spend');
    assert.strictEqual(result.surface, true);
  });
});

// ─── shouldSpendTurn: the fossil no-delta fold (LIN-2619) ────────────────

describe('shouldSpendTurn: fossil no-delta fold (LIN-2619)', () => {
  test('a row ageing out of the enumerated attention (present in attentionKeysFull both ticks) -> false, reason no-delta', () => {
    // Prior tick: the row was still fresh, enumerated in BOTH attention and
    // attentionKeysFull.
    const priorSnapshot = {
      lanes: lanes({}),
      attentionKeys: [['loop-1', 'blocked', 'review']],
      attentionKeysFull: [['loop-1', 'blocked', 'review']],
      attentionCount: 1,
      truncated: false,
      censusRev: 1
    };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    // Current tick: the sweep has now collapsed loop-1 into staleAttentionCount
    // — gone from `attention`/`attentionKeys`, but STILL present in
    // attentionKeysFull, since that key is fossil-filter-blind by design.
    const doc = census({
      stateHash: 'hNew',
      rev: 2,
      lanesState: lanes({}),
      attention: [],
      attentionKeysFull: [['loop-1', 'blocked', 'review']]
    });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-delta', nextRecord: null });
  });

  test('a genuinely NEW attention row (added to attentionKeysFull too) still spends, even with an unrelated fossil row aged out in the same tick', () => {
    const priorSnapshot = {
      lanes: lanes({}),
      attentionKeys: [['loop-fossil', 'blocked', 'review']],
      attentionKeysFull: [['loop-fossil', 'blocked', 'review']],
      attentionCount: 1,
      truncated: false,
      censusRev: 1
    };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    // loop-fossil ages out of attention/attentionKeys (still in attentionKeysFull),
    // AND a genuinely new loop-fresh appears in all three.
    const doc = census({
      stateHash: 'hNew',
      rev: 2,
      lanesState: lanes({}),
      attention: [attentionRow('loop-fresh', 'blocked', 'review')],
      attentionKeysFull: [['loop-fossil', 'blocked', 'review'], ['loop-fresh', 'blocked', 'review']]
    });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.surface, true);
    assert.strictEqual(result.reason, 'spend');
  });

  test('a genuinely RESOLVED row (gone from attentionKeysFull too, not merely aged out) still spends', () => {
    const priorSnapshot = {
      lanes: lanes({}),
      attentionKeys: [['loop-1', 'blocked', 'review']],
      attentionKeysFull: [['loop-1', 'blocked', 'review']],
      attentionCount: 1,
      truncated: false,
      censusRev: 1
    };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    // A human answered loop-1 — it is gone from EVERY key, not merely the
    // enumerated one, which is exactly what distinguishes "resolved" from
    // "aged out" and must still spend.
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [], attentionKeysFull: [] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.surface, true);
    assert.strictEqual(result.reason, 'spend');
  });

  describe('backward compatibility: a companion snapshot persisted BEFORE this deploy has no attentionKeysFull', () => {
    test('prior snapshot missing attentionKeysFull falls back to its own attentionKeys — an unchanged fleet across the deploy boundary still folds to no-delta', () => {
      // The prior snapshot is EXACTLY the pre-LIN-2619 shape — no
      // attentionKeysFull key at all (not merely undefined; genuinely absent,
      // as a real object literal read back from a pre-deploy persisted
      // document would be).
      const priorSnapshot = {
        lanes: lanes({ terminal: 2 }),
        attentionKeys: [['loop-1', 'blocked', 'review']],
        attentionCount: 1,
        truncated: false,
        censusRev: 1
      };
      assert.ok(!('attentionKeysFull' in priorSnapshot), 'sanity: this snapshot must genuinely lack the key, not merely hold it as undefined');
      const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
      // Current tick is post-deploy and DOES carry attentionKeysFull, but the
      // underlying fleet is unchanged and under ATTENTION_CAP — so the new
      // full set and the old capped-but-complete attentionKeys are identical.
      const doc = census({
        stateHash: 'hNew',
        rev: 2,
        lanesState: lanes({ terminal: 2 }),
        attention: [attentionRow('loop-1', 'blocked', 'review')],
        attentionKeysFull: [['loop-1', 'blocked', 'review']]
      });
      const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
      assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-delta', nextRecord: null });
    });

    test('prior snapshot missing attentionKeysFull still detects a genuinely new row (never crashes, never silently swallows the delta)', () => {
      const priorSnapshot = { lanes: lanes({}), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
      assert.ok(!('attentionKeysFull' in priorSnapshot));
      const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
      const doc = census({
        stateHash: 'hNew',
        rev: 2,
        lanesState: lanes({}),
        attention: [attentionRow('loop-new', 'blocked', 'review')],
        attentionKeysFull: [['loop-new', 'blocked', 'review']]
      });
      const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
      assert.strictEqual(result.spend, true, 'a real new row must still spend even when the PRIOR snapshot predates attentionKeysFull');
      assert.strictEqual(result.reason, 'spend');
    });

    test('current census doc ALSO missing attentionKeysFull (mid-deploy race) never crashes — both sides fall back to attentionKeys, reproducing pre-LIN-2619 behavior exactly', () => {
      const priorSnapshot = { lanes: lanes({ terminal: 1 }), attentionKeys: [['loop-1', 'blocked', 'review']], attentionCount: 1, truncated: false, censusRev: 1 };
      const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
      // No attentionKeysFull passed to census() at all — a pre-LIN-2619 sweep doc.
      const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 1 }), attention: [attentionRow('loop-1', 'blocked', 'review')] });
      let result;
      assert.doesNotThrow(() => { result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 }); });
      assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'no-delta', nextRecord: null });
    });
  });
});

describe('shouldSpendTurn: floor-interval boundary', () => {
  const priorSnapshot = { lanes: lanes({}), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };

  function nonSeedCompanion(lastTurnAtMs) {
    return companion({
      lastCensusStateHash: 'hOld',
      lastCensusSnapshot: priorSnapshot,
      lastTurnAt: lastTurnAtMs == null ? null : new Date(lastTurnAtMs).toISOString()
    });
  }

  test('now - lastTurnAt === floorMs - 1 -> false, reason floor, nextRecord null', () => {
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const companionDoc = nonSeedCompanion(0);
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: DEFAULT_COMPANION_FLOOR_MS - 1, floorMs: DEFAULT_COMPANION_FLOOR_MS });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'floor', nextRecord: null });
  });

  test('now - lastTurnAt === floorMs -> true (all else permitting)', () => {
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const companionDoc = nonSeedCompanion(0);
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: DEFAULT_COMPANION_FLOOR_MS, floorMs: DEFAULT_COMPANION_FLOOR_MS });
    assert.strictEqual(result.spend, true);
    assert.strictEqual(result.reason, 'spend');
  });

  test('lastTurnAt: null -> floor never blocks, regardless of elapsed time', () => {
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const companionDoc = nonSeedCompanion(null);
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1, floorMs: DEFAULT_COMPANION_FLOOR_MS });
    assert.notStrictEqual(result.reason, 'floor');
    assert.strictEqual(result.spend, true);
  });
});

// ─── turn-in-flight precedence (LIN-2442) ────────────────────────────────

describe('shouldSpendTurn: turn-in-flight precedence (LIN-2442)', () => {
  test('a live reservation blocks even though the floor has already elapsed and the hash differs', () => {
    const priorSnapshot = { lanes: lanes({}), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
    const companionDoc = companion({
      lastCensusStateHash: 'hOld',
      lastCensusSnapshot: priorSnapshot,
      lastTurnAt: new Date(0).toISOString(),
      turnReservedUntil: new Date(500_000).toISOString()
    });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    // now is well past DEFAULT_COMPANION_FLOOR_MS (180_000) since lastTurnAt,
    // so without the turn-in-flight branch this would fall through to spend.
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 400_000, floorMs: DEFAULT_COMPANION_FLOOR_MS });
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'turn-in-flight', nextRecord: null });
  });

  test('turn-in-flight outranks hash-identical when both would otherwise match', () => {
    const doc = census({ stateHash: 'h1' });
    const companionDoc = companion({
      lastCensusStateHash: 'h1',
      lastCensusSnapshot: buildCompanionSnapshot(doc),
      turnReservedUntil: new Date(2000).toISOString()
    });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 1000 });
    assert.strictEqual(result.reason, 'turn-in-flight');
  });

  test('now === turnReservedUntil -> lease has expired, does not block (all else permitting)', () => {
    const priorSnapshot = { lanes: lanes({}), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
    const companionDoc = companion({
      lastCensusStateHash: 'hOld',
      lastCensusSnapshot: priorSnapshot,
      lastTurnAt: new Date(0).toISOString(),
      turnReservedUntil: new Date(500_000).toISOString()
    });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 500_000, floorMs: DEFAULT_COMPANION_FLOOR_MS });
    assert.notStrictEqual(result.reason, 'turn-in-flight');
    assert.strictEqual(result.spend, true);
  });

  test('turnReservedUntil: null -> never blocks, regardless of elapsed time', () => {
    const priorSnapshot = { lanes: lanes({}), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
    const companionDoc = companion({
      lastCensusStateHash: 'hOld',
      lastCensusSnapshot: priorSnapshot,
      lastTurnAt: new Date(0).toISOString(),
      turnReservedUntil: null
    });
    const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
    const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: 400_000, floorMs: DEFAULT_COMPANION_FLOOR_MS });
    assert.notStrictEqual(result.reason, 'turn-in-flight');
    assert.strictEqual(result.spend, true);
  });

  test('COMPANION_SEED_STATE seeds turnReservedUntil: null alongside lastTurnAt: null', () => {
    assert.strictEqual(COMPANION_SEED_STATE.turnReservedUntil, null);
  });

  // LIN-2447 item 1. The assertion this replaces read
  //   assert.ok(RESERVATION_LEASE_MS > 4 * 120_000)
  // and passed — while the lease was 600_000 and the true worst case was ALSO
  // 600_000, i.e. zero headroom. It passed because it encoded the same missing
  // hop the comment did: `streamChatWithTools` runs up to
  // DEFAULT_MAX_TOOL_ITERATIONS `runToolHop` calls and then ALWAYS falls
  // through to a final `streamChat`, so the bound is (MAX + 1) timeouts.
  //
  // Pinned against openrouter.js's LIVE constants rather than copies, so
  // raising either one fails here instead of silently eating the headroom
  // again. REQUEST_TIMEOUT_MS is module-private, so it is read from source —
  // the alternative is a hard-coded 120_000, which is the exact mistake this
  // test exists to prevent recurring.
  test('LIN-2447: RESERVATION_LEASE_MS outlasts (DEFAULT_MAX_TOOL_ITERATIONS + 1) x REQUEST_TIMEOUT_MS, with real headroom', () => {
    const openrouterSrc = readFileSync(join(__dirname, '../../lib/openrouter.js'), 'utf8');
    const timeoutMatch = /const REQUEST_TIMEOUT_MS = (\d+);/.exec(openrouterSrc);
    assert.ok(timeoutMatch, 'expected REQUEST_TIMEOUT_MS in lib/openrouter.js — if this fails the constant moved and this pin needs re-anchoring');
    const requestTimeoutMs = Number(timeoutMatch[1]);

    // The mandatory final hop, asserted from source rather than assumed.
    assert.match(
      openrouterSrc,
      /Final answer ALWAYS streams[\s\S]*?return streamChat\(convo, streamOptions, onEvent\);/,
      'the +1 in the derivation is this unconditional final streamChat — if it becomes conditional, the arithmetic below changes'
    );

    // The bound, stated for what it is: (MAX + 1) calls, each bounded in
    // TIME-TO-RESPONSE-HEADERS. Not a total-duration worst case — streamChat
    // clears its timeout once the fetch resolves and then reads the SSE body
    // unguarded, and executeTool is unbounded. Asserted as a floor the lease
    // must clear, never as an equality: pinning the literal 600_000 would both
    // certify a figure that is not the worst case AND go red on a legitimate
    // DEFAULT_MAX_TOOL_ITERATIONS bump that leaves the invariant intact.
    const headersBoundMs = (DEFAULT_MAX_TOOL_ITERATIONS + 1) * requestTimeoutMs;
    assert.ok(
      RESERVATION_LEASE_MS > headersBoundMs,
      `lease (${RESERVATION_LEASE_MS}) must EXCEED the ${headersBoundMs}ms (MAX+1)-call bound, not equal it — equalling it is the defect LIN-2447 fixed`
    );
    assert.ok(
      RESERVATION_LEASE_MS >= headersBoundMs * 1.25,
      'and by a real margin, not a rounding error'
    );
  });

  test('LIN-2447: two same-millisecond gate evaluations produce distinguishable reserve records', () => {
    // Named for what it actually asserts. It does NOT touch advance(), so it
    // proves nothing about who wins a CAS — and item 3's claimed collision does
    // not reproduce anyway (see the reservationId comment in the gate: the
    // duplicate-identical-state branch needs `current.rev === expectedRev`, so
    // the loser of a real race sees rev+1 and gets false, with or without a
    // nonce). What matters here is the property item 2 depends on: byte-
    // identical inputs and an identical clock must still yield records that can
    // be told apart, because turnReservedUntil alone cannot identify a turn.
    const build = () => {
      const priorSnapshot = { lanes: lanes({ terminal: 0 }), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
      return {
        currentCensusDoc: census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 0 }), attention: [attentionRow('loop-1', 'blocked', 'review')] }),
        companionDoc: companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null }),
        now: 5000,
      };
    };
    const a = shouldSpendTurn(build());
    const b = shouldSpendTurn(build());

    assert.strictEqual(a.spend, true);
    assert.strictEqual(b.spend, true);
    assert.notStrictEqual(
      a.reserveRecord.reservationId,
      b.reserveRecord.reservationId,
      'same-millisecond reservations must differ, or the commit CAS has nothing to match on'
    );
    assert.notDeepStrictEqual(
      a.reserveRecord,
      b.reserveRecord,
      'and the whole RECORD must differ, not just a field the commit path happens to read'
    );
  });

  test('LIN-2447: the commit record carries no reservation — committing releases the lease', () => {
    const priorSnapshot = { lanes: lanes({ terminal: 0 }), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
    const result = shouldSpendTurn({
      currentCensusDoc: census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 0 }), attention: [attentionRow('loop-1', 'blocked', 'review')] }),
      companionDoc: companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null }),
      now: 5000,
    });
    assert.strictEqual(result.nextRecord.turnReservedUntil, null);
    assert.strictEqual(result.nextRecord.reservationId, null, 'the commit clears the nonce alongside the deadline');
  });
});

// ─── The write-nothing invariant, structurally ──────────────────────────

describe('shouldSpendTurn: write-nothing-on-false invariant', () => {
  const nonSpendCases = [
    { name: 'no-census', args: { currentCensusDoc: null, companionDoc: COMPANION_SEED_STATE, now: 1000 } },
    { name: 'no-companion', args: { currentCensusDoc: census({ stateHash: 'h1' }), companionDoc: null, now: 1000 } },
    {
      name: 'turn-in-flight',
      args: {
        currentCensusDoc: census({ stateHash: 'h1' }),
        companionDoc: companion({ turnReservedUntil: new Date(2000).toISOString() }),
        now: 1000
      }
    },
    {
      name: 'hash-identical',
      args: (() => {
        const doc = census({ stateHash: 'h1' });
        return { currentCensusDoc: doc, companionDoc: companion({ lastCensusStateHash: 'h1', lastCensusSnapshot: buildCompanionSnapshot(doc) }), now: 1000 };
      })()
    },
    {
      name: 'floor',
      args: {
        currentCensusDoc: census({ stateHash: 'hNew', attention: [attentionRow('loop-1', 'blocked', 'review')] }),
        companionDoc: companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: { lanes: ZERO_LANES, attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 }, lastTurnAt: new Date(0).toISOString() }),
        now: 100
      }
    },
    {
      name: 'no-delta',
      args: {
        currentCensusDoc: census({ stateHash: 'hNew', attention: [] }),
        companionDoc: companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: { lanes: ZERO_LANES, attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 } }),
        now: 1000
      }
    }
  ];

  for (const { name, args } of nonSpendCases) {
    test(`${name} -> nextRecord === null`, () => {
      const result = shouldSpendTurn(args);
      assert.strictEqual(result.spend, false);
      assert.strictEqual(result.nextRecord, null);
    });
  }
});

// ─── The multi-turn sequence witness ─────────────────────────────────────

describe('shouldSpendTurn: multi-turn sequence — the gate opens exactly once', () => {
  test('repeated real-change polls below the floor are suppressed; the gate opens once at the boundary, then hash-identical holds it closed', () => {
    const floorMs = 1000;
    const changedCensus = census({ stateHash: 'hB', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });

    let companionDoc = companion({
      lastCensusStateHash: 'hA',
      lastCensusSnapshot: { lanes: ZERO_LANES, attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 },
      lastTurnAt: new Date(0).toISOString()
    });

    const pollTimes = [100, 300, 600, 900, 1000, 1050, 1100, 2000];
    let spendCount = 0;

    for (const t of pollTimes) {
      const result = shouldSpendTurn({ currentCensusDoc: changedCensus, companionDoc, now: t, floorMs });
      if (result.spend) {
        spendCount += 1;
        companionDoc = result.nextRecord;
      }
      // On false, nothing is written — the caller's stored companionDoc is unchanged.
    }

    assert.strictEqual(spendCount, 1);
  });
});

// ─── Instance-key prefix ─────────────────────────────────────────────────

describe('COMPANION_INSTANCE_PREFIX', () => {
  test('is the third instance-key family', () => {
    assert.strictEqual(COMPANION_INSTANCE_PREFIX, 'companion:v1:');
  });
});

// ─── L2: the injected-clock guard ────────────────────────────────────────
//
// Close-out ledger item L2. The module's determinism rests entirely on `now`
// being injected (§3: "never `Date.now()` read internally"), and the header
// cites lib/observer-sweep.js:231-233 as its precedent — but that precedent
// carries its own assert.rejects test and this module shipped without the
// equivalent, so replacing the guard with a silent `Date.now()` fallback left
// the suite green. These cases are that missing witness: under such a
// fallback every `assert.throws` below fails, because the call returns a
// perfectly ordinary result instead of refusing.

describe('shouldSpendTurn: the injected clock is REQUIRED (L2)', () => {
  const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
  const companionDoc = companion({
    lastCensusStateHash: 'hOld',
    lastCensusSnapshot: { lanes: ZERO_LANES, attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 }
  });

  const badClocks = [undefined, null, NaN, Infinity, -Infinity, '1700000000000', 'not-a-date', '', new Date('nope'), {}, true, [] ];

  for (const bad of badClocks) {
    test(`now = ${String(bad) || JSON.stringify(bad)} throws instead of falling back to Date.now()`, () => {
      assert.throws(
        () => shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now: bad }),
        /now \(epoch ms or Date\) is required/,
        `now = ${String(bad)} must throw`
      );
    });
  }

  test('the guard runs FIRST — it refuses before even the no-census branch can answer', () => {
    // Ordering matters: were the guard below the branch table, a bad clock on
    // a null census would quietly return `no-census` and the refusal would
    // never be reached on the path that matters.
    assert.throws(
      () => shouldSpendTurn({ currentCensusDoc: null, companionDoc: null, now: undefined }),
      /now \(epoch ms or Date\) is required/
    );
  });

  test('the three accepted clock forms are NOT refused, and agree on the stamp', () => {
    // The negative cases above are only meaningful if the guard is a real
    // discriminator rather than a blanket throw. Epoch ms, a Date, and an ISO
    // string are the module's documented inputs; all three must produce the
    // same `lastTurnAt`.
    const ms = 1788134400000;
    const stamps = [ms, new Date(ms), new Date(ms).toISOString()].map((now) => {
      const result = shouldSpendTurn({ currentCensusDoc: doc, companionDoc, now });
      assert.strictEqual(result.spend, true, `now = ${String(now)} must not be refused`);
      return result.nextRecord.lastTurnAt;
    });
    assert.deepStrictEqual(stamps, [new Date(ms).toISOString(), new Date(ms).toISOString(), new Date(ms).toISOString()]);
  });
});

// ─── shouldSpendTurn: sweep liveness (LIN-2438) ──────────────────────────
//
// A pure relabel of an ALREADY spend:false decision — see the module header
// and lib/observer-sweep.js's post-advance() heartbeat. Applied at exactly
// two return sites (hash-identical, no-delta); never on no-census,
// no-companion, turn-in-flight or floor (T7). The F1 property this exists to
// preserve — no branch may turn a real spend into a no-spend — is pinned
// structurally by T4 below, parameterised over every spend-producing fixture
// already in this file.

describe('shouldSpendTurn: sweep liveness (LIN-2438)', () => {
  const NOW_MS = 2_000_000; // well past DEFAULT_SWEEP_LIVENESS_HORIZON_MS (1_800_000) from epoch 0

  function hashIdenticalArgs(censusOverrides = {}) {
    const doc = { ...census({ stateHash: 'h1', lanesState: lanes({ working: 1 }) }), ...censusOverrides };
    const companionDoc = companion({ lastCensusStateHash: 'h1', lastCensusSnapshot: buildCompanionSnapshot(census({ stateHash: 'h1', lanesState: lanes({ working: 1 }) })), lastTurnAt: null });
    return { currentCensusDoc: doc, companionDoc, now: NOW_MS };
  }

  function noDeltaArgs(censusOverrides = {}) {
    const priorSnapshot = { lanes: lanes({ terminal: 2 }), attentionKeys: [['loop-1', 'blocked', 'review']], attentionCount: 1, truncated: false, censusRev: 1 };
    const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
    const doc = { ...census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 2 }), attention: [attentionRow('loop-1', 'blocked', 'review')] }), ...censusOverrides };
    return { currentCensusDoc: doc, companionDoc, now: NOW_MS };
  }

  test('DEFAULT_SWEEP_LIVENESS_HORIZON_MS is derived: 30 x OBSERVER_SWEEP_INTERVAL_MS (server.js:597, 60_000)', () => {
    // T9
    assert.strictEqual(DEFAULT_SWEEP_LIVENESS_HORIZON_MS, 30 * 60_000);
    assert.strictEqual(DEFAULT_SWEEP_LIVENESS_HORIZON_MS, 1_800_000);
  });

  test('hash-identical + lastSeenAt inside the horizon -> reason stays hash-identical (a genuinely quiet fleet)', () => {
    // T1
    const args = hashIdenticalArgs({ lastSeenAt: new Date(NOW_MS - (DEFAULT_SWEEP_LIVENESS_HORIZON_MS - 1)) });
    const result = shouldSpendTurn(args);
    assert.deepStrictEqual(result, { spend: false, surface: false, reason: 'hash-identical', nextRecord: null });
  });

  test('hash-identical + lastSeenAt past the horizon -> reason sweep-not-seen, spend false, surface false, nextRecord null', () => {
    // T2
    const seenAt = new Date(NOW_MS - (DEFAULT_SWEEP_LIVENESS_HORIZON_MS + 1));
    const args = hashIdenticalArgs({ lastSeenAt: seenAt });
    const result = shouldSpendTurn(args);
    assert.deepStrictEqual(result, {
      spend: false,
      surface: false,
      reason: 'sweep-not-seen',
      sweepLastSeenAt: seenAt.toISOString(),
      nextRecord: null
    });
  });

  test('no-delta + lastSeenAt past the horizon -> reason sweep-not-seen', () => {
    // T3
    const seenAt = new Date(NOW_MS - (DEFAULT_SWEEP_LIVENESS_HORIZON_MS + 1));
    const args = noDeltaArgs({ lastSeenAt: seenAt });
    const result = shouldSpendTurn(args);
    assert.strictEqual(result.spend, false);
    assert.strictEqual(result.surface, false);
    assert.strictEqual(result.reason, 'sweep-not-seen');
    assert.strictEqual(result.sweepLastSeenAt, seenAt.toISOString());
    assert.strictEqual(result.nextRecord, null);
  });

  test('F1 REGRESSION: an arbitrarily ancient lastSeenAt never turns a spend into a no-spend', () => {
    // T4 — parameterised over every spend-producing fixture already in this
    // file, each run twice (fresh stamp vs new Date(0)) and deepStrictEqual'd
    // against each other. Red against any implementation that puts liveness
    // anywhere in the precedence chain ahead of the spend decision.
    const spendCases = [
      // different hash, new attention tuple (line ~153 above)
      () => {
        const priorSnapshot = { lanes: lanes({ terminal: 0 }), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
        const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null, notes: 'prior notes' });
        const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 0 }), attention: [attentionRow('loop-1', 'blocked', 'review')] });
        return { currentCensusDoc: doc, companionDoc, now: 5000 };
      },
      // terminal delta > 0 (line ~191 above)
      () => {
        const priorSnapshot = { lanes: lanes({ terminal: 1 }), attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 };
        const companionDoc = companion({ lastCensusStateHash: 'hOld', lastCensusSnapshot: priorSnapshot, lastTurnAt: null });
        const doc = census({ stateHash: 'hNew', rev: 2, lanesState: lanes({ terminal: 3 }), attention: [] });
        return { currentCensusDoc: doc, companionDoc, now: 1000 };
      },
      // seed turn, attentionCount === 0 (line ~210 above)
      () => {
        const doc = census({ stateHash: 'hNew', rev: 1, lanesState: lanes({}), attention: [] });
        return { currentCensusDoc: doc, companionDoc: COMPANION_SEED_STATE, now: 1000 };
      },
      // seed turn, attentionCount > 0 (line ~235 above)
      () => {
        const doc = census({ stateHash: 'hNew', rev: 1, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] });
        return { currentCensusDoc: doc, companionDoc: COMPANION_SEED_STATE, now: 1000 };
      }
    ];

    for (const buildArgs of spendCases) {
      const freshArgs = buildArgs();
      freshArgs.currentCensusDoc = { ...freshArgs.currentCensusDoc, lastSeenAt: new Date(freshArgs.now) };
      // LIN-2447: the reserve record now carries a per-turn nonce, so two
      // invocations differ by construction. Inject a fixed one on both sides —
      // this test is about liveness never changing the decision, not about the
      // records being byte-identical across independent turns (they must not be).
      freshArgs.reservationId = 'fixed-for-comparison';
      const freshResult = shouldSpendTurn(freshArgs);

      const ancientArgs = buildArgs();
      ancientArgs.reservationId = 'fixed-for-comparison';
      // Genuinely past DEFAULT_SWEEP_LIVENESS_HORIZON_MS relative to THIS
      // fixture's own `now` (not epoch 0) — several of these fixtures use a
      // `now` in the single-digit thousands, far smaller than the 1.8M ms
      // horizon, so an absolute `new Date(0)` would never actually cross it.
      ancientArgs.currentCensusDoc = { ...ancientArgs.currentCensusDoc, lastSeenAt: new Date(ancientArgs.now - DEFAULT_SWEEP_LIVENESS_HORIZON_MS - 1) };
      const ancientResult = shouldSpendTurn(ancientArgs);

      assert.strictEqual(freshResult.spend, true, 'sanity: the fixture must actually be spend-producing');
      assert.deepStrictEqual(ancientResult, freshResult, 'an ancient lastSeenAt must never change a spend decision');
    }
  });

  test('boundary: now - lastSeenAt === horizonMs -> sweep-not-seen; === horizonMs - 1 -> unchanged', () => {
    // T5
    const justInside = hashIdenticalArgs({ lastSeenAt: new Date(NOW_MS - (DEFAULT_SWEEP_LIVENESS_HORIZON_MS - 1)) });
    assert.strictEqual(shouldSpendTurn(justInside).reason, 'hash-identical');

    const atBoundary = hashIdenticalArgs({ lastSeenAt: new Date(NOW_MS - DEFAULT_SWEEP_LIVENESS_HORIZON_MS) });
    assert.strictEqual(shouldSpendTurn(atBoundary).reason, 'sweep-not-seen');
  });

  test('an absent or unparseable lastSeenAt leaves the decision untouched', () => {
    // T6 — fixture-inertness / fail-safe guard.
    const noStamp = hashIdenticalArgs({});
    delete noStamp.currentCensusDoc.lastSeenAt;
    assert.strictEqual(shouldSpendTurn(noStamp).reason, 'hash-identical');

    const unparseable = hashIdenticalArgs({ lastSeenAt: 'not-a-date' });
    assert.strictEqual(shouldSpendTurn(unparseable).reason, 'hash-identical');

    const nullStamp = hashIdenticalArgs({ lastSeenAt: null });
    assert.strictEqual(shouldSpendTurn(nullStamp).reason, 'hash-identical');
  });

  test('turn-in-flight, floor, no-companion and no-census are never relabelled, however stale the stamp', () => {
    // T7
    const ancientSeen = new Date(0);

    const noCensus = shouldSpendTurn({ currentCensusDoc: null, companionDoc: COMPANION_SEED_STATE, now: NOW_MS });
    assert.strictEqual(noCensus.reason, 'no-census');

    const noCompanionDoc = { ...census({ stateHash: 'h1' }), lastSeenAt: ancientSeen };
    const noCompanion = shouldSpendTurn({ currentCensusDoc: noCompanionDoc, companionDoc: null, now: NOW_MS });
    assert.strictEqual(noCompanion.reason, 'no-companion');

    const tifCensus = { ...census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] }), lastSeenAt: ancientSeen };
    const tifCompanion = companion({
      lastCensusStateHash: 'hOld',
      lastCensusSnapshot: { lanes: ZERO_LANES, attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 },
      lastTurnAt: new Date(0).toISOString(),
      turnReservedUntil: new Date(NOW_MS + 500_000).toISOString()
    });
    const tif = shouldSpendTurn({ currentCensusDoc: tifCensus, companionDoc: tifCompanion, now: NOW_MS });
    assert.strictEqual(tif.reason, 'turn-in-flight');

    const floorCensus = { ...census({ stateHash: 'hNew', rev: 2, lanesState: lanes({}), attention: [attentionRow('loop-1', 'blocked', 'review')] }), lastSeenAt: ancientSeen };
    const floorCompanion = companion({
      lastCensusStateHash: 'hOld',
      lastCensusSnapshot: { lanes: ZERO_LANES, attentionKeys: [], attentionCount: 0, truncated: false, censusRev: 1 },
      lastTurnAt: new Date(NOW_MS - 1).toISOString()
    });
    const floor = shouldSpendTurn({ currentCensusDoc: floorCensus, companionDoc: floorCompanion, now: NOW_MS, floorMs: DEFAULT_COMPANION_FLOOR_MS });
    assert.strictEqual(floor.reason, 'floor');
  });

  test('write-nothing-on-false invariant: a sweep-not-seen relabel still carries nextRecord: null', () => {
    // T8
    const seenAt = new Date(NOW_MS - (DEFAULT_SWEEP_LIVENESS_HORIZON_MS + 1));
    const result = shouldSpendTurn(hashIdenticalArgs({ lastSeenAt: seenAt }));
    assert.strictEqual(result.spend, false);
    assert.strictEqual(result.surface, false);
    assert.strictEqual(result.nextRecord, null);
  });

  test('a custom sweepHorizonMs is honoured', () => {
    const seenAt = new Date(NOW_MS - 500);
    const tightHorizon = hashIdenticalArgs({ lastSeenAt: seenAt });
    tightHorizon.sweepHorizonMs = 100;
    assert.strictEqual(shouldSpendTurn(tightHorizon).reason, 'sweep-not-seen');
  });
});
