/**
 * LIN-4502 (P2 of LIN-4499): the retirement census. P2 removes the `## As asked` seal, its proxy guard, the create
 * lanes' and first dispatch's seal, Jira's As-asked region and the readers only the seal used; then the close-out
 * prune, the write-below route it used (with its operation name and error code) and task snapshots (the store, the
 * capture, the routes, the test clear route, the replay and eval readers). This test fails on any of their words in
 * the code, the live docs, the fixtures and the public pages, outside a short allowance that names, for each file,
 * the exact words it may keep and why.
 *
 * It is built on the LIN-4495 census (tests/unit/lin-4495-retirement-census.test.js): the same file scan
 * (tests/unit/helpers/retirement-census.js, with that census's roots and reasoned exclusions: dated papers, plans and
 * reviews, the walk-8 stores, the runner kit) and the same planted-mutation proof. One difference: an allowance here
 * is per file AND per word, so a file allowed one word still fails on any other retired word.
 *
 * What stays a word on purpose, and is not retired: `## As asked` (the brief's part-1 label, owned by
 * lib/brief-quote.js), `askedOf` (the one writer rule), `askedText` (the records pipeline's injected-reader name), the
 * lower-case `harbour.asAsked` (the orphaned Jira property, left on older issues and named only to say so). The
 * `task-snapshots` collection name stays only where production data still needs it until the drop has run.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, CENSUS_ROOTS, EXCLUDED_PREFIXES } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The retired words, each with the spelling the census matches. */
export const RETIRED = Object.freeze([
  // The seal's, the guard's and the Jira region's functions and classes: sealAsAsked, splitAsAsked, checkAsAsked,
  // outsideAsAsked, refusedByAsAsked, providerHoldsAsAsked, holdAsAsked, AsAskedHoldError. Case-sensitive, so the
  // orphaned property's name (`harbour.asAsked`) is not one.
  { word: '*AsAsked* symbols', re: /AsAsked/ },
  // The old spellings and codes: AS_ASKED_HEADING/_END/_END_SHORT/_PARENT_*, AS_ASKED_IMMUTABLE, AS_ASKED_PROPERTY,
  // AS_ASKED_READ. (`NO_AS_ASKED_BLOCK` has no word boundary before AS_; it has its own row below.)
  { word: 'AS_ASKED_*', re: /\bAS_ASKED_[A-Z]/ },
  { word: 'sealForFiling', re: /\bsealForFiling\b/ },
  { word: 'sealOnFirstDispatch', re: /\bsealOnFirstDispatch\b/ },
  { word: 'hasDispatchForIssue', re: /\bhasDispatchForIssue\b/ },
  { word: 'carriesStageState', re: /\bcarriesStageState\b/ },
  { word: 'descriptionRoundTrip', re: /\bdescriptionRoundTrip\b/ },
  { word: 'hasMarkerLine', re: /\bhasMarkerLine\b/ },
  { word: 'the As-asked modules', re: /\bas-asked(?:-seal|-region)?\.js\b/ },
  { word: 'the [as-asked] log lines', re: /\[as-asked\]/ },
  // The quote's reader may read a description in one place only: lib/asked-of.js's legacy reader (see ALLOW).
  { word: 'splitQuote', re: /\bsplitQuote\b/ },
  // The close-out prune and the route it wrote through.
  { word: 'belowDescription', re: /\bbelowDescription\b/ },
  { word: 'NO_AS_ASKED_BLOCK', re: /\bNO_AS_ASKED_BLOCK\b/ },
  { word: 'the write-below route', re: /description\/below/ },
  { word: 'keepBlockThen', re: /\bkeepBlockThen\b/ },
  { word: 'Archive & Prune', re: /Archive & Prune/ },
  // Task snapshots.
  { word: 'task-snapshot-store', re: /task-snapshot-store/ },
  { word: 'task snapshot symbols', re: /\b(?:TaskSnapshotStore|taskSnapshotStore|captureTaskSnapshot|snapshotFromContext|diffSnapshots)\b/ },
  { word: 'clear-task-snapshots', re: /clear-task-snapshots/ },
  { word: 'the /snapshots routes', re: /issues\/[^\s`'"()]*\/snapshots\b/ },
  // Not inside a longer hyphenated name (clear-task-snapshots has its own row).
  { word: 'the task-snapshots collection', re: /(?<![\w-])task-snapshots\b/ },
]);

/**
 * Files that keep a retired word, each with the words it may keep and the reason. Short on purpose: a new entry needs
 * a reason here, and an allowance whose file no longer holds that word fails the stale-allowance test.
 */
export const ALLOW = Object.freeze({
  'lib/brief-quote.js': {
    words: ['splitQuote'],
    reason: 'the quote\'s home: splitQuote reads the brief\'s own quote (briefQuoteEnd), and the module defines it',
  },
  'lib/asked-of.js': {
    words: ['splitQuote'],
    reason: 'the ONE legacy reader of the block that tickets filed before P2 still carry (askedOf, readFact, outsideAsked, '
      + 'legacyBlockSpan all go through its private legacyBlock). Exit condition, written in its header: P4 (LIN-4504) moves '
      + 'plan facts and the size record to records, and no ticket with a block is left without a task; then this goes',
  },
  'scripts/prompt-template-change-log.md': {
    words: ['AS_ASKED_*', 'the As-asked modules', 'the write-below route', 'Archive & Prune'],
    reason: 'the change log: each row names what it changed or retired, so the old names are the record itself',
  },
  // Production still holds the collection until scripts/drop-task-snapshots-collection.mjs has run. These four go
  // (or lose the name) together after that run.
  'lib/account-erasure.js': {
    words: ['the task-snapshots collection'],
    reason: 'a Full wipe keeps erasing the collection while its per-task history is still in production, until the drop has run',
  },
  'lib/drop-task-snapshots-collection.js': {
    words: ['the task-snapshots collection'],
    reason: 'the one-off drop of the collection; its exported name keeps the collection in the derived universe until it runs',
  },
  'scripts/drop-task-snapshots-collection.mjs': {
    words: ['the task-snapshots collection'],
    reason: 'the operator script that runs the drop once after deploy; it names what it drops',
  },
  'scripts/dry-run-urlkey-duplicates.mjs': {
    words: ['the task-snapshots collection'],
    reason: 'the operator\'s urlKey dry run reads every collection that still holds workspace data; it goes with the erasure row',
  },
  // Dated records and recorded data, as the LIN-4495 census excludes dated papers: rewriting them would falsify them.
  'docs/prompt-pipeline/stage-descriptions/review-closeout.md': {
    words: ['the write-below route', 'the /snapshots routes'],
    reason: 'a dated analysis (3 Oct) whose banner says the archive, the snapshot check and the prune it describes are retired (LIN-4502)',
  },
  'docs/prompt-system-audit.md': {
    words: ['task-snapshot-store'],
    reason: 'a dated audit whose recommendations name the store as it stood; the store is retired, the audit is a record',
  },
  'docs/prompt-system-audit.html': {
    words: ['task-snapshot-store'],
    reason: 'the rendered copy of the dated audit above',
  },
  'scripts/eval/fixtures/recommend/large-dense.json': {
    words: ['task snapshot symbols', 'the /snapshots routes'],
    reason: 'recorded ticket text the recommend eval replays; the words are the tickets\' own, as written',
  },
  'scripts/eval/fixtures/recommend/_source/large-dense.json': {
    words: ['task snapshot symbols', 'the /snapshots routes'],
    reason: 'the source of the recorded eval fixture above: the tickets\' own words, as written',
  },
});

const allowed = (file, word, allow) => Boolean(allow[file]?.words.includes(word));

/**
 * Every retired word in the given files, outside the per-word allowance: `[{file, word, line}]`. Pure over the file
 * text, so the planted-mutation tests can run it over synthetic files. The exclusions are the file list's
 * (scanFiles), as in the LIN-4495 census; a synthetic path under an excluded prefix is skipped here too.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {Record<string, {words: string[], reason: string}>} [allow]
 */
export function findRetired(files, allow = ALLOW) {
  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    if (Object.keys(EXCLUDED_PREFIXES).some((p) => file.startsWith(p))) continue;
    for (const { word, re } of RETIRED) {
      if (allowed(file, word, allow)) continue;
      const m = re.exec(text);
      if (!m) continue;
      hits.push({ file, word, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return hits;
}

const censusFiles = () => scanFiles(ROOT, CENSUS_ROOTS, EXCLUDED_PREFIXES);
const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4502 retirement census: the seal, the guard, the Jira region, the prune and task snapshots left no word in the tree', () => {
  test('no retired word outside the per-word allowance and the exclusions', () => {
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

  test('the legacy reader\'s allowance names its exit condition', () => {
    assert.match(ALLOW['lib/asked-of.js'].reason, /Exit condition/);
    assert.match(readFileSync(join(ROOT, 'lib/asked-of.js'), 'utf8'), /Exit condition/, 'the module states it too');
  });

  test('the retired modules are gone from disk', () => {
    for (const path of ['lib/as-asked.js', 'lib/as-asked-seal.js', 'lib/providers/jira/as-asked-region.js', 'lib/task-snapshot-store.js', 'scripts/replay-brief.mjs']) {
      assert.throws(() => readFileSync(join(ROOT, path)), { code: 'ENOENT' }, path);
    }
  });

  test('a planted retired word is seen, one file per word: dropping any row leaves its file unseen', () => {
    const planted = {
      'lib/p1.js': 'export const sealed = sealAsAsked(words);\n',
      'lib/p2.js': "const code = 'AS_ASKED_IMMUTABLE';\n",
      'routes/p3.js': 'input.description = sealForFiling({ provider, words }).description;\n',
      'lib/p4.js': 'await sealOnFirstDispatch({ store });\n',
      'lib/p5.js': 'const earlier = await store.hasDispatchForIssue(urlKey, id);\n',
      'lib/p6.js': 'if (carriesStageState(text)) return;\n',
      'lib/providers/p7.js': 'descriptionRoundTrip(markdown) { return markdown; }\n',
      'routes/p8.js': 'if (hasMarkerLine(description)) return refuse();\n',
      'docs/areas/p9.md': 'The block lives in `lib/as-asked.js`.\n',
      'docs/p10.md': 'The server logs `[as-asked] seal skipped`.\n',
      'lib/p11.js': 'const parts = splitQuote(description);\n',
      'lib/p12.js': "const op = 'belowDescription';\n",
      'routes/p13.js': "throw new DescriptionEditError('NO_AS_ASKED_BLOCK', 'x');\n",
      'docs/p14.md': 'Send it to `POST /api/proxy/issues/{id}/description/below`.\n',
      'routes/p15.js': 'const next = keepBlockThen(current, body);\n',
      'lib/p16.js': "const h = '### Archive & Prune Superseded Stage Artifacts';\n",
      'lib/p17.js': "// modelled on lib/task-snapshot-store.js\n",
      'server.js': 'const store = new TaskSnapshotStore({ collection });\n',
      'tests/fixtures/p19.js': "await fetch('/test/clear-task-snapshots');\n",
      'docs/p20.md': 'Verify with `GET /api/proxy/issues/LIN-1/snapshots`.\n',
      'lib/p21.js': "db.collection('task-snapshots');\n",
    };
    assert.deepStrictEqual(findRetired(planted).map((h) => h.word).sort(), RETIRED.map((r) => r.word).sort());
  });

  test('a per-word allowance hides only its word in only its file', () => {
    const files = {
      'lib/asked-of.js': 'splitQuote(x); sealAsAsked(y);\n',
      'lib/other.js': 'splitQuote(x);\n',
    };
    assert.deepStrictEqual(findRetired(files).map((h) => `${h.file} ${h.word}`).sort(), ['lib/asked-of.js *AsAsked* symbols', 'lib/other.js splitQuote']);
  });

  test('the words that stay are not retired: the brief label, the writer rule, the injected-reader name, the orphaned property', () => {
    const files = {
      'lib/a.js': "const H = '## As asked'; askedOf(d); createRecordWrites({ askedText: askedOf });\n",
      'lib/b.js': "// the orphaned harbour.asAsked property is never read\nconst usage = 'a cumulative usage snapshot';\n",
    };
    assert.deepStrictEqual(findRetired(files), []);
  });

  test('an excluded prefix is skipped, as in the LIN-4495 census', () => {
    const excluded = ['docs', 'plans', 'x.md'].join('/');
    assert.deepStrictEqual(findRetired({ [excluded]: 'sealAsAsked\n' }), []);
  });
});
