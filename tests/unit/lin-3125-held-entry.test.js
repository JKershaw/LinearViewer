/**
 * LIN-3125 Phase 3 — the held-connection ENTRY slice.
 *
 * Covers the approved plan's §D-F1/F2/F9 entry obligations:
 *   - the four approved emitters call `withHeldMarker` (pin + source scan);
 *   - `GET /auth/github` captures a MARKED request (D11 on, authorized held
 *     connection) into the server-side `heldEntry` + picker redirect, and falls
 *     through BYTE-IDENTICALLY to today's authorize redirect for every other
 *     request (the F1 marker-isolation class);
 *   - D11 off makes a marked request inert with zero held reads (F2);
 *   - a `setup_action=update` return from the held picker keeps the add-source
 *     target (F9) instead of restarting as `mode=new`;
 *   - the marker literal lives only in the helper (no emitter hardcodes it).
 *
 * Run with: node --test tests/unit/lin-3125-held-entry.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { createHeldConnectionRoutes } from '../../routes/held-connection.js';
import { reproofUrlForAccount, EMAIL_REPROOF_URL } from '../../lib/account-conflict.js';
import { renderGitHubRepoSelectPage, renderGitHubProjectSelectPage, renderLoginPage } from '../../lib/render-pages.js';
import { renderAccountHomePage, accountHomeSourceCtas } from '../../lib/render-account-home.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { getProvider } from '../../lib/providers/registry.js';
import { loadStrippedSources } from '../fixtures/connection-access-guards.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG', 'CONNECTION_BACKED_WRITES'];

const HELD_CONN = { _id: 'acct-1::github::77', accountId: 'acct-1', provider: 'github', referents: [] };

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200, body: null, redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    send(html) { this.body = html; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
  };
}

function makeSession(over = {}) {
  return {
    accountId: 'acct-1',
    workspaces: [{ id: 'w1', urlKey: 'acme' }],
    save(cb) { if (cb) cb(); },
    regenerate(cb) { cb(); },
    ...over,
  };
}

/** The GitHub surface's provider double: beginAuth needs no real config, supports the held method. */
function flowProvider(over = {}) {
  return {
    name: 'github',
    supports: (m) => m === 'listConnectionScopes',
    beginAuth: ({ state }) => `https://github.com/login/oauth/authorize?client_id=cid&state=${state}`,
    ...over,
  };
}

function buildFlow({ listAuthorizedAccountConnections, connectionBackedWritesEnabled, provider = flowProvider() } = {}) {
  return createGitHubAuthRoutes({
    provider,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
    accountWorkspaceStore: {},
    listAuthorizedAccountConnections,
    connectionBackedWritesEnabled,
  });
}

/** Redirect targets differ only by the random CSRF `state`; normalise it for byte comparison. */
const stripState = (url) => String(url).replace(/state=[0-9a-fA-F-]+/, 'state=STATE');

describe('LIN-3125 Phase 3 — held-connection entry', () => {
  let savedEnv;

  before(() => {
    savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    Object.assign(process.env, { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'app' });
  });
  after(() => {
    for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });
  beforeEach(() => { delete process.env.CONNECTION_BACKED_WRITES; });
  afterEach(() => { delete process.env.CONNECTION_BACKED_WRITES; });

  // -------------------------------------------------------------------------
  // Held hook: capture vs bare pass-through
  // -------------------------------------------------------------------------
  describe('held hook capture vs bare pass-through', () => {
    test('marker + D11 on + authorized held connection => heldEntry stored + picker redirect', async () => {
      const calls = [];
      const handler = getHandler(buildFlow({
        listAuthorizedAccountConnections: async (args) => { calls.push(args); return [HELD_CONN]; },
        connectionBackedWritesEnabled: () => true,
      }), 'get', '/auth/github');
      const session = makeSession();
      const res = makeRes();

      await handler({ query: { mode: 'add-source', workspace: 'acme', heldConnection: '1' }, session }, res);

      assert.equal(res.redirectedTo, '/connect/github/held', 'redirects into the held picker, never to GitHub');
      assert.deepEqual(session.heldEntry, {
        provider: 'github', mode: 'add-source', workspaceUrlKey: 'acme',
        beginUrl: '/auth/github?mode=add-source&workspace=acme',
      });
      assert.deepEqual(calls, [{ accountId: 'acct-1', provider: 'github' }], 'one owner-scoped read, canonical account');
    });

    test('held new-workspace entry capture (mode=new, fresh intent) stores the bare beginUrl', async () => {
      const handler = getHandler(buildFlow({
        listAuthorizedAccountConnections: async () => [HELD_CONN],
        connectionBackedWritesEnabled: () => true,
      }), 'get', '/auth/github');
      const session = makeSession();
      const res = makeRes();
      await handler({ query: { mode: 'new', heldConnection: '1' }, session }, res);
      assert.equal(res.redirectedTo, '/connect/github/held');
      assert.equal(session.heldEntry.beginUrl, '/auth/github');
      assert.equal(session.heldEntry.mode, 'new');
    });

    test('no marker + held connection + signed in => today\'s authorize redirect, no heldEntry, ZERO held reads', async () => {
      const calls = [];
      const handler = getHandler(buildFlow({
        listAuthorizedAccountConnections: async (a) => { calls.push(a); return [HELD_CONN]; },
        connectionBackedWritesEnabled: () => true,
      }), 'get', '/auth/github');
      const session = makeSession();
      const res = makeRes();
      await handler({ query: { mode: 'new' }, session }, res);

      assert.match(res.redirectedTo, /^https:\/\/github\.com\/login\/oauth\/authorize\?/, 'reaches authorize');
      assert.equal(session.heldEntry, undefined);
      assert.equal(calls.length, 0, 'an unmarked request does no held read');
    });

    test('marker with no usable held connection => authorize (sub-cases), zero capture', async () => {
      // The real reader filters by provider+owner and returns []; these three
      // variants are what "no connection / other provider's / other account's"
      // resolve to through that reader (its foreign-row exclusion is pinned in
      // lin-3125-phase1-held-entry.test.js).
      for (const label of ['no connection', "other provider's connection", "other account's connection"]) {
        const handler = getHandler(buildFlow({
          listAuthorizedAccountConnections: async () => [],
          connectionBackedWritesEnabled: () => true,
        }), 'get', '/auth/github');
        const session = makeSession();
        const res = makeRes();
        await handler({ query: { mode: 'add-source', workspace: 'acme', heldConnection: '1' }, session }, res);
        assert.match(res.redirectedTo, /^https:\/\/github\.com\/login\/oauth\/authorize\?/, label);
        assert.equal(session.heldEntry, undefined, label);
      }
    });

    test('marker + signed-out session => authorize, no capture', async () => {
      const handler = getHandler(buildFlow({
        listAuthorizedAccountConnections: async () => [HELD_CONN],
        connectionBackedWritesEnabled: () => true,
      }), 'get', '/auth/github');
      const session = makeSession({ accountId: undefined });
      const res = makeRes();
      await handler({ query: { mode: 'new', heldConnection: '1' }, session }, res);
      assert.match(res.redirectedTo, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
      assert.equal(session.heldEntry, undefined);
    });

    test('marker + declining provider (no listConnectionScopes) => authorize, zero held reads', async () => {
      const calls = [];
      const handler = getHandler(buildFlow({
        provider: flowProvider({ name: 'jira', supports: () => false }),
        listAuthorizedAccountConnections: async (a) => { calls.push(a); return [HELD_CONN]; },
        connectionBackedWritesEnabled: () => true,
      }), 'get', '/auth/github');
      const session = makeSession();
      const res = makeRes();
      await handler({ query: { mode: 'add-source', workspace: 'acme', heldConnection: '1' }, session }, res);
      assert.match(res.redirectedTo, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
      assert.equal(session.heldEntry, undefined);
      assert.equal(calls.length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // D11 (F2) at entry
  // -------------------------------------------------------------------------
  describe('D11 at entry', () => {
    test('CONNECTION_BACKED_WRITES=off: marked request is inert — byte-identical to unmarked, zero held reads', async () => {
      const calls = [];
      const build = () => buildFlow({
        listAuthorizedAccountConnections: async (a) => { calls.push(a); return [HELD_CONN]; },
        connectionBackedWritesEnabled: () => false,
      });

      const markedSession = makeSession();
      const markedRes = makeRes();
      await getHandler(build(), 'get', '/auth/github')({ query: { mode: 'add-source', workspace: 'acme', heldConnection: '1' }, session: markedSession }, markedRes);

      const bareSession = makeSession();
      const bareRes = makeRes();
      await getHandler(build(), 'get', '/auth/github')({ query: { mode: 'add-source', workspace: 'acme' }, session: bareSession }, bareRes);

      assert.match(markedRes.redirectedTo, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
      assert.equal(stripState(markedRes.redirectedTo), stripState(bareRes.redirectedTo), 'marked off is byte-identical to unmarked');
      assert.equal(markedSession.heldEntry, undefined);
      assert.equal(calls.length, 0, 'D11 off => zero held reads');
    });
  });

  // -------------------------------------------------------------------------
  // F9 — held add-source intent survives a stateless setup_action=update return
  // -------------------------------------------------------------------------
  describe('F9 — held add-source intent across a stateless update return', () => {
    test('held add-source picker -> setup_action=update return restarts into ?mode=add-source&workspace=<X>, not mode=new', async () => {
      const deps = {
        listAuthorizedAccountConnections: async () => [HELD_CONN],
        connectionBackedWritesEnabled: () => true,
      };
      const session = makeSession();
      // 1. the held entry stores the server-side intent.
      await getHandler(buildFlow(deps), 'get', '/auth/github')({ query: { mode: 'add-source', workspace: 'acme', heldConnection: '1' }, session }, makeRes());
      assert.equal(session.heldEntry.beginUrl, '/auth/github?mode=add-source&workspace=acme');

      // 2. GitHub returns statelessly after an update (no state, no code).
      const res = makeRes();
      await getHandler(buildFlow(deps), 'get', '/auth/github/callback')({ query: { installation_id: '88', setup_action: 'update' }, session }, res);

      assert.equal(res.redirectedTo, '/auth/github?mode=add-source&workspace=acme', 'keeps the add-source target');
      assert.ok(!res.redirectedTo.includes('heldConnection'), 'the restart is unmarked (no loop)');
    });

    test('F9 control: a stateless update with no held entry and no intent restarts to the bare basePath', async () => {
      const session = makeSession();
      const res = makeRes();
      await getHandler(buildFlow({ listAuthorizedAccountConnections: async () => [], connectionBackedWritesEnabled: () => true }), 'get', '/auth/github/callback')({ query: { installation_id: '88', setup_action: 'update' }, session }, res);
      assert.equal(res.redirectedTo, '/auth/github');
    });

    test('F9 precedence: a live oauthIntent wins over the held entry (most recent wins)', async () => {
      const deps = { listAuthorizedAccountConnections: async () => [HELD_CONN], connectionBackedWritesEnabled: () => true };
      const session = makeSession();
      await getHandler(buildFlow(deps), 'get', '/auth/github')({ query: { mode: 'add-source', workspace: 'acme', heldConnection: '1' }, session }, makeRes());
      session.oauthIntent = { mode: 'add-source', workspaceUrlKey: 'other' };
      const res = makeRes();
      await getHandler(buildFlow(deps), 'get', '/auth/github/callback')({ query: { installation_id: '88', setup_action: 'update' }, session }, res);
      assert.equal(res.redirectedTo, '/auth/github?mode=add-source&workspace=other');
    });
  });

  // -------------------------------------------------------------------------
  // Marker isolation: bare emitters stay bare, restart never carries it
  // -------------------------------------------------------------------------
  describe('marker isolation (F1)', () => {
    test('restartUrl never carries the marker (add-source and new intents)', async () => {
      const deps = { listAuthorizedAccountConnections: async () => [], connectionBackedWritesEnabled: () => true };

      // The stateless install/update return is the one restart SITE that redirects
      // (the other 18 render an error page whose actionUrl is restartUrl — pinned
      // by the LIN-2882 suite). Drive it for both intents.
      const s1 = makeSession({ oauthIntent: { mode: 'add-source', workspaceUrlKey: 'acme' } });
      const r1 = makeRes();
      await getHandler(buildFlow(deps), 'get', '/auth/github/callback')({ query: { installation_id: '88', setup_action: 'install' }, session: s1 }, r1);
      assert.equal(r1.redirectedTo, '/auth/github?mode=add-source&workspace=acme');
      assert.ok(!r1.redirectedTo.includes('heldConnection'));

      const s2 = makeSession();
      const r2 = makeRes();
      await getHandler(buildFlow(deps), 'get', '/auth/github/callback')({ query: { installation_id: '88', setup_action: 'install' }, session: s2 }, r2);
      assert.equal(r2.redirectedTo, '/auth/github');
      assert.ok(!r2.redirectedTo.includes('heldConnection'));

      // And the error-page restart sites keep the same unmarked actionUrl.
      const r3 = makeRes();
      await getHandler(buildFlow(deps), 'get', '/auth/github/callback')({ query: { error: 'access_denied' }, session: makeSession({ oauthIntent: { mode: 'add-source', workspaceUrlKey: 'acme' } }) }, r3);
      assert.equal(r3.statusCode, 400);
      assert.ok(r3.body.includes('/auth/github?mode=add-source&amp;workspace=acme') || r3.body.includes('/auth/github?mode=add-source&workspace=acme'));
      assert.ok(!r3.body.includes('heldConnection'));
    });

    test('repo-picker fallback + Projects retry hrefs are unmarked (renderer x2)', () => {
      assert.ok(!renderGitHubRepoSelectPage([], { mode: 'new' }).includes('heldConnection'), 'repo picker empty-state fallback');
      assert.ok(!renderGitHubProjectSelectPage([], { mode: 'new' }).includes('heldConnection'), 'projects retry');
    });

    test('account-home github CTA is unmarked', () => {
      for (const cta of accountHomeSourceCtas()) assert.ok(!cta.href.includes('heldConnection'), cta.name);
      assert.ok(!renderAccountHomePage({ emails: ['a@b.c'] }).includes('heldConnection'));
    });

    test('signed-out sign-in surfaces are unmarked', () => {
      assert.ok(!renderLoginPage({ githubEnabled: true }).includes('heldConnection'));
      assert.ok(!renderNavBar({ isLanding: true }).includes('heldConnection'));
    });

    test('conflict "Sign in again" reproof URL is the bare basePath (reaches authorize)', async () => {
      const accountStore = {
        getAccount: async () => ({ identities: [{ provider: 'github', id: 'x' }] }),
        listEmailIdentities: async () => [],
      };
      const url = await reproofUrlForAccount(accountStore, 'acct-1', '/auth/github');
      assert.equal(url, '/auth/github');
      assert.ok(!url.includes('heldConnection'));
      // and the scope of the re-proof mechanism itself is unchanged
      assert.equal(EMAIL_REPROOF_URL, '/auth/email/reproof');
    });

    test('entryCta.href is the unmarked literal; github-projects has no entryCta', () => {
      assert.equal(getProvider('github').entryCta.href, '/auth/github');
      assert.ok(!getProvider('github-projects').entryCta);
    });
  });

  // -------------------------------------------------------------------------
  // Source scan: exactly four helper call sites, literal only in the helper
  // -------------------------------------------------------------------------
  describe('source scan', () => {
    test('withHeldMarker( call sites are exactly the four approved emitters', () => {
      const sources = loadStrippedSources();
      const sites = [];
      for (const [rel, src] of sources) {
        src.split('\n').forEach((line, i) => {
          if (/function\s+withHeldMarker/.test(line)) return;
          if (/(^|[^.\w])withHeldMarker\(/.test(line)) sites.push(`${rel}:${i + 1}`);
        });
      }
      assert.equal(sites.length, 4, `expected 4 emitters, got:\n${sites.join('\n')}`);
      const files = sites.map(s => s.split(':')[0]).sort();
      assert.deepEqual(files, ['lib/components/navbar.js', 'lib/render-settings.js', 'server.js', 'server.js']);
    });

    test('no production file hardcodes the marker literal outside the helper', () => {
      const sources = loadStrippedSources();
      for (const [rel, src] of sources) {
        if (rel === 'lib/held-connection-entry.js') continue;
        assert.ok(!/heldConnection=1/.test(src), `${rel} hardcodes heldConnection=1 instead of using withHeldMarker`);
      }
    });
  });

  // -------------------------------------------------------------------------
  // The picker route is provider-gated (full GET/POST coverage lives in
  // lin-3125-picker-route.test.js; beat 3 replaced the 501 stub).
  // -------------------------------------------------------------------------
  describe('held picker route is provider-gated', () => {
    const routes = createHeldConnectionRoutes({
      resolveProvider: (n) => (n === 'github' ? { name: 'github', supports: (m) => m === 'listConnectionScopes' } : null),
    });
    const handler = getHandler(routes, 'get', '/connect/:provider/held');

    test('declining provider => 404', () => {
      const res = makeRes();
      handler({ params: { provider: 'jira' }, session: { heldEntry: { provider: 'jira' } } }, res);
      assert.equal(res.statusCode, 404);
    });
    test('missing/cross-provider heldEntry => 400 Session Expired', () => {
      const res = makeRes();
      handler({ params: { provider: 'github' }, session: { heldEntry: { provider: 'jira' } } }, res);
      assert.equal(res.statusCode, 400);
    });
  });
});
