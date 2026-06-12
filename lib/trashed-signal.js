// Trashed-issue signal (LIN-401).
//
// Linear soft-deletes: a trashed (deleted) issue goes to trash for ~30 days,
// vanishing from every view, search, and parent/child collection — but it STILL
// resolves when fetched by ID via the GraphQL API, carrying whatever workflow
// state it had before deletion. A by-ID read therefore leaks a ghost: a stale,
// pre-deletion state with nothing to mark it as deleted, and an agent reasons
// from it as if it were live work.
//
// We surface deletion two ways, depending on the consumer:
//   - SIGNAL (raw by-ID reads): override the reported state to a terminal
//     `canceled` type so every existing terminal guard (isTerminalState,
//     the recommend descent guard, the LIN-353 terminal-state branch) handles
//     it for free, while keeping a distinct `Trashed` name + a top-level
//     `trashed: true` flag so "user canceled" stays distinguishable from
//     "user deleted".
//   - REFUSE (context fetchers / writes): reject outright, because distilling,
//     recommending on, or mutating a ghost is the same failure as reading one.
//
// `canceled` is reused deliberately rather than inventing a new `state.type`:
// trashed is an orthogonal axis, not a workflow terminal state, so teaching
// TERMINAL_TYPES a new value would mis-signal the dashboard/tree. The terminal
// behaviour we want is exactly `canceled`'s; the name + flag carry the rest.

/** The synthetic state stamped onto a trashed issue by a by-ID read. */
export const TRASHED_STATE = { name: 'Trashed', type: 'canceled' };

/** True when a raw issue record carries Linear's `trashed` flag. */
export function isTrashed(issue) {
  return Boolean(issue && issue.trashed);
}

/**
 * Stamp the trashed signal onto a by-ID read result, in place. A live issue is
 * returned unchanged. A trashed issue gets its root state overridden to
 * `{ name: 'Trashed', type: 'canceled' }` and a top-level `trashed: true`.
 * Only the root is touched — nested children/parent/relation lists already drop
 * trash (Linear excludes it from collections), so they are left as-is.
 *
 * @param {Object} issue - The raw issue object from a by-ID query
 * @returns {Object} The same object, for convenience
 */
export function applyTrashedSignal(issue) {
  if (isTrashed(issue)) {
    issue.state = { ...TRASHED_STATE };
    issue.trashed = true;
  }
  return issue;
}
