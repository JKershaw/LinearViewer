/**
 * LIN-2802 — GitHub signed-in "new workspace" mints a fresh container.
 *
 * The switcher's new "+ GitHub Issues" row (tests/unit/lin-2802-workspace-add-rows.test.js)
 * points at `GET /auth/github?mode=new` while signed in. Before this ticket the
 * new-mode link handler always found-or-created the per-account `github:<userId>`
 * container, so a second "+ GitHub Issues" click silently rejoined the first
 * GitHub workspace instead of minting a second one. This file pins the fix:
 *
 *   1. `intent.fresh` is captured at flow START (`GET /auth/github`), gated on
 *      `mode === 'new' && session.accountId && supportsFreshContainer` — never
 *      inferred later at the link step.
 *   2. `deriveGithubFreshUrlKey`, the pure urlKey-collision helper (mirrors
 *      `deriveJiraUrlKey`'s shape), including the underscore/dot fixture cases.
 *   3. `POST .../link` branches on `pending.fresh`: a fresh invocation mints a
 *      brand-new random-id container (never `github:<userId>`), even when the
 *      account already holds one; the MAX_WORKSPACES cap still applies.
 *   4. `github-projects` never sets `supportsFreshContainer`, so its signed-in
 *      `mode=new` behavior is untouched (F4 of the plan review).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createGitHubProjectsAuthRoutes } from '../../routes/github-projects-auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { deriveUrlKey } from '../../lib/workspace-urlkey.js';
import { getHandler, makeRes, makeSession } from '../fixtures/github-install-flow-branches.js';
import { MAX_WORKSPACES } from '../../lib/workspace.js';
import { withResolver } from './lin-3382-resolver-harness.js';

const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

function fakeGithubProvider() {
  return {
    name: 'github',
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`,
    beginInstall: ({ state }) => `https://github.com/apps/my-app/installations/new?state=${state}`,
    completeInstallation: async (installationId) => ({
      token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(installationId), tokenExpiresAt: '2026-06-25T20:00:00Z',
    }),
    listRepos: async () => ([{ slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false }]),
    completeAuth: async () => ({ access_token: 'gho_user' }),
    listReboundableRepos: async () => ([]),
    fetchViewer: async () => ({ id: 'human-42', login: 'octocat', name: 'The Octocat' }),
  };
}

function fakeGithubProjectsProvider() {
  return { ...fakeGithubProvider(), name: 'github-projects' };
}

// LIN-3382: `deriveGithubFreshUrlKey` (a session-local collision loop) is gone;
// the key is now `gh-<name>-<installationId>` from `deriveUrlKey`, held-tested by
// the resolver. The slugify fixtures (F3) stay as the name segment of that key.
describe('GitHub fresh-container key name segment (LIN-2802 F3 fixtures, via deriveUrlKey)', () => {
  const key = (repoName) => deriveUrlKey('github-fresh', { repoName, installationId: '99', scope: `octocat/${repoName}` });

  test('a plain repo name slugifies into the key', () => {
    assert.equal(key('hello-world'), 'gh-hello-world-99');
  });

  test('underscore repo name (LIN-2802 F3 fixture): my_repo -> my-repo', () => {
    assert.equal(key('my_repo'), 'gh-my-repo-99');
  });

  test('dotted repo name (LIN-2802 F3 fixture): foo.js -> foo-js', () => {
    assert.equal(key('foo.js'), 'gh-foo-js-99');
  });

  test('an unslugifiable name falls back to the github literal, not a silent empty string', () => {
    assert.equal(key('___'), 'gh-github-99');
    assert.equal(key(''), 'gh-github-99');
  });
});

describe('LIN-2802 — GET /auth/github captures intent.fresh at flow start', () => {
  let saved;
  const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  let dbClient, dbDir, acctCounter = 0;

  before(async () => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
    process.env.GITHUB_APP_SLUG = 'my-app';
    dbDir = mkdtempSync(join(tmpdir(), 'lin2802-fresh-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });
  after(async () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
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

  test('github descriptor: signed-in (accountId present) + mode=new sets intent.fresh = true', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    // LIN-1892 S2-1 (stated setup change, assertion unchanged): the switcher
    // click this pins comes from a session that holds a workspace. accountId
    // with ZERO workspaces (an email-only sign-in) is a different state, pinned
    // in tests/unit/lin-1892-github-from-account.test.js.
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github', bindings: [] }] });
    await handler({ query: { mode: 'new' }, session }, res);
    assert.equal(session.oauthIntent.fresh, true);
  });

  test('github descriptor: signed-OUT (no accountId) + mode=new never sets intent.fresh — byte-identical re-login', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession();
    await handler({ query: { mode: 'new' }, session }, res);
    assert.equal(session.oauthIntent.fresh, undefined);
  });

  test('github descriptor: signed-in add-source never sets intent.fresh (mode gate, not just accountId)', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github');
    const res = makeRes();
    const session = makeSession({ accountId: 'acct-1' });
    await handler({ query: { mode: 'add-source', workspace: 'acme' }, session }, res);
    assert.equal(session.oauthIntent.fresh, undefined);
  });

  test('F4 — github-projects descriptor never sets intent.fresh, signed-in mode=new, byte-identical to pre-ticket behavior', async () => {
    const router = createGitHubProjectsAuthRoutes({ ...withResolver(), provider: fakeGithubProjectsProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'get', '/auth/github-projects');
    const res = makeRes();
    const session = makeSession({ accountId: 'acct-1' });
    await handler({ query: { mode: 'new' }, session }, res);
    assert.equal(session.oauthIntent.fresh, undefined, 'github-projects has no switcher entry point and must never mint a fresh container');
  });
});

describe('LIN-2802 — POST /auth/github/link, pending.fresh branch', () => {
  let saved;
  const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  let dbClient, dbDir, acctCounter = 0;

  before(async () => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
    process.env.GITHUB_APP_SLUG = 'my-app';
    dbDir = mkdtempSync(join(tmpdir(), 'lin2802-fresh-link-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });
  after(async () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
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

  test('(b) mints a NEW random-id container even though github:<userId> already exists; existing workspace survives the regenerate', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [{ id: 'github:42', name: 'octocat', urlKey: 'octocat', provider: 'github', bindings: [] }],
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(session.workspaces.length, 2, 'the pre-existing github:<userId> workspace is preserved, plus the new one');
    const preexisting = session.workspaces.find(w => w.id === 'github:42');
    assert.ok(preexisting, 'pre-existing github:<userId> workspace survives the regenerate');
    const fresh = session.workspaces.find(w => w.id !== 'github:42');
    assert.ok(fresh, 'a second, distinct workspace was minted');
    assert.notEqual(fresh.id, 'github:42', 'the fresh container is never keyed github:<userId>');
    assert.match(fresh.id, /^[0-9a-f-]{36}$/, 'fresh id is a random UUID, the /workspace/new idiom');
    assert.equal(fresh.urlKey, 'gh-hello-world-99', 'urlKey is the resolver\'s id-bearing key (name segment + installation id)');
    assert.equal(session.activeWorkspaceId, fresh.id, 'activeWorkspaceId points at the new container');
    assert.equal(res.redirectedTo, `/workspace/${fresh.urlKey}/`);
  });

  test('(c) LIN-3382 (changed on purpose): picking the SAME repo twice in one session lands on the existing workspace instead of minting `<name>-2`', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');

    const session1 = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/my_repo' } , session: session1 }, makeRes());
    assert.equal(session1.workspaces.length, 1);
    assert.equal(session1.workspaces[0].urlKey, 'gh-my-repo-99');

    // Second invocation reads the FIRST invocation's resulting workspace list
    // as its own pre-existing state (mirrors two real, sequential clicks).
    const session2 = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: session1.workspaces,
    });
    const res2 = makeRes();
    await handler({ body: { repo: 'octocat/my_repo' }, session: session2 }, res2);
    assert.equal(session2.workspaces.length, 1, 'no second workspace on the same {provider, scope}');
    assert.equal(session2.activeWorkspaceId, session1.workspaces[0].id, 'lands on the existing workspace');
    assert.equal(res2.redirectedTo, '/workspace/gh-my-repo-99/');
    assert.equal(session2.githubPending, undefined, 'the pending pick is consumed');
  });

  test('(c) a different repo whose derived key is already live under another workspace gets a distinct, valid key', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [{ id: 'other', name: 'other', urlKey: 'gh-my-repo-99', bindings: [{ provider: 'github', scope: 'someone/else' }] }],
    });
    await handler({ body: { repo: 'octocat/my_repo' }, session }, makeRes());
    const minted = session.workspaces.find(w => w.id !== 'other');
    assert.ok(minted);
    assert.notEqual(minted.urlKey, 'gh-my-repo-99', 'never a key live under another workspace id');
    assert.match(minted.urlKey, /^[a-z0-9-]{1,50}$/);
  });

  test('(c) dotted repo name fixture: foo.js -> foo-js', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/foo.js' }, session }, makeRes());
    assert.equal(session.workspaces[0].urlKey, 'gh-foo-js-99');
  });

  test('(d) two consecutive fresh invocations with DIFFERENT repo names never collide', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');

    const session1 = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });
    await handler({ body: { repo: 'octocat/hello-world' }, session: session1 }, makeRes());

    const session2 = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: session1.workspaces,
    });
    await handler({ body: { repo: 'octocat/other-project' }, session: session2 }, makeRes());

    assert.equal(session2.workspaces.length, 2);
    const urlKeys = session2.workspaces.map(w => w.urlKey).sort();
    assert.deepEqual(urlKeys, ['gh-hello-world-99', 'gh-other-project-99']);
  });

  test('(e) at MAX_WORKSPACES, a fresh invocation renders the limit page; regenerate has already occurred; no establishAccount/prefs/activeWorkspaceId side effect follows', async () => {
    const router = createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...freshAccountStores() });
    const handler = getHandler(router, 'post', '/auth/github/link');
    const res = makeRes();
    const preexistingWorkspaces = Array.from({ length: MAX_WORKSPACES }, (_, i) => ({ id: `ws-${i}`, name: `Workspace ${i}`, urlKey: `ws-${i}` }));
    const session = makeSession({
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', fresh: true, login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: preexistingWorkspaces,
      activeWorkspaceId: 'ws-0',
    });
    const activeWorkspaceIdBefore = session.activeWorkspaceId;
    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body, /Workspace Limit Reached/);
    // regenerate() has already run by the time the cap throws (F2: upsertWorkspace
    // runs INSIDE the regenerate callback) — the session is the post-regenerate
    // shape (session.save/regenerate stubs intact, non-function keys wiped and
    // NOT yet re-populated beyond what the callback set before throwing).
    assert.equal(session.accountId, undefined, 'establishAccount never ran after the cap threw');
    assert.equal(session.activeWorkspaceId, undefined, 'activeWorkspaceId assignment never ran');
    assert.notEqual(session.activeWorkspaceId, activeWorkspaceIdBefore, 'the pre-regenerate activeWorkspaceId did not survive either — regenerate already wiped it');
  });
});
