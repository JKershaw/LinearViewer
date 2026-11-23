/**
 * LIN-4438 (piece 3 of LIN-4396): close-out waits on a recorded blind read.
 *
 * The shared-trail table drives the same trails through every place that decides close-out readiness
 * and checks they agree. Five lanes:
 *   - route: lib/openrouter.js codeRouteOf, through getRecommendation (the selector stubbed to answer
 *     `close-out` when the code routes stand aside);
 *   - state: deriveCloseOutState for a stop-at-PR run, through readCloseOutChain (the check route's chain);
 *   - box: readRunEvidence, the task page's close-out box (its one read is the landing's sole PR, LIN-4458);
 *   - guard, stop-at lane: closeOutNotReady on a stop-at-PR task;
 *   - guard, ladder lane: closeOutNotReady on an ordinary task.
 * A future place that decides readiness without closeOutDecision (LIN-4460) and the landing disagrees with a row.
 *
 * Rows 14 and 15 write their expected landing down, so the behaviour is chosen, not found. Row 14 was
 * flipped on purpose by LIN-4458 (piece 2 of LIN-4447): with one comment classifier, an audit carries
 * only the PRs it is the first on the trail to cite (its notes PRs), so the merged landing PR it re-cites
 * no longer joins the notes PR's landing, and the read names the notes PR alone. Row 15 (a foreign PR
 * cited before the first review joins a first landing) was a stated limit under the comment path; LIN-4518
 * step 3 flipped it on records: a comment that cites a foreign PR is not a change of this task.
 *
 * LIN-4520: every trail is the ticket's records trail (seeded from each row's events, read by trailForTicket). No
 * comment is read for a verdict, a landing, a blind read or a Survey; a comment decides nothing here.
 *
 * Run with: node --test tests/unit/lin-4438-blind-read-gate.test.js
 */
process.env.NODE_ENV = 'test';

import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { test, describe, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { recordsStoreFor, seedTicketRecords } from '../helpers/records-scenario.js';
import { planRound } from '../helpers/plan-review-loop.js';
import { trailForTicket } from '../../lib/task-standing.js';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { readCloseOutChain, closeOutNotReady } from '../../lib/close-out-readiness.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { closeOutWaitsOn } from '../../lib/run-closeout-state.js';
import { assembleTrailFacts } from '../../lib/recommendation-facts.js';
import { isPersonComment } from '../../lib/run-trail.js';
import { blindReadStep, BLIND_READ_ATTEMPT_BOUND } from '../../lib/recommendation-blind-read.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { SURVEY_HEADINGS } from '../../lib/prompts/survey-words.js';

afterEach(() => { setFetchImpl(null); setPromptTraceRecorder(null); });

const harness = createMangoTmpdir('lin-4438-blind-read-gate-');
before(() => harness.connect());
after(() => harness.close());
const URL_KEY = 'acme';

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const PR1 = PR(41);
const PR2 = PR(42);
const PR_OLD = PR(40);
const FOREIGN = 'https://github.com/other/repo/pull/7';
const REVIEWED = 'aaaaaaa1111111';

const T = (n) => `2026-11-12T${String(n).padStart(2, '0')}:00:00.000Z`;
const c = (n, body) => ({ id: `c${n}`, body, createdAt: T(n), user: 'agent' });
const summary = (n, url = PR1) => c(n, `Implementation done: ${url}, CI green.`);
const review = (n, verdict = 'Approve', url = PR1) => c(n, `## Code Review\n\nReviewed head \`${REVIEWED}\` of ${url}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: ${verdict}**`);
const read = (n, ...urls) => c(n, `## Blind read\nVerdict: same. It gave the gate one owner in lib/run-closeout-state.js and left nothing worse.\n\nRead: ${urls.join(', ')} at \`${REVIEWED.slice(0, 9)}\` against \`000000000\`.\n\n### Inside the area, fix-sized\nNone.`);
const closeOut = (n, body) => c(n, `## Close-out\n\n${body}`);
// Row 11's link comment: the shape close-out's not-ready sentence asks for (no heading; a first line
// naming the PR that opens with none of Close-out, Autopilot, Plan or Revision).
const LINK_BODY = `PR to merge: ${PR2}`;
const link = (n) => c(n, LINK_BODY);
const audit = (n) => c(n, `## Retrospective audit — LIN-1\n\nThe landing ${PR1} holds; one note entry is wrong. Notes PR: ${PR2}.`);
const research = (n) => c(n, `## Research notes\n\nAn earlier attempt elsewhere is ${FOREIGN}; this ticket starts fresh.`);

// The same trails as records (LIN-4518 step 3): what each comment above says, written as the records a stage writes.
const evPr = (n, url = PR1, head = REVIEWED) => ({ kind: 'pr', at: T(n), pr: url, head });
const evReview = (n, outcome = 'approve', url = PR1) => ({ kind: 'review', at: T(n), on: [url], outcome, heads: { [url]: REVIEWED } });
const evRead = (n, ...urls) => ({ kind: 'blindRead', at: T(n), on: urls });
const evClose = (n) => ({ kind: 'closeOut', at: T(n) });
const evMerged = (n, url) => ({ kind: 'merged', at: T(n), pr: url });
const evAudit = (n, url, head = REVIEWED) => ({ kind: 'audit', at: T(n), pr: url, head });
const evRun = (stage, n, state) => ({ kind: 'run', at: T(n), stage, state });

/** The ticket's records trail for `events` (LIN-4518 step 3): seeded into a fresh store, read the way the gates read it. */
async function trailOfEvents(events) {
  const recordsStore = await recordsStoreFor(harness);
  await seedTicketRecords(recordsStore, URL_KEY, 'LIN-1', events);
  return trailForTicket({ recordsStore, urlKey: URL_KEY, ticket: 'LIN-1' });
}

const STARTED = { name: 'In Progress', type: 'started' };
const DONE = { name: 'Done', type: 'completed' };
const run = (stage, n, outcome = 'done') => ({ stage, at: T(n), outcome, dispatchedAt: T(n), id: `r${n}` });

const open = (number, sha = REVIEWED) => ({ readable: true, repo: REPO, number, state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] });
const merged = (number) => ({ ...open(number), state: 'closed', merged: true });

/**
 * The table. `route`: what codeRouteOf sends ('blind-read', 'blocked') or 'aside' (the selector is
 * asked). `gate`: 'wait' (every guard refuses blind-read-missing; the state and the box are not ready)
 * or 'admit' (no lane refuses on the gate). `merged`: PR numbers GitHub reports merged.
 */
const ROWS = [
  { n: 1, name: 'approve, no read', comments: [summary(1), review(2)], events: [evPr(1), evReview(2)], route: 'blind-read', gate: 'wait' },
  { n: 2, name: 'approve, then a read naming the PR', comments: [summary(1), review(2), read(3, PR1)], events: [evPr(1), evReview(2), evRead(3, PR1)], route: 'aside', gate: 'admit', ready: true },
  // The older PR was the previous round's: merged by a close-out before the review, so it is not in this landing.
  { n: 3, name: 'a read naming an older PR only', comments: [summary(1), review(2), read(3, PR_OLD)], events: [evPr(0, PR_OLD), evClose(0), evMerged(0, PR_OLD), evPr(1), evReview(2), evRead(3, PR_OLD)], route: 'blind-read', gate: 'wait' },
  // LIN-4544: the read names the landing, so it stands through the new review: nothing is sent and the gate admits.
  { n: 4, name: 'a read, then a new review (the read stands)', comments: [summary(1), review(2), read(3, PR1), review(4)], events: [evPr(1), evReview(2), evRead(3, PR1), evReview(4)], route: 'aside', gate: 'admit', ready: true },
  { n: 5, name: 'request changes', comments: [summary(1), review(2, 'Request Changes')], events: [evPr(1), evReview(2, 'request-changes')], route: 'aside', gate: 'admit' },
  { n: 6, name: 'two ended attempts, runs known', comments: [summary(1), review(2)], events: [evPr(1), evReview(2), evRun('blind-read', 3, 'done'), evRun('blind-read', 4, 'failed')], allRuns: [run('review', 2), run('blind-read', 3, 'done'), run('blind-read', 4, 'failed')], route: 'blocked', gate: 'wait' },
  { n: 7, name: 'runs unknown', comments: [summary(1), review(2)], events: [evPr(1), evReview(2)], allRuns: null, route: 'blind-read', gate: 'wait' },
  // A review needs a change to rest on (records refuse a verdict with no `on`), so the records of this row hold none.
  { n: 8, name: 'no PR on the trail', comments: [c(1, 'Implementation done, CI green.'), review(2, 'Approve', 'the change')], events: [], route: 'aside', gate: 'admit' },
  { n: 9, name: 'no review', comments: [summary(1)], events: [evPr(1)], route: 'aside', gate: 'admit' },
  { n: 10, name: 'approve, then a not-ready close-out citing the PR', comments: [summary(1), review(2), closeOut(3, `Not ready: no blind read yet for ${PR1}. Next: blind-read.`)], events: [evPr(1), evReview(2), evClose(3)], route: 'blind-read', gate: 'wait' },
  { n: 11, name: 'approve, then a plain link comment naming a new PR', comments: [summary(1), review(2), link(3)], events: [evPr(1), evReview(2), evPr(3, PR2)], route: 're-review', gate: 'wait' }, // LIN-4521 (finding-3df7a963): a PR the review never judged is re-reviewed by code, not left to the selector
  { n: 12, name: 'approve, a read, then a merging close-out on a Done ticket', state: DONE, comments: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`)], events: [evPr(1), evReview(2), evRead(3, PR1), evClose(4), evMerged(4, PR1)], merged: [41], route: 'aside', gate: 'admit' },
  // The fix round re-cites PR1 at the same head, so it adds no record: the landing keeps PR1 (LIN-4438 row 13).
  { n: 13, name: 'approve, a not-ready close-out, a fix round re-naming the PR, then a re-review', comments: [summary(1), review(2), closeOut(3, `Not ready: CI red on ${PR1}. Next: implementation.`), summary(4), review(5)], events: [evPr(1), evReview(2), evClose(3), evReview(5)], route: 'blind-read', gate: 'wait' },
  { n: 14, name: 'a Done ticket: landing close-out, then an audit notes PR and its own review', state: DONE, comments: [summary(1), review(2), read(3, PR1), closeOut(4, `Merged ${PR1}; set Done.`), audit(5), review(6, 'Approve', PR2)], events: [evPr(1), evReview(2), evRead(3, PR1), evClose(4), evMerged(4, PR1), evAudit(5, PR2), evReview(6, 'approve', PR2)], merged: [41], route: 'blind-read', gate: 'wait', landing: [PR2] },
  // Flipped by LIN-4518 step 3: a comment that cites a foreign PR is not a change of this task, so the records landing
  // holds PR1 alone and the read of PR1 clears the gate. (The stray-change ruling, finding b00a848c, owns the records case.)
  { n: 15, name: 'a pre-review comment cites a foreign PR by full URL', comments: [research(1), summary(2), review(3), read(4, PR1)], events: [evPr(2), evReview(3), evRead(4, PR1)], route: 'aside', gate: 'admit', landing: [PR1] },
];

const SELECTOR_REPLY = { choices: [{ message: { content: '## Reasoning\n→ **close-out**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } };
const context = (row, trail) => ({ parent: null, siblings: [], project: null, children: [], comments: row.comments, focusedChild: null, attachments: [], runs: [], allRuns: Object.hasOwn(row, 'allRuns') ? row.allRuns : [], trail });
const issueOf = (row) => ({ identifier: 'LIN-1', title: 'Gate fixture', description: '', state: row.state || STARTED, labels: [] });

function statusFor(row, url) {
  const number = Number(url.split('/').pop());
  return (row.merged || []).includes(number) ? merged(number) : open(number);
}

function seamFor(row, stopAt) {
  return {
    resolveProvider: () => ({ provider: { name: 'local', async fetchIssueComments() { return row.comments; } }, callScope: 'scope' }),
    readPrStatus: async ({ repo, number }) => statusFor(row, `https://github.com/${repo}/pull/${number}`),
    isStopAtRun: async () => stopAt
  };
}

async function routeLane(row, trail) {
  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => ({ ok: true, json: async () => SELECTOR_REPLY }));
  const rec = await getRecommendation(issueOf(row), context(row, trail), { apiKey: 'stub', model: 'x' });
  if (rec.codeRoute === 'blind-read' || rec.codeRoute === 'blocked') {
    assert.equal(rec.recommendedAction, rec.codeRoute, `row ${row.n}: the code route sends its own step`);
    return rec.codeRoute;
  }
  if (rec.codeRoute === 're-review') {
    assert.equal(rec.recommendedAction, 'review', `row ${row.n}: the re-review route sends review`);
    return rec.codeRoute;
  }
  assert.equal(rec.codeRoute, undefined, `row ${row.n}: no other code route fires`);
  return 'aside';
}

async function lanes(row) {
  // LIN-4518 step 3: the rows are records. Each row is seeded into its own store, and every lane reads that store.
  const recordsStore = await recordsStoreFor(harness);
  await seedTicketRecords(recordsStore, URL_KEY, 'LIN-1', row.events);
  const trail = await trailForTicket({ recordsStore, urlKey: URL_KEY, ticket: 'LIN-1' });
  const workspace = { urlKey: URL_KEY };
  const { state } = await readCloseOutChain({ openFindings: FINDINGS_NONE, workspace, issueIdentifier: 'LIN-1', seam: seamFor(row, 'pr'), stopAt: 'pr', runnerReady: true, owner: true, actor: 'harbour', prStatusCache: new Map(), recordsStore });
  // LIN-4458: the box is read the way the page reads it (readRunEvidence: one read, of the landing's sole PR).
  const box = (await readRunEvidence({ openFindings: FINDINGS_NONE, issueIdentifier: 'LIN-1', comments: [], urlKey: URL_KEY, recordsStore, readPrStatus: async ({ repo, number }) => statusFor(row, `https://github.com/${repo}/pull/${number}`), stopAt: 'pr', runnerReady: true, viewerIsOwner: true })).closeOut;
  const stopAtGuard = await closeOutNotReady({ openFindings: FINDINGS_NONE, workspace, issueIdentifier: 'LIN-1', seam: seamFor(row, 'pr'), recordsStore });
  const ladderGuard = await closeOutNotReady({ openFindings: FINDINGS_NONE, workspace, issueIdentifier: 'LIN-1', seam: seamFor(row, null), recordsStore });
  return { route: await routeLane(row, trail), state, box, stopAtGuard, ladderGuard, trail };
}

/** A box or state model that does not advertise a close-out the gate refuses. */
function notReadyForGate(model) {
  return model.ready === false && (model.reason === 'blind-read-missing' || ['merged', 'partial'].includes(model.status));
}

describe('the shared-trail table: every lane agrees (LIN-4438)', () => {
  for (const row of ROWS) {
    test(`row ${row.n}: ${row.name} → route ${row.route}, gate ${row.gate}`, async () => {
      const got = await lanes(row);
      assert.equal(got.route, row.route, `row ${row.n}: route`);
      if (row.gate === 'wait') {
        assert.equal(got.stopAtGuard?.reason, 'blind-read-missing', `row ${row.n}: the stop-at guard refuses`);
        assert.equal(got.ladderGuard?.reason, 'blind-read-missing', `row ${row.n}: the ladder guard refuses`);
        assert.ok(notReadyForGate(got.state), `row ${row.n}: the stop-at state is not ready: ${got.state.status}/${got.state.reason}`);
        assert.ok(notReadyForGate(got.box), `row ${row.n}: the page box is not ready: ${got.box.status}/${got.box.reason}`);
        // LIN-4439 blind read: one builder, so both guard lanes refuse with the box model's shape.
        const keys = (m) => Object.keys(m).sort();
        assert.deepEqual(keys(got.stopAtGuard), keys(got.state), `row ${row.n}: the stop-at refusal is a box model`);
        assert.deepEqual(keys(got.ladderGuard), keys(got.stopAtGuard), `row ${row.n}: both lanes refuse with one shape`);
        assert.equal(got.stopAtGuard.setDone, false, `row ${row.n}: a refusal sets nothing`);
      } else {
        assert.equal(got.stopAtGuard, null, `row ${row.n}: the stop-at guard admits`);
        assert.equal(got.ladderGuard, null, `row ${row.n}: the ladder guard admits`);
        assert.notEqual(got.state.reason, 'blind-read-missing', `row ${row.n}: state`);
        assert.notEqual(got.box.reason, 'blind-read-missing', `row ${row.n}: box`);
      }
      if (row.ready) {
        assert.equal(got.state.status, 'ready', `row ${row.n}: the state is ready`);
        assert.equal(got.box.status, 'ready', `row ${row.n}: the box is ready`);
      }
      if (row.landing) assert.deepEqual([...got.trail.landing].sort(), [...row.landing].sort(), `row ${row.n}: the landing, written down`);
    });
  }
});

describe('rows that need more than the lanes', () => {
  test('row 11: the plain link comment is a change after review, so the facts show work after it and the predicate waits', async () => {
    const row = ROWS.find(r => r.n === 11);
    const trail = await trailOfEvents(row.events);
    const facts = assembleTrailFacts(row.comments, '', { leaf: false, trail });
    assert.equal(isPersonComment(LINK_BODY), false, 'never read as a person waiting for an answer');
    assert.equal(facts.workAfterReview, true, 'the selector facts show work after review');
    assert.equal(facts.closeOutAfterReview, false);
    assert.equal(closeOutWaitsOn(trail.review, trail.landing), 'blind-read');
    assert.deepEqual([...trail.landing].sort(), [PR1, PR2]);
  });

  // Flipped on purpose by LIN-4458: before it, the audit's re-cite of the merged PR1 joined the notes
  // PR's landing, so the read had to name both. One classifier gives an audit only the PRs it is the
  // first to cite, so the notes PR's landing is PR2 alone.
  test('row 14: the audit re-cites the merged landing PR, and the notes PR\'s read names the notes PR alone (flipped by LIN-4458)', async () => {
    const row = ROWS.find(r => r.n === 14);
    const trail = await trailOfEvents(row.events);
    assert.deepEqual(trail.landing, [PR2]);
    assert.equal(closeOutWaitsOn({ ...trail.review, blindRead: { prs: [PR2] } }, trail.landing), null, 'a read of the notes PR alone clears it');
    assert.equal(closeOutWaitsOn({ ...trail.review, blindRead: { prs: [PR1] } }, trail.landing), 'blind-read', 'a read of the merged landing alone does not');
    // The prompt names the landing's change records (LIN-4518 step 3, finding 75b33054): the notes PR's change alone.
    const prompt = generatePrompt('blind-read', issueOf(row), { ...context(row, trail), landingChanges: [{ id: 'change-notes', ref: PR2, head: REVIEWED }] }).prompt;
    assert.ok(prompt.includes(`**The change:** ${PR2}`) && !prompt.includes(`**The change:** ${PR1}`), 'the reader is told to read the notes PR only');
  });
});

describe('the route\'s own edges', () => {
  const approved = [evPr(1), evReview(2)];

  test('a Canceled or Duplicate ticket stands aside; a Done ticket stands aside unless an audit\'s notes PR reads after it', async () => {
    const trail = await trailOfEvents(approved);
    for (const type of ['canceled', 'duplicate']) {
      assert.equal(blindReadStep({ state: { type } }, { trail, allRuns: [] }), null, type);
    }
    // Row 196, first half (flipped by LIN-4460): a person set the ticket Done outside Harbour and the trail holds
    // no close-out on its landing, so Harbour follows and sends no read to a Done ticket.
    assert.equal(blindReadStep({ state: DONE }, { trail, allRuns: [] }), null, 'Done with no close-out on the landing: the person\'s Done stands');
    // Row 196, second half (unchanged): a close-out after the review.
    const closed = await trailOfEvents([evPr(1), evReview(2), evClose(3), evMerged(3, PR1)]);
    assert.equal(blindReadStep({ state: DONE }, { trail: closed, allRuns: [] }), null, 'Done, closed out after the review, no read: stands aside');
    // Added by LIN-4460: an audit's notes PR opened after Done still gets its read (its own review comes after the close-out).
    const audited = await trailOfEvents([evPr(1), evReview(2), evClose(3), evMerged(3, PR1), evAudit(4, PR2), evReview(5, 'approve', PR2)]);
    assert.equal(blindReadStep({ state: DONE }, { trail: audited, allRuns: [] }).step, 'blind-read', 'a post-Done audit notes PR is still read');
  });

  test('a live blind read is not an ended attempt; with no read on record, every ended attempt counts, across a review (LIN-4544)', async () => {
    assert.equal(BLIND_READ_ATTEMPT_BOUND, 2);
    const trail = await trailOfEvents(approved);
    const step = (allRuns) => blindReadStep({ state: STARTED }, { trail, allRuns }).step;
    assert.equal(step([run('blind-read', 3, 'done')]), 'blind-read', 'one ended attempt');
    assert.equal(step([run('blind-read', 3, 'done'), { ...run('blind-read', 4, 'running') }]), 'blind-read', 'one ended, one live');
    assert.equal(step([run('blind-read', 0, 'done'), run('blind-read', 1, 'failed'), run('blind-read', 3, 'done')]), 'blocked', 'no read on record: the attempts before the review count too');
    for (const outcome of ['skipped', 'aborted', 'closed', 'waiting on a person']) {
      assert.equal(step([run('blind-read', 3, 'done'), run('blind-read', 4, outcome)]), 'blocked', outcome);
    }
  });

  test('a read written before the review names the landing and stands: no second read is sent (LIN-4544)', async () => {
    const trail = await trailOfEvents([evPr(1), evRead(2, PR1), evReview(3)]);
    assert.equal(blindReadStep({ state: STARTED }, { trail, allRuns: [] }), null);
  });
});

describe('a Survey report is not landing work, for the trail facts as for the landing (LIN-4438 leftovers)', () => {
  const survey = (n) => c(n, `${SURVEY_HEADINGS['survey-task']}: LIN-1 @ abc123def\n\nAn earlier attempt is ${PR_OLD}; start from it.`);

  test('a Survey after the review is not work after review, and the landing skips it', async () => {
    // The Survey is a run of its stage (LIN-4520: runs decide); it writes no change, so the landing is the review's PR alone.
    const trail = await trailOfEvents([evPr(1), evReview(2), evRun('survey-task', 3, 'done')]);
    assert.equal(assembleTrailFacts([summary(1), review(2), survey(3)], '', { leaf: false, trail }).workAfterReview, false);
    assert.deepEqual(trail.landing, [PR1]);
  });

  test('a Survey after a plan-review verdict is not landed work', () => {
    const verdictRun = planReviewRunOf({ verdicts: [planRound(T(1), 'request-changes').verdict], findings: [] });
    assert.equal(assembleTrailFacts([survey(2)], '', { planReviewRun: verdictRun }).planReview.landed, null);
  });
});
