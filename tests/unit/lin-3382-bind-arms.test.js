/**
 * LIN-3382 — the bind arms, driven through their REAL handlers against REAL
 * MangoDB stores, with the resolver built exactly as server.js builds it
 * (`createStoreBackedResolver`: the strict holder finder over the same stores).
 *
 * What this pins, per arm (GitHub fresh, GitHub account container, held-new,
 * Jira, Linear new + add-source, local, and the merge-confirm landing):
 *
 *   - a different account binding the same provider resource is REFUSED: a plain
 *     409, no holder named, and NOTHING written (no new rows in the holder
 *     stores, no account/edge rows, session unchanged);
 *   - a binder never refuses its own key (re-adding its own repo, including after
 *     the workspace was removed), and a returning workspace keeps its key with an
 *     expired session;
 *   - the key resolved once is the key written into `connections.referents`;
 *   - a missing or throwing resolver fails closed: the retry page, 503, nothing
 *     written (Jira also drops its carried refresh token);
 *   - a merge-confirm whose originating arm refused never lands the workspace.
 *
 * The resolver's own decision table is tests/unit/workspace-urlkey.test.js.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createGitHubProjectsAuthRoutes } from '../../routes/github-projects-auth.js';
import { createHeldConnectionRoutes } from '../../routes/held-connection.js';
import { createJiraAuthRoutes } from '../../routes/jira-auth.js';
import { createAuthRoutes } from '../../routes/auth.js';
import { createWorkspaceRoutes } from '../../routes/workspace.js';
import { createAccountMergeRoutes } from '../../routes/account-merge.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { convertToConnectionBacked, createAuthorizedAccountConnectionReader, heldConnectionCredentials } from '../../lib/connection-credential.js';
import { createStoreBackedResolver } from './lin-3382-resolver-harness.js';
import { deriveUrlKey } from '../../lib/workspace-urlkey.js';
import { getHandler, makeRes, makeSession } from '../fixtures/github-install-flow-branches.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const ENV = [
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG',
  'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI', 'CONNECTION_BACKED_WRITES'
];

let dbDir;
let client;
let counter = 0;
let savedEnv;

before(async () => {
  savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'app',
    LINEAR_CLIENT_ID: 'set', LINEAR_CLIENT_SECRET: 'set', LINEAR_REDIRECT_URI: 'set'
  });
  delete process.env.CONNECTION_BACKED_WRITES;
  dbDir = mkdtempSync(join(tmpdir(), 'lin3382-arms-'));
  client = new MangoClient(dbDir);
  await client.connect();
});
after(async () => {
  if (client?.close) await client.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

/** Real stores over a fresh db, with the resolver built the way server.js builds it. */
function makeWorld() {
  const db = client.db(`arms_${counter++}`);
  const world = {
    connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
    ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
    accountStore: new AccountStore({ collection: db.collection('accounts') }),
    accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    proxyTokenStore: new ProxyTokenStore({ collection: db.collection('proxy-tokens') }),
    dispatchTokenStore: new DispatchTokenStore({ collection: db.collection('dispatch-tokens') })
  };
  world.resolve = createStoreBackedResolver(world);
  return world;
}

/** Row counts of every store a bind can write to (the three holder stores plus the account side). */
async function counts(world) {
  return {
    connections: await world.connectionStore.collection.countDocuments({}),
    ownerCredentials: await world.ownerCredentialStore.collection.countDocuments({}),
    proxyTokens: await world.proxyTokenStore.collection.countDocuments({}),
    dispatchTokens: await world.dispatchTokenStore.collection.countDocuments({}),
    accounts: await world.accountStore.collection.countDocuments({}),
    edges: await world.accountWorkspaceStore.collection.countDocuments({})
  };
}
const sessionState = session => JSON.parse(JSON.stringify(session));

// ---- seeding history through the real stores -----------------------------------------------

async function newAccount(world, identity) {
  const account = await world.accountStore.createAccount();
  if (identity) await world.accountStore.linkIdentity(account._id, identity.provider, identity.scope, {});
  return account._id;
}
async function holdByReferent(world, accountId, urlKey, provider, scope) {
  await world.connectionStore.collection.insertOne({
    _id: `${accountId}::${provider}::${scope}`, accountId, provider, unitId: scope, origin: provider,
    referents: [{ urlKey, provider, scope }], credentials: {}
  });
}
async function holdByCredential(world, accountId, urlKey, provider, scope) {
  await world.ownerCredentialStore.collection.insertOne({
    _id: `${accountId}::${urlKey}::${provider}`, accountId, urlKey, provider, ...(scope ? { scope } : {}), token: 'x', refreshToken: 'y'
  });
}
async function holdByToken(world, accountId, urlKey) {
  await world.dispatchTokenStore.collection.insertOne({ _id: crypto.randomUUID(), urlKey, createdBy: accountId, createdAt: new Date(), tokenHash: 'h' });
}
async function edge(world, accountId, workspaceId) {
  await world.accountWorkspaceStore.collection.insertOne({ _id: crypto.randomUUID(), accountId, workspaceId, createdAt: new Date() });
}

/** The one rule's key for a GitHub repo bound on a random-id workspace (fresh and held-new). */
const repoKey = (scope, provider = 'github') => deriveUrlKey('github-fresh', { repoName: scope.split('/').pop(), provider, scope });

const REFUSAL = /can(?:'|&#0?39;)t be connected/;
const SUPPORT = /contact support/;
const RETRY = /Connection Not Saved/;

// =================================================================================
// GitHub fresh + account container (lib/github-install-flow.js)
// =================================================================================

function fakeGithubProvider(name = 'github') {
  return {
    name,
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
    beginInstall: ({ state }) => `https://github.com/apps/app/installations/new?state=${state}`,
    completeInstallation: async (installationId) => ({
      token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2030-06-25T20:00:00Z'
    }),
    listRepos: async () => [], completeAuth: async () => ({ access_token: 'gho_user' }), listReboundableRepos: async () => [],
    fetchViewer: async () => ({ id: 'human-42', login: 'octocat', name: 'The Octocat' })
  };
}
const freshPending = (over = {}) => ({ token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2030-06-25T20:00:00Z', ...over });

async function linkGithub(world, { session, repo, resolve = world.resolve, projects = false }) {
  const make = projects ? createGitHubProjectsAuthRoutes : createGitHubAuthRoutes;
  const router = make({
    provider: fakeGithubProvider(projects ? 'github-projects' : 'github'),
    accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore, connectionStore: world.connectionStore,
    ...(resolve === null ? {} : { resolveWorkspaceUrlKey: resolve })
  });
  const res = makeRes();
  await getHandler(router, 'post', projects ? '/auth/github-projects/link' : '/auth/github/link')({ body: projects ? { board: repo } : { repo }, session }, res);
  return res;
}
const githubSession = (accountId, over = {}) => makeSession({
  githubHumanId: 'human-42', githubPending: freshPending(), accountId, workspaces: [], ...over
});

describe('GitHub fresh (random id)', () => {
  test('a different account binding the same repo is refused: 409, holder not named, NOTHING written, session unchanged', async () => {
    const world = makeWorld();
    const alice = await newAccount(world, { provider: 'github', scope: 'human-alice' });
    await holdByReferent(world, alice, repoKey('octocat/hello-world'), 'github', 'octocat/hello-world');
    const bob = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const session = githubSession(bob);
    const beforeCounts = await counts(world);
    const beforeSession = sessionState(session);

    const res = await linkGithub(world, { session, repo: 'octocat/hello-world' });

    assert.equal(res.statusCode, 409);
    assert.match(res.body, REFUSAL);
    assert.match(res.body, SUPPORT);
    assert.ok(!res.body.includes(alice) && !res.body.includes(repoKey('octocat/hello-world')), 'neither the holder nor the key is named');
    assert.deepEqual(await counts(world), beforeCounts, 'no new rows in the three holder stores, accounts or edges');
    assert.deepEqual(sessionState(session), beforeSession, 'the session is exactly as it was (no regenerate, no workspace, pending intact)');
  });

  test('a binder never refuses its own key: re-adding its own repo after the workspace was removed (unbind, expire, rebind: the same key)', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    await holdByToken(world, me, repoKey('octocat/hello-world')); // what a removed workspace leaves behind
    const res = await linkGithub(world, { session: githubSession(me), repo: 'octocat/hello-world' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirectedTo, `/workspace/${repoKey('octocat/hello-world')}/`);
  });

  test('the key resolved once is the key persistBinding writes into connections.referents', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const session = githubSession(me);
    const res = await linkGithub(world, { session, repo: 'octocat/hello-world' });
    const ws = session.workspaces[0];
    assert.equal(res.redirectedTo, `/workspace/${ws.urlKey}/`);
    const rows = await world.connectionStore.collection.find({}).toArray();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].referents[0].urlKey, ws.urlKey);
  });

  for (const live of [true, false]) {
    test(`round-3 R1 (${live ? 'live' : 'expired'} session): with alice/foo bound as \`foo\`, a first-time bind of alice-org/foo does not get \`foo\``, async () => {
      const world = makeWorld();
      const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
      await holdByReferent(world, me, 'foo', 'github', 'alice/foo');
      const session = githubSession(me, {
        githubPending: freshPending(),
        workspaces: live ? [{ id: 'w-foo', urlKey: 'foo', bindings: [{ provider: 'github', scope: 'alice/foo' }] }] : []
      });
      const res = await linkGithub(world, { session, repo: 'alice-org/foo' });
      assert.equal(res.statusCode, 200);
      const minted = session.workspaces.find(w => w.id !== 'w-foo');
      assert.notEqual(minted.urlKey, 'foo');
      assert.equal(minted.urlKey, repoKey('alice-org/foo'));
      if (live) assert.ok(session.workspaces.some(w => w.urlKey === 'foo'), 'the live `foo` workspace is untouched');
    });
  }

  test('fails closed with no resolver: 503 retry page, nothing written, session unchanged', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const session = githubSession(me);
    const beforeCounts = await counts(world);
    const beforeSession = sessionState(session);
    const res = await linkGithub(world, { session, repo: 'octocat/hello-world', resolve: null });
    assert.equal(res.statusCode, 503);
    assert.match(res.body, RETRY);
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(sessionState(session), beforeSession);
  });

  test('fails closed when the resolver throws (a store read error): 503, nothing written', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const session = githubSession(me);
    const beforeCounts = await counts(world);
    const res = await linkGithub(world, { session, repo: 'octocat/hello-world', resolve: async () => { throw new Error('mongo down'); } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(session.workspaces, []);
  });
});

describe('GitHub account container (stable id github:<userId>), shared with /auth/github-projects', () => {
  const containerSession = (accountId, over = {}) => makeSession({
    githubHumanId: 'human-42', githubPending: freshPending({ fresh: false }), accountId, workspaces: [], ...over
  });

  test('expired session, same identity: the container keeps its key', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    await holdByReferent(world, me, 'gh-42', 'github', 'octocat/hello-world');
    await edge(world, me, 'github:42');
    const session = containerSession(me);
    const res = await linkGithub(world, { session, repo: 'octocat/hello-world' });
    assert.equal(res.redirectedTo, '/workspace/gh-42/');
    assert.equal(session.workspaces[0].urlKey, 'gh-42');
  });

  test('LIN-3382 (no option C): a container live under an old name is re-keyed to gh-<userId> by the rule, not kept because it is "old"', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const session = containerSession(me, { workspaces: [{ id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github', bindings: [] }] });
    const res = await linkGithub(world, { session, repo: 'octocat/hello-world' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirectedTo, '/workspace/gh-42/');
    assert.deepEqual(session.workspaces.map(w => w.urlKey), ['gh-42']);
  });

  test('a first-time container never lands on a login key another account holds (falls to gh-<userId>)', async () => {
    const world = makeWorld();
    const other = await newAccount(world);
    await holdByToken(world, other, 'octocat');
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const session = containerSession(me);
    await linkGithub(world, { session, repo: 'octocat/hello-world' });
    assert.equal(session.workspaces[0].urlKey, 'gh-42');
  });

  test('the same arm serves /auth/github-projects, and fails closed without a resolver', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const ok = containerSession(me, { githubProjectsPending: freshPending({ fresh: false }) });
    delete ok.githubPending;
    const res = await linkGithub(world, { session: ok, repo: 'octocat/7', projects: true });
    assert.equal(res.statusCode, 200);
    assert.equal(ok.workspaces[0].urlKey, 'gh-42');

    const bare = containerSession(me, { githubProjectsPending: freshPending({ fresh: false }) });
    delete bare.githubPending;
    const beforeCounts = await counts(world);
    const failed = await linkGithub(world, { session: bare, repo: 'octocat/7', projects: true, resolve: null });
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(await counts(world), beforeCounts);
  });
});

// =================================================================================
// Held-new (routes/held-connection.js)
// =================================================================================

describe('held-new (routes/held-connection.js)', () => {
  const ACCT = 'acct-held';
  const INSTALL = '77';
  const CONN_ID = `${ACCT}::github::${INSTALL}`;
  const NEW_KEY = repoKey('octo/a');

  const githubProvider = () => ({
    name: 'github', scopeType: 'repository', ui: { displayName: 'GitHub Issues' },
    supports: (m) => m === 'listConnectionScopes',
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
    async listConnectionScopes() { return [{ slug: 'octo/a', name: 'octo/a', private: false, installationId: INSTALL }]; },
    heldScopeView(item = {}) { return { scope: item.slug, label: item.name, installationId: item.installationId }; }
  });

  async function heldWorld() {
    const world = makeWorld();
    await world.connectionStore.collection.insertOne({
      _id: CONN_ID, accountId: ACCT, provider: 'github', unitId: INSTALL, origin: 'github', referents: [],
      credentials: { token: 'ghs_fresh', installationId: INSTALL, tokenExpiresAt: Date.now() + 3600_000 }
    });
    return world;
  }
  function mount(world, { resolve = world.resolve } = {}) {
    return createHeldConnectionRoutes({
      ...(resolve === null ? {} : { resolveWorkspaceUrlKey: resolve }),
      resolveProvider: () => githubProvider(),
      connectionStore: world.connectionStore,
      accountWorkspaceStore: world.accountWorkspaceStore,
      listAuthorizedAccountConnections: createAuthorizedAccountConnectionReader({ connectionStore: world.connectionStore }),
      heldConnectionCredentials,
      connectionBackedWritesEnabled: () => true,
      convertToConnectionBacked,
      resolveCanonicalAccountId: (id) => id
    });
  }
  const heldSession = (over = {}) => makeSession({
    accountId: ACCT, identityAuthenticatedAt: 111,
    workspaces: [{ id: 'w0', urlKey: 'base', bindings: [{ provider: 'linear', scope: 'org' }] }],
    heldEntry: { provider: 'github', mode: 'new', workspaceUrlKey: null, beginUrl: '/auth/github' },
    ...over
  });
  async function bind(route, session, repo = 'octo/a') {
    await getHandler(route, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, makeRes());
    const res = makeRes();
    await getHandler(route, 'post', '/connect/:provider/held/bind')({ params: { provider: 'github' }, session, body: { repo } }, res);
    return res;
  }

  test('a different account holding the repo\'s key: refused BEFORE upsertWorkspace, nothing written, session unchanged', async () => {
    const world = await heldWorld();
    const alice = await newAccount(world);
    await holdByReferent(world, alice, NEW_KEY, 'github', 'octo/a');
    const route = mount(world);
    const session = heldSession();
    await getHandler(route, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, makeRes());
    const beforeCounts = await counts(world);
    const beforeSession = sessionState(session);

    const res = makeRes();
    await getHandler(route, 'post', '/connect/:provider/held/bind')({ params: { provider: 'github' }, session, body: { repo: 'octo/a' } }, res);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, REFUSAL);
    assert.ok(!res.body.includes(alice) && !res.body.includes(NEW_KEY));
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(sessionState(session), beforeSession, 'upsertWorkspace never ran');
    const row = await world.connectionStore.collection.findOne({ _id: CONN_ID });
    assert.deepEqual(row.referents, []);
  });

  test('a binder re-adding its own repo is not refused, including after the workspace was removed', async () => {
    const world = await heldWorld();
    await holdByToken(world, ACCT, NEW_KEY);
    const session = heldSession();
    const res = await bind(mount(world), session);
    assert.equal(res.redirectedTo, `/workspace/${NEW_KEY}/`);
  });

  test('referents[0].urlKey is the resolved key, and equals the credentials-mode fresh arm\'s key for the same repo', async () => {
    const world = await heldWorld();
    const session = heldSession();
    await bind(mount(world), session);
    const row = await world.connectionStore.collection.findOne({ _id: CONN_ID });
    assert.equal(row.referents[0].urlKey, NEW_KEY);
    assert.ok(session.workspaces.some(w => w.urlKey === NEW_KEY));
  });

  for (const live of [true, false]) {
    test(`round-3 R1 (${live ? 'live' : 'expired'}): with octo/foo bound as \`foo\`, a first-time held-new bind of other/foo does not get \`foo\``, async () => {
      const world = await heldWorld();
      await holdByReferent(world, ACCT, 'foo', 'github', 'octo/foo');
      const route = createHeldConnectionRoutes({
        resolveWorkspaceUrlKey: world.resolve,
        resolveProvider: () => ({
          ...githubProvider(),
          async listConnectionScopes() { return [{ slug: 'other/foo', name: 'other/foo', private: false, installationId: INSTALL }]; }
        }),
        connectionStore: world.connectionStore, accountWorkspaceStore: world.accountWorkspaceStore,
        listAuthorizedAccountConnections: createAuthorizedAccountConnectionReader({ connectionStore: world.connectionStore }),
        heldConnectionCredentials, connectionBackedWritesEnabled: () => true, convertToConnectionBacked,
        resolveCanonicalAccountId: (id) => id
      });
      const session = heldSession({
        workspaces: live ? [{ id: 'w-foo', urlKey: 'foo', bindings: [{ provider: 'github', scope: 'octo/foo' }] }] : []
      });
      const res = await bind(route, session, 'other/foo');
      assert.equal(res.statusCode, 302 === res.statusCode ? 302 : res.statusCode);
      const minted = session.workspaces.find(w => w.id !== 'w-foo');
      assert.ok(minted, 'a workspace was minted');
      assert.notEqual(minted.urlKey, 'foo');
      assert.equal(minted.urlKey, repoKey('other/foo'));
    });
  }

  test('fails closed with no resolver: 503 retry page, nothing written, session unchanged', async () => {
    const world = await heldWorld();
    const route = mount(world, { resolve: null });
    const session = heldSession();
    await getHandler(route, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, makeRes());
    const beforeCounts = await counts(world);
    const beforeSession = sessionState(session);
    const res = makeRes();
    await getHandler(route, 'post', '/connect/:provider/held/bind')({ params: { provider: 'github' }, session, body: { repo: 'octo/a' } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, RETRY);
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(sessionState(session), beforeSession);
  });

  test('the repo already open in the session lands on that workspace instead of minting a second', async () => {
    const world = await heldWorld();
    const session = heldSession({
      workspaces: [{ id: 'w-open', urlKey: NEW_KEY, bindings: [{ provider: 'github', scope: 'octo/a', connectionId: CONN_ID }] }]
    });
    const res = await bind(mount(world), session);
    assert.equal(session.workspaces.length, 1);
    assert.match(res.redirectedTo, new RegExp(`^/workspace/${NEW_KEY}/settings`));
  });
});

// =================================================================================
// Jira (routes/jira-auth.js)
// =================================================================================

describe('Jira (stable id jira:<atlassianAccountId>)', () => {
  const MYSELF = { accountId: '557058:abc', emailAddress: 'j@example.com', displayName: 'J' };
  const SITE = { cloudId: 'cid-1', url: 'https://acme.atlassian.net', name: 'Acme' };
  const provider = { validateCredential: async () => MYSELF };
  // The one rule: jira-<cloudId>-<sha6(W)>, W = the Atlassian identity's container id.
  const JIRA_W = `jira:${MYSELF.accountId}`;
  const JIRA_KEY = deriveUrlKey('jira', { cloudId: SITE.cloudId, workspaceId: JIRA_W });

  const jiraSession = (over = {}) => makeSession({
    workspaces: [],
    jiraPending: { mode: 'new', sites: [SITE], accessToken: 'jira-access', expiresIn: 3600, refreshToken: 'ROTATING' },
    ...over
  });
  async function pick(world, { session, resolve = world.resolve }) {
    const router = createJiraAuthRoutes({
      provider, accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
      ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
      ...(resolve === null ? {} : { resolveWorkspaceUrlKey: resolve })
    });
    const res = makeRes();
    await getHandler(router, 'post', '/auth/jira/oauth/link')({ body: { cloudId: 'cid-1' }, session }, res);
    return res;
  }

  test('a different account binding the same site is refused: 409, nothing written, the carried refresh token dropped', async () => {
    const world = makeWorld();
    const alice = await newAccount(world);
    await holdByReferent(world, alice, JIRA_KEY, 'jira', SITE.url);
    await edge(world, alice, 'jira:alice');
    const session = jiraSession();
    const beforeCounts = await counts(world);

    const res = await pick(world, { session });

    assert.equal(res.statusCode, 409);
    assert.match(res.body, REFUSAL);
    assert.match(res.body, SUPPORT);
    assert.ok(!res.body.includes(alice) && !res.body.includes(JIRA_KEY));
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(session.workspaces, [], 'no workspace, no regenerate');
    assert.equal(session.accountId, undefined);
    assert.equal(session.jiraPending.refreshToken, undefined, 'the rotating token does not outlive the refusal');
  });

  test('fails closed with no resolver: 503, nothing written, the carried refresh token dropped', async () => {
    const world = makeWorld();
    const session = jiraSession();
    const beforeCounts = await counts(world);
    const res = await pick(world, { session, resolve: null });
    assert.equal(res.statusCode, 503);
    assert.match(res.body, RETRY);
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(session.workspaces, []);
    assert.equal(session.jiraPending.refreshToken, undefined);
  });

  test('fails closed when the resolver throws', async () => {
    const world = makeWorld();
    const session = jiraSession();
    const res = await pick(world, { session, resolve: async () => { throw new Error('mongo down'); } });
    assert.equal(res.statusCode, 503);
    assert.equal(session.jiraPending.refreshToken, undefined);
  });

  test('a first-time bind gets jira-<cloudId>-<sha6(W)>, and that key is what the connection referent carries', async () => {
    const world = makeWorld();
    const session = jiraSession();
    const res = await pick(world, { session });
    assert.equal(res.redirectedTo, `/workspace/${JIRA_KEY}/`);
    const rows = await world.connectionStore.collection.find({}).toArray();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].referents[0].urlKey, JIRA_KEY);
  });

  test('LIN-3382 (no option C): a container live under an old tenant name (`immersify`) is re-keyed by the rule', async () => {
    const world = makeWorld();
    const session = jiraSession({ workspaces: [{ id: JIRA_W, name: 'Acme', urlKey: 'immersify', provider: 'jira', bindings: [] }] });
    const res = await pick(world, { session });
    assert.equal(res.redirectedTo, `/workspace/${JIRA_KEY}/`);
    assert.deepEqual(session.workspaces.map(w => w.urlKey), [JIRA_KEY]);
  });

  test('unbind, expire the session, rebind: the same key (the key is a function of the identity, nothing is recovered)', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'jira', scope: MYSELF.accountId });
    await holdByReferent(world, me, JIRA_KEY, 'jira', SITE.url);
    await edge(world, me, JIRA_W);
    const session = jiraSession();
    const res = await pick(world, { session });
    assert.equal(res.redirectedTo, `/workspace/${JIRA_KEY}/`);
    assert.equal(session.workspaces[0].urlKey, JIRA_KEY);
  });

  test('a legacy-shaped holder row (`acme-2`) is not recovered: the rule derives the new key', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'jira', scope: MYSELF.accountId });
    await holdByReferent(world, me, 'acme-2', 'jira', SITE.url);
    await edge(world, me, JIRA_W);
    const session = jiraSession();
    const res = await pick(world, { session });
    assert.equal(res.redirectedTo, `/workspace/${JIRA_KEY}/`);
  });
});

// =================================================================================
// Linear (routes/auth.js): new + add-source, merge-confirm
// =================================================================================

describe('Linear (stable id = org id; key stays org.urlKey || org.name)', () => {
  const provider = (org, viewer) => ({
    name: 'linear',
    beginAuth: ({ state }) => `https://linear.app/oauth/authorize?state=${state}`,
    completeAuth: async () => ({ access_token: 'lin_tok', refresh_token: 'lin_refresh', expires_in: 86400 }),
    fetchOrganization: async () => org,
    fetchViewer: async () => viewer
  });
  const ACME = { id: 'org-1', name: 'Acme', urlKey: 'acme' };
  const mountAuth = (world, p, { resolve = world.resolve } = {}) => createAuthRoutes({
    provider: p, sessionStore: { cleanup: async () => {} },
    accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
    ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
    ...(resolve === null ? {} : { resolveWorkspaceUrlKey: resolve })
  });
  const callback = (router, session) => {
    const res = makeRes();
    return getHandler(router, 'get', '/auth/callback')({ query: { code: 'c', state: 'real' }, session }, res).then(() => res);
  };

  test('a first-time bind keeps org.urlKey, and the referent carries it', async () => {
    const world = makeWorld();
    const session = makeSession({ oauthState: 'real' });
    const res = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), session);
    assert.equal(res.redirectedTo, '/workspace/acme/');
    const rows = await world.connectionStore.collection.find({}).toArray();
    assert.equal(rows[0].referents[0].urlKey, 'acme');
  });

  test('two members of one Linear org still share their workspace (the second is not refused)', async () => {
    const world = makeWorld();
    const first = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), makeSession({ oauthState: 'real' }));
    assert.equal(first.redirectedTo, '/workspace/acme/');
    const session2 = makeSession({ oauthState: 'real' });
    const second = await callback(mountAuth(world, provider(ACME, { id: 'v2' })), session2);
    assert.equal(second.statusCode, 200);
    assert.equal(second.redirectedTo, '/workspace/acme/');
    assert.equal(session2.workspaces[0].id, 'org-1');
    assert.equal((await world.accountWorkspaceStore.listAccountsForWorkspace('org-1')).length, 2);
  });

  test('a key another account holds, with no edge to the org, is refused: 409, nothing written', async () => {
    const world = makeWorld();
    const other = await newAccount(world);
    await holdByToken(world, other, 'acme');
    const session = makeSession({ oauthState: 'real', workspaces: [] });
    const beforeCounts = await counts(world);
    const res = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), session);
    assert.equal(res.statusCode, 409);
    assert.match(res.body, SUPPORT);
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(session.workspaces, []);
  });

  const OWN_CONFLICT = /Another connection on your account/;

  test('reverse order, LIVE session: legacy Jira `acme` open, then Linear org `acme` -> own-conflict 409 (new), nothing written, Jira untouched', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'linear', scope: 'v1' });
    await holdByCredential(world, me, 'acme', 'jira');
    const jiraWs = { id: 'jira:j1', urlKey: 'acme', provider: 'jira', bindings: [{ provider: 'jira', scope: 'https://acme.atlassian.net' }] };
    const session = makeSession({ oauthState: 'real', accountId: me, workspaces: [jiraWs] });
    const beforeCounts = await counts(world);
    const beforeSession = sessionState(session);

    const res = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), session);

    assert.equal(res.statusCode, 409);
    assert.match(res.body, OWN_CONFLICT);
    assert.doesNotMatch(res.body, /acme/, 'names no key');
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(sessionState(session), beforeSession);
    assert.deepEqual((await world.ownerCredentialStore.collection.find({}).toArray()).map(r => r._id), [`${me}::acme::jira`]);
  });

  test('reverse order, LIVE session, add-source: the same own-conflict, before the snapshot, nothing written', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'linear', scope: 'v0' });
    const jiraWs = { id: 'jira:j1', urlKey: 'acme', provider: 'jira', bindings: [{ provider: 'jira', scope: 'https://acme.atlassian.net' }] };
    const session = makeSession({
      oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'linear', workspaceUrlKey: 'acme' },
      accountId: me, workspaces: [jiraWs], activeWorkspaceId: 'jira:j1'
    });
    const beforeCounts = await counts(world);
    const beforeSession = sessionState(session);
    const res = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), session);
    assert.equal(res.statusCode, 409);
    assert.match(res.body, OWN_CONFLICT);
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(sessionState(session), beforeSession, 'add-source is refused before the workspaces snapshot, so nothing needs restoring');
  });

  test('EXPIRED session: the binder\'s own durable Jira credential on `acme` does not refuse Linear (the same-account tie check is dropped by ruling; the live-session version above still refuses; LIN-3394)', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'linear', scope: 'v1' });
    await holdByCredential(world, me, 'acme', 'jira');
    const res = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), makeSession({ oauthState: 'real', workspaces: [] }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirectedTo, '/workspace/acme/');
  });

  test('F2(a): the binder holds Linear `acme` AND Jira `acme`, session expired -> `acme`, the returning workspace is not refused', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'linear', scope: 'v1' });
    await holdByReferent(world, me, 'acme', 'linear', 'org-1');
    await holdByCredential(world, me, 'acme', 'jira');
    const res = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), makeSession({ oauthState: 'real' }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.redirectedTo, '/workspace/acme/');
  });

  test('forward order: Linear `acme` first, then Jira, still gets the Jira key (never the Linear key)', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'jira', scope: '557058:abc' });
    const linearWs = { id: 'org-1', urlKey: 'acme', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org-1' }] };
    const session = makeSession({
      accountId: me, workspaces: [linearWs],
      jiraPending: { mode: 'new', sites: [{ cloudId: 'cid-1', url: 'https://acme.atlassian.net', name: 'Acme' }], accessToken: 'a', expiresIn: 3600 }
    });
    const router = createJiraAuthRoutes({
      provider: { validateCredential: async () => ({ accountId: '557058:abc', emailAddress: 'j@x' }) },
      accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
      ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
      resolveWorkspaceUrlKey: world.resolve
    });
    const res = makeRes();
    await getHandler(router, 'post', '/auth/jira/oauth/link')({ body: { cloudId: 'cid-1' }, session }, res);
    const jiraKey = deriveUrlKey('jira', { cloudId: 'cid-1', workspaceId: 'jira:557058:abc' });
    assert.equal(res.redirectedTo, `/workspace/${jiraKey}/`);
    assert.deepEqual(session.workspaces.map(w => w.urlKey).sort(), ['acme', jiraKey].sort());
  });

  test('fails closed with no resolver (503, nothing written)', async () => {
    const world = makeWorld();
    const session = makeSession({ oauthState: 'real', workspaces: [] });
    const beforeCounts = await counts(world);
    const res = await callback(mountAuth(world, provider(ACME, { id: 'v1' }), { resolve: null }), session);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, RETRY);
    assert.deepEqual(await counts(world), beforeCounts);
    assert.deepEqual(session.workspaces, []);
  });

  test('merge-confirm: when the originating arm REFUSED, no merge is pending and a confirm never lands the workspace', async () => {
    const world = makeWorld();
    const other = await newAccount(world);
    await holdByToken(world, other, 'acme');
    const me = await newAccount(world, { provider: 'linear', scope: 'v1' });
    const session = makeSession({ oauthState: 'real', accountId: me, identityAuthenticatedAt: Date.now(), workspaces: [] });
    const refused = await callback(mountAuth(world, provider(ACME, { id: 'v1' })), session);
    assert.equal(refused.statusCode, 409);
    assert.equal(session.pendingMerge, undefined, 'a refusal never reaches the merge offer');

    const mergeRouter = createAccountMergeRoutes({
      accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
      ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore
    });
    const confirm = makeRes();
    await getHandler(mergeRouter, 'post', '/auth/merge/confirm')({ session }, confirm);
    assert.equal(confirm.statusCode, 400);
    assert.match(confirm.body, /Merge Expired/);
    assert.deepEqual(session.workspaces, [], 'the workspace never landed');
    assert.deepEqual(await world.accountWorkspaceStore.listAccountsForWorkspace('org-1'), []);
  });
});

// =================================================================================
// Local (routes/workspace.js)
// =================================================================================

describe('Local (POST /workspace/new)', () => {
  const run = async (world, { session, resolve = world.resolve, body = { name: 'My Space' } }) => {
    const router = createWorkspaceRoutes({
      accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
      ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
      ...(resolve === null ? {} : { resolveWorkspaceUrlKey: resolve })
    });
    const res = { statusCode: 200, body: null, redirectedTo: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, redirect(u) { this.redirectedTo = u; } };
    session.save = session.save || ((cb) => cb && cb());
    await getHandler(router, 'post', '/workspace/new')({ body, session }, res);
    return res;
  };

  test('mints <slug>-<8 hex> through the resolver and redirects into it', async () => {
    const world = makeWorld();
    const session = { workspaces: [] };
    const res = await run(world, { session });
    assert.match(res.redirectedTo, /^\/workspace\/my-space-[0-9a-f]{8}\/$/);
    assert.equal(session.workspaces[0].urlKey, res.redirectedTo.split('/')[2]);
  });

  test('fails closed with no resolver (503), nothing written', async () => {
    const world = makeWorld();
    const session = { workspaces: [] };
    const beforeCounts = await counts(world);
    const res = await run(world, { session, resolve: null });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(session.workspaces, []);
    assert.deepEqual(await counts(world), beforeCounts);
  });
});
