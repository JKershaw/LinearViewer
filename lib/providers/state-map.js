// =============================================================================
// State Mapping
// =============================================================================
//
// Display, ordering, and semantic predicates for canonical issue states.
// All state-mapping semantics live here so providers and views share one
// importable source of truth — Phase 1 of LIN-174.

import { STARTED, BACKLOG, TERMINAL_TYPES, STATE_ORDER } from './models.js'

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
 * linear.js/linear-cli.js, 1 in render-swipe.js).
 * @param {string|undefined} type - The state.type string
 * @returns {number|undefined} Sort rank, or undefined if unknown
 */
export function getStateOrder(type) {
  return STATE_ORDER[type]
}
