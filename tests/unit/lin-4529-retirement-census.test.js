/**
 * LIN-4529: the retirement census for the rulings-as-records and ticket-section slice (LIN-4530 is its P1, the design and
 * the decision's own words; LIN-4543 is P9, which finalises the census). Each later piece of the slice adds the words it
 * retires to RETIRED, with a per-file reasoned allowance in ALLOW for any file that must keep one. This test then fails
 * on any retired word that comes back in the code, the live docs, the fixtures or the public pages.
 *
 * It is built on the LIN-4495 and LIN-4502 censuses: the same file scan (tests/unit/helpers/retirement-census.js, with
 * its roots and reasoned exclusions: dated papers, plans and designs of record, reviews, the walk-8 stores, the runner
 * kit), the same per-word, per-file allowance, and the same planted-mutation proof. It starts with RETIRED empty on
 * purpose: P1 retires nothing yet. An empty list is not a pass for free, so the proof below shows the scan sees a planted
 * word in a synthetic file and in a real file's text, and that an allowance hides only its word in only its file.
 *
 * Designs and plans of record (docs/plans/, including the integration design this slice revises) are excluded by the
 * shared list: they quote the retired words as the design they are, and rewriting them would falsify the record.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, CENSUS_ROOTS, EXCLUDED_PREFIXES } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The words this slice retires, each with the spelling the census matches. Empty until a piece retires something. */
export const RETIRED = Object.freeze([]);

/** Files that keep a retired word, each with the words it may keep and the reason. Empty until RETIRED has rows. */
export const ALLOW = Object.freeze({});

/**
 * Every retired word in the given files, outside the per-word allowance: `[{file, word, line}]`. Pure over the file text,
 * so the planted-mutation tests can run it over synthetic files. A file under an excluded prefix is skipped, as in the
 * census's file list.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {{retired?: readonly {word: string, re: RegExp}[], allow?: Record<string, {words: string[], reason: string}>}} [opts]
 */
export function findRetired(files, { retired = RETIRED, allow = ALLOW } = {}) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    if (Object.keys(EXCLUDED_PREFIXES).some((p) => file.startsWith(p))) continue;
    for (const { word, re } of retired) {
      if (allow[file]?.words.includes(word)) continue;
      const m = re.exec(text);
      if (!m) continue;
      hits.push({ file, word, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

const censusFiles = () => scanFiles(ROOT, CENSUS_ROOTS, EXCLUDED_PREFIXES);
const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4529 retirement census: what the slice retires is gone from the tree', () => {
  test('no retired word outside the per-word allowance and the exclusions', () => {
    const hits = findRetired(readAll(censusFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the tree:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
  });

  test('the scan reads the code and the live docs, and not the designs and plans of record', () => {
    const files = censusFiles();
    assert.ok(files.includes('lib/records/check.js'), 'the records code is scanned');
    assert.ok(files.includes('routes/proxy-records.js'), 'the records routes are scanned');
    assert.ok(!files.some((f) => f.startsWith('docs/plans/')), 'designs and plans of record are excluded, with their reason');
  });

  test('every allowance is scanned, still holds each word it allows, and carries a reason (a stale allowance fails)', () => {
    const all = readAll(censusFiles());
    for (const [file, { words, reason }] of Object.entries(ALLOW)) {
      assert.ok(all[file] !== undefined, `${file} is allowed but not scanned`);
      for (const word of words) {
        const row = RETIRED.find((r) => r.word === word);
        assert.ok(row, `${file} allows "${word}", which is not a retired word`);
        assert.ok(row.re.test(all[file]), `${file} is allowed "${word}" but no longer holds it: drop it`);
      }
      assert.ok(reason.length > 20, `${file} needs a reason`);
    }
  });

  test('each retired word has one row, a name, and a pattern', () => {
    const words = RETIRED.map((r) => r.word);
    assert.equal(new Set(words).size, words.length, 'no word is listed twice');
    for (const row of RETIRED) {
      assert.ok(row.word.length > 0 && row.re instanceof RegExp, `${row.word} has a name and a pattern`);
    }
  });

  test('a planted retired word is seen in every kind of file, one row per word', () => {
    const planted = [
      { word: 'planted: a function', re: /\bplantedRetiredFunction\b/ },
      { word: 'planted: a constant', re: /\bPLANTED_RETIRED_CONSTANT\b/ },
      { word: 'planted: a docs phrase', re: /planted retired phrase/ },
    ];
    const files = {
      'lib/p1.js': 'export const x = plantedRetiredFunction(1);\n',
      'routes/p2.js': "const code = 'PLANTED_RETIRED_CONSTANT';\n",
      'docs/areas/p3.md': 'The planted retired phrase is here.\n',
      'public/p4.js': 'const note = "planted retired phrase";\n',
      'scripts/p5.mjs': 'plantedRetiredFunction();\n',
    };
    const hits = findRetired(files, { retired: planted });
    assert.deepStrictEqual(hits.map((h) => `${h.file} ${h.word}`).sort(), [
      'docs/areas/p3.md planted: a docs phrase',
      'lib/p1.js planted: a function',
      'public/p4.js planted: a docs phrase',
      'routes/p2.js planted: a constant',
      'scripts/p5.mjs planted: a function',
    ]);
  });

  test('a per-word allowance hides only its word in only its file', () => {
    const retired = [
      { word: 'word A', re: /\bwordA\b/ },
      { word: 'word B', re: /\bwordB\b/ },
    ];
    const allow = { 'lib/keeps.js': { words: ['word A'], reason: 'a test allowance that keeps word A in this one file' } };
    const files = {
      'lib/keeps.js': 'wordA(); wordB();\n',
      'lib/other.js': 'wordA();\n',
    };
    assert.deepStrictEqual(findRetired(files, { retired, allow }).map((h) => `${h.file} ${h.word}`).sort(), [
      'lib/keeps.js word B',
      'lib/other.js word A',
    ]);
  });

  test('an excluded prefix is skipped, as in the other censuses', () => {
    const excluded = ['docs', 'plans', 'x.md'].join('/');
    const retired = [{ word: 'word A', re: /wordA/ }];
    assert.deepStrictEqual(findRetired({ [excluded]: 'wordA\n' }, { retired }), []);
  });

  test('a planted word in a real file is seen: the scan of the records check module, with one line added, fails', () => {
    // A mutation of the real tree in memory: the module's own text, plus one planted line. Nothing is written to disk.
    const real = readFileSync(join(ROOT, 'lib/records/check.js'), 'utf8');
    const retired = [{ word: 'planted: records check', re: /\bPLANTED_RETIRED_IN_REAL_FILE\b/ }];
    assert.deepStrictEqual(findRetired({ 'lib/records/check.js': real }, { retired }), [], 'unmutated, the planted word is absent');
    const mutated = `${real}\n// PLANTED_RETIRED_IN_REAL_FILE\n`;
    const hits = findRetired({ 'lib/records/check.js': mutated }, { retired });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].file, 'lib/records/check.js');
    assert.equal(hits[0].line, real.split('\n').length + 1, 'the hit is on the line that was added');
  });
});
