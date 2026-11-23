/**
 * LIN-4544: one blind read per change. A blind read on record that names the landing stands through a re-review of
 * close-out's own commits: the gate asks for nothing more, the route sends no second read, and the attempt bound counts
 * from the read on record. The guards that stay are tested beside it: a PR the read does not name, a moved head, and a
 * PR merged in an earlier round.
 *
 * The trails are seeded as the records a stage writes (tests/helpers/records-scenario.js) and read the way the gates
 * read them (trailForTicket). The churn side (a second read is `repeat-stage`, the audit resets it) is in
 * tests/unit/pipeline-churn.test.js.
 *
 * Run with: node --test tests/unit/lin-4544-one-blind-read.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { recordsStoreFor, seedTicketRecords } from '../helpers/records-scenario.js';
import { trailForTicket } from '../../lib/task-standing.js';
import { closeOutDecision, closeOutWaitsOn } from '../../lib/run-closeout-state.js';
import { blindReadStep, BLIND_READ_ATTEMPT_BOUND } from '../../lib/recommendation-blind-read.js';
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { BLIND_READ_KIND } from '../../lib/prompts/blind-read-words.js';

const harness = createMangoTmpdir('lin-4544-one-blind-read-');
before(() => harness.connect());
after(() => harness.close());
const URL_KEY = 'acme';

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const REVIEWED = 'aaaaaaa1111111';
const FIX = 'bbbbbbb2222222';

const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;

const evPr = (n, url = PR1, head = REVIEWED) => ({ kind: 'pr', at: T(n), pr: url, head });
const evHead = (n, url, head) => ({ kind: 'head', at: T(n), pr: url, head });
const evMerged = (n, url) => ({ kind: 'merged', at: T(n), pr: url });
const evClose = (n) => ({ kind: 'closeOut', at: T(n) });
const evRead = (n, ...urls) => ({ kind: 'blindRead', at: T(n), on: urls });
// A review judges each PR in `on` at the head `heads` pins (default: the reviewed head).
const evReview = (n, on = [PR1], heads = Object.fromEntries(on.map((url) => [url, REVIEWED])), outcome = 'approve') => ({
  kind: 'review', at: T(n), on, outcome, heads,
});

/** The ticket's records trail for `events`, read the way the gates read it. */
async function trailOf(events) {
  const recordsStore = await recordsStoreFor(harness);
  await seedTicketRecords(recordsStore, URL_KEY, 'LIN-1', events);
  return trailForTicket({ recordsStore, urlKey: URL_KEY, ticket: 'LIN-1' });
}

const STARTED = { name: 'In Progress', type: 'started' };
// An ended or live blind-read run as the route reads them: `dispatchedAt` is what the attempt bound compares.
const readRun = (n, outcome = 'done') => ({ stage: BLIND_READ_KIND, at: T(n), outcome, dispatchedAt: T(n), id: `r${n}` });

const open = (number, sha = REVIEWED) => ({ readable: true, repo: REPO, number, state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] });

describe('one blind read stands through a re-review of close-out\'s own commits', () => {
  // Review A approves PR1, the blind read names it, close-out pushes a fix (the head moves), review B approves the fix.
  const events = [evPr(1), evReview(2), evRead(3, PR1), evClose(4), evHead(4, PR1, FIX), evReview(5, [PR1], { [PR1]: FIX })];

  test('the read on record still covers the landing: the gate asks for nothing, the route sends no read', async () => {
    const trail = await trailOf(events);
    assert.deepEqual(trail.landing, [PR1]);
    assert.deepEqual(trail.review.blindRead.prs, [PR1]);
    assert.equal(closeOutWaitsOn(trail.review, trail.landing), null);
    const decision = closeOutDecision({ trail, openFindings: FINDINGS_NONE });
    assert.equal(decision.routesRead, false);
    assert.equal(decision.refuses, null);
    assert.equal(decision.waitsOn, null);
    assert.equal(blindReadStep({ state: STARTED }, { trail, allRuns: [] }), null);
  });

  test('a re-review that finds nothing new at the same head keeps the read too', async () => {
    const trail = await trailOf([evPr(1), evReview(2), evRead(3, PR1), evReview(4, [PR1])]);
    const decision = closeOutDecision({ trail, openFindings: FINDINGS_NONE });
    assert.equal(decision.routesRead, false);
    assert.equal(decision.refuses, null);
  });
});

describe('the guards that stay: a read covers the landing it names, and nothing else', () => {
  test('a PR the latest read does not name routes a read and refuses close-out; an unread PR joined to an old read is not covered', async () => {
    // Close-out opens PR2 after the read; the landing is PR1 and PR2 and the read names PR1 only.
    const events = [
      evPr(1), evReview(2), evRead(3, PR1), evClose(4), evPr(5, PR2),
      evReview(6, [PR1, PR2], { [PR1]: REVIEWED, [PR2]: REVIEWED }),
    ];
    const trail = await trailOf(events);
    assert.deepEqual(trail.landing, [PR1, PR2]);
    assert.equal(closeOutWaitsOn(trail.review, trail.landing), 'blind-read');
    const decision = closeOutDecision({ trail, openFindings: FINDINGS_NONE });
    assert.equal(decision.routesRead, true);
    assert.equal(decision.refuses, 'blind-read-missing');
    assert.equal(blindReadStep({ state: STARTED }, { trail, allRuns: [] }).step, BLIND_READ_KIND);
  });

  test('a stale approval still blocks: a moved head is re-reviewed, and close-out refuses the moved PR', async () => {
    const trail = await trailOf([evPr(1), evReview(2), evRead(3, PR1), evHead(4, PR1, FIX)]);
    assert.equal(trail.review.staleUrls.includes(PR1), true);
    const decision = closeOutDecision({
      trail,
      openFindings: FINDINGS_NONE,
      stopAt: 'pr',
      runnerReady: true,
      prStatuses: new Map([[PR1, open(41, FIX)]]),
    });
    assert.equal(decision.refuses, 'head-moved');
    assert.deepEqual(decision.movedPrs, [PR1]);
    assert.equal(decision.routesRead, false, 'work after review: the re-review goes first, the read is not sent');
  });

  test('a PR merged in an earlier round left the landing at the round cut, so the old read does not cover the new landing', async () => {
    const trail = await trailOf([
      evPr(1), evReview(2), evRead(3, PR1), evMerged(4, PR1), evClose(4), evPr(5, PR2), evReview(6, [PR2]),
    ]);
    assert.deepEqual(trail.landing, [PR2]);
    assert.equal(closeOutWaitsOn(trail.review, trail.landing), 'blind-read');
    assert.equal(closeOutDecision({ trail, openFindings: FINDINGS_NONE }).routesRead, true);
  });
});

describe('the attempt bound counts from the read on record, not from the review', () => {
  test('no read on record: ended attempts across a re-review still count, so a re-review does not hand out two more', async () => {
    assert.equal(BLIND_READ_ATTEMPT_BOUND, 2);
    const trail = await trailOf([evPr(1), evReview(2), evReview(5)]);
    const allRuns = [readRun(3, 'done'), readRun(4, 'failed')];
    const route = blindReadStep({ state: STARTED }, { trail, allRuns });
    assert.equal(route.step, 'blocked');
    assert.match(route.why, /no read naming/);
  });

  test('a read on record: attempts before it do not count, attempts after it do, and an uncovered PR counts from that read', async () => {
    // The read names PR1; PR2 joins the landing after it, so a new read is due and the bound counts runs after PR1's read.
    const trail = await trailOf([
      evPr(1), evReview(2), evRead(3, PR1), evPr(6, PR2), evReview(7, [PR1, PR2], { [PR1]: REVIEWED, [PR2]: REVIEWED }),
    ]);
    assert.deepEqual(trail.landing, [PR1, PR2]);
    const earlier = [readRun(0, 'done'), readRun(1, 'failed')];
    assert.equal(blindReadStep({ state: STARTED }, { trail, allRuns: earlier }).step, BLIND_READ_KIND, 'two runs before the read do not count');
    const once = [...earlier, readRun(4, 'done')];
    assert.equal(blindReadStep({ state: STARTED }, { trail, allRuns: once }).step, BLIND_READ_KIND, 'one run after the read');
    const bound = [...once, readRun(5, 'skipped')];
    assert.equal(blindReadStep({ state: STARTED }, { trail, allRuns: bound }).step, 'blocked', 'two runs after the read');
  });
});
