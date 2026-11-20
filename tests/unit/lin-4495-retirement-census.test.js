/**
 * LIN-4495 (piece 4 of LIN-4491): the retirement census. The cutover removes the Waiting lists, the `Retires:`
 * conveyor and its 422, the leftover answer's heading, the ledger's item parse and its counts, and the notes-PR
 * clause. This test fails on any of their words in the code, the docs and the fixtures, outside a short, reasoned
 * allowlist.
 *
 * It is a word census over the text under CENSUS_ROOTS (code, the live docs, the fixtures and the public pages), with
 * these deliberate exclusions, each by path and each with its reason in EXCLUDED_PREFIXES, and not by a blanket word:
 *   - lib/runner-kit/runner.mjs is the runner's own kit (its local ledger is the runner's, not this one);
 *   - docs/papers/, docs/plans/ and docs/reviews/ are dated records of the method as it was: they quote the retired
 *     words as history, and rewriting them would falsify the record;
 *   - tests/fixtures/walk-8/ is walk 8's store, ported to today's kinds (LIN-4496): the historical records the replay writes
 *     through the proxy, quoting the retired words as the walk wrote them;
 *   - the census's own test files are under tests/unit/, which is not a census root.
 * Matching is by symbol and by heading, not by bare word: "Waiting" alone is never retired (Home's "Waiting on you"
 * and lib/recommendation-look-first.js's wait on a live run are different things), and `## Waiting` matches anywhere,
 * including inside a JS string.
 *
 * ALLOW lists the files that keep a retired word for a reason the census cannot read. Each has its reason. The planted
 * mutations below prove the scan sees a new retired word, so an allowlisted file cannot hide a new one.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The retired words, each with the spelling the census matches. */
export const RETIRED = Object.freeze([
  { word: 'Retires:', re: /Retires:/ },
  { word: 'RETIRES_*', re: /\bRETIRES_[A-Z]/ },
  { word: 'LEFTOVER_RETIRES_', re: /LEFTOVER_RETIRES_/ },
  { word: 'NOTES_PR', re: /\bNOTES_PR\b/ },
  { word: '## Waiting', re: /## Waiting\b/ },
  { word: 'countWaiting', re: /\bcountWaiting\b/ },
  { word: 'dispatch-leftover-answer', re: /dispatch-leftover-answer/ },
  { word: 'LEFTOVERS_HEADING', re: /\bLEFTOVERS_HEADING\b/ },
  { word: 'FOR_CLOSE_OUT', re: /\bFOR_CLOSE_OUT\b/ },
  { word: 'FOLLOW_UP_SHAPE', re: /\bFOLLOW_UP_SHAPE\b/ },
  { word: 'dischargedBy', re: /\bdischargedBy\b/ },
  { word: '.discharged', re: /\.discharged\b/ },
  { word: 'ledger.items', re: /\bledger\??\.items\b/ },
  { word: 'ledgerItems / ledgerOpen', re: /\bledger(?:Items|Open)\b/ },
  // LIN-4505: the one-off importer and its frozen Waiting reader are retired (the records they wrote stay, by id).
  { word: 'parseWaitingSection', re: /\bparseWaitingSection\b/ },
  { word: 'countFrozenWaiting', re: /\bcountFrozenWaiting\b/ },
  { word: 'waitingAt', re: /\bwaitingAt\b/ },
  { word: 'planImport', re: /\bplanImport\b/ },
  { word: 'applyManifest', re: /\bapplyManifest\b/ },
  { word: 'waiting-import', re: /\bwaiting-import\b/ },
  { word: 'import-apply', re: /\bimport-apply\b/ },
  { word: 'records-import', re: /\brecords-import\b/ },
  { word: 'parked-tickets', re: /\bparked-tickets\b/ },
]);

/** The roots the census reads: the code, the live docs, the fixtures and the public pages. */
export const CENSUS_ROOTS = Object.freeze(['lib', 'routes', 'server.js', 'scripts', 'docs', 'tests/fixtures', 'public']);

/** Text extensions the census reads; binary assets (fonts, images) are not text and are not scanned. */
const TEXT_EXT = /\.(m?js|cjs|md|txt|json|html|css|ya?ml)$/;

/**
 * Paths out of the census, by prefix, each with its reason. A prefix is a directory (ending in `/`) or a file.
 * Short on purpose: a new entry needs a reason here.
 */
export const EXCLUDED_PREFIXES = Object.freeze({
  'lib/runner-kit/runner.mjs': 'the runner\'s own kit: its local ledger is the runner\'s, not this one',
  'docs/papers/': 'research papers: dated records of the method as it was, quoting the retired words as history',
  'docs/plans/': 'plans and designs of record: the LIN-4491 design quotes the retired words it retires',
  'docs/reviews/': 'dated review records, including the stability readings from before the cutover',
  'tests/fixtures/walk-8/': 'the walk-8 stores (LIN-4496), ported to today\'s kinds: the historical records the replay writes through the proxy, and their retired words (Retires: lines, the retired flags) are the walk\'s record, as the walk wrote them',
});

/**
 * Files that keep a retired word, each with its reason. Short on purpose: a new entry needs a reason here, and a file
 * listed here that holds no retired word fails the stale-allowance test.
 */
export const ALLOW = Object.freeze({
  'lib/prompts/leftover-words.js': 'the history header that says what the cutover retired (`Retires:`, the answer\'s guard)',
  'scripts/prompt-template-change-log.md': 'the change log: each row names what it retired, so the words are the record itself',
  'tests/fixtures/run-ledger-trails.js': 'pre-cutover review comments, kept as the legacy-hold fixture: the ledger items as the comment wrote them, read as text',
});

function textFilesUnder(rel, out = []) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) return out;
  if (!statSync(full).isDirectory()) {
    if (TEXT_EXT.test(rel)) out.push(rel.split(sep).join('/'));
    return out;
  }
  for (const name of readdirSync(full)) textFilesUnder(join(rel, name), out);
  return out;
}

/** The census's file list: the text under CENSUS_ROOTS, minus the excluded prefixes (the scan's whole input). */
export function censusFiles() {
  return CENSUS_ROOTS.flatMap((root) => textFilesUnder(root))
    .filter((f) => !Object.keys(EXCLUDED_PREFIXES).some((p) => f.startsWith(p)))
    .sort();
}

/**
 * Every retired word in the given files, outside the allowlist and the excluded prefixes: `[{file, word, line}]`. Pure
 * over the file text, so the planted-mutation tests can run it over a synthetic file.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {Record<string, string>} [allow]
 */
export function findRetired(files, allow = ALLOW) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    if (allow[file] || Object.keys(EXCLUDED_PREFIXES).some((p) => file.startsWith(p))) continue;
    for (const { word, re } of RETIRED) {
      const m = re.exec(text);
      if (!m) continue;
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ file, word, line });
    }
  }
  return hits;
}

const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4495 retirement census: the cutover left no retired word in the code, the docs or the fixtures', () => {
  test('no retired word outside the reasoned allowlist and exclusions', () => {
    const hits = findRetired(readAll(censusFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the tree:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
  });

  test('every allowlisted file is scanned and still holds a retired word (an allowance with nothing to allow is stale)', () => {
    const all = readAll(censusFiles());
    for (const [file, reason] of Object.entries(ALLOW)) {
      assert.ok(all[file] !== undefined, `${file} is listed but not scanned`);
      assert.ok(RETIRED.some(({ re }) => re.test(all[file])), `${file} is allowlisted but holds no retired word: drop its entry`);
      assert.ok(reason.length > 20, `${file} needs a reason`);
    }
  });

  test('every excluded prefix names a real path and carries a reason (an exclusion with nothing to exclude is stale)', () => {
    for (const [prefix, reason] of Object.entries(EXCLUDED_PREFIXES)) {
      assert.ok(existsSync(join(ROOT, prefix)), `${prefix} is excluded but does not exist`);
      assert.ok(reason.length > 20, `${prefix} needs a reason`);
    }
  });

  test('the census reads the roots it names: docs, fixtures and public pages are scanned, not only code', () => {
    const files = censusFiles();
    assert.ok(files.some((f) => f.startsWith('docs/architecture/')), 'docs/architecture is scanned');
    assert.ok(files.some((f) => f.startsWith('tests/fixtures/')), 'the fixtures are scanned');
    assert.ok(files.some((f) => f.startsWith('public/')), 'the public pages are scanned');
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
    const planted = {
      'lib/new-import.js': 'export const plan = planImport(notes);\n',
      'scripts/new-import.mjs': "import { countFrozenWaiting } from './x.js';\n",
      'docs/areas/new.md': 'The one-off `records-import` ran from the notes.\n',
      'lib/new-manifest.js': 'await applyManifest({});\n',
    };
    assert.deepStrictEqual(findRetired(planted).map((h) => h.word).sort(), ['applyManifest', 'countFrozenWaiting', 'planImport', 'records-import'].sort());
  });

  test('a file named in the allowlist is skipped, and only it: an allowance cannot hide a new word elsewhere', () => {
    const files = { 'lib/prompts/leftover-words.js': 'Retires: x\n', 'lib/other.js': 'Retires: x\n' };
    const hits = findRetired(files);
    assert.deepStrictEqual(hits.map((h) => h.file), ['lib/other.js']);
  });

  test('an excluded prefix is skipped, and only it', () => {
    const excluded = ['docs', 'plans', 'x.md'].join('/');
    const kept = ['docs', 'architecture', 'x.md'].join('/');
    const files = { [excluded]: '## Waiting\n', [kept]: '## Waiting\n' };
    assert.deepStrictEqual(findRetired(files).map((h) => h.file), [kept]);
  });

  test('Home\'s "Waiting on you" and the live-run Waiting are not the retired word', () => {
    assert.deepStrictEqual(findRetired({ 'lib/waiting-section.js': "// Waiting on you\nconst label = 'Waiting on you';\n// a run waiting on a live run\n" }), []);
  });

  test('runner.mjs of the runner kit is out of the census by file (its own local ledger)', () => {
    assert.deepStrictEqual(findRetired({ 'lib/runner-kit/runner.mjs': 'const ledger = { items: [] }; ledger.items.push(1); // discharged\n' }), []);
  });
});
