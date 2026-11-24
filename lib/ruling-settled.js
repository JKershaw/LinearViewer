/**
 * LIN-4241: the settled-ruling guard's refusal. A question that is already answered
 * or dismissed is refused with this one shape (LIN-4531's question answer and
 * dismiss, lib/question-answers.js, the one route left since the old ruling writes
 * retired in LIN-4541), so the wording and the `code` stay what clients key on.
 *
 * Spread into the route's error reply: `jsonError(res, ...RULING_SETTLED_REFUSAL)`.
 * The client keys on `code` ('ruling-settled'), never on the wording.
 */
export const RULING_SETTLED_REFUSAL = Object.freeze([
  409,
  'This ruling was already answered or dismissed.',
  Object.freeze({ code: 'ruling-settled' }),
]);
