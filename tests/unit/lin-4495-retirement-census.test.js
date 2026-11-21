/**
 * LIN-4495 (piece 4 of LIN-4491): the retirement census. The cutover removes the Waiting lists, the `Retires:`
 * conveyor and its 422, the leftover answer's heading, the ledger's item parse and its counts, and the notes-PR
 * clause. This test fails on any of their words in the code, the docs, the fixtures and the tests, outside the shared
 * RETAINED table (tests/unit/helpers/retirement-census.js).
 *
 * LIN-4524 (piece A) moved this census onto that one table, and widened its scan from the code, docs, fixtures and
 * public pages to the whole tests root. What the census keeps from before:
 *   - its words: CENSUS_WORDS.LIN_4495, unchanged;
 *   - its matching: by symbol and by heading, not by bare word ("Waiting" alone is never retired; `## Waiting` matches
 *     anywhere, including inside a JS string);
 *   - its reasoned exclusions (dated papers, plans and reviews, the walk-8 stores, the runner's own kit) and its
 *     allowances, now rows of the table, each with its kind and reason;
 *   - its planted-mutation proofs below, so a row cannot hide a new word.
 * What changed: the per-file allowances and the exclusion list are rows of RETAINED, and every row is checked against
 * the real tree by tests/unit/retirement-census-table.test.js (a stale row, a missing file, an unknown word, a
 * duplicate, a row outside the scanned roots). The stale-allowance and excluded-path tests this file used to hold are
 * that table test now, so they check every census's rows, not only this one's.
 *
 * The census's own test files, and its helper, are SELF: they name the words as their own lists.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, censusHits, CENSUS_WORDS, RETAINED, SELF, WHOLE_ROOTS } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The retired words, each with the spelling the census matches. */
export const RETIRED = CENSUS_WORDS.LIN_4495;

/**
 * Every LIN-4495 word in the given files that no row covers, and that is not SELF: `[{file, word, line}]`. Pure over the
 * file text, so the planted-mutation tests can run it over synthetic files.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {readonly object[]} [rows] - the table (default: the shared RETAINED)
 */
export function findRetired(files, rows = RETAINED) {
  return censusHits(files, RETIRED, 'LIN_4495', rows, SELF);
}

/** The census's file list: the text under the whole tests root and the census roots (the shared table does the excluding). */
export function censusFiles() {
  return scanFiles(ROOT, WHOLE_ROOTS);
}

const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4495 retirement census: the cutover left no retired word in the code, the docs, the fixtures or the tests', () => {
  test('no retired word outside the shared table, the SELF list and the reasoned records', () => {
    const hits = findRetired(readAll(censusFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the tree:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
  });

  test('the census reads the roots it names: docs, fixtures, public pages and the whole tests root', () => {
    const files = censusFiles();
    assert.ok(files.some((f) => f.startsWith('docs/architecture/')), 'docs/architecture is scanned');
    assert.ok(files.some((f) => f.startsWith('tests/fixtures/')), 'the fixtures are scanned');
    assert.ok(files.some((f) => f.startsWith('public/')), 'the public pages are scanned');
    assert.ok(files.some((f) => f.startsWith('tests/unit/')), 'the whole tests root is scanned, not only the fixtures (LIN-4524)');
  });

  test('a planted retired word is seen: the scan is not vacuous', () => {
    const planted = { 'lib/new-leftover-thing.js': "export const X = 'Retires: `lib/a.js`: the entry';\n" };
    assert.equal(findRetired(planted).length, 1);
    assert.equal(findRetired({ 'lib/new-waiting.js': '\n## Waiting\n\n- `lib/a.js`: waits.\n' })[0].word, '## Waiting');
    assert.equal(findRetired({ 'lib/new-waiting-string.js': "const H = '## Waiting';\n" })[0].word, '## Waiting', 'a heading inside a JS string is seen');
    const docNote = ['docs', 'areas', 'new.md'].join('/');
    assert.equal(findRetired({ [docNote]: 'Lessons.\n\n## Waiting\n' })[0].word, '## Waiting', 'a heading in a doc is seen');
    assert.equal(findRetired({ 'lib/new-ledger.js': 'const n = review.ledger.items.length;\n' })[0].word, 'ledger.items');
    assert.equal(findRetired({ 'lib/new-ledger.js': 'const n = ledger?.items?.length;\n' })[0].word, 'ledger.items');
    assert.equal(findRetired({ 'public/new.js': "const s = 'Waiting for you: ## Waiting';\n" })[0].word, '## Waiting');
  });

  test('LIN-4505: the retired importer names are seen anywhere in the census, so a revived importer fails here', () => {
    // One planted file per word the LIN-4505 change added to RETIRED: dropping any one row leaves its file unseen and fails the equality.
    const planted = {
      'lib/new-import.js': 'export const plan = planImport(notes);\n',
      'scripts/new-import.mjs': "import { countFrozenWaiting } from './x.js';\n",
      'docs/areas/new.md': 'The one-off `records-import` ran from the notes.\n',
      'lib/new-manifest.js': 'await applyManifest({});\n',
      'lib/new-section.js': 'const sections = parseWaitingSection(text);\n',
      'lib/new-endpoint.js': 'const n = waitingAt(sha);\n',
      'docs/areas/new-reader.md': 'Read by the retired waiting-import module.\n',
      'docs/areas/new-apply.md': 'Written by the retired import-apply module.\n',
      'scripts/new-list.mjs': "const list = 'scripts/records/parked-tickets.json';\n",
    };
    const nine = ['applyManifest', 'countFrozenWaiting', 'import-apply', 'parked-tickets', 'parseWaitingSection', 'planImport', 'records-import', 'waiting-import', 'waitingAt'];
    assert.deepStrictEqual(findRetired(planted).map((h) => h.word).sort(), nine);
  });

  test('a row covers its file and its word, and nothing else: a file named in a row is skipped for that word, and only it', () => {
    const rows = [{ kind: 'record', file: 'lib/prompts/leftover-words.js', words: ['Retires:'], reason: 'the history header' }];
    const files = { 'lib/prompts/leftover-words.js': 'Retires: x\n', 'lib/other.js': 'Retires: x\n' };
    assert.deepStrictEqual(findRetired(files, rows).map((h) => h.file), ['lib/other.js']);
  });

  test('a directory row covers every file under it, for its word; a file outside the directory is still read', () => {
    const rows = [{ kind: 'record', file: 'docs/plans/', words: ['*'], reason: 'plans of record' }];
    const excluded = ['docs', 'plans', 'x.md'].join('/');
    const kept = ['docs', 'architecture', 'x.md'].join('/');
    const files = { [excluded]: '## Waiting\n', [kept]: '## Waiting\n' };
    assert.deepStrictEqual(findRetired(files, rows).map((h) => h.file), [kept]);
  });

  test('an ALL:<census> row covers only that census\'s words: this census still reads the others under the same directory', () => {
    const rows = [{ kind: 'record', file: 'scripts/eval/fixtures/', words: ['ALL:LIN_4504'], reason: 'recorded corpora' }];
    const files = { 'scripts/eval/fixtures/a.json': 'Retires: x; fits one session\n' };
    assert.deepStrictEqual(findRetired(files, rows).map((h) => h.word), ['Retires:']);
  });

  test('Home\'s "Waiting on you" and the live-run Waiting are not the retired word', () => {
    assert.deepStrictEqual(findRetired({ 'lib/waiting-section.js': "// Waiting on you\nconst label = 'Waiting on you';\n// a run waiting on a live run\n" }), []);
  });

  test('the runner\'s own kit is covered by its live row: its ledger.items is the runner\'s, the census keeps reading the rest', () => {
    assert.deepStrictEqual(findRetired({ 'lib/runner-kit/runner.mjs': 'const ledger = { items: [] }; ledger.items.push(1); // discharged\n' }), []);
    assert.equal(findRetired({ 'lib/runner-kit/runner.mjs': "// Retires: x\n" }).length, 1, 'a retired word the row does not name is still seen');
  });
});
