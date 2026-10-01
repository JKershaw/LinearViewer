/**
 * Model test for the LIN-3200 arm rule's load-bearing claim (plan testing
 * strategy): over modelled M1-M4 failures, the recompute parity equals the arm
 * the factory logged, OR classifyPilotRows flags the row race-suspect. R1-R4
 * are excluded by construction (no fail-open, no swallowed archive, no clock
 * skew beyond the slack) and named, not tested.
 *
 * A seeded virtual clock drives concurrent dispatchers with random read
 * latencies up to their caps, random insert lag `L_insert` (plan-review
 * verdict `ee3c850d` finding 1a) and random take hops of length up to
 * HOP_ALLOWANCE_MS.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  RACE_SUSPECT_WINDOW_MS,
  COUNT_TIMEOUT_MS,
  POINTER_STEP_TIMEOUT_MS,
  HOP_ALLOWANCE_MS,
  SKEW_SLACK_MS,
  selectPilotArm,
  classifyPilotRows
} from '../../lib/file-pointer.js';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runSchedule(seed, { windowMs = RACE_SUSPECT_WINDOW_MS, classify = classifyPilotRows } = {}) {
  const rnd = mulberry32(seed);
  const G = COUNT_TIMEOUT_MS;
  const HOP = HOP_ALLOWANCE_MS;
  const INSERT = Math.max(1, RACE_SUSPECT_WINDOW_MS - G); // W - G

  const n = 3 + Math.floor(rnd() * 6);
  let t = 0;
  const scheds = [];
  for (let i = 0; i < n; i++) {
    t += Math.floor(rnd() * (G + HOP + SKEW_SLACK_MS));
    scheds.push(t);
  }

  const rows = [];
  const visibleAt = (row, tau) => {
    if (row.visible > tau) return false;
    if (row.removedAt != null && row.removedAt <= tau && (row.reinsertedAt == null || tau < row.reinsertedAt)) return false;
    return true;
  };

  for (let i = 0; i < n; i++) {
    const id = `r${String(i).padStart(3, '0')}`;
    const read0 = scheds[i];
    const lat0 = Math.floor(rnd() * G);
    const c0 = rows.filter(r => visibleAt(r, read0)).length;
    let arm = selectPilotArm({ ordinal: c0 });
    let stamp;
    if (arm === 'pointer') {
      const assembly = Math.floor(rnd() * POINTER_STEP_TIMEOUT_MS);
      const read1 = read0 + lat0 + assembly;
      const lat1 = Math.floor(rnd() * G);
      const c1 = rows.filter(r => visibleAt(r, read1)).length;
      arm = selectPilotArm({ ordinal: c1 });
      stamp = read1 + lat1;
    } else {
      stamp = read0 + lat0;
    }
    const insertLag = Math.floor(rnd() * INSERT);
    const row = { id, stamp, visible: stamp + insertLag, removedAt: null, reinsertedAt: null, resolvedAt: null, loggedArm: arm };
    // Schedule the take hop NOW (not after the loop) so a LATER dispatch's count
    // can observe this row mid-hop — the only way M3 is exercised.
    if (rnd() < 0.4) {
      const when = row.visible + Math.floor(rnd() * (G + HOP));
      const dur = Math.floor(rnd() * (HOP + 1));
      row.removedAt = when;
      row.reinsertedAt = when + dur;
      row.resolvedAt = when + dur;
    }
    rows.push(row);
  }

  const endT = Math.max(...rows.map(r => Math.max(r.visible, r.removedAt ?? 0, r.reinsertedAt ?? 0))) + 1;
  const finalRows = rows
    .filter(r => visibleAt(r, endT))
    .map(r => ({
      id: r.id,
      kind: 'implementation',
      followUpTo: null,
      abort: false,
      issueIdentifier: 'LIN-1',
      dispatchedAt: new Date(r.stamp).toISOString(),
      ...(r.resolvedAt != null ? { resolvedAt: new Date(r.resolvedAt).toISOString() } : {}),
      delivered: false
    }));

  const classified = classify(finalRows, { windowMs });
  const byId = new Map(classified.rows.map(r => [r.id, r]));
  let unflagged = 0;
  let mismatches = 0;
  for (const row of rows) {
    const rec = byId.get(row.id);
    if (!rec) continue; // mid-hop at end (an R2/R3-like loss), excluded by construction
    if (rec.arm !== row.loggedArm) {
      mismatches++;
      if (!rec.raceSuspect) unflagged++;
    }
  }
  return { unflagged, mismatches };
}

describe('file-pointer arm model', () => {
  test('zero unflagged mislabels across 200 seeded schedules (M1-M4)', () => {
    let totalUnflagged = 0;
    let totalMismatches = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { unflagged, mismatches } = runSchedule(seed);
      totalUnflagged += unflagged;
      totalMismatches += mismatches;
    }
    assert.equal(totalUnflagged, 0, `expected zero unflagged mislabels, got ${totalUnflagged} (${totalMismatches} mismatches)`);
    // Sanity: the model must actually exercise mismatches, or the assertion is vacuous.
    assert.ok(totalMismatches > 0, 'the model must produce at least one modelled divergence');
  });

  test('mutation: shrinking W below G + HOP_ALLOWANCE_MS goes red', () => {
    let unflagged = 0;
    for (let seed = 1; seed <= 200; seed++) {
      unflagged += runSchedule(seed, { windowMs: COUNT_TIMEOUT_MS + Math.floor(HOP_ALLOWANCE_MS / 2) }).unflagged;
    }
    assert.ok(unflagged > 0, 'a too-narrow window must leave mislabels unflagged');
  });

  test('mutation: dropping clause (ii) goes red', () => {
    // Zero out resolvedAt before classifying — the effect of removing the
    // resolvedAt half of the flag.
    const withoutClauseII = (rows, opts) => classifyPilotRows(rows.map(r => ({ ...r, resolvedAt: undefined })), opts);
    let unflagged = 0;
    for (let seed = 1; seed <= 200; seed++) {
      unflagged += runSchedule(seed, { classify: withoutClauseII }).unflagged;
    }
    assert.ok(unflagged > 0, 'dropping the resolvedAt clause must leave mislabels unflagged');
  });
});
