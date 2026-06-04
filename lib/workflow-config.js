/**
 * Workflow Configuration
 *
 * Centralized configuration for workflow labels.
 * This module serves as the single source of truth for all label names
 * used throughout the codebase.
 *
 * Simplified to 3 labels:
 * - preparing: Pre-implementation work (research, breakdown, design, etc.)
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */

/**
 * The preparing label indicates pre-implementation work is in progress.
 * Tasks with this label are excluded from the "Ready" queue.
 */
export const PREPARING_LABEL = 'preparing';

/**
 * Work issue labels indicate problems or blockers during work.
 * These are not phase indicators but status modifiers.
 */
export const WORK_ISSUE_LABELS = {
  BLOCKED: 'blocked',
  BUG: 'bug'
};

/**
 * Virtual prompt types that are state-based, not label-based.
 * These prompts are available based on task state, not labels.
 */
export const VIRTUAL_PROMPTS = {
  PLAN: 'plan',
  CODE_REVIEW: 'code-review',
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
  RETRO: 'retro'
};

/**
 * Get all work issue label values as an array.
 * @returns {string[]} Array of work issue label values
 */
export function getWorkIssueLabels() {
  return Object.values(WORK_ISSUE_LABELS);
}
