/**
 * LIN-1887 Step 4/5 — the Jira 3LO routes, driven end to end through a real
 * Express app with only the network faked.
 *
 * The security properties this file exists to pin, in order of how badly they
 * fail if they regress:
 *
 *  1. the rotating refresh token reaches the DURABLE STORE and never the session
 *     (LIN-1524) — and lands in the JIRA partition, never Linear's (F1);
 *  2. `state` is an opaque CSRF nonce, validated, and carries no intent;
 *  3. the site is resolved against the server's OWN accessible-resources list,
 *     so a client cannot assert a site the grant does not reach;
 *  4. the binding carries a REAL expiry, not the Phase 1 sentinel.
 *
 * Nothing here proves Atlassian accepts any of it — see D3.
 *
 * LIN-1890 E1 note: the add-source cases below now pass `mode=add-source`
 * EXPLICITLY. They used to rely on the route hard-coding that mode; the landing
 * entry made `new` the default, so the intent has to be stated. The assertions
 * themselves are unchanged — this file still pins add-source behaviour, and a
 * regression that ignored `mode` would now show up as a `new`-shaped result.
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';

import { createJiraAuthRoutes } from '../../routes/jira-auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

const ENV_KEYS = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.JIRA_CLIENT_ID = 'client-id-1';
  process.env.JIRA_CLIENT_SECRET = 'secret-1';
  process.env.JIRA_REDIRECT_URI = 'https://harbour.example/auth/jira/oauth/callback';
});
afterEach(() => { for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; } });

/** A session shared across a test's requests, mimicking express-session. */
function makeSession(over = {}) {
  return {
    accountId: 'acct-1',
    workspaces: [{ id: 'ws-1', urlKey: 'acme', provider: 'linear', accessToken: 'linear-access', bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'linear-access' } }] }],
    activeWorkspaceId: 'ws-1',
    save(cb) { if (cb) cb(null); },
    ...over,
  };
}

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

/**
 * Minimal account stores. Real ones, not nulls: `establishAccount` is the same
 * seam Phase 1 uses, and stubbing it out would hide whether the OAuth link
 * resolves to the same Harbour account a Basic link does.
 */
function makeAccountStores() {
  const identities = new Map();
  return {
    accountStore: {
      async findAccountByIdentity(provider, scope) { return identities.get(`${provider}:${scope}`) ?? null; },
      async createAccount() { return { _id: 'acct-new' }; },
      async linkIdentity(accountId, provider, scope) { identities.set(`${provider}:${scope}`, { _id: accountId }); return { ok: true }; },
      // This fake models no merging, so canonicalization is always a no-op —
      // mirrors AccountStore.resolveCanonicalAccountId's no-mergedInto case.
      async resolveCanonicalAccountId(accountId) { return accountId ?? null; },
    },
    accountWorkspaceStore: { async bindAccountToWorkspace() { return true; } },
  };
}

function makeApp({ session, store, provider, fetches = {}, accountStore, accountWorkspaceStore }) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.session = session; next(); });
  // The routes read `fetch` off the module scope of lib/providers/jira/oauth.js,
  // which resolves to globalThis.fetch — so the stub is installed there.
  globalThis.fetch = async (url, opts) => {
    for (const [match, handler] of Object.entries(fetches)) {
      if (String(url).includes(match)) return handler(url, opts);
    }
    throw new Error(`unstubbed fetch: ${url}`);
  };
  // LIN-2285: an accountStore/accountWorkspaceStore pair can be passed in
  // (real, MangoDB-backed ones) so a test can pre-seed a merge and check
  // canonicalization — the fake `makeAccountStores()` below models no
  // merging at all, so it stays the default for every other test in this file.
  const stores = accountStore ? { accountStore, accountWorkspaceStore } : makeAccountStores();
  app.use(createJiraAuthRoutes({ provider, ...stores, ownerCredentialStore: store }));
  return app;
}

/**
 * Minimal request driver — avoids a supertest dependency the repo does not have.
 *
 * ONE http server for the whole file, delegating to whichever app the current
 * test built. Listening per request instead churned a socket and a port for
 * every case, which is enough extra load to tip borderline specs elsewhere in
 * the suite into timeouts.
 */
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

const fakeProvider = (myself = { accountId: 'atlassian-acct-1', emailAddress: 'a@b.c', displayName: 'A' }) => ({
  validateCredential: async (credential) => { fakeProvider.lastCredential = credential; return myself; },
});

const TOKEN_BAG = { access_token: 'jira-access-1', refresh_token: 'atlassian-refresh-ROTATING', expires_in: 3600 };
const ONE_SITE = [{ id: 'cid-1', url: 'https://acme.atlassian.net', name: 'Acme' }];
const TWO_SITES = [...ONE_SITE, { id: 'cid-2', url: 'https://other.atlassian.net', name: 'Other' }];

// Order matters: Atlassian's accessible-resources path is
// `/oauth/token/accessible-resources`, so a `/oauth/token` matcher would
// swallow it. The more specific pattern is listed first.
const stubs = (sites = ONE_SITE, bag = TOKEN_BAG) => ({
  'accessible-resources': async () => ({ ok: true, status: 200, json: async () => sites }),
  '/oauth/token': async () => ({ ok: true, status: 200, json: async () => bag }),
});

describe('LIN-1887 Step 4 — GET /auth/jira/oauth (begin)', () => {
  test('redirects to Atlassian consent, minting an opaque state that carries no intent', async () => {
    const session = makeSession();
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=acme' });

    assert.equal(res.status, 302);
    const url = new URL(res.location);
    assert.equal(url.origin, 'https://auth.atlassian.com');
    assert.equal(url.searchParams.get('state'), session.oauthState);
    assert.doesNotMatch(url.searchParams.get('state'), /acme|add-source/, 'state must be an opaque nonce — intent lives in the session (LIN-562)');
    assert.deepEqual(session.oauthIntent, { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' });
  });

  test('an unconfigured server refuses to begin a flow it cannot finish', async () => {
    delete process.env.JIRA_CLIENT_SECRET;
    const app = makeApp({ session: makeSession(), store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=acme' });
    assert.equal(res.status, 503);
    assert.match(res.text, /JIRA_CLIENT_SECRET/);
  });

  test('add-source only: an unknown workspace is refused before any redirect', async () => {
    const app = makeApp({ session: makeSession(), store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira/oauth?mode=add-source&workspace=not-mine' });
    assert.equal(res.status, 400);
  });
});

describe('LIN-1887 Step 4/5 — the callback', () => {
  test('a state mismatch is refused before the code is ever exchanged', async () => {
    const session = makeSession({ oauthState: 'real-nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const store = makeStore();
    const app = makeApp({ session, store, provider: fakeProvider(), fetches: stubs() });
    const res = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=forged' });
    assert.equal(res.status, 400);
    assert.equal(store.records.size, 0, 'nothing may be persisted on a failed CSRF check');
  });

  test('single site: the refresh token goes to the JIRA durable partition and NEVER into the session', async () => {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const store = makeStore();
    const app = makeApp({ session, store, provider: fakeProvider(), fetches: stubs() });
    const res = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });

    assert.equal(res.status, 302);
    assert.equal(res.location, '/workspace/acme/settings?provider_ok=jira');

    // 1. Durable, partitioned, correctly labelled.
    const durable = await store.get('acct-1', 'acme', 'jira');
    assert.equal(durable.refreshToken, 'atlassian-refresh-ROTATING');
    assert.equal(durable.provider, 'jira');
    assert.equal(await store.get('acct-1', 'acme', 'linear'), null, 'Linear’s partition must be untouched (F1)');

    // 2. Never in the session — the whole point of LIN-1524.
    const serialized = JSON.stringify(session);
    assert.ok(!serialized.includes('atlassian-refresh-ROTATING'), 'the rotating refresh token must not be reachable from the session');

    // 3. The binding carries a REAL expiry and the OAuth discriminator.
    const binding = session.workspaces[0].bindings.find(b => b.provider === 'jira');
    assert.equal(binding.scope, 'https://acme.atlassian.net', 'scope stays the human-facing site so browse links keep working');
    assert.equal(binding.credentials.authType, 'oauth');
    assert.equal(binding.credentials.cloudId, 'cid-1');
    assert.equal(binding.credentials.token, 'jira-access-1');
    assert.ok(binding.credentials.tokenExpiresAt < Number.MAX_SAFE_INTEGER, 'the Phase 1 sentinel is a lie for an OAuth token');
    assert.ok(binding.credentials.tokenExpiresAt > Date.now(), 'and it must be in the future');
    assert.equal(binding.credentials.refreshToken, undefined, 'the binding must never carry the rotating credential');

    // 4. The single-site case skips the picker, so no pending state survives.
    assert.equal(session.jiraPending, undefined);
  });

  test('identity is resolved from /rest/api/3/myself over the OAuth credential, not a second endpoint', async () => {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const provider = fakeProvider();
    const app = makeApp({ session, store: makeStore(), provider, fetches: stubs() });
    await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });
    assert.deepEqual(provider.constructor === Object ? fakeProvider.lastCredential : fakeProvider.lastCredential, {
      authType: 'oauth', accessToken: 'jira-access-1', cloudId: 'cid-1', site: 'https://acme.atlassian.net',
    });
  });

  test('several sites: the picker renders and the pending state carries NO rotating credential', async () => {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const store = makeStore();
    const app = makeApp({ session, store, provider: fakeProvider(), fetches: stubs(TWO_SITES) });
    const res = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });

    assert.equal(res.status, 200);
    assert.match(res.text, /data-testid="jira-site-select-page"/);
    assert.match(res.text, /value="cid-2"/);
    assert.deepEqual(session.jiraPending.sites.map(s => s.cloudId), ['cid-1', 'cid-2']);
    assert.equal(session.jiraPending.refreshToken, undefined, 'jiraPending carries the pick’s inputs and the SHORT-LIVED access token only');
    assert.ok(!JSON.stringify(session.jiraPending).includes('atlassian-refresh-ROTATING'));
    // Durable-first: the credential is already safe before the user picks.
    assert.equal((await store.get('acct-1', 'acme', 'jira')).refreshToken, 'atlassian-refresh-ROTATING');
  });

  test('an ABANDONED pick leaves an orphan durable record — inert, and asserted rather than assumed', async () => {
    // Writing durable-first has this consequence. Nothing reads a provider
    // partition whose binding does not exist, the next link attempt overwrites
    // it, and whole-workspace removal deletes every partition.
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const store = makeStore();
    const app = makeApp({ session, store, provider: fakeProvider(), fetches: stubs(TWO_SITES) });
    await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });

    assert.ok(await store.get('acct-1', 'acme', 'jira'), 'the orphan exists');
    assert.equal(session.workspaces[0].bindings.find(b => b.provider === 'jira'), undefined, 'and has no binding to be read through');
  });

  test('a grant with no reachable Jira site is refused, not linked to nothing', async () => {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), fetches: stubs([]) });
    const res = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });
    assert.equal(res.status, 400);
    assert.equal(session.workspaces[0].bindings.length, 1);
  });
});

describe('LIN-1887 Step 4 — POST /auth/jira/oauth/link (the pick)', () => {
  async function beginTwoSitePick() {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const store = makeStore();
    const app = makeApp({ session, store, provider: fakeProvider(), fetches: stubs(TWO_SITES) });
    await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });
    return { session, store, app };
  }

  test('a cloudId the grant does not reach is REFUSED — the client cannot assert a site', async () => {
    const { session, app } = await beginTwoSitePick();
    const res = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-not-mine' } });
    assert.equal(res.status, 400);
    assert.equal(session.workspaces[0].bindings.find(b => b.provider === 'jira'), undefined);
  });

  test('the chosen site is linked with its own cloudId and site URL', async () => {
    const { session, app } = await beginTwoSitePick();
    const res = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-2' } });
    assert.equal(res.status, 302);
    const binding = session.workspaces[0].bindings.find(b => b.provider === 'jira');
    assert.equal(binding.scope, 'https://other.atlassian.net');
    assert.equal(binding.credentials.cloudId, 'cid-2');
    assert.equal(session.jiraPending, undefined, 'the pending state is cleared once consumed');
  });

  test('a pick with no pending state is refused rather than 500ing', async () => {
    const app = makeApp({ session: makeSession(), store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-1' } });
    assert.equal(res.status, 400);
  });
});

// === LIN-2499: the CSRF nonce's post-success lifetime ===
// routes/jira-auth.js:562/621 already deleted oauthState/oauthIntent — LIN-2499
// names this surface as the in-repo precedent the other three routers were
// brought up to. Nothing asserted it, so these are characterization tests: they
// pin the behaviour that is already correct, and they record WHERE Jira's clear
// point actually is, which is not identical to the GitHub surfaces'.
//
// Jira clears at FLOW COMPLETION, not unconditionally at the callback. With one
// reachable site the callback IS the completion (it links and redirects), so the
// nonce is gone when it returns. With several sites the callback renders a site
// picker and the nonce is consumed by the POST pick that follows — mid-flow it
// survives on purpose, the same reason lib/github-install-flow.js keeps it for
// the beginInstall hop.
describe('LIN-2499 — Jira OAuth consumes the CSRF nonce at flow completion', () => {
  test('single site: the callback completes the flow and the nonce is gone', async () => {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), fetches: stubs() });

    const res = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });

    assert.equal(res.status, 302);
    assert.equal(session.oauthState, undefined);
    assert.equal(session.oauthIntent, undefined);
  });

  test('single site: replaying the consumed nonce gets the 400 Session Expired guard, not a second link', async () => {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), fetches: stubs() });

    await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });
    const replay = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });

    assert.equal(replay.status, 400);
  });

  test('several sites: the nonce survives the picker render and is consumed by the pick', async () => {
    const session = makeSession({ oauthState: 'nonce', oauthIntent: { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' } });
    const app = makeApp({ session, store: makeStore(), provider: fakeProvider(), fetches: stubs(TWO_SITES) });

    const picker = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });
    assert.equal(picker.status, 200);
    assert.equal(session.oauthState, 'nonce', 'still mid-flow — the pick has not happened yet');

    const pick = await request(app, { method: 'POST', path: '/auth/jira/oauth/link', body: { cloudId: 'cid-2' } });
    assert.equal(pick.status, 302);
    assert.equal(session.oauthState, undefined);
    assert.equal(session.oauthIntent, undefined);
  });
});

describe('LIN-1887 — the Phase 1 Basic routes are untouched', () => {
  test('GET /auth/jira still renders the API-token form', async () => {
    const app = makeApp({ session: makeSession(), store: makeStore(), provider: fakeProvider() });
    const res = await request(app, { path: '/auth/jira?workspace=acme' });
    assert.equal(res.status, 200);
    assert.match(res.text, /data-testid="jira-link-form"/);
  });
});

// LIN-2285 (plan-review F2): the merged-side canonicalization fix in
// establishAccount (lib/account-session.js) makes `established.accountId`
// canonical for every call site, including `routes/jira-auth.js`'s OWN
// durable rotating-refresh write (`persistRefresh`, a second, Jira-specific
// consumer of the same OwnerCredentialStore the LIN-1887 tests above already
// pin for Linear). Real, MangoDB-backed account stores here (not the fake
// `makeAccountStores()` above, which models no merging at all) so a merge
// can genuinely be pre-seeded.
describe('LIN-2285 — a fresh Jira login with an already-merged identity canonicalizes the durable credential write', () => {
  let dbClient, dbDir;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'jira-oauth-lin2285-'));
    dbClient = new MangoClient(dbDir);
    await dbClient.connect();
  });
  after(async () => {
    if (dbClient?.close) await dbClient.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function realAccountStores() {
    const db = dbClient.db('acct');
    return {
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
  }

  // mode:'new' mints a fresh workspace container via `req.session.regenerate`
  // — none of the `add-source` sessions above exercise that branch, so this
  // session needs its own `regenerate`, mirroring tests/unit/account-identity.test.js's.
  function makeFreshLoginSession() {
    return {
      workspaces: [],
      oauthState: 'nonce',
      oauthIntent: { mode: 'new', provider: 'jira' },
      save(cb) { if (cb) cb(null); },
      regenerate(cb) {
        for (const k of Object.keys(this)) {
          if (typeof this[k] !== 'function') delete this[k];
        }
        cb();
      },
    };
  }

  test('persistRefresh writes the rotating refresh token under the CANONICAL account, not the merged one', async () => {
    const { accountStore, accountWorkspaceStore } = realAccountStores();
    const a = await accountStore.createAccount();
    const b = await accountStore.createAccount();
    await accountStore.linkIdentity(b._id, 'jira', 'atlassian-acct-1', {});
    assert.equal((await accountStore.mergeAccounts(a._id, b._id)).ok, true, 'sanity: B is merged into A before this login ever happens');

    const store = makeStore();
    const session = makeFreshLoginSession();
    const app = makeApp({ session, store, provider: fakeProvider(), fetches: stubs(), accountStore, accountWorkspaceStore });
    const res = await request(app, { path: '/auth/jira/oauth/callback?code=c&state=nonce' });

    assert.equal(res.status, 302, res.text);
    assert.equal(session.accountId, a._id, 'session.accountId is canonical, not the merged id B');

    const urlKey = session.workspaces[0].urlKey;
    const canonicalCred = await store.get(a._id, urlKey, 'jira');
    assert.ok(canonicalCred, 'the durable rotating refresh token landed under the CANONICAL account');
    assert.equal(canonicalCred.refreshToken, 'atlassian-refresh-ROTATING');
    const mergedCred = await store.get(b._id, urlKey, 'jira');
    assert.equal(mergedCred, null, 'no write happened under the merged (non-canonical) account');
  });
});
