/**
 * LIN-4518 review finding 4b4eef63: the plan-review loop's speech facts (a person's comment since the latest round, landed
 * work since it) are anchored on the latest plan-review verdict RECORD's instant, never on a comment that reads as a
 * verdict (commentKindOf). The witnesses below each name the anchor they test: a comment-anchored reading gives the
 * opposite answer, so the test fails under that mutation.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { planReviewRunOf } from '../../lib/records/plan-facts.js';
import { reviewLoopStep, assembleTrailFacts, speechSince } from '../../lib/recommendation-facts.js';

const ISSUE = { state: { name: 'In Progress', type: 'started' } };
const at = (hhmm) => `2026-11-21T${hhmm}:00.000Z`;

/** Plan-review verdicts as records: `rounds` = [[outcome, at, blockingFindingsCount], ...], each round's findings written at its instant. */
function recordsOf(rounds) {
  const verdicts = rounds.map(([outcome, t], i) => ({ id: `v${i}`, outcome, at: t }));
  const blockingFindings = rounds.flatMap(([, t, n], i) => Array.from({ length: n ?? 0 }, (_, k) => ({ id: `f${i}-${k}`, at: t })));
  return planReviewRunOf({ verdicts, blockingFindings });
}

const planFactsOf = (rounds) => ({ measured: true, planReview: recordsOf(rounds) });

/** A plan-review verdict as a comment (the contract's heading, read by commentKindOf as a plan-review). */
const verdictComment = (t, body = 'Request Changes.') => ({
  createdAt: t, body: `### Plan Review Verdict\n\n**Verdict:** ${body}\n\nBlocking findings: 1`,
});
const personComment = (t, body = 'Please hold this until the vendor answers.') => ({ createdAt: t, body });
const landedComment = (t) => ({ createdAt: t, body: '**Implementation landed:** https://github.com/o/r/pull/7' });

const THREE_STUCK = [['request-changes', at('10:00'), 3], ['request-changes', at('11:00'), 3], ['request-changes', at('12:00'), 3]];

describe('the loop step anchors on the latest verdict record (finding 4b4eef63)', () => {
  test('a person comment written before the latest record does not lift the bound', () => {
    const comments = [personComment(at('10:30')), landedComment(at('10:45'))];
    const stop = reviewLoopStep(ISSUE, comments, { planFacts: planFactsOf(THREE_STUCK) });
    assert.equal(stop?.codeRoute, 'blocked', 'the stop stands: nothing was said after the latest round');
  });

  test('a person comment written after the latest record lifts it, though no comment verdict exists', () => {
    // A comment-anchored reading finds no comment verdict, so it reads nothing since one and stops: this differs.
    const comments = [personComment(at('12:30'))];
    assert.equal(reviewLoopStep(ISSUE, comments, { planFacts: planFactsOf(THREE_STUCK) }), null);
  });

  test('a comment that reads as a verdict moves no anchor: the comment-anchored reading would lift the stop here', () => {
    // The person spoke after the comment-verdict at 11:45, which a comment anchor would take as the latest round; the
    // latest record (12:00) is later, so the person's comment is before it and the stop stands.
    const comments = [verdictComment(at('11:45')), personComment(at('11:50'))];
    const stop = reviewLoopStep(ISSUE, comments, { planFacts: planFactsOf(THREE_STUCK) });
    assert.equal(stop?.codeRoute, 'blocked');
  });

  test('landed work after the latest record is a running loop lifted, and an unmeasured read is the comment reading', () => {
    assert.equal(reviewLoopStep(ISSUE, [landedComment(at('12:10'))], { planFacts: planFactsOf(THREE_STUCK) }), null);
    assert.equal(reviewLoopStep(ISSUE, [], { planFacts: null }), null, 'no comments, no verdicts: no stop');
  });
});

describe('speechSince reads the instant only (finding 4b4eef63)', () => {
  test('nothing since a missing instant: no person, no landed work', () => {
    assert.deepEqual(speechSince([personComment(at('10:00'))], null), { personSince: false, landed: null });
  });

  test('comments strictly after the instant count, earlier ones do not', () => {
    assert.equal(speechSince([personComment(at('10:00'))], at('10:00')).personSince, false);
    assert.equal(speechSince([personComment(at('10:01'))], at('10:00')).personSince, true);
  });
});

describe('assembleTrailFacts reads plan review from the records when measured (finding 4b4eef63)', () => {
  test('the speech facts are the instant\'s, and the round counts are the records\'', () => {
    const comments = [verdictComment(at('09:00')), personComment(at('10:30'))];
    const facts = assembleTrailFacts(comments, '', { leaf: true, planFacts: planFactsOf(THREE_STUCK) });
    assert.equal(facts.planReview.verdicts, 3, 'three rounds on record, not the one comment verdict');
    assert.equal(facts.planReview.count, 3);
    assert.equal(facts.planReview.latestAt, at('12:00'));
    assert.equal(facts.planReview.personSince, false, 'the person spoke before the latest round, so nothing since it');
    assert.equal(facts.planReview.landed, null);
  });

  test('byKind counts the records by verdict word', () => {
    const rounds = [['request-changes', at('10:00'), 2], ['approve', at('11:00')], ['needs-discussion', at('12:00')]];
    const facts = assembleTrailFacts([], '', { leaf: true, planFacts: planFactsOf(rounds) });
    assert.deepEqual(facts.planReview.byKind, { 'request changes': 1, approve: 1, 'needs discussion': 1 });
  });
});
