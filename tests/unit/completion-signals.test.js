/**
 * Unit tests for completion-signals.js
 *
 * Run with: node --test tests/unit/completion-signals.test.js
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

// =============================================================================
// COMPLETION_SIGNALS Structure Tests
// =============================================================================

describe('COMPLETION_SIGNALS', () => {
  const expectedPromptTypes = [
    'needs-research',
    'needs-breakdown',
    'needs-scoping',
    'needs-design',
    'needs-spike',
    'needs-context',
    'blocked',
    'bug'
  ];

  test('has all 8 expected prompt types', () => {
    const keys = Object.keys(COMPLETION_SIGNALS);
    assert.strictEqual(keys.length, 8, 'Should have exactly 8 prompt types');
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
  test('needs-research has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['needs-research'];
    assert.ok(signal.coreOutcome.includes('question'));
    assert.ok(signal.signals.some(s => s.includes('approach') || s.includes('Recommended')));
    assert.ok(signal.readinessCheck.includes('implementor'));
  });

  test('needs-breakdown has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['needs-breakdown'];
    assert.ok(signal.coreOutcome.includes('split') || signal.coreOutcome.includes('actionable'));
    assert.ok(signal.signals.some(s => s.includes('Subtask') || s.includes('Dependencies')));
    assert.ok(signal.readinessCheck.includes('subtask') || signal.readinessCheck.includes('start'));
  });

  test('needs-scoping has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['needs-scoping'];
    assert.ok(signal.coreOutcome.includes('Boundaries') || signal.coreOutcome.includes('clear'));
    assert.ok(signal.signals.some(s => s.includes('scope') || s.includes('Scope')));
  });

  test('needs-design has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['needs-design'];
    assert.ok(signal.coreOutcome.includes('Approach') || signal.coreOutcome.includes('chosen'));
    assert.ok(signal.signals.some(s => s.includes('approaches') || s.includes('Tradeoffs')));
  });

  test('needs-spike has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['needs-spike'];
    assert.ok(signal.coreOutcome.includes('Go/no-go') || signal.coreOutcome.includes('decision'));
    assert.ok(signal.signals.some(s => s.includes('Proof-of-concept') || s.includes('Feasibility')));
  });

  test('needs-context has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['needs-context'];
    assert.ok(signal.coreOutcome.includes('state') || signal.coreOutcome.includes('understood'));
    assert.ok(signal.signals.some(s => s.includes('done') || s.includes('remains')));
  });

  test('blocked has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['blocked'];
    assert.ok(signal.coreOutcome.includes('forward') || signal.coreOutcome.includes('Path'));
    assert.ok(signal.signals.some(s => s.includes('Blocker') || s.includes('Root cause')));
    assert.ok(signal.readinessCheck.includes('resume'));
  });

  test('bug has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['bug'];
    assert.ok(signal.coreOutcome.includes('fix') || signal.coreOutcome.includes('understood'));
    assert.ok(signal.signals.some(s => s.includes('Reproduction') || s.includes('Root cause')));
    assert.ok(signal.readinessCheck.includes('fix'));
  });
});

// =============================================================================
// getDefinedSignalTypes Tests
// =============================================================================

describe('getDefinedSignalTypes', () => {
  test('returns all 8 signal types', () => {
    const defined = getDefinedSignalTypes();
    assert.ok(Array.isArray(defined));
    assert.strictEqual(defined.length, 8);
  });

  test('returns all expected types', () => {
    const defined = getDefinedSignalTypes();
    const expectedTypes = [
      'needs-research', 'needs-breakdown', 'needs-scoping',
      'needs-design', 'needs-spike', 'needs-context',
      'blocked', 'bug'
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
    const types = [
      'needs-research', 'needs-breakdown', 'needs-scoping',
      'needs-design', 'needs-spike', 'needs-context',
      'blocked', 'bug'
    ];
    for (const type of types) {
      assert.strictEqual(hasSignals(type), true, `${type} should have signals`);
    }
  });

  test('returns false for unknown types', () => {
    assert.strictEqual(hasSignals('unknown'), false);
    assert.strictEqual(hasSignals('plan'), false);
    assert.strictEqual(hasSignals('code-review'), false);
    assert.strictEqual(hasSignals(''), false);
  });
});

// =============================================================================
// getSignal Tests
// =============================================================================

describe('getSignal', () => {
  test('returns signal for valid type', () => {
    const signal = getSignal('needs-research');
    assert.ok(signal !== null);
    assert.ok(signal.coreOutcome);
    assert.ok(signal.signals);
    assert.ok(signal.readinessCheck);
  });

  test('returns null for unknown type', () => {
    assert.strictEqual(getSignal('unknown'), null);
    assert.strictEqual(getSignal('plan'), null);
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
    const result = assessCompletion('needs-research', mockContext);
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
    const result = assessCompletion('needs-research', mockContext);
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
    const blockers = getBlockers('needs-research', mockContext);
    assert.ok(Array.isArray(blockers));
    assert.ok(blockers.length > 0);
  });

  test('blockers reference signal items', () => {
    const blockers = getBlockers('needs-research', mockContext);
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
    const formatted = formatSignalsForPrompt('needs-research');
    assert.ok(typeof formatted === 'string');
    assert.ok(formatted.includes('Core Outcome:'));
    assert.ok(formatted.includes('Signals'));
    assert.ok(formatted.includes('Readiness Check:'));
  });

  test('includes all signal items as bullets', () => {
    const formatted = formatSignalsForPrompt('needs-research');
    const signal = COMPLETION_SIGNALS['needs-research'];
    for (const s of signal.signals) {
      assert.ok(formatted.includes(s), `Should include signal: ${s}`);
    }
  });

  test('returns null for unknown type', () => {
    assert.strictEqual(formatSignalsForPrompt('unknown'), null);
    assert.strictEqual(formatSignalsForPrompt('plan'), null);
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

  test('includes all 8 signal types', () => {
    const formatted = formatAllSignalsForMetaPrompt();
    const types = [
      'needs-research', 'needs-breakdown', 'needs-scoping',
      'needs-design', 'needs-spike', 'needs-context',
      'blocked', 'bug'
    ];
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
    assert.ok(formatted.includes('### needs-research'));
    assert.ok(formatted.includes('### blocked'));
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  test('all prompt-templates types have corresponding signals', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');

    const preWorkTypes = [
      'needs-breakdown', 'needs-research', 'needs-scoping',
      'needs-design', 'needs-spike', 'needs-context'
    ];
    const workIssueTypes = ['blocked', 'bug'];

    for (const type of [...preWorkTypes, ...workIssueTypes]) {
      assert.ok(hasSignals(type), `${type} should have signals defined`);
      const template = PROMPT_TEMPLATES[type];
      assert.ok(template, `${type} should have template defined`);
      assert.ok(
        template.completionSignals,
        `${type} template should have completionSignals property`
      );
    }
  });

  test('template completionSignals match COMPLETION_SIGNALS', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');

    const typesWithSignals = [
      'needs-breakdown', 'needs-research', 'needs-scoping',
      'needs-design', 'needs-spike', 'needs-context',
      'blocked', 'bug'
    ];

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

  test('aiHint.readinessCheck matches signal readinessCheck', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');

    const typesWithSignals = [
      'needs-breakdown', 'needs-research', 'needs-scoping',
      'needs-design', 'needs-spike', 'needs-context',
      'blocked', 'bug'
    ];

    for (const type of typesWithSignals) {
      const template = PROMPT_TEMPLATES[type];
      const signal = COMPLETION_SIGNALS[type];
      assert.strictEqual(
        template.aiHint.readinessCheck,
        signal.readinessCheck,
        `${type} aiHint.readinessCheck should match signal`
      );
    }
  });
});
