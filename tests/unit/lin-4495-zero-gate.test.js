/**
 * LIN-4495 (piece 4 of LIN-4491): the zero-gate witness. A task with one open finding to close-out is NOT ready
 * to close, the decision says why, and ending the finding clears readiness. Every reading that is not "read with
 * none open" holds the gate too (not-read, including a ticket with no task record): none reads as zero.
 *
 * Runs on a real MangoDB engine (tests/fixtures/mango-tmpdir.js) through the records store. The ready trail is seeded
 * as the records a stage writes (tests/helpers/records-scenario.js), the trail is read the way the gate reads it
 * (trailForTicket, lib/task-standing.js), and the finding reading is the one the gate uses (lib/close-out-findings.js).
 *
 * LIN-4520: the trail is a records trail; no comment is read for a verdict, a ledger or a blind read.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4495-zero-gate.test.js
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { trailForTicket } from '../../lib/task-standing.js';
import { closeOutDecision, CLOSE_OUT_REASON, CLOSE_OUT_STATUS } from '../../lib/run-closeout-state.js';
import { readOpenFindings, findingsRead, findingsNotRead, findingsHold, findingsCopy, FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { seedTicketRecords, ev } from '../helpers/records-scenario.js';

const URL_KEY = 'zero-gate-workspace';
const REPO = 'acme/widget';
const PR1 = `https://github.com/${REPO}/pull/41`;
const REVIEWED = 'aaaaaaa1111111';
const T0 = '2026-11-19T10:00:00.000Z';
const TICKET = 'LIN-9001';

// A ready task: the landing is PR1 at the reviewed head, the review approves it with no open findings, and a blind
// read names PR1 after the review.
const READY = [ev.pr(1, PR1, REVIEWED), ev.review(2, PR1), ev.read(3, PR1)];
const openPr = { readable: true, repo: REPO, number: 41, state: 'open', merged: false, head: { ref: 'f', sha: REVIEWED }, ref: REVIEWED, checks: [] };
const statuses = new Map([[PR1, openPr]]);

const harness = createMangoTmpdir('lin-4495-zero-gate-');
let store;

const seed = (events = READY) => seedTicketRecords(store, URL_KEY, TICKET, events);
const trailNow = (ticket = TICKET) => trailForTicket({ recordsStore: store, urlKey: URL_KEY, ticket });
function decide(trail, openFindings, prStatuses = statuses, actor = 'harbour') {
  return closeOutDecision({ trail, prStatuses, stopAt: 'pr', runnerReady: true, actor, openFindings });
}

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  const db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({
    records: db.collection(RECORDS_COLLECTION),
    refs: db.collection(REFS_COLLECTION),
    queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => new Date(T0),
  });
});

describe('zero-gate: the decision reads the finding reading', () => {
  test('a ready trail with no open findings to close-out is ready', async () => {
    await seed();
    const d = decide(await trailNow(), FINDINGS_NONE);
    assert.equal(d.status, CLOSE_OUT_STATUS.READY);
    assert.equal(d.reason, null);
  });

  test('one open finding to close-out is not ready, and the decision says why', async () => {
    await seed();
    const d = decide(await trailNow(), findingsRead(['finding-aaaaaaaa']));
    assert.equal(d.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.equal(d.reason, CLOSE_OUT_REASON.OPEN_FINDINGS);
    assert.match(d.message, /1 open finding to close-out/);
    // Readiness is held, but the dispatch is not refused: close-out is the stage that ends the finding (LIN-4495 review).
    assert.equal(d.refuses, null);
  });

  test('an open finding holds Done even on a merged landing; ending it lets the person\'s check set Done', async () => {
    await seed();
    const trail = await trailNow();
    const merged = new Map([[PR1, { ...openPr, state: 'closed', merged: true }]]);
    const withMerged = (open) => decide(trail, open, merged, 'person');
    assert.equal(withMerged(findingsRead(['finding-aaaaaaaa'])).setDone, false);
    assert.equal(withMerged(findingsNotRead('store down')).setDone, false);
    assert.equal(withMerged(FINDINGS_NONE).setDone, true);
  });

  test('a finding not read is not ready: never a zero', async () => {
    await seed();
    const d = decide(await trailNow(), findingsNotRead('store down'));
    assert.equal(d.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.equal(d.reason, CLOSE_OUT_REASON.OPEN_FINDINGS);
    assert.match(d.message, /not read/);
  });

  test('the paired case: a ready trail whose findings are not read (no task record for the ticket) still holds, never a zero', async () => {
    await seed();
    const d = decide(await trailNow(), findingsNotRead('no task record for the ticket'));
    assert.equal(d.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.equal(d.reason, CLOSE_OUT_REASON.OPEN_FINDINGS);
  });

  test('the decision refuses to decide without a reading (no silent default)', async () => {
    await seed();
    const trail = await trailNow();
    assert.throws(() => decide(trail, undefined), /openFindings/);
  });

  test('the copy names the two readings and never reads a hold as zero', () => {
    assert.equal(findingsCopy(findingsRead([])), 'no open findings to close-out');
    assert.match(findingsCopy(findingsNotRead('x')), /not read/);
    assert.equal(findingsHold(findingsRead([])), false);
    assert.equal(findingsHold(findingsNotRead('x')), true);
  });
});

describe('zero-gate: the records store is the source of the reading', () => {
  test('an open finding to close-out on the task holds the gate; ending it clears readiness', async () => {
    await seed([...READY, ev.finding(5, 'The footer count is off.', 'a repro')]);

    const open = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(open.state, 'read');
    assert.equal(open.count, 1);
    assert.equal(open.ids.length, 1);
    assert.equal(decide(await trailNow(), open).reason, CLOSE_OUT_REASON.OPEN_FINDINGS);

    await store.end(URL_KEY, open.ids[0], { state: 'done', reason: 'the footer was fixed' }, { by: 'close-out', at: '2026-11-12T09:00:00.000Z' });

    const after = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(after.count, 0);
    assert.equal(decide(await trailNow(), after).status, CLOSE_OUT_STATUS.READY);
  });

  // LIN-4527: a ticket with no task record is not read, never "none open": the store cannot tell "never had a task"
  // from "the lookup missed it".
  test('a task with no record is not read (never none open), and a finding to another reader does not count', async () => {
    const none = await readOpenFindings({ store, urlKey: URL_KEY, ticket: 'LIN-9999' });
    assert.equal(none.state, 'not-read');
    assert.equal(none.count, null);
    assert.equal(none.why, 'no task record for the ticket');
    assert.equal(findingsHold(none), true);

    const { taskId } = await seed([]);
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'For the project.' }, links: {}, in: taskId, to: 'project' }, { by: 'review', run: null, at: '2026-11-12T09:00:00.000Z' });
    const r = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(r.state, 'read');
    assert.equal(r.count, 0);
  });

  // LIN-4527: the person's merge reads the same gate. A merged, approved landing whose ticket has no task record is not Done.
  test('a person-merged, approved landing with no task record reads not-read: setDone is false, and a read of zero sets it', async () => {
    await seed();
    const trail = await trailNow();
    const merged = new Map([[PR1, { ...openPr, state: 'closed', merged: true }]]);
    const decideMerged = (open) => decide(trail, open, merged, 'person');
    const untasked = await readOpenFindings({ store, urlKey: URL_KEY, ticket: 'LIN-9998' });
    assert.equal(decideMerged(untasked).setDone, false);
    const read0 = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(read0.count, 0);
    assert.equal(decideMerged(read0).setDone, true);
  });

  test('a store that throws is not-read, never a zero', async () => {
    const broken = { taskForTicket: async () => { throw new Error('db down'); } };
    const r = await readOpenFindings({ store: broken, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(r.state, 'not-read');
    assert.equal(r.count, null);
    assert.equal(findingsHold(r), true);
    assert.equal((await readOpenFindings({ store: null, urlKey: URL_KEY, ticket: TICKET })).state, 'not-read');
  });
});
