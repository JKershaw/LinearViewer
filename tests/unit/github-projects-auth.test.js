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
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { GitHubProjectsProvider } from '../../lib/providers/github-projects/index.js';
import { createGitHubProjectsAuthRoutes } from '../../routes/github-projects-auth.js';
import { createFakeGitHubProjectsClient } from '../../lib/providers/github-projects/fake-client.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

// Ephemeral RSA keypair so completeInstallation's App-JWT signing runs for real
// against a valid PEM — generated, never on disk.
const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

// ---------------------------------------------------------------------------
// Provider acquisition + picker primitives
// ---------------------------------------------------------------------------

describe('GitHubProjectsProvider auth primitives', () => {
  const ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_REDIRECT_URI', 'GITHUB_PROJECTS_REDIRECT_URI'];
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM; // real PEM shape (LIN-2081) — getAppConfig validates it even on the slug-only install-URL path
    process.env.GITHUB_APP_SLUG = 'my-app';
    // The App's OWN user-to-server OAuth credentials drive beginAuth (authorize) +
    // the re-bind code exchange (LIN-735); Projects rounds through its own callback.
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    process.env.GITHUB_REDIRECT_URI = 'http://localhost:3000/auth/github/callback';
    process.env.GITHUB_PROJECTS_REDIRECT_URI = 'http://localhost:3000/auth/github-projects/callback';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('beginAuth builds the user-to-server OAuth authorize URL with opaque state (LIN-735)', () => {
    const url = new GitHubProjectsProvider().beginAuth({ state: 'nonce-123' });
    // Authorize URL now, NOT installations/new — fixes the already-installed dead-end.
    assert.ok(url.startsWith('https://github.com/login/oauth/authorize?'),
      `expected OAuth authorize URL, got ${url}`);
    const params = new URL(url).searchParams;
    assert.equal(params.get('state'), 'nonce-123');
    assert.equal(params.get('client_id'), 'cid');
    // Projects rounds through its OWN callback path.
    assert.equal(params.get('redirect_uri'), 'http://localhost:3000/auth/github-projects/callback');
    // No OAuth scope leakage — App permissions declare access.
    assert.equal(params.get('scope'), null);
  });

  test('beginAuth redirect_uri falls back to GITHUB_REDIRECT_URI when no Projects-specific URI is set (LIN-735)', () => {
    delete process.env.GITHUB_PROJECTS_REDIRECT_URI;
    const url = new GitHubProjectsProvider().beginAuth({ state: 'n' });
    assert.equal(new URL(url).searchParams.get('redirect_uri'), 'http://localhost:3000/auth/github/callback');
  });

  test('beginAuth throws when GITHUB_CLIENT_ID is unset (LIN-735)', () => {
    delete process.env.GITHUB_CLIENT_ID;
    assert.throws(() => new GitHubProjectsProvider().beginAuth({ state: 'n' }), /GITHUB_CLIENT_ID/);
  });

  test('beginInstall builds the App installation URL; throws without GITHUB_APP_SLUG (LIN-735)', () => {
    const url = new GitHubProjectsProvider().beginInstall({ state: 'nonce-123' });
    assert.ok(url.startsWith('https://github.com/apps/my-app/installations/new?'), `got ${url}`);
    assert.equal(new URL(url).searchParams.get('state'), 'nonce-123');
    delete process.env.GITHUB_APP_SLUG;
    assert.throws(() => new GitHubProjectsProvider().beginInstall({ state: 'n' }), /GITHUB_APP_SLUG/);
  });

  test('listReboundableBoards flattens installations + their OPEN boards with installationId (LIN-735)', async () => {
    const provider = new GitHubProjectsProvider();
    // Inject the installations (the shared REST enumeration seam) and the board client.
    provider._listUserInstallations = async () => ([
      { id: 77, account: { login: 'octocat' } },
      { id: 88, account: { login: 'acme' } },
    ]);
    const fake = createFakeGitHubProjectsClient({
      'octocat/5': { project: { number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5' } },
      'octocat/6': { project: { number: 6, title: 'Archived', url: 'u6', closed: true } },
      'acme/9': { project: { number: 9, title: 'Widgets' } },
    });
    provider._clientForToken = () => fake;

    const boards = await provider.listReboundableBoards('gho_user');
    // Flattened across BOTH installations, closed board dropped, each tagged with its installationId.
    assert.deepEqual(boards, [
      { login: 'octocat', number: 5, title: 'Roadmap', url: 'u5', shortDescription: 'd5', closed: false, installationId: '77' },
      { login: 'acme', number: 9, title: 'Widgets', url: null, shortDescription: null, closed: false, installationId: '88' },
    ]);
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

  // LIN-1329: fetchViewer hoisted onto the Projects provider (it has no REST
  // client of its own — GraphQL-only) so both GitHub doors resolve the same
  // kind of human identity for account linking (Q3).
  test('fetchViewer maps the GitHub shape through the plain REST client (LIN-1329)', async () => {
    const provider = new GitHubProjectsProvider();
    const fake = createFakeGitHubClient({ _user: { id: 42, login: 'octocat', name: 'The Octocat' } });
    provider._restClientForToken = () => fake; // inject instead of a real HTTP call

    const viewer = await provider.fetchViewer('gho_abc');
    assert.deepEqual(viewer, { id: '42', login: 'octocat', name: 'The Octocat' });
  });
});

// ---------------------------------------------------------------------------
// Route harness (the routes are under test, not the network)
// ---------------------------------------------------------------------------

function fakeProvider() {
  return {
    name: 'github-projects',
    // beginAuth is the authorize URL (LIN-735); beginInstall is the no-installation fallback.
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`,
    beginInstall: ({ state }) => `https://github.com/apps/my-app/installations/new?state=${state}`,
    completeInstallation: async (installationId) => {
      if (installationId === 'bad') throw new Error('GitHub App auth: installation-token request failed');
      return { token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z' };
    },
    listBoards: async (_token, login) => ([
      { login, number: 5, title: 'Roadmap', url: 'u', shortDescription: null, closed: false },
    ]),
    // Already-installed re-bind seam (LIN-735): the callback exchanges the OAuth
    // `code` for a DISCOVERY-only user token, then enumerates the user's boards.
    completeAuth: async (code) => {
      if (code === 'bad') throw new Error('bad_verification_code');
      return { access_token: 'gho_user' };
    },
    listReboundableBoards: async () => ([
      { login: 'octocat', number: 5, title: 'Roadmap', url: 'u', shortDescription: null, closed: false, installationId: '77' },
    ]),
    // LIN-1329: the human GitHub identity, resolved from the discovery user
    // token — shared with GitHub Issues (Q3), distinct from the installation
    // account (`userId` above).
    fetchViewer: async () => ({ id: 'human-42', login: 'octocat', name: 'The Octocat' }),
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

// The route guards gate on the COMPLETE GitHub config (LIN-761) — the shared App
// vars plus the OAuth client_id/secret — byte-symmetric with routes/github-auth.js.
const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];

describe('GitHub Projects auth routes', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM; // real PEM shape (LIN-2081) — getAppConfig validates it even on the slug-only install-URL path
    process.env.GITHUB_APP_SLUG = 'my-app';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // LIN-1329: every route the router mounts now threads accountStore/
  // accountWorkspaceStore into `establishAccount` — real MangoDB-backed
  // stores (fresh per test), same precedent as tests/unit/account-store.test.js.
  let dbClient;
  let dbDir;
  let acctCounter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'github-projects-auth-route-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });
  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  function freshAccountStores() {
    const db = dbClient.db(`acct_${acctCounter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  test('GET /auth/github-projects 503s when GitHub App env is not configured', async () => {
    delete process.env.GITHUB_APP_ID;
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    await handler({ query: {}, session: makeSession() }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
  });

  // LIN-2081 review finding 4 — byte-symmetric with github-auth.js: the front
  // gate now uses the WIDER predicate (getGitHubConfigProblems), so a
  // shape-invalid-but-present key 503s at the very first gate.
  test('GET /auth/github-projects 503s when GITHUB_APP_PRIVATE_KEY is set but not a valid PEM (LIN-2081 finding 4)', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'not-a-pem';
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    await handler({ query: {}, session: makeSession() }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
    assert.match(res.body, /GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key/);
  });

  // LIN-761 — partial config (App vars present, GITHUB_CLIENT_ID absent) returns a
  // clean up-front 503, never hangs in beginAuth. Byte-symmetric with Issues.
  test('GET /auth/github-projects 503s (never hangs) on a partial config: App vars set, GITHUB_CLIENT_ID absent (LIN-761)', async () => {
    delete process.env.GITHUB_CLIENT_ID;
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: {}, session }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
    assert.match(res.body, /GITHUB_CLIENT_ID/);
    assert.equal(res.redirectedTo, null);
    assert.equal(session.oauthState, undefined);
  });

  // LIN-761 root cause A — throw-safe begin: a throw from beginAuth is caught
  // before session.save, yielding a clean 503 rather than an escaped async throw.
  test('GET /auth/github-projects is throw-safe out of session.save when beginAuth throws (LIN-761)', async () => {
    let saveCalled = false;
    const throwingProvider = {
      ...fakeProvider(),
      beginAuth: () => { throw new Error('boom from beginAuth'); },
    };
    const router = createGitHubProjectsAuthRoutes({ provider: throwingProvider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    const origSave = session.save;
    session.save = function (cb) { saveCalled = true; return origSave.call(this, cb); };
    await handler({ query: {}, session }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.redirectedTo, null);
    assert.equal(saveCalled, false);
  });

  test('GET /auth/github-projects mints state, stores intent server-side, and redirects', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
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
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source', workspace: 'acme' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github-projects', workspaceUrlKey: 'acme' });
    assert.ok(!res.redirectedTo.includes('acme'), 'urlKey rides in session, not opaque state');
  });

  test('GET callback rejects a mismatched state (CSRF guard)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '42', state: 'attacker' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('GET callback mints from installation_id and renders the board picker, holding the token in session', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
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
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'github-projects', workspaceUrlKey: 'acme' } });
    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);
    assert.equal(session.githubProjectsPending.workspaceUrlKey, 'acme');
  });

  test('GET callback (re-bind) exchanges the code, enumerates boards, and stashes a rebind pending WITHOUT the user token (LIN-735)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github-projects' } });
    // Already-installed App round-trips a `code`, no installation_id.
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    // Same board picker, rendered from the enumerated boards.
    assert.match(res.body, /Roadmap/);
    assert.match(res.body, /github-projects-board-form/);
    assert.match(res.body, /value="octocat\/5"/);
    // Pending carries ONLY a board->installationId map (server-side resolution at link).
    assert.deepEqual(session.githubProjectsPending, { rebind: true, mode: 'new', boardInstallations: { 'octocat/5': '77' } });
    // The discovery user token is never stored on the session.
    assert.ok(!JSON.stringify(session.githubProjectsPending).includes('gho_user'));
  });

  test('GET callback (re-bind) carries the viewed-workspace urlKey from intent into the rebind pending (LIN-541 + LIN-735)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'github-projects', workspaceUrlKey: 'acme' } });
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    assert.deepEqual(session.githubProjectsPending, { rebind: true, mode: 'add-source', boardInstallations: { 'octocat/5': '77' }, workspaceUrlKey: 'acme' });
  });

  test('GET callback (re-bind) with NO installations falls through to the install URL (LIN-735)', async () => {
    const provider = { ...fakeProvider(), listReboundableBoards: async () => [] };
    const router = createGitHubProjectsAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } });
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    assert.equal(res.redirectedTo, 'https://github.com/apps/my-app/installations/new?state=real');
    assert.equal(session.githubProjectsPending, undefined, 'no rebind pending stashed when there is nothing to pick');
  });

  test('GET callback (re-bind) responds with a clean 503 instead of hanging when beginInstall throws on a malformed key (LIN-2081 review finding 3)', async () => {
    // Byte-symmetric with the github-auth.js test of the same name: beginInstall()
    // throws (as the REAL buildInstallUrl() does when GITHUB_APP_PRIVATE_KEY is
    // shape-invalid, since it calls getAppConfig() unconditionally for `slug`).
    // Before finding 3's fix this call site was UNGUARDED inside an async Express
    // handler, so the throw would hang the request with NO response rather than
    // surface this clean 503.
    const provider = {
      ...fakeProvider(),
      listReboundableBoards: async () => [],
      beginInstall: () => { throw new Error("GitHub App auth: GITHUB_APP_PRIVATE_KEY ends with stray characters after the END line: '%'") },
    };
    const router = createGitHubProjectsAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } });
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    assert.equal(res.statusCode, 503, 'must respond, not hang');
    assert.match(res.body, /GitHub App Not Configured/);
    assert.match(res.body, /GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key/);
    assert.equal(res.redirectedTo, null, 'must not redirect to a broken install URL');
  });

  test('GET callback (re-bind) surfaces a clean 400 when the code exchange fails (LIN-735)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { code: 'bad', state: 'real' }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
  });

  test('GET callback 400s when installation_id is missing (setup_action=request)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { setup_action: 'request', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Installation Incomplete/);
    assert.match(res.body, /admin to approve/);
  });

  test('GET callback surfaces a clean 400 when the installation-token mint fails', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { installation_id: 'bad', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
  });

  test('POST link (new) find-or-creates the GitHub account container and writes the LIN-711 binding', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
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

    // LIN-1329: the 5th sign-in path's actual deliverable — session.accountId
    // set, exactly one durable account minted, the sign-up provider (`github`,
    // keyed on the human GitHub user id, never the installation account) linked
    // as its first identity.
    assert.ok(session.accountId, 'session.accountId set by establishAccount');
    const account = await accountStore.getAccount(session.accountId);
    assert.ok(account, 'account was actually persisted');
    assert.deepEqual(account.identities, [{ provider: 'github', scope: 'human-42', credentials: { login: 'octocat' } }]);
    const workspaces = await accountWorkspaceStore.listWorkspacesForAccount(session.accountId);
    assert.deepEqual(workspaces, ['github:42']);
  });

  // LIN-1349: at MAX_WORKSPACES, the upsertWorkspace limit check must run BEFORE
  // establishAccount, so a refused new-container sign-in never gets a durable
  // account↔workspace binding written for it.
  test('POST link (new), at the workspace limit, is rejected 400 and writes NO account↔workspace binding (LIN-1349)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const existingWorkspaces = Array.from({ length: 10 }, (_, i) => ({ id: `ws-${i}`, name: `Workspace ${i}`, urlKey: `ws-${i}` }));
    const session = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: existingWorkspaces,
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Workspace Limit Reached/);
    // The crux: establishAccount never ran, so no binding exists for the refused workspace.
    assert.deepEqual(await accountWorkspaceStore.listAccountsForWorkspace('github:42'), []);
    assert.equal(session.accountId, undefined);
  });

  test('POST link (new) a returning GitHub Projects user (fresh session, previously-seen human id) lands on their EXISTING account, not a new one', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');

    const firstSession = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' } , session: firstSession }, makeRes());
    const firstAccountId = firstSession.accountId;
    assert.ok(firstAccountId);

    // A brand-new session (logged out / new device) signing in with the SAME
    // GitHub human identity.
    const secondSession = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' }, session: secondSession }, makeRes());

    assert.strictEqual(secondSession.accountId, firstAccountId);
    const account = await accountStore.getAccount(firstAccountId);
    assert.equal(account.identities.length, 1, 'still exactly one identity, not re-minted');
  });

  // LIN-2267 (class fix of LIN-2233's L2.1, applied to the GitHub Projects
  // sibling): mode:'new' regenerates the session, and until this fix that
  // regenerate unconditionally wiped session.accountId — so a session
  // already holding a live account that then front-doors with a BRAND-NEW
  // GitHub identity always took the mint branch instead of linking onto the
  // live account, forking a second account. Mirrors
  // tests/unit/account-identity.test.js's "L6 test 1 — fork-prevention" and
  // tests/unit/github-auth.test.js's sibling GitHub Issues coverage.
  test('POST link (new) carries session.accountId across the fixation-preventing regenerate — a brand-new GitHub identity links onto the LIVE account instead of forking a second one (LIN-2267)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');

    // First front-door login mints account A.
    const session = makeSession({
      githubHumanId: 'human-A',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' }, session }, makeRes());
    const accountIdAfterA = session.accountId;
    assert.ok(accountIdAfterA, 'account A minted and carried into the session');

    // Second front-door login, SAME session, a BRAND-NEW GitHub identity
    // (different human, different installation account) — the live
    // accountId must survive session.regenerate() and this identity must
    // link onto it, not mint a second account.
    session.githubHumanId = 'human-B'
    session.githubProjectsPending = { token: 'ghs_inst2', mode: 'new', login: 'octofriend', userId: '99', installationId: '88', tokenExpiresAt: '2026-06-25T20:00:00Z' }
    const res = makeRes();
    await handler({ body: { board: 'octofriend/7' }, session }, res);

    assert.equal(res.redirectedTo, '/workspace/octofriend/');
    assert.strictEqual(session.accountId, accountIdAfterA, 'session.accountId unchanged across the second front-door login — no fork');
    assert.equal(session.workspaces.length, 2, 'both workspace containers present (existingWorkspaces carried across regenerate too)');
    const account = await accountStore.getAccount(accountIdAfterA);
    assert.strictEqual(account.identities.length, 2, 'both GitHub identities attached to the ONE account');
    assert.ok(account.identities.some(i => i.scope === 'human-A'));
    assert.ok(account.identities.some(i => i.scope === 'human-B'));
  });

  // LIN-2267 amendment (review F1 + F2), the GitHub Projects sibling of
  // github-auth.test.js's equivalent: the accountId-carry above makes an
  // `unknown-account` conflict reachable on THIS branch for the first time —
  // before the carry, regenerate() always wiped session.accountId, so
  // establishAccount's stale-id branch could never fire here. Now that it IS
  // reachable, this branch must apply the same post-conflict hygiene
  // routes/auth.js's respondToAccountConflict already applies (LIN-2266):
  // clear the stale accountId/freshness stamp/OAuth state, and restore
  // session.workspaces to its pre-login snapshot.
  test('POST link (new) clears the stale accountId and restores session.workspaces on an unknown-account 409, so the retry is not a permanent lockout (LIN-2267 F1/F2)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      accountId: 'acct-DELETED',
      identityAuthenticatedAt: Date.now(),
      oauthState: 'state-abc',
      oauthIntent: { mode: 'new' },
      githubHumanId: 'human-new',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octonew', userId: '777', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [linearWs],
    });
    await handler({ body: { board: 'octonew/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Account Conflict/);
    assert.equal(session.accountId, undefined, 'stale accountId cleared');
    assert.equal(session.identityAuthenticatedAt, undefined, 'freshness stamp cleared');
    assert.equal(session.oauthState, undefined, 'OAuth state cleared');
    assert.equal(session.oauthIntent, undefined, 'OAuth intent cleared');
    assert.deepEqual(session.workspaces, [linearWs], 'session.workspaces restored to its pre-login snapshot');
    assert.ok(!JSON.stringify(session.workspaces).includes('ghs_inst'), 'the arriving credential does not leak into the session');
  });

  // === LIN-2304: mode:'new' regenerate branch reaches the shared merge offer ===
  // Mirrors tests/unit/github-auth.test.js's equivalent coverage. GitHub App
  // (Issues) and GitHub Projects share ONE identity provider ('github'), so
  // the offer's identityLabel says "GitHub", never "GitHub Projects".

  test('POST link (new) reaches the shared merge offer — not the old dead-end 409 — when the GitHub identity already belongs to a DIFFERENT account, preserving session.accountId as the canonical id (LIN-2304)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const canonicalAccount = await accountStore.createAccount();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'github', 'human-other', {});

    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const session = makeSession({
      accountId: canonicalAccount._id,
      identityAuthenticatedAt: Date.now(),
      githubHumanId: 'human-other',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    const res = makeRes();
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Merge these accounts\?/, 'the shared merge offer, not the old dead-end "Account Conflict" page');
    assert.match(res.body, /This GitHub account/, 'identityLabel says GitHub, not GitHub Projects — one shared identity provider');
    assert.ok(session.pendingMerge, 'a pending merge offer is stored — but nothing written yet');
    assert.strictEqual(session.pendingMerge.canonicalAccountId, canonicalAccount._id, 'canonicalAccountId is session.accountId — never undefined');
    assert.strictEqual(session.pendingMerge.mergedAccountId, otherAccount._id);
    assert.strictEqual(session.accountId, canonicalAccount._id, 'session.accountId (the canonical id) is preserved, not cleared');
    assert.strictEqual((await accountStore.getAccount(canonicalAccount._id)).mergedInto, undefined, 'nothing written yet — offer only');
    assert.strictEqual((await accountStore.getAccount(otherAccount._id)).mergedInto, undefined);
  });

  test('POST link (new) refuses a one-click merge and offers re-auth instead when the canonical session is LIVE but STALE (LIN-2304)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const canonicalAccount = await accountStore.createAccount();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'github', 'human-other', {});

    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const session = makeSession({
      accountId: canonicalAccount._id,
      identityAuthenticatedAt: Date.now() - 60 * 60 * 1000,
      githubHumanId: 'human-other',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    const res = makeRes();
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Sign in again to confirm/);
    assert.strictEqual(session.pendingMerge, undefined, 'no pending merge is offered when the canonical side is not fresh');
    assert.strictEqual((await accountStore.getAccount(canonicalAccount._id)).mergedInto, undefined);
    assert.strictEqual((await accountStore.getAccount(otherAccount._id)).mergedInto, undefined);
  });

  // Mirrors tests/unit/github-auth.test.js's add-source conflict test — the
  // GitHub Projects half of the LIN-1329 review's finding 2 (the auth-route.test.js
  // note claims this file's add-source mode covers the conflict branch).
  test('POST link (add-source) returns 409 Account Conflict when the GitHub identity already belongs to a DIFFERENT account, and writes nothing', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'github', 'human-42', {});
    const myAccount = await accountStore.createAccount();

    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      accountId: myAccount._id,
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Account Conflict/);
    // No binding written, no pending cleared — the sign-in did not complete.
    assert.equal(linearWs.bindings, undefined);
    assert.ok(session.githubProjectsPending, 'pending NOT cleared on conflict');
    // Neither account was mutated.
    assert.strictEqual((await accountStore.getAccount(otherAccount._id)).identities.length, 1);
    assert.strictEqual((await accountStore.getAccount(myAccount._id)).identities.length, 0);
    // LIN-2300: a MERGEABLE conflict must NOT clear session.accountId — it is
    // needed by the merge-confirm flow this 409 dead-ends into today (LIN-2304).
    assert.equal(session.accountId, myAccount._id, 'session.accountId preserved on a mergeable conflict');
  });

  // LIN-2300: add-source never regenerates the session — a stale,
  // unresolvable session.accountId left uncleared here would 409 every
  // subsequent add-source attempt for as long as the session lives.
  test('POST link (add-source) clears a stale, unresolvable session.accountId on an unknown-account 409 (LIN-2300)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      accountId: 'acct-DELETED',
      identityAuthenticatedAt: Date.now(),
      oauthState: 'state-abc',
      oauthIntent: { mode: 'add-source' },
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Account Conflict/);
    assert.equal(session.accountId, undefined, 'stale accountId cleared');
    assert.equal(session.identityAuthenticatedAt, undefined, 'freshness stamp cleared');
    assert.equal(session.oauthState, undefined, 'OAuth state cleared');
    assert.equal(session.oauthIntent, undefined, 'OAuth intent cleared');
    assert.equal(linearWs.bindings, undefined, 'no binding written');
  });

  test('POST link (new) adds a board as a binding onto an EXISTING GitHub account container (coexists with Issues)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    // A container already created by the GitHub Issues login for the same account.
    const existing = {
      id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github',
      bindings: [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho' } }],
    };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [existing],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(session.workspaces.length, 1, 'no duplicate workspace created');
    assert.deepEqual(existing.bindings.map(b => `${b.provider}:${b.scope}`),
      ['github:octocat/hello-world', 'github-projects:octocat/5']);
  });

  // LIN-2300: the existing-container branch (mode 'new', re-adding a board
  // onto an already-connected GitHub container) never regenerates the
  // session either — same stale-accountId hazard as add-source above.
  test('POST link (new, existing container) clears a stale, unresolvable session.accountId on an unknown-account 409 (LIN-2300)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const existing = {
      id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github',
      bindings: [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho' } }],
    };
    const session = makeSession({
      accountId: 'acct-DELETED',
      identityAuthenticatedAt: Date.now(),
      oauthState: 'state-abc',
      oauthIntent: { mode: 'new' },
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [existing],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Account Conflict/);
    assert.equal(session.accountId, undefined, 'stale accountId cleared');
    assert.equal(session.identityAuthenticatedAt, undefined, 'freshness stamp cleared');
    assert.equal(session.oauthState, undefined, 'OAuth state cleared');
    assert.equal(session.oauthIntent, undefined, 'OAuth intent cleared');
    assert.equal(existing.bindings.length, 1, 'no new binding written');
  });

  // LIN-2300 close-out F1: the existing-container branch's `!established.conflict`
  // guard was unwitnessed — removing it made the clear unconditional and no test
  // failed. Mirrors the add-source mergeable-conflict test above, for this branch.
  test('POST link (new, existing container) returns 409 Account Conflict when the GitHub identity already belongs to a DIFFERENT account, and preserves session.accountId (LIN-2300)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'github', 'human-42', {});
    const myAccount = await accountStore.createAccount();

    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const existing = {
      id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github',
      bindings: [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho' } }],
    };
    const session = makeSession({
      accountId: myAccount._id,
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [existing],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Account Conflict/);
    assert.equal(existing.bindings.length, 1, 'no new binding written');
    // LIN-2300: a MERGEABLE conflict must NOT clear session.accountId — it is
    // needed by the merge-confirm flow this 409 dead-ends into today (LIN-2304).
    assert.equal(session.accountId, myAccount._id, 'session.accountId preserved on a mergeable conflict');
  });

  // LIN-2300 close-out — same-session self-heal: an unknown-account 409 on
  // attempt 1 must not doom every later attempt on the same session. Attempt 2,
  // after the stale id is cleared, mints and lands on a fresh account.
  test('POST link (new, existing container) self-heals: after an unknown-account 409 clears the session, a second attempt on the SAME session succeeds (LIN-2300)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const existing = {
      id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github',
      bindings: [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho' } }],
    };
    const session = makeSession({
      accountId: 'acct-DELETED',
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [existing],
    });

    const attempt1 = makeRes();
    await handler({ body: { board: 'octocat/5' }, session }, attempt1);
    assert.equal(attempt1.statusCode, 409, 'attempt 1: the stale accountId fails as before');
    assert.equal(session.accountId, undefined, 'attempt 1: stale accountId cleared, opening the door to a retry');

    session.githubProjectsPending = { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' };
    const attempt2 = makeRes();
    await handler({ body: { board: 'octocat/6' }, session }, attempt2);

    assert.equal(attempt2.redirectedTo, '/workspace/octocat/', 'attempt 2: succeeds and redirects');
    assert.ok(session.accountId, 'attempt 2: a fresh accountId is established on the same session');
    const account = await accountStore.getAccount(session.accountId);
    assert.ok(account, 'attempt 2: the newly established account is real and durable');
    assert.equal(existing.bindings.length, 2, 'attempt 2: the retried binding is written');
  });

  test('POST link (add-source) binds onto the VIEWED workspace without clobbering its primary', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const viewedWs = { id: 'org-a', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_a' };
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubHumanId: 'human-42',
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

  test('POST link (re-bind, new) mints the installation token for the chosen board and writes the LIN-711 binding (LIN-735)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { rebind: true, mode: 'new', boardInstallations: { 'octocat/5': '77' } },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(session.workspaces.length, 1);
    const ws = session.workspaces[0];
    // Identity comes from completeInstallation (installation account), like the install path.
    assert.equal(ws.id, 'github:42');
    const expectedExpiry = Date.parse('2026-06-25T20:00:00Z');
    // Persisted credential is an INSTALLATION token for the board's resolved installation (77).
    assert.deepEqual(ws.bindings, [{ provider: 'github-projects', scope: 'octocat/5', credentials: { installationId: '77', token: 'ghs_inst', tokenExpiresAt: expectedExpiry } }]);
    assert.ok(!JSON.stringify(session.workspaces).includes('gho_user'), 'discovery user token is never persisted');
    assert.equal(session.githubProjectsPending, undefined, 'pending cleared');
    assert.equal(res.redirectedTo, '/workspace/octocat/');
  });

  test('POST link (re-bind, add-source) mints + binds onto the viewed workspace without clobbering its primary (LIN-735)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { rebind: true, mode: 'add-source', boardInstallations: { 'octocat/5': '77' } },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    const binding = linearWs.bindings.find(b => b.provider === 'github-projects');
    assert.deepEqual(binding.credentials, { installationId: '77', token: 'ghs_inst', tokenExpiresAt: Date.parse('2026-06-25T20:00:00Z') });
    assert.equal(linearWs.provider, 'linear', 'non-active re-add must not clobber the active scalar mirror');
    assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=github-projects');
  });

  test('POST link (re-bind) rejects a board that is not in the enumerated installation map (LIN-735)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { rebind: true, mode: 'new', boardInstallations: { 'octocat/5': '77' } },
      workspaces: [],
    });
    // A well-formed board slug the user never had enumerated — must not mint anything.
    await handler({ body: { board: 'octocat/9' }, session }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Invalid Project Board/);
    assert.equal(session.workspaces.length, 0);
  });

  test('POST link rejects a non-numeric board slug (must be org/projectNumber, not owner/repo)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({ githubHumanId: 'human-42', githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' }, workspaces: [] });
    await handler({ body: { board: 'octocat/hello-world' }, session }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Invalid Project Board/);
    assert.equal(session.workspaces.length, 0);
  });

  test('POST link surfaces a clean error when the installation expiry is missing/unparseable', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99' },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Something Went Wrong/);
    assert.equal(session.workspaces.length, 0, 'no binding written from a bad expiry');
  });

  test('POST link rejects when there is no pending GitHub Projects session', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    await handler({ body: { board: 'octocat/5' }, session: makeSession() }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  // LIN-1350: a throw inside the post-regenerate callback (e.g. the prefs
  // store down) used to resolve the wrapper promise via `finally` with no
  // response ever sent, surfacing only as an unhandledRejection. The new
  // `catch` arm must render this route's own 500 page (with the GitHub
  // diagnostic threaded in) instead of hanging.
  test('POST link: a throw inside the post-regenerate callback (prefs store down) responds 500, not a hang (LIN-1350)', async () => {
    const router = createGitHubProjectsAuthRoutes({
      provider: fakeProvider(),
      userPreferencesStore: { getUserPreferences: async () => { throw new Error('prefs store down') } },
      ...freshAccountStores(),
    });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body && /Could not link your GitHub project board/.test(res.body));
    assert.strictEqual(res.redirectedTo, null);
  });

  // ---------------------------------------------------------------------------
  // LIN-2397 stage A — characterization tests for gaps enumerated by the
  // research comment (§3): none of these change production behavior; each one
  // pins a branch the extraction in stage B must preserve byte-for-byte.
  // Byte-symmetric with the mirrored tests added to tests/unit/github-auth.test.js,
  // plus three gaps that are unique to this file (github-auth already covers them).
  // ---------------------------------------------------------------------------

  test('GET callback 400s Session Expired when state is missing entirely (not just mismatched) [LIN-2397 gap: missing state]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '42' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('GET callback 400s Installation Cancelled with the cancellation copy when error=access_denied [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { error: 'access_denied' }, session: makeSession() }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Installation Cancelled/);
    assert.match(res.body, /You cancelled the GitHub App installation request\./);
    assert.match(res.body, /href="\/auth\/github-projects"/);
  });

  test('GET callback 400s Installation Cancelled with the raw error value interpolated for a non-access_denied error [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { error: 'server_error' }, session: makeSession() }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Installation Cancelled/);
    assert.match(res.body, /GitHub App installation failed: server_error/);
  });

  test('GET callback (install path) 500s Connection Error when listBoards fails [LIN-2397 gap]', async () => {
    const provider = { ...fakeProvider(), listBoards: async () => { throw new Error('boom') } };
    const router = createGitHubProjectsAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '99', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Connection Error/);
    assert.match(res.body, /Could not fetch your project boards from GitHub/);
  });

  test('GET callback (re-bind) 400s "Could not verify your GitHub account" when fetchViewer fails [LIN-2397 gap]', async () => {
    const provider = { ...fakeProvider(), fetchViewer: async () => { throw new Error('viewer lookup failed') } };
    const router = createGitHubProjectsAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { code: 'oauth-code', state: 'real' }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
    assert.match(res.body, /Could not verify your GitHub account/);
  });

  test('GET callback (install path) 500s Something Went Wrong from the outer catch on an unexpected post-mint failure [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real' });
    session.save = () => { throw new Error('session store unavailable') };
    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Something Went Wrong/);
    assert.match(res.body, /An unexpected error occurred during GitHub authentication/);
  });

  test('GET /auth/github-projects defaults mode to "new" in the session intent when ?mode is absent [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: {}, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'new', provider: 'github-projects' });
  });

  test('GET /auth/github-projects defaults mode to "new" in the session intent when ?mode is garbage [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'nonsense' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'new', provider: 'github-projects' });
  });

  test('GET callback defaults pending.mode to "new" when oauthIntent.mode is absent [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { provider: 'github-projects' } });
    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);
    assert.equal(session.githubProjectsPending.mode, 'new');
  });

  test('GET callback defaults pending.mode to "new" when oauthIntent.mode is garbage [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'nonsense', provider: 'github-projects' } });
    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);
    assert.equal(session.githubProjectsPending.mode, 'new');
  });

  // --- Gaps unique to this file (github-auth.test.js already covers the
  // Issues-router equivalent of each) ---

  test('GET callback (re-bind) keeps the CSRF state guard (mismatched state rejected before code exchange) [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { code: 'oauth-code', state: 'attacker' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('GET callback surfaces GitHub’s real error detail + HTTP status in the page diagnostic, byte-symmetric with github-auth.js (LIN-746) [LIN-2397 gap]', async () => {
    const err = new Error('GitHub API POST /app/installations/99/access_tokens failed: Resource not accessible by integration');
    err.status = 403;
    const provider = { ...fakeProvider(), completeInstallation: async () => { throw err; } };
    const router = createGitHubProjectsAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '99', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/, 'generic friendly headline preserved');
    assert.match(res.body, /error-details/, 'diagnostic block rendered');
    assert.match(res.body, /Resource not accessible by integration/, 'GitHub’s real cause is surfaced');
    assert.match(res.body, /GITHUB_403/, 'the HTTP status is surfaced');
  });

  test('GET /auth/github-projects (add-source) ignores a malformed workspace query param [LIN-2397 gap]', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source', workspace: 'not a valid key!' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github-projects' });
  });

  // LIN-2397 stage A, review finding (ledger item 1) — the Projects half, and the
  // site the review actually cross-wired to prove the hole: `reauthUrl` at
  // routes/github-projects-auth.js's respondToAccountConflict call was pinned by
  // NOTHING, so pointing it at the Issues router's '/auth/github' left the whole
  // 9058-test suite green, byte-parity goldens included. The existing merge-offer
  // tests assert only `/This GitHub account/` — identityLabel copy that is
  // deliberately identical on both surfaces — so they prove the branch is reached
  // and nothing about which surface's URL it emits.
  test('POST link (new) reauth-required page links back to THIS surface\'s own reauthUrl, never the sibling router\'s [LIN-2397 gap: reauthUrl]', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const canonicalAccount = await accountStore.createAccount();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'github', 'human-other', {});

    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github-projects/link');
    const session = makeSession({
      accountId: canonicalAccount._id,
      // Stale — well outside the 10-minute fresh-auth window — which is what
      // routes this mergeable conflict to renderMergeReauthRequiredPage.
      identityAuthenticatedAt: Date.now() - 60 * 60 * 1000,
      githubHumanId: 'human-other',
      githubProjectsPending: { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    const res = makeRes();
    await handler({ body: { board: 'octocat/5' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Sign in again to confirm/, 'the reauth-required arm was reached');
    assert.match(res.body, /<a href="\/auth\/github-projects" class="login-button">Sign in again<\/a>/,
      'the Projects surface sends the user back to its OWN base path');
    // The negative is the assertion that actually catches the cross-wire: the
    // Issues base path is a strict prefix of this one, so only the closing quote
    // distinguishes them.
    assert.doesNotMatch(res.body, /href="\/auth\/github"/,
      'never the GitHub Issues sibling\'s base path');
  });

  // === LIN-2499: the CSRF nonce's post-success lifetime ===
  // Mirrors the Issues-surface block in github-auth.test.js. The clear itself is
  // shared (lib/github-install-flow.js since LIN-2397 stage B); these pin that
  // BOTH surfaces get it, so a future de-sharing of the flow goes red here.

  test('GET callback (install path) consumes oauthState/oauthIntent once the picker renders (LIN-2499)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github-projects' } });
    const res = makeRes();

    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);

    assert.match(res.body, /github-projects-board-form/, 'the picker still renders');
    assert.equal(session.oauthState, undefined);
    assert.equal(session.oauthIntent, undefined);
    assert.equal(session.githubProjectsPending.mode, 'new');
  });

  test('GET callback (re-bind path) consumes oauthState/oauthIntent once the picker renders (LIN-2499)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'github-projects', workspaceUrlKey: 'acme' } });
    const res = makeRes();

    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);

    assert.match(res.body, /github-projects-board-form/, 'the picker still renders');
    assert.equal(session.oauthState, undefined);
    assert.equal(session.oauthIntent, undefined);
    assert.equal(session.githubProjectsPending.workspaceUrlKey, 'acme', 'the add-source target still rides in pending');
  });

  test('a replayed callback with the already-consumed nonce gets the 400 Session Expired page, not a second picker (LIN-2499)', async () => {
    const router = createGitHubProjectsAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github-projects' } });

    const first = makeRes();
    await handler({ query: { installation_id: '99', state: 'real' }, session }, first);
    assert.match(first.body, /github-projects-board-form/);

    const replay = makeRes();
    await handler({ query: { installation_id: '99', state: 'real' }, session }, replay);

    assert.equal(replay.statusCode, 400);
    assert.match(replay.body, /Session Expired/);
    assert.doesNotMatch(replay.body, /github-projects-board-form/, 'the flow did not re-run');
  });

  test('GET callback KEEPS the nonce on the no-installations beginInstall hop (LIN-2499 boundary)', async () => {
    const provider = { ...fakeProvider(), listReboundableBoards: async () => [] };
    const router = createGitHubProjectsAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects/callback');
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github-projects' } });
    const res = makeRes();

    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);

    assert.match(res.redirectedTo, /installations\/new\?state=real/, 'the install hop carries the same nonce');
    assert.equal(session.oauthState, 'real', 'the nonce survives for the return trip');
    assert.deepEqual(session.oauthIntent, { mode: 'new', provider: 'github-projects' });
  });

});
