// LIN-3729: pin the code-shape area map for files that a name pattern in
// scripts/code-shape/areas.json used to misfile. First matching area wins.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const areas = JSON.parse(readFileSync(join(ROOT, 'scripts/code-shape/areas.json'), 'utf8'));
const list = areas.areas || areas;

function areaOf(path) {
  const hit = list.find((a) => (a.match || []).some((m) => new RegExp(m).test(path)));
  return hit && hit.name;
}

describe('code-shape area map placement (LIN-3729)', () => {
  test('the three relabelled files land in their owning areas', () => {
    assert.strictEqual(areaOf('lib/proxy-fetch.js'), 'Platform & plumbing');
    assert.strictEqual(areaOf('lib/openrouter-key-resolver.js'), 'Auth, accounts & workspaces');
    assert.strictEqual(areaOf('lib/guest-task-path.js'), 'Auth, accounts & workspaces');
    assert.strictEqual(areaOf('lib/vendor-assets.js'), 'Platform & plumbing'); // LIN-3787
  });

  test('sibling files the lookaheads must not steal stay where they were', () => {
    assert.strictEqual(areaOf('lib/proxy-wire.js'), 'Agent API (proxy)');
    assert.strictEqual(areaOf('lib/openrouter.js'), 'LLM & prompts');
    assert.strictEqual(areaOf('lib/pat-session.js'), 'Auth, accounts & workspaces');
  });

  // LIN-3554: task ordering is its own area; graph-features is relabelled into it
  // (first match wins, so Task model must sit ahead of LLM & prompts).
  test('task ordering and the blocking-graph primitives land in Task model', () => {
    assert.strictEqual(areaOf('lib/task-order.js'), 'Task model');
    assert.strictEqual(areaOf('lib/graph-features.js'), 'Task model');
    assert.strictEqual(areaOf('lib/tree.js'), 'Front end: server-rendered pages');
  });

  // LIN-3852: the LLM job registry is a leaf of the LLM area; without its pattern
  // it would fall through to the catch-all `^lib/` in "Other features".
  test('the LLM job registry lands in LLM & prompts', () => {
    assert.strictEqual(areaOf('lib/llm-jobs.js'), 'LLM & prompts');
    assert.strictEqual(areaOf('lib/llm-call-log.js'), 'LLM & prompts');
  });
});
