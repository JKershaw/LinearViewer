/**
 * Pure classifiers for unwedge-or-breakdown.md (LIN-3932). No I/O: census.mjs reads the
 * cache and calls these; the unit test drives them with fixtures.
 *
 * The plan-review facts come from lib/recommendation-facts.js, so a verdict counts here
 * exactly as the router counts it. Only the loop rule is re-applied by date (eraOf), since
 * the rule changed three times.
 */
import { assemblePlanReviewFacts, reviewLoopStop } from '../../../../lib/recommendation-facts.js';

const MIN = 60_000;
const ms = (iso) => Date.parse(iso);

/**
 * The plan-review loop rule in force on a date. Each start is the commit that introduced
 * it: 26 Jul (7f1efdb8, one revision cycle, written in the operating manual), 5 Oct
 * (0dd3c99e, REVIEW_LOOP_BOUND = 3 in code), 18 Oct (69991b3e, converging plans up to a
 * ceiling of 5). Before 26 Jul there was no plan-review gate.
 * @param {string} iso
 * @returns {'none'|'one-cycle'|'bound-3'|'ceiling-5'}
 */
export function eraOf(iso) {
  const t = ms(iso);
  if (t < ms('2026-07-26T00:00:00.000Z')) return 'none';
  if (t < ms('2026-10-05T00:00:00.000Z')) return 'one-cycle';
  if (t < ms('2026-10-18T00:00:00.000Z')) return 'bound-3';
  return 'ceiling-5';
}

/**
 * The first point at which a plan-review run stops, replayed over the comments in time
 * order under the rule of its era. A stop is checked at each verdict, against the verdicts
 * so far: a person's comment or landed work after a verdict lifts a stop only at the next
 * check, and that check is the next verdict, so the first stop is the first verdict that
 * meets the rule (the router's own check, applied to each prefix).
 * @param {Array<{body?: string, createdAt?: string}>} comments
 * @param {string|((iso: string) => string)} era - a fixed era, or eraOf so that each verdict
 *   is checked under the rule in force on its own date (a run can span a rule change)
 * @returns {null|{at: string, count: number, kind: string, verdictIndex: number}}
 */
export function replayFirstStop(comments, era) {
  const eraAt = typeof era === 'function' ? era : () => era;
  const sorted = [...comments].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  let verdictsSoFar = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prefix = sorted.slice(0, i + 1);
    const facts = assemblePlanReviewFacts(prefix);
    if (facts.verdicts === verdictsSoFar) continue;
    verdictsSoFar = facts.verdicts;
    const current = eraAt(sorted[i].createdAt);
    let kind = null;
    if (current === 'one-cycle' && facts.count >= 2) kind = 'one-cycle';
    if (current === 'bound-3' && facts.count >= 3) kind = 'bound';
    if (current === 'ceiling-5') kind = reviewLoopStop({ state: { type: 'started' } }, prefix);
    if (kind) return { at: sorted[i].createdAt, count: facts.count, kind, verdictIndex: i };
  }
  return null;
}

/**
 * The carve rule of root-task-ratio.md: a parent link AND an opening (first 400 characters)
 * that announces the carve. A parent link alone is not one (follow-ups are filed under the
 * same parent, LIN-2704 under LIN-751).
 */
const CARVE_PATTERNS = [
  /\bphase\s+(\d+|[A-Z])\b/i,
  /\bS\d+\b/,
  /\bsession\s+\d+\b/i,
  /\bstep\s+\d+\s+of\b/i,
  /\bsub-?issue of\b/i,
  /\bsubtask of\b/i,
  /\bplan item\b/i,
  /\bowner of item\b/i,
  /\bcarved (from|out of)\b/i,
  /\bsplit (from|out of)\b/i,
  /\bbreakdown of\b/i,
  /\bbreakdown pass\b/i,
  /\bscope copied from the parent\b/i,
  /\b(of|per) the LIN-\d+ (plan|breakdown)\b/i,
];

/**
 * Is this ticket a carve of the given parent? Needs both halves of the rule.
 * @param {{parent?: string|null, description?: string}} child
 * @param {string} parentIdentifier
 * @returns {boolean}
 */
export function carveChild(child, parentIdentifier) {
  if (child.parent !== parentIdentifier) return false;
  const opening = String(child.description || '').slice(0, 400);
  return CARVE_PATTERNS.some(p => p.test(opening));
}

/**
 * Classes a candidate blocker Y (an inverse `blocks` relation on X: Y blocks X) against X's
 * dates. Relations carry no timestamp, so Y's createdAt is the filing date (a Limit).
 *   own-child   Y is a child of X (breakdown, not unwedge)
 *   sibling     Y shares X's parent and was created within ten minutes of X (same breakdown)
 *   P           Y was created before X's first plan (a pre-plan prerequisite)
 *   after-impl  Y was created at or after X's first implementation
 *   not-done    Y was not Done by X's first implementation
 *   U           Y was filed between X's first plan and first implementation, and finished
 *               before X's first implementation: an unwedge
 * @param {{identifier: string, parent: string|null, createdAt: string, firstPlanAt?: string, firstImplAt?: string}} X
 * @param {{identifier: string, parent: string|null, createdAt: string, completedAt?: string|null, state: {type: string}}|null} Y
 * @returns {null|'own-child'|'sibling'|'undated'|'P'|'after-impl'|'not-done'|'U'}
 */
export function classifyBlocker(X, Y) {
  if (!Y) return null;
  if (Y.parent === X.identifier) return 'own-child';
  if (X.parent && Y.parent === X.parent && Math.abs(ms(Y.createdAt) - ms(X.createdAt)) <= 10 * MIN) return 'sibling';
  if (!X.firstPlanAt) return 'undated';
  if (ms(Y.createdAt) < ms(X.firstPlanAt)) return 'P';
  if (!X.firstImplAt) return 'undated';
  if (ms(Y.createdAt) >= ms(X.firstImplAt)) return 'after-impl';
  const doneBeforeImpl = Y.state?.type === 'completed' && Y.completedAt && ms(Y.completedAt) <= ms(X.firstImplAt);
  if (!doneBeforeImpl) return 'not-done';
  return 'U';
}

/**
 * Is this ticket an R (LIN-397 refactor-required) subtask? Seeded from the title patterns the
 * research found; the census decides the population, not this function.
 * @param {{title?: string}} issue
 */
export function classifyRefactor(issue) {
  return /\(blocking (refactor|prerequisite)\)|\bprerequisite\b|\bprecondition\b/i.test(issue.title || '');
}

/**
 * Breakdown cases: B1 is a /cost session of kind `breakdown`; B2 is a parent with at least one
 * carve child under carveChild. Both are reported and their overlap is shown.
 * @param {{identifier: string, sessions: Array<{kind: string}>, carveChildren: string[]}} row
 */
export function breakdownCase(row) {
  const b1 = row.sessions.some(s => s.kind === 'breakdown');
  const b2 = row.carveChildren.length > 0;
  return { identifier: row.identifier, b1, b2, b: b1 || b2 };
}
