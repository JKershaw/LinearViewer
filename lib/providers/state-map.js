// =============================================================================
// State Mapping
// =============================================================================
//
// Display, ordering, and semantic predicates for canonical issue states.
// All state-mapping semantics live here so providers and views share one
// importable source of truth — Phase 1 of LIN-174.

import { COMPLETED, STARTED, BACKLOG, CANCELED, TERMINAL_TYPES, STATE_ORDER } from './models.js'

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
 * Check if an issue is blocked (by blocking relation).
 * An issue is blocked if:
 * - It has an inverse 'blocks' relation from an incomplete issue
 *
 * Relocated from lib/linear.js (LIN-330) to lib/tree.js, then to its owner
 * here (LIN-3606): this reasons over issue-state semantics (a blocker only
 * counts while its state is non-terminal), so it lives beside isTerminalState
 * and lets the proxy routes import it without reaching through tree.js. The legacy `blocked` *label* was abolished
 * (LIN-357); blocked-ness is now the blocking *relationship* only.
 *
 * @param {Object} issue - Issue object with inverseRelations
 * @returns {boolean} True if the issue is blocked
 */
export function isBlocked(issue) {
  // Check for blocking relations (inverse 'blocks' from non-terminal issues)
  const hasBlockingRelation = Array.isArray(issue.inverseRelations?.nodes) &&
    issue.inverseRelations.nodes.some(r =>
      r.type === 'blocks' &&
      !isTerminalState(r.issue?.state?.type)
    )
  return hasBlockingRelation
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
 * Canonical display info for a state type, and the one glyph/label rule: a
 * completed task is a check, a closed-but-not-completed one (canceled,
 * duplicate) is a cross reading "Cancelled" (LIN-276/3656/3659: a duplicate
 * reads as cancelled). The class stays 'done' for all three terminal types so
 * data-status and the done styling do not change; only char and label vary.
 * public/swipe.js, context.js, ship.js and swim.js cannot import this (no
 * build step) and hand-match it.
 * @param {string|undefined} type - The state.type string
 * @returns {{class: string, char: string, label: string}}
 */
export function getStateDisplay(type) {
  if (type === COMPLETED) {
    return { class: 'done', char: '✓', label: 'Completed' }
  } else if (isTerminalState(type)) {
    return { class: 'done', char: '✕', label: 'Cancelled' }
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
