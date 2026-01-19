/**
 * Workflow Configuration
 *
 * Centralized configuration for workflow labels and phase definitions.
 * This module serves as the single source of truth for all label names
 * used throughout the codebase.
 *
 * Future: Can be extended to load from environment variables or database
 * for user customization.
 */

/**
 * Phase labels indicate the current phase within "In Progress" state.
 * Tasks move to "In Progress" when any phase begins, and labels track
 * which specific phase is active.
 *
 * Naming convention: "in-X" indicates current activity (vs "needs-X" which
 * implied something was missing).
 */
export const PHASE_LABELS = {
  RESEARCH: 'in-research',
  BREAKDOWN: 'in-breakdown',
  SCOPING: 'in-scoping',
  DESIGN: 'in-design',
  SPIKE: 'in-spike',
  CONTEXT: 'in-context',
  IMPLEMENTATION: 'in-implementation',
  REVIEW: 'in-review'
};

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
  TRIAGE: 'triage'
};

/**
 * Get all phase label values as an array.
 * Useful for checking if a label is a phase label.
 * @returns {string[]} Array of phase label values
 */
export function getPhaseLabels() {
  return Object.values(PHASE_LABELS);
}

/**
 * Get all work issue label values as an array.
 * @returns {string[]} Array of work issue label values
 */
export function getWorkIssueLabels() {
  return Object.values(WORK_ISSUE_LABELS);
}

/**
 * Check if a label is a phase label.
 * @param {string} label - The label to check
 * @returns {boolean} True if the label is a phase label
 */
export function isPhaseLabel(label) {
  return getPhaseLabels().includes(label.toLowerCase());
}

/**
 * Get the phase key from a label value.
 * @param {string} label - The label value (e.g., 'in-research')
 * @returns {string|null} The phase key (e.g., 'RESEARCH') or null if not found
 */
export function getPhaseKey(label) {
  const normalizedLabel = label.toLowerCase();
  for (const [key, value] of Object.entries(PHASE_LABELS)) {
    if (value === normalizedLabel) {
      return key;
    }
  }
  return null;
}

/**
 * Pre-work phase labels that indicate a task needs preparation before implementation.
 * Tasks with these labels are excluded from the "Ready" queue.
 */
export const PRE_WORK_PHASES = [
  PHASE_LABELS.RESEARCH,
  PHASE_LABELS.BREAKDOWN,
  PHASE_LABELS.SCOPING,
  PHASE_LABELS.DESIGN,
  PHASE_LABELS.SPIKE,
  PHASE_LABELS.CONTEXT
];

/**
 * Get all pre-work phase labels.
 * @returns {string[]} Array of pre-work phase label values
 */
export function getPreWorkPhaseLabels() {
  return PRE_WORK_PHASES;
}

/**
 * Check if a label indicates pre-work (excludes from Ready queue).
 * @param {string} label - The label to check
 * @returns {boolean} True if the label is a pre-work phase
 */
export function isPreWorkPhase(label) {
  return PRE_WORK_PHASES.includes(label.toLowerCase());
}
