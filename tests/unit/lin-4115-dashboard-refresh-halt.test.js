/**
 * LIN-4115 (UI round 3 · S3d): the halt banner on Home's post-401 re-render (lib/dashboard-refresh.js).
 *
 * This is the second Home producer. After a token refresh, Home is re-rendered here, not by server.js's route,
 * so a banner that the route draws but this path drops would vanish right after a refresh. These witnesses run
 * renderDashboardAfterRefresh with a REAL WorkspaceHaltStore and the REAL renderPage, and read the banner from
 * the HTML the user would get.
 *
 * Witnesses (each fails on the unimplemented path unless noted):
 *  - a halt set on the store shows the banner after a refresh;
 *  - cold cache + a failing read shows NO banner (readHaltForPoll's fallback is the last-known value, and a
 *    cold cache has none). The positive control: the same failing read with a warm cache DOES show it;
 *  - a read that never resolves is cut off by the injected haltReadTimeoutMs: no banner, within the bound,
 *    and the warm-cache variant still shows the last-known halt;
 *  - a null store draws no banner and renders byte-identical HTML to the run with the store omitted (controls);
 *  - a member gets the sentence with no link, the owner gets the link.
 *
 * The test does not assert "any read failure means no banner": readHaltForPoll falls back to the last-known
 * value on purpose (LIN-3024), and the per-process cache is the accepted residual (see the PR).
 *
 * Run: node --test tests/unit/lin-4115-dashboard-refresh-halt.test.js
 */
import '../../lib/providers/index.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboardAfterRefresh } from '../../lib/dashboard-refresh.js';
import { renderPage } from '../../lib/render.js';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';
const DISPATCH_HREF = `/workspace/${URL_KEY}/dispatch`;
const PAUSE_TEXT = 'Runs are paused · cleared on Dispatch ›';
const STOP_TEXT = 'Runs are stopped · cleared on Dispatch ›';

const OWNER = { runControls: true, runSetup: false };
const MEMBER = { runControls: false, runSetup: false };

const bannerText = (html) => {
  const m = html.match(/<div[^>]*data-testid="home-halt-banner"[^>]*>([\s\S]*?)<\/div>/);
  return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null;
};

// A store whose read never settles. The injected timeout has to win, and the cache decides what is shown.
function neverResolvingHaltStore({ lastKnown = null } = {}) {
  return {
    getWorkspaceHalt: () => new Promise(() => {}),
    getLastKnownHalt: () => lastKnown
  };
}

/**
 * Runs the Home refresh tail with the real renderPage. `workspaceHaltStore` and `haltReadTimeoutMs` are the
 * LIN-4115 deps; omit `workspaceHaltStore` (undefined) to check the no-store path.
 */
async function refresh({ workspaceHaltStore, haltReadTimeoutMs, featureFlags = OWNER } = {}) {
  const workspace = { id: 'ws-1', urlKey: URL_KEY, name: 'Acme' };
  const session = { workspaces: [workspace], accountId: 'acct-1' };
  const res = { body: null, send(payload) { this.body = payload; return this; } };
  const deps = {
    customPromptsStore: { list: async () => [] },
    getDeployInfo: () => ({}),
    fetchAndPrepareProjects: async () => ({
      trees: [], inProgressTrees: [], recentActivityTrees: [], organizationName: 'acme',
      teams: [], selectedTeamId: null, showSource: false, truncated: false, availableAssignees: [], appliedAssigneeName: null, stateIssues: []
    }),
    orderIssuesForSwipe: () => [],
    renderPage,
    getFeatureFlags: () => ({}),
    homeRowStates: async () => null,
    resolveRunControls: async () => featureFlags,
    getProviderForWorkspace: () => ({ supports: () => false }),
    ...(workspaceHaltStore !== undefined ? { workspaceHaltStore } : {}),
    ...(haltReadTimeoutMs !== undefined ? { haltReadTimeoutMs } : {})
  };
  const started = Date.now();
  await renderDashboardAfterRefresh(deps, {
    workspace, session, teamId: null,
    assigneeState: { selectedAssignee: 'all', resolvedAssigneeName: null },
    openRouterSource: null, res
  });
  return { html: res.body, elapsedMs: Date.now() - started };
}

describe('LIN-4115 — Home re-render after a token refresh: a halt set on the real store', () => {
  test('a pause set on the store shows the pause banner after a refresh', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice' });
    const { html } = await refresh({ workspaceHaltStore });
    assert.equal(bannerText(html), PAUSE_TEXT);
  });

  test('a stop set on the store shows the stop banner after a refresh, with the owner link', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'stop', setBy: 'alice' });
    const { html } = await refresh({ workspaceHaltStore, featureFlags: OWNER });
    assert.equal(bannerText(html), STOP_TEXT);
    const link = html.match(/<a\b[^>]*data-testid="home-halt-dispatch-link"[^>]*>/);
    assert.ok(link, 'the owner gets the dispatch link');
    assert.match(link[0], new RegExp(`href="${DISPATCH_HREF}"`));
  });

  test('a member on the refreshed page gets the sentence with no link', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice' });
    const { html } = await refresh({ workspaceHaltStore, featureFlags: MEMBER });
    assert.equal(bannerText(html), PAUSE_TEXT);
    assert.ok(!html.includes('home-halt-dispatch-link'));
  });

  test('a cleared halt shows no banner after a refresh', async () => {
    const workspaceHaltStore = new WorkspaceHaltStore({ collection: createMockCollection() });
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice' });
    await workspaceHaltStore.clearWorkspaceHalt(URL_KEY);
    const { html } = await refresh({ workspaceHaltStore });
    assert.equal(bannerText(html), null);
  });
});

describe('LIN-4115 — Home re-render after a token refresh: a failing halt read (cold cache vs warm cache)', () => {
  test('cold cache + a failing read shows NO banner (no last-known halt to fall back to)', async () => {
    const collection = createMockCollection();
    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };
    const workspaceHaltStore = new WorkspaceHaltStore({ collection });
    const { html } = await refresh({ workspaceHaltStore });
    assert.equal(bannerText(html), null);
    assert.ok(!html.includes('home-halt'), 'no halt markup at all');
  });

  test('positive control: warm cache + the same failing read DOES show the last-known banner', async () => {
    const collection = createMockCollection();
    const workspaceHaltStore = new WorkspaceHaltStore({ collection });
    await workspaceHaltStore.setWorkspaceHalt(URL_KEY, { mode: 'stop', setBy: 'alice' });
    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };
    const { html } = await refresh({ workspaceHaltStore });
    assert.equal(bannerText(html), STOP_TEXT, 'the fallback is the value the server really wrote');
  });

  test('a never-resolving read on a cold cache is cut off by haltReadTimeoutMs: no banner, within the bound', async () => {
    const { html, elapsedMs } = await refresh({
      workspaceHaltStore: neverResolvingHaltStore({ lastKnown: null }),
      haltReadTimeoutMs: 40
    });
    assert.equal(bannerText(html), null);
    assert.ok(elapsedMs < 1000, `expected the bounded read to win well under 1s, took ${elapsedMs}ms`);
  });

  test('a never-resolving read with a warm last-known halt is cut off and shows that halt, within the bound', async () => {
    const { html, elapsedMs } = await refresh({
      workspaceHaltStore: neverResolvingHaltStore({ lastKnown: { mode: 'pause', setAt: '2026-11-01T00:00:00.000Z', setBy: 'alice' } }),
      haltReadTimeoutMs: 40
    });
    assert.equal(bannerText(html), PAUSE_TEXT);
    assert.ok(elapsedMs < 1000, `expected the bounded read to win well under 1s, took ${elapsedMs}ms`);
  });
});

describe('LIN-4115 — Home re-render after a token refresh: no store, no change', () => {
  test('a null store draws no banner', async () => {
    const { html } = await refresh({ workspaceHaltStore: null });
    assert.equal(bannerText(html), null);
  });

  test('a null store renders byte-identical HTML to omitting the store (no-halt output unchanged)', async () => {
    const omitted = await refresh({});
    const withNull = await refresh({ workspaceHaltStore: null });
    assert.equal(withNull.html, omitted.html);
    assert.ok(!withNull.html.includes('home-halt'));
  });
});
