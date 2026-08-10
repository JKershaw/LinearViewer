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
//
// Close-out follow-up (implementation review's "What CI Did Not Prove" ledger,
// row 1): the primary route's OWN threading (server.js's `GET
// /workspace/:urlKey/`, the route this whole disclosure was built for) was
// never pinned — only read manually, once, at one SHA. Deleting `truncated`
// from its destructure or its `renderPage` options object left all 6581 unit
// tests and all 4 e2e shards green. The tests below close that gap the same
// way the refresh-path ones above do: slice the route handler's REAL source
// (an anonymous `app.get(..., async (req, res) => {...})` handler — no
// docstring end marker like the named functions above, so it is bounded by
// the "Workspace-Prefixed Dashboard Routes" section comment that follows it
// instead) and execute it in a vm context with only the I/O boundaries faked.

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

/**
 * The primary dashboard route handler — `app.get('/workspace/:urlKey/',
 * workspaceFromUrl, async (req, res) => {...})` — sliced to just the arrow
 * function passed as the route's third argument. There is no docstring end
 * marker (it isn't a documented top-level function), so this is bounded by
 * the section-header comment that immediately follows it in server.js
 * ("Workspace-Prefixed Dashboard Routes"), and the slice is checked for brace
 * balance so a future reformat fails loudly here rather than producing a
 * SyntaxError deep in vm.runInContext.
 */
function slicePrimaryDashboardRouteHandler() {
  const routePrefix = "app.get('/workspace/:urlKey/', workspaceFromUrl, ";
  const startMarker = `${routePrefix}async (req, res) => {`;
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find the primary dashboard route (GET /workspace/:urlKey/) in server.js');
  const handlerStart = startIdx + routePrefix.length;

  const endMarker = '\n})\n\n// =============================================================================\n// Workspace-Prefixed Dashboard Routes';
  const endIdx = SERVER_SRC.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, 'expected the "Workspace-Prefixed Dashboard Routes" comment block bounding the primary dashboard route — if this fails the route was moved/reformatted and this harness needs re-anchoring');

  // endMarker starts with the newline that ends the handler's last body line,
  // followed by "})" — the "}" closes the arrow function (opened by
  // startMarker), the ")" closes the app.get(...) call. Slice through the "}"
  // but stop short of the ")", so the result is a complete, standalone arrow
  // function expression.
  const handler = SERVER_SRC.slice(handlerStart, endIdx + 2);
  assert.equal(
    (handler.match(/{/g) || []).length,
    (handler.match(/}/g) || []).length,
    'the sliced primary dashboard route handler must be brace-balanced — if this fails the route was reformatted and this harness needs re-anchoring'
  );
  return handler;
}

async function runPrimaryDashboardRoute({ fetchResult }) {
  const calls = { renderPageOptions: null, renderPageCallCount: 0 };

  const workspace = { id: 'ws-1', urlKey: 'acme' };
  const req = {
    workspace,
    query: {},
    session: { accountId: null, workspaces: [workspace] },
    get(header) { return header === 'host' ? 'example.com' : undefined; }
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; }
  };

  const context = vm.createContext({
    UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    getDeployInfo: () => ({}),
    getOpenRouterSource: () => null,
    userPreferencesStore: { setSelectedTeam: async () => {}, getSelectedTeam: async () => null },
    customPromptsStore: { list: async () => [] },
    fetchAndPrepareProjects: async () => fetchResult,
    renderPage: (trees, inProgressTrees, recentActivityTrees, organizationName, options) => {
      calls.renderPageCallCount++;
      calls.renderPageOptions = options;
      return '<html/>';
    },
    getFeatureFlags: () => ({}),
    isAuthError: () => false,
    handleUnauthorizedError: async () => {},
    renderUpstreamAwareErrorPage: () => '<error/>',
    console: { log() {}, error() {} }
  });

  const script = `(${slicePrimaryDashboardRouteHandler()})`;
  const handler = vm.runInContext(script, context);
  await handler(req, res);
  return calls;
}

test('the primary dashboard route (GET /workspace/:urlKey/) threads truncated:true into renderPage (LIN-2006 close-out ledger row 1)', async () => {
  const calls = await runPrimaryDashboardRoute({
    fetchResult: {
      trees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'acme',
      teams: [], selectedTeamId: null, showSource: false, truncated: true
    }
  });
  assert.equal(calls.renderPageCallCount, 1);
  assert.equal(calls.renderPageOptions.truncated, true, 'a truncated Jira read must disclose on the primary dashboard route — deleting `truncated` from its destructure or renderPage options must fail this assertion');
});

test('the primary dashboard route (GET /workspace/:urlKey/) threads truncated:false into renderPage (LIN-2006 close-out ledger row 1)', async () => {
  const calls = await runPrimaryDashboardRoute({
    fetchResult: {
      trees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'acme',
      teams: [], selectedTeamId: null, showSource: false, truncated: false
    }
  });
  assert.equal(calls.renderPageCallCount, 1);
  assert.equal(calls.renderPageOptions.truncated, false, 'an untruncated read must not spuriously show the notice on the primary dashboard route');
});
