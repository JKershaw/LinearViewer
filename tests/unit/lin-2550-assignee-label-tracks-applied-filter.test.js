/**
 * LIN-2550: the dashboard's assignee selector could display a filter name
 * while rendering the UNFILTERED board.
 *
 * `resolveAssigneeSelection` returns `selectedAssignee: <the literal name>`
 * for any `?assignee=` value without checking it exists in the loaded set, and
 * `fetchAndPrepareProjects` applies the filter only `if (matchedIds.size > 0)`
 * — so an unmatched name degrades to unfiltered (deliberately: John's ruling
 * is show the board, not an empty page) while the navbar kept asserting the
 * filter. Reachable by ordinary clicking, not URL editing: `buildFilterUrl`
 * preserves `?assignee=` across a team change, so picking a team the selected
 * person has no issues in strands a stale name in the URL.
 *
 * The fix threads `appliedAssigneeName` — the filter the render ACTUALLY
 * applied, null when it degraded — out of `fetchAndPrepareProjects`, and both
 * dashboard render paths label the selector off that instead of off the raw
 * request. This is the assignee half of the invariant LIN-2520's R4 tightened
 * for the team filter: the URL must not claim a scope the render didn't apply.
 *
 * server.js is not import-safe in a unit test (it connects to Mongo and calls
 * app.listen() at module load) — the same documented constraint behind
 * tests/unit/lin-2006-refresh-truncation.test.js, whose slicing harness this
 * file reuses deliberately: both dashboard render paths are pinned, because
 * the post-401 refresh tail carries assignee state forward (LIN-2526 F2) and
 * would otherwise re-introduce the lying label on its own.
 *
 * Run with: node --test tests/unit/lin-2550-assignee-label-tracks-applied-filter.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

/**
 * The primary dashboard route handler — `app.get('/workspace/:urlKey/',
 * workspaceFromUrl, async (req, res) => {...})`. Bounded by the section-header
 * comment that follows it, and brace-balance checked, so a reformat fails
 * loudly here rather than as a SyntaxError inside vm.runInContext.
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

  const handler = SERVER_SRC.slice(handlerStart, endIdx + 2);
  assert.equal(
    (handler.match(/{/g) || []).length,
    (handler.match(/}/g) || []).length,
    'the sliced primary dashboard route handler must be brace-balanced — if this fails the route was reformatted and this harness needs re-anchoring'
  );
  return handler;
}

function sliceRenderDashboardAfterRefresh() {
  const startMarker = 'async function renderDashboardAfterRefresh(workspace, session, teamId, assigneeState, openRouterSource, res) {';
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find renderDashboardAfterRefresh in server.js');
  const endMarker = '\n/**\n * Handles 401 Unauthorized errors from the Linear API.\n */';
  const endIdx = SERVER_SRC.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, 'expected the docstring marker bounding renderDashboardAfterRefresh — if this fails the function was moved and this harness needs re-anchoring');
  return SERVER_SRC.slice(startIdx, endIdx);
}

/**
 * `fetchAndPrepareProjects`'s output, with the assignee-applied field under
 * test. Everything else is the shape the render tail destructures.
 */
function fetchResult(appliedAssigneeName) {
  return {
    trees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'acme',
    teams: [], selectedTeamId: null, showSource: false, truncated: false,
    availableAssignees: ['Charlie'], appliedAssigneeName
  };
}

function baseContext(calls, appliedAssigneeName, assigneeState) {
  return {
    UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    getDeployInfo: () => ({}),
    getOpenRouterSource: () => null,
    userPreferencesStore: { setSelectedTeam: async () => {}, getSelectedTeam: async () => null },
    customPromptsStore: { list: async () => [] },
    fetchAndPrepareProjects: async () => fetchResult(appliedAssigneeName),
    renderPage: (trees, inProgressTrees, recentActivityTrees, organizationName, options) => {
      calls.renderPageCallCount++;
      calls.renderPageOptions = options;
      return '<html/>';
    },
    getFeatureFlags: () => ({}),
    isAuthError: () => false,
    handleUnauthorizedError: async () => {},
    renderUpstreamAwareErrorPage: () => '<error/>',
    resolveTeamSelection: async () => ({ teamId: null }),
    resolveAssigneeSelection: async () => assigneeState,
    getProviderForWorkspace: () => ({ supports: () => true }),
    getWorkspaceCallScope: () => ({}),
    console: { log() {}, error() {} }
  };
}

async function runPrimaryDashboardRoute({ appliedAssigneeName, assigneeState }) {
  const calls = { renderPageOptions: null, renderPageCallCount: 0 };
  const workspace = { id: 'ws-1', urlKey: 'acme' };
  const req = {
    workspace,
    query: {},
    session: { accountId: null, workspaces: [workspace] },
    get(header) { return header === 'host' ? 'example.com' : undefined; }
  };
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; }
  };

  const context = vm.createContext(baseContext(calls, appliedAssigneeName, assigneeState));
  const handler = vm.runInContext(`(${slicePrimaryDashboardRouteHandler()})`, context);
  await handler(req, res);
  return calls;
}

async function runRenderDashboardAfterRefresh({ appliedAssigneeName, assigneeState }) {
  const calls = { renderPageOptions: null, renderPageCallCount: 0 };
  const workspace = { id: 'ws-1', urlKey: 'acme' };
  const session = { workspaces: [workspace] };
  const res = { body: null, send(payload) { this.body = payload; return this; } };

  const context = vm.createContext(baseContext(calls, appliedAssigneeName, assigneeState));
  const script = [sliceRenderDashboardAfterRefresh(), '', 'renderDashboardAfterRefresh'].join('\n');
  const fn = vm.runInContext(script, context);
  await fn(workspace, session, null, assigneeState, null, res);
  return calls;
}

const RUNNERS = [
  ['the primary dashboard route (GET /workspace/:urlKey/)', runPrimaryDashboardRoute],
  ['renderDashboardAfterRefresh (the post-401 refresh render tail)', runRenderDashboardAfterRefresh]
];

describe('LIN-2550 — the assignee selector labels the filter the render APPLIED', () => {
  for (const [label, run] of RUNNERS) {
    test(`${label}: an unmatched literal name degrades to unfiltered, so the selector reads "all"`, async () => {
      // The headline repro: ?assignee=Bob carried across a team change by
      // buildFilterUrl into a team Bob has no issues in. The board renders
      // unfiltered (correct, deliberate) — the label must not claim "Bob".
      const calls = await run({
        appliedAssigneeName: null,
        assigneeState: { selectedAssignee: 'Bob', resolvedAssigneeName: 'Bob' }
      });
      assert.equal(calls.renderPageCallCount, 1);
      assert.equal(
        calls.renderPageOptions.selectedAssignee,
        'all',
        'an unapplied assignee filter must not be asserted by the nav label — that is the URL claiming a scope the render did not apply'
      );
    });

    test(`${label}: ?assignee=me for a viewer with nothing assigned also reads "all"`, async () => {
      // Same degrade, reached without any stale URL at all: `me` resolves to a
      // real display name, that name matches no loaded issue, the full board
      // renders. The `me` row must not come back marked .selected.
      const calls = await run({
        appliedAssigneeName: null,
        assigneeState: { selectedAssignee: 'me', resolvedAssigneeName: 'Local User' }
      });
      assert.equal(calls.renderPageOptions.selectedAssignee, 'all');
    });

    test(`${label}: a filter that DID apply keeps its own label`, async () => {
      const calls = await run({
        appliedAssigneeName: 'Charlie',
        assigneeState: { selectedAssignee: 'Charlie', resolvedAssigneeName: 'Charlie' }
      });
      assert.equal(
        calls.renderPageOptions.selectedAssignee,
        'Charlie',
        'the control case — a filter that narrowed the board must still be shown as selected'
      );
    });

    test(`${label}: an applied \`me\` filter still labels \`me\`, not the resolved display name`, async () => {
      const calls = await run({
        appliedAssigneeName: 'Local User',
        assigneeState: { selectedAssignee: 'me', resolvedAssigneeName: 'Local User' }
      });
      assert.equal(calls.renderPageOptions.selectedAssignee, 'me');
    });

    test(`${label}: no filter requested at all is unchanged`, async () => {
      const calls = await run({
        appliedAssigneeName: null,
        assigneeState: { selectedAssignee: 'all', resolvedAssigneeName: null }
      });
      assert.equal(calls.renderPageOptions.selectedAssignee, 'all');
    });
  }
});

describe('LIN-2550 — fetchAndPrepareProjects reports what it applied', () => {
  // A source-level pin rather than a behavioural one: fetchAndPrepareProjects
  // is a ~180-line function over the provider fan-out, and the behaviour that
  // matters (degrade -> null) is proven end-to-end by
  // tests/e2e/assignee-filter.spec.js against real seeded data. What this
  // guards is the wiring the route tests above have to assume: that the field
  // exists, is set INSIDE the matched branch, and is returned.
  const SRC = SERVER_SRC.slice(
    SERVER_SRC.indexOf('async function fetchAndPrepareProjects('),
    SERVER_SRC.indexOf('async function fetchAndPrepareProjects(') + 20000
  );

  test('appliedAssigneeName is declared null and only ever assigned inside the matched branch', () => {
    assert.match(SRC, /let appliedAssigneeName = null;/, 'expected the applied-filter accumulator to default to null (the degraded reading)');
    const assignIdx = SRC.indexOf('appliedAssigneeName = assigneeName;');
    assert.notEqual(assignIdx, -1, 'expected appliedAssigneeName to be set to the applied name');
    const guardIdx = SRC.indexOf('if (matchedIds.size > 0) {');
    assert.notEqual(guardIdx, -1);
    assert.ok(assignIdx > guardIdx, 'appliedAssigneeName must be assigned INSIDE the matched branch — assigning it outside would re-assert an unapplied filter');
  });

  test('appliedAssigneeName is returned to the caller', () => {
    assert.match(SRC, /return \{ trees,[^}]*appliedAssigneeName \};/, 'expected appliedAssigneeName on fetchAndPrepareProjects\'s return — the route cannot correct a label it is never told about');
  });
});
