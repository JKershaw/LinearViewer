/**
 * LIN-1890 — the Jira ENTRY layer: "Continue with Jira" for a Jira-only human.
 *
 * LIN-1887 delivered the OAuth mechanism (the 3LO round-trip, cloudId, the real
 * expiry, the provider-declared refresh strategy, the projection discriminator).
 * This file pins the layer on top of it, and deliberately does NOT re-assert any
 * of LIN-1887's own signals — `lin-1887-jira-oauth-routes.test.js` owns those,
 * and double-booking them is the duplication the two tickets were split to stop.
 *
 * What is genuinely new here, in the order it would hurt if it regressed:
 *
 *  1. E2 — a Jira-only sign-in ENDS WITH A USABLE WORKSPACE. Not "the callback
 *     returned 200": a workspace in the session, active, with an OAuth binding,
 *     reachable by its urlKey. That is the user outcome; a 200 is a proxy for it
 *     that can be green while the outcome is wrong.
 *  2. E6a — the COMPOSED join nobody else covers: the binding E2's bootstrap
 *     actually writes, run through the real `getWorkspaceCallScope` /
 *     `getBindingCallScope` projections, produces the OAuth call shape. Each
 *     half is tested elsewhere; that they meet correctly is not.
 *  3. E1 — `mode` selects the entry point, and `add-source` is UNCHANGED. The
 *     default flipped, so the regression this guards against is a settings
 *     "add a source" quietly minting a second workspace.
 *  4. The urlKey derivation, which cannot come from the identity.
 *
 * NOT proven here, stated rather than left implicit: no test in this repo drives
 * `/auth/jira/oauth` as HTTP against a real Atlassian exchange (LIN-1890 plan
 * R1 — the config predicate guards the callback too, so an e2e server 503s
 * both). Everything below fakes the network. Atlassian's runtime contract
 * remains unobserved by this ticket, exactly as it was by LIN-1887 (D3).
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';

import { createJiraAuthRoutes, deriveJiraUrlKey } from '../../routes/jira-auth.js';
import { getWorkspaceCallScope, getBindingCallScope, getWorkspaceToken } from '../../lib/workspace.js';

const ENV_KEYS = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.JIRA_CLIENT_ID = 'client-id-1';
  process.env.JIRA_CLIENT_SECRET = 'secret-1';
  process.env.JIRA_REDIRECT_URI = 'https://harbour.example/auth/jira/oauth/callback';
});
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

// ---------------------------------------------------------------------------
// Harness — mirrors lin-1887-jira-oauth-routes.test.js so the two files read the
// same way, with one addition: `regenerate`, which the `mode: 'new'` path runs
// and the add-source path never touches.
// ---------------------------------------------------------------------------

/**
 * A session that models the ONE behaviour of `express-session.regenerate` this
 * feature depends on: it wipes every field. If the bootstrap forgets to restore
 * `workspaces`, this is what makes that visible instead of silently passing.
 */
function makeSession(over = {}) {
  const session = {
    save(cb) { if (cb) cb(null); },
    regenerate(cb) {
      for (const key of Object.keys(this)) {
        if (typeof this[key] !== 'function') delete this[key];
      }
      cb(null);
    },
    ...over,
  };
  return session;
}

/** A session for a Jira-ONLY human: zero Linear and zero GitHub bindings. */
const jiraOnlySession = () => makeSession({ workspaces: [] });

/** A session that already holds a Linear workspace (the co-resident case). */
const withLinearSession = () => makeSession({
  accountId: 'acct-1',
  workspaces: [{ id: 'ws-1', urlKey: 'acme-linear', provider: 'linear', accessToken: 'linear-access', bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'linear-access' } }] }],
  activeWorkspaceId: 'ws-1',
});

function makeStore() {
  const records = new Map();
  return {
    records,
    async put(accountId, urlKey, credential) { records.set(`${accountId}::${urlKey}::${credential.provider || 'linear'}`, credential); return true; },
    async get(accountId, urlKey, provider = 'linear') { return records.get(`${accountId}::${urlKey}::${provider}`) ?? null; },
    async delete() { return true; },
    async deleteAll() { return true; },
  };
}

function makeAccountStores() {
  const identities = new Map();
  const bound = [];
  return {
    bound,
    accountStore: {
      async findAccountByIdentity(provider, scope) { return identities.get(`${provider}:${scope}`) ?? null; },
      async createAccount() { return { _id: 'acct-new' }; },
      async linkIdentity(accountId, provider, scope) { identities.set(`${provider}:${scope}`, { _id: accountId }); return { ok: true }; },
      async deleteAccount() { return true; },
    },
    accountWorkspaceStore: { async bindAccountToWorkspace(accountId, workspaceId) { bound.push([accountId, workspaceId]); return true; } },
  };
}

/**
 * A preferences store that records the accountId it was asked about. The
 * bootstrap must rehydrate preferences AFTER regenerate() (which wiped them)
 * and against the ESTABLISHED account, not a stale session value.
 */
function makePrefsStore(prefs = { features: { dispatch: true }, theme: 'dark' }) {
  const asked = [];
  return {
    asked,
    async getUserPreferences(accountId) { asked.push(accountId); return prefs; },
  };
}

const realFetch = globalThis.fetch;
let currentApp = null;
const rootApp = express();
rootApp.use((req, res, next) => (currentApp ? currentApp(req, res, next) : next()));
let server;
let baseUrl;

before(async () => {
  await new Promise(resolve => { server = rootApp.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  globalThis.fetch = realFetch;
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
});

function makeApp({ session, store, provider, prefsStore, stores = makeAccountStores(), fetches = {} }) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.session = session; next(); });
  globalThis.fetch = async (url, opts) => {
    for (const [match, handler] of Object.entries(fetches)) {
      if (String(url).includes(match)) return handler(url, opts);
    }
    throw new Error(`unstubbed fetch: ${url}`);
  };
  app.use(createJiraAuthRoutes({
    provider,
    accountStore: stores.accountStore,
    accountWorkspaceStore: stores.accountWorkspaceStore,
    ownerCredentialStore: store,
    userPreferencesStore: prefsStore,
  }));
  return app;
}

async function request(app, { method = 'GET', path, body }) {
  currentApp = app;
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    redirect: 'manual',
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}

const MYSELF = { accountId: '557058:2f1c9a0e-1111-2222-3333-444455556666', emailAddress: 'jira.only@example.com', displayName: 'Jira Only' };
const fakeProvider = (myself = MYSELF) => ({
  validateCredential: async (credential) => { fakeProvider.lastCredential = credential; return myself; },
});

const TOKEN_BAG = { access_token: 'jira-access-1', refresh_token: 'atlassian-refresh-ROTATING', expires_in: 3600 };
const ONE_SITE = [{ id: 'cid-1', url: 'https://acme.atlassian.net', name: 'Acme' }];
const TWO_SITES = [...ONE_SITE, { id: 'cid-2', url: 'https://other.atlassian.net', name: 'Other' }];

const stubs = (sites = ONE_SITE, bag = TOKEN_BAG) => ({
  'accessible-resources': async () => ({ ok: true, status: 200, json: async () => sites }),
  '/oauth/token': async () => ({ ok: true, status: 200, json: async () => bag }),
});

/** Drive begin → callback for a `mode: 'new'` login, returning the final response. */
async function signInWithJira({ session, store = makeStore(), prefsStore, stores = makeAccountStores(), sites = ONE_SITE }) {
  const app = makeApp({ session, store, provider: fakeProvider(), prefsStore, stores, fetches: stubs(sites) });
  const begin = await request(app, { path: '/auth/jira/oauth?mode=new' });
  const callback = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });
  return { app, begin, callback, store, stores };
}

// ---------------------------------------------------------------------------
// E1 — the entry route accepts `mode: 'new'`, and add-source is unchanged.
// ---------------------------------------------------------------------------

describe('LIN-1890 E1 — mode selects the entry point', () => {
  test('a landing login needs no workspace and records a `new` intent', async () => {
    const session = jiraOnlySession();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira/oauth?mode=new' });

    assert.equal(res.status, 302, 'a Jira-only visitor with no workspace must reach Atlassian, not a 400');
    assert.equal(new URL(res.location).origin, 'https://auth.atlassian.com');
    assert.deepEqual(session.oauthIntent, { mode: 'new', provider: 'jira' });
    assert.ok(!('workspaceUrlKey' in session.oauthIntent), 'a new login has no target workspace to carry');
  });

  test('`new` is the DEFAULT — a bare /auth/jira/oauth is a login, not a 400', async () => {
    const session = jiraOnlySession();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira/oauth' });
    assert.equal(res.status, 302);
    assert.equal(session.oauthIntent.mode, 'new');
  });

  test('state stays an opaque nonce carrying no intent', async () => {
    const session = jiraOnlySession();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira/oauth?mode=new' });
    const state = new URL(res.location).searchParams.get('state');
    assert.equal(state, session.oauthState);
    assert.doesNotMatch(state, /new|add-source|jira/, 'intent lives in the session (LIN-562), never in state');
  });

  test('CHARACTERIZATION: add-source still refuses an unresolvable workspace', async () => {
    // The guard LIN-1887 shipped, unchanged. `mode` gating it must not have
    // turned it into a soft fallback.
    const app = makeApp({ session: withLinearSession(), store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=not-mine' });
    assert.equal(res.status, 400);
  });

  test('CHARACTERIZATION: add-source carries the target workspace, new does not', async () => {
    const session = withLinearSession();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider() });
    await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=acme-linear' });
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme-linear' });
  });

  test('CHARACTERIZATION: an unconfigured server refuses BOTH entry points', async () => {
    // The predicate gates the promise and the route identically — a landing CTA
    // is only rendered when this passes, so the two cannot drift.
    delete process.env.JIRA_CLIENT_SECRET;
    const app = makeApp({ session: jiraOnlySession(), store: makeStore(), provider: fakeProvider() });
    const asNew = await request(app, { path: '/auth/jira/oauth?mode=new' });
    assert.equal(asNew.status, 503);
    assert.match(asNew.text, /JIRA_CLIENT_SECRET/);
  });
});

// ---------------------------------------------------------------------------
// E2 — the bootstrap. The user outcome, not the status code.
// ---------------------------------------------------------------------------

describe('LIN-1890 E2 — a Jira-only sign-in lands in a working workspace', () => {
  test('the session ends with exactly one ACTIVE Jira workspace, reachable by urlKey', async () => {
    const session = jiraOnlySession();
    const { callback } = await signInWithJira({ session });

    assert.equal(callback.status, 302);
    // Lands IN the workspace, not on settings — this is a login, not an add.
    assert.equal(callback.location, '/workspace/acme/');

    assert.equal(session.workspaces.length, 1, 'a Jira-only login must produce a workspace, not zero');
    const ws = session.workspaces[0];
    assert.equal(ws.id, `jira:${MYSELF.accountId}`, 'the container is keyed on the HUMAN, never the site (LIN-1329 Q1)');
    assert.equal(ws.urlKey, 'acme');
    assert.equal(session.activeWorkspaceId, ws.id, 'the new workspace must be the active one, or the user lands nowhere');
    assert.equal(ws.provider, 'jira');
  });

  test('the binding is OAuth-shaped with a REAL expiry, and holds no refresh token', async () => {
    const session = jiraOnlySession();
    await signInWithJira({ session });
    const binding = session.workspaces[0].bindings.find(b => b.provider === 'jira');

    assert.equal(binding.scope, 'https://acme.atlassian.net', 'scope stays the human-facing site so deep links keep working');
    assert.equal(binding.credentials.authType, 'oauth');
    assert.equal(binding.credentials.cloudId, 'cid-1');
    assert.equal(binding.credentials.token, 'jira-access-1', 'the ACCESS token must be in `token` or the scalar mirror breaks');
    assert.ok(binding.credentials.tokenExpiresAt < Number.MAX_SAFE_INTEGER, 'a real expiry, never the Basic sentinel');
    assert.ok(binding.credentials.tokenExpiresAt > Date.now(), 'and it must be in the future');
    assert.ok(!('refreshToken' in binding.credentials), 'the rotating credential is durable-store-only (LIN-1524)');
  });

  test('the rotating refresh token reaches the durable store, in the JIRA partition', async () => {
    const session = jiraOnlySession();
    const { store } = await signInWithJira({ session });
    const record = await store.get('acct-new', 'acme', 'jira');
    assert.ok(record, 'without this the workspace cannot survive its first expiry');
    assert.equal(record.refreshToken, 'atlassian-refresh-ROTATING');
    assert.equal(record.provider, 'jira');
    assert.equal(await store.get('acct-new', 'acme', 'linear'), null, 'never Linear\'s partition (LIN-1887 F1)');
  });

  test('the refresh token is never left behind in the session', async () => {
    const session = jiraOnlySession();
    await signInWithJira({ session });
    assert.equal(JSON.stringify(session).includes('atlassian-refresh-ROTATING'), false,
      'the single-site path passes it as an argument; the multi-site path deletes it on consumption');
  });

  test('a co-resident Linear workspace SURVIVES the session regenerate', async () => {
    // The regression the plan review re-proved red at `ac6dc725`: regenerate()
    // wipes the session, so failing to restore workspaces destroys everything
    // the user already had.
    const session = withLinearSession();
    await signInWithJira({ session });

    const keys = session.workspaces.map(w => w.urlKey).sort();
    assert.deepEqual(keys, ['acme', 'acme-linear']);
    assert.equal(session.activeWorkspaceId, `jira:${MYSELF.accountId}`);
  });

  test('durable preferences are rehydrated after regenerate, against the ESTABLISHED account', async () => {
    const session = jiraOnlySession();
    const prefsStore = makePrefsStore();
    await signInWithJira({ session, prefsStore });

    assert.deepEqual(prefsStore.asked, ['acct-new'], 'asked exactly once, for the account establishAccount resolved');
    assert.equal(session.features?.dispatch, true, 'regenerate() wiped these; they must come back');
  });

  test('the account is established and bound to the new workspace', async () => {
    const session = jiraOnlySession();
    const stores = makeAccountStores();
    await signInWithJira({ session, stores });
    assert.equal(session.accountId, 'acct-new');
    assert.deepEqual(stores.bound, [['acct-new', `jira:${MYSELF.accountId}`]]);
  });

  test('a returning human with the same accountId adds a BINDING, not a second workspace', async () => {
    const session = jiraOnlySession();
    await signInWithJira({ session });
    assert.equal(session.workspaces.length, 1);

    // Sign in again, picking a different site for the same human.
    const second = await signInWithJira({ session, sites: [{ id: 'cid-9', url: 'https://second.atlassian.net', name: 'Second' }] });
    assert.equal(second.callback.status, 302);
    assert.equal(session.workspaces.length, 1, 'one human, one Jira container');
    const scopes = session.workspaces[0].bindings.filter(b => b.provider === 'jira').map(b => b.scope).sort();
    assert.deepEqual(scopes, ['https://acme.atlassian.net', 'https://second.atlassian.net']);
  });

  test('the multi-site pick completes the same bootstrap, and clears the carried token', async () => {
    const session = jiraOnlySession();
    const store = makeStore();
    const app = makeApp({ session, store, provider: fakeProvider(), fetches: stubs(TWO_SITES) });
    await request(app, { path: '/auth/jira/oauth?mode=new' });
    const callback = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });

    assert.equal(callback.status, 200, 'two sites means a pick page, not an immediate link');
    assert.match(callback.text, /jira-site-form/);

    const picked = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-2' } });
    assert.equal(picked.status, 302);
    assert.equal(picked.location, '/workspace/other/', 'the urlKey follows the PICKED site');
    assert.equal(session.workspaces[0].bindings[0].credentials.cloudId, 'cid-2');
    assert.ok(!session.jiraPending, 'pending state — including the carried refresh token — is cleared');

    const record = await store.get('acct-new', 'other', 'jira');
    assert.equal(record.refreshToken, 'atlassian-refresh-ROTATING', 'the durable write still happens on the pick path');
  });

  test('a THROWING session.regenerate answers 500 — it must never hang the request', async () => {
    // Found by execution while implementing: a throw escaping an async callback
    // outside Express's middleware chain reaches no error handler, so no
    // response is ever written and the request hangs until the platform kills it
    // — the LIN-761 failure mode verbatim. Answering 500 is strictly better.
    const session = makeSession({ workspaces: [] });
    session.regenerate = () => { throw new Error('session store unavailable'); };
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), fetches: stubs() });
    await request(app, { path: '/auth/jira/oauth?mode=new' });
    const res = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });
    assert.equal(res.status, 500);
    assert.match(res.text, /Session Error/);
  });

  test('a client cannot assert a site the grant does not reach', async () => {
    const session = jiraOnlySession();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), fetches: stubs(TWO_SITES) });
    await request(app, { path: '/auth/jira/oauth?mode=new' });
    await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });
    const forged = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-not-granted' } });
    assert.equal(forged.status, 400);
    assert.equal(session.workspaces.length, 0);
  });
});

// ---------------------------------------------------------------------------
// E6a — the composed join: the binding the bootstrap WRITES, through the real
// projections. Neither half is new; that they meet correctly is.
// ---------------------------------------------------------------------------

describe('LIN-1890 E6a — bootstrap → projection (composed)', () => {
  test('the workspace E2 wrote projects to the OAuth call scope, not the Basic one', async () => {
    const session = jiraOnlySession();
    await signInWithJira({ session });
    const workspace = session.workspaces[0];

    // The real projection, not a hand-built binding — that is the whole point.
    const scope = getWorkspaceCallScope(workspace);
    assert.equal(scope.authType, 'oauth');
    assert.equal(scope.accessToken, 'jira-access-1');
    assert.equal(scope.cloudId, 'cid-1');
    assert.equal(scope.site, 'https://acme.atlassian.net');
    assert.ok(!('apiToken' in scope), 'a Basic projection here would send an OAuth token in a Basic header');
    assert.ok(!('email' in scope));
  });

  test('the per-binding projection agrees with the workspace-level one', async () => {
    const session = jiraOnlySession();
    await signInWithJira({ session });
    const workspace = session.workspaces[0];
    const binding = workspace.bindings.find(b => b.provider === 'jira');
    assert.deepEqual(getBindingCallScope(binding), getWorkspaceCallScope(workspace),
      'the two projections must not disagree about the same active binding');
  });

  test('the scalar mirror carries the access token, so the headless lane resolves', async () => {
    const session = jiraOnlySession();
    await signInWithJira({ session });
    const workspace = session.workspaces[0];
    assert.equal(getWorkspaceToken(workspace), 'jira-access-1');
    assert.equal(workspace.accessToken, 'jira-access-1');
    assert.ok(workspace.tokenExpiresAt < Number.MAX_SAFE_INTEGER,
      'the scalar expiry mirror must be real too — the headless resolver reads it');
  });
});

// ---------------------------------------------------------------------------
// The urlKey derivation (plan finding N2).
// ---------------------------------------------------------------------------

describe('LIN-1890 — deriveJiraUrlKey', () => {
  test('derives from the site tenant', () => {
    assert.equal(deriveJiraUrlKey({ url: 'https://acme.atlassian.net' }), 'acme');
  });

  test('an Atlassian accountId could never have been used — it fails URL_KEY_REGEX', () => {
    // The finding this function exists for: `557058:<uuid>` contains a colon.
    assert.match(MYSELF.accountId, /:/);
    assert.equal(deriveJiraUrlKey({ url: 'https://acme.atlassian.net' }).includes(':'), false);
  });

  test('collides safely against an existing workspace — tenant names are company names', () => {
    const existing = [{ urlKey: 'acme' }];
    assert.equal(deriveJiraUrlKey({ url: 'https://acme.atlassian.net' }, existing), 'acme-2');
    assert.equal(deriveJiraUrlKey({ url: 'https://acme.atlassian.net' }, [...existing, { urlKey: 'acme-2' }]), 'acme-3');
  });

  test('falls back to a valid key when the tenant is unusable', () => {
    for (const url of ['not a url', 'https://.atlassian.net', '']) {
      const key = deriveJiraUrlKey({ url });
      assert.match(key, /^[a-z0-9-]{1,50}$/i, `unusable tenant must still yield a legal urlKey (got ${key})`);
    }
  });

  test('the derived key is always a legal urlKey', () => {
    const key = deriveJiraUrlKey({ url: 'https://ACME-Corp.atlassian.net' });
    assert.match(key, /^[a-z0-9-]{1,50}$/);
  });
});
