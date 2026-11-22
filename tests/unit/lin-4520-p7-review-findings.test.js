// LIN-4520 (P7 of LIN-4513): the review's findings on PR #2495, each pinned by a test that fails on the code the review saw.
//
//   e79dcdd5  headMovedFor has no comment branch; the evidence box's "Now" row reads the same per-PR rule as close-out.
//   9058b84e  close-out refuses on a PR the stale flag names, even when its live head is the one the review judged.
//   9d0c053a  the share page's close-out quote is the close-out run's account, not a comment.
//   a610ceb9  the fix-round brief section is retired; the workflow points at the task's open findings and change.
//   ca44ecba  landed work is a change record version that wrote a head after an instant, not a verdict-looking comment (the
//             loop and the selector's acted-after read it; next-stage-choice.test.js pins the loop repro).
//   2f1e89d3  promptContextOf carries reviewRound (lin-4518-step2-witnesses.test.js runs the three entrances end to end).
//   5d38c050  a revision pushed to an existing PR is landed work since the verdict or comment before it (every head-writing
//             version counts, not the first write only; lin-4520-landed-work-store.test.js pins the store's dating).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FINDINGS_NONE } from '../../lib/close-out-findings.js';
import { buildRunEvidence, closeOutSummaryFor } from '../../lib/run-evidence.js';
import { closeOutDecision, headMovedFor } from '../../lib/run-closeout-state.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { formatStageContract } from '../../lib/prompt-contract.js';
import { loopFactsOf } from '../../lib/recommendation-facts.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { promptContextOf } from '../../lib/prompts/prompt-context.js';
import { buildImplementationWorkflow, reviewRoundOf } from '../../lib/prompts/fix-round.js';

const PR_A = 'https://github.com/acme/widget/pull/12';
const HEAD_A = 'aaaa111';
const HEAD_MOVED = 'bbbb222';

// A records trail (trailOfStanding's shape): the review judged PR_A at HEAD_A, and the landing is PR_A.
const trailOf = ({ review = null, landing = [PR_A] } = {}) => ({
  review, landing, workAfterReview: false, closeOutAfterReview: false, closeOutOnTrail: false,
  landingHasNotesPr: false, notesPrs: [], auditAfterCloseOut: false,
});
const approvedReview = (over = {}) => ({
  verdict: 'approve', at: '2026-07-01T10:00:00.000Z', sha: null, heads: { [PR_A]: HEAD_A }, staleUrls: [], commentId: 'verdict-1',
  blindRead: { prs: [PR_A], verdict: 'same', at: '2026-07-01T11:00:00.000Z', commentId: 'read-1' },
  ...over,
});
const openStatus = (sha) => ({ readable: true, state: 'open', merged: false, number: 12, repo: 'acme/widget', head: { ref: 'x', sha }, ref: sha, checks: [] });

describe('e79dcdd5: headMovedFor reads records only (the comment sha branch is retired)', () => {
  test('a review with no heads judged no head, so it has moved', () => {
    assert.equal(headMovedFor(PR_A, HEAD_A, { sha: HEAD_A }), true, 'the sha-only comment branch is gone');
    assert.equal(headMovedFor(PR_A, HEAD_A, {}), true);
  });

  test('the judged head is current: not moved; a moved head, a stale flag or an unjudged PR is moved', () => {
    assert.equal(headMovedFor(PR_A, HEAD_A, { heads: { [PR_A]: HEAD_A }, staleUrls: [] }), false);
    assert.equal(headMovedFor(PR_A, HEAD_MOVED, { heads: { [PR_A]: HEAD_A }, staleUrls: [] }), true);
    assert.equal(headMovedFor(PR_A, HEAD_A, { heads: { [PR_A]: HEAD_A }, staleUrls: [PR_A] }), true, 'the stale flag moves it');
    assert.equal(headMovedFor('https://github.com/acme/widget/pull/99', HEAD_A, { heads: { [PR_A]: HEAD_A }, staleUrls: [] }), true);
  });
});

describe('e79dcdd5: the evidence box\'s "Now" row takes headMoved from the same per-PR rule as close-out', () => {
  const box = (review, headSha = HEAD_A) => buildRunEvidence({
    openFindings: FINDINGS_NONE,
    issueIdentifier: 'LIN-1',
    comments: [{ body: `Opened ${PR_A}`, createdAt: '2026-07-01T09:00:00.000Z' }],
    prStatus: openStatus(headSha),
    trail: trailOf({ review, landing: [PR_A] }),
  });

  test('a records review whose PR a later revise staled reads moved in the box, as close-out reads it', () => {
    const review = approvedReview({ staleUrls: [PR_A] });
    const evidence = box(review, HEAD_A);
    assert.equal(evidence.evidence.checked.now.headMoved, true, 'the box says the code changed since the review');
    const decision = closeOutDecision({ trail: trailOf({ review, landing: [PR_A] }), prStatuses: new Map([[PR_A, openStatus(HEAD_A)]]), stopAt: 'pr', runnerReady: true, openFindings: FINDINGS_NONE });
    assert.equal(decision.headMoved, true, 'close-out agrees');
  });

  test('a judged head that is still current reads not moved; a moved live head reads moved', () => {
    assert.equal(box(approvedReview(), HEAD_A).evidence.checked.now.headMoved, false);
    assert.equal(box(approvedReview(), HEAD_MOVED).evidence.checked.now.headMoved, true);
  });

  test('no review on record reads not moved (nothing was judged)', () => {
    assert.equal(box(null, HEAD_MOVED).evidence.checked.now.headMoved, false);
  });
});

describe('9058b84e: close-out refuses on the PR the stale flag names (the flag is what replaces headMoved)', () => {
  const args = (review) => ({
    trail: trailOf({ review, landing: [PR_A] }),
    prStatuses: new Map([[PR_A, openStatus(HEAD_A)]]),
    stopAt: 'pr',
    runnerReady: true,
    openFindings: FINDINGS_NONE,
  });

  test('approved, heads {PR: H}, staleUrls [PR], live head H, stop at PR, runner ready -> head-moved', () => {
    const decision = closeOutDecision(args(approvedReview({ staleUrls: [PR_A] })));
    assert.equal(decision.reason, 'head-moved');
    assert.equal(decision.status, 'not-ready');
  });

  test('the same review without the stale flag is ready: the flag alone is what refuses it', () => {
    const decision = closeOutDecision(args(approvedReview()));
    assert.equal(decision.reason, null);
    assert.notEqual(decision.status, 'not-ready');
  });
});

describe('9d0c053a: the close-out quote is read from the close-out run record\'s account', () => {
  test('the run record is the only source: its account is the summary block, under no title', () => {
    const got = closeOutSummaryFor([{ at: '2026-07-01T12:00:00.000Z', fields: { stage: 'close-out', account: '## Close-out — LIN-1\n\nMerged at aaaa111.\n\n## Ledger\n- x' } }], { at: '2026-07-01T10:00:00.000Z' });
    assert.deepEqual(got, { at: '2026-07-01T12:00:00.000Z', text: 'Merged at aaaa111.' });
  });

  test('the close-out contract no longer tells close-out to title its comment', () => {
    assert.equal(formatStageContract('close-out', 'LIN-1'), '');
  });
});

describe('a610ceb9: the fix round is one workflow, from records; the revision section is retired', () => {
  const issue = { identifier: 'LIN-4520', title: 't', description: 'd', state: { name: 'In Progress', type: 'started' } };
  const fixRound = reviewRoundOf({ review: { verdict: 'request-changes', at: '2026-07-01T10:00:00.000Z' }, landing: [PR_A] });

  test('reviewRoundOf reads the fix round from the verdict on record, and names no PR (the change record does)', () => {
    assert.deepEqual(fixRound, { fixRound: true });
    assert.deepEqual(reviewRoundOf(null), null, 'a trail not read is not a fix round');
  });

  test('the fix-round workflow says continue the same PR, answer the open findings, and points at the task, not a comment', () => {
    const wf = buildImplementationWorkflow(issue, true);
    assert.match(wf, /Continue the existing branch and the PR the task's change record names/);
    assert.match(wf, /Push the fixes to the existing PR and answer each finding in your summary comment — do not open a new PR/);
    assert.match(wf, /including the open findings to implementation on this task/);
    assert.doesNotMatch(wf, /review comment with its findings/);
    assert.doesNotMatch(wf, /\*\*Open a PR\*\*/);
  });

  test('the fresh-start workflow is unchanged: it opens a PR and names no review', () => {
    const wf = buildImplementationWorkflow(issue, false);
    assert.match(wf, /\*\*Open a PR\*\*: Open a pull request targeting main and referencing LIN-4520/);
    assert.doesNotMatch(wf, /Continue the existing branch|open findings to implementation/);
  });

  test('the implementation prompt carries the fix-round workflow and no revision section', () => {
    const prompt = generatePrompt('implementation', issue, { parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null, reviewRound: fixRound }).prompt;
    assert.doesNotMatch(prompt, /### Revising After a Review/);
    assert.match(prompt, /Continue the existing branch and the PR the task's change record names/);
  });
});

describe('ca44ecba: landed work is a change record version that wrote a head after an instant', () => {
  const verdict = { id: 'verdict-1', at: '2026-07-01T10:00:00.000Z', run: 'r1', fields: { judgement: 'plan-review', outcome: 'request-changes' } };

  test('a change record written after the latest verdict is landed work; a comment citing a PR is not', () => {
    const withChange = planReviewRunOf({ verdicts: [verdict], changes: [{ at: '2026-07-01T11:00:00.000Z', fields: { ref: PR_A } }] });
    assert.equal(loopFactsOf(withChange, []).landed, PR_A);
    const noChange = planReviewRunOf({ verdicts: [verdict] });
    assert.equal(loopFactsOf(noChange, [{ createdAt: '2026-07-01T11:00:00.000Z', body: `Landed in ${PR_A}` }]).landed, null);
  });

  test('a change written only before the latest verdict is not landed work since it', () => {
    const run = planReviewRunOf({
      verdicts: [{ id: 'verdict-1', at: '2026-07-01T10:00:00.000Z', run: 'r1', fields: { judgement: 'plan-review', outcome: 'request-changes' } }],
      changes: [{ at: '2026-07-01T09:00:00.000Z', fields: { ref: PR_A } }],
    });
    assert.equal(loopFactsOf(run, []).landed, null);
  });

  // finding-5d38c050: the store emits one entry per head-writing version, so a revision pushed after the verdict counts.
  test('a change recorded before the verdict whose head moved after it (v1, then v2) is landed work since it', () => {
    const run = planReviewRunOf({
      verdicts: [{ id: 'verdict-1', at: '2026-07-01T10:00:00.000Z', run: 'r1', fields: { judgement: 'plan-review', outcome: 'request-changes' } }],
      changes: [
        { at: '2026-07-01T09:00:00.000Z', fields: { ref: PR_A } },
        { at: '2026-07-01T12:00:00.000Z', fields: { ref: PR_A } },
      ],
    });
    assert.equal(loopFactsOf(run, []).landed, PR_A);
    assert.deepEqual(run.landed.map((w) => w.at), ['2026-07-01T09:00:00.000Z', '2026-07-01T12:00:00.000Z'], 'oldest first');
  });
});

// finding-2f1e89d3: the one explicit field list a stage prompt receives must carry the fix round, or three entrances drop it.
describe('2f1e89d3: promptContextOf carries reviewRound to generatePrompt', () => {
  const ctx = { parent: null, siblings: [], project: null, children: [], comments: [], attachments: [] };
  const issue = { id: 'i', identifier: 'LIN-4520', title: 'Fix round', description: 'd', state: { name: 'In Progress', type: 'started' }, labels: [] };

  test('a request-changes round projected through promptContextOf continues the existing branch', () => {
    const prompt = generatePrompt('implementation', issue, promptContextOf({ ...ctx, reviewRound: { fixRound: true } })).prompt;
    assert.match(prompt, /Continue the existing branch/);
    assert.doesNotMatch(prompt, /\*\*Open a PR\*\*/);
  });

  test('a context with no reviewRound, or a null one (records not read), stays the fresh-start workflow', () => {
    assert.ok(!('reviewRound' in promptContextOf(ctx)));
    for (const withRound of [ctx, { ...ctx, reviewRound: null }]) {
      assert.match(generatePrompt('implementation', issue, promptContextOf(withRound)).prompt, /\*\*Open a PR\*\*/);
    }
  });
});
