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
import { NOTES_DIR, REGISTRY_FILE, NOT_NOTES, NOTE_EXTENSIONS, ANY_EXTENSION, isCitedPath, citedPaths } from '../../lib/prompts/area-note-format.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// [span, the notes guard's reading (NOTE_EXTENSIONS), the retirement-line checker's reading (ANY_EXTENSION)], at HEAD.
const BEFORE = [
  ['lib/a.js', true, true],
  ['server.js', true, true],
  ['tests/fixtures/', true, true],
  ['x.js:3', true, true],
  ['run.sh', true, true],
  ['/dispatch', false, false],
  ['^lib/', false, false],
  ['provider.name', false, true],
  ['GATE_DUE_MARKER', false, false],
  ['doc.kind', false, true],
  ['src/x.ts', true, true],
  ['a.py', false, true],
  ['svc/main.go', true, true],
  ['provider.name:12', false, true],
  ['lib/b.js:12:4', true, true],
  ['a.json', true, true],
  ['a.markdown', false, false],
  ['README.md', true, true],
  ['foo.bar.baz', false, true],
  ['x.toml', true, true],
  ['lib/x.mjs:9', true, true],
  ['a.yaml', true, true],
  ['ab.cdefghi', false, false],
  ['pkg.tsx', false, true],
  ['lib/runner-kit/', true, true],
  ['docs/areas/', true, true],
  ['v1.2', false, true],
  ['lib/a.js:', true, true],
  ['12.5', false, true],
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

describe('LIN-4470 — the cited-path rule is one predicate, read with each caller\'s extension list', () => {
  test('the notes guard reads each span as it did at HEAD', () => {
    for (const [span, guard] of BEFORE) {
      assert.equal(isCitedPath(span, NOTE_EXTENSIONS), guard, `guard: ${span}`);
    }
  });

  test('the retirement-line checker reads each span as it did at HEAD', () => {
    for (const [span, , leftover] of BEFORE) {
      assert.equal(isCitedPath(span, ANY_EXTENSION), leftover, `checker: ${span}`);
    }
  });

  test('citedPaths keeps the guard\'s default and returns spans in order', () => {
    assert.deepEqual(
      citedPaths('`lib/a.js` `server.js` `tests/fixtures/` `x.js:3` `run.sh` `/dispatch` `^lib/` `provider.name === 1` `GATE_DUE_MARKER` `doc.kind`'),
      ['lib/a.js', 'server.js', 'tests/fixtures/', 'x.js:3', 'run.sh'],
    );
  });

  test('a retirement line can name another repository\'s file; the notes guard does not read it as a note path', () => {
    assert.equal(isCitedPath('a.py', ANY_EXTENSION), true);
    assert.equal(isCitedPath('a.py', NOTE_EXTENSIONS), false);
  });
});
