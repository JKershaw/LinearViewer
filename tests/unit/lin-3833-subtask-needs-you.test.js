/**
 * LIN-3833 — the opened task's subtask line: a subtask that needs you (or failed), named with an Open link.
 * LIN-4016: the line is the server's `attention` on the parent's row state, so these fixtures build row states with
 * `taskStateOf` and `rollUpRow`, the same readers `buildRowStates` uses, and no hand-written flags.
 *
 * Witnesses:
 *  - `subtaskNeedingYouOf` names the subtask the parent's row state carries as `attention`, with its task-page
 *    link (the top task's source carried), and says nothing when no subtask needs you or fails, when there is no
 *    row-state map (a viewer with no sessions), or when the top task has no row.
 *  - `rowDataByNodeKey` gives EVERY Home row its decision record, its subtask line (`attention`) included, keyed by the
 *    row's node key, so the line shows for whichever task is opened, not only Home's top task.
 *  - Home's prompt options carry `rowData` (the per-row decision records) when there are rows to carry, and
 *    carry no `rowData` key when there are none.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { subtaskNeedingYouOf, rowDataByNodeKey } from '../../lib/task-board-view.js';
import { renderPage } from '../../lib/render.js';
import { nodeKey } from '../../lib/tree.js';
import { taskStateOf, rollUpRow } from '../../lib/task-state.js';

// A child's row state as buildRowStates keeps it: its decided state, with its identifier and title.
const childOf = (identifier, facts = {}) => ({ identifier, title: `Title ${identifier}`, ...taskStateOf(facts) });
const NEEDS_YOU = { ownRuling: true };
const FAILED = { failed: { words: 'Build failed' } };
const QUIET = {};

// A parent's row state, rolled up from its children exactly as buildRowStates does.
const parentOf = (children, own = {}) => rollUpRow(own, children);

const TOP = { identifier: 'LIN-10', source: 'linear' };
const TOP_CHILDREN = [childOf('LIN-11', QUIET), childOf('LIN-12', NEEDS_YOU)];

describe('LIN-3833 subtaskNeedingYouOf — the top task\'s subtask that needs you', () => {
  test('names the subtask that needs you, with its task-page link and its line', () => {
    const rowStates = new Map([['LIN-10', parentOf(TOP_CHILDREN)]]);
    assert.deepEqual(
      subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates }),
      {
        identifier: 'LIN-12',
        title: null, // LIN-4049: the line names the subtask by identifier only, so Home and the opened task agree.
        href: '/workspace/acme/task/LIN-12?source=linear',
        state: 'needs-you',
        lead: 'A subtask needs you',
        detail: '',
        words: 'A subtask needs you: LIN-12'
      }
    );
  });

  test('a failed subtask is named as failed, with its failure (not as needing you)', () => {
    const rowStates = new Map([['LIN-10', parentOf([childOf('LIN-11', QUIET), childOf('LIN-12', FAILED)])]]);
    const line = subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates });
    assert.equal(line.identifier, 'LIN-12');
    assert.equal(line.words, 'A subtask failed: LIN-12 · Build failed');
    assert.equal(line.state, 'failed');
  });

  test('says nothing when no subtask needs you or fails', () => {
    const rowStates = new Map([['LIN-10', parentOf([childOf('LIN-11', QUIET), childOf('LIN-12', QUIET)])]]);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates }), null);
  });

  test('says nothing without row states (a copy-first viewer reads no sessions)', () => {
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: TOP, rowStates: null }), null);
  });

  test('says nothing when the top task has no row state, or there is no top task', () => {
    const rowStates = new Map([['LIN-10', parentOf(TOP_CHILDREN)]]);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: { identifier: 'LIN-1', source: 'linear' }, rowStates }), null);
    assert.equal(subtaskNeedingYouOf({ urlKey: 'acme', topTask: null, rowStates }), null);
  });
});

// A Home tree node: the issue and its child nodes, as buildForest makes them.
const node = (identifier, children = [], extra = {}) => ({
  issue: { id: `id-${identifier}`, identifier, title: `Title ${identifier}`, source: 'linear', ...extra },
  children
});

describe('LIN-3833 rowDataByNodeKey — every opened row names its own subtask that needs you (its attention)', () => {
  // A project-tree row that is NOT the top task, with one waiting child; a row with a quiet child; a row with none.
  const waitingRow = node('LIN-20', [node('LIN-21'), node('LIN-22')]);
  const quietRow = node('LIN-30', [node('LIN-31')]);
  const bareRow = node('LIN-40');
  const roots = [waitingRow, quietRow, bareRow];
  // Each row's state, rolled up from its children (a leaf rolls up to its own state).
  const rowStates = new Map([
    ['LIN-20', parentOf([childOf('LIN-21', QUIET), childOf('LIN-22', NEEDS_YOU)])],
    ['LIN-21', taskStateOf(QUIET)],
    ['LIN-22', taskStateOf(NEEDS_YOU)],
    ['LIN-30', parentOf([childOf('LIN-31', QUIET)])],
    ['LIN-31', taskStateOf(QUIET)],
    ['LIN-40', taskStateOf(QUIET)]
  ]);

  test('a row that is not the top task gets its waiting subtask, keyed by its node key', () => {
    const byKey = rowDataByNodeKey({ urlKey: 'acme', projectTrees: [{ incomplete: roots, completed: [] }], rowStates });
    assert.equal(byKey[nodeKey(waitingRow.issue)].attention.identifier, 'LIN-22');
    assert.equal(byKey[nodeKey(waitingRow.issue)].attention.href, '/workspace/acme/task/LIN-22?source=linear');
  });

  test('rows whose subtasks are quiet, or who have none, carry no subtask line', () => {
    const byKey = rowDataByNodeKey({ urlKey: 'acme', projectTrees: [{ incomplete: roots, completed: [] }], rowStates });
    assert.equal(byKey[nodeKey(quietRow.issue)].attention, null);
    assert.equal(byKey[nodeKey(bareRow.issue)].attention, null);
  });

  test('a waiting subtask of a nested row is named by its direct parent', () => {
    const inner = node('LIN-50', [node('LIN-51')]);
    const outer = node('LIN-49', [inner]);
    const states = new Map([
      ['LIN-49', parentOf([childOf('LIN-50', QUIET)])],
      ['LIN-50', parentOf([childOf('LIN-51', NEEDS_YOU)])],
      ['LIN-51', taskStateOf(NEEDS_YOU)],
    ]);
    const byKey = rowDataByNodeKey({ urlKey: 'acme', inProgressTrees: [{ roots: [outer] }], rowStates: states });
    assert.equal(byKey[nodeKey(inner.issue)].attention.identifier, 'LIN-51');
    assert.equal(byKey[nodeKey(outer.issue)].attention, null, 'the grandparent does not name a grandchild');
  });

  test('rows in Recent activity and in the completed part of a project are covered too', () => {
    const recent = node('LIN-60', [node('LIN-61')]);
    const done = node('LIN-70', [node('LIN-71')]);
    const states = new Map([
      ['LIN-60', parentOf([childOf('LIN-61', NEEDS_YOU)])],
      ['LIN-70', parentOf([childOf('LIN-71', NEEDS_YOU)])],
    ]);
    const byKey = rowDataByNodeKey({
      urlKey: 'acme',
      recentActivityTrees: [{ roots: [recent] }],
      projectTrees: [{ incomplete: [], completed: [done] }],
      rowStates: states
    });
    assert.equal(byKey[nodeKey(recent.issue)].attention.identifier, 'LIN-61');
    assert.equal(byKey[nodeKey(done.issue)].attention.identifier, 'LIN-71');
  });

  test('says nothing without row states (a copy-first viewer reads no sessions)', () => {
    const byKey = rowDataByNodeKey({ urlKey: 'acme', projectTrees: [{ incomplete: roots, completed: [] }], rowStates: null });
    assert.equal(byKey[nodeKey(waitingRow.issue)].attention, null);
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
    const html = fixture({ rowData: { 'linear:row': { container: true, attention: { identifier: 'LIN-12', title: 'Waiting child', href: '/workspace/acme/task/LIN-12' } } } });
    assert.match(html, /rowData/);
    assert.match(html, /linear:row/);
    assert.match(html, /LIN-12/);
  });

  test('with no row data, the options are unchanged (no rowData key)', () => {
    assert.equal(/rowData/.test(fixture({ rowData: {} })), false);
  });
});
