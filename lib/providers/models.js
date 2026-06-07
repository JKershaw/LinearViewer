// =============================================================================
// Canonical State Model
// =============================================================================
//
// The canonical issue-state vocabulary, using Linear's real `state.type` enum
// values. This is the contract that every provider maps INTO — Phase 1 of
// LIN-174 (Backend Provider Abstraction). LIN-176 (Provider Interface),
// LIN-178 (GitHub), and LIN-275 (Jira) will normalize their native states into
// these constants.
//
// Named after the actual `state.type` values that already flow through the
// codebase (started/unstarted/backlog/completed/canceled/duplicate), NOT a new
// in_progress/todo/done/cancelled dialect — manufacturing a second vocabulary
// is the exact gap LIN-174 exists to close.
//
// No imports, no side effects.

export const STARTED = 'started'
export const UNSTARTED = 'unstarted'
export const BACKLOG = 'backlog'
export const COMPLETED = 'completed'
export const CANCELED = 'canceled'
export const DUPLICATE = 'duplicate'

/**
 * Terminal state types: issues in these states are non-actionable and should be
 * filtered/grouped together across all views. Duplicates are treated
 * identically to canceled across all surfaces (LIN-276).
 */
export const TERMINAL_TYPES = [COMPLETED, CANCELED, DUPLICATE]

/**
 * Canonical sort order for state types. Matches the order maps that previously
 * lived (in agreement) in linear.js, linear-cli.js, and render-swipe.js;
 * duplicate ranks together with canceled.
 *
 * Note: swim-lanes.js intentionally collapses all terminal states to a single
 * rank — that deliberate variant is derived from these same constants there,
 * not from this map.
 */
export const STATE_ORDER = {
  [STARTED]: 0,
  [UNSTARTED]: 1,
  [BACKLOG]: 2,
  [COMPLETED]: 3,
  [CANCELED]: 4,
  [DUPLICATE]: 4,
}
