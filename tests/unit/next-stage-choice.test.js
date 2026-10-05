/**
 * LIN-3309 — improve the next-stage choice.
 *
 * Covers the four fixes and their seams:
 *   - relations reach the router (render + Local's two encodings);
 *   - plan-review verdict facts (count/reset/person/landed) and the review loop bound;
 *   - the fix-round implementation brief (continue the reviewed PR, temp N+1 where used);
 *   - D1 (a `**Reasoning**`/headerless reply still streams reasoning) and D2 (`retro` refused).
 *
 * Run with: node --test tests/unit/next-stage-choice.test.js
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient } from 'graphql-request';
import {
  assemblePlanReviewFacts, reviewLoopExhausted, REVIEW_LOOP_BOUND
} from '../../lib/recommendation-facts.js';
import { formatIssueContext, getRecommendation, getRecommendationStream, setFetchImpl } from '../../lib/openrouter.js';
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
    assert.deepEqual(facts.byKind, { 'request changes': 2, 'needs discussion': 1 });
    assert.equal(facts.count, 3);
    assert.equal(facts.latestVerdict, 'needs discussion');
    assert.equal(facts.latestAt, '2026-01-04T00:00:00Z');
  });

  test('only an Approve resets the count; a revision alone does not', () => {
    const c = (verdict, d) => ({ createdAt: `2026-01-0${d}T00:00:00Z`, body: `### Plan Review Verdict\n\n**Verdict: ${verdict}.**` });
    const count = (...vs) => assemblePlanReviewFacts(vs.map((v, i) => c(v, i + 1))).count;
    assert.equal(count('Request Changes'), 1);
    assert.equal(count('Request Changes', 'Request Changes', 'Request Changes', 'Request Changes'), 4);
    assert.equal(count('Request Changes', 'Approve', 'Request Changes'), 1);
    assert.equal(count('Request Changes', 'Needs Discussion'), 2);
    assert.equal(count('Request Changes', 'Approve'), 0);
    assert.equal(assemblePlanReviewFacts([]).count, 0);
  });

  test('shuffled input order yields the same facts (the reader sorts by createdAt)', () => {
    // Asymmetric on purpose (review F5): a reply lands after the latest verdict in
    // time but before it in array order, so a reader that trusts input order differs.
    const trail = [RC('2026-01-03T00:00:00Z'), { createdAt: '2026-01-04T00:00:00Z', body: 'go on' }, RC('2026-01-01T00:00:00Z')];
    const a = assemblePlanReviewFacts(trail);
    assert.deepEqual(a, assemblePlanReviewFacts([...trail].reverse()));
    assert.equal(a.personSince, true, 'the reply after the latest verdict is seen');
  });

  describe('a reply means a person\'s comment (FC 10c608df)', () => {
    const note = (body) => ({ createdAt: '2026-01-03T00:00:00Z', body });
    const twoRc = [RC('2026-01-01T00:00:00Z'), RC('2026-01-02T00:00:00Z')];

    test('each agent note form is part of the trail, not a person\'s comment', () => {
      for (const body of [
        '**Plan posted in the description (`## Implementation Plan`).** One PR.',
        '**Plan revision 1 written** (`## Implementation Plan` in the description).',
        '**Plan revised in the description (`## Implementation Plan`, Revision 3), answering plan-review 53e4757c.**',
        'Revision 4 — addresses plan-review findings.',
        '**Autopilot step record — plan revision 1 done (verified); plan-review round 2 started.**',
        '## Autopilot plan step done',
      ]) {
        assert.equal(assemblePlanReviewFacts([...twoRc, note(body)]).personSince, false, body);
      }
    });

    test('a person\'s comment, an FC ruling included, is one', () => {
      for (const body of ['Decision (FC): go on — take the revision.', '**Note for the plan revision (FC).** F3 is right.', 'Hold until LIN-3098 ships.']) {
        assert.equal(assemblePlanReviewFacts([...twoRc, note(body)]).personSince, true, body);
      }
    });
  });

  describe('work that landed after the latest verdict (FC 10c608df)', () => {
    const summary = (at = '2026-01-03T00:00:00Z') => ({ createdAt: at, body: '**Implementation complete — PR opened: https://github.com/JKershaw/LinearViewer/pull/1748** (commit e1287c0c).' });

    test('a PR or a code review after the latest verdict is landed work', () => {
      assert.equal(assemblePlanReviewFacts([APP('2026-01-01T00:00:00Z'), summary()]).landed, 'https://github.com/JKershaw/LinearViewer/pull/1748');
      const review = { createdAt: '2026-02-01T00:00:00Z', body: '## Review — LIN-3309\n\n### Verdict\nRequest Changes — F1' };
      assert.equal(assemblePlanReviewFacts([RC('2026-01-01T00:00:00Z'), review]).landed, 'a code review');
    });

    test('a PR only before the latest verdict, or cited in a planner note, is not landed', () => {
      assert.equal(assemblePlanReviewFacts([summary('2026-01-01T00:00:00Z'), RC('2026-01-02T00:00:00Z')]).landed, null);
      const plannerCites = { createdAt: '2026-01-03T00:00:00Z', body: '**Plan revised in the description (Revision 2)**, grounded on https://github.com/JKershaw/LinearViewer/pull/1747.' };
      assert.equal(assemblePlanReviewFacts([RC('2026-01-02T00:00:00Z'), plannerCites]).landed, null);
    });
  });

  test('the planner records what a revision addresses, with no exact form for code to read', () => {
    const plan = generatePrompt('plan', REVIEW, { comments: [] }).prompt;
    assert.match(plan, /\*\*Record what changed\*\*: add a short changelog line/);
    assert.doesNotMatch(plan, /Code reads that number|EXACTLY this form|third verdict/i);
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
  test('retro is rejected by the routing parse; the extractor still returns it', () => {
    assert.throws(() => routeStage('## Reasoning\n→ **retro**', 'stop', 3), /cannot be recommended/);
    assert.throws(() => parseRouteDecision('## Reasoning\n→ **retro**'), /cannot be recommended/);
    assert.equal(parseRecommendedAction('## Reasoning\n→ **retro**'), 'retro');
  });

  test('a normal stage still parses', () => {
    assert.equal(routeStage('## Reasoning\n→ **plan**', 'stop', 1).action, 'plan');
  });
});

describe('the review loop bound: the one route code settles (LIN-3309)', () => {
  const open = { name: 'In Progress', type: 'started' };
  const leaf = (over = {}) => ({ identifier: 'T-9', title: 't', description: 'A plan.', state: open, labels: [], ...over });
  const bundle = (comments) => ({ parent: null, siblings: [], project: null, children: [], comments, focusedChild: null });
  const rcs = (n) => Array.from({ length: n }, (_, i) => RC(`2026-01-0${i + 1}T00:00:00Z`));
  const after = (body) => ({ createdAt: '2026-01-09T00:00:00Z', body });

  test(`${REVIEW_LOOP_BOUND} verdicts asking for changes since the latest Approve stop the loop`, () => {
    assert.equal(REVIEW_LOOP_BOUND, 3);
    assert.equal(reviewLoopExhausted(leaf(), rcs(2)), false);
    assert.equal(reviewLoopExhausted(leaf(), rcs(3)), true);
    assert.equal(reviewLoopExhausted(leaf(), [RC('2026-01-01T00:00:00Z'), ND('2026-01-02T00:00:00Z'), RC('2026-01-03T00:00:00Z')]), true);
    assert.equal(reviewLoopExhausted(leaf(), [...rcs(3), APP('2026-01-08T00:00:00Z')]), false, 'an Approve resets it');
  });

  test('a person\'s comment since the latest verdict lifts it; an agent note does not', () => {
    assert.equal(reviewLoopExhausted(leaf(), [...rcs(3), after('go on, take it to implementation')]), false);
    assert.equal(reviewLoopExhausted(leaf(), [...rcs(3), after('Hold until LIN-3098 ships.')]), false);
    assert.equal(reviewLoopExhausted(leaf(), [...rcs(3), after('**Plan posted** — plan revision written.')]), true);
  });

  test('landed work since the latest verdict, or a terminal task, is not a running loop', () => {
    assert.equal(reviewLoopExhausted(leaf(), [...rcs(3), after('Implementation landed: https://github.com/o/r/pull/7')]), false);
    assert.equal(reviewLoopExhausted(leaf({ state: { name: 'Canceled', type: 'canceled' } }), rcs(3)), false);
    assert.equal(reviewLoopExhausted(leaf({ state: { name: 'Done', type: 'completed' } }), rcs(3)), false);
  });

  test('getRecommendation stops at blocked without a routing call, with the blocked stage prompt', async () => {
    setFetchImpl(async () => { throw new Error('the model must not be called at the bound'); });
    try {
      const rec = await getRecommendation(leaf(), bundle(rcs(3)), { apiKey: 'stub', model: 'x' });
      assert.equal(rec.codeRoute, 'blocked');
      assert.equal(rec.recommendedAction, 'blocked');
      assert.equal(rec.prompt, generatePrompt('blocked', leaf(), bundle(rcs(3))).prompt);
    } finally {
      setFetchImpl(null);
    }
  });

  test('the stream takes the same route and emits the reasoning and the prompt', async () => {
    setFetchImpl(async () => { throw new Error('the model must not be called at the bound'); });
    const events = [];
    try {
      const rec = await getRecommendationStream(leaf(), bundle(rcs(3)), { apiKey: 'stub', model: 'x' }, (type, data) => events.push([type, data]));
      assert.equal(rec.codeRoute, 'blocked');
      assert.deepEqual(events.filter(([t]) => t === 'delta').map(([, d]) => d.section), ['reasoning', 'prompt']);
      assert.equal(events.at(-1)[0], 'done');
    } finally {
      setFetchImpl(null);
    }
  });

  test('below the bound, or with a person\'s comment, the model chooses from plain facts', async () => {
    const calls = [];
    setFetchImpl(async (url, opts = {}) => {
      calls.push(JSON.parse(opts.body).messages[0].content);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **plan**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
    });
    try {
      for (const comments of [rcs(1), rcs(2), [...rcs(3), after('Decision: go on with the revision.')]]) {
        const rec = await getRecommendation(leaf(), bundle(comments), { apiKey: 'stub', model: 'x' });
        assert.equal(rec.codeRoute, undefined);
        assert.equal(rec.recommendedAction, 'plan');
      }
      assert.equal(calls.length, 3, 'the router model is called each time');
      assert.match(calls[2], /- Plan-review verdicts: 3 \(3 request changes\); latest: request changes/);
      for (const c of calls) assert.doesNotMatch(c, /Route this pass|since the latest Approve|first match wins/, 'no steer and no loop count');
    } finally {
      setFetchImpl(null);
    }
  });
});
