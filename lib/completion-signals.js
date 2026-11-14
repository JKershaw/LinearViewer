/**
 * Completion signals by stage kind: a view of each kind's record (lib/prompts/stage-kinds.js, LIN-4467), where the
 * text is written once, beside the kind's route and writes. Read by the prompt formatters (lib/prompt-formatters.js)
 * and the audit (lib/audit.js).
 *
 * Core Principle: Block on inability to proceed, not on missing checkboxes.
 * Simple tasks need simple validation. Complex tasks need deeper signals.
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
 * Completion signals for every stage kind, a view of each kind's record.
 *
 * @type {Object<string, CompletionSignal>}
 */
export const COMPLETION_SIGNALS = Object.fromEntries(
  Object.entries(STAGE_KINDS).map(([kind, record]) => [kind, record.signals])
);
