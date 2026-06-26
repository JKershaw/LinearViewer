/**
 * Unit tests for the GitHub Projects live-auth slice (LIN-560 Session 2).
 *
 * Two surfaces, mirroring tests/unit/github-auth.test.js:
 *   - the GitHubProjects provider's credential-ACQUISITION primitives reused from
 *     the shared GitHub App helpers (beginAuth / completeInstallation /
 *     refreshCredential) plus the board-list picker seam (listBoards);
 *   - the routes/github-projects-auth.js router that drives them and writes the
 *     binding via linkProvider — begin (503 + redirect), callback (state guard +
 *     board picker + already-installed steer), and link (new-container
 *     find-or-create + add-source, with the org/projectNumber scope validation).
 *
 * Run with: node --test tests/unit/github-projects-auth.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { GitHubProjectsProvider } from '../../lib/providers/github-projects/index.js';
import { createGitHubProjectsAuthRoutes } from '../../routes/github-projects-auth.js';
import { createFakeGitHubProjectsClient } from '../../lib/providers/github-projects/fake-client.js';

// Ephemeral RSA keypair so completeInstallation's App-JWT signing runs for real
// against a valid PEM — generated, never on disk.
const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

// ---------------------------------------------------------------------------
// Provider acquisition + picker primitives
// ---------------------------------------------------------------------------

describe('GitHubProjectsProvider auth primitives', () => {
  const ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
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

  test('beginAuth builds the shared GitHub App installation URL with opaque state', () => {
    const url = new GitHubProjectsProvider().beginAuth({ state: 'nonce-123' });
    assert.ok(url.startsWith('https://github.com/apps/my-app/installations/new?'),
      `expected App install URL, got ${url}`);
    const params = new URL(url).searchParams;
    assert.equal(params.get('state'), 'nonce-123');
    // No OAuth scope/client_id leakage — App permissions declare access.
    assert.equal(params.get('scope'), null);
    assert.equal(params.get('client_id'), null);
  });

  test('beginAuth throws when GITHUB_APP_SLUG is unset rather than emitting apps/undefined', () => {
    delete process.env.GITHUB_APP_SLUG;
    assert.throws(() => new GitHubProjectsProvider().beginAuth({ state: 'n' }), /GITHUB_APP_SLUG/);
  });

  test('completeInstallation mints an installation token and resolves the board-owner identity', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM; // real key so mintAppJwt signs
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      if (String(url).endsWith('/access_tokens')) {
        assert.equal(init.method, 'POST');
        return { ok: true, status: 201, text: async () => JSON.stringify({ token: 'ghs_inst', expires_at: '2026-06-25T20:00:00Z' }) };
      }
      assert.match(String(url), /\/app\/installations\/42$/);
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 42, account: { id: 7, login: 'octocat' } }) };
    };
    try {
      const creds = await new GitHubProjectsProvider().completeInstallation('42');
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

  test('listBoards maps the installation account boards and drops closed ones', async () => {
    const provider = new GitHubProjectsProvider();
    const fake = createFakeGitHubProjectsClient({
      'octocat/5': { project: { number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5' } },
      'octocat/6': { project: { number: 6, title: 'Archived', url: 'u6', closed: true } },
      'acme/9': { project: { number: 9, title: 'Other org' } },
    });
    provider._clientForToken = () => fake; // inject the fake instead of a real HTTP client

    const boards = await provider.listBoards('ghs_inst', 'octocat');
    // Only octocat's OPEN boards — the closed one and the other org are excluded.
    assert.deepEqual(boards, [
      { login: 'octocat', number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5', closed: false },
    ]);
  });

  test('refreshCredential re-mints from installationId with a real ms expiry and no refresh token', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
    const fetchImpl = async (url) => {
      assert.match(String(url), /\/app\/installations\/77\/access_tokens$/);
      return { ok: true, status: 201, text: async () => JSON.stringify({ token: 'ghs_new', expires_at: '2026-06-25T21:00:00Z' }) };
    };
    const patch = await new GitHubProjectsProvider().refreshCredential(
      { credentials: { installationId: '77' } }, { fetchImpl, now: Date.parse('2026-06-25T20:00:00Z') }
    );
    assert.deepEqual(patch, { token: 'ghs_new', tokenExpiresAt: Date.parse('2026-06-25T21:00:00Z'), installationId: '77' });
    assert.equal(patch.refreshToken, undefined);
  });

  test('refreshCredential throws when the binding has no installationId', async () => {
    await assert.rejects(
      () => new GitHubProjectsProvider().refreshCredential({ credentials: {} }),
      /missing installationId/
    );
  });
});

// ---------------------------------------------------------------------------
// Route harness (the routes are under test, not the network)
// ---------------------------------------------------------------------------

function fakeProvider() {
  return {
    name: 'github-projects',
    beginAuth: ({ state }) => `https://github.com/apps/my-app/installations/new?state=${state}`,
    completeInstallation: async (installationId) => {
      if (installationId === 'bad') throw new Error('GitHub App auth: installation-token request failed');
      return { token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z' };
    },
    listBoards: async (_token, login) => ([
      { login, number: 5, title: 'Roadmap', url: 'u', shortDescription: null, closed: false },
    ]),
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
      for (const k of Object.keys(this)) {
        if (typeof this[k] !== 'function') delete this[k];
      }
      cb();
    },
  };
  return session;
}

const ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];

describe('GitHub Projects auth routes', () => {
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

  test('GET /auth/github-projects 503s when GitHub App env is not configured', async () => {
    delete process.env.GITHUB_APP_ID;
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    await handler({ query: {}, session: makeSession() }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
  });

  test('GET /auth/github-projects mints state, stores intent server-side, and redirects', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source' }, session }, res);
    assert.ok(session.oauthState, 'state nonce stored in session');
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github-projects' });
    assert.ok(res.redirectedTo.includes(`state=${session.oauthState}`));
    assert.ok(!res.redirectedTo.includes('add-source'), 'mode not encoded into opaque state');
  });

  test('GET /auth/github-projects (add-source) carries a validated viewed-workspace urlKey', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source', workspace: 'acme' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github-projects', workspaceUrlKey: 'acme' });
    assert.ok(!res.redirectedTo.includes('acme'), 'urlKey rides in session, not opaque state');
  });

  test('GET callback rejects a mismatched state (CSRF guard)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '42', state: 'attacker' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('GET callback mints from installation_id and renders the board picker, holding the token in session', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github-projects' } });
    await handler({ query: { installation_id: '99', setup_action: 'install', state: 'real' }, session }, res);
    assert.deepEqual(session.githubProjectsPending, { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' });
    assert.match(res.body, /Roadmap/);
    assert.match(res.body, /github-projects-board-form/);
    // The option value is the org/projectNumber slug.
    assert.match(res.body, /value="octocat\/5"/);
  });

  test('GET callback (add-source) carries the viewed-workspace urlKey from intent into pending', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'github-projects', workspaceUrlKey: 'acme' } });
    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);
    assert.equal(session.githubProjectsPending.workspaceUrlKey, 'acme');
  });

  test('GET callback steers the already-installed (code, no installation_id) case rather than 500', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } });
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Already Installed/);
    assert.equal(session.githubProjectsPending, undefined, 'no pending stashed on the steered path');
  });

  test('GET callback 400s when installation_id is missing (setup_action=request)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { setup_action: 'request', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Installation Incomplete/);
    assert.match(res.body, /admin to approve/);
  });

  test('GET callback surfaces a clean 400 when the installation-token mint fails', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { installation_id: 'bad', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
  });

  test('POST link (new) find-or-creates the GitHub account container and writes the LIN-711 binding', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(session.workspaces.length, 1);
    const ws = session.workspaces[0];
    assert.equal(ws.id, 'github:42');
    assert.equal(ws.urlKey, 'octocat');
    assert.equal(ws.provider, 'github-projects');
    const expectedExpiry = Date.parse('2026-06-25T20:00:00Z');
    assert.deepEqual(ws.bindings, [{ provider: 'github-projects', scope: 'octocat/5', credentials: { installationId: '99', token: 'ghs_inst', tokenExpiresAt: expectedExpiry } }]);
    assert.notEqual(ws.tokenExpiresAt, Number.MAX_SAFE_INTEGER);
    assert.equal(session.activeWorkspaceId, 'github:42');
    assert.equal(session.githubProjectsPending, undefined, 'pending cleared');
    assert.equal(res.redirectedTo, '/workspace/octocat/');
  });

  test('POST link (new) adds a board as a binding onto an EXISTING GitHub account container (coexists with Issues)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    // A container already created by the GitHub Issues login for the same account.
    const existing = {
      id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github',
      bindings: [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho' } }],
    };
    const session = makeSession({
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [existing],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(session.workspaces.length, 1, 'no duplicate workspace created');
    assert.deepEqual(existing.bindings.map(b => `${b.provider}:${b.scope}`),
      ['github:octocat/hello-world', 'github-projects:octocat/5']);
  });

  test('POST link (add-source) binds onto the VIEWED workspace without clobbering its primary', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const viewedWs = { id: 'org-a', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_a' };
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubProjectsPending: { token: 'ghs_inst', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z', workspaceUrlKey: 'acme' },
      workspaces: [viewedWs, activeWs],
      activeWorkspaceId: 'org-b',
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.ok(viewedWs.bindings?.some(b => b.provider === 'github-projects' && b.scope === 'octocat/5'), 'viewed workspace gets the binding');
    assert.ok(!activeWs.bindings, 'active workspace untouched');
    assert.equal(viewedWs.provider, 'linear', 'viewed primary scalar unchanged by the non-active binding');
    assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=github-projects');
  });

  test('POST link rejects a non-numeric board slug (must be org/projectNumber, not owner/repo)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({ githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' }, workspaces: [] });
    await handler({ body: { board: 'octocat/hello-world' }, session }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Invalid Project Board/);
    assert.equal(session.workspaces.length, 0);
  });

  test('POST link surfaces a clean error when the installation expiry is missing/unparseable', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99' },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Something Went Wrong/);
    assert.equal(session.workspaces.length, 0, 'no binding written from a bad expiry');
  });

  test('POST link rejects when there is no pending GitHub Projects session', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    await handler({ body: { board: 'octocat/5' }, session: makeSession() }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });
});
