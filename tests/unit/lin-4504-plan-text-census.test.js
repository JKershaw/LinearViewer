/**
 * LIN-4504 (slice 2, P4): the plan-text census. Plans are records: no stage writes a plan into a description, and
 * nothing reads a plan, its session fit or whether a review is owed from ticket text. This test fails on the words of
 * the old plan text and of every reader LIN-4504 retired, in the code, the docs, the fixtures and the tests, outside
 * the shared RETAINED table (tests/unit/helpers/retirement-census.js).
 *
 * LIN-4524 (piece A) moved this census onto that one table and widened its scan to the whole tests root. Its words
 * (CENSUS_WORDS.LIN_4504) are unchanged. Its allowances and its dated-record exclusions (the eval folders, the recorded
 * ticket corpora, the dated docs) are rows of RETAINED: the excluded directories are `ALL:LIN_4504` rows, so this
 * census skips its own words there and nothing else, as before. tests/unit/retirement-census-table.test.js checks every
 * row against the real tree.
 *
 * The words (case-insensitive for prose): the plan heading's words; the three phrases the old session-fit and
 * review-due lines were written in; and the retired readers and the pilot: extractPlanSection, extractPlanPaths,
 * PLAN_HEADING_ANY, isPlanComment, sessionFitOf, extractSessionFit, planReviewDueOf, condensePlan, PLAN_MARKER,
 * parentPlan, carriesStageState, readFact, the file-pointer pilot (its module, marker and env switch), the GitHub PR
 * files reader, countPilotEligible, PLAN_READ_TIMEOUT_MS and gateFieldsAvailable.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, censusHits, CENSUS_WORDS, RETAINED, SELF, WHOLE_ROOTS } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The retired words, each with the spelling the census matches. */
export const RETIRED = CENSUS_WORDS.LIN_4504;

/**
 * Every LIN-4504 word in the given files that no row covers, and that is not SELF: `[{file, word, line}]`. Pure over the
 * file text, so the planted-mutation tests can run it over synthetic files.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {readonly object[]} [rows] - the table (default: the shared RETAINED)
 */
export function findRetired(files, rows = RETAINED) {
  return censusHits(files, RETIRED, 'LIN_4504', rows, SELF);
}

const censusFiles = () => scanFiles(ROOT, WHOLE_ROOTS);
const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4504 plan-text census: no plan text is written or read, and the retired readers and pilot left no word', () => {
  test('no retired word outside the shared table, the SELF list and the reasoned records', () => {
    const hits = findRetired(readAll(censusFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the tree:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
  });

  test('the leaf allowed the heading exports no fact reader', async () => {
    const leaf = await import('../../lib/legacy-plan-text.js');
    for (const name of Object.keys(leaf)) assert.doesNotMatch(name, /fit|due|owed|review|session|facts?$/i, `${name}: the leaf returns text, never a fact`);
  });

  test('the retired modules are gone from disk', () => {
    for (const path of ['lib/file-pointer.js', 'lib/github-pr-files.js', 'scripts/file-pointer-read.mjs']) {
      assert.throws(() => readFileSync(join(ROOT, path)), { code: 'ENOENT' }, path);
    }
  });

  test('a planted retired word is seen, one file per word: dropping any row leaves its file unseen', () => {
    const planted = {
      'lib/p1.js': "lines.push('## Implementation Plan');\n",
      'lib/p2.js': "// State session fit as exactly `fits one session`.\n",
      'docs/architecture/p3.md': 'The plan says it needs multiple sessions.\n',
      'routes/p4.js': "if (/plan-review due: yes/.test(d)) due = true;\n",
      'lib/p5.js': 'const section = extractPlanSection(description);\n',
      'scripts/p6.mjs': 'const paths = extractPlanPaths(description);\n',
      'lib/p7.js': 'if (PLAN_HEADING_ANY.test(body)) return true;\n',
      'lib/p8.js': 'const plan = comments.find(isPlanComment);\n',
      'lib/p9.js': 'return sessionFitOf(text);\n',
      'lib/p10.js': 'const fit = extractSessionFit(issue.description);\n',
      'lib/p11.js': 'const due = planReviewDueOf(description);\n',
      'lib/p12.js': 'view.push(condensePlan(description));\n',
      'lib/p13.js': 'if (PLAN_MARKER.test(d)) planned = true;\n',
      'lib/p14.js': 'assembleTrailFacts(comments, d, { parentPlan });\n',
      'lib/p15.js': 'if (carriesStageState(d)) return;\n',
      'lib/p16.js': 'return readFact(d, parse);\n',
      'lib/p17.js': 'const n = await store.countPilotEligible(urlKey);\n',
      'lib/p18.js': 'const cap = PLAN_READ_TIMEOUT_MS;\n',
      'lib/p19.js': 'computeEffortReadout({ gateFieldsAvailable: true });\n',
      'lib/p20.js': "import { buildFilePointer } from './file-pointer.js';\n",
      'lib/p21.js': 'const marker = FILE_POINTER_MARKER;\n',
      'lib/p22.js': "import { collectPrFiles } from './github-pr-files.js';\n",
    };
    const hits = findRetired(planted, []);
    const seen = new Set(hits.map((h) => h.file));
    assert.deepEqual(Object.keys(planted).filter((f) => !seen.has(f)), [], 'every planted file is seen');
    for (const row of RETIRED) {
      const without = RETIRED.filter((r) => r !== row);
      const missed = Object.entries(planted).filter(([, text]) => !without.some((r) => r.re.test(text)) && row.re.test(text));
      assert.ok(missed.length >= 1, `${row.word}: some planted file is caught by this row alone`);
    }
    assert.deepEqual(findRetired({ 'docs/autopilot-experiment.md': 'fits one session' }), [], 'an excluded dated record is not scanned');
    assert.deepEqual(findRetired({ 'lib/legacy-plan-text.js': 'Implementation Plan' }), [], 'the leaf keeps the heading');
    assert.equal(findRetired({ 'lib/legacy-plan-text.js': 'Implementation Plan; plan-review due' }).length, 1, 'but no other word');
  });
});
