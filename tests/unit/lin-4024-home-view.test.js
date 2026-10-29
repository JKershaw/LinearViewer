/**
 * LIN-4024 step 2 (volume): Home's trimmed forest (`buildHomeView`).
 *
 * Witnesses (plan witness C): a started parent shows only its started or needs-you children and counts the rest
 * in `more`; a done task is never in the view unless it has an open ruling; a deep Backlog task with a ruling is
 * In Progress under its ancestors; a failed Todo task is In Progress; the top task is present when it is Backlog;
 * the project view counts Backlog and done, shows a few Up next, and leaves out what In Progress already shows.
 * The input trees are not changed (the shared `fetchAndPrepareProjects` output stays whole for Swipe, Swim, Ship).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView, UP_NEXT_PER_PROJECT } from '../../lib/home-view.js';
import { PERIODICALS_PROJECT_ID } from '../../lib/tree.js';

const node = (identifier, type, children = []) => ({
  issue: { id: identifier, identifier, title: identifier, state: { type } },
  children,
  depth: 0,
});
const ids = nodes => nodes.map(n => n.issue.identifier);
const stateFor = (over = {}) => ({ state: 'next', needsYou: false, ...over });
const states = entries => new Map(Object.entries(entries));
const project = (id, incomplete) => ({ project: { id, name: id, collapsed: false }, incomplete, completed: [], completedCount: 0 });
const inProgress = roots => [{ projectId: 'p', projectName: 'p', roots }];

describe('In Progress: what shows', () => {
  test('a started parent shows only its started or needs-you children and counts the rest in more', () => {
    const parent = node('LIN-1', 'started', [
      node('LIN-2', 'started'),
      node('LIN-3', 'unstarted'),
      node('LIN-4', 'backlog'),
      node('LIN-5', 'unstarted'),
    ]);
    const view = buildHomeView({
      inProgressTrees: inProgress([parent]),
      trees: [],
      states: states({ 'LIN-4': stateFor({ needsYou: true, state: 'needs-you' }) }),
    });
    const [root] = view.inProgressTrees[0].roots;
    assert.deepEqual(ids(root.children), ['LIN-2', 'LIN-4']);
    assert.equal(root.more, 2, 'the two plain Todo children fold into "2 more"');
    assert.equal(root.context, false, 'a started parent is its own reason to show');
  });

  test('a done task with no open ruling is not in the view, and a done task with one is', () => {
    const view = buildHomeView({
      inProgressTrees: inProgress([
        node('LIN-10', 'completed'),
        node('LIN-11', 'completed'),
      ]),
      trees: [],
      states: states({ 'LIN-11': stateFor({ needsYou: true, state: 'needs-you' }) }),
    });
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-11']);
  });

  test('a deep Backlog task with an open ruling is In Progress, with its ancestors as context', () => {
    const view = buildHomeView({
      inProgressTrees: inProgress([
        node('LIN-20', 'backlog', [
          node('LIN-21', 'unstarted', [node('LIN-22', 'backlog')]),
        ]),
      ]),
      trees: [],
      states: states({ 'LIN-22': stateFor({ needsYou: true, state: 'needs-you' }) }),
    });
    const [root] = view.inProgressTrees[0].roots;
    assert.equal(root.issue.identifier, 'LIN-20');
    assert.equal(root.context, true, 'the backlog ancestor is context, not its own row');
    assert.equal(root.children[0].issue.identifier, 'LIN-21');
    assert.equal(root.children[0].context, true);
    assert.equal(root.children[0].children[0].issue.identifier, 'LIN-22');
    assert.equal(root.children[0].children[0].context, false);
  });

  test('a failed Todo task is In Progress, and its failed state reaches the view', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', [node('LIN-30', 'unstarted')])],
      states: states({ 'LIN-30': stateFor({ state: 'failed', needsYou: true, words: 'Build failed' }) }),
    });
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-30']);
    assert.deepEqual(view.trees[0].incomplete, [], 'a task In Progress is not repeated under its project');
  });

  test('the top task is present when it is a Backlog task', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', [node('LIN-40', 'backlog'), node('LIN-41', 'unstarted')])],
      states: states({}),
      topTaskId: 'LIN-40',
    });
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-40']);
  });
});

describe('Project view: Up next, Backlog and done', () => {
  test('Backlog is counted and not rendered, done is counted and not rendered, and Up next keeps a few', () => {
    const roots = [
      node('LIN-50', 'unstarted'),
      node('LIN-51', 'unstarted'),
      node('LIN-52', 'unstarted'),
      node('LIN-53', 'unstarted'),
      node('LIN-54', 'unstarted'),
      node('LIN-55', 'backlog', [node('LIN-56', 'backlog'), node('LIN-57', 'completed')]),
      node('LIN-58', 'completed'),
    ];
    const [tree] = buildHomeView({ inProgressTrees: [], trees: [project('p', roots)], states: states({}) }).trees;
    assert.deepEqual(ids(tree.incomplete), ['LIN-50', 'LIN-51', 'LIN-52']);
    assert.equal(tree.upNextMore, 2, 'the two Todo roots past the limit are counted');
    assert.equal(tree.backlogCount, 2, 'LIN-55 and LIN-56 are open Backlog; the done child is not counted as open');
    assert.equal(tree.doneCount, 2, 'LIN-57 and LIN-58 are done and never rendered');
    assert.equal(UP_NEXT_PER_PROJECT, 3);
  });

  test('open work under a done task is kept, and the done task is counted once', () => {
    const roots = [node('LIN-60', 'completed', [node('LIN-61', 'unstarted')])];
    const [tree] = buildHomeView({ inProgressTrees: [], trees: [project('p', roots)], states: states({}) }).trees;
    assert.deepEqual(ids(tree.incomplete), ['LIN-61']);
    assert.equal(tree.doneCount, 1);
  });

  test('a node already shown In Progress is left out of its project, subtree included', () => {
    const roots = [node('LIN-70', 'unstarted', [node('LIN-71', 'started'), node('LIN-72', 'unstarted')])];
    const view = buildHomeView({
      inProgressTrees: inProgress([node('LIN-71', 'started')]),
      trees: [project('p', roots)],
      states: states({}),
    });
    assert.deepEqual(ids(view.trees[0].incomplete), ['LIN-70']);
    assert.deepEqual(ids(view.trees[0].incomplete[0].children), ['LIN-72']);
  });

  test('the Periodicals group passes through unchanged', () => {
    const periodicals = { project: { id: PERIODICALS_PROJECT_ID, name: 'Periodicals' }, incomplete: [node('P-1', 'unstarted')], completed: [], completedCount: 0 };
    const [out] = buildHomeView({ inProgressTrees: [], trees: [periodicals], states: states({}) }).trees;
    assert.strictEqual(out, periodicals);
  });
});

test('the inputs are not changed, so the shared trees stay whole', () => {
  const build = () => ({
    inProgressTrees: inProgress([node('LIN-80', 'started', [node('LIN-81', 'unstarted')])]),
    trees: [project('p', [node('LIN-82', 'unstarted'), node('LIN-83', 'backlog')])],
    states: states({ 'LIN-81': stateFor({ needsYou: true, state: 'needs-you' }) }),
  });
  const input = build();
  const before = JSON.stringify(input.trees);
  const beforeIP = JSON.stringify(input.inProgressTrees);
  buildHomeView(input);
  assert.equal(JSON.stringify(input.trees), before);
  assert.equal(JSON.stringify(input.inProgressTrees), beforeIP);
});
