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
import { withResolver } from './lin-3382-resolver-harness.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import {
  getHandler, makeRes, makeSession,
  STATELESS_RETURN_SHAPES, STATELESS_REQUEST_SHAPES, STATELESS_STILL_400_SHAPES,
} from '../fixtures/github-install-flow-branches.js';

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
  { basePath: '/auth/github', providerName: 'github', createRoutes: createGitHubAuthRoutes, bodyField: 'repo', newSlug: 'octocat/new-repo', pendingKey: 'githubPending', rebindMapKey: 'repoInstallations' },
  { basePath: '/auth/github-projects', providerName: 'github-projects', createRoutes: createGitHubProjectsAuthRoutes, bodyField: 'board', newSlug: 'octocat/7', pendingKey: 'githubProjectsPending', rebindMapKey: 'boardInstallations' },
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

async function post(router, path, body, session) {
  const res = makeRes();
  await getHandler(router, 'post', path)({ body, session }, res);
  return res;
}

// The action link an error page renders (`renderErrorPage`'s `.login-button`),
// un-escaped so it can be compared against a raw `?mode=…&workspace=…` target.
function actionUrlOf(res) {
  const m = String(res.body || '').match(/<a href="([^"]*)" class="login-button">/);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

// The provider calls the fix must make structurally unreachable on a stateless
// return: the OAuth code exchange and the installation-token mint.
function exchanges(provider) {
  return provider.calls.filter(c => c.startsWith('completeAuth:') || c.startsWith('completeInstallation:'));
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
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
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
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
        await get(router, callbackPath, { ...query }, makeSession());
        const unauthenticated = provider.calls.filter(c => c === `completeAuth:${query.code}` || c === `completeInstallation:${INSTALLATION_ID}`);
        assert.deepEqual(unauthenticated, [], 'no GitHub call is made on the strength of the stateless parameters');
      });
    }

    test(`${s.basePath}: harness sanity — the SAME follow/link driver completes a Harbour-initiated connect (passes at HEAD)`, async () => {
      const provider = spyProvider(s.providerName);
      const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
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
      const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
      const res = await get(router, callbackPath, { ...UPDATE_RETURNS['code+installation_id+setup_action=update'], state: 'attacker' }, makeSession({ oauthState: 'real' }));
      assert.equal(res.statusCode, 400);
      assert.equal(errorTitle(res), 'Session Expired');
      assert.deepEqual(provider.calls, []);
    });

    test(`${callbackPath}: control — the same update query with a live matching state reaches the picker`, async () => {
      const provider = spyProvider(s.providerName);
      const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
      const session = makeSession({ oauthState: 'live', oauthIntent: { mode: 'add-source', provider: s.providerName } });
      const res = await get(router, callbackPath, { installation_id: INSTALLATION_ID, setup_action: 'update', state: 'live' }, session);
      assert.equal(res.statusCode, 200);
      assert.ok(res.body.includes(`value="${s.newSlug}"`));
    });
  }

  // ===========================================================================
  // LIN-2882 rev 2 — the stateless-return classifier (planned behaviour).
  //
  // Failing-before: production still 400s EVERY stateless return at
  // lib/github-install-flow.js:291, so the restart/request-bypass/log cases
  // below are red at HEAD. The boundary and wrong-state cases are invariants
  // that pass at HEAD and must stay green after the fix.
  //
  // Test map (plan rev 2):
  //   - classifier restart shapes            → STATELESS_RETURN_SHAPES
  //   - request bypass (± code)               → STATELESS_REQUEST_SHAPES
  //   - hostile query isolation + targets     → "hostile query …"
  //   - empty `state=`                        → "state='' is treated as absent"
  //   - still-400 boundary (golden fixture)   → STATELESS_STILL_400_SHAPES
  //   - present-but-wrong state, all actions  → "present-but-wrong state …"
  //   - stale pendingKey precedence (finding 1)
  //   - retry-site actionUrl swap
  //   - signed-in `fresh` re-derivation (finding 6)
  //   - mandatory intended-workspace binding (finding 12)
  //   - observability labels N1/N2 (finding 11)
  // ===========================================================================
  for (const s of SURFACES) {
    const callbackPath = `${s.basePath}/callback`;
    const addSourceKey = { rebind: true, mode: 'add-source', [s.rebindMapKey]: {} };

    for (const [shape, query] of Object.entries(STATELESS_RETURN_SHAPES)) {
      test(`${callbackPath} stateless [${shape}]: 302 restart to this surface's begin, no exchange`, async () => {
        const provider = spyProvider(s.providerName);
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
        const res = await get(router, callbackPath, { ...query }, makeSession());
        assert.equal(res.redirectedTo, s.basePath, `expected a restart, got ${res.statusCode} ${errorTitle(res)}`);
        assert.equal(res.body, null, 'a restart renders no error page');
        assert.deepEqual(exchanges(provider), [], 'the stateless return exchanges/mints nothing');
      });
    }

    for (const [shape, query] of Object.entries(STATELESS_REQUEST_SHAPES)) {
      test(`${callbackPath} stateless [${shape}]: existing admin-approval response, no exchange`, async () => {
        const provider = spyProvider(s.providerName);
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
        const res = await get(router, callbackPath, { ...query }, makeSession());
        assert.equal(errorTitle(res), 'Installation Incomplete', `expected admin-approval, got ${res.statusCode} ${errorTitle(res)}`);
        assert.match(res.body, /organization admin to approve/);
        assert.equal(actionUrlOf(res), s.basePath);
        assert.deepEqual(exchanges(provider), [], 'request+code must never fall through to exchange');
      });
    }

    test(`${callbackPath} stateless update: hostile query workspace/mode never leaks into the restart`, async () => {
      const cases = [
        [makeSession({ oauthIntent: { mode: 'new', provider: s.providerName } }), s.basePath],
        [makeSession({ [s.pendingKey]: { ...addSourceKey } }), `${s.basePath}?mode=add-source`],
        [makeSession({ [s.pendingKey]: { ...addSourceKey, workspaceUrlKey: 'acme' } }), `${s.basePath}?mode=add-source&workspace=acme`],
        [makeSession({ [s.pendingKey]: { ...addSourceKey, workspaceUrlKey: 'not a valid key!' } }), `${s.basePath}?mode=add-source`],
        [makeSession({
          oauthIntent: { mode: 'add-source', provider: s.providerName, workspaceUrlKey: 'fresh-ws' },
          [s.pendingKey]: { ...addSourceKey, workspaceUrlKey: 'stale-ws' },
        }), `${s.basePath}?mode=add-source&workspace=fresh-ws`],
        [makeSession(), s.basePath],
      ];
      for (const [session, expected] of cases) {
        const provider = spyProvider(s.providerName);
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
        const res = await get(router, callbackPath, {
          installation_id: INSTALLATION_ID, setup_action: 'update',
          workspace: 'HOSTILE-WORKSPACE', mode: 'HOSTILE-MODE',
        }, session);
        assert.equal(res.redirectedTo, expected, `restart target must come from the session, not the query (${expected})`);
        assert.deepEqual(exchanges(provider), []);
      }
    });

    test(`${callbackPath} state='' is treated as absent (restart and request-bypass alike)`, async () => {
      const provider = spyProvider(s.providerName);
      const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
      const restart = await get(router, callbackPath, { installation_id: INSTALLATION_ID, setup_action: 'update', state: '' }, makeSession());
      assert.equal(restart.redirectedTo, s.basePath);
      const request = await get(router, callbackPath, { setup_action: 'request', code: 'github-initiated-code', state: '' }, makeSession());
      assert.equal(errorTitle(request), 'Installation Incomplete');
      assert.deepEqual(exchanges(provider), []);
    });

    for (const [shape, query] of Object.entries(STATELESS_STILL_400_SHAPES)) {
      test(`${callbackPath} stateless [${shape}] still 400s (classifier boundary)`, async () => {
        const provider = spyProvider(s.providerName);
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
        const res = await get(router, callbackPath, { ...query }, makeSession({ oauthState: 'real' }));
        assert.equal(res.statusCode, 400);
        assert.equal(errorTitle(res), 'Session Expired');
        assert.deepEqual(exchanges(provider), []);
      });
    }

    test(`${callbackPath} present-but-wrong state still 400s for every setup_action`, async () => {
      for (const query of [
        { installation_id: INSTALLATION_ID, setup_action: 'update', state: 'attacker' },
        { installation_id: INSTALLATION_ID, setup_action: 'install', state: 'attacker' },
        { setup_action: 'request', state: 'attacker' },
      ]) {
        const provider = spyProvider(s.providerName);
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
        const res = await get(router, callbackPath, query, makeSession({ oauthState: 'real' }));
        assert.equal(res.statusCode, 400, JSON.stringify(query));
        assert.equal(errorTitle(res), 'Session Expired');
        assert.deepEqual(exchanges(provider), []);
      }
    });

    test(`${callbackPath} a stateful (valid state) request is unchanged`, async () => {
      const router = s.createRoutes({ provider: spyProvider(s.providerName), ...freshAccountStores() });
      const res = await get(router, callbackPath, { setup_action: 'request', state: 'live' }, makeSession({ oauthState: 'live' }));
      assert.equal(res.statusCode, 400);
      assert.equal(errorTitle(res), 'Installation Incomplete');
    });

    test(`${callbackPath} a stale add-source pendingKey does not hijack an unrelated mode=new retry`, async () => {
      const provider = { ...spyProvider(s.providerName), completeAuth: async () => { throw new Error('exchange boom'); } };
      const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
      const session = makeSession({
        [s.pendingKey]: { ...addSourceKey, workspaceUrlKey: 'stale-acme' },
      });
      await get(router, s.basePath, {}, session);
      assert.equal(session.oauthIntent.mode, 'new');
      const res = await get(router, callbackPath, { code: 'c', state: session.oauthState }, session);
      assert.equal(errorTitle(res), 'Authentication Failed');
      assert.equal(actionUrlOf(res), s.basePath, 'retry follows the CURRENT mode=new intent, not the stale pendingKey');
    });

    test(`${callbackPath} retry-site actionUrl carries the add-source intent (restartUrl swap)`, async () => {
      const provider = { ...spyProvider(s.providerName), completeAuth: async () => { throw new Error('exchange boom'); } };
      const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
      const session = makeSession({
        oauthState: 'live',
        oauthIntent: { mode: 'add-source', provider: s.providerName, workspaceUrlKey: 'acme' },
      });
      const res = await get(router, callbackPath, { code: 'c', state: 'live' }, session);
      assert.equal(errorTitle(res), 'Authentication Failed');
      assert.equal(actionUrlOf(res), `${s.basePath}?mode=add-source&workspace=acme`);
    });

    test(`${callbackPath} mandatory: an add-source picker restart binds to the SAME intended workspace`, async () => {
      const provider = spyProvider(s.providerName);
      // A real signed-in account: `establishAccount`/`linkIdentity` reject a
      // session.accountId with no matching account, so the fixture must mint one.
      const stores = freshAccountStores();
      const signedInAccount = await stores.accountStore.createAccount();
      const router = s.createRoutes({ ...withResolver(), provider, ...stores });
      const session = makeSession({
        accountId: signedInAccount._id,
        workspaces: [
          { id: 'ws-tangle', name: 'Tangle', urlKey: 'tangle', provider: 'linear', accessToken: 'lin_tok' },
          { id: 'ws-other', name: 'Other', urlKey: 'other', provider: 'linear', accessToken: 'lin2' },
        ],
        activeWorkspaceId: 'ws-other',
      });
      // 1. add-source begin for the viewed (non-active) workspace.
      const begin = await get(router, s.basePath, { mode: 'add-source', workspace: 'tangle' }, session);
      assert.equal(session.oauthIntent.workspaceUrlKey, 'tangle');
      // 2. picker renders: nonce consumed, intent stashed on the pending key.
      const { res: picker } = await follow(router, s.basePath, session, begin);
      assert.equal(picker.statusCode, 200, `expected picker, got ${picker.statusCode} ${errorTitle(picker)}`);
      assert.equal(session[s.pendingKey].workspaceUrlKey, 'tangle');
      // 3. a stateless GitHub-started update return restarts carrying the intent.
      const ret = await get(router, callbackPath, { installation_id: INSTALLATION_ID, setup_action: 'update' }, session);
      assert.equal(ret.redirectedTo, `${s.basePath}?mode=add-source&workspace=tangle`);
      // 4. follow the restart round-trip, then complete the link.
      const { res: picker2 } = await follow(router, s.basePath, session, ret);
      assert.equal(picker2.statusCode, 200, `expected picker after restart, got ${picker2.statusCode} ${errorTitle(picker2)}`);
      const link = await post(router, `${s.basePath}/link`, { [s.bodyField]: s.newSlug }, session);
      assert.match(String(link.redirectedTo), /^\/workspace\/tangle\//, 'binds into the intended workspace');
      const tangle = session.workspaces.find(w => w.urlKey === 'tangle');
      assert.ok(tangle.bindings.some(b => b.provider === s.providerName && b.scope === s.newSlug));
      assert.equal(session.workspaces.length, 2, 'no fresh container minted');
      const other = session.workspaces.find(w => w.urlKey === 'other');
      assert.ok(!(other.bindings || []).some(b => b.provider === s.providerName && b.scope === s.newSlug), 'not bound to the active workspace');
    });

    test(`${callbackPath} logs statelessRestart with normalised flags only (N1/N2)`, async (t) => {
      const logs = [];
      t.mock.method(console, 'log', (...args) => { logs.push(args); });
      const router = s.createRoutes({ provider: spyProvider(s.providerName), ...freshAccountStores() });
      const session = makeSession({ oauthIntent: { mode: 'add-source', provider: s.providerName, workspaceUrlKey: 'acme' } });
      const res = await get(router, callbackPath, {
        installation_id: '999', setup_action: 'update',
        workspace: 'HOSTILE-WORKSPACE', mode: 'HOSTILE-MODE', code: 'SECRET-CODE',
      }, session);
      assert.equal(res.redirectedTo, `${s.basePath}?mode=add-source&workspace=acme`);
      const entry = logs.find(([label]) => typeof label === 'string' && label.includes('stateless-return restart'));
      assert.ok(entry, `expected a statelessRestart log; saw ${JSON.stringify(logs.map(l => l[0]))}`);
      const payload = entry[1];
      assert.equal(payload.setupAction, 'update');
      assert.equal(payload.hasCode, true);
      assert.equal(payload.hasInstallationId, true);
      assert.strictEqual(typeof payload.intentCarried, 'boolean');
      assert.equal(payload.intentCarried, true);
      assert.equal(payload.restarted, true);
      const logged = JSON.stringify(entry);
      for (const raw of ['HOSTILE-WORKSPACE', 'HOSTILE-MODE', 'SECRET-CODE', '999', 'acme']) {
        assert.ok(!logged.includes(raw), `raw value ${raw} must not be logged`);
      }
    });

    test(`${callbackPath} logs statelessRestart (restarted:false) for the request bypass`, async (t) => {
      const logs = [];
      t.mock.method(console, 'log', (...args) => { logs.push(args); });
      const router = s.createRoutes({ provider: spyProvider(s.providerName), ...freshAccountStores() });
      const res = await get(router, callbackPath, { setup_action: 'request', code: 'SECRET-CODE' }, makeSession());
      assert.equal(errorTitle(res), 'Installation Incomplete');
      const entry = logs.find(([label]) => typeof label === 'string' && label.includes('stateless-return restart'));
      assert.ok(entry, `expected a statelessRestart log; saw ${JSON.stringify(logs.map(l => l[0]))}`);
      const payload = entry[1];
      assert.equal(payload.setupAction, 'request');
      assert.equal(payload.restarted, false);
      assert.equal(payload.hasInstallationId, false);
      assert.equal(payload.hasCode, true);
      assert.strictEqual(typeof payload.intentCarried, 'boolean');
      assert.equal(payload.intentCarried, false);
      assert.ok(!JSON.stringify(entry).includes('SECRET-CODE'));
    });

    test(`${callbackPath} logs guardRejected with setupAction normalised, never raw (N1)`, async (t) => {
      const logs = [];
      t.mock.method(console, 'log', (...args) => { logs.push(args); });
      const router = s.createRoutes({ provider: spyProvider(s.providerName), ...freshAccountStores() });
      const hostile = 'HOSTILE<script>alert(1)</script>';
      const res = await get(router, callbackPath, { setup_action: hostile, code: 'SECRET-CODE' }, makeSession({ oauthState: 'real' }));
      assert.equal(res.statusCode, 400);
      assert.equal(errorTitle(res), 'Session Expired');
      const entry = logs.find(([label]) => typeof label === 'string' && label.includes('guard'));
      assert.ok(entry, `expected a guardRejected log; saw ${JSON.stringify(logs.map(l => l[0]))}`);
      const payload = entry[1];
      assert.equal(payload.setupAction, 'other');
      assert.equal(payload.hasCode, true);
      assert.equal(payload.hasInstallationId, false);
      assert.equal(payload.hasState, false);
      assert.ok(!JSON.stringify(entry).includes('HOSTILE'));
      assert.ok(!JSON.stringify(entry).includes('SECRET-CODE'));
    });

    test(`${callbackPath} logs guardRejected for a present-but-wrong state`, async (t) => {
      const logs = [];
      t.mock.method(console, 'log', (...args) => { logs.push(args); });
      const router = s.createRoutes({ provider: spyProvider(s.providerName), ...freshAccountStores() });
      const res = await get(router, callbackPath, { installation_id: '99', setup_action: 'update', state: 'attacker' }, makeSession({ oauthState: 'real' }));
      assert.equal(res.statusCode, 400);
      const entry = logs.find(([label]) => typeof label === 'string' && label.includes('guard'));
      assert.ok(entry, `expected a guardRejected log; saw ${JSON.stringify(logs.map(l => l[0]))}`);
      assert.equal(entry[1].setupAction, 'update');
      assert.equal(entry[1].hasState, true);
      assert.equal(entry[1].hasInstallationId, true);
    });
  }

  test('/auth/github signed-in mode=new restart re-derives fresh at the begin handler (LIN-2802)', async () => {
    const s = SURFACES[0];
    const provider = spyProvider(s.providerName);
    const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
    // LIN-1892 S2-1 (stated setup change, assertions unchanged): a signed-in
    // "new" flow that mints a fresh container is the switcher click, from a
    // session that holds a workspace; accountId with zero workspaces (email-
    // only) now reuses github:<userId> (tests/unit/lin-1892-github-from-account.test.js).
    const session = makeSession({ accountId: 'acct-1', workspaces: [{ id: 'ws-existing', name: 'Existing', urlKey: 'existing', provider: 'linear', bindings: [] }] });
    const begin = await get(router, s.basePath, {}, session);
    assert.equal(session.oauthIntent.fresh, true, 'begin mints fresh for a signed-in new flow');
    const { res: picker } = await follow(router, s.basePath, session, begin);
    assert.equal(picker.statusCode, 200, `expected picker, got ${picker.statusCode} ${errorTitle(picker)}`);
    assert.equal(session[s.pendingKey].fresh, true, 'pending snapshots the fresh intent');
    const ret = await get(router, `${s.basePath}/callback`, { installation_id: INSTALLATION_ID, setup_action: 'update' }, session);
    assert.equal(ret.redirectedTo, s.basePath, 'a mode=new restart lands on the bare begin path');
    await get(router, s.basePath, {}, session);
    assert.equal(session.oauthIntent.fresh, true, 'the re-entered begin handler re-derives fresh');
  });

  // LIN-2882 review B2-1: every retry-site `actionUrl` that can see an
  // add-source intent carries it (restartUrl swap), one forced failure per
  // site (fe5190e8 line numbers). :741/:805 are omitted by design: they run
  // only after session.regenerate() on the mode=new arm, where restartUrl(req)
  // is provably bare basePath (same reasoning as reauthUrl at :785).
  for (const s of SURFACES) {
    const callbackPath = `${s.basePath}/callback`;
    const linkPath = `${s.basePath}/link`;
    const want = `${s.basePath}?mode=add-source&workspace=acme`;
    const boom = async () => { throw new Error('boom'); };
    const listReboundable = s.providerName === 'github' ? 'listReboundableRepos' : 'listReboundableBoards';
    const listChoices = s.providerName === 'github' ? 'listRepos' : 'listBoards';
    const cbSession = () => makeSession({
      oauthState: 'live',
      oauthIntent: { mode: 'add-source', provider: s.providerName, workspaceUrlKey: 'acme' },
    });
    const linkSession = (pending) => makeSession({
      [s.pendingKey]: { mode: 'add-source', workspaceUrlKey: 'acme', ...pending },
      githubHumanId: 'human-42',
      workspaces: [{ id: 'ws-acme', name: 'Acme', urlKey: 'acme', provider: 'linear', accessToken: 'lin_tok' }],
      activeWorkspaceId: 'ws-acme',
    });
    const install = { state: 'live', installation_id: INSTALLATION_ID, setup_action: 'install' };
    const SITES = [
      [':325 error=', {}, () => get, { error: 'access_denied' }, cbSession],
      [':377 state guard', {}, () => get, { state: 'wrong', installation_id: INSTALLATION_ID, setup_action: 'update' }, cbSession],
      [':399 completeAuth', { completeAuth: boom }, () => get, { state: 'live', code: 'c' }, cbSession],
      [':417 fetchViewer', { fetchViewer: boom }, () => get, { state: 'live', code: 'c' }, cbSession],
      [':428 listReboundable', { [listReboundable]: boom }, () => get, { state: 'live', code: 'c' }, cbSession],
      [':491 stateful request', {}, () => get, { state: 'live', setup_action: 'request' }, cbSession],
      [':508 completeInstallation', { completeInstallation: boom }, () => get, install, cbSession],
      [':520 listChoices', { [listChoices]: boom }, () => get, install, cbSession],
      [':546 callback catch', {}, () => get, install, () => Object.assign(cbSession(), { save() { throw new Error('save boom'); } })],
      [':569 link no pending', {}, () => post, {}, () => linkSession({})],
      [':576 link invalid slug', {}, () => post, { [s.bodyField]: 'not a slug!!' }, () => linkSession({ token: 'ghs_inst' })],
      [':593 link slug not in map', {}, () => post, { [s.bodyField]: s.newSlug }, () => linkSession({ rebind: true, [s.rebindMapKey]: {} })],
      [':816 link catch', {}, () => post, { [s.bodyField]: s.newSlug }, () => linkSession({ token: 'ghs_inst', login: 'octocat', userId: '42', installationId: INSTALLATION_ID, tokenExpiresAt: 'not-a-date' })],
    ];
    for (const [site, overrides, verb, input, session] of SITES) {
      test(`${s.basePath} retry site ${site}: actionUrl carries the add-source intent`, async () => {
        const provider = { ...spyProvider(s.providerName), ...overrides };
        const router = s.createRoutes({ ...withResolver(), provider, ...freshAccountStores() });
        const path = verb() === post ? linkPath : callbackPath;
        const res = await verb()(router, path, input, session());
        assert.ok(res.body, `expected an error page, got ${res.statusCode} redirect=${res.redirectedTo}`);
        assert.equal(actionUrlOf(res), want);
      });
    }
  }
});
