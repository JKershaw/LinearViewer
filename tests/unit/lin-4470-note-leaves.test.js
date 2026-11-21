/**
 * LIN-4470 (piece 6 of LIN-4448): the area notes' two leaves each have one spelling.
 *
 * 1. The registry's path is derived from the notes directory and the registry's file name, which area-registry-path.js
 *    spells once and area-note-format.js re-exports (REGISTRY_PATH used to be a second copy of `docs/areas/areas.json`;
 *    NOT_NOTES a third).
 * 2. The cited-path rule is one predicate (isCitedPath, citedPaths in lib/prompts/area-note-format.js). The notes guard
 *    and the retirement-line checker read it with different extension lists, and that difference is the argument, not
 *    two rules. The table below is the behaviour each caller had before this change, captured at HEAD, so the change is
 *    shown to move neither: a waiting entry is read as a path exactly as the guard read it, and a retirement line exactly
 *    as the checker read it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY_PATH } from '../../lib/prompts/area-registry-path.js';
import { NOTES_DIR, REGISTRY_FILE, NOT_NOTES, isCitedPath } from '../../lib/prompts/area-note-format.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// [span, the notes guard's reading], at HEAD. LIN-4527: the retirement-line checker's column and ANY_EXTENSION are gone.
const BEFORE = [
  ['lib/a.js', true],
  ['server.js', true],
  ['tests/fixtures/', true],
  ['x.js:3', true],
  ['run.sh', true],
  ['/dispatch', false],
  ['^lib/', false],
  ['provider.name', false],
  ['GATE_DUE_MARKER', false],
  ['doc.kind', false],
  ['src/x.ts', true],
  ['a.py', false],
  ['svc/main.go', true],
  ['provider.name:12', false],
  ['lib/b.js:12:4', true],
  ['a.json', true],
  ['a.markdown', false],
  ['README.md', true],
  ['foo.bar.baz', false],
  ['x.toml', true],
  ['lib/x.mjs:9', true],
  ['a.yaml', true],
  ['ab.cdefghi', false],
  ['pkg.tsx', false],
  ['lib/runner-kit/', true],
  ['docs/areas/', true],
  ['v1.2', false],
  ['lib/a.js:', true],
  ['12.5', false],
];

describe('LIN-4470 — the registry path is derived from the notes directory, spelled once', () => {
  test('REGISTRY_PATH is the notes directory and the registry file', () => {
    assert.equal(REGISTRY_PATH, `${NOTES_DIR}/${REGISTRY_FILE}`);
    assert.equal(REGISTRY_PATH, 'docs/areas/areas.json');
  });

  test('the directory and the file name are each spelled once, in the leaf that imports nothing', () => {
    const spellings = (name) => ['lib/prompts/area-registry-path.js', 'lib/prompts/area-note-format.js']
      .map((path) => [path, readFileSync(join(ROOT, path), 'utf8').split(`'${name}'`).length - 1]);
    assert.deepEqual(spellings('areas.json'), [['lib/prompts/area-registry-path.js', 1], ['lib/prompts/area-note-format.js', 0]]);
    assert.deepEqual(spellings('docs/areas'), [['lib/prompts/area-registry-path.js', 1], ['lib/prompts/area-note-format.js', 0]]);
    assert.match(readFileSync(join(ROOT, 'lib/prompts/area-registry-path.js'), 'utf8'), /export const REGISTRY_PATH = `\$\{NOTES_DIR\}\/\$\{REGISTRY_FILE\}`;/);
  });

  test('NOT_NOTES names the registry through REGISTRY_FILE, not a second spelling', () => {
    assert.ok(NOT_NOTES.has(REGISTRY_FILE));
    assert.ok(NOT_NOTES.has('README.md'));
    assert.equal(NOT_NOTES.size, 2);
  });
});

describe('LIN-4470 — the cited-path rule is one predicate', () => {
  test('the notes guard reads each span as it did at HEAD', () => {
    for (const [span, guard] of BEFORE) {
      assert.equal(isCitedPath(span), guard, `guard: ${span}`);
    }
  });

  test('a file of another extension is not a cited path (LIN-4527: the any-extension reading went with its checker)', () => {
    assert.equal(isCitedPath('a.py'), false);
  });
});
