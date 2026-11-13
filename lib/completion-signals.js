/**
 * Completion Signals for AI Prompt Assessment
 *
 * This module reads completion signals for the simplified label system, enabling
 * consistent assessment of whether a task's work is complete. The text is each kind's
 * `signals` on its record (lib/prompts/stage-kinds.js, LIN-4467).
 *
 * Core Principle: Block on inability to proceed, not on missing checkboxes.
 * Simple tasks need simple validation. Complex tasks need deeper signals.
 *
 * Workflow labels (1):
 * - bug: Investigating unexpected behavior
 *
 * Keyed by the literal prompt name (the `bug` key is the workflow label's value): the `blocked` prompt is a
 * universal option, not label-triggered.
 */

import { STAGE_KINDS } from './prompts/stage-kinds.js';

/**
 * @typedef {Object} CompletionSignal
 * @property {string} coreOutcome - The essential result that must be achieved
 * @property {string[]} signals - Supporting indicators (context-dependent, not all required)
 * @property {string} readinessCheck - The ultimate question to answer for this prompt type
 */

/**
 * Completion signals for the simplified 3-label system, by kind: a view of each kind's record
 * (lib/prompts/stage-kinds.js, LIN-4467). The text is written there, once, beside the kind's route and writes.
 *
 * @type {Object<string, CompletionSignal>}
 */
export const COMPLETION_SIGNALS = Object.fromEntries(
  Object.entries(STAGE_KINDS).map(([kind, record]) => [kind, record.signals])
);

/**
 * Get all prompt types that have completion signals defined: every kind, since each record carries its signals.
 * @returns {string[]} Array of prompt type keys with defined signals
 */
export function getDefinedSignalTypes() {
  return Object.keys(COMPLETION_SIGNALS);
}

/**
 * Check if a prompt type has completion signals defined.
 * @param {string} promptType - The prompt type key
 * @returns {boolean} True if signals are defined for this prompt type
 */
export function hasSignals(promptType) {
  return COMPLETION_SIGNALS[promptType] !== null &&
         COMPLETION_SIGNALS[promptType] !== undefined;
}

/**
 * Get the completion signal for a prompt type.
 * @param {string} promptType - The prompt type key
 * @returns {CompletionSignal|null} The signal definition or null if not defined
 */
export function getSignal(promptType) {
  return COMPLETION_SIGNALS[promptType] || null;
}

/**
 * Check if a prompt type's work appears complete based on context.
 * This is a heuristic check - the AI makes the final determination.
 *
 * @param {string} promptType - The prompt type key
 * @param {Object} context - Issue context (comments, children, description, etc.)
 * @param {Array} [context.comments] - Issue comments
 * @param {Array} [context.children] - Child issues
 * @param {string} [context.description] - Issue description
 * @returns {{complete: boolean, reason: string}} Assessment result with reason
 */
export function assessCompletion(promptType, context) {
  const signal = COMPLETION_SIGNALS[promptType];

  if (!signal) {
    return {
      complete: false,
      reason: `No completion signals defined for prompt type: ${promptType}`
    };
  }

  // For now, return incomplete with guidance to use AI assessment
  // The AI will use the signals to make the actual determination
  return {
    complete: false,
    reason: 'Use AI assessment with completion signals for accurate determination'
  };
}

/**
 * Get blocking issues preventing completion.
 * Returns potential blockers based on missing signals.
 *
 * @param {string} promptType - The prompt type key
 * @param {Object} context - Issue context
 * @returns {string[]} List of potential blockers
 */
export function getBlockers(promptType, context) {
  const signal = COMPLETION_SIGNALS[promptType];

  if (!signal) {
    return [`No completion signals defined for: ${promptType}`];
  }

  // Return the signals as potential blockers for AI to evaluate
  return signal.signals.map(s => `Missing: ${s}`);
}

/**
 * Format completion signals for inclusion in AI prompts/hints.
 * Returns a structured string that can be included in meta-prompts.
 *
 * @param {string} promptType - The prompt type key
 * @returns {string|null} Formatted signals string or null if not defined
 */
export function formatSignalsForPrompt(promptType) {
  const signal = COMPLETION_SIGNALS[promptType];

  if (!signal) {
    return null;
  }

  const lines = [
    `**Core Outcome:** ${signal.coreOutcome}`,
    '',
    '**Signals (context-dependent):**',
    ...signal.signals.map(s => `- ${s}`),
    '',
    `**Readiness Check:** ${signal.readinessCheck}`
  ];

  return lines.join('\n');
}
