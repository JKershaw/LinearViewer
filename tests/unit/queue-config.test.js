/**
 * Unit tests for queue-config.js
 *
 * Run with: node --test tests/unit/queue-config.test.js
 *
 * Tests the simplified queue system with preparing label.
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
import { PREPARING_LABEL } from '../../lib/workflow-config.js';

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

  test('excludeLabels contains preparing label', () => {
    const labels = readyQueue.excludeLabels;
    assert.ok(labels.includes(PREPARING_LABEL));
  });

  test('excludeLabels matches getPreWorkLabels()', () => {
    assert.deepStrictEqual(readyQueue.excludeLabels, getPreWorkLabels());
  });

  test('excludeLabels has exactly 1 label (preparing)', () => {
    assert.strictEqual(readyQueue.excludeLabels.length, 1);
  });

  test('excludeLabels does not contain work-issue labels', () => {
    const labels = readyQueue.excludeLabels;
    // blocked and bug are WORK_ISSUE category, not PRE_WORK
    assert.ok(!labels.includes('blocked'));
    assert.ok(!labels.includes('bug'));
  });
});

// =============================================================================
// QUEUE_CONFIG Tests
// =============================================================================

describe('QUEUE_CONFIG', () => {
  test('is an array', () => {
    assert.ok(Array.isArray(QUEUE_CONFIG));
  });

  test('has Preparing queue', () => {
    const preparing = QUEUE_CONFIG.find(q => q.name === 'Preparing');
    assert.ok(preparing);
    assert.strictEqual(preparing.type, QUEUE_TYPES.LABEL);
    assert.ok(preparing.labelPatterns.includes(PREPARING_LABEL));
    assert.strictEqual(preparing.required, true);
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

  test('has exactly 4 queues', () => {
    assert.strictEqual(QUEUE_CONFIG.length, 4);
  });
});

// =============================================================================
// matchesPattern Tests
// =============================================================================

describe('matchesPattern', () => {
  test('returns true for exact match', () => {
    assert.strictEqual(matchesPattern('preparing', ['preparing']), true);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(matchesPattern('Preparing', ['preparing']), true);
    assert.strictEqual(matchesPattern('PREPARING', ['preparing']), true);
    assert.strictEqual(matchesPattern('preparing', ['PREPARING']), true);
  });

  test('trims whitespace', () => {
    assert.strictEqual(matchesPattern(' preparing ', ['preparing']), true);
  });

  test('returns false for non-match', () => {
    assert.strictEqual(matchesPattern('bug', ['preparing']), false);
  });

  test('matches any pattern in array', () => {
    assert.strictEqual(matchesPattern('bug', ['preparing', 'bug']), true);
  });

  test('returns false for empty patterns array', () => {
    assert.strictEqual(matchesPattern('preparing', []), false);
  });
});

// =============================================================================
// isInQueue Tests
// =============================================================================

describe('isInQueue', () => {
  describe('label-based queues', () => {
    const preparingQueue = QUEUE_CONFIG.find(q => q.name === 'Preparing');

    test('returns true when issue has matching label', () => {
      const issue = {
        labels: { nodes: [{ name: 'preparing' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, preparingQueue), true);
    });

    test('returns false when issue lacks matching label', () => {
      const issue = {
        labels: { nodes: [{ name: 'bug' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, preparingQueue), false);
    });

    test('is case-insensitive for labels', () => {
      const issue = {
        labels: { nodes: [{ name: 'PREPARING' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, preparingQueue), true);
    });

    test('handles missing labels gracefully', () => {
      const issue = {
        labels: null,
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, preparingQueue), false);
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

    test('returns false when has preparing label', () => {
      const issue = {
        labels: { nodes: [{ name: 'preparing' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), false);
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
  test('returns Preparing queue for issue with preparing label', () => {
    const issue = {
      labels: { nodes: [{ name: 'preparing' }] },
      state: { type: 'backlog' }
    };
    const queues = getQueuesForIssue(issue);
    assert.ok(queues.includes('Preparing'));
    assert.ok(!queues.includes('Ready'));
  });

  test('returns Ready queue for backlog issue without preparing label', () => {
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
      labels: { nodes: [{ name: 'preparing' }] },
      state: { type: 'started' }
    };
    const queues = getQueuesForIssue(issue);
    assert.ok(queues.includes('Preparing'));
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
  test('returns Preparing for preparing label', () => {
    assert.strictEqual(getQueueForLabel('preparing'), 'Preparing');
  });

  test('returns null for non-label-based queue labels', () => {
    assert.strictEqual(getQueueForLabel('bug'), null);
    assert.strictEqual(getQueueForLabel('blocked'), null);
    assert.strictEqual(getQueueForLabel('feature'), null);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(getQueueForLabel('PREPARING'), 'Preparing');
    assert.strictEqual(getQueueForLabel('Preparing'), 'Preparing');
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
    assert.ok(names.includes('Preparing'));
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

  test('includes Preparing, Ready, and In-Progress', () => {
    const required = getRequiredQueues();
    assert.ok(required.includes('Preparing'));
    assert.ok(required.includes('Ready'));
    assert.ok(required.includes('In-Progress'));
  });

  test('does not include optional queues', () => {
    const required = getRequiredQueues();
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

  test('includes Preparing queue', () => {
    const queues = getLabelBasedQueues();
    const names = queues.map(q => q.name);
    assert.ok(names.includes('Preparing'));
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
    assert.ok(!names.includes('Preparing'));
  });
});
