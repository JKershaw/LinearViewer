/**
 * LIN-3382 — the injection-path (hop) class, H1.
 *
 * `resolveWorkspaceUrlKey` is injected at server.js and must reach every bind
 * arm through the factories in between. The seven named-option factories each
 * destructure a FIXED list, so a hop that forgets to forward it silently drops
 * it — and a dropped resolver is a dropped refusal. Top-level injection alone is
 * therefore not enough; this test walks each hop for real:
 *
 *   1 createGitHubAuthRoutes          via GitHubProvider.getAuthRouter       -> install flow
 *   2 createGitHubProjectsAuthRoutes  via GitHubProjectsProvider.getAuthRouter -> install flow
 *   3 createGitHubInstallFlowRoutes   reached only through #1 and #2
 *   4 createHeldConnectionRoutes      mounted directly
 *   5 createJiraAuthRoutes            via JiraProvider.getAuthRouter
 *   6 createAuthRoutes                via LinearProvider.getAuthRouter
 *   7 createWorkspaceRoutes           mounted directly
 *
 * For each: with a SPY resolver the spy is reached with the right arm and the
 * workspace gets the spy's key (so the result, not a local derivation, is used);
 * with NO resolver the arm answers 503 and writes nothing. The server.js mounts
 * are pinned by symbol (source text), which is not enough on its own — the
 * behavioural half above is the point — but it fails if a mount stops passing it.
 *
 * A new eighth `create*Routes` factory that binds is caught by the K1 verdict
 * table in lin-3382-urlkey-class-guard.test.js (it must resolve its key).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHeldConnectionRoutes } from '../../routes/held-connection.js';
import { createWorkspaceRoutes } from '../../routes/workspace.js';
import { getProvider } from '../../lib/providers/index.js';
import { convertToConnectionBacked, createAuthorizedAccountConnectionReader, heldConnectionCredentials } from '../../lib/connection-credential.js';
import { getHandler, makeRes, makeSession } from '../fixtures/github-install-flow-branches.js';

const SPY_KEY = 'spy-resolved-key';

/** A resolver spy that records its requests and answers a fixed key. */
function spy() {
  const calls = [];
  const resolve = async (request) => { calls.push(request); return { urlKey: SPY_KEY, source: 'derived' }; };
  return { calls, resolve };
}

/** In-memory stores; every write is recorded so "nothing written" is a fact, not an absence of assertion. */
function memoryStores() {
  const writes = [];
  const rec = name => async (...args) => { writes.push([name, ...args]); return true; };
  const accountStore = {
    findAccountByIdentity: async () => null,
    createAccount: async () => { writes.push(['createAccount']); return { _id: 'acct-1' }; },
    linkIdentity: async (id, provider, scope) => { writes.push(['linkIdentity', provider, scope]); return { ok: true }; },
    getAccount: async () => null,
    resolveCanonicalAccountId: async id => id ?? null,
    listEmailIdentities: async () => []
  };
  const accountWorkspaceStore = {
    bindAccountToWorkspace: async (accountId, workspaceId) => { writes.push(['bind', accountId, workspaceId]); return { role: 'owner' }; },
    listAccountsForWorkspace: async () => []
  };
  const ownerCredentialStore = { put: rec('ownerPut'), get: async () => null, putByConnection: rec('ownerPutByConnection'), deleteAll: rec('ownerDeleteAll') };
  return { writes, accountStore, accountWorkspaceStore, ownerCredentialStore };
}

async function withPatched(target, patch, fn) {
  const original = {};
  for (const key of Object.keys(patch)) { original[key] = target[key]; target[key] = patch[key]; }
  try { return await fn(); } finally { for (const key of Object.keys(patch)) target[key] = original[key]; }
}

const GITHUB_ENV = { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 's' };
async function withEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

const pending = (over = {}) => ({ token: 't', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2030-01-01T00:00:00Z', ...over });

describe('H1 hops: the resolver is reached through each real factory path', () => {
  for (const hop of [
    { n: 1, name: 'createGitHubAuthRoutes via GitHubProvider.getAuthRouter', provider: 'github', base: '/auth/github', field: 'repo', slug: 'octocat/hello-world', pendingKey: 'githubPending', arm: 'github-fresh', fresh: true },
    { n: 3, name: 'createGitHubInstallFlowRoutes (container arm) via GitHubProvider.getAuthRouter', provider: 'github', base: '/auth/github', field: 'repo', slug: 'octocat/hello-world', pendingKey: 'githubPending', arm: 'github-container', fresh: false },
    { n: 2, name: 'createGitHubProjectsAuthRoutes via GitHubProjectsProvider.getAuthRouter', provider: 'github-projects', base: '/auth/github-projects', field: 'board', slug: 'octocat/7', pendingKey: 'githubProjectsPending', arm: 'github-container', fresh: false }
  ]) {
    test(`#${hop.n} ${hop.name}`, async () => {
      const provider = getProvider(hop.provider);
      const run = async (resolver) => {
        const stores = memoryStores();
        const router = provider.getAuthRouter({
          sessionStore: { cleanup: async () => {} },
          accountStore: stores.accountStore, accountWorkspaceStore: stores.accountWorkspaceStore, ownerCredentialStore: stores.ownerCredentialStore,
          ...(resolver ? { resolveWorkspaceUrlKey: resolver } : {})
        });
        const session = makeSession({ githubHumanId: 'h-42', [hop.pendingKey]: pending({ fresh: hop.fresh }), workspaces: [] });
        const res = makeRes();
        await getHandler(router, 'post', `${hop.base}/link`)({ body: { [hop.field]: hop.slug }, session }, res);
        return { res, session, stores };
      };

      const s = spy();
      const withSpy = await run(s.resolve);
      assert.equal(s.calls.length, 1, 'the injected resolver is reached through the real getAuthRouter -> factory -> install flow path');
      assert.equal(s.calls[0].arm, hop.arm);
      assert.equal(s.calls[0].provider, hop.provider);
      assert.equal(withSpy.session.workspaces[0]?.urlKey, SPY_KEY, 'the workspace carries the resolver\'s key, not a local derivation');

      const bare = await run(null);
      assert.equal(bare.res.statusCode, 503, 'no resolver: fail closed');
      assert.match(bare.res.body, /Connection Not Saved/);
      assert.deepEqual(bare.session.workspaces, [], 'nothing landed in the session');
      assert.deepEqual(bare.stores.writes, [], 'nothing was written to any store');
    });
  }

  test('#4 createHeldConnectionRoutes (mounted directly)', async () => {
    const INSTALL = '77';
    const connection = { _id: 'acct-1::github::77', accountId: 'acct-1', provider: 'github', unitId: INSTALL, referents: [], credentials: { token: 'x', installationId: INSTALL, tokenExpiresAt: Date.now() + 3_600_000 } };
    const heldProvider = {
      name: 'github', scopeType: 'repository', ui: { displayName: 'GitHub Issues' }, supports: m => m === 'listConnectionScopes',
      beginAuth: () => '/x', listConnectionScopes: async () => [{ slug: 'octo/a', name: 'octo/a', installationId: INSTALL }],
      heldScopeView: item => ({ scope: item.slug, label: item.name, installationId: item.installationId })
    };
    const run = async (resolver) => {
      const writes = [];
      const connectionStore = {
        link: async (...a) => { writes.push(['link', ...a]); return { ok: true }; },
        addReferent: async (...a) => { writes.push(['addReferent', ...a]); return true; },
        removeReferent: async () => true,
        readConnectionOutcome: async () => null,
        readConnectionsByAccountPrefix: async () => [connection],
        readConnectionsByIds: async () => [connection]
      };
      const route = createHeldConnectionRoutes({
        ...(resolver ? { resolveWorkspaceUrlKey: resolver } : {}),
        resolveProvider: () => heldProvider, connectionStore,
        accountWorkspaceStore: { bindAccountToWorkspace: async (...a) => { writes.push(['bind', ...a]); return { role: 'owner' }; } },
        listAuthorizedAccountConnections: createAuthorizedAccountConnectionReader({ connectionStore }),
        heldConnectionCredentials, connectionBackedWritesEnabled: () => true,
        convertToConnectionBacked: async () => { writes.push(['convert']); return { connectionBacked: true, finalize: async () => true }; },
        resolveCanonicalAccountId: id => id
      });
      const session = makeSession({ accountId: 'acct-1', workspaces: [], heldEntry: { provider: 'github', mode: 'new', beginUrl: '/auth/github' } });
      await getHandler(route, 'get', '/connect/:provider/held')({ params: { provider: 'github' }, session }, makeRes());
      const res = makeRes();
      await getHandler(route, 'post', '/connect/:provider/held/bind')({ params: { provider: 'github' }, session, body: { repo: 'octo/a' } }, res);
      return { res, session, writes };
    };

    const s = spy();
    const withSpy = await run(s.resolve);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].arm, 'github-fresh');
    assert.deepEqual(s.calls[0].ids, { repoName: 'a' }, 'held-new asks with the repo name alone: the key is a function of {provider, scope}');
    assert.equal(s.calls[0].scope, 'octo/a');
    assert.equal(withSpy.session.workspaces[0]?.urlKey, SPY_KEY);

    const bare = await run(null);
    assert.equal(bare.res.statusCode, 503);
    assert.deepEqual(bare.session.workspaces, []);
    assert.deepEqual(bare.writes, []);
  });

  test('#5 createJiraAuthRoutes via JiraProvider.getAuthRouter', async () => {
    const provider = getProvider('jira');
    const run = async (resolver) => {
      const stores = memoryStores();
      const router = provider.getAuthRouter({
        accountStore: stores.accountStore, accountWorkspaceStore: stores.accountWorkspaceStore, ownerCredentialStore: stores.ownerCredentialStore,
        ...(resolver ? { resolveWorkspaceUrlKey: resolver } : {})
      });
      const session = makeSession({
        workspaces: [],
        jiraPending: { mode: 'new', sites: [{ cloudId: 'cid-1', url: 'https://acme.atlassian.net', name: 'Acme' }], accessToken: 'a', expiresIn: 3600, refreshToken: 'ROTATING' }
      });
      const res = makeRes();
      await withPatched(provider, { validateCredential: async () => ({ accountId: '557058:abc', emailAddress: 'j@x' }) }, () =>
        getHandler(router, 'post', '/auth/jira/oauth/link')({ body: { cloudId: 'cid-1' }, session }, res));
      return { res, session, stores };
    };
    const s = spy();
    const withSpy = await run(s.resolve);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].arm, 'jira');
    assert.equal(withSpy.session.workspaces[0]?.urlKey, SPY_KEY);

    const bare = await run(null);
    assert.equal(bare.res.statusCode, 503);
    assert.deepEqual(bare.session.workspaces, []);
    assert.deepEqual(bare.stores.writes, []);
    assert.equal(bare.session.jiraPending.refreshToken, undefined, 'the carried refresh token is dropped on the fail-closed exit too');
  });

  test('#6 createAuthRoutes via LinearProvider.getAuthRouter', async () => {
    const provider = getProvider('linear');
    const run = async (resolver) => {
      const stores = memoryStores();
      const router = provider.getAuthRouter({
        sessionStore: { cleanup: async () => {} },
        accountStore: stores.accountStore, accountWorkspaceStore: stores.accountWorkspaceStore, ownerCredentialStore: stores.ownerCredentialStore,
        ...(resolver ? { resolveWorkspaceUrlKey: resolver } : {})
      });
      const session = makeSession({ oauthState: 'real', workspaces: [] });
      const res = makeRes();
      await withEnv({ LINEAR_CLIENT_ID: 'set', LINEAR_CLIENT_SECRET: 'set', LINEAR_REDIRECT_URI: 'set' }, () => withPatched(provider, {
        completeAuth: async () => ({ access_token: 'lin', refresh_token: 'r', expires_in: 86400 }),
        fetchOrganization: async () => ({ id: 'org-1', name: 'Acme', urlKey: 'acme' }),
        fetchViewer: async () => ({ id: 'v1' })
      }, () => getHandler(router, 'get', '/auth/callback')({ query: { code: 'c', state: 'real' }, session }, res)));
      return { res, session, stores };
    };
    const s = spy();
    const withSpy = await run(s.resolve);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].arm, 'linear');
    assert.equal(s.calls[0].ids.orgKey, 'acme');
    assert.equal(withSpy.session.workspaces[0]?.urlKey, SPY_KEY);

    const bare = await run(null);
    assert.equal(bare.res.statusCode, 503);
    assert.deepEqual(bare.session.workspaces, []);
    assert.deepEqual(bare.stores.writes, []);
  });

  test('#7 createWorkspaceRoutes (mounted directly)', async () => {
    const run = async (resolver) => {
      const stores = memoryStores();
      const router = createWorkspaceRoutes({
        accountStore: stores.accountStore, accountWorkspaceStore: stores.accountWorkspaceStore, ownerCredentialStore: stores.ownerCredentialStore,
        ...(resolver ? { resolveWorkspaceUrlKey: resolver } : {})
      });
      const session = { workspaces: [], save: cb => cb && cb() };
      const res = { statusCode: 200, body: null, redirectedTo: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, redirect(u) { this.redirectedTo = u; } };
      await getHandler(router, 'post', '/workspace/new')({ body: { name: 'Space' }, session }, res);
      return { res, session, stores };
    };
    const s = spy();
    const withSpy = await run(s.resolve);
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].arm, 'local');
    assert.equal(withSpy.session.workspaces[0]?.urlKey, SPY_KEY);

    const bare = await run(null);
    assert.equal(bare.res.statusCode, 503);
    assert.deepEqual(bare.session.workspaces, []);
    assert.deepEqual(bare.stores.writes, []);
  });
});

describe('server.js wiring (source pin; complements the behavioural hops above)', () => {
  const server = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');

  test('the resolver is built once, strict, over the real stores', () => {
    assert.equal((server.match(/createWorkspaceUrlKeyResolver\(/g) || []).length, 1, 'built exactly once');
    // anchored on the finder's own closing line, so the nested createReferentHolderReader({ strict: true }) cannot satisfy it
    assert.match(server, /createUrlKeyHolderFinder\(\{[\s\S]*?\n  strict: true\n\}\)\nconst resolveWorkspaceUrlKey = createWorkspaceUrlKeyResolver\(/);
    assert.match(server, /createReferentHolderReader\(\{ connectionStore, strict: true \}\)/);
    assert.match(server, /findUrlKeyHolders: \(urlKey\) => urlKeyHolderFinder\.findUrlKeyHolders\(urlKey\)/);
  });

  test('the resolver is built before the PAT middleware mounts, and reaches it (the eighth hop)', () => {
    const built = server.indexOf('createWorkspaceUrlKeyResolver(');
    const mounted = server.indexOf('createEnsurePATSession({');
    assert.ok(built > 0 && mounted > 0 && built < mounted, 'resolver construction sits above the PAT mount');
    assert.match(server, /createEnsurePATSession\(\{[^}]*\bresolveWorkspaceUrlKey\b[^}]*\}\)/);
  });

  test('the resolver reaches all three bind-arm mounts', () => {
    assert.match(server, /provider\.getAuthRouter\(\{[^}]*\bresolveWorkspaceUrlKey\b[^}]*\}\)/, 'the provider auth loop (GitHub, GitHub Projects, Jira, Linear)');
    assert.match(server, /createWorkspaceRoutes\(\{[^}]*\bresolveWorkspaceUrlKey\b[^}]*\}\)/, 'createWorkspaceRoutes');
    assert.match(server, /createHeldConnectionRoutes\(\{[\s\S]*?\bresolveWorkspaceUrlKey,[\s\S]*?\}\)\)/, 'createHeldConnectionRoutes');
  });
});
