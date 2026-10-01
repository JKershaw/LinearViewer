/**
 * LIN-3125 Phase 3 — the acceptance witness.
 *
 * One GitHub App installation (id 77) with THREE repos. Add #1 goes through the
 * existing first-connect path (authorize -> OAuth code -> re-bind enumeration ->
 * install -> picker -> link); adds #2 and #3 go through the held-connection
 * picker. The witness proves criterion (a) (a first connect completes without
 * getting stuck on the App redirect) and criterion (b) (any number of sources
 * from one connection with no auth/install round trip).
 *
 * Everything is REAL except the network: the real `GitHubProvider`, the real
 * routes (`createGitHubAuthRoutes`, `createHeldConnectionRoutes`), the real
 * stores, the real `createAuthorizedAccountConnectionReader` / refresher /
 * `convertToConnectionBacked`/`persistBinding` seam — wired EXACTLY as
 * `server.js` wires them. Only the GitHub HTTP boundary (a recording
 * `fetchImpl`) and the REST client (`clientFactory` -> the in-memory fake) are
 * injected, so the REAL `completeAuth` / `completeInstallation` /
 * `refreshCredential` bodies run offline and are counted BY URL.
 *
 * Counters (`D-F7`): oauthExchange (`/login/oauth/access_token`), mint
 * (`/app/installations/<id>/access_tokens`), installationRead
 * (`/app/installations/<id>`), listUserInstallations (the fake client call),
 * beginAuth / beginInstall (instance wrappers). The token log is the
 * `clientFactory` argument.
 *
 * Run with: node --test tests/unit/lin-3125-held-connection-witness.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createHeldConnectionRoutes } from '../../routes/held-connection.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { createFakeGitHubClient } from '../../lib/providers/github/fake-client.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import {
  createAuthorizedAccountConnectionReader,
  createConnectionRefresher,
  convertToConnectionBacked,
  heldConnectionCredentials,
  CONNECTION_RETRY_TITLE,
  CONNECTION_RETRY_MESSAGE,
} from '../../lib/connection-credential.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG', 'CONNECTION_BACKED_WRITES'];

const INSTALLATION = '77';
const REPOS = ['octo/repo-a', 'octo/repo-b', 'octo/repo-c'];
const WORKSPACE = 'octo';

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function makeRes() {
  return { statusCode: 200, body: null, redirectedTo: null, status(c){this.statusCode=c;return this;}, send(h){this.body=h;return this;}, redirect(u){this.redirectedTo=u;return this;} };
}
function makeSession() {
  return {
    workspaces: [],
    save(cb) { if (cb) cb(); },
    regenerate(cb) { for (const k of Object.keys(this)) if (typeof this[k] !== 'function') delete this[k]; cb(); },
  };
}
function jsonResponse(data) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data, text: async () => JSON.stringify(data) };
}

/** Build the whole flow through the SAME construction server.js uses. */
async function harness(client) {
  const db = client.db(`witness_${Math.random().toString(36).slice(2)}`);
  const accountStore = new AccountStore({ collection: db.collection('accounts') });
  const accountWorkspaceStore = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') });
  const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
  const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });

  const counters = { oauthExchange: 0, mint: 0, installationRead: 0, listUserInstallations: 0, beginAuth: 0, beginInstall: 0 };
  const tokens = [];
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    if (u.includes('/login/oauth/access_token')) { counters.oauthExchange += 1; return jsonResponse({ access_token: 'gho_user' }); }
    if (/\/app\/installations\/[^/]+\/access_tokens$/.test(u)) {
      counters.mint += 1;
      const auth = opts?.headers?.Authorization || '';
      if (!/^Bearer eyJ/.test(auth)) throw new Error('mint must be authenticated with an App JWT');
      return jsonResponse({ token: 'ghs_inst', expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }
    if (/\/app\/installations\/[^/]+$/.test(u)) { counters.installationRead += 1; return jsonResponse({ account: { id: 42, login: 'octo' } }); }
    throw new Error(`unexpected fetch: ${u}`);
  };

  const seed = {
    _repos: REPOS.map(slug => ({ full_name: slug, private: false })),
    _installations: [{ id: Number(INSTALLATION), account: { login: 'octo' }, repositories: REPOS.map(slug => ({ full_name: slug, private: false })) }],
  };
  const fake = createFakeGitHubClient(seed);
  let installationsVisible = false;
  const countingClient = {
    ...fake,
    listUserInstallations: async () => { counters.listUserInstallations += 1; return installationsVisible ? fake.listUserInstallations() : []; },
  };
  const clientFactory = (token) => { tokens.push(token); return countingClient; };

  const provider = new GitHubProvider({ clientFactory, fetchImpl });
  const origBeginAuth = provider.beginAuth.bind(provider);
  provider.beginAuth = (args) => { counters.beginAuth += 1; return origBeginAuth(args); };
  const origBeginInstall = provider.beginInstall.bind(provider);
  provider.beginInstall = (args) => { counters.beginInstall += 1; return origBeginInstall(args); };

  const reader = createAuthorizedAccountConnectionReader({ connectionStore });
  // The test's provider stands in for the registered singleton server.js resolves
  // through `getProviderForWorkspace`; wiring the same resolver shape keeps the
  // construction identical while driving the injected fake/fetch.
  const resolveProvider = () => provider;
  const refreshConnection = createConnectionRefresher({ connectionStore, ownerCredentialStore, resolveProvider });

  const flow = createGitHubAuthRoutes({
    provider, accountStore, accountWorkspaceStore, connectionStore,
    listAuthorizedAccountConnections: reader,
    connectionBackedWritesEnabled: () => true,
  });
  const picker = createHeldConnectionRoutes({
    resolveProvider,
    connectionStore, accountWorkspaceStore,
    listAuthorizedAccountConnections: reader,
    heldConnectionCredentials,
    connectionBackedWritesEnabled: () => true,
    refreshConnection,
    convertToConnectionBacked,
    resolveCanonicalAccountId: (id) => accountStore.resolveCanonicalAccountId(id),
    connectionRetry: { title: CONNECTION_RETRY_TITLE, message: CONNECTION_RETRY_MESSAGE },
  });

  return {
    db, accountStore, accountWorkspaceStore, connectionStore, ownerCredentialStore,
    counters, tokens, flow, picker,
    setInstallationsVisible: (v) => { installationsVisible = v; },
  };
}

/** Add #1 through the REAL first-connect path (authorize -> code -> install -> picker -> link). */
async function firstConnect(h, session, repo) {
  const g = makeRes();
  await getHandler(h.flow, 'get', '/auth/github')({ query: { mode: 'new' }, session }, g);
  assert.match(g.redirectedTo, /login\/oauth\/authorize/, 'begin reaches the authorize URL');
  const state = session.oauthState;
  assert.ok(state, 'begin minted an oauth state');

  // OAuth return: no installations yet -> the flow sends the user to install.
  h.setInstallationsVisible(false);
  const c1 = makeRes();
  await getHandler(h.flow, 'get', '/auth/github/callback')({ query: { code: 'code-1', state }, session }, c1);
  assert.match(c1.redirectedTo, /installations\/new/, 'first-time connect falls through to the App install');

  // The user installs the App; GitHub returns an installation_id (same nonce).
  h.setInstallationsVisible(true);
  const c2 = makeRes();
  await getHandler(h.flow, 'get', '/auth/github/callback')({ query: { installation_id: INSTALLATION, setup_action: 'install', state }, session }, c2);
  assert.match(c2.body, /github-repo-form/, 'callback renders the repo picker');

  const l = makeRes();
  await getHandler(h.flow, 'post', '/auth/github/link')({ body: { repo }, session }, l);
  assert.match(l.redirectedTo || '', /^\/workspace\//, l.body || 'no redirect');
}

/** Start from the exact URL the Settings POST emits and follow the held path. */
async function heldAdd(h, session, repo) {
  const g = makeRes();
  await getHandler(h.flow, 'get', '/auth/github')({ query: { mode: 'add-source', workspace: WORKSPACE, heldConnection: '1' }, session }, g);
  assert.equal(g.redirectedTo, '/connect/github/held', 'marked entry captured into the held picker');
  const p = makeRes();
  await getHandler(h.picker, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, p);
  assert.match(p.body, new RegExp(repo.replace('/', '\\/')), 'picker offers the repo');
  const b = makeRes();
  await getHandler(h.picker, 'post', '/connect/:provider/held/bind')({ params: { provider: 'github' }, session, body: { repo } }, b);
  return { g, p, b };
}

const snap = (counters) => ({ ...counters });
const deltas = (before, after) => Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]));

describe('LIN-3125 Phase 3 — acceptance witness: three repos, one connection', () => {
  let dir;
  let client;
  let savedEnv;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin3125-witness-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    Object.assign(process.env, { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'app' });
  });
  afterEach(() => {
    for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });

  test('criterion (a)+(b): one connection, three repos, zero auth/install round trips on adds #2/#3', async () => {
    const h = await harness(client);
    const session = makeSession();

    // ---- add #1: the first-connect path (also the criterion (a) proof) ----
    await firstConnect(h, session, REPOS[0]);
    assert.equal(session.workspaces.length, 1);
    assert.equal(session.workspaces[0].urlKey, WORKSPACE);

    // Counter liveness: every counter that can fire on the first connect did.
    for (const [name, v] of Object.entries(h.counters)) assert.ok(v >= 1, `counter ${name} is live (${v})`);
    const mark = snap(h.counters);
    const markTokens = h.tokens.length;

    // ---- adds #2 and #3: the held path, no marker on GitHub ----
    h.setInstallationsVisible(true);
    const redirects = [];
    for (const repo of [REPOS[1], REPOS[2]]) {
      const { g, b } = await heldAdd(h, session, repo);
      redirects.push(g.redirectedTo, b.redirectedTo);
    }

    // (1) zero counter movement after the snapshot.
    assert.deepEqual(deltas(mark, h.counters), { oauthExchange: 0, mint: 0, installationRead: 0, listUserInstallations: 0, beginAuth: 0, beginInstall: 0 });

    // (2) no held redirect ever matched an authorize/install URL.
    for (const u of redirects) {
      assert.doesNotMatch(u || '', /github\.com\/login\/oauth\/authorize/);
      assert.doesNotMatch(u || '', /installations\/new/);
    }

    // (3) exactly ONE Connection with three referents.
    const rows = await h.connectionStore.readConnectionsByAccountPrefix(session.accountId);
    assert.equal(rows.length, 1, 'one Connection record');
    assert.deepEqual(rows[0].referents.map(r => r.scope).sort(), [...REPOS].sort());
    const connectionId = rows[0]._id;

    // (4) three bindings, each {provider, scope, connectionId}, one connection, no credentials.
    const ws = session.workspaces[0];
    assert.equal(ws.bindings.length, 3);
    for (const repo of REPOS) {
      const b = ws.bindings.find(x => x.scope === repo);
      assert.deepEqual(b, { provider: 'github', scope: repo, connectionId });
      assert.ok(!('credentials' in b));
    }

    // (5) the held adds used ONLY the installation token.
    const heldTokens = h.tokens.slice(markTokens);
    assert.ok(heldTokens.length >= 2, 'the held adds built at least one client per add');
    assert.ok(heldTokens.every(t => t.startsWith('ghs_')), `held tokens are installation tokens, saw: ${JSON.stringify(heldTokens)}`);

    // (6) no identity freshness stamp from the held adds.
    const freshness = session.identityAuthenticatedAt;
    assert.ok(freshness, 'add #1 stamped freshness');
    // (re-run one more held add to be explicit that it does not move)
    const before = snap(h.counters);
    await heldAdd(h, session, REPOS[0]).catch(() => {}); // repo-a already bound -> idempotent/empties; counters must not move
    assert.deepEqual(deltas(before, h.counters), { oauthExchange: 0, mint: 0, installationRead: 0, listUserInstallations: 0, beginAuth: 0, beginInstall: 0 });
    assert.equal(session.identityAuthenticatedAt, freshness, 'identityAuthenticatedAt unchanged');
  });

  test('stale-token variant: exactly one refresh mint, zero oauth/installationRead/listUserInstallations', async () => {
    const h = await harness(client);
    const session = makeSession();
    await firstConnect(h, session, REPOS[0]);

    // Expire the connection's installation token before add #2.
    await h.db.collection('connections').updateMany({}, { $set: { 'credentials.tokenExpiresAt': Date.now() - 60_000 } });
    const before = snap(h.counters);
    await heldAdd(h, session, REPOS[1]);

    assert.deepEqual(deltas(before, h.counters), { oauthExchange: 0, mint: 1, installationRead: 0, listUserInstallations: 0, beginAuth: 0, beginInstall: 0 });
    const ws = session.workspaces[0];
    assert.ok(ws.bindings.some(b => b.scope === REPOS[1]));
  });

  test('no-marker control: an unmarked add still runs the full round trip (counters move)', async () => {
    const h = await harness(client);
    const session = makeSession();
    await firstConnect(h, session, REPOS[0]);
    h.setInstallationsVisible(true);

    const before = snap(h.counters);
    // Unmarked: begins at the authorize URL, not the picker.
    const g = makeRes();
    await getHandler(h.flow, 'get', '/auth/github')({ query: { mode: 'add-source', workspace: WORKSPACE }, session }, g);
    assert.match(g.redirectedTo, /login\/oauth\/authorize/, 'no marker => authorize');
    const state = session.oauthState;
    const c = makeRes();
    await getHandler(h.flow, 'get', '/auth/github/callback')({ query: { code: 'code-2', state }, session }, c);
    assert.match(c.body, /github-repo-form/, 'code re-bind picker');
    const l = makeRes();
    await getHandler(h.flow, 'post', '/auth/github/link')({ body: { repo: REPOS[1] }, session }, l);

    const d = deltas(before, h.counters);
    for (const k of ['beginAuth', 'oauthExchange', 'listUserInstallations', 'mint', 'installationRead']) assert.ok(d[k] >= 1, `${k} moved (${d[k]})`);
  });

  test('Phase 0 L2: the counters run through the provider fetchImpl seam for completeAuth AND the refresh fallback', async () => {
    const h = await harness(client);
    const session = makeSession();
    await firstConnect(h, session, REPOS[0]);
    assert.ok(h.counters.oauthExchange >= 1, 'completeAuth -> exchangeOAuthCode counted via fetchImpl');
    assert.ok(h.counters.mint >= 1, 'completeInstallation mint counted via fetchImpl');

    // Stale token => the refresher's refreshCredential fallback also goes through the seam.
    await h.db.collection('connections').updateMany({}, { $set: { 'credentials.tokenExpiresAt': Date.now() - 60_000 } });
    const before = snap(h.counters);
    await heldAdd(h, session, REPOS[1]);
    assert.equal(deltas(before, h.counters).mint, 1, 'refreshCredential mint counted through the seam');
  });
});
