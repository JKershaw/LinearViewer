/**
 * Unit tests for lib/recommendation-facts.js (LIN-434) — the deterministic,
 * network-free fact-assembly seam. These tests touch no network and no LLM: they
 * prove the fact set is pure, isolated, and reproducible.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  extractSessionFit,
  computeNodeStateCounts,
  assembleNodeFacts,
  computeFrontierFacts,
  selectFocusSubtask,
  isBlocked,
  isTerminalState
} from '../../lib/recommendation-facts.js';

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

describe('recommendation-facts: extractSessionFit', () => {
  test('returns null for empty / missing description', () => {
    assert.strictEqual(extractSessionFit(undefined), null);
    assert.strictEqual(extractSessionFit(''), null);
    assert.strictEqual(extractSessionFit('no canonical phrase here'), null);
  });

  test('matches "fits one session" and the "fits in one focused session" variant', () => {
    assert.strictEqual(extractSessionFit('**Session fit:** fits one session.'), 'fits one session');
    assert.strictEqual(extractSessionFit('This fits in one focused session.'), 'fits one session');
    assert.strictEqual(extractSessionFit('It FITS ONE SESSION'), 'fits one session');
  });

  test('matches "needs multiple sessions" (and the singular "need")', () => {
    assert.strictEqual(extractSessionFit('This needs multiple sessions.'), 'needs multiple sessions');
    assert.strictEqual(extractSessionFit('these need multiple sessions'), 'needs multiple sessions');
  });

  test('"needs multiple sessions" takes precedence when both phrases appear', () => {
    const desc = 'Originally fits one session, but on reflection it needs multiple sessions.';
    assert.strictEqual(extractSessionFit(desc), 'needs multiple sessions');
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

  test('with open children → frontier facts carry session-fit from the description', () => {
    const issue = { state: { type: 'started' }, description: 'Plan says this fits one session.' };
    const children = [child('LIN-10', 'unstarted'), child('LIN-11', 'completed')];
    const facts = assembleNodeFacts(issue, children);

    assert.strictEqual(facts.completedCount, 1);
    assert.strictEqual(facts.remainingCount, 1);
    assert.strictEqual(facts.hasOpenChildren, true);
    assert.ok(facts.frontierFacts, 'frontier facts present when there are children');
    assert.strictEqual(facts.frontierFacts.openCount, 1);
    assert.strictEqual(facts.frontierFacts.sessionFit, 'fits one session');
    assert.strictEqual(facts.frontierFacts.nextChild, 'LIN-10');
  });

  test('session-fit is null when the description lacks a canonical phrase', () => {
    const facts = assembleNodeFacts({ state: { type: 'started' }, description: 'no phrase' }, [child('LIN-1', 'unstarted')]);
    assert.strictEqual(facts.frontierFacts.sessionFit, null);
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
