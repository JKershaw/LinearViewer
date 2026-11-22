// LIN-4420: the stability measures' core (scripts/stability-measures-core.mjs). Pure inputs in, rows out: the row
// contract's three states, the counting rule against the code-shape kit's own counter, churn's scope and denominator,
// CI matching, and the measures' order (the Waiting readings are tests/unit/lin-4505-waiting-series.test.js). The live run on the 8 Nov window needs
// the proxy, `gh` and two checkouts, so it is not run here: its committed output (LIN-4423) is checked below, and the
// CLI's own reads are run against fixture repositories and a stand-in `gh`.
// LIN-4421: the tracker half. Landing ownership, finished-task selection across window edges, sessions as /cost
// lineages (the recorded LIN-4393 fixture), speed and cost with their unreadable counts, the ID-span search, and the
// paced proxy client (scripts/stability-measures-tracker.mjs) with injected fetch, sleep and clock.
// LIN-4422: the Balance-to-sign rule against the paper's frozen codes (the rule now beside the paper's coder) and
// measure 4 (loop rulings, origin not measured, the operator-free upper bound read from every lineage member's
// feedback), and the seat read end to end through the same fake proxy.
// LIN-4423: the reference reading (referencesFrom, the table's reference line, the CLI's refusals), the committed 8 Nov
// reference against piece 1's verified figures, and the declaration naming every measure and row the tool emits.
// LIN-4439: measure 1 reads the ledger (a pre-merge `## Blind read` naming each landing's PR, unread by named reason),
// LIN-4519: from the verdict records instead (blind-read verdicts, the cutover, the paced records reads), the CLI end to
// end on a loopback proxy, and one source (no sample, no --blind).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { delimiter, join } from 'node:path';
import { makeRepo } from '../../scripts/code-shape/test-helpers.mjs';
import { ROOT } from './helpers/area-registry.js';
import { analyse } from '../../scripts/code-shape/shape-core.mjs';
import { measureShape } from '../../scripts/code-shape/shape-report.mjs';
import { compileScope } from '../../scripts/code-shape/code-shape-lib.mjs';
import {
  MEASURES, MINTED_NOT_SUPPLIED, NOT_BUILT, NO_REFERENCE_KEYS, NO_REFERENCE_ROWS, SCOPE_INCLUDE, STATUS, buildReading, churnRow, ciRow, costRow, firstDispatchOf, formatTable,
  idSpanSearch, landingOwners, landingPr, linesRow, mintedRow, noReferenceReading, notMeasured, ownTicket, parseLandingLog, parseNumstat,
  referencesFrom, row, selectFinished,
  sessionsOf, speedRow, tasksRow,
} from '../../scripts/stability-measures-core.mjs';
import { DISPATCH_LIST_LIMIT, createProxyClient, readSeat, readTracker, readVerdictRecords, retryAfterMs, trackerNotMeasured } from '../../scripts/stability-measures-tracker.mjs';
import {
  GATE_LANDING, UNREAD, blindRow, changeRefsOf, isOrdinaryLanding, repoSlugOf, ticketsToRead,
} from '../../scripts/stability-measures-blind.mjs';
import {
  VERDICT_RECORDS_SINCE, verdictFactsFromRecords, verdictFactsNotMeasured,
} from '../../lib/records/verdict-facts.js';
import { codeBalance } from '../../docs/papers/harbour/cleaner-than-it-started-scripts/balance-sign.mjs';
import {
  MISSING_CONDITION, ORIGIN_UNREADABLE, UPPER_BOUND, LOOP_ONLY, hasBlockedMarker, membersOf, operatorFreeRow, rulingsRow,
  seatNotMeasured, seatRows, taskConditions,
} from '../../scripts/stability-measures-seat.mjs';
import { deriveBlockedStatus } from '../../lib/dispatch-terminal.js';

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
    // LIN-4422 leftovers: delivery-composition credits each commit's own ticket through ownTicket too.
    for (const f of ['scripts/stability-measures.mjs', 'scripts/stability-measures-tracker.mjs', 'scripts/stability-measures-blind.mjs', 'scripts/stability-measures-seat.mjs', 'scripts/delivery-composition.mjs']) {
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
    const { rows, selection, tasks } = await readTracker({ client, windowLandings, window });
    const { seat, ...tracker } = rows;
    for (const r of [...Object.values(tracker), seat[0], seat[2]]) assert.deepStrictEqual([r.status, r.value, r.reason], [STATUS.NOT_MEASURED, null, 'proxy: issue list: HTTP 503'], r.key);
    // LIN-4422: the seat reads the same finished set, so it fails with it, under the same reason, never `not built yet`.
    assert.deepStrictEqual(seat.map((r) => r.key), ['rulings', 'origin', 'operator-free']);
    assert.deepStrictEqual([seat[1].status, seat[1].reason], [STATUS.NOT_MEASURED, ORIGIN_UNREADABLE], 'origin keeps its own reason');
    assert.deepStrictEqual([selection, tasks], [null, null], 'no finished set to hand on');
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

// ── The paper's Balance-to-sign rule (LIN-4422's, no longer a measure) ──────
// The hand-run passes' rule left the measure with the sample (LIN-4439) and lives beside the paper's coder, its one user.
describe('the Balance-to-sign rule: one rule for the paper\'s coder', () => {
  const frozen = ['2026-11-06', '2026-11-06-v2'].flatMap((d) => JSON.parse(readFileSync(join(ROOT, `docs/papers/harbour/cleaner-than-it-started-evidence/${d}/blind-codes.json`), 'utf8'))
    .passes.flatMap((p) => p.rows.map((r) => ({ ...r, where: `${d} ${p.id} #${r.row}` }))));

  test('every frozen Balance cell codes to the sign, score and leans the paper recorded', () => {
    assert.ok(frozen.length >= 200, `both frozen folders read (${frozen.length} rows)`);
    for (const r of frozen) {
      const c = codeBalance(r.balance_raw);
      assert.deepStrictEqual([c.sign, c.score, c.leans], [r.sign, r.score, r.leans], r.where);
    }
  });

  test('the edge cells: mixed (leans worse) is mixed, better (small) is better, (with #3) has no sign', () => {
    assert.deepStrictEqual(codeBalance('**mixed (leans worse)**'), { balance: 'mixed (leans worse)', sign: 'mixed', score: 0, leans: 'worse' });
    assert.deepStrictEqual(codeBalance('**better** (small)'), { balance: 'better (small)', sign: 'better', score: 1, leans: null });
    assert.deepStrictEqual(codeBalance('(with #3)'), { balance: '(with #3)', sign: null, score: null, leans: null });
    assert.deepStrictEqual([codeBalance('**Worse**').score, codeBalance('neutral').score, codeBalance('').sign], [-1, 0, null]);
  });

  test('the paper\'s coder imports the rule and keeps no sign map of its own', () => {
    const src = readFileSync(join(ROOT, 'docs/papers/harbour/cleaner-than-it-started-scripts/code-blind.mjs'), 'utf8');
    assert.match(src, /import \{ codeBalance \} from '\.\/balance-sign\.mjs'/);
    assert.doesNotMatch(src, /better\|neutral\|mixed\|worse|better: 1/);
  });
});

// ── LIN-4519: measure 1 reads the verdict records ───────────────────────────
// A blind read is a verdict record: judgement `blind-read`, outcome better, same or worse, `in` the ticket's task and `on`
// the change of the PR it read. The fixtures are the records the proxy reader folds (verdictFactsFromRecords), so the same
// fold decides the facts the tests see. Landings are after the cutover (VERDICT_RECORDS_SINCE, 21 Nov 08:06Z) unless a
// test says otherwise.
const PR = (n, repo = 'JKershaw/LinearViewer') => `https://github.com/${repo}/pull/${n}`;
const AFTER = (h, m = 0) => new Date(Date.parse('2026-11-13T00:00:00Z') + (h * 60 + m) * 60e3).toISOString().replace('.000Z', 'Z');
const LATER = (h, m = 0) => new Date(Date.parse('2026-11-22T00:00:00Z') + (h * 60 + m) * 60e3).toISOString().replace('.000Z', 'Z');
const ledgerWindow = (specs) => {
  const landings = [];
  const numstat = [];
  specs.forEach(({ subject, date, files = ['lib/x.js'] }, i) => {
    const commit = `${String(i).padStart(2, '0')}`.padEnd(40, 'c');
    landings.unshift(landing(commit, date, subject));
    if (files) numstat.unshift({ commit, files: files.map((p) => ({ path: p, added: 1, deleted: 0 })) });
  });
  return { landings, numstat };
};
/** The records blind reads leave: `reads` = [{ ticket, outcome, prs, at, id?, judgement? }] → { tasks, verdicts, changes, firstAt }. */
function recordsOf(reads) {
  const tasks = new Map();
  const changes = new Map();
  const verdicts = [];
  const firstAt = new Map();
  for (const r of reads) {
    if (!tasks.has(r.ticket)) tasks.set(r.ticket, { kind: 'task', id: `task-${r.ticket}`, fields: { ref: r.ticket } });
    const on = r.prs.map((url) => {
      if (!changes.has(url)) changes.set(url, { kind: 'change', id: `change-${changes.size + 1}`, fields: { ref: url } });
      return `${changes.get(url).id}@1`;
    });
    const id = r.id ?? `verdict-${verdicts.length + 1}`;
    verdicts.push({ kind: 'verdict', id, v: 1, at: r.at, in: `task-${r.ticket}`, links: { on }, fields: { judgement: r.judgement ?? 'blind-read', outcome: r.outcome } });
    firstAt.set(id, r.at);
  }
  return { tasks: [...tasks.values()], verdicts, changes: [...changes.values()], firstAt };
}
/** The facts and change refs measure 1 is handed for `tickets`, folded from `reads` by the proxy reader's own fold. */
function factsOf(reads, tickets) {
  const r = recordsOf(reads);
  return { facts: verdictFactsFromRecords({ tasks: r.tasks, verdicts: r.verdicts, firstAt: r.firstAt }, tickets), changeRefs: changeRefsOf(r.changes) };
}
/** Measure 1 over landings `specs` (ledgerWindow) with `reads` (recordsOf), for the tickets the window needs. */
function measure1(specs, reads, opts = {}) {
  const { landings, numstat } = ledgerWindow(specs);
  const { facts, changeRefs } = factsOf(reads, ticketsToRead({ landings, numstat }));
  return blindRow({ landings, numstat, facts, changeRefs, ...opts });
}

describe('measure 1: a landing counts as read only with a blind-read verdict naming its PR, written before its merge', () => {
  const merged = LATER(2);
  const one = (reads, subject = 'LIN-1: change (#20)', opts = {}) => measure1([{ subject, date: merged }], reads, opts);

  test('a timely verdict on the change whose ref names the landing\'s PR counts as read, with its outcome', () => {
    const r = one([{ ticket: 'LIN-1', outcome: 'worse', prs: [PR(20)], at: LATER(1, 30) }]);
    assert.deepStrictEqual([r.key, r.status, r.value.landings, r.value.read], ['blind', STATUS.MEASURED, 1, 1]);
    assert.deepStrictEqual(r.value.verdicts, { better: 0, same: 0, worse: 1 });
    assert.deepStrictEqual(r.value.unread, { [UNREAD.noTicket]: 0, [UNREAD.notOrdinary]: 0, [UNREAD.beforeGate]: 0, [UNREAD.beforeRecords]: 0, [UNREAD.noRead]: 0 });
    const p = r.value.perLanding[0];
    assert.deepStrictEqual([p.status, p.verdict, p.prUrl, p.readAt, p.verdictId], ['read', 'worse', PR(20), LATER(1, 30), 'verdict-1']);
  });

  test('a verdict first written after the merge is no read on record', () => {
    const r = one([{ ticket: 'LIN-1', outcome: 'better', prs: [PR(20)], at: LATER(2, 5) }]);
    assert.deepStrictEqual([r.value.read, r.value.unread[UNREAD.noRead]], [0, 1]);
    assert.match(r.value.perLanding[0].why, /no blind read naming #20 before the merge/);
  });

  test('a verdict on a change naming a different PR is no read on record', () => {
    const r = one([{ ticket: 'LIN-1', outcome: 'better', prs: [PR(19)], at: LATER(1, 30) }]);
    assert.deepStrictEqual([r.value.read, r.value.unread[UNREAD.noRead]], [0, 1]);
  });

  test('a review verdict, or one on no change at all, is no blind read', () => {
    const r = one([{ ticket: 'LIN-1', outcome: 'better', prs: [PR(20)], at: LATER(1, 30), judgement: 'review' },
      { ticket: 'LIN-1', outcome: 'better', prs: [], at: LATER(1, 35) }]);
    assert.deepStrictEqual([r.value.read, r.value.unread[UNREAD.noRead]], [0, 1]);
  });

  test('the newest verdict gives the outcome; a verdict whose outcome is not a word is not a read', () => {
    const r = one([{ ticket: 'LIN-1', outcome: 'worse', prs: [PR(20)], at: LATER(1, 10) }, { ticket: 'LIN-1', outcome: 'same', prs: [PR(20)], at: LATER(1, 40) },
      { ticket: 'LIN-1', outcome: null, prs: [PR(20)], at: LATER(1, 50) }]);
    assert.deepStrictEqual(r.value.verdicts, { better: 0, same: 1, worse: 0 });
  });

  test('a merge landing\'s PR is its "Merge pull request #N"; a squash landing\'s its trailing (#N)', () => {
    assert.deepStrictEqual([landingPr('Merge pull request #2413 from JKershaw/feat/lin-4438-x'), landingPr('LIN-4419: pin Node (#2412)'), landingPr('LIN-1: see #12 for why')], [2413, 2412, null]);
    const r = one([{ ticket: 'LIN-1', outcome: 'better', prs: [PR(21)], at: LATER(1, 5) }], 'Merge pull request #21 from JKershaw/feat/lin-1-x');
    assert.deepStrictEqual(r.value.verdicts.better, 1);
  });

  test('with the repository known, a PR number names only that repository\'s PR; owner and name ignore case', () => {
    const foreign = PR(20, 'JKershaw/simple-dispatcher');
    const reads = [{ ticket: 'LIN-1', outcome: 'better', prs: [foreign], at: LATER(1, 5) }];
    assert.strictEqual(one(reads).value.read, 1, 'the number alone matches when the repository is unknown');
    assert.strictEqual(one(reads, undefined, { repo: 'JKershaw/LinearViewer' }).value.unread[UNREAD.noRead], 1);
    const own = [{ ticket: 'LIN-1', outcome: 'better', prs: [PR(20)], at: LATER(1, 5) }];
    assert.strictEqual(one(own, undefined, { repo: 'jkershaw/linearviewer' }).value.read, 1, 'GitHub owner and name ignore case (prOf, lib/run-ledger.js)');
    assert.deepStrictEqual([repoSlugOf('https://github.com/JKershaw/LinearViewer.git\n'), repoSlugOf('git@github.com:JKershaw/LinearViewer.git'), repoSlugOf('/tmp/x')],
      ['JKershaw/LinearViewer', 'JKershaw/LinearViewer', null]);
  });
});

describe('measure 1: the cutover: a landing merged before the verdict records is counted apart, never as no read', () => {
  const specs = [
    { subject: 'LIN-1: before the gate (#10)', date: '2026-11-12T20:00:00Z' },
    { subject: 'LIN-2: after the gate, before the cutover (#11)', date: AFTER(2) },
    { subject: 'LIN-3: read (#12)', date: LATER(3) },
  ];
  const reads = [{ ticket: 'LIN-3', outcome: 'better', prs: [PR(12)], at: LATER(2, 30) }];
  const { landings, numstat } = ledgerWindow(specs);

  test('the cutover is the first verdict-import write, 21 Nov 08:06:29.634Z (lib/records/verdict-facts.js)', () => {
    assert.strictEqual(VERDICT_RECORDS_SINCE, '2026-11-21T08:06:29.634Z');
  });

  test('only landings at or after the cutover need their ticket\'s records', () => {
    assert.deepStrictEqual(ticketsToRead({ landings, numstat }), ['LIN-3']);
  });

  test('a landing after the gate and before the cutover is "before the verdict records", and the row says so', () => {
    const { facts, changeRefs } = factsOf(reads, ['LIN-3']);
    const r = blindRow({ landings, numstat, facts, changeRefs });
    assert.deepStrictEqual(r.value.perLanding.map((l) => l.status), ['landed before the gate', UNREAD.beforeRecords, 'read'], 'oldest first');
    assert.deepStrictEqual([r.status, r.unreadable, r.value.read, r.value.verdictRecordsSince], [STATUS.PARTIAL, 1, 1, VERDICT_RECORDS_SINCE]);
    assert.deepStrictEqual(r.value.unread, { [UNREAD.noTicket]: 0, [UNREAD.notOrdinary]: 0, [UNREAD.beforeGate]: 1, [UNREAD.beforeRecords]: 1, [UNREAD.noRead]: 0 });
    assert.match(r.reason, /^1 landing\(s\) merged before the verdict records began \(2026-11-21T08:06:29\.634Z\), not read from them$/);
  });

  test('a window of landings all before the gate stays measured: the gate reason, no partial row', () => {
    const early = ledgerWindow([{ subject: 'LIN-1: a (#1)', date: '2026-11-11T10:00:00Z' }, { subject: 'LIN-2: b (#2)', date: '2026-11-12T10:00:00Z' }]);
    const r = blindRow({ ...early, facts: new Map() });
    assert.deepStrictEqual([r.status, r.unreadable, r.reason, r.value.unread[UNREAD.beforeGate]], [STATUS.MEASURED, 0, null, 2]);
  });

  test('a window after the gate and wholly before the cutover is not measured, its reason naming the cutover', () => {
    const mid = ledgerWindow([{ subject: 'LIN-1: a (#1)', date: AFTER(1) }, { subject: 'LIN-2: b (#2)', date: AFTER(2) }]);
    assert.deepStrictEqual(blindRow({ ...mid, facts: new Map() }), notMeasured('blind', 'every landing merged before the verdict records began (2026-11-21T08:06:29.634Z)'));
  });
});

describe('measure 1: what could not be read is counted, never "no read"', () => {
  const window = ledgerWindow([{ subject: 'LIN-1: a (#1)', date: LATER(1) }, { subject: 'LIN-2: b (#2)', date: LATER(2) }, { subject: 'LIN-3: c (#3)', date: LATER(3), files: null },
    { subject: 'LIN-4: d (#4)', date: LATER(4) }]);

  test('a failed records read and a landing with no file list make the row partial, with their reasons', () => {
    const facts = new Map([
      ['LIN-1', verdictFactsNotMeasured('the records could not be read through the proxy (HTTP 500)')],
      ['LIN-2', { measured: true, taskId: 'task-LIN-2', verdicts: [] }],
      ['LIN-4', { measured: true, taskId: null, verdicts: [] }],
    ]);
    const r = blindRow({ ...window, facts });
    assert.deepStrictEqual([r.status, r.unreadable, r.value.read, r.value.unread[UNREAD.noRead]], [STATUS.PARTIAL, 2, 0, 2]);
    assert.match(r.reason, /the records could not be read through the proxy \(HTTP 500\); .* no file list/);
  });

  test('no landing readable, or no landing at all, is not measured with its reason', () => {
    const { landings, numstat } = ledgerWindow([{ subject: 'LIN-1: a (#1)', date: LATER(1) }]);
    const none = blindRow({ landings, numstat, facts: new Map([['LIN-1', verdictFactsNotMeasured('the records could not be read through the proxy (HTTP 500)')]]) });
    assert.deepStrictEqual([none.status, none.value], [STATUS.NOT_MEASURED, null]);
    assert.match(none.reason, /^no landing could be read \(.* the records could not be read through the proxy \(HTTP 500\)\)$/);
    assert.deepStrictEqual(blindRow({ landings: [], numstat: [], facts: new Map() }), notMeasured('blind', 'no landings in the window'));
  });
});

describe('measure 1: the verdict records come through the paced proxy client, the fold\'s reads only', () => {
  const fakeProxy = (routes) => {
    const paths = [];
    const fetch = async (url) => {
      const path = url.replace('http://p/api/proxy', '');
      paths.push(path);
      const r = routes[path] ?? { status: 404 };
      return { status: r.status, headers: { get: () => null }, json: async () => r.body ?? {} };
    };
    return { paths, client: createProxyClient({ base: 'http://p/api/proxy', fetch, now: () => 0, sleep: async () => {} }) };
  };

  test('the task, verdict and change lists, then the first version of a verdict that has moved on; no issue or comment read', async () => {
    const { client, paths } = fakeProxy({
      '/records?kind=task': { status: 200, body: { records: [{ kind: 'task', id: 'task-1', fields: { ref: 'LIN-1' } }] } },
      '/records?kind=verdict': { status: 200, body: { records: [{ kind: 'verdict', id: 'verdict-2', v: 2, at: LATER(1, 40), in: 'task-1', links: { on: ['change-1@1'] }, fields: { judgement: 'blind-read', outcome: 'worse' } }] } },
      '/records?kind=change': { status: 200, body: { records: [{ kind: 'change', id: 'change-1', v: 1, fields: { ref: PR(5) } }] } },
      '/records/verdict-2': { status: 200, body: { id: 'verdict-2', versions: [{ v: 1, at: LATER(1, 5) }, { v: 2, at: LATER(1, 40) }] } },
    });
    const { facts, changes } = await readVerdictRecords({ client, tickets: ['LIN-1', 'LIN-9'] });
    assert.deepStrictEqual(paths, ['/records?kind=task', '/records?kind=verdict', '/records?kind=change', '/records/verdict-2']);
    assert.deepStrictEqual(facts.get('LIN-1').verdicts.map((x) => [x.id, x.at, x.outcome]), [['verdict-2', LATER(1, 5), 'worse']], 'the first write time, from the first version');
    assert.deepStrictEqual(facts.get('LIN-9'), { measured: true, taskId: null, verdicts: [] }, 'a ticket with no task has no verdicts, which is measured');
    assert.deepStrictEqual(changes.map((c) => c.fields.ref), [PR(5)]);
  });

  test('a failed records read makes every ticket\'s facts not measured, with its reason, never "no verdict"', async () => {
    const { client } = fakeProxy({ '/records?kind=task': { status: 500 } });
    const { facts } = await readVerdictRecords({ client, tickets: ['LIN-1', 'LIN-2'] });
    assert.strictEqual(facts.get('LIN-1').measured, false);
    assert.match(facts.get('LIN-1').reason, /could not be read through the proxy \(HTTP 500\)/);
    assert.deepStrictEqual(facts.get('LIN-2'), facts.get('LIN-1'));
  });
});

// LIN-4519 acceptance: measure 1 reads no comment. Its module, its reader and the CLI name no comment parser or trail read.
test('measure 1 reads no comment: no comment parser or trail read in its module, reader or CLI', () => {
  for (const f of ['scripts/stability-measures-blind.mjs', 'scripts/stability-measures-tracker.mjs', 'scripts/stability-measures.mjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /^import .*run-trail/m, `${f} imports no comment parser`);
    assert.doesNotMatch(src, /\b(parseBlindRead|landingPrUrls|readTrails|latestBlindRead|checkBlindRead)\b/, f);
  }
});

// ── LIN-4422: measure 4, the person's seat ──────────────────────────────────
const ruling = (issue, outcome, extra = {}) => ({
  decision: { decision_id: `${issue}-${outcome}` }, anchor: { issueIdentifier: issue, ...extra.anchor },
  ...(outcome === 'open' ? {} : { resolution: { decisionId: `${issue}-${outcome}`, outcome } }),
});
const fb = (...messages) => messages.map((message, i) => ({ message, timestamp: `2026-11-08T10:0${i}:00Z` }));
const quiet = (over = {}) => ({ membership: { memberIds: ['r1'], rootOnly: 0 }, list: { items: [{ id: 'r1', closedReason: null }], total: 1 }, details: [{ itemId: 'r1', body: { feedback: fb('[working] x', '[done] ok'), closedReason: null } }], ...over });

describe('seat: loop rulings per finished task and the answered share', () => {
  const finished = [{ id: 'LIN-1', parent: 'LIN-9' }, { id: 'LIN-2', parent: 'LIN-9' }, { id: 'LIN-3', parent: null }];

  test('an unreadable rulings read is never 0: both the rulings row and the operator-free share are not measured', () => {
    const [rulings, origin, free] = seatRows({ finished, rulings: { reason: 'HTTP 503' }, dispatch: new Map() });
    assert.deepStrictEqual([rulings.status, rulings.value, rulings.reason], [STATUS.NOT_MEASURED, null, 'rulings read failed: HTTP 503']);
    assert.deepStrictEqual([free.status, free.value], [STATUS.NOT_MEASURED, null]);
    assert.match(free.reason, /no-ruling condition is unreadable/);
    assert.deepStrictEqual([origin.status, origin.reason], [STATUS.NOT_MEASURED, ORIGIN_UNREADABLE]);
  });

  test('outcome buckets as escalation-kpis: answered / (answered + dismissed); withdrawn and self-resolved are neither; null is unreadable', () => {
    const rulings = { rulings: [
      ruling('LIN-1', 'answered'), ruling('LIN-1', 'answered'), ruling('LIN-2', 'dismissed'), ruling('LIN-2', 'withdrawn'),
      ruling('LIN-3', 'self-resolved'), ruling('LIN-3', null), ruling('LIN-3', 'open'),
      ruling('LIN-9', 'answered'), ruling('LIN-500', 'dismissed'),
    ] };
    const r = rulingsRow({ finished, rulings });
    assert.deepStrictEqual([r.status, r.unreadable, r.value.raised, r.value.perFinishedTask, r.value.answeredShare], [STATUS.PARTIAL, 1, 7, 2.33, 66.7]);
    assert.deepStrictEqual(r.value.outcomes, { answered: 2, dismissed: 1, withdrawn: 1, 'self-resolved': 1, unknown: 1, open: 1 });
    assert.match(r.reason, /1 resolved ruling\(s\) have outcome null/);
    assert.strictEqual(r.value.onParents, 1, 'the parent\'s ruling is named, not counted against its pieces');
    assert.strictEqual(r.value.label, LOOP_ONLY);
    assert.match(r.value.notRead.join(' '), /answered task-bound rulings \(anchor\.taskDecisionId\)/);
    assert.match(r.value.notRead.join(' '), /parent or another unfinished ticket .*1 on a finished task's parent/);
    assert.match(r.value.rules.raised, /distinct decisions/);
  });

  test('read rulings with none on the finished tasks is a measured zero, with no share', () => {
    const r = rulingsRow({ finished, rulings: { rulings: [ruling('LIN-500', 'answered')] } });
    assert.deepStrictEqual([r.status, r.value.raised, r.value.perFinishedTask, r.value.answeredShare], [STATUS.MEASURED, 0, 0, null]);
  });
});

describe('seat: blocking read from every lineage member\'s feedback', () => {
  test('a lineage that blocked and then finished counts as blocked (the last-marker helper would say no)', () => {
    const feedback = fb('[working] start', '[blocked] DECISION: which way?', '[working] Session resumed.', '[done] finished');
    assert.strictEqual(hasBlockedMarker(feedback), true);
    assert.strictEqual(deriveBlockedStatus(feedback), null, 'why the measure does not use deriveBlockedStatus');
    const t = taskConditions('LIN-1', { rulingCount: 0, d: quiet({ details: [{ itemId: 'r1', body: { feedback, closedReason: null } }] }) });
    assert.deepStrictEqual([t.blocked, t.free], [true, false]);
  });

  test('[pending] is a handoff, not a wait on a person; a marker must open the entry', () => {
    assert.strictEqual(hasBlockedMarker(fb('[pending] waiting on CI', 'mentions [blocked] mid-line', '[done] ok')), false);
  });

  test('every member /cost lists is read: a marker on a member that is not the root still counts', () => {
    const m = membersOf({ body: LIN4393.cost });
    assert.deepStrictEqual([m.memberIds.length, m.rootOnly], [14, 0]);
    const d = {
      membership: { memberIds: ['root', 'member'], rootOnly: 0 }, list: { items: [], total: 0 },
      details: [{ itemId: 'root', body: { feedback: fb('[done] ok') } }, { itemId: 'member', body: { feedback: fb('[started] Resuming session', '[blocked] DECISION: x', '[done] ok') } }],
    };
    assert.strictEqual(taskConditions('LIN-1', { rulingCount: 0, d }).blocked, true);
  });

  test('membership: roots stand in only where /cost cannot split a lineage, and are counted; no lineage is unreadable', () => {
    const body = { workerSessions: [{ rootItemId: 'a', dispatches: [{ itemId: 'a' }, { itemId: 'b' }] }, { rootItemId: 'c', dispatches: null }] };
    assert.deepStrictEqual(membersOf({ body }), { memberIds: ['a', 'b', 'c'], rootOnly: 1 });
    assert.match(membersOf({ body: { noLineage: true, workerSessions: [] } }).reason, /no lineage/);
    assert.match(membersOf({ reason: 'HTTP 500' }).reason, /cost read failed: HTTP 500/);
  });
});

describe('seat: the operator-free share, an upper bound with its missing condition named', () => {
  const finished = ['LIN-1', 'LIN-2', 'LIN-3', 'LIN-4', 'LIN-5', 'LIN-6'].map((id) => ({ id, parent: null }));
  const dispatch = new Map([
    ['LIN-1', quiet()],
    ['LIN-2', quiet()],
    ['LIN-3', quiet({ list: { items: [{ id: 'q', closedReason: 'operator' }], total: 1 } })], // closed by an operator, a row that never ran
    ['LIN-4', quiet({ details: [{ itemId: 'r1', reason: 'HTTP 500' }] })], // unreadable
    ['LIN-5', quiet({ details: [{ itemId: 'r1', reason: 'HTTP 500' }] })], // unreadable reads, but a ruling already shows the operator
    ['LIN-6', quiet({ membership: { reason: 'no lineage: no dispatch ran for this issue' }, details: [] })],
  ]);
  const rulings = { rulings: [ruling('LIN-2', 'answered'), ruling('LIN-5', 'dismissed')] };

  test('three readable conditions; a task whose reads failed is unreadable unless a read already shows the operator', () => {
    const r = operatorFreeRow({ finished, rulings, dispatch });
    assert.deepStrictEqual([r.status, r.value.read, r.value.operatorFree, r.value.share, r.unreadable], [STATUS.PARTIAL, 4, 1, 25, 2]);
    assert.deepStrictEqual(r.value.failing, { ruling: 2, blocked: 0, operatorClosed: 1 });
    assert.deepStrictEqual(r.value.perTask.find((t) => t.id === 'LIN-5'), { id: 'LIN-5', ruling: true, blocked: null, operatorClosed: null, free: false });
    assert.match(r.reason, /2 task\(s\) unreadable: .*1 dispatch detail read\(s\) failed \(HTTP 500\).*no lineage/);
  });

  test('the row says upper bound, names the missing condition, and discloses the catch-all closes', () => {
    const r = operatorFreeRow({ finished, rulings, dispatch });
    assert.strictEqual(r.value.label, UPPER_BOUND);
    assert.strictEqual(r.value.missingCondition, MISSING_CONDITION);
    assert.match(MISSING_CONDITION, /no person-started dispatch \(not measured: dispatchedBy is the workspace account for autopilot and person alike\)/);
    assert.match(r.value.caveats.join(' '), /catch-all .*bulk fossil passes/);
    const w = { base: 'b'.repeat(40), head: 'h'.repeat(40), baseDate: 'x', headDate: 'y', landings: 6 };
    const table = formatTable(buildReading({ window: w, rows: { seat: seatRows({ finished, rulings, dispatch }) } }));
    assert.match(table, /^4\. The person's seat\n {3}rulings +loop rulings only: 2 raised over 6 finished tasks.*\n {3}origin +not measured: dispatchedBy is the workspace account for autopilot and person alike\n {3}operator-free +upper bound: 25% \(1 of 4 tasks\).*missing condition: no person-started dispatch/m);
    assert.doesNotMatch(table, /\{"/);
  });

  test('a truncated dispatch list leaves closedReason unknown, never "not closed"', () => {
    const t = taskConditions('LIN-1', { rulingCount: 0, d: quiet({ list: { items: [{ id: 'r1', closedReason: null }], total: DISPATCH_LIST_LIMIT + 1 } }) });
    assert.deepStrictEqual([t.operatorClosed, t.free], [null, null]);
    assert.match(t.reason, /dispatch list truncated \(1 of 101\)/);
  });
});

describe('the seat read end to end, through a fake proxy', () => {
  const cost = { workerSessions: [{ rootItemId: 'root-1', dispatches: [{ itemId: 'root-1' }, { itemId: 'member-1' }] }] };
  const fetchFrom = (routes) => {
    const paths = [];
    const fetch = async (url) => {
      const path = url.replace('http://p/api/proxy', '');
      paths.push(path);
      const r = routes[path] ?? { status: 404 };
      return { status: r.status, headers: { get: () => null }, json: async () => r.body ?? {} };
    };
    let t = 0;
    return { paths, client: createProxyClient({ base: 'http://p/api/proxy', fetch, now: () => t, sleep: async (ms) => { t += ms; } }) };
  };
  const routes = {
    '/rulings?includeResolved=true': { status: 200, body: { rulings: [ruling('LIN-31', 'answered')] } },
    [`/dispatch?issueIdentifier=LIN-30&limit=${DISPATCH_LIST_LIMIT}`]: { status: 200, body: { items: [{ id: 'root-1', closedReason: null }], total: 1 } },
    [`/dispatch?issueIdentifier=LIN-31&limit=${DISPATCH_LIST_LIMIT}`]: { status: 200, body: { items: [], total: 0 } },
    '/dispatch/root-1': { status: 200, body: { feedback: fb('[done] ok'), closedReason: null } },
    '/dispatch/member-1': { status: 200, body: { feedback: fb('[blocked] DECISION: x', '[done] ok'), closedReason: null } },
    '/dispatch/root-2': { status: 200, body: { feedback: fb('[done] ok'), closedReason: null } },
  };
  const finished = [{ id: 'LIN-30', parent: null }, { id: 'LIN-31', parent: null }];
  const tasks = [{ id: 'LIN-30', cost: { body: cost } }, { id: 'LIN-31', cost: { body: { workerSessions: [{ rootItemId: 'root-2', dispatches: null }] } } }];

  test('rulings once, then each task\'s list and every member\'s detail; the member\'s marker blocks LIN-30', async () => {
    const { client, paths } = fetchFrom(routes);
    const { rows } = await readSeat({ client, finished, tasks });
    assert.strictEqual(paths.filter((p) => p.startsWith('/rulings')).length, 1, 'one rulings read for every task');
    assert.ok(paths.includes('/dispatch/member-1'), 'a lineage member, not only its root');
    const [rulingsR, , free] = rows;
    assert.deepStrictEqual([rulingsR.value.raised, rulingsR.value.answeredShare], [1, 100]);
    assert.deepStrictEqual([free.status, free.value.read, free.value.operatorFree, free.value.failing.blocked, free.value.rootOnlyLineages], [STATUS.MEASURED, 2, 0, 1, 1]);
  });

  test('a failed rulings read skips every dispatch read: no share can be read without the no-ruling condition', async () => {
    const { client, paths } = fetchFrom({ ...routes, '/rulings?includeResolved=true': { status: 503 } });
    const { rows } = await readSeat({ client, finished, tasks });
    assert.deepStrictEqual(paths, ['/rulings?includeResolved=true']);
    assert.deepStrictEqual(rows.map((r) => r.status), [STATUS.NOT_MEASURED, STATUS.NOT_MEASURED, STATUS.NOT_MEASURED]);
  });

  test('no proxy: the seat is not measured with the tracker\'s reason, never `not built yet`', () => {
    const rows = trackerNotMeasured('no --api given and HARBOUR_LOCAL_BASE unset');
    const reading = buildReading({ window: {}, rows: { seat: rows.seat } });
    assert.deepStrictEqual(reading.measures[3].rows.map((r) => r.reason), ['no --api given and HARBOUR_LOCAL_BASE unset', ORIGIN_UNREADABLE, 'no --api given and HARBOUR_LOCAL_BASE unset']);
  });
});

// ── LIN-4423: the reference reading and the declaration ──────────────────────
// The reference is written by the tool itself (--as-reference) and read back by it (--reference), so every value beside
// a live row has that row's definition. The committed 8 Nov reading must reproduce piece 1's verified figures, and the
// declaration must name every row the tool emits, so a renamed row or measure cannot drift past it unnoticed.
const DECLARATION_DIR = join(ROOT, 'docs/reviews/stability-measures');
const REFERENCE = JSON.parse(readFileSync(join(DECLARATION_DIR, 'reference-2026-11-08.json'), 'utf8'));
const DECLARATION = readFileSync(join(DECLARATION_DIR, 'README.md'), 'utf8');
const rowsOf = (reading) => Object.fromEntries(reading.measures.flatMap((m) => m.rows.map((r) => [r.key, r])));

describe('the reference: written and read by the tool, never another definition', () => {
  const window = { base: 'b'.repeat(40), head: 'h'.repeat(40), baseDate: '2026-11-08T17:10:36Z', headDate: '2026-11-12T17:00:00Z', landings: 10 };
  const reference = (rows, extra = {}) => ({
    tool: 'stability-measures', reference: { label: '8 Nov' }, scope: { include: SCOPE_INCLUDE }, measures: [{ key: 'curve', rows }], ...extra,
  });

  test('referencesFrom keys each reference row by its row key, carrying the label, status, value and reason', () => {
    const churn = churnRow(parseNumstat('@a\n\n3\t1\tlib/x.js'), inScope);
    const refs = referencesFrom(reference([churn, notMeasured('blind', noReferenceReading('8 Nov'))]));
    assert.deepStrictEqual(refs.churn, { label: '8 Nov', status: STATUS.MEASURED, value: churn.value, reason: null, unreadable: 0 });
    assert.deepStrictEqual(refs.blind, { label: '8 Nov', status: STATUS.NOT_MEASURED, value: null, reason: 'no 8 Nov reading; the first reading sets it', unreadable: null });
  });

  test('the rows a reference never has are the rows measures 1 and 4 emit, in their modules\' order', () => {
    assert.deepStrictEqual(NO_REFERENCE_ROWS['no-new-mess'], [blindRow({ landings: [], numstat: [], facts: new Map() }).key]);
    assert.deepStrictEqual(NO_REFERENCE_ROWS.seat, seatNotMeasured('x').map((r) => r.key));
    assert.deepStrictEqual(NO_REFERENCE_KEYS, [...NO_REFERENCE_ROWS['no-new-mess'], ...NO_REFERENCE_ROWS.seat]);
  });

  test('a file that is not this tool\'s reference reading, or counts lines on another scope, is refused', () => {
    assert.throws(() => referencesFrom({ tool: 'shape' }), /not a stability-measures reading/);
    assert.throws(() => referencesFrom({ ...reference([]), reference: undefined }), /not a reference reading/);
    assert.throws(() => referencesFrom(reference([], { scope: { include: '^lib/' } })), /another scope/);
  });

  test('the opening table prints each reference under its live row, summarised by the row\'s own rule', () => {
    const live = churnRow(parseNumstat('@a\n\n9\t3\tlib/x.js'), inScope);
    const refs = referencesFrom(reference([churnRow(parseNumstat('@a\n\n3\t1\tlib/x.js'), inScope), notMeasured('blind', noReferenceReading('8 Nov'))]));
    const table = formatTable(buildReading({
      window,
      rows: { curve: [churnRow(parseNumstat('@a\n\n9\t3\tlib/x.js'), inScope, { reference: refs.churn })], 'no-new-mess': [blindRow({ landings: [], numstat: [], facts: new Map(), reference: refs.blind })] },
    }));
    assert.match(table, new RegExp(`churn +${live.value.added} added.*\\n {20}8 Nov: 3 added, 1 deleted over 1 landings`));
    assert.match(table, /blind +not measured: no landings in the window\n {20}8 Nov: not measured: no 8 Nov reading; the first reading sets it/);
  });

  test('the CLI refuses a reference reading read against a reference, and a --reference that is not one, before any read', () => {
    const cli = (...args) => spawnSync(process.execPath, ['scripts/stability-measures.mjs', '.', 'HEAD', 'HEAD', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HARBOUR_LOCAL_BASE: '' } });
    const both = cli('--as-reference', '8 Nov', '--reference', 'docs/reviews/stability-measures/reference-2026-11-08.json');
    assert.strictEqual(both.status, 2);
    assert.match(both.stderr, /give --reference or --as-reference, not both/);
    const wrong = cli('--reference', 'package.json');
    assert.strictEqual(wrong.status, 2);
    assert.match(wrong.stderr, /--reference package\.json is not a stability-measures reading/);
  });
});

describe('the committed 8 Nov reference reproduces the verified figures', () => {
  const rows = rowsOf(REFERENCE);

  test('window 5334c81a..9574d537 (run 4\'s pin to run 5\'s), 114 landings, written as the 8 Nov reference', () => {
    assert.strictEqual(REFERENCE.window.base.slice(0, 8), '5334c81a');
    assert.strictEqual(REFERENCE.window.head.slice(0, 8), '9574d537');
    assert.strictEqual(REFERENCE.window.landings, 114);
    assert.strictEqual(REFERENCE.reference.label, '8 Nov');
    assert.deepStrictEqual(REFERENCE.measures.map((m) => m.title), MEASURES.map((m) => m.title));
  });

  test('lines: net 6,558 = code +3,034, comment-only +3,185, blank +339; share 39.44% → 39.73%', () => {
    const { net, base, head } = rows.lines.value;
    assert.deepStrictEqual([net.total, net.code, net.comment, net.blank], [6558, 3034, 3185, 339]);
    assert.deepStrictEqual([base.commentShare, head.commentShare], [39.44, 39.73]);
  });

  test('churn 0.36 deleted per added; Waiting 0 → 56 in Harbour and 10 in the runner at 5d8489e', () => {
    assert.strictEqual(rows.churn.value.deletedPerAdded, 0.36);
    assert.deepStrictEqual([rows['waiting.harbour'].value.base, rows['waiting.harbour'].value.head], [0, 56]);
    assert.strictEqual(rows['waiting.runner'].value.head, 10);
    assert.strictEqual(rows['waiting.runner'].value.headSha.slice(0, 7), '5d8489e');
  });

  test('the blind-read and seat rows say the starting point had none; every other row was measured', () => {
    for (const key of NO_REFERENCE_KEYS) {
      assert.deepStrictEqual([rows[key].status, rows[key].reason], [STATUS.NOT_MEASURED, noReferenceReading('8 Nov')], key);
    }
    for (const [key, r] of Object.entries(rows).filter(([k]) => !NO_REFERENCE_KEYS.includes(k))) assert.strictEqual(r.status, STATUS.MEASURED, key);
  });

  test('no session-local diagnostic is committed: no proxy URL, no call counts, no runner tip', () => {
    assert.strictEqual(REFERENCE.inputs.api, '$HARBOUR_LOCAL_BASE/api/proxy');
    assert.ok(!('calls' in REFERENCE.sources.tracker));
    for (const k of ['tip', 'tipDate', 'upstreamSha']) assert.ok(!(k in REFERENCE.sources.runner), k);
    assert.match(REFERENCE.sources.tracker.readOn, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the declaration names what the tool emits', () => {
  test('every measure title, in order, and every row key the reference carries', () => {
    let at = 0;
    for (const m of MEASURES) {
      const i = DECLARATION.indexOf(`${m.rank}. ${m.title}`, at);
      assert.ok(i >= at, `README names "${m.rank}. ${m.title}" after the measure before it`);
      at = i;
    }
    for (const key of Object.keys(rowsOf(REFERENCE))) assert.ok(DECLARATION.includes(`\`${key}\``), `README names row \`${key}\``);
  });

  test('every scripts/ or lib/ module it cites exists', () => {
    const cited = [...DECLARATION.matchAll(/`((?:scripts|lib)\/[\w./-]+\.m?js)`/g)].map((m) => m[1]);
    assert.ok(cited.length >= 5, 'the declaration points at the defining modules');
    for (const p of new Set(cited)) assert.ok(existsSync(join(ROOT, p)), p);
  });
});

// The CLI's own reads (LIN-4423 leftovers): git numstat with merge landings, the landing log's ownership, Waiting in both
// repositories (LIN-4505: from the committed series, so a fixture commit reads not measured), the runner's endpoints by date, the `gh` listing and measure 1 without a proxy, run end to end on fixture
// repositories. `gh` is a stand-in script first on PATH that records its arguments and prints fixed runs, so nothing
// leaves the machine. The lookback's prior-landing log is read only with a proxy, so its test gives a loopback stand-in
// whose issue list is empty: the tracker rows stop there, after the log was read. The proxy reads themselves are the
// tracker tests' above.
describe('the CLI\'s reads, end to end on fixture repositories', () => {
  // A note's text only gives each fixture commit a change: the tool no longer reads notes for Waiting (LIN-4505).
  const note = (n) => `# x\n\n## Lessons\n\n${Array.from({ length: n }, (_, i) => `- \`lib/a.js\`: lesson ${i}.\n`).join('')}`;
  const at = (d) => `2026-01-0${d}T12:00:00Z`;

  test('churn counts a merge landing against its first parent; tickets, Waiting, runner endpoints and CI are read; measure 1 needs --api', () => {
    const repo = makeRepo();
    const runner = makeRepo();
    const fake = mkdtempSync(join(tmpdir(), 'stability-gh-'));
    try {
      const base = repo.commit({ 'lib/a.js': 'const a = 1;\nconst b = 2;\n', 'docs/areas/x.md': note(1) }, at(1), 'base');
      const squash = repo.commit({ 'lib/b.js': 'export const b = 1;\nexport const c = 2;\n' }, at(2), 'LIN-1: add b (#1)');
      repo.git('checkout', '-q', '-b', 'feat/lin-2-c');
      repo.commit({ 'lib/c.js': '// c\nexport const c = 1;\n\n', 'lib/a.js': 'const a = 1;\n', 'docs/areas/x.md': note(3) }, at(3), 'work');
      repo.git('checkout', '-q', 'main');
      const env = { ...process.env, GIT_AUTHOR_DATE: at(4), GIT_COMMITTER_DATE: at(4) };
      spawnSync('git', ['-C', repo.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', '--no-ff', 'feat/lin-2-c',
        '-m', 'Merge pull request #2 from x/feat/lin-2-c', '-m', 'Add c'], { env });
      const merge = repo.git('rev-parse', 'HEAD').trim();

      runner.commit({ 'docs/areas/r.md': note(1) }, '2025-12-31T00:00:00Z', 'r1');
      const runnerHead = runner.commit({ 'docs/areas/r.md': note(2) }, at(3), 'r2');
      runner.commit({ 'docs/areas/r.md': note(5) }, at(6), 'r3 (after head: the tip, not an endpoint)');

      const minutesLater = (sha, m) => ({ databaseId: m, headSha: sha, startedAt: at(4), updatedAt: new Date(Date.parse(at(4)) + m * 60e3).toISOString(), conclusion: 'success' });
      writeFileSync(join(fake, 'runs.json'), JSON.stringify([minutesLater(squash, 4), minutesLater(merge, 8), minutesLater(base, 60)]));
      writeFileSync(join(fake, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(fake, 'args')}"\ncat "${join(fake, 'runs.json')}"\n`);
      chmodSync(join(fake, 'gh'), 0o755);
      const cli = (...args) => {
        const r = spawnSync(process.execPath, [join(ROOT, 'scripts/stability-measures.mjs'), repo.dir, base, merge, '--runner', runner.dir, ...args],
          { encoding: 'utf8', env: { ...process.env, HARBOUR_LOCAL_BASE: '', PATH: `${fake}${delimiter}${process.env.PATH}` } });
        assert.strictEqual(r.status, 0, r.stderr);
        return rowsOf(JSON.parse(r.stdout));
      };

      const rows = cli();
      // Without --diff-merges=first-parent the merge landing has no numstat and churn reads 2 added, 0 deleted.
      assert.deepStrictEqual([rows.churn.value.landings, rows.churn.value.added, rows.churn.value.deleted], [2, 5, 1]);
      assert.deepStrictEqual(rows.lines.value.net, { total: 4, code: 2, comment: 1, blank: 1 });
      // LIN-4505: the Waiting rows read the committed series and the records, never the notes in git. These fixture
      // commits are not in the series and predate the records, so each Waiting row is not measured with that reason.
      assert.strictEqual(rows['waiting.harbour'].status, STATUS.NOT_MEASURED);
      assert.match(rows['waiting.harbour'].reason, /no reading at .*: it is not in the committed Waiting series/);
      assert.strictEqual(rows['waiting.runner'].status, STATUS.NOT_MEASURED);
      assert.match(rows['waiting.runner'].reason, /is not in the committed Waiting series for simple-dispatcher/);
      assert.strictEqual(rows['waiting.total'].status, STATUS.NOT_MEASURED);
      assert.deepStrictEqual([rows.ci.value.runs, rows.ci.value.medianMinutes], [2, 6], 'the base\'s run is not a landing\'s');
      const ghArgs = readFileSync(join(fake, 'args'), 'utf8').split('\n');
      for (const [flag, value] of [['--workflow', 'test.yml'], ['--branch', 'main'], ['--status', 'success'], ['--created', '2026-01-01..2026-01-05']]) {
        assert.strictEqual(ghArgs[ghArgs.indexOf(flag) + 1], value, flag);
      }
      // No proxy: measure 1 is a not-measured row in the core's shape, never a zero count (lesson LIN-4420).
      assert.deepStrictEqual(rows.blind, notMeasured('blind', 'no --api given and HARBOUR_LOCAL_BASE unset'));
      assert.ok(!('sample' in rows), 'the sample row is gone: measure 1 has one row');
    } finally {
      repo.cleanup(); runner.cleanup(); rmSync(fake, { recursive: true, force: true });
    }
  });

  // LIN-4423 review, ledger item 1: the committed reference tests assert a static file, so this drives the code path that
  // writes a reference (--as-reference) and reads it back beside the live rows (--reference). Seen red under each of: the
  // CLI's refs forced to {}, the runner tip kept in a reference's output, the blind row read live in reference mode.
  test('--as-reference writes a reference reading that --reference reads back beside each live row', () => {
    const repo = makeRepo();
    const runner = makeRepo();
    const fake = mkdtempSync(join(tmpdir(), 'stability-gh-'));
    try {
      const base = repo.commit({ 'lib/a.js': 'const a = 1;\nconst b = 2;\n', 'docs/areas/x.md': note(1) }, at(1), 'base');
      const head = repo.commit({ 'lib/b.js': 'export const b = 1;\n', 'lib/a.js': 'const a = 1;\n', 'docs/areas/x.md': note(2) }, at(2), 'LIN-1: add b (#1)');
      runner.commit({ 'docs/areas/r.md': note(1) }, at(1), 'r1');
      runner.commit({ 'docs/areas/r.md': note(3) }, at(5), 'r2 (after head: the tip a live reading records)');
      writeFileSync(join(fake, 'gh'), '#!/bin/sh\necho "[]"\n');
      chmodSync(join(fake, 'gh'), 0o755);
      const cli = (...args) => {
        const r = spawnSync(process.execPath, [join(ROOT, 'scripts/stability-measures.mjs'), repo.dir, base, head, '--runner', runner.dir, ...args],
          { encoding: 'utf8', env: { ...process.env, HARBOUR_LOCAL_BASE: '', PATH: `${fake}${delimiter}${process.env.PATH}` } });
        assert.strictEqual(r.status, 0, r.stderr);
        return { out: JSON.parse(r.stdout), stdout: r.stdout, stderr: r.stderr };
      };

      const first = cli('--as-reference', 'fix');
      const refRows = rowsOf(first.out);
      for (const key of NO_REFERENCE_KEYS) {
        assert.deepStrictEqual([refRows[key].status, refRows[key].reason], [STATUS.NOT_MEASURED, noReferenceReading('fix')], key);
      }
      for (const k of ['tip', 'tipDate', 'upstreamSha']) assert.ok(!(k in first.out.sources.runner), k);
      assert.ok(!('calls' in first.out.sources.tracker));

      const file = join(fake, 'reference.json');
      writeFileSync(file, first.stdout);
      const second = cli('--reference', file);
      const rows = rowsOf(second.out);
      assert.deepStrictEqual(rows.churn.reference, { label: 'fix', status: STATUS.MEASURED, value: refRows.churn.value, reason: null, unreadable: 0 });
      assert.strictEqual(rows.blind.reference.reason, noReferenceReading('fix'));
      assert.match(second.stderr, /\n {20}fix: \d/);
    } finally {
      repo.cleanup(); runner.cleanup(); rmSync(fake, { recursive: true, force: true });
    }
  });
});

test('the lookback reads the first-parent landings of the days before base, base included, and no older', async () => {
  const repo = makeRepo();
  const fake = mkdtempSync(join(tmpdir(), 'stability-gh-'));
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ issues: [] })); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    repo.commit({ 'lib/a.js': 'const a = 0;\n' }, '2025-12-20T12:00:00Z', 'LIN-7: older than the lookback');
    repo.commit({ 'lib/a.js': 'const a = 1;\n' }, '2025-12-30T12:00:00Z', 'LIN-8: inside the lookback');
    const base = repo.commit({ 'lib/a.js': 'const a = 2;\n' }, '2026-01-01T12:00:00Z', 'LIN-9: base');
    const head = repo.commit({ 'lib/b.js': 'const b = 1;\n' }, '2026-01-02T12:00:00Z', 'LIN-10: the window');
    writeFileSync(join(fake, 'gh'), '#!/bin/sh\necho "[]"\n');
    chmodSync(join(fake, 'gh'), 0o755);
    const out = await new Promise((resolve, reject) => execFile(process.execPath,
      [join(ROOT, 'scripts/stability-measures.mjs'), repo.dir, base, head, '--api', `http://127.0.0.1:${server.address().port}`, '--lookback-days', '3'],
      { env: { ...process.env, HARBOUR_LOCAL_BASE: '', PATH: `${fake}${delimiter}${process.env.PATH}` } },
      (e, stdout, stderr) => (e ? reject(new Error(stderr || e.message)) : resolve(JSON.parse(stdout)))));
    assert.deepStrictEqual(out.sources.tracker.lookback, { days: 3, since: '2025-12-29T12:00:00.000Z' });
    assert.strictEqual(out.sources.tracker.priorLandings, 2, 'LIN-8 and base; not LIN-7');
    assert.match(rowsOf(out).tasks.reason, /issue list has no LIN- issue/);
  } finally {
    server.close(); repo.cleanup(); rmSync(fake, { recursive: true, force: true });
  }
});

// LIN-4505 review (finding-5ebfd2a9): the CLI's records path for waiting.harbour, end to end. Both window endpoints are
// fixture commits dated after `records.coveredFrom`, so neither is in the committed series and each is read from the
// records store: a loopback stand-in for the proxy answers GET /records?to=project&state=open&asOf=... by the time asked.
// Seen red with the CLI's head endpoint given `client: null` (the head then reads "no --api given", not 2).
test('the CLI reads waiting.harbour from the records at each endpoint commit\'s time, through --api', async () => {
  const repo = makeRepo();
  const fake = mkdtempSync(join(tmpdir(), 'stability-gh-'));
  const asked = [];
  const open = (id, kind, to) => ({ id, kind, to, state: 'open', openedAt: '2026-11-20T13:06:49.033Z' });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('content-type', 'application/json');
    if (url.pathname !== '/records') { res.end(JSON.stringify({ issues: [] })); return; }
    asked.push({ to: url.searchParams.get('to'), state: url.searchParams.get('state'), asOf: url.searchParams.get('asOf') });
    // One finding open at the base's time; two findings and a task (not a hand-off) at the head's.
    const atBase = Date.parse(url.searchParams.get('asOf')) < Date.parse('2026-11-22T00:00:00Z');
    res.end(JSON.stringify({ records: atBase ? [open('finding-a', 'finding', 'project')]
      : [open('finding-a', 'finding', 'project'), open('question-b', 'question', 'project'), open('task-c', 'task', 'project')] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const baseDate = '2026-11-21T12:00:00Z';
    const headDate = '2026-11-22T12:00:00Z';
    const base = repo.commit({ 'lib/a.js': 'const a = 1;\n' }, baseDate, 'LIN-1: base');
    const head = repo.commit({ 'lib/b.js': 'const b = 1;\n' }, headDate, 'LIN-2: head');
    writeFileSync(join(fake, 'gh'), '#!/bin/sh\necho "[]"\n');
    chmodSync(join(fake, 'gh'), 0o755);
    const out = await new Promise((resolve, reject) => execFile(process.execPath,
      [join(ROOT, 'scripts/stability-measures.mjs'), repo.dir, base, head, '--api', `http://127.0.0.1:${server.address().port}`, '--lookback-days', '1'],
      { env: { ...process.env, HARBOUR_LOCAL_BASE: '', PATH: `${fake}${delimiter}${process.env.PATH}` } },
      (e, stdout, stderr) => (e ? reject(new Error(stderr || e.message)) : resolve(JSON.parse(stdout)))));
    const harbour = rowsOf(out)['waiting.harbour'];
    assert.strictEqual(harbour.status, STATUS.MEASURED, harbour.reason);
    assert.deepStrictEqual([harbour.value.base, harbour.value.head], [1, 2], 'findings and questions to the project, not the task');
    const waiting = asked.filter((q) => q.to === 'project' && q.state === 'open').map((q) => q.asOf);
    assert.ok(waiting.includes(new Date(baseDate).toISOString()), 'the base commit\'s time was asked');
    assert.ok(waiting.includes(new Date(headDate).toISOString()), 'the head commit\'s time was asked');
  } finally {
    server.close(); repo.cleanup(); rmSync(fake, { recursive: true, force: true });
  }
});

// LIN-4519: measure 1 end to end. A fixture repository whose window holds one landing for each outcome, its origin a
// GitHub remote, and a loopback stand-in proxy serving the verdict records. Its issue list fails, so the tracker stops
// after one call, and measure 1 reads the records (task, verdict, change) of its ordinary landings at or after the
// cutover, and no comment.
test('measure 1 reads the verdict records through --api and counts the window\'s landings by outcome', async () => {
  const repo = makeRepo();
  const fake = mkdtempSync(join(tmpdir(), 'stability-gh-'));
  const lv = (n) => `https://github.com/JKershaw/LinearViewer/pull/${n}`;
  const foreign = 'https://github.com/JKershaw/simple-dispatcher/pull/8';
  const records = {
    task: [{ kind: 'task', id: 'task-1', fields: { ref: 'LIN-1' } }, { kind: 'task', id: 'task-3', fields: { ref: 'LIN-3' } }],
    change: [{ kind: 'change', id: 'change-5', fields: { ref: lv(5) } }, { kind: 'change', id: 'change-8', fields: { ref: foreign } }],
    verdict: [
      { kind: 'verdict', id: 'verdict-1', v: 1, at: '2026-11-22T10:50:00Z', in: 'task-1', links: { on: ['change-5@1'] }, fields: { judgement: 'blind-read', outcome: 'better' } },
      { kind: 'verdict', id: 'verdict-3', v: 1, at: '2026-11-22T12:40:00Z', in: 'task-3', links: { on: ['change-8@1'] }, fields: { judgement: 'blind-read', outcome: 'same' } },
    ],
  };
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    res.setHeader('content-type', 'application/json');
    const m = /^\/records\?kind=(task|verdict|change)$/.exec(req.url);
    if (m) return res.end(JSON.stringify({ records: records[m[1]] }));
    res.statusCode = 404;
    return res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    repo.git('remote', 'add', 'origin', 'https://github.com/JKershaw/LinearViewer.git');
    const base = repo.commit({ 'lib/a.js': 'const a = 0;\n' }, '2026-11-21T06:00:00Z', 'base');
    repo.commit({ 'lib/a.js': 'const a = 1;\n' }, '2026-11-21T07:00:00Z', 'LIN-4: before the verdict records (#4)');
    repo.commit({ 'lib/b.js': 'const b = 1;\n' }, '2026-11-22T11:00:00Z', 'LIN-1: add b (#5)');
    repo.commit({ 'docs/n.md': 'n\n' }, '2026-11-22T11:30:00Z', 'LIN-2: notes only (#6)');
    repo.commit({ 'lib/c.js': 'const c = 1;\n' }, '2026-11-22T12:00:00Z', 'Tidy c (#7)');
    repo.git('checkout', '-q', '-b', 'feat/lin-3-d');
    repo.commit({ 'lib/d.js': 'const d = 1;\n' }, '2026-11-22T12:50:00Z', 'work');
    repo.git('checkout', '-q', 'main');
    spawnSync('git', ['-C', repo.dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'merge', '-q', '--no-ff', 'feat/lin-3-d',
      '-m', 'Merge pull request #8 from x/feat/lin-3-d', '-m', 'Add d'], { env: { ...process.env, GIT_AUTHOR_DATE: '2026-11-22T13:00:00Z', GIT_COMMITTER_DATE: '2026-11-22T13:00:00Z' } });
    const head = repo.git('rev-parse', 'HEAD').trim();
    writeFileSync(join(fake, 'gh'), '#!/bin/sh\necho "[]"\n');
    chmodSync(join(fake, 'gh'), 0o755);
    const out = await new Promise((resolve, reject) => execFile(process.execPath,
      [join(ROOT, 'scripts/stability-measures.mjs'), repo.dir, base, head, '--api', `http://127.0.0.1:${server.address().port}`, '--lookback-days', '0'],
      { env: { ...process.env, HARBOUR_LOCAL_BASE: '', PATH: `${fake}${delimiter}${process.env.PATH}` } },
      (e, stdout, stderr) => (e ? reject(new Error(stderr || e.message)) : resolve({ json: JSON.parse(stdout), table: stderr }))));
    const blind = rowsOf(out.json).blind;
    assert.deepStrictEqual([blind.status, blind.value.landings, blind.value.read, blind.value.repo], [STATUS.PARTIAL, 5, 1, 'JKershaw/LinearViewer']);
    assert.deepStrictEqual(blind.value.verdicts, { better: 1, same: 0, worse: 0 });
    // LIN-4 landed before the verdict records; LIN-3 is a merge landing (its ticket from the branch, its PR from "Merge
    // pull request #8"), and its verdict names simple-dispatcher's #8, not this repository's: no read on record.
    assert.deepStrictEqual(blind.value.unread, { 'no ticket': 1, 'not an ordinary landing': 1, 'landed before the gate': 0, 'before the verdict records': 1, 'no read on record': 1 });
    assert.deepStrictEqual(paths.filter((p) => p.startsWith('/records?kind=')), ['/records?kind=task', '/records?kind=verdict', '/records?kind=change']);
    assert.ok(!paths.some((p) => p.startsWith('/issues/')), 'no ticket\'s comments are read');
    assert.match(rowsOf(out.json).tasks.reason, /^proxy: issue list: not found$/);
    assert.match(blind.reason, /^1 landing\(s\) merged before the verdict records began \(2026-11-21T08:06:29\.634Z\), not read from them$/);
  } finally {
    server.close(); repo.cleanup(); rmSync(fake, { recursive: true, force: true });
  }
});

// LIN-4519: a window wholly before the cutover reads no record at all (ticketsToRead is empty), and measure 1 is not
// measured with the cutover as its reason.
test('a window wholly before the verdict records reads no record and is not measured, its reason naming the cutover', async () => {
  const repo = makeRepo();
  const fake = mkdtempSync(join(tmpdir(), 'stability-gh-'));
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.statusCode = 404;
    return res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    repo.git('remote', 'add', 'origin', 'https://github.com/JKershaw/LinearViewer.git');
    const base = repo.commit({ 'lib/a.js': 'const a = 0;\n' }, '2026-11-20T06:00:00Z', 'base');
    const head = repo.commit({ 'lib/a.js': 'const a = 1;\n' }, '2026-11-20T07:00:00Z', 'LIN-1: add a (#5)');
    writeFileSync(join(fake, 'gh'), '#!/bin/sh\necho "[]"\n');
    chmodSync(join(fake, 'gh'), 0o755);
    const out = await new Promise((resolve, reject) => execFile(process.execPath,
      [join(ROOT, 'scripts/stability-measures.mjs'), repo.dir, base, head, '--api', `http://127.0.0.1:${server.address().port}`, '--lookback-days', '0'],
      { env: { ...process.env, HARBOUR_LOCAL_BASE: '', PATH: `${fake}${delimiter}${process.env.PATH}` } },
      (e, stdout, stderr) => (e ? reject(new Error(stderr || e.message)) : resolve({ json: JSON.parse(stdout), table: stderr }))));
    const blind = rowsOf(out.json).blind;
    assert.deepStrictEqual([blind.status, blind.value], [STATUS.NOT_MEASURED, null]);
    assert.strictEqual(blind.reason, 'every landing merged before the verdict records began (2026-11-21T08:06:29.634Z)');
    assert.deepStrictEqual(paths.filter((p) => p.startsWith('/records?kind=') || p.startsWith('/issues/')), [], 'no verdict or comment read');
  } finally {
    server.close(); repo.cleanup(); rmSync(fake, { recursive: true, force: true });
  }
});

// LIN-4439 acceptance: one source for measure 1. The hand-scored input and the sample are gone from the tool and its
// declaration, and nothing else in the measuring scripts scores a blind read.
test('measure 1 has one source: no --blind input and no sample anywhere in the tool or its declaration', () => {
  const files = ['scripts/stability-measures.mjs', 'scripts/stability-measures-core.mjs', 'scripts/stability-measures-blind.mjs',
    'scripts/stability-measures-tracker.mjs', 'scripts/stability-measures-seat.mjs', 'docs/reviews/stability-measures/README.md'];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /--blind\b|signs\.json|sampleRow|evenSample|SAMPLE_SIZE|pending blind reads/, f);
  }
  assert.ok(!rowsOf(REFERENCE).sample, 'the committed reference has no sample row');
  assert.ok(!('blind' in REFERENCE.inputs), 'the committed reference records no --blind input');
});

// LIN-4439 acceptance: the hand-run pass is retired in writing, dated, in every place the plan names, and the
// declaration says a diff-scoped read does not replace the Periodicals.
test('the retirement line is dated in the place ledger, the notebook, the paper\'s evidence folder and the declaration', () => {
  for (const f of ['docs/plans/survey/place-ledger.md', 'docs/plans/survey.md', 'docs/papers/harbour/cleaner-than-it-started-evidence/README.md', 'docs/reviews/stability-measures/README.md']) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    assert.match(text, /12 Nov(?:ember)? 2026 \(LIN-4439\)/, `${f} dates the retirement`);
    assert.match(text, /the balance is the pre-merge `## Blind read`, counted by measure 1[\s\S]{0,200}?and the\shand-run pass stops/, `${f} says what replaces the pass`);
  }
  assert.match(DECLARATION, /does not replace the Periodicals[\s\S]*LIN-4253 read better in both hand-run blind passes, while Seams & Tangles run 8 rated/);
});
