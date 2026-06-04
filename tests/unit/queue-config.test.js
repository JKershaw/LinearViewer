/**
 * Unit tests for queue-config.js
 *
 * Run with: node --test tests/unit/queue-config.test.js
 *
 * Tests the queue system (Ready / In-Progress / Review).
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
// Ready Queue excludeLabels Tests
// =============================================================================

describe('Ready queue excludeLabels', () => {
  const readyQueue = QUEUE_CONFIG.find(q => q.name === 'Ready');

  test('excludeLabels is an array', () => {
    assert.ok(Array.isArray(readyQueue.excludeLabels));
  });

  test('excludeLabels is empty (no labels exclude a task from Ready)', () => {
    assert.strictEqual(readyQueue.excludeLabels.length, 0);
  });

  test('excludeLabels does not contain work-issue labels', () => {
    const labels = readyQueue.excludeLabels;
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

  test('has exactly 3 queues', () => {
    assert.strictEqual(QUEUE_CONFIG.length, 3);
  });
});

// =============================================================================
// matchesPattern Tests
// =============================================================================

describe('matchesPattern', () => {
  test('returns true for exact match', () => {
    assert.strictEqual(matchesPattern('bug', ['bug']), true);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(matchesPattern('Bug', ['bug']), true);
    assert.strictEqual(matchesPattern('BUG', ['bug']), true);
    assert.strictEqual(matchesPattern('bug', ['BUG']), true);
  });

  test('trims whitespace', () => {
    assert.strictEqual(matchesPattern(' bug ', ['bug']), true);
  });

  test('returns false for non-match', () => {
    assert.strictEqual(matchesPattern('feature', ['bug']), false);
  });

  test('matches any pattern in array', () => {
    assert.strictEqual(matchesPattern('bug', ['blocked', 'bug']), true);
  });

  test('returns false for empty patterns array', () => {
    assert.strictEqual(matchesPattern('bug', []), false);
  });
});

// =============================================================================
// isInQueue Tests
// =============================================================================

describe('isInQueue', () => {
  describe('label-based queues', () => {
    // No label-based queues exist in QUEUE_CONFIG anymore; exercise the
    // LABEL matching branch with a synthetic queue definition.
    const labelQueue = { name: 'Test', type: QUEUE_TYPES.LABEL, labelPatterns: ['bug'] };

    test('returns true when issue has matching label', () => {
      const issue = {
        labels: { nodes: [{ name: 'bug' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, labelQueue), true);
    });

    test('returns false when issue lacks matching label', () => {
      const issue = {
        labels: { nodes: [{ name: 'feature' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, labelQueue), false);
    });

    test('is case-insensitive for labels', () => {
      const issue = {
        labels: { nodes: [{ name: 'BUG' }] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, labelQueue), true);
    });

    test('handles missing labels gracefully', () => {
      const issue = {
        labels: null,
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, labelQueue), false);
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

    test('returns true when in correct state', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'backlog' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), true);
    });

    test('returns true for unstarted state', () => {
      const issue = {
        labels: { nodes: [] },
        state: { type: 'unstarted' }
      };
      assert.strictEqual(isInQueue(issue, readyQueue), true);
    });

    test('does not exclude work-issue labels from Ready queue', () => {
      // blocked and bug do not exclude a task from Ready
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
  test('returns Ready queue for backlog issue', () => {
    const issue = {
      labels: { nodes: [] },
      state: { type: 'backlog' }
    };
    const queues = getQueuesForIssue(issue);
    assert.ok(queues.includes('Ready'));
  });

  test('returns Ready for backlog issue with a work-issue label', () => {
    const issue = {
      labels: { nodes: [{ name: 'bug' }] },
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
  test('returns null for all labels (no label-based queues)', () => {
    assert.strictEqual(getQueueForLabel('bug'), null);
    assert.strictEqual(getQueueForLabel('blocked'), null);
    assert.strictEqual(getQueueForLabel('feature'), null);
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

  test('includes Ready and In-Progress', () => {
    const required = getRequiredQueues();
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

  test('returns no label-based queues', () => {
    const queues = getLabelBasedQueues();
    assert.strictEqual(queues.length, 0);
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
});
