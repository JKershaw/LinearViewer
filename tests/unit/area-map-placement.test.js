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
  });

  test('sibling files the lookaheads must not steal stay where they were', () => {
    assert.strictEqual(areaOf('lib/proxy-wire.js'), 'Agent API (proxy)');
    assert.strictEqual(areaOf('lib/openrouter.js'), 'LLM & prompts');
    assert.strictEqual(areaOf('lib/pat-session.js'), 'Auth, accounts & workspaces');
  });
});
