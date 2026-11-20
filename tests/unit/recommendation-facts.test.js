/**
 * Unit tests for lib/recommendation-facts.js (LIN-434) — the deterministic,
 * network-free fact-assembly seam. These tests touch no network and no LLM: they
 * prove the fact set is pure, isolated, and reproducible.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  computeNodeStateCounts,
  assembleNodeFacts,
  computeFrontierFacts,
  selectFocusSubtask,
  compareByIdentifier,
  isBlocked,
  isTerminalState
} from '../../lib/recommendation-facts.js';
import * as tree from '../../lib/tree.js';
import { planFactsOf } from '../../lib/records/plan-facts.js';

// Small helpers to build child issues with a given state type.
const child = (identifier, type, extra = {}) => ({ identifier, state: { type }, ...extra });

describe('recommendation-facts: re-export surface', () => {
  test('re-exports the tree fact primitives so this is the single import surface', () => {
    assert.strictEqual(typeof computeFrontierFacts, 'function');
    assert.strictEqual(typeof selectFocusSubtask, 'function');
    assert.strictEqual(typeof isBlocked, 'function');
    assert.strictEqual(typeof isTerminalState, 'function');
  });
});

describe('recommendation-facts: focus-child picker ownership (LIN-3727)', () => {
  test('tree.js re-exports the very same picker functions (no duplicate definitions)', () => {
    assert.strictEqual(tree.selectFocusSubtask, selectFocusSubtask);
    assert.strictEqual(tree.computeFrontierFacts, computeFrontierFacts);
    assert.strictEqual(tree.compareByIdentifier, compareByIdentifier);
  });
});

describe('recommendation-facts: no description reader of session fit (LIN-4504)', () => {
  test('extractSessionFit is gone: session fit is the plan records\' addressee (lib/records/plan-facts.js)', async () => {
    const facts = await import('../../lib/recommendation-facts.js');
    assert.strictEqual(facts.extractSessionFit, undefined);
    assert.strictEqual(facts.condensePlan, undefined);
  });
});

describe('recommendation-facts: computeNodeStateCounts', () => {
  test('empty children → all zero, no open children', () => {
    assert.deepStrictEqual(computeNodeStateCounts([]), {
      subtaskCount: 0,
      completedCount: 0,
      inProgressCount: 0,
      remainingCount: 0,
      hasOpenChildren: false
    });
  });

  test('defaults to empty children when called with no argument', () => {
    assert.strictEqual(computeNodeStateCounts().subtaskCount, 0);
  });

  test('counts completed (terminal), in-progress, and remaining', () => {
    const children = [
      child('LIN-1', 'completed'),
      child('LIN-2', 'canceled'),
      child('LIN-3', 'started'),
      child('LIN-4', 'unstarted'),
      child('LIN-5', 'backlog')
    ];
    assert.deepStrictEqual(computeNodeStateCounts(children), {
      subtaskCount: 5,
      completedCount: 2, // completed + canceled are terminal
      inProgressCount: 1, // started
      remainingCount: 3, // 5 - 2 terminal
      hasOpenChildren: true
    });
  });

  test('all-terminal children → no open children', () => {
    const children = [child('LIN-1', 'completed'), child('LIN-2', 'canceled')];
    const counts = computeNodeStateCounts(children);
    assert.strictEqual(counts.remainingCount, 0);
    assert.strictEqual(counts.hasOpenChildren, false);
  });
});

describe('recommendation-facts: assembleNodeFacts', () => {
  test('no children → null frontierFacts, isTerminal reflects the node state', () => {
    const facts = assembleNodeFacts({ state: { type: 'started' }, description: 'fits one session' }, []);
    assert.strictEqual(facts.frontierFacts, null);
    assert.strictEqual(facts.isTerminal, false);
    assert.strictEqual(facts.hasOpenChildren, false);
    assert.strictEqual(facts.completedCount, 0);
  });

  test('terminal node state surfaces isTerminal=true', () => {
    const facts = assembleNodeFacts({ state: { type: 'completed' } }, []);
    assert.strictEqual(facts.isTerminal, true);
  });

  test('with open children → frontier facts carry the plan facts passed in (records), never the description\'s (LIN-4504)', () => {
    const issue = { state: { type: 'started' }, description: 'Plan says this needs multiple sessions.' };
    const children = [child('LIN-10', 'unstarted'), child('LIN-11', 'completed')];
    const planFacts = planFactsOf({ task: { id: 'task-n', kind: 'task' }, inside: [{ id: 'plan-n', v: 1, kind: 'plan', state: 'kept', in: 'task-n', to: 'implementation' }] });
    const facts = assembleNodeFacts(issue, children, { planFacts });

    assert.strictEqual(facts.completedCount, 1);
    assert.strictEqual(facts.remainingCount, 1);
    assert.strictEqual(facts.hasOpenChildren, true);
    assert.ok(facts.frontierFacts, 'frontier facts present when there are children');
    assert.strictEqual(facts.frontierFacts.openCount, 1);
    assert.strictEqual(facts.frontierFacts.planFacts.sessionFit, 'one', 'the record says one session; the description says several and is not read');
    assert.strictEqual(facts.frontierFacts.nextChild, 'LIN-10');
  });

  test('with no plan facts passed, the node\'s plan facts are not measured, never "none"', () => {
    const facts = assembleNodeFacts({ state: { type: 'started' }, description: 'fits one session' }, [child('LIN-1', 'unstarted')]);
    assert.strictEqual(facts.frontierFacts.planFacts.measured, false);
  });

  test('is pure: repeated calls on the same input yield equal facts', () => {
    const issue = { state: { type: 'started' }, description: 'needs multiple sessions' };
    const children = [child('LIN-1', 'started'), child('LIN-2', 'backlog')];
    assert.deepStrictEqual(assembleNodeFacts(issue, children), assembleNodeFacts(issue, children));
  });

  test('matches the shape buildMetaPrompt consumes (the meta-prompt fact contract)', () => {
    const facts = assembleNodeFacts({ state: { type: 'started' }, description: '' }, [child('LIN-1', 'unstarted')]);
    assert.deepStrictEqual(
      Object.keys(facts).sort(),
      ['completedCount', 'frontierFacts', 'hasOpenChildren', 'inProgressCount', 'isTerminal', 'remainingCount'].sort()
    );
  });
});
