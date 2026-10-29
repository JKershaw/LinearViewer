/**
 * LIN-3774: handleUnauthorizedError's secondary-binding arm.
 *
 * A 401 that fetchAndPrepareProjects tagged (`error.binding`) as coming from a
 * SECONDARY connection-backed GitHub-family binding re-mints THAT binding only,
 * then re-renders the dashboard with `degradeSecondary` — it does not rotate the
 * Linear refresh token (the active-binding ladder) and does not 503.
 *
 * All five routes (dashboard, swipe, swim, ship, roadmap) reach this handler with
 * the same arguments and the handler's retry always renders the dashboard
 * (LIN-2526), so swim/ship/swipe/roadmap show the dashboard with the notice on a
 * secondary 401, where they used to get the 503 page.
 *
 * server.js is not import-safe: the real source of renderDashboardAfterRefresh and
 * handleUnauthorizedError is sliced into a vm context (as lin-1503-*-behaviour).
 * The freshness seam is the REAL module over a counting re-mint; the Linear
 * exchange is a counting stub.
 *
 * Run: node --test tests/unit/lin-3774-handle-unauthorized-secondary-binding.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createSecondaryBindingRemint } from '../../lib/connection-secondary-remint.js';
import { rehydrateBindingAfterRefresh } from '../../lib/connection-credential.js';
import { setBindingCredential, activeConnectionBackedBinding } from '../../lib/connection-binding.js';
import { REFRESH_STRATEGY, refreshDeclarationFor, relinkNotice } from '../../lib/refresh-strategy.js';
import { normalizeProvider } from '../../lib/workspace.js';
import { renderPage } from '../../lib/render.js';
import { orderIssuesForSwipe } from '../../lib/render-swipe.js';
import { nodeKey } from '../../lib/tree.js';
import { renderSourceErrorPage } from '../../lib/render-pages.js';
import { errorReference, isAuthError } from '../../lib/errors.js';
import { liveConsoleOn } from '../../lib/run-controls.js';
import { buildHomeView } from '../../lib/home-view.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const NOW = 1_800_000_000_000;

function slice(startMarker, endMarker) {
  const startIdx = SERVER_SRC.indexOf(startMarker);
  assert.notEqual(startIdx, -1, `expected ${startMarker.slice(0, 50)} in server.js`);
  const endIdx = SERVER_SRC.indexOf(endMarker, startIdx);
  assert.notEqual(endIdx, -1, `expected end marker ${endMarker.slice(0, 40)}`);
  return SERVER_SRC.slice(startIdx, endIdx);
}
const RENDER_SRC = slice('async function renderDashboardAfterRefresh(', '\n/**\n * Handles 401 Unauthorized');
const HANDLER_SRC = slice('async function handleUnauthorizedError(', '\n/**\n * Home page');

const authError = (binding) => Object.assign(new Error('Bad credentials'), { status: 401, ...(binding ? { binding } : {}) });
const GH_TAG = { provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: 'a::github::1' };

function makeWorkspace({ ghHydrated = true, ghProvider = 'github', ghConnectionId = 'a::github::1' } = {}) {
  const linear = { provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' };
  const github = { provider: ghProvider, scope: 'JKershaw/LinearViewer', connectionId: ghConnectionId };
  setBindingCredential(linear, { token: 'lin-token', tokenExpiresAt: NOW + 3_600_000 });
  if (ghHydrated) setBindingCredential(github, { token: 'stale-gh', tokenExpiresAt: NOW - 1000 });
  return { id: 'org-1', urlKey: 'lv', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org-1' }, bindings: [linear, github] };
}

/**
 * LIN-3790: a LEGACY (no connectionId) workspace. `primary` is the active provider
 * (undefined `provider` = a pre-`provider` workspace, normalised to linear); the
 * secondary is any non-connection-backed binding of another kind.
 */
function makeLegacyWorkspace({ primary = 'linear', secondary = { provider: 'github', scope: 'JKershaw/LinearViewer' } } = {}) {
  const active = { provider: 'linear', scope: 'org-1', credentials: { token: 'lin-token' } };
  const sec = { ...secondary, credentials: { token: 'stale-sec' } };
  const ws = { id: 'org-1', urlKey: 'lv', accessToken: 'lin-token', activeBinding: { provider: 'linear', scope: 'org-1' }, bindings: [active, sec] };
  if (primary) ws.provider = primary;
  return ws;
}

/**
 * @param {Object} o
 * @param {Object} [o.fetchResult] - what the (faked) fetchAndPrepareProjects resolves for the retry render
 * @param {boolean} [o.remintFails]
 */
function harness({ degraded = [], remintFails = false, fetchThrows = null, fetchThrowsSeq = null } = {}) {
  const calls = { errorLogs: [], githubRemint: [], linearRefresh: [], linearExchange: 0, fetch: [], removal: 0, saveSession: 0, durableRead: 0 };
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
  };
  const secondaryRemint = createSecondaryBindingRemint({
    refreshConnectionForWorkspace: async (connection, accountId, urlKey) => {
      calls.githubRemint.push({ connection, accountId, urlKey });
      if (remintFails) throw new Error('JWT rejected');
      return { token: 'fresh-gh', expiresAt: NOW + 3_600_000 };
    },
    applyRefreshed: rehydrateBindingAfterRefresh,
    now: () => NOW,
    logger: { error: () => {} },
  });
  const context = vm.createContext({
    process, console: { ...console, error: (...a) => { calls.errorLogs.push(a); }, log: () => {} },
    REFRESH_STRATEGY, refreshDeclarationFor, normalizeProvider,
    renderPage, orderIssuesForSwipe, nodeKey, renderSourceErrorPage, errorReference, isAuthError, relinkNotice,
    secondaryRemint,
    activeConnectionIdForWorkspace: (ws) => activeConnectionBackedBinding(ws)?.connectionId ?? null,
    customPromptsStore: { list: async () => [] },
    getDeployInfo: () => ({}),
    getProviderForWorkspace: () => ({ supports: () => false }),
    getFeatureFlags: () => ({}),
    // LIN-3833: the Home row states; these sandboxes render no In Progress rows.
    homeRowStates: async () => null,
    // LIN-4024: the trimmed Home view the post-401 render builds (server.js); the real one is injected.
    buildHomeView,
    // LIN-3833: the subtasks that need you by row; these sandboxes render no In Progress rows.
    subtaskNeedingYouByNodeKey: () => ({}),
    focusSubtaskByNodeKey: () => ({}),
    requestFeatureFlags: async () => ({}),
    resolveRunControls: async () => ({ runControls: false, runSetup: false }),
    // LIN-3977: the post-401 Home render applies the promotion rule (server.js), so the real one is injected.
    liveConsoleOn,
    fetchAndPrepareProjects: async (...args) => {
      calls.fetch.push(args);
      if (fetchThrows) throw fetchThrows;
      // LIN-3790: errors for the 1st, 2nd... render; later renders succeed.
      if (fetchThrowsSeq && calls.fetch.length <= fetchThrowsSeq.length && fetchThrowsSeq[calls.fetch.length - 1]) throw fetchThrowsSeq[calls.fetch.length - 1];
      return { trees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'Acme', teams: [], selectedTeamId: null, showSource: true, truncated: false, availableAssignees: [], appliedAssigneeName: null, degradedSources: degraded };
    },
    // The active-binding ladder, spied: a connection-backed Linear workspace refreshes via its Connection.
    connectionAccess: {
      refreshConnectionForWorkspace: async (connection) => {
        calls.linearRefresh.push(connection);
        calls.linearExchange++;
        return { token: 'new-lin', expiresAt: NOW + 3_600_000 };
      },
    },
    rehydrateAfterRefresh: () => true,
    refreshExchangeFor: () => async () => ({}),
    ownerCredentialStore: { get: async () => { calls.durableRead++; return null; }, delete: async () => {} },
    saveSession: async () => { calls.saveSession++; },
    handleWorkspaceRemoval: async () => { calls.removal++; return 'removed'; },
    sendRelinkNotice: () => 'relink',
    isDefinitiveRevocation: () => false,
    releaseConnectionCredential: async () => {},
    evictReferentFor: () => () => {},
    connectionStore: {},
    evictAllWorkspaceTokens: () => {},
    evictWorkspaceToken: () => {},
  });
  vm.runInContext(`${RENDER_SRC}\n${HANDLER_SRC}`, context);
  return { calls, res, run: (workspace, error, routeShape = {}) => vm.runInContext('handleUnauthorizedError', context)(
    workspace,
    { accountId: 'a', workspaces: [workspace] },
    routeShape.teamId ?? null,
    routeShape.assigneeState ?? { selectedAssignee: 'all', resolvedAssigneeName: null },
    null, res, error,
  ) };
}

describe('LIN-3774 handleUnauthorizedError — tagged secondary 401', () => {
  test('re-mints that connection only, spends no Linear refresh, and renders the dashboard flagged degradeSecondary', async () => {
    const { calls, res, run } = harness();
    await run(makeWorkspace(), authError(GH_TAG));
    assert.equal(calls.githubRemint.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.githubRemint[0].connection)), { _id: 'a::github::1', provider: 'github' });
    assert.equal(calls.linearExchange, 0, 'a GitHub 401 must not spend a Linear refresh');
    assert.equal(calls.linearRefresh.length, 0);
    assert.equal(calls.durableRead, 0);
    assert.equal(calls.removal, 0);
    assert.equal(calls.saveSession, 0);
    assert.equal(calls.fetch.length, 1, 'one retry render');
    assert.equal(calls.fetch[0][4].degradeSecondary, true);
    assert.equal(calls.fetch[0][4].accountId, 'a');
    assert.equal(res.statusCode, 200);
  });

  test('a secondary that still fails renders the DASHBOARD with the source notice, not the 503 — for every route caller shape', async () => {
    // dashboard / swipe / swim / ship / roadmap all call the handler with these same arguments;
    // the retry is always the dashboard (LIN-2526). Each route's team/assignee state flows through.
    const shapes = [
      { route: 'dashboard', teamId: null },
      { route: 'swipe', teamId: 't-swipe' },
      { route: 'swim', teamId: 't-swim' },
      { route: 'ship', teamId: 't-ship' },
      { route: 'roadmap', teamId: 't-roadmap' },
    ];
    for (const shape of shapes) {
      const { calls, res, run } = harness({ degraded: [{ provider: 'github', scope: 'JKershaw/LinearViewer' }] });
      await run(makeWorkspace(), authError(GH_TAG), shape);
      assert.equal(res.statusCode, 200, shape.route);
      assert.match(res.body, /data-testid="dashboard-source-notice"/, shape.route);
      assert.match(res.body, /JKershaw\/LinearViewer/, shape.route);
      assert.equal(calls.fetch[0][1], shape.teamId, `${shape.route}: the route's own team reaches the retry`);
    }
  });

  test('a failed re-mint still retries once (degrading), and does not remove the workspace', async () => {
    const { calls, res, run } = harness({ remintFails: true, degraded: [{ provider: 'github', scope: 'JKershaw/LinearViewer' }] });
    await run(makeWorkspace(), authError(GH_TAG));
    assert.equal(calls.githubRemint.length, 1);
    assert.equal(calls.fetch.length, 1);
    assert.equal(calls.removal, 0);
    assert.match(res.body, /dashboard-source-notice/);
  });

  test('a render failure after the re-mint is the existing retryable 503, and the workspace is preserved', async () => {
    const { calls, res, run } = harness({ fetchThrows: new Error('GitHub 502') });
    await run(makeWorkspace(), authError(GH_TAG));
    assert.equal(res.statusCode, 503);
    assert.equal(calls.removal, 0);
    // The arm ends here: it never falls through to the active-binding ladder after its own 503.
    assert.equal(calls.linearRefresh.length, 0);
    assert.equal(calls.durableRead, 0);
  });

  // LIN-3775 exit 1991: the 503 names the failing source, the status, and carries the
  // same reference as the log line. A 502 from the secondary GitHub source never offers reconnect.
  test('LIN-3775: the render-failure 503 names the source and status, with the log line\'s reference', async () => {
    const fetchThrows = Object.assign(new Error('GitHub 502 upstream body'), { status: 502, binding: GH_TAG });
    const { calls, res, run } = harness({ fetchThrows });
    await run(makeWorkspace(), authError(GH_TAG));
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub Issues \(JKershaw\/LinearViewer\)/);
    assert.match(res.body, /HTTP 502/);
    assert.doesNotMatch(res.body, /[Rr]econnect|Go to settings|try again later/);
    const log = calls.errorLogs.find((a) => String(a[0]).startsWith('Post-secondary-remint dashboard render failed'));
    const ref = String(log.at(-1)).match(/^\[ref ([0-9a-f]{8})\]$/)?.[1];
    assert.ok(ref, 'the last console.error argument is [ref <8 hex>]');
    assert.ok(res.body.includes(ref), 'the same reference is on the page');
  });

  test('LIN-3775: a secondary GitHub 401 that survives the re-mint offers settings, not the active relink', async () => {
    const fetchThrows = Object.assign(new Error('Bad credentials'), { status: 401, binding: GH_TAG });
    const { res, run } = harness({ fetchThrows });
    await run(makeWorkspace(), authError(GH_TAG));
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /href="\/workspace\/lv\/settings\/sources"/);
    assert.match(res.body, /Go to settings/);
  });
});

describe('LIN-3774 handleUnauthorizedError — active-binding 401 reaches the degraded retry', () => {
  test('an untagged 401 refreshes Linear, does not re-mint the secondary, and renders the degraded dashboard rather than the 503', async () => {
    // Plan-review N1: on this path the secondary is not re-minted reactively before it degrades.
    const { calls, res, run } = harness({ degraded: [{ provider: 'github', scope: 'JKershaw/LinearViewer' }] });
    await run(makeWorkspace(), authError());
    assert.equal(calls.linearRefresh.length, 1);
    assert.equal(calls.githubRemint.length, 0);
    assert.equal(calls.fetch[0][4].degradeSecondary, true);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /dashboard-source-notice/);
  });
});

describe('LIN-3774 handleUnauthorizedError — everything else keeps today\'s ladder', () => {
  async function ladder(error, workspace = makeWorkspace()) {
    const h = harness();
    await h.run(workspace, error);
    return h;
  }

  test('an untagged error and a call with no error argument take the active-binding ladder and never touch the seam', async () => {
    for (const error of [authError(), undefined, null]) {
      const { calls } = await ladder(error);
      assert.equal(calls.githubRemint.length, 0);
      assert.equal(calls.linearRefresh.length, 1, 'the Linear Connection is refreshed, as today');
      assert.equal(calls.fetch.length, 1);
    }
  });

  test('an ACTIVE-tagged error takes the ladder', async () => {
    const { calls } = await ladder(authError({ provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' }));
    assert.equal(calls.githubRemint.length, 0);
    assert.equal(calls.linearRefresh.length, 1);
  });

  // LIN-3790: legacy, refresh-token-kind and unhydrated SECONDARIES no longer take
  // the active ladder (they used to; see the secondary describe below). Same-kind
  // legacy bindings are the active binding by one-source-per-kind and still do.
  test('LIN-3790: a legacy binding of the PRIMARY kind (not a secondary) takes the ladder', async () => {
    const ws = makeLegacyWorkspace({ secondary: { provider: 'linear', scope: 'org-2' } });
    const { calls } = await ladder(authError({ provider: 'linear', scope: 'org-2', connectionId: undefined }), ws);
    assert.equal(calls.removal + calls.durableRead > 0, true, 'the active ladder ran');
  });
});

describe('LIN-3790 handleUnauthorizedError — legacy and refresh-token-kind secondaries', () => {
  const JIRA_TAG = { provider: 'jira', scope: 'https://x.atlassian.net', connectionId: 'a::jira::x' };

  function jiraOAuthWorkspace({ hydrated = true } = {}) {
    const ws = makeWorkspace();
    const jira = { provider: 'jira', scope: 'https://x.atlassian.net', connectionId: 'a::jira::x' };
    if (hydrated) setBindingCredential(jira, { token: 'stale-jira', tokenExpiresAt: NOW - 1000 });
    ws.bindings = [ws.bindings[0], jira];
    return ws;
  }

  test('a connection-backed Jira OAuth secondary is renewed through the seam, spends no Linear refresh, then renders degradeSecondary', async () => {
    const { calls, res, run } = harness();
    await run(jiraOAuthWorkspace(), authError(JIRA_TAG));
    assert.equal(calls.githubRemint.length, 1, 'one refreshConnectionForWorkspace call');
    assert.deepEqual(JSON.parse(JSON.stringify(calls.githubRemint[0].connection)), { _id: 'a::jira::x', provider: 'jira' });
    assert.equal(calls.linearRefresh.length, 0);
    assert.equal(calls.removal, 0);
    assert.equal(calls.fetch[0][4].degradeSecondary, true);
    assert.equal(res.statusCode, 200);
  });

  // F2 witness: at HEAD this tag went down the active ladder and ended in handleWorkspaceRemoval.
  for (const provider of [undefined, 'linear']) {
    test(`F2: a dead LEGACY GitHub secondary on a legacy Linear-primary (workspace.provider ${provider}) degrades: no removal, no Linear refresh`, async () => {
      const { calls, res, run } = harness({ degraded: [{ provider: 'github', scope: 'JKershaw/LinearViewer' }] });
      await run(makeLegacyWorkspace({ primary: provider }), authError({ provider: 'github', scope: 'JKershaw/LinearViewer', connectionId: undefined }));
      assert.equal(calls.removal, 0, 'the workspace is not removed over a dead secondary');
      assert.equal(calls.linearRefresh.length, 0);
      assert.equal(calls.linearExchange, 0);
      assert.equal(calls.durableRead, 0);
      assert.equal(calls.githubRemint.length, 0, 'a legacy secondary has no renewal path');
      assert.equal(calls.fetch.length, 1);
      assert.equal(calls.fetch[0][4].degradeSecondary, true);
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /dashboard-source-notice/);
    });
  }

  test('a dead legacy Jira Basic secondary degrades the same way', async () => {
    const ws = makeLegacyWorkspace({ secondary: { provider: 'jira', scope: 'https://x.atlassian.net' } });
    const { calls, res, run } = harness({ degraded: [{ provider: 'jira', scope: 'https://x.atlassian.net' }] });
    await run(ws, authError({ provider: 'jira', scope: 'https://x.atlassian.net', connectionId: undefined }));
    assert.equal(calls.removal, 0);
    assert.equal(calls.linearRefresh.length, 0);
    assert.match(res.body, /dashboard-source-notice/);
  });

  test('a dead legacy Linear secondary under a legacy GitHub primary degrades, with no GitHub re-mint', async () => {
    const ws = makeLegacyWorkspace({ primary: 'github', secondary: { provider: 'linear', scope: 'org-1' } });
    ws.bindings = [{ provider: 'github', scope: 'o/r', credentials: { token: 'gh' } }, ws.bindings[1]];
    ws.activeBinding = { provider: 'github', scope: 'o/r' };
    const { calls, res, run } = harness({ degraded: [{ provider: 'linear', scope: 'org-1' }] });
    await run(ws, authError({ provider: 'linear', scope: 'org-1', connectionId: undefined }));
    assert.equal(calls.removal, 0);
    assert.equal(calls.githubRemint.length, 0);
    assert.match(res.body, /dashboard-source-notice/);
  });

  test('an unhydrated connection-backed secondary degrades without the ladder (remint is a no-op)', async () => {
    const { calls, res, run } = harness({ degraded: [{ provider: 'github', scope: 'JKershaw/LinearViewer' }] });
    await run(makeWorkspace({ ghHydrated: false }), authError(GH_TAG));
    assert.equal(calls.githubRemint.length, 0);
    assert.equal(calls.linearRefresh.length, 0);
    assert.equal(calls.fetch[0][4].degradeSecondary, true);
    assert.match(res.body, /dashboard-source-notice/);
  });

  // F3 witness: at HEAD a dead Linear secondary spent a GitHub installation re-mint on the ACTIVE binding.
  test('F3: a connection-backed GitHub-primary with a dead Linear secondary re-mints the secondary only, never the active GitHub installation', async () => {
    const gh = { provider: 'github', scope: 'o/r', connectionId: 'a::github::1' };
    const lin = { provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' };
    setBindingCredential(gh, { token: 'gh', tokenExpiresAt: NOW + 3_600_000 });
    setBindingCredential(lin, { token: 'stale-lin', tokenExpiresAt: NOW - 1000 });
    const ws = { id: 'org-1', urlKey: 'lv', provider: 'github', activeBinding: { provider: 'github', scope: 'o/r' }, bindings: [gh, lin] };
    const { calls, res, run } = harness();
    await run(ws, authError({ provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' }));
    assert.equal(calls.githubRemint.length, 1);
    assert.equal(calls.githubRemint[0].connection.provider, 'linear', 'the Linear secondary was renewed');
    assert.equal(res.statusCode, 200);
  });

  describe('R1: a retry that fails with the ACTIVE binding\'s auth error falls through to the active ladder', () => {
    const LIN_TAG = { provider: 'linear', scope: 'org-1', connectionId: 'a::linear::org-1' };
    for (const [name, tag] of [['active-tagged', LIN_TAG], ['untagged', null]]) {
      test(`${name} auth error on the secondary arm's retry runs the ladder instead of the 503`, async () => {
        const { calls, res, run } = harness({ fetchThrowsSeq: [authError(tag)] });
        await run(makeWorkspace(), authError(GH_TAG));
        assert.equal(calls.githubRemint.length, 1, 'the secondary was renewed first');
        assert.equal(calls.linearRefresh.length, 1, 'then the active ladder ran');
        assert.equal(res.statusCode, 200);
      });
    }

    test('a secondary-tagged auth error on the retry stays the 503 (no ladder)', async () => {
      const { calls, res, run } = harness({ fetchThrows: authError(GH_TAG) });
      await run(makeWorkspace(), authError(GH_TAG));
      assert.equal(res.statusCode, 503);
      assert.equal(calls.linearRefresh.length, 0);
    });

    test('a non-auth retry failure stays the 503 (no ladder)', async () => {
      const { calls, res, run } = harness({ fetchThrows: Object.assign(new Error('GitHub 502'), { status: 502 }) });
      await run(makeWorkspace(), authError(GH_TAG));
      assert.equal(res.statusCode, 503);
      assert.equal(calls.linearRefresh.length, 0);
    });
  });
});

describe('LIN-3774 handleUnauthorizedError — call-site pins', () => {
  test('all five routes pass the caught error into the handler', () => {
    const calls = [...SERVER_SRC.matchAll(/return handleUnauthorizedError\(([^)]*)\)/g)].map(m => m[1]);
    assert.equal(calls.length, 5);
    for (const c of calls) assert.match(c, /openRouterSource, res, error$/, c);
  });

  test('the secondary arm is guarded on error?.binding and sits right after the PAT arm, before the strategy ladder', () => {
    const body = HANDLER_SRC;
    const guard = body.indexOf('error?.binding ? secondaryRemint.bindingForError(workspace, error) : null');
    assert.notEqual(guard, -1);
    assert.ok(guard > body.indexOf('workspace.isPAT'));
    assert.ok(guard < body.indexOf('refreshDeclarationFor(workspace)'));
    assert.ok(guard < body.indexOf('ownerCredentialStore.get('));
  });
});
