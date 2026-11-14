/**
 * Unit tests for completion-signals.js
 *
 * Run with: node --test tests/unit/completion-signals.test.js
 *
 * Tests the workflow label completion signals:
 * - blocked: Work stuck on external dependency
 * - bug: Investigating unexpected behavior
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { COMPLETION_SIGNALS } from '../../lib/completion-signals.js';
import { WORK_ISSUE_LABELS } from '../../lib/workflow-config.js';

// =============================================================================
// COMPLETION_SIGNALS Structure Tests
// =============================================================================

describe('COMPLETION_SIGNALS', () => {
  const expectedLabelTypes = [
    // `blocked` is keyed by the literal prompt name now (LIN-357: not a label)
    'blocked',
    WORK_ISSUE_LABELS.BUG
  ];

  const expectedPromptTypes = [
    ...expectedLabelTypes,
    'plan',
    'look-into', 'triage', 'breakdown', 'research', 'scoping',
    'design', 'spike', 'context', 'plan-review', 'implementation', 'review', 'close-out',
    'retrospective-audit', 'retro', 'survey-task', 'survey-place', 'blind-read'
  ];

  test('has all 20 expected prompt types', () => {
    const keys = Object.keys(COMPLETION_SIGNALS);
    assert.strictEqual(keys.length, 20, 'Should have exactly 20 prompt types');
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
  test('blocked has appropriate signals', () => {
    const signal = COMPLETION_SIGNALS['blocked'];
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
// Integration Tests
// =============================================================================

describe('Integration', () => {
  test('work-issue labels have corresponding signals', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');
    const workIssueTypes = ['blocked', 'bug'];

    for (const type of workIssueTypes) {
      assert.ok(COMPLETION_SIGNALS[type], `${type} should have signals defined`);
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

  test('no template carries the retired aiHint (LIN-3300: route replaced it)', async () => {
    const { PROMPT_TEMPLATES } = await import('../../lib/prompt-templates.js');
    for (const [type, template] of Object.entries(PROMPT_TEMPLATES)) {
      assert.strictEqual(template.aiHint, undefined, `${type} should describe itself with route, not aiHint`);
    }
  });
});

// LIN-4353 (review ledger item 2): the judging signals carry the As-asked rule the
// stage templates carry, so the done-check a worker reads agrees with its prompt.
describe('judging signals read the As asked block (LIN-4353)', () => {
  const doneSignal = (type, re) => COMPLETION_SIGNALS[type].signals.find(s => re.test(s));

  for (const [type, what] of [['review', 'work'], ['plan-review', 'plan']]) {
    test(`${type}: the verdict signal says how the ${what} meets what was asked and names any cut`, () => {
      const verdict = doneSignal(type, /^Explicit verdict issued/);
      assert.ok(verdict, `${type} has a verdict signal`);
      // LIN-4345: review accounts for each sentence of the block; plan-review keeps one line.
      assert.match(verdict, type === 'review'
        ? /where the work meets each sentence of what was asked/
        : new RegExp(`in one line how the ${what} meets what was asked`));
      assert.match(verdict, /`## As asked` block/);
      assert.match(verdict, /naming any cut/);
    });
  }

  test('review: a cut nobody agreed to is Needs Discussion', () => {
    assert.match(doneSignal('review', /^Explicit verdict issued/), /nobody agreed to is Needs Discussion/);
  });

  test('close-out: the summary says how the work meets what was asked', () => {
    assert.ok(doneSignal('close-out', /^Summary comment posted, saying how the merged work meets what was asked/));
    assert.match(COMPLETION_SIGNALS['close-out'].readinessCheck, /how the work meets what was asked/);
  });

  test('close-out: the prune writes below the block through description/below, and not at all with no block', () => {
    const prune = doneSignal('close-out', /pre-prune snapshot/);
    assert.match(prune, /below the `## As asked` block, through `description\/below`/);
    assert.match(prune, /with no block, no prune/);
    assert.match(COMPLETION_SIGNALS['close-out'].readinessCheck, /below the `## As asked` block only/);
  });
});
