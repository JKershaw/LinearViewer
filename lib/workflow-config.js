/**
 * Workflow Configuration
 *
 * Centralized configuration for workflow labels.
 * This module serves as the single source of truth for all label names
 * used throughout the codebase.
 *
 * Workflow labels (1):
 * - bug: Investigating unexpected behavior
 */

/**
 * Work issue labels indicate problems or blockers during work.
 * These are not phase indicators but status modifiers.
 */
export const WORK_ISSUE_LABELS = {
  BUG: 'bug'
};

/**
 * Virtual prompt types that are state-based, not label-based.
 * These prompts are available based on task state, not labels.
 */
export const VIRTUAL_PROMPTS = {
  PLAN: 'plan',
  LOOK_INTO: 'look-into',
  TRIAGE: 'triage',
  BREAKDOWN: 'breakdown',
  RESEARCH: 'research',
  SCOPING: 'scoping',
  DESIGN: 'design',
  SPIKE: 'spike',
  CONTEXT: 'context',
  IMPLEMENTATION: 'implementation',
  REVIEW: 'review',
  CLOSE_OUT: 'close-out',
  RETRO: 'retro'
};

/**
 * Get all work issue label values as an array.
 * @returns {string[]} Array of work issue label values
 */
export function getWorkIssueLabels() {
  return Object.values(WORK_ISSUE_LABELS);
}
