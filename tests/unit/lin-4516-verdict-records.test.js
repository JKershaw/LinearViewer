/**
 * LIN-4516 (P3 of LIN-4513, plan-4761b4db): verdicts written as records, pinned to the head their judge read.
 *
 * The witnesses of plan-4761b4db ("fail before, pass after"), over the real records store (MangoDB), the real routes
 * (routes/proxy-records.js, over HTTP in process), the real checked pipeline, the real head refresh (lib/change-records.js,
 * P2) and the in-memory tracker (tests/helpers/fake-records-tracker.js). Only the PR reader and the tracker are faked.
 *
 * Target shape these tests encode:
 * - The verdict route takes a write-only request field `heads: {<change id>: <sha>}`, one head per change named in `on`.
 *   It is not stored on the verdict (the pinned change version already holds the sha).
 * - A verdict on a change with no head named in `heads` is refused. The refusal names the `heads` field.
 * - A verdict pins `on` to the change version whose head is the judge's sha, and only then refreshes to the live head.
 * - A blind read's `on` must name exactly the task's landing: its open changes plus those ended `merged` this round.
 *   A refusal of a set mismatch names the `on` field. The round is cut at the end of the latest close-out run that ended
 *   before the latest review verdict: the record-side form of the comment path's anchor (lib/run-trail.js, LIN-4396), where a
 *   close-out after the review is an attempt on the same landing and never a new cut (witness 6).
 * - "Approve, conditional" is an approval plus findings: the review POSTs one finding `to` close-out, `about` the change, for
 *   each condition, then the approval. The approval is the commit point (plan-91aae6d8 item 8; no `conditions` field).
 * - A verdict write posts one marked summary through the tracker port (SUMMARY_LEAD first line), and no comment reader
 *   reads that summary as a person's comment, landed work or a verdict.
 *
 * They were first written against main (69b10fde9), where they failed: several on the first refusal the code gave (`heads`
 * was a misplaced field then, so every verdict write carrying `heads` was refused). Each assertion checks the behaviour
 * itself (which version is pinned, which field a refusal names, whether a finding exists before a verdict), so a refusal
 * for the wrong reason is not a pass. They are green on this branch.
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
import { SUMMARY_LEAD, summaryBodyOf } from '../../lib/records/summary.js';
import { computeIssueRoundTrips } from '../../lib/plan-review-round-trips.js';
import { parseBlindRead } from '../../lib/run-trail.js';
import { readOpenFindings, findingsHold } from '../../lib/close-out-findings.js';
import { readTrail, withoutHarbourSummaries, isHarbourSummary, isPersonComment } from '../../lib/run-trail.js';

const URL_KEY = 'lin-4516-workspace';
const TICKET = 'LIN-4516';
const REPO = 'acme/widget';
const T0 = '2026-11-21T10:00:00.000Z';
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

const harness = createMangoTmpdir('lin-4516-verdict-records-');
before(() => harness.connect());
after(() => harness.close());

/** A readable PR status in the shape readPrStatusOf returns: the head is `head.sha`. */
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
    tickets: [{ identifier: TICKET, title: 'Slice 3 P3: verdicts as records', description: 'Asked.', state: { name: 'In Progress', type: 'started' }, parent: null }],
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
  taskId = (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'Slice 3 P3.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
  writes = createRecordWrites({ recordsStore: store, isTerminalState });
});

afterEach(async () => {
  if (rh) await rh.close();
  rh = null;
});

const post = (token, body) => rh.post('/api/proxy/records', token, body);
const get = (id, token) => rh.get(`/api/proxy/records/${id}`, token);

/** The stage's own change write, through the route, filed by its run. Returns the change's id. */
async function addChange(n, sha) {
  prs.set(n, { sha, merged: false });
  const r = await post(tokens.impl, { kind: 'change', in: taskId, ref: prUrl(n), head: sha, run: 'row-impl' });
  assert.equal(r.status, 201, `the change write was refused: ${JSON.stringify(r.body)}`);
  return r.body.id;
}

/** The fake PR reader, by PR number: the route's refresh and the test's refresh read the same PRs. */
const readPrStatus = async ({ number }) => {
  const p = prs.get(number);
  return p ? status(number, { sha: p.sha, merged: p.merged }) : { readable: false };
};

/** One head refresh of the task's open changes, from the fake PR reader's current state (P2's one validity read). */
const refresh = () => refreshTaskChanges({ urlKey: URL_KEY, taskId, writes, recordsStore: store, readPrStatus });

/** Set the store's clock for the next writes, so merges and run ends are ordered as the test needs. */
const clock = (iso) => { store.now = () => new Date(iso); };

/** A review verdict body on the changes named, with the judge's heads. */
const reviewVerdict = (on, heads, extra = {}) => ({
  kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'read at the head named', on, heads, run: 'row-review', ...extra,
});

/** A blind read's verdict body on the changes named, with the judge's heads. */
const blindVerdict = (on, heads) => ({
  kind: 'verdict', judgement: 'blind-read', outcome: 'same', reasoning: 'the change reads as it did', on, heads, run: 'row-blind',
});

/** The version numbers a record's `on` link pins to, e.g. ['ch-1@1']. */
const onOf = (record) => [].concat(record.links?.on || []);

describe('witness 1: a verdict pinned to the head its judge read stays on it after a refresh moves the change', () => {
  test('the judge read H1; the change refreshes to H2 after the verdict; the verdict stays on H1 and shows stale', async () => {
    const changeId = await addChange(41, 'H1');
    const v = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(v.status, 201, `the verdict was refused: ${JSON.stringify(v.body)}`);
    prs.set(41, { sha: 'H2', merged: false });
    await refresh();
    const read = await get(v.body.id, tokens.review);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.deepEqual(onOf(read.body), [`${changeId}@1`], 'the verdict stays on the version that holds H1');
    assert.ok(read.body.flags?.stale?.length, 'the verdict shows stale once the change has moved to H2');
  });

  test('the judge read H1, but the change already moved to H2 before the verdict: it pins to H1 (v1) and is stale at once', async () => {
    const changeId = await addChange(41, 'H1');
    prs.set(41, { sha: 'H2', merged: false });
    await refresh();
    const v = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(v.status, 201, `the verdict was refused: ${JSON.stringify(v.body)}`);
    const read = await get(v.body.id, tokens.review);
    assert.deepEqual(onOf(read.body), [`${changeId}@1`], 'a push the judge never saw does not move the pin onto H2');
    assert.ok(read.body.flags?.stale?.length, 'the verdict is stale at once: the judge read H1, the change is at H2');
  });
});

describe('witness 1 (route refresh): the route refreshes after it pins', () => {
  test('the judge read H1, the PR is at H2 and no refresh has run: the verdict pins H1 and is stale on return', async () => {
    const changeId = await addChange(41, 'H1');
    prs.set(41, { sha: 'H2', merged: false });
    const v = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(v.status, 201, `the verdict was refused: ${JSON.stringify(v.body)}`);
    const read = await get(v.body.id, tokens.review);
    assert.deepEqual(onOf(read.body), [`${changeId}@1`], 'the pin holds the version the judge read');
    assert.ok(read.body.flags?.stale?.length, 'the route ran the refresh after pinning: the change is at H2 and the verdict is stale');
  });
});

describe('witness 2: a verdict with no head is refused', () => {
  test('a verdict on a change with no head named in heads is refused, and the refusal names the heads field', async () => {
    const changeId = await addChange(41, 'H1');
    const r = await post(tokens.review, { kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'no head given', on: [changeId], run: 'row-review' });
    assert.equal(r.status, 422, `a verdict with no head was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'heads'), `the refusal does not name heads: ${JSON.stringify(r.body)}`);
    assert.equal((await store.find(URL_KEY, { kind: 'verdict' })).length, 0, 'nothing was written');
  });
});

describe('witness 2 (other write paths): a change cannot be attached to a verdict by link or revise without its head', () => {
  test('link and revise that add a change to a verdict are refused without its head, and pin it to the sha named', async () => {
    const changeId = await addChange(41, 'H1');
    const f = await post(tokens.review, { kind: 'finding', in: taskId, to: 'review', says: 'Check the footer.', how: 'run it', run: 'row-review' });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    const v = await post(tokens.review, reviewVerdict([f.body.id], {}));
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const linkBare = await rh.post(`/api/proxy/records/${v.body.id}/link`, tokens.review, { on: changeId, run: 'row-review' });
    assert.equal(linkBare.status, 422, `a bare link to a change was accepted: ${JSON.stringify(linkBare.body)}`);
    assert.ok(linkBare.body.problems?.some((p) => p.field === 'heads'), JSON.stringify(linkBare.body));
    const linkPinned = await rh.post(`/api/proxy/records/${v.body.id}/link`, tokens.review, { on: changeId, heads: { [changeId]: 'H1' }, run: 'row-review' });
    assert.equal(linkPinned.status, 200, JSON.stringify(linkPinned.body));
    assert.ok(onOf(linkPinned.body).includes(`${changeId}@1`), `the link did not pin the change to H1: ${JSON.stringify(linkPinned.body.links)}`);
    const reviseBare = await rh.post(`/api/proxy/records/${v.body.id}/revise`, tokens.review, { on: changeId, reason: 'add the change', run: 'row-review' });
    assert.equal(reviseBare.status, 422, `a bare revise adding a change was accepted: ${JSON.stringify(reviseBare.body)}`);
  });
});

describe('witness 3: a blind read names exactly the landing (one landing function)', () => {
  test('a blind read naming a subset of the open changes is refused, naming the on field', async () => {
    const a = await addChange(41, 'HA');
    await addChange(42, 'HB');
    const r = await post(tokens.blind, blindVerdict([a], { [a]: 'HA' }));
    assert.equal(r.status, 422, `a subset blind read was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'on'), `the refusal does not name on: ${JSON.stringify(r.body)}`);
  });

  test('a blind read naming a superset of the landing (a change abandoned unmerged) is refused, naming the on field', async () => {
    const a = await addChange(41, 'HA');
    const b = await addChange(42, 'HB');
    const c = await addChange(43, 'HC');
    await writes.end({ urlKey: URL_KEY, id: c, input: { state: 'abandoned', reason: 'the PR closed unmerged' }, by: 'harbour' });
    const r = await post(tokens.blind, blindVerdict([a, b, c], { [a]: 'HA', [b]: 'HB', [c]: 'HC' }));
    assert.equal(r.status, 422, `a superset blind read was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'on'), `the refusal does not name on: ${JSON.stringify(r.body)}`);
  });

  test('a blind read naming exactly the two open changes is accepted', async () => {
    const a = await addChange(41, 'HA');
    const b = await addChange(42, 'HB');
    const r = await post(tokens.blind, blindVerdict([a, b], { [a]: 'HA', [b]: 'HB' }));
    assert.equal(r.status, 201, `the exact blind read was refused: ${JSON.stringify(r.body)}`);
  });

  test('a partly merged two-PR landing: a blind read naming only the still-open change is refused; one naming both is accepted', async () => {
    const a = await addChange(41, 'HA');
    const b = await addChange(42, 'HB');
    prs.set(41, { sha: 'HA', merged: true });
    await refresh();
    const onlyOpen = await post(tokens.blind, blindVerdict([b], { [b]: 'HB' }));
    assert.equal(onlyOpen.status, 422, `a blind read leaving out the merged PR was accepted: ${JSON.stringify(onlyOpen.body)}`);
    assert.ok(onlyOpen.body.problems?.some((p) => p.field === 'on'), `the refusal does not name on: ${JSON.stringify(onlyOpen.body)}`);
    const both = await post(tokens.blind, blindVerdict([a, b], { [a]: 'HA', [b]: 'HB' }));
    assert.equal(both.status, 201, `the blind read naming both of the landing was refused: ${JSON.stringify(both.body)}`);
  });
});

describe('witness 4: conditions are written before the approval, and a run killed in between leaves close-out held', () => {
  test('an approve-with-conditions writes its finding to close-out about the change first, then the approval, which is the later record', async () => {
    const changeId = await addChange(41, 'H1');
    const f = await post(tokens.review, { kind: 'finding', in: taskId, to: 'close-out', about: [changeId], says: 'Add the footer test.', how: 'run the footer test', run: 'row-review' });
    assert.equal(f.status, 201, `the condition finding was refused: ${JSON.stringify(f.body)}`);
    const v = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(v.status, 201, `the approval was refused: ${JSON.stringify(v.body)}`);
    const finding = await store.current(URL_KEY, f.body.id);
    const verdict = await store.current(URL_KEY, v.body.id);
    assert.ok(finding.at <= verdict.at, 'the condition is written before the approval');
  });

  test('a run killed after its condition findings and before its approval: close-out is held, and no approval exists', async () => {
    const changeId = await addChange(41, 'H1');
    const f = await post(tokens.review, { kind: 'finding', in: taskId, to: 'close-out', about: [changeId], says: 'Add the footer test.', how: 'run the footer test', run: 'row-review' });
    assert.equal(f.status, 201, `the condition finding was refused: ${JSON.stringify(f.body)}`);
    // The run dies here: no approval is written.
    assert.equal((await store.find(URL_KEY, { kind: 'verdict' })).length, 0, 'no approval was written');
    const reading = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(findingsHold(reading), true, 'the open condition holds close-out (LIN-4495)');
    assert.equal(reading.count, 1);
  });
});

describe('witness 5: a verdict summary of every kind changes nothing for any comment reader', () => {
  test('a verdict write posts one marked summary through the tracker port, on the task ticket', async () => {
    const changeId = await addChange(41, 'H1');
    const r = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(r.status, 201, `the verdict was refused: ${JSON.stringify(r.body)}`);
    assert.equal(tracker.comments.length, 1, `expected one summary comment, got ${tracker.comments.length}`);
    assert.equal(tracker.comments[0].ref, TICKET);
    assert.ok(tracker.comments[0].body.startsWith(SUMMARY_LEAD), 'the summary opens with the mark');
  });

  test('each summary kind is a harbour summary to the one predicate, and feeding it to each comment reader changes nothing', async () => {
    const changeId = await addChange(41, 'H1');
    const verdictRes = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(verdictRes.status, 201, `the verdict was refused: ${JSON.stringify(verdictRes.body)}`);
    const blindRes = await post(tokens.blind, blindVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(blindRes.status, 201, `the blind read was refused: ${JSON.stringify(blindRes.body)}`);
    const summaries = tracker.comments.map((c) => c.body);
    assert.equal(summaries.length, 2, 'one summary per verdict write');
    const human = [
      { body: 'Looks right to me, but check the footer count.', createdAt: '2026-11-21T09:00:00Z' },
      { body: '### Plan Review Verdict\n\n**Verdict:** Approve.', createdAt: '2026-11-21T09:30:00Z' },
    ];
    const baseline = readTrail(human);
    for (const body of summaries) {
      const comment = { body, createdAt: '2026-11-21T10:00:00Z' };
      assert.ok(isHarbourSummary(comment), `not read as a harbour summary: ${body.split('\n')[0]}`);
      assert.equal(isPersonComment(comment), false, `read as a person's comment: ${body.split('\n')[0]}`);
      assert.deepEqual(withoutHarbourSummaries([...human, comment]), human, 'the summary is filtered out of the discussed comments');
      assert.deepEqual(readTrail([...human, comment]), baseline, 'the trail reads the same with the summary in it');
    }
  });
});

describe('witness 6: the round cut (the next round\'s landing)', () => {
  // The rule, the record-side form of lib/run-trail.js's anchor (LIN-4396): the cut is the end of the latest close-out run
  // that ended before the latest review verdict. Changes merged before the cut are out of the next round's landing; open
  // changes, and changes merged after the cut, are in. A close-out after the latest review is an attempt on the same
  // landing (the comment path's "never a new one"), so it does not move the cut.
  const reviewOn = async (ids) => {
    const heads = Object.fromEntries(ids.map((id) => [id, 'H?']));
    return post(tokens.review, reviewVerdict(ids, heads));
  };

  test('a change merged before the close-out that precedes the latest review stays out; one merged after it is in', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const b = await addChange(42, 'HB');
    clock('2026-11-21T11:05:00.000Z');
    const a = await addChange(41, 'HA');
    clock('2026-11-21T11:30:00.000Z');
    prs.set(41, { sha: 'HA', merged: true });
    await refresh();
    clock('2026-11-21T11:40:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-1', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T11:40:00.000Z' });
    clock('2026-11-21T11:50:00.000Z');
    await store.endRun(URL_KEY, 'row-close-1', { state: 'done', at: '2026-11-21T11:50:00.000Z' });
    clock('2026-11-21T12:00:00.000Z');
    const r = await post(tokens.review, reviewVerdict([b], { [b]: 'HB' }));
    assert.equal(r.status, 201, `the review was refused: ${JSON.stringify(r.body)}`);
    clock('2026-11-21T12:10:00.000Z');
    const c = await addChange(43, 'HC');
    clock('2026-11-21T12:20:00.000Z');
    prs.set(43, { sha: 'HC', merged: true });
    await refresh();
    clock('2026-11-21T12:30:00.000Z');
    const withOld = await post(tokens.blind, blindVerdict([a, b, c], { [a]: 'HA', [b]: 'HB', [c]: 'HC' }));
    assert.equal(withOld.status, 422, `a blind read naming a change merged before the cut was accepted: ${JSON.stringify(withOld.body)}`);
    assert.ok(withOld.body.problems?.some((p) => p.field === 'on'), `the refusal does not name on: ${JSON.stringify(withOld.body)}`);
    const inRound = await post(tokens.blind, blindVerdict([b, c], { [b]: 'HB', [c]: 'HC' }));
    assert.equal(inRound.status, 201, `the blind read naming the next round's landing was refused: ${JSON.stringify(inRound.body)}`);
  });

  test('a close-out after the latest review is an attempt on the same landing: it does not move the cut', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const b = await addChange(42, 'HB');
    clock('2026-11-21T11:05:00.000Z');
    const a = await addChange(41, 'HA');
    clock('2026-11-21T11:30:00.000Z');
    prs.set(41, { sha: 'HA', merged: true });
    await refresh();
    clock('2026-11-21T11:40:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-1', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T11:40:00.000Z' });
    clock('2026-11-21T11:50:00.000Z');
    await store.endRun(URL_KEY, 'row-close-1', { state: 'done', at: '2026-11-21T11:50:00.000Z' });
    // C is added after the first close-out ends and merges before the review: it is in the round the cut opens.
    clock('2026-11-21T11:52:00.000Z');
    const c = await addChange(43, 'HC');
    clock('2026-11-21T11:55:00.000Z');
    prs.set(43, { sha: 'HC', merged: true });
    await refresh();
    clock('2026-11-21T12:00:00.000Z');
    const r = await post(tokens.review, reviewVerdict([b], { [b]: 'HB' }));
    assert.equal(r.status, 201, `the review was refused: ${JSON.stringify(r.body)}`);
    // A second close-out runs after the latest review. It is an attempt on the same landing, so it must not cut at its own end
    // (a cut there would put C out of the round).
    clock('2026-11-21T12:10:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-2', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T12:10:00.000Z' });
    clock('2026-11-21T12:20:00.000Z');
    await store.endRun(URL_KEY, 'row-close-2', { state: 'done', at: '2026-11-21T12:20:00.000Z' });
    clock('2026-11-21T12:30:00.000Z');
    const inRound = await post(tokens.blind, blindVerdict([b, c], { [b]: 'HB', [c]: 'HC' }));
    assert.equal(inRound.status, 201, `the blind read naming the round's landing (B and C) was refused: ${JSON.stringify(inRound.body)}`);
    const withOld = await post(tokens.blind, blindVerdict([a, b, c], { [a]: 'HA', [b]: 'HB', [c]: 'HC' }));
    assert.equal(withOld.status, 422, `a blind read naming A, merged before the first close-out, was accepted: ${JSON.stringify(withOld.body)}`);
  });
});

describe('witness 4 : the conditions contract', () => {
  test('a conditions field on a verdict is refused and nothing is written: a condition is a finding to close-out, written first', async () => {
    const changeId = await addChange(41, 'H1');
    const r = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }, { conditions: ['add the footer test'] }));
    assert.equal(r.status, 422, `a verdict with a conditions field was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'conditions'), `the refusal does not name conditions: ${JSON.stringify(r.body)}`);
    assert.equal((await store.find(URL_KEY, { kind: 'verdict' })).length, 0, 'no approval was written');
    assert.equal((await store.find(URL_KEY, { kind: 'finding', to: 'close-out' })).length, 0, 'no condition was written as a side effect');
  });

  test('an approval written after its condition finding holds close-out until close-out ends the finding', async () => {
    const changeId = await addChange(41, 'H1');
    const f = await post(tokens.review, { kind: 'finding', in: taskId, to: 'close-out', about: [changeId], says: 'Add the footer test.', how: 'run the footer test', run: 'row-review' });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    const v = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const reading = await readOpenFindings({ store, urlKey: URL_KEY, ticket: TICKET });
    assert.equal(findingsHold(reading), true, 'the approval does not clear the condition: close-out is held until it is ended');
  });
});

describe('witness 5 : the summary path', () => {
  test('an import posts no summary, and a failed summary is named in the answer and never retried', async () => {
    const changeId = await addChange(41, 'H1');
    const plain = createRecordWrites({ recordsStore: store, isTerminalState, tracker: () => tracker.port });
    const imported = await plain.add({ urlKey: URL_KEY, kind: 'verdict', input: { judgement: 'review', outcome: 'approve', reasoning: 'imported', on: [`${changeId}@1`], in: taskId }, by: 'review', via: 'import' });
    assert.ok(!imported.problems, JSON.stringify(imported.problems));
    assert.equal(tracker.comments.length, 0, 'an import posts no summary');
    tracker.knobs.commentFails = true;
    const r = await post(tokens.review, reviewVerdict([changeId], { [changeId]: 'H1' }));
    tracker.knobs.commentFails = false;
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.summary?.error, `the failed summary is not named: ${JSON.stringify(r.body.summary)}`);
    assert.equal(tracker.attempts.comment, 1, 'the post is tried once and never retried');
  });

  test('a link to a verdict is a new version and posts its summary once more', async () => {
    const changeId = await addChange(41, 'H1');
    const f = await post(tokens.review, { kind: 'finding', in: taskId, to: 'review', says: 'Check the footer.', how: 'run it', run: 'row-review' });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    const v = await post(tokens.review, reviewVerdict([f.body.id], {}));
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const before = tracker.comments.length;
    const linked = await rh.post(`/api/proxy/records/${v.body.id}/link`, tokens.review, { on: changeId, heads: { [changeId]: 'H1' }, run: 'row-review' });
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.equal(tracker.comments.length, before + 1, 'the new version posted exactly one summary');
    assert.ok(tracker.comments.at(-1).body.startsWith(SUMMARY_LEAD), 'the summary opens with the mark');
    assert.equal(linked.body.summary?.posted, true, JSON.stringify(linked.body.summary));
  });
});

describe('close-out witness A: `on` under links is read as `on` beside the fields (findings 356a11ca, 369e09dc)', () => {
  const nested = (on, heads, extra = {}) => ({ kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'read at the head named', links: { on }, ...(heads ? { heads } : {}), run: 'row-review', ...extra });

  test('a verdict naming its change under links.on with no head is refused, naming heads, and nothing is written', async () => {
    const changeId = await addChange(41, 'H1');
    const r = await post(tokens.review, nested([changeId]));
    assert.equal(r.status, 422, `a links.on verdict with no head was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'heads'), `the refusal does not name heads: ${JSON.stringify(r.body)}`);
    assert.equal((await store.find(URL_KEY, { kind: 'verdict' })).length, 0, 'nothing was written');
  });

  test('a bare-id links.on (not a list) is refused the same way', async () => {
    const changeId = await addChange(41, 'H1');
    const r = await post(tokens.review, nested(changeId));
    assert.equal(r.status, 422, `a bare links.on id with no head was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'heads'), JSON.stringify(r.body));
  });

  test('with heads, links.on is pinned to the version holding the sha (not the current one), filed under the task, and stale at once', async () => {
    const changeId = await addChange(41, 'H1');
    prs.set(41, { sha: 'H2', merged: false });
    await refresh();
    const r = await post(tokens.review, nested([changeId], { [changeId]: 'H1' }));
    assert.equal(r.status, 201, `the links.on verdict was refused: ${JSON.stringify(r.body)}`);
    assert.deepEqual(onOf(r.body), [`${changeId}@1`], 'pinned to the version that holds H1, not the current H2');
    assert.equal(r.body.in, taskId, 'filed under the task its change is on');
    const read = await get(r.body.id, tokens.review);
    assert.ok(read.body.flags?.stale?.length, 'stale: the change is at H2');
  });

  test('a blind read naming a subset of the landing under links.on is refused, naming on', async () => {
    const a = await addChange(41, 'HA');
    await addChange(42, 'HB');
    const r = await post(tokens.blind, { kind: 'verdict', judgement: 'blind-read', outcome: 'same', reasoning: 'the change reads as it did', links: { on: [a] }, heads: { [a]: 'HA' }, run: 'row-blind' });
    assert.equal(r.status, 422, `a subset blind read via links.on was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'on'), JSON.stringify(r.body));
  });

  test('revise adding links.on without heads is refused; with heads it pins to the sha named', async () => {
    const changeId = await addChange(41, 'H1');
    const f = await post(tokens.review, { kind: 'finding', in: taskId, to: 'review', says: 'Check the footer.', how: 'run it', run: 'row-review' });
    const v = await post(tokens.review, reviewVerdict([f.body.id], {}));
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const bare = await rh.post(`/api/proxy/records/${v.body.id}/revise`, tokens.review, { links: { on: [changeId] }, reason: 'add the change', run: 'row-review' });
    assert.equal(bare.status, 422, `a links.on revise with no head was accepted: ${JSON.stringify(bare.body)}`);
    assert.ok(bare.body.problems?.some((p) => p.field === 'heads'), JSON.stringify(bare.body));
    const pinned = await rh.post(`/api/proxy/records/${v.body.id}/revise`, tokens.review, { links: { on: [changeId] }, heads: { [changeId]: 'H1' }, reason: 'add the change', run: 'row-review' });
    assert.equal(pinned.status, 200, JSON.stringify(pinned.body));
    assert.ok(onOf(pinned.body).includes(`${changeId}@1`), `not pinned to H1: ${JSON.stringify(pinned.body.links)}`);
  });

  test('a body naming on beside the fields and under links is refused, and no head is revised on the way', async () => {
    const changeId = await addChange(41, 'H1');
    const r = await post(tokens.review, nested([changeId], { [changeId]: 'H9' }, { on: [changeId] }));
    assert.equal(r.status, 422, `on named twice was accepted: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.problems?.some((p) => p.field === 'on'), JSON.stringify(r.body));
    const versions = await store.versionsOf(URL_KEY, [changeId]);
    assert.equal(versions.length, 1, 'no head revise was left behind by a refused body');
  });
});

describe('close-out witness B: only a verdict rests on a head (finding 804994d8)', () => {
  test('a finding on a change needs no head, and one carrying heads is refused as misplaced', async () => {
    const changeId = await addChange(41, 'H1');
    const plain = await post(tokens.review, { kind: 'finding', in: taskId, to: 'close-out', on: [changeId], says: 'Add the footer test.', how: 'run the footer test', run: 'row-review' });
    assert.equal(plain.status, 201, `a finding on a change was refused for want of a head: ${JSON.stringify(plain.body)}`);
    const withHeads = await post(tokens.review, { kind: 'finding', in: taskId, to: 'close-out', on: [changeId], heads: { [changeId]: 'H1' }, says: 'Again.', how: 'run it', run: 'row-review' });
    assert.equal(withHeads.status, 422, JSON.stringify(withHeads.body));
    assert.ok(withHeads.body.problems?.some((p) => p.field === 'heads' && /verdict/.test(p.message)), JSON.stringify(withHeads.body));
  });
});

describe('close-out witness C: no comment reader picks a verdict summary up (finding f83642c2)', () => {
  const ASOF = '2026-11-21T12:00:00.000Z';
  const T = Date.parse('2026-11-21T10:00:00.000Z');
  const at = (min) => new Date(T + min * 60000).toISOString();
  const rounds = (comments) => computeIssueRoundTrips({
    id: 'i1', identifier: 'LIN-1', description: '', comments,
    rows: [{ id: 'r1', kind: 'plan-review', status: 'done', dispatchedAt: at(0), completedAt: at(60) }],
  }, { asOf: ASOF, planFacts: undefined });
  const summary = (judgement, outcome, reasoning) => summaryBodyOf({ id: `verdict-${judgement}`, v: 1, kind: 'verdict', fields: { judgement, outcome, reasoning } });

  test('a plan-review, a review and a blind-read verdict summary in the round-trip window read as no comment at all', () => {
    const baseline = rounds([]);
    assert.equal(baseline.R0.verdict, null, 'baseline: no verdict');
    for (const body of [
      summary('plan-review', 'approve', 'The plan holds.'),
      summary('review', 'request-changes', 'Needs discussion before this lands. Verdict follows in the records.'),
      summary('blind-read', 'same', 'Reads as it did.'),
    ]) {
      const got = rounds([{ id: 'c1', body, createdAt: at(30) }]);
      assert.deepEqual(got, baseline, `a summary changed the round-trip reading: ${body.split('\n')[0]}`);
    }
  });

  test('a blind-read summary is not a blind read to the measure-1 and run-evidence parser', () => {
    assert.equal(parseBlindRead({ id: 'c1', body: summary('blind-read', 'same', 'Reads as it did.'), createdAt: at(30) }), null);
  });
});

describe('close-out witness D: a merged change that takes a later version stays merged at its merge (finding 9a6a5703)', () => {
  test('a link added to a change after it merged and after the round cut does not put its PR back in the landing', async () => {
    clock('2026-11-21T11:00:00.000Z');
    const b = await addChange(42, 'HB');
    clock('2026-11-21T11:05:00.000Z');
    const a = await addChange(41, 'HA');
    clock('2026-11-21T11:30:00.000Z');
    prs.set(41, { sha: 'HA', merged: true });
    await refresh();
    clock('2026-11-21T11:40:00.000Z');
    await store.openRun(URL_KEY, { id: 'row-close-1', stage: 'close-out', taskId, lineage: 'row-root', at: '2026-11-21T11:40:00.000Z' });
    clock('2026-11-21T11:50:00.000Z');
    await store.endRun(URL_KEY, 'row-close-1', { state: 'done', at: '2026-11-21T11:50:00.000Z' });
    clock('2026-11-21T12:00:00.000Z');
    const r = await post(tokens.review, reviewVerdict([b], { [b]: 'HB' }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    // A is merged (ended at 11:30, before the cut at 11:50). A later link gives it a new version at 12:40, after the cut.
    const f = await post(tokens.review, { kind: 'finding', in: taskId, to: 'project', says: 'A note about A.', how: 'none', run: 'row-review' });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    clock('2026-11-21T12:40:00.000Z');
    const linked = await writes.link({ urlKey: URL_KEY, id: a, links: { about: [f.body.id] }, by: 'review' });
    assert.ok(!linked.problems, `the link was refused: ${JSON.stringify(linked.problems)}`);
    assert.equal((await store.versionsOf(URL_KEY, [a])).length >= 3, true, 'the merged change took a new version after it ended');
    clock('2026-11-21T12:50:00.000Z');
    const exact = await post(tokens.blind, blindVerdict([b], { [b]: 'HB' }));
    assert.equal(exact.status, 201, `the landing put the merged-before-the-cut PR back: ${JSON.stringify(exact.body)}`);
  });
});
