/**
 * Unit tests for workflow configuration.
 *
 * Run with: node --test tests/unit/workflow-config.test.js
 *
 * Tests the workflow label system:
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  WORK_ISSUE_LABELS,
  VIRTUAL_PROMPTS,
  getWorkIssueLabels
} from '../../lib/workflow-config.js';

// =============================================================================
// Constants Tests
// =============================================================================

describe('WORK_ISSUE_LABELS', () => {
  test('has expected work issue labels', () => {
    assert.strictEqual(WORK_ISSUE_LABELS.BLOCKED, 'blocked');
    assert.strictEqual(WORK_ISSUE_LABELS.BUG, 'bug');
  });

  test('has exactly 2 labels', () => {
    assert.strictEqual(Object.keys(WORK_ISSUE_LABELS).length, 2);
  });
});

describe('VIRTUAL_PROMPTS', () => {
  test('has expected virtual prompts', () => {
    assert.strictEqual(VIRTUAL_PROMPTS.PLAN, 'plan');
    assert.strictEqual(VIRTUAL_PROMPTS.LOOK_INTO, 'look-into');
    assert.strictEqual(VIRTUAL_PROMPTS.TRIAGE, 'triage');
  });
});

// =============================================================================
// getWorkIssueLabels Tests
// =============================================================================

describe('getWorkIssueLabels', () => {
  test('returns array of work issue label values', () => {
    const labels = getWorkIssueLabels();
    assert.ok(Array.isArray(labels));
    assert.strictEqual(labels.length, 2);
  });

  test('includes blocked and bug', () => {
    const labels = getWorkIssueLabels();
    assert.ok(labels.includes('blocked'));
    assert.ok(labels.includes('bug'));
  });
});

// =============================================================================
// Simplified Label System Tests
// =============================================================================

describe('Workflow label system', () => {
  test('total workflow labels is 2', () => {
    const allLabels = [...getWorkIssueLabels()];
    assert.strictEqual(allLabels.length, 2);
  });

  test('all labels are lowercase', () => {
    const allLabels = [...getWorkIssueLabels()];
    for (const label of allLabels) {
      assert.strictEqual(label, label.toLowerCase(), `${label} should be lowercase`);
    }
  });

  test('no duplicate labels', () => {
    const allLabels = [...getWorkIssueLabels()];
    const unique = new Set(allLabels);
    assert.strictEqual(unique.size, allLabels.length);
  });
});
