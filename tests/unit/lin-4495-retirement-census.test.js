/**
 * LIN-4495 (piece 4 of LIN-4491): the retirement census. The cutover removes the Waiting lists, the `Retires:`
 * conveyor and its 422, the leftover answer's heading, the ledger's item parse and its counts, and the notes-PR
 * clause. This test fails on any of their words in the code, outside a short, reasoned allowlist.
 *
 * It is a word census over the code roots (lib/, routes/, server.js and scripts/*.mjs|js), with three deliberate
 * exclusions, each by file or symbol and not by a blanket word:
 *   - lib/runner-kit/ is the runner's own kit (its local ledger is the runner's, not this one): out by directory;
 *   - "Waiting" alone is never a retired word: Home's "Waiting on you" and lib/recommendation-look-first.js's live-run
 *     wait are different things (the census matches `## Waiting`, `countWaiting`, and the ledger's fields by symbol);
 *   - `.discharged` and `dischargedBy` are the ledger item's fields: retired words in lib/, routes/, scripts/. The
 *     reading of a finding is `openFindings` (lib/close-out-findings.js), which the census does not match.
 *
 * ALLOW lists the files that keep a retired word for a reason the census cannot read: the frozen one-off importer's
 * reader (it reads a pre-cutover ref, by design) and the history comments that name what they retired. The planted
 * mutation below proves the scan sees a new retired word, so an allowlisted file cannot hide a new one.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The retired words, each with the spelling the census matches. */
export const RETIRED = Object.freeze([
  { word: 'Retires:', re: /\bRetires:/ },
  { word: 'RETIRES_*', re: /\bRETIRES_[A-Z]/ },
  { word: 'LEFTOVER_RETIRES_', re: /LEFTOVER_RETIRES_/ },
  { word: 'NOTES_PR', re: /\bNOTES_PR\b/ },
  { word: '## Waiting', re: /^## Waiting\b/m },
  { word: 'countWaiting', re: /\bcountWaiting\b/ },
  { word: 'dispatch-leftover-answer', re: /dispatch-leftover-answer/ },
  { word: 'LEFTOVERS_HEADING', re: /\bLEFTOVERS_HEADING\b/ },
  { word: 'FOR_CLOSE_OUT', re: /\bFOR_CLOSE_OUT\b/ },
  { word: 'FOLLOW_UP_SHAPE', re: /\bFOLLOW_UP_SHAPE\b/ },
  { word: 'dischargedBy', re: /\bdischargedBy\b/ },
  { word: '.discharged', re: /\.discharged\b/ },
  { word: 'ledger.items', re: /\bledger\??\.items\b/ },
  { word: 'ledgerItems / ledgerOpen', re: /\bledger(?:Items|Open)\b/ },
]);

/** Files that keep a retired word, each with its reason. Short on purpose: a new entry needs a reason here. */
export const ALLOW = Object.freeze({
  'lib/prompts/leftover-words.js': 'the history header that says what the cutover retired (`Retires:`, the answer\'s guard)',
});

/** Directories out of the census, by path prefix (a directory's own ledger, not this one). */
const EXCLUDED_DIRS = ['lib/runner-kit/'];

function sourceFilesUnder(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, name);
    if (statSync(full).isDirectory()) { sourceFilesUnder(join(dir, name), out); continue; }
    if (/\.(m?js|js)$/.test(name)) out.push(join(dir, name).split(sep).join('/'));
  }
  return out;
}

/** The census's file list: lib/, routes/, server.js and scripts/ (its top level, the code). */
export function codeFiles() {
  const files = [...sourceFilesUnder('lib'), ...sourceFilesUnder('routes')];
  files.push('server.js');
  for (const name of readdirSync(join(ROOT, 'scripts'))) {
    if (/\.(m?js|js)$/.test(name)) files.push(`scripts/${name}`);
  }
  return files.filter((f) => !EXCLUDED_DIRS.some((d) => f.startsWith(d)));
}

/**
 * Every retired word in the given files, outside the allowlist: `[{file, word, line}]`. Pure over the file text, so the
 * planted-mutation test can run it over a synthetic file.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {Record<string, string>} [allow]
 */
export function findRetired(files, allow = ALLOW) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    if (allow[file] || EXCLUDED_DIRS.some((d) => file.startsWith(d))) continue;
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

describe('LIN-4495 retirement census: the cutover left no retired word in the code', () => {
  test('no retired word outside the reasoned allowlist', () => {
    const hits = findRetired(readAll(codeFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the code:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
  });

  test('every allowlisted file is scanned and still holds a retired word (an allowance with nothing to allow is stale)', () => {
    const all = readAll(codeFiles());
    for (const [file, reason] of Object.entries(ALLOW)) {
      assert.ok(all[file] !== undefined, `${file} is listed but not scanned`);
      assert.ok(RETIRED.some(({ re }) => re.test(all[file])), `${file} is allowlisted but holds no retired word: drop its entry`);
      assert.ok(reason.length > 20, `${file} needs a reason`);
    }
  });

  test('a planted retired word is seen: the scan is not vacuous', () => {
    const planted = { 'lib/new-leftover-thing.js': "export const X = 'Retires: `lib/a.js`: the entry';\n" };
    assert.equal(findRetired(planted).length, 1);
    assert.equal(findRetired({ 'lib/new-waiting.js': '\n## Waiting\n\n- `lib/a.js`: waits.\n' })[0].word, '## Waiting');
    assert.equal(findRetired({ 'lib/new-ledger.js': 'const n = review.ledger.items.length;\n' })[0].word, 'ledger.items');
    assert.equal(findRetired({ 'lib/new-ledger.js': 'const n = ledger?.items?.length;\n' })[0].word, 'ledger.items');
  });

  test('a file named in the allowlist is skipped, and only it: an allowance cannot hide a new word elsewhere', () => {
    const files = { 'lib/prompts/leftover-words.js': 'Retires: x\n', 'lib/other.js': 'Retires: x\n' };
    const hits = findRetired(files);
    assert.deepStrictEqual(hits.map((h) => h.file), ['lib/other.js']);
  });

  test('Home\'s "Waiting on you" and the live-run Waiting are not the retired word', () => {
    assert.deepStrictEqual(findRetired({ 'lib/waiting-section.js': "// Waiting on you\nconst label = 'Waiting on you';\n// a run waiting on a live run\n" }), []);
  });

  test('the runner kit is out of the census by directory (its own local ledger)', () => {
    assert.deepStrictEqual(findRetired({ 'lib/runner-kit/runner.mjs': 'const ledger = { items: [] }; ledger.items.push(1); // discharged\n' }), []);
  });
});
