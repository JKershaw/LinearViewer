/**
 * LIN-4113 (S3b): Home's "Running and recently moved" section and "Up next", as the view and pipeline build them.
 *
 * Witnesses for the view and pipeline layer (beat 1). Each task appears once across Running, the recent rows, their
 * fold and Up next; a failed task and a Todo task with its own run are in Running; Up next is cross-project, unstarted
 * only, capped at 5 and in `orderIssuesForSwipe` order; the recent rows are capped at 10 with the rest behind a fold
 * paged by `/api/home-rows`; `isOwn` admits no more than the plan's list.
 *
 * Named imports are only for names that already exist. New names (UP_NEXT_LIMIT, HOME_RECENT_LIMIT, RECENT_WINDOW_DAYS,
 * KNOWN_SECTIONS) are read off a namespace import, so a missing name fails one assertion and not the whole file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as homeView from '../../lib/home-view.js';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowsFor, HOME_ROW_KINDS } from '../../lib/home-rows.js';
import { homeRowDataFor, gatherHomeInputs, gatherHomePage } from '../../lib/home-pipeline.js';
import { orderIssuesForSwipe } from '../../lib/task-board-view.js';
import * as tree from '../../lib/tree.js';
import * as issueRead from '../../routes/workspace-api-issue-read.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const NOW_ISO = '2026-11-02T09:00:00.000Z';

// ---- fixtures ----------------------------------------------------------------------------------------------------

const node = (identifier, type, children = [], over = {}) => ({
  issue: { id: identifier, identifier, title: identifier, state: { type }, ...over },
  children,
  depth: 0,
});
const ids = nodes => nodes.map(n => n.issue.identifier);
const states = entries => new Map(Object.entries(entries));
const stateFor = (state, over = {}) => ({ state, ...over });
const project = (id, name, incomplete, completed = []) => ({
  project: { id, name, collapsed: false },
  incomplete,
  completed,
  completedCount: completed.length,
});
const inProgress = (projectId, roots) => [{ projectId, projectName: projectId, roots }];
const card = (identifier, isSeed = false) => ({ id: `id-${identifier}`, identifier, isSeed });
/** A recent-activity forest over issues created today, as `buildRecentActivityForest` returns it (one flat tree). */
const recentOf = (identifiers, type = 'unstarted') => [{
  projectId: null,
  projectName: null,
  roots: identifiers.map(identifier => ({
    issue: { id: identifier, identifier, title: identifier, state: { type } },
    children: [],
    depth: 0,
    projectName: 'p',
    activityKind: 'created',
    activityAt: NOW_ISO,
  })),
}];

/** Every identifier Home shows, across Running (drawn), the recent rows (drawn and behind the fold), their "more" folds, and Up next. */
function homeIds(input) {
  const view = buildHomeView(input);
  const ids = [];
  const running = [];
  const walk = n => { running.push(n); ids.push(n.issue.identifier); (n.children || []).forEach(walk); };
  view.inProgressTrees.forEach(t => t.roots.forEach(walk));
  for (const n of running) {
    if (!n.more) continue;
    let offset = 0;
    for (;;) {
      const page = homeRowsFor({ ...input, kind: 'more-of-parent', parentId: n.issue.id, offset });
      ids.push(...page.nodes.map(x => x.issue.identifier));
      if (page.nextOffset == null) break;
      offset = page.nextOffset;
    }
  }
  ids.push(...view.recent.nodes.map(n => n.issue.identifier));
  let offset = 0;
  for (;;) {
    const page = homeRowsFor({ ...input, kind: 'recent', offset });
    ids.push(...page.nodes.map(x => x.issue.identifier));
    if (page.nextOffset == null) break;
    offset = page.nextOffset;
  }
  ids.push(...view.upNext.map(n => n.issue.identifier));
  return ids;
}

const distinct = list => new Set(list).size === list.length;

// ---- each task once ----------------------------------------------------------------------------------------------

describe('Running and recently moved: each task appears once', () => {
  test('starter-seed shape: a started parent, its Todo child, both created today — the pair is shown once, the child behind the parent fold', () => {
    const input = {
      inProgressTrees: inProgress('p', [node('LOCAL-1', 'started')]),
      trees: [project('p', 'p', [node('LOCAL-1', 'started', [node('LOCAL-2', 'unstarted')])])],
      recentActivityTrees: recentOf(['LOCAL-1', 'LOCAL-2']),
      states: states({ 'LOCAL-1': stateFor('running') }),
      topTaskId: null,
      orderedCards: [card('LOCAL-1'), card('LOCAL-2')],
    };
    const all = homeIds(input);
    assert.ok(distinct(all), `a task is shown twice: ${all.join(', ')}`);
    assert.deepEqual([...new Set(all)].sort(), ['LOCAL-1', 'LOCAL-2']);
    const view = buildHomeView(input);
    assert.equal(view.recent.nodes.length, 0, 'both recent rows are already on Home');
    assert.deepEqual(view.upNext, [], 'LOCAL-2 is behind its parent, so it is not Up next');
  });

  test('a heavy shape (three running parents with folded children, twenty Todo roots, 113 rows created today) shows each task once', () => {
    const roots = [];
    const recentIds = [];
    const children = [];
    for (let s = 1; s <= 3; s++) {
      const kids = [];
      for (let c = 1; c <= 30; c++) {
        const id = `S${s}-C${c}`;
        kids.push(node(id, 'unstarted'));
        children.push(id);
      }
      roots.push(node(`S${s}`, 'started', kids));
      recentIds.push(`S${s}`);
    }
    const todo = [];
    for (let t = 1; t <= 20; t++) {
      todo.push(node(`T-${t}`, 'unstarted'));
      recentIds.push(`T-${t}`);
    }
    recentIds.push(...children);
    const input = {
      inProgressTrees: inProgress('p', roots),
      trees: [project('p', 'p', [...roots, ...todo])],
      recentActivityTrees: recentOf(recentIds),
      states: states({}),
      topTaskId: null,
      orderedCards: [...roots, ...todo].map(n => card(n.issue.identifier)),
    };
    const all = homeIds(input);
    assert.ok(distinct(all), 'a task is shown more than once across Running, recent, the fold and Up next');
    assert.equal(all.length, 3 + 90 + 20, 'every open task is on Home once: 3 running, 90 folded, 20 Todo (5 Up next, 15 recent)');
  });

  test('a recent row that is already on Home through the Running view is not shown again as recent', () => {
    // LIN-11 finished today (completed), so it is a recent row and not Up next; LIN-10 is Running and recent too.
    const input = {
      inProgressTrees: inProgress('p', [node('LIN-10', 'started')]),
      trees: [project('p', 'p', [node('LIN-10', 'started')])],
      recentActivityTrees: [...recentOf(['LIN-10']), ...recentOf(['LIN-11'], 'completed')],
      states: states({}),
      orderedCards: [card('LIN-10'), card('LIN-11')],
    };
    const view = buildHomeView(input);
    assert.deepEqual(view.recent.nodes.map(n => n.issue.identifier), ['LIN-11']);
  });
});

// ---- recent window bound and fold ----------------------------------------------------------------------------------

describe('Recent: capped at 10 drawn, the rest behind a fold', () => {
  const sixHundred = Array.from({ length: 600 }, (_, i) => `R-${i + 1}`);

  test('600 recent rows give at most 10 drawn and a remaining count of 590', () => {
    const view = buildHomeView({ inProgressTrees: [], trees: [], recentActivityTrees: recentOf(sixHundred), states: states({}), orderedCards: [] });
    assert.equal(view.recent.nodes.length, 10, 'ten recent rows are drawn');
    assert.equal(view.recent.remaining, 590, 'the other 590 are counted behind "show N more"');
    assert.equal(view.recent.nodes[0].issue.identifier, 'R-1', 'the drawn rows are the newest, in the forest order');
  });

  test('the recent fold pages the rest through homeRowsFor: all 590 are reachable, 50 per page, and none is drawn twice', () => {
    const input = { inProgressTrees: [], trees: [], recentActivityTrees: recentOf(sixHundred), states: states({}), orderedCards: [] };
    const first = homeRowsFor({ ...input, kind: 'recent', offset: 0 });
    assert.equal(first.nodes.length, 50, 'a page is 50 rows');
    assert.equal(first.nextOffset, 50);
    const reached = [];
    let offset = 0;
    for (;;) {
      const page = homeRowsFor({ ...input, kind: 'recent', offset });
      reached.push(...page.nodes.map(n => n.issue.identifier));
      if (page.nextOffset == null) break;
      offset = page.nextOffset;
    }
    assert.equal(reached.length, 590);
    assert.ok(distinct(reached));
    assert.ok(!reached.includes('R-1') && !reached.includes('R-10'), 'the drawn ten are not in the fold');
  });

  test('the recent cap and the fold are one number: the view and the fold cannot disagree', () => {
    assert.equal(homeView.HOME_RECENT_LIMIT, 10, 'HOME_RECENT_LIMIT is exported as 10');
  });
});

// ---- what joins Running -------------------------------------------------------------------------------------------

describe('Running: which tasks join, and what must stay out', () => {
  test('a failed Todo task is in Running (pin of existing behaviour) and is not repeated among the recent rows', () => {
    const input = {
      inProgressTrees: [],
      trees: [project('p', 'p', [node('LIN-30', 'unstarted')])],
      recentActivityTrees: recentOf(['LIN-30']),
      states: states({ 'LIN-30': stateFor('failed', { words: 'Build failed' }) }),
      orderedCards: [card('LIN-30')],
    };
    const view = buildHomeView(input);
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-30']);
    assert.deepEqual(view.recent.nodes, [], 'a failed task is in Running and recently moved, once');
  });

  test('a Todo task with its own running run is in Running, not Up next, and not in its project any more', () => {
    const input = {
      inProgressTrees: [],
      trees: [project('p', 'p', [node('LIN-40', 'unstarted'), node('LIN-41', 'unstarted')])],
      recentActivityTrees: [],
      states: states({ 'LIN-40': stateFor('running') }),
      orderedCards: [card('LIN-40'), card('LIN-41')],
    };
    const view = buildHomeView(input);
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-40'], 'the running Todo task is In Running (it was invisible on Home before)');
    assert.deepEqual(ids(view.upNext), ['LIN-41'], 'and it is not Up next');
    assert.ok(!ids(view.trees[0].incomplete).includes('LIN-40'), 'it has left its project section (LIN-41 stays there, as Up next)');
  });

  test('a Todo task with its own queued run is in Running and not Up next', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('LIN-42', 'unstarted')])],
      states: states({ 'LIN-42': stateFor('queued') }),
      orderedCards: [card('LIN-42')],
    });
    assert.deepEqual(ids(view.inProgressTrees[0].roots), ['LIN-42']);
    assert.deepEqual(view.upNext, []);
  });

  test('a Todo parent whose subtask is running becomes a Running root, since its rolled-up state is running', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('LIN-50', 'unstarted', [node('LIN-51', 'unstarted')])])],
      states: states({ 'LIN-50': stateFor('running'), 'LIN-51': stateFor('running') }),
      orderedCards: [card('LIN-50'), card('LIN-51')],
    });
    const [root] = view.inProgressTrees[0].roots;
    assert.equal(root.issue.identifier, 'LIN-50');
    assert.equal(root.context, false, 'the parent is its own reason to show');
    assert.deepEqual(ids(root.children), ['LIN-51']);
  });

  test('must NOT admit: a done parent of a running subtask stays context only (rollUpRow rolls running up to it)', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [], [node('LIN-60', 'completed', [node('LIN-61', 'started')])])],
      states: states({ 'LIN-60': stateFor('running'), 'LIN-61': stateFor('running') }),
      orderedCards: [],
    });
    const [root] = view.inProgressTrees[0].roots;
    assert.equal(root.issue.identifier, 'LIN-60');
    assert.equal(root.context, true, 'the done parent is shown as context, not as its own row');
    assert.deepEqual(ids(root.children), ['LIN-61']);
  });

  test('must NOT admit: a Todo task whose only run ended stays in its project', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('LIN-70', 'unstarted')])],
      states: states({ 'LIN-70': stateFor('todo') }),
      orderedCards: [card('LIN-70')],
    });
    assert.deepEqual(view.inProgressTrees, []);
    assert.deepEqual(ids(view.trees[0].incomplete), ['LIN-70']);
  });

  test('must NOT admit: a parked task is not in Running', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('LIN-80', 'unstarted')])],
      states: states({ 'LIN-80': stateFor('parked') }),
      orderedCards: [],
    });
    assert.deepEqual(view.inProgressTrees, []);
  });

  test('must NOT admit: a viewer whose states carry no run records sees no Todo task in Running', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('LIN-90', 'unstarted'), node('LIN-91', 'unstarted')])],
      states: new Map(),
      orderedCards: [card('LIN-90'), card('LIN-91')],
    });
    assert.deepEqual(view.inProgressTrees, []);
    assert.deepEqual(ids(view.upNext), ['LIN-90', 'LIN-91']);
  });
});

// ---- Up next ----------------------------------------------------------------------------------------------------

describe('Up next: cross-project, unstarted only, capped at 5, in orderIssuesForSwipe order', () => {
  test('the limit is 5 (the ticket cap, read off the module)', () => {
    assert.equal(homeView.UP_NEXT_LIMIT, 5);
  });

  test('Up next takes tasks from more than one project', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('a', 'Alpha', [node('A-1', 'unstarted')]), project('b', 'Beta', [node('B-1', 'unstarted')])],
      states: states({}),
      orderedCards: [card('A-1'), card('B-1')],
    });
    assert.deepEqual(ids(view.upNext), ['A-1', 'B-1']);
    assert.deepEqual(view.upNext.map(n => n.projectName), ['Alpha', 'Beta'], 'each row carries its project name for the badge');
  });

  test('only unstarted tasks: a backlog, a triage, a started and a completed task are not Up next', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [
        node('U-1', 'unstarted'),
        node('U-2', 'backlog'),
        node('U-3', 'triage'),
        node('U-4', 'started'),
      ], [node('U-5', 'completed')])],
      states: states({}),
      orderedCards: [card('U-1'), card('U-2'), card('U-3'), card('U-4'), card('U-5')],
    });
    assert.deepEqual(ids(view.upNext), ['U-1']);
  });

  test('a task with a decided state other than todo is not Up next (running, queued, needs-you, failed, parked)', () => {
    const others = ['needs-you', 'failed', 'parked', 'queued'];
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('X-1', 'unstarted'), node('X-2', 'unstarted'), node('X-3', 'unstarted'), node('X-4', 'unstarted'), node('X-5', 'unstarted'), node('X-6', 'unstarted')])],
      states: states({ 'X-2': stateFor(others[0]), 'X-3': stateFor(others[1]), 'X-4': stateFor(others[2]), 'X-5': stateFor(others[3]) }),
      orderedCards: ['X-1', 'X-2', 'X-3', 'X-4', 'X-5', 'X-6'].map(id => card(id)),
    });
    const upNextIds = ids(view.upNext);
    assert.ok(!upNextIds.some(id => ['X-2', 'X-3', 'X-4', 'X-5'].includes(id)), `decided non-todo tasks reached Up next: ${upNextIds}`);
    assert.ok(upNextIds.includes('X-1') && upNextIds.includes('X-6'));
  });

  test('seeds are excluded', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('SEED-1', 'unstarted'), node('REAL-1', 'unstarted')])],
      states: states({}),
      orderedCards: [card('REAL-1'), card('SEED-1', true)],
    });
    assert.deepEqual(ids(view.upNext), ['REAL-1']);
  });

  test('capped at 5, taking the first five eligible cards in the order given', () => {
    const list = Array.from({ length: 8 }, (_, i) => node(`C-${i + 1}`, 'unstarted'));
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', list)],
      states: states({}),
      orderedCards: list.map(n => card(n.issue.identifier)),
    });
    assert.deepEqual(ids(view.upNext), ['C-1', 'C-2', 'C-3', 'C-4', 'C-5']);
  });

  test('the order is orderIssuesForSwipe\'s, not project order: priorities and a blocking edge reorder the list', () => {
    // Project order would put A first. Priority puts C (Urgent) first, and B is blocked by C, so the real order
    // is not the project order and not the priority order alone. The expected list is what orderIssuesForSwipe says.
    const a = { id: 'id-A', identifier: 'A', title: 'A', state: { type: 'unstarted' }, priority: 4, relations: { nodes: [] } };
    const b = { id: 'id-B', identifier: 'B', title: 'B', state: { type: 'unstarted' }, priority: 2, relations: { nodes: [{ type: 'blocks', relatedIssue: { id: 'id-C' } }] } };
    const c = { id: 'id-C', identifier: 'C', title: 'C', state: { type: 'unstarted' }, priority: 1, relations: { nodes: [] } };
    const projectTrees = [
      project('p1', 'Alpha', [{ issue: a, children: [], depth: 0 }, { issue: b, children: [], depth: 0 }]),
      project('p2', 'Beta', [{ issue: c, children: [], depth: 0 }]),
    ];
    const cards = orderIssuesForSwipe({ projectTrees, inProgressTrees: [], recentActivityTrees: [], urlKey: null });
    const expected = cards.map(x => x.identifier).filter(x => x === 'A' || x === 'B' || x === 'C');
    assert.notDeepEqual(expected, ['A', 'B', 'C'], 'the fixture must make project order differ from the swipe order');
    const view = buildHomeView({ inProgressTrees: [], trees: projectTrees, states: states({}), orderedCards: cards });
    // LIN-4139 retarget: this is the ranking, not the deck order. C is blocked by open B, so it is not ready; B (High)
    // ranks above A (Low). The deck order above is still asserted to differ, so the fixture still proves the point.
    assert.deepEqual(ids(view.upNext), ['B', 'A']);
  });

  test('a parent and its child: only one of the two is Up next, whichever comes first in the order (both orders)', () => {
    // LIN-4139 retarget: the child is the higher-priority task of their one epic, so it is the epic's card in both orders.
    // The point this test pins, that only one of the two appears, is unchanged.
    const trees = [project('p', 'p', [node('PAR-1', 'unstarted', [node('CHD-1', 'unstarted', [], { priority: 2 })], { priority: 4 })])];
    const parentFirst = buildHomeView({ inProgressTrees: [], trees, states: states({}), orderedCards: [card('PAR-1'), card('CHD-1')] });
    assert.deepEqual(ids(parentFirst.upNext), ['CHD-1'], 'parent first: the child is the epic\'s card, the parent is skipped');
    const childFirst = buildHomeView({ inProgressTrees: [], trees, states: states({}), orderedCards: [card('CHD-1'), card('PAR-1')] });
    assert.deepEqual(ids(childFirst.upNext), ['CHD-1'], 'child first: the parent is skipped');
  });

  test('Up next does not subtract from /backlog: the project section still lists an Up next task', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('K-1', 'unstarted'), node('K-2', 'unstarted')])],
      states: states({}),
      orderedCards: [card('K-1'), card('K-2')],
    });
    assert.deepEqual(ids(view.trees[0].incomplete), ['K-1', 'K-2']);
    assert.deepEqual(ids(view.upNext), ['K-1', 'K-2']);
  });

  test('Up next and the recent rows: an Up next task is not repeated among the recent rows; a finished one is recent only', () => {
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('N-1', 'unstarted')])],
      recentActivityTrees: [...recentOf(['N-1']), ...recentOf(['N-2'], 'completed')],
      states: states({}),
      orderedCards: [card('N-1'), card('N-2')],
    });
    assert.deepEqual(ids(view.upNext), ['N-1']);
    assert.deepEqual(view.recent.nodes.map(n => n.issue.identifier), ['N-2']);
  });
});

// ---- routing, pipeline, and the window --------------------------------------------------------------------------

describe('Routing and pipeline', () => {
  test('the recent fold kind is a Home row kind, and an unknown kind is still not one', () => {
    assert.ok(HOME_ROW_KINDS.includes('recent'), `HOME_ROW_KINDS is ${HOME_ROW_KINDS}`);
    assert.ok(!HOME_ROW_KINDS.includes('bogus'));
  });

  test('KNOWN_SECTIONS accepts home-up-next, and keeps the two existing sections', () => {
    assert.ok(issueRead.KNOWN_SECTIONS?.includes('home-up-next'), `KNOWN_SECTIONS is ${issueRead.KNOWN_SECTIONS}`);
    assert.ok(issueRead.KNOWN_SECTIONS.includes('in-progress'));
    assert.ok(issueRead.KNOWN_SECTIONS.includes('recent-activity'));
  });

  test('the recent window is one named constant, of one day', () => {
    assert.equal(tree.RECENT_WINDOW_DAYS, 1);
  });

  test('server.js and task-stack.js read the window through the constant, not a literal 1', () => {
    const server = readFileSync(join(ROOT, 'server.js'), 'utf8');
    const stack = readFileSync(join(ROOT, 'lib/task-stack.js'), 'utf8');
    assert.ok(/buildRecentActivityForest\(issues, projects, RECENT_WINDOW_DAYS\)/.test(server), 'server.js:1886 uses the constant');
    assert.ok(/buildRecentActivityForest\(issues, projects, RECENT_WINDOW_DAYS\)/.test(stack), 'task-stack.js:97 uses the constant');
    assert.ok(!/last 7 days/.test(server), 'the false "last 7 days" comment is corrected');
  });

  test('gatherHomeInputs returns the ordered cards it already computes, and gatherHomePage builds Up next and recent', async () => {
    const trees = [project('p', 'p', [node('G-1', 'unstarted'), node('G-2', 'unstarted')])];
    const recentActivityTrees = recentOf(['G-2']);
    const deps = {
      fetchAndPrepareProjects: async () => ({ trees, inProgressTrees: [], recentActivityTrees, stateIssues: [] }),
      orderIssuesForSwipe,
      homeRowStates: async () => ({ states: new Map(), roots: null }),
    };
    const opts = { workspace: { urlKey: 'ws' }, teamId: null, accountId: null, assigneeName: null, resolveFlags: async () => ({ runControls: false }) };
    const gathered = await gatherHomeInputs(deps, opts);
    assert.ok(Array.isArray(gathered.orderedCards), 'orderedCards is returned');
    assert.deepEqual(gathered.orderedCards.map(c => c.identifier).sort(), ['G-1', 'G-2']);
    const page = await gatherHomePage(deps, opts);
    // G-1 is the top task (the first non-seed card): always shown In Progress, so it is not also Up next.
    assert.deepEqual(ids(page.homeView.inProgressTrees[0].roots), ['G-1'], 'the top task is in Running');
    assert.deepEqual(ids(page.homeView.upNext), ['G-2'], 'Up next comes from the same ordered cards, minus what Running shows');
    assert.deepEqual(page.homeView.recent.nodes.length, 0, 'G-2 is Up next, so it is not also a recent row');
  });

  test('homeRowDataFor carries the drawn Up next rows and the drawn recent rows, and not the rest of the recent forest', () => {
    const big = Array.from({ length: 30 }, (_, i) => `RD-${i + 1}`);
    const cards = [card('UP-1'), ...big.map(id => card(id))];
    const view = buildHomeView({
      inProgressTrees: [],
      trees: [project('p', 'p', [node('UP-1', 'unstarted')])],
      recentActivityTrees: recentOf(big, 'completed'),
      states: states({}),
      orderedCards: cards,
    });
    const rowData = homeRowDataFor({ pageMode: 'home', urlKey: 'ws', homeView: view, rowStates: new Map() });
    assert.ok(Object.keys(rowData).some(k => k.endsWith(':UP-1')), 'the Up next row has its record');
    const recentKeys = Object.keys(rowData).filter(k => k.includes(':RD-'));
    assert.equal(recentKeys.length, 10, 'only the ten drawn recent rows have records; the 20 behind the fold do not');
  });
});

// (g) LIN-4113: the sign-in refresh renders the desk the page renders. The refresh and the page share one view
// (lib/home-pipeline.js) and one renderPage, so the desk markup, from Running to the backlog link, is the same string.
describe('LIN-4113 (g): the sign-in refresh renders the same desk as the page', () => {
  test('the Running, recent and Up next markup from the refresh equals the page built from the same inputs', async () => {
    const { renderDashboardAfterRefresh } = await import('../../lib/dashboard-refresh.js');
    const { renderPage: renderPageDirect } = await import('../../lib/render.js');
    const { nodeKey: keyOf } = await import('../../lib/tree.js');
    const WORKSPACE = { urlKey: 'ws', name: 'WS', provider: 'linear' };
    const projectTrees = [project('p', 'Alpha', [
      node('D-RUN', 'started'),
      node('D-N1', 'unstarted'),
      node('D-N2', 'unstarted'),
      node('D-N3', 'unstarted'),
      node('D-N4', 'unstarted'),
      node('D-N5', 'unstarted'),
      node('D-N6', 'unstarted'),
    ])];
    const inProgressTrees = [{ projectName: 'Alpha', roots: [projectTrees[0].incomplete[0]] }];
    const recentActivityTrees = recentOf(['D-OLD-1', 'D-OLD-2'], 'completed');
    const fetched = {
      trees: projectTrees, inProgressTrees, recentActivityTrees, organizationName: 'Org',
      teams: [], selectedTeamId: null, showSource: 'local', truncated: false, availableAssignees: [],
      appliedAssigneeName: null, degradedSources: [], stateIssues: [],
    };
    const pageCalls = [];
    const sent = [];
    const deps = {
      customPromptsStore: { list: async () => [] },
      getDeployInfo: () => ({}),
      getFeatureFlags: () => ({}),
      getProviderForWorkspace: () => ({ supports: () => false }),
      fetchAndPrepareProjects: async () => fetched,
      resolveRunControls: async () => ({ runControls: false }),
      homeRowStates: async () => ({ states: new Map(), roots: null, rulingCount: 0 }),
      orderIssuesForSwipe,
      renderPage: (...args) => { pageCalls.push(args); return renderPageDirect(...args); },
      writeTaskFacts: undefined,
      readFilledRung: undefined,
    };
    const session = { accountId: 'acct-g', workspaces: [WORKSPACE], proxyDefault: true, features: {}, copyFirstCardDismissed: true };
    await renderDashboardAfterRefresh(deps, {
      workspace: WORKSPACE, session, teamId: null,
      assigneeState: { resolvedAssigneeName: null, selectedAssignee: 'all' }, openRouterSource: null,
      res: { send: (html) => { sent.push(html); return html; } },
    });
    const refreshHtml = sent[0];

    // The same inputs through the view and the page, by hand: the top task is the first non-seed card, as the pipeline picks it.
    const cards = orderIssuesForSwipe({ projectTrees, inProgressTrees, recentActivityTrees, urlKey: 'ws' });
    const topTaskId = keyOf(cards.find(card => !card.isSeed));
    const view = buildHomeView({ inProgressTrees, trees: projectTrees, states: new Map(), topTaskId, recentActivityTrees, orderedCards: cards });
    const pageHtml = renderPageDirect(view.trees, view.inProgressTrees, recentActivityTrees, 'Org', {
      urlKey: 'ws', workspaces: [WORKSPACE], featureFlags: {}, topTaskId, homeView: view, rowStates: new Map(),
      copyFirstCard: false, selectedAssignee: 'all', showSource: true,
    });

    const desk = (html) => html.slice(html.indexOf('<div class="running-section"'), html.indexOf('data-testid="home-backlog-link"'));
    assert.ok(desk(refreshHtml).includes('data-testid="home-up-next-section"'), 'the refresh draws Up next');
    assert.ok(desk(refreshHtml).includes('data-testid="running-recent-label"'), 'the refresh draws the recent block');
    assert.equal(desk(refreshHtml), desk(pageHtml), 'the refresh and the page draw the same desk, byte for byte');
    assert.ok(pageCalls[0][4].homeView?.upNext?.length > 0, 'the refresh hands renderPage its view, with Up next in it');
  });
});
