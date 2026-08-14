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
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { AuthExchangeError } from '../../lib/providers/interface.js';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { githubErrorDiagnostic } from '../../lib/errors.js';
import { getMissingGitHubConfig, getGitHubConfigProblems, isGitHubConfigured } from '../../lib/providers/github/app-auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

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
    // GitHub App config (LIN-708). beginAuth ITSELF no longer reads getAppConfig()
    // (LIN-735 turned it into a pure OAuth-authorize-URL builder off CLIENT_ID
    // alone), so this fixture is belt-and-braces for the beginAuth tests below,
    // not load-bearing for them. It IS load-bearing for beginInstall() (LIN-2081
    // review finding 5) and completeInstallation() further down this suite — both
    // call getAppConfig() for `slug`, which validates the FULL PEM shape
    // unconditionally, so the key must be real and PEM-shaped, never a placeholder.
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
    process.env.GITHUB_APP_SLUG = 'my-app';
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('beginAuth builds the user-to-server OAuth authorize URL with opaque state (LIN-735)', () => {
    const url = new GitHubProvider().beginAuth({ state: 'nonce-123' });
    // Authorize URL now, NOT installations/new — the authorize round-trip always
    // returns a `code` even for an already-installed App (the LIN-728 dead-end fix).
    assert.ok(url.startsWith('https://github.com/login/oauth/authorize?'),
      `expected OAuth authorize URL, got ${url}`);
    const params = new URL(url).searchParams;
    // state passes through unchanged as an opaque nonce.
    assert.equal(params.get('state'), 'nonce-123');
    // The App identifies itself by its OAuth client_id, and the redirect_uri is the
    // Issues callback.
    assert.equal(params.get('client_id'), 'cid');
    assert.equal(params.get('redirect_uri'), 'http://localhost:3000/auth/github/callback');
    // `scope` is still dropped entirely — App permissions declare access, so keeping
    // `repo` would resurrect the over-grant the App migration fixes (security M1, LIN-683).
    assert.equal(params.get('scope'), null);
    assert.doesNotMatch(url, /scope=/);
  });

  test('beginAuth throws when GITHUB_CLIENT_ID is unset (LIN-735)', () => {
    delete process.env.GITHUB_CLIENT_ID;
    assert.throws(() => new GitHubProvider().beginAuth({ state: 'nonce-123' }), /GITHUB_CLIENT_ID/);
  });

  test('beginInstall builds the App installation URL; throws without GITHUB_APP_SLUG (LIN-735)', () => {
    const url = new GitHubProvider().beginInstall({ state: 'nonce-123' });
    // The fresh-install / no-installation fallback still targets installations/new.
    assert.ok(url.startsWith('https://github.com/apps/my-app/installations/new?'),
      `expected App install URL, got ${url}`);
    assert.equal(new URL(url).searchParams.get('state'), 'nonce-123');
    delete process.env.GITHUB_APP_SLUG;
    assert.throws(() => new GitHubProvider().beginInstall({ state: 'n' }), /GITHUB_APP_SLUG/);
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

  test('listReboundableRepos flattens the user installations + their repos with installationId (LIN-728)', async () => {
    const provider = new GitHubProvider();
    const fake = createFakeGitHubClient({
      _installations: [
        { id: 77, account: { login: 'octocat' }, repositories: [
          { full_name: 'octocat/hello-world', private: false },
          { full_name: 'octocat/secret', private: true },
        ] },
        { id: 88, account: { login: 'acme' }, repositories: [
          { full_name: 'acme/widgets', private: false },
        ] },
      ],
    });
    provider._clientForToken = () => fake; // inject the fake instead of a real HTTP client

    const repos = await provider.listReboundableRepos('gho_user');
    // Flattened across BOTH installations, each repo tagged with its installationId
    // so the link step can mint the right installation token server-side.
    assert.deepEqual(repos, [
      { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: '77' },
      { slug: 'octocat/secret', name: 'octocat/secret', private: true, installationId: '77' },
      { slug: 'acme/widgets', name: 'acme/widgets', private: false, installationId: '88' },
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
// Shared config predicate (LIN-761) — the SINGLE definition of "GitHub configured"
// consumed by the route guards, the settings add affordance, and the landing hero,
// so those three consumers can never drift (root cause C).
// ---------------------------------------------------------------------------

describe('getMissingGitHubConfig / getGitHubConfigProblems / isGitHubConfigured (LIN-761; PEM-shape-aware since LIN-2081 finding 4)', () => {
  const ALL = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  // GITHUB_REDIRECT_URI is optional — it must NOT gate configuration.
  const SAVE = [...ALL, 'GITHUB_REDIRECT_URI'];
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(SAVE.map(k => [k, process.env[k]]));
    for (const k of ALL) process.env[k] = 'set';
    // GITHUB_APP_PRIVATE_KEY is the one var isGitHubConfigured() now shape-checks
    // (LIN-2081 finding 4), so — unlike its bare-presence siblings above — it
    // needs a real PEM, not the 'set' placeholder, or the "reports configured"
    // case below would report false for the wrong reason.
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
    delete process.env.GITHUB_REDIRECT_URI;
  });
  afterEach(() => {
    for (const k of SAVE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('reports configured when the FULL env set is present (REDIRECT_URI not required)', () => {
    assert.deepEqual(getMissingGitHubConfig(), []);
    assert.equal(isGitHubConfigured(), true);
  });

  test('a partial config (App vars set, GITHUB_CLIENT_ID + SECRET absent) is NOT configured — the exact prod hang class', () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    assert.deepEqual(getMissingGitHubConfig(), ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']);
    assert.equal(isGitHubConfigured(), false);
  });

  test('a missing App var alone is also NOT configured', () => {
    delete process.env.GITHUB_APP_SLUG;
    assert.deepEqual(getMissingGitHubConfig(), ['GITHUB_APP_SLUG']);
    assert.equal(isGitHubConfigured(), false);
  });

  // -------------------------------------------------------------------------
  // LIN-2081 review finding 4 — a PRESENT-but-malformed GITHUB_APP_PRIVATE_KEY
  // must not report "configured": getAppConfig() rejects it unconditionally
  // (including on paths, like the install-URL build, that never sign with
  // it), so promising the flow can complete is the exact LIN-761 root-cause-C
  // drift this predicate exists to prevent.
  // -------------------------------------------------------------------------

  test('a shape-invalid GITHUB_APP_PRIVATE_KEY is NOT configured, even though nothing is literally unset', () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'not-a-pem';
    // getMissingGitHubConfig() keeps its narrower "what's unset" contract — the
    // var IS set, so it reports nothing missing. isGitHubConfigured() is the
    // wider predicate that must still catch this.
    assert.deepEqual(getMissingGitHubConfig(), []);
    assert.equal(isGitHubConfigured(), false);
  });

  test('getGitHubConfigProblems() names the shape defect distinctly from a missing var', () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'not-a-pem';
    assert.deepEqual(getGitHubConfigProblems(), ['GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key']);
  });

  test('a missing var takes precedence over a shape check that would be meaningless without it', () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'not-a-pem';
    delete process.env.GITHUB_APP_SLUG;
    assert.deepEqual(getGitHubConfigProblems(), ['GITHUB_APP_SLUG']);
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
    // beginAuth is the authorize URL (LIN-735); beginInstall is the no-installation
    // fallback the callback redirects to.
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`,
    beginInstall: ({ state }) => `https://github.com/apps/my-app/installations/new?state=${state}`,
    // The App-flow acquisition seam (LIN-709): mint installation token + resolve
    // the installation account identity. The route drives this; the network lives
    // behind it (covered by the provider-primitive tests above).
    completeInstallation: async (installationId) => {
      if (installationId === 'bad') throw new Error('GitHub App auth: installation-token request failed');
      return { token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z' };
    },
    listRepos: async () => ([{ slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false }]),
    // Already-installed re-bind seam (LIN-728): the callback exchanges the OAuth
    // `code` for a DISCOVERY-only user token, then enumerates the user's repos.
    completeAuth: async (code) => {
      if (code === 'bad') throw new AuthExchangeError('bad_verification_code', 'github');
      return { access_token: 'gho_user' };
    },
    listReboundableRepos: async () => ([
      { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: '77' },
    ]),
    // LIN-1329: the human GitHub identity, resolved from the discovery user
    // token — distinct from the installation account (`userId` above).
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
      // Mirror express-session: wipe data fields, keep the methods.
      for (const k of Object.keys(this)) {
        if (typeof this[k] !== 'function') delete this[k];
      }
      cb();
    },
  };
  return session;
}

// The route guards gate on the COMPLETE GitHub config the flow consumes end-to-end
// (LIN-761): the GITHUB_APP_* install/mint vars AND the OAuth client_id/secret the
// authorize begin + code exchange need. A partial config no longer sails past to a
// hanging beginAuth — it returns a clean 503 up front.
const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];

describe('GitHub auth routes', () => {
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
  // stores (fresh per test) rather than a hand-rolled fake, same precedent
  // as tests/unit/account-store.test.js.
  let dbClient;
  let dbDir;
  let acctCounter = 0;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'github-auth-route-'));
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

  test('GET /auth/github 503s when GitHub App env is not configured', async () => {
    delete process.env.GITHUB_APP_ID;
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    await handler({ query: {}, session: makeSession() }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
  });

  // LIN-2081 review finding 4 — the front gate now uses the WIDER predicate
  // (getGitHubConfigProblems), so a shape-invalid-but-present key 503s here at
  // the very first gate, never letting the request start down a flow that
  // cannot complete.
  test('GET /auth/github 503s when GITHUB_APP_PRIVATE_KEY is set but not a valid PEM (LIN-2081 finding 4)', async () => {
    process.env.GITHUB_APP_PRIVATE_KEY = 'not-a-pem';
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    await handler({ query: {}, session: makeSession() }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
    assert.match(res.body, /GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key/);
  });

  // LIN-761 — partial config (App vars present, OAuth CLIENT_ID absent) used to
  // sail past the App-only guard and throw in beginAuth INSIDE session.save,
  // hanging until the platform H12 killed the request at 30s. The complete gate
  // (getMissingGitHubConfig over the full set) now returns a clean 503 up front.
  test('GET /auth/github 503s (never hangs) on a partial config: App vars set, GITHUB_CLIENT_ID absent (LIN-761)', async () => {
    delete process.env.GITHUB_CLIENT_ID;
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: {}, session }, res);
    // Clean up-front 503 with the missing var named — NOT a redirect, NOT a hang.
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /GitHub App Not Configured/);
    assert.match(res.body, /GITHUB_CLIENT_ID/);
    assert.equal(res.redirectedTo, null);
    // The gate short-circuits before any session mutation.
    assert.equal(session.oauthState, undefined);
  });

  // LIN-761 root cause A — defense-in-depth: even with a complete config, a throw
  // from beginAuth must be caught BEFORE session.save, never escape the async
  // callback. A provider whose beginAuth throws yields a clean 503, not a hang.
  test('GET /auth/github is throw-safe out of session.save when beginAuth throws (LIN-761)', async () => {
    let saveCalled = false;
    const throwingProvider = {
      ...fakeProvider(),
      beginAuth: () => { throw new Error('boom from beginAuth'); },
    };
    const router = createGitHubAuthRoutes({ provider: throwingProvider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    const origSave = session.save;
    session.save = function (cb) { saveCalled = true; return origSave.call(this, cb); };
    await handler({ query: {}, session }, res);
    // A response is always written (503), and the redirect never fires.
    assert.equal(res.statusCode, 503);
    assert.equal(res.redirectedTo, null);
    // The throw was handled before persistence — session.save was never reached.
    assert.equal(saveCalled, false);
  });

  test('GET /auth/github mints state, stores intent server-side, and redirects', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
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
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '42', state: 'attacker' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('GET callback 400s when installation_id is missing (setup_action=request)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { setup_action: 'request', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Installation Incomplete/);
    assert.match(res.body, /admin to approve/);
  });

  test('GET /auth/github (add-source) carries a validated viewed-workspace urlKey in the intent', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source', workspace: 'acme' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github', workspaceUrlKey: 'acme' });
    // urlKey rides in the session intent, never in the opaque OAuth state.
    assert.ok(!res.redirectedTo.includes('acme'));
  });

  test('GET /auth/github (add-source) ignores a malformed workspace query param', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'add-source', workspace: 'not a valid key!' }, session }, res);
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'github' });
  });

  test('GET callback mints from installation_id and renders the repo picker, holding the token in session', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github' } });
    await handler({ query: { installation_id: '99', setup_action: 'install', state: 'real' }, session }, res);
    // Installation token + installation-account identity held in pending; installationId
    // (re-mint key) and the raw expires_at both carried for the binding-shape surface (LIN-711).
    assert.deepEqual(session.githubPending, { token: 'ghs_inst', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' });
    assert.match(res.body, /octocat\/hello-world/);
    assert.match(res.body, /github-repo-form/);
  });

  test('GET callback (add-source) carries the viewed-workspace urlKey from intent into pending', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'github', workspaceUrlKey: 'acme' } });
    await handler({ query: { installation_id: '99', state: 'real' }, session }, res);
    assert.deepEqual(session.githubPending, { token: 'ghs_inst', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z', workspaceUrlKey: 'acme' });
  });

  test('GET callback surfaces a clean 400 when the installation-token mint fails', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { installation_id: 'bad', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
  });

  // ---------------------------------------------------------------------------
  // Already-installed re-bind path (LIN-728): no fresh installation_id, an OAuth
  // `code` instead. The callback enumerates the user's installations/repos and
  // reuses the SAME picker + linkProvider seam; the link step mints an
  // installation token (never persisting the discovery user token).
  // ---------------------------------------------------------------------------

  test('GET callback (re-bind) exchanges the code, enumerates repos, and stashes a rebind pending WITHOUT the user token (LIN-728)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github' } });
    // Already-installed App round-trips a `code`, no installation_id.
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    // Same repo picker, rendered from the enumerated repos.
    assert.match(res.body, /octocat\/hello-world/);
    assert.match(res.body, /github-repo-form/);
    // Pending carries ONLY a repo->installationId map (server-side resolution at link).
    assert.deepEqual(session.githubPending, { rebind: true, mode: 'new', repoInstallations: { 'octocat/hello-world': '77' } });
    // The discovery user token is never stored on the session.
    assert.equal(session.githubPending.token, undefined);
    assert.ok(!JSON.stringify(session.githubPending).includes('gho_user'));
  });

  test('GET callback (re-bind) carries the viewed-workspace urlKey from intent into the rebind pending (LIN-541 + LIN-728)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'github', workspaceUrlKey: 'acme' } });
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    assert.deepEqual(session.githubPending, { rebind: true, mode: 'add-source', repoInstallations: { 'octocat/hello-world': '77' }, workspaceUrlKey: 'acme' });
  });

  test('GET callback (re-bind) keeps the CSRF state guard (mismatched state rejected before code exchange)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { code: 'oauth-code', state: 'attacker' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('GET callback (re-bind) surfaces a clean 400 when the code exchange fails', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { code: 'bad', state: 'real' }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
  });

  test('GET callback (re-bind) with NO installations falls through to the install URL (LIN-735)', async () => {
    // A first-time connect: the user authorized via OAuth but has never installed
    // the App, so enumeration is empty. Rather than the old dead-end empty picker,
    // send them to installations/new (reusing the CSRF nonce) to install + pick.
    const provider = { ...fakeProvider(), listReboundableRepos: async () => [] };
    const router = createGitHubAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github' } });
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    assert.equal(res.redirectedTo, 'https://github.com/apps/my-app/installations/new?state=real');
    assert.equal(session.githubPending, undefined, 'no rebind pending stashed when there is nothing to pick');
  });

  test('GET callback (re-bind) responds with a clean 503 instead of hanging when beginInstall throws on a malformed key (LIN-2081 review finding 3)', async () => {
    // Same no-installations branch as the test above, but beginInstall() now
    // throws (as the REAL buildInstallUrl() does when GITHUB_APP_PRIVATE_KEY is
    // shape-invalid, since it calls getAppConfig() unconditionally for `slug`).
    // Before finding 3's fix, this call site was UNGUARDED inside an async
    // Express handler — Express 4 does not route an async throw to error
    // middleware, so the request would hang with NO response at all (the exact
    // LIN-761 root-cause-A failure this file documents beginAuth against
    // elsewhere) rather than surface this clean 503.
    const provider = {
      ...fakeProvider(),
      listReboundableRepos: async () => [],
      beginInstall: () => { throw new Error("GitHub App auth: GITHUB_APP_PRIVATE_KEY ends with stray characters after the END line: '%'") },
    };
    const router = createGitHubAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    const session = makeSession({ oauthState: 'real', oauthIntent: { mode: 'new', provider: 'github' } });
    await handler({ query: { code: 'oauth-code', state: 'real' }, session }, res);
    assert.equal(res.statusCode, 503, 'must respond, not hang');
    assert.match(res.body, /GitHub App Not Configured/);
    assert.match(res.body, /GITHUB_APP_PRIVATE_KEY is set but is not a valid PEM key/);
    assert.equal(res.redirectedTo, null, 'must not redirect to a broken install URL');
  });

  test('POST link (re-bind, new) mints the installation token for the chosen repo and writes the LIN-711 binding (LIN-728)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { rebind: true, mode: 'new', repoInstallations: { 'octocat/hello-world': '77' } },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(session.workspaces.length, 1);
    const ws = session.workspaces[0];
    // Identity comes from completeInstallation (installation account), like the install path.
    assert.equal(ws.id, 'github:42');
    const expectedExpiry = Date.parse('2026-06-25T20:00:00Z');
    // The persisted credential is an INSTALLATION token in the LIN-711 shape — for the
    // repo's resolved installation (77), never the discovery user token.
    assert.deepEqual(ws.bindings, [{ provider: 'github', scope: 'octocat/hello-world', credentials: { installationId: '77', token: 'ghs_inst', tokenExpiresAt: expectedExpiry } }]);
    assert.ok(!JSON.stringify(session.workspaces).includes('gho_user'), 'discovery user token is never persisted');
    assert.equal(session.githubPending, undefined, 'pending cleared');
    assert.equal(res.redirectedTo, '/workspace/octocat/');
  });

  test('POST link (re-bind, add-source) mints + binds onto the active workspace without clobbering its primary (LIN-717 + LIN-728)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { rebind: true, mode: 'add-source', repoInstallations: { 'octocat/hello-world': '77' } },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    const binding = linearWs.bindings.find(b => b.provider === 'github');
    assert.deepEqual(binding.credentials, { installationId: '77', token: 'ghs_inst', tokenExpiresAt: Date.parse('2026-06-25T20:00:00Z') });
    // A non-active re-add must NOT clobber the active scalar mirror (LIN-717).
    assert.equal(linearWs.provider, 'linear');
    assert.equal(linearWs.accessToken, 'lin_tok');
    assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=github');
  });

  test('POST link (re-bind) rejects a repo that is not in the enumerated installation map (LIN-728)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { rebind: true, mode: 'new', repoInstallations: { 'octocat/hello-world': '77' } },
      workspaces: [],
    });
    // A well-formed slug that the user never had enumerated — must not mint anything.
    await handler({ body: { repo: 'octocat/not-enumerated' }, session }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Invalid Repository/);
    assert.equal(session.workspaces.length, 0);
  });

  test('POST link (new) find-or-creates the GitHub account container and writes the binding', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(session.workspaces.length, 1);
    const ws = session.workspaces[0];
    assert.equal(ws.id, 'github:42');
    assert.equal(ws.urlKey, 'octocat');
    assert.equal(ws.provider, 'github');
    // GitHub App binding shape (LIN-711): installationId persisted (re-mint key) and
    // a REAL ms expiry from expires_at, not the old never-expires MAX.
    const expectedExpiry = Date.parse('2026-06-25T20:00:00Z');
    assert.deepEqual(ws.bindings, [{ provider: 'github', scope: 'octocat/hello-world', credentials: { installationId: '99', token: 'gho_token', tokenExpiresAt: expectedExpiry } }]);
    assert.equal(ws.tokenExpiresAt, expectedExpiry, 'workspace stamp is the real expiry, not MAX');
    assert.notEqual(ws.tokenExpiresAt, Number.MAX_SAFE_INTEGER);
    assert.equal(session.activeWorkspaceId, 'github:42');
    assert.equal(session.githubPending, undefined, 'pending cleared');
    assert.equal(res.redirectedTo, '/workspace/octocat/');
  });

  // LIN-1349: at MAX_WORKSPACES, the upsertWorkspace limit check must run BEFORE
  // establishAccount, so a refused new-container sign-in never gets a durable
  // account↔workspace binding written for it.
  test('POST link (new), at the workspace limit, is rejected 400 and writes NO account↔workspace binding (LIN-1349)', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const existingWorkspaces = Array.from({ length: 10 }, (_, i) => ({ id: `ws-${i}`, name: `Workspace ${i}`, urlKey: `ws-${i}` }));
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: existingWorkspaces,
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Workspace Limit Reached/);
    // The crux: establishAccount never ran, so no binding exists for the refused workspace.
    assert.deepEqual(await accountWorkspaceStore.listAccountsForWorkspace('github:42'), []);
    assert.equal(session.accountId, undefined);
  });

  test('POST link (new) adds a second repo as a binding on the existing account container', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const existing = {
      id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github',
      bindings: [{ provider: 'github', scope: 'octocat/hello-world', credentials: { token: 'gho_token' } }],
    };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [existing],
    });
    await handler({ body: { repo: 'octocat/another-repo' }, session }, res);

    assert.equal(session.workspaces.length, 1, 'no duplicate workspace created');
    assert.deepEqual(session.workspaces[0].bindings.map(b => b.scope), ['octocat/hello-world', 'octocat/another-repo']);
  });

  test('POST link (add-source) links onto the active workspace without creating a new one', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(session.workspaces.length, 1, 'no new workspace');
    assert.equal(linearWs.provider, 'linear', 'active provider unchanged by a non-active binding');
    assert.ok(linearWs.bindings.some(b => b.provider === 'github' && b.scope === 'octocat/hello-world'));
    assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=github');
  });

  // LIN-1329: add-source is the one GitHub mode that does NOT regenerate the
  // session, so a pre-existing session.accountId survives into establishAccount
  // — the realistic path to the strict conflict signal (an identity already
  // owned by a DIFFERENT account than the one currently signed in).
  test('POST link (add-source) returns 409 Account Conflict when the GitHub identity already belongs to a DIFFERENT account, and writes nothing', async () => {
    const { accountStore, accountWorkspaceStore } = freshAccountStores();
    const otherAccount = await accountStore.createAccount();
    await accountStore.linkIdentity(otherAccount._id, 'github', 'human-42', {});
    const myAccount = await accountStore.createAccount();

    const router = createGitHubAuthRoutes({ provider: fakeProvider(), accountStore, accountWorkspaceStore });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      accountId: myAccount._id,
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, /Account Conflict/);
    // No binding written, no pending cleared — the sign-in did not complete.
    assert.equal(linearWs.bindings, undefined);
    assert.ok(session.githubPending, 'pending NOT cleared on conflict');
    // Neither account was mutated.
    assert.strictEqual((await accountStore.getAccount(otherAccount._id)).identities.length, 1);
    assert.strictEqual((await accountStore.getAccount(myAccount._id)).identities.length, 0);
  });

  test('POST link (add-source) binds onto the VIEWED workspace, not the active one (LIN-541)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    // User is viewing workspace A (acme) but B (globex) is the active one.
    const viewedWs = { id: 'org-a', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_a' };
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z', workspaceUrlKey: 'acme' },
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
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [activeWs],
      activeWorkspaceId: 'org-b',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.ok(activeWs.bindings?.some(b => b.provider === 'github' && b.scope === 'octocat/hello-world'));
    assert.equal(res.redirectedTo, '/workspace/globex/settings?provider_ok=github');
  });

  test('POST link (add-source) falls back to active when the carried urlKey no longer resolves', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const activeWs = { id: 'org-b', name: 'Globex', urlKey: 'globex', provider: 'linear', accessToken: 'lin_b' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z', workspaceUrlKey: 'gone' },
      workspaces: [activeWs],
      activeWorkspaceId: 'org-b',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.ok(activeWs.bindings?.some(b => b.provider === 'github' && b.scope === 'octocat/hello-world'));
    assert.equal(res.redirectedTo, '/workspace/globex/settings?provider_ok=github');
  });

  test('POST link rejects when there is no pending GitHub session', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    await handler({ body: { repo: 'octocat/hello-world' }, session: makeSession() }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Session Expired/);
  });

  test('POST link (add-source) writes the LIN-711 binding shape: installationId + real ms expiry', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const linearWs = { id: 'org-1', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' };
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'ghs_inst', mode: 'add-source', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [linearWs],
      activeWorkspaceId: 'org-1',
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    const binding = linearWs.bindings.find(b => b.provider === 'github');
    assert.deepEqual(binding.credentials, {
      installationId: '99',
      token: 'ghs_inst',
      tokenExpiresAt: Date.parse('2026-06-25T20:00:00Z'),
    });
    // A non-active binding must NOT clobber the Linear primary's scalar mirror.
    assert.equal(linearWs.provider, 'linear');
    assert.equal(linearWs.accessToken, 'lin_tok');
  });

  test('POST link surfaces a clean error when the installation expiry is missing/unparseable (LIN-711)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    // No tokenExpiresAt carried — must NOT silently fall back to a never-expires stamp.
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42', installationId: '99' },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Something Went Wrong/);
    // No workspace/binding was written from a bad expiry.
    assert.equal(session.workspaces.length, 0);
  });

  test('POST link rejects a malformed repo slug', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({ githubHumanId: 'human-42', githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42' }, workspaces: [] });
    await handler({ body: { repo: 'not-a-repo' }, session }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Invalid Repository/);
  });

  // ---------------------------------------------------------------------------
  // LIN-746: the caught GitHub error detail (already built at the client/app-auth
  // boundary) is THREADED into the error page's diagnostic block, instead of being
  // console.error'd server-side and flattened to a generic "Please try again.".
  // The generic friendly headline is preserved; the diagnostic ADDS the cause.
  // ---------------------------------------------------------------------------

  test('GET callback surfaces GitHub’s real error detail + HTTP status in the page diagnostic (LIN-746)', async () => {
    const err = new Error('GitHub API POST /app/installations/99/access_tokens failed: Resource not accessible by integration');
    err.status = 403;
    const provider = { ...fakeProvider(), completeInstallation: async () => { throw err; } };
    const router = createGitHubAuthRoutes({ provider, ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    await handler({ query: { installation_id: '99', state: 'real' }, session: makeSession({ oauthState: 'real' }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/, 'generic friendly headline preserved');
    assert.match(res.body, /error-details/, 'diagnostic block rendered');
    assert.match(res.body, /Resource not accessible by integration/, 'GitHub’s real cause is surfaced');
    assert.match(res.body, /GITHUB_403/, 'the HTTP status is surfaced');
  });

  test('GET callback (re-bind) surfaces the OAuth error detail in the diagnostic (LIN-746)', async () => {
    const router = createGitHubAuthRoutes({ provider: fakeProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github/callback');
    const res = makeRes();
    // fakeProvider.completeAuth('bad') throws AuthExchangeError('bad_verification_code').
    await handler({ query: { code: 'bad', state: 'real' }, session: makeSession({ oauthState: 'real', oauthIntent: { mode: 'new' } }) }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Authentication Failed/);
    assert.match(res.body, /bad_verification_code/, 'AuthExchangeError.detail surfaced to the user');
  });

  // LIN-1350: a throw inside the post-regenerate callback (e.g. the prefs
  // store down) used to resolve the wrapper promise via `finally` with no
  // response ever sent, surfacing only as an unhandledRejection. The new
  // `catch` arm must render this route's own 500 page (with the GitHub
  // diagnostic threaded in) instead of hanging.
  test('POST link: a throw inside the post-regenerate callback (prefs store down) responds 500, not a hang (LIN-1350)', async () => {
    const router = createGitHubAuthRoutes({
      provider: fakeProvider(),
      userPreferencesStore: { getUserPreferences: async () => { throw new Error('prefs store down') } },
      ...freshAccountStores(),
    });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.strictEqual(res.statusCode, 500);
    assert.ok(res.body && /Could not link your GitHub repository/.test(res.body));
    assert.strictEqual(res.redirectedTo, null);
  });
});

describe('githubErrorDiagnostic (LIN-746)', () => {
  test('maps an HTTP 403 to an auth, non-retryable diagnostic carrying GitHub’s message', () => {
    const err = new Error('GitHub API GET /installation/repositories failed: Resource not accessible by integration');
    err.status = 403;
    const d = githubErrorDiagnostic(err, '2026-06-27T00:00:00.000Z');
    assert.equal(d.category, 'auth');
    assert.equal(d.retryable, false);
    assert.equal(d.code, 'GITHUB_403');
    assert.match(d.detail, /Resource not accessible by integration/);
    assert.equal(d.time, '2026-06-27T00:00:00.000Z');
  });

  test('maps 429 and 5xx to a retryable upstream diagnostic', () => {
    const rate = new Error('rate limited'); rate.status = 429;
    const rd = githubErrorDiagnostic(rate);
    assert.equal(rd.category, 'upstream');
    assert.equal(rd.retryable, true);
    assert.equal(rd.code, 'GITHUB_429');

    const boom = new Error('bad gateway'); boom.status = 502;
    const bd = githubErrorDiagnostic(boom);
    assert.equal(bd.category, 'upstream');
    assert.equal(bd.retryable, true);
    assert.equal(bd.code, 'GITHUB_502');
  });

  test('prefers AuthExchangeError.detail + .code when no HTTP status is present', () => {
    const err = new AuthExchangeError('bad_verification_code', 'github');
    const d = githubErrorDiagnostic(err);
    assert.equal(d.detail, 'bad_verification_code');
    assert.equal(d.code, 'AUTH_EXCHANGE_FAILED');
  });

  test('classifies a dropped socket (no status) as a retryable upstream failure', () => {
    const err = new Error('fetch failed'); err.code = 'ECONNRESET';
    const d = githubErrorDiagnostic(err);
    assert.equal(d.category, 'upstream');
    assert.equal(d.retryable, true);
    // No HTTP status, so the Code row falls back to the transport errno — itself
    // a useful anchor (ECONNRESET) rather than a generic marker.
    assert.equal(d.code, 'ECONNRESET');
  });

  test('falls back to a safe placeholder detail when the error carries nothing', () => {
    const d = githubErrorDiagnostic({});
    assert.match(d.detail, /without a detail message/);
    assert.equal(d.category, 'internal');
    assert.equal(d.code, 'GITHUB_ERROR');
  });
});
