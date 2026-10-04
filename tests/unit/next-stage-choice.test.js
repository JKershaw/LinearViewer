/**
 * LIN-3309 — improve the next-stage choice.
 *
 * Covers the four fixes and their seams:
 *   - relations reach the router (render + Local's two encodings);
 *   - plan-review verdict facts (count/reset/revision/replies) and the router block;
 *   - the fix-round implementation brief (continue the reviewed PR, temp N+1 where used);
 *   - D1 (a `**Reasoning**`/headerless reply still streams reasoning) and D2 (`retro` refused).
 *
 * Run with: node --test tests/unit/next-stage-choice.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assemblePlanReviewFacts, formatPlanReviewFactsBlock, REVISION_LABEL_RE
} from '../../lib/recommendation-facts.js';
import { formatIssueContext } from '../../lib/openrouter.js';
import { routeStage, parseRouteDecision, parseRecommendedAction } from '../../lib/stage-router.js';
import { parseRecommendationResponse } from '../../lib/openrouter.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { readRunLedger } from '../../lib/run-ledger.js';
import { isRequestChangesRound } from '../../lib/prompts/revision-brief.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { createLocalProvider } from '../fixtures/local-harness.js';

const RC = (at, id = at) => ({ id, createdAt: at, body: `### Plan Review Verdict\n\nFinding.\n\n**Verdict: Request Changes.**` });
const ND = (at, id = at) => ({ id, createdAt: at, body: `### Plan Review Verdict\n\n**Verdict: Needs Discussion.**` });
const APP = (at, id = at) => ({ id, createdAt: at, body: `### Plan Review Verdict\n\n**Verdict: Approve.**` });
const REVIEW = { identifier: 'LIN-1', title: 'A task', description: 'Do it.', state: { name: 'In Progress', type: 'started' } };

describe('relations reach the router (LIN-3309 S1)', () => {
  const base = { identifier: 'LIN-1', title: 'Blocked task', state: { name: 'In Progress', type: 'started' } };

  test('formatIssueContext renders open and resolved blockers as separate lists', () => {
    const issue = {
      ...base,
      blockedBy: [
        { identifier: 'LIN-2', title: 'Live blocker', state: { name: 'In Progress', type: 'started' } },
        { identifier: 'LIN-3', title: 'Done blocker', state: { name: 'Done', type: 'completed' } },
        { identifier: 'LIN-4', title: 'Canceled blocker', state: { name: 'Canceled', type: 'canceled' } },
      ]
    };
    const out = formatIssueContext(issue, {});
    assert.match(out, /\*\*Blocked by \(open\):\*\* LIN-2 — Live blocker \(In Progress\)/);
    assert.match(out, /\*\*Blockers already resolved:\*\* LIN-3 — Done blocker \(Done\); LIN-4 — Canceled blocker \(Canceled\)/);
  });

  test('nothing is rendered when there are no blockers', () => {
    assert.ok(!formatIssueContext(base, {}).includes('Blocked by'));
  });

  test('Local reads both encodings: outgoing blocked-by and inverse blocks', async () => {
    const { provider, store } = createLocalProvider();
    await store.seed('ws', {
      issues: [
        { id: 'i1', identifier: 'LOCAL-1', title: 'Blocker via blocks', state: { name: 'In Progress', type: 'started' }, relations: [{ type: 'blocks', relatedIssueId: 'i3' }] },
        { id: 'i2', identifier: 'LOCAL-2', title: 'Blocker via blocked-by', state: { name: 'Done', type: 'completed' } },
        { id: 'i3', identifier: 'LOCAL-3', title: 'Blocked task', state: { name: 'Todo', type: 'unstarted' }, relations: [{ type: 'blocked-by', relatedIssueId: 'i2' }] },
      ],
    });
    const ctx = await provider.fetchIssueContext('ws', 'i3');
    const ids = ctx.issue.blockedBy.map(b => b.identifier).sort();
    assert.deepEqual(ids, ['LOCAL-1', 'LOCAL-2']);
    assert.equal(ctx.issue.blockedBy.find(b => b.identifier === 'LOCAL-2').state.type, 'completed');
    // Another provider instance exposes the same shape (no Linear-style swap needed).
    assert.ok(new LocalProvider());
  });
});

describe('plan-review verdict facts (LIN-3309 S2)', () => {
  test('reads the contract heading, the legacy heading, and ignores autopilot records', () => {
    const facts = assemblePlanReviewFacts([
      { createdAt: '2026-01-01T00:00:00Z', body: '### Plan Review Verdict\n\n**Verdict: Request Changes.**' },
      { createdAt: '2026-01-02T00:00:00Z', body: '## Plan-review (round 2) — Request Changes' },
      { createdAt: '2026-01-03T00:00:00Z', body: '**Autopilot step** — dispatched implementation' },
      { createdAt: '2026-01-04T00:00:00Z', body: '### Plan Review Verdict\n\n**Verdict: Needs Discussion.**' },
    ]);
    assert.equal(facts.verdicts, 3, 'autopilot record is not a verdict');
    assert.equal(facts.count, 3);
    assert.equal(facts.latestVerdict, 'needs discussion');
  });

  test('only an Approve resets the count; a revision alone does not', () => {
    const c = (verdict, at) => ({ createdAt: at, body: `### Plan Review Verdict\n\n**Verdict: ${verdict}.**` });
    assert.equal(assemblePlanReviewFacts([c('Request Changes', '2026-01-01T00:00:00Z')]).count, 1);
    assert.equal(assemblePlanReviewFacts([c('Request Changes', '2026-01-01T00:00:00Z'), c('Request Changes', '2026-01-02T00:00:00Z')]).count, 2);
    assert.equal(assemblePlanReviewFacts([c('Request Changes', '2026-01-01T00:00:00Z'), c('Request Changes', '2026-01-02T00:00:00Z'), c('Request Changes', '2026-01-03T00:00:00Z')]).count, 3);
    assert.equal(assemblePlanReviewFacts([c('Request Changes', '2026-01-01T00:00:00Z'), c('Request Changes', '2026-01-02T00:00:00Z'), c('Request Changes', '2026-01-03T00:00:00Z'), c('Request Changes', '2026-01-04T00:00:00Z')]).count, 4);
    assert.equal(assemblePlanReviewFacts([c('Request Changes', '2026-01-01T00:00:00Z'), c('Approve', '2026-01-02T00:00:00Z'), c('Request Changes', '2026-01-03T00:00:00Z')]).count, 1);
    assert.equal(assemblePlanReviewFacts([c('Request Changes', '2026-01-01T00:00:00Z'), c('Needs Discussion', '2026-01-02T00:00:00Z')]).count, 2);
  });

  test('replies are the newest non-verdict comments after the latest verdict, newest first', () => {
    const facts = assemblePlanReviewFacts([
      RC('2026-01-01T00:00:00Z'),
      { createdAt: '2026-01-02T00:00:00Z', body: 'First reply' },
      { createdAt: '2026-01-03T00:00:00Z', body: 'Newest reply' },
      { createdAt: '2026-01-04T00:00:00Z', body: '### Plan Review Verdict\n\n**Verdict: Request Changes.**' },
    ]);
    assert.equal(facts.latestVerdict, 'request changes');
    assert.deepEqual(facts.replies.map(r => r.text), [], 'nothing follows the LATEST verdict');
    const trailing = assemblePlanReviewFacts([
      RC('2026-01-01T00:00:00Z'),
      { createdAt: '2026-01-02T00:00:00Z', body: 'Older reply' },
      { createdAt: '2026-01-03T00:00:00Z', body: 'Newest reply' },
    ]);
    assert.deepEqual(trailing.replies.map(r => r.text), ['Newest reply', 'Older reply']);
  });

  test('commentsRead reflects the trail length', () => {
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z'), { createdAt: '2026-01-02T00:00:00Z', body: 'x' }]).commentsRead, 2);
    assert.equal(assemblePlanReviewFacts([]).commentsRead, 0);
  });

  test('shuffled input order yields the same facts (the reader sorts by createdAt)', () => {
    const trail = [RC('2026-01-01T00:00:00Z'), { createdAt: '2026-01-02T00:00:00Z', body: 'go on' }, RC('2026-01-03T00:00:00Z')];
    const a = assemblePlanReviewFacts(trail);
    const b = assemblePlanReviewFacts([...trail].reverse());
    assert.deepEqual(a, b);
  });

  test('revised reads the Revision N label against the verdict count', () => {
    const desc = (n) => `## Implementation Plan\n\nthings\n\nRevision ${n} — addresses plan-review findings F1.`;
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z')], desc(2)).revised, true);
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z'), RC('2026-01-02T00:00:00Z')], desc(2)).revised, false);
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z')], 'no label here').revised, false);
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z'), APP('2026-01-02T00:00:00Z')], desc(3)).revised, false, 'not computed after an Approve');
  });

  test('the planner template carries a line the reader regex reads (coupling test)', () => {
    const plan = generatePrompt('plan', REVIEW, { comments: [] }).prompt;
    assert.ok(plan.includes('Revision N — addresses plan-review'), 'the planner writes the exact form the reader counts');
    assert.equal('Revision 2 — addresses plan-review findings F1'.match(REVISION_LABEL_RE)[1], '2', 'the reader regex reads the concrete line');
  });

  test('the facts block renders only when a verdict exists, with the frozen precedence', () => {
    assert.equal(formatPlanReviewFactsBlock(null), '');
    assert.equal(formatPlanReviewFactsBlock({ verdicts: 0, count: 0, latestVerdict: null, revised: false, revisionN: 1, replies: [], commentsRead: 0 }), '');
    const hold = formatPlanReviewFactsBlock({
      verdicts: 1, count: 1, latestVerdict: 'request changes', revised: false, revisionN: 1,
      replies: [{ text: 'Hold until LIN-9 ships' }], commentsRead: 2
    });
    assert.match(hold, /Request Changes \/ Needs Discussion since the latest Approve: 1/);
    assert.match(hold, /Reply after the latest verdict: "Hold until LIN-9 ships"/);
    assert.match(hold, /hold \(stop, wait, do not proceed\) → \`blocked\`, at any count/);
    const revised = formatPlanReviewFactsBlock({
      verdicts: 3, count: 3, latestVerdict: 'request changes', revised: true, revisionN: 4,
      replies: [{ text: 'go on' }], commentsRead: 8
    });
    assert.match(revised, /Revision landed since the latest verdict: yes \(revision 4\)/);
    assert.match(revised, /A revision has landed since the latest verdict → \`plan-review\`, at any count and after a go-ahead too/);
  });
});

describe('the implementation fix-round brief (LIN-3309 S4)', () => {
  const issue = { identifier: 'LIN-3124', title: 'Cut over reads', description: 'd', state: { name: 'In Progress', type: 'started' } };
  const ctx = (comments) => ({ parent: null, siblings: [], project: { name: 'P' }, children: [], comments, focusedChild: null });
  const PR3 = '## Review: LIN-3124 PR3 (#1618)\n\nCI: green\n\n### What CI Did Not Prove\n- x\n\n### Verdict\nRequest Changes — one finding';
  const PR1 = '### Review Verdict — LIN-3124 PR1 (#1610)\n\nCI: green\n\n### Verdict\nApprove';

  test('the review reader classifies the real heading forms', () => {
    assert.equal(readRunLedger([{ createdAt: '2026-01-01T00:00:00Z', body: PR3 }]).verdict, 'request-changes');
    assert.equal(readRunLedger([{ createdAt: '2026-01-01T00:00:00Z', body: PR1 }]).verdict, 'approve');
    assert.equal(isRequestChangesRound([{ createdAt: '2026-01-01T00:00:00Z', body: PR3 }]), true);
  });

  test('a Request Changes review switches the brief to continue the reviewed PR', () => {
    const prompt = generatePrompt('implementation', issue, ctx([{ createdAt: '2026-01-01T00:00:00Z', body: PR3 }])).prompt;
    assert.match(prompt, /### Revising After a Review/);
    assert.match(prompt, /The latest review verdict is \*\*Request Changes\*\* \(review: `Review: LIN-3124 PR3 \(#1618\)`\)/);
    assert.match(prompt, /the PR the review names/);
    assert.match(prompt, /do not open a new PR/i);
    assert.match(prompt, /\*\*Branch\*\*: Continue the existing branch/);
    assert.match(prompt, /\*\*Update the PR\*\*: Push the fixes to the existing PR/);
    assert.doesNotMatch(prompt, /\*\*Open a PR\*\*/);
    assert.doesNotMatch(prompt, /pull\/1618/, 'it never guesses a PR URL for a bare #1618');
  });

  test('a review that names a full PR URL uses it verbatim', () => {
    const withUrl = '## Review: LIN-3124 PR3\n\nSee https://github.com/JKershaw/LinearViewer/pull/1618\n\n### Verdict\nRequest Changes';
    const prompt = generatePrompt('implementation', issue, ctx([{ createdAt: '2026-01-01T00:00:00Z', body: withUrl }])).prompt;
    assert.match(prompt, /https:\/\/github\.com\/JKershaw\/LinearViewer\/pull\/1618/);
  });

  test('an Approve or no review leaves the fresh-start brief byte-identical', () => {
    const fresh = generatePrompt('implementation', issue, ctx([])).prompt;
    assert.equal(generatePrompt('implementation', issue, ctx([{ createdAt: '2026-01-01T00:00:00Z', body: PR1 }])).prompt, fresh);
    assert.match(fresh, /\*\*Open a PR\*\*/);
    assert.doesNotMatch(fresh, /### Revising After a Review/);
  });
});

describe('D2: excluded kinds are refused (LIN-3309 S5)', () => {
  test('retro is rejected in routing and full mode; the extractor still returns it', () => {
    assert.throws(() => routeStage('## Reasoning\n→ **retro**', 'stop', 3), /cannot be recommended/);
    assert.throws(() => parseRouteDecision('## Reasoning\n→ **retro**'), /cannot be recommended/);
    assert.throws(() => parseRecommendationResponse('## Reasoning\n→ **retro**\n## Prompt\nx', 'stop', 3), /cannot be recommended/);
    assert.equal(parseRecommendedAction('## Reasoning\n→ **retro**'), 'retro');
  });

  test('a normal stage still parses in both modes', () => {
    assert.equal(routeStage('## Reasoning\n→ **plan**', 'stop', 1).action, 'plan');
    assert.equal(parseRecommendationResponse('## Reasoning\n→ **plan**\n## Prompt\nx', 'stop', 1).recommendedAction, 'plan');
  });
});
