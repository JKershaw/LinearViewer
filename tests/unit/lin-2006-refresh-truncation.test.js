// LIN-2006 plan-review correction 1: the primary dashboard route
// (server.js's GET /workspace/:urlKey/) threads fetchAndPrepareProjects's
// `truncated` flag into renderPage, but renderDashboardAfterRefresh — the
// render tail used after a successful post-401 credential refresh/re-mint
// (Jira OAuth, GitHub re-mint, Linear token refresh) — did not, so a Jira
// OAuth workspace that 401s mid-session and refreshes would silently drop the
// disclosure on that path even though the primary path shows it.
//
// server.js is not import-safe in a unit test (it connects to Mongo and calls
// app.listen() at module load — the same documented constraint behind
// owner-credential-durable-delete-census.test.js and the LIN-1503 behavioural
// test). This pins renderDashboardAfterRefresh's REAL source, sliced by
// docstring markers, executed in a vm context with the I/O boundaries
// (fetchAndPrepareProjects, renderPage, customPromptsStore, getDeployInfo,
// getFeatureFlags) faked — so a regression that drops `truncated` from either
// the destructure or the renderPage call fails this test, not just a read.

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

function sliceRenderDashboardAfterRefresh() {
  const startMarker = 'async function renderDashboardAfterRefresh(workspace, session, teamId, openRouterSource, res) {';
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find renderDashboardAfterRefresh in server.js');
  const endMarker = '\n/**\n * Handles 401 Unauthorized errors from the Linear API.\n */';
  const endIdx = SERVER_SRC.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, 'expected the docstring marker bounding renderDashboardAfterRefresh — if this fails the function was moved and this harness needs re-anchoring');
  return SERVER_SRC.slice(startIdx, endIdx);
}

async function runRenderDashboardAfterRefresh({ fetchResult }) {
  const calls = { renderPageOptions: null };

  const workspace = { id: 'ws-1', urlKey: 'acme' };
  const session = { workspaces: [workspace] };
  const res = {
    body: null,
    send(payload) { this.body = payload; return this; }
  };

  const context = vm.createContext({
    customPromptsStore: { list: async () => [] },
    getDeployInfo: () => ({}),
    fetchAndPrepareProjects: async () => fetchResult,
    renderPage: (trees, inProgressTrees, recentActivityTrees, organizationName, options) => {
      calls.renderPageOptions = options;
      return '<html/>';
    },
    getFeatureFlags: () => ({}),
    console: { log() {}, error() {} }
  });

  const script = [sliceRenderDashboardAfterRefresh(), '', 'renderDashboardAfterRefresh'].join('\n');
  const fn = vm.runInContext(script, context);
  await fn(workspace, session, null, null, res);
  return calls;
}

test('renderDashboardAfterRefresh threads truncated:true into renderPage (LIN-2006 correction 1)', async () => {
  const calls = await runRenderDashboardAfterRefresh({
    fetchResult: {
      trees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'acme',
      teams: [], selectedTeamId: null, showSource: false, truncated: true
    }
  });
  assert.equal(calls.renderPageOptions.truncated, true, 'a truncated Jira read must still disclose after an OAuth-refresh re-render, not only on the primary dashboard route');
});

test('renderDashboardAfterRefresh threads truncated:false into renderPage (LIN-2006 correction 1)', async () => {
  const calls = await runRenderDashboardAfterRefresh({
    fetchResult: {
      trees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'acme',
      teams: [], selectedTeamId: null, showSource: false, truncated: false
    }
  });
  assert.equal(calls.renderPageOptions.truncated, false, 'an untruncated read must not spuriously show the notice on the refresh render tail');
});
