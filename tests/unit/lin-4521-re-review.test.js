/**
 * LIN-4521 (P8 of LIN-4513, ruling 1 = yes: close-out's own commits stale the approval, so the work goes back to review
 * rather than merging). Witnesses:
 *   - reReviewStep (lib/recommendation-re-review.js) sends `review` when closeOutDecision's `routesReview` says an approving
 *     review's open landing change moved since it was judged (the trail's `movedUrls`), and stands aside otherwise: a merged
 *     PR (stale, not moved), a terminal ticket, no approve;
 *   - CODE_ROUTES holds the route after review-bound and before blind-read, so a stale approval is re-reviewed before a
 *     blind read is sent for it, and the selector is never asked (a fetch that throws proves it);
 *   - the blind read stands aside while the approval is stale (its own routesRead rule), so it is not sent for a head
 *     nobody has reviewed.
 * The trail is the shape trailOfStanding produces (lib/records/standing.js); the stale-URL production is witnessed in
 * tests/unit/lin-4518-standing.test.js (witness 10 and 11), so this file does not rebuild the store.
 */
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_ROUTES } from '../../lib/code-routes.js';
import { reReviewStep } from '../../lib/recommendation-re-review.js';
import { blindReadStep } from '../../lib/recommendation-blind-read.js';
import { closeOutDecision } from '../../lib/run-closeout-state.js';
import { findingsNotRead } from '../../lib/close-out-findings.js';
import { readFileSync } from 'node:fs';
import { getRecommendation, setFetchImpl, setPromptTraceRecorder } from '../../lib/openrouter.js';

afterEach(() => { setFetchImpl(null); setPromptTraceRecorder(null); });

const REPO = 'acme/widget';
const PR1 = `https://github.com/${REPO}/pull/41`;
const PR2 = `https://github.com/${REPO}/pull/42`;
const REVIEWED = 'aaaaaaa1111111';
const T = (n) => `2026-11-22T${String(n).padStart(2, '0')}:00:00.000Z`;
const STARTED = { name: 'In Progress', type: 'started' };
const issue = { identifier: 'LIN-4521', state: STARTED, description: '' };
const issueIn = (type) => ({ identifier: 'LIN-4521', state: { name: type, type }, description: '' });

/**
 * An approving review on PR1 (judged at REVIEWED), with the given stale PRs and no blind read yet. `movedUrls` (the stale
 * PRs whose change is still open, lib/records/standing.js) defaults to the stale ones: a merged PR is passed explicitly.
 */
const trailOf = ({ verdict = 'approve', staleUrls = [], movedUrls = staleUrls, landing = [PR1], blindRead = null, landingHasNotesPr = false } = {}) => ({
  review: { verdict, at: T(2), sha: REVIEWED, heads: { [PR1]: REVIEWED }, commentId: 'review-1', blindRead, staleUrls, movedUrls },
  landing,
  // trailOfStanding sets workAfterReview from the stale flag: a stale approval is work after the review.
  workAfterReview: staleUrls.length > 0,
  closeOutAfterReview: false,
  closeOutOnTrail: false,
  landingHasNotesPr,
  notesPrs: [],
  auditAfterCloseOut: false,
});

const entry = (name) => {
  const found = CODE_ROUTES.find(r => r.name === name);
  assert.ok(found, `CODE_ROUTES has no entry named ${name}`);
  return found;
};

describe('reReviewStep: an approval whose landing PR moved is sent back to review', () => {
  test('an approve, with a landing PR the review judged at an older head, sends review (codeRoute re-review)', () => {
    const got = reReviewStep(issue, { trail: trailOf({ staleUrls: [PR1] }) });
    assert.equal(got?.step, 'review');
    assert.equal(got?.codeRoute, 're-review');
    assert.ok(got.why.includes(PR1), 'the why names the PR that moved');
  });

  test('a current approval (no stale PR) stands aside', () => {
    assert.equal(reReviewStep(issue, { trail: trailOf() }), null);
  });

  test('a review that is not an approve stands aside: its own verdict decides what happens next', () => {
    assert.equal(reReviewStep(issue, { trail: trailOf({ verdict: 'request-changes', staleUrls: [PR1] }) }), null);
  });

  test('a stale PR outside the landing stands aside (an abandoned or unlanded change is not re-reviewed)', () => {
    assert.equal(reReviewStep(issue, { trail: trailOf({ staleUrls: [PR2] }) }), null);
  });

  test('a two-PR landing with one moved PR still sends review, and the why names only the moved one', () => {
    const trail = trailOf({ landing: [PR1, PR2], staleUrls: [PR2] });
    const got = reReviewStep(issue, { trail });
    assert.equal(got?.codeRoute, 're-review');
    assert.ok(got.why.includes(PR2) && !got.why.includes(PR1), 'the why names the moved PR and not the unmoved one');
  });

  test('no trail (not read) stands aside; the route never guesses from comments', () => {
    assert.equal(reReviewStep(issue, { trail: null }), null);
    assert.equal(reReviewStep(issue, {}), null);
  });

  test('a PR merged after the push (stale, but not an open change that moved) stands aside: it cannot be re-judged before its merge', () => {
    assert.equal(reReviewStep(issue, { trail: trailOf({ staleUrls: [PR1], movedUrls: [] }) }), null);
  });

  test('a terminal ticket stands aside (Canceled, Duplicate, or Done: Harbour follows the person), as the blind read does', () => {
    const trail = trailOf({ staleUrls: [PR1] });
    for (const type of ['canceled', 'completed']) assert.equal(reReviewStep(issueIn(type), { trail }), null, type);
  });

  test('a Done ticket whose landing is an audit notes PR is still re-reviewed, as it still gets its blind read', () => {
    const got = reReviewStep(issueIn('completed'), { trail: trailOf({ staleUrls: [PR1], landingHasNotesPr: true }) });
    assert.equal(got?.codeRoute, 're-review');
  });
});

describe('closeOutDecision owns the answer (routesReview), as it owns routesRead', () => {
  const decide = (trail, ticketState = 'started') => closeOutDecision({ trail, ticketState, openFindings: findingsNotRead('advice only') });

  test('routesReview and movedPrs: true with the moved landing PRs, false and empty otherwise', () => {
    const moved = decide(trailOf({ landing: [PR1, PR2], staleUrls: [PR2] }));
    assert.equal(moved.routesReview, true);
    assert.deepEqual(moved.movedPrs, [PR2]);
    for (const trail of [trailOf(), trailOf({ verdict: 'request-changes', staleUrls: [PR1] }), trailOf({ staleUrls: [PR1], movedUrls: [] })]) {
      const d = decide(trail);
      assert.equal(d.routesReview, false);
      assert.deepEqual(d.movedPrs, []);
    }
    assert.equal(decide(trailOf({ staleUrls: [PR1] }), 'canceled').routesReview, false);
  });

  test('the route only delegates: it fires exactly when the decision routes a review', () => {
    for (const trail of [trailOf(), trailOf({ staleUrls: [PR1] }), trailOf({ staleUrls: [PR1], movedUrls: [] }), trailOf({ staleUrls: [PR2] })]) {
      assert.equal(reReviewStep(issue, { trail }) !== null, decide(trail).routesReview);
    }
    const source = readFileSync(new URL('../../lib/recommendation-re-review.js', import.meta.url), 'utf8');
    assert.ok(!/staleUrls|movedUrls|isApprovedReview/.test(source), 'lib/recommendation-re-review.js spells no rule of its own');
  });
});

describe('CODE_ROUTES: the re-review route sits between review-bound and blind-read', () => {
  test('the order is live-wait, review-bound, re-review, blind-read, look-first', () => {
    assert.deepEqual(CODE_ROUTES.map(r => r.name), ['live-wait', 'review-bound', 're-review', 'blind-read', 'look-first']);
  });

  test('re-review declares its trace value', () => {
    assert.deepEqual(entry('re-review').emits, ['re-review']);
  });

  test('the entry delegates to reReviewStep: its reason is written once, beside the rule', () => {
    const trail = trailOf({ staleUrls: [PR1] });
    const step = reReviewStep(issue, { trail });
    assert.deepEqual(entry('re-review').route(issue, { trail }), { action: step.step, codeRoute: step.codeRoute, why: step.why });
    assert.equal(entry('re-review').route(issue, { trail: trailOf() }), null);
  });
});

describe('the blind read waits for a re-review of a stale approval', () => {
  test('blind-read stands aside while the approval is stale, even with no read on record', () => {
    assert.equal(blindReadStep(issue, { trail: trailOf({ staleUrls: [PR1] }), allRuns: [] }), null);
  });

  test('once the approval is current and no read is on record, blind-read is sent (the same route as before)', () => {
    assert.equal(blindReadStep(issue, { trail: trailOf(), allRuns: [] })?.codeRoute, 'blind-read');
  });
});

describe('getRecommendation: a stale approval is settled by code, never by the selector', () => {
  test('the ticket with a stale approval gets review with codeRoute re-review, and no selector call', async () => {
    const seen = [];
    setPromptTraceRecorder(() => {});
    setFetchImpl(async (...args) => { seen.push(args); throw new Error('a code route must settle this without asking the selector'); });
    const rec = await getRecommendation(issue, {
      comments: [], allRuns: [], trail: trailOf({ staleUrls: [PR1] }),
    }, { apiKey: 'stub', model: 'x' });
    assert.equal(seen.length, 0, 'the selector was not asked');
    assert.equal(rec.codeRoute, 're-review');
    assert.equal(rec.recommendedAction, 'review');
  });

  test('the same ticket with a current approval is not settled by this route (blind-read is sent instead)', async () => {
    setPromptTraceRecorder(() => {});
    setFetchImpl(async () => { throw new Error('a code route must settle this without asking the selector'); });
    const rec = await getRecommendation(issue, {
      comments: [], allRuns: [], trail: trailOf(),
    }, { apiKey: 'stub', model: 'x' });
    assert.equal(rec.codeRoute, 'blind-read');
  });
});
