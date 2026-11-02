/**
 * LIN-4145 (S3e-0): Home's folds follow the tracker parent link (`parentKeyOf`), so a child in another project is a child
 * of its parent on Home. `buildForest` links a child only within its own project, so a cross-project child is a root of
 * its own project's tree. Home must still count it in its parent's "N more", page it through `moreOfParent`, hold it in
 * `onHome`, and never repeat it in Up next or the recent rows.
 *
 * The trees and the In Progress forest come from the same helpers the app uses (`buildForest`, `partitionCompleted`,
 * `buildInProgressForest`), so the shapes are the ones production builds.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor } from '../../lib/home-rows.js';
import { buildForest, buildInProgressForest, nodeKey, partitionCompleted, PERIODICALS_PROJECT_ID } from '../../lib/tree.js';
import { isCompleted } from '../../lib/providers/state-map.js';

const PA = { id: 'pa', name: 'Alpha' };
const PB = { id: 'pb', name: 'Beta' };
const PROJECTS = [PA, PB];

const issue = (identifier, type, { parent = null, project = PA } = {}) => ({
  id: identifier,
  identifier,
  title: identifier,
  state: { type },
  parent: parent ? { id: parent } : null,
  project,
  labels: { nodes: [] },
});

/** The project trees and the In Progress forest the page is built from, across every project in `PROJECTS`. */
function workspaceOf(issues) {
  const forest = buildForest(issues);
  const trees = PROJECTS.map(project => {
    const roots = forest.get(project.id)?.roots || [];
    const { incomplete, completed, completedCount } = partitionCompleted(roots);
    return { project: { ...project, collapsed: false }, incomplete, completed, completedCount };
  });
  return { trees, inProgressTrees: buildInProgressForest(issues, PROJECTS) };
}

/** A recent-activity root for one issue, shaped the way `buildRecentActivityForest` hands them to Home. */
const recentRoot = (issueObj, projectName) => ({ issue: issueObj, children: [], depth: 0, projectName });

function scenario({ issues, states = {}, topTaskId = null, recent = [] }) {
  const { trees, inProgressTrees } = workspaceOf(issues);
  const stateMap = new Map(Object.entries(states));
  // LIN-4114: a needs-you task has an open ruling, so Home holds its row (the Waiting on you set).
  const rulingRows = Object.entries(states)
    .filter(([, state]) => state.state === 'needs-you')
    .map(([identifier]) => ({ decision: { decision_id: `d-${identifier}`, question: 'Which?' }, decisionCase: [], anchor: { loopId: null, issueId: `id-${identifier}`, issueIdentifier: identifier, workspaceUrlKey: 'w', taskDecisionId: `td-${identifier}` }, disposition: 'task-bound', effect: 'record', canReply: true }));
  // Every open issue is a front card, in list order, so Up next has the same candidates the page would.
  const orderedCards = issues.filter(i => !isCompleted(i)).map(i => ({ identifier: i.identifier, isSeed: false }));
  const recentActivityTrees = recent.length ? [{ roots: recent.map(id => recentRoot(issues.find(i => i.identifier === id), 'x')) }] : [];
  const view = buildHomeView({ inProgressTrees, trees, states: stateMap, topTaskId, recentActivityTrees, orderedCards, rulingRows });
  return { issues, trees, inProgressTrees, view, states: stateMap, topTaskId, rulingRows, recentActivityTrees, orderedCards };
}

/** The identifiers of a node list, depth-first, open ones only. */
function openIdsOf(nodes, into = []) {
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

/** The project-level Up next rows (the project trees Home holds), excluding the Periodicals project. */
function projectUpNextIds(s) {
  const into = [];
  for (const tree of s.view.trees) {
    if (tree.project?.id !== PERIODICALS_PROJECT_ID) openIdsOf(tree.incomplete || [], into);
  }
  return into;
}

/** Every identifier Home draws In Progress (each node the view keeps, at any depth). */
function inProgressIdsOf(s) {
  return viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).map(node => node.issue.identifier);
}

/** The rows `moreOfParent` returns for a parent Home draws, by its identifier. */
function moreOf(s, parentIdentifier) {
  const parent = viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).find(node => node.issue.identifier === parentIdentifier);
  assert.ok(parent, `${parentIdentifier} must be drawn In Progress for its fold to open`);
  return homeRowsFor({ kind: 'more-of-parent', parentId: parent.issue.id, trees: s.trees, inProgressTrees: s.inProgressTrees, states: s.states, topTaskId: s.topTaskId, rulingRows: s.rulingRows });
}

describe('LIN-4145: a child in another project is a child of its parent on Home', () => {
  test('(a) a Running parent with an open child in another project: "N more" counts it, the fold returns it, Home holds it, and Up next and the recent rows do not repeat it', () => {
    const s = scenario({
      issues: [issue('P-1', 'started'), issue('C-2', 'unstarted', { parent: 'P-1', project: PB })],
      recent: ['C-2'],
    });
    const parent = viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).find(node => node.issue.identifier === 'P-1');
    assert.ok(parent, 'P-1 is Running');
    assert.equal(parent.more, 1, 'C-2 is an open child in another project, so it is folded and counted in "N more"');

    const rows = moreOf(s, 'P-1');
    assert.deepEqual(rows.nodes.map(n => n.issue.identifier), ['C-2'], 'moreOfParent returns the cross-project child');

    // onHome: the child is held by Home (it is not in any other section, and is reached through its parent).
    assert.ok(!projectUpNextIds(s).includes('C-2'), 'C-2 is not repeated in a project Up next');
    assert.ok(!s.view.upNext.some(row => row.issue.identifier === 'C-2'), 'C-2 is not repeated in the flat Up next list');
    assert.ok(!s.view.recent.nodes.concat(s.view.recent.rest).some(row => row.issue.identifier === 'C-2'), 'C-2 is not repeated in the recent rows');
  });

  test('(b) a cross-project child of a context ancestor (the LIN-2569 shape): the Todo parent is context, and the child is folded under it', () => {
    const s = scenario({
      issues: [
        issue('P-1', 'unstarted'),
        issue('C-2', 'started', { parent: 'P-1' }),
        issue('X-3', 'unstarted', { parent: 'P-1', project: PB }),
      ],
    });
    const parent = viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).find(node => node.issue.identifier === 'P-1');
    assert.ok(parent, 'P-1 is held as context for its started child C-2');
    assert.equal(parent.context, true, 'the Todo parent is a context row');
    assert.equal(parent.more, 1, 'X-3 is an open child in another project, so it is folded and counted');

    const rows = moreOf(s, 'P-1');
    assert.deepEqual(rows.nodes.map(n => n.issue.identifier), ['X-3'], 'moreOfParent returns the cross-project child');
    assert.ok(!projectUpNextIds(s).includes('X-3'), 'X-3 is not repeated in its project Up next');
    assert.ok(!s.view.upNext.some(row => row.issue.identifier === 'X-3'), 'X-3 is not repeated in the flat Up next list');
  });

  test('(c) a cross-project child Home already draws (started, project-tagged) is counted once, and its parent folds nothing for it', () => {
    const s = scenario({
      issues: [issue('P-1', 'started'), issue('C-2', 'started', { parent: 'P-1', project: PB })],
    });
    const drawn = inProgressIdsOf(s);
    assert.equal(drawn.filter(id => id === 'C-2').length, 1, 'C-2 is drawn once, under its parent');

    const parent = viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).find(node => node.issue.identifier === 'P-1');
    assert.deepEqual(parent.children.map(c => c.issue.identifier), ['C-2']);
    assert.equal(parent.more, 0, 'a child Home draws is not also counted in "N more"');
    assert.deepEqual(moreOf(s, 'P-1').nodes, [], 'and the fold does not return it again');
    assert.ok(!projectUpNextIds(s).includes('C-2'), 'C-2 is not repeated in its project section');
  });
});
