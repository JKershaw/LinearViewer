/**
 * Unit tests for LIN-1353 S8+S9: durable preferences (OpenRouter key, features,
 * theme, north star) survive `session.regenerate()` for NON-Linear sign-ins
 * (GitHub App install, GitHub Projects install), and — as a characterization
 * check — the pre-existing workspace-config survival still holds for all three
 * regenerate paths (Linear, GitHub, GitHub Projects) after the accountId re-key.
 *
 * Before LIN-1353, `applyUserPreferencesToSession` was only ever called from
 * routes/auth.js's Linear callback — a GitHub/GitHub Projects fresh sign-in
 * (the ONE branch of each router that calls `session.regenerate()`) silently
 * dropped every durable preference. This drives the REAL routers + REAL
 * UserPreferencesStore + REAL account seam (establishAccount) end-to-end.
 *
 * Run with: node --test tests/unit/regenerate-survival.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createAuthRoutes } from '../../routes/auth.js';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createGitHubProjectsAuthRoutes } from '../../routes/github-projects-auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { UserPreferencesStore } from '../../lib/user-preferences.js';

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    send(html) { this.body = html; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
}

function makeSession(initial = {}) {
  const session = {
    ...initial,
    save(cb) { if (cb) cb(); },
    regenerate(cb) {
      for (const k of Object.keys(this)) {
        if (typeof this[k] !== 'function') delete this[k];
      }
      cb();
    },
  };
  return session;
}

function fakeLinearProvider() {
  return {
    name: 'linear',
    beginAuth: ({ state }) => `https://linear.app/oauth/authorize?state=${state}`,
    completeAuth: async () => ({ access_token: 'lin_tok', refresh_token: 'lin_refresh', expires_in: 86400 }),
    fetchOrganization: async () => ({ id: 'org-1', name: 'Acme', urlKey: 'acme' }),
    fetchViewer: async () => ({ id: 'viewer-1' }),
  };
}

function fakeGitHubProvider() {
  return {
    name: 'github',
    completeInstallation: async (installationId) => ({
      token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z',
    }),
    listRepos: async () => ([{ slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false }]),
  };
}

function fakeGitHubProjectsProvider() {
  return {
    name: 'github-projects',
    completeInstallation: async (installationId) => ({
      token: 'ghs_proj_inst', login: 'octocat', userId: '99', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z',
    }),
    listBoards: async () => ([{ slug: 'octocat/1', name: 'Roadmap' }]),
  };
}

describe('durable preferences survive session.regenerate() (LIN-1353 S8+S9)', () => {
  let dbClient, dbDir, counter = 0;
  const ENV = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];
  let savedEnv;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'regen-survival-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
    savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    for (const k of ENV) process.env[k] = 'set';
  });

  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  function freshDeps() {
    const db = dbClient.db(`regen_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      userPreferencesStore: new UserPreferencesStore({ collection: db.collection('user-preferences') }),
    };
  }

  test('GitHub App install (new-container login): OpenRouter key + features + theme rehydrate onto the fresh session', async () => {
    const deps = freshDeps();

    // 1. A prior session for this SAME human GitHub identity already connected
    // OpenRouter and set preferences — durably, under their real accountId.
    const preEstablish = { session: {} };
    const { establishAccount } = await import('../../lib/account-session.js');
    const established = await establishAccount(preEstablish.session, deps.accountStore, deps.accountWorkspaceStore, 'github', 'human-42', {}, 'placeholder-ws');
    await deps.userPreferencesStore.setOpenRouterApiKey(established.accountId, 'sk-or-v1-github-survive');
    await deps.userPreferencesStore.saveUserPreferences(established.accountId, {
      openRouterApiKey: 'sk-or-v1-github-survive',
      features: { collective: true },
      theme: 'dark',
    });

    // 2. Fresh GitHub App install/login (the ONE session.regenerate() branch).
    const router = createGitHubAuthRoutes({ provider: fakeGitHubProvider(), ...deps });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });

    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(res.redirectedTo, '/workspace/octocat/');
    assert.strictEqual(session.accountId, established.accountId, 'same human → same account, found by identity lookup');
    // The whole point of S9: the durable connection survived the regenerate.
    assert.strictEqual(session.openRouterApiKey, 'sk-or-v1-github-survive');
    assert.deepStrictEqual(session.features, { collective: true });
    assert.strictEqual(session.theme, 'dark');
  });

  test('GitHub Projects install (new-container login): OpenRouter key + features rehydrate onto the fresh session', async () => {
    const deps = freshDeps();
    const { establishAccount } = await import('../../lib/account-session.js');
    const preEstablish = { session: {} };
    const established = await establishAccount(preEstablish.session, deps.accountStore, deps.accountWorkspaceStore, 'github', 'human-99', {}, 'placeholder-ws');
    await deps.userPreferencesStore.setOpenRouterApiKey(established.accountId, 'sk-or-v1-projects-survive');
    await deps.userPreferencesStore.saveUserPreferences(established.accountId, {
      openRouterApiKey: 'sk-or-v1-projects-survive',
      northStarByWorkspace: { acme: 'Ship the roadmap' },
    });

    const router = createGitHubProjectsAuthRoutes({ provider: fakeGitHubProjectsProvider(), ...deps });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-99',
      githubProjectsPending: { token: 'ghs_proj_inst', mode: 'new', login: 'octocat', userId: '99', installationId: '77', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });

    await handler({ body: { board: 'octocat/1' }, session }, res);

    assert.equal(res.redirectedTo, '/workspace/octocat/');
    assert.strictEqual(session.accountId, established.accountId);
    assert.strictEqual(session.openRouterApiKey, 'sk-or-v1-projects-survive');
    assert.deepStrictEqual(session.northStarByWorkspace, { acme: 'Ship the roadmap' });
  });

  test('GitHub App install: no stored preferences → rehydrate is a clean no-op (no thrown error, no fabricated fields)', async () => {
    const deps = freshDeps();
    const router = createGitHubAuthRoutes({ provider: fakeGitHubProvider(), ...deps });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-fresh',
      githubPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });

    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(res.redirectedTo, '/workspace/octocat/');
    assert.strictEqual(session.openRouterApiKey, undefined);
  });

  // ---------------------------------------------------------------------------
  // Characterization: workspace config (session.workspaces) already survived
  // regenerate via the existing session-blob preserve — must still hold after
  // the accountId re-key. All three regenerate paths.
  // ---------------------------------------------------------------------------

  test('Linear OAuth callback: workspace config survives regenerate', async () => {
    const router = createAuthRoutes({ provider: fakeLinearProvider(), sessionStore: { cleanup: async () => {} }, ...freshDeps() });
    const handler = getHandler(router, 'get', '/auth/callback');
    const res = makeRes();
    const priorWs = { id: 'prior-1', name: 'Prior', urlKey: 'prior', accessToken: 'tok' };
    const session = makeSession({ oauthState: 'real', workspaces: [priorWs] });

    await handler({ query: { code: 'good-code', state: 'real' }, session }, res);

    assert.strictEqual(session.workspaces.length, 2, 'the pre-regenerate workspace plus the new one');
    assert.ok(session.workspaces.some(w => w.id === 'prior-1'));
  });

  test('GitHub App install: workspace config survives regenerate', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeGitHubProvider(), ...freshDeps() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const priorWs = { id: 'prior-2', name: 'Prior', urlKey: 'prior', accessToken: 'tok' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [priorWs],
    });

    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.strictEqual(session.workspaces.length, 2);
    assert.ok(session.workspaces.some(w => w.id === 'prior-2'));
  });

  test('GitHub Projects install: workspace config survives regenerate', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeGitHubProjectsProvider(), ...freshDeps() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const priorWs = { id: 'prior-3', name: 'Prior', urlKey: 'prior', accessToken: 'tok' };
    const session = makeSession({
      githubHumanId: 'human-99',
      githubProjectsPending: { token: 'ghs_proj_inst', mode: 'new', login: 'octocat', userId: '99', installationId: '77', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [priorWs],
    });

    await handler({ body: { board: 'octocat/1' }, session }, res);

    assert.strictEqual(session.workspaces.length, 2);
    assert.ok(session.workspaces.some(w => w.id === 'prior-3'));
  });
});
