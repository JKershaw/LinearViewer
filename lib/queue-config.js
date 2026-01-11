/**
 * Queue Configuration
 *
 * Maps our internal queue model to Linear label names.
 * This configuration defines the expected workflow queues and which
 * Linear labels correspond to each queue.
 *
 * The audit feature uses this to check if the Linear workspace is
 * properly configured for our queue-based workflow.
 */

/**
 * Queue definitions for the workflow model.
 * Each queue has:
 * - name: Internal queue name
 * - labelPatterns: Array of label patterns to match (case-insensitive)
 * - required: Whether this queue must exist for the workflow to function
 * - description: Human-readable description of the queue's purpose
 */
export const QUEUE_CONFIG = [
  {
    name: 'Breakdown',
    labelPatterns: ['breakdown', 'needs-breakdown', 'status:breakdown', 'queue:breakdown'],
    required: true,
    description: 'Tasks that need to be broken down into smaller pieces'
  },
  {
    name: 'Research',
    labelPatterns: ['research', 'status:research', 'queue:research'],
    required: false,
    description: 'Tasks that need research or investigation before starting'
  },
  {
    name: 'Ready',
    labelPatterns: ['ready', 'status:ready', 'queue:ready'],
    required: true,
    description: 'Tasks that are ready to be picked up'
  },
  {
    name: 'In-Progress',
    labelPatterns: ['in-progress', 'status:in-progress', 'queue:in-progress', 'wip'],
    required: true,
    description: 'Tasks currently being worked on'
  },
  {
    name: 'Review',
    labelPatterns: ['review', 'status:review', 'queue:review', 'in-review'],
    required: true,
    description: 'Tasks awaiting review'
  }
];

/**
 * Matches a label name against a queue's patterns.
 *
 * @param {string} labelName - The label name to check
 * @param {string[]} patterns - Array of patterns to match against
 * @returns {boolean} True if the label matches any pattern
 */
export function matchesQueue(labelName, patterns) {
  const normalizedLabel = labelName.toLowerCase().trim();
  return patterns.some(pattern => normalizedLabel === pattern.toLowerCase());
}

/**
 * Finds which queue a label belongs to.
 *
 * @param {string} labelName - The label name to check
 * @returns {string|null} Queue name if matched, null if unmapped
 */
export function getQueueForLabel(labelName) {
  for (const queue of QUEUE_CONFIG) {
    if (matchesQueue(labelName, queue.labelPatterns)) {
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
