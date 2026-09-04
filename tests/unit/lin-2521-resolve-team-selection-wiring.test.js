/**
 * LIN-2521: resolveTeamSelection(req, workspace) lifts team persist/restore
 * out of the dashboard route alone into a shared helper, called from all five
 * team-filterable routes AND threaded (never re-read) through the post-401
 * refresh/retry chain (handleUnauthorizedError -> handleTokenRefreshAndRetry
 * -> renderDashboardAfterRefresh).
 *
 * server.js is not import-safe in a unit test (it connects to Mongo and calls
 * app.listen() at module load) — the same constraint documented in
 * tests/unit/lin-1503-github-family-401-remint.test.js and
 * tests/unit/workspace-token-refresh.test.js's Block E. This is a source-text
 * pin, not a behavioral test, following that established precedent: it proves
 * the WIRING (resolveTeamSelection is the sole `req.query.team` read site;
 * every route feeds it its own resolved teamId; the retry chain threads that
 * same value through to the re-render) that AC4's "401-refresh path on
 * /swim?team=X re-renders with selectedTeamId/teams preserved" depends on.
 * The actual cross-route PERSISTENCE behavior (AC1/AC3) is proven
 * behaviorally over real HTTP in tests/e2e/error-handling.spec.js's "Team
 * persistence across all five routes (LIN-2521)" describe block — that suite
 * is mutation-checked (fails against the pre-fix server.js, passes against
 * the fix). The genuine 401-triggering behavioral scenario is not currently
 * reachable in e2e without new test-only credential-expiry infrastructure,
 * which is out of this ticket's scope — flagged here rather than silently
 * assumed covered.
 *
 * Run with: node --test tests/unit/lin-2521-resolve-team-selection-wiring.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
// Comments legitimately name the very things a "must appear exactly once"
// check counts (e.g. resolveTeamSelection's own JSDoc explains it is the sole
// req.query.team read site) — strip comments before counting CODE occurrences,
// mirroring tests/unit/lin-2370-browser-copy-prompt-provider-identity.test.js.
const SERVER_CODE_ONLY = SERVER_SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

function sliceFunction(name, signatureLine) {
  const startIdx = SERVER_SRC.indexOf(signatureLine);
  assert.notEqual(startIdx, -1, `expected to find ${name} in server.js`);
  // Every function this file slices is followed by a blank line then the next
  // top-level `/**` doc comment or `app.` route registration — find whichever
  // comes first after the start.
  const afterStart = startIdx + signatureLine.length;
  const nextDoc = SERVER_SRC.indexOf('\n/**', afterStart);
  const nextApp = SERVER_SRC.indexOf('\napp.', afterStart);
  const candidates = [nextDoc, nextApp].filter(i => i !== -1);
  assert.ok(candidates.length > 0, `expected to find the end of ${name}`);
  const endIdx = Math.min(...candidates);
  return SERVER_SRC.slice(startIdx, endIdx);
}

describe('LIN-2521 — resolveTeamSelection is the sole req.query.team read site', () => {
  test('req.query.team is read exactly once in the whole file, inside resolveTeamSelection', () => {
    const matches = [...SERVER_CODE_ONLY.matchAll(/req\.query\.team\b/g)];
    assert.equal(matches.length, 1, `expected exactly one req.query.team read, found ${matches.length}`);

    const resolveIdx = SERVER_CODE_ONLY.indexOf('async function resolveTeamSelection(req, workspace) {');
    assert.notEqual(resolveIdx, -1, 'expected resolveTeamSelection to be defined');
    const resolveEndIdx = SERVER_CODE_ONLY.indexOf('\n}', resolveIdx);
    assert.ok(matches[0].index > resolveIdx && matches[0].index < resolveEndIdx,
      'the sole req.query.team read must be inside resolveTeamSelection');
  });

  test('isPersistableTeamRef is referenced exactly once in server.js — the cap is carried, not duplicated per route', () => {
    const matches = [...SERVER_CODE_ONLY.matchAll(/\bisPersistableTeamRef\(/g)];
    assert.equal(matches.length, 1, `expected exactly one isPersistableTeamRef( call, found ${matches.length} — a route parsing raw ?team= itself would bypass the shared cap`);
  });

  test('resolveTeamSelection is called from exactly the five team-filterable routes', () => {
    const callSites = [...SERVER_SRC.matchAll(/const \{ teamId \} = await resolveTeamSelection\(req, workspace\);/g)];
    assert.equal(callSites.length, 5, `expected 5 call sites (dashboard, swipe, swim, ship, roadmap), found ${callSites.length}`);

    const routeMarkers = [
      "app.get('/workspace/:urlKey/', workspaceFromUrl, async (req, res) => {",
      "app.get('/workspace/:urlKey/swipe/:identifier?', workspaceFromUrl, async (req, res) => {",
      "app.get('/workspace/:urlKey/swim', workspaceFromUrl, async (req, res) => {",
      "app.get('/workspace/:urlKey/ship', workspaceFromUrl, async (req, res) => {",
      "app.get('/workspace/:urlKey/roadmap', workspaceFromUrl, async (req, res) => {",
    ];
    for (const marker of routeMarkers) {
      const routeIdx = SERVER_SRC.indexOf(marker);
      assert.notEqual(routeIdx, -1, `expected to find route registration: ${marker}`);
      const nextRouteIdx = SERVER_SRC.indexOf('\napp.get(', routeIdx + marker.length);
      const body = SERVER_SRC.slice(routeIdx, nextRouteIdx === -1 ? routeIdx + 4000 : nextRouteIdx);
      assert.match(body, /const \{ teamId \} = await resolveTeamSelection\(req, workspace\);/,
        `expected ${marker} to call resolveTeamSelection`);
    }
  });

  test('each of the five routes forwards its OWN resolved teamId into handleUnauthorizedError (never a shared/global one)', () => {
    const calls = [...SERVER_SRC.matchAll(/return handleUnauthorizedError\(workspace, req\.session, teamId, openRouterSource, res\);/g)];
    assert.equal(calls.length, 5, `expected 5 handleUnauthorizedError call sites carrying the route-local teamId, found ${calls.length}`);
  });
});

describe('LIN-2521 — the refresh-retry chain threads teamId through, never re-reads req.query.team', () => {
  test('handleTokenRefreshAndRetry accepts teamId and forwards it unchanged to renderDashboardAfterRefresh', () => {
    const body = sliceFunction('handleTokenRefreshAndRetry',
      'async function handleTokenRefreshAndRetry(workspace, session, teamId, openRouterSource, res, { provider, exchange } = {}) {');
    assert.doesNotMatch(body, /req\.query/, 'must never read req.query directly — it has no req in scope');
    assert.match(body, /return renderDashboardAfterRefresh\(workspace, session, teamId, openRouterSource, res\);/,
      'must forward the SAME teamId parameter it received, not re-derive one');
  });

  test('renderDashboardAfterRefresh threads teamId into fetchAndPrepareProjects and the resulting selectedTeamId/teams into renderPage', () => {
    const body = sliceFunction('renderDashboardAfterRefresh',
      'async function renderDashboardAfterRefresh(workspace, session, teamId, openRouterSource, res) {');
    assert.doesNotMatch(body, /req\.query/, 'must never read req.query directly — it has no req in scope');
    assert.match(body, /fetchAndPrepareProjects\(workspace, teamId, null, workspace\.urlKey, \{ slim: true \}\)/,
      'must pass the received teamId into fetchAndPrepareProjects');
    // The destructure that captures selectedTeamId/teams off that same call.
    assert.match(body, /const \{ trees, inProgressTrees, recentActivityTrees, organizationName, teams, selectedTeamId, showSource, truncated \} = await fetchAndPrepareProjects/);
    assert.match(body, /teams,\s*\n\s*selectedTeamId,/, 'renderPage must receive teams/selectedTeamId from the SAME resolved fetch, proving the 401-refresh re-render preserves them');
  });

  test('handleUnauthorizedError accepts teamId and forwards it unchanged to both renderDashboardAfterRefresh and handleTokenRefreshAndRetry, never re-reading req.query', () => {
    const body = sliceFunction('handleUnauthorizedError',
      'async function handleUnauthorizedError(workspace, session, teamId, openRouterSource, res) {');
    assert.doesNotMatch(body, /req\.query/, 'must never read req.query directly — it has no req in scope');
    assert.match(body, /return await renderDashboardAfterRefresh\(workspace, session, teamId, openRouterSource, res\);/);
    assert.match(body, /return await handleTokenRefreshAndRetry\(workspace, session, teamId, openRouterSource, res, \{ provider, exchange \}\);/);
  });
});

test('LIN-2521 AC2 — isPersistableTeamRef import is unchanged (still from lib/workspace.js, not re-implemented)', () => {
  assert.match(SERVER_SRC, /import \{[^}]*\bisPersistableTeamRef\b[^}]*\} from '\.\/lib\/workspace\.js'/s);
});
