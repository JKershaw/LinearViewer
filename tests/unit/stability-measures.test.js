// LIN-4420: the stability measures' core (scripts/stability-measures-core.mjs). Pure inputs in, rows out: the row
// contract's three states, the counting rule against the code-shape kit's own counter, churn's scope and denominator,
// CI matching, Waiting's zero-versus-unreadable line, and the measures' order. The live reproduction on the 8 Nov
// window needs `gh` and two checkouts, so it is run by hand and recorded in the PR, never here.
// LIN-4421: the tracker half. Landing ownership, finished-task selection across window edges, sessions as /cost
// lineages (the recorded LIN-4393 fixture), speed and cost with their unreadable counts, the ID-span search, and the
// paced proxy client (scripts/stability-measures-tracker.mjs) with injected fetch, sleep and clock.
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
  MINTED_NOT_SUPPLIED, NOT_BUILT, SCOPE_INCLUDE, STATUS, buildReading, churnRow, ciRow, costRow, firstDispatchOf, formatTable,
  idSpanSearch, landingOwners, linesRow, mintedRow, notMeasured, ownTicket, parseLandingLog, parseNumstat, row, selectFinished,
  sessionsOf, speedRow, tasksRow, waitingRow, waitingRows,
} from '../../scripts/stability-measures-core.mjs';
import { createProxyClient, readTracker, retryAfterMs } from '../../scripts/stability-measures-tracker.mjs';

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
    assert.strictEqual(reading.measures[1].rows[1].reason, MINTED_NOT_SUPPLIED, 'a curve without a minted row still ends with one, not measured');
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

// ── LIN-4421: the tracker half ───────────────────────────────────────────────
const LIN4393 = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/stability-measures/lin-4393.json'), 'utf8'));
const landing = (commit, date, subject, body = '') => ({ commit, date, subject, body });

describe('landing ownership: each landing names only its own ticket', () => {
  test('a squash landing owns the first id in its subject; ids in its body are precedents, not owners', () => {
    assert.strictEqual(ownTicket('LIN-4393: remove the size-of-the-move setting cleanly (#2377)', 'Follows LIN-690 reopened; see LIN-12.'), 'LIN-4393');
    assert.strictEqual(ownTicket('LIN-4358: area reads; LIN-4300 noted (#2373)'), 'LIN-4358');
    assert.strictEqual(ownTicket('Tidy the README (#2400)', 'Mentions LIN-77.'), null, 'no id in the subject: the landing owns no ticket');
  });

  test('a merge landing owns its branch id, else its PR title id; the branch wins when they disagree', () => {
    const merge = 'Merge pull request #2381 from JKershaw/feat/lin-4349-tail-drives-review-in-place';
    assert.strictEqual(ownTicket(merge, 'LIN-4349: tail drives review in place\n\nCloses LIN-4300.'), 'LIN-4349');
    assert.strictEqual(ownTicket(merge, 'Follow-up to LIN-4000: tail drives review'), 'LIN-4349', 'branch before title (pinned: the title can cite another ticket)');
    assert.strictEqual(ownTicket('Merge pull request #9 from JKershaw/chore/tidy', 'LIN-55 tidy the tidy\n\nLIN-66'), 'LIN-55', 'no id in the branch: the title\'s first');
    assert.strictEqual(ownTicket('Merge pull request #9 from JKershaw/chore/tidy', 'Tidy\n\nLIN-66 in the body'), null, 'never the body below the title');
    assert.strictEqual(ownTicket("Merge branch 'feat/lin-12-x'"), 'LIN-12');
    assert.strictEqual(ownTicket('Merge pull request #1 from o/feat/lin-0042-pad'), 'LIN-42', 'one spelling per ticket');
  });

  test('the landing log parses subject and body apart, and owners keep each ticket\'s last landing', () => {
    const log = ['aaa\x1f2026-11-08T10:00:00Z\x1fLIN-1: first\x1fbody mentions LIN-2\n\x1e', '\nbbb\x1f2026-11-08T12:00:00Z\x1fLIN-1: second\x1f\x1e',
      '\nccc\x1f2026-11-08T11:00:00Z\x1fREADME only\x1f\x1e\n'].join('');
    const landings = parseLandingLog(log);
    assert.deepStrictEqual(landings[0], landing('aaa', '2026-11-08T10:00:00Z', 'LIN-1: first', 'body mentions LIN-2'));
    const { owners, unowned } = landingOwners(landings);
    assert.deepStrictEqual([...owners.keys()], ['LIN-1'], 'LIN-2 is a precedent in a body, not an owner');
    assert.deepStrictEqual(owners.get('LIN-1'), { landings: ['aaa', 'bbb'], lastLandingAt: '2026-11-08T12:00:00Z' });
    assert.deepStrictEqual(unowned, ['ccc']);
  });

  test('the CLI keeps no ticket regex of its own: ownership is the core\'s', () => {
    for (const f of ['scripts/stability-measures.mjs', 'scripts/stability-measures-tracker.mjs']) {
      assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /LIN-\\d|LIN-\\\\d|\\bLIN-\\b/, f);
    }
  });
});

describe('sessions, speed and cost: the recorded LIN-4393 fixture', () => {
  test('14 dispatch rows, 5 of them wakes, are 8 sessions as /cost lineages (the row rule would say 9)', () => {
    const rows = LIN4393.dispatchRows;
    assert.strictEqual(rows.length, 14);
    assert.strictEqual(LIN4393.dispatchListTruncated, false);
    assert.strictEqual(rows.filter((r) => r.kind === 'wake').length, 5);
    assert.strictEqual(rows.filter((r) => r.kind !== 'wake').length, 9, 'non-wake rows: the leftover row is the 9th');
    assert.strictEqual(sessionsOf(LIN4393.cost), 8);
    // The lineages partition exactly the 14 rows: the leftover resumes the implementation's lineage.
    const members = LIN4393.cost.workerSessions.flatMap((s) => s.dispatches.map((d) => d.itemId)).sort();
    assert.deepStrictEqual(members, rows.map((r) => r.id).sort());
    const impl = LIN4393.cost.workerSessions.find((s) => s.kind === 'implementation');
    assert.deepStrictEqual(impl.dispatches.map((d) => d.kind), ['implementation', 'leftover']);
  });

  test('first dispatch to last landing is 54 minutes, 8 sessions, $14.94', () => {
    assert.strictEqual(firstDispatchOf(LIN4393.cost), '2026-11-08T14:40:59.557Z', 'the task Survey, the earliest lineage root');
    const { owners } = landingOwners([LIN4393.landing]);
    const sel = selectFinished({ window: { owners }, issues: new Map([['LIN-4393', LIN4393.issue]]), baseDate: '2026-11-04T05:23:59Z', headDate: '2026-11-08T17:10:36Z' });
    assert.deepStrictEqual(sel.finished.map((t) => t.id), ['LIN-4393']);
    const tasks = [{ id: 'LIN-4393', lastLandingAt: sel.finished[0].lastLandingAt, cost: { body: LIN4393.cost } }];
    const speed = speedRow(tasks);
    assert.strictEqual(speed.status, STATUS.MEASURED);
    assert.deepStrictEqual([Math.round(speed.value.medianMinutes), speed.value.medianSessions], [54, 8]);
    const cost = costRow(tasks);
    assert.strictEqual(cost.status, STATUS.MEASURED);
    assert.strictEqual(cost.value.medianUsd, 14.94);
    assert.deepStrictEqual(cost.value.counters, { unpriced: 0, noTelemetryCount: 0, unreadableCount: 0, noLineage: 0 });
  });
});

describe('unreadable is counted, never zero', () => {
  const priced = (usd) => ({ totalUsd: usd, pricedUsd: usd, unpriced: [], noTelemetryCount: 0, unreadableCount: 0, noLineage: false, workerSessions: [{ dispatchedAt: '2026-11-08T10:00:00Z' }] });
  const task = (id, cost) => ({ id, lastLandingAt: '2026-11-08T11:00:00Z', cost });

  test('a null totalUsd is unreadable with its cause, and a failed read is apart from it', () => {
    const tasks = [
      task('LIN-1', { body: priced(10) }),
      task('LIN-2', { body: { ...priced(null), pricedUsd: 3, unpriced: [{ model: 'x' }] } }),
      task('LIN-3', { body: { ...priced(null), noTelemetryCount: 2 } }),
      task('LIN-4', { body: { ...priced(null), unreadableCount: 1 } }),
      task('LIN-5', { body: { ...priced(null), noLineage: true, workerSessions: [] } }),
      task('LIN-6', { reason: '429 did not clear after 3 retries' }),
    ];
    const r = costRow(tasks);
    assert.strictEqual(r.status, STATUS.PARTIAL);
    assert.deepStrictEqual([r.value.priced, r.value.medianUsd, r.unreadable], [1, 10, 5], 'the four nulls and the failure are not $0');
    assert.deepStrictEqual(r.value.nullTotal, { unpriced: 1, noTelemetry: 1, unreadable: 1, noLineage: 1, other: 0 });
    assert.deepStrictEqual(r.value.counters, { unpriced: 1, noTelemetryCount: 2, unreadableCount: 1, noLineage: 1 });
    assert.deepStrictEqual(r.value.readFailures, [{ id: 'LIN-6', reason: '429 did not clear after 3 retries' }]);
    assert.match(r.reason, /4 null totalUsd \(unpriced 1, noTelemetry 1, unreadable 1, noLineage 1\); 1 cost read\(s\) failed \(429 did not clear/);
  });

  test('no total anywhere is not measured, not a median of nothing', () => {
    const r = costRow([task('LIN-2', { body: priced(null) })]);
    assert.deepStrictEqual([r.status, r.value], [STATUS.NOT_MEASURED, null]);
    assert.match(r.reason, /null totalUsd \(other 1\)/);
  });

  test('speed counts a failed read, a lineage-less task and a hand landing as unreadable', () => {
    const r = speedRow([
      task('LIN-1', { body: priced(1) }),
      task('LIN-2', { reason: 'HTTP 500' }),
      task('LIN-3', { body: { ...priced(null), noLineage: true, workerSessions: [] } }),
      { id: 'LIN-4', lastLandingAt: '2026-11-08T09:00:00Z', cost: { body: priced(1) } },
    ]);
    assert.deepStrictEqual([r.status, r.unreadable, r.value.read, r.value.medianMinutes, r.value.medianSessions], [STATUS.PARTIAL, 3, 1, 60, 1]);
    assert.match(r.reason, /1 cost read failed, 1 no lineage, 1 first dispatch after last landing/);
  });

  test('a missing issue makes the finished count partial; every read failing is not measured', () => {
    const { owners } = landingOwners([landing('a', '2026-11-08T10:00:00Z', 'LIN-1: x'), landing('b', '2026-11-08T10:30:00Z', 'LIN-2: y')]);
    const issues = new Map([['LIN-1', { state: { type: 'completed' }, completedAt: '2026-11-08T10:05:00Z' }], ['LIN-2', { reason: 'issue not found' }]]);
    const sel = selectFinished({ window: { owners }, issues, baseDate: '2026-11-08T00:00:00Z', headDate: '2026-11-09T00:00:00Z' });
    const r = tasksRow({ selection: sel, windowTickets: 2, unownedLandings: [] });
    assert.deepStrictEqual([r.status, r.value.finished, r.unreadable, r.reason], [STATUS.PARTIAL, 1, 1, '1 issue read(s) failed: issue not found']);
    const none = tasksRow({ selection: selectFinished({ window: { owners }, issues: new Map(), baseDate: '2026-11-08T00:00:00Z', headDate: '2026-11-09T00:00:00Z' }), windowTickets: 2, unownedLandings: [] });
    assert.deepStrictEqual([none.status, none.value], [STATUS.NOT_MEASURED, null]);
  });
});

describe('finished tasks: counted once, in the window where they finished', () => {
  // Two adjacent windows. LIN-10 lands in A and again in B and finishes in B. LIN-20 is LIN-4349's shape: merged just
  // before A's head, marked Done nine minutes after it, never named by a landing in B.
  const A = { baseDate: '2026-11-07T00:00:00Z', headDate: '2026-11-08T17:10:36Z' };
  const B = { baseDate: A.headDate, headDate: '2026-11-10T00:00:00Z' };
  const landingsA = [landing('a1', '2026-11-08T09:00:00Z', 'LIN-10: part 1'), landing('a2', A.headDate, 'Merge pull request #1 from o/feat/lin-20-x', 'LIN-20: x')];
  const landingsB = [landing('b1', '2026-11-09T09:00:00Z', 'LIN-10: part 2')];
  const issues = new Map([
    ['LIN-10', { state: { type: 'completed', name: 'Done' }, completedAt: '2026-11-09T10:00:00Z' }],
    ['LIN-20', { state: { type: 'completed', name: 'Done' }, completedAt: '2026-11-08T17:19:00Z' }],
  ]);

  test('in A neither has finished: both are printed as landed and done outside the window, not dropped', () => {
    const sel = selectFinished({ window: landingOwners(landingsA), issues, ...A });
    assert.deepStrictEqual(sel.finished, []);
    assert.deepStrictEqual(sel.doneOutside.map((t) => t.id), ['LIN-10', 'LIN-20']);
  });

  test('in B both finish: LIN-10 by its own landing, LIN-20 by a landing before base', () => {
    const sel = selectFinished({ window: landingOwners(landingsB), prior: landingOwners(landingsA), issues, ...B });
    assert.deepStrictEqual(sel.finished.map((t) => [t.id, t.landedInWindow, t.lastLandingAt]), [['LIN-10', true, '2026-11-09T09:00:00Z'], ['LIN-20', false, A.headDate]]);
  });

  test('summed over both windows each task counts once', () => {
    const a = selectFinished({ window: landingOwners(landingsA), issues, ...A }).finished;
    const b = selectFinished({ window: landingOwners(landingsB), prior: landingOwners(landingsA), issues, ...B }).finished;
    assert.deepStrictEqual([...a, ...b].map((t) => t.id).sort(), ['LIN-10', 'LIN-20']);
  });

  test('completed exactly at A\'s head counts in A only: the window is (base, head], even with A\'s landings as B\'s prior', () => {
    const atHead = new Map([['LIN-50', { state: { type: 'completed', name: 'Done' }, completedAt: A.headDate }]]);
    const ownA = landingOwners([landing('a3', '2026-11-08T16:00:00Z', 'LIN-50: lands in A')]);
    const inA = selectFinished({ window: ownA, issues: atHead, ...A });
    assert.deepStrictEqual(inA.finished.map((t) => t.id), ['LIN-50']);
    const inB = selectFinished({ window: landingOwners([]), prior: ownA, issues: atHead, ...B });
    assert.deepStrictEqual([inB.finished, inB.doneOutside, inB.notDone], [[], [], []]);
  });

  test('a prior-only ticket finished elsewhere is not reported; a canceled one is not finished', () => {
    const more = new Map([...issues, ['LIN-30', { state: { type: 'completed' }, completedAt: '2026-11-08T08:00:00Z' }], ['LIN-40', { state: { type: 'canceled', name: 'Canceled' }, completedAt: null }]]);
    const sel = selectFinished({
      window: landingOwners([landing('b2', '2026-11-09T11:00:00Z', 'LIN-40: dropped')]),
      prior: landingOwners([landing('p', '2026-11-08T07:00:00Z', 'LIN-30: earlier')]),
      issues: more, ...B,
    });
    assert.deepStrictEqual([sel.finished, sel.doneOutside, sel.notDone], [[], [], [{ id: 'LIN-40', state: 'Canceled' }]]);
  });
});

describe('tickets minted: the ID-span search', () => {
  // Issues 1..40 created an hour apart from 1 Nov, except 13 and 30..31 (404s) and 20 (trashed: a 200 that is a gap).
  const t0 = Date.parse('2026-11-01T00:00:00Z');
  const createdAt = (n) => new Date(t0 + n * 3600e3).toISOString();
  const world = (n) => {
    if (n < 1 || n > 40 || n === 13 || n === 30 || n === 31) return { status: 'missing' };
    return { status: 'ok', createdAt: createdAt(n), trashed: n === 20 };
  };
  const counted = () => {
    const calls = [];
    return { calls, probe: async (n) => { calls.push(n); return world(n); } };
  };

  test('the highest number created at or before a time, stepping past 404s and trashed issues', async () => {
    for (const [at, want] of [[createdAt(12), 12], [createdAt(13), 12], [createdAt(14) , 14], [createdAt(20), 19], [createdAt(31), 29], [createdAt(25.5), 25]]) {
      const { probe } = counted();
      const r = await idSpanSearch({ at, hi: 40, probe });
      assert.strictEqual(r.value, want, `at ${at}`);
    }
  });

  test('every probe is recorded, with a gap named as missing or trashed', async () => {
    const { calls, probe } = counted();
    const r = await idSpanSearch({ at: createdAt(20), hi: 40, probe });
    assert.deepStrictEqual(r.probes.map((p) => p.n), calls);
    assert.ok(r.probes.some((p) => p.status === 'trashed' && p.n === 20), 'the trashed 20 was probed and stepped past');
    assert.ok(calls.length <= 12, `bisection, not a walk: ${calls.length} probes`);
  });

  test('a shared cache keeps the head search from re-probing what the base search read', async () => {
    const { calls, probe } = counted();
    const cache = new Map();
    const base = await idSpanSearch({ at: createdAt(10), hi: 40, probe, cache });
    const before = calls.length;
    const head = await idSpanSearch({ at: createdAt(26), lo: base.value, hi: 40, probe, cache });
    assert.strictEqual(new Set(calls).size, calls.length, 'no number probed twice');
    assert.ok(calls.length > before);
    const r = mintedRow({ base, head, landings: 8, bracket: 'LIN-40' });
    assert.deepStrictEqual([r.status, r.value.label, r.value.span, r.value.perLanding, r.value.base, r.value.head], [STATUS.MEASURED, 'ID-span estimate', 16, 2, 'LIN-10', 'LIN-26']);
    assert.deepStrictEqual(r.value.probes.base, base.probes.map((p) => p.n));
  });

  test('a bracket created before the time is the answer, flagged; an unreadable probe ends the search, not measured', async () => {
    const top = await idSpanSearch({ at: createdAt(99), hi: 40, probe: async (n) => world(n) });
    assert.deepStrictEqual([top.value, top.atBracket], [40, true]);
    const holed = await idSpanSearch({ at: createdAt(10), hi: 40, probe: async (n) => (n === 20 ? { status: 'unreadable', reason: '429 did not clear after 3 retries' } : world(n)) });
    assert.match(holed.reason, /probe of 20 unreadable: 429 did not clear/);
    const r = mintedRow({ base: holed, head: { reason: 'not searched' }, landings: 3 });
    assert.deepStrictEqual([r.status, r.value], [STATUS.NOT_MEASURED, null]);
    assert.match(r.reason, /^ID-span search failed \(base: probe of 20 unreadable/);
    assert.match((await idSpanSearch({ at: createdAt(10), hi: 41, probe: async (n) => world(n) })).reason, /bracket 41 is not an existing issue/);
  });
});

describe('the proxy client: paced, honours 429 Retry-After, never throws', () => {
  const clock = () => {
    let t = 0;
    const sleeps = [];
    return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps, at: () => t };
  };
  const res = (status, body = {}, headers = {}) => ({ status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });

  test('calls start at least 60000 / perMinute ms apart', async () => {
    const c = clock();
    const starts = [];
    const client = createProxyClient({ base: 'http://p/api/proxy/', perMinute: 60, ...c, fetch: async (url) => { starts.push([c.at(), url]); return res(200, { ok: 1 }); } });
    for (let i = 0; i < 3; i++) assert.deepStrictEqual(await client.get(`/issues/LIN-${i}`), { ok: true, status: 200, body: { ok: 1 } });
    assert.deepStrictEqual(starts.map(([t]) => t), [0, 1000, 2000]);
    assert.strictEqual(starts[0][1], 'http://p/api/proxy/issues/LIN-0');
    assert.strictEqual(createProxyClient({ base: 'x' }).stats.calls, 0);
  });

  test('a 429 waits its Retry-After and retries; one that never clears is a failure, not a value', async () => {
    const c = clock();
    let n = 0;
    const flaky = createProxyClient({ base: 'http://p', ...c, fetch: async () => (n++ < 2 ? res(429, {}, { 'retry-after': '7' }) : res(200, { totalUsd: 1 })) });
    assert.deepStrictEqual(await flaky.get('/issues/LIN-1/cost'), { ok: true, status: 200, body: { totalUsd: 1 } });
    assert.ok(c.sleeps.filter((ms) => ms === 7000).length === 2, `waited Retry-After twice: ${c.sleeps}`);
    const stuck = createProxyClient({ base: 'http://p', ...clock(), retries: 2, fetch: async () => res(429, {}, { 'retry-after': '1' }) });
    assert.deepStrictEqual(await stuck.get('/x'), { ok: false, status: 429, reason: '429 did not clear after 2 retries' });
    assert.strictEqual(stuck.stats.calls, 3);
  });

  test('404, other statuses, network errors and bad bodies come back as failures with reasons', async () => {
    const one = (fetch) => createProxyClient({ base: 'http://p', ...clock(), fetch }).get('/x');
    assert.deepStrictEqual(await one(async () => res(404)), { ok: false, status: 404, reason: 'not found' });
    assert.deepStrictEqual(await one(async () => res(503)), { ok: false, status: 503, reason: 'HTTP 503' });
    assert.deepStrictEqual(await one(async () => { throw new Error('ECONNREFUSED'); }), { ok: false, status: null, reason: 'proxy unreachable: ECONNREFUSED' });
    assert.match((await one(async () => ({ status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected token <'); } }))).reason, /^body unreadable/);
  });

  test('Retry-After reads seconds or an HTTP date', () => {
    assert.strictEqual(retryAfterMs('12', 0), 12000);
    assert.strictEqual(retryAfterMs(new Date(5000).toUTCString(), 0), 5000);
    assert.strictEqual(retryAfterMs('soon', 0), null);
    assert.strictEqual(retryAfterMs(null, 0), null);
  });
});

describe('the tracker read end to end, through a fake proxy', () => {
  const window = { baseDate: '2026-11-08T00:00:00Z', headDate: '2026-11-09T00:00:00Z', landings: 3 };
  const created = (n) => new Date(Date.parse('2026-11-07T00:00:00Z') + n * 3600e3).toISOString(); // LIN-24 at base, LIN-48 at head
  const windowLandings = [
    landing('a', '2026-11-08T15:00:00Z', 'LIN-30: one'),
    landing('b', '2026-11-08T16:00:00Z', 'LIN-31: two'),
    landing('c', '2026-11-08T17:00:00Z', 'LIN-32: three, after LIN-1'),
  ];
  const routes = (over = {}) => (path) => {
    if (path in over) return over[path];
    if (path === '/issues?limit=50') return { status: 200, body: { issues: [{ identifier: 'LIN-60' }, { identifier: 'LIN-59' }] } };
    const issue = /^\/issues\/LIN-(\d+)$/.exec(path);
    if (issue) {
      const n = Number(issue[1]);
      if (n > 60) return { status: 404 };
      const done = { 30: '2026-11-08T15:10:00Z', 31: '2026-11-08T16:10:00Z' }[n];
      return { status: 200, body: { createdAt: created(n), state: done ? { type: 'completed', name: 'Done' } : { type: 'started', name: 'In Progress' }, completedAt: done ?? null, trashed: false } };
    }
    if (path === '/issues/LIN-30/cost') return { status: 200, body: { ...LIN4393.cost, identifier: 'LIN-30' } };
    if (path === '/issues/LIN-31/cost') return { status: 429, headers: { 'retry-after': '1' } };
    return { status: 500 };
  };
  const proxy = (over) => {
    const paths = [];
    const route = routes(over);
    const fetch = async (url) => {
      const path = url.replace('http://p/api/proxy', '');
      paths.push(path);
      const r = route(path);
      return { status: r.status, headers: { get: (k) => r.headers?.[k] ?? null }, json: async () => r.body ?? {} };
    };
    let t = 0;
    return { paths, client: createProxyClient({ base: 'http://p/api/proxy', fetch, now: () => t, sleep: async (ms) => { t += ms; }, retries: 1 }) };
  };

  test('finished, unfinished, a 429 that never clears and the span all come out as rows', async () => {
    const { client, paths } = proxy();
    const { rows } = await readTracker({ client, windowLandings, window, lookback: { days: 3 } });
    assert.deepStrictEqual([rows.tasks.status, rows.tasks.value.finished, rows.tasks.value.landedUnfinished], [STATUS.MEASURED, 2, 1]);
    assert.deepStrictEqual(rows.tasks.value.ids.landedUnfinished, [{ id: 'LIN-32', state: 'In Progress' }]);
    assert.ok(!paths.includes('/issues/LIN-1'), 'a precedent in a subject\'s tail is never read as a ticket');
    assert.deepStrictEqual([rows.cost.status, rows.cost.value.priced, rows.cost.unreadable], [STATUS.PARTIAL, 1, 1]);
    assert.deepStrictEqual(rows.cost.value.readFailures, [{ id: 'LIN-31', reason: '429 did not clear after 1 retries' }]);
    assert.deepStrictEqual([rows.speed.status, rows.speed.value.medianSessions, rows.speed.unreadable], [STATUS.PARTIAL, 8, 1]);
    assert.deepStrictEqual([rows.minted.status, rows.minted.value.base, rows.minted.value.head, rows.minted.value.span], [STATUS.MEASURED, 'LIN-24', 'LIN-48', 24]);
    assert.strictEqual(rows.minted.value.bracket, 'LIN-60');
  });

  test('a window ticket whose issue read is a 404 is unreadable with its reason, and the tasks row is partial', async () => {
    const { client } = proxy({ '/issues/LIN-33': { status: 404 } });
    const withMissing = [...windowLandings, landing('d', '2026-11-08T18:00:00Z', 'LIN-33: four')];
    const { rows } = await readTracker({ client, windowLandings: withMissing, window: { ...window, landings: 4 }, lookback: { days: 3 } });
    assert.deepStrictEqual([rows.tasks.status, rows.tasks.unreadable, rows.tasks.value.finished], [STATUS.PARTIAL, 1, 2]);
    assert.deepStrictEqual(rows.tasks.value.ids.unreadable, [{ id: 'LIN-33', reason: 'issue not found' }]);
    assert.deepStrictEqual(rows.tasks.value.ids.landedUnfinished, [{ id: 'LIN-32', state: 'In Progress' }]);
  });

  test('an unreadable issue list ends the read: every tracker row is not measured, none is zero', async () => {
    const { client, paths } = proxy({ '/issues?limit=50': { status: 503 } });
    const { rows } = await readTracker({ client, windowLandings, window });
    for (const r of Object.values(rows)) assert.deepStrictEqual([r.status, r.value, r.reason], [STATUS.NOT_MEASURED, null, 'proxy: issue list: HTTP 503'], r.key);
    assert.deepStrictEqual(paths, ['/issues?limit=50']);
  });

  test('the opening table prints each tracker row as prose, not raw JSON', async () => {
    const { client } = proxy();
    const { rows } = await readTracker({ client, windowLandings, window, lookback: { days: 3 } });
    const w = { base: 'b'.repeat(40), head: 'h'.repeat(40), baseDate: window.baseDate, headDate: window.headDate, landings: 3 };
    const table = formatTable(buildReading({ window: w, rows: { curve: [rows.minted], speed: [rows.tasks, rows.speed], cost: [rows.cost] } }));
    assert.match(table, /minted +24 over LIN-24 → LIN-48, 8 per landing \(ID-span estimate; \d+ probes\)/);
    assert.match(table, /tasks +2 finished \(0 landed before base\); of 3 tickets landed here, 1 not done/);
    assert.match(table, /speed +median [\d.]+ min .* median 8 sessions/);
    assert.match(table, /cost +median \$14\.94 .* unpriced 0, noTelemetryCount 0, unreadableCount 0, noLineage 0 \[partial: 1 unreadable/);
    assert.doesNotMatch(table, /\{"/);
  });
});
