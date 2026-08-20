/**
 * Unit tests for lib/periodical-runs.js's `foldPeriodicalRuns` (LIN-1827,
 * sub-ticket of LIN-373 Approach C). Two layers, per the plan's test
 * strategy (mirroring tests/unit/dispatch-store-add-feedback-atomic.test.js's
 * own split):
 *  - Hand-fixture (most of this file): no store, no mock, no backend — every
 *    row is a literal JS object built by the factories below, feeding the
 *    pure fold directly.
 *  - Round-trip (bottom describe block): a real `MangoClient` over a tmpdir,
 *    never `tests/fixtures/mock-collection.js` — the mock honours exclusion
 *    projections (`{field: 0}`) only and silently no-ops on
 *    `PERIODICAL_PROJECTION`'s inclusion form (`{field: 1}`), so it cannot
 *    fail on a wrong projection or prove read-order behaviour the way a real
 *    engine can.
 *
 * Load-bearing assertions in this file:
 *  - `lastDispatchedAt` is a MAX over matched `taken` history rows'
 *    `dispatchedAt`, independent of input order — never `rows[0]`. Two plan
 *    reviews on this ticket caught an unpinned version of this property; the
 *    "order independence" describe block below is the test that exists
 *    specifically to close it, with a non-max row placed FIRST in the input
 *    array so an `rows[0]` implementation fails unconditionally.
 *  - `due`/`recent` is compared in MILLISECONDS against the cadence boundary,
 *    never through the floored `daysSince` display field, and the boundary
 *    is inclusive (`>=`) — at exactly one cadence period elapsed the state
 *    is `due`.
 *  - Only `status === 'taken'` history rows count as run evidence;
 *    `followUpTo`/`abort` exclude a row from evidence unconditionally; any
 *    live queue row reads `recent` regardless of what history alone says.
 *  - `never` vs `unknown` split on `effectiveHorizonMs = Math.min(horizonMs,
 *    historyTtlMs)` vs `historyTtlMs` — `unknown` is unreachable by any
 *    production caller at HEAD (both default to 30 days) but is pinned here
 *    as a defensive branch for a narrower horizon.
 *  - The join resolves `periodicalId` first, falls back to an
 *    exact-or-`"+ Autopilot"`-suffix title match ONLY for rows with no
 *    `periodicalId`, and an ambiguous title match or a stamped-but-unmatched
 *    `periodicalId` both resolve to no template, silently.
 *
 * Run: `npm run test:unit` (or `node --test tests/unit/periodical-runs.test.js`).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import {
  foldPeriodicalRuns,
  resolveCadenceMs,
  CADENCE_MS,
  DEFAULT_CADENCE_MS,
  DEFAULT_HORIZON_MS
} from '../../lib/periodical-runs.js';
import { PERIODICAL_PROJECTION, DispatchQueueStore } from '../../lib/dispatch-store.js';
import { PERIODICALS } from '../../lib/periodicals.js';

const WEEK_MS = CADENCE_MS.weekly;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-03T00:00:00.000Z').getTime();
const HISTORY_TTL_MS = 30 * DAY_MS;
const URL_KEY = 'acme';

// ── Fixture factories ───────────────────────────────────────────────────────

/** Mirrors a PERIODICALS registry entry (lib/periodicals.js's PeriodicalTemplate typedef, :93-104). */
function template(over = {}) {
  return {
    id: 'documentation-review',
    title: 'Documentation Review',
    mode: 'corrective',
    cadence: 'weekly',
    scope: 'repo',
    ...over
  };
}

/** Mirrors `_formatItem`'s output (lib/dispatch-store.js:1826) as read under PERIODICAL_PROJECTION — a queue row carries no `status` field at all. */
function queueRow(over = {}) {
  return {
    kind: 'custom',
    periodicalId: null,
    promptName: 'Prompt',
    followUpTo: null,
    abort: false,
    ...over
  };
}

/** Mirrors `_formatHistoryItem`'s output (lib/dispatch-store.js:1301) as read under PERIODICAL_PROJECTION. */
function historyRow(over = {}) {
  return {
    kind: 'custom',
    periodicalId: null,
    promptName: 'Prompt',
    dispatchedAt: '2026-07-01T00:00:00.000Z',
    status: 'taken',
    followUpTo: null,
    abort: false,
    ...over
  };
}

// ── resolveCadenceMs ─────────────────────────────────────────────────────────

describe('resolveCadenceMs', () => {
  test("'weekly' resolves to WEEK_MS", () => {
    assert.equal(resolveCadenceMs('weekly'), WEEK_MS);
  });

  test("'WEEKLY' normalises via case/whitespace, same as 'weekly'", () => {
    assert.equal(resolveCadenceMs('  WEEKLY  '), WEEK_MS);
  });

  test('undefined falls back to DEFAULT_CADENCE_MS', () => {
    // The cadence-vocabulary table has exactly one entry whose value equals
    // the fallback (weekly === DEFAULT_CADENCE_MS), so the fallback is
    // otherwise unobservable through the fold itself — this direct export
    // test is the only thing that pins it.
    assert.equal(resolveCadenceMs(undefined), DEFAULT_CADENCE_MS);
  });

  test('an unrecognised word falls back to DEFAULT_CADENCE_MS, never throws', () => {
    assert.equal(resolveCadenceMs('monthly'), DEFAULT_CADENCE_MS);
  });

  test('a non-string falls back to DEFAULT_CADENCE_MS, never throws', () => {
    assert.equal(resolveCadenceMs(42), DEFAULT_CADENCE_MS);
    assert.equal(resolveCadenceMs(null), DEFAULT_CADENCE_MS);
    assert.equal(resolveCadenceMs({}), DEFAULT_CADENCE_MS);
  });
});

// ── All four states reachable ───────────────────────────────────────────────

describe('foldPeriodicalRuns — all four states', () => {
  test('due: a taken history row older than one cadence period, no queue row', () => {
    const t = template({ cadence: 'weekly' });
    const rows = {
      historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - WEEK_MS - DAY_MS).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'due');
  });

  test('recent: a taken history row within one cadence period, no queue row', () => {
    const t = template({ cadence: 'weekly' });
    const rows = {
      historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - DAY_MS).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'recent');
  });

  test('never: no matched row at all, and the horizon is not narrower than the store\'s retention', () => {
    const t = template();
    const [result] = foldPeriodicalRuns([t], {}, { now: NOW, horizonMs: DEFAULT_HORIZON_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'never');
  });

  test('unknown (synthetic): no matched row, horizon narrower than the store\'s retention', () => {
    // Unreachable by any production caller at HEAD — both `horizonMs` and the
    // store's `historyTtlMs` default to 30 days, so `effectiveHorizonMs`
    // always equals `historyTtlMs` in production. This fixture forces
    // `horizonMs < historyTtlMs` to exercise the defensive branch directly,
    // per research beat 3 §2 — kept so a future reader does not delete it as
    // dead code.
    const t = template();
    const [result] = foldPeriodicalRuns([t], {}, { now: NOW, horizonMs: 7 * DAY_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'unknown');
  });
});

// ── due/recent boundary, in milliseconds ────────────────────────────────────

describe('foldPeriodicalRuns — due/recent boundary (ms, inclusive)', () => {
  test('at exactly one cadence period elapsed, state is due (>=, not >)', () => {
    const t = template({ cadence: 'weekly' });
    const rows = {
      historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - WEEK_MS).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'due');
  });

  test('one millisecond short of one cadence period, state is recent', () => {
    const t = template({ cadence: 'weekly' });
    const rows = {
      historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - WEEK_MS + 1).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'recent');
  });

  test('the boundary is never read through the floored daysSince field (a same-day cadence would misfire on <1-day floors)', () => {
    // A cadence far under a day makes the point concrete: if state were
    // compared via floored daysSince (always 0 for a same-day gap), this
    // would incorrectly read `recent` forever. Comparing in ms gets it right.
    const t = template({ cadence: 'weekly' });
    const twoWeeksMs = 2 * WEEK_MS;
    const rows = {
      historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - twoWeeksMs).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'due');
    assert.equal(result.daysSince, 14);
  });
});

// ── Joins ────────────────────────────────────────────────────────────────────

describe('foldPeriodicalRuns — joins', () => {
  test('periodicalId wins over a title match when both could apply', () => {
    const docReview = template({ id: 'documentation-review', title: 'Documentation Review' });
    const secReview = template({ id: 'security-review', title: 'Security Review' });
    // promptName would title-match secReview, but periodicalId points at docReview.
    const rows = {
      historyRows: [historyRow({ periodicalId: 'documentation-review', promptName: 'Security Review', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })]
    };
    const [doc, sec] = foldPeriodicalRuns([docReview, secReview], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(doc.runs, 1);
    assert.equal(sec.runs, 0);
  });

  test('title fallback applies only when periodicalId is absent (null)', () => {
    const t = template({ id: 'documentation-review', title: 'Documentation Review' });
    const rows = {
      historyRows: [historyRow({ periodicalId: null, promptName: 'Documentation Review', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
  });

  test('title fallback matches the exact title', () => {
    const t = template({ title: 'Documentation Review' });
    const rows = { historyRows: [historyRow({ periodicalId: null, promptName: 'Documentation Review', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
  });

  test('title fallback matches the "<title> + Autopilot" suffix (Mint + Autopilot dispatch)', () => {
    const t = template({ title: 'Documentation Review' });
    const rows = { historyRows: [historyRow({ periodicalId: null, promptName: 'Documentation Review + Autopilot', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
  });

  test('title fallback is exact-or-suffix only, never a startsWith/prefix match', () => {
    const t = template({ title: 'Documentation Review' });
    const rows = { historyRows: [historyRow({ periodicalId: null, promptName: 'Documentation Review Extended', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.state, 'never');
  });

  test('an ambiguous title match (row matches two templates) resolves to no template, not shared evidence', () => {
    const a = template({ id: 'a', title: 'Shared Title' });
    const b = template({ id: 'b', title: 'Shared Title' });
    const rows = { historyRows: [historyRow({ periodicalId: null, promptName: 'Shared Title', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [resultA, resultB] = foldPeriodicalRuns([a, b], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(resultA.runs, 0);
    assert.equal(resultB.runs, 0);
  });

  test('title fallback applies to queue rows too, not just history rows (AC3)', () => {
    // Every other join test in this block runs on historyRows; _resolveTemplateForRow
    // is shared code, but "uniformly across both reads" was an inference until
    // pinned here (review F3).
    const t = template({ title: 'Documentation Review' });
    const rows = { queueRows: [queueRow({ periodicalId: null, promptName: 'Documentation Review' })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'recent');
  });

  test('a stamped-but-unmatched periodicalId (a since-removed template) contributes to nothing and throws nothing', () => {
    const t = template({ id: 'documentation-review' });
    const rows = {
      historyRows: [historyRow({ periodicalId: 'a-removed-template-id', promptName: 'Documentation Review', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })]
    };
    assert.doesNotThrow(() => {
      const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
      // No fallback to the (matching) title, per the module's join rule.
      assert.equal(result.runs, 0);
      assert.equal(result.state, 'never');
    });
  });
});

// ── Evidence rules ───────────────────────────────────────────────────────────

describe('foldPeriodicalRuns — evidence rules', () => {
  test("only a 'taken' history row counts as run evidence", () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, status: 'taken', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
    assert.equal(result.state, 'recent');
  });

  test("a 'cancelled' history row is excluded from runs and lastDispatchedAt", () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, status: 'cancelled', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.lastDispatchedAt, null);
    assert.equal(result.state, 'never');
  });

  test("an 'expired' history row is excluded from runs and lastDispatchedAt", () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, status: 'expired', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.state, 'never');
  });

  test('a history row with followUpTo set is excluded even when otherwise taken', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, status: 'taken', followUpTo: 'some-earlier-dispatch-id', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.state, 'never');
  });

  test('a history row with abort === true is excluded even when otherwise taken', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, status: 'taken', abort: true, dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.state, 'never');
  });

  test('a queue row with followUpTo set does not contribute to recent', () => {
    const t = template();
    const rows = { queueRows: [queueRow({ periodicalId: t.id, followUpTo: 'some-earlier-dispatch-id' })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'never');
  });

  test('a queue row with abort === true does not contribute to recent', () => {
    const t = template();
    const rows = { queueRows: [queueRow({ periodicalId: t.id, abort: true })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'never');
  });

  test('cancelled/expired rows newer than the newest taken row do not win the max or inflate runs (AC4)', () => {
    // The shape AC4 demands to the line: excluded rows placed NEWER than the
    // taken row, with runs AND lastDispatchedAt (and the state it drives)
    // both asserted — a mutant that filters `runs` by status but takes the
    // max over every non-excluded row passes if either assertion is dropped
    // (review F1: it reports `recent` when the truth is `due`).
    const t = template({ cadence: 'weekly' });
    const takenAt = new Date(NOW - 14 * DAY_MS).toISOString();
    const rows = {
      historyRows: [
        historyRow({ periodicalId: t.id, status: 'taken', dispatchedAt: takenAt }),
        historyRow({ periodicalId: t.id, status: 'cancelled', dispatchedAt: new Date(NOW - DAY_MS).toISOString() }),
        historyRow({ periodicalId: t.id, status: 'expired', dispatchedAt: new Date(NOW - DAY_MS).toISOString() })
      ]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
    assert.equal(result.lastDispatchedAt, new Date(takenAt).getTime());
    assert.equal(result.daysSince, 14);
    assert.equal(result.state, 'due');
  });
});

// ── Queue precedence ─────────────────────────────────────────────────────────

describe('foldPeriodicalRuns — queue precedence', () => {
  test('a live queue row reads recent even when history alone would say due', () => {
    const t = template({ cadence: 'weekly' });
    const rows = {
      queueRows: [queueRow({ periodicalId: t.id })],
      historyRows: [historyRow({ periodicalId: t.id, status: 'taken', dispatchedAt: new Date(NOW - WEEK_MS - DAY_MS).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'recent');
  });

  test('a queue row needs no status field at all to contribute recent — queue docs carry none', () => {
    const t = template();
    const row = queueRow({ periodicalId: t.id });
    assert.equal('status' in row, false);
    const [result] = foldPeriodicalRuns([t], { queueRows: [row] }, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'recent');
  });
});

// ── Per-repo lanes (LIN-1932 beat 2: B4, B7) ────────────────────────────────

describe('foldPeriodicalRuns — per-repo lanes (LIN-1932)', () => {
  test('B4: a live queue row for repo-a does not mark repo-b recent — rule 1 is per-lane, not per-template', () => {
    // Direct mutant-killer for `hasRecentQueueRow.set(template.id, true)`
    // (unconditional per template) surviving unchanged: that shape would
    // mark repo-b recent too, even though repo-b has no queue row of its
    // own and its own history is aged past cadence.
    const t = template({ cadence: 'weekly' });
    const rows = {
      queueRows: [queueRow({ periodicalId: t.id, repo: 'repo-a' })],
      historyRows: [historyRow({ periodicalId: t.id, repo: 'repo-b', status: 'taken', dispatchedAt: new Date(NOW - WEEK_MS - DAY_MS).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    const repoALane = result.repos.find(l => l.repo === 'repo-a');
    const repoBLane = result.repos.find(l => l.repo === 'repo-b');
    assert.ok(repoALane, 'expected a repo-a lane');
    assert.ok(repoBLane, 'expected a repo-b lane');
    assert.equal(repoALane.state, 'recent');
    assert.equal(repoBLane.state, 'due');
  });

  test('B7: a history row aged out of the effective horizon leaves no inner lane Map — top-level AND lane read null/never/null, never -Infinity/due', () => {
    // The empty-inner-Map hazard (plan-review f1ef4ad9 blocking finding): an
    // inner Map created but left empty would send Math.max() an empty
    // argument list (-Infinity), flipping state to 'due' and, at the wire
    // boundary, throwing RangeError on `new Date(-Infinity).toISOString()`.
    // The invariant (getOrCreate only at first write, after the horizon
    // guard) means this template's inner Maps are never created at all.
    const t = template();
    const rows = {
      historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - 40 * DAY_MS).toISOString() })]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, horizonMs: HISTORY_TTL_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.lastDispatchedAt, null);
    assert.equal(result.state, 'never');
    assert.equal(result.daysSince, null);
    // Same guard, pinned at the per-lane emit path too — not exercised by
    // the pre-existing top-level-only backstop at :443, since that test
    // predates the `repos` field.
    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].isDefault, true);
    assert.equal(result.repos[0].state, 'never');
    assert.equal(result.repos[0].lastDispatchedAt, null);
    assert.equal(result.repos[0].daysSince, null);
  });
});

// ── Retention boundary (never vs unknown) ──────────────────────────────────

describe('foldPeriodicalRuns — retention boundary', () => {
  test('effectiveHorizonMs === historyTtlMs (horizonMs >= historyTtlMs) with no matched row → never', () => {
    const t = template();
    const [result] = foldPeriodicalRuns([t], {}, { now: NOW, horizonMs: HISTORY_TTL_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'never');
  });

  test('a larger horizonMs than historyTtlMs is still capped at historyTtlMs → never', () => {
    const t = template();
    const [result] = foldPeriodicalRuns([t], {}, { now: NOW, horizonMs: HISTORY_TTL_MS * 2, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'never');
  });

  test('effectiveHorizonMs < historyTtlMs (horizonMs narrower) with no matched row → unknown', () => {
    const t = template();
    const [result] = foldPeriodicalRuns([t], {}, { now: NOW, horizonMs: HISTORY_TTL_MS - 1, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.state, 'unknown');
  });
});

// ── Effective horizon is re-applied to history rows (review F2) ────────────

describe('foldPeriodicalRuns — effective horizon filters history rows, not just the never/unknown split', () => {
  // Plan test 8: three points at the same injected `now` around the
  // effective-horizon edge (`now - effectiveHorizonMs`), asserting
  // included / included / excluded. Before this fix, no row was ever age-filtered
  // by the fold at all — a caller's `since` was trusted blindly.
  const edge = NOW - HISTORY_TTL_MS;

  test('a history row exactly at the effective horizon boundary is included ($gte parity)', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(edge).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, horizonMs: HISTORY_TTL_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
  });

  test('a history row 1ms inside (newer than) the effective horizon boundary is included', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(edge + 1).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, horizonMs: HISTORY_TTL_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
  });

  test('a history row 1ms outside (older than) the effective horizon boundary is excluded', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(edge - 1).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, horizonMs: HISTORY_TTL_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.state, 'never');
  });

  test('a taken row older than the store\'s own retention (40d, 30d TTL) is excluded, not read as due', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - 40 * DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, horizonMs: HISTORY_TTL_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.state, 'never');
  });

  test('a caller-narrowed horizonMs (7d) excludes a 20d-old taken row even though historyTtlMs (30d) alone would not', () => {
    // The exact probe from the review: without the fold re-applying
    // effectiveHorizonMs, the caller's narrower horizon was silently ignored.
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - 20 * DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, horizonMs: 7 * DAY_MS, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 0);
    assert.equal(result.state, 'unknown');
  });
});

// ── Timestamp tolerance ──────────────────────────────────────────────────────

describe('foldPeriodicalRuns — dispatchedAt tolerance', () => {
  test('an ISO string dispatchedAt parses normally', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: '2026-08-02T00:00:00.000Z' })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
    assert.equal(result.lastDispatchedAt, new Date('2026-08-02T00:00:00.000Z').getTime());
  });

  test('a Date object dispatchedAt parses normally', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date('2026-08-02T00:00:00.000Z') })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.runs, 1);
    assert.equal(result.lastDispatchedAt, new Date('2026-08-02T00:00:00.000Z').getTime());
  });

  test('an absent dispatchedAt is skipped — no throw, no evidence contributed', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: undefined })] };
    assert.doesNotThrow(() => {
      const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
      assert.equal(result.runs, 0);
      assert.equal(result.state, 'never');
    });
  });

  test('a garbage dispatchedAt is skipped — no throw, no evidence contributed', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: 'not-a-real-date' })] };
    assert.doesNotThrow(() => {
      const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
      assert.equal(result.runs, 0);
      assert.equal(result.state, 'never');
    });
  });
});

// ── daysSince ─────────────────────────────────────────────────────────────────

describe('foldPeriodicalRuns — daysSince', () => {
  test('is floored, not rounded', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - (2 * DAY_MS + 23 * 60 * 60 * 1000)).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.daysSince, 2);
  });

  test('is null when there is no matched evidence', () => {
    const t = template();
    const [result] = foldPeriodicalRuns([t], {}, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.daysSince, null);
  });

  test('is null when lastDispatchedAt is future-dated relative to now (clock skew), not negative', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW + DAY_MS).toISOString() })] };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.daysSince, null);
  });
});

// ── historyTtlMs is a required contract, not tolerant row data (review F4) ──

describe('foldPeriodicalRuns — historyTtlMs is required', () => {
  test('an omitted historyTtlMs throws rather than silently degrading every template to unknown', () => {
    const t = template();
    assert.throws(() => foldPeriodicalRuns([t], {}, { now: NOW }), TypeError);
  });

  test('a non-finite historyTtlMs (NaN) throws', () => {
    const t = template();
    assert.throws(() => foldPeriodicalRuns([t], {}, { now: NOW, historyTtlMs: NaN }), TypeError);
  });
});

// ── Registry cadence stays in sync with CADENCE_MS ──────────────────────────

describe('foldPeriodicalRuns — registry cadence consistency', () => {
  test('every PERIODICALS entry\'s cadence is a recognised key of CADENCE_MS', () => {
    // A registry entry whose cadence isn't a CADENCE_MS key silently falls
    // through resolveCadenceMs's fallback — this fails loudly instead so a
    // future entry with an unrecognised cadence string is caught here rather
    // than discovered as a due/recent misread in production.
    for (const p of PERIODICALS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CADENCE_MS, p.cadence),
        `PERIODICALS entry '${p.id}' has cadence '${p.cadence}', not a recognised key of CADENCE_MS`
      );
    }
  });
});

// ── mode/cadence carried through ────────────────────────────────────────────

describe('foldPeriodicalRuns — mode/cadence pass-through', () => {
  test('mode and cadence are carried straight through from the matched template, not re-derived', () => {
    const t = template({ mode: 'advisory', cadence: 'weekly' });
    const [result] = foldPeriodicalRuns([t], {}, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.mode, 'advisory');
    assert.equal(result.cadence, 'weekly');
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('foldPeriodicalRuns — determinism', () => {
  test('identical inputs + identical injected now produce identical output (the fold reads no clock)', () => {
    const t = template();
    const rows = { historyRows: [historyRow({ periodicalId: t.id, dispatchedAt: new Date(NOW - DAY_MS).toISOString() })] };
    const opts = { now: NOW, historyTtlMs: HISTORY_TTL_MS };
    const first = foldPeriodicalRuns([t], rows, opts);
    const second = foldPeriodicalRuns([t], rows, opts);
    assert.deepEqual(first, second);
  });
});

// ── Projection self-check ────────────────────────────────────────────────────

describe('foldPeriodicalRuns — projection coverage', () => {
  test('every row field the fold reads is a key of PERIODICAL_PROJECTION', () => {
    // Ties this module to lib/dispatch-store.js's PERIODICAL_PROJECTION so a
    // future field the fold starts reading, but the projection doesn't grant,
    // fails loudly here rather than silently arriving as `undefined` in
    // production — the exact silent-drop class both plan reviews caught for
    // followUpTo/abort.
    const fieldsTheFoldReads = ['periodicalId', 'promptName', 'dispatchedAt', 'status', 'followUpTo', 'abort', 'repo'];
    for (const field of fieldsTheFoldReads) {
      assert.equal(PERIODICAL_PROJECTION[field], 1, `PERIODICAL_PROJECTION is missing '${field}'`);
    }
  });
});

// ── Order independence (the property this beat exists to pin) ──────────────

describe('foldPeriodicalRuns — lastDispatchedAt order independence (blocking correction 2)', () => {
  // Hand-fixture, not round-trip: this needs no backend at all to prove — a
  // plain array with the non-max row placed first is sufficient to fail an
  // `rows[0]` implementation unconditionally, with no dependence on emergent
  // MangoDB/Mongo read order. The round-trip group below separately exercises
  // the same property against a real store, where an `rows[0]`-shaped bug
  // could otherwise hide behind incidental insertion order — this test is
  // the one that fails it no matter what, regardless of backend.
  test('a non-max dispatchedAt FIRST in the input array does not win — lastDispatchedAt is the true max', () => {
    const t = template();
    const older = '2026-07-20T00:00:00.000Z';
    const newer = '2026-08-01T00:00:00.000Z';
    const rows = {
      historyRows: [
        historyRow({ periodicalId: t.id, dispatchedAt: older }), // non-max, listed first
        historyRow({ periodicalId: t.id, dispatchedAt: newer })  // true max, listed second
      ]
    };
    const [result] = foldPeriodicalRuns([t], rows, { now: NOW, historyTtlMs: HISTORY_TTL_MS });
    assert.equal(result.lastDispatchedAt, new Date(newer).getTime());
    assert.equal(result.runs, 2);
  });
});

// ── Round-trip (real MangoDB tmpdir — see file header for why) ─────────────

describe('periodical-runs round-trip (real MangoDB tmpdir)', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'periodical-runs-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`periodical_runs_${counter++}`);
    return new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history')
    });
  }

  // A projection missing exactly the two fields blocking corrections 1/2
  // depend on — the falsification probe: this is what proves the vehicle CAN
  // fail on a wrong projection, unlike tests/fixtures/mock-collection.js,
  // which honours exclusion projections only and silently leaks every field
  // back regardless of an inclusion projection like PERIODICAL_PROJECTION.
  const PROJECTION_MISSING_EXCLUSION_FIELDS = {
    kind: 1, periodicalId: 1, promptName: 1, dispatchedAt: 1, status: 1
  };

  test('PERIODICAL_PROJECTION survives a real archive round trip: followUpTo, abort, periodicalId, promptName, dispatchedAt, status, kind all read back', async () => {
    const store = freshStore();
    const created = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: 'Documentation Review',
      kind: 'custom',
      periodicalId: 'documentation-review',
      followUpTo: 'an-earlier-dispatch-id',
      abort: true
    });
    await store.takeItem(created._id, URL_KEY, 'token-a');

    const { items } = await store.listHistory(URL_KEY, { projection: PERIODICAL_PROJECTION });
    assert.equal(items.length, 1);
    const [row] = items;
    assert.equal(row.kind, 'custom');
    assert.equal(row.periodicalId, 'documentation-review');
    assert.equal(row.promptName, 'Documentation Review');
    assert.equal(row.status, 'taken');
    assert.equal(row.followUpTo, 'an-earlier-dispatch-id');
    assert.equal(row.abort, true);
    assert.ok(row.dispatchedAt, 'dispatchedAt must be present');
    assert.equal(new Date(row.dispatchedAt).getTime(), created.dispatchedAt.getTime());
  });

  test('the SAME row read under a deliberately incomplete projection loses followUpTo/abort — proving this vehicle can fail (unlike the mock)', async () => {
    const store = freshStore();
    const created = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: 'Documentation Review',
      kind: 'custom',
      periodicalId: 'documentation-review',
      followUpTo: 'an-earlier-dispatch-id',
      abort: true
    });
    await store.takeItem(created._id, URL_KEY, 'token-a');

    const { items } = await store.listHistory(URL_KEY, { projection: PROJECTION_MISSING_EXCLUSION_FIELDS });
    assert.equal(items.length, 1);
    const [row] = items;
    // The fields the wrong projection omitted come back falsy — this is the
    // exact silent-drop shape the first plan-review caught for the ORIGINAL
    // PERIODICAL_PROJECTION draft (which omitted followUpTo/abort for real).
    assert.equal(row.followUpTo, null);
    assert.equal(row.abort, false);
    // Fields the wrong projection still grants keep reading correctly —
    // confirms the failure above is projection-shaped, not a broken store.
    assert.equal(row.periodicalId, 'documentation-review');
    assert.equal(row.status, 'taken');
  });

  // LIN-1932 beat 1, B3: falsification probe. PERIODICAL_PROJECTION at HEAD
  // does not yet include `repo: 1` — this is the deliberately-incomplete
  // projection for THIS bug (no separate constant needed, since the
  // production projection itself is what's missing the field). Proves the
  // silent drop is real against the store's actual read path, and that it
  // is projection-shaped, not a broken store: periodicalId/status (fields
  // the projection DOES grant) keep reading correctly on the same row.
  test('LIN-1932 B3: a repo-stamped row reads back repo: null under PERIODICAL_PROJECTION (repo not yet projected), while periodicalId/status still read correctly', async () => {
    const store = freshStore();
    const created = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: 'Documentation Review',
      kind: 'custom',
      periodicalId: 'documentation-review',
      repo: 'repo-a'
    });
    await store.takeItem(created._id, URL_KEY, 'token-a');

    const { items } = await store.listHistory(URL_KEY, { projection: PERIODICAL_PROJECTION });
    assert.equal(items.length, 1);
    const [row] = items;
    // This is the bug: PERIODICAL_PROJECTION at HEAD has no `repo: 1`, so a
    // genuinely repo-stamped row silently reads back `repo: null` instead of
    // 'repo-a'. Must fail until beat 2 adds `repo: 1` to the projection.
    assert.equal(row.repo, 'repo-a');
    assert.equal(row.periodicalId, 'documentation-review');
    assert.equal(row.status, 'taken');
  });

  // LIN-1932 beat 1, B1: history-lane split. Two archived `taken` rows for
  // ONE template — repo-a and the default (null) lane — both in-window.
  // Read with a projection that DOES include repo (repo: 1 added on top of
  // PERIODICAL_PROJECTION) so this test exercises the FOLD's re-key, not the
  // projection gap B3 already covers on its own. Asserts two DISTINCT lanes,
  // runs: 1 each — not merely "a repo-a lane exists" (the plan is explicit
  // that a fold which duplicated every row onto every lane would also pass
  // that weaker assertion).
  test('LIN-1932 B1: two taken rows (repo-a, default) for one template split into two lanes, runs: 1 each — not one merged lane', async () => {
    const store = freshStore();
    const repoProjection = { ...PERIODICAL_PROJECTION, repo: 1 };
    const t = template({ id: 'documentation-review', title: 'Documentation Review' });

    const repoARow = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: t.title,
      kind: 'custom',
      periodicalId: t.id,
      repo: 'repo-a'
    });
    await store.takeItem(repoARow._id, URL_KEY, 'token-a');

    // A small real delay, not a fabricated timestamp (mirrors the true-max
    // round-trip test below): addItem always stamps dispatchedAt from the
    // clock, so this only guarantees the default row lands strictly later,
    // making it the unambiguous max for the top-level assertion below.
    await new Promise(resolve => setTimeout(resolve, 5));

    const defaultRow = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: t.title,
      kind: 'custom',
      periodicalId: t.id,
      repo: null
    });
    await store.takeItem(defaultRow._id, URL_KEY, 'token-b');
    assert.ok(defaultRow.dispatchedAt.getTime() > repoARow.dispatchedAt.getTime(), 'test setup sanity: defaultRow must be strictly later than repoARow');

    const { items: historyRows } = await store.listHistory(URL_KEY, { projection: repoProjection });
    assert.equal(historyRows.length, 2);

    const [result] = foldPeriodicalRuns([t], { historyRows }, { now: NOW, historyTtlMs: HISTORY_TTL_MS });

    // Today (pre-re-key) the fold has no `repos` lane array at all — both
    // rows key on template.id alone and collapse into the single top-level
    // `runs: 2`. This must fail until beat 2 re-keys the fold's
    // accumulators onto (periodicalId, repo).
    assert.ok(Array.isArray(result.repos), 'foldPeriodicalRuns must return a `repos` lane array per template');
    assert.equal(result.repos.length, 2, 'expected exactly two lanes: repo-a and the default null lane');
    const repoALane = result.repos.find(l => l.repo === 'repo-a');
    const defaultLane = result.repos.find(l => l.repo === null);
    assert.ok(repoALane, 'expected a repo-a lane');
    assert.ok(defaultLane, 'expected a default (null) lane');
    assert.equal(repoALane.runs, 1);
    assert.equal(defaultLane.runs, 1);

    // §3 aggregation properties (beat 4 corrective): every OTHER `runs`
    // assertion in this file sits on a single-lane fixture, where a sum is
    // indistinguishable from "return the first/only lane's count" — this is
    // the one two-lane fixture that can actually catch a mis-implementation
    // like `laneRuns.get(firstLane)` surviving in place of a real reduce.
    assert.equal(result.runs, 2, 'top-level runs must be the SUM across lanes (1 + 1), not either lane\'s own count');
    assert.equal(result.lastDispatchedAt, defaultRow.dispatchedAt.getTime(), 'top-level lastDispatchedAt must be the MAX across lanes (the later default-lane row), not repo-a\'s earlier one');
  });

  test('LIN-1932 B2: a live queue row for repo-a and an aged taken row for repo-b — repo-a reads recent, repo-b reads due, and no default lane is spuriously marked recent', async () => {
    const store = freshStore();
    const t = template({ id: 'documentation-review', title: 'Documentation Review', cadence: 'weekly' });

    // Live queue row for repo-a — never archived, so it stays on the queue
    // (the "in-flight run against repo A" the ticket's queue-half bug describes).
    await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: t.title,
      kind: 'custom',
      periodicalId: t.id,
      repo: 'repo-a'
    });

    // Archived taken row for repo-b, aged past the weekly cadence.
    const repoBRow = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: t.title,
      kind: 'custom',
      periodicalId: t.id,
      repo: 'repo-b'
    });
    await store.takeItem(repoBRow._id, URL_KEY, 'token-b');

    const queueRows = await store.listItems(URL_KEY, { projection: PERIODICAL_PROJECTION });
    const { items: historyRows } = await store.listHistory(URL_KEY, { projection: PERIODICAL_PROJECTION });
    assert.equal(queueRows.length, 1);
    assert.equal(historyRows.length, 1);

    // Inject `now` one cadence period + a day past repo-b's real dispatchedAt.
    const fakeNow = repoBRow.dispatchedAt.getTime() + WEEK_MS + DAY_MS;

    const [result] = foldPeriodicalRuns([t], { queueRows, historyRows }, { now: fakeNow, historyTtlMs: HISTORY_TTL_MS });

    const repoALane = result.repos.find(l => l.repo === 'repo-a');
    const repoBLane = result.repos.find(l => l.repo === 'repo-b');
    const defaultLane = result.repos.find(l => l.isDefault);

    assert.ok(repoALane, 'expected a repo-a lane');
    assert.ok(repoBLane, 'expected a repo-b lane');
    assert.equal(repoALane.state, 'recent');
    assert.equal(repoBLane.state, 'due');
    // The load-bearing assertion: neither row was stamped repo: null, so no
    // default lane should appear at all. Pre-fix, an unprojected queue row
    // silently read repo: null and put the in-flight run on the DEFAULT
    // lane instead of repo-a's own — exactly the direction that points at
    // re-dispatching a run already underway.
    assert.equal(defaultLane, undefined, 'no row here was stamped repo: null — a default lane appearing at all would mean the projection or fold miscategorized a repo-stamped row');
  });

  test('PERIODICAL_PROJECTION survives a real queue-row round trip too (no status field — queue docs carry none)', async () => {
    const store = freshStore();
    const created = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: 'Documentation Review',
      kind: 'custom',
      periodicalId: 'documentation-review',
      followUpTo: 'an-earlier-dispatch-id',
      abort: true
    });

    const items = await store.listItems(URL_KEY, { projection: PERIODICAL_PROJECTION });
    assert.equal(items.length, 1);
    const [row] = items;
    assert.equal(row.kind, 'custom');
    assert.equal(row.periodicalId, 'documentation-review');
    assert.equal(row.promptName, 'Documentation Review');
    assert.equal(row.followUpTo, 'an-earlier-dispatch-id');
    assert.equal(row.abort, true);
    assert.ok(row.dispatchedAt, 'dispatchedAt must be present');
    assert.equal(new Date(row.dispatchedAt).getTime(), created.dispatchedAt.getTime());
  });

  // Remedy (a), blocking correction 2: this is the property two plan reviews
  // found unpinned. `addItem` stamps `dispatchedAt` itself (a caller-supplied
  // value is ignored), so rows are created ascending by construction — the
  // only way to get a non-max row first is to control ARCHIVE order instead.
  // `_archiveItem` strips `resolvedAt` under PERIODICAL_PROJECTION (it isn't
  // one of the projected fields) and `listHistory`'s unlimited branch issues
  // no `.sort()`, so once `resolvedAt` is gone what the read reflects is
  // archive/insertion order, not chronological order. Archiving OLDEST-first
  // therefore leaves the non-max row first in the read — the failing
  // direction for an `rows[0]` implementation. Archiving newest-first would
  // be the vacuous direction (an `rows[0]` bug would pass by accident), which
  // is exactly why it is not used here.
  test('lastDispatchedAt is the true max over a real archive round trip, even when the OLDER row is archived (and so read back) first', async () => {
    const store = freshStore();
    const t = template({ id: 'documentation-review', title: 'Documentation Review' });

    const older = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: t.title,
      kind: 'custom',
      periodicalId: t.id
    });
    // A small real delay, not a fabricated timestamp: addItem always stamps
    // `dispatchedAt` from the clock, so this only guarantees the two calls
    // land in genuinely distinct, ascending milliseconds.
    await new Promise(resolve => setTimeout(resolve, 5));
    const newer = await store.addItem(URL_KEY, {
      prompt: 'run the review',
      promptName: t.title,
      kind: 'custom',
      periodicalId: t.id
    });
    assert.ok(newer.dispatchedAt.getTime() > older.dispatchedAt.getTime(), 'test setup sanity: newer must be strictly later than older');

    // Archive OLDEST-first — the failing direction for rows[0] (see comment above).
    await store.takeItem(older._id, URL_KEY, 'token-a');
    await store.takeItem(newer._id, URL_KEY, 'token-a');

    const { items: historyRows } = await store.listHistory(URL_KEY, { projection: PERIODICAL_PROJECTION });
    assert.equal(historyRows.length, 2);
    assert.equal(historyRows[0].dispatchedAt, older.dispatchedAt.toISOString(), 'sanity: archive order put the non-max row first in the read');

    const [result] = foldPeriodicalRuns([t], { historyRows }, {
      now: newer.dispatchedAt.getTime() + 1000,
      historyTtlMs: store.historyTtl * 1000
    });
    assert.equal(result.lastDispatchedAt, newer.dispatchedAt.getTime());
    assert.equal(result.runs, 2);
  });
});
