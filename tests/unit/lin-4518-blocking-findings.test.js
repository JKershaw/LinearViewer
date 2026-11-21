/**
 * LIN-4518 (P5, beat 4, the parent's ruling: finding-per-issue): the plan-review bound on records. A reviewer writes one
 * blocking finding per blocking issue (kind finding, `to: implementation`, `about` the plan, `fields.blocking: true`); the
 * verdict's blocking count is the blocking findings written in its round (after the previous plan-review verdict, up to
 * this one). The review request stays its own finding (`to: plan-review`) and is never counted as a blocking one.
 *
 * Witnesses: a round with two blocking findings counts two; a round with none counts null (no count); the bound still stops
 * a plan that does not converge, and the ceiling stops one that keeps going, on the records' counts as on the comment count.
 *
 * Run with: node --test tests/unit/lin-4518-blocking-findings.test.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { planReviewRunOf } from '../../lib/records/plan-facts.js';
import { reviewLoopStopOf, REVIEW_LOOP_BOUND, REVIEW_LOOP_CEILING } from '../../lib/recommendation-facts.js';

const T = (n) => `2026-11-21T10:${String(n).padStart(2, '0')}:00.000Z`;
const verdict = (id, outcome, n) => ({ id, outcome, at: T(n) });
const blocking = (id, n) => ({ id, at: T(n) });
const ISSUE = { identifier: 'LIN-1', state: { type: 'started' } };

describe('LIN-4518: the blocking count of a plan-review round is the blocking findings written in it', () => {
  test('a round with two blocking findings counts two; a round with none counts null', () => {
    const plan = planReviewRunOf({
      verdicts: [verdict('v1', 'request-changes', 10), verdict('v2', 'request-changes', 20), verdict('v3', 'request-changes', 30)],
      blockingFindings: [blocking('f1', 5), blocking('f2', 7), blocking('f3', 25), blocking('f4', 27)],
    });
    assert.deepEqual(plan.run.map((r) => r.blocking), [2, null, 2], 'round 1 has two, round 2 has none, round 3 has two (f3 and f4)');
  });

  test('a round with one blocking finding counts one (the reviewer\'s own convergence rule reads it)', () => {
    const plan = planReviewRunOf({
      verdicts: [verdict('v1', 'request-changes', 10), verdict('v2', 'request-changes', 20)],
      blockingFindings: [blocking('f1', 5), blocking('f2', 15)],
    });
    assert.deepEqual(plan.run.map((r) => r.blocking), [1, 1]);
  });

  test('the review request is not a blocking finding: a plan-review finding without the flag is not counted (it is not in the input)', () => {
    const plan = planReviewRunOf({ verdicts: [verdict('v1', 'request-changes', 10)], blockingFindings: [] });
    assert.equal(plan.run[0].blocking, null);
    assert.equal(plan.count, 1);
  });
});

describe('LIN-4518: the bound still stops a plan where the comment count did', () => {
  const rounds = (counts) => planReviewRunOf({
    verdicts: counts.map((_, i) => verdict(`v${i + 1}`, 'request-changes', 10 * (i + 1))),
    blockingFindings: counts.flatMap((c, i) => Array.from({ length: c ?? 0 }, (_, k) => blocking(`f${i}-${k}`, 10 * (i + 1) - 5))),
  });

  test('three rounds that do not narrow stop at the bound', () => {
    assert.equal(reviewLoopStopOf({ issue: ISSUE, planReview: rounds([2, 2, 2]) }), 'not-converging');
  });

  test('three rounds that narrow keep going (converging), and a round with no findings stops the run as not converging', () => {
    assert.equal(reviewLoopStopOf({ issue: ISSUE, planReview: rounds([3, 2, 1]) }), null);
    assert.equal(reviewLoopStopOf({ issue: ISSUE, planReview: rounds([2, null, 2]) }), 'not-converging');
  });

  test(`${REVIEW_LOOP_CEILING} rounds stop at the ceiling whatever the counts`, () => {
    assert.equal(reviewLoopStopOf({ issue: ISSUE, planReview: rounds([3, 2, 1, 1, 1]) }), 'ceiling');
    assert.equal(REVIEW_LOOP_BOUND, 3);
  });

  test('a person\'s comment since the latest verdict lifts the stop', () => {
    assert.equal(reviewLoopStopOf({ issue: ISSUE, planReview: rounds([2, 2, 2]), personSince: true }), null);
  });
});

describe('LIN-4518: a blocking finding is a declared flag on a finding (the checker)', () => {
  // The checker reads the vocabulary (lib/records/kinds.json): a finding declares `blocking` as a flag (true or false).
  const ctx = { addressees: { stages: ['implementation', 'plan-review'], people: [] }, resolve: () => null };
  // The checker reads a write's fields flat at the top level (lib/records/check.js).
  const base = { to: 'implementation', says: 'the plan misses the export path' };

  test('a finding may say blocking true, and a finding without the flag is still a finding', async () => {
    const { checkAdd } = await import('../../lib/records/check.js');
    assert.deepEqual(checkAdd('finding', { ...base, blocking: true }, ctx).problems, []);
    assert.deepEqual(checkAdd('finding', base, ctx).problems, []);
  });

  test('a blocking flag that is not true or false is refused', async () => {
    const { checkAdd } = await import('../../lib/records/check.js');
    const { problems } = checkAdd('finding', { ...base, blocking: 'yes' }, ctx);
    assert.match(problems[0].message, /'blocking' of finding must be true or false/);
  });
});
