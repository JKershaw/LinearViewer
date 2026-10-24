/**
 * LIN-3861: the workspace-API unit helper (tests/unit/lib/workspace-api-unit.js) and
 * the placement convention it states for the LIN-2246 moves out of
 * createWorkspaceApiRoutes.
 *
 * Run: node --test tests/unit/workspace-api-unit.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isWorkspaceApiUnitFile, workspaceApiUnitFiles } from './lib/workspace-api-unit.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('the unit is routes/workspace-api.js and routes/workspace-api-*.js, flat', () => {
  for (const rel of ['routes/workspace-api.js', 'routes/workspace-api-body.js', 'routes/workspace-api-prompts.js', 'routes/workspace-api-x.y.js']) {
    assert.ok(isWorkspaceApiUnitFile(rel), rel);
  }
  for (const rel of [
    'routes/workspace-api/issues.js',    // a subdirectory is not in the unit (the unit is flat)
    'routes/workspace-api/index.js',
    'routes/workspace-api-.js',          // a dash with no name
    'routes/workspace-apis.js',
    'routes/workspace-api.mjs',
    'routes/workspace-kpis.js',
    'lib/workspace-api-mocks.js',        // lib/ is not in the unit
    'lib/workspace-api.js',
    'tests/unit/routes/workspace-api.js',
    'server.js'
  ]) {
    assert.ok(!isWorkspaceApiUnitFile(rel), rel);
  }
});

// At least, never an exact count: the LIN-2246 moves add files, and the move
// probe's layouts add `-body` files.
test('workspaceApiUnitFiles lists at least the four current files, sorted, all existing unit files', () => {
  const files = workspaceApiUnitFiles(root);
  for (const rel of ['routes/workspace-api.js', 'routes/workspace-api-prompts.js', 'routes/workspace-api-roadmap.js', 'routes/workspace-api-steps.js']) {
    assert.ok(files.includes(rel), `${rel} is in the unit`);
  }
  for (const rel of files) {
    assert.ok(isWorkspaceApiUnitFile(rel), rel);
    assert.ok(existsSync(join(root, rel)), rel);
  }
  assert.deepEqual(files, [...files].sort());
});

test('the unit excludes lib/workspace-api-mocks.js, routes/workspace-kpis.js and any routes/workspace-api/ path', () => {
  const files = workspaceApiUnitFiles(root);
  assert.ok(!files.includes('lib/workspace-api-mocks.js'));
  assert.ok(!files.includes('routes/workspace-kpis.js'));
  assert.ok(files.every(rel => !rel.startsWith('routes/workspace-api/')));
});

// The unit is flat so run-limit-gating.test.js (a non-recursive readdirSync of
// routes/) and the other whole-tree scanners keep seeing every member. A
// routes/workspace-api/ directory would move members out of their sight without a
// failure, so it fails here until the move re-anchors this helper AND
// run-limit-gating.test.js in the commit that creates the directory (LIN-2246).
test('there is no routes/workspace-api/ directory (a subdirectory is a blind spot for the flat scanners)', () => {
  assert.equal(existsSync(join(root, 'routes', 'workspace-api')), false,
    'routes/workspace-api/ exists: re-anchor tests/unit/lib/workspace-api-unit.js and the non-recursive readdirSync in tests/unit/run-limit-gating.test.js in the same commit');
});
