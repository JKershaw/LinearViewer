// LIN-513 regression guard. The clamp itself lives in resolveWorkspaceModel
// (see workspace-model-clamp.test.js); this test pins the WIRING — that every
// billed LLM call site in the route layer threads `forceDefault: isFreeTier`, so
// a free-tier recommend / recap / brief / roadmap / chat request cannot select a
// non-default (expensive) model against the operator's shared free-tier key.
//
// It is a source-level invariant: any `resolveWorkspaceModel(` call that does NOT
// pass `forceDefault` must be one of the two explicitly display/metadata-only
// sites (footer model label, report-history metadata) which bill no LLM call.
// If a new billed caller is added without the flag — or an existing one loses it —
// this fails, pointing at the exact unclamped line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Non-billing callers of resolveWorkspaceModel: these resolve a model for DISPLAY
// or METADATA only and intentionally do NOT clamp (LIN-513 out-of-scope list).
// Matched by exact trimmed source line so the allowlist can't silently widen.
const DISPLAY_ONLY = new Set([
  // routes/workspace-api.js — footer model label (no LLM call)
  'const model = await resolveWorkspaceModel({ urlKey: workspace.urlKey, workspacePreferencesStore })',
  // routes/workspace-api.js — reportHistoryStore.save metadata (no LLM call)
  'const model = await resolveWorkspaceModel({ urlKey: req.workspace.urlKey, workspacePreferencesStore });'
]);

const FILES = ['routes/workspace-api.js', 'routes/proxy.js', 'routes/task-chat.js'];

test('every billed resolveWorkspaceModel call threads forceDefault: isFreeTier', () => {
  let billedClampCount = 0;
  for (const rel of FILES) {
    const lines = readFileSync(join(root, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('resolveWorkspaceModel({')) return;
      const trimmed = line.trim();
      if (trimmed.includes('forceDefault: isFreeTier')) {
        billedClampCount++;
        return;
      }
      assert.ok(
        DISPLAY_ONLY.has(trimmed),
        `${rel}:${i + 1} calls resolveWorkspaceModel without the free-tier clamp ` +
        `and is not an allowlisted display/metadata site:\n  ${trimmed}`
      );
    });
  }
  // Sanity floor: all 13 billed sites (workspace-api recommend/stream/recap/brief/
  // roadmap/chat = 6, feedback-title = 1, task-chat = 1, proxy recommend/recap×2/brief×2 = 5).
  assert.equal(billedClampCount, 13, `expected 13 clamped billed sites, found ${billedClampCount}`);
});
