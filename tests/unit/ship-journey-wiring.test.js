/**
 * Unit coverage for the Ship Journey experimental-view wiring + page renderer
 * (LIN-1675 P3), mirroring tests/unit/live-console-wiring.test.js.
 *
 * Two contracts:
 *   1. The feature is a proper experimental view — present in FEATURES with an
 *      off default, a Settings label + description, and a membership row in
 *      the shared EXPERIMENTAL_VIEWS source of truth so Settings AND the nav
 *      overflow surface it without drift.
 *   2. renderShipJourneyPage emits the honest thin-data empty state below the
 *      2-waypoint threshold, and the coverage figure + playback controls +
 *      map mount otherwise — with the coverage figure scoped to the retained
 *      run window (never presented as the whole journey).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURES,
  FEATURE_DEFAULTS,
  FEATURE_LABELS,
  FEATURE_DESCRIPTIONS,
  EXPERIMENTAL_VIEWS,
  getFeatureFlags,
} from '../../lib/feature-defaults.js';
import { getViewNavLinks } from '../../lib/components/view-nav.js';
import { renderShipJourneyPage } from '../../lib/render-ship-journey.js';
import { deriveJourney } from '../../lib/ship-journey.js';

// ─── feature wiring ───────────────────────────────────────────────────────────

test('shipJourney is a registered feature, defaulting OFF, with label + description', () => {
  assert.equal(FEATURES.SHIP_JOURNEY, 'shipJourney');
  assert.equal(FEATURE_DEFAULTS.shipJourney, false);
  assert.ok(FEATURE_LABELS.shipJourney, 'has a settings label');
  assert.ok(FEATURE_DESCRIPTIONS.shipJourney, 'has a settings description');
});

test('shipJourney is in the shared EXPERIMENTAL_VIEWS list mapped to the ship-journey route', () => {
  const row = EXPERIMENTAL_VIEWS.find(v => v.flag === 'shipJourney');
  assert.ok(row, 'shipJourney has an EXPERIMENTAL_VIEWS row');
  assert.equal(row.path, 'ship-journey');
});

test('getFeatureFlags keeps shipJourney off by default and honours an explicit toggle', () => {
  assert.equal(getFeatureFlags({}).shipJourney, false);
  assert.equal(getFeatureFlags({ features: { shipJourney: true } }).shipJourney, true);
});

test('nav surfaces ship-journey ONLY when the flag is on (gated inclusion)', () => {
  assert.ok(!getViewNavLinks('acme', {}).map(l => l.text).includes('ship-journey'));
  const on = getViewNavLinks('acme', { shipJourney: true }).map(l => l.text);
  assert.ok(on.includes('ship-journey'));
  // strict === true gate
  assert.ok(!getViewNavLinks('acme', { shipJourney: 1 }).map(l => l.text).includes('ship-journey'));
});

// ─── renderer: thin-data empty state ─────────────────────────────────────────

function baseOptions(overrides = {}) {
  return {
    deployInfo: {},
    urlKey: 'acme',
    workspaces: [{ urlKey: 'acme', name: 'Acme' }],
    featureFlags: { shipJourney: true },
    ...overrides,
  };
}

test('zero waypoints renders the honest thin-data empty state, no playback controls', () => {
  const journey = {
    waypoints: [],
    coverage: { completions: 0, ratio: null, span: null },
    capDropped: { atCapCount: 0, totalReports: 0, message: null },
    starChanges: [],
    bearingHistogram: {},
  };
  const html = renderShipJourneyPage(journey, baseOptions());
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /data-testid="ship-journey-empty"/);
  assert.ok(!html.includes('data-testid="ship-journey-controls"'));
  assert.ok(!html.includes('data-testid="ship-journey-map"'));
  // Honest: does not claim the workspace has no history (store failure and
  // empty are indistinguishable at this seam — LIN-1683 close-out ledger).
  assert.ok(!/no history/i.test(html));
});

test('a single waypoint is still "thin" — below the 2-waypoint journey threshold', () => {
  const journey = {
    waypoints: [{ identifier: 'LIN-1', bearing: 'N', angle: 270, completedAt: '2026-01-01T00:00:00Z' }],
    coverage: { completions: 1, ratio: 1, span: { oldest: '2026-01-01T00:00:00Z', newest: '2026-01-01T00:00:00Z' } },
    capDropped: { atCapCount: 0, totalReports: 1, message: null },
    starChanges: [],
    bearingHistogram: {},
  };
  const html = renderShipJourneyPage(journey, baseOptions());
  assert.match(html, /data-testid="ship-journey-empty"/);
  assert.ok(!html.includes('data-testid="ship-journey-map"'));
});

// ─── renderer: playable journey ───────────────────────────────────────────────

function twoWaypointJourney(overrides = {}) {
  return {
    waypoints: [
      { identifier: 'LIN-1', bearing: 'N', angle: 270, completedAt: '2026-01-01T00:00:00Z' },
      { identifier: 'LIN-2', bearing: 'S', angle: 90, completedAt: '2026-01-02T00:00:00Z' },
    ],
    coverage: { completions: 2, ratio: 1, span: { oldest: '2026-01-01T00:00:00Z', newest: '2026-01-02T00:00:00Z' } },
    capDropped: { atCapCount: 0, totalReports: 3, message: null },
    starChanges: [],
    bearingHistogram: { N: 1, S: 1 },
    ...overrides,
  };
}

test('two or more waypoints render the coverage figure, controls, and map mount', () => {
  const html = renderShipJourneyPage(twoWaypointJourney(), baseOptions());
  assert.ok(!html.includes('data-testid="ship-journey-empty"'));
  assert.match(html, /data-testid="ship-journey-coverage"/);
  assert.match(html, /100% coverage — 2 of 2 completed tasks charted, across the last 3 retained runs\./);
  assert.match(html, /data-testid="ship-journey-controls"/);
  assert.match(html, /data-testid="ship-journey-play"/);
  assert.match(html, /data-testid="ship-journey-step-back"/);
  assert.match(html, /data-testid="ship-journey-step-forward"/);
  assert.match(html, /data-testid="ship-journey-scrub"[^>]*min="0"[^>]*max="1"/);
  assert.match(html, /data-testid="ship-journey-map"/);
});

test('the coverage figure discloses the 20-run retention cap when it applies', () => {
  const journey = twoWaypointJourney({ capDropped: { atCapCount: 0, totalReports: 20, message: null } });
  const html = renderShipJourneyPage(journey, baseOptions());
  assert.match(html, /retention cap/);
});

test('a per-report candidate-cap hit surfaces the capDropped note separately from the coverage figure', () => {
  const journey = twoWaypointJourney({
    capDropped: { atCapCount: 1, totalReports: 3, message: "this run's list was at the cap — some candidates may have been dropped, count unknown" },
  });
  const html = renderShipJourneyPage(journey, baseOptions());
  assert.match(html, /data-testid="ship-journey-cap-note"/);
});

test('a waypoint with no completedAt is skipped from the trail and the coverage numerator', () => {
  const journey = twoWaypointJourney({
    waypoints: [
      { identifier: 'LIN-1', bearing: 'N', angle: 270, completedAt: '2026-01-01T00:00:00Z' },
      { identifier: 'LIN-2', bearing: 'S', angle: 90, completedAt: '2026-01-02T00:00:00Z' },
      { identifier: 'LIN-3', bearing: 'E', angle: 0, completedAt: null },
    ],
  });
  const html = renderShipJourneyPage(journey, baseOptions());
  // Still only 2 placeable waypoints: the null-completedAt one is excluded,
  // so "2 of 2" (not 3) and the embedded data carries only the placeable pair.
  assert.match(html, /2 of 2 completed tasks charted/);
  assert.ok(!html.includes('"identifier":"LIN-3"'));
  assert.match(html, /data-testid="ship-journey-scrub"[^>]*max="1"/);
});

// LIN-1970 defect 1 regression: feed deriveJourney's REAL output (not a
// hand-built coverage fixture) through the renderer. This is exactly the
// shape that produced the self-contradictory "150% coverage — 2 of 2
// completed tasks charted" — 3 retained runs, one candidate's issue never
// got a completedAt set (reachable on the local provider), so deriveJourney
// yields 3 unfiltered waypoints over 2 completions (coverage.ratio === 1.5),
// while the renderer must display the FILTERED (placeable) count in both the
// numerator and the percentage.
test('a real deriveJourney output with a null-completedAt candidate renders an internally consistent coverage figure', () => {
  const reports = [
    { id: 'r1', generatedAt: '2026-01-01T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'LOCAL-1', bearing: 'N', reason: '', archived: false }] },
    { id: 'r2', generatedAt: '2026-01-05T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'LOCAL-2', bearing: 'S', reason: '', archived: false }] },
    { id: 'r3', generatedAt: '2026-01-10T00:00:00Z', northStar: 'Ship A', orientation: [{ identifier: 'LOCAL-3', bearing: 'E', reason: '', archived: false }] },
  ];
  const issues = [
    { identifier: 'LOCAL-1', state: { type: 'completed' }, completedAt: '2026-01-02T00:00:00Z' },
    { identifier: 'LOCAL-2', state: { type: 'completed' }, completedAt: '2026-01-06T00:00:00Z' },
    // completedAt never set — the local-provider case LIN-1684 ledger item 2 routed to P3.
    { identifier: 'LOCAL-3', state: { type: 'completed' }, completedAt: null },
  ];

  const journey = deriveJourney({ reports, issues });
  // Sanity-check this is the exact repro shape: 3 unfiltered waypoints over 2
  // completions, i.e. coverage.ratio (1.5) disagrees with the filtered count.
  assert.equal(journey.waypoints.length, 3);
  assert.equal(journey.coverage.completions, 2);
  assert.equal(journey.coverage.ratio, 1.5);

  const html = renderShipJourneyPage(journey, baseOptions());
  const match = html.match(/(\d+)% coverage — (\d+) of (\d+) completed/);
  assert.ok(match, 'coverage figure renders a percentage sentence');
  const [, pct, numerator, denominator] = match;
  assert.equal(numerator, '2', 'numerator is the placeable (filtered) count');
  assert.equal(denominator, '2');
  assert.equal(pct, '100', 'percentage derives from the filtered numerator, not coverage.ratio');
});

test('embeds the filtered waypoint + starChanges data for client-side playback', () => {
  const journey = twoWaypointJourney({
    starChanges: [{ from: 'a', to: 'b', at: '2026-01-01T12:00:00Z' }],
  });
  const html = renderShipJourneyPage(journey, baseOptions());
  assert.match(html, /__SHIP_JOURNEY_DATA__/);
  assert.match(html, /"identifier":"LIN-1"/);
  assert.match(html, /"identifier":"LIN-2"/);
  assert.match(html, /"from":"a","to":"b"/);
});

test('loads its own scoped assets in the correct script order (common.js before ship-journey.js)', () => {
  const html = renderShipJourneyPage(twoWaypointJourney(), baseOptions());
  assert.match(html, /\/ship-journey\.css/);
  const commonIdx = html.indexOf('/common.js');
  const journeyJsIdx = html.indexOf('/ship-journey.js');
  assert.ok(commonIdx > 0 && journeyJsIdx > commonIdx, 'common.js must load before ship-journey.js');
});
