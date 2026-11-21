/**
 * LIN-4517 (slice 3 P4): the read-only cutover query (docs/reviews/slice-3-readings/cutover-query.mjs) on a real
 * MangoDB records store and stand-in tickets. The dump is read from the store as the container step reads it; the
 * tickets are read through a stand-in proxy as the local step reads them; the comments are classified with today's
 * readers (lib/run-trail.js, lib/close-out-findings.js).
 *
 * Seeds, one ticket each:
 *   LIN-1  open, a review comment, ledger "None."                      → comment-only (review)
 *   LIN-2  open, a review comment whose ledger lists items             → comment-only and legacy ledger
 *   LIN-3  open, a ledger listing bold-led items that isEmptyStatement
 *          reads as empty ("no open questions" inside an item; LIN-2634's shape)                  → comment-only and read-as-empty-with-items
 *   LIN-4  open, a review comment and a review verdict record after it,
 *          on a change of the task                                     → has a verdict record; not comment-only
 *   LIN-5  completed ticket, a review comment only                     → excluded
 *   LIN-6  open, a plan-review comment and a blind read                → comment-only (plan-review, blind-read)
 *   LIN-7  open, no comments                                           → no verdict record, never judged
 *   LIN-8  open, a review verdict record, then a later review comment  → comment-only (the record is older)
 *   LIN-9  task record ended done, ticket open                         → excluded (not an open task)
 *   LIN-10 open task record, ticket not listed (deleted)               → excluded
 *   LIN-11 open, a review comment, then a plan-review comment, then an
 *          imported plan-review verdict record (by: import, its stage in
 *          its judgement) after both                                   → comment-only (review); plan-review covered
 *   (no ticket) one open task with no ref                              → counted apart
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { commentKindOf } from '../../lib/run-trail.js';
import { parseRunLedger } from '../../lib/run-ledger.js';
import {
  dumpFromStore, cutoverReading, readTickets, loadReaders, ledgerItemLines, stageOfVerdict,
} from '../../docs/reviews/slice-3-readings/cutover-query.mjs';

const URL_KEY = 'lin-4517-cutover';
const harness = createMangoTmpdir('lin-4517-cutover-');
const BASE = Date.UTC(2026, 10, 21, 12, 0);
const iso = (minutes) => new Date(BASE + minutes * 60000).toISOString();
const shape = (kind, fields = {}, extra = {}) => ({ kind, state: 'open', fields, links: {}, ...extra });
const PR = 'https://github.com/example/repo/pull/1';

const review = (verdict, ledger) => `## Code Review: the change\n\n**Verdict: ${verdict}**\n\nCI: green.\n\n### What CI Did Not Prove\n\n${ledger}\n`;
const planReview = '## Plan Review Verdict\n\n**Verdict: Request changes**\n\nThe plan leaves out the migration.';
const blindRead = `## Blind read\n\nVerdict: better, the change reads clearly and holds up\n\n${PR}`;
const LEDGER_NONE = 'None.';
const LEDGER_ITEMS = '- The migration was not run against a production-sized store.\n- The page was not checked on a phone.';
// The shape seen on a live task (LIN-2634, 21 Nov): bold-led items, not bullets, one of which says "no open".
const LEDGER_MISREAD = '**Import — checked by hand on staging; no open questions about its ids.**\n\n**Rollback — not exercised.**\n\n**Ledger status: no item is a close-out gate.**';

const comment = (id, body, minutes) => ({ id, body, createdAt: iso(minutes) });

let store;
let dump;
let tickets;
let reading;

async function seed() {
  const db = harness.freshDb();
  store = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  const task = async (ref) => (await store.add(URL_KEY, shape('task', { ...(ref ? { ref } : {}), asked: `Task ${ref}.` }), { by: 'import', at: iso(-1000) })).id;
  const ids = {};
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) ids[n] = await task(`LIN-${n}`);
  ids.none = await task(null);
  await store.end(URL_KEY, ids[9], { state: 'done', reason: 'landed' }, { by: 'close-out', at: iso(-500) });
  // LIN-4: a change, and a review verdict on it written 5 minutes after the review comment.
  const change = await store.add(URL_KEY, shape('change', { ref: PR, head: 'abc1234' }, { in: ids[4] }), { by: 'implementation', at: iso(-300) });
  await store.add(URL_KEY, shape('verdict', { judgement: 'review', outcome: 'approve', reasoning: 'Read it.' }, { state: 'stands', links: { on: [`${change.id}@1`] } }), { by: 'review', at: iso(-95) });
  // LIN-8: a review verdict record 3 hours before the latest review comment.
  await store.add(URL_KEY, shape('verdict', { judgement: 'review', outcome: 'approve', reasoning: 'Read it.' }, { state: 'stands', in: ids[8], links: { on: [`${ids[8]}@1`] } }), { by: 'review', at: iso(-280) });
  // LIN-11: an imported plan-review verdict, written after both of the ticket's comments. Its writer is `import`, so
  // only its judgement says which stage it covers; it must not cover the review.
  await store.add(URL_KEY, shape('verdict', { judgement: 'plan-review', outcome: 'request-changes', reasoning: 'Imported.' }, { state: 'stands', in: ids[11], links: { on: [`${ids[11]}@1`] } }), { by: 'import', via: 'import', at: iso(-40) });
  return ids;
}

/** The stand-in proxy: the issue list in two pages, and each issue's detail. */
function standInProxy(issues) {
  const calls = [];
  const fetchImpl = async (url) => {
    const path = url.replace('http://proxy.test/api/proxy', '');
    calls.push(path);
    const json = (body) => ({ ok: true, status: 200, headers: new Map(), json: async () => body });
    if (path.startsWith('/issues?')) {
      const listed = [...issues.values()].filter((i) => !i.unlisted);
      const second = path.includes('after=page-2');
      const half = Math.ceil(listed.length / 2);
      const page = second ? listed.slice(half) : listed.slice(0, half);
      return json({ issues: page.map((i) => ({ identifier: i.identifier, state: { type: i.state } })), pageInfo: { hasNextPage: !second, endCursor: second ? null : 'page-2' } });
    }
    const ref = decodeURIComponent(path.slice('/issues/'.length));
    const issue = issues.get(ref);
    return json({ identifier: ref, state: { type: issue.state }, trashed: false, comments: issue.comments });
  };
  return { fetchImpl, calls };
}

const issueMap = () => new Map([
  ['LIN-1', { state: 'started', comments: [comment('c1', review('Approve', LEDGER_NONE), -100)] }],
  ['LIN-2', { state: 'started', comments: [comment('c2', review('Request changes', LEDGER_ITEMS), -100)] }],
  ['LIN-3', { state: 'unstarted', comments: [comment('c3', review('Approve', LEDGER_MISREAD), -100)] }],
  ['LIN-4', { state: 'started', comments: [comment('c4', review('Approve', LEDGER_NONE), -100)] }],
  ['LIN-5', { state: 'completed', comments: [comment('c5', review('Approve', LEDGER_NONE), -100)] }],
  ['LIN-6', { state: 'started', comments: [comment('c6a', planReview, -200), comment('c6b', blindRead, -50)] }],
  ['LIN-7', { state: 'backlog', comments: [] }],
  ['LIN-8', { state: 'started', comments: [comment('c8', review('Request changes', LEDGER_NONE), -100)] }],
  ['LIN-9', { state: 'started', comments: [comment('c9', review('Approve', LEDGER_NONE), -100)] }],
  ['LIN-10', { state: 'started', unlisted: true, comments: [comment('c10', review('Approve', LEDGER_NONE), -100)] }],
  ['LIN-11', { state: 'started', comments: [comment('c11a', review('Approve', LEDGER_NONE), -100), comment('c11b', planReview, -60)] }],
].map(([identifier, i]) => [identifier, { identifier, ...i }]));

let ids;
let proxyCalls;
let loadedReaders;

before(async () => {
  await harness.connect();
  ids = await seed();
  dump = await dumpFromStore({ store, urlKey: URL_KEY, asOf: iso(0) });
  const proxy = standInProxy(issueMap());
  tickets = await readTickets({ base: 'http://proxy.test/api/proxy', dump, fetchImpl: proxy.fetchImpl });
  proxyCalls = proxy.calls;
  loadedReaders = await loadReaders();
  reading = cutoverReading({ dump, tickets, readers: loadedReaders });
});
after(() => harness.close());

const ticketsOf = (rows) => rows.map((r) => r.ticket);

describe('LIN-4517 cutover query: the fixtures classify as intended', () => {
  test('each seed comment is the kind it stands for, under today\'s classifier', () => {
    assert.equal(commentKindOf(review('Approve', LEDGER_NONE)), 'review');
    assert.equal(commentKindOf(planReview), 'plan-review');
    assert.equal(commentKindOf(blindRead), 'blind-read');
  });

  test('the misread ledger is the isEmptyStatement defect: read as empty, though it lists items', () => {
    const misread = parseRunLedger({ body: review('Approve', LEDGER_MISREAD) }).ledger;
    assert.equal(misread.empty, true);
    assert.equal(ledgerItemLines(misread.raw).length, 2);
    assert.equal(parseRunLedger({ body: review('Approve', LEDGER_ITEMS) }).ledger.empty, false);
    assert.deepEqual(ledgerItemLines('- None.\n- (none)'), []);
    assert.equal(ledgerItemLines('- One.\n2. Two.').length, 2);
    assert.deepEqual(ledgerItemLines('**Ledger status: no item is a close-out gate.**'), [], 'a line about the ledger is not an item');
  });
});

describe('LIN-4517 cutover query: the dump', () => {
  test('holds the open task records only, every verdict with its first write time, and the changes\' tasks', () => {
    assert.equal(dump.tasks.length, 11);
    assert.ok(!dump.tasks.some((t) => t.id === ids[9]));
    assert.equal(dump.verdicts.length, 3);
    assert.ok(dump.verdicts.every((v) => v.at));
    assert.deepEqual(dump.verdicts.map((v) => [v.by, v.judgement, v.via]).sort(), [['import', 'plan-review', 'import'], ['review', 'review', null], ['review', 'review', null]]);
    assert.equal(dump.changes.length, 1);
    assert.equal(dump.changes[0].in, ids[4]);
    assert.equal(dump.changes[0].ref, PR);
    assert.deepEqual(dump.plans, []);
  });

  test('the tickets are paged whole, and comments are read only for open tickets with an open task', () => {
    assert.equal(proxyCalls.filter((p) => p.startsWith('/issues?')).length, 2);
    const detail = proxyCalls.filter((p) => !p.startsWith('/issues?')).map((p) => p.slice('/issues/'.length)).sort();
    assert.deepEqual(detail, ['LIN-1', 'LIN-11', 'LIN-2', 'LIN-3', 'LIN-4', 'LIN-6', 'LIN-7', 'LIN-8']);
  });
});

describe('LIN-4517 cutover query: the reading', () => {
  test('the window: closed, unlisted, ended and ticketless tasks are not open', () => {
    assert.deepEqual(reading.window, { openTaskRecords: 11, noTicket: 1, ticketClosed: 1, ticketNotListed: 1, open: 8 });
    assert.deepEqual(reading.noTicketTasks, { count: 1, withVerdictRecord: 0, tasks: [ids.none] });
  });

  test('comment-only: the latest verdict of a stage is a comment with no record at or after it', () => {
    assert.deepEqual(ticketsOf(reading.commentOnly.tasks), ['LIN-1', 'LIN-11', 'LIN-2', 'LIN-3', 'LIN-6', 'LIN-8']);
    assert.deepEqual(reading.commentOnly.byStage, { review: 5, 'plan-review': 1, 'blind-read': 1 });
    const six = reading.commentOnly.tasks.find((r) => r.ticket === 'LIN-6');
    assert.deepEqual(six.stages.map((s) => [s.stage, s.verdict]), [['plan-review', 'request changes'], ['blind-read', 'better']]);
  });

  test('a record written after the comment covers it; one older than the comment does not', () => {
    assert.ok(!ticketsOf(reading.commentOnly.tasks).includes('LIN-4'));
    assert.ok(ticketsOf(reading.commentOnly.tasks).includes('LIN-8'));
    assert.deepEqual(ticketsOf(reading.withVerdictRecord.tasks), ['LIN-11', 'LIN-4', 'LIN-8']);
  });

  test('a record covers only its own stage, read from its judgement: an imported plan review covers no review (LIN-11)', () => {
    const eleven = reading.commentOnly.tasks.find((r) => r.ticket === 'LIN-11');
    assert.deepEqual(eleven.stages.map((s) => s.stage), ['review'], 'the plan review is covered and the review is not');
    assert.equal(stageOfVerdict({ by: 'import', judgement: 'plan-review' }), 'plan-review');
    assert.equal(stageOfVerdict({ by: 'review', judgement: null }), 'review', 'a dump without judgements falls back to the writer');
    assert.equal(stageOfVerdict({ by: 'import', judgement: null }), null);
  });

  test('a dump taken before judgements were carried reads the same for records whose writer is their stage', () => {
    const old = { ...dump, verdicts: dump.verdicts.filter((v) => v.by !== 'import').map(({ judgement, ...v }) => v) };
    const without = cutoverReading({ dump: old, tickets, readers: loadedReaders });
    assert.deepEqual(ticketsOf(without.withVerdictRecord.tasks), ['LIN-4', 'LIN-8']);
    assert.ok(!ticketsOf(without.commentOnly.tasks).includes('LIN-4'));
  });

  test('the ledgers: a legacy one, and one the heuristic reads as empty although it lists items', () => {
    assert.deepEqual(ticketsOf(reading.legacyLedger.tasks), ['LIN-2']);
    assert.deepEqual(ticketsOf(reading.ledgerReadEmptyWithItems.tasks), ['LIN-3']);
  });

  test('needs an import or a re-review: the union, each task once', () => {
    assert.equal(reading.needsImportOrReReview.count, 6);
    assert.deepEqual(ticketsOf(reading.needsImportOrReReview.tasks), ['LIN-1', 'LIN-11', 'LIN-2', 'LIN-3', 'LIN-6', 'LIN-8']);
    assert.deepEqual(reading.needsImportOrReReview.tasks.find((r) => r.ticket === 'LIN-1'), { task: ids[1], ticket: 'LIN-1' });
  });

  test('no verdict record at all: split into judged by comment only and never judged', () => {
    assert.deepEqual(reading.noVerdictRecord, { count: 5, neverJudged: 1, judgedByCommentOnly: 4 });
    assert.equal(reading.importMarkedVerdicts, 1);
  });

  test('prints counts and ids only: no comment text and no PR URL reaches the output', () => {
    const out = JSON.stringify(reading);
    assert.ok(!out.includes('github.com'));
    assert.ok(!out.includes('What CI Did Not Prove'));
    assert.ok(!out.includes('migration'));
  });
});
