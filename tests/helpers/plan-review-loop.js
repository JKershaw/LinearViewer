/**
 * LIN-4518 (finding-527b8237): the plan-review loop's facts for a test, built from records, never from comment prose.
 *
 * A plan-review round is what the records hold (lib/records/plan-review-run.js): a verdict record judged `plan-review`,
 * and one finding `to: plan` per blocking issue its own run wrote. `loopFactsFor` folds those records with planReviewRunOf,
 * then reads a person's speech since the latest verdict from the person's findings and landed work from the change records
 * (loopFactsOf; LIN-4520, finding-ca44ecba; LIN-4535: speech is a person finding, never a comment's words), exactly as the
 * entrance does (lib/recommendation-input.js).
 */
import { planReviewRunOf, PLAN_REVIEW_JUDGEMENT, PLAN_FINDING_TO } from '../../lib/records/plan-review-run.js';
import { loopFactsOf } from '../../lib/recommendation-facts.js';

/**
 * One plan-review round as records, at `at`: its verdict (`outcome` is request-changes, approve or needs-discussion, the
 * outcome words the records hold) and `blocking` `to: plan` findings written under the same run (default none, so the
 * verdict carries no count).
 * @returns {{verdict: object, findings: object[]}}
 */
export function planRound(at, outcome, blocking = 0) {
  const run = `run-plan-review-${at}`;
  const findings = Array.from({ length: blocking }, (_, i) => ({ id: `finding-${at}-${i + 1}`, kind: 'finding', to: PLAN_FINDING_TO, run, at }));
  return {
    verdict: { id: `verdict-${at}`, kind: 'verdict', at, run, fields: { judgement: PLAN_REVIEW_JUDGEMENT, outcome, reasoning: 'plan review' } },
    findings,
  };
}

/**
 * The loop's facts for `rounds` (planRound values, in time order): the run folded from their records, the person's
 * speech since the latest verdict from `personFindings` (the person's findings: { at }), and the landed work from `changes`:
 * change records, each with the instant its record was first written (`at`) and its PR (`fields.ref`).
 * @param {Array<{verdict: object, findings: object[]}>} rounds
 * @param {Array<{at: string}>} [personFindings]
 * @param {Array<{at: string, fields: {ref: string}}>} [changes]
 */
export function loopFactsFor(rounds, personFindings = [], changes = []) {
  const verdicts = rounds.map((r) => r.verdict);
  const findings = rounds.flatMap((r) => r.findings);
  return loopFactsOf(planReviewRunOf({ verdicts, findings, changes }), personFindings);
}
