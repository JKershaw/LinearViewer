/**
 * Unit tests for lib/providers/state-map.js and lib/providers/models.js
 *
 * Covers the newly-extracted display/order maps and the relocated state
 * semantics (LIN-174 Phase 1). The existing tree.test.js exercises
 * isTerminalState/isCompleted/TERMINAL_STATE_TYPES through tree.js's
 * back-compat re-export; this file targets the canonical module directly.
 *
 * Run with: node --test tests/unit/state-map.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  getStateDisplay,
  getStateOrder,
  isTerminalState,
  isCompleted,
  isInProgress,
} from '../../lib/providers/state-map.js';
import {
  STARTED, UNSTARTED, BACKLOG, COMPLETED, CANCELED, DUPLICATE,
  TERMINAL_TYPES, STATE_ORDER,
} from '../../lib/providers/models.js';

const ALL_TYPES = [STARTED, UNSTARTED, BACKLOG, COMPLETED, CANCELED, DUPLICATE];

describe('models.js canonical vocabulary', () => {
  test('constants use Linear real state.type values', () => {
    assert.deepEqual(
      [STARTED, UNSTARTED, BACKLOG, COMPLETED, CANCELED, DUPLICATE],
      ['started', 'unstarted', 'backlog', 'completed', 'canceled', 'duplicate']
    );
  });

  test('TERMINAL_TYPES is completed/canceled/duplicate', () => {
    assert.deepEqual(TERMINAL_TYPES, ['completed', 'canceled', 'duplicate']);
  });

  test('STATE_ORDER ranks duplicate together with canceled', () => {
    assert.deepEqual(STATE_ORDER, {
      started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 4, duplicate: 4,
    });
  });
});

describe('getStateDisplay', () => {
  const expected = {
    completed: { class: 'done', char: '✓', label: 'Completed' },
    canceled: { class: 'done', char: '✓', label: 'Completed' },
    duplicate: { class: 'done', char: '✓', label: 'Completed' },
    started: { class: 'in-progress', char: '◐', label: 'In Progress' },
    backlog: { class: 'backlog', char: '◌', label: 'Backlog' },
    unstarted: { class: 'todo', char: '○', label: 'To Do' },
  };

  for (const type of ALL_TYPES) {
    test(`maps ${type} to its display info`, () => {
      assert.deepEqual(getStateDisplay(type), expected[type]);
    });
  }

  test('unknown/undefined falls back to To Do (matches render default)', () => {
    assert.deepEqual(getStateDisplay(undefined), { class: 'todo', char: '○', label: 'To Do' });
    assert.deepEqual(getStateDisplay('mystery'), { class: 'todo', char: '○', label: 'To Do' });
  });
});

describe('getStateOrder', () => {
  for (const type of ALL_TYPES) {
    test(`returns canonical rank for ${type}`, () => {
      assert.equal(getStateOrder(type), STATE_ORDER[type]);
    });
  }

  test('returns undefined for unknown types so callers keep their ?? fallback', () => {
    assert.equal(getStateOrder('mystery'), undefined);
    assert.equal(getStateOrder(undefined), undefined);
  });

  test('canceled and duplicate share a rank', () => {
    assert.equal(getStateOrder(CANCELED), getStateOrder(DUPLICATE));
  });
});

describe('semantic predicates', () => {
  test('isTerminalState matches all terminal types and nothing else', () => {
    assert.equal(isTerminalState('completed'), true);
    assert.equal(isTerminalState('canceled'), true);
    assert.equal(isTerminalState('duplicate'), true);
    assert.equal(isTerminalState('started'), false);
    assert.equal(isTerminalState('unstarted'), false);
    assert.equal(isTerminalState('backlog'), false);
    assert.equal(isTerminalState(undefined), false);
  });

  test('isCompleted preserves duplicate == canceled semantics (LIN-276)', () => {
    assert.equal(
      isCompleted({ state: { type: 'duplicate' } }),
      isCompleted({ state: { type: 'canceled' } })
    );
    assert.equal(isCompleted({ state: { type: 'completed' } }), true);
    assert.equal(isCompleted({ state: { type: 'started' } }), false);
    assert.equal(isCompleted({}), false);
  });

  test('isInProgress is true only for started', () => {
    assert.equal(isInProgress({ state: { type: 'started' } }), true);
    assert.equal(isInProgress({ state: { type: 'unstarted' } }), false);
    assert.equal(isInProgress({ state: { type: 'completed' } }), false);
    assert.equal(isInProgress({}), false);
  });
});
