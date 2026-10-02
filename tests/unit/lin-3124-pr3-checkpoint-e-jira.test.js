/**
 * LIN-3124 PR3 checkpoint E — the Jira OAuth add-source pick seam (D8 / D18,
 * revision 4b): T20 (a)-(k) and T21, each run for a single-site grant (the
 * callback completes the link in the same request) and a multi-site grant (the
 * pick is a second request), through the REAL `routes/jira-auth.js` handlers
 * with real MangoDB stores and only the network faked.
 *
 * Invariant (per session, residual (c) excepted): a rotating refresh token is
 * never duplicated and never deleted — `liveCopies(session, store, token)`, the
 * number of records holding the token that some binding IN THAT ONE SESSION
 * can read, is 1 after every case except session 1 of T20(k) on the success
 * path (row 7), which is residual (c) asserted as stated.
 *
 * Names follow the end-state table after D8: `S` = the staged record
 * `acct::urlKey::jira`, `C` = the connection-keyed record for the new site B,
 * `R1` = the new grant's rotating refresh token, `A` = another site.
 *
 * Run with: node --test tests/unit/lin-3124-pr3-checkpoint-e-jira.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createJiraAuthRoutes } from '../../routes/jira-auth.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { convertToConnectionBacked, createConnectionRefresher } from '../../lib/connection-credential.js';
import { refreshOwnerCredential } from '../../lib/workspace-token-refresh.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';

const ENV_KEYS = ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET', 'JIRA_REDIRECT_URI'];
const SITE_A = { id: 'cid-a', url: 'https://a.atlassian.net', name: 'A' };
const SITE_B = { id: 'cid-b', url: 'https://b.atlassian.net', name: 'B' };
const SITE_X = { id: 'cid-x', url: 'https://x.atlassian.net', name: 'X' };
const MODES = {
  single: { sites: [SITE_B] },
  multi: { sites: [SITE_X, SITE_B] },
};
const OWNER_SPY = ['put', 'getByConnection', 'putByConnection', 'copyToConnection', 'finalizePromotion', 'deleteByConnection'];
const CONN_SPY = ['link', 'readConnectionOutcome', 'put'];

function spied(store, names, log, faults = {}, prefix = '') {
  const wrapper = Object.create(store);
  for (const name of names) {
    const real = store[name].bind(store);
    wrapper[name] = async (...args) => {
      log.push(prefix + name);
      return faults[name] ? faults[name](real, ...args) : real(...args);
    };
  }
  return wrapper;
}

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path}`);
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

/** A rotating-grant model: a refresh token is accepted once, then spent. */
function grantServer(initial) {
  const live = new Set(initial);
  const exchange = async (rt) => {
    if (!live.has(rt)) throw new TokenRefreshError('invalid_grant', 'EXPIRED');
    live.delete(rt);
    const next = `${rt}+`;
    live.add(next);
    return { access_token: `at-${next}`, refresh_token: next, expires_in: 3600 };
  };
  return { live, exchange };
}

/** Records holding `token` that some Jira binding in THIS session can read. */
async function liveCopies(session, ownerStore, token) {
  const ids = new Set();
  for (const ws of session.workspaces || []) {
    for (const b of ws.bindings || []) {
      if (b.provider !== 'jira') continue;
      if (typeof b.connectionId === 'string') ids.add(b.connectionId);
      else if (b.credentials?.authType === 'oauth') ids.add(`${session.accountId}::${ws.urlKey}::jira`);
    }
  }
  let n = 0;
  for (const id of ids) if ((await ownerStore.collection.findOne({ _id: id }))?.refreshToken === token) n++;
  return n;
}

async function recordsHolding(ownerStore, token) {
  return (await ownerStore.collection.find({ refreshToken: token }).toArray()).length;
}

/** Every Jira OAuth binding in the session has a readable record carrying a refresh token. */
async function everyBindingHasDurableRefresh(session, ownerStore) {
  for (const ws of session.workspaces || []) {
    for (const b of ws.bindings || []) {
      if (b.provider !== 'jira') continue;
      const id = typeof b.connectionId === 'string' ? b.connectionId
        : b.credentials?.authType === 'oauth' ? `${session.accountId}::${ws.urlKey}::jira` : null;
      if (id && !(await ownerStore.collection.findOne({ _id: id }))?.refreshToken) return false;
    }
  }
  return true;
}

describe('LIN-3124 PR3 checkpoint E — Jira add-source pick seam (D8/D18, T20/T21)', () => {
  let dbDir;
  let client;
  let counter = 0;
  let savedEnv;
  const realFetch = globalThis.fetch;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3124-pr3-ej-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });
  after(async () => {
    globalThis.fetch = realFetch;
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
    process.env.JIRA_CLIENT_ID = 'cid';
    process.env.JIRA_CLIENT_SECRET = 'secret';
    process.env.JIRA_REDIRECT_URI = 'https://harbour.example/auth/jira/oauth/callback';
  });
  afterEach(() => {
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    delete process.env.CONNECTION_BACKED_WRITES;
    globalThis.fetch = realFetch;
  });

  /**
   * One owner, one world: real stores (spied, with optional faults) and a
   * factory for sessions of that owner. Each `addSource` drives the real
   * callback (and, multi-site, the real pick) against one session.
   */
  async function world({ ownerFaults = {}, connFaults = {} } = {}) {
    const db = client.db(`pr3ej_${counter++}`);
    const real = {
      ownerStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
    };
    const account = await real.accountStore.createAccount();
    const log = [];
    const faults = { owner: { ...ownerFaults }, conn: { ...connFaults } };
    const ownerCredentialStore = spied(real.ownerStore, OWNER_SPY, log, faults.owner);
    const connectionStore = spied(real.connectionStore, CONN_SPY, log, faults.conn, 'conn.');
    const router = createJiraAuthRoutes({
      provider: { validateCredential: async () => ({ accountId: 'atl-human', emailAddress: 'a@b.c', displayName: 'A' }) },
      accountStore: real.accountStore, accountWorkspaceStore: real.accountWorkspaceStore,
      ownerCredentialStore, connectionStore,
    });
    const callback = getHandler(router, 'get', '/auth/jira/oauth/callback');
    const pick = getHandler(router, 'post', '/auth/jira/oauth/link');

    function session(extraBindings = [], over = {}) {
      return {
        accountId: account._id,
        workspaces: [{
          id: 'ws-1', urlKey: 'acme', provider: 'linear', accessToken: 'lin', credentials: { token: 'lin' },
          bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'lin' } }, ...extraBindings],
        }],
        activeWorkspaceId: 'ws-1',
        save(cb) { log.push('saveSession'); if (this.failSave) return cb(new Error('session store down')); cb(null); },
        ...over,
      };
    }

    /** Callback (+ pick): returns the final response; `beforePick` runs between the two. */
    async function addSource(s, { mode = 'single', refresh = 'R1', site = SITE_B, beforePick, beforeFinalSave } = {}) {
      const sites = mode === 'single' ? [site] : [SITE_X, site];
      globalThis.fetch = async (url) => {
        if (String(url).includes('accessible-resources')) return { ok: true, status: 200, json: async () => sites };
        if (String(url).includes('/oauth/token')) return { ok: true, status: 200, json: async () => ({ access_token: `at-${refresh}`, refresh_token: refresh, expires_in: 3600 }) };
        throw new Error(`unstubbed fetch ${url}`);
      };
      s.oauthState = 'nonce';
      s.oauthIntent = { mode: 'add-source', provider: 'jira', workspaceUrlKey: 'acme' };
      const run = async (handler, req) => {
        const res = makeRes();
        try { await handler(req, res); } catch (err) { res.thrown = err; }
        return res;
      };
      if (mode === 'single') {
        if (beforeFinalSave) s.failSave = beforeFinalSave === 'fail';
        return run(callback, { query: { code: 'c', state: 'nonce' }, session: s });
      }
      const first = await run(callback, { query: { code: 'c', state: 'nonce' }, session: s });
      assert.equal(first.statusCode, 200, 'the picker rendered');
      if (beforePick) await beforePick();
      if (beforeFinalSave) s.failSave = beforeFinalSave === 'fail';
      return run(pick, { body: { cloudId: site.id }, session: s });
    }

    const staged = () => real.ownerStore.collection.findOne({ _id: `${account._id}::acme::jira` });
    const connectionIdFor = (site = SITE_B) => `${account._id}::jira::${site.url}`;
    const bindingFor = (s, site = SITE_B) => s.workspaces[0].bindings.find(b => b.provider === 'jira' && b.scope === site.url);
    return { real, account, log, faults, session, addSource, staged, connectionIdFor, bindingFor, db };
  }

  const LEGACY_OAUTH_A = { provider: 'jira', scope: SITE_A.url, credentials: { token: 'at-A', authType: 'oauth', cloudId: SITE_A.id, tokenExpiresAt: Date.now() + 3600_000 } };
  const LEGACY_BASIC_A = { provider: 'jira', scope: SITE_A.url, credentials: { token: 'api', email: 'e', tokenExpiresAt: Number.MAX_SAFE_INTEGER } };

  for (const mode of Object.keys(MODES)) {
    describe(`${mode}-site`, () => {
      test('T20(c) row 7 success: copy → link → rewrite → saveSession → finalize; one owner record (C)', async () => {
        const w = await world();
        const s = w.session();
        const res = await w.addSource(s, { mode });
        assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=jira', res.body);
        const order = w.log.filter(n => ['copyToConnection', 'conn.link', 'saveSession', 'finalizePromotion', 'deleteByConnection'].includes(n));
        assert.deepEqual(order.slice(-4), ['copyToConnection', 'conn.link', 'saveSession', 'finalizePromotion']);
        assert.ok(!w.log.includes('deleteByConnection'), 'the converter never deletes');
        assert.ok(!w.log.includes('putByConnection'), 'one copy source: the staged record, never the refreshToken argument');
        assert.deepEqual(w.bindingFor(s), { provider: 'jira', scope: SITE_B.url, connectionId: w.connectionIdFor() });
        const owner = await w.real.ownerStore.collection.find({}).toArray();
        assert.deepEqual(owner.map(r => r._id), [w.connectionIdFor()], 'exactly one owner record: C');
        assert.equal(owner[0].refreshToken, 'R1');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1);
        assert.ok(!JSON.stringify(s).includes('R1'), 'no refresh token in the session');
        // First refresh finds the record (connection lane).
        const grants = grantServer(['R1']);
        const refresh = createConnectionRefresher({ connectionStore: w.real.connectionStore, ownerCredentialStore: w.real.ownerStore, resolveExchange: () => grants.exchange });
        assert.equal((await refresh(w.connectionIdFor(), w.account._id)).refreshToken, 'R1+');
      });

      test('T20(a) row 2: link() false, re-read absent: B legacy, copy released, S byte-equal, S refreshes as today', async () => {
        const w = await world({ connFaults: { link: async () => false } });
        const s = w.session();
        let snapshot;
        w.faults.owner.put = async (realPut, ...args) => { const ok = await realPut(...args); snapshot = await w.staged(); return ok; };
        await w.addSource(s, { mode });
        assert.equal(w.log.filter(n => n === 'put').length, 1, 'no persistOwnerCredential call: the staging put only');
        assert.ok(w.log.indexOf('conn.readConnectionOutcome') >= 0 && w.log.indexOf('conn.readConnectionOutcome') < w.log.indexOf('deleteByConnection'), 're-read BEFORE the release');
        assert.ok(w.bindingFor(s).credentials, 'B is legacy');
        assert.equal(await w.real.ownerStore.collection.findOne({ _id: w.connectionIdFor() }), null, 'the copy was released');
        assert.deepEqual(await w.staged(), snapshot, 'S is byte-equal to the staging write');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1);
        assert.equal(await w.real.connectionStore.collection.countDocuments({ referents: { $exists: true } }), 0);
        const grants = grantServer(['R1']);
        const out = await refreshOwnerCredential({ ownerAccountId: w.account._id, urlKey: 'acme', provider: 'jira', refreshAccessToken: grants.exchange, store: w.real.ownerStore });
        assert.equal(out.refreshToken, 'R1+');
        assert.equal((await w.staged()).pendingSpend, null, 'spend-intent resolved by the CAS as today');
      });

      test('T20(b): the same with the orphan release failing: the orphan copy is inert and S still refreshes', async () => {
        const w = await world({ connFaults: { link: async () => false }, ownerFaults: { deleteByConnection: async () => false } });
        const s = w.session();
        await w.addSource(s, { mode });
        assert.ok(await w.real.ownerStore.collection.findOne({ _id: w.connectionIdFor() }), 'the unreleased copy remains');
        assert.ok(!s.workspaces[0].bindings.some(b => b.connectionId), 'nothing references its connectionId: inert');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1);
        const grants = grantServer(['R1']);
        assert.equal((await refreshOwnerCredential({ ownerAccountId: w.account._id, urlKey: 'acme', provider: 'jira', refreshAccessToken: grants.exchange, store: w.real.ownerStore })).refreshToken, 'R1+');
      });

      test('T20(d) row 5: saveSession rejects: S intact, C the one live copy; a retried pick ends with one record', async () => {
        const w = await world();
        const s = w.session();
        const persisted = mode === 'multi' ? null : structuredClone({ workspaces: s.workspaces });
        let beforePickClone;
        const res = await w.addSource(s, { mode, beforeFinalSave: 'fail', beforePick: async () => { beforePickClone = structuredClone({ workspaces: s.workspaces, jiraPending: s.jiraPending, oauthIntent: s.oauthIntent }); } });
        assert.ok(res.thrown, 'the rejected save surfaces as an error');
        assert.ok(!w.log.includes('finalizePromotion'), 'finalize never runs before a successful save');
        assert.equal((await w.staged()).refreshToken, 'R1', 'S intact');
        assert.equal((await w.real.ownerStore.getByConnection(w.connectionIdFor())).refreshToken, 'R1');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1, 'C is the one copy this session reads');

        // Retry from the state the failed save left persisted.
        const retry = w.session();
        if (mode === 'multi') {
          retry.workspaces = beforePickClone.workspaces;
          retry.jiraPending = beforePickClone.jiraPending;
          retry.oauthIntent = beforePickClone.oauthIntent;
          const res2 = makeRes();
          await getHandler(createJiraAuthRoutes({ provider: { validateCredential: async () => ({ accountId: 'atl-human' }) }, accountStore: w.real.accountStore, accountWorkspaceStore: w.real.accountWorkspaceStore, ownerCredentialStore: w.real.ownerStore, connectionStore: w.real.connectionStore }), 'post', '/auth/jira/oauth/link')({ body: { cloudId: SITE_B.id }, session: retry }, res2);
          assert.equal(res2.redirectedTo, '/workspace/acme/settings?provider_ok=jira');
        } else {
          retry.workspaces = persisted.workspaces;
          const res2 = await w.addSource(retry, { mode });
          assert.equal(res2.redirectedTo, '/workspace/acme/settings?provider_ok=jira');
        }
        assert.deepEqual((await w.real.ownerStore.collection.find({}).toArray()).map(r => r._id), [w.connectionIdFor()]);
        assert.equal(await liveCopies(retry, w.real.ownerStore, 'R1'), 1);
      });

      test('T20(e) gate G: a co-resident legacy OAuth site A keeps B legacy — one record, no store call, both lanes rotate', async () => {
        const w = await world();
        const s = w.session([structuredClone(LEGACY_OAUTH_A)]);
        await w.addSource(s, { mode });
        for (const name of ['copyToConnection', 'conn.link', 'finalizePromotion', 'putByConnection', 'getByConnection', 'deleteByConnection', 'conn.readConnectionOutcome']) {
          assert.ok(!w.log.includes(name), `no ${name}`);
        }
        assert.equal(w.log.filter(n => n === 'put').length, 1, 'the staging put only: no persistOwnerCredential over the staged token');
        assert.ok(w.bindingFor(s).credentials, 'B legacy');
        assert.deepEqual((await w.real.ownerStore.collection.find({}).toArray()).map(r => r._id), [`${w.account._id}::acme::jira`]);
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1);
        // T20(g)(i): A and B on one grant (shared S, CAS) — rotate through
        // either, the other still refreshes, neither is classified revoked.
        const grants = grantServer(['R1']);
        const refreshVia = () => refreshOwnerCredential({ ownerAccountId: w.account._id, urlKey: 'acme', provider: 'jira', refreshAccessToken: grants.exchange, store: w.real.ownerStore });
        assert.equal((await refreshVia()).refreshToken, 'R1+', 'A rotates');
        assert.equal((await refreshVia()).refreshToken, 'R1++', 'then B refreshes from the rotated token');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1++'), 1);
      });

      test('T20(e): a co-resident legacy BASIC site does not trigger the gate', async () => {
        const w = await world();
        const s = w.session([structuredClone(LEGACY_BASIC_A)]);
        await w.addSource(s, { mode });
        assert.equal(w.bindingFor(s).connectionId, w.connectionIdFor());
        assert.equal(await w.staged(), null);
      });

      test('T20(f) row 6: finalize no-op (S re-staged by a later flow): S keeps its grant, B refreshes from C', async () => {
        const w = await world();
        const s = w.session();
        const origSave = s.save;
        let armed = mode === 'single';
        s.save = function (cb) {
          origSave.call(this, async (err) => {
            // A later flow writes its own grant into S between the save and finalize.
            if (armed) await w.real.ownerStore.put(w.account._id, 'acme', { provider: 'jira', token: 'at-R9', refreshToken: 'R9', tokenExpiresAt: Date.now() + 3600_000 });
            cb(err);
          });
        };
        const res = await w.addSource(s, { mode, beforePick: async () => { armed = true; } });
        assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=jira');
        assert.equal((await w.staged()).refreshToken, 'R9', 'a later flow\'s own grant is never deleted');
        const grants = grantServer(['R1', 'R9']);
        const refresh = createConnectionRefresher({ connectionStore: w.real.connectionStore, ownerCredentialStore: w.real.ownerStore, resolveExchange: () => grants.exchange });
        assert.equal((await refresh(w.connectionIdFor(), w.account._id)).refreshToken, 'R1+');
      });

      test('T20(f) row 6: finalize no-op (C absent) and finalize throwing: no delete of S, no crash', async () => {
        const w = await world();
        const s = w.session();
        const origSave = s.save;
        let armed = mode === 'single';
        s.save = function (cb) { origSave.call(this, async (err) => { if (armed) await w.real.ownerStore.collection.deleteOne({ _id: w.connectionIdFor() }); cb(err); }); };
        const res = await w.addSource(s, { mode, beforePick: async () => { armed = true; } });
        assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=jira');
        assert.equal((await w.staged()).refreshToken, 'R1', 'finalize can never delete the only refresh token');

        const w2 = await world({ ownerFaults: { finalizePromotion: async () => { throw new Error('store blip'); } } });
        const s2 = w2.session();
        const res2 = await w2.addSource(s2, { mode });
        assert.equal(res2.redirectedTo, '/workspace/acme/settings?provider_ok=jira');
        assert.equal((await w2.staged()).refreshToken, 'R1');
        assert.equal(w2.bindingFor(s2).connectionId, w2.connectionIdFor(), 'B reads C');
        assert.equal(await liveCopies(s2, w2.real.ownerStore, 'R1'), 1, 'S has no reader in this session');
      });

      test('T20(g)(ii): two connection-backed sites from two authorizations — two records, rotating A leaves B refreshing, no S', async () => {
        const w = await world();
        const s = w.session();
        await w.addSource(s, { mode, site: SITE_A, refresh: 'RA' });
        await w.addSource(s, { mode, site: SITE_B, refresh: 'RB' });
        assert.equal(w.bindingFor(s, SITE_A).connectionId, w.connectionIdFor(SITE_A));
        assert.equal(w.bindingFor(s, SITE_B).connectionId, w.connectionIdFor(SITE_B));
        assert.equal(await w.staged(), null);
        const grants = grantServer(['RA', 'RB']);
        const refresh = createConnectionRefresher({ connectionStore: w.real.connectionStore, ownerCredentialStore: w.real.ownerStore, resolveExchange: () => grants.exchange });
        assert.equal((await refresh(w.connectionIdFor(SITE_A), w.account._id)).refreshToken, 'RA+');
        assert.equal((await refresh(w.connectionIdFor(SITE_B), w.account._id)).refreshToken, 'RB+');
      });

      test('T20(h) row 3: link() false after a committed write: rolled forward, copy kept, finalize deletes S', async () => {
        const w = await world({ connFaults: { link: async (realLink, ...args) => { await realLink(...args); return false; } } });
        const s = w.session();
        await w.addSource(s, { mode });
        assert.ok(!w.log.includes('deleteByConnection'), 'the copy is never released on a committed write');
        assert.equal(w.bindingFor(s).connectionId, w.connectionIdFor());
        assert.deepEqual((await w.real.ownerStore.collection.find({}).toArray()).map(r => r._id), [w.connectionIdFor()]);
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1);
      });

      test('T20(h) row 4 (residual a): link() false and the re-read fails: S, C and the legacy binding kept, retryable error', async () => {
        const w = await world({ connFaults: { link: async () => false, readConnectionOutcome: async () => null } });
        const s = w.session();
        const res = await w.addSource(s, { mode });
        assert.equal(res.statusCode, 503);
        assert.match(res.body, /Connection Not Saved/);
        assert.ok(w.bindingFor(s).credentials, 'the legacy fallback binding');
        assert.equal((await w.staged()).refreshToken, 'R1');
        assert.equal((await w.real.ownerStore.getByConnection(w.connectionIdFor())).refreshToken, 'R1');
        assert.equal(await recordsHolding(w.real.ownerStore, 'R1'), 2, 'residual (a) as stated: two copies until the store returns');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1, 'only S is read in this session');
      });

      test('T20(i): establishAccount canonicalizes the account — copy/finalize key on the staging id; another id is a step-1 fallback', async () => {
        const w = await world();
        const canonical = await w.real.accountStore.createAccount();
        assert.equal((await w.real.accountStore.mergeAccounts(canonical._id, w.account._id, { accountWorkspaceStore: w.real.accountWorkspaceStore })).ok, true);
        const s = w.session();
        await w.addSource(s, { mode });
        assert.equal(s.accountId, canonical._id, 'establishAccount canonicalized the session');
        const cid = `${canonical._id}::jira::${SITE_B.url}`;
        assert.equal(w.bindingFor(s).connectionId, cid);
        assert.equal((await w.real.ownerStore.getByConnection(cid)).refreshToken, 'R1');
        assert.equal(await w.staged(), null, 'the staged record (under the staging id) was finalized');

        // The converter reading under any OTHER id finds nothing: step-1 fallback, S untouched.
        const w2 = await world();
        await w2.real.ownerStore.put(w2.account._id, 'acme', { provider: 'jira', token: 'at-R1', refreshToken: 'R1', tokenExpiresAt: 1 });
        const before = await w2.staged();
        const s2 = w2.session([{ provider: 'jira', scope: SITE_B.url, credentials: { token: 'at-R1', authType: 'oauth', cloudId: SITE_B.id, tokenExpiresAt: 1 } }]);
        const out = await convertToConnectionBacked({
          connectionStore: w2.real.connectionStore, ownerCredentialStore: w2.real.ownerStore, session: s2, accountId: w2.account._id,
          workspaceId: 'ws-1', provider: 'jira', scope: SITE_B.url, credentials: s2.workspaces[0].bindings[1].credentials, prior: 'none',
          staged: { accountId: 'some-other-id', urlKey: 'acme' },
        });
        assert.equal(out.connectionBacked, false);
        assert.deepEqual(await w2.staged(), before);
        assert.equal(await w2.real.ownerStore.getByConnection(`${w2.account._id}::jira::${SITE_B.url}`), null);
      });

      test('T21: a refused (conflicted) pick persists no Connection, referent or connection-keyed row', async () => {
        const w = await world();
        const other = await w.real.accountStore.createAccount();
        await w.real.accountStore.linkIdentity(other._id, 'jira', 'atl-human', {});
        const s = w.session();
        const res = await w.addSource(s, { mode });
        assert.equal(res.statusCode, 409);
        assert.equal(await w.real.connectionStore.collection.countDocuments({}), 0);
        assert.equal(await w.real.ownerStore.collection.countDocuments({ connectionId: { $exists: true } }), 0);
        assert.ok(!w.log.includes('copyToConnection') && !w.log.includes('conn.link'));
      });

      test('T21 row 1: the copy fails (or S is absent): legacy fallback exactly as today, S untouched', async () => {
        const w = await world({ ownerFaults: { copyToConnection: async () => false } });
        const s = w.session();
        await w.addSource(s, { mode });
        assert.ok(w.bindingFor(s).credentials);
        assert.equal((await w.staged()).refreshToken, 'R1');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R1'), 1);
        assert.ok(await everyBindingHasDurableRefresh(s, w.real.ownerStore));
        if (mode === 'multi') {
          const w2 = await world();
          const s2 = w2.session();
          await w2.addSource(s2, { mode, beforePick: async () => { await w2.real.ownerStore.collection.deleteOne({ _id: `${w2.account._id}::acme::jira` }); } });
          assert.ok(w2.bindingFor(s2).credentials, 'S absent at pick time: step-1 fallback');
          assert.equal(await w2.real.ownerStore.collection.countDocuments({}), 0);
        }
      });

      test('T21 row 8: existing connection-backed B re-auth where link() fails: new record kept, no finalize, S duplicate, retryable', async () => {
        const w = await world();
        const s = w.session();
        await w.addSource(s, { mode });
        w.faults.conn.link = async () => false;
        w.log.length = 0;
        const res = await w.addSource(s, { mode, refresh: 'R2' });
        assert.equal(res.statusCode, 503);
        assert.ok(!w.log.includes('finalizePromotion') && !w.log.includes('deleteByConnection') && !w.log.includes('conn.readConnectionOutcome'));
        assert.deepEqual(w.bindingFor(s), { provider: 'jira', scope: SITE_B.url, connectionId: w.connectionIdFor() }, 'never downgraded');
        assert.equal((await w.real.ownerStore.getByConnection(w.connectionIdFor())).refreshToken, 'R2', 'the new record is kept');
        assert.equal((await w.staged()).refreshToken, 'R2', 'S stays as a duplicate with no reader in this session');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R2'), 1);
      });

      test('T21 existing connection-backed B re-auth, success: C updated, S finalized, shape kept', async () => {
        const w = await world();
        const s = w.session();
        await w.addSource(s, { mode });
        await w.addSource(s, { mode, refresh: 'R2' });
        assert.deepEqual(w.bindingFor(s), { provider: 'jira', scope: SITE_B.url, connectionId: w.connectionIdFor() });
        assert.deepEqual((await w.real.ownerStore.collection.find({}).toArray()).map(r => [r._id, r.refreshToken]), [[w.connectionIdFor(), 'R2']]);
      });

      test('T21 row 9 (residual b): existing connection-backed B + co-resident legacy OAuth A: no copy, C byte-equal, S read by A, retryable', async () => {
        const w = await world();
        const s = w.session();
        await w.addSource(s, { mode });                       // B connection-backed (R1 in C)
        process.env.CONNECTION_BACKED_WRITES = 'off';
        await w.addSource(s, { mode, site: SITE_A, refresh: 'RA' }); // rollback flag: A legacy
        delete process.env.CONNECTION_BACKED_WRITES;
        assert.ok(w.bindingFor(s, SITE_A).credentials, 'A legacy');
        const cBefore = await w.real.ownerStore.collection.findOne({ _id: w.connectionIdFor() });
        w.log.length = 0;
        const res = await w.addSource(s, { mode, refresh: 'R2' });  // re-auth B
        assert.equal(res.statusCode, 503);
        assert.ok(!w.log.includes('copyToConnection') && !w.log.includes('conn.link'), 'no copy, no link');
        assert.deepEqual(await w.real.ownerStore.collection.findOne({ _id: w.connectionIdFor() }), cBefore, 'C byte-equal');
        assert.equal((await w.staged()).refreshToken, 'R2', 'S holds R2 and A reads it');
        assert.equal(await liveCopies(s, w.real.ownerStore, 'R2'), 1);
        assert.ok(await everyBindingHasDurableRefresh(s, w.real.ownerStore));
      });

      test('T20(k) residual (c) as stated: two sessions of one owner, rows 7 / 5 / 6 / 8', async () => {
        // Row 7 (success): session 1's legacy A loses its only refresh token.
        {
          const w = await world();
          const s1 = w.session([structuredClone(LEGACY_OAUTH_A)]);
          await w.real.ownerStore.put(w.account._id, 'acme', { provider: 'jira', token: 'at-R0', refreshToken: 'R0', tokenExpiresAt: 1 });
          const s1Before = JSON.stringify(s1);
          const s2 = w.session();
          await w.addSource(s2, { mode });
          assert.equal(JSON.stringify(s1), s1Before, 'no scan of (or write to) session 1');
          assert.equal(await liveCopies(s2, w.real.ownerStore, 'R1'), 1, 'session 2 refreshes from C');
          assert.equal(await liveCopies(s1, w.real.ownerStore, 'R1'), 0, 'session 1 count 0 after row 7 (residual c)');
          assert.equal(await w.staged(), null);
          const grants = grantServer(['R0', 'R1']);
          assert.equal(await refreshOwnerCredential({ ownerAccountId: w.account._id, urlKey: 'acme', provider: 'jira', refreshAccessToken: grants.exchange, store: w.real.ownerStore }), null,
            "session 1's A takes the null-refresh path (the re-link notice at its next expiry)");
        }
        // Rows 5 and 6: S and C both hold R1 — a second live copy seen from session 1.
        for (const row of ['5', '6']) {
          const w = await world(row === '6' ? { ownerFaults: { finalizePromotion: async () => false } } : {});
          const s1 = w.session([structuredClone(LEGACY_OAUTH_A)]);
          const s2 = w.session();
          await w.addSource(s2, { mode, beforeFinalSave: row === '5' ? 'fail' : undefined });
          assert.equal(await liveCopies(s2, w.real.ownerStore, 'R1'), 1, `row ${row}: session 2`);
          assert.equal(await liveCopies(s1, w.real.ownerStore, 'R1'), 1, `row ${row}: session 1 reads S`);
        }
        // Row 8: existing connection-backed B re-auth fails in session 2.
        {
          const w = await world();
          const s1 = w.session([structuredClone(LEGACY_OAUTH_A)]);
          const s2 = w.session();
          await w.addSource(s2, { mode });
          w.faults.conn.link = async () => false;
          await w.addSource(s2, { mode, refresh: 'R2' });
          assert.equal(await liveCopies(s2, w.real.ownerStore, 'R2'), 1);
          assert.equal(await liveCopies(s1, w.real.ownerStore, 'R2'), 1);
        }
        // Concurrent re-stage (multi-site only: the pick is a separate request).
        if (mode === 'multi') {
          const w = await world();
          const s2 = w.session();
          await w.addSource(s2, { mode, beforePick: async () => {
            await w.real.ownerStore.put(w.account._id, 'acme', { provider: 'jira', token: 'at-R2', refreshToken: 'R2', tokenExpiresAt: 1 });
          } });
          assert.equal((await w.real.ownerStore.getByConnection(w.connectionIdFor())).refreshToken, 'R2', 'the re-staged grant is what is copied');
          assert.equal(await w.staged(), null, 'and then deleted from S');
        }
      });

      test('flag-off parity: CONNECTION_BACKED_WRITES=off keeps B legacy exactly as before the cutover', async () => {
        process.env.CONNECTION_BACKED_WRITES = 'off';
        const w = await world();
        const s = w.session();
        const res = await w.addSource(s, { mode });
        assert.equal(res.redirectedTo, '/workspace/acme/settings?provider_ok=jira');
        assert.deepEqual(w.log.filter(n => n !== 'saveSession'), ['put', 'conn.put'], 'the staging put and the LIN-3127 dual-write only');
        assert.equal(w.bindingFor(s).credentials.authType, 'oauth');
        assert.equal((await w.staged()).refreshToken, 'R1');
        const [row] = await w.real.connectionStore.collection.find({}).toArray();
        assert.equal(row.referents, undefined);
      });

      test('legacy byte-identity: re-auth of an existing LEGACY OAuth site B is identical with the flag on and off', async () => {
        async function run(flag) {
          if (flag) process.env.CONNECTION_BACKED_WRITES = flag; else delete process.env.CONNECTION_BACKED_WRITES;
          const w = await world();
          const legacyB = { provider: 'jira', scope: SITE_B.url, credentials: { token: 'at-R0', authType: 'oauth', cloudId: SITE_B.id, tokenExpiresAt: 1 } };
          const s = w.session([legacyB]);
          const realNow = Date.now;
          Date.now = () => 1_800_000_000_000;
          try { await w.addSource(s, { mode }); } finally { Date.now = realNow; delete process.env.CONNECTION_BACKED_WRITES; }
          const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (['createdAt', 'updatedAt', 'boundAt', 'linkedAt', 'identityAuthenticatedAt'].includes(k) ? undefined : v)).split(w.account._id).join('ACCT'));
          const { save, ...plain } = s;
          return strip({ session: plain, owner: await w.real.ownerStore.collection.find({}).toArray(), conn: await w.real.connectionStore.collection.find({}).toArray(), log: w.log });
        }
        const on = await run(undefined);
        const off = await run('off');
        assert.deepEqual(on, off);
        assert.ok(on.session.workspaces[0].bindings[1].credentials, 'stays legacy');
      });
    });
  }

  test('T20(j): new-login existing container with a legacy sibling — direct putByConnection, legacy key byte-equal, sibling keeps its grant', async () => {
    const w = await world();
    const legacyA = structuredClone(LEGACY_OAUTH_A);
    const container = { id: 'jira:atl-human', urlKey: 'acme-jira', provider: 'jira', accessToken: 'at-A', bindings: [legacyA] };
    await w.real.accountStore.linkIdentity(w.account._id, 'jira', 'atl-human', {});
    await w.real.ownerStore.put(w.account._id, 'acme-jira', { provider: 'jira', token: 'at-RA', refreshToken: 'RA', tokenExpiresAt: 1 });
    const legacyBefore = await w.real.ownerStore.collection.findOne({ _id: `${w.account._id}::acme-jira::jira` });
    const s = { accountId: w.account._id, workspaces: [container], activeWorkspaceId: container.id, oauthState: 'nonce', oauthIntent: { mode: 'new', provider: 'jira' }, save(cb) { cb(null); } };
    globalThis.fetch = async (url) => String(url).includes('accessible-resources')
      ? { ok: true, status: 200, json: async () => [SITE_B] }
      : { ok: true, status: 200, json: async () => ({ access_token: 'at-RB', refresh_token: 'RB', expires_in: 3600 }) };
    const router = createJiraAuthRoutes({ provider: { validateCredential: async () => ({ accountId: 'atl-human' }) }, accountStore: w.real.accountStore, accountWorkspaceStore: w.real.accountWorkspaceStore, ownerCredentialStore: w.real.ownerStore, connectionStore: w.real.connectionStore });
    const res = makeRes();
    await getHandler(router, 'get', '/auth/jira/oauth/callback')({ query: { code: 'c', state: 'nonce' }, session: s }, res);
    assert.equal(res.redirectedTo, '/workspace/acme-jira/');
    const b = container.bindings.find(x => x.scope === SITE_B.url);
    assert.equal(b.connectionId, `${w.account._id}::jira::${SITE_B.url}`);
    assert.equal((await w.real.ownerStore.getByConnection(b.connectionId)).refreshToken, 'RB');
    assert.deepEqual(await w.real.ownerStore.collection.findOne({ _id: `${w.account._id}::acme-jira::jira` }), legacyBefore, 'the legacy key is byte-equal');
    const grants = grantServer(['RA', 'RB']);
    assert.equal((await refreshOwnerCredential({ ownerAccountId: w.account._id, urlKey: 'acme-jira', provider: 'jira', refreshAccessToken: grants.exchange, store: w.real.ownerStore })).refreshToken, 'RA+', 'the sibling refreshes from its own grant');
  });

  test('new-login fresh container: connection-backed, no legacy record; flag off writes the legacy record', async () => {
    for (const flag of [undefined, 'off']) {
      if (flag) process.env.CONNECTION_BACKED_WRITES = flag; else delete process.env.CONNECTION_BACKED_WRITES;
      const w = await world();
      const s = { workspaces: [], oauthState: 'nonce', oauthIntent: { mode: 'new', provider: 'jira' }, save(cb) { cb(null); }, regenerate(cb) { for (const k of Object.keys(this)) if (typeof this[k] !== 'function') delete this[k]; cb(); } };
      globalThis.fetch = async (url) => String(url).includes('accessible-resources')
        ? { ok: true, status: 200, json: async () => [SITE_B] }
        : { ok: true, status: 200, json: async () => ({ access_token: 'at-RN', refresh_token: 'RN', expires_in: 3600 }) };
      const router = createJiraAuthRoutes({ provider: { validateCredential: async () => ({ accountId: 'atl-new' }) }, accountStore: w.real.accountStore, accountWorkspaceStore: w.real.accountWorkspaceStore, ownerCredentialStore: w.real.ownerStore, connectionStore: w.real.connectionStore });
      const res = makeRes();
      await getHandler(router, 'get', '/auth/jira/oauth/callback')({ query: { code: 'c', state: 'nonce' }, session: s }, res);
      const ws = s.workspaces[0];
      assert.match(res.redirectedTo, /^\/workspace\//);
      if (!flag) {
        assert.deepEqual(ws.bindings, [{ provider: 'jira', scope: SITE_B.url, connectionId: `${s.accountId}::jira::${SITE_B.url}` }]);
        assert.deepEqual(ws.activeBinding, { provider: 'jira', scope: SITE_B.url });
        assert.equal(await w.real.ownerStore.get(s.accountId, ws.urlKey, 'jira'), null);
      } else {
        assert.equal(ws.bindings[0].credentials.authType, 'oauth');
        assert.equal((await w.real.ownerStore.get(s.accountId, ws.urlKey, 'jira')).refreshToken, 'RN');
      }
    }
    delete process.env.CONNECTION_BACKED_WRITES;
  });

  test('copy and finalize are idempotent; finalize on an absent S is a no-op', async () => {
    const w = await world();
    await w.real.ownerStore.put(w.account._id, 'acme', { provider: 'jira', token: 't', refreshToken: 'R1', tokenExpiresAt: 1 });
    const cid = w.connectionIdFor();
    assert.equal(await w.real.ownerStore.copyToConnection(w.account._id, 'acme', 'jira', cid), true);
    assert.equal(await w.real.ownerStore.copyToConnection(w.account._id, 'acme', 'jira', cid), true);
    assert.equal(await w.real.ownerStore.collection.countDocuments({}), 2);
    assert.equal(await w.real.ownerStore.finalizePromotion(w.account._id, 'acme', 'jira', { connectionId: cid, copiedRefreshToken: 'R1' }), true);
    assert.equal(await w.real.ownerStore.finalizePromotion(w.account._id, 'acme', 'jira', { connectionId: cid, copiedRefreshToken: 'R1' }), false);
    assert.equal(await w.real.ownerStore.collection.countDocuments({}), 1);
  });

  test('pins: finalizePromotion / copyToConnection have one caller (the seam)', () => {
    const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
    const seam = src('lib/connection-credential.js');
    assert.equal((seam.match(/\.finalizePromotion\(/g) || []).length, 1);
    assert.equal((seam.match(/\.copyToConnection\(/g) || []).length, 1);
    for (const rel of ['routes/jira-auth.js', 'server.js', 'routes/auth.js', 'lib/github-install-flow.js', 'routes/account-merge.js']) {
      assert.doesNotMatch(src(rel), /\.(finalizePromotion|copyToConnection)\(/, rel);
    }
    // LIN-3219 A3: the cross-file `KNOWN_CONNECTION_RELEASE_COUNT = 7` literal
    // pin is dropped; the durable-release boundary (every
    // releaseConnectionCredential call passes an `evict:` hook) is guarded in
    // lin-3124-pr3-n1-d4.test.js, and the guard file keeps its own constant.
    // The Jira route awaits the finalize thunk only AFTER the session save.
    const jira = src('routes/jira-auth.js');
    const save = jira.indexOf('await saveSession(req.session)\n    await conversion.finalize()');
    assert.ok(save > 0, 'finalize runs immediately after the awaited saveSession');
    // The router has no sessions dependency, so it cannot scan other session rows (residual c: no cross-session checks).
    assert.doesNotMatch(jira.slice(jira.indexOf('export function createJiraAuthRoutes('), jira.indexOf('export function createJiraAuthRoutes(') + 200), /sessions/i);
  });
});
