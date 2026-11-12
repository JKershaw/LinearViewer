// LIN-4420: the stability measures' core (scripts/stability-measures-core.mjs). Pure inputs in, rows out: the row
// contract's three states, the counting rule against the code-shape kit's own counter, churn's scope and denominator,
// CI matching, Waiting's zero-versus-unreadable line, and the measures' order. The live reproduction on the 8 Nov
// window needs `gh` and two checkouts, so it is run by hand and recorded in the PR, never here.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers/area-registry.js';
import { analyse } from '../../scripts/code-shape/shape-core.mjs';
import { measureShape } from '../../scripts/code-shape/shape-report.mjs';
import { compileScope } from '../../scripts/code-shape/code-shape-lib.mjs';
import { NOT_NOTES, countWaiting, parseNote } from '../../lib/prompts/area-note-format.js';
import {
  NOT_BUILT, SCOPE_INCLUDE, STATUS, buildReading, churnRow, ciRow, formatTable, linesRow, notMeasured, parseNumstat, row,
  waitingRow, waitingRows,
} from '../../scripts/stability-measures-core.mjs';

const inScope = compileScope({ include: SCOPE_INCLUDE });

describe('the row contract: measured, partial, not measured', () => {
  test('a full read has its value, no reason and nothing unreadable', () => {
    assert.deepStrictEqual(row('x', 5), { key: 'x', value: 5, reference: null, status: STATUS.MEASURED, reason: null, unreadable: 0 });
  });

  test('a partial read keeps what it read and counts what it could not', () => {
    const r = row('x', 5, { unreadable: 2, reason: '2 files unreadable', reference: 4 });
    assert.deepStrictEqual(r, { key: 'x', value: 5, reference: 4, status: STATUS.PARTIAL, reason: '2 files unreadable', unreadable: 2 });
    assert.throws(() => row('x', 5, { unreadable: 1 }), /names what it could not read/);
  });

  test('not measured has no value, never a zero, and always a reason', () => {
    assert.deepStrictEqual(notMeasured('x', 'gone'), { key: 'x', value: null, reference: null, status: STATUS.NOT_MEASURED, reason: 'gone', unreadable: null });
    assert.throws(() => notMeasured('x', ''), /needs a reason/);
    assert.throws(() => row('x', null), /notMeasured/);
  });
});

describe('lines: the code-shape kit counter, code and comments apart', () => {
  // Code, comment-only (line and block), blank, and a code line with a trailing comment, which counts as code.
  const FIXTURE = [
    '// a comment-only line',
    'const a = 1;',
    '',
    'const b = 2; // trailing comment: still code',
    '/*',
    ' * block comment lines',
    ' */',
    '   ',
    'export { a, b };',
    '',
  ].join('\n');

  test('the split read from measureShape is the split shape-core gives', () => {
    const report = measureShape({ files: { 'lib/fixture.js': FIXTURE } });
    const { code, comment, blank } = analyse(FIXTURE).lines;
    assert.deepStrictEqual({ code, comment, blank }, { code: 3, comment: 4, blank: 2 }, 'trailing-comment line is code; block comment lines are comment-only');
    const empty = { totals: { codeLines: 0, commentLines: 0, blankLines: 0 }, parseFailures: 0 };
    const r = linesRow({ base: empty, head: { totals: report.totals, parseFailures: report.scope.parseFailures.length }, landings: 1 });
    assert.deepStrictEqual(r.value.net, { total: 9, code: 3, comment: 4, blank: 2 });
    assert.strictEqual(r.status, STATUS.MEASURED);
  });

  test('the comment-only share is over all lines, blanks included (8 Nov base: 39.44%, not 42.5%)', () => {
    // 5334c81a's shape totals: 200,226 lines, 78,976 comment-only.
    const base = { totals: { codeLines: 106977, commentLines: 78976, blankLines: 14273 }, parseFailures: 0 };
    const head = { totals: { codeLines: 110011, commentLines: 82161, blankLines: 14612 }, parseFailures: 0 };
    const r = linesRow({ base, head, landings: 114 });
    assert.strictEqual(r.value.base.total, 200226);
    assert.strictEqual(r.value.base.commentShare, 39.44);
    assert.strictEqual(r.value.head.commentShare, 39.73);
    assert.deepStrictEqual(r.value.net, { total: 6558, code: 3034, comment: 3185, blank: 339 });
    assert.strictEqual(r.value.perLanding.total, 57.5);
  });

  test('files the counter could not parse make the read partial, with their count', () => {
    const report = measureShape({ files: { 'lib/ok.js': 'const a = 1;\n', 'lib/broken.js': 'const = ;\n' } });
    const side = { totals: report.totals, parseFailures: report.scope.parseFailures.length };
    const r = linesRow({ base: side, head: side, landings: 3 });
    assert.strictEqual(r.status, STATUS.PARTIAL);
    assert.strictEqual(r.unreadable, 2);
    assert.match(r.reason, /did not parse/);
  });

  test('a missing endpoint is not measured, not a zero', () => {
    const r = linesRow({ base: null, head: { totals: { codeLines: 1, commentLines: 0, blankLines: 0 } }, landings: 1 });
    assert.strictEqual(r.status, STATUS.NOT_MEASURED);
    assert.strictEqual(r.value, null);
  });
});

describe('churn: first-parent numstat on the shape scope', () => {
  test('the scope is the D2 production scope with the kit default excludes', () => {
    for (const p of ['server.js', 'lib/a.js', 'routes/b.mjs', 'public/c.cjs', 'lib/deep/d.js']) assert.ok(inScope(p), p);
    for (const p of ['lib/a.test.js', 'tests/unit/a.js', 'scripts/a.mjs', 'docs/a.md', 'lib/vendor/x.js', 'public/a.min.js', 'lib/a.json', 'experiments/a.js']) {
      assert.ok(!inScope(p), p);
    }
  });

  const LOG = [
    '@aaa', '', '10\t2\tlib/a.js', '5\t5\ttests/unit/a.test.js', '3\t0\tdocs/x.md',
    '@bbb', '', '1\t0\tREADME.md', // a landing that touches no in-scope file still counts in the denominator
    '@ccc', '', '4\t1\tserver.js', '-\t-\tpublic/img.js', // a merge landing's first-parent diff; an in-scope binary
  ].join('\n');

  test('numstat parses one entry per landing, binary counts as null', () => {
    const commits = parseNumstat(LOG);
    assert.deepStrictEqual(commits.map((c) => c.commit), ['aaa', 'bbb', 'ccc']);
    assert.deepStrictEqual(commits[2].files[1], { path: 'public/img.js', added: null, deleted: null });
  });

  test('added and deleted count in-scope files only, per landing over every landing', () => {
    const r = churnRow(parseNumstat(LOG), inScope);
    assert.deepStrictEqual(r.value, { landings: 3, added: 14, deleted: 3, net: 11, perLanding: { added: 4.7, deleted: 1, net: 3.7 }, deletedPerAdded: 0.21 });
    assert.strictEqual(r.status, STATUS.PARTIAL, 'the in-scope binary is unreadable, not zero');
    assert.strictEqual(r.unreadable, 1);
  });

  test('an empty window is not measured', () => {
    assert.strictEqual(churnRow([], inScope).status, STATUS.NOT_MEASURED);
  });
});

describe('CI: successful runs whose head sha is a landing', () => {
  const run = (headSha, minutes, extra = {}) => ({ headSha, startedAt: '2026-11-05T10:00:00Z', updatedAt: new Date(Date.parse('2026-11-05T10:00:00Z') + minutes * 60000).toISOString(), conclusion: 'success', ...extra });

  test('median of updatedAt - startedAt over matched runs; runs for other commits are ignored', () => {
    const r = ciRow({ runs: [run('a', 8), run('b', 9), run('c', 10), run('zzz', 60), run('d', 7)], landingShas: ['a', 'b', 'c', 'd'] });
    assert.deepStrictEqual(r.value, { medianMinutes: 8.5, runs: 4, landingsWithRun: 4, landings: 4, listingCapped: false });
    assert.strictEqual(r.status, STATUS.MEASURED);
  });

  test('landings with no matched run make the read partial, with their count', () => {
    const r = ciRow({ runs: [run('a', 8), run('b', 9, { conclusion: 'failure' })], landingShas: ['a', 'b', 'c'], listingCapped: true });
    assert.strictEqual(r.status, STATUS.PARTIAL);
    assert.strictEqual(r.unreadable, 2);
    assert.match(r.reason, /2 landing\(s\) have no successful run; the run listing hit its limit/);
  });

  test('an unreadable gh is not measured with its reason, never a zero', () => {
    const r = ciRow({ runs: null, reason: 'gh unreadable: spawnSync gh ENOENT', landingShas: ['a'] });
    assert.deepStrictEqual([r.status, r.value, r.reason], [STATUS.NOT_MEASURED, null, 'gh unreadable: spawnSync gh ENOENT']);
  });
});

describe('Waiting: one definition, zero versus unreadable', () => {
  test('the stability count and the area notes guard share one definition of a waiting entry', () => {
    const guard = readFileSync(join(ROOT, 'tests/unit/area-notes.test.js'), 'utf8');
    assert.match(guard, /import \{[^}]*\bparseNote\b[^}]*\} from '\.\.\/\.\.\/lib\/prompts\/area-note-format\.js';/);
    assert.doesNotMatch(guard, /function parseNote\b/, 'the guard keeps no copy of its own');
    assert.doesNotMatch(guard, /new Set\(\['README\.md', 'areas\.json'\]\)/, 'nor of the files that are not notes');
  });

  test('`- ` bullets under ## Waiting in notes only; the README and the registry are not notes', () => {
    const note = '# A\n\n## Lessons\n\n- not waiting\n\n## Waiting\n\n- `lib/a.js`: one\n  continued\n- `lib/b.js`: two\n  - nested, not an entry\n';
    assert.strictEqual(parseNote(note).waiting.length, 2);
    assert.ok(NOT_NOTES.has('README.md') && NOT_NOTES.has('areas.json'));
    assert.strictEqual(countWaiting({ 'a.md': note, 'README.md': note, 'areas.json': note, 'b.md': note }), 4);
  });

  test('a readable commit with no notes directory reads 0, a measured zero', () => {
    assert.strictEqual(countWaiting({}), 0);
    const r = waitingRow('waiting.harbour', { base: { count: countWaiting({}) }, head: { count: 56 }, landings: 114 });
    assert.deepStrictEqual([r.status, r.value.base, r.value.head, r.value.change, r.value.perLanding], [STATUS.MEASURED, 0, 56, 56, 0.49]);
  });

  test('a missing runner is not measured, and so is the sum; neither is 0', () => {
    const [h, rn, total] = waitingRows({ harbour: { base: { count: 0 }, head: { count: 56 } }, runner: { reason: 'runner checkout not found at /x' }, landings: 114 });
    assert.strictEqual(h.status, STATUS.MEASURED);
    assert.deepStrictEqual([rn.status, rn.value, rn.reason], [STATUS.NOT_MEASURED, null, 'runner checkout not found at /x']);
    assert.deepStrictEqual([total.status, total.value], [STATUS.NOT_MEASURED, null]);
  });

  test('an endpoint that failed to read is not measured with the endpoint named', () => {
    const r = waitingRow('waiting.runner', { base: { count: 0 }, head: { reason: 'git cat-file failed' }, landings: 3 });
    assert.deepStrictEqual([r.status, r.reason], [STATUS.NOT_MEASURED, 'head: git cat-file failed']);
  });

  test('both read: the sum, with the runner branch and endpoints carried', () => {
    const rows = waitingRows({
      harbour: { base: { count: 0 }, head: { count: 56 } },
      runner: { base: { count: 0 }, head: { count: 10 }, detail: { branch: 'main', baseSha: '9478e1c53', headSha: '5d8489e7f' } },
      landings: 114,
    });
    assert.deepStrictEqual(rows.map((r) => [r.key, r.value.head]), [['waiting.harbour', 56], ['waiting.runner', 10], ['waiting.total', 66]]);
    assert.strictEqual(rows[1].value.headSha, '5d8489e7f');
  });
});

describe('the reading: five measures in order', () => {
  const window = { base: 'b'.repeat(40), head: 'h'.repeat(40), baseDate: '2026-11-04T05:23:59Z', headDate: '2026-11-08T17:10:36Z', landings: 1 };
  const lines = row('lines', { base: {}, head: {}, net: {} });

  test('ranks 1 to 5; rows not yet built read not measured: not built yet; the curve opens with lines', () => {
    const reading = buildReading({ window, rows: { curve: [lines] } });
    assert.deepStrictEqual(reading.measures.map((m) => m.key), ['no-new-mess', 'curve', 'speed', 'seat', 'cost']);
    for (const m of reading.measures.filter((x) => x.key !== 'curve')) {
      assert.deepStrictEqual(m.rows.map((r) => [r.status, r.reason]), [[STATUS.NOT_MEASURED, NOT_BUILT]], m.key);
    }
    assert.deepStrictEqual(reading.measures[1].rows.map((r) => r.key), ['lines', 'minted']);
    assert.strictEqual(reading.measures[1].rows[1].reason, NOT_BUILT);
  });

  test('the opening table prints not measured with its reason and a partial read with its count', () => {
    const ci = ciRow({ runs: [], landingShas: ['a'] });
    const churn = churnRow(parseNumstat('@a\n\n-\t-\tlib/x.js\n1\t0\tlib/y.js'), inScope);
    const table = formatTable(buildReading({ window, rows: { curve: [ci, churn] } }));
    assert.match(table, /^1\. No new mess\n {3}no-new-mess +not measured: not built yet$/m);
    assert.match(table, /ci +not measured: no successful run matched any of the 1 landings/);
    assert.match(table, /\[partial: 1 unreadable — 1 in-scope binary file change\(s\) have no line counts\]/);
    assert.ok(table.indexOf('1. No new mess') < table.indexOf('2. The curve') && table.indexOf('2. The curve') < table.indexOf('5. Cost'));
  });
});
