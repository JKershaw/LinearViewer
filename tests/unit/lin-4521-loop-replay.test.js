/**
 * LIN-4521 (P8 of LIN-4513): the loop, replayed on the real records store. The Done-when is "a task can hand back from
 * close-out, get reviewed again, and finish at the reviewed head without getting stuck", and each piece is witnessed alone
 * in tests/unit/lin-4521-re-review.test.js on hand-built trails; this file composes them through the store the gates read
 * (tests/helpers/records-scenario.js, trailForTicket, getRecommendation, closeOutDecision), as the live loop would.
 *
 *   - the loop (finding-c898b6cc): approve at H1, blind read, close-out, a push to H2 -> code sends the re-review and the
 *     press is refused head-moved; a review at H2 -> the read on record stands (LIN-4544), so no code route is sent and the
 *     selector decides; the read of H2 -> the selector is asked too and the press is not refused;
 *   - a PR opened after the approval (finding-3df7a963): the review never judged it, so it is re-reviewed as a moved head
 *     is, not left to the selector and a refusing close-out;
 *   - a Done ticket whose landing is an audit notes PR, with a close-out on the trail: neither advice answer routes
 *     (finding-3d0569b8: one shared ticket guard).
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4521-loop-replay.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { seededRecordsStore, ev } from '../helpers/records-scenario.js';
import { trailForTicket } from '../../lib/task-standing.js';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';
import { closeOutDecision, CLOSE_OUT_ACTOR } from '../../lib/run-closeout-state.js';
import { FINDINGS_NONE, findingsNotRead } from '../../lib/close-out-findings.js';

const harness = createMangoTmpdir('lin-4521-loop-replay-');
before(() => harness.connect());
after(() => harness.close());

const REPO = 'acme/widget';
const PR = (n) => `https://github.com/${REPO}/pull/${n}`;
const A = PR(41);
const N = PR(42);
const H1 = 'aaaaaaa1111111';
const H2 = 'bbbbbbb2222222';
const STARTED = { name: 'In Progress', type: 'started' };
const ISSUE = { identifier: 'LIN-1', title: 'Loop replay fixture', description: '', state: STARTED, labels: [] };

const open = (url, sha) => ({ readable: true, repo: REPO, number: Number(url.split('/').pop()), state: 'open', merged: false, head: { ref: 'f', sha }, ref: sha, checks: [] });

/** The gate's trail for `events`, read from a fresh store. */
async function trailOf(events) {
  const store = await seededRecordsStore(harness, events, { urlKey: 'acme', tickets: ['LIN-1'] });
  return trailForTicket({ recordsStore: store, urlKey: 'acme', ticket: 'LIN-1' });
}

/** What the recommendation answers for `trail`: the selector is stubbed, and `asked` counts its calls. */
async function recommend(trail, asked) {
  setPromptTraceRecorder(() => {});
  setFetchImpl(async () => {
    asked.n += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **close-out**' }, finish_reason: 'stop' }], usage: {} }) };
  });
  try {
    return await getRecommendation(ISSUE, { parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null, attachments: [], runs: [], allRuns: [], trail }, { apiKey: 'stub', model: 'x' });
  } finally {
    setFetchImpl(null);
    setPromptTraceRecorder(null);
  }
}

/** Close-out's press: the guard at the live heads `statuses` (PR URL -> sha). */
const press = (trail, statuses) => closeOutDecision({
  trail, prStatuses: new Map(Object.entries(statuses).map(([url, sha]) => [url, open(url, sha)])),
  stopAt: 'pr', runnerReady: true, actor: CLOSE_OUT_ACTOR.HARBOUR, openFindings: FINDINGS_NONE,
});

describe('the loop: close-out pushes, review judges again, the one blind read stands, the merge is at the reviewed head', () => {
  const approved = [ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.read(3, A), ev.close(4)];

  test('step 1: approve at H1, read, close-out done, a push to H2: code sends the re-review, and the press is refused head-moved', async () => {
    const trail = await trailOf([...approved, ev.head(5, A, H2)]);
    const asked = { n: 0 };
    const rec = await recommend(trail, asked);
    assert.equal(rec.codeRoute, 're-review');
    assert.equal(rec.recommendedAction, 'review');
    assert.equal(asked.n, 0, 'the selector was not asked');
    assert.equal(press(trail, { [A]: H2 }).refuses, 'head-moved');
  });

  test('step 2: a review of H2: the approval is current, and the read on record stands, so no read is sent for it (LIN-4544)', async () => {
    const trail = await trailOf([...approved, ev.head(5, A, H2), ev.review(6, A, { heads: { [A]: H2 } })]);
    const asked = { n: 0 };
    const rec = await recommend(trail, asked);
    assert.equal(rec.codeRoute, undefined, 'no code route: the read covering the landing is on record');
    assert.equal(asked.n, 1, 'the selector was asked');
    assert.deepEqual(trail.review.staleUrls, [], 'the new approval is not stale');
  });

  test('step 3: the blind read of H2: no code route, the selector decides, and the press is not refused at H2', async () => {
    const trail = await trailOf([...approved, ev.head(5, A, H2), ev.review(6, A, { heads: { [A]: H2 } }), ev.read(7, A)]);
    const asked = { n: 0 };
    const rec = await recommend(trail, asked);
    assert.equal(rec.codeRoute, undefined, 'no code route settles it');
    assert.equal(asked.n, 1, 'the selector was asked');
    assert.equal(press(trail, { [A]: H2 }).refuses, null);
  });

  test('a close-out that pushes again after the re-review hands back again: the loop does not stop at one round', async () => {
    const trail = await trailOf([...approved, ev.head(5, A, H2), ev.review(6, A, { heads: { [A]: H2 } }), ev.read(7, A), ev.close(8), ev.head(9, A, 'ccccccc3333333')]);
    const rec = await recommend(trail, { n: 0 });
    assert.equal(rec.codeRoute, 're-review');
  });
});

describe('a PR opened after the approval is re-reviewed (finding-3df7a963)', () => {
  const events = [ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.read(3, A), ev.close(4), ev.pr(5, N, H2)];

  test('the landing holds both PRs, the review judged only the first, and code sends the re-review without asking the selector', async () => {
    const trail = await trailOf(events);
    assert.deepEqual([...trail.landing].sort(), [A, N].sort());
    assert.equal(trail.workAfterReview, true);
    assert.deepEqual(trail.review.movedUrls, [N], 'the PR the review never saw is the one to judge; the judged one has not moved');
    const asked = { n: 0 };
    const rec = await recommend(trail, asked);
    assert.equal(rec.codeRoute, 're-review');
    assert.equal(rec.recommendedAction, 'review');
    assert.equal(asked.n, 0, 'the selector was not asked');
    assert.ok(press(trail, { [A]: H1, [N]: H2 }).refuses, 'close-out is refused until the new PR is judged and read');
  });

  test('a new PR that merged or was abandoned before the re-review is not sent to review', async () => {
    for (const end of [ev.merged(6, N), ev.abandoned(6, N)]) {
      const trail = await trailOf([...events, end]);
      assert.deepEqual(trail.review.movedUrls, [], `a ${end.kind} PR is not re-judged`);
    }
  });

  test('once a review judges it, the approval is current again', async () => {
    const trail = await trailOf([...events, ev.review(6, [A, N], { heads: { [A]: H1, [N]: H2 } })]);
    assert.deepEqual(trail.review.movedUrls, []);
    assert.deepEqual(trail.review.staleUrls, []);
  });
});

describe('one ticket guard for both advice answers (finding-3d0569b8)', () => {
  const advice = (trail, type) => closeOutDecision({ trail, ticketState: type, openFindings: findingsNotRead('advice only') });

  test('a Done ticket whose landing is an audit notes PR: routed while no close-out is on the trail, and not once one is', async () => {
    const base = [ev.pr(1, A, H1), ev.review(2, A, { heads: { [A]: H1 } }), ev.audit(3, N, H1), ev.head(4, A, H2)];
    const noCloseOut = await trailOf(base);
    assert.equal(noCloseOut.landingHasNotesPr, true);
    assert.equal(advice(noCloseOut, 'completed').routesReview, true, 'a Done ticket with a notes PR and no close-out is re-reviewed');
    // The blind read stands aside on a close-out on the trail; the re-review must too, the guard being one predicate.
    const closed = { ...noCloseOut, closeOutOnTrail: true };
    const d = advice(closed, 'completed');
    assert.equal(d.routesRead, false);
    assert.equal(d.routesReview, false, 'routesReview stands aside exactly where routesRead does');
  });
});
