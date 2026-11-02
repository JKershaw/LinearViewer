/**
 * LIN-4118 (S3a-1) W6: the Home view is built in one place.
 *
 * (a) lives in lin-4118-build-home-view-callers.test.js (a source scan, with no imports from lib/).
 * (b) Behaviour: the sign-in refresh renders through the shared pipeline, with its dependencies injected. A spy on the
 *     pipeline's entry point proves the refresh invokes it; the fetch options, the held-facts write and the rendered
 *     page are asserted against the refresh's own contract (degradeSecondary, LIN-2526 assignee state, LIN-4068 write).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderDashboardAfterRefresh } from '../../lib/dashboard-refresh.js';
import { gatherHomePage } from '../../lib/home-pipeline.js';
import { renderPage } from '../../lib/render.js';
import { orderIssuesForSwipe } from '../../lib/task-board-view.js';
import { partitionCompleted } from '../../lib/tree.js';

const node = (identifier, type, children = [], extra = {}) => ({
  issue: { id: identifier, identifier, title: `Title ${identifier}`, description: '', state: { name: type, type }, url: `/x/${identifier}`, labels: { nodes: [] }, ...extra },
  children,
  depth: 0,
});
const project = (id, name, incomplete, completed = []) => {
  const part = partitionCompleted([...incomplete, ...completed]);
  return { project: { id, name, collapsed: false }, incomplete: part.incomplete, completed: part.completed, completedCount: part.completedCount };
};

function fixture() {
  const parent = node('RF-1', 'started', [node('RF-2', 'started'), node('RF-3', 'unstarted'), node('RF-4', 'unstarted'), node('RF-5', 'backlog')]);
  const trees = [
    project('rp-1', 'Refresh project', [parent, node('RF-6', 'unstarted'), node('RF-7', 'backlog'), node('RF-8', 'unstarted', [node('RF-9', 'unstarted')])], [node('RF-10', 'completed')]),
    project('rp-2', 'Second project', [node('RF-20', 'unstarted'), node('RF-21', 'backlog')]),
  ];
  return {
    trees,
    inProgressTrees: [{ projectId: 'rp-1', projectName: 'Refresh project', roots: [parent] }],
    recentActivityTrees: [],
    organizationName: 'Refresh Org',
    teams: [], selectedTeamId: null, showSource: 'local', truncated: false, availableAssignees: [],
    appliedAssigneeName: 'Local User', degradedSources: [],
    stateIssues: [],
  };
}

describe('W6 (b): the sign-in refresh renders through the shared pipeline, with its dependencies injected', () => {
  test('the pipeline is invoked once, with the refresh contract; the write and the page follow from it', async () => {
    const fx = fixture();
    const homeStatesRoots = ['index-marker'];
    const fetchCalls = [];
    const writes = [];
    const pipelineCalls = [];
    const sent = [];
    const pageCalls = [];
    const deps = {
      customPromptsStore: { list: async () => [] },
      getDeployInfo: () => ({ version: 'w6' }),
      getFeatureFlags: () => ({}),
      getProviderForWorkspace: () => ({ supports: () => false }),
      fetchAndPrepareProjects: async (...args) => { fetchCalls.push(args); return fx; },
      resolveRunControls: async () => ({ runControls: false }),
      homeRowStates: async () => ({ states: new Map(), roots: homeStatesRoots, rulingCount: 0 }),
      orderIssuesForSwipe,
      // Records the call the refresh makes, so the view it built can be rendered in the page mode that holds sections.
      renderPage: (...args) => { pageCalls.push(args); return renderPage(...args); },
      writeTaskFacts: (urlKey, fetched, opts) => { writes.push({ urlKey, fetched, opts }); },
      readFilledRung: async () => null,
      taskModeStore: null,
      accountStore: null,
      // The spy wraps the real entry point: the refresh must call it, not build the view itself.
      gatherHomePage: (d, o) => { pipelineCalls.push(o); return gatherHomePage(d, o); },
    };
    const assigneeState = { resolvedAssigneeName: 'Local User', selectedAssignee: 'Local User' };
    const workspace = { urlKey: 'w6-refresh', name: 'W6', provider: 'local' };
    const session = { accountId: 'acct-w6', workspaces: [], proxyDefault: true, features: {}, copyFirstCardDismissed: true };
    const res = { send: (html) => { sent.push(html); return html; } };

    await renderDashboardAfterRefresh(deps, { workspace, session, teamId: null, assigneeState, openRouterSource: null, res });

    // The refresh goes through the pipeline's entry point exactly once.
    assert.equal(pipelineCalls.length, 1, 'renderDashboardAfterRefresh must render through gatherHomePage, once');
    const opts = pipelineCalls[0];
    assert.equal(opts.degradeSecondary, true, 'the refresh fetches with degradeSecondary: true');
    assert.equal(opts.accountId, 'acct-w6');
    assert.equal(opts.assigneeName, 'Local User', 'LIN-2526: the refresh carries the assignee state into the fetch');
    assert.equal(typeof opts.resolveFlags, 'function', 'flags are resolved without a request');

    // The fetch query shape is the refresh's own, unchanged: slim, assignee, account, degradeSecondary, urlKey.
    assert.equal(fetchCalls.length, 1);
    const [ws, teamId, nothing, urlKey, fetchOpts] = fetchCalls[0];
    assert.equal(ws, workspace);
    assert.equal(teamId, null);
    assert.equal(nothing, null);
    assert.equal(urlKey, 'w6-refresh');
    assert.deepEqual(fetchOpts, { slim: true, assigneeName: 'Local User', accountId: 'acct-w6', degradeSecondary: true });

    // LIN-4068: the held-facts write runs once, after the gather, with the index the gather built.
    assert.equal(writes.length, 1);
    assert.equal(writes[0].urlKey, 'w6-refresh');
    assert.equal(writes[0].fetched, fx);
    assert.deepEqual(writes[0].opts, { index: homeStatesRoots });

    // The page is rendered once, through the view the pipeline built: the In Progress parent and the top task show.
    assert.equal(sent.length, 1, 'the refresh sends exactly one response');
    assert.match(sent[0], /data-identifier="RF-1"/, 'the In Progress parent renders');
    // LIN-4119: the refresh's own page (Home) draws no project sections from S3a-3 on; they are the backlog page's. The
    // view the refresh built is rendered in that page mode here, so the claim (the sections come from the view) holds.
    assert.equal(pageCalls.length, 1, 'the refresh renders its page once');
    const [trees, inProgressTrees, recentTrees, orgName, options] = pageCalls[0];
    const backlog = renderPage(trees, inProgressTrees, recentTrees, orgName, { ...options, pageMode: 'backlog' });
    assert.match(backlog, /data-project-name="Second project"/, 'the project sections render from the view, on the backlog page');
  });
});
