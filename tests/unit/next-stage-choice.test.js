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
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient } from 'graphql-request';
import {
  assemblePlanReviewFacts, formatPlanReviewFactsBlock, REVISION_LABEL_RE
} from '../../lib/recommendation-facts.js';
import { formatIssueContext, getRecommendation, parseRecommendationResponse, setFetchImpl } from '../../lib/openrouter.js';
import { routeStage, parseRouteDecision, parseRecommendedAction } from '../../lib/stage-router.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { readRunLedger } from '../../lib/run-ledger.js';
import { isRequestChangesRound } from '../../lib/prompts/revision-brief.js';
import { fetchIssueContext } from '../../lib/providers/linear/index.js';
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
    // The resolved split is the thing the research spike showed matters: a resolved
    // blocker must NOT leak into the open list (mutation: `open = blockedBy`).
    assert.doesNotMatch(out, /\*\*Blocked by \(open\):\*\*[^\n]*LIN-3/);
    assert.doesNotMatch(out, /\*\*Blocked by \(open\):\*\*[^\n]*LIN-4/);
    assert.doesNotMatch(out, /\*\*Blockers already resolved:\*\*[^\n]*LIN-2/);
  });

  test('Linear normalises an inverse blocks relation to blockedBy (direction + resolved)', async () => {
    const data = {
      issue: {
        id: 'i1', identifier: 'LIN-1', title: 'Blocked task', description: 'd', trashed: false,
        state: { name: 'In Progress', type: 'started' }, labels: { nodes: [] },
        parent: null, children: { nodes: [] }, comments: { nodes: [] },
        inverseRelations: {
          nodes: [
            { type: 'blocks', issue: { identifier: 'LIN-2', title: 'Open blocker', state: { name: 'In Progress', type: 'started' } } },
            { type: 'blocks', issue: { identifier: 'LIN-3', title: 'Done blocker', state: { name: 'Done', type: 'completed' } } },
            { type: 'blocks', issue: { identifier: 'LIN-4', title: 'Canceled blocker', state: { name: 'Canceled', type: 'canceled' } } },
            // A 'related' relation is not a blocker and must be dropped.
            { type: 'related', issue: { identifier: 'LIN-9', title: 'Not a blocker', state: { name: 'Todo', type: 'unstarted' } } },
          ]
        }
      }
    };
    const m = mock.method(GraphQLClient.prototype, 'request', async () => data);
    try {
      const ctx = await fetchIssueContext('tok', 'i1');
      assert.deepEqual(ctx.issue.blockedBy.map(b => b.identifier), ['LIN-2', 'LIN-3', 'LIN-4']);
      assert.equal(ctx.issue.blockedBy.find(b => b.identifier === 'LIN-3').state.type, 'completed');
      assert.equal(ctx.issue.blockedBy.find(b => b.identifier === 'LIN-4').state.type, 'canceled');
    } finally {
      m.mock.restore();
    }
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
    // Asymmetric on purpose (review F5): a reply lands after the latest verdict in
    // time but before it in array order, so a reader that trusts input order differs.
    const trail = [RC('2026-01-03T00:00:00Z'), { createdAt: '2026-01-04T00:00:00Z', body: 'go on' }, RC('2026-01-01T00:00:00Z')];
    const a = assemblePlanReviewFacts(trail);
    const b = assemblePlanReviewFacts([...trail].reverse());
    assert.deepEqual(a, b);
    assert.deepEqual(a.replies.map(r => r.text), ['go on'], 'the reply after the latest verdict is kept');
  });

  test('revised reads the HIGHEST Revision N label against the verdict count (F4)', () => {
    const desc = (n) => `## Implementation Plan\n\nthings\n\nRevision ${n} — addresses plan-review findings F1.`;
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z')], desc(2)).revised, true);
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z'), RC('2026-01-02T00:00:00Z')], desc(2)).revised, false);
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z')], 'no label here').revised, false);
    assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z'), APP('2026-01-02T00:00:00Z')], desc(3)).revised, false, 'not computed after an Approve');
    // A description that carries Revision 2 AND Revision 3 with 2 verdicts: the first
    // match (2) would say not-revised and redo finished work; the highest (3) is right.
    const twoLabels = `${desc(2)}\n\nRevision 3 — addresses plan-review findings F2.`;
    const facts = assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z'), RC('2026-01-02T00:00:00Z')], twoLabels);
    assert.equal(facts.revisionN, 3);
    assert.equal(facts.revised, true);
  });

  test('the newest reply wins: a hold superseded by a go-ahead is not a hold (F3a)', () => {
    const holdThenGo = [
      RC('2026-01-01T00:00:00Z'),
      { createdAt: '2026-01-02T00:00:00Z', body: 'Hold until LIN-3098 ships.' },
      { createdAt: '2026-01-03T00:00:00Z', body: 'OK, go on.' },
    ];
    const facts = assemblePlanReviewFacts(holdThenGo);
    assert.deepEqual(facts.replies.map(r => r.text), ['OK, go on.', 'Hold until LIN-3098 ships.'], 'newest first');
    assert.equal(facts.route, 'plan', 'the newest reply (go) wins over the older hold');
    // The block tells the model to read the NEWEST reply, not any hold in the list.
    const block = formatPlanReviewFactsBlock(facts);
    assert.match(block, /The NEWEST reply wins: a hold a later reply superseded is not a hold/);
    assert.match(block, /unless the NEWEST reply after the latest verdict tells the work to continue/);
  });

  test('the code route settles the no-reply cases (F1 + FC addendum)', () => {
    const verdict = (v, at) => ({ createdAt: at, body: `### Plan Review Verdict\n\n**Verdict: ${v}.**` });
    const oneRc = [verdict('Request Changes', '2026-01-01T00:00:00Z')];
    const twoRc = [...oneRc, verdict('Request Changes', '2026-01-02T00:00:00Z')];
    const threeRc = [...twoRc, verdict('Request Changes', '2026-01-03T00:00:00Z')];
    // count 1 or 2, no reply, not revised -> plan
    assert.equal(assemblePlanReviewFacts(oneRc).route, 'plan');
    assert.equal(assemblePlanReviewFacts(twoRc).route, 'plan');
    // count 3, no reply -> blocked
    assert.equal(assemblePlanReviewFacts(threeRc).route, 'blocked');
    // revised -> plan-review (count 1 and count 2 + a revision, this ticket's own state)
    assert.equal(assemblePlanReviewFacts(oneRc, 'Revision 2 — addresses plan-review').route, 'plan-review');
    assert.equal(assemblePlanReviewFacts(twoRc, 'Revision 3 — addresses plan-review').route, 'plan-review');
    // a reply is read in code when its newest word is recognisably go/hold
    assert.equal(assemblePlanReviewFacts([...threeRc, { createdAt: '2026-01-04T00:00:00Z', body: 'go on' }]).route, 'plan');
    assert.equal(assemblePlanReviewFacts([...threeRc, { createdAt: '2026-01-04T00:00:00Z', body: 'Hold until LIN-3098 ships.' }]).route, 'blocked');
    // an ambiguous reply is left to the model
    assert.equal(assemblePlanReviewFacts([...threeRc, { createdAt: '2026-01-04T00:00:00Z', body: 'thanks, looking at this now' }]).route, null);
    // an agent's plan-posted note is not a reply, so the code route still settles it
    assert.equal(assemblePlanReviewFacts([...threeRc, { createdAt: '2026-01-04T00:00:00Z', body: '**Plan posted** — plan revision written.' }]).route, 'blocked');
    // an explicit implementation go-ahead routes to the fix round
    assert.equal(assemblePlanReviewFacts([...threeRc, { createdAt: '2026-01-04T00:00:00Z', body: 'go on, take it to implementation' }]).route, 'implementation');
    // Approve -> session-fit rules own it
    assert.equal(assemblePlanReviewFacts([verdict('Approve', '2026-01-01T00:00:00Z')]).route, null);
  });

  test('a landed implementation dominates a stale Revision label (FC addendum 2)', () => {
    const review = { createdAt: '2026-02-01T00:00:00Z', body: '## Review — LIN-3309\n\n### Verdict\nRequest Changes — F1' };
    const facts = assemblePlanReviewFacts([
      RC('2026-01-01T00:00:00Z'), RC('2026-01-02T00:00:00Z'), review,
    ], '## Implementation Plan\n\nRevision 3 — addresses plan-review findings F1.');
    assert.equal(facts.revised, true, 'the stale label still reads revised');
    assert.equal(facts.route, 'implementation', 'but the landed review sends it to the fix round, not plan-review');
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
    assert.match(revised, /A revision has landed since the latest verdict → \`plan-review\`, at any count/);
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

describe('the code route is not sent to the model (LIN-3309 F1 + addendum)', () => {
  const bundle = (issue, comments) => ({ parent: null, siblings: [], project: null, children: [], comments, focusedChild: null });
  const planReviewRc = { createdAt: '2026-01-01T00:00:00Z', body: '### Plan Review Verdict\n\n**Verdict: Request Changes.**' };

  test('getRecommendation skips the routing call when the facts settle the route', async () => {
    setFetchImpl(async () => { throw new Error('the model must not be called for a code-settled route'); });
    try {
      const issue = { identifier: 'T-1', title: 't', description: '## Implementation Plan\n\nRevision 2 — addresses plan-review findings.', state: { name: 'In Progress', type: 'started' }, labels: [] };
      const rec = await getRecommendation(issue, bundle(issue, [planReviewRc]), { apiKey: 'stub', model: 'x', briefWriter: { model: 'x' }, deadline: 0 });
      assert.equal(rec.codeRoute, 'plan-review');
      assert.equal(rec.recommendedAction, 'plan-review');
    } finally {
      setFetchImpl(null);
    }
  });

  test('a Request Changes review routes to the fix-round brief without the model', async () => {
    setFetchImpl(async () => { throw new Error('the model must not be called for a code-settled route'); });
    try {
      const issue = { identifier: 'T-2', title: 't', description: 'do it', state: { name: 'In Progress', type: 'started' }, labels: [] };
      const review = { createdAt: '2026-01-01T00:00:00Z', body: '## Review — T-2\n\n### Verdict\nRequest Changes — F1' };
      const rec = await getRecommendation(issue, bundle(issue, [review]), { apiKey: 'stub', model: 'x', briefWriter: { model: 'x' }, deadline: 0 });
      assert.equal(rec.codeRoute, 'implementation');
      assert.match(rec.prompt, /### Revising After a Review/);
    } finally {
      setFetchImpl(null);
    }
  });
});
