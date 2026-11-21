/**
 * LIN-4502 (P2 of LIN-4499): the retirement census. P2 removes the `## As asked` seal, its proxy guard, the create
 * lanes' and first dispatch's seal, Jira's As-asked region and the readers only the seal used; then the close-out
 * prune, the write-below route it used (with its operation name and error code) and task snapshots (the store, the
 * capture, the routes, the test clear route, the replay and eval readers). This test fails on any of their words in
 * the code, the docs, the fixtures and the tests, outside the shared RETAINED table (tests/unit/helpers/retirement-census.js).
 *
 * LIN-4524 (piece A) moved this census onto that one table and widened its scan to the whole tests root. Its words
 * (CENSUS_WORDS.LIN_4502) are unchanged; its per-file, per-word allowances are rows of RETAINED, each with a kind and a
 * reason, and tests/unit/retirement-census-table.test.js checks every row against the real tree.
 *
 * What stays a word on purpose, and is not retired: `## As asked` (the brief's part-1 label, owned by
 * lib/brief-quote.js), `askedOf` (the one writer rule), `askedText` (the records pipeline's injected-reader name), the
 * lower-case `harbour.asAsked` (the orphaned Jira property, left on older issues and named only to say so). The
 * `task-snapshots` collection name stays only in the operator drop group, until the drop has run.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, censusHits, CENSUS_WORDS, RETAINED, SELF, WHOLE_ROOTS } from './helpers/retirement-census.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The retired words, each with the spelling the census matches. */
export const RETIRED = CENSUS_WORDS.LIN_4502;

/**
 * Every LIN-4502 word in the given files that no row covers, and that is not SELF: `[{file, word, line}]`. Pure over the
 * file text, so the planted-mutation tests can run it over synthetic files.
 * @param {Record<string, string>} files - repo-relative path → text
 * @param {readonly object[]} [rows] - the table (default: the shared RETAINED)
 */
export function findRetired(files, rows = RETAINED) {
  return censusHits(files, RETIRED, 'LIN_4502', rows, SELF);
}

const censusFiles = () => scanFiles(ROOT, WHOLE_ROOTS);
const readAll = (files) => Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

describe('LIN-4502 retirement census: the seal, the guard, the Jira region, the prune and task snapshots left no word in the tree', () => {
  test('no retired word outside the shared table, the SELF list and the reasoned records', () => {
    const hits = findRetired(readAll(censusFiles()));
    assert.deepStrictEqual(hits, [], `retired words still in the tree:\n${hits.map((h) => `  ${h.file}:${h.line} ${h.word}`).join('\n')}`);
  });

  test('the legacy reader\'s row names its exit, and the module states the same condition in its header', () => {
    const row = RETAINED.find((r) => r.file === 'lib/asked-of.js');
    assert.ok(row, 'lib/asked-of.js has a row');
    assert.match(row.exit, /piece B/, 'the row names the piece that removes the reader');
    assert.match(readFileSync(join(ROOT, 'lib/asked-of.js'), 'utf8'), /Exit condition/, 'the module states its exit condition too');
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
      'lib/p17.js': '// modelled on lib/task-snapshot-store.js\n',
      'server.js': 'const store = new TaskSnapshotStore({ collection });\n',
      'tests/fixtures/p19.js': "await fetch('/test/clear-task-snapshots');\n",
      'docs/p20.md': 'Verify with `GET /api/proxy/issues/LIN-1/snapshots`.\n',
      'lib/p21.js': "db.collection('task-snapshots');\n",
    };
    assert.deepStrictEqual(findRetired(planted).map((h) => h.word).sort(), RETIRED.map((r) => r.word).sort());
  });

  test('a row covers one word in one file: a temporary row hides its word in its file, and nothing else', () => {
    const rows = [{ kind: 'temporary', file: 'lib/asked-of.js', words: ['splitQuote'], reason: 'the legacy reader', owner: 'LIN-4525', exit: 'piece B' }];
    const files = {
      'lib/asked-of.js': 'splitQuote(x); sealAsAsked(y);\n',
      'lib/other.js': 'splitQuote(x);\n',
    };
    assert.deepStrictEqual(findRetired(files, rows).map((h) => `${h.file} ${h.word}`).sort(), ['lib/asked-of.js *AsAsked* symbols', 'lib/other.js splitQuote']);
  });

  test('the words that stay are not retired: the brief label, the writer rule, the injected-reader name, the orphaned property', () => {
    const files = {
      'lib/a.js': "const H = '## As asked'; askedOf(d); createRecordWrites({ askedText: askedOf });\n",
      'lib/b.js': "// the orphaned harbour.asAsked property is never read\nconst usage = 'a cumulative usage snapshot';\n",
    };
    assert.deepStrictEqual(findRetired(files), []);
  });

  test('a directory row covers the words under it, as the LIN-4495 census does for the records directories', () => {
    const rows = [{ kind: 'record', file: 'docs/plans/', words: ['*'], reason: 'plans of record' }];
    const excluded = ['docs', 'plans', 'x.md'].join('/');
    assert.deepStrictEqual(findRetired({ [excluded]: 'sealAsAsked\n' }, rows), []);
  });
});
