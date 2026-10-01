/**
 * LIN-3125 Phase 1 — characterization of the `intent.fresh` behaviour at
 * `lib/github-install-flow.js` before/after its extraction into the shared
 * `isFreshNewWorkspaceIntent` predicate.
 *
 * This file deliberately imports ONLY the flow (not the held-entry module), so
 * it passes on the pre-extraction tree and on the post-extraction tree alike —
 * that is the behaviour-preservation evidence. The extraction must not change
 * which GET /auth/github requests set `intent.fresh`.
 *
 * Run with: node --test tests/unit/lin-3125-phase1-intent-characterization.test.js
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
import { getHandler, makeRes, makeSession } from '../fixtures/github-install-flow-branches.js';

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

describe('LIN-3125 Phase 1 — intent.fresh characterization (extraction is behaviour-preserving)', () => {
  let saved, dbClient, dbDir, counter = 0;

  before(async () => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    Object.assign(process.env, { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'secret', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'my-app' });
    dbDir = mkdtempSync(join(tmpdir(), 'lin3125-intent-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });

  after(async () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function handler() {
    const db = dbClient.db(`intent_${counter++}`);
    return getHandler(createGitHubAuthRoutes({
      provider: fakeGithubProvider(),
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    }), 'get', '/auth/github');
  }

  test('signed-in with a workspace + mode=new: intent.fresh === true (switcher / as-new-workspace)', async () => {
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] });
    await handler()({ query: { mode: 'new' }, session }, makeRes());
    assert.equal(session.oauthIntent.mode, 'new');
    assert.equal(session.oauthIntent.fresh, true);
  });

  test('email-only zero-workspace account + mode=new: no intent.fresh (LIN-1892 S2-1)', async () => {
    for (const workspaces of [[], undefined]) {
      const session = makeSession({ accountId: 'acct-email', ...(workspaces ? { workspaces } : {}) });
      await handler()({ query: { mode: 'new' }, session }, makeRes());
      assert.equal(session.oauthIntent.fresh, undefined, `workspaces=${JSON.stringify(workspaces)}`);
    }
  });

  test('add-source: never intent.fresh', async () => {
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-1', urlKey: 'acme' }] });
    await handler()({ query: { mode: 'add-source', workspace: 'acme' }, session }, makeRes());
    assert.equal(session.oauthIntent.mode, 'add-source');
    assert.equal(session.oauthIntent.fresh, undefined);
  });
});
