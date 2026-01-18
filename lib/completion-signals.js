/**
 * Completion Signals for AI Prompt Assessment
 *
 * This module defines unified completion signals for all prompt types,
 * enabling consistent assessment of whether a task's pre-work is complete.
 *
 * Core Principle: Block on inability to proceed, not on missing checkboxes.
 * Simple tasks need simple validation. Complex tasks need deeper signals.
 *
 * Each prompt type has:
 * - coreOutcome: The essential result that must be achieved
 * - signals: Supporting indicators (not all required, context-dependent)
 * - readinessCheck: The ultimate question to answer
 */

/**
 * @typedef {Object} CompletionSignal
 * @property {string} coreOutcome - The essential result that must be achieved
 * @property {string[]} signals - Supporting indicators (context-dependent, not all required)
 * @property {string} readinessCheck - The ultimate question to answer for this prompt type
 */

/**
 * Completion signals for all prompt types.
 * Null values indicate signals not yet defined (to be filled in subsequent tasks).
 *
 * @type {Object<string, CompletionSignal|null>}
 */
export const COMPLETION_SIGNALS = {
  'needs-research': {
    coreOutcome: 'Key question answered with enough info to proceed',
    signals: [
      'Recommended approach or next step identified',
      'Options evaluated (when multiple approaches exist)',
      'Risks or concerns noted (when discovered)',
      'Implementation considerations documented (for complex tasks)'
    ],
    readinessCheck: 'Could an implementor start work based on this?'
  },
  'needs-breakdown': {
    coreOutcome: 'Task split into actionable, right-sized pieces',
    signals: [
      'Subtasks created with clear titles and descriptions',
      'Dependencies identified via blocked-by relations',
      'Each subtask is small enough to complete in one session',
      'Subtasks cover the full scope of the parent task'
    ],
    readinessCheck: 'Could someone pick up any subtask and start working?'
  },
  'needs-scoping': {
    coreOutcome: 'Boundaries are clear and agreed upon',
    signals: [
      'In-scope items explicitly listed',
      'Out-of-scope items explicitly excluded',
      'Assumptions documented',
      'Success criteria defined'
    ],
    readinessCheck: 'Would two people independently agree on what is included?'
  },
  'needs-design': {
    coreOutcome: 'Approach chosen with clear rationale',
    signals: [
      'Multiple approaches evaluated (when applicable)',
      'Tradeoffs documented for chosen approach',
      'Key implementation details outlined',
      'Risks and mitigations identified'
    ],
    readinessCheck: 'Could an implementor start building based on this design?'
  },
  'needs-spike': {
    coreOutcome: 'Go/no-go decision made with evidence',
    signals: [
      'Specific questions answered with findings',
      'Proof-of-concept created (when applicable)',
      'Feasibility determined',
      'Remaining unknowns documented'
    ],
    readinessCheck: 'Do we know enough to make a confident decision?'
  },
  'needs-context': {
    coreOutcome: 'Current state understood and documented',
    signals: [
      'What has been done summarized',
      'What remains identified',
      'Key decisions documented',
      'Next steps recommended'
    ],
    readinessCheck: 'Could someone new pick this up and continue effectively?'
  },
  'blocked': {
    coreOutcome: 'Path forward identified and unblocking can proceed',
    signals: [
      'Blocker type identified (dependency, info, technical, external)',
      'Root cause understood',
      'Options to unblock evaluated',
      'Recommended action determined'
    ],
    readinessCheck: 'Can work resume based on this analysis?'
  },
  'bug': {
    coreOutcome: 'Issue understood well enough to fix',
    signals: [
      'Reproduction steps identified',
      'Root cause hypothesized or confirmed',
      'Fix approach determined',
      'Scope of impact understood'
    ],
    readinessCheck: 'Could someone implement a fix based on this?'
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
