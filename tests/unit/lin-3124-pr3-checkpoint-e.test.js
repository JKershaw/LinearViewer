/**
 * LIN-3124 PR3 checkpoint E — the write flip (S3: D2a / D8 / D18 / D11).
 *
 * `convertToConnectionBacked` is the first observable change of the cutover:
 * a NEW eligible binding becomes `{provider, scope, connectionId}` and its
 * credential lives on the Connection (and, for refresh-token kinds, the
 * connection-keyed owner record). This file covers:
 *
 *   - the D2a creation matrix (eligible × prior shape × flag), with spies
 *     proving the non-converting arms make NO store call;
 *   - the D18 phase-B order and every failure step's end state (step 1, step
 *     2 refused / committed / unreadable, existing-binding failures);
 *   - D11 `CONNECTION_BACKED_WRITES`: creation-only, existing bindings still
 *     update, flag-off parity;
 *   - route-level conversion at the Linear, GitHub, merge-confirm and Jira
 *     new-login seams, the refused-link-persists-nothing case, and legacy
 *     byte-identity (a re-auth of an existing legacy binding is identical with
 *     the flag on and off);
 *   - T22 remainder: a re-auth over an existing connection-backed binding keeps
 *     the shape and writes no legacy record; `linkProvider` clears a stale
 *     marker when a legacy binding takes the mirror;
 *   - source pins: every seam converts after its establishAccount refusal and
 *     takes the legacy write only as the fallback.
 *
 * The Jira add-source pick seam (D8 stage/promote, T20/T21) is in
 * `lin-3124-pr3-checkpoint-e-jira.test.js`.
 *
 * Run with: node --test tests/unit/lin-3124-pr3-checkpoint-e.test.js
 */
import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { AccountMergeLogStore } from '../../lib/account-merge-log.js';
import { convertToConnectionBacked, connectionBackedWritesEnabled, bindingShapeAt } from '../../lib/connection-credential.js';
import { linkProvider, getWorkspaceToken } from '../../lib/workspace.js';
import { createAuthRoutes } from '../../routes/auth.js';
import { createAccountMergeRoutes } from '../../routes/account-merge.js';

const LINK_SPY = ['link', 'readConnectionOutcome', 'put', 'readConnectionById'];
const OWNER_SPY = ['getByConnection', 'putByConnection', 'copyToConnection', 'finalizePromotion', 'deleteByConnection', 'put', 'get'];

/** Wrap the named methods of a store: log each call, optionally inject a fault. */
function spied(store, names, log, faults = {}) {
  const wrapper = Object.create(store);
  for (const name of names) {
    const real = store[name].bind(store);
    wrapper[name] = async (...args) => {
      log.push(name);
      return faults[name] ? faults[name](real, ...args) : real(...args);
    };
  }
  return wrapper;
}

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
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

function makeSession(initial = {}) {
  return {
    ...initial,
    save(cb) { if (cb) cb(); },
    regenerate(cb) {
      for (const k of Object.keys(this)) if (typeof this[k] !== 'function') delete this[k];
      cb();
    },
  };
}

/** Drop volatile timestamps so two runs of one scenario compare byte-for-byte. */
function stable(docs) {
  return JSON.parse(JSON.stringify(docs, (k, v) => (['createdAt', 'updatedAt', 'addedAt', 'at', 'expiresAt', 'identityAuthenticatedAt', 'boundAt', 'linkedAt'].includes(k) ? undefined : v)));
}

async function withWrites(value, fn) {
  const prev = process.env.CONNECTION_BACKED_WRITES;
  if (value === undefined) delete process.env.CONNECTION_BACKED_WRITES;
  else process.env.CONNECTION_BACKED_WRITES = value;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.CONNECTION_BACKED_WRITES;
    else process.env.CONNECTION_BACKED_WRITES = prev;
  }
}

describe('LIN-3124 PR3 checkpoint E — convertToConnectionBacked', () => {
  let dbDir;
  let client;
  let counter = 0;
  const ENV = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_REDIRECT_URI'];
  let savedEnv;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'lin3124-pr3-e-'));
    client = new MangoClient(dbDir);
    await client.connect();
    savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    for (const k of ENV) process.env[k] = 'set';
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
    for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  });

  afterEach(() => { delete process.env.CONNECTION_BACKED_WRITES; });

  function stores() {
    const db = client.db(`pr3e_${counter++}`);
    return {
      db,
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      accountMergeLogStore: new AccountMergeLogStore({ collection: db.collection('account-merge-events') }),
    };
  }

  async function dump(s) {
    return {
      connections: await s.connectionStore.collection.find({}).toArray(),
      owner: await s.ownerCredentialStore.collection.find({}).toArray(),
    };
  }

  /** A session holding one workspace after phase A (`linkProvider`) ran. */
  function phaseA({ provider = 'linear', scope = 'org-1', credentials, workspaceProvider, existingBindings = [] } = {}) {
    const creds = credentials || { token: 'tok-1', tokenExpiresAt: Date.now() + 3600_000 };
    const workspace = { id: 'ws-1', urlKey: 'acme', bindings: existingBindings.map(b => ({ ...b })), ...(workspaceProvider ? { provider: workspaceProvider } : {}) };
    const prior = bindingShapeAt(workspace, provider, scope);
    linkProvider(workspace, provider, scope, creds);
    return { session: { accountId: 'acct-1', workspaces: [workspace] }, workspace, prior, creds };
  }

  function convert(s, { session, prior, creds }, over = {}) {
    return convertToConnectionBacked({
      connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore,
      session, accountId: 'acct-1', workspaceId: 'ws-1', provider: 'linear', scope: 'org-1',
      credentials: creds, refreshToken: 'R1', prior, ...over,
    });
  }

  // -------------------------------------------------------------------------
  // D2a creation matrix
  // -------------------------------------------------------------------------

  describe('D2a creation matrix', () => {
    test('new Linear binding → connection-backed: binding shape, Connection row, connection-keyed record, no legacy record', async () => {
      const s = stores();
      const a = phaseA();
      const out = await convert(s, a);
      assert.equal(out.connectionBacked, true);
      assert.equal(out.error, null);
      const connectionId = 'acct-1::linear::org-1';
      assert.deepEqual(a.workspace.bindings, [{ provider: 'linear', scope: 'org-1', connectionId }]);
      const row = await s.connectionStore.readConnectionById(connectionId);
      assert.equal(row.origin, 'connection');
      assert.deepEqual(row.referents, [{ urlKey: 'acme', provider: 'linear', scope: 'org-1' }]);
      assert.deepEqual(row.credentials, { token: 'tok-1', tokenExpiresAt: a.creds.tokenExpiresAt });
      const record = await s.ownerCredentialStore.getByConnection(connectionId);
      assert.equal(record.refreshToken, 'R1');
      assert.equal(record.token, 'tok-1');
      assert.equal(await s.ownerCredentialStore.get('acct-1', 'acme', 'linear'), null, 'the converter replaces persistOwnerCredential');
      assert.ok(!JSON.stringify(a.session).includes('R1'), 'no refresh token in the session');
      assert.ok(!JSON.stringify(a.session.workspaces[0].bindings).includes('tok-1'), 'no credential on the binding');
    });

    test('active-provider link: D2 marker set, scalar mirror stripped, side-table serves the token this request', async () => {
      const s = stores();
      const a = phaseA();
      assert.equal(a.workspace.accessToken, 'tok-1', 'phase A wrote the legacy mirror');
      await convert(s, a);
      assert.deepEqual(a.workspace.activeBinding, { provider: 'linear', scope: 'org-1' });
      assert.equal(a.workspace.accessToken, undefined);
      assert.equal(a.workspace.credentials, undefined);
      assert.equal(a.workspace.tokenExpiresAt, undefined);
      assert.equal(getWorkspaceToken(a.workspace), 'tok-1', 'hydrated for the rest of the request');
    });

    test('non-active add-source: no marker and the active provider mirror is untouched', async () => {
      const s = stores();
      const a = phaseA({ provider: 'github', scope: 'o/r', workspaceProvider: 'linear', credentials: { installationId: '9', token: 'ghs', tokenExpiresAt: 1 } });
      a.workspace.accessToken = 'lin-mirror';
      const out = await convert(s, a, { provider: 'github', scope: 'o/r', refreshToken: undefined });
      assert.equal(out.connectionBacked, true);
      assert.equal(a.workspace.activeBinding, undefined);
      assert.equal(a.workspace.accessToken, 'lin-mirror');
      assert.deepEqual(a.workspace.bindings, [{ provider: 'github', scope: 'o/r', connectionId: 'acct-1::github::9' }]);
      assert.equal((await dump(s)).owner.length, 0, 'remint kinds write no owner record');
    });

    test('github-projects and Jira OAuth convert; the connection unit is the installation / the site', async () => {
      const s = stores();
      const gp = phaseA({ provider: 'github-projects', scope: 'o/5', credentials: { installationId: '77', token: 'g', tokenExpiresAt: 1 } });
      assert.equal((await convert(s, gp, { provider: 'github-projects', scope: 'o/5', refreshToken: undefined })).connectionId, 'acct-1::github-projects::77');
      const s2 = stores();
      const jira = phaseA({ provider: 'jira', scope: 'https://a.atlassian.net', credentials: { token: 'j', authType: 'oauth', cloudId: 'c', tokenExpiresAt: 1 } });
      const out = await convert(s2, jira, { provider: 'jira', scope: 'https://a.atlassian.net', refreshToken: 'RJ' });
      assert.equal(out.connectionId, 'acct-1::jira::https://a.atlassian.net');
      assert.equal((await s2.ownerCredentialStore.getByConnection(out.connectionId)).refreshToken, 'RJ');
    });

    const LEGACY_CASES = [
      ['re-link of a legacy binding stays legacy', { existingBindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'old' } }] }, {}],
      ['Jira Basic stays legacy (token omitted, ruling 04461f8f)', { provider: 'jira', scope: 'https://a.atlassian.net', credentials: { token: 'api', email: 'e', tokenExpiresAt: Number.MAX_SAFE_INTEGER } }, { provider: 'jira', scope: 'https://a.atlassian.net' }],
      ['local never converts', { provider: 'local', scope: 'acme', credentials: { token: 'acme' } }, { provider: 'local', scope: 'acme' }],
      ['flag off (writesEnabled=false)', {}, { writesEnabled: false }],
      ['a GitHub credential with no installationId has no connection unit', { provider: 'github', scope: 'o/r', credentials: { token: 'g' } }, { provider: 'github', scope: 'o/r' }],
    ];
    for (const [name, aOpts, cOpts] of LEGACY_CASES) {
      test(`legacy: ${name} — and NO store call is made`, async () => {
        const s = stores();
        const log = [];
        const spiedStores = {
          connectionStore: spied(s.connectionStore, LINK_SPY, log),
          ownerCredentialStore: spied(s.ownerCredentialStore, OWNER_SPY, log),
        };
        const a = phaseA(aOpts);
        const before = JSON.stringify(a.session);
        const out = await convert(spiedStores, a, cOpts);
        assert.deepEqual(out.connectionBacked, false);
        assert.equal(out.error, null);
        assert.deepEqual(log, [], 'no store call on a non-converting arm');
        assert.equal(JSON.stringify(a.session), before, 'the session is byte-identical');
        assert.deepEqual(await dump(s), { connections: [], owner: [] });
      });
    }

    test('D11: the env flag reads off/false/0/no as off and anything else (incl. unset) as on', () => {
      for (const v of ['off', 'OFF', 'false', '0', 'no', ' off ']) assert.equal(connectionBackedWritesEnabled({ CONNECTION_BACKED_WRITES: v }), false, v);
      for (const v of [undefined, '', 'on', 'true', '1']) assert.equal(connectionBackedWritesEnabled({ CONNECTION_BACKED_WRITES: v }), true, String(v));
    });

    test('D11: CONNECTION_BACKED_WRITES=off in the environment keeps a new binding legacy', async () => {
      const s = stores();
      const a = phaseA();
      await withWrites('off', async () => {
        const out = await convertToConnectionBacked({ connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, session: a.session, accountId: 'acct-1', workspaceId: 'ws-1', provider: 'linear', scope: 'org-1', credentials: a.creds, refreshToken: 'R1', prior: a.prior });
        assert.equal(out.connectionBacked, false);
      });
      assert.deepEqual(await dump(s), { connections: [], owner: [] });
    });

    test('stores without the connection-backed methods (fakes) take the legacy fallback', async () => {
      const a = phaseA();
      const out = await convertToConnectionBacked({ connectionStore: { async put() { return true; } }, ownerCredentialStore: { async put() { return true; } }, session: a.session, accountId: 'acct-1', workspaceId: 'ws-1', provider: 'linear', scope: 'org-1', credentials: a.creds, refreshToken: 'R1', prior: a.prior });
      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, null);
    });
  });

  // -------------------------------------------------------------------------
  // D18 order and failure steps (non-staged seams)
  // -------------------------------------------------------------------------

  describe('D18 phase-B order and failure end states', () => {
    test('order: owner record first, then the atomic link (referent last), then the rewrite', async () => {
      const s = stores();
      const log = [];
      let bindingAtLink;
      const a = phaseA();
      const connectionStore = spied(s.connectionStore, LINK_SPY, log, {
        link: async (real, ...args) => { bindingAtLink = JSON.stringify(a.workspace.bindings); return real(...args); },
      });
      await convert({ connectionStore, ownerCredentialStore: spied(s.ownerCredentialStore, OWNER_SPY, log) }, a);
      assert.deepEqual(log, ['getByConnection', 'putByConnection', 'link']);
      assert.ok(!bindingAtLink.includes('connectionId'), 'the binding is rewritten only after link() succeeded');
    });

    test('step 1 fails: legacy fallback, the partial record is released, nothing else written', async () => {
      const s = stores();
      const log = [];
      const a = phaseA();
      const ownerCredentialStore = spied(s.ownerCredentialStore, OWNER_SPY, log, {
        putByConnection: async (real, ...args) => { await real(...args); return false; },
      });
      const out = await convert({ connectionStore: spied(s.connectionStore, LINK_SPY, log), ownerCredentialStore }, a);
      assert.equal(out.connectionBacked, false);
      assert.deepEqual(log, ['getByConnection', 'putByConnection', 'deleteByConnection']);
      assert.deepEqual(await dump(s), { connections: [], owner: [] });
      assert.ok(a.workspace.bindings[0].credentials, 'the binding stays legacy');
    });

    test('step 1 fails over a PRE-EXISTING connection-keyed record: never released (someone else\'s live record)', async () => {
      const s = stores();
      await s.ownerCredentialStore.putByConnection('acct-1::linear::org-1', { provider: 'linear', token: 'other', refreshToken: 'R-other' });
      const a = phaseA();
      const ownerCredentialStore = spied(s.ownerCredentialStore, OWNER_SPY, [], { putByConnection: async () => false });
      await convert({ connectionStore: s.connectionStore, ownerCredentialStore }, a);
      assert.equal((await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1')).refreshToken, 'R-other');
    });

    test('step 2 refused, re-read absent: copy released, legacy fallback, zero rows', async () => {
      const s = stores();
      const log = [];
      const a = phaseA();
      const connectionStore = spied(s.connectionStore, LINK_SPY, log, { link: async () => false });
      const out = await convert({ connectionStore, ownerCredentialStore: spied(s.ownerCredentialStore, OWNER_SPY, log) }, a);
      assert.equal(out.connectionBacked, false);
      assert.equal(out.error, null);
      assert.deepEqual(log, ['getByConnection', 'putByConnection', 'link', 'readConnectionOutcome', 'deleteByConnection'], 're-read BEFORE the release');
      assert.deepEqual(await dump(s), { connections: [], owner: [] });
    });

    test('step 2 ambiguous (false after a committed write): rolled forward, copy kept', async () => {
      const s = stores();
      const a = phaseA();
      const connectionStore = spied(s.connectionStore, LINK_SPY, [], { link: async (real, ...args) => { await real(...args); return false; } });
      const out = await convert({ connectionStore, ownerCredentialStore: s.ownerCredentialStore }, a);
      assert.equal(out.connectionBacked, true);
      assert.ok(await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1'));
      assert.equal(a.workspace.bindings[0].connectionId, 'acct-1::linear::org-1');
    });

    test('step 2 ambiguous with a pre-existing row that lacks OUR referent counts as absent', async () => {
      const s = stores();
      await s.connectionStore.put('acct-1', 'linear', 'org-1', { token: 'dual-write' }); // LIN-3127-born row
      const a = phaseA();
      const connectionStore = spied(s.connectionStore, LINK_SPY, [], { link: async () => false });
      const out = await convert({ connectionStore, ownerCredentialStore: s.ownerCredentialStore }, a);
      assert.equal(out.connectionBacked, false);
      assert.equal(await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1'), null, 'the copy was released');
    });

    test('step 2 ambiguous and the re-read fails (residual a): everything kept, retryable, binding legacy', async () => {
      const s = stores();
      const a = phaseA();
      const connectionStore = spied(s.connectionStore, LINK_SPY, [], {
        link: async () => false,
        readConnectionOutcome: async () => null,
      });
      const out = await convert({ connectionStore, ownerCredentialStore: s.ownerCredentialStore }, a);
      assert.deepEqual([out.connectionBacked, out.error], [false, 'retryable']);
      assert.ok(await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1'), 'the copy is kept (never deleted on an unknowable state)');
      assert.ok(a.workspace.bindings[0].credentials, 'the legacy fallback binding is kept');
    });
  });

  // -------------------------------------------------------------------------
  // Existing connection-backed bindings (re-auth): update, never downgrade
  // -------------------------------------------------------------------------

  describe('existing connection-backed binding (re-auth)', () => {
    async function seedExisting(s) {
      const a = phaseA();
      await convert(s, a);
      // A later request: the binding is connection-backed; phase A of the
      // re-auth is a keystone no-op over it.
      const creds = { token: 'tok-2', tokenExpiresAt: Date.now() + 7200_000 };
      const prior = bindingShapeAt(a.workspace, 'linear', 'org-1');
      linkProvider(a.workspace, 'linear', 'org-1', creds);
      return { ...a, creds, prior };
    }

    test('updates the Connection and the connection-keyed record; the binding shape is unchanged', async () => {
      const s = stores();
      const a = await seedExisting(s);
      assert.equal(a.prior, 'connection');
      const out = await convert(s, a, { refreshToken: 'R2' });
      assert.equal(out.connectionBacked, true);
      assert.deepEqual(a.workspace.bindings, [{ provider: 'linear', scope: 'org-1', connectionId: 'acct-1::linear::org-1' }]);
      assert.equal((await s.connectionStore.readConnectionById('acct-1::linear::org-1')).credentials.token, 'tok-2');
      assert.equal((await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1')).refreshToken, 'R2');
      assert.equal(await s.ownerCredentialStore.get('acct-1', 'acme', 'linear'), null, 'no legacy record written');
    });

    test('D11: the flag governs creation only — with it off an existing binding still updates', async () => {
      const s = stores();
      const a = await seedExisting(s);
      const out = await convert(s, a, { refreshToken: 'R2', writesEnabled: false });
      assert.equal(out.connectionBacked, true);
      assert.equal((await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1')).refreshToken, 'R2');
    });

    test('link() fails: retryable, never downgraded, the new record kept, no re-read/release', async () => {
      const s = stores();
      const a = await seedExisting(s);
      const log = [];
      const connectionStore = spied(s.connectionStore, LINK_SPY, log, { link: async () => false });
      const out = await convert({ connectionStore, ownerCredentialStore: spied(s.ownerCredentialStore, OWNER_SPY, log) }, a, { refreshToken: 'R2' });
      assert.deepEqual([out.connectionBacked, out.error], [true, 'retryable']);
      assert.ok(!log.includes('deleteByConnection') && !log.includes('readConnectionOutcome'));
      assert.equal((await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1')).refreshToken, 'R2');
      assert.deepEqual(a.workspace.bindings, [{ provider: 'linear', scope: 'org-1', connectionId: 'acct-1::linear::org-1' }]);
    });

    test('step 1 fails: retryable and the live record is NOT released', async () => {
      const s = stores();
      const a = await seedExisting(s);
      const ownerCredentialStore = spied(s.ownerCredentialStore, OWNER_SPY, [], { putByConnection: async () => false });
      const out = await convert({ connectionStore: s.connectionStore, ownerCredentialStore }, a, { refreshToken: 'R2' });
      assert.deepEqual([out.connectionBacked, out.error], [true, 'retryable']);
      assert.equal((await s.ownerCredentialStore.getByConnection('acct-1::linear::org-1')).refreshToken, 'R1');
    });
  });

  // -------------------------------------------------------------------------
  // T22 remainder: linkProvider marker hand-off
  // -------------------------------------------------------------------------

  test('T22: a legacy binding taking the scalar mirror clears a stale D2 marker (and the sanitizer then keeps its mirror)', () => {
    const ws = {
      id: 'ws', urlKey: 'u', provider: 'jira', activeBinding: { provider: 'jira', scope: 'https://b' },
      bindings: [{ provider: 'jira', scope: 'https://b', connectionId: 'a::jira::https://b' }],
    };
    linkProvider(ws, 'jira', 'https://c', { token: 'basic', email: 'e', tokenExpiresAt: Number.MAX_SAFE_INTEGER });
    assert.equal(ws.activeBinding, undefined);
    assert.equal(ws.accessToken, 'basic');
    const legacyOnly = { id: 'l', urlKey: 'l', bindings: [] };
    linkProvider(legacyOnly, 'linear', 'org', { token: 't' });
    assert.ok(!('activeBinding' in legacyOnly), 'identity on legacy-only data');
  });

  // -------------------------------------------------------------------------
  // Route level: Linear callback (auth.js ×2)
  // -------------------------------------------------------------------------

  function linearProvider({ org = { id: 'org-a', name: 'Org A', urlKey: 'org-a' }, viewer = { id: 'viewer-a' }, refresh = 'R-lin' } = {}) {
    return {
      name: 'linear',
      beginAuth: ({ state }) => `https://linear.app/oauth/authorize?state=${state}`,
      completeAuth: async () => ({ access_token: 'lin-access', refresh_token: refresh, expires_in: 86400 }),
      fetchOrganization: async () => org,
      fetchViewer: async () => viewer,
    };
  }

  async function linearLogin(s, session, provider = linearProvider()) {
    const router = createAuthRoutes({ provider, sessionStore: { cleanup: async () => {} }, ...s });
    const res = makeRes();
    session.oauthState = 'st';
    await getHandler(router, 'get', '/auth/callback')({ query: { code: 'c', state: 'st' }, session }, res);
    return res;
  }

  describe('route level — Linear (auth.js new-login + add-source)', () => {
    test('new-login: a new Linear binding is connection-backed; no legacy record', async () => {
      const s = stores();
      const session = makeSession({});
      const res = await linearLogin(s, session);
      assert.equal(res.redirectedTo, '/workspace/org-a/');
      const ws = session.workspaces[0];
      const connectionId = `${session.accountId}::linear::org-a`;
      assert.deepEqual(ws.bindings, [{ provider: 'linear', scope: 'org-a', connectionId }]);
      assert.deepEqual(ws.activeBinding, { provider: 'linear', scope: 'org-a' });
      assert.equal(ws.accessToken, undefined);
      assert.equal((await s.ownerCredentialStore.getByConnection(connectionId)).refreshToken, 'R-lin');
      assert.equal(await s.ownerCredentialStore.get(session.accountId, 'org-a', 'linear'), null);
      assert.deepEqual((await s.connectionStore.readConnectionById(connectionId)).referents, [{ urlKey: 'org-a', provider: 'linear', scope: 'org-a' }]);
    });

    test('flag-off parity: new-login writes exactly the legacy shape (binding credentials, legacy record, un-managed row)', async () => {
      const s = stores();
      const session = makeSession({});
      await withWrites('off', () => linearLogin(s, session));
      const ws = session.workspaces[0];
      assert.equal(ws.bindings[0].connectionId, undefined);
      assert.equal(ws.bindings[0].credentials.token, 'lin-access');
      assert.equal(ws.accessToken, 'lin-access');
      assert.equal((await s.ownerCredentialStore.get(session.accountId, 'org-a', 'linear')).refreshToken, 'R-lin');
      const rows = await s.connectionStore.collection.find({}).toArray();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].referents, undefined, 'the LIN-3127 dual-write row, not connection-managed');
      assert.equal(rows[0].origin, undefined);
    });

    test('legacy byte-identity: re-login over an existing LEGACY Linear workspace is identical with the flag on and off', async () => {
      async function run(flag) {
        const s = stores();
        const legacyWs = { id: 'org-a', name: 'Org A', urlKey: 'org-a', addedAt: 1, provider: 'linear', accessToken: 'old', credentials: { token: 'old' }, tokenExpiresAt: 1, bindings: [{ provider: 'linear', scope: 'org-a', credentials: { token: 'old', tokenExpiresAt: 1 } }] };
        const acct = await s.accountStore.createAccount();
        await s.accountStore.linkIdentity(acct._id, 'linear', 'viewer-a');
        const session = makeSession({ accountId: acct._id, workspaces: [legacyWs], activeWorkspaceId: 'org-a' });
        const realNow = Date.now;
        Date.now = () => 1_800_000_000_000; // both runs stamp the same expiry
        try { await withWrites(flag, () => linearLogin(s, session)); } finally { Date.now = realNow; }
        const { save, regenerate, ...plain } = session;
        return { session: stable(plain), owner: stable(await s.ownerCredentialStore.collection.find({}).toArray()), connections: stable(await s.connectionStore.collection.find({}).toArray()), acct: acct._id };
      }
      const on = await run(undefined);
      const off = await run('off');
      const norm = (r) => JSON.parse(JSON.stringify(r).split(r.acct).join('ACCT'));
      assert.deepEqual(norm(on), norm(off));
      assert.equal(norm(on).session.workspaces[0].bindings[0].connectionId, undefined, 'stays legacy');
      assert.ok(norm(on).owner.some(r => r._id === 'ACCT::org-a::linear' && r.refreshToken === 'R-lin'), 'legacy record written as today');
    });

    test('add-source: the second org is connection-backed on the live account', async () => {
      const s = stores();
      const session = makeSession({});
      await linearLogin(s, session);
      session.oauthIntent = { mode: 'add-source', workspaceUrlKey: 'org-a' };
      const res = await linearLogin(s, session, linearProvider({ org: { id: 'org-b', name: 'Org B', urlKey: 'org-b' }, viewer: { id: 'viewer-b' }, refresh: 'R-b' }));
      assert.equal(res.redirectedTo, '/workspace/org-a/settings?provider_ok=linear');
      const wsB = session.workspaces.find(w => w.id === 'org-b');
      assert.equal(wsB.bindings[0].connectionId, `${session.accountId}::linear::org-b`);
      assert.equal((await s.ownerCredentialStore.getByConnection(wsB.bindings[0].connectionId)).refreshToken, 'R-b');
    });

    test('T21: a refused (conflicted) add-source link persists NOTHING — no Connection, referent or owner row', async () => {
      const s = stores();
      const other = await s.accountStore.createAccount();
      await s.accountStore.linkIdentity(other._id, 'linear', 'viewer-b');
      const session = makeSession({});
      await linearLogin(s, session);
      const beforeRows = await dump(s);
      session.oauthIntent = { mode: 'add-source', workspaceUrlKey: 'org-a' };
      const res = await linearLogin(s, session, linearProvider({ org: { id: 'org-b', name: 'Org B', urlKey: 'org-b' }, viewer: { id: 'viewer-b' }, refresh: 'R-b' }));
      assert.notEqual(res.redirectedTo, '/workspace/org-a/settings?provider_ok=linear');
      assert.deepEqual(stable(await dump(s)), stable(beforeRows), 'the refused link wrote nothing durable');
      assert.ok(!session.workspaces.some(w => w.id === 'org-b'));
    });

    test('T22: re-login over an existing connection-backed Linear workspace keeps the shape and writes no legacy record', async () => {
      const s = stores();
      const session = makeSession({});
      await linearLogin(s, session);
      const connectionId = session.workspaces[0].bindings[0].connectionId;
      await linearLogin(s, session, linearProvider({ refresh: 'R-lin-2' }));
      assert.deepEqual(session.workspaces[0].bindings, [{ provider: 'linear', scope: 'org-a', connectionId }]);
      assert.equal(session.workspaces[0].accessToken, undefined, 'the incoming mirror is stripped');
      assert.equal((await s.ownerCredentialStore.getByConnection(connectionId)).refreshToken, 'R-lin-2');
      assert.equal(await s.ownerCredentialStore.get(session.accountId, 'org-a', 'linear'), null);
    });
  });

  // -------------------------------------------------------------------------
  // Route level: merge confirm
  // -------------------------------------------------------------------------

  describe('route level — merge confirm (account-merge.js)', () => {
    async function confirm(s, { provider, workspace, refreshToken, priorWorkspaces = [] }) {
      const canonical = await s.accountStore.createAccount();
      const merged = await s.accountStore.createAccount();
      const session = makeSession({
        accountId: canonical._id, identityAuthenticatedAt: Date.now(), workspaces: priorWorkspaces,
        pendingMerge: { canonicalAccountId: canonical._id, mergedAccountId: merged._id, workspace, refreshToken: refreshToken ?? null, mode: 'new', returnUrlKey: workspace.urlKey, provider, createdAt: Date.now() },
      });
      const res = makeRes();
      await getHandler(createAccountMergeRoutes(s), 'post', '/auth/merge/confirm')({ session }, res);
      return { session, res, canonical: canonical._id };
    }

    test('the arriving Linear binding becomes connection-backed on the CANONICAL account', async () => {
      const s = stores();
      const { session, canonical } = await confirm(s, { provider: 'linear', refreshToken: 'R-m', workspace: { id: 'org-m', urlKey: 'm', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org-m', credentials: { token: 'lin_tok' } }] } });
      const connectionId = `${canonical}::linear::org-m`;
      assert.deepEqual(session.workspaces[0].bindings, [{ provider: 'linear', scope: 'org-m', connectionId }]);
      assert.equal((await s.ownerCredentialStore.getByConnection(connectionId)).refreshToken, 'R-m');
      assert.equal(await s.ownerCredentialStore.get(canonical, 'm', 'linear'), null);
    });

    test('GitHub merge: connection-backed, no owner record (as today)', async () => {
      const s = stores();
      const { session, canonical } = await confirm(s, { provider: 'github', workspace: { id: 'github:1', urlKey: 'gh', provider: 'github', bindings: [{ provider: 'github', scope: 'o/r', credentials: { installationId: '5', token: 'ghs', tokenExpiresAt: 1 } }] } });
      assert.equal(session.workspaces[0].bindings[0].connectionId, `${canonical}::github::5`);
      assert.equal((await dump(s)).owner.length, 0);
    });

    test('a merge onto a session that already holds a LEGACY binding at that key stays legacy (legacy writes as today)', async () => {
      const s = stores();
      const prior = [{ id: 'org-m', urlKey: 'm', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org-m', credentials: { token: 'old' } }] }];
      const { session, canonical } = await confirm(s, { provider: 'linear', refreshToken: 'R-m', priorWorkspaces: prior, workspace: { id: 'org-m', urlKey: 'm', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org-m', credentials: { token: 'lin_tok' } }] } });
      assert.equal(session.workspaces[0].bindings[0].connectionId, undefined);
      assert.equal((await s.ownerCredentialStore.get(canonical, 'm', 'linear')).refreshToken, 'R-m');
    });

    test('flag-off parity: legacy writes, no connection-keyed record', async () => {
      const s = stores();
      const { session, canonical } = await withWrites('off', () => confirm(s, { provider: 'linear', refreshToken: 'R-m', workspace: { id: 'org-m', urlKey: 'm', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org-m', credentials: { token: 'lin_tok' } }] } }));
      assert.equal(session.workspaces[0].bindings[0].credentials.token, 'lin_tok');
      assert.equal((await s.ownerCredentialStore.get(canonical, 'm', 'linear')).refreshToken, 'R-m');
      assert.equal(await s.ownerCredentialStore.getByConnection(`${canonical}::linear::org-m`), null);
    });
  });

  // -------------------------------------------------------------------------
  // Source pins: the 10 seams
  // -------------------------------------------------------------------------

  describe('source pins — the 10 writeConnection seams', () => {
    const SEAMS = {
      'routes/auth.js': 2,
      'lib/github-install-flow.js': 3,
      'routes/jira-auth.js': 4,
      'routes/account-merge.js': 1,
    };
    const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

    test('each seam file keeps its writeConnection calls, every one guarded as the legacy fallback', () => {
      let total = 0;
      for (const [rel, n] of Object.entries(SEAMS)) {
        const src = read(rel);
        const calls = src.split('\n').filter(l => /await writeConnection\(/.test(l));
        total += calls.length;
        assert.equal(calls.length, n, rel);
        const guarded = calls.filter(l => /!conversion\.connectionBacked/.test(l)).length;
        const blockGuards = (src.match(/if \(!conversion\.connectionBacked\) \{/g) || []).length;
        assert.ok(guarded + blockGuards >= n, `${rel}: every legacy write sits behind the conversion result`);
      }
      assert.equal(total, 10);
    });

    test('in every seam function the conversion runs after the establishAccount refusal return', () => {
      for (const rel of Object.keys(SEAMS)) {
        const src = read(rel);
        let idx = src.indexOf('convertToConnectionBacked({');
        let seen = 0;
        while (idx >= 0) {
          seen++;
          const head = src.slice(0, idx);
          const refusal = rel === 'routes/account-merge.js'
            ? head.lastIndexOf('Workspace Limit Reached')
            : Math.max(head.lastIndexOf('if (!established.ok)'), head.lastIndexOf('const established = await establishAccount('));
          assert.ok(refusal >= 0, `${rel}: a conversion with no refusal before it`);
          idx = src.indexOf('convertToConnectionBacked({', idx + 1);
        }
        assert.ok(seen >= 1, rel);
      }
      // Jira's new-login seams share one `convert` helper; both call sites
      // follow their own establishAccount refusal.
      const jira = read('routes/jira-auth.js');
      for (const call of ['await convert(established.accountId, existing', 'await convert(established.accountId, workspace']) {
        const at = jira.indexOf(call);
        assert.ok(at > 0 && jira.lastIndexOf('if (!established.ok)', at) > 0, call);
      }
    });

    test('F1: connection-credential.js importers are exactly the server, the session store and the four seam modules', () => {
      const guard = read('tests/unit/connection-access-guard.test.js');
      for (const rel of ['routes/auth.js', 'lib/github-install-flow.js', 'routes/jira-auth.js', 'routes/account-merge.js']) {
        assert.ok(guard.includes(`'${rel}'`), rel);
        assert.match(read(rel), /from '\.\.?\/(lib\/)?connection-credential\.js'/, rel);
      }
      // The 4 routes/test.js fixture writers stay legacy until checkpoint F.
      assert.doesNotMatch(read('routes/test.js'), /convertToConnectionBacked/);
    });
  });
});
