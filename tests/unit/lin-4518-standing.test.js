/**
 * LIN-4518 (P5 of LIN-4513, plan-f77d6aea item 1): the record-side standing of a task (lib/records/standing.js).
 *
 * Witnesses over the real records store, the real verdict route and the real checked pipeline, with the head refresh
 * (P2) and the fake PR reader from the P3 witnesses. Each assertion names the record fact it reads, so a standing that
 * is right for the wrong reason does not pass.
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { refreshTaskChanges } from '../../lib/change-records.js';
import { readStandingRecords } from '../../lib/records/standing.js';
import { BLIND_READ_KIND } from '../../lib/prompts/blind-read-words.js';

const URL_KEY = 'lin-4518-workspace';
const TICKET = 'LIN-4518';
const REPO = 'acme/widget';
const T0 = '2026-11-21T10:00:00.000Z';
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

const harness = createMangoTmpdir('lin-4518-standing-');
before(() => harness.connect());
after(() => harness.close());

function status(number, { sha, merged = false }) {
  return {
    repo: REPO, number, readable: true,
    state: merged ? 'closed' : 'open', merged,
    head: { ref: `feat/pr-${number}`, sha }, ref: sha,
    created_at: T0, merged_at: merged ? T0 : null, checks: [],
  };
}

let rh;
let store;
let writes;
let taskId;
let tracker;
let prs;
let tokens;

beforeEach(async () => {
  prs = new Map();
  tracker = createFakeTracker({
    tickets: [{ identifier: TICKET, title: 'Slice 3 P5: standing', description: 'Asked.', state: { name: 'In Progress', type: 'started' }, parent: null }],
  });
  rh = await createRecordsRouteHarness({
    harness,
    urlKey: URL_KEY,
    tickets: new Map(),
    people: [],
    readTicket: tracker.readTicket,
    tracker: () => tracker.port,
    changePrReaderFor: () => readPrStatus,
  });
  store = rh.store;
  for (const [id, stage] of [['row-impl', 'implementation'], ['row-review', 'review'], ['row-blind', 'blind-read']]) {
    await store.openRun(URL_KEY, { id, stage, lineage: 'row-root', at: '2026-11-19T10:00:00.000Z' });
  }
  tokens = {
    impl: await rh.mintRunToken('row-impl'),
    review: await rh.mintRunToken('row-review'),
    blind: await rh.mintRunToken('row-blind'),
  };
  taskId = (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'Slice 3 P5.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
  writes = createRecordWrites({ recordsStore: store, isTerminalState });
});

afterEach(async () => {
  if (rh) await rh.close();
  rh = null;
});

const post = (token, body) => rh.post('/api/proxy/records', token, body);

async function addChange(n, sha) {
  prs.set(n, { sha, merged: false });
  const r = await post(tokens.impl, { kind: 'change', in: taskId, ref: prUrl(n), head: sha, run: 'row-impl' });
  assert.equal(r.status, 201, `the change write was refused: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

const readPrStatus = async ({ number }) => {
  const p = prs.get(number);
  return p ? status(number, { sha: p.sha, merged: p.merged }) : { readable: false };
};

const refresh = () => refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus });
const clock = (iso) => { store.now = () => new Date(iso); };

async function reviewOn(changeIds, heads) {
  const v = await post(tokens.review, {
    kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'read at the head named',
    on: changeIds, heads, run: 'row-review',
  });
  assert.equal(v.status, 201, `the review verdict was refused: ${JSON.stringify(v.body)}`);
  return v.body.id;
}

const standing = () => readStandingRecords({ recordsStore: store, urlKey: URL_KEY, taskId, judgements: { review: 'review', blindRead: BLIND_READ_KIND } });

describe('witness 1: a push after the review makes the review stale and counts as work after it', () => {
  test('the judge read H1; the PR moves to H2; the verdict stays on H1, shows stale, and work came after the review', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(101, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    prs.set(101, { sha: 'H2', merged: false });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    assert.ok(s.review, 'the review verdict is on record');
    assert.equal(s.review.outcome, 'approve');
    assert.equal(s.review.stale, true, 'a push the judge never saw must show the approval stale');
    assert.equal(s.reviewStale, true);
    assert.equal(s.workAfterReview, true, 'a stale approval is work after the review');
    assert.equal(s.landing.length, 1);
  });
});

describe('witness 2: no push after the review leaves it current', () => {
  test('the judge read the head the PR still has: not stale, no work after the review', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(102, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    assert.equal(s.review.stale, false, 'a refresh that finds the same head must not make the approval stale');
    assert.equal(s.workAfterReview, false);
  });
});

describe('witness 3: a merge after the review does not stale the approval', () => {
  test('the PR merges at the head the judge read: the approval is not stale', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(103, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    prs.set(103, { sha: 'H1', merged: true });
    clock('2026-11-21T11:40:00.000Z');
    await refresh();
    const s = await standing();
    assert.equal(s.review.stale, false, 'ending a change merged moves no fields, so it cannot stale an approval');
    assert.equal(s.workAfterReview, false);
  });
});

describe('witness 4: a new PR after the review is work; re-stating the reviewed PR is not', () => {
  test('a second PR first written after the review counts as work after it', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(104, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    clock('2026-11-21T11:10:00.000Z');
    await addChange(105, 'H9');
    const s = await standing();
    assert.equal(s.workAfterReview, true);
    assert.equal(s.review.stale, false, 'the new PR is not the reviewed change, so the review itself is not stale');
  });

  test('a second change record for the reviewed PR, written after the review, is not new work', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(106, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    clock('2026-11-21T11:10:00.000Z');
    // Written directly through the checked pipeline, so a second record for the same PR is certain to exist.
    const again = await writes.add({ urlKey: URL_KEY, kind: 'change', input: { in: taskId, ref: prUrl(106), head: 'H1' }, by: 'harbour', run: 'row-impl' });
    assert.equal(again.problems, undefined, `the second change was refused: ${JSON.stringify(again.problems)}`);
    const changes = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
    assert.equal(changes.length, 2, 'two change records name the one PR');
    const s = await standing();
    assert.equal(s.workAfterReview, false, 'the reviewed PR restated is not new work');
  });
});

describe('witness 5: close-out and blind-read standing read from records, after the review', () => {
  test('a close-out run ended after the review is seen; one ended before is not', async () => {
    clock('2026-11-21T10:30:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-early', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T10:20:00.000Z' });
    await store.endRun(URL_KEY, 'row-close-early', { state: 'done', at: '2026-11-21T10:25:00.000Z' });
    const c = await addChange(107, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    let s = await standing();
    assert.equal(s.closeOutAfterReview, false, 'a close-out that ended before the review is not after it');

    await store.openRun(URL_KEY, { id: 'row-close-late', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T11:20:00.000Z' });
    await store.endRun(URL_KEY, 'row-close-late', { state: 'done', at: '2026-11-21T11:25:00.000Z' });
    s = await standing();
    assert.equal(s.closeOutAfterReview, true);
  });

  test('a blind read written after the review is the blind read on record; none before it counts', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(108, 'H1');
    const b0 = await post(tokens.blind, { kind: 'verdict', judgement: 'blind-read', outcome: 'same', reasoning: 'early', on: [c], heads: { [c]: 'H1' }, run: 'row-blind' });
    assert.equal(b0.status, 201, `early blind read refused: ${JSON.stringify(b0.body)}`);
    let s = await standing();
    // With no review on record, the latest blind read stands (readTrail's latestBlindRead does the same).
    assert.equal(s.blindRead.outcome, 'same');
    await reviewOn([c], { [c]: 'H1' });
    s = await standing();
    assert.equal(s.blindRead, null, 'a blind read written before the review does not answer it');
    clock('2026-11-21T11:50:00.000Z');
    const b1 = await post(tokens.blind, { kind: 'verdict', judgement: 'blind-read', outcome: 'better', reasoning: 'late', on: [c], heads: { [c]: 'H1' }, run: 'row-blind' });
    assert.equal(b1.status, 201, `late blind read refused: ${JSON.stringify(b1.body)}`);
    s = await standing();
    assert.equal(s.blindRead.outcome, 'better');
  });
});

describe('witness 6: a task with no review has no review standing', () => {
  test('no verdict: review is null, nothing is stale, no work after', async () => {
    await addChange(109, 'H1');
    const s = await standing();
    assert.equal(s.review, null);
    assert.equal(s.reviewStale, false);
    assert.equal(s.workAfterReview, false);
    assert.equal(s.closeOutAfterReview, false);
  });
});
