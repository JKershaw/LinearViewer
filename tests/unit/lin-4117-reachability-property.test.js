/**
 * LIN-4117 W2b (S3a-0 reachability, part 2): the property every open task Home holds is placed exactly once.
 *
 * A placement is one of: a row in In Progress, a row in the project's Up next, a row of the project's Backlog or
 * Up next fold (`homeRowsFor` pages), or a row of a `more-of-parent` fold. A top task or a ruling sits In Progress.
 * A started parent is the guard: it keeps its own shape. A done context ancestor may still render on Home.
 *
 * The trees and the In Progress forest come from the same helpers the app uses (`buildForest`, `partitionCompleted`,
 * `buildInProgressForest`), so a forest-held ancestor is built the way production builds it, not by hand.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor } from '../../lib/home-rows.js';
import { buildForest, buildInProgressForest, nodeKey, partitionCompleted, PERIODICALS_PROJECT_ID } from '../../lib/tree.js';
import { isCompleted } from '../../lib/providers/state-map.js';

const PROJECT = { id: 'p', name: 'P' };

const issue = (identifier, type, parent = null) => ({
  id: identifier,
  identifier,
  title: identifier,
  state: { type },
  parent: parent ? { id: parent } : null,
  project: PROJECT,
  labels: { nodes: [] },
});

/** The project trees and the In Progress forest the page is built from, shaped the way the app builds them. */
function workspaceOf(issues) {
  const roots = buildForest(issues).get(PROJECT.id)?.roots || [];
  const { incomplete, completed, completedCount } = partitionCompleted(roots);
  return {
    trees: [{ project: { ...PROJECT, collapsed: false }, incomplete, completed, completedCount }],
    inProgressTrees: buildInProgressForest(issues, [PROJECT]),
  };
}

function scenario({ issues, states = {}, topTaskId = null }) {
  const { trees, inProgressTrees } = workspaceOf(issues);
  const stateMap = new Map(Object.entries(states));
  const view = buildHomeView({ inProgressTrees, trees, states: stateMap, topTaskId });
  return { issues, trees, inProgressTrees, view, states: stateMap, topTaskId };
}

/** Appends the open identifiers of a node list, depth-first, to `into`. */
function openIdsOf(nodes, into) {
  for (const node of nodes) {
    if (!isCompleted(node.issue)) into.push(node.issue.identifier);
    openIdsOf(node.children || [], into);
  }
  return into;
}

/** Every view node In Progress shows, depth-first. */
function viewNodesOf(nodes, into = []) {
  for (const node of nodes) {
    into.push(node);
    viewNodesOf(node.children || [], into);
  }
  return into;
}

/** Where each open task is placed: In Progress, Up next, a Backlog or Up next fold, and each more-of-parent fold. */
function placementsOf(s) {
  const { view, trees, inProgressTrees, states, topTaskId } = s;
  const inProgress = [];
  for (const tree of view.inProgressTrees) openIdsOf(tree.roots, inProgress);

  const upNext = [];
  for (const tree of view.trees) {
    if (tree.project?.id !== PERIODICALS_PROJECT_ID) openIdsOf(tree.incomplete || [], upNext);
  }

  const folds = [];
  for (const tree of trees) {
    for (const kind of ['backlog', 'up-next']) {
      let offset = 0;
      let page;
      do {
        page = homeRowsFor({ kind, projectId: tree.project.id, offset, trees, inProgressTrees, states, topTaskId });
        openIdsOf(page.nodes, folds);
        offset = page.nextOffset;
      } while (offset !== null);
    }
  }

  const parentFolds = viewNodesOf(view.inProgressTrees.flatMap(tree => tree.roots))
    .filter(node => node.more > 0)
    .map(node => {
      const rows = homeRowsFor({ kind: 'more-of-parent', parentId: node.issue.id, trees, inProgressTrees, states, topTaskId });
      return { parent: node.issue.identifier, more: node.more, topLevel: rows.nodes.map(n => n.issue.identifier), all: openIdsOf(rows.nodes, []) };
    });

  return { inProgress, upNext, folds, parentFolds };
}

/** The view node for one In Progress identifier, or null when Home does not show it In Progress. */
function inProgressNodeOf(s, identifier) {
  return viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).find(node => node.issue.identifier === identifier) || null;
}

/** Asserts the property: each open task is placed exactly once, the named tasks sit In Progress, each fold matches its count. */
function assertPlacedOnce(s, { inProgress: mustBeInProgress = [] } = {}) {
  const p = placementsOf(s);
  const placed = [...p.inProgress, ...p.upNext, ...p.folds, ...p.parentFolds.flatMap(f => f.all)];
  const count = new Map();
  for (const id of placed) count.set(id, (count.get(id) || 0) + 1);
  const open = s.issues.filter(i => !isCompleted(i)).map(i => i.identifier);
  for (const id of open) {
    assert.equal(count.get(id) || 0, 1, `${id} must be placed exactly once; found ${count.get(id) || 0}`);
  }
  for (const id of mustBeInProgress) {
    assert.ok(p.inProgress.includes(id), `${id} must sit In Progress, not only in a fold`);
  }
  for (const f of p.parentFolds) {
    assert.equal(f.topLevel.length, f.more, `${f.parent}: its more-of-parent fold must return its ${f.more} folded task(s)`);
  }
}

describe('LIN-4117 W2b: every open task Home holds is placed exactly once', () => {
  test('a top task as a child of a Todo parent: the parent is context, and its open siblings fold under it', () => {
    const s = scenario({
      issues: [issue('P-1', 'unstarted'), issue('P-2', 'unstarted', 'P-1'), issue('P-3', 'unstarted', 'P-1'), issue('B-4', 'backlog', 'P-1')],
      topTaskId: nodeKey({ id: 'P-2' }),
    });
    assertPlacedOnce(s, { inProgress: ['P-2'] });
    assert.equal(inProgressNodeOf(s, 'P-1').context, true);
  });

  test('a top task as a child of a done parent: the done parent is context, and its open siblings still fold', () => {
    const s = scenario({
      issues: [issue('D-1', 'completed'), issue('T-2', 'unstarted', 'D-1'), issue('S-3', 'unstarted', 'D-1'), issue('B-4', 'backlog', 'D-1')],
      topTaskId: nodeKey({ id: 'T-2' }),
    });
    assertPlacedOnce(s, { inProgress: ['T-2'] });
  });

  test('a top task as a grandchild: each ancestor folds its own open siblings', () => {
    const s = scenario({
      issues: [
        issue('P-1', 'unstarted'),
        issue('M-2', 'unstarted', 'P-1'),
        issue('P-4', 'unstarted', 'P-1'),
        issue('T-3', 'unstarted', 'M-2'),
        issue('M-5', 'unstarted', 'M-2'),
      ],
      topTaskId: nodeKey({ id: 'T-3' }),
    });
    assertPlacedOnce(s, { inProgress: ['T-3'] });
  });

  test('a ruling child under a Todo parent: the ruling sits In Progress, and the parent folds its open siblings', () => {
    const s = scenario({
      issues: [issue('P-1', 'unstarted'), issue('R-2', 'unstarted', 'P-1'), issue('Q-3', 'unstarted', 'P-1'), issue('B-4', 'backlog', 'P-1')],
      states: { 'R-2': { state: 'needs-you' } },
    });
    assertPlacedOnce(s, { inProgress: ['R-2'] });
  });

  test('a failed Todo parent with children: the parent is its own reason to show, and it folds its children', () => {
    const s = scenario({
      issues: [issue('F-1', 'unstarted'), issue('C-2', 'unstarted', 'F-1'), issue('C-3', 'backlog', 'F-1')],
      states: { 'F-1': { state: 'failed', words: 'Build failed' } },
    });
    assertPlacedOnce(s, { inProgress: ['F-1'] });
    assert.equal(inProgressNodeOf(s, 'F-1').context, false);
  });

  test('a started parent (guard): it keeps its own shape, with its open children folded', () => {
    const s = scenario({
      issues: [issue('S-1', 'started'), issue('X-2', 'started', 'S-1'), issue('Y-3', 'unstarted', 'S-1'), issue('Z-4', 'backlog', 'S-1')],
    });
    assertPlacedOnce(s, { inProgress: ['S-1', 'X-2'] });
    assert.equal(inProgressNodeOf(s, 'S-1').context, false);
  });

  test('a started child under a Todo parent with Todo, Backlog, top-task and ruling siblings: the top task and the ruling sit In Progress', () => {
    const s = scenario({
      issues: [
        issue('P-1', 'unstarted'),
        issue('C-2', 'started', 'P-1'),
        issue('Q-3', 'unstarted', 'P-1'),
        issue('B-4', 'backlog', 'P-1'),
        issue('T-5', 'unstarted', 'P-1'),
        issue('R-6', 'unstarted', 'P-1'),
      ],
      states: { 'R-6': { state: 'needs-you' } },
      topTaskId: nodeKey({ id: 'T-5' }),
    });
    assertPlacedOnce(s, { inProgress: ['C-2', 'T-5', 'R-6'] });
    assert.equal(inProgressNodeOf(s, 'P-1').context, true);
  });

  test('the same under a done parent: the top task and the ruling sit In Progress, and the open siblings fold', () => {
    const s = scenario({
      issues: [
        issue('D-1', 'completed'),
        issue('C-2', 'started', 'D-1'),
        issue('Q-3', 'unstarted', 'D-1'),
        issue('B-4', 'backlog', 'D-1'),
        issue('T-5', 'unstarted', 'D-1'),
        issue('R-6', 'unstarted', 'D-1'),
      ],
      states: { 'R-6': { state: 'needs-you' } },
      topTaskId: nodeKey({ id: 'T-5' }),
    });
    assertPlacedOnce(s, { inProgress: ['C-2', 'T-5', 'R-6'] });
  });
});
