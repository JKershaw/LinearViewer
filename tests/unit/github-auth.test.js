/**
 * Unit tests for the GitHub OAuth consumer of the LIN-562 binding seam (LIN-541).
 *
 * Two surfaces:
 *   - the GitHub provider's credential-ACQUISITION primitives (beginAuth /
 *     completeAuth / fetchViewer / listRepos), mirroring the Linear provider;
 *   - the routes/github-auth.js router that drives them and writes the binding
 *     via linkProvider — begin (503 + redirect), callback (state guard + repo
 *     picker), and link (new-container find-or-create + add-source).
 *
 * Run with: node --test tests/unit/github-auth.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { AuthExchangeError } from '../../lib/providers/interface.js';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';

// Ephemeral RSA keypair so completeInstallation's App-JWT signing (mintAppJwt)
// runs for real against a valid PEM — generated, never on disk.
const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

// ---------------------------------------------------------------------------
// Provider acquisition primitives
// ---------------------------------------------------------------------------

describe('GitHubProvider auth primitives', () => {
  const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    process.env.GITHUB_REDIRECT_URI = 'http://localhost:3000/auth/github/callback';
    // GitHub App config (LIN-708) — beginAuth now builds the App installation URL
    // and reads `slug` via getAppConfig(), which also requires appId/privateKey.
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = 'test-key';
    process.env.GITHUB_APP_SLUG = 'my-app';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('beginAuth builds the GitHub App installation URL with opaque state (LIN-708)', () => {
    const url = new GitHubProvider().beginAuth({ state: 'nonce-123' });
    // App installation picker, NOT the OAuth authorize URL.
    assert.ok(url.startsWith('https://github.com/apps/my-app/installations/new?'),
      `expected App install URL, got ${url}`);
    const params = new URL(url).searchParams;
    // state passes through unchanged as an opaque nonce.
    assert.equal(params.get('state'), 'nonce-123');
    // `scope` is dropped entirely — App permissions (Issues: read & write) declare
    // access, so keeping `repo` would preserve the over-grant this migration fixes
    // (security M1, LIN-683).
    assert.equal(params.get('scope'), null);
    assert.doesNotMatch(url, /scope=/);
    // OAuth-only params are gone too — the App identifies itself by slug.
    assert.equal(params.get('client_id'), null);
    assert.equal(params.get('redirect_uri'), null);
    assert.equal(params.get('allow_signup'), null);
  });

  test('beginAuth throws when GITHUB_APP_SLUG is unset rather than emitting apps/undefined (LIN-708)', () => {
    delete process.env.GITHUB_APP_SLUG;
    assert.throws(() => new GitHubProvider().beginAuth({ state: 'nonce-123' }), /GITHUB_APP_SLUG/);
  });

  test('completeAuth returns a normalized token bag on success', async () => {
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'gho_abc', token_type: 'bearer' }) });
    try {
      const bag = await new GitHubProvider().completeAuth('code-1');
      assert.deepEqual(bag, { access_token: 'gho_abc' });
    } finally {
      global.fetch = realFetch;
    }
  });

  test('completeAuth throws AuthExchangeError on an error payload (HTTP 200 + {error})', async () => {
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ error: 'bad_verification_code' }) });
    try {
      await assert.rejects(
        () => new GitHubProvider().completeAuth('bad'),
        (err) => err instanceof AuthExchangeError && err.provider === 'github'
      );
    } finally {
      global.fetch = realFetch;
    }
  });

  test('fetchViewer + listRepos map the GitHub shape through a per-token client', async () => {
    const provider = new GitHubProvider();
    const fake = createFakeGitHubClient({
      _user: { id: 42, login: 'octocat', name: 'The Octocat' },
      _repos: [
        { full_name: 'octocat/hello-world', private: false },
        { full_name: 'octocat/secret', private: true },
      ],
    });
    provider._clientForToken = () => fake; // inject the fake instead of a real HTTP client

    const viewer = await provider.fetchViewer('gho_abc');
    assert.deepEqual(viewer, { id: '42', login: 'octocat', name: 'The Octocat' });

    const repos = await provider.listRepos('gho_abc');
    assert.deepEqual(repos, [
      { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false },
      { slug: 'octocat/secret', name: 'octocat/secret', private: true },
    ]);
  });

  test('completeInstallation mints an installation token and resolves account identity (LIN-709)', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM; // real key so mintAppJwt signs
    const realFetch = global.fetch;
    // Route by URL: the access_tokens POST vs the installation GET.
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/access_tokens')) {
        assert.equal(init.method, 'POST');
        return { ok: true, status: 201, text: async () => JSON.stringify({ token: 'ghs_inst', expires_at: '2026-06-25T20:00:00Z' }) };
      }
      // GET /app/installations/42 → identity comes from the installation account.
      assert.match(String(url), /\/app\/installations\/42$/);
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 42, account: { id: 7, login: 'octocat' } }) };
    };
    try {
      const creds = await new GitHubProvider().completeInstallation('42');
      assert.deepEqual(creds, {
        token: 'ghs_inst',
        login: 'octocat',
        userId: '7',
        installationId: '42',
        tokenExpiresAt: '2026-06-25T20:00:00Z',
      });
    } finally {
      global.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Route harness
// ---------------------------------------------------------------------------

// A fake GitHub provider with deterministic auth primitives — the routes are
// what's under test, not the network.
function fakeProvider() {
  return {
    name: 'github',
    beginAuth: ({ state }) => `https://github.com/apps/my-app/installations/new?state=${state}`,
    // The App-flow acquisition seam (LIN-709): mint installation token + resolve
    // the installation account identity. The route drives this; the network lives
    // behind it (covered by the provider-primitive tests above).
    completeInstallation: async (installationId) => {
      if (installationId === 'bad') throw new Error('GitHub App auth: installation-token request failed');
      return { token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z' };
    },
    listRepos: async () => ([{ slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false }]),
  };
}

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
      // Mirror express-session: wipe data fields, keep the methods.
      for (const k of Object.keys(this)) {
        if (typeof this[k] !== 'function') delete this[k];
      }
      cb();
    },
  };
  return session;
}

// The install flow now gates on the GitHub App config (LIN-703 migration), not
// the retired OAuth client_id/secret/redirect_uri.
const ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];

describe('GitHub auth routes', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = 'test-key';
    process.env.GITHUB_APP_SLUG = 'my-app';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('GET /auth/github 503s when GitHub App env is not configured', async () => {
    delete process.env.GITHUB_APP_ID;
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    await handler({ query: {}, session: makeSession() }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
  });

  test('GET /auth/github mints state, stores intent server-side, and redirects', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source' }, session }, res);
    assert.ok(session.oauthState, 'state nonce stored in session');
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github' });
    assert.ok(res.redirectedTo.includes(`state=${session.oauthState}`));
    // state is opaque — mode is NOT encoded into it (LIN-562)
    assert.ok(!res.redirectedTo.includes('add-source'));
  });

  test('GET callback rejects a mismatched state (CSRF guard)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '42', state: 'attacker' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('GET callback 400s when installation_id is missing (setup_action=request)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { setup_action: 'request', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Installation Incomplete/);
    assert.match(res.body, /admin to approve/);
  });

  test('GET /auth/github (add-source) carries a validated viewed-workspace urlKey in the intent', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source', workspace: 'acme' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github', workspaceUrlKey: 'acme' });
    // urlKey rides in the session intent, never in the opaque OAuth state.
    assert.ok(!res.redirectedTo.includes('acme'));
  });

  test('GET /auth/github (add-source) ignores a malformed workspace query param', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source', workspace: 'not a valid key!' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github' });
  });

  test('GET callback mints from installation_id and renders the repo picker, holding the token in session', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github' } });
    await handler({ query: { installation_id: '99', setup_action: 'install', state: 'real' }, session }, res);
    // Installation token + installation-account identity held in pending; installationId
    // carried for the binding-shape surface (LIN-711).
    assert.deepEqual(session.githubPending, { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99' });
    assert.match(res.body, /octocat\/hello-world/);
    assert.match(res.body, /github-repo-form/);
  });

  test('GET callback (add-source) carries the viewed-workspace urlKey from intent into pending', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'github', workspaceUrlKey: 'acme' } });
    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);
    assert.deepEqual(session.githubPending, { token: 'ghs_inst', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', workspaceUrlKey: 'acme' });
  });

  test('GET callback surfaces a clean 400 when the installation-token mint fails', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { installation_id: 'bad', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
  });

  test('POST link (new) find-or-creates the GitHub account container and writes the binding', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42' },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(session.workspaces.length, 1);
    const ws = session.workspaces[0];
    assert.equal(ws.id, 'github:42');
    assert.equal(ws.urlKey, 'octocat');
    assert.equal(ws.provider, 'github');
    assert.deepEqual(ws.bindings, [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho_token', tokenExpiresAt: Number.MAX_SAFE_INTEGER } }]);
    assert.equal(session.activeWorkspaceId, 'github:42');
    assert.equal(session.githubPending, undefined, 'pending cleared');
    assert.equal(res.redirectedTo, '/workspace/octocat/');
  });

  test('POST link (new) adds a second repo as a binding on the existing account container', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const existing = {
      id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github',
      bindings: [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho_token' } }],
    };
    const session = makeSession({
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42' },
      workspaces: [existing],
    });
    await handler({ body: { repo: 'octocat/another-repo' }, session }, res);

    assert.equal(session.workspaces.length, 1, 'no duplicate workspace created');
    assert.deepEqual(session.workspaces[0].bindings.map(b => b.scope), ['octocat/hello-world', 'octocat/another-repo']);
  });

  test('POST link (add-source) links onto the active workspace without creating a new one', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42' },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(session.workspaces.length, 1, 'no new workspace');
    assert.equal(linearWs.provider, 'linear', 'active provider unchanged by a non-active binding');
    assert.ok(linearWs.bindings.some(b => b.provider === 'github' && b.scope === 'octocat/hello-world'));
    assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=github');
  });

  test('POST link (add-source) binds onto the VIEWED workspace, not the active one (LIN-541)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    // User is viewing workspace A (acme) but B (globex) is the active one.
    const viewedWs = { id: 'org-a', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_a' };
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42', workspaceUrlKey: 'acme' },
      workspaces: [viewedWs, activeWs],
      activeWorkspaceId: 'org-b',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    // The binding lands on the VIEWED workspace (acme), NOT the active one (globex).
    assert.ok(viewedWs.bindings?.some(b => b.provider === 'github' && b.scope === 'octocat/hello-world'), 'viewed workspace gets the binding');
    assert.ok(!activeWs.bindings, 'active workspace is untouched');
    assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=github');
  });

  test('POST link (add-source) falls back to the active workspace when no target urlKey was carried', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42' },
      workspaces: [activeWs],
      activeWorkspaceId: 'org-b',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.ok(activeWs.bindings?.some(b => b.provider === 'github' && b.scope === 'octocat/hello-world'));
    assert.equal(res.redirectedTo, '/workspace/globex/settings?provider_ok=github');
  });

  test('POST link (add-source) falls back to active when the carried urlKey no longer resolves', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42', workspaceUrlKey: 'gone' },
      workspaces: [activeWs],
      activeWorkspaceId: 'org-b',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.ok(activeWs.bindings?.some(b => b.provider === 'github' && b.scope === 'octocat/hello-world'));
    assert.equal(res.redirectedTo, '/workspace/globex/settings?provider_ok=github');
  });

  test('POST link rejects when there is no pending GitHub session', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    await handler({ body: { repo: 'octocat/hello-world' }, session: makeSession() }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('POST link rejects a malformed repo slug', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({ githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42' }, workspaces: [] });
    await handler({ body: { repo: 'not-a-repo' }, session }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Invalid Repository/);
  });
});
