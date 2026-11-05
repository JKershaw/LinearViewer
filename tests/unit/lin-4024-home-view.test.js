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
import { buildHomeView, PROJECT_LEAD_ROOTS } from '../../lib/home-view.js';
import { PERIODICALS_PROJECT_ID, partitionCompleted, nodeKey } from '../../lib/tree.js';

/** LIN-4114: an open ruling's row, as the standing hands it (a needs-you task has one); Home holds it as Waiting on you. */
const ruling = (identifier) => ({ decision: { decision_id: `d-${identifier}`, question: 'Which?' }, decisionCase: [], anchor: { loopId: null, issueId: `id-${identifier}`, issueIdentifier: identifier, workspaceUrlKey: 'w', taskDecisionId: `td-${identifier}` }, disposition: 'task-bound', effect: 'record', canReply: true });
const node = (identifier, type, children = []) => ({
  issue: { id: identifier, identifier, title: identifier, state: { type } },
  children,
  depth: 0,
});
const ids = nodes => nodes.map(n => n.issue.identifier);
const stateFor = (over = {}) => ({ state: 'next', ...over });
const states = entries => new Map(Object.entries(entries));
const project = (id, incomplete) => ({ project: { id, name: id, collapsed: false }, incomplete, completed: [], completedCount: 0 });
const inProgress = roots => [{ projectId: 'p', projectName: 'p', roots }];

describe('In Progress: what shows', () => {
  test('a started parent shows only its started children (a Waiting on you child is not a row here) and counts the rest in more', () => {
    const parent = node('LIN-1', 'started', [
      node('LIN-2', 'started'),
      node('LIN-3', 'unstarted'),
      node('LIN-4', 'backlog'),
      node('LIN-5', 'unstarted'),
    ]);
    const view = buildHomeView({
      inProgressTrees: inProgress([parent]),
      trees: [],
      states: states({ 'LIN-4': stateFor({ state: 'needs-you' }) }),
      rulingRows: [ruling('LIN-4')],
    });
    const [root] = view.inProgressTrees[0].roots;
    assert.deepEqual(ids(root.children), ['LIN-2']);
    assert.deepEqual(view.waiting.ids, ['LIN-4'], 'LIN-4 sits in Waiting on you');
    assert.equal(root.more, 2, 'the two plain Todo children fold into "2 more"');
    assert.equal(root.context, false, 'a started parent is its own reason to show');
  });

  test('a done task with no open ruling is not in the view, and a done task with one sits in Waiting on you', () => {
    const view = buildHomeView({
      inProgressTrees: inProgress([
        node('LIN-10', 'completed'),
        node('LIN-11', 'completed'),
      ]),
      trees: [],
      states: states({ 'LIN-11': stateFor({ state: 'needs-you' }) }),
      rulingRows: [ruling('LIN-11')],
    });
    assert.deepEqual(view.waiting.ids, ['LIN-11']);
    assert.ok(!view.inProgressTrees.some(t => t.roots.some(n => n.issue.identifier === 'LIN-10')), 'LIN-10 has no ruling and is not shown');
  });

  // Review finding 2: a done root reaches the view through partitionCompleted, which puts it in `completed`, not
  // `incomplete`. The fixture above hands the done task straight to In Progress, which is not where it arrives.
  test('a done root with an open ruling, built through partitionCompleted, sits in Waiting on you and is not repeated under its project', () => {
    const { incomplete, completed, completedCount } = partitionCompleted([node('LIN-90', 'completed'), node('LIN-91', 'unstarted')]);
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [{ project: { id: 'p', name: 'p', collapsed: false }, incomplete, completed, completedCount }],
      states: states({ 'LIN-90': stateFor({ state: 'needs-you' }) }),
      rulingRows: [ruling('LIN-90')],
    });
    assert.deepEqual(view.waiting.ids, ['LIN-90']);
    assert.deepEqual(ids(view.trees[0].incomplete), ['LIN-91'], 'LIN-91 is Up next; LIN-90 is shown in Waiting on you only');
  });

  test('a deep Backlog task with an open ruling sits in Waiting on you; its Backlog ancestors are not In Progress when no open child is shown below them', () => {
    const view = buildHomeView({
      inProgressTrees: inProgress([
        node('LIN-20', 'backlog', [
          node('LIN-21', 'unstarted', [node('LIN-22', 'backlog')]),
        ]),
      ]),
      trees: [],
      states: states({ 'LIN-22': stateFor({ state: 'needs-you' }) }),
      rulingRows: [ruling('LIN-22')],
    });
    assert.deepEqual(view.waiting.ids, ['LIN-22']);
    assert.deepEqual(view.inProgressTrees, [], 'no open child of LIN-20 is shown below it, so nothing In Progress'); 
  });

  test('a failed Todo task is In Progress, and its failed state reaches the view', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', [node('LIN-30', 'unstarted')])],
      states: states({ 'LIN-30': stateFor({ state: 'failed', words: 'Build failed' }) }),
    });
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-30']);
    assert.deepEqual(view.trees[0].incomplete, [], 'a task In Progress is not repeated under its project');
  });

  test('the top task is present when it is a Backlog task', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', [node('LIN-40', 'backlog'), node('LIN-41', 'unstarted')])],
      states: states({}),
      topTaskId: nodeKey({ id: 'LIN-40' }),
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
    assert.equal(PROJECT_LEAD_ROOTS, 3);
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
    states: states({ 'LIN-81': stateFor({ state: 'needs-you' }) }),
  });
  const input = build();
  const before = JSON.stringify(input.trees);
  const beforeIP = JSON.stringify(input.inProgressTrees);
  buildHomeView(input);
  assert.equal(JSON.stringify(input.trees), before);
  assert.equal(JSON.stringify(input.inProgressTrees), beforeIP);
});

// LIN-4117 (S3a-0, identity): callers build the top task's key with nodeKey() (`source:id`, server.js:3484), so the
// top task is matched by that key only, and never when it is done. A done task with an open ruling still counts.
describe('LIN-4117 identity: the top task is matched by nodeKey, and never when it is done', () => {
  // W1: an unstarted top task is In Progress under its nodeKey and is not repeated under its project.
  test('W1: a nodeKey topTaskId puts an unstarted top task In Progress, out of its project', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', [node('LIN-100', 'unstarted'), node('LIN-101', 'unstarted')])],
      states: states({}),
      topTaskId: nodeKey({ id: 'LIN-100' }),
    });
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-100']);
    assert.deepEqual(ids(view.trees[0].incomplete), ['LIN-101'], 'the top task is not repeated under its project');
  });

  // W1: a bare identifier is not a top-task key, so it promotes nothing.
  test('W1: the plain identifier promotes nothing', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', [node('LIN-102', 'unstarted'), node('LIN-103', 'unstarted')])],
      states: states({}),
      topTaskId: 'LIN-102',
    });
    assert.deepEqual(view.inProgressTrees, [], 'a bare identifier must not promote anything');
    assert.deepEqual(ids(view.trees[0].incomplete), ['LIN-102', 'LIN-103']);
  });

  // W2: a done top task is never promoted, whether it is named by nodeKey or by identifier.
  test('W2: a done top task is not promoted, by nodeKey or by identifier', () => {
    for (const topTaskId of [nodeKey({ id: 'LIN-110' }), 'LIN-110']) {
      const { incomplete, completed, completedCount } = partitionCompleted([node('LIN-110', 'completed'), node('LIN-111', 'unstarted')]);
      const view = buildHomeView({
        inProgressTrees: [],
        trees: [{ project: { id: 'p', name: 'p', collapsed: false }, incomplete, completed, completedCount }],
        states: states({}),
        topTaskId,
      });
      assert.deepEqual(view.inProgressTrees, [], `topTaskId ${topTaskId} must not promote a done task`);
    }
  });

  // W2 guard: a done task with an open ruling is still promoted through the completed/needsAttention path.
  test('W2 guard: a done top task with an open ruling sits in Waiting on you, and its open sibling is Up next', () => {
    const { incomplete, completed, completedCount } = partitionCompleted([node('LIN-120', 'completed'), node('LIN-121', 'unstarted')]);
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [{ project: { id: 'p', name: 'p', collapsed: false }, incomplete, completed, completedCount }],
      states: states({ 'LIN-120': stateFor({ state: 'needs-you' }) }),
      topTaskId: nodeKey({ id: 'LIN-120' }),
      rulingRows: [ruling('LIN-120')],
    });
    assert.deepEqual(view.waiting.ids, ['LIN-120']);
    assert.deepEqual(ids(view.trees[0].incomplete), ['LIN-121']);
  });
});
