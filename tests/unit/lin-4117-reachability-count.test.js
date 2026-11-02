/**
 * LIN-4117 (S3a-0, reachability, part 1): a node In Progress shows counts the open children it folds, not only a
 * started node. The count comes from the project tree's copy of the node (it has every child), and the fold
 * (`more-of-parent`) finds the parent in the project trees first, so a sibling of a promoted task stays reachable.
 *
 * Shapes: a top task under a Todo parent (promoted from a project tree); a started child under a Todo parent
 * (the parent is held by the In Progress forest as context); a failed Todo parent with children (its own reason).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor } from '../../lib/home-rows.js';
import { nodeKey } from '../../lib/tree.js';

const node = (identifier, type, children = []) => ({
  issue: { id: identifier, identifier, title: identifier, state: { type }, labels: { nodes: [] } },
  children,
  depth: 0,
});
const ids = nodes => nodes.map(n => n.issue.identifier);
const states = entries => new Map(Object.entries(entries));
const project = (id, incomplete) => ({ project: { id, name: id, collapsed: false }, incomplete, completed: [], completedCount: 0 });
const forest = roots => [{ projectId: 'p', projectName: 'p', roots }];

describe('LIN-4117 reachability: a node In Progress shows counts its open folded children', () => {
  test('a top task under a Todo parent: the parent is In Progress with more = its open siblings, and the fold returns them', () => {
    const trees = [project('p', [node('P-1', 'unstarted', [node('P-2', 'unstarted'), node('P-3', 'unstarted'), node('P-4', 'unstarted')])])];
    const topTaskId = nodeKey({ id: 'P-2' });
    const view = buildHomeView({ inProgressTrees: [], trees, states: states({}), topTaskId });
    const [root] = view.inProgressTrees[0].roots;
    assert.equal(root.issue.identifier, 'P-1');
    assert.equal(root.context, true, 'the Todo parent is context for the top task');
    assert.deepEqual(ids(root.children), ['P-2']);
    assert.equal(root.more, 2, 'P-3 and P-4 are open and folded');

    const rows = homeRowsFor({ kind: 'more-of-parent', parentId: 'P-1', trees, inProgressTrees: [], states: states({}), topTaskId });
    assert.deepEqual(ids(rows.nodes), ['P-3', 'P-4'], 'the fold returns the siblings the view leaves out');
    assert.equal(rows.section, 'in-progress');
    assert.equal(rows.parentId, 'P-1');
  });

  test('a done sibling under a Todo parent is not counted in more', () => {
    const trees = [project('p', [node('P-10', 'unstarted', [node('P-11', 'unstarted'), node('P-12', 'completed'), node('P-13', 'unstarted')])])];
    const topTaskId = nodeKey({ id: 'P-11' });
    const view = buildHomeView({ inProgressTrees: [], trees, states: states({}), topTaskId });
    const [root] = view.inProgressTrees[0].roots;
    assert.equal(root.more, 1, 'only P-13 is open and folded; the done P-12 is not counted');
    const rows = homeRowsFor({ kind: 'more-of-parent', parentId: 'P-10', trees, inProgressTrees: [], states: states({}), topTaskId });
    assert.deepEqual(ids(rows.nodes), ['P-13']);
  });

  test('a started child under a Todo parent: the forest holds the parent, and its open siblings still count and fold', () => {
    const trees = [project('p', [node('P-20', 'unstarted', [node('P-21', 'started'), node('P-22', 'unstarted'), node('P-23', 'backlog')])])];
    const inProgressTrees = forest([node('P-20', 'unstarted', [node('P-21', 'started')])]);
    const view = buildHomeView({ inProgressTrees, trees, states: states({}) });
    const [root] = view.inProgressTrees[0].roots;
    assert.equal(root.context, true);
    assert.deepEqual(ids(root.children), ['P-21']);
    assert.equal(root.more, 2, 'the forest holds only P-21; the project tree\'s copy adds P-22 and P-23, both folded');

    const rows = homeRowsFor({ kind: 'more-of-parent', parentId: 'P-20', trees, inProgressTrees, states: states({}) });
    assert.deepEqual(ids(rows.nodes), ['P-22', 'P-23']);
  });

  test('a failed Todo parent with children is its own reason to show, and its open children are folded', () => {
    const trees = [project('p', [node('P-30', 'unstarted', [node('P-31', 'unstarted'), node('P-32', 'unstarted')])])];
    const view = buildHomeView({ inProgressTrees: [], trees, states: states({ 'P-30': { state: 'failed', words: 'Build failed' } }) });
    const [root] = view.inProgressTrees[0].roots;
    assert.equal(root.context, false, 'the failed parent is its own reason to show');
    assert.equal(root.more, 2);
    const rows = homeRowsFor({ kind: 'more-of-parent', parentId: 'P-30', trees, inProgressTrees: [], states: states({ 'P-30': { state: 'failed', words: 'Build failed' } }) });
    assert.deepEqual(ids(rows.nodes), ['P-31', 'P-32']);
  });
});
