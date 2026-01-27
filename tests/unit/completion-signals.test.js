/**
 * Unit tests for completion-signals.js
 *
 * Run with: node --test tests/unit/completion-signals.test.js
 *
 * Tests the simplified 3-label system completion signals:
 * - preparing: Pre-implementation work
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  COMPLETION_SIGNALS,
  getDefinedSignalTypes,
  hasSignals,
  getSignal,
  assessCompletion,
  getBlockers,
  formatSignalsForPrompt,
  formatAllSignalsForMetaPrompt
} from '../../lib/completion-signals.js';
import { PREPARING_LABEL, WORK_ISSUE_LABELS } from '../../lib/workflow-config.js';

// =============================================================================
// COMPLETION_SIGNALS Structure Tests
// =============================================================================

describe('COMPLETION_SIGNALS', () => {
  const expectedLabelTypes = [
    PREPARING_LABEL,
    WORK_ISSUE_LABELS.BLOCKED,
    WORK_ISSUE_LABELS.BUG
  ];

  const expectedPromptTypes = [
    ...expectedLabelTypes,
    'plan', 'code-review',
    'look-into', 'triage', 'breakdown', 'research', 'scoping',
    'design', 'spike', 'context', 'implementation', 'review'
  ];

  test('has all 15 expected prompt types', () => {
    const keys = Object.keys(COMPLETION_SIGNALS);
    assert.strictEqual(keys.length, 15, 'Should have exactly 15 prompt types');
    for (const type of expectedPromptTypes) {
      assert.ok(type in COMPLETION_SIGNALS, `Should have ${type} signal`);
    }
  });

  test('all signals are defined (not null)', () => {
    for (const [key, signal] of Object.entries(COMPLETION_SIGNALS)) {
      assert.ok(signal !== null, `Signal for ${key} should not be null`);
      assert.ok(signal !== undefined, `Signal for ${key} should not be undefined`);
    }
  });

  test('all signals have required fields', () => {
    for (const [key, signal] of Object.entries(COMPLETION_SIGNALS)) {
      assert.ok(
        typeof signal.coreOutcome === 'string',
        `${key} should have coreOutcome string`
      );
      assert.ok(
        Array.isArray(signal.signals),
        `${key} should have signals array`
      );
      assert.ok(
        signal.signals.length > 0,
        `${key} should have at least one signal`
      );
      assert.ok(
        typeof signal.readinessCheck === 'string',
        `${key} should have readinessCheck string`
      );
    }
  });

  test('all signals end with question mark in readinessCheck', () => {
    for (const [key, signal] of Object.entries(COMPLETION_SIGNALS)) {
      assert.ok(
        signal.readinessCheck.endsWith('?'),
        `${key} readinessCheck should end with question mark`
      );
    }
  });

  test('all coreOutcomes are meaningful (not empty)', () => {
    for (const [key, signal] of Object.entries(COMPLETION_SIGNALS)) {
      assert.ok(
        signal.coreOutcome.length > 10,
        `${key} coreOutcome should be meaningful`
      );
    }
  });
});

// =============================================================================
// Signal Content Tests
// =============================================================================

describe('Signal Content', () => {
  test('preparing has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS[PREPARING_LABEL];
    assert.ok(signal.coreOutcome.includes('ready'));
    assert.ok(signal.signals.some(s => s.includes('question') || s.includes('Requirements')));
    assert.ok(signal.readinessCheck.includes('implementor'));
  });

  test('blocked has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS[WORK_ISSUE_LABELS.BLOCKED];
    assert.ok(signal.coreOutcome.includes('forward') || signal.coreOutcome.includes('Path'));
    assert.ok(signal.signals.some(s => s.includes('Blocker') || s.includes('Root cause')));
    assert.ok(signal.readinessCheck.includes('resume'));
  });

  test('bug has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS[WORK_ISSUE_LABELS.BUG];
    assert.ok(signal.coreOutcome.includes('fix') || signal.coreOutcome.includes('understood'));
    assert.ok(signal.signals.some(s => s.includes('Reproduction') || s.includes('Root cause')));
    assert.ok(signal.readinessCheck.includes('fix'));
  });
});

// =============================================================================
// getDefinedSignalTypes Tests
// =============================================================================

describe('getDefinedSignalTypes', () => {
  test('returns all 15 signal types', () => {
    const defined = getDefinedSignalTypes();
    assert.ok(Array.isArray(defined));
    assert.strictEqual(defined.length, 15);
  });

  test('returns all expected types', () => {
    const defined = getDefinedSignalTypes();
    const expectedTypes = [
      PREPARING_LABEL, 'blocked', 'bug',
      'plan', 'code-review', 'look-into', 'triage', 'breakdown',
      'research', 'scoping', 'design', 'spike', 'context', 'implementation', 'review'
    ];
    for (const type of expectedTypes) {
      assert.ok(defined.includes(type), `Should include ${type}`);
    }
  });
});

// =============================================================================
// hasSignals Tests
// =============================================================================

describe('hasSignals', () => {
  test('returns true for all defined types', () => {
    const types = [PREPARING_LABEL, 'blocked', 'bug'];
    for (const type of types) {
      assert.strictEqual(hasSignals(type), true, `${type} should have signals`);
    }
  });

  test('returns false for unknown types', () => {
    assert.strictEqual(hasSignals('unknown'), false);
    assert.strictEqual(hasSignals('nonexistent'), false);
    assert.strictEqual(hasSignals('invalid-type'), false);
    assert.strictEqual(hasSignals(''), false);
  });

  test('returns true for all 15 defined types', () => {
    const allTypes = [
      PREPARING_LABEL, 'blocked', 'bug',
      'plan', 'code-review', 'look-into', 'triage', 'breakdown',
      'research', 'scoping', 'design', 'spike', 'context', 'implementation', 'review'
    ];
    for (const type of allTypes) {
      assert.strictEqual(hasSignals(type), true, `${type} should have signals`);
    }
  });

  test('returns false for old phase labels', () => {
    assert.strictEqual(hasSignals('in-research'), false);
    assert.strictEqual(hasSignals('in-breakdown'), false);
    assert.strictEqual(hasSignals('in-scoping'), false);
  });
});

// =============================================================================
// getSignal Tests
// =============================================================================

describe('getSignal', () => {
  test('returns signal for valid type', () => {
    const signal = getSignal(PREPARING_LABEL);
    assert.ok(signal !== null);
    assert.ok(signal.coreOutcome);
    assert.ok(signal.signals);
    assert.ok(signal.readinessCheck);
  });

  test('returns null for unknown type', () => {
    assert.strictEqual(getSignal('unknown'), null);
    assert.strictEqual(getSignal('nonexistent'), null);
  });

  test('returns signal for all 15 defined types', () => {
    const allTypes = [
      PREPARING_LABEL, 'blocked', 'bug',
      'plan', 'code-review', 'look-into', 'triage', 'breakdown',
      'research', 'scoping', 'design', 'spike', 'context', 'implementation', 'review'
    ];
    for (const type of allTypes) {
      const signal = getSignal(type);
      assert.ok(signal !== null, `${type} should return a signal`);
      assert.ok(signal.coreOutcome, `${type} should have coreOutcome`);
      assert.ok(signal.readinessCheck, `${type} should have readinessCheck`);
    }
  });
});

// =============================================================================
// assessCompletion Tests
// =============================================================================

describe('assessCompletion', () => {
  const mockContext = {
    comments: [],
    children: [],
    description: 'Test description'
  };

  test('returns assessment object with complete and reason', () => {
    const result = assessCompletion(PREPARING_LABEL, mockContext);
    assert.ok('complete' in result);
    assert.ok('reason' in result);
    assert.strictEqual(typeof result.complete, 'boolean');
    assert.strictEqual(typeof result.reason, 'string');
  });

  test('returns incomplete for unknown type', () => {
    const result = assessCompletion('unknown', mockContext);
    assert.strictEqual(result.complete, false);
    assert.ok(result.reason.includes('No completion signals defined'));
  });

  test('returns result for valid type', () => {
    const result = assessCompletion(PREPARING_LABEL, mockContext);
    assert.strictEqual(typeof result.complete, 'boolean');
    assert.ok(result.reason.length > 0);
  });
});

// =============================================================================
// getBlockers Tests
// =============================================================================

describe('getBlockers', () => {
  const mockContext = {};

  test('returns array for valid type', () => {
    const blockers = getBlockers(PREPARING_LABEL, mockContext);
    assert.ok(Array.isArray(blockers));
    assert.ok(blockers.length > 0);
  });

  test('blockers reference signal items', () => {
    const blockers = getBlockers(PREPARING_LABEL, mockContext);
    assert.ok(blockers.every(b => b.startsWith('Missing:')));
  });

  test('returns error for unknown type', () => {
    const blockers = getBlockers('unknown', mockContext);
    assert.ok(Array.isArray(blockers));
    assert.ok(blockers[0].includes('No completion signals defined'));
  });
});

// =============================================================================
// formatSignalsForPrompt Tests
// =============================================================================

describe('formatSignalsForPrompt', () => {
  test('returns formatted string for valid type', () => {
    const formatted = formatSignalsForPrompt(PREPARING_LABEL);
    assert.ok(typeof formatted === 'string');
    assert.ok(formatted.includes('Core Outcome:'));
    assert.ok(formatted.includes('Signals'));
    assert.ok(formatted.includes('Readiness Check:'));
  });

  test('includes all signal items as bullets', () => {
    const formatted = formatSignalsForPrompt(PREPARING_LABEL);
    const signal = COMPLETION_SIGNALS[PREPARING_LABEL];
    for (const s of signal.signals) {
      assert.ok(formatted.includes(s), `Should include signal: ${s}`);
    }
  });

  test('returns null for unknown type', () => {
    assert.strictEqual(formatSignalsForPrompt('unknown'), null);
    assert.strictEqual(formatSignalsForPrompt('nonexistent'), null);
  });

  test('returns formatted string for all 15 types', () => {
    const allTypes = [
      PREPARING_LABEL, 'blocked', 'bug',
      'plan', 'code-review', 'look-into', 'triage', 'breakdown',
      'research', 'scoping', 'design', 'spike', 'context', 'implementation', 'review'
    ];
    for (const type of allTypes) {
      const formatted = formatSignalsForPrompt(type);
      assert.ok(typeof formatted === 'string', `${type} should return a string`);
      assert.ok(formatted.includes('Core Outcome:'), `${type} should include Core Outcome`);
      assert.ok(formatted.includes('Readiness Check:'), `${type} should include Readiness Check`);
    }
  });
});

// =============================================================================
// formatAllSignalsForMetaPrompt Tests
// =============================================================================

describe('formatAllSignalsForMetaPrompt', () => {
  test('returns non-empty string', () => {
    const formatted = formatAllSignalsForMetaPrompt();
    assert.ok(typeof formatted === 'string');
    assert.ok(formatted.length > 0);
  });

  test('includes all 3 signal types', () => {
    const formatted = formatAllSignalsForMetaPrompt();
    const types = [PREPARING_LABEL, 'blocked', 'bug'];
    for (const type of types) {
      assert.ok(formatted.includes(type), `Should include ${type}`);
    }
  });

  test('includes Core and Check for each type', () => {
    const formatted = formatAllSignalsForMetaPrompt();
    assert.ok(formatted.includes('**Core:**'));
    assert.ok(formatted.includes('**Check:**'));
  });

  test('uses markdown headers for each type', () => {
    const formatted = formatAllSignalsForMetaPrompt();
    assert.ok(formatted.includes(`### ${PREPARING_LABEL}`));
    assert.ok(formatted.includes('### blocked'));
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  test('work-issue labels have corresponding signals', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');
    const workIssueTypes = ['blocked', 'bug'];

    for (const type of workIssueTypes) {
      assert.ok(hasSignals(type), `${type} should have signals defined`);
      const template = PROMPT_TEMPLATES[type];
      assert.ok(template, `${type} should have template defined`);
      assert.ok(
        template.completionSignals,
        `${type} template should have completionSignals property`
      );
    }
  });

  test('template completionSignals match COMPLETION_SIGNALS for work issues', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');
    const typesWithSignals = ['blocked', 'bug'];

    for (const type of typesWithSignals) {
      const template = PROMPT_TEMPLATES[type];
      const signal = COMPLETION_SIGNALS[type];
      assert.deepStrictEqual(
        template.completionSignals,
        signal,
        `${type} template.completionSignals should match COMPLETION_SIGNALS`
      );
    }
  });

  test('all templates have completionSignals defined', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');
    const allTypes = Object.keys(PROMPT_TEMPLATES);

    for (const type of allTypes) {
      const template = PROMPT_TEMPLATES[type];
      assert.ok(
        template.completionSignals,
        `${type} template should have completionSignals property`
      );
      assert.ok(
        template.completionSignals.coreOutcome,
        `${type} should have coreOutcome`
      );
      assert.ok(
        template.completionSignals.readinessCheck,
        `${type} should have readinessCheck`
      );
    }
  });

  test('aiHint does not have redundant readinessCheck', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');
    }
  });

    for (const type of allTypes) {
      const template = PROMPT_TEMPLATES[type];
      assert.strictEqual(
        template.aiHint?.readinessCheck,
        undefined,
        `${type} aiHint should not have readinessCheck (use completionSignals instead)`
      );
    }
  });
});
