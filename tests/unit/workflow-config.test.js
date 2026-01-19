/**
 * Unit tests for workflow configuration.
 *
 * Run with: node --test tests/unit/workflow-config.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  PHASE_LABELS,
  WORK_ISSUE_LABELS,
  VIRTUAL_PROMPTS,
  PRE_WORK_PHASES,
  getPhaseLabels,
  getWorkIssueLabels,
  isPhaseLabel,
  getPhaseKey,
  getPreWorkPhaseLabels,
  isPreWorkPhase
} from '../../lib/workflow-config.js';

// =============================================================================
// Constants Tests
// =============================================================================

describe('PHASE_LABELS', () => {
  test('has all expected phase labels', () => {
    assert.strictEqual(PHASE_LABELS.RESEARCH, 'in-research');
    assert.strictEqual(PHASE_LABELS.BREAKDOWN, 'in-breakdown');
    assert.strictEqual(PHASE_LABELS.SCOPING, 'in-scoping');
    assert.strictEqual(PHASE_LABELS.DESIGN, 'in-design');
    assert.strictEqual(PHASE_LABELS.SPIKE, 'in-spike');
    assert.strictEqual(PHASE_LABELS.CONTEXT, 'in-context');
    assert.strictEqual(PHASE_LABELS.IMPLEMENTATION, 'in-implementation');
    assert.strictEqual(PHASE_LABELS.REVIEW, 'in-review');
  });

  test('uses in-X naming convention', () => {
    for (const value of Object.values(PHASE_LABELS)) {
      assert.ok(value.startsWith('in-'), `${value} should start with 'in-'`);
    }
  });
});

describe('WORK_ISSUE_LABELS', () => {
  test('has expected work issue labels', () => {
    assert.strictEqual(WORK_ISSUE_LABELS.BLOCKED, 'blocked');
    assert.strictEqual(WORK_ISSUE_LABELS.BUG, 'bug');
  });
});

describe('VIRTUAL_PROMPTS', () => {
  test('has expected virtual prompts', () => {
    assert.strictEqual(VIRTUAL_PROMPTS.PLAN, 'plan');
    assert.strictEqual(VIRTUAL_PROMPTS.CODE_REVIEW, 'code-review');
    assert.strictEqual(VIRTUAL_PROMPTS.LOOK_INTO, 'look-into');
    assert.strictEqual(VIRTUAL_PROMPTS.TRIAGE, 'triage');
  });
});

describe('PRE_WORK_PHASES', () => {
  test('contains expected pre-work phases', () => {
    assert.ok(PRE_WORK_PHASES.includes(PHASE_LABELS.RESEARCH));
    assert.ok(PRE_WORK_PHASES.includes(PHASE_LABELS.BREAKDOWN));
    assert.ok(PRE_WORK_PHASES.includes(PHASE_LABELS.SCOPING));
    assert.ok(PRE_WORK_PHASES.includes(PHASE_LABELS.DESIGN));
    assert.ok(PRE_WORK_PHASES.includes(PHASE_LABELS.SPIKE));
    assert.ok(PRE_WORK_PHASES.includes(PHASE_LABELS.CONTEXT));
  });

  test('does not include implementation or review phases', () => {
    assert.ok(!PRE_WORK_PHASES.includes(PHASE_LABELS.IMPLEMENTATION));
    assert.ok(!PRE_WORK_PHASES.includes(PHASE_LABELS.REVIEW));
  });
});

// =============================================================================
// getPhaseLabels Tests
// =============================================================================

describe('getPhaseLabels', () => {
  test('returns array of all phase label values', () => {
    const labels = getPhaseLabels();
    assert.ok(Array.isArray(labels));
    assert.strictEqual(labels.length, 8);
  });

  test('includes all expected phase labels', () => {
    const labels = getPhaseLabels();
    assert.ok(labels.includes('in-research'));
    assert.ok(labels.includes('in-breakdown'));
    assert.ok(labels.includes('in-scoping'));
    assert.ok(labels.includes('in-design'));
    assert.ok(labels.includes('in-spike'));
    assert.ok(labels.includes('in-context'));
    assert.ok(labels.includes('in-implementation'));
    assert.ok(labels.includes('in-review'));
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
// isPhaseLabel Tests
// =============================================================================

describe('isPhaseLabel', () => {
  test('returns true for valid phase labels', () => {
    assert.strictEqual(isPhaseLabel('in-research'), true);
    assert.strictEqual(isPhaseLabel('in-breakdown'), true);
    assert.strictEqual(isPhaseLabel('in-implementation'), true);
    assert.strictEqual(isPhaseLabel('in-review'), true);
  });

  test('returns false for non-phase labels', () => {
    assert.strictEqual(isPhaseLabel('blocked'), false);
    assert.strictEqual(isPhaseLabel('bug'), false);
    assert.strictEqual(isPhaseLabel('feature'), false);
    assert.strictEqual(isPhaseLabel('plan'), false);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(isPhaseLabel('IN-RESEARCH'), true);
    assert.strictEqual(isPhaseLabel('In-Breakdown'), true);
    assert.strictEqual(isPhaseLabel('IN-IMPLEMENTATION'), true);
  });
});

// =============================================================================
// getPhaseKey Tests
// =============================================================================

describe('getPhaseKey', () => {
  test('returns correct key for phase labels', () => {
    assert.strictEqual(getPhaseKey('in-research'), 'RESEARCH');
    assert.strictEqual(getPhaseKey('in-breakdown'), 'BREAKDOWN');
    assert.strictEqual(getPhaseKey('in-scoping'), 'SCOPING');
    assert.strictEqual(getPhaseKey('in-design'), 'DESIGN');
    assert.strictEqual(getPhaseKey('in-spike'), 'SPIKE');
    assert.strictEqual(getPhaseKey('in-context'), 'CONTEXT');
    assert.strictEqual(getPhaseKey('in-implementation'), 'IMPLEMENTATION');
    assert.strictEqual(getPhaseKey('in-review'), 'REVIEW');
  });

  test('returns null for non-phase labels', () => {
    assert.strictEqual(getPhaseKey('blocked'), null);
    assert.strictEqual(getPhaseKey('bug'), null);
    assert.strictEqual(getPhaseKey('feature'), null);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(getPhaseKey('IN-RESEARCH'), 'RESEARCH');
    assert.strictEqual(getPhaseKey('In-Breakdown'), 'BREAKDOWN');
  });
});

// =============================================================================
// getPreWorkPhaseLabels Tests
// =============================================================================

describe('getPreWorkPhaseLabels', () => {
  test('returns array of pre-work phase labels', () => {
    const labels = getPreWorkPhaseLabels();
    assert.ok(Array.isArray(labels));
    assert.strictEqual(labels.length, 6);
  });

  test('includes expected pre-work labels', () => {
    const labels = getPreWorkPhaseLabels();
    assert.ok(labels.includes('in-research'));
    assert.ok(labels.includes('in-breakdown'));
    assert.ok(labels.includes('in-scoping'));
    assert.ok(labels.includes('in-design'));
    assert.ok(labels.includes('in-spike'));
    assert.ok(labels.includes('in-context'));
  });

  test('does not include implementation or review', () => {
    const labels = getPreWorkPhaseLabels();
    assert.ok(!labels.includes('in-implementation'));
    assert.ok(!labels.includes('in-review'));
  });
});

// =============================================================================
// isPreWorkPhase Tests
// =============================================================================

describe('isPreWorkPhase', () => {
  test('returns true for pre-work phase labels', () => {
    assert.strictEqual(isPreWorkPhase('in-research'), true);
    assert.strictEqual(isPreWorkPhase('in-breakdown'), true);
    assert.strictEqual(isPreWorkPhase('in-scoping'), true);
    assert.strictEqual(isPreWorkPhase('in-design'), true);
    assert.strictEqual(isPreWorkPhase('in-spike'), true);
    assert.strictEqual(isPreWorkPhase('in-context'), true);
  });

  test('returns false for non-pre-work phases', () => {
    assert.strictEqual(isPreWorkPhase('in-implementation'), false);
    assert.strictEqual(isPreWorkPhase('in-review'), false);
  });

  test('returns false for non-phase labels', () => {
    assert.strictEqual(isPreWorkPhase('blocked'), false);
    assert.strictEqual(isPreWorkPhase('bug'), false);
    assert.strictEqual(isPreWorkPhase('feature'), false);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(isPreWorkPhase('IN-RESEARCH'), true);
    assert.strictEqual(isPreWorkPhase('In-Breakdown'), true);
  });
});
