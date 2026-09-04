/**
 * LIN-2522: the roadmap route's team fetch used to be gated on `teamId`
 * presence (`teamId ? matchTeamId(..., teamId) : null`), so a genuinely
 * unfiltered `/roadmap` load never fetched a team list at all — nothing for a
 * later renderer to thread into the navbar's team selector. This makes the
 * fetch unconditional; `matchTeamId`'s own `if (!rawTeamId) return null`
 * already makes a null/absent teamId a no-op, so the guard bought nothing but
 * the missing list.
 *
 * server.js is not import-safe in a unit test (it connects to Mongo and calls
 * app.listen() at module load) — the same documented constraint behind
 * tests/unit/lin-2006-refresh-truncation.test.js and
 * tests/unit/lin-1503-github-family-401-remint.test.js. This pins the real
 * roadmap route handler's source, sliced by its route-registration marker,
 * executed in a vm context with the I/O boundaries (resolveTeamSelection,
 * provider.fetchTeams/fetchProjects, matchTeamId, renderRoadmapPage, ...)
 * faked — so a regression that re-gates the fetch, or that lets the
 * isTestMode arm start calling the real provider, fails this test.
 *
 * Full browser-visible proof of AC1 ("/roadmap with no ?team= renders the
 * team selector with a populated list") depends on LIN-2523 (thread
 * teams/selectedTeamId into the four page renderers) landing too — this
 * ticket only makes the DATA available; LIN-2523 is what wires it into the
 * navbar. Noted honestly rather than overclaimed, same pattern as LIN-2520's
 * close-out (its client logic was ready and unit-proven before LIN-2523 gave
 * it anything to click).
 *
 * Run with: node --test tests/unit/lin-2522-roadmap-unconditional-teams-fetch.test.js
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
 * The roadmap route handler — `app.get('/workspace/:urlKey/roadmap',
 * workspaceFromUrl, async (req, res) => {...})` — sliced to just the arrow
 * function passed as the route's third argument, bounded by the next route
 * registration (`/audit`), the same brace-balance discipline
 * lin-2006-refresh-truncation.test.js's dashboard-route slicer uses.
 */
function sliceRoadmapRouteHandler() {
  const routePrefix = "app.get('/workspace/:urlKey/roadmap', workspaceFromUrl, ";
  const startMarker = `${routePrefix}async (req, res) => {`;
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, 'expected to find the roadmap route in server.js');
  const handlerStart = startIdx + routePrefix.length;

  const endMarker = "\n});\n\n/**\n * Operator Dashboard page";
  const endIdx = SERVER_SRC.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, 'expected the "Operator Dashboard page" docstring bounding the roadmap route — if this fails the route was moved/reformatted and this harness needs re-anchoring');

  const handler = SERVER_SRC.slice(handlerStart, endIdx + 2);
  assert.equal(
    (handler.match(/{/g) || []).length,
    (handler.match(/}/g) || []).length,
    'the sliced roadmap route handler must be brace-balanced — if this fails the route was reformatted and this harness needs re-anchoring'
  );
  return handler;
}

async function runRoadmapRoute({ isTestMode, teamId, fetchedTeams = [], matchedTeamId = null }) {
  const calls = { fetchTeamsCallCount: 0, matchTeamIdArgs: null, fetchProjectsArgs: null, renderRoadmapPageOptions: null };

  const workspace = { id: 'ws-1', urlKey: 'acme', accessToken: isTestMode ? 'test-token' : 'real-token' };
  const req = { workspace, session: { workspaces: [workspace] } };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, send(p) { this.body = p; return this; }, redirect() {} };

  const provider = {
    fetchTeams: async (scope) => { calls.fetchTeamsCallCount++; return fetchedTeams; },
    fetchProjects: async (...args) => { calls.fetchProjectsArgs = args; return { organizationName: 'acme', projects: [], issues: [] }; }
  };

  const context = vm.createContext({
    process: { env: { NODE_ENV: isTestMode ? 'test' : 'production' } },
    getDeployInfo: () => ({}),
    getOpenRouterSource: () => null,
    getFeatureFlags: () => ({ roadmap: true }),
    resolveTeamSelection: async () => ({ teamId }),
    getProviderForWorkspace: () => provider,
    getWorkspaceCallScope: () => ({}),
    testMockTeams: [{ id: 'mock-team-1', name: 'Mock Team' }],
    testMockData: { organizationName: 'mock-org', projects: [], issues: [] },
    matchTeamId: (teams, rawTeamId) => { calls.matchTeamIdArgs = { teams, rawTeamId }; return matchedTeamId; },
    buildRoadmapModel: () => ({}),
    renderRoadmapPage: (data, options) => { calls.renderRoadmapPageOptions = options; return '<html/>'; },
    AVAILABLE_MODELS: [],
    isAuthError: () => false,
    handleUnauthorizedError: async () => {},
    renderUpstreamAwareErrorPage: () => '<error/>',
    console: { log() {}, error() {} }
  });

  const script = `(${sliceRoadmapRouteHandler()})`;
  const handler = vm.runInContext(script, context);
  await handler(req, res);
  return calls;
}

describe('LIN-2522 — roadmap route fetches the team list unconditionally', () => {
  test('a genuinely unfiltered load (no teamId) still calls provider.fetchTeams — the AC1 regression this ticket fixes', async () => {
    const calls = await runRoadmapRoute({ isTestMode: false, teamId: null, fetchedTeams: [{ id: 't1', name: 'Engineering' }] });
    assert.equal(calls.fetchTeamsCallCount, 1, 'fetchTeams must run even with no teamId — the old `teamId ? ... : null` guard skipped it entirely');
    assert.deepEqual(calls.matchTeamIdArgs, { teams: [{ id: 't1', name: 'Engineering' }], rawTeamId: null },
      'matchTeamId must still receive the fetched list, relying on its own null-teamId no-op rather than a route-level skip');
  });

  test('a filtered load (teamId present) calls provider.fetchTeams exactly once, same as before', async () => {
    const calls = await runRoadmapRoute({ isTestMode: false, teamId: 't1', fetchedTeams: [{ id: 't1', name: 'Engineering' }], matchedTeamId: 't1' });
    assert.equal(calls.fetchTeamsCallCount, 1);
    assert.equal(calls.matchTeamIdArgs.rawTeamId, 't1');
    assert.equal(calls.fetchProjectsArgs[1], 't1', 'the matched team id must reach fetchProjects');
  });

  test('AC2 — isTestMode arm is unchanged: no real provider call for teams OR projects, even unfiltered (the LIN-1034 regression guard)', async () => {
    const calls = await runRoadmapRoute({ isTestMode: true, teamId: null });
    assert.equal(calls.fetchTeamsCallCount, 0, 'isTestMode must use testMockTeams synchronously, never provider.fetchTeams');
    assert.equal(calls.fetchProjectsArgs, null, 'isTestMode must use testMockData, never provider.fetchProjects');
    assert.deepEqual(calls.matchTeamIdArgs.teams, [{ id: 'mock-team-1', name: 'Mock Team' }],
      'matchTeamId must receive testMockTeams in isTestMode, not a real fetch result');
  });

  test('AC2 — isTestMode arm is unchanged when filtered, too', async () => {
    const calls = await runRoadmapRoute({ isTestMode: true, teamId: 'mock-team-1', matchedTeamId: 'mock-team-1' });
    assert.equal(calls.fetchTeamsCallCount, 0);
    assert.equal(calls.fetchProjectsArgs, null);
  });
});
