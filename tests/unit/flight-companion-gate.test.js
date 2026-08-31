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
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';

import { buildCompanionSnapshot, shouldSpendTurn, COMPANION_SEED_STATE, COMPANION_INSTANCE_PREFIX, DEFAULT_COMPANION_FLOOR_MS } from '../../lib/flight-companion-gate.js';

const ZERO_LANES = { working: 0, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 };

function lanes(overrides) {
  return { ...ZERO_LANES, ...overrides };
}

function attentionRow(loopId, lane, stage, since = '2026-08-31T00:00:00.000Z') {
  return { loopId, issue: `LIN-${loopId}`, lane, stage, since };
}

/** A raw sweep census store document (`observerStateStore.readCurrent('sweep:v1:<urlKey>')`'s shape). */
function census({ stateHash, rev = 1, lanesState = ZERO_LANES, attention = [], truncated = false }) {
  return {
    state: { v: 1, lanes: lanesState, attention, truncated },
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
      attentionCount: 2,
      truncated: true,
      censusRev: 7
    });
  });

  test('empty attention -> attentionCount 0, empty attentionKeys', () => {
    const doc = census({ stateHash: 'h1', rev: 1 });
    assert.deepStrictEqual(buildCompanionSnapshot(doc).attentionKeys, []);
    assert.strictEqual(buildCompanionSnapshot(doc).attentionCount, 0);
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
      notes: 'prior notes'
    });
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

// ─── The write-nothing invariant, structurally ──────────────────────────

describe('shouldSpendTurn: write-nothing-on-false invariant', () => {
  const nonSpendCases = [
    { name: 'no-census', args: { currentCensusDoc: null, companionDoc: COMPANION_SEED_STATE, now: 1000 } },
    { name: 'no-companion', args: { currentCensusDoc: census({ stateHash: 'h1' }), companionDoc: null, now: 1000 } },
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
