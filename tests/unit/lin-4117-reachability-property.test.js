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
  // LIN-4114: a task in the needs-you state has an open ruling, so Home holds its row (the Waiting on you set).
  const rulingRows = Object.entries(states)
    .filter(([, state]) => state.state === 'needs-you')
    .map(([identifier]) => ({ decision: { decision_id: `d-${identifier}`, question: 'Which?' }, decisionCase: [], anchor: { loopId: null, issueId: `id-${identifier}`, issueIdentifier: identifier, workspaceUrlKey: 'w', taskDecisionId: `td-${identifier}` }, disposition: 'task-bound', effect: 'record', canReply: true }));
  const view = buildHomeView({ inProgressTrees, trees, states: stateMap, topTaskId, rulingRows });
  return { issues, trees, inProgressTrees, view, states: stateMap, topTaskId, rulingRows };
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
  // LIN-4114: the Waiting on you set is a place a task can sit in.
  const waiting = [...view.waiting.ids];
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
        page = homeRowsFor({ kind, projectId: tree.project.id, offset, trees, inProgressTrees, states, topTaskId, rulingRows: s.rulingRows });
        openIdsOf(page.nodes, folds);
        offset = page.nextOffset;
      } while (offset !== null);
    }
  }

  const parentFolds = viewNodesOf(view.inProgressTrees.flatMap(tree => tree.roots))
    .filter(node => node.more > 0)
    .map(node => {
      const rows = homeRowsFor({ kind: 'more-of-parent', parentId: node.issue.id, trees, inProgressTrees, states, topTaskId, rulingRows: s.rulingRows });
      return { parent: node.issue.identifier, more: node.more, topLevel: rows.nodes.map(n => n.issue.identifier), all: openIdsOf(rows.nodes, []) };
    });

  return { inProgress, waiting, upNext, folds, parentFolds };
}

/** The view node for one In Progress identifier, or null when Home does not show it In Progress. */
function inProgressNodeOf(s, identifier) {
  return viewNodesOf(s.view.inProgressTrees.flatMap(tree => tree.roots)).find(node => node.issue.identifier === identifier) || null;
}

/** Asserts the property: each open task is placed exactly once, the named tasks sit In Progress, each fold matches its count. */
function assertPlacedOnce(s, { inProgress: mustBeInProgress = [], waiting: mustBeWaiting = [] } = {}) {
  const p = placementsOf(s);
  const placed = [...p.inProgress, ...p.waiting, ...p.upNext, ...p.folds, ...p.parentFolds.flatMap(f => f.all)];
  const count = new Map();
  for (const id of placed) count.set(id, (count.get(id) || 0) + 1);
  const open = s.issues.filter(i => !isCompleted(i)).map(i => i.identifier);
  for (const id of open) {
    assert.equal(count.get(id) || 0, 1, `${id} must be placed exactly once; found ${count.get(id) || 0}`);
  }
  for (const id of mustBeInProgress) {
    assert.ok(p.inProgress.includes(id), `${id} must sit In Progress, not only in a fold`);
  }
  for (const id of mustBeWaiting) {
    assert.ok(p.waiting.includes(id), `${id} must sit in Waiting on you, not only in a fold`);
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

  test('a ruling child under a Todo parent: the ruling sits in Waiting on you, and the parent folds its open siblings', () => {
    const s = scenario({
      issues: [issue('P-1', 'unstarted'), issue('R-2', 'unstarted', 'P-1'), issue('Q-3', 'unstarted', 'P-1'), issue('B-4', 'backlog', 'P-1')],
      states: { 'R-2': { state: 'needs-you' } },
    });
    assertPlacedOnce(s, { waiting: ['R-2'] });
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

  test('a started child under a Todo parent with Todo, Backlog, top-task and ruling siblings: the top task sits In Progress and the ruling sits in Waiting on you', () => {
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
    assertPlacedOnce(s, { inProgress: ['C-2', 'T-5'], waiting: ['R-6'] });
    assert.equal(inProgressNodeOf(s, 'P-1').context, true);
  });

  test('the same under a done parent: the top task sits In Progress, the ruling in Waiting on you, and the open siblings fold', () => {
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
    assertPlacedOnce(s, { inProgress: ['C-2', 'T-5'], waiting: ['R-6'] });
  });
});

// LIN-4145: the same property with children in another project. `buildForest` links a child only within its own project,
// so a cross-project child is a root of its own project's tree; Home must still place it once, behind its parent's fold.
//
// `/backlog` is not Home (LIN-4120): it draws the project trees (`view.trees`) and their Backlog and Up next folds, and it is
// unchanged by LIN-4145, so a cross-project child keeps its place in its own project there. The property is therefore
// checked per surface: on Home (In Progress, Waiting on you, the flat Up next, the more-of-parent folds) each open task is
// placed at most once; on `/backlog` each open task is placed at most once; and every open task is placed somewhere.
const CROSS_PROJECTS = [{ id: 'pa', name: 'Alpha' }, { id: 'pb', name: 'Beta' }];
const crossIssue = (identifier, type, { parent = null, project = CROSS_PROJECTS[0] } = {}) => ({
  id: identifier,
  identifier,
  title: identifier,
  state: { type },
  parent: parent ? { id: parent } : null,
  project,
  labels: { nodes: [] },
});

/** The project trees and In Progress forest across two projects, shaped the way the app builds them. */
function crossWorkspaceOf(issues) {
  const forest = buildForest(issues);
  const trees = CROSS_PROJECTS.map(project => {
    const roots = forest.get(project.id)?.roots || [];
    const { incomplete, completed, completedCount } = partitionCompleted(roots);
    return { project: { ...project, collapsed: false }, incomplete, completed, completedCount };
  });
  return { trees, inProgressTrees: buildInProgressForest(issues, CROSS_PROJECTS) };
}

function crossScenario({ issues, states = {}, topTaskId = null }) {
  const { trees, inProgressTrees } = crossWorkspaceOf(issues);
  const stateMap = new Map(Object.entries(states));
  const rulingRows = Object.entries(states)
    .filter(([, state]) => state.state === 'needs-you')
    .map(([identifier]) => ({ decision: { decision_id: `d-${identifier}`, question: 'Which?' }, decisionCase: [], anchor: { loopId: null, issueId: `id-${identifier}`, issueIdentifier: identifier, workspaceUrlKey: 'w', taskDecisionId: `td-${identifier}` }, disposition: 'task-bound', effect: 'record', canReply: true }));
  // Every open issue is a front card, so Home's flat Up next has every candidate it could repeat.
  const orderedCards = issues.filter(i => !isCompleted(i)).map(i => ({ identifier: i.identifier, isSeed: false }));
  const view = buildHomeView({ inProgressTrees, trees, states: stateMap, topTaskId, orderedCards, rulingRows });
  return { issues, trees, inProgressTrees, view, states: stateMap, topTaskId, rulingRows };
}

/** The property per surface (above), plus: each named task sits In Progress, in Waiting on you, or behind its parent's fold. */
function assertPlacedOnceAcrossProjects(s, { inProgress: mustBeInProgress = [], waiting: mustBeWaiting = [], folded: mustBeFolded = [] } = {}) {
  const p = placementsOf(s);
  const flatUpNext = s.view.upNext.map(row => row.issue.identifier);
  const parentFolded = p.parentFolds.flatMap(f => f.all);
  const home = [...p.inProgress, ...p.waiting, ...flatUpNext, ...parentFolded];
  const backlog = [...p.upNext, ...p.folds];
  const tally = ids => ids.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map());
  const onHome = tally(home);
  const onBacklog = tally(backlog);
  for (const id of s.issues.filter(i => !isCompleted(i)).map(i => i.identifier)) {
    assert.ok((onHome.get(id) || 0) <= 1, `${id} must be placed at most once on Home; found ${onHome.get(id)} in ${JSON.stringify(home)}`);
    assert.ok((onBacklog.get(id) || 0) <= 1, `${id} must be placed at most once on /backlog; found ${onBacklog.get(id)}`);
    assert.ok((onHome.get(id) || 0) + (onBacklog.get(id) || 0) >= 1, `${id} must be placed somewhere`);
  }
  for (const id of mustBeInProgress) assert.ok(p.inProgress.includes(id), `${id} must sit In Progress`);
  for (const id of mustBeWaiting) assert.ok(p.waiting.includes(id), `${id} must sit in Waiting on you`);
  for (const id of mustBeFolded) {
    assert.ok(parentFolded.includes(id), `${id} must be behind its parent's "N more" on Home; Home placed: ${JSON.stringify(home)}`);
  }
  for (const f of p.parentFolds) {
    assert.equal(f.topLevel.length, f.more, `${f.parent}: its more-of-parent fold must return its ${f.more} folded task(s)`);
  }
}

describe('LIN-4145 reachability: children in another project are placed exactly once', () => {
  test('a started parent with open cross-project children (Todo and Backlog): both fold under it, and Home repeats neither', () => {
    const s = crossScenario({
      issues: [
        crossIssue('P-1', 'started'),
        crossIssue('C-2', 'unstarted', { parent: 'P-1', project: CROSS_PROJECTS[1] }),
        crossIssue('C-3', 'backlog', { parent: 'P-1', project: CROSS_PROJECTS[1] }),
      ],
    });
    assertPlacedOnceAcrossProjects(s, { inProgress: ['P-1'], folded: ['C-2', 'C-3'] });
  });

  test('a started parent with a started cross-project child and an open cross-project sibling: the child is drawn, the sibling folds', () => {
    const s = crossScenario({
      issues: [
        crossIssue('P-1', 'started'),
        crossIssue('C-2', 'started', { parent: 'P-1', project: CROSS_PROJECTS[1] }),
        crossIssue('C-3', 'unstarted', { parent: 'P-1', project: CROSS_PROJECTS[1] }),
      ],
    });
    assertPlacedOnceAcrossProjects(s, { inProgress: ['P-1', 'C-2'], folded: ['C-3'] });
  });

  test('a started parent with a cross-project ruling child and an open cross-project sibling: the ruling sits in Waiting on you, the sibling folds', () => {
    const s = crossScenario({
      issues: [
        crossIssue('P-1', 'started'),
        crossIssue('R-2', 'unstarted', { parent: 'P-1', project: CROSS_PROJECTS[1] }),
        crossIssue('Q-3', 'unstarted', { parent: 'P-1', project: CROSS_PROJECTS[1] }),
      ],
      states: { 'R-2': { state: 'needs-you' } },
    });
    assertPlacedOnceAcrossProjects(s, { inProgress: ['P-1'], waiting: ['R-2'], folded: ['Q-3'] });
  });

  test('a Todo context parent with a started child and a cross-project Todo child (the LIN-2569 shape): the cross-project child folds', () => {
    const s = crossScenario({
      issues: [
        crossIssue('P-1', 'unstarted'),
        crossIssue('C-2', 'started', { parent: 'P-1' }),
        crossIssue('X-3', 'unstarted', { parent: 'P-1', project: CROSS_PROJECTS[1] }),
        crossIssue('Y-4', 'backlog', { parent: 'P-1' }),
      ],
    });
    assertPlacedOnceAcrossProjects(s, { inProgress: ['C-2'], folded: ['X-3', 'Y-4'] });
  });

  test('a failed parent with a cross-project child that runs (drawn as its own project\'s row): placed once, and the parent folds nothing for it', () => {
    const s = crossScenario({
      issues: [crossIssue('P-1', 'unstarted'), crossIssue('C-2', 'unstarted', { parent: 'P-1', project: CROSS_PROJECTS[1] })],
      states: { 'P-1': { state: 'failed', words: 'Build failed' }, 'C-2': { state: 'running' } },
    });
    assertPlacedOnceAcrossProjects(s, { inProgress: ['P-1', 'C-2'] });
  });
});

// LIN-4145 audit: a done child is dropped from a fold and its open children take its place (`openOnly`), so the count must
// hand them up the same way; it counted the done child as 0, so the fold was smaller than its rows, or not offered at all.
describe('LIN-4145 audit: a folded done child\'s open children are counted, as the fold returns them', () => {
  test('a started parent with a done child that has open children: they are counted, folded and placed once', () => {
    const s = scenario({
      issues: [issue('S-1', 'started'), issue('D-2', 'completed', 'S-1'), issue('G-3', 'unstarted', 'D-2'), issue('G-4', 'backlog', 'D-2')],
    });
    assertPlacedOnce(s, { inProgress: ['S-1'] });
    assert.equal(inProgressNodeOf(s, 'S-1').more, 2, 'G-3 and G-4 stand in for their done parent D-2');
  });

  test('the same with the done child in another project: its open children are counted and folded', () => {
    const s = crossScenario({
      issues: [
        crossIssue('P-1', 'started', { project: CROSS_PROJECTS[1] }),
        crossIssue('D-2', 'completed', { parent: 'P-1' }),
        crossIssue('X-3', 'unstarted', { parent: 'P-1' }),
        crossIssue('G-4', 'unstarted', { parent: 'D-2' }),
        crossIssue('G-5', 'unstarted', { parent: 'D-2' }),
      ],
    });
    assertPlacedOnceAcrossProjects(s, { inProgress: ['P-1'], folded: ['X-3', 'G-4', 'G-5'] });
  });
});
