/**
 * Unit tests for ship-journey.js — deriveJourney derivation library.
 *
 * Run with: node --test tests/unit/ship-journey.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { deriveJourney } from '../../lib/ship-journey.js';
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

  test('selects the newest pre-completion bearing for each identifier', () => {
    const reports = [
      createReport({
        generatedAt: '2026-01-01T00:00:00Z',
        orientation: [
          { identifier: 'T-X', bearing: 'N', reason: '', archived: false }
        ]
      }),
      createReport({
        generatedAt: '2026-01-02T00:00:00Z',
        orientation: [
          { identifier: 'T-X', bearing: 'E', reason: '', archived: false }
        ]
      })
    ];

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
      'waypoint must carry the NEWEST bearing (E), not the oldest (N)');
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

});
