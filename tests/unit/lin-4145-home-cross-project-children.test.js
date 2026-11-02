/**
 * LIN-4145 (S3e-0): Home's folds follow the tracker parent link (`parentKeyOf`), so a child in another project is a child
 * of its parent on Home. `buildForest` links a child only within its own project, so a cross-project child is a root of
 * its own project's tree. Home must still count it in its parent's "N more", page it through `moreOfParent`, hold it in
 * `onHome` (so the flat Up next and the recent rows never repeat it), and walk up through it in `parentOf`.
 *
 * `/backlog` is not Home: it draws the project trees (`view.trees`) and their folds, and it is unchanged, so a
 * cross-project child still sits in its own project there. The guards below pin that too.
 *
 * The trees and the In Progress forest come from the same helpers the app uses (`buildForest`, `partitionCompleted`,
 * `buildInProgressForest`), so the shapes are the ones production builds.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor } from '../../lib/home-rows.js';
import { buildForest, buildInProgressForest, partitionCompleted, PERIODICALS_PROJECT_ID } from '../../lib/tree.js';
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
const recentRoot = (issueObj) => ({ issue: issueObj, children: [], depth: 0, projectName: issueObj.project?.name ?? null });

function scenario({ issues, states = {}, topTaskId = null, recent = [] }) {
  const { trees, inProgressTrees } = workspaceOf(issues);
  const stateMap = new Map(Object.entries(states));
  // LIN-4114: a needs-you task has an open ruling, so Home holds its row (the Waiting on you set).
  const rulingRows = Object.entries(states)
    .filter(([, state]) => state.state === 'needs-you')
    .map(([identifier]) => ({ decision: { decision_id: `d-${identifier}`, question: 'Which?' }, decisionCase: [], anchor: { loopId: null, issueId: `id-${identifier}`, issueIdentifier: identifier, workspaceUrlKey: 'w', taskDecisionId: `td-${identifier}` }, disposition: 'task-bound', effect: 'record', canReply: true }));
  // Every open issue is a front card, in list order, so Up next has the same candidates the page would.
  const orderedCards = issues.filter(i => !isCompleted(i)).map(i => ({ identifier: i.identifier, isSeed: false }));
  const recentActivityTrees = recent.length ? [{ roots: recent.map(id => recentRoot(issues.find(i => i.identifier === id))) }] : [];
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

/** The view node Home draws In Progress for one identifier, or undefined. */
const drawnNodeOf = (s, identifier) => viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).find(node => node.issue.identifier === identifier);

/** `/backlog`'s project sections (`view.trees`), excluding the Periodicals project. Not Home: LIN-4120. */
function backlogSectionIds(s) {
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

const upNextIds = s => s.view.upNext.map(row => row.issue.identifier);
const recentIds = s => s.view.recent.nodes.concat(s.view.recent.rest).map(row => row.issue.identifier);

/** The rows `moreOfParent` returns for a parent Home draws, by its identifier. */
function moreOf(s, parentIdentifier) {
  const parent = drawnNodeOf(s, parentIdentifier);
  assert.ok(parent, `${parentIdentifier} must be drawn In Progress for its fold to open`);
  return homeRowsFor({ kind: 'more-of-parent', parentId: parent.issue.id, trees: s.trees, inProgressTrees: s.inProgressTrees, recentActivityTrees: s.recentActivityTrees, orderedCards: s.orderedCards, states: s.states, topTaskId: s.topTaskId, rulingRows: s.rulingRows });
}

describe('LIN-4145: a child in another project is a child of its parent on Home', () => {
  test('(a) a Running parent with an open child in another project (the LIN-3490 shape): "N more" counts it, the fold returns it, and Up next does not repeat it', () => {
    const s = scenario({
      issues: [issue('P-1', 'started'), issue('C-2', 'unstarted', { parent: 'P-1', project: PB })],
    });
    const parent = drawnNodeOf(s, 'P-1');
    assert.ok(parent, 'P-1 is Running');
    assert.equal(parent.more, 1, 'C-2 is an open child in another project, so it is folded and counted in "N more"');
    assert.deepEqual(moreOf(s, 'P-1').nodes.map(n => n.issue.identifier), ['C-2'], 'moreOfParent returns the cross-project child');
    // onHome holds it: Up next leaves out a task on Home, so this is onHome's witness.
    assert.ok(!upNextIds(s).includes('C-2'), 'C-2 is not repeated in Up next');
    // /backlog is unchanged: the project trees still hold C-2 as a root of its own project.
    assert.ok(backlogSectionIds(s).includes('C-2'), '/backlog still lists C-2 under its own project');
  });

  test('(a) a Running parent with a Backlog child in another project: the recent rows do not repeat it', () => {
    // A Backlog task is never an Up next candidate, so only onHome keeps it out of the recent rows.
    const s = scenario({
      issues: [issue('P-1', 'started'), issue('B-2', 'backlog', { parent: 'P-1', project: PB })],
      recent: ['B-2'],
    });
    assert.ok(!recentIds(s).includes('B-2'), 'B-2 is on Home (behind P-1\'s "N more"), so it is not a recent row');
    assert.equal(drawnNodeOf(s, 'P-1').more, 1, 'B-2 is open and folded under P-1');
  });

  test('(b) a cross-project child of a context ancestor (the LIN-2569 shape): the Todo parent is context, and the child is folded under it', () => {
    const s = scenario({
      issues: [
        issue('P-1', 'unstarted'),
        issue('C-2', 'started', { parent: 'P-1' }),
        issue('X-3', 'unstarted', { parent: 'P-1', project: PB }),
      ],
      recent: ['X-3'],
    });
    const parent = drawnNodeOf(s, 'P-1');
    assert.ok(parent, 'P-1 is held as context for its started child C-2');
    assert.equal(parent.context, true, 'the Todo parent is a context row');
    assert.equal(parent.more, 1, 'X-3 is an open child in another project, so it is folded and counted');
    assert.deepEqual(moreOf(s, 'P-1').nodes.map(n => n.issue.identifier), ['X-3'], 'moreOfParent returns the cross-project child');
    assert.ok(!upNextIds(s).includes('X-3'), 'X-3 is not repeated in Up next');
    assert.ok(!recentIds(s).includes('X-3'), 'X-3 is not repeated in the recent rows');
  });

  test('(c) a cross-project child Home already draws (started, project-tagged) is counted once, and its parent folds nothing for it', () => {
    const s = scenario({
      issues: [issue('P-1', 'started'), issue('C-2', 'started', { parent: 'P-1', project: PB })],
    });
    assert.equal(inProgressIdsOf(s).filter(id => id === 'C-2').length, 1, 'C-2 is drawn once, under its parent');
    const parent = drawnNodeOf(s, 'P-1');
    assert.deepEqual(parent.children.map(c => c.issue.identifier), ['C-2']);
    assert.equal(parent.children[0].projectTag, 'Beta', 'it is drawn with its own project as a tag');
    assert.equal(parent.more, 0, 'a child Home draws is not also counted in "N more"');
    assert.deepEqual(moreOf(s, 'P-1').nodes, [], 'and the fold does not return it again');
    assert.ok(!backlogSectionIds(s).includes('C-2'), 'a drawn task is left out of /backlog\'s project section, as before');
  });

  test('(c) a cross-project child Home draws as its own project\'s row (a running Todo task) is counted once: its parent does not fold it too', () => {
    // The parent is promoted (failed), not held by the In Progress forest, so the forest never nests the child under it:
    // the child is drawn as a root of its own project. Home must not also count it in the parent's "N more".
    const s = scenario({
      issues: [issue('P-1', 'unstarted'), issue('C-2', 'unstarted', { parent: 'P-1', project: PB })],
      states: { 'P-1': { state: 'failed', words: 'Build failed' }, 'C-2': { state: 'running' } },
    });
    assert.equal(inProgressIdsOf(s).filter(id => id === 'C-2').length, 1, 'C-2 is drawn once');
    assert.equal(drawnNodeOf(s, 'P-1').more, 0, 'P-1 does not count a child Home already draws');
    assert.deepEqual(moreOf(s, 'P-1').nodes, [], 'and its fold does not return it');
  });

  test('(e) parentOf crosses projects: Up next never lists a parent and its child in another project together', () => {
    const s = scenario({
      issues: [issue('P-1', 'unstarted'), issue('C-2', 'unstarted', { parent: 'P-1', project: PB })],
    });
    assert.deepEqual(upNextIds(s), ['P-1'], 'C-2 is P-1\'s child (tracker link), so it is skipped once P-1 is taken');
  });
});
