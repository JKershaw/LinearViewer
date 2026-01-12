/**
 * Unit tests for queue-config.js
 *
 * Run with: node --test tests/unit/queue-config.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  QUEUE_TYPES,
  QUEUE_CONFIG,
  matchesPattern,
  isInQueue,
  getQueuesForIssue,
  getQueueForLabel,
  getQueueNames,
  getRequiredQueues,
  getLabelBasedQueues,
  getStateBasedQueues
} from '../../lib/queue-config.js';
import { getPreWorkLabels } from '../../lib/prompt-templates.js';

// =============================================================================
// QUEUE_TYPES Tests
// =============================================================================

describe('QUEUE_TYPES', () => {
  test('has LABEL type', () => {
    assert.strictEqual(QUEUE_TYPES.LABEL, 'label');
  });

  test('has STATE type', () => {
    assert.strictEqual(QUEUE_TYPES.STATE, 'state');
  });

  test('has IMPLICIT type', () => {
    assert.strictEqual(QUEUE_TYPES.IMPLICIT, 'implicit');
  });
});

// =============================================================================
// Ready Queue excludeLabels Tests (via getPreWorkLabels)
// =============================================================================

describe('Ready queue excludeLabels', () => {
  const readyQueue = QUEUE_CONFIG.find(q => q.name === 'Ready');

  test('excludeLabels is an array', () => {
    assert.ok(Array.isArray(readyQueue.excludeLabels));
  });

  test('excludeLabels contains expected pre-work labels', () => {
    const labels = readyQueue.excludeLabels;
    assert.ok(labels.includes('needs-breakdown'));
    assert.ok(labels.includes('needs-research'));
    assert.ok(labels.includes('needs-scoping'));
    assert.ok(labels.includes('needs-design'));
    assert.ok(labels.includes('needs-spike'));
    assert.ok(labels.includes('needs-context'));
  });

  test('excludeLabels matches getPreWorkLabels()', () => {
    assert.deepStrictEqual(readyQueue.excludeLabels, getPreWorkLabels());
  });

  test('excludeLabels does not contain work-issue labels', () => {
    const labels = readyQueue.excludeLabels;
    // blocked and bug are WORK_ISSUE category, not PRE_WORK
    assert.ok(!labels.includes('blocked'));
    assert.ok(!labels.includes('bug'));
  });

  test('excludeLabels does not contain ready-state labels', () => {
    const labels = readyQueue.excludeLabels;
    assert.ok(!labels.includes('plan'));
    assert.ok(!labels.includes('code-review'));
  });
});

// =============================================================================
// QUEUE_CONFIG Tests
// =============================================================================

describe('QUEUE_CONFIG', () => {
  test('is an array', () => {
    assert.ok(Array.isArray(QUEUE_CONFIG));
  });

  test('has Breakdown queue', () => {
    const breakdown = QUEUE_CONFIG.find(q => q.name === 'Breakdown');
    assert.ok(breakdown);
    assert.strictEqual(breakdown.type, QUEUE_TYPES.LABEL);
    assert.ok(breakdown.labelPatterns.includes('needs-breakdown'));
    assert.strictEqual(breakdown.required, true);
  });

  test('has Research queue', () => {
    const research = QUEUE_CONFIG.find(q => q.name === 'Research');
    assert.ok(research);
    assert.strictEqual(research.type, QUEUE_TYPES.LABEL);
    assert.ok(research.labelPatterns.includes('needs-research'));
    assert.strictEqual(research.required, false);
  });

  test('has Ready queue', () => {
    const ready = QUEUE_CONFIG.find(q => q.name === 'Ready');
    assert.ok(ready);
    assert.strictEqual(ready.type, QUEUE_TYPES.IMPLICIT);
    assert.ok(ready.stateTypes.includes('backlog'));
    assert.ok(ready.stateTypes.includes('unstarted'));
    assert.ok(Array.isArray(ready.excludeLabels));
    assert.strictEqual(ready.required, true);
  });

  test('has In-Progress queue', () => {
    const inProgress = QUEUE_CONFIG.find(q => q.name === 'In-Progress');
    assert.ok(inProgress);
    assert.strictEqual(inProgress.type, QUEUE_TYPES.STATE);
    assert.ok(inProgress.stateTypes.includes('started'));
    assert.strictEqual(inProgress.required, true);
  });

  test('has Review queue', () => {
    const review = QUEUE_CONFIG.find(q => q.name === 'Review');
    assert.ok(review);
    assert.strictEqual(review.type, QUEUE_TYPES.STATE);
    assert.ok(review.stateTypes.includes('review'));
    assert.strictEqual(review.required, false);
  });

  test('all queues have required properties', () => {
    for (const queue of QUEUE_CONFIG) {
      assert.ok(queue.name, `Queue should have name`);
      assert.ok(queue.type, `Queue ${queue.name} should have type`);
      assert.ok(typeof queue.required === 'boolean', `Queue ${queue.name} should have required flag`);
      assert.ok(queue.description, `Queue ${queue.name} should have description`);
    }
  });
});

// =============================================================================
// matchesPattern Tests
// =============================================================================

describe('matchesPattern', () => {
  test('returns true for exact match', () => {
    assert.strictEqual(matchesPattern('needs-breakdown', ['needs-breakdown']), true);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(matchesPattern('Needs-Breakdown', ['needs-breakdown']), true);
    assert.strictEqual(matchesPattern('NEEDS-BREAKDOWN', ['needs-breakdown']), true);
    assert.strictEqual(matchesPattern('needs-breakdown', ['NEEDS-BREAKDOWN']), true);
  });

  test('trims whitespace', () => {
    assert.strictEqual(matchesPattern(' needs-breakdown ', ['needs-breakdown']), true);
  });

  test('returns false for non-match', () => {
    assert.strictEqual(matchesPattern('bug', ['needs-breakdown']), false);
  });

  test('matches any pattern in array', () => {
    assert.strictEqual(matchesPattern('needs-research', ['needs-breakdown', 'needs-research']), true);
  });

  test('returns false for empty patterns array', () => {
    assert.strictEqual(matchesPattern('needs-breakdown', []), false);
  });
});

// =============================================================================
// isInQueue Tests
// =============================================================================

describe('isInQueue', () => {
  describe('label-based queues', () => {
    const breakdownQueue = QUEUE_CONFIG.find(q => q.name === 'Breakdown');

    test('returns true when issue has matching label', () => {
      const issue = {
        labels: { nodes: [{ name: 'needs-breakdown' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, breakdownQueue), true);
    });

    test('returns false when issue lacks matching label', () => {
      const issue = {
        labels: { nodes: [{ name: 'bug' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, breakdownQueue), false);
    });

    test('is case-insensitive for labels', () => {
      const issue = {
        labels: { nodes: [{ name: 'NEEDS-BREAKDOWN' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, breakdownQueue), true);
    });

    test('handles missing labels gracefully', () => {
      const issue = {
        labels: null,
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, breakdownQueue), false);
    });
  });

  describe('state-based queues', () => {
    const inProgressQueue = QUEUE_CONFIG.find(q => q.name === 'In-Progress');

    test('returns true when issue has matching state', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'started' }
      };
      assert.strictEqual(isInQueue(issue, inProgressQueue), true);
    });

    test('returns false when issue has different state', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, inProgressQueue), false);
    });

    test('is case-insensitive for state type', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'STARTED' }
      };
      assert.strictEqual(isInQueue(issue, inProgressQueue), true);
    });

    test('handles missing state gracefully', () => {
      const issue = {
        labels: { nodes: [] },
        state: null
      };
      assert.strictEqual(isInQueue(issue, inProgressQueue), false);
    });
  });

  describe('implicit queues', () => {
    const readyQueue = QUEUE_CONFIG.find(q => q.name === 'Ready');

    test('returns true when in correct state without excluded labels', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), true);
    });

    test('returns true for unstarted state without excluded labels', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'unstarted' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), true);
    });

    test('returns false when has excluded label', () => {
      const issue = {
        labels: { nodes: [{ name: 'needs-breakdown' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), false);
    });

    test('returns false when has any pre-work label', () => {
      // Only PRE_WORK category labels exclude from Ready queue
      const preWorkLabels = ['needs-research', 'needs-scoping', 'needs-design', 'needs-spike', 'needs-context'];
      for (const label of preWorkLabels) {
        const issue = {
          labels: { nodes: [{ name: label }] },
          state: { type: 'backlog' }
        };
        assert.strictEqual(isInQueue(issue, readyQueue), false, `Should exclude ${label}`);
      }
    });

    test('does not exclude work-issue labels from Ready queue', () => {
      // blocked and bug are WORK_ISSUE category, not excluded from Ready
      const workIssueLabels = ['blocked', 'bug'];
      for (const label of workIssueLabels) {
        const issue = {
          labels: { nodes: [{ name: label }] },
          state: { type: 'backlog' }
        };
        assert.strictEqual(isInQueue(issue, readyQueue), true, `Should not exclude ${label}`);
      }
    });

    test('returns false when in wrong state', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'started' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), false);
    });

    test('returns false when in completed state', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'completed' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), false);
    });
  });

  test('returns false for unknown queue type', () => {
    const unknownQueue = { type: 'unknown', name: 'Unknown' };
    const issue = {
      labels: { nodes: [] },
      state: { type: 'backlog' }
    };
    assert.strictEqual(isInQueue(issue, unknownQueue), false);
  });
});

// =============================================================================
// getQueuesForIssue Tests
// =============================================================================

describe('getQueuesForIssue', () => {
  test('returns Breakdown queue for issue with needs-breakdown label', () => {
    const issue = {
      labels: { nodes: [{ name: 'needs-breakdown' }] },
      state: { type: 'backlog' }
    };
    const queues = getQueuesForIssue(issue);
    assert.ok(queues.includes('Breakdown'));
    assert.ok(!queues.includes('Ready'));
  });

  test('returns Ready queue for backlog issue without pre-work labels', () => {
    const issue = {
      labels: { nodes: [] },
      state: { type: 'backlog' }
    };
    const queues = getQueuesForIssue(issue);
    assert.ok(queues.includes('Ready'));
  });

  test('returns In-Progress queue for started issue', () => {
    const issue = {
      labels: { nodes: [] },
      state: { type: 'started' }
    };
    const queues = getQueuesForIssue(issue);
    assert.ok(queues.includes('In-Progress'));
  });

  test('returns multiple queues when applicable', () => {
    const issue = {
      labels: { nodes: [{ name: 'needs-breakdown' }] },
      state: { type: 'started' }
    };
    const queues = getQueuesForIssue(issue);
    assert.ok(queues.includes('Breakdown'));
    assert.ok(queues.includes('In-Progress'));
  });

  test('returns empty array for completed issue without labels', () => {
    const issue = {
      labels: { nodes: [] },
      state: { type: 'completed' }
    };
    const queues = getQueuesForIssue(issue);
    assert.deepStrictEqual(queues, []);
  });
});

// =============================================================================
// getQueueForLabel Tests
// =============================================================================

describe('getQueueForLabel', () => {
  test('returns Breakdown for needs-breakdown', () => {
    assert.strictEqual(getQueueForLabel('needs-breakdown'), 'Breakdown');
  });

  test('returns Research for needs-research', () => {
    assert.strictEqual(getQueueForLabel('needs-research'), 'Research');
  });

  test('returns null for non-label-based queue labels', () => {
    assert.strictEqual(getQueueForLabel('bug'), null);
    assert.strictEqual(getQueueForLabel('feature'), null);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(getQueueForLabel('NEEDS-BREAKDOWN'), 'Breakdown');
    assert.strictEqual(getQueueForLabel('Needs-Research'), 'Research');
  });
});

// =============================================================================
// getQueueNames Tests
// =============================================================================

describe('getQueueNames', () => {
  test('returns array of queue names', () => {
    const names = getQueueNames();
    assert.ok(Array.isArray(names));
  });

  test('includes all expected queue names', () => {
    const names = getQueueNames();
    assert.ok(names.includes('Breakdown'));
    assert.ok(names.includes('Research'));
    assert.ok(names.includes('Ready'));
    assert.ok(names.includes('In-Progress'));
    assert.ok(names.includes('Review'));
  });

  test('returns same count as QUEUE_CONFIG', () => {
    const names = getQueueNames();
    assert.strictEqual(names.length, QUEUE_CONFIG.length);
  });
});

// =============================================================================
// getRequiredQueues Tests
// =============================================================================

describe('getRequiredQueues', () => {
  test('returns array of required queue names', () => {
    const required = getRequiredQueues();
    assert.ok(Array.isArray(required));
  });

  test('includes Breakdown, Ready, and In-Progress', () => {
    const required = getRequiredQueues();
    assert.ok(required.includes('Breakdown'));
    assert.ok(required.includes('Ready'));
    assert.ok(required.includes('In-Progress'));
  });

  test('does not include optional queues', () => {
    const required = getRequiredQueues();
    assert.ok(!required.includes('Research'));
    assert.ok(!required.includes('Review'));
  });
});

// =============================================================================
// getLabelBasedQueues Tests
// =============================================================================

describe('getLabelBasedQueues', () => {
  test('returns array of queue definitions', () => {
    const queues = getLabelBasedQueues();
    assert.ok(Array.isArray(queues));
  });

  test('includes only LABEL type queues', () => {
    const queues = getLabelBasedQueues();
    for (const queue of queues) {
      assert.strictEqual(queue.type, QUEUE_TYPES.LABEL);
    }
  });

  test('includes Breakdown and Research queues', () => {
    const queues = getLabelBasedQueues();
    const names = queues.map(q => q.name);
    assert.ok(names.includes('Breakdown'));
    assert.ok(names.includes('Research'));
  });

  test('does not include state-based or implicit queues', () => {
    const queues = getLabelBasedQueues();
    const names = queues.map(q => q.name);
    assert.ok(!names.includes('Ready'));
    assert.ok(!names.includes('In-Progress'));
    assert.ok(!names.includes('Review'));
  });
});

// =============================================================================
// getStateBasedQueues Tests
// =============================================================================

describe('getStateBasedQueues', () => {
  test('returns array of queue definitions', () => {
    const queues = getStateBasedQueues();
    assert.ok(Array.isArray(queues));
  });

  test('includes STATE and IMPLICIT type queues', () => {
    const queues = getStateBasedQueues();
    for (const queue of queues) {
      assert.ok(
        queue.type === QUEUE_TYPES.STATE || queue.type === QUEUE_TYPES.IMPLICIT,
        `Queue ${queue.name} should be STATE or IMPLICIT type`
      );
    }
  });

  test('includes Ready, In-Progress, and Review queues', () => {
    const queues = getStateBasedQueues();
    const names = queues.map(q => q.name);
    assert.ok(names.includes('Ready'));
    assert.ok(names.includes('In-Progress'));
    assert.ok(names.includes('Review'));
  });

  test('does not include label-based queues', () => {
    const queues = getStateBasedQueues();
    const names = queues.map(q => q.name);
    assert.ok(!names.includes('Breakdown'));
    assert.ok(!names.includes('Research'));
  });
});
