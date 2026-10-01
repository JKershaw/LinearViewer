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
  'routes/dashboard.js'
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
