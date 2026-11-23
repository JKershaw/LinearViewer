/**
 * LIN-3309 — improve the next-stage choice.
 *
 * Covers the four fixes and their seams:
 *   - relations reach the router (render + Local's two encodings);
 *   - plan-review verdict facts (count/reset/person/landed) and the review loop bound;
 *   - the fix-round implementation brief (continue the reviewed PR, temp N+1 where used);
 *   - D1 (a `**Reasoning**`/headerless reply still streams reasoning) and D2 (`retro` refused).
 *
 * LIN-4520: the verdicts, the review and the landing are records. The plan-review facts are the records run
 * (planReviewRunOf) with the person's speech and landed work read from the comments; the fix-round brief reads the
 * records review (reviewRoundOf). No comment is read for a verdict, a review title or a blocking count.
 *
 * Run with: node --test tests/unit/next-stage-choice.test.js
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { GraphQLClient } from 'graphql-request';
import {
  planReviewFactsOf, reviewLoopExhausted, reviewLoopConverging, reviewLoopStop, REVIEW_LOOP_BOUND, REVIEW_LOOP_CEILING
} from '../../lib/recommendation-facts.js';
import { planReviewRunOf } from '../../lib/records/plan-review-run.js';
import { formatIssueContext, getRecommendation, getRecommendationStream, setFetchImpl } from '../../lib/openrouter.js';

import { routeStage, parseRouteDecision, parseRecommendedAction } from '../../lib/stage-router.js';
import { generatePrompt } from '../../lib/prompt-templates.js';
import { isRequestChangesRound, reviewRoundOf } from '../../lib/prompts/fix-round.js';
import { fetchIssueContext } from '../../lib/providers/linear/index.js';
import { LocalProvider } from '../../lib/providers/local/index.js';
import { createLocalProvider } from '../fixtures/local-harness.js';
import { planRound, loopFactsFor } from '../helpers/plan-review-loop.js';

// LIN-4518 (finding-527b8237): the loop's facts are built from records (tests/helpers/plan-review-loop.js): a round is a
// plan-review verdict on record with its own run's `to: plan` findings. `rr`, `ndr` and `apr` are those rounds, `n` being
// the blocking findings the round wrote. The comments (RC below) are the thread, and a person's speech since the latest
// verdict is read from them by loopFactsOf; landed work is a change record first written after it (LIN-4520, finding-ca44ecba).
const rr = (at, n = 0) => planRound(at, 'request-changes', n);
const ndr = (at, n = 0) => planRound(at, 'needs-discussion', n);
const apr = (at) => planRound(at, 'approve');
const exhausted = (issue, rounds, comments = [], changes = []) => reviewLoopExhausted(issue, loopFactsFor(rounds, comments, changes));
const stop = (issue, rounds, comments = [], changes = []) => reviewLoopStop(issue, loopFactsFor(rounds, comments, changes));
// The plan-review facts of a ticket: the records run folded from its rounds and its change records, and the comments read for a person.
const runOf = (rounds, changes = []) => planReviewRunOf({ verdicts: rounds.map((r) => r.verdict), findings: rounds.flatMap((r) => r.findings), changes });
// LIN-4535: a person's speech is a person's finding (`speech(at, body)`), never a comment's words.
const speech = (at, body) => ({ id: `finding-${at}`, at, accountId: 'john', says: body, ruling: false });
const factsOf = (rounds, personFindings = [], changes = []) => planReviewFactsOf(runOf(rounds, changes), personFindings);
// A change record first written at `at` for `ref` (the PR the work landed in).
const landedChange = (at, ref = 'https://github.com/JKershaw/LinearViewer/pull/7') => ({ at, fields: { ref } });

// A plan-review verdict comment as the thread carries it (the verdict itself is the record, not this text).
const RC = (at, id = at) => ({ id, createdAt: at, body: `### Plan Review Verdict\n\nFinding.\n\n**Verdict: Request Changes.**` });
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
  test('the verdicts on record are counted by kind, and the latest is named with its instant', () => {
    const rounds = [rr('2026-01-01T00:00:00Z'), rr('2026-01-02T00:00:00Z'), ndr('2026-01-04T00:00:00Z')];
    const facts = factsOf(rounds);
    assert.equal(facts.verdicts, 3);
    assert.deepEqual(facts.byKind, { 'request changes': 2, 'needs discussion': 1 });
    assert.equal(runOf(rounds).run.length, 3, 'the count is the run since the latest Approve');
    assert.equal(facts.latestVerdict, 'needs discussion');
    assert.equal(facts.latestAt, '2026-01-04T00:00:00Z');
  });

  test('a verdict record that is not a plan review is not a plan-review verdict', () => {
    const other = { verdict: { id: 'v-review', kind: 'verdict', at: '2026-01-03T00:00:00Z', run: null, fields: { judgement: 'review', outcome: 'approve' } }, findings: [] };
    assert.equal(factsOf([rr('2026-01-01T00:00:00Z'), other]).verdicts, 1);
  });

  test('only an Approve resets the count; a revision alone does not', () => {
    const count = (...outcomes) => runOf(outcomes.map((o, i) => planRound(`2026-01-0${i + 1}T00:00:00Z`, o))).run.length;
    assert.equal(count('request-changes'), 1);
    assert.equal(count('request-changes', 'request-changes', 'request-changes', 'request-changes'), 4);
    assert.equal(count('request-changes', 'approve', 'request-changes'), 1);
    assert.equal(count('request-changes', 'needs-discussion'), 2);
    assert.equal(count('request-changes', 'approve'), 0);
    assert.equal(runOf([]).run.length, 0);
  });

  test('shuffled input order yields the same facts (the run sorts by the verdict instant)', () => {
    // Asymmetric on purpose (review F5): a reply lands after the latest verdict in
    // time but before it in array order, so a reader that trusts input order differs.
    const reply = speech('2026-01-04T00:00:00Z', 'go on');
    const a = planReviewFactsOf(runOf([rr('2026-01-03T00:00:00Z'), rr('2026-01-01T00:00:00Z')]), [reply]);
    assert.deepEqual(a, planReviewFactsOf(runOf([rr('2026-01-01T00:00:00Z'), rr('2026-01-03T00:00:00Z')]), [reply]));
    assert.equal(a.personSince, true, 'the reply after the latest verdict is seen');
  });

  test('no plan-review run on record is "not measured", never zero verdicts', () => {
    assert.equal(planReviewFactsOf(null, [{ createdAt: '2026-01-01T00:00:00Z', body: 'go on' }]), null);
  });

  describe('a reply means a person\'s comment (FC 10c608df)', () => {
    const note = (body) => ({ createdAt: '2026-01-03T00:00:00Z', body });
    const twoRc = [rr('2026-01-01T00:00:00Z'), rr('2026-01-02T00:00:00Z')];

    test('each agent note form is part of the trail: a comment that is not a person\'s finding is no speech, whatever its words', () => {
      for (const body of [
        '**Plan posted in the description (`## Implementation Plan`).** One PR.',
        '**Plan revision 1 written** (`## Implementation Plan` in the description).',
        '**Plan revised in the description (`## Implementation Plan`, Revision 3), answering plan-review 53e4757c.**',
        'Revision 4 — addresses plan-review findings.',
        '**Autopilot step record — plan revision 1 done (verified); plan-review round 2 started.**',
        '## Autopilot plan step done',
      ]) {
        assert.equal(factsOf(twoRc, []).personSince, false, body);
      }
    });

    test('a person\'s finding, an FC ruling included, is speech, whatever its words', () => {
      for (const body of ['Decision (FC): go on — take the revision.', '**Note for the plan revision (FC).** F3 is right.', 'Hold until LIN-3098 ships.']) {
        assert.equal(factsOf(twoRc, [speech('2026-01-03T00:00:00Z', body)]).personSince, true, body);
      }
    });
  });

  describe('work that landed after the latest verdict (FC 10c608df; LIN-4520, finding-ca44ecba: a change record, never a comment)', () => {
    const summary = (at = '2026-01-03T00:00:00Z') => ({ createdAt: at, body: '**Implementation complete — PR opened: https://github.com/JKershaw/LinearViewer/pull/1748** (commit e1287c0c).' });

    test('a change record first written after the latest verdict is landed work, named by its PR', () => {
      assert.equal(factsOf([apr('2026-01-01T00:00:00Z')], [], [landedChange('2026-01-03T00:00:00Z', 'https://github.com/JKershaw/LinearViewer/pull/1748')]).landed, 'https://github.com/JKershaw/LinearViewer/pull/1748');
    });

    test('a PR a comment cites, or a code review after the latest verdict, is not landed work', () => {
      assert.equal(factsOf([apr('2026-01-01T00:00:00Z')], [summary()]).landed, null);
      const review = { createdAt: '2026-02-01T00:00:00Z', body: '## Review — LIN-3309\n\n### Verdict\nRequest Changes — F1' };
      assert.equal(factsOf([rr('2026-01-01T00:00:00Z')], [review]).landed, null);
      const plannerCites = { createdAt: '2026-01-03T00:00:00Z', body: '**Plan revised in the description (Revision 2)**, grounded on https://github.com/JKershaw/LinearViewer/pull/1747.' };
      assert.equal(factsOf([rr('2026-01-02T00:00:00Z')], [plannerCites]).landed, null);
    });

    test('a change first written before the latest verdict is not landed work since it', () => {
      assert.equal(factsOf([rr('2026-01-02T00:00:00Z')], [], [landedChange('2026-01-01T00:00:00Z')]).landed, null);
    });
  });

  test('the planner records what a revision addresses, with no exact form for code to read', () => {
    const plan = generatePrompt('plan', REVIEW, { comments: [] }).prompt;
    assert.match(plan, /with a reason saying what changed and which findings it answers/);
    assert.doesNotMatch(plan, /Code reads that number|EXACTLY this form|third verdict/i);
  });
});

describe('the implementation fix-round brief (LIN-3309 S4)', () => {
  const issue = { identifier: 'LIN-3124', title: 'Cut over reads', description: 'd', state: { name: 'In Progress', type: 'started' } };
  const PR_URL = 'https://github.com/JKershaw/LinearViewer/pull/1618';
  // The records trail the brief reads (lib/task-standing.js trailForTicket): the review on record and the landing.
  const trailOf = (verdict, landing = [PR_URL]) => ({ review: verdict ? { verdict, at: '2026-01-01T00:00:00Z' } : null, landing });
  const ctx = (trail) => ({ parent: null, siblings: [], project: { name: 'P' }, children: [], comments: [], focusedChild: null, reviewRound: reviewRoundOf(trail) });

  test('the records review classifies the verdict: Request Changes is a fix round, Approve and no review are not', () => {
    assert.equal(isRequestChangesRound(reviewRoundOf(trailOf('request-changes'))), true);
    assert.equal(isRequestChangesRound(reviewRoundOf(trailOf('approve'))), false);
    assert.equal(isRequestChangesRound(reviewRoundOf(trailOf(null, []))), false);
    assert.equal(isRequestChangesRound(reviewRoundOf(null)), false, 'a trail not read is the fresh-start brief');
  });

  // LIN-4520 (finding-a610ceb9): the "Revising After a Review" section is retired. Its reasoning reaches the stage through the
  // brief's "what stands" part; the fix-round workflow keeps the steps that stop a fresh PR (continue the same PR).
  test('a Request Changes review switches the workflow to continue the change\'s PR, and retires the revision section', () => {
    const prompt = generatePrompt('implementation', issue, ctx(trailOf('request-changes'))).prompt;
    assert.doesNotMatch(prompt, /### Revising After a Review/, 'the revision section is retired');
    assert.match(prompt, /\*\*Branch\*\*: Continue the existing branch and the PR the task's change record names/);
    assert.match(prompt, /\*\*Update the PR\*\*: Push the fixes to the existing PR/);
    assert.match(prompt, /do not open a new PR/i);
    assert.match(prompt, /Address every open finding to implementation on this task/);
    assert.match(prompt, /do not re-implement what already landed/i);
    assert.doesNotMatch(prompt, /\*\*Open a PR\*\*/);
  });

  test('step 2 points at the open findings to implementation on the task, not at a review comment', () => {
    const prompt = generatePrompt('implementation', issue, ctx(trailOf('request-changes'))).prompt;
    assert.match(prompt, /including the open findings to implementation on this task/);
    assert.doesNotMatch(prompt, /review comment with its findings/);
  });

  test('the fix-round workflow names no PR URL: the change record, carried by the brief, names it', () => {
    const prompt = generatePrompt('implementation', issue, ctx(trailOf('request-changes'))).prompt;
    assert.doesNotMatch(prompt, /pull\/1618/);
  });

  test('a landing of more than one PR continues the same way', () => {
    const prompt = generatePrompt('implementation', issue, ctx(trailOf('request-changes', [PR_URL, 'https://github.com/JKershaw/LinearViewer/pull/1619']))).prompt;
    assert.match(prompt, /\*\*Branch\*\*: Continue the existing branch/);
    assert.doesNotMatch(prompt, /pull\/1618|pull\/1619/);
  });

  test('an Approve, or no review, leaves the fresh-start brief byte-identical', () => {
    const fresh = generatePrompt('implementation', issue, ctx(null)).prompt;
    assert.equal(generatePrompt('implementation', issue, ctx(trailOf('approve'))).prompt, fresh);
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

describe('the review loop bound: the first route code settles (LIN-3309; the look-first sequence is LIN-4370)', () => {
  const open = { name: 'In Progress', type: 'started' };
  const leaf = (over = {}) => ({ identifier: 'T-9', title: 't', description: 'A plan.', state: open, labels: [], ...over });
  // The loop's facts are the rounds on record; the comments carry the thread (the selector's facts still read it) and a
  // person's speech since the latest verdict (LIN-4518 finding-527b8237). Landed work is the change records (LIN-4520).
  const bundle = (rounds, comments = [], changes = []) => ({ parent: null, siblings: [], project: null, children: [], comments, planReviewLoop: loopFactsFor(rounds, comments, changes), planReviewRun: runOf(rounds, changes), focusedChild: null });
  const rcs = (n) => Array.from({ length: n }, (_, i) => rr(`2026-01-0${i + 1}T00:00:00Z`));
  const rcComments = (n) => Array.from({ length: n }, (_, i) => RC(`2026-01-0${i + 1}T00:00:00Z`));
  const after = (body) => speech('2026-01-09T00:00:00Z', body);

  test(`${REVIEW_LOOP_BOUND} verdicts asking for changes since the latest Approve stop the loop`, () => {
    assert.equal(REVIEW_LOOP_BOUND, 3);
    assert.equal(exhausted(leaf(), rcs(2)), false);
    assert.equal(exhausted(leaf(), rcs(3)), true);
    assert.equal(exhausted(leaf(), [rr('2026-01-01T00:00:00Z'), ndr('2026-01-02T00:00:00Z'), rr('2026-01-03T00:00:00Z')]), true);
    assert.equal(exhausted(leaf(), [...rcs(3), apr('2026-01-08T00:00:00Z')]), false, 'an Approve resets it');
  });

  test('a person\'s comment since the latest verdict lifts it; an agent note does not', () => {
    assert.equal(exhausted(leaf(), rcs(3), [after('go on, take it to implementation')]), false);
    assert.equal(exhausted(leaf(), rcs(3), [after('Hold until LIN-3098 ships.')]), false);
    assert.equal(exhausted(leaf(), rcs(3), []), true, 'an agent note is no finding, so it is no speech');
  });

  test('landed work since the latest verdict, or a terminal task, is not a running loop', () => {
    assert.equal(exhausted(leaf(), rcs(3), [], [landedChange('2026-01-09T00:00:00Z')]), false);
    assert.equal(exhausted(leaf({ state: { name: 'Canceled', type: 'canceled' } }), rcs(3)), false);
    assert.equal(exhausted(leaf({ state: { name: 'Done', type: 'completed' } }), rcs(3)), false);
  });

  test('a comment that only looks like a verdict is no speech and no work: the bound holds (LIN-4520, finding-ca44ecba, LIN-4535)', () => {
    // Review's repro at 2d0b71414: three request-changes verdicts are not converging, and a review-titled comment with an
    // approve word after the latest verdict used to lift the bound. The loop reads a person's finding (LIN-4535), so a comment
    // that is not one is not speech; only a change record written after the verdict is work.
    assert.equal(exhausted(leaf(), rcs(3), []), true, 'a review-looking comment is not a person\'s finding');
    assert.equal(exhausted(leaf(), rcs(3), [], [landedChange('2026-01-09T00:00:00Z')]), false, 'a change record written after the verdict is the landed work');
    assert.equal(exhausted(leaf(), rcs(3), []), true, 'a PR a comment cites is not landed work');
  });

  test('getRecommendation stops at blocked without a routing call, with the blocked stage prompt', async () => {
    setFetchImpl(async () => { throw new Error('the model must not be called at the bound'); });
    try {
      const rec = await getRecommendation(leaf(), bundle(rcs(3), rcComments(3)), { apiKey: 'stub', model: 'x' });
      assert.equal(rec.codeRoute, 'blocked');
      assert.equal(rec.recommendedAction, 'blocked');
      assert.equal(rec.prompt, generatePrompt('blocked', leaf(), bundle(rcs(3), rcComments(3))).prompt);
    } finally {
      setFetchImpl(null);
    }
  });

  test('the stream takes the same route and emits the reasoning and the prompt', async () => {
    setFetchImpl(async () => { throw new Error('the model must not be called at the bound'); });
    const events = [];
    try {
      const rec = await getRecommendationStream(leaf(), bundle(rcs(3), rcComments(3)), { apiKey: 'stub', model: 'x' }, (type, data) => events.push([type, data]));
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
      const cases = [
        { rounds: rcs(1), comments: rcComments(1) },
        { rounds: rcs(2), comments: rcComments(2) },
        { rounds: rcs(3), comments: [...rcComments(3), after('Decision: go on with the revision.')] },
      ];
      for (const { rounds, comments } of cases) {
        const rec = await getRecommendation(leaf(), bundle(rounds, comments), { apiKey: 'stub', model: 'x' });
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

describe('a converging plan gets another round, up to a ceiling (LIN-3651)', () => {
  const open = { name: 'In Progress', type: 'started' };
  const leaf = () => ({ identifier: 'T-9', title: 't', description: 'A plan.', state: open, labels: [] });
  const bundle = (rounds, comments = []) => ({ parent: null, siblings: [], project: null, children: [], comments, planReviewLoop: loopFactsFor(rounds, comments), planReviewRun: runOf(rounds), focusedChild: null });
  // Rounds on record: `counted(3, 2, 1)` is three request-changes verdicts with 3, 2 and 1 `to: plan` findings.
  const counted = (...ns) => ns.map((n, i) => rr(`2026-01-0${i + 1}T00:00:00Z`, n));
  const after = (body) => speech('2026-01-09T00:00:00Z', body);

  test('the ceiling is separate from the bound', () => {
    assert.equal(REVIEW_LOOP_BOUND, 3);
    assert.equal(REVIEW_LOOP_CEILING, 5);
  });

  test('narrowing counts (3,3,1; 2,2,1) and a steady one (1,1,1) are not exhausted at the bound', () => {
    for (const ns of [[3, 3, 1], [2, 2, 1], [1, 1, 1]]) {
      assert.equal(exhausted(leaf(), counted(...ns)), false, ns.join(','));
    }
    assert.equal(stop(leaf(), counted(3, 3, 1)), null);
  });

  test('rising, flat above 1, and uncounted runs stop at the bound', () => {
    for (const ns of [[1, 3, 4], [3, 3, 3]]) {
      assert.equal(exhausted(leaf(), counted(...ns)), true, ns.join(','));
      assert.equal(stop(leaf(), counted(...ns)), 'not-converging');
    }
    const plain = [rr('2026-01-01T00:00:00Z'), rr('2026-01-02T00:00:00Z'), rr('2026-01-03T00:00:00Z')];
    assert.equal(exhausted(leaf(), plain), true, 'no findings on record for the verdicts: today\'s behaviour');
  });

  test('five verdicts stop at the ceiling even while narrowing', () => {
    assert.equal(exhausted(leaf(), counted(3, 2, 2, 1)), false, 'four, still narrowing: another round');
    assert.equal(exhausted(leaf(), counted(3, 2, 2, 1, 1)), true);
    assert.equal(stop(leaf(), counted(3, 2, 2, 1, 1)), 'ceiling');
  });

  test('a Needs Discussion latest verdict is not converging', () => {
    const run = [rr('2026-01-01T00:00:00Z', 3), rr('2026-01-02T00:00:00Z', 1), ndr('2026-01-03T00:00:00Z')];
    assert.equal(exhausted(leaf(), run), true);
    assert.equal(reviewLoopConverging(loopFactsFor(run).run), false);
  });

  test('a Needs Discussion latest verdict that carries findings is still not converging (LIN-3651)', () => {
    const run = [rr('2026-01-01T00:00:00Z', 3), rr('2026-01-02T00:00:00Z', 2), ndr('2026-01-03T00:00:00Z', 1)];
    assert.equal(exhausted(leaf(), run), true);
    assert.equal(loopFactsFor(run).run[2].blocking, null);
  });

  test('person comment, landed work and Approve still lift it, at the ceiling too', () => {
    const five = counted(3, 2, 2, 1, 1);
    assert.equal(exhausted(leaf(), five, [after('go on, take it to implementation')]), false);
    assert.equal(exhausted(leaf(), five, [], [landedChange('2026-01-09T00:00:00Z')]), false);
    assert.equal(exhausted(leaf(), [...five, apr('2026-01-08T00:00:00Z')]), false);
    assert.equal(exhausted(leaf(), [...counted(3, 3, 3), apr('2026-01-08T00:00:00Z')]), false);
  });

  test('the run since the latest Approve carries each verdict\'s count; only Request Changes has one', () => {
    const f = loopFactsFor([rr('2026-01-01T00:00:00Z', 4), apr('2026-01-02T00:00:00Z'), rr('2026-01-03T00:00:00Z', 2), ndr('2026-01-04T00:00:00Z')]);
    assert.deepStrictEqual(f.run.map(({ verdict, blocking }) => ({ verdict, blocking })), [{ verdict: 'request changes', blocking: 2 }, { verdict: 'needs discussion', blocking: null }]);
  });

  test('order does not matter to the run', () => {
    const trail = counted(3, 3, 1);
    assert.deepEqual(loopFactsFor(trail), loopFactsFor([...trail].reverse()));
  });

  test('getRecommendation: 3,3,1 makes its routing call; 1,3,4 and the ceiling stop at blocked, naming the stop', async () => {
    let calls = 0;
    setFetchImpl(async () => {
      calls++;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '## Reasoning\n→ **plan**' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } }) };
    });
    try {
      const rec = await getRecommendation(leaf(), bundle(counted(3, 3, 1)), { apiKey: 'stub', model: 'x' });
      assert.equal(rec.codeRoute, undefined);
      assert.equal(calls, 1);
      const rising = await getRecommendation(leaf(), bundle(counted(1, 3, 4)), { apiKey: 'stub', model: 'x' });
      assert.equal(rising.codeRoute, 'blocked');
      assert.match(rising.reasoning, /not narrowing/);
      const capped = await getRecommendation(leaf(), bundle(counted(3, 2, 2, 1, 1)), { apiKey: 'stub', model: 'x' });
      assert.equal(capped.codeRoute, 'blocked');
      assert.match(capped.reasoning, /ceiling of 5/);
      assert.equal(calls, 1, 'no routing call at either stop');
    } finally {
      setFetchImpl(null);
    }
  });
});
