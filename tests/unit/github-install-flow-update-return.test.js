/**
 * LIN-2882 — failing-before acceptance witness (scratch, investigation beat 3).
 *
 * The defect: a return GitHub initiates (not Harbour) — the user changed an
 * existing installation's repository access at
 * github.com/settings/installations/<id>, the page the LIN-2820 picker link
 * sends them to — reaches the shared nonce-guarded callback
 * (lib/github-install-flow.js:291) carrying `installation_id` +
 * `setup_action=update` (+ an OAuth `code` when "Request user authorization
 * (OAuth) during installation" is on) and NO Harbour `state`, and dead-ends on
 * 400 "Session Expired". Production hit: 2026-09-17T06:32:26Z.
 *
 * Acceptance signal (the leg criterion "connecting a GitHub repository
 * completes without getting stuck"): starting from that stateless return and
 * following only Harbour redirects plus GitHub's standard authorize
 * round-trip, the user reaches THIS surface's picker listing the NEWLY
 * granted choice, `POST {base}/link` 302s into a workspace, and a binding for
 * that choice exists in the session. A 200 page or a redirect alone is not
 * enough.
 *
 * Invariants that must hold both before and after the fix:
 *   - the stateless return must not exchange its `code` or mint from its
 *     `installation_id` before a Harbour-minted `state` round-trip (GitHub:
 *     "you should not rely on the validity of the installation_id parameter");
 *   - a PRESENT-but-wrong `state` is still rejected (CSRF guard intact).
 *
 * The completion tests FAIL at HEAD a1564830 (first hop is the 400) and must
 * pass after the fix. Hermetic: the provider is an in-memory spy.
 *
 * Run with: node --test tests/unit/github-install-flow-update-return.test.js
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
import { getHandler, makeRes, makeSession } from '../fixtures/github-install-flow-branches.js';

const { privateKey: RSA_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_PRIVATE_KEY.export({ type: 'pkcs1', format: 'pem' });

// The reporter's installation id (LIN-2882 description).
const INSTALLATION_ID = '142745078';

// A spy GitHub whose grant has just been widened: the reboundable/choice lists
// include the NEWLY granted item alongside the original one.
function spyProvider(name) {
  const calls = [];
  const repos = [
    { slug: 'octocat/hello-world', name: 'octocat/hello-world', private: false, installationId: INSTALLATION_ID },
    { slug: 'octocat/new-repo', name: 'octocat/new-repo', private: false, installationId: INSTALLATION_ID },
  ];
  const boards = [
    { login: 'octocat', number: 5, title: 'Roadmap', url: 'u', shortDescription: null, closed: false, installationId: INSTALLATION_ID },
    { login: 'octocat', number: 7, title: 'New Board', url: 'u', shortDescription: null, closed: false, installationId: INSTALLATION_ID },
  ];
  return {
    calls,
    name,
    beginAuth: ({ state }) => { calls.push('beginAuth'); return `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`; },
    beginInstall: ({ state }) => { calls.push('beginInstall'); return `https://github.com/apps/my-app/installations/new?state=${state}`; },
    completeAuth: async (code) => { calls.push(`completeAuth:${code}`); return { access_token: 'gho_user' }; },
    fetchViewer: async () => { calls.push('fetchViewer'); return { id: 'human-42', login: 'octocat' }; },
    completeInstallation: async (id) => {
      calls.push(`completeInstallation:${id}`);
      return { token: 'ghs_inst', login: 'octocat', userId: '42', installationId: String(id), tokenExpiresAt: '2099-01-01T00:00:00Z' };
    },
    listRepos: async () => { calls.push('listRepos'); return repos.map(({ installationId, ...r }) => r); },
    listReboundableRepos: async () => { calls.push('listReboundableRepos'); return repos; },
    listBoards: async () => { calls.push('listBoards'); return boards.map(({ installationId, ...b }) => b); },
    listReboundableBoards: async () => { calls.push('listReboundableBoards'); return boards; },
  };
}

const SURFACES = [
  { basePath: '/auth/github', providerName: 'github', createRoutes: createGitHubAuthRoutes, bodyField: 'repo', newSlug: 'octocat/new-repo' },
  { basePath: '/auth/github-projects', providerName: 'github-projects', createRoutes: createGitHubProjectsAuthRoutes, bodyField: 'board', newSlug: 'octocat/7' },
];

// The two shapes GitHub can send after a repository-access update:
//  - OAuth-during-install ON (the documented App config): code + installation_id + setup_action
//  - Setup URL + "Redirect on update" (no OAuth hop): installation_id + setup_action only
const UPDATE_RETURNS = {
  'code+installation_id+setup_action=update': { code: 'github-initiated-code', installation_id: INSTALLATION_ID, setup_action: 'update' },
  'installation_id+setup_action=update': { installation_id: INSTALLATION_ID, setup_action: 'update' },
};

function errorTitle(res) {
  return (res.body || '').match(/<h2 class="error-title">([^<]*)<\/h2>/)?.[1] ?? null;
}

async function get(router, path, query, session) {
  const res = makeRes();
  await getHandler(router, 'get', path)({ query, session }, res);
  return res;
}

/**
 * Follow a response the way a browser + GitHub would: Harbour-relative
 * redirects into this router, GitHub's authorize URL answered with a fresh
 * `code` carrying the SAME state, and installations/new answered as a
 * completed install. Stops on a non-redirect page. Returns the hop trace.
 */
async function follow(router, basePath, session, first) {
  const trace = [];
  let res = first;
  for (let hop = 0; hop < 6 && res.redirectedTo; hop++) {
    const to = res.redirectedTo;
    trace.push(to);
    const url = new URL(to, 'https://harbour.test');
    const query = Object.fromEntries(url.searchParams);
    if (url.hostname === 'github.com' && url.pathname === '/login/oauth/authorize') {
      res = await get(router, `${basePath}/callback`, { code: `authorize-code-${hop}`, state: query.state }, session);
    } else if (url.hostname === 'github.com' && url.pathname.endsWith('/installations/new')) {
      res = await get(router, `${basePath}/callback`, { code: `install-code-${hop}`, installation_id: INSTALLATION_ID, setup_action: 'install', state: query.state }, session);
    } else if (url.hostname === 'harbour.test' && (url.pathname === basePath || url.pathname === `${basePath}/callback`)) {
      res = await get(router, url.pathname, query, session);
    } else {
      break; // left this surface (e.g. /workspace/...) — caller inspects
    }
  }
  return { res, trace };
}

describe('LIN-2882 acceptance witness: a GitHub-initiated update return completes the connection', () => {
  const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
  let saved;
  let dbClient;
  let dbDir;
  let acctCounter = 0;
  before(async () => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'secret';
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_APP_PRIVATE_KEY = RSA_PEM;
    process.env.GITHUB_APP_SLUG = 'my-app';
    dbDir = mkdtempSync(join(tmpdir(), 'lin2882-witness-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });
  after(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
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

  for (const s of SURFACES) {
    const callbackPath = `${s.basePath}/callback`;

    for (const [shape, query] of Object.entries(UPDATE_RETURNS)) {
      test(`${callbackPath} [${shape}], no state: completes — picker lists the new grant, link binds it`, async () => {
        const provider = spyProvider(s.providerName);
        const router = s.createRoutes({ provider, ...freshAccountStores() });
        // The reporter's session: the picker already rendered once, so the
        // nonce is consumed (LIN-2499); nothing GitHub sends carries state.
        const session = makeSession();

        const first = await get(router, callbackPath, { ...query }, session);
        assert.notEqual(errorTitle(first), 'Session Expired', `stateless update return dead-ends: ${first.statusCode} ${errorTitle(first)}`);

        const { res: picker, trace } = await follow(router, s.basePath, session, first);
        assert.equal(picker.statusCode, 200, `expected this surface's picker after ${JSON.stringify(trace)}, got ${picker.statusCode} ${errorTitle(picker)}`);
        assert.ok(picker.body.includes(`value="${s.newSlug}"`), 'picker lists the newly granted choice');

        const link = makeRes();
        await getHandler(router, 'post', `${s.basePath}/link`)({ body: { [s.bodyField]: s.newSlug }, session }, link);
        assert.equal(link.statusCode, 200, `link errored: ${errorTitle(link)}`);
        assert.match(String(link.redirectedTo), /^\/workspace\//, 'link lands in a workspace');
        const bound = (session.workspaces || []).some(w => (w.bindings || []).some(b => b.provider === s.providerName && b.scope === s.newSlug));
        assert.ok(bound, `a ${s.providerName} binding for ${s.newSlug} exists in the session`);
      });

      test(`${callbackPath} [${shape}], no state: never exchanges the code or mints from installation_id unauthenticated`, async () => {
        const provider = spyProvider(s.providerName);
        const router = s.createRoutes({ provider, ...freshAccountStores() });
        await get(router, callbackPath, { ...query }, makeSession());
        const unauthenticated = provider.calls.filter(c => c === `completeAuth:${query.code}` || c === `completeInstallation:${INSTALLATION_ID}`);
        assert.deepEqual(unauthenticated, [], 'no GitHub call is made on the strength of the stateless parameters');
      });
    }

    test(`${s.basePath}: harness sanity — the SAME follow/link driver completes a Harbour-initiated connect (passes at HEAD)`, async () => {
      const provider = spyProvider(s.providerName);
      const router = s.createRoutes({ provider, ...freshAccountStores() });
      const session = makeSession();
      const begin = await get(router, s.basePath, {}, session);
      const { res: picker } = await follow(router, s.basePath, session, begin);
      assert.equal(picker.statusCode, 200);
      assert.ok(picker.body.includes(`value="${s.newSlug}"`));
      const link = makeRes();
      await getHandler(router, 'post', `${s.basePath}/link`)({ body: { [s.bodyField]: s.newSlug }, session }, link);
      assert.match(String(link.redirectedTo), /^\/workspace\//);
      assert.ok((session.workspaces || []).some(w => (w.bindings || []).some(b => b.provider === s.providerName && b.scope === s.newSlug)));
    });

    test(`${callbackPath}: a PRESENT but wrong state is still rejected (CSRF guard intact)`, async () => {
      const provider = spyProvider(s.providerName);
      const router = s.createRoutes({ provider, ...freshAccountStores() });
      const res = await get(router, callbackPath, { ...UPDATE_RETURNS['code+installation_id+setup_action=update'], state: 'attacker' }, makeSession({ oauthState: 'real' }));
      assert.equal(res.statusCode, 400);
      assert.equal(errorTitle(res), 'Session Expired');
      assert.deepEqual(provider.calls, []);
    });

    test(`${callbackPath}: control — the same update query with a live matching state reaches the picker`, async () => {
      const provider = spyProvider(s.providerName);
      const router = s.createRoutes({ provider, ...freshAccountStores() });
      const session = makeSession({ oauthState: 'live', oauthIntent: { mode: 'add-source', provider: s.providerName } });
      const res = await get(router, callbackPath, { installation_id: INSTALLATION_ID, setup_action: 'update', state: 'live' }, session);
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes(`value="${s.newSlug}"`));
    });
  }
});
