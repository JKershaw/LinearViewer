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
import { readStandingRecords, trailOfStanding } from '../../lib/records/standing.js';
import { readLanding } from '../../lib/records/landing.js';
import { BLIND_READ_KIND } from '../../lib/prompts/blind-read-words.js';
import { standingForTicket, setStandingPrReaderFor } from '../../lib/task-standing.js';

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

describe('witness 5: close-out after the review, and the blind read on record, read from records', () => {
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

  test('the latest blind read on record is the blind read on record, wherever it falls against the review (LIN-4544)', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(108, 'H1');
    const b0 = await post(tokens.blind, { kind: 'verdict', judgement: 'blind-read', outcome: 'same', reasoning: 'early', on: [c], heads: { [c]: 'H1' }, run: 'row-blind' });
    assert.equal(b0.status, 201, `early blind read refused: ${JSON.stringify(b0.body)}`);
    let s = await standing();
    // With no review on record, the latest blind read stands (readTrail's latestBlindRead does the same).
    assert.equal(s.blindRead.outcome, 'same');
    await reviewOn([c], { [c]: 'H1' });
    s = await standing();
    assert.equal(s.blindRead.outcome, 'same', 'a read on record stands through a later review: one read per change');
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

describe('witness 7 (finding 4c23d02b): closeOutOnTrail on records is a close-out on this landing\'s round, not any close-out', () => {
  test('a close-out that ended before the review cut this round: not on the trail; one after the review is on it', async () => {
    clock('2026-11-21T10:30:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-cut', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T10:20:00.000Z' });
    await store.endRun(URL_KEY, 'row-close-cut', { state: 'done', at: '2026-11-21T10:25:00.000Z' });
    const c = await addChange(110, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    let s = await standing();
    assert.equal(s.closeOutOnTrail, false, 'the close-out ended before the round was cut: it is the previous round\'s, not this landing\'s');
    assert.equal(s.closeOutAfterReview, false);

    clock('2026-11-21T11:30:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-on', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T11:20:00.000Z' });
    await store.endRun(URL_KEY, 'row-close-on', { state: 'done', at: '2026-11-21T11:25:00.000Z' });
    s = await standing();
    assert.equal(s.closeOutOnTrail, true, 'a close-out ended after the review is on this landing\'s trail');
    assert.equal(s.closeOutAfterReview, true);
  });
});

describe('witness 8 (finding d99d9922): the standing read refreshes change heads first, so a push after a verdict is stale with no later verdict write', () => {
  beforeEach(() => setStandingPrReaderFor(() => readPrStatus));
  afterEach(() => setStandingPrReaderFor(null));

  test('the PR moves after the approval; standingForTicket alone (no refresh call, no verdict write) shows the approval stale and the change at the new head', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(111, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    prs.set(111, { sha: 'H2', merged: false });
    clock('2026-11-21T11:30:00.000Z');
    const s = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.ok(s, 'the standing was read');
    assert.equal(s.review.stale, true, 'a push the judge never saw must show the approval stale on the read itself');
    assert.equal(s.workAfterReview, true);
    const [change] = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
    assert.equal(change.fields.head, 'H2', 'the read refreshed the change to the PR\'s head before it read');
  });

  test('the same state with no PR reader wired: the read does not refresh, so the approval still reads current (the refresh is what makes it stale)', async () => {
    setStandingPrReaderFor(null);
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(112, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    prs.set(112, { sha: 'H2', merged: false });
    clock('2026-11-21T11:30:00.000Z');
    const s = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(s.review.stale, false, 'without the refresh, the stale flag cannot see the moved head');
    assert.equal(s.workAfterReview, false);
  });

  test('an unreadable PR fails open: the standing is still read, and the change keeps the head it had', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(113, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    prs.delete(113);
    clock('2026-11-21T11:30:00.000Z');
    const s = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: TICKET });
    assert.ok(s, 'an unreadable PR does not refuse the standing read');
    assert.equal(s.review.stale, false);
    const [change] = await store.find(URL_KEY, { kind: 'change', inRef: taskId });
    assert.equal(change.fields.head, 'H1');
  });
});

describe('witness 9: a ticket with no task, or no store, is the empty standing or not read', () => {
  test('a ticket that has no task on record reads as the empty standing: no review, no landing', async () => {
    const s = await standingForTicket({ recordsStore: store, urlKey: URL_KEY, ticket: 'LIN-9999' });
    assert.ok(s, 'an empty ticket is read, not unread');
    assert.equal(s.review, null);
    assert.deepEqual(s.landing, []);
    assert.equal(s.workAfterReview, false);
  });

  test('no records store is "not read" (null), so a caller can tell it from an empty ticket', async () => {
    assert.equal(await standingForTicket({ recordsStore: null, urlKey: URL_KEY, ticket: TICKET }), null);
  });
});

describe('witness 10 (finding d115ccd8): staleness and judged heads are per PR on a two-PR landing', () => {
  test('one review on two PRs; only the PR whose head moved is named stale, and the heads are per PR', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const a = await addChange(201, 'A1');
    const b = await addChange(202, 'B1');
    await reviewOn([a, b], { [a]: 'A1', [b]: 'B1' });
    prs.set(202, { sha: 'B2', merged: false });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    assert.equal(s.review.stale, true);
    assert.deepEqual(s.review.staleUrls, [prUrl(202)], 'exactly the PR that moved is named; the unmoved PR is not');
    assert.equal(s.review.sha, null, 'a two-PR review has no single judged head');
    assert.deepEqual(s.review.heads, { [prUrl(201)]: 'A1', [prUrl(202)]: 'B1' }, 'each PR carries the head its pinned version held');
  });

  test('one review on two PRs with no move: no stale URLs, not stale', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const a = await addChange(203, 'A1');
    const b = await addChange(204, 'B1');
    await reviewOn([a, b], { [a]: 'A1', [b]: 'B1' });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    assert.equal(s.review.stale, false);
    assert.deepEqual(s.review.staleUrls, []);
  });

  test('stored staleness and live movement are independent: a live head move is seen only once it is refreshed into a version', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const a = await addChange(205, 'A1');
    const b = await addChange(206, 'B1');
    await reviewOn([a, b], { [a]: 'A1', [b]: 'B1' });
    // The PR moved on GitHub, but no refresh has written it: the stored record still says A1.
    prs.set(205, { sha: 'A2', merged: false });
    let s = await standing();
    assert.deepEqual(s.review.staleUrls, [], 'the stored records have not seen the live move yet');
    assert.equal(s.review.stale, false);
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    s = await standing();
    assert.deepEqual(s.review.staleUrls, [prUrl(205)], 'once refreshed, the moved PR is the stale one');
  });

  test('a one-PR review carries its single judged head as sha, and the head stays the judged one after a move', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(207, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    prs.set(207, { sha: 'H2', merged: false });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    assert.equal(s.review.sha, 'H1', 'the head the judge read, not the head the PR has now');
    assert.deepEqual(s.review.heads, { [prUrl(207)]: 'H1' });
    assert.deepEqual(s.review.staleUrls, [prUrl(207)]);
  });
});

describe('LIN-4521: movedUrls names the open changes a push moved, so a re-review is never sent for a merged PR', () => {
  test('a push to an open PR after the review: stale and moved, and the trail carries both', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(221, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    prs.set(221, { sha: 'H2', merged: false });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    assert.deepEqual(s.review.staleUrls, [prUrl(221)]);
    assert.deepEqual(s.review.movedUrls, [prUrl(221)], 'the open change that moved is the one review must re-judge');
    assert.deepEqual(trailOfStanding(s).review.movedUrls, [prUrl(221)], 'the trail carries it to the decision');
  });

  test('a PR merged after an unreviewed push: the approval is stale (the head at merge), but nothing is moved', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(222, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    // Someone pushed H2 and merged it: the merge function revises the head to H2, then ends the change merged.
    prs.set(222, { sha: 'H2', merged: true });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    assert.deepEqual(s.review.staleUrls, [prUrl(222)], 'the approval does not cover the merged head');
    assert.deepEqual(s.review.movedUrls, [], 'a merged PR cannot be re-judged before its merge, so it is not moved');
    assert.deepEqual(s.landing, [prUrl(222)], 'the merged PR is still this round\'s landing');
  });
});

describe('witness 11 (finding d115ccd8): trailOfStanding carries the verdict, stale PRs, per-PR heads and blind-read PRs', () => {
  test('a two-PR landing with a blind read: the trail names the verdict, the stale PR, the heads per PR and the blind-read PRs', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const a = await addChange(211, 'A1');
    const b = await addChange(212, 'B1');
    await reviewOn([a, b], { [a]: 'A1', [b]: 'B1' });
    clock('2026-11-21T11:10:00.000Z');
    const bl = await post(tokens.blind, { kind: 'verdict', judgement: 'blind-read', outcome: 'same', reasoning: 'read both', on: [a, b], heads: { [a]: 'A1', [b]: 'B1' }, run: 'row-blind' });
    assert.equal(bl.status, 201, `blind read refused: ${JSON.stringify(bl.body)}`);
    prs.set(212, { sha: 'B2', merged: false });
    clock('2026-11-21T11:30:00.000Z');
    await refresh();
    const s = await standing();
    const trail = trailOfStanding(s);
    assert.equal(trail.review.verdict, 'approve', 'the review\'s outcome is the verdict the trail reports');
    assert.deepEqual(trail.review.staleUrls, [prUrl(212)], 'the trail names the stale PR');
    assert.equal(trail.review.sha, null, 'no single head across a two-PR landing');
    assert.deepEqual(trail.review.heads, { [prUrl(211)]: 'A1', [prUrl(212)]: 'B1' });
    assert.deepEqual(trail.review.blindRead.prs, [prUrl(211), prUrl(212)], 'the blind read names both PRs');
    assert.equal(trail.review.blindRead.verdict, 'same');
    assert.deepEqual(trail.landing, [prUrl(211), prUrl(212)], 'the landing, in the order the changes were first written');
    assert.equal(trail.workAfterReview, true, 'a stale PR is work after the review');
  });

  test('a one-PR review: the trail carries the judged head as sha', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const c = await addChange(213, 'H1');
    await reviewOn([c], { [c]: 'H1' });
    const trail = trailOfStanding(await standing());
    assert.equal(trail.review.verdict, 'approve');
    assert.equal(trail.review.sha, 'H1');
    assert.deepEqual(trail.review.staleUrls, []);
  });
});

describe('witness 12 (finding 6d32cb5a): an audit\'s notes PR is the change its audit run first wrote, not the change\'s author', () => {
  test('a change the backstop wrote for an audit run is the notes PR and is in the landing; an implementation run\'s change is not', async () => {
    clock('2026-11-21T10:00:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-audit', stage: 'retrospective-audit', taskId, lineage: 'row-root', at: '2026-11-21T10:00:00.000Z' });
    // An implementation run on the task. It must be a task run: standingOf reads only runs whose `in` is the task, so
    // a run opened without a task would make the stage filter untestable. (beforeEach's row-impl has no task.)
    await store.openRun(URL_KEY, { id: 'row-impl-task', stage: 'implementation', taskId, lineage: 'row-root', at: '2026-11-21T10:00:00.000Z' });
    // The backstop's shape: written under the backstop's name (not the audit), with the audit run as its run.
    const notes = await writes.add({ urlKey: URL_KEY, kind: 'change', input: { in: taskId, ref: prUrl(301), head: 'N1' }, by: 'harbour', run: 'row-audit' });
    assert.equal(notes.problems, undefined, `the audit's change was refused: ${JSON.stringify(notes.problems)}`);
    // The implementation's change, written under the task's implementation run.
    prs.set(302, { sha: 'I1', merged: false });
    const impl = await writes.add({ urlKey: URL_KEY, kind: 'change', input: { in: taskId, ref: prUrl(302), head: 'I1' }, by: 'harbour', run: 'row-impl-task' });
    assert.equal(impl.problems, undefined, `the implementation's change was refused: ${JSON.stringify(impl.problems)}`);
    const s = await standing();
    assert.deepEqual(s.notesPrs, [prUrl(301)], 'only the change the audit run first wrote is a notes PR');
    assert.ok(s.landing.includes(prUrl(301)));
    assert.equal(s.landingHasNotesPr, true, 'the landing holds the audit\'s notes PR');
  });

  test('a landing whose changes were all written by implementation runs holds no notes PR', async () => {
    await store.openRun(URL_KEY, { id: 'row-audit-2', stage: 'retrospective-audit', taskId, lineage: 'row-root', at: '2026-11-21T10:00:00.000Z' });
    await addChange(303, 'I1');
    const s = await standing();
    assert.deepEqual(s.notesPrs, [], 'no change was written by an audit run');
    assert.equal(s.landingHasNotesPr, false);
  });
});

describe('witness 13 (finding 398df7e5): the landing and the standing cut the round at the same instant, a close-out run revised after it ended', () => {
  test('a close-out ended at 10:25 and revised at 10:35, after the review at 10:30: readLanding and standingOf both cut at 10:25, so a PR merged at 10:23 is the previous round\'s', async () => {
    clock('2026-11-21T10:00:00.000Z');
    const open = await addChange(120, 'H1');
    clock('2026-11-21T10:05:00.000Z');
    await addChange(121, 'E1');
    await store.openRun(URL_KEY, { id: 'row-close-w13', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T10:20:00.000Z' });
    clock('2026-11-21T10:23:00.000Z');
    prs.set(121, { sha: 'E1', merged: true });
    await refresh();
    clock('2026-11-21T10:25:00.000Z');
    await store.endRun(URL_KEY, 'row-close-w13', { state: 'done', at: '2026-11-21T10:25:00.000Z' });
    clock('2026-11-21T10:30:00.000Z');
    await reviewOn([open], { [open]: 'H1' });
    // A later write to the ended run: its current instant moves past the review, but its end stays at 10:25.
    await store.revise(URL_KEY, 'row-close-w13', { fields: { stage: 'close-out' } }, { at: '2026-11-21T10:35:00.000Z', reason: 'a later write to the ended run' });

    const fromStore = await readLanding({ recordsStore: store, urlKey: URL_KEY, taskId });
    const s = await standing();
    assert.deepEqual(s.landing, fromStore, 'the standing and the landing read take the same round from the same instants');
    assert.deepEqual(fromStore, [prUrl(120)], 'the cut is the close-out\'s end (10:25), not its current instant (10:35): the merge at 10:23 is not in the round');
  });
});
