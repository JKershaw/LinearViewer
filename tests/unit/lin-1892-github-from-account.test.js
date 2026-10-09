/**
 * LIN-1892 S2-1 (verdict 0def5b66 H1): what connecting GitHub from `/account`
 * does. Chosen: option (c). `lib/github-install-flow.js` sets `intent.fresh`
 * only when the session already HOLDS a workspace (the LIN-2802 switcher
 * click). An email-only account (accountId, zero workspaces) connecting GitHub
 * is its first GitHub sign-in, so it reuses `github:<userId>`, exactly as a
 * signed-out GitHub login does, and links the GitHub identity onto the
 * email account instead of minting a duplicate random-id container per device.
 *
 * Run with: node --test tests/unit/lin-1892-github-from-account.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { establishAccount } from '../../lib/account-session.js';
import { accountHomeSourceCtas } from '../../lib/render-account-home.js';
import { getHandler, makeRes, makeSession } from '../fixtures/github-install-flow-branches.js';
import { withResolver } from './lin-3382-resolver-harness.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];

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

describe('LIN-1892 S2-1: connecting GitHub from /account (zero workspaces) reuses github:<userId>', () => {
  let saved, dbClient, dbDir, counter = 0;

  before(async () => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    Object.assign(process.env, { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'secret', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'my-app' });
    dbDir = mkdtempSync(join(tmpdir(), 'lin1892-github-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });
  after(async () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  function stores() {
    const db = dbClient.db(`acct_${counter++}`);
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  test('the account home\'s GitHub CTA is the registry entryCta (/auth/github, mode=new) when GitHub is configured', () => {
    const github = accountHomeSourceCtas().find(c => c.name === 'github');
    assert.ok(github, 'GitHub is offered when configured');
    assert.strictEqual(github.href, '/auth/github');
  });

  test('flow start: accountId with zero workspaces + mode=new does NOT set intent.fresh', async () => {
    const handler = getHandler(createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...stores() }), 'get', '/auth/github');
    for (const workspaces of [[], undefined]) {
      const session = makeSession({ accountId: 'acct-email', ...(workspaces ? { workspaces } : {}) });
      await handler({ query: { mode: 'new' }, session }, makeRes());
      assert.strictEqual(session.oauthIntent.mode, 'new');
      assert.strictEqual(session.oauthIntent.fresh, undefined, `workspaces=${JSON.stringify(workspaces)}`);
    }
  });

  test('flow start: the switcher state (accountId + a workspace) still sets intent.fresh (LIN-2802 unchanged)', async () => {
    const handler = getHandler(createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...stores() }), 'get', '/auth/github');
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] });
    await handler({ query: { mode: 'new' }, session }, makeRes());
    assert.strictEqual(session.oauthIntent.fresh, true);
  });

  test('link step: the email account gets the github:<userId> container and the GitHub identity, no duplicate container', async () => {
    const deps = stores();
    const emailSession = {};
    const emailAccount = await establishAccount(emailSession, deps.accountStore, deps.accountWorkspaceStore, 'email', 'a@x.io', {}, null);

    const handler = getHandler(createGitHubAuthRoutes({ ...withResolver(), provider: fakeGithubProvider(), ...deps }), 'post', '/auth/github/link');
    const res = makeRes();
    const session = makeSession({
      accountId: emailAccount.accountId,
      identityAuthenticatedAt: emailSession.identityAuthenticatedAt,
      githubHumanId: 'human-42',
      githubPending: { token: 'gho_token', mode: 'new', login: 'octocat', userId: '42', installationId: '99', tokenExpiresAt: '2026-06-25T20:00:00Z' },
      workspaces: [],
    });

    await handler({ body: { repo: 'octocat/hello-world' }, session }, res);

    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.workspaces[0].id, 'github:42', 'the per-account github:<userId> container, not a random-id fresh one');
    assert.strictEqual(session.accountId, emailAccount.accountId, 'still the email account');
    const account = await deps.accountStore.getAccount(emailAccount.accountId);
    assert.deepStrictEqual(account.identities.map(i => `${i.provider}:${i.scope}`), ['email:a@x.io', 'github:human-42']);
    assert.deepStrictEqual(await deps.accountWorkspaceStore.listWorkspacesForAccount(emailAccount.accountId), ['github:42']);
  });
});
