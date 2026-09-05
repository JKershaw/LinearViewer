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
  // 17 billed sites: workspace-api has 6 (recommend×2 + recap + brief + scan
  // [LIN-2197 Phase 4] + feedback-title), workspace-api-roadmap has 2
  // (roadmap-generate + roadmap-chat, moved out of workspace-api.js by
  // LIN-2246), proxy-compute has 4 (recap×2 + brief×2) + proxy.js has 1
  // (LIN-679 Stage 4: /recommend's site is inside computeRecommendation, a
  // closure-local helper that stayed in routes/proxy.js and is shared with
  // group I's /recommend-and-dispatch — not proxy-compute.js), task-chat has 1,
  // next-run has 1 (resolveAiOperationModel), dashboard has 2 (run-summary +
  // session-summary, both resolveAiOperationModel).
  assert.equal(billedClampCount, 17, `expected 17 clamped billed sites, found ${billedClampCount}`);
});
