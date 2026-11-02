// LIN-4120 (S3a-3): Home lets go of the project sections. These pins are the render and helper half of the witnesses
// (W1 and W7 are also E2E in tests/e2e/lin-4120-home-backlog.spec.js; W5 is the bounded-Home E2E in CI).
//   - Home draws no project section: its Projects region is one `home-backlog-link`, carrying Home's assignee filter.
//   - The seed-only hint's "Add your own task" links to the backlog page.
//   - The backlog page draws the project sections alone, with no Home link.
//   - Home's rowData is In Progress and Recent only; the backlog's is the project trees (one helper, lib/home-pipeline.js).
//   - Add task's back link and Cancel return to the backlog page (lib/render-task-create.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../../lib/providers/index.js';
import { renderPage } from '../../lib/render.js';
import { renderTaskCreatePage } from '../../lib/render-task-create.js';
import { buildHomeView } from '../../lib/home-view.js';
import { homeRowDataFor } from '../../lib/home-pipeline.js';
import { nodeKey } from '../../lib/tree.js';
import { renderDashboardAfterRefresh } from '../../lib/dashboard-refresh.js';
import { orderIssuesForSwipe } from '../../lib/task-board-view.js';

const URL_KEY = 'ws';
const WORKSPACE = { urlKey: URL_KEY, name: 'WS', provider: 'linear' };

const issue = (fields) => ({
  id: 'i', identifier: 'X-1', title: 'Task', priority: 0,
  state: { type: 'backlog', name: 'Backlog' }, labels: { nodes: [] }, relations: { nodes: [] }, ...fields,
});
const node = (fields) => ({ issue: issue(fields), children: [], depth: 0 });

function worldTrees() {
  const started = node({ id: 's1', identifier: 'X-S', title: 'Working', state: { type: 'started', name: 'In Progress' } });
  const todo = node({ id: 't1', identifier: 'X-T', title: 'Waiting', state: { type: 'unstarted', name: 'Todo' } });
  const backlog = node({ id: 'b1', identifier: 'X-B', title: 'Parked' });
  const projectTrees = [{ project: { id: 'p1', name: 'Alpha' }, incomplete: [todo, backlog], completed: [], completedCount: 0 }];
  const inProgressTrees = [{ projectName: 'Alpha', roots: [started] }];
  return { projectTrees, inProgressTrees, started, todo, backlog };
}

/** Home as its route builds it: the one view (lib/home-view.js), then the page. */
function renderHome(extra = {}) {
  const { projectTrees, inProgressTrees } = worldTrees();
  const view = buildHomeView({ inProgressTrees, trees: projectTrees, states: new Map(), topTaskId: null });
  return renderPage(view.trees, view.inProgressTrees, [], 'Org', { urlKey: URL_KEY, workspaces: [WORKSPACE], featureFlags: {}, ...extra });
}

describe('LIN-4120: Home draws no project section, and one Backlog link stands in for them', () => {
  test('Home has no project section and exactly one home-backlog-link labelled Backlog ›', () => {
    const html = renderHome();
    assert.equal((html.match(/data-testid="project"/g) || []).length, 0, 'no project section on Home');
    assert.equal((html.match(/data-testid="home-backlog-link"/g) || []).length, 1, 'exactly one Backlog link');
    assert.match(html, /<a href="\/workspace\/ws\/backlog" data-testid="home-backlog-link">Backlog ›<\/a>/);
    assert.doesNotMatch(html, /aria-label="Projects"/, 'the Projects region is replaced by the link');
  });

  test("the Backlog link carries Home's applied assignee filter, and drops it when none is applied", () => {
    assert.match(renderHome({ selectedAssignee: 'Charlie' }), /href="\/workspace\/ws\/backlog\?assignee=Charlie"/);
    assert.match(renderHome({ selectedAssignee: 'Other User' }), /href="\/workspace\/ws\/backlog\?assignee=Other%20User"/);
    assert.match(renderHome({ selectedAssignee: 'all' }), /href="\/workspace\/ws\/backlog"/);
    assert.match(renderHome({ selectedAssignee: null }), /href="\/workspace\/ws\/backlog"/);
  });

  test('a seed-only Home\'s hint links "Add your own task" to the backlog page', () => {
    const html = renderHome({ topTaskOnboarding: true });
    assert.match(html, /<a href="\/workspace\/ws\/backlog" data-testid="home-onboarding-backlog-link">Add your own task<\/a>/);
  });

  test('the backlog page draws the project sections, with no Home link and no In Progress region', () => {
    const { projectTrees, inProgressTrees } = worldTrees();
    const view = buildHomeView({ inProgressTrees, trees: projectTrees, states: new Map(), topTaskId: null });
    const html = renderPage(view.trees, view.inProgressTrees, [], 'Org', { urlKey: URL_KEY, workspaces: [WORKSPACE], featureFlags: {}, pageMode: 'backlog' });
    assert.ok(html.includes('data-testid="project"'), 'the project section is drawn');
    assert.doesNotMatch(html, /data-testid="home-backlog-link"/);
    assert.doesNotMatch(html, /in-progress-section/);
  });
});

describe("LIN-4120: Home's rowData is In Progress and Recent only; the backlog's is the project trees", () => {
  test('Home rowData has the In Progress task and no project-only task; the backlog rowData has the project tasks', () => {
    const { projectTrees, inProgressTrees, started, todo, backlog } = worldTrees();
    const view = buildHomeView({ inProgressTrees, trees: projectTrees, states: new Map(), topTaskId: null });

    const home = homeRowDataFor({ pageMode: 'home', urlKey: URL_KEY, homeView: view, recentActivityTrees: [], rowStates: null });
    assert.ok(nodeKey(started.issue) in home, 'the In Progress task has its row record');
    assert.ok(!(nodeKey(todo.issue) in home), 'a project-only Todo task carries no Home row record');
    assert.ok(!(nodeKey(backlog.issue) in home), 'a project-only Backlog task carries no Home row record');

    const backlogData = homeRowDataFor({ pageMode: 'backlog', urlKey: URL_KEY, homeView: view, recentActivityTrees: [], rowStates: null });
    assert.ok(nodeKey(todo.issue) in backlogData, 'the backlog page carries its project tasks');
    // A Backlog task is folded into a count on the view and fetched when its fold opens (/api/home-rows), so it is not in
    // the page's rowData on either page; the rows the page draws are.
    assert.ok(!(nodeKey(backlog.issue) in backlogData), 'a folded Backlog task is fetched by its fold, not carried in rowData');
  });
});

describe('LIN-4120: the backlog rowData covers every row the backlog page draws, and nothing it does not', () => {
  test('each task row on /backlog has its record, and the In Progress-only task is not carried', () => {
    const { projectTrees, inProgressTrees, started } = worldTrees();
    const view = buildHomeView({ inProgressTrees, trees: projectTrees, states: new Map(), topTaskId: null });
    const html = renderPage(view.trees, view.inProgressTrees, [], 'Org', { urlKey: URL_KEY, workspaces: [WORKSPACE], featureFlags: {}, pageMode: 'backlog' });
    const data = homeRowDataFor({ pageMode: 'backlog', urlKey: URL_KEY, homeView: view, recentActivityTrees: [], rowStates: null });

    const byIdentifier = new Map(projectTrees[0].incomplete.map(n => [n.issue.identifier, n.issue]));
    const drawn = [...html.matchAll(/data-identifier="([^"]+)"/g)].map(m => m[1]);
    assert.ok(drawn.length > 0, 'the backlog page draws task rows');
    for (const identifier of drawn) {
      assert.ok(byIdentifier.has(identifier), `${identifier} is a project task`);
      assert.ok(nodeKey(byIdentifier.get(identifier)) in data, `${identifier} has its row record on /backlog`);
    }
    assert.ok(!(nodeKey(started.issue) in data), 'the In Progress task, which /backlog does not draw, carries no record there');
  });
});

describe('LIN-4120 W7: the sign-in refresh re-renders Home with the same rowData as Home', () => {
  test('the refresh draws no project section, and its rowData carries no project-only task', async () => {
    const { projectTrees, inProgressTrees, started, backlog } = worldTrees();
    // A second Up next task that is not the top task: Home's view holds it under its project, so only the rowData
    // helper keeps it off Home. (The first Todo is the top task, which Home promotes into its In Progress region.)
    const upNext = node({ id: 't2', identifier: 'X-T2', title: 'Also waiting', state: { type: 'unstarted', name: 'Todo' } });
    projectTrees[0].incomplete.push(upNext);
    const fetched = {
      trees: projectTrees, inProgressTrees, recentActivityTrees: [], organizationName: 'Org',
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
      renderPage: (...args) => { pageCalls.push(args); return renderPage(...args); },
      writeTaskFacts: undefined,
      readFilledRung: undefined,
    };
    const session = { accountId: 'acct-w7', workspaces: [WORKSPACE], proxyDefault: true, features: {}, copyFirstCardDismissed: true };
    const res = { send: (html) => { sent.push(html); return html; } };
    await renderDashboardAfterRefresh(deps, {
      workspace: WORKSPACE, session, teamId: null,
      assigneeState: { resolvedAssigneeName: null, selectedAssignee: 'all' }, openRouterSource: null, res,
    });

    assert.equal(pageCalls.length, 1, 'the refresh renders its page once');
    const html = sent[0];
    assert.equal((html.match(/data-testid="project"/g) || []).length, 0, 'the refresh re-render has no project section');
    assert.equal((html.match(/data-testid="home-backlog-link"/g) || []).length, 1, 'the refresh re-render has the one Backlog link');

    // The refresh's top task is the Todo task: Home's view promotes it into the In Progress region, so it has a row record
    // on Home. The project-only Backlog task has none. That is the contrast a project-tree rowData would break.
    const rowData = pageCalls[0][4].rowData;
    assert.ok(nodeKey(started.issue) in rowData, 'the In Progress task has its row record after refresh');
    assert.ok(!(nodeKey(upNext.issue) in rowData), 'a project-only Up next task carries no row record after refresh');
    assert.ok(!(nodeKey(backlog.issue) in rowData), 'a project-only Backlog task carries no row record after refresh');
  });
});

describe('LIN-4120: Add task returns to the backlog page', () => {
  test('the back link and Cancel both point at /workspace/:urlKey/backlog', () => {
    const html = renderTaskCreatePage({ urlKey: URL_KEY, fields: ['description'] }, { workspaces: [WORKSPACE], featureFlags: {} });
    assert.match(html, /<a class="task-create-back" href="\/workspace\/ws\/backlog" data-testid="task-create-back">/);
    assert.match(html, /<a class="task-create-cancel" href="\/workspace\/ws\/backlog" data-testid="task-create-cancel">Cancel<\/a>/);
  });
});
