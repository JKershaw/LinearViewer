/**
 * LIN-3700 (step 1 of LIN-3394) — every site that binds an account to a workspace
 * records `{id, urlKey, provider}` into the urlKey registry, through its REAL
 * handler over REAL MangoDB stores.
 *
 * One table, one row per site. Per row:
 *   - success writes exactly one registry row (`_id` = urlKey, the six fields);
 *   - a refusal or an account conflict writes none;
 *   - a store that throws leaves the response, redirect and session as they were.
 *
 * The final row fails on any non-test production file that calls `establishAccount`
 * (or `bindAccountToWorkspace`) without being in the table or on the named
 * exclusion list, so a fourteenth site cannot be added silently.
 *
 * The helper's own contract is tests/unit/workspace-registry.test.js; the store's
 * is tests/unit/workspace-store.test.js.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
import { createEnsurePATSession } from '../../lib/pat-session.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { WorkspaceStore } from '../../lib/workspace-store.js';
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
  'LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI', 'CONNECTION_BACKED_WRITES', 'LINEAR_ACCESS_TOKEN'
];

let dbDir;
let client;
let counter = 0;
let savedEnv;
let quiet;

before(async () => {
  savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  Object.assign(process.env, {
    GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'app',
    LINEAR_CLIENT_ID: 'set', LINEAR_CLIENT_SECRET: 'set', LINEAR_REDIRECT_URI: 'set'
  });
  delete process.env.CONNECTION_BACKED_WRITES;
  dbDir = mkdtempSync(join(tmpdir(), 'lin3700-sites-'));
  client = new MangoClient(dbDir);
  await client.connect();
  // The sites log by design (a throwing store, an expected refusal); keep the run readable.
  quiet = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = () => {};
});
after(async () => {
  Object.assign(console, quiet);
  if (client?.close) await client.close();
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

function makeWorld({ throwingRegistry = false } = {}) {
  const db = client.db(`sites_${counter++}`);
  const world = {
    connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
    ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
    accountStore: new AccountStore({ collection: db.collection('accounts') }),
    accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    proxyTokenStore: new ProxyTokenStore({ collection: db.collection('proxy-tokens') }),
    dispatchTokenStore: new DispatchTokenStore({ collection: db.collection('dispatch-tokens') })
  };
  const real = new WorkspaceStore({ collection: db.collection('workspaces') });
  world.registry = real;
  world.workspaceStore = throwingRegistry
    ? { registerWorkspace: async () => { throw new Error('mongo down: mongodb://user:secret@host'); } }
    : real;
  world.resolve = createStoreBackedResolver(world);
  return world;
}

const rows = world => world.registry.collection.find({}).toArray();

async function newAccount(world, identity) {
  const account = await world.accountStore.createAccount();
  if (identity) await world.accountStore.linkIdentity(account._id, identity.provider, identity.scope, {});
  return account._id;
}

/**
 * The conflict fixture: the identity belongs to another account while
 * `session.accountId` is a different, live one (lin-3382-hop-class.test.js:51
 * returns null here, which is why it cannot reach the refusal).
 */
async function conflictAccounts(world, identity) {
  await newAccount(world, identity); // the owner of the identity
  return newAccount(world, null); // the live session's account
}

/** Everything the caller can observe, with the random parts masked. */
const observe = (res, session) => ({
  status: res.statusCode,
  redirect: res.redirectedTo ? String(res.redirectedTo).replace(/[0-9a-f]{8}/g, 'X') : null,
  workspaces: (session.workspaces || []).map(w => ({ ...w, id: undefined, addedAt: undefined })).length,
  accountSet: !!session.accountId
});

// ---- drivers -------------------------------------------------------------------------------

const pending = (over = {}) => ({ token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2030-06-25T20:00:00Z', ...over });
const fakeGithub = name => ({
  name,
  beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
  beginInstall: ({ state }) => `https://github.com/apps/app/installations/new?state=${state}`,
  completeInstallation: async (id) => ({ token: 'ghs', login: 'octocat', userId: '42', installationId: String(id), tokenExpiresAt: '2030-06-25T20:00:00Z' }),
  listRepos: async () => [], completeAuth: async () => ({ access_token: 'gho' }), listReboundableRepos: async () => [],
  fetchViewer: async () => ({ id: 'human-42', login: 'octocat', name: 'The Octocat' })
});
const LIVE = { id: 'w-live', name: 'Live', urlKey: 'live', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org' }] };

async function github(world, session, repo = 'octocat/hello-world') {
  const router = createGitHubAuthRoutes({
    provider: fakeGithub('github'), accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
    connectionStore: world.connectionStore, resolveWorkspaceUrlKey: world.resolve, workspaceStore: world.workspaceStore
  });
  const res = makeRes();
  await getHandler(router, 'post', '/auth/github/link')({ body: { repo }, session }, res);
  return res;
}
async function githubProjects(world, session, repo = 'octocat/7') {
  const router = createGitHubProjectsAuthRoutes({
    provider: fakeGithub('github-projects'), accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
    connectionStore: world.connectionStore, resolveWorkspaceUrlKey: world.resolve, workspaceStore: world.workspaceStore
  });
  const res = makeRes();
  await getHandler(router, 'post', '/auth/github-projects/link')({ body: { board: repo }, session }, res);
  return res;
}

const MYSELF = { accountId: '557058:abc', emailAddress: 'j@example.com', displayName: 'J' };
const SITE = { cloudId: 'cid-1', url: 'https://acme.atlassian.net', name: 'Acme' };
const JIRA_W = `jira:${MYSELF.accountId}`;
const JIRA_KEY = deriveUrlKey('jira', { cloudId: SITE.cloudId, workspaceId: JIRA_W });
const jiraRouter = world => createJiraAuthRoutes({
  provider: { validateCredential: async () => MYSELF },
  accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
  ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
  resolveWorkspaceUrlKey: world.resolve, workspaceStore: world.workspaceStore
});
const jiraPending = (over = {}) => ({ mode: 'new', sites: [SITE], accessToken: 'jira-access', expiresIn: 3600, refreshToken: 'ROTATING', ...over });

const ACME = { id: 'org-1', name: 'Acme', urlKey: 'acme' };
const linearProvider = (viewerId = 'v1') => ({
  name: 'linear',
  beginAuth: ({ state }) => `https://linear.app/oauth/authorize?state=${state}`,
  completeAuth: async () => ({ access_token: 'lin_tok', refresh_token: 'lin_refresh', expires_in: 86400 }),
  fetchOrganization: async () => ACME,
  fetchViewer: async () => ({ id: viewerId })
});
async function linearCallback(world, session, viewerId) {
  const router = createAuthRoutes({
    provider: linearProvider(viewerId), accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
    ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
    resolveWorkspaceUrlKey: world.resolve, workspaceStore: world.workspaceStore
  });
  const res = makeRes();
  await getHandler(router, 'get', '/auth/callback')({ query: { code: 'c', state: 'real' }, session }, res);
  return res;
}

/**
 * Each row: `urlKey` the registry key the success drives, `success`/`conflict`
 * build `{ world-side setup, session }` and run the handler. `conflict` is
 * `null` where the site has no account-conflict refusal of its own (documented).
 */
const SITES = [
  {
    site: 'lib/github-install-flow.js:845 (add-source)', provider: 'linear', id: LIVE.id, urlKey: 'live',
    async run(world, { conflict }) {
      const accountId = conflict ? await conflictAccounts(world, { provider: 'github', scope: 'human-42' }) : await newAccount(world, { provider: 'github', scope: 'human-42' });
      const session = makeSession({
        githubHumanId: 'human-42', githubPending: pending({ mode: 'add-source', fresh: false, workspaceUrlKey: 'live' }),
        accountId, workspaces: [structuredClone(LIVE)], activeWorkspaceId: LIVE.id
      });
      return { res: await github(world, session), session };
    }
  },
  {
    site: 'lib/github-install-flow.js:968 (live account container)', provider: 'github', id: 'github:42', urlKey: 'gh-42',
    async run(world, { conflict }) {
      const accountId = conflict ? await conflictAccounts(world, { provider: 'github', scope: 'human-42' }) : await newAccount(world, { provider: 'github', scope: 'human-42' });
      const session = makeSession({
        githubHumanId: 'human-42', githubPending: pending({ fresh: false }), accountId,
        workspaces: [{ id: 'github:42', name: 'octocat', urlKey: 'gh-42', provider: 'github', bindings: [] }]
      });
      return { res: await github(world, session), session };
    }
  },
  {
    site: 'lib/github-install-flow.js:1060 (new container, github-projects mount)', provider: 'github-projects', urlKey: 'gh-42',
    async run(world, { conflict }) {
      const accountId = conflict ? await conflictAccounts(world, { provider: 'github', scope: 'human-42' }) : await newAccount(world, { provider: 'github', scope: 'human-42' });
      const session = makeSession({ githubHumanId: 'human-42', githubProjectsPending: pending({ fresh: false }), accountId, workspaces: [] });
      return { res: await githubProjects(world, session), session };
    }
  },
  {
    site: 'routes/auth.js:280 (Linear add-source)', provider: 'linear', id: ACME.id, urlKey: 'acme',
    async run(world, { conflict }) {
      const accountId = conflict ? await conflictAccounts(world, { provider: 'linear', scope: 'v1' }) : await newAccount(world, { provider: 'linear', scope: 'v1' });
      const session = makeSession({
        oauthState: 'real', oauthIntent: { mode: 'add-source', provider: 'linear', workspaceUrlKey: 'live' },
        accountId, workspaces: [structuredClone(LIVE)], activeWorkspaceId: LIVE.id
      });
      return { res: await linearCallback(world, session, 'v1'), session };
    }
  },
  {
    site: 'routes/auth.js:423 (Linear new login)', provider: 'linear', id: ACME.id, urlKey: 'acme',
    async run(world, { conflict }) {
      const session = makeSession({ oauthState: 'real', workspaces: [] });
      if (conflict) session.accountId = await conflictAccounts(world, { provider: 'linear', scope: 'v1' });
      return { res: await linearCallback(world, session, 'v1'), session };
    }
  },
  {
    site: 'routes/jira-auth.js:295 (Basic link)', provider: 'linear', id: LIVE.id, urlKey: 'live',
    async run(world, { conflict }) {
      const accountId = conflict ? await conflictAccounts(world, { provider: 'jira', scope: MYSELF.accountId }) : await newAccount(world, { provider: 'jira', scope: MYSELF.accountId });
      const session = makeSession({ accountId, workspaces: [structuredClone(LIVE)], activeWorkspaceId: LIVE.id });
      const res = makeRes();
      await getHandler(jiraRouter(world), 'post', '/auth/jira/link')({
        body: { email: 'j@example.com', apiToken: 'tok', site: SITE.url, workspace: 'live' }, session
      }, res);
      return { res, session };
    }
  },
  {
    site: 'routes/jira-auth.js:629 (OAuth add-source)', provider: 'linear', id: LIVE.id, urlKey: 'live',
    async run(world, { conflict }) {
      const accountId = conflict ? await conflictAccounts(world, { provider: 'jira', scope: MYSELF.accountId }) : await newAccount(world, { provider: 'jira', scope: MYSELF.accountId });
      const session = makeSession({
        accountId, workspaces: [structuredClone(LIVE)], activeWorkspaceId: LIVE.id,
        jiraPending: jiraPending({ mode: 'add-source', workspaceUrlKey: 'live' })
      });
      const res = makeRes();
      await getHandler(jiraRouter(world), 'post', '/auth/jira/oauth/link')({ body: { cloudId: SITE.cloudId }, session }, res);
      return { res, session };
    }
  },
  {
    site: 'routes/jira-auth.js:838 (live Jira container)', provider: 'jira', id: JIRA_W, urlKey: JIRA_KEY,
    async run(world, { conflict }) {
      const accountId = conflict ? await conflictAccounts(world, { provider: 'jira', scope: MYSELF.accountId }) : await newAccount(world, { provider: 'jira', scope: MYSELF.accountId });
      const session = makeSession({
        accountId, jiraPending: jiraPending(),
        workspaces: [{ id: JIRA_W, name: 'Acme', urlKey: JIRA_KEY, provider: 'jira', bindings: [] }]
      });
      const res = makeRes();
      await getHandler(jiraRouter(world), 'post', '/auth/jira/oauth/link')({ body: { cloudId: SITE.cloudId }, session }, res);
      return { res, session };
    }
  },
  {
    site: 'routes/jira-auth.js:927 (new Jira container)', provider: 'jira', id: JIRA_W, urlKey: JIRA_KEY,
    async run(world, { conflict }) {
      const session = makeSession({ workspaces: [], jiraPending: jiraPending() });
      if (conflict) session.accountId = await conflictAccounts(world, { provider: 'jira', scope: MYSELF.accountId });
      const res = makeRes();
      await getHandler(jiraRouter(world), 'post', '/auth/jira/oauth/link')({ body: { cloudId: SITE.cloudId }, session }, res);
      return { res, session };
    }
  },
  {
    site: 'routes/workspace.js:88 (local create)', provider: 'local', conflict: null, // a fresh urlKey is the identity scope: it cannot conflict
    async run(world) {
      const router = createWorkspaceRoutes({
        accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
        ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
        resolveWorkspaceUrlKey: world.resolve, workspaceStore: world.workspaceStore
      });
      const session = makeSession({ workspaces: [] });
      const res = makeRes();
      await getHandler(router, 'post', '/workspace/new')({ body: { name: 'My Space' }, session }, res);
      return { res, session };
    }
  }
];

describe('every bind site records the registry row (LIN-3700)', () => {
  for (const row of SITES) {
    describe(row.site, () => {
      test('success writes exactly one row: {_id: urlKey, id, urlKey, provider, createdAt, updatedAt}', async () => {
        const world = makeWorld();
        const { res, session } = await row.run(world, { conflict: false });
        assert.equal(res.statusCode, 200, `the handler succeeded (${String(res.body).slice(0, 200)})`);
        const written = await rows(world);
        assert.equal(written.length, 1);
        const [doc] = written;
        assert.deepEqual(Object.keys(doc).sort(), ['_id', 'createdAt', 'id', 'provider', 'updatedAt', 'urlKey']);
        const bound = session.workspaces.find(w => w.urlKey === doc.urlKey);
        assert.ok(bound, 'the row is for a workspace the session now holds');
        assert.equal(doc._id, doc.urlKey);
        assert.equal(doc.id, bound.id);
        assert.equal(doc.provider, row.provider);
        if (row.urlKey) assert.equal(doc.urlKey, row.urlKey);
        if (row.id) assert.equal(doc.id, row.id);
      });

      if (row.conflict !== null) {
        test('an account conflict writes no row', async () => {
          const world = makeWorld();
          const { res } = await row.run(world, { conflict: true });
          assert.notEqual(res.statusCode, 200, 'the handler refused');
          assert.deepEqual(await rows(world), []);
        });
      }

      test('a throwing store leaves the response, redirect and session unchanged', async () => {
        const good = makeWorld();
        const expected = await row.run(good, { conflict: false });
        const bad = makeWorld({ throwingRegistry: true });
        const actual = await row.run(bad, { conflict: false });
        assert.deepEqual(observe(actual.res, actual.session), observe(expected.res, expected.session));
        assert.equal(actual.res.statusCode, 200);
        assert.deepEqual(await rows(bad), []);
      });
    });
  }
});

// =================================================================================
// The three sites with their own placement
// =================================================================================

describe('routes/account-merge.js:150 (merge confirm)', () => {
  const confirm = async (world, workspace) => {
    const canonical = await newAccount(world);
    const merged = await newAccount(world);
    const router = createAccountMergeRoutes({
      accountStore: world.accountStore, accountWorkspaceStore: world.accountWorkspaceStore,
      ownerCredentialStore: world.ownerCredentialStore, connectionStore: world.connectionStore,
      workspaceStore: world.workspaceStore
    });
    const session = makeSession({
      accountId: canonical, identityAuthenticatedAt: Date.now(),
      pendingMerge: {
        canonicalAccountId: canonical, mergedAccountId: merged, workspace, refreshToken: null,
        mode: 'new', returnUrlKey: workspace?.urlKey ?? '/', provider: 'linear', createdAt: Date.now()
      }
    });
    const res = makeRes();
    await getHandler(router, 'post', '/auth/merge/confirm')({ session }, res);
    return { res, session };
  };
  const arriving = () => ({
    id: 'org-other', name: 'Other', urlKey: 'other', provider: 'linear', accessToken: 'TOKEN-CANARY',
    bindings: [{ provider: 'linear', scope: 'org-other', credentials: { token: 'TOKEN-CANARY' } }]
  });

  test('a confirmed merge records the arriving workspace, and nothing but {id, urlKey, provider} reaches the store', async () => {
    const world = makeWorld();
    const seen = [];
    const spy = { registerWorkspace: async (entry) => { seen.push(entry); return world.registry.registerWorkspace(entry); } };
    world.workspaceStore = spy;
    const { res } = await confirm(world, arriving());
    assert.equal(res.redirectedTo, '/workspace/other/');
    assert.deepEqual(seen, [{ id: 'org-other', urlKey: 'other', provider: 'linear' }]);
    const [doc] = await rows(world);
    assert.deepEqual(Object.keys(doc).sort(), ['_id', 'createdAt', 'id', 'provider', 'updatedAt', 'urlKey']);
    assert.ok(!JSON.stringify(doc).includes('TOKEN-CANARY'));
  });

  test('a null-workspace merge (email link-mode) records nothing', async () => {
    const world = makeWorld();
    const { res } = await confirm(world, null);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(await rows(world), []);
  });

  test('a throwing store does not change the redirect', async () => {
    const world = makeWorld({ throwingRegistry: true });
    const { res } = await confirm(world, arriving());
    assert.equal(res.redirectedTo, '/workspace/other/');
  });
});

describe('lib/pat-session.js:119 (PAT auto-login)', () => {
  class FakeLinear extends ProviderInterface {
    constructor() { super(); this.name = 'linear'; }
    async fetchOrganization() { return { id: 'org-1', name: 'Acme', urlKey: 'acme' }; }
    async fetchViewer() { return { id: 'viewer-1' }; }
  }
  const run = async (world, { establishFails = false } = {}) => {
    registerProvider(new FakeLinear());
    process.env.LINEAR_ACCESS_TOKEN = 'lin_api_test';
    // linkIdentity answering a plain failure (no conflict) is how establishAccount returns !ok here.
    const accountStore = establishFails
      ? Object.assign(Object.create(world.accountStore), { linkIdentity: async () => ({ ok: false, reason: 'store-down' }) })
      : world.accountStore;
    const middleware = createEnsurePATSession({
      accountStore, accountWorkspaceStore: world.accountWorkspaceStore, resolveWorkspaceUrlKey: world.resolve,
      workspaceStore: world.workspaceStore
    });
    const session = makeSession({});
    let saves = 0;
    const save = session.save;
    session.save = (cb) => { saves++; return save.call(session, cb); };
    let nexted = false;
    await middleware({ path: '/', session }, {}, () => { nexted = true; });
    return { session, nexted, saves };
  };

  test('success records the org workspace', async () => {
    const world = makeWorld();
    const { session, nexted } = await run(world);
    assert.ok(nexted);
    assert.equal(session.workspaces.length, 1);
    const [doc] = await rows(world);
    assert.equal(doc._id, 'acme');
    assert.equal(doc.id, 'org-1');
    assert.equal(doc.provider, 'linear');
  });

  test('a failed establish records nothing, and the session is still saved', async () => {
    const world = makeWorld();
    const { nexted, saves } = await run(world, { establishFails: true });
    assert.ok(nexted);
    assert.ok(saves >= 1, 'the PAT session is saved either way (lib/pat-session.js carries on after the log)');
    assert.deepEqual(await rows(world), []);
  });

  test('a throwing store changes nothing the middleware does', async () => {
    const world = makeWorld({ throwingRegistry: true });
    const { session, nexted } = await run(world);
    assert.ok(nexted);
    assert.equal(session.workspaces.length, 1);
    assert.deepEqual(await rows(world), []);
  });
});

describe('routes/held-connection.js:364 (held-new bind)', () => {
  const ACCT = 'acct-held';
  const INSTALL = '77';
  const CONN_ID = `${ACCT}::github::${INSTALL}`;
  const NEW_KEY = deriveUrlKey('github-fresh', { repoName: 'a', provider: 'github', scope: 'octo/a' });
  const githubProvider = () => ({
    name: 'github', scopeType: 'repository', ui: { displayName: 'GitHub Issues' },
    supports: (m) => m === 'listConnectionScopes',
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
    async listConnectionScopes() { return [{ slug: 'octo/a', name: 'octo/a', private: false, installationId: INSTALL }]; },
    heldScopeView(item = {}) { return { scope: item.slug, label: item.name, installationId: item.installationId }; }
  });
  async function heldWorld(opts) {
    const world = makeWorld(opts);
    await world.connectionStore.collection.insertOne({
      _id: CONN_ID, accountId: ACCT, provider: 'github', unitId: INSTALL, origin: 'github', referents: [],
      credentials: { token: 'ghs_fresh', installationId: INSTALL, tokenExpiresAt: Date.now() + 3600_000 }
    });
    return world;
  }
  const mount = (world, { accountWorkspaceStore = world.accountWorkspaceStore } = {}) => createHeldConnectionRoutes({
    resolveWorkspaceUrlKey: world.resolve, workspaceStore: world.workspaceStore,
    resolveProvider: () => githubProvider(),
    connectionStore: world.connectionStore, accountWorkspaceStore,
    listAuthorizedAccountConnections: createAuthorizedAccountConnectionReader({ connectionStore: world.connectionStore }),
    heldConnectionCredentials, connectionBackedWritesEnabled: () => true, convertToConnectionBacked,
    resolveCanonicalAccountId: (id) => id
  });
  const heldSession = () => makeSession({
    accountId: ACCT, identityAuthenticatedAt: 111,
    workspaces: [{ id: 'w0', urlKey: 'base', bindings: [{ provider: 'linear', scope: 'org' }] }],
    heldEntry: { provider: 'github', mode: 'new', workspaceUrlKey: null, beginUrl: '/auth/github' }
  });
  async function bind(route, session) {
    await getHandler(route, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, makeRes());
    const res = makeRes();
    await getHandler(route, 'post', '/connect/:provider/held/bind')({ params: { provider: 'github' }, session, body: { repo: 'octo/a' } }, res);
    return res;
  }

  test('an owner bind records the new container', async () => {
    const world = await heldWorld();
    const session = heldSession();
    const res = await bind(mount(world), session);
    assert.equal(res.redirectedTo, `/workspace/${NEW_KEY}/`);
    const [doc] = await rows(world);
    assert.equal(doc._id, NEW_KEY);
    assert.equal(doc.provider, 'github');
    assert.equal(doc.id, session.workspaces.find(w => w.urlKey === NEW_KEY).id);
  });

  test('a non-owner edge (the bind is undone) records nothing', async () => {
    const world = await heldWorld();
    const session = heldSession();
    const res = await bind(mount(world, {
      accountWorkspaceStore: { ...world.accountWorkspaceStore, bindAccountToWorkspace: async () => ({ role: 'member' }) }
    }), session);
    assert.notEqual(res.redirectedTo, `/workspace/${NEW_KEY}/`);
    assert.deepEqual(await rows(world), []);
  });

  test('a throwing store leaves the redirect and the session as they were', async () => {
    const world = await heldWorld({ throwingRegistry: true });
    const session = heldSession();
    const res = await bind(mount(world), session);
    assert.equal(res.redirectedTo, `/workspace/${NEW_KEY}/`);
    assert.deepEqual(session.providerAdded, { provider: 'github', scope: 'octo/a' });
  });
});

// =================================================================================
// Remove then re-add, and the completeness guard
// =================================================================================

describe('remove then re-add (the lin-3382-bind-arms :190-197 flow)', () => {
  test('bind, remove, bind: one row, the second id, createdAt kept', async () => {
    const world = makeWorld();
    const me = await newAccount(world, { provider: 'github', scope: 'human-42' });
    const first = makeSession({ githubHumanId: 'human-42', githubPending: pending(), accountId: me, workspaces: [] });
    await github(world, first);
    const [before] = await rows(world);
    const firstId = first.workspaces[0].id;

    const second = makeSession({ githubHumanId: 'human-42', githubPending: pending(), accountId: me, workspaces: [] }); // expired session: the removed workspace is gone
    await github(world, second);
    const secondId = second.workspaces[0].id;
    assert.notEqual(firstId, secondId, 'GitHub-fresh mints a new random id for the same key');

    const after = await rows(world);
    assert.equal(after.length, 1);
    assert.equal(after[0].id, secondId);
    assert.equal(after[0]._id, before._id);
    assert.deepEqual(after[0].createdAt, before.createdAt);
  });
});

describe('completeness guard', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
  const code = file => fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const count = (text, re) => (text.match(re) || []).length;

  // Not sites, each with its reason (LIN-3700): null-workspace email (an identity, never a provider), the merge
  // re-point in account-store, the seam's own definition, test seeds, and the owner backfill / held add-source (no edge).
  const EXCLUDED = new Set([
    'routes/email-auth.js', 'lib/account-store.js', 'lib/account-session.js', 'routes/test.js', 'lib/owner-backfill.js'
  ]);

  test('every production file that binds an account to a workspace calls recordWorkspace once per bind', () => {
    const files = [...walk('lib'), ...walk('routes'), 'server.js'];
    const checked = [];
    for (const file of files) {
      if (EXCLUDED.has(file)) continue;
      const text = code(file);
      const binds = count(text, /\bestablishAccount\(|\.bindAccountToWorkspace\(/g);
      if (!binds) continue;
      checked.push(file);
      assert.equal(count(text, /\bawait recordWorkspace\(/g), binds, `${file}: ${binds} bind call(s) need as many recordWorkspace calls`);
    }
    assert.deepEqual(checked.sort(), [
      'lib/github-install-flow.js', 'lib/pat-session.js', 'routes/account-merge.js', 'routes/auth.js',
      'routes/held-connection.js', 'routes/jira-auth.js', 'routes/workspace.js'
    ]);
  });

  test('the excluded files never call recordWorkspace', () => {
    for (const file of EXCLUDED) {
      if (fs.existsSync(path.join(root, file))) assert.equal(count(code(file), /recordWorkspace/g), 0, file);
    }
  });
});
