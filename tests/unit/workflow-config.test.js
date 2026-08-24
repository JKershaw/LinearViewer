/**
 * Unit tests for workflow configuration.
 *
 * Run with: node --test tests/unit/workflow-config.test.js
 *
 * Tests the workflow label system:
 * - bug: Investigating unexpected behavior
 *
 * Note: the `blocked` label was abolished (LIN-357) — blocked-ness is now the
 * blocking `blocks`/`blocked-by` relationship, not a label.
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
    assert.strictEqual(WORK_ISSUE_LABELS.BUG, 'bug');
  });

  test('no longer carries a blocked label (LIN-357)', () => {
    assert.strictEqual(WORK_ISSUE_LABELS.BLOCKED, undefined);
  });

  test('has exactly 1 label', () => {
    assert.strictEqual(Object.keys(WORK_ISSUE_LABELS).length, 1);
  });
});

describe('VIRTUAL_PROMPTS', () => {
  test('has expected virtual prompts', () => {
    assert.strictEqual(VIRTUAL_PROMPTS.PLAN, 'plan');
    assert.strictEqual(VIRTUAL_PROMPTS.LOOK_INTO, 'look-into');
    assert.strictEqual(VIRTUAL_PROMPTS.TRIAGE, 'triage');
    assert.strictEqual(VIRTUAL_PROMPTS.REVIEW, 'review');
    // LIN-550: close-out is a first-class universal step alongside review/retro.
    assert.strictEqual(VIRTUAL_PROMPTS.CLOSE_OUT, 'close-out');
    // LIN-2261: the post-merge audit verb, distinct from the pre-merge-framed review.
    assert.strictEqual(VIRTUAL_PROMPTS.RETROSPECTIVE_AUDIT, 'retrospective-audit');
    assert.strictEqual(VIRTUAL_PROMPTS.RETRO, 'retro');
  });
});

// =============================================================================
// getWorkIssueLabels Tests
// =============================================================================

describe('getWorkIssueLabels', () => {
  test('returns array of work issue label values', () => {
    const labels = getWorkIssueLabels();
    assert.ok(Array.isArray(labels));
    assert.strictEqual(labels.length, 1);
  });

  test('includes bug but not blocked (LIN-357)', () => {
    const labels = getWorkIssueLabels();
    assert.ok(labels.includes('bug'));
    assert.ok(!labels.includes('blocked'));
  });
});

// =============================================================================
// Simplified Label System Tests
// =============================================================================

describe('Workflow label system', () => {
  test('total workflow labels is 1', () => {
    const allLabels = [...getWorkIssueLabels()];
    assert.strictEqual(allLabels.length, 1);
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
