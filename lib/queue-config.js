/**
 * Queue Configuration
 *
 * Maps our internal queue model to Linear's states and labels.
 * Uses a hybrid approach:
 * - Label-based queues: task is in queue if it has a specific label
 * - State-based queues: task is in queue if it's in a specific workflow state
 * - Implicit queues: task is in queue based on state + absence of labels
 */

/**
 * Queue types for different matching strategies.
 */
export const QUEUE_TYPES = {
  LABEL: 'label',       // Match by label presence
  STATE: 'state',       // Match by workflow state
  IMPLICIT: 'implicit'  // Match by state + absence of certain labels
};

/**
 * Labels that indicate a task is in a pre-work queue.
 * Used by implicit queues to exclude tasks that aren't ready.
 */
export const PRE_WORK_LABELS = ['needs-breakdown', 'needs-research'];

/**
 * Queue definitions for the workflow model.
 *
 * Each queue has:
 * - name: Internal queue name
 * - type: How to match tasks (label, state, or implicit)
 * - match: Label pattern or state type to match
 * - stateTypes: For state-based, which state types to match
 * - excludeLabels: For implicit, which labels exclude a task
 * - required: Whether this queue must exist for the workflow to function
 * - description: Human-readable description of the queue's purpose
 */
export const QUEUE_CONFIG = [
  {
    name: 'Breakdown',
    type: QUEUE_TYPES.LABEL,
    labelPatterns: ['needs-breakdown'],
    required: true,
    description: 'Tasks that need to be broken down into smaller pieces'
  },
  {
    name: 'Research',
    type: QUEUE_TYPES.LABEL,
    labelPatterns: ['needs-research'],
    required: false,
    description: 'Tasks that need research or investigation before starting'
  },
  {
    name: 'Ready',
    type: QUEUE_TYPES.IMPLICIT,
    stateTypes: ['backlog', 'unstarted'],
    excludeLabels: PRE_WORK_LABELS,
    required: true,
    description: 'Tasks ready to be picked up (unstarted, no pre-work labels)'
  },
  {
    name: 'In-Progress',
    type: QUEUE_TYPES.STATE,
    stateTypes: ['started'],
    required: true,
    description: 'Tasks currently being worked on'
  },
  {
    name: 'Review',
    type: QUEUE_TYPES.STATE,
    stateTypes: ['review'],  // May need adjustment based on actual Linear state
    required: false,  // Not all workflows have a review state
    description: 'Tasks awaiting review'
  }
];

/**
 * Checks if a label matches any of the given patterns (case-insensitive).
 *
 * @param {string} labelName - The label name to check
 * @param {string[]} patterns - Array of patterns to match against
 * @returns {boolean} True if the label matches any pattern
 */
export function matchesPattern(labelName, patterns) {
  const normalizedLabel = labelName.toLowerCase().trim();
  return patterns.some(pattern => normalizedLabel === pattern.toLowerCase());
}

/**
 * Checks if a task belongs to a specific queue.
 *
 * @param {Object} issue - The issue to check
 * @param {Object} queueDef - The queue definition
 * @returns {boolean} True if the issue belongs to this queue
 */
export function isInQueue(issue, queueDef) {
  const issueLabels = (issue.labels?.nodes || []).map(l => l.name.toLowerCase());
  const stateType = issue.state?.type?.toLowerCase() || '';

  switch (queueDef.type) {
    case QUEUE_TYPES.LABEL:
      // Task has one of the queue's labels
      return queueDef.labelPatterns.some(pattern =>
        issueLabels.includes(pattern.toLowerCase())
      );

    case QUEUE_TYPES.STATE:
      // Task is in one of the queue's state types
      return queueDef.stateTypes.some(st => st.toLowerCase() === stateType);

    case QUEUE_TYPES.IMPLICIT:
      // Task is in correct state AND doesn't have any excluded labels
      const inCorrectState = queueDef.stateTypes.some(st =>
        st.toLowerCase() === stateType
      );
      const hasExcludedLabel = queueDef.excludeLabels.some(label =>
        issueLabels.includes(label.toLowerCase())
      );
      return inCorrectState && !hasExcludedLabel;

    default:
      return false;
  }
}

/**
 * Gets all queues a task belongs to.
 *
 * @param {Object} issue - The issue to check
 * @returns {string[]} Array of queue names the task belongs to
 */
export function getQueuesForIssue(issue) {
  return QUEUE_CONFIG
    .filter(queueDef => isInQueue(issue, queueDef))
    .map(queueDef => queueDef.name);
}

/**
 * Finds which label-based queue a label belongs to.
 * Only checks label-based queues (not state or implicit).
 *
 * @param {string} labelName - The label name to check
 * @returns {string|null} Queue name if matched, null if unmapped
 */
export function getQueueForLabel(labelName) {
  for (const queue of QUEUE_CONFIG) {
    if (queue.type === QUEUE_TYPES.LABEL &&
        matchesPattern(labelName, queue.labelPatterns)) {
      return queue.name;
    }
  }
  return null;
}

/**
 * Gets all queue names from the configuration.
 *
 * @returns {string[]} Array of queue names
 */
export function getQueueNames() {
  return QUEUE_CONFIG.map(q => q.name);
}

/**
 * Gets all required queue names.
 *
 * @returns {string[]} Array of required queue names
 */
export function getRequiredQueues() {
  return QUEUE_CONFIG.filter(q => q.required).map(q => q.name);
}

/**
 * Gets all label-based queues.
 *
 * @returns {Object[]} Array of label-based queue definitions
 */
export function getLabelBasedQueues() {
  return QUEUE_CONFIG.filter(q => q.type === QUEUE_TYPES.LABEL);
}

/**
 * Gets all state-based queues (including implicit).
 *
 * @returns {Object[]} Array of state-based queue definitions
 */
export function getStateBasedQueues() {
  return QUEUE_CONFIG.filter(q =>
    q.type === QUEUE_TYPES.STATE || q.type === QUEUE_TYPES.IMPLICIT
  );
}
