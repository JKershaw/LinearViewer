/**
 * LIN-3840: the dashboard unit helper (tests/unit/lib/dashboard-unit.js) and the
 * placement convention it states for the createDashboardRoutes rebuild (LIN-3742).
 *
 * Run: node --test tests/unit/dashboard-unit.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isDashboardUnitFile, dashboardUnitFiles } from './lib/dashboard-unit.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the unit is routes/dashboard.js and routes/dashboard-*.js, flat', () => {
  for (const rel of ['routes/dashboard.js', 'routes/dashboard-body.js', 'routes/dashboard-rulings.js', 'routes/dashboard-x.y.js']) {
    assert.ok(isDashboardUnitFile(rel), rel);
  }
  for (const rel of [
    'routes/dashboard/rulings.js',       // a subdirectory is not in the unit (the unit is flat)
    'routes/dashboard/index.js',
    'routes/dashboard-.js',              // a dash with no name
    'routes/dashboards.js',
    'routes/dashboard.mjs',
    'routes/proxy.js',
    'lib/dashboard.js',                  // lib/ is not in the unit
    'lib/dashboard-state.js',
    'tests/unit/routes/dashboard.js',
    'server.js'
  ]) {
    assert.ok(!isDashboardUnitFile(rel), rel);
  }
});

test('dashboardUnitFiles lists routes/dashboard.js and only unit files that exist', () => {
  const files = dashboardUnitFiles(root);
  assert.ok(files.includes('routes/dashboard.js'));
  for (const rel of files) {
    assert.ok(isDashboardUnitFile(rel), rel);
    assert.ok(existsSync(join(root, rel)), rel);
  }
  assert.deepEqual(files, [...files].sort());
});

// The unit is flat so run-limit-gating.test.js (a non-recursive readdirSync of
// routes/) and the other whole-tree scanners keep seeing every member. A
// routes/dashboard/ directory would move members out of their sight without a
// failure, so it fails here until the rebuild re-anchors this helper AND
// run-limit-gating.test.js in the commit that creates the directory (LIN-3742).
test('there is no routes/dashboard/ directory (a subdirectory is a blind spot for the flat scanners)', () => {
  assert.equal(existsSync(join(root, 'routes', 'dashboard')), false,
    'routes/dashboard/ exists: re-anchor tests/unit/lib/dashboard-unit.js and the non-recursive readdirSync in tests/unit/run-limit-gating.test.js in the same commit');
});
