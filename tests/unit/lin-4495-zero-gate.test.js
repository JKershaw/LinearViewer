/**
 * LIN-4495 (piece 4 of LIN-4491): the zero-gate witness. A task with one open finding to close-out is NOT ready
 * to close, the decision says why, and ending the finding clears readiness. Every reading that is not "read with
 * none open" holds the gate too (not-read, including a ticket with no task record): none reads as zero.
 *
 * Runs on a real MangoDB engine (tests/fixtures/mango-tmpdir.js) through the records store, so the finding is a
 * record written the way an agent writes one, and the reading is the one the gate uses (lib/close-out-findings.js).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4495-zero-gate.test.js
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { readTrail } from '../../lib/run-trail.js';
import { closeOutDecision, CLOSE_OUT_REASON, CLOSE_OUT_STATUS } from '../../lib/run-closeout-state.js';
import { readOpenFindings, findingsRead, findingsNotRead, findingsHold, findingsCopy, FINDINGS_NONE } from '../../lib/close-out-findings.js';

const URL_KEY = 'zero-gate-workspace';
const REPO = 'acme/widget';
const PR1 = `https://github.com/${REPO}/pull/41`;
const REVIEWED = 'aaaaaaa1111111';
const T0 = '2026-11-19T10:00:00.000Z';
const at = (minute) => new Date(Date.UTC(2026, 10, 19, 10, minute)).toISOString();
const TICKET = 'LIN-9001';
const ticket = { identifier: TICKET, title: 'A task', closed: false };

// A ready trail: the landing is PR1, the review approves it with no ledger items (an explicitly empty ledger),
// and a blind read names PR1 after the review.
const c = (n, body) => ({ id: `c${n}`, body, createdAt: at(n), user: 'agent' });
const TRAIL = [
  c(1, `Implementation done: ${PR1}, CI green.`),
  c(2, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${PR1}.\n\n### What CI Did Not Prove\nNone: green CI covers the deliverable.\n\n**Verdict: Approve**`),
  c(3, `## Blind read\nVerdict: same. It left nothing worse.\n\nRead: ${PR1} at \`${REVIEWED.slice(0, 9)}\` against \`000000000\`.\n\n### Inside the area, fix-sized\nNone.`),
];
const openPr = { readable: true, repo: REPO, number: 41, state: 'open', merged: false, head: { ref: 'f', sha: REVIEWED }, ref: REVIEWED, checks: [] };
const statuses = new Map([[PR1, openPr]]);

function decide(openFindings, comments = TRAIL) {
  const trail = readTrail(comments);
  return closeOutDecision({ trail, prStatuses: statuses, stopAt: 'pr', runnerReady: true, actor: 'harbour', openFindings });
}

const harness = createMangoTmpdir('lin-4495-zero-gate-');
let db;
let store;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
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
  test('a ready trail with no open findings to close-out is ready', () => {
    const d = decide(FINDINGS_NONE);
    assert.equal(d.status, CLOSE_OUT_STATUS.READY);
    assert.equal(d.reason, null);
  });

  test('one open finding to close-out is not ready, and the decision says why', () => {
    const d = decide(findingsRead(['finding-aaaaaaaa']));
    assert.equal(d.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.equal(d.reason, CLOSE_OUT_REASON.OPEN_FINDINGS);
    assert.match(d.message, /1 open finding to close-out/);
    // Readiness is held, but the dispatch is not refused: close-out is the stage that ends the finding (LIN-4495 review).
    assert.equal(d.refuses, null);
  });

  test('an open finding holds Done even on a merged landing; ending it lets the person\'s check set Done', () => {
    const merged = new Map([[PR1, { ...openPr, state: 'closed', merged: true }]]);
    const withMerged = (open) => closeOutDecision({ trail: readTrail(TRAIL), prStatuses: merged, stopAt: 'pr', runnerReady: true, actor: 'person', openFindings: open });
    assert.equal(withMerged(findingsRead(['finding-aaaaaaaa'])).setDone, false);
    assert.equal(withMerged(findingsNotRead('store down')).setDone, false);
    assert.equal(withMerged(FINDINGS_NONE).setDone, true);
  });

  test('a finding not read is not ready: never a zero', () => {
    const d = decide(findingsNotRead('store down'));
    assert.equal(d.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.equal(d.reason, CLOSE_OUT_REASON.OPEN_FINDINGS);
    assert.match(d.message, /not read/);
  });

  // LIN-4527: the legacy-ledger hold is gone. A review that still carries a non-empty old `### What CI Did Not Prove`
  // section is read as the records say: with no open finding to close-out, the task is none open and is ready.
  // This is the guard loosening, written as intended: the section is text the gate no longer parses.
  const LEGACY_LEDGER_REVIEW = [
    c(1, `Implementation done: ${PR1}, CI green.`),
    c(2, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${PR1}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: Approve**`),
    c(3, TRAIL[2].body),
  ];
  test('a pre-cutover review with a non-empty old ledger section, and no open finding to close-out, is ready (the old section is no longer read)', () => {
    const trail = readTrail(LEGACY_LEDGER_REVIEW);
    assert.equal(trail.review.ledger.present, true, 'the section is still visible to the Slice 3 tooling');
    const d = closeOutDecision({ trail, prStatuses: statuses, stopAt: 'pr', runnerReady: true, actor: 'harbour', openFindings: FINDINGS_NONE });
    assert.equal(d.status, CLOSE_OUT_STATUS.READY);
    assert.equal(d.reason, null);
  });

  test('the paired case: the same review on a task whose findings are not read still holds, never a zero', () => {
    const trail = readTrail(LEGACY_LEDGER_REVIEW);
    const d = closeOutDecision({ trail, prStatuses: statuses, stopAt: 'pr', runnerReady: true, actor: 'harbour', openFindings: findingsNotRead('no task record for the ticket') });
    assert.equal(d.status, CLOSE_OUT_STATUS.NOT_READY);
    assert.equal(d.reason, CLOSE_OUT_REASON.OPEN_FINDINGS);
  });

  test('the decision refuses to decide without a reading (no silent default)', () => {
    assert.throws(() => decide(undefined), /openFindings/);
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
    const task = await store.ensureTask(URL_KEY, ticket, { by: 'Harbour', at: at(1) });
    const finding = await store.add(URL_KEY, {
      kind: 'finding', state: 'open', fields: { says: 'The footer count is off.', how: 'a repro' }, links: {}, in: task.id, to: 'close-out',
    }, { by: 'review', run: null, at: at(4) });

    const open = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(open.state, 'read');
    assert.equal(open.count, 1);
    assert.deepEqual(open.ids, [finding.id]);
    assert.equal(decide(open).reason, CLOSE_OUT_REASON.OPEN_FINDINGS);

    await store.end(URL_KEY, finding.id, { state: 'done', reason: 'the footer was fixed' }, { by: 'close-out', at: at(9) });

    const after = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(after.count, 0);
    assert.equal(decide(after).status, CLOSE_OUT_STATUS.READY);
  });

  // LIN-4527: a ticket with no task record is not read, never "none open": the store cannot tell "never had a task"
  // from "the lookup missed it".
  test('a task with no record is not read (never none open), and a finding to another reader does not count', async () => {
    const none = await readOpenFindings({ store, urlKey: URL_KEY, ticket: 'LIN-9999' });
    assert.equal(none.state, 'not-read');
    assert.equal(none.count, null);
    assert.equal(none.why, 'no task record for the ticket');
    assert.equal(findingsHold(none), true);
    const task = await store.ensureTask(URL_KEY, ticket, { by: 'Harbour', at: at(1) });
    await store.add(URL_KEY, { kind: 'finding', state: 'open', fields: { says: 'For the project.' }, links: {}, in: task.id, to: 'project' }, { by: 'review', run: null, at: at(4) });
    const r = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(r.state, 'read');
    assert.equal(r.count, 0);
  });

  // LIN-4527: the person's merge reads the same gate. A merged, approved landing whose task has no record is not Done.
  test('a person-merged, approved landing with no task record reads not-read: setDone is false, and a read of zero sets it', async () => {
    const merged = new Map([[PR1, { ...openPr, state: 'closed', merged: true }]]);
    const decideMerged = (open) => closeOutDecision({ trail: readTrail(TRAIL), prStatuses: merged, stopAt: 'pr', runnerReady: true, actor: 'person', openFindings: open });
    const untasked = await readOpenFindings({ store, urlKey: URL_KEY, ticket: 'LIN-9998' });
    assert.equal(decideMerged(untasked).setDone, false);
    await store.ensureTask(URL_KEY, ticket, { by: 'Harbour', at: at(1) });
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
