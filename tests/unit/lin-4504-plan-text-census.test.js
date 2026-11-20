/**
 * LIN-4504 (slice 2, P4): the plan-text census. Plans are records: no stage writes a plan into a description, and
 * nothing reads a plan, its session fit or whether a review is owed from ticket text. This test fails on the words of
 * the old plan text and of every reader LIN-4504 retired, in the code, the live docs, the fixtures and the public
 * pages, outside a short per-file, per-word allowance that says why each kept word stays.
 *
 * It is built on the LIN-4495 census (tests/unit/lin-4495-retirement-census.test.js) and the LIN-4502 census beside it:
 * the same file scan (tests/unit/helpers/retirement-census.js, with its roots and reasoned exclusions), file-and-word
 * allowances, a stale-allowance test, and a planted-mutation proof for every word. Its own exclusions add, each with its
 * reason, the dated eval records and output folders, the recorded ticket corpora and the dated docs: rewriting them would
 * falsify them. Recorded corpora get no vocabulary ban; tests/unit/lin-4504-plan-facts.test.js holds the selector's facts
 * byte-identical whatever a description's plan section says instead (the description-invariance test).
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
import { scanFiles, CENSUS_ROOTS, EXCLUDED_PREFIXES } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const symbol = (name) => ({ word: name, re: new RegExp(`\\b${name}\\b`) });

/** The retired words, each with the spelling the census matches. */
export const RETIRED = Object.freeze([
  { word: 'the plan heading', re: /implementation plan/i },
  { word: 'fits one session', re: /\bfits one session\b/i },
  { word: 'needs multiple sessions', re: /\bneeds multiple sessions\b/i },
  { word: 'plan-review due', re: /plan-review due/i },
  ...['extractPlanSection', 'extractPlanPaths', 'PLAN_HEADING_ANY', 'isPlanComment', 'sessionFitOf', 'extractSessionFit',
    'planReviewDueOf', 'condensePlan', 'PLAN_MARKER', 'parentPlan', 'carriesStageState', 'readFact', 'countPilotEligible',
    'PLAN_READ_TIMEOUT_MS', 'gateFieldsAvailable'].map(symbol),
  { word: 'file-pointer', re: /file-pointer/i },
  { word: 'FILE_POINTER', re: /FILE_POINTER/ },
  { word: 'github-pr-files', re: /github-pr-files/ },
]);

/**
 * Paths out of this census, by prefix, beyond the shared exclusions (EXCLUDED_PREFIXES), each with its reason. Dated
 * records and recorded data: rewriting them would falsify them. Short on purpose.
 */
export const SLICE2_EXCLUDED = Object.freeze({
  'scripts/eval/recommend-baseline/': 'a dated eval baseline: the recommend outputs as recorded',
  'scripts/eval/lin-3309-pass-bar/': 'a dated eval record (LIN-3309): the pass bar as it was set',
  'scripts/eval/lin-263-spike2-out/': 'a dated eval output folder: what the model wrote then',
  'scripts/eval/lin-263-spike3-out/': 'a dated eval output folder: what the model wrote then',
  'scripts/eval/jev-routing-out/': 'a dated eval output folder (LIN-3107)',
  'scripts/eval/assessment-scaffold-out/': 'a dated eval output folder',
  'scripts/eval/lin-263-spike2-results.md': 'a dated eval results write-up',
  'scripts/eval/fixtures/': 'recorded ticket corpora: the tickets\' own words, as written (the invariance test covers what they feed)',
  'scripts/eval/fixtures-widened/': 'recorded ticket corpora (LIN-3107 class D), as written',
  'scripts/eval/jev-routing-corpus.json': 'the recorded verb-override corpus table (LIN-3107)',
  'scripts/eval/build-widened-routing-fixtures.mjs': 'the builder of the recorded fixtures-widened corpus, whose quoted ticket text and two hand-built cases are written in that corpus\'s own era',
  'scripts/eval/jev-routing-eval.mjs': 'the dated LIN-3107 eval harness; its gold-override reasons quote the recorded corpus',
  'scripts/eval/lin-3372-selector-context/': 'a dated LIN-3372 experiment that replays recorded points through the selector as it was',
  'scripts/eval-plan-review-verdict.mjs': 'a paid-model eval\'s seeded input, kept as it was set; paid-model evals were not re-run for LIN-4504',
  'docs/prompt-pipeline/stage-descriptions/': 'dated analyses (3 Oct 2026), bannered as superseded, describing the prompts as they stood',
  'docs/autopilot-experiment.md': 'a dated experiment record',
  'docs/lin-260-prompt-scaling-research.md': 'dated research (LIN-260)',
  'docs/plan-LIN-180-dispatch-custom-prompt.md': 'a dated plan of record (LIN-180)',
  'docs/prompt-system-audit.md': 'a dated audit whose recommendations name the code as it stood',
  'docs/prompt-system-audit.html': 'the rendered copy of the dated audit above',
  'docs/recommendation-engine-redesign.md': 'a dated design record',
});

/**
 * Files that keep a retired word, each with the words it may keep and the reason. An allowance whose file no longer
 * holds that word fails the stale-allowance test.
 */
export const ALLOW = Object.freeze({
  'lib/legacy-plan-text.js': {
    words: ['the plan heading'],
    reason: 'the one recognition rule for old plan text: it recognises the heading so asked, the kept section and the selector view leave it out and new description writes refuse it; it returns text, never a fact',
  },
  'scripts/prompt-template-change-log.md': {
    words: ['the plan heading', 'fits one session', 'plan-review due', 'condensePlan', 'PLAN_MARKER', 'file-pointer'],
    reason: 'the change log: each row names what it changed or retired, so the old names are the record itself',
  },
  'scripts/survey-overlap-lib.mjs': {
    words: ['the plan heading'],
    reason: 'the LIN-3179 research instrument: it sorts historical description text into steps by heading for the step-overlap paper; it reads no plan fact and drives no route or metric',
  },
  'tests/fixtures/cost-replay/goldens.json': {
    words: ['plan-review due', 'planReviewDueOf'],
    reason: 'the frozen LIN-4177 baseline the change list is measured from; it is never re-recorded (agent-api Lesson, LIN-4404), and expected-changes.json names the S10 notes LIN-4504 moved',
  },
  'tests/fixtures/run-ledger-trails.js': {
    words: ['fits one session'],
    reason: 'recorded trail comments, as written, that the run-ledger tests replay',
  },
});

const allowed = (file, word, allow) => Boolean(allow[file]?.words.includes(word));
const excluded = (file) => [...Object.keys(EXCLUDED_PREFIXES), ...Object.keys(SLICE2_EXCLUDED)].some((p) => file.startsWith(p));

/**
 * Every retired word in the given files, outside the allowance and the exclusions: `[{file, word, line}]`. Pure over
 * the file text, so the planted-mutation tests can run it over synthetic files.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {Record<string, {words: string[], reason: string}>} [allow]
 */
export function findRetired(files, allow = ALLOW) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    if (excluded(file)) continue;
    for (const { word, re } of RETIRED) {
      if (allowed(file, word, allow)) continue;
      const m = re.exec(text);
      if (!m) continue;
      hits.push({ file, word, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

const censusFiles = () => scanFiles(ROOT, CENSUS_ROOTS, EXCLUDED_PREFIXES).filter((f) => !excluded(f));
const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4504 plan-text census: no plan text is written or read, and the retired readers and pilot left no word', () => {
  test('no retired word outside the allowance and the exclusions', () => {
    const hits = findRetired(readAll(censusFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the tree:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
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

  test('every exclusion names a path that exists and carries a reason (a stale exclusion fails)', () => {
    const scanned = scanFiles(ROOT, CENSUS_ROOTS, EXCLUDED_PREFIXES);
    for (const [prefix, reason] of Object.entries(SLICE2_EXCLUDED)) {
      assert.ok(scanned.some((f) => f.startsWith(prefix)), `${prefix} is excluded but nothing under it is scanned: drop it`);
      assert.ok(reason.length > 20, `${prefix} needs a reason`);
    }
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
      'lib/p21.js': "const marker = FILE_POINTER_MARKER;\n",
      'lib/p22.js': "import { collectPrFiles } from './github-pr-files.js';\n",
    };
    const hits = findRetired(planted, {});
    const seen = new Set(hits.map((h) => h.file));
    assert.deepEqual(Object.keys(planted).filter((f) => !seen.has(f)), [], 'every planted file is seen');
    for (const row of RETIRED) {
      const without = RETIRED.filter((r) => r !== row);
      const missed = Object.entries(planted).filter(([, text]) => !without.some((r) => r.re.test(text)) && row.re.test(text));
      assert.ok(missed.length >= 1, `${row.word}: some planted file is caught by this row alone`);
    }
    assert.deepEqual(findRetired({ 'docs/autopilot-experiment.md': 'fits one session' }, {}), [], 'an excluded dated record is not scanned');
    assert.deepEqual(findRetired({ 'lib/legacy-plan-text.js': 'Implementation Plan' }), [], 'the leaf keeps the heading');
    assert.equal(findRetired({ 'lib/legacy-plan-text.js': 'Implementation Plan; plan-review due' }).length, 1, 'but no other word');
  });
});
