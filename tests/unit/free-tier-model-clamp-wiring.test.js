// LIN-513 regression guard. The clamp itself lives in resolveWorkspaceModel
// and resolveAiOperationModel (see workspace-model-clamp.test.js); this test
// pins the WIRING — that every billed LLM call site in the route layer threads
// `forceDefault: isFreeTier`, so a free-tier request cannot select a non-default
// (expensive) model against the operator's shared free-tier key.
//
// It is a source-level invariant: any `resolveWorkspaceModel(` or
// `resolveAiOperationModel(` call that does NOT pass `forceDefault` must be one
// of the explicitly display/metadata-only sites which bill no LLM call. If a
// new billed caller is added without the flag — or an existing one loses it —
// this fails, pointing at the exact unclamped line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dashboardUnitFiles } from './lib/dashboard-unit.js';
import { workspaceApiUnitFiles } from './lib/workspace-api-unit.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Non-billing callers of resolveWorkspaceModel or resolveAiOperationModel:
// these resolve a model for DISPLAY or METADATA only and intentionally do NOT
// clamp (LIN-513 out-of-scope list). Matched by exact trimmed source line so
// the allowlist can't silently widen.
const DISPLAY_ONLY = new Set([
  // routes/workspace-api.js — footer model label (no LLM call)
  'const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: \'recommend\' })',
  // routes/workspace-api.js — reportHistoryStore.save metadata (no LLM call)
  'const model = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore });'
]);

const FILES = [
  'routes/workspace-api.js',
  'routes/workspace-api-roadmap.js',
  'routes/proxy.js',
  'routes/proxy-compute.js',
  'routes/task-chat.js',
  'routes/next-run.js',
  // LIN-3840: the dashboard unit (routes/dashboard.js and routes/dashboard-*.js), not one file.
  ...dashboardUnitFiles(root)
];

const RESOLVER_FNS = ['resolveWorkspaceModel', 'resolveAiOperationModel'];

test('every billed resolveWorkspaceModel / resolveAiOperationModel call threads forceDefault: isFreeTier', () => {
  let billedClampCount = 0;
  for (const rel of FILES) {
    const lines = readFileSync(join(root, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const fn = RESOLVER_FNS.find(f => line.includes(`${f}({`));
      if (!fn) return;
      const trimmed = line.trim();
      if (trimmed.includes('forceDefault: isFreeTier')) {
        billedClampCount++;
        return;
      }
      assert.ok(
        DISPLAY_ONLY.has(trimmed),
        `${rel}:${i + 1} calls ${fn} without the free-tier clamp ` +
        `and is not an allowlisted display/metadata site:\n  ${trimmed}`
      );
    });
  }
  // LIN-3218 (LIN-3201 A1): the numeric total ("17 billed sites") is gone. The
  // boundary rule IS the assertion: every `resolveWorkspaceModel(` /
  // `resolveAiOperationModel(` call in FILES is either clamped
  // (`forceDefault: isFreeTier`) or exactly one of the DISPLAY_ONLY lines above.
  // A new billed caller — or a lost clamp on an existing one — fails at the
  // exact line above, with no total to bump. (The former per-file breakdown
  // lives in git history.) Non-vacuity is proven by a planted-offender witness,
  // not a pinned count: dropping the clamp from one real billed site in a
  // scanned file must fail this test (recorded in the PR).
  assert.ok(billedClampCount > 0, 'expected at least one clamped billed site — a zero scan would be vacuous');
});

// ─── LIN-3840: the dashboard routes as one unit ──────────────────────────────
// The same rule over the whole dashboard unit (routes/dashboard.js and
// routes/dashboard-*.js; tests/unit/lib/dashboard-unit.js), so the
// createDashboardRoutes rebuild (LIN-3742) can place its two summary routes in any
// unit file and a file that holds a billed call is still scanned.
//
// Reported, not fixed here: FILES is stale. It omits routes/flight-companion.js
// (its :420 call spans lines, so the one-line rule would fail it), routes/ship-biscuit.js
// (clamped), lib/agent-turn.js (:465) and lib/observer-pass.js (:392, unclamped), and
// still lists routes/task-chat.js, which is no longer a caller. No ticket identified.

/** Unclamped, non-display-only resolver calls in `{ rel: src }`; [] means clean. */
function clampProblems(sources) {
  const problems = [];
  let billed = 0;
  for (const [rel, src] of Object.entries(sources)) {
    src.split('\n').forEach((line, i) => {
      const fn = RESOLVER_FNS.find(f => line.includes(`${f}({`));
      if (!fn) return;
      const trimmed = line.trim();
      if (trimmed.includes('forceDefault: isFreeTier')) { billed++; return; }
      if (!DISPLAY_ONLY.has(trimmed)) problems.push(`${rel}:${i + 1} calls ${fn} without the free-tier clamp: ${trimmed}`);
    });
  }
  if (billed === 0) problems.push('no clamped billed site found: a zero scan is vacuous');
  return problems;
}

test('LIN-3840: every billed call in the dashboard unit threads forceDefault: isFreeTier', () => {
  const sources = Object.fromEntries(dashboardUnitFiles(root).map(rel => [rel, readFileSync(join(root, rel), 'utf8')]));
  assert.deepEqual(clampProblems(sources), []);
  // Both summary routes are billed sites in the unit.
  const clamped = Object.values(sources).join('\n').split('\n').filter(l => l.includes('resolveAiOperationModel({') && l.includes('forceDefault: isFreeTier'));
  assert.equal(clamped.length, 2);
});

// Built from synthetic unit files, never from the live text of routes/dashboard.js.
test('LIN-3840 witness: dropping forceDefault: isFreeTier from the run-summary site of any unit file fails', () => {
  const clamped = "const selectedModel = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'run-summary', forceDefault: isFreeTier });";
  const dropped = clamped.replace(', forceDefault: isFreeTier', '');
  assert.notEqual(dropped, clamped);
  assert.deepEqual(clampProblems({ 'routes/dashboard.js': clamped }), []);
  assert.deepEqual(clampProblems({ 'routes/dashboard.js': '', 'routes/dashboard-body.js': clamped }), []);
  const hit = clampProblems({ 'routes/dashboard.js': clamped, 'routes/dashboard-body.js': `\n${dropped}` });
  assert.equal(hit.length, 1, hit.join('\n'));
  assert.match(hit[0], /^routes\/dashboard-body\.js:2 /);
});

// ─── LIN-3861: the workspace-API routes as one unit ──────────────────────────
// The same rule over the whole workspace-API unit (routes/workspace-api.js and
// routes/workspace-api-*.js; tests/unit/lib/workspace-api-unit.js). The fixed FILES list above
// named routes/workspace-api.js and routes/workspace-api-roadmap.js only, so it was blind to
// routes/workspace-api-prompts.js and -steps.js (LIN-3842) and would be blind to every file the
// LIN-2246 moves add. A billed call anywhere in the unit is scanned.
//
// Reported, not fixed here: the DISPLAY_ONLY comment above says the metadata line
// (`reportHistoryStore.save` metadata) is in routes/workspace-api.js, but that line lives in
// routes/workspace-api-roadmap.js. Both display-only lines are matched by their exact content, not
// their location, so the allow-list is unaffected. No ticket identified.
const readUnit = () => Object.fromEntries(workspaceApiUnitFiles(root).map(rel => [rel, readFileSync(join(root, rel), 'utf8')]));

test('LIN-3861: every billed call in the workspace-API unit threads forceDefault: isFreeTier', () => {
  const sources = readUnit();
  assert.ok(Object.keys(sources).length >= 4, 'the unit is listed');
  assert.deepEqual(clampProblems(sources), []);
  // Billed sites exist in the unit (a zero scan would be vacuous; clampProblems also fails it).
  const clamped = Object.values(sources).join('\n').split('\n').filter(l => /resolve(?:AiOperation|Workspace)Model\(\{/.test(l) && l.includes('forceDefault: isFreeTier'));
  assert.ok(clamped.length > 0);
});

// Built from synthetic unit files, never from the live text of routes/workspace-api.js (which is free to move).
test('LIN-3861 witness: dropping forceDefault: isFreeTier from a billed site in ANY unit file fails', () => {
  const clamped = "const model = await resolveAiOperationModel({ urlKey: workspace.urlKey, workspacePreferencesStore, opKind: 'recap', forceDefault: isFreeTier });";
  const dropped = clamped.replace(', forceDefault: isFreeTier', '');
  assert.notEqual(dropped, clamped);
  assert.deepEqual(clampProblems({ 'routes/workspace-api.js': clamped }), []);
  assert.deepEqual(clampProblems({ 'routes/workspace-api.js': '', 'routes/workspace-api-x.js': clamped }), []);
  for (const rel of ['routes/workspace-api.js', 'routes/workspace-api-prompts.js', 'routes/workspace-api-steps.js', 'routes/workspace-api-x.js']) {
    const hit = clampProblems({ 'routes/workspace-api-roadmap.js': clamped, [rel]: `\n${dropped}` });
    assert.equal(hit.length, 1, `${rel}: ${hit.join('\n')}`);
    assert.match(hit[0], new RegExp(`^${rel.replace(/\./g, '\\.')}:2 `));
  }
});

test('LIN-3861 witness: a zero scan of the unit is vacuous and fails', () => {
  assert.deepEqual(clampProblems({ 'routes/workspace-api.js': 'export {};\n' }), ['no clamped billed site found: a zero scan is vacuous']);
});
