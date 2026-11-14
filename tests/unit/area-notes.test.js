// The area notes guard (LIN-4371): the notes in docs/areas/ stay keyed on the registry and true to the tree.
// docs/areas/README.md owns the format; this test holds the five checks it names:
//   1. every notes file is named by a registry area's slug;
//   2. every path a note cites exists;
//   3. every waiting entry cites a path, and its first cited path maps to the note's own area;
//   4. every note's `## Lessons` section stays under NOTE_BYTE_CAP (LIN-4414: Waiting has no cap, so a still-true
//      entry is never squeezed or cut to make room; it leaves only when settled, untrue or filed);
//   5. the README states NOTE_BYTE_CAP, so its number cannot drift from this constant (LIN-4414).
// Each note's Waiting count is printed as a test diagnostic, so whether the lists are falling can be read in CI.
// The checks are one pure function over (registry, files, exists), run once on the real tree and once per mutation,
// so each check is shown to fail on the defect it exists to catch. simple-dispatcher keeps its own copy (LIN-4372);
// the two repositories share no test code.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadAreas, areaOf } from './helpers/area-registry.js';
// What a waiting entry is, and which files are not notes, is defined once in the product's leaf (LIN-4420): the
// stability measure (scripts/stability-measures.mjs) counts the entries this guard checks, from the same definition.
import { NOTES_DIR, NOT_NOTES, citedPaths, parseNote } from '../../lib/prompts/area-note-format.js';

// About 6 KB (LIN-4347's plan leaves the builder to pick it): a note's Lessons are read before every change in its
// area, so they must stay short enough to read in full. Since LIN-4414 it caps the `## Lessons` section only.
export const NOTE_BYTE_CAP = 6144;
const SECTIONS = new Set(['Lessons', 'Waiting']);
/** The bytes of a note's `## Lessons` section: from its heading to the next level-two heading or the end; 0 if none. */
export function lessonsBytes(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^## Lessons\s*$/.test(line));
  if (start < 0) return 0;
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  return Buffer.byteLength(lines.slice(start, end).join('\n'), 'utf8');
}

/**
 * The five checks over one directory listing. `files` maps a file name in docs/areas/ to its text; `exists` answers
 * for a repo-relative path. Returns one problem per defect, `{ check, file, detail }`; an empty list is a pass.
 */
export function checkAreaNotes({ areas, files, exists, cap = NOTE_BYTE_CAP }) {
  const problems = [];
  const slugs = new Set(areas.map((a) => a.slug));
  for (const [file, text] of Object.entries(files)) {
    if (NOT_NOTES.has(file)) continue;
    const slug = file.endsWith('.md') ? file.slice(0, -3) : null;
    if (!slug || !slugs.has(slug)) {
      problems.push({ check: 1, file, detail: `not named by a registry area (slugs: ${[...slugs].join(', ')})` });
      continue;
    }
    for (const path of citedPaths(text)) {
      if (!exists(path)) problems.push({ check: 2, file, detail: `cites \`${path}\`, which does not exist (cite files, never line numbers)` });
    }
    const { headings, waiting } = parseNote(text);
    for (const h of headings) {
      if (!SECTIONS.has(h)) problems.push({ check: 3, file, detail: `section "## ${h}" is neither Lessons nor Waiting, so its entries go unchecked` });
    }
    for (const entry of waiting) {
      const [first] = citedPaths(entry);
      if (!first) { problems.push({ check: 3, file, detail: `waiting entry cites no file: "${entry.slice(0, 80)}"` }); continue; }
      // A cited directory (`lib/runner-kit/`) maps as a file inside it would.
      const owner = areaOf(first.replace(/\/$/, '/x'), areas)?.slug;
      if (owner !== slug) problems.push({ check: 3, file, detail: `waiting entry's first path \`${first}\` maps to ${owner ?? 'no area'}, not ${slug}` });
    }
    const bytes = lessonsBytes(text);
    if (bytes > cap) problems.push({ check: 4, file, detail: `its Lessons are ${bytes} bytes, over the ${cap}-byte cap (Waiting has no cap)` });
  }
  if (!String(files['README.md'] ?? '').includes(String(cap))) {
    problems.push({ check: 5, file: 'README.md', detail: `does not state the ${cap}-byte Lessons cap the guard holds` });
  }
  return problems;
}

function readTree() {
  const files = {};
  for (const name of readdirSync(join(ROOT, NOTES_DIR))) files[name] = readFileSync(join(ROOT, NOTES_DIR, name), 'utf8');
  return { areas: loadAreas(), files, exists: (p) => existsSync(join(ROOT, p)) };
}

describe('area notes (LIN-4371)', () => {
  const tree = readTree();

  test('the registry gives every area a unique slug, and the README and at least one note exist', () => {
    const slugs = tree.areas.map((a) => a.slug);
    for (const a of tree.areas) assert.match(a.slug ?? '', /^[a-z0-9]+(-[a-z0-9]+)*$/, `${a.name}: slug`);
    assert.strictEqual(new Set(slugs).size, slugs.length, 'slugs are unique');
    assert.ok(tree.files['README.md'], 'docs/areas/README.md owns the format');
    assert.ok(Object.keys(tree.files).some((f) => !NOT_NOTES.has(f)), 'the seeded notes are present');
  });

  test('every note in docs/areas/ passes the five checks', () => {
    assert.deepStrictEqual(checkAreaNotes(tree), []);
  });

  // LIN-4414: an area's waiting list should shrink over time through the leftover step's retirements. The counts are
  // printed so a reader of CI can see it (baselines on 12 Nov: runs-and-dispatch 16, llm-and-prompts 15,
  // front-end-pages 13, agent-api 11).
  test('each note\'s Waiting count (printed)', (t) => {
    for (const file of Object.keys(tree.files).filter((f) => !NOT_NOTES.has(f)).sort()) {
      const { waiting } = parseNote(tree.files[file]);
      t.diagnostic(`area-notes waiting ${file.slice(0, -3)}: ${waiting.length} entries; Lessons ${lessonsBytes(tree.files[file])} of ${NOTE_BYTE_CAP} bytes`);
    }
  });

  // Each mutation is applied to a copy of the real tree, so a check that stopped looking would pass it.
  describe('each check fails on the defect it exists to catch', () => {
    const note = Object.keys(tree.files).find((f) => !NOT_NOTES.has(f) && parseNote(tree.files[f]).waiting.length);
    const mutate = (change) => checkAreaNotes({ ...tree, files: { ...tree.files, ...change(tree.files) } });
    const checksOf = (problems) => [...new Set(problems.map((p) => p.check))];

    test('1: a note for an area the registry does not name', () => {
      const problems = mutate(() => ({ 'no-such-area.md': '# Nowhere\n\n## Lessons\n\n- Nothing.\n' }));
      assert.deepStrictEqual(checksOf(problems), [1]);
      assert.strictEqual(problems[0].file, 'no-such-area.md');
    });

    test('2: a cited path that does not exist (a deleted file, or a line number)', () => {
      const [first] = citedPaths(tree.files[note]);
      const gone = mutate((f) => ({ [note]: f[note].replace(`\`${first}\``, '`lib/deleted-for-the-guard.js`') }));
      assert.ok(gone.some((p) => p.check === 2 && p.detail.includes('lib/deleted-for-the-guard.js')), JSON.stringify(gone));
      const deleted = checkAreaNotes({ ...tree, exists: (p) => p !== first && tree.exists(p) });
      assert.ok(deleted.some((p) => p.check === 2 && p.detail.includes(first)), 'deleting the cited file fails the guard');
      const lined = mutate((f) => ({ [note]: f[note].replace(`\`${first}\``, `\`${first}:12\``) }));
      assert.ok(lined.some((p) => p.check === 2 && p.detail.includes(`${first}:12`)), 'a line number fails the guard');
    });

    test('3: a waiting entry filed under the wrong area, or citing no file', () => {
      const target = ['server.js', 'lib/dispatch-store.js'].find((p) => areaOf(p).slug !== note.slice(0, -3));
      const wrong = mutate((f) => ({ [note]: `${f[note]}- \`${target}\`: filed under the wrong area.\n` }));
      assert.ok(wrong.some((p) => p.check === 3 && p.detail.includes(target)), JSON.stringify(wrong));
      const bare = mutate((f) => ({ [note]: `${f[note]}- Something waits, but no file is named.\n` }));
      assert.ok(bare.some((p) => p.check === 3 && p.detail.includes('cites no file')), JSON.stringify(bare));
      const renamed = mutate((f) => ({ [note]: f[note].replace('## Waiting', '## Waiting work') }));
      assert.ok(renamed.some((p) => p.check === 3 && p.detail.includes('Waiting work')), 'a renamed section cannot hide its entries');
    });

    test('4: a note whose Lessons are over the byte cap', () => {
      // Grown inside Lessons (LIN-4414): before it, this appended at the end of the file, which is Waiting.
      const big = mutate((f) => ({ [note]: f[note].replace('## Lessons\n', `## Lessons\n\n- ${'x'.repeat(NOTE_BYTE_CAP)}\n`) }));
      assert.ok(big.length, 'the mutation landed in Lessons');
      assert.deepStrictEqual(checksOf(big), [4]);
    });

    test('4: Waiting has no cap: 7 KB of valid waiting entries pass every check (LIN-4414)', () => {
      const [owned] = citedPaths(parseNote(tree.files[note]).waiting[0]);
      const entry = `- \`${owned}\`: a valid waiting entry, citing a file in this area first, grown to test the cap. (LIN-4414.)\n`;
      const grown = `${tree.files[note].replace(/\n*$/, '\n')}${entry.repeat(Math.ceil(7168 / entry.length))}`;
      assert.ok(Buffer.byteLength(grown) - Buffer.byteLength(tree.files[note]) >= 7168, 'grew by 7 KB');
      assert.ok(Buffer.byteLength(grown) > NOTE_BYTE_CAP, 'the whole file is over the cap');
      assert.deepStrictEqual(checksOf(mutate(() => ({ [note]: grown }))), []);
    });

    test('4: a note with no Lessons section passes check 4', () => {
      const noLessons = mutate((f) => ({ [note]: f[note].replace(/## Lessons\n[\s\S]*?(?=\n## )/, '') }));
      assert.ok(!noLessons.some((p) => p.check === 4), JSON.stringify(noLessons));
    });

    test('5: a README that does not state the cap', () => {
      const silent = mutate((f) => ({ 'README.md': f['README.md'].split(String(NOTE_BYTE_CAP)).join('some number of') }));
      assert.deepStrictEqual(checksOf(silent), [5]);
    });
  });

  test('citedPaths reads repo-relative paths only', () => {
    assert.deepStrictEqual(
      citedPaths('`lib/a.js` `server.js` `tests/fixtures/` `x.js:3` `run.sh` `/dispatch` `^lib/` `provider.name === 1` `GATE_DUE_MARKER` `doc.kind`'),
      ['lib/a.js', 'server.js', 'tests/fixtures/', 'x.js:3', 'run.sh']);
  });
});
