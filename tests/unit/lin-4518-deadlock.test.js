/**
 * LIN-4518 (P5 of LIN-4513, beat 1): the LIN-4499 deadlock, fixed at its cause, and the no-verdict routing witness.
 *
 * The deadlock. Close-out's gate is a blind read on record. Close-out parked on that gate is a stage run that is queued or
 * running, so the live-stage wait (CODE_ROUTES[0], lib/run-live-wait.js) held the ticket on it, ahead of the blind-read
 * route that would have sent the read. Nothing ended the parked run, so the read was never sent, and close-out could not
 * merge without it. The cause lived in CODE_ROUTES[0]: it counted a parked close-out as work in progress. The fix is in the
 * live-wait route: a close-out whose gate the record does not clear yet does not hold the ticket (lib/recommendation-blind-
 * read.js closeOutGateHeld). The comment path's answer is frozen in tests/helpers/comment-path-frozen.js and the goldens
 * (seed 2 freezes live-wait), so the witness states both answers.
 *
 * The second half of the same seed (LIN-4499 at 22:14): a note cites a PR the review did not hold. On the comment path that
 * note was work after review, so the read stood aside too; on records a PR is work only when a change record is written for
 * it (lib/records/standing.js), so this witness states the work-after-review case with a change written after the review.
 *
 * Run with: node --test tests/unit/lin-4518-deadlock.test.js
 */
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { standingOfComments } from '../helpers/records-trail.js';
import { frozenRouteOf } from '../helpers/comment-path-frozen.js';
import { assembleTrailFacts, formatTrailFactsBlock } from '../../lib/recommendation-facts.js';
import { closeOutGateHeld } from '../../lib/recommendation-blind-read.js';
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const T = (hhmm) => `2026-11-20T${hhmm}:00.000Z`;
const HEAD = '9c7aac662a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
const STARTED = { name: 'In Progress', type: 'started' };
const SELECTOR_REPLY = { choices: [{ message: { content: '## Reasoning\n→ **close-out**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } };

/** The implementation's summary, citing its PR (a landing carrier before the review). */
const summary = (id, at, n) => ({ id, createdAt: T(at), body: `Implementation done: ${PR(n)}, CI green.` });
/** A review that approves the landing at its head, naming the PR in full. */
const review = (id, at, n) => ({
  id, createdAt: T(at),
  body: `## Code Review\n\nReviewed head \`${HEAD.slice(0, 9)}\` of ${PR(n)}.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | a repro |\n\n**Verdict: Approve**`,
});
/** A parked close-out run, as the dispatch facts read it: running, dispatched at `hhmm`. */
const closeOutRunning = (hhmm) => ({ id: 'run-close-out', stage: 'close-out', outcome: 'running', at: T(hhmm), dispatchedAt: T(hhmm) });
const reviewDone = (hhmm) => ({ id: 'run-review', stage: 'review', outcome: 'done', at: T(hhmm), dispatchedAt: T(hhmm) });

/** The recommendation's route for a ticket, through getRecommendation with the selector stubbed to answer close-out. */
async function routeOf({ comments, allRuns, standing }) {
  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => ({ ok: true, json: async () => SELECTOR_REPLY }));
  try {
    const rec = await getRecommendation(
      { identifier: 'LIN-1', title: 'Gate fixture', description: '', state: STARTED, labels: [] },
      { parent: null, siblings: [], project: null, children: [], comments, focusedChild: null, attachments: [], runs: [], allRuns, standing },
      { apiKey: 'stub', model: 'x' },
    );
    return { codeRoute: rec.codeRoute ?? null, recommendedAction: rec.recommendedAction ?? null, liveWait: rec.liveWait ?? null };
  } finally {
    setFetchImpl(null);
    setPromptTraceRecorder(null);
  }
}

describe('LIN-4499 deadlock: a close-out parked on the blind read does not hold the ticket (LIN-4518)', () => {
  // The approving review on the landing PR, with a close-out parked (running) and no read on record.
  const comments = [summary('c1', '21:00', 2478), review('c2', '22:08', 2478)];
  const allRuns = [reviewDone('22:08'), closeOutRunning('22:10')];

  test('records: the blind-read route sends the read; the parked close-out does not hold the ticket', async () => {
    const standing = standingOfComments(comments, { statuses: { [PR(2478)]: { readable: true, state: 'open', merged: false, head: { sha: HEAD }, checks: [] } } });
    assert.equal(closeOutGateHeld({ standing }), true, 'the approval is on record and the read is not: close-out is gated');
    assert.deepEqual(await routeOf({ comments, allRuns, standing }), { codeRoute: 'blind-read', recommendedAction: 'blind-read', liveWait: null });
  });

  test('the frozen comment path answered live-wait for the same trail (the goldens freeze it, seed 2)', () => {
    const route = frozenRouteOf({ identifier: 'LIN-1', state: STARTED }, { comments, allRuns });
    assert.equal(route?.codeRoute, 'live-wait');
  });

  test('a live blind read still holds the ticket: only the parked close-out steps aside', async () => {
    const withRead = [...comments, { id: 'c3', createdAt: T('22:12'), body: `## Blind read\nVerdict: same. It gave the gate one owner and left nothing worse.\n\nRead: ${PR(2478)} at \`${HEAD.slice(0, 9)}\` against \`000000000\`.\n\n### Inside the area, fix-sized\nNone.` }];
    const runs = [...allRuns, { id: 'run-blind', stage: 'blind-read', outcome: 'running', at: T('22:12'), dispatchedAt: T('22:12') }];
    const standing = standingOfComments(withRead, { statuses: { [PR(2478)]: { readable: true, state: 'open', merged: false, head: { sha: HEAD }, checks: [] } } });
    const route = await routeOf({ comments: withRead, allRuns: runs, standing });
    assert.equal(route.codeRoute, 'live-wait', 'a read in flight is work in progress: the ticket waits on it');
    assert.equal(route.liveWait.kind, 'blind-read');
  });

  test('work after the review on records: close-out steps aside, and the selector is asked (review goes first)', async () => {
    // A PR the review did not hold, with a change written after the review (a new change record, not a comment).
    const later = [...comments, { id: 'c3', createdAt: T('22:14'), body: `Fix pushed: ${PR(2479)}.` }];
    const versions = standingOfComments(later, { statuses: { [PR(2478)]: { readable: true, state: 'open', merged: false, head: { sha: HEAD }, checks: [] }, [PR(2479)]: { readable: true, state: 'open', merged: false, head: { sha: 'aaaaaaa111' }, checks: [] } } });
    assert.equal(versions.workAfterReview, true, 'a change first written after the review is work after it');
    const route = await routeOf({ comments: later, allRuns, standing: versions });
    assert.notEqual(route.codeRoute, 'live-wait', 'the parked close-out must not hold the ticket when the selector has to send review first');
    assert.equal(route.codeRoute, null, 'no code route: the selector is asked, and review comes first');
  });
});

describe('a task with no verdict record routes to review (LIN-4518 witness)', () => {
  test('no review on record: the code routes stand aside, and the selector is told there is no review', async () => {
    const comments = [summary('c1', '21:00', 2478)];
    const standing = standingOfComments(comments, { statuses: { [PR(2478)]: { readable: true, state: 'open', merged: false, head: { sha: HEAD }, checks: [] } } });
    assert.equal(standing.review, null, 'no verdict record: no review on record');
    assert.equal(closeOutGateHeld({ standing }), false, 'no approval, so no gate');
    assert.deepEqual(await routeOf({ comments, allRuns: [], standing }), { codeRoute: null, recommendedAction: 'close-out', liveWait: null }, 'the stub stands for the selector');
    // The selector's own facts say what the records say: no review, so its landed-work rule sends review.
    const facts = assembleTrailFacts(comments, '', { leaf: true, openFindings: FINDINGS_NONE, standing });
    assert.equal(facts.review, null);
    assert.match(formatTrailFactsBlock(facts, comments.length), /Latest code review: none/);
  });

  test('records not read: the facts say not measured, never none', () => {
    const comments = [summary('c1', '21:00', 2478)];
    const facts = assembleTrailFacts(comments, '', { leaf: true, openFindings: FINDINGS_NONE, standing: null });
    assert.match(formatTrailFactsBlock(facts, comments.length), /Latest code review: not measured/);
  });
});
