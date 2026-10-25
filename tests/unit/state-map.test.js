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
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  getStateDisplay,
  getStateOrder,
  isTerminalState,
  isCompleted,
  isInProgress,
  isHiddenState,
} from '../../lib/providers/state-map.js';
import {
  STARTED, UNSTARTED, BACKLOG, COMPLETED, CANCELED, DUPLICATE,
  TERMINAL_TYPES, STATE_ORDER,
} from '../../lib/providers/models.js';
import { withHarnessModels } from '../fixtures/harness-models.js';

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
    canceled: { class: 'done', char: '✕', label: 'Cancelled' },
    duplicate: { class: 'done', char: '✕', label: 'Cancelled' },
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
    assert.deepEqual(getStateDisplay('triage'), { class: 'todo', char: '○', label: 'To Do' });
    assert.deepEqual(getStateDisplay(null), { class: 'todo', char: '○', label: 'To Do' });
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

describe('isHiddenState (LIN-769)', () => {
  test('hides canceled only', () => {
    assert.equal(isHiddenState({ state: { type: 'canceled' } }), true);
  });

  // Pin the deliberate canceled-ONLY decision: duplicate is a live pointer to
  // its canonical issue and must stay visible, and completed genuinely is done.
  // Guards against a future change silently widening to all TERMINAL_TYPES.
  test('does NOT hide duplicate (stays visible, unlike canceled)', () => {
    assert.equal(isHiddenState({ state: { type: 'duplicate' } }), false);
  });

  test('does NOT hide completed (it is genuinely done)', () => {
    assert.equal(isHiddenState({ state: { type: 'completed' } }), false);
  });

  test('does NOT hide active states (started/unstarted/backlog)', () => {
    assert.equal(isHiddenState({ state: { type: 'started' } }), false);
    assert.equal(isHiddenState({ state: { type: 'unstarted' } }), false);
    assert.equal(isHiddenState({ state: { type: 'backlog' } }), false);
  });

  test('does NOT hide an issue with missing/unknown state', () => {
    assert.equal(isHiddenState({}), false);
    assert.equal(isHiddenState({ state: {} }), false);
    assert.equal(isHiddenState(undefined), false);
    assert.equal(isHiddenState({ state: { type: 'mystery' } }), false);
  });
});

// Step A of LIN-3674: the browser cannot import isTerminalState, so public/common.js
// mirrors the set once. This loads the real file and pins it to the server predicate
// (the one parity test, not a standing sweep).
describe('browser terminal-state predicate (public/common.js)', () => {
  const src = readFileSync(fileURLToPath(new URL('../../public/common.js', import.meta.url)), 'utf8');
  const sandbox = { console, document: { addEventListener() {} }, location: { search: '', href: '' } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(src), sandbox, { filename: 'common.js' });

  for (const type of ['completed', 'canceled', 'duplicate', 'started', 'unstarted', 'backlog', 'triage', undefined, null]) {
    test(`agrees with isTerminalState for ${String(type)}`, () => {
      assert.equal(sandbox.window.isTerminalState(type), isTerminalState(type));
    });
  }
});

// LIN-3674 step B: the context panel hand-matches getStateDisplay. context.js has an
// existing export (ContextSection.renderSession), so the glyph table is driven through
// it with the real common.js loaded first (context.js reads window.escapeHtml at load).
describe('context panel state glyphs (public/context.js)', () => {
  const load = (file) => readFileSync(fileURLToPath(new URL(`../../public/${file}`, import.meta.url)), 'utf8');
  const sandbox = { console, document: { addEventListener() {}, querySelector() { return null; } }, location: { search: '', href: '' } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(withHarnessModels(load('common.js')), sandbox, { filename: 'common.js' });
  vm.runInContext(load('context.js'), sandbox, { filename: 'context.js' });

  const expected = [
    ['completed', '✓', 'done'],
    ['canceled', '✕', 'done'],
    ['duplicate', '✕', 'done'],
    ['started', '◐', 'in-progress'],
    ['unstarted', '○', 'todo'],
    ['backlog', '◌', 'backlog'],
    ['triage', '○', 'backlog'],
    [undefined, '○', 'backlog'],
    [null, '○', 'backlog'],
  ];

  const html = sandbox.window.ContextSection.renderSession({
    graph: {
      tasks: [{
        identifier: 'S-1',
        provenance: 'seed',
        root: { identifier: 'S-1', stateType: 'started' },
        blockers: expected.map(([stateType], i) => ({ identifier: `B-${i}`, stateType })),
      }],
    },
  });

  for (const [type, char, cls] of expected) {
    test(`blocker with stateType ${String(type)} draws ${char} (${cls})`, () => {
      const id = `B-${expected.findIndex(([t]) => t === type)}`;
      const node = html.split('<a ').find(chunk => chunk.includes(`data-context-nav="${id}"`));
      const m = /<span class="state ([^ "]+) [^"]*">([^<]*)<\/span>/.exec(node);
      assert.ok(m, 'state span found');
      assert.equal(m[1], cls);
      assert.equal(m[2], char);
    });
  }
});

// LIN-3674: a closed task draws the same everywhere. The class is 'done' for all three
// terminal types (data-status and the done styling are unchanged); only char/label vary.
describe('getStateDisplay: closed-but-not-completed', () => {
  test('only completed is a check; canceled and duplicate are a cross reading Cancelled', () => {
    assert.equal(getStateDisplay('completed').char, '✓');
    for (const type of ['canceled', 'duplicate']) {
      assert.equal(getStateDisplay(type).char, '✕', type);
      assert.equal(getStateDisplay(type).label, 'Cancelled', type);
    }
  });

  test('class stays done for every terminal type', () => {
    for (const type of ['completed', 'canceled', 'duplicate']) {
      assert.equal(getStateDisplay(type).class, 'done', type);
    }
  });
});
