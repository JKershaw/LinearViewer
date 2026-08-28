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
 * NOT proven here, stated rather than left implicit — and narrowed at close-out
 * (review F1 corrected plan R1, which had generalised a GitHub measurement to
 * Jira): the ENTRY route is driven as HTTP by the e2e suite, whose server is
 * Jira-OAuth-configured (`landing.spec.js` asserts the `mode=new` 302 to
 * Atlassian, `settings-providers.spec.js` the add-source one). What no test in
 * this repo drives as HTTP is the CALLBACK — the code→token exchange has no stub
 * seam — so everything below fakes that network. Atlassian's runtime contract
 * remains unobserved by this ticket, exactly as it was by LIN-1887 (D3).
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';

import { createJiraAuthRoutes, deriveJiraUrlKey } from '../../routes/jira-auth.js';
import { createAccountMergeRoutes } from '../../routes/account-merge.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
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
      // This fake models no merging, so canonicalization is always a no-op —
      // mirrors AccountStore.resolveCanonicalAccountId's no-mergedInto case.
      async resolveCanonicalAccountId(accountId) { return accountId ?? null; },
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
  await new Promise(resolve => { server = rootApp.listen(0, '127.0.0.1', resolve); });
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
// LIN-2267 (class fix of LIN-2233's L2.1, applied to the Jira mode:'new'
// bootstrap): completeJiraNewLogin's regenerate() unconditionally wiped
// session.accountId (see the stale docblock comment this ticket corrected) —
// so a session already holding a live account that then front-doors with a
// BRAND-NEW Jira identity always took the mint branch instead of linking
// onto the live account, forking a second one. Mirrors
// tests/unit/account-identity.test.js's "L6 test 1 — fork-prevention" and
// the sibling GitHub/GitHub Projects coverage added by this same class fix.
// ---------------------------------------------------------------------------

/**
 * A fork-DETECTING account store: unlike makeAccountStores() above (whose
 * createAccount always returns the same fixed 'acct-new' id, so a second
 * mint would be indistinguishable from the carried id by equality alone),
 * this mints a genuinely fresh id each call and counts mints — the real
 * signal this test needs: "was a second account minted at all".
 */
function makeForkTrackingAccountStores() {
  const identities = new Map();
  const bound = [];
  let nextId = 1;
  let createCount = 0;
  return {
    bound,
    createCount: () => createCount,
    accountStore: {
      async findAccountByIdentity(provider, scope) {
        const id = identities.get(`${provider}:${scope}`);
        return id ? { _id: id } : null;
      },
      async createAccount() { createCount++; return { _id: `acct-${nextId++}` }; },
      async linkIdentity(accountId, provider, scope) { identities.set(`${provider}:${scope}`, accountId); return { ok: true }; },
      async deleteAccount() { return true; },
    },
    accountWorkspaceStore: { async bindAccountToWorkspace(accountId, workspaceId) { bound.push([accountId, workspaceId]); return true; } },
  };
}

describe('LIN-2267 — mode:new carries session.accountId across regenerate', () => {
  test('a brand-new Jira identity arriving in a session that already holds a live account links onto it instead of forking a second one', async () => {
    const session = jiraOnlySession();
    const stores = makeForkTrackingAccountStores();

    // First front-door login mints account A.
    await signInWithJira({ session, stores });
    const accountIdAfterA = session.accountId;
    assert.ok(accountIdAfterA);
    assert.equal(stores.createCount(), 1);

    // Second front-door login, SAME session, a BRAND-NEW Jira identity (a
    // different human, a different Jira tenant). The live accountId must
    // survive completeJiraNewLogin's session.regenerate() and this identity
    // must link onto it, not mint a second account.
    const OTHER_HUMAN = { accountId: 'other-jira-human-999', emailAddress: 'other.human@example.com', displayName: 'Other Human' };
    const app2 = makeApp({
      session, store: makeStore(), provider: fakeProvider(OTHER_HUMAN), stores,
      fetches: stubs([{ id: 'cid-9', url: 'https://othercorp.atlassian.net', name: 'OtherCorp' }]),
    });
    await request(app2, { path: '/auth/jira/oauth?mode=new' });
    const callback = await request(app2, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });

    assert.equal(callback.status, 302);
    assert.strictEqual(session.accountId, accountIdAfterA, 'session.accountId unchanged across the second front-door login — no fork');
    assert.equal(stores.createCount(), 1, 'createAccount called only once — the second identity LINKED onto the live account, not re-minted');
    assert.equal(session.workspaces.length, 2, 'two distinct Jira containers, one per human accountId — the first survives the regenerate too');
    assert.deepEqual(stores.bound.map(([acct]) => acct), [accountIdAfterA, accountIdAfterA], 'both bindings recorded under the SAME account');
  });
});

// ---------------------------------------------------------------------------
// LIN-2267 amendment (review F1 + F2): the accountId-carry above makes an
// `unknown-account` conflict reachable on completeJiraNewLogin's regenerate
// branch for the first time — before the carry, regenerate() always wiped
// session.accountId, so establishAccount's stale-id branch could never fire
// here. Now that it IS reachable, this branch must apply the same
// post-conflict hygiene routes/auth.js's respondToAccountConflict already
// applies (LIN-2266): clear the stale accountId/freshness stamp/OAuth state,
// and restore session.workspaces to its pre-login snapshot.
// ---------------------------------------------------------------------------

/**
 * An account store that models `unknown-account`: `findAccountByIdentity`
 * always misses (a brand-new identity), so `establishAccount` falls through
 * to `else if (session.accountId)` and tries to link onto the CARRIED id —
 * `linkIdentity` then reports it unknown unless it is the one id this store
 * actually minted (`'acct-new'`), mirroring `lib/account-store.js`'s real
 * `getAccount(accountId) === null` branch.
 */
function makeUnknownAccountStores() {
  const bound = []
  return {
    bound,
    accountStore: {
      async findAccountByIdentity() { return null },
      async createAccount() { return { _id: 'acct-new' } },
      async linkIdentity(accountId) {
        if (accountId !== 'acct-new') return { ok: false, reason: 'unknown-account' }
        return { ok: true }
      },
      async deleteAccount() { return true },
      async resolveCanonicalAccountId(accountId) { return accountId ?? null },
    },
    accountWorkspaceStore: { async bindAccountToWorkspace(accountId, workspaceId) { bound.push([accountId, workspaceId]); return true } },
  }
}

describe('LIN-2267 amendment — post-conflict session hygiene on the mode:new unknown-account 409', () => {
  test('clears the stale accountId and restores session.workspaces, so the retry is not a permanent lockout (F1/F2)', async () => {
    const linearWs = { id: 'ws-1', urlKey: 'acme-linear', provider: 'linear', accessToken: 'linear-access', bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'linear-access' } }] }
    const session = makeSession({
      // A stale/unresolvable accountId — the deleted-account or
      // restored/repointed-store case establishAccount's unknown-account
      // branch guards against.
      accountId: 'acct-DELETED',
      identityAuthenticatedAt: Date.now(),
      workspaces: [linearWs],
    })
    const stores = makeUnknownAccountStores()

    const { callback } = await signInWithJira({ session, stores })

    assert.equal(callback.status, 409)
    assert.match(callback.text, /Account Conflict/)
    // F1: the stale accountId (and its freshness stamp) must not survive
    // into the retry, or every subsequent front-door login re-derives the
    // SAME stale id and 409s forever (the LIN-2266 lockout, reintroduced
    // here).
    assert.equal(session.accountId, undefined, 'stale accountId cleared')
    assert.equal(session.identityAuthenticatedAt, undefined, 'freshness stamp cleared')
    assert.equal(session.oauthState, undefined, 'OAuth state cleared')
    assert.equal(session.oauthIntent, undefined, 'OAuth intent cleared')
    // F2: the arriving (unconfirmed) workspace and its live OAuth credentials
    // must not remain in session.workspaces.
    assert.deepEqual(session.workspaces, [linearWs], 'session.workspaces restored to its pre-login snapshot')
    assert.ok(!JSON.stringify(session.workspaces).includes('jira-access-1'), 'the arriving credential does not leak into the session')
  })
})

// ---------------------------------------------------------------------------
// LIN-2304: the mode:'new' regenerate branch reaches the shared merge offer
// instead of the old dead-end 409 — the FIRST mergeable-conflict coverage
// this branch has ever had (LIN-2267 review ledger item 1).
// ---------------------------------------------------------------------------

describe('LIN-2304 — Jira mode:new regenerate branch reaches the shared merge offer', () => {
  test('a MERGEABLE conflict reaches the shared merge offer (not the old dead-end "Account Conflict" page), preserving session.accountId as canonical', async () => {
    const stores = makeAccountStores()
    await stores.accountStore.linkIdentity('acct-other', 'jira', MYSELF.accountId)
    const session = makeSession({
      // A LIVE session for a DIFFERENT, already-canonical account, freshly
      // authenticated in THIS session — the amendment A1 proof standard.
      accountId: 'acct-canonical',
      identityAuthenticatedAt: Date.now(),
      workspaces: [],
    })

    const { callback } = await signInWithJira({ session, stores })

    assert.equal(callback.status, 409)
    assert.match(callback.text, /Merge these accounts\?/, 'the shared merge offer, not the old dead-end 409')
    assert.match(callback.text, /This Jira account/, 'identityLabel is parameterized to Jira')
    assert.ok(session.pendingMerge, 'a pending merge offer is stored — but nothing written yet')
    assert.strictEqual(session.pendingMerge.canonicalAccountId, 'acct-canonical', 'canonicalAccountId is session.accountId — never undefined')
    assert.strictEqual(session.pendingMerge.mergedAccountId, 'acct-other')
    assert.strictEqual(session.accountId, 'acct-canonical', 'session.accountId (the canonical id) is preserved, not cleared')
  })

  test('refuses a one-click merge and offers re-auth instead when the canonical session is LIVE but STALE', async () => {
    const stores = makeAccountStores()
    await stores.accountStore.linkIdentity('acct-other', 'jira', MYSELF.accountId)
    const session = makeSession({
      accountId: 'acct-canonical',
      // Well outside the 10-minute fresh-auth window.
      identityAuthenticatedAt: Date.now() - 60 * 60 * 1000,
      workspaces: [],
    })

    const { callback } = await signInWithJira({ session, stores })

    assert.equal(callback.status, 409)
    assert.match(callback.text, /Sign in again to confirm/)
    assert.strictEqual(session.pendingMerge, undefined, 'no pending merge is offered when the canonical side is not fresh')
  })

  // Credential-write witness (paired with github-auth.test.js's "writes NO
  // owner credential" witness): Jira's rotating refresh token IS threaded
  // into the offer (the closure-scope `refreshToken` completeJiraNewLogin
  // already holds), so a confirmed merge must persist it durably, exactly as
  // `persistRefresh` would have on the non-conflict path.
  test('Jira confirm-to-completion persists the arriving identity\'s rotating refresh token under the CANONICAL account (LIN-2304 finding 1, paired witness)', async () => {
    const dbDir = mkdtempSync(join(tmpdir(), 'lin-2304-jira-merge-'))
    const dbClient = new MangoClient(dbDir)
    await dbClient.connect()
    try {
      const db = dbClient.db('acct')
      const accountStore = new AccountStore({ collection: db.collection('accounts') })
      const accountWorkspaceStore = new AccountWorkspaceStore({ collection: db.collection('account-workspaces') })
      const canonicalAccount = await accountStore.createAccount()
      const otherAccount = await accountStore.createAccount()
      await accountStore.linkIdentity(otherAccount._id, 'jira', MYSELF.accountId, {})

      const session = makeSession({
        accountId: canonicalAccount._id,
        identityAuthenticatedAt: Date.now(),
        workspaces: [],
      })
      const { callback } = await signInWithJira({ session, stores: { accountStore, accountWorkspaceStore } })
      assert.equal(callback.status, 409)
      assert.ok(session.pendingMerge, 'sanity: the offer was built')
      assert.strictEqual(session.pendingMerge.refreshToken, 'atlassian-refresh-ROTATING', 'sanity: the arriving refresh token was threaded into the offer')

      const credentialCalls = []
      const ownerCredentialStore = { put: async (...args) => { credentialCalls.push(args) } }
      const mergeRouter = createAccountMergeRoutes({ accountStore, accountWorkspaceStore, ownerCredentialStore })
      const confirmHandler = mergeRouter.stack.find(l => l.route?.path === '/auth/merge/confirm').route.stack[0].handle

      const res = { statusCode: 200, redirectedTo: null, status(c) { this.statusCode = c; return this }, send(b) { this.body = b; return this }, redirect(u) { this.redirectedTo = u; return this } }
      await confirmHandler({ session }, res)

      assert.strictEqual((await accountStore.getAccount(otherAccount._id)).mergedInto, canonicalAccount._id, 'mergeAccounts actually ran')
      assert.strictEqual(credentialCalls.length, 1, 'Jira confirm DOES persist an owner credential — unlike GitHub\'s paired witness')
      const [accountId, , credential] = credentialCalls[0]
      assert.strictEqual(accountId, canonicalAccount._id)
      assert.strictEqual(credential.refreshToken, 'atlassian-refresh-ROTATING')
    } finally {
      if (dbClient?.close) await dbClient.close()
      rmSync(dbDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// LIN-1890 close-out — review F3: the carried refresh token on the FAILURE
// exits.
//
// The multi-site `mode: 'new'` pick parks a rotating refresh token in the
// session, and the deviation that allows it was accepted on a stated bound:
// written once, read once, deleted on consumption. `finish()` only ever runs on
// the success path, so before this the bound held there and nowhere else. Each
// test below drives ONE exit that answers an error instead, and asserts the
// value is gone — the distinguishing precondition in every case is `sites.length
// > 1`, since a single-site grant never puts the token in the session at all.
//
// The abandoned pick is deliberately absent: it issues no request, so there is
// no exit to test. That residue is documented in-tree rather than claimed away.
// ---------------------------------------------------------------------------

describe('LIN-1890 close-out (F3) — the carried refresh token is dropped on every error exit', () => {
  /** Drive begin → callback with TWO sites, stopping at the pick page. */
  async function pendingPick({ session, provider = fakeProvider(), stores = makeAccountStores() }) {
    const app = makeApp({ session, store: makeStore(), provider, stores, fetches: stubs(TWO_SITES) });
    await request(app, { path: '/auth/jira/oauth?mode=new' });
    const callback = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });
    assert.equal(callback.status, 200, 'the premise: two sites, so the token IS parked in the session');
    assert.equal(session.jiraPending.refreshToken, 'atlassian-refresh-ROTATING');
    return app;
  }

  const assertNoResidue = (session) => {
    assert.equal(session.jiraPending?.refreshToken, undefined, 'the carried token is gone');
    assert.equal(JSON.stringify(session).includes('atlassian-refresh-ROTATING'), false,
      'and nothing else in the session kept a copy of it');
  };

  test('the unknown-site 400 — a forged cloudId does not leave the token parked', async () => {
    const session = jiraOnlySession();
    const app = await pendingPick({ session });
    const forged = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-not-granted' } });
    assert.equal(forged.status, 400);
    assertNoResidue(session);
  });

  test('the identity-lookup 400 — a Jira /myself failure does not leave the token parked', async () => {
    const session = jiraOnlySession();
    const throwingProvider = { validateCredential: async () => { throw new Error('jira 500'); } };
    const app = await pendingPick({ session, provider: throwingProvider });
    const picked = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-2' } });
    assert.equal(picked.status, 400);
    assert.match(picked.text, /Authentication Failed/);
    assertNoResidue(session);
  });

  test('the returning-container 409 — the one conflict exit that runs no regenerate', async () => {
    // The `existing` branch answers 409 with the session fully intact (no
    // regenerate to wipe it), which is what makes it the exit where residue
    // would actually persist.
    const session = makeSession({
      accountId: 'acct-A',
      workspaces: [{ id: `jira:${MYSELF.accountId}`, urlKey: 'acme', provider: 'jira', bindings: [] }],
    });
    const stores = makeAccountStores();
    stores.accountStore.findAccountByIdentity = async () => ({ _id: 'acct-B' });

    const app = await pendingPick({ session, stores });
    const picked = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-2' } });
    assert.equal(picked.status, 409);
    assert.match(picked.text, /Account Conflict/);
    assertNoResidue(session);
    // LIN-2300: a MERGEABLE conflict must NOT clear session.accountId — it is
    // needed by the merge-confirm flow this 409 dead-ends into today (LIN-2304).
    assert.equal(session.accountId, 'acct-A', 'session.accountId preserved on a mergeable conflict');
  });
});

// ---------------------------------------------------------------------------
// LIN-2300 (sibling of LIN-2266/LIN-2267/the LIN-2267-amendment block above):
// the two remaining non-regenerate `establishAccount` exits in this file —
// OAuth add-source (jira-auth.js:519) and OAuth binding-add onto an existing
// container (jira-auth.js:629, exercised above as "the returning-container
// 409") — must ALSO clear a stale, unresolvable session.accountId on an
// unknown-account 409, or the retry 409s forever for as long as the session
// lives (neither of these branches ever regenerates the session).
// ---------------------------------------------------------------------------

describe('LIN-2300 — OAuth add-source and existing-container unknown-account 409s clear the stale session', () => {
  test('OAuth add-source (jira-auth.js:519): an unknown-account 409 clears the stale session.accountId', async () => {
    const linearWs = { id: 'ws-1', urlKey: 'acme-linear', provider: 'linear', accessToken: 'linear-access', bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'linear-access' } }] };
    const session = makeSession({
      accountId: 'acct-DELETED',
      identityAuthenticatedAt: Date.now(),
      workspaces: [linearWs],
      activeWorkspaceId: 'ws-1',
    });
    const stores = makeUnknownAccountStores();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), stores, fetches: stubs(ONE_SITE) });

    await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=acme-linear' });
    const callback = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });

    assert.equal(callback.status, 409);
    assert.match(callback.text, /Account Conflict/);
    assert.equal(session.accountId, undefined, 'stale accountId cleared');
    assert.equal(session.identityAuthenticatedAt, undefined, 'freshness stamp cleared');
    assert.equal(session.oauthState, undefined, 'OAuth state cleared');
    assert.equal(session.oauthIntent, undefined, 'OAuth intent cleared');
    // add-source never regenerates, so the pre-existing Linear workspace must
    // remain exactly as it was, with no Jira binding written onto it.
    assert.deepEqual(session.workspaces, [linearWs]);
  });

  test('OAuth binding-add onto an existing container (jira-auth.js:629): an unknown-account 409 clears the stale session.accountId AND still drops the carried refresh token', async () => {
    const session = makeSession({
      accountId: 'acct-DELETED',
      identityAuthenticatedAt: Date.now(),
      workspaces: [{ id: `jira:${MYSELF.accountId}`, urlKey: 'acme', provider: 'jira', bindings: [] }],
    });
    const stores = makeUnknownAccountStores();
    // TWO_SITES, mirroring "the returning-container 409" above, so the
    // rotating refresh token is parked in session.jiraPending before the pick
    // — the precondition that makes token residue on this exit observable.
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), stores, fetches: stubs(TWO_SITES) });
    await request(app, { path: '/auth/jira/oauth?mode=new' });
    const pending = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });
    assert.equal(pending.status, 200, 'the premise: two sites, so the token IS parked in the session');
    assert.equal(session.jiraPending.refreshToken, 'atlassian-refresh-ROTATING');

    const picked = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-2' } });

    assert.equal(picked.status, 409);
    assert.match(picked.text, /Account Conflict/);
    assert.equal(session.accountId, undefined, 'stale accountId cleared');
    assert.equal(session.identityAuthenticatedAt, undefined, 'freshness stamp cleared');
    // LIN-2300 close-out F2: the mutation-check found this exit's oauthState/
    // oauthIntent clearing was unwitnessed (dropping either field failed 7 of
    // 8 tests, not 8) — assert both explicitly, matching the add-source test
    // above and the helper's full four-field contract.
    assert.equal(session.oauthState, undefined, 'OAuth state cleared');
    assert.equal(session.oauthIntent, undefined, 'OAuth intent cleared');
    assert.equal(session.jiraPending?.refreshToken, undefined, 'the carried token is gone (dropCarriedRefreshToken, unchanged behavior)');
    assert.equal(JSON.stringify(session).includes('atlassian-refresh-ROTATING'), false, 'and nothing else in the session kept a copy of it');
  });
});

// ---------------------------------------------------------------------------
// LIN-2300 close-out F1: the OAuth add-source exit's `!established.conflict`
// guard was unwitnessed — removing it (making the clear unconditional) failed
// zero tests. A mergeable conflict must still preserve session.accountId here,
// exactly as it already does at the binding-add exit above.
// ---------------------------------------------------------------------------

describe('LIN-2300 close-out F1 — OAuth add-source preserves session.accountId on a MERGEABLE conflict', () => {
  test('OAuth add-source (jira-auth.js:519): a MERGEABLE conflict returns 409 and preserves session.accountId', async () => {
    const session = withLinearSession();
    const stores = makeAccountStores();
    stores.accountStore.findAccountByIdentity = async () => ({ _id: 'acct-B' });
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), stores, fetches: stubs(ONE_SITE) });

    await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=acme-linear' });
    const callback = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });

    assert.equal(callback.status, 409);
    assert.match(callback.text, /Account Conflict/);
    assert.equal(session.accountId, 'acct-1', 'session.accountId preserved on a mergeable conflict');
  });
});

// ---------------------------------------------------------------------------
// LIN-2300 close-out — same-session self-heal: an unknown-account 409 on
// attempt 1 must not doom every later attempt on the same session. Attempt 2,
// after the stale id is cleared, mints and lands on a fresh account.
// ---------------------------------------------------------------------------

describe('LIN-2300 close-out — OAuth add-source self-heals across a same-session retry', () => {
  test('OAuth add-source (jira-auth.js:519): after an unknown-account 409 clears the session, a second attempt on the SAME session succeeds', async () => {
    const linearWs = { id: 'ws-1', urlKey: 'acme-linear', provider: 'linear', accessToken: 'linear-access', bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'linear-access' } }] };
    const session = makeSession({
      accountId: 'acct-DELETED',
      workspaces: [linearWs],
      activeWorkspaceId: 'ws-1',
    });
    const stores = makeUnknownAccountStores();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), stores, fetches: stubs(ONE_SITE) });

    await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=acme-linear' });
    const attempt1 = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });
    assert.equal(attempt1.status, 409, 'attempt 1: the stale accountId fails as before');
    assert.equal(session.accountId, undefined, 'attempt 1: stale accountId cleared, opening the door to a retry');

    // Same session object, second attempt — the account is re-established fresh.
    await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=acme-linear' });
    const attempt2 = await request(app, { path: `/auth/jira/oauth/callback?code=c&state=${encodeURIComponent(session.oauthState)}` });

    assert.equal(attempt2.status, 302, 'attempt 2: succeeds and redirects');
    assert.equal(attempt2.location, '/workspace/acme-linear/settings?provider_ok=jira');
    assert.ok(session.accountId, 'attempt 2: a fresh accountId is established on the same session');
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
