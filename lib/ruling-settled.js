/**
 * LIN-4241: the settled-ruling guard's refusal. A ruling that is already answered
 * or dismissed is refused with this one shape everywhere the guard applies (the
 * comment route, the loop dismiss, the scan dismiss, the task-bound answer), so
 * the wording and the `code` cannot drift between routes.
 *
 * Spread into the route's error reply: `jsonError(res, ...RULING_SETTLED_REFUSAL)`.
 * The client keys on `code` ('ruling-settled'), never on the wording.
 */
export const RULING_SETTLED_REFUSAL = Object.freeze([
  409,
  'This ruling was already answered or dismissed.',
  Object.freeze({ code: 'ruling-settled' }),
]);
