/**
 * Completion Signals for AI Prompt Assessment
 *
 * This module defines completion signals for the simplified label system,
 * enabling consistent assessment of whether a task's work is complete.
 *
 * Core Principle: Block on inability to proceed, not on missing checkboxes.
 * Simple tasks need simple validation. Complex tasks need deeper signals.
 *
 * Simplified label system (3 labels):
 * - preparing: Pre-implementation work (research, breakdown, design, etc.)
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */

import { WORK_ISSUE_LABELS, PREPARING_LABEL } from './workflow-config.js';

/**
 * @typedef {Object} CompletionSignal
 * @property {string} coreOutcome - The essential result that must be achieved
 * @property {string[]} signals - Supporting indicators (context-dependent, not all required)
 * @property {string} readinessCheck - The ultimate question to answer for this prompt type
 */

/**
 * Completion signals for the simplified 3-label system.
 *
 * @type {Object<string, CompletionSignal|null>}
 */
export const COMPLETION_SIGNALS = {
  [PREPARING_LABEL]: {
    coreOutcome: 'Task is ready for implementation',
    signals: [
      'Key questions answered or verified',
      'Requirements clear and concrete',
      'Approach decided (if multiple options existed)',
      'Task small enough to complete in one session (or broken into subtasks)',
      'No unresolved blockers or unknowns'
    ],
    readinessCheck: 'Could an implementor start work based on what is known?'
  },
  [WORK_ISSUE_LABELS.BLOCKED]: {
    coreOutcome: 'Path forward identified and unblocking can proceed',
    signals: [
      'Blocker type identified (dependency, info, technical, external)',
      'Root cause understood',
      'Options to unblock evaluated',
      'Recommended action determined'
    ],
    readinessCheck: 'Can work resume based on this analysis?'
  },
  [WORK_ISSUE_LABELS.BUG]: {
    coreOutcome: 'Issue understood well enough to fix',
    signals: [
      'Reproduction steps identified',
      'Root cause hypothesized or confirmed',
      'Fix approach determined',
      'Scope of impact understood'
    ],
    readinessCheck: 'Could someone implement a fix based on this?'
  },

  // READY category (implementation-focused)
  'plan': {
    coreOutcome: 'Clear implementation plan documented with scope assessed',
    signals: [
      'Implementation steps clearly documented in description',
      'Files and functions to modify identified',
      'Dependencies and order of operations defined',
      'Test strategy outlined',
      'Scope bounded (what will and won\'t be done)',
      'Scope assessment completed (single task or needs breakdown)',
      'Plan includes necessary refactoring or cleanup steps before or during implementation'
    ],
    readinessCheck: 'Is the plan documented and has scope been assessed for breakdown?'
  },
  'code-review': {
    coreOutcome: 'Code reviewed with clear verdict provided',
    signals: [
      'Changes match task requirements',
      'Test coverage verified',
      'Security review completed',
      'Code style consistent with codebase',
      'No performance regressions identified'
    ],
    readinessCheck: 'Is a clear verdict (Approve/Request Changes/Needs Discussion) provided with justification?'
  },

  // UNIVERSAL category (information-gathering)
  'look-into': {
    coreOutcome: 'Task context understood with recommended next action',
    signals: [
      'Task purpose and requirements summarized',
      'Project context identified',
      'Current status and blockers assessed',
      'Recommended next prompt type identified'
    ],
    readinessCheck: 'Can someone decide what to do next based on this overview?'
  },
  'triage': {
    coreOutcome: 'Task metadata reflects its actual status',
    signals: [
      'Labels appropriate for current state',
      'Priority matches importance and urgency',
      'State accurate for current progress',
      'Changes applied via Linear MCP'
    ],
    readinessCheck: 'Is the task properly organized for the next workflow stage?'
  },
  'breakdown': {
    coreOutcome: 'Task decomposed into actionable subtasks with clear ordering',
    signals: [
      'Subtasks created with clear titles and descriptions',
      'Each subtask has acceptance criteria',
      'Blocked-by relations establish execution order',
      'Summary comment added to parent task'
    ],
    readinessCheck: 'Can someone start working through the subtasks in order?'
  },
  'research': {
    coreOutcome: 'Key questions answered with actionable recommendations',
    signals: [
      'Key discoveries and insights documented',
      'Options evaluated with pros/cons',
      'Recommended next steps provided',
      'Description updated with key findings',
      'Refactoring opportunities or technical debt in the affected area identified'
    ],
    readinessCheck: 'Can someone proceed based on these findings?'
  },
  'scoping': {
    coreOutcome: 'Scope clearly defined and documented in description',
    signals: [
      'In scope items explicitly listed',
      'Out of scope items explicitly excluded',
      'Assumptions stated',
      'Success criteria defined',
      'Open questions flagged for resolution'
    ],
    readinessCheck: 'Is there enough clarity to start implementation?'
  },
  'design': {
    coreOutcome: 'Design approach chosen with clear rationale',
    signals: [
      'Multiple approaches evaluated (2-3)',
      'Tradeoffs documented for each',
      'Recommendation made with rationale',
      'Implementation considerations outlined'
    ],
    readinessCheck: 'Can implementation proceed based on this design?'
  },
  'spike': {
    coreOutcome: 'Technical questions answered with go/no-go recommendation',
    signals: [
      'Specific questions defined upfront',
      'Exploration completed within timebox',
      'Proof-of-concept code created (if applicable)',
      'Findings documented with recommendation'
    ],
    readinessCheck: 'Is there enough information to make a technical decision?'
  },
  'context': {
    coreOutcome: 'Current state and history clearly summarized',
    signals: [
      'Current state documented',
      'Completed work identified',
      'Remaining work listed',
      'Key decisions noted',
      'Next steps recommended'
    ],
    readinessCheck: 'Can someone pick up this task based on this summary?'
  },
  'implementation': {
    coreOutcome: 'Code changes complete with tests passing',
    signals: [
      'Implementation follows plan (if present)',
      'Code changes committed',
      'Tests written and passing',
      'Summary comment added'
    ],
    readinessCheck: 'Is the implementation complete and tested?'
  },
  'review': {
    coreOutcome: 'Implementation verified ready for production',
    signals: [
      'Requirements matched',
      'Tests pass',
      'CI/CD pipeline passes',
      'No regressions identified'
    ],
    readinessCheck: 'Is the code ready for production deployment?'
  }
};

/**
 * Get all prompt types that have completion signals defined.
 * @returns {string[]} Array of prompt type keys with defined signals
 */
export function getDefinedSignalTypes() {
  return Object.entries(COMPLETION_SIGNALS)
    .filter(([, signal]) => signal !== null)
    .map(([key]) => key);
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

/**
 * Format all defined signals for meta-prompt inclusion.
 * Returns a summary of all signals for AI reference.
 *
 * @returns {string} Formatted summary of all defined signals
 */
export function formatAllSignalsForMetaPrompt() {
  const defined = getDefinedSignalTypes();

  if (defined.length === 0) {
    return 'No completion signals defined yet.';
  }

  const sections = defined.map(promptType => {
    const signal = COMPLETION_SIGNALS[promptType];
    return [
      `### ${promptType}`,
      `**Core:** ${signal.coreOutcome}`,
      `**Check:** ${signal.readinessCheck}`,
      ''
    ].join('\n');
  });

  return sections.join('\n');
}
