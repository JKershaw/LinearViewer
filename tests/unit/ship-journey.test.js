/**
 * Unit tests for ship-journey.js — deriveJourney derivation library.
 *
 * Run with: node --test tests/unit/ship-journey.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { deriveJourney, MAX_TURN_DEGREES } from '../../lib/ship-journey.js';
import { ORIENTATION_CANDIDATE_CAP } from '../../lib/prompts/roadmap-orientation-template.js';

// =============================================================================
// Test Helpers — local synthetic fixture factories
// =============================================================================

let counter = 0;

function createReport(overrides = {}) {
  counter++;
  return {
    id: overrides.id || `report-${counter}`,
    generatedAt: overrides.generatedAt || '2026-01-01T00:00:00Z',
    model: overrides.model || 'gpt-5.4-mini',
    northStar: overrides.northStar !== undefined ? overrides.northStar : '',
    narrative: overrides.narrative || '',
    orientation: overrides.orientation || [],
    ...overrides
  };
}

function createIssue(overrides = {}) {
  counter++;
  return {
    id: overrides.id || `issue-${counter}`,
    identifier: overrides.identifier || `TEST-${counter}`,
    title: overrides.title || `Test Issue ${counter}`,
    description: overrides.description ?? '',
    estimate: overrides.estimate ?? null,
    priority: overrides.priority ?? 2,
    sortOrder: overrides.sortOrder ?? counter,
    createdAt: overrides.createdAt || '2024-01-01T00:00:00Z',
    dueDate: overrides.dueDate || null,
    completedAt: overrides.completedAt ?? null,
    url: '',
    parent: overrides.parent || null,
    project: overrides.project || { id: 'proj-1', name: 'Project Alpha' },
    state: overrides.state || { name: 'Todo', type: 'unstarted' },
    assignee: overrides.assignee || null,
    labels: overrides.labels || { nodes: [] },
    relations: overrides.relations || { nodes: [] },
    ...overrides
  };
}

function createOrientationEntries(count, { includeArchived = 0, prefix = 'E' } = {}) {
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      identifier: `${prefix}-${i}`,
      bearing: 'N',
      reason: '',
      archived: i < includeArchived
    });
  }
  return entries;
}

// =============================================================================
// deriveJourney
// =============================================================================

describe('deriveJourney', () => {

  // ── scenario 1: no reports at all ──────────────────────────────────────────

  test('returns empty shape when no reports are provided', () => {
    const result = deriveJourney({ reports: [], issues: [] });

    assert.deepStrictEqual(result.waypoints, []);
    assert.deepStrictEqual(result.coverage, { completions: 0, ratio: null, span: null });
    assert.deepStrictEqual(result.capDropped, { atCapCount: 0, totalReports: 0, message: null });
    assert.deepStrictEqual(result.starChanges, []);

    for (const key of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) {
      assert.strictEqual(result.bearingHistogram[key], 0, `histogram.${key} should be 0`);
    }
  });

  // ── scenario 2: only empty orientations ────────────────────────────────────

  test('reports with empty orientations still populate span and totals', () => {
    const reports = [
      createReport({ generatedAt: '2026-01-01T00:00:00Z', orientation: [] }),
      createReport({ generatedAt: '2026-01-05T00:00:00Z', orientation: [] })
    ];

    const result = deriveJourney({ reports, issues: [] });

    assert.deepStrictEqual(result.waypoints, []);
    assert.strictEqual(result.capDropped.totalReports, 2);
    assert.deepStrictEqual(result.coverage.span, {
      oldest: '2026-01-01T00:00:00Z',
      newest: '2026-01-05T00:00:00Z'
    });
  });

  // ── scenario 3: scored + never-scored completions ──────────────────────────

  test('counts never-scored completions in coverage but not in waypoints', () => {
    const reports = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        orientation: [
          { identifier: 'SCORED', bearing: 'N', reason: '', archived: false }
        ]
      })
    ];

    const issues = [
      createIssue({
        identifier: 'SCORED',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-01T00:00:00Z'
      }),
      createIssue({
        identifier: 'UNSCORED',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-01T00:00:00Z'
      })
    ];

    const result = deriveJourney({ reports, issues });

    assert.strictEqual(result.waypoints.length, 1);
    assert.strictEqual(result.waypoints[0].identifier, 'SCORED');
    assert.strictEqual(result.coverage.completions, 2);
    assert.ok(result.coverage.ratio < 1);
  });

  // ── scenario 4: canceled / duplicate / still-open excluded ─────────────────

  test('excludes canceled duplicate and unstarted identifiers from waypoints', () => {
    const reports = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        orientation: [
          { identifier: 'CANCELED', bearing: 'N', reason: '', archived: false },
          { identifier: 'DUP', bearing: 'NE', reason: '', archived: false },
          { identifier: 'OPEN', bearing: 'E', reason: '', archived: false },
          { identifier: 'DONE', bearing: 'SE', reason: '', archived: false }
        ]
      })
    ];

    const issues = [
      createIssue({
        identifier: 'CANCELED',
        state: { name: 'Canceled', type: 'canceled' },
        completedAt: '2026-01-01T00:00:00Z'
      }),
      createIssue({
        identifier: 'DUP',
        state: { name: 'Duplicate', type: 'duplicate' },
        completedAt: '2026-01-01T00:00:00Z'
      }),
      createIssue({
        identifier: 'OPEN',
        state: { name: 'In Progress', type: 'started' }
      }),
      createIssue({
        identifier: 'DONE',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-01T00:00:00Z'
      })
    ];

    const result = deriveJourney({ reports, issues });

    assert.strictEqual(result.waypoints.length, 1, 'only the completed issue should produce a waypoint');
    assert.strictEqual(result.waypoints[0].identifier, 'DONE');
  });

  // ── scenario 5: north-star change with empty-snapshot run between ───────────

  test('skips empty northStar snapshots entirely in star diffing', () => {
    // Sub-case A: 'x' → '' → 'x' yields zero starChanges
    const reportsA = [
      createReport({ generatedAt: '2026-01-01T00:00:00Z', northStar: 'x' }),
      createReport({ generatedAt: '2026-01-02T00:00:00Z', northStar: '' }),
      createReport({ generatedAt: '2026-01-03T00:00:00Z', northStar: 'x' })
    ];

    const resultA = deriveJourney({ reports: reportsA, issues: [] });
    assert.deepStrictEqual(resultA.starChanges, [],
      "'x' → '' → 'x' must produce zero starChanges");

    // Sub-case B: 'x' → '' → 'y' yields exactly one {from:'x', to:'y'}
    const reportsB = [
      createReport({ generatedAt: '2026-01-01T00:00:00Z', northStar: 'x' }),
      createReport({ generatedAt: '2026-01-02T00:00:00Z', northStar: '' }),
      createReport({ generatedAt: '2026-01-03T00:00:00Z', northStar: 'y' })
    ];

    const resultB = deriveJourney({ reports: reportsB, issues: [] });
    assert.strictEqual(resultB.starChanges.length, 1,
      "'x' → '' → 'y' must yield exactly one starChange");
    assert.deepStrictEqual(resultB.starChanges[0], {
      from: 'x',
      to: 'y',
      at: '2026-01-03T00:00:00Z'
    });
  });

  // ── scenario 6: below-threshold waypoint count ─────────────────────────────

  test('returns a small number of waypoints plainly with no internal gating', () => {
    const reports = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        orientation: [
          { identifier: 'T-A', bearing: 'N', reason: '', archived: false }
        ]
      })
    ];
    const issues = [
      createIssue({
        identifier: 'T-A',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-01T00:00:00Z'
      })
    ];

    const result = deriveJourney({ reports, issues });

    assert.strictEqual(result.waypoints.length, 1);
    assert.strictEqual(result.bearingHistogram.N, 1);
    // coverage still computed honestly
    assert.strictEqual(result.coverage.completions, 1);
    assert.strictEqual(result.coverage.ratio, 1);
  });

  // ── scenario 7: newest-vs-oldest bearing selection ─────────────────────────

  // Fixture is newest-first — the order ReportHistoryStore.listFull() actually
  // returns (`_docsSorted()` sorts descending by generatedAt) and therefore the
  // order the sole intended caller (P3/LIN-1685) will hand in. Every other
  // fixture in this file happens to arrive pre-sorted ascending, which leaves
  // `sortReportsChronological` completely unexercised — deleting that line
  // left the suite green. This scenario is what pins it (LIN-1684 review).
  test('selects the newest pre-completion bearing for each identifier', () => {
    const reports = [
      createReport({
        generatedAt: '2026-01-02T00:00:00Z',
        northStar: 'star-B',
        orientation: [
          { identifier: 'T-X', bearing: 'E', reason: '', archived: false }
        ]
      }),
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        northStar: 'star-A',
        orientation: [
          { identifier: 'T-X', bearing: 'N', reason: '', archived: false }
        ]
      })
    ]; // newest-first — the order listFull() actually returns

    const issues = [
      createIssue({
        identifier: 'T-X',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-03T00:00:00Z'
      })
    ];

    const result = deriveJourney({ reports, issues });

    assert.strictEqual(result.waypoints.length, 1);
    assert.strictEqual(result.waypoints[0].bearing, 'E',
      'waypoint must carry the NEWEST bearing (E), not the first-seen entry of an unsorted array (N)');
    assert.deepStrictEqual(result.starChanges, [
      { from: 'star-A', to: 'star-B', at: '2026-01-02T00:00:00Z' }
    ], 'starChanges must read chronologically oldest -> newest regardless of input order');
  });

  // ── scenario 8: a run at the cap ───────────────────────────────────────────

  test('detects cap-hit via raw orientation length and uses exact mandated message', () => {
    const capEntries = createOrientationEntries(ORIENTATION_CANDIDATE_CAP, { prefix: 'CAP' });
    const reports = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        orientation: capEntries
      }),
      createReport({
        generatedAt: '2026-01-02T00:00:00Z',
        orientation: [
          { identifier: 'T-1', bearing: 'N', reason: '', archived: false }
        ]
      })
    ];

    const result = deriveJourney({ reports, issues: [] });

    assert.strictEqual(result.capDropped.atCapCount, 1,
      'the report with 200 orientation entries must be counted');
    assert.strictEqual(result.capDropped.totalReports, 2);
    assert.strictEqual(
      result.capDropped.message,
      "this run's list was at the cap — some candidates may have been dropped, count unknown"
    );
  });

  // ── scenario 9: ratio > 1 out-of-span completion ───────────────────────────

  test('allows ratio to exceed 1 when a waypoint completes outside the report span', () => {
    const reports = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        orientation: [
          { identifier: 'IN-SPAN', bearing: 'N', reason: '', archived: false },
          { identifier: 'LATE', bearing: 'E', reason: '', archived: false }
        ]
      }),
      createReport({
        generatedAt: '2026-01-05T00:00:00Z',
        orientation: []
      })
    ];

    const issues = [
      createIssue({
        identifier: 'IN-SPAN',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-03T00:00:00Z'
      }),
      createIssue({
        identifier: 'LATE',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-02-01T00:00:00Z'
      })
    ];

    const result = deriveJourney({ reports, issues });

    assert.strictEqual(result.waypoints.length, 2,
      'both identifiers should be waypoints');
    assert.strictEqual(result.coverage.completions, 1,
      'only the in-span completion is counted in the denominator');
    assert.ok(result.coverage.ratio > 1,
      'ratio must exceed 1 (not be clamped)');
    assert.ok(Number.isFinite(result.coverage.ratio),
      'ratio must be a finite number');
  });

  // ── scenario 10: archived entry still counts toward cap ────────────────────

  test('archived entries count toward cap detection but are excluded from waypoints', () => {
    const entries = createOrientationEntries(ORIENTATION_CANDIDATE_CAP, {
      includeArchived: 50,
      prefix: 'ARC'
    });

    const reports = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        orientation: entries
      })
    ];

    // Create completed issues for all non-archived entries (indices 50–199 = 150 issues)
    const issues = [];
    for (let i = 50; i < ORIENTATION_CANDIDATE_CAP; i++) {
      issues.push(
        createIssue({
          identifier: `ARC-${i}`,
          state: { name: 'Done', type: 'completed' },
          completedAt: '2026-01-01T00:00:00Z'
        })
      );
    }

    const result = deriveJourney({ reports, issues });

    assert.strictEqual(result.capDropped.atCapCount, 1,
      'raw orientation.length hit the cap despite archived entries');
    assert.strictEqual(result.waypoints.length, 150,
      'only non-archived entries should produce waypoints');
  });

  // ── scenario 11: newest-first input (the real listFull() order) ────────────

  // `ReportHistoryStore.listFull()` returns reports NEWEST-FIRST — the exact
  // opposite of every fixture above, and the order the sole intended caller
  // (P3/LIN-1685) will hand in. `sortReportsChronological` is the one line that
  // reconciles the two, and it is load-bearing twice over: `walkReportHistory`
  // selects the newest bearing by last-write-wins over an ASCENDING pass, and
  // `starChanges` reads its from/to direction off that same pass. Every fixture
  // above arrives pre-sorted, so deleting the sort leaves them all green while
  // the trail silently inverts. These two tests are what make that mutation fail.

  test('selects the newest bearing and star direction from newest-first input', () => {
    // The order listFull() actually returns.
    const newestFirst = [
      createReport({
        generatedAt: '2026-01-02T00:00:00Z',
        northStar: 'star-B',
        orientation: [{ identifier: 'T-X', bearing: 'E', reason: '', archived: false }]
      }),
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        northStar: 'star-A',
        orientation: [{ identifier: 'T-X', bearing: 'N', reason: '', archived: false }]
      })
    ];

    const issues = [
      createIssue({
        identifier: 'T-X',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-03T00:00:00Z'
      })
    ];

    const result = deriveJourney({ reports: newestFirst, issues });

    assert.strictEqual(result.waypoints.length, 1);
    assert.strictEqual(result.waypoints[0].bearing, 'E',
      'must select the NEWEST bearing (E), not the first-seen entry of an unsorted array (N)');
    assert.deepStrictEqual(result.starChanges, [
      { from: 'star-A', to: 'star-B', at: '2026-01-02T00:00:00Z' }
    ], 'starChanges must read oldest → newest regardless of the order reports arrive in');
    assert.deepStrictEqual(result.coverage.span, {
      oldest: '2026-01-01T00:00:00Z',
      newest: '2026-01-02T00:00:00Z'
    });
  });

  test('derives an identical result whatever order the same reports arrive in', () => {
    // Generalises the case above: the output is a function of the report SET,
    // never of its arrival order. Pins the delete-the-sort mutation AND the
    // reverse-the-comparator one, neither of which the ascending fixtures catch.
    const oldestFirst = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        northStar: 'star-A',
        orientation: [
          { identifier: 'T-X', bearing: 'N', reason: '', archived: false },
          { identifier: 'T-Y', bearing: 'S', reason: '', archived: false }
        ]
      }),
      createReport({
        generatedAt: '2026-01-02T00:00:00Z',
        northStar: 'star-A',
        orientation: [{ identifier: 'T-X', bearing: 'E', reason: '', archived: false }]
      }),
      createReport({
        generatedAt: '2026-01-03T00:00:00Z',
        northStar: 'star-B',
        orientation: [
          { identifier: 'T-Y', bearing: 'W', reason: '', archived: false },
          { identifier: 'T-Z', bearing: 'NE', reason: '', archived: true }
        ]
      }),
      createReport({
        generatedAt: '2026-01-04T00:00:00Z',
        northStar: 'star-C',
        orientation: [{ identifier: 'T-X', bearing: 'SE', reason: '', archived: false }]
      })
    ];

    const issues = [
      createIssue({
        identifier: 'T-X',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-05T00:00:00Z'
      }),
      createIssue({
        identifier: 'T-Y',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-02T00:00:00Z'
      }),
      createIssue({
        identifier: 'T-Z',
        state: { name: 'Done', type: 'completed' },
        completedAt: '2026-01-03T00:00:00Z'
      })
    ];

    const expected = deriveJourney({ reports: oldestFirst, issues });

    // Anchor the expectation on the real semantics, so a bug that corrupts both
    // orderings identically cannot pass this test by mere self-consistency.
    assert.deepStrictEqual(
      expected.waypoints.map(w => [w.identifier, w.bearing]),
      [['T-Y', 'W'], ['T-X', 'SE']],
      'newest bearing per identifier, ascending by completedAt, archived-only T-Z excluded'
    );
    assert.deepStrictEqual(expected.starChanges, [
      { from: 'star-A', to: 'star-B', at: '2026-01-03T00:00:00Z' },
      { from: 'star-B', to: 'star-C', at: '2026-01-04T00:00:00Z' }
    ]);

    const orderings = [
      ['newest-first', [...oldestFirst].reverse()],
      ['shuffled', [oldestFirst[2], oldestFirst[0], oldestFirst[3], oldestFirst[1]]]
    ];

    for (const [label, reports] of orderings) {
      assert.deepStrictEqual(
        deriveJourney({ reports, issues }),
        expected,
        `${label} input must derive the same journey as oldest-first input`
      );
    }
  });

});

// =============================================================================
// cumulative-walk placement (LIN-2065 / LIN-1675 P5)
// =============================================================================

/**
 * Build a deriveJourney fixture from an ordered list of bearings — one
 * completed waypoint per bearing, ascending completedAt (one day apart), all
 * scored in a single report. `completedAt: null` produces a non-placeable
 * (completed but never-dated) waypoint, per the local-provider case P3
 * already handles.
 */
function buildWalkFixture(entries) {
  const orientation = entries.map((e, i) => ({
    identifier: e.id || `WP-${i}`,
    bearing: e.bearing,
    reason: '',
    archived: false
  }));
  const report = createReport({ generatedAt: '2026-01-01T00:00:00Z', orientation });
  const issues = entries.map((e, i) => createIssue({
    identifier: e.id || `WP-${i}`,
    state: { name: 'Done', type: 'completed' },
    completedAt: e.completedAt !== undefined ? e.completedAt : `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`
  }));
  return deriveJourney({ reports: [report], issues });
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('cumulative-walk placement', () => {

  test('consecutive placed waypoints are exactly one unit apart', () => {
    const result = buildWalkFixture([
      { bearing: 'N' }, { bearing: 'E' }, { bearing: 'S' }, { bearing: 'W' }, { bearing: 'NE' }, { bearing: 'SW' }
    ]);
    const wps = result.waypoints;
    assert.strictEqual(wps.length, 6);

    let prev = { x: 0, y: 0 }; // the berth
    for (const wp of wps) {
      assert.ok(typeof wp.x === 'number' && typeof wp.y === 'number', `${wp.identifier} must carry x/y`);
      assert.ok(Math.abs(distance(prev, wp) - 1) < 1e-9, `${wp.identifier} must be exactly one unit from the previous position`);
      prev = wp;
    }
  });

  test('a same-bearing run renders as an exact straight drift (heading never turns away from its own bearing)', () => {
    const result = buildWalkFixture(Array.from({ length: 8 }, () => ({ bearing: 'E' })));
    result.waypoints.forEach((wp, i) => {
      assert.ok(Math.abs(wp.x - (i + 1)) < 1e-9, `waypoint ${i} x should be ${i + 1}`);
      assert.ok(Math.abs(wp.y) < 1e-9, `waypoint ${i} y should stay 0`);
    });
  });

  test('a direct N→S reversal takes multiple steps as a bounded-turn arc, never a one-step flip', () => {
    const result = buildWalkFixture([
      { bearing: 'N' }, { bearing: 'N' },
      { bearing: 'S' }, { bearing: 'S' }, { bearing: 'S' }, { bearing: 'S' }, { bearing: 'S' }, { bearing: 'S' }
    ]);
    const wps = result.waypoints;

    // Recover each step's heading from its displacement (unit-length steps,
    // same cos/sin convention as BEARING_TO_ANGLE).
    const points = [{ x: 0, y: 0 }, ...wps];
    const headings = [];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      headings.push(deg);
    }

    // Every step's turn is bounded by MAX_TURN_DEGREES.
    for (let i = 1; i < headings.length; i++) {
      let delta = ((headings[i] - headings[i - 1] + 540) % 360) - 180;
      assert.ok(Math.abs(delta) <= MAX_TURN_DEGREES + 1e-9,
        `step ${i} turned ${delta}°, exceeding MAX_TURN_DEGREES (${MAX_TURN_DEGREES}°)`);
    }

    // The reversal is not a one-step flip: right after the first 'S'
    // waypoint, heading has not yet reached south (90°).
    assert.ok(Math.abs(headings[1] - 270) < 1e-9, 'heading starts at N (270°) across the same-bearing run');
    assert.ok(Math.abs(headings[2] - 90) > 1e-9, 'heading must not snap straight from N to S in one step');

    // The tail converges to — and stays at — due south: a straight drift
    // after the turn-in arc (pin the converged tail, not the first steps).
    assert.ok(Math.abs(headings[headings.length - 1] - 90) < 1e-9, 'heading must converge to S (90°) by the run\'s tail');
    assert.ok(Math.abs(headings[headings.length - 2] - 90) < 1e-9, 'the converged tail must hold steady, not oscillate');
  });

  test('the walk runs over the placeable projection only — a never-dated waypoint is excluded and does not perturb spacing', () => {
    const result = buildWalkFixture([
      { id: 'A', bearing: 'N', completedAt: '2026-01-01T00:00:00Z' },
      { id: 'B', bearing: 'E', completedAt: null },
      { id: 'C', bearing: 'S', completedAt: '2026-01-02T00:00:00Z' }
    ]);

    const byId = Object.fromEntries(result.waypoints.map(wp => [wp.identifier, wp]));
    assert.strictEqual(result.waypoints.length, 3, 'the never-dated waypoint is still present in the unfiltered list');
    assert.ok(!('x' in byId.B) && !('y' in byId.B), 'a non-placeable waypoint carries no x/y');

    // A is the sole placeable predecessor of C — the walk skips B entirely,
    // so C's position is exactly one bounded-turn step from A's, not from a
    // (nonexistent) intermediate step at B's bearing.
    assert.ok(Math.abs(distance({ x: 0, y: 0 }, byId.A) - 1) < 1e-9);
    assert.ok(Math.abs(distance(byId.A, byId.C) - 1) < 1e-9);
  });

  test('a north-star segment break resets both heading and position to a fresh berth', () => {
    const reports = [
      createReport({ generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'W1', bearing: 'N', reason: '', archived: false }] }),
      createReport({ generatedAt: '2026-01-05T00:00:00Z', northStar: 'Ship B', orientation: [{ identifier: 'W2', bearing: 'S', reason: '', archived: false }] })
    ];
    const issues = [
      createIssue({ identifier: 'W1', state: { name: 'Done', type: 'completed' }, completedAt: '2026-01-02T00:00:00Z' }),
      createIssue({ identifier: 'W2', state: { name: 'Done', type: 'completed' }, completedAt: '2026-01-10T00:00:00Z' })
    ];

    const result = deriveJourney({ reports, issues });
    assert.strictEqual(result.starChanges.length, 1, 'sanity: a star change is present between W1 and W2');

    const byId = Object.fromEntries(result.waypoints.map(wp => [wp.identifier, wp]));
    // W2 opens a fresh segment: heading = its own bearing (S, 90°) directly,
    // position measured from the origin — not a bounded-turn step from W1's
    // accumulated position/heading.
    assert.ok(Math.abs(byId.W2.x - 0) < 1e-9, 'a fresh berth starts at x=0');
    assert.ok(Math.abs(byId.W2.y - 1) < 1e-9, 'a fresh berth steps one unit along its own bearing (S), not a clamped turn from W1');
    assert.ok(Math.abs(distance({ x: 0, y: 0 }, byId.W2) - 1) < 1e-9);
  });

});
