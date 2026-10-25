/**
 * LIN-3833 — the opened task's "Needs you" line: a subtask that needs you, named with an Open link.
 *
 * Witnesses:
 *  - `subtaskNeedingYouOf` names the first subtask whose row state says it needs you, with its task-page
 *    link (the top task's source carried), and says nothing when no subtask needs you, when there is no
 *    row-state map (a viewer with no sessions), or when the top task has no subtasks.
 *  - `subtaskNeedingYouByNodeKey` gives EVERY Home row whose subtask needs you its own entry, keyed by the
 *    row's node key, so the line shows for whichever task is opened, not only Home's top task.
 *  - Home's prompt options carry `subtaskNeedsYouById` when one needs you, and are byte-identical to today
 *    when none does (the key is added only when set).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { subtaskNeedingYouOf, subtaskNeedingYouByNodeKey } from '../../lib/task-board-view.js';
import { renderPage } from '../../lib/render.js';
import { nodeKey } from '../../lib/tree.js';

const TOP = {
  identifier: 'LIN-10',
  source: 'linear',
  subtasks: [
    { id: 'a', identifier: 'LIN-11', title: 'Quiet child', stateType: 'started' },
    { id: 'b', identifier: 'LIN-12', title: 'Waiting child', stateType: 'started' }
  ]
};

describe('LIN-3833 subtaskNeedingYouOf — the top task\'s subtask that needs you', () => {
  test('names the subtask that needs you, with its task-page link', () => {
    const rowStates = new Map([
      ['LIN-11', { needsYou: false }],
      ['LIN-12', { needsYou: true }]
    ]);
    assert.deepEqual(
      subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates }),
      { identifier: 'LIN-12', title: 'Waiting child', href: '/workspace/acme/task/LIN-12?source=linear' }
    );
  });

  test('says nothing when no subtask needs you', () => {
    const rowStates = new Map([['LIN-11', { needsYou: false }], ['LIN-12', { needsYou: false }]]);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates }), null);
  });

  test('says nothing without row states (a copy-first viewer reads no sessions)', () => {
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates: null }), null);
  });

  test('says nothing when the top task has no subtasks, or there is no top task', () => {
    const rowStates = new Map([['LIN-12', { needsYou: true }]]);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: { identifier: 'LIN-1', source: 'linear' }, rowStates }), null);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: null, rowStates }), null);
  });
});

// A Home tree node: the issue and its child nodes, as buildForest makes them.
const node = (identifier, children = [], extra = {}) => ({
  issue: { id: `id-${identifier}`, identifier, title: `Title ${identifier}`, source: 'linear', ...extra },
  children
});

describe('LIN-3833 subtaskNeedingYouByNodeKey — every opened row names its own subtask that needs you', () => {
  // A project-tree row that is NOT the top task, with one waiting child; a row with a quiet child; a row with none.
  const waitingRow = node('LIN-20', [node('LIN-21'), node('LIN-22')]);
  const quietRow = node('LIN-30', [node('LIN-31')]);
  const bareRow = node('LIN-40');
  const roots = [waitingRow, quietRow, bareRow];
  const rowStates = new Map([
    ['LIN-20', { needsYou: false }],
    ['LIN-21', { needsYou: false }],
    ['LIN-22', { needsYou: true }],
    ['LIN-30', { needsYou: false }],
    ['LIN-31', { needsYou: false }],
    ['LIN-40', { needsYou: false }]
  ]);

  test('a row that is not the top task gets its waiting subtask, keyed by its node key', () => {
    const byKey = subtaskNeedingYouByNodeKey({ urlKey: 'acme', projectTrees: [{ incomplete: roots, completed: [] }], rowStates });
    assert.deepEqual(byKey[nodeKey(waitingRow.issue)], {
      identifier: 'LIN-22', title: 'Title LIN-22', href: '/workspace/acme/task/LIN-22?source=linear'
    });
  });

  test('rows whose subtasks are quiet, or who have none, get no entry', () => {
    const byKey = subtaskNeedingYouByNodeKey({ urlKey: 'acme', projectTrees: [{ incomplete: roots, completed: [] }], rowStates });
    assert.deepEqual(Object.keys(byKey), [nodeKey(waitingRow.issue)]);
  });

  test('a waiting subtask of a nested row is named by its direct parent', () => {
    const inner = node('LIN-50', [node('LIN-51')]);
    const outer = node('LIN-49', [inner]);
    const states = new Map([['LIN-50', { needsYou: false }], ['LIN-51', { needsYou: true }]]);
    const byKey = subtaskNeedingYouByNodeKey({ urlKey: 'acme', inProgressTrees: [{ roots: [outer] }], rowStates: states });
    assert.equal(byKey[nodeKey(inner.issue)].identifier, 'LIN-51');
    assert.equal(byKey[nodeKey(outer.issue)], undefined, 'the grandparent does not name a grandchild');
  });

  test('rows in Recent activity and in the completed part of a project are covered too', () => {
    const recent = node('LIN-60', [node('LIN-61')]);
    const done = node('LIN-70', [node('LIN-71')]);
    const states = new Map([['LIN-61', { needsYou: true }], ['LIN-71', { needsYou: true }]]);
    const byKey = subtaskNeedingYouByNodeKey({
      urlKey: 'acme',
      recentActivityTrees: [{ roots: [recent] }],
      projectTrees: [{ incomplete: [], completed: [done] }],
      rowStates: states
    });
    assert.equal(byKey[nodeKey(recent.issue)].identifier, 'LIN-61');
    assert.equal(byKey[nodeKey(done.issue)].identifier, 'LIN-71');
  });

  test('says nothing without row states (a copy-first viewer reads no sessions)', () => {
    assert.deepEqual(subtaskNeedingYouByNodeKey({ urlKey: 'acme', projectTrees: [{ incomplete: roots, completed: [] }], rowStates: null }), {});
  });
});

describe('LIN-3833 — Home\'s prompt options carry the subtask only when one needs you', () => {
  const fixture = (over = {}) => renderPage([], [], [], 'Test', {
    urlKey: 'acme',
    workspace: { urlKey: 'acme', provider: 'linear' },
    topTaskId: 'linear:top',
    topTaskWhy: [],
    ...over
  });

  test('a subtask that needs you is in the page options, keyed by its row', () => {
    const html = fixture({ subtaskNeedsYouById: { 'linear:row': { identifier: 'LIN-12', title: 'Waiting child', href: '/workspace/acme/task/LIN-12' } } });
    assert.match(html, /subtaskNeedsYouById/);
    assert.match(html, /linear:row/);
    assert.match(html, /LIN-12/);
  });

  test('with no subtask needing you, the options are unchanged (no subtaskNeedsYouById key)', () => {
    assert.equal(/subtaskNeedsYouById/.test(fixture({ subtaskNeedsYouById: {} })), false);
  });
});
