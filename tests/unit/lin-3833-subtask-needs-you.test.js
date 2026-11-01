/**
 * LIN-3833 — the opened task's subtask line: a subtask that needs you (or failed), named with an Open link.
 *
 * LIN-4016: the line is the server's `attention` on the parent's row state, so these fixtures build row states with
 * `taskStateOf` and `rollUpRow`, the same readers `buildRowStates` uses, and no hand-written flags.
 * LIN-4071: the line is the gather's words, read from `/state` (`attention`) and from the row state the gather decides;
 * the Home row record carries no subtask line, and the browser builds the Open link from the task's own source.
 *
 * Witnesses:
 *  - a parent's row state names the subtask that needs you (else the failed one) as `attention`, with its words, and names
 *    nothing when no subtask needs you or fails;
 *  - every row's state (the gather's, over the whole tree) names its own direct subtask that needs you, so the line shows
 *    for whichever task is opened, and a grandparent does not name a grandchild;
 *  - the Home record carries no subtask line (LIN-4071), and the page options carry `rowData` (the per-row records) only
 *    when there are rows to carry.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rowDataByNodeKey } from '../../lib/task-board-view.js';
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

const TOP_CHILDREN = [childOf('LIN-11', QUIET), childOf('LIN-12', NEEDS_YOU)];

describe('LIN-3833 — a parent\'s state names the subtask that needs you, or the one that failed (the gather\'s attention)', () => {
  test('names the subtask that needs you, with its line', () => {
    const { attention } = parentOf(TOP_CHILDREN);
    assert.deepEqual(attention, {
      identifier: 'LIN-12',
      title: 'Title LIN-12',
      state: 'needs-you',
      lead: 'A subtask needs you',
      detail: '',
      words: 'A subtask needs you: LIN-12',
    });
  });

  test('a failed subtask is named as failed, with its failure (not as needing you)', () => {
    const { attention } = parentOf([childOf('LIN-11', QUIET), childOf('LIN-12', FAILED)]);
    assert.equal(attention.identifier, 'LIN-12');
    assert.equal(attention.words, 'A subtask failed: LIN-12 · Build failed');
    assert.equal(attention.state, 'failed');
  });

  test('says nothing when no subtask needs you or fails', () => {
    assert.equal(parentOf([childOf('LIN-11', QUIET), childOf('LIN-12', QUIET)]).attention, null);
  });
});

// A Home tree node: the issue and its child nodes, as buildForest makes them.
const node = (identifier, children = [], extra = {}) => ({
  issue: { id: `id-${identifier}`, identifier, title: `Title ${identifier}`, source: 'linear', ...extra },
  children,
});

describe('LIN-3833 — every row\'s state names its own subtask that needs you (the gather\'s attention, LIN-4071)', () => {
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
    ['LIN-40', taskStateOf(QUIET)],
  ]);

  test('a row that is not the top task names its waiting subtask in its own state', () => {
    assert.equal(rowStates.get('LIN-20').attention.identifier, 'LIN-22');
  });

  test('rows whose subtasks are quiet, or who have none, name no subtask', () => {
    assert.equal(rowStates.get('LIN-30').attention, null);
    assert.equal(rowStates.get('LIN-40').attention, null);
  });

  test('a waiting subtask of a nested row is named by its direct parent', () => {
    const inner = node('LIN-50', [node('LIN-51')]);
    const outer = node('LIN-49', [inner]);
    const states = new Map([
      ['LIN-49', parentOf([childOf('LIN-50', QUIET)])],
      ['LIN-50', parentOf([childOf('LIN-51', NEEDS_YOU)])],
      ['LIN-51', taskStateOf(NEEDS_YOU)],
    ]);
    assert.equal(states.get('LIN-50').attention.identifier, 'LIN-51');
    assert.equal(states.get('LIN-49').attention, null, 'the grandparent does not name a grandchild');
    // The Home record keeps no subtask line; the state above is what /state sends.
    const byKey = rowDataByNodeKey({ urlKey: 'acme', inProgressTrees: [{ roots: [outer] }], rowStates: states });
    assert.equal('attention' in byKey[nodeKey(inner.issue)], false, 'the record carries no subtask line');
    assert.equal('attention' in byKey[nodeKey(outer.issue)], false, 'the record carries no subtask line');
  });

  test('rows in Recent activity and in the completed part of a project are covered too', () => {
    const recent = node('LIN-60', [node('LIN-61')]);
    const done = node('LIN-70', [node('LIN-71')]);
    const states = new Map([
      ['LIN-60', parentOf([childOf('LIN-61', NEEDS_YOU)])],
      ['LIN-70', parentOf([childOf('LIN-71', NEEDS_YOU)])],
    ]);
    assert.equal(states.get('LIN-60').attention.identifier, 'LIN-61');
    assert.equal(states.get('LIN-70').attention.identifier, 'LIN-71');
    const byKey = rowDataByNodeKey({
      urlKey: 'acme',
      recentActivityTrees: [{ roots: [recent] }],
      projectTrees: [{ incomplete: [], completed: [done] }],
      rowStates: states,
    });
    assert.ok(byKey[nodeKey(recent.issue)], 'the recent row has its record');
    assert.ok(byKey[nodeKey(done.issue)], 'the completed row has its record');
  });
});

describe('LIN-3833 — Home\'s prompt options carry the per-row records, and no subtask line (LIN-4071)', () => {
  const fixture = (over = {}) => renderPage([], [], [], 'Test', {
    urlKey: 'acme',
    workspace: { urlKey: 'acme', provider: 'linear' },
    topTaskId: 'linear:top',
    topTaskWhy: [],
    ...over,
  });

  test('a row with a decided action is in the page options, keyed by its row; no subtask line rides with it', () => {
    const html = fixture({ rowData: { 'linear:row': { action: { kind: 'run-to-pr', why: 'x', container: true }, copyStep: { label: 'plan', name: 'Plan', why: '' }, trackerWord: 'In progress' } } });
    assert.match(html, /rowData/);
    assert.match(html, /linear:row/);
    assert.doesNotMatch(html, /attention/, 'the subtask line is /state\'s, never a page option');
  });

  test('with no row data, the options are unchanged (no rowData key)', () => {
    assert.equal(/rowData/.test(fixture({ rowData: {} })), false);
  });
});
