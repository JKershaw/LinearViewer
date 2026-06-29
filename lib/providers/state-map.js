// =============================================================================
// State Mapping
// =============================================================================
//
// Display, ordering, and semantic predicates for canonical issue states.
// All state-mapping semantics live here so providers and views share one
// importable source of truth — Phase 1 of LIN-174.

import { STARTED, BACKLOG, CANCELED, TERMINAL_TYPES, STATE_ORDER } from './models.js'

/**
 * Check if a state type is terminal (completed, canceled, or duplicate).
 * Duplicates are treated identically to canceled across all surfaces (LIN-276).
 * @param {string|undefined} stateType - The state.type string
 * @returns {boolean} True for completed/canceled/duplicate
 */
export function isTerminalState(stateType) {
  return TERMINAL_TYPES.includes(stateType)
}

/**
 * Check if an issue is in a terminal state (completed, canceled, or duplicate).
 * @param {{state?: {type?: string}}} issue - Issue to check
 * @returns {boolean} True if issue state is terminal
 */
export function isCompleted(issue) {
  return isTerminalState(issue.state?.type)
}

/**
 * Check if an issue is in progress (started).
 * @param {{state?: {type?: string}}} issue - Issue to check
 * @returns {boolean} True if issue state is started
 */
export function isInProgress(issue) {
  return issue.state?.type === STARTED
}

/**
 * Whether an issue should be HIDDEN from the dashboard entirely — treated like a
 * trashed/deleted issue rather than shown with completed (✓) styling (LIN-769).
 *
 * Scoped to `canceled` only, deliberately NOT the full TERMINAL_TYPES set:
 *   - `completed` stays visible (it IS done — the "show N completed" group).
 *   - `duplicate` stays visible: it is a live pointer to its canonical issue, and
 *     silently hiding it would drop that breadcrumb. The ticket asks to hide
 *     *cancelled*, and the trashed signal (LIN-401) itself reuses `canceled`
 *     (never `duplicate`) as its synthetic hidden state, so `canceled` is the
 *     precedent-aligned hide target.
 *
 * This is a dashboard-data-seam filter, not a change to isTerminalState/
 * getStateDisplay, so terminal routing and the shared state glyphs are untouched.
 * @param {{state?: {type?: string}}} issue - Issue to check
 * @returns {boolean} True if the issue should be hidden from the dashboard
 */
export function isHiddenState(issue) {
  return issue?.state?.type === CANCELED
}

/**
 * Canonical display info for a state type.
 * Extracted verbatim from render.js renderNode()'s inline switch.
 * @param {string|undefined} type - The state.type string
 * @returns {{class: string, char: string, label: string}}
 */
export function getStateDisplay(type) {
  if (isTerminalState(type)) {
    return { class: 'done', char: '✓', label: 'Completed' }
  } else if (type === STARTED) {
    return { class: 'in-progress', char: '◐', label: 'In Progress' }
  } else if (type === BACKLOG) {
    return { class: 'backlog', char: '◌', label: 'Backlog' }
  }
  return { class: 'todo', char: '○', label: 'To Do' }
}

/**
 * Canonical sort rank for a state type. Returns undefined for unknown types so
 * callers keep their own `?? fallback` (which historically varied: 2 in
 * linear.js, 1 in render-swipe.js).
 * @param {string|undefined} type - The state.type string
 * @returns {number|undefined} Sort rank, or undefined if unknown
 */
export function getStateOrder(type) {
  return STATE_ORDER[type]
}
