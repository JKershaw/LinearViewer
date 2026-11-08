// The area notes guard (LIN-4371): the notes in docs/areas/ stay keyed on the registry and true to the tree.
// docs/areas/README.md owns the format; this test holds the four checks it names:
//   1. every notes file is named by a registry area's slug;
//   2. every path a note cites exists;
//   3. every waiting entry cites a path, and its first cited path maps to the note's own area;
//   4. every note stays under NOTE_BYTE_CAP.
// The checks are one pure function over (registry, files, exists), run once on the real tree and once per mutation,
// so each check is shown to fail on the defect it exists to catch. simple-dispatcher keeps its own copy (LIN-4372);
// the two repositories share no test code.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadAreas, areaOf } from './helpers/area-registry.js';

const NOTES_DIR = 'docs/areas';
// About 6 KB (LIN-4347's plan leaves the builder to pick it): a note is read before every change in its area, so it
// must stay short enough to read in full. The largest seeded note is about half of this.
export const NOTE_BYTE_CAP = 6144;
const NOT_NOTES = new Set(['README.md', 'areas.json']);
const SECTIONS = new Set(['Lessons', 'Waiting']);
const EXTENSIONS = 'js|mjs|cjs|json|md|css|html|txt|yml|yaml|toml';
// A repo-relative path in backticks: path characters only (a `:12` suffix stays in, so a line number fails check 2),
// and either a `/` in it or a file extension. `/dispatch`, `^lib/` and `provider.name` are not paths.
const PATH_SPAN = new RegExp(`^[\\w.:-]+(?:/[\\w.:-]+)*/?$`);
const HAS_EXTENSION = new RegExp(`\\.(?:${EXTENSIONS})$`);

/** Every backtick span in `text` that reads as a repo-relative path, in order. */
export function citedPaths(text) {
  return [...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1])
    .filter((s) => PATH_SPAN.test(s) && (s.includes('/') || HAS_EXTENSION.test(s.replace(/(:\d+)+$/, ''))));
}

/** A note's `##` sections and its waiting entries (one per top-level bullet, continuation lines joined). */
export function parseNote(text) {
  const headings = [];
  const waiting = [];
  let section = null;
  for (const line of text.split('\n')) {
    const h = /^## (.*)$/.exec(line);
    if (h) { section = h[1].trim(); headings.push(section); continue; }
    if (section !== 'Waiting') continue;
    if (line.startsWith('- ')) waiting.push(line.slice(2));
    else if (/^\s+\S/.test(line) && waiting.length) waiting[waiting.length - 1] += ` ${line.trim()}`;
  }
  return { headings, waiting };
}

/**
 * The four checks over one directory listing. `files` maps a file name in docs/areas/ to its text; `exists` answers
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
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > cap) problems.push({ check: 4, file, detail: `${bytes} bytes, over the ${cap}-byte cap` });
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

  test('every note in docs/areas/ passes the four checks', () => {
    assert.deepStrictEqual(checkAreaNotes(tree), []);
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

    test('4: a note over its byte cap', () => {
      const big = mutate((f) => ({ [note]: `${f[note]}\n${'x'.repeat(NOTE_BYTE_CAP)}\n` }));
      assert.deepStrictEqual(checksOf(big), [4]);
    });
  });

  test('citedPaths reads repo-relative paths only', () => {
    assert.deepStrictEqual(
      citedPaths('`lib/a.js` `server.js` `tests/fixtures/` `x.js:3` `/dispatch` `^lib/` `provider.name === 1` `GATE_DUE_MARKER` `doc.kind`'),
      ['lib/a.js', 'server.js', 'tests/fixtures/', 'x.js:3']);
  });
});
