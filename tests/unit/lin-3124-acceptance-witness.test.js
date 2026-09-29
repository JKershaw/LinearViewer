/**
 * LIN-3124 — T15, the ticket's acceptance witness (fails before, passes after),
 * on the v1 slice (a fresh account; legacy operator records are LIN-2150).
 *
 *   Seed a fresh account with ONE GitHub connection and TWO workspaces bound to
 *   it (repoA, repoB). Expire the connection's credential and resolve both
 *   workspaces concurrently. Assert:
 *     1. exactly one mintInstallationToken / refresh, single-flighted on the connection
 *     2. both workspaces' getWorkspaceCallScope return the new token
 *     3. exactly 1 durable owner-credential record, keyed on the connection
 *     4. neither persisted binding has a `credentials` key
 *     5. the invariant sweep reports no orphans
 *
 * Everything real except the network: the two workspaces are created by the
 * REAL GitHub install-flow route (two fresh-container links on one
 * installation), the resolve is the REAL connection-first arm server.js wires
 * (`createConnectionAccess` + the one `createConnectionRefresher`), the mint is
 * the REAL `GitHubProvider.refreshCredential` → `mintInstallationToken` with only
 * the HTTP `fetchImpl` stubbed and counted, and the sweep is the REAL
 * `runCredentialInvariantSweep` with the seam's connection-data loader.
 *
 * Flags recorded in the plan (§9); the ticket's criteria are NOT edited:
 *   - Flag A (assertion 3): GitHub owns zero `owner-credentials` records before
 *     and after, so "1 durable record keyed on the connection" is read as:
 *     exactly ONE `connections` record with `referents = [repoA, repoB]` and
 *     ZERO owner-credential records for the GitHub connection. The "one durable
 *     owner record per connection" property itself is checked at unit level on
 *     a refresh-token connection (T9, lin-3124-pr2-connection-credential).
 *   - Flag B (assertion 5): "orphans" is not sweep vocabulary; read as zero
 *     violations and zero `connection_unreferenced` for repoA/repoB.
 *
 * "Fails before" is shown on THIS tree by the legacy arm: the identical seam
 * flow with CONNECTION_BACKED_WRITES=off is the pre-cutover code path (D11:
 * flag-off is the D2a fallback, i.e. the unchanged legacy writes), and on it
 * the witness fails exactly as the ticket predicts — two mints (the refresh is
 * keyed per urlKey), credentials on both bindings, and the sweep reporting
 * both GitHub edges `missing`.
 *
 * Run with: node --test tests/unit/lin-3124-acceptance-witness.test.js
 */
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { GitHubProvider } from '../../lib/providers/github/index.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import {
  createConnectionRefresher,
  createConnectionAccess,
  createSweepConnectionDataLoader,
  hydrateSession,
  sanitizeSessionForPersist,
} from '../../lib/connection-credential.js';
import { selectOwnerSessionRow, TOKEN_REFRESH_BUFFER_MS } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken } from '../../lib/workspace-token-refresh.js';
import { runCredentialInvariantSweep } from '../../lib/credential-invariant-sweep.js';
import { createRefreshOnResolveGate } from '../../lib/refresh-on-resolve-gate.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { getWorkspaceCallScope, normalizeProvider } from '../../lib/workspace.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const ENV = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG'];
const INSTALLATION = '99';
const REPO_A = 'octo/repo-a';
const REPO_B = 'octo/repo-b';
const NEW_TOKEN = 'ghs_minted_after_expiry';

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

function makeSession() {
  return {
    workspaces: [],
    save(cb) { if (cb) cb(); },
    regenerate(cb) { for (const k of Object.keys(this)) if (typeof this[k] !== 'function') delete this[k]; cb(); },
  };
}

/** The GitHub App's installation-token endpoint, stubbed and counted (the only network). */
function mintEndpoint() {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method });
    await new Promise(r => setTimeout(r, 15)); // hold the mint open so the two resolves overlap
    const body = JSON.stringify({ token: NEW_TOKEN, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    return { ok: true, status: 201, statusText: 'Created', text: async () => body };
  };
  return { calls, fetchImpl };
}

describe('LIN-3124 T15 — acceptance witness: one GitHub connection, two workspaces', () => {
  let dir;
  let client;
  let n = 0;
  let savedEnv;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin3124-witness-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
    Object.assign(process.env, { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: RSA_PEM, GITHUB_APP_SLUG: 'app' });
  });
  afterEach(() => {
    for (const k of ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    delete process.env.CONNECTION_BACKED_WRITES;
  });

  /**
   * A fresh account links repoA then repoB as two fresh GitHub workspaces on ONE
   * installation, through the real route; the session is then persisted the way
   * the session store persists it (sanitized) and the credential expired.
   */
  async function seedWitness() {
    const db = client.db(`witness_${n++}`);
    const stores = {
      db,
      accountStore: new AccountStore({ collection: db.collection('accounts') }),
      accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
      connectionStore: new ConnectionStore({ collection: db.collection('connections') }),
      ownerCredentialStore: new OwnerCredentialStore({ collection: db.collection('owner-credentials') }),
      sessions: db.collection('sessions'),
    };
    const provider = {
      name: 'github',
      completeInstallation: async (id) => ({ token: 'ghs_initial', login: 'octo', userId: '42', installationId: String(id), tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    };
    const link = getHandler(createGitHubAuthRoutes({ provider, accountStore: stores.accountStore, accountWorkspaceStore: stores.accountWorkspaceStore, connectionStore: stores.connectionStore }), 'post', '/auth/github/link');
    const session = makeSession();
    for (const repo of [REPO_A, REPO_B]) {
      session.githubHumanId = 'human-42';
      session.githubPending = { mode: 'new', fresh: true, installationId: INSTALLATION, token: 'ghs_initial', login: 'octo', userId: '42', tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString() };
      const res = makeRes();
      await link({ body: { repo }, session }, res);
      assert.match(res.redirectedTo || '', /^\/workspace\//, res.body || '');
    }
    assert.equal(session.workspaces.length, 2, 'two workspaces');

    // Expire the credential: the Connection row (connection-backed) and, for the
    // legacy arm, the session-carried copies.
    const past = Date.now() - 60_000;
    await stores.db.collection('connections').updateMany({}, { $set: { 'credentials.tokenExpiresAt': past } });
    for (const ws of session.workspaces) {
      if (ws.tokenExpiresAt !== undefined) ws.tokenExpiresAt = past;
      for (const b of ws.bindings) if (b.credentials) b.credentials.tokenExpiresAt = past;
    }
    const { save, regenerate, ...data } = session;
    const persisted = sanitizeSessionForPersist(structuredClone(data));
    await stores.sessions.insertOne({ _id: 'sid-owner', session: persisted, expires: new Date(Date.now() + 86400_000) });
    return { ...stores, accountId: session.accountId, urlKeys: session.workspaces.map(w => w.urlKey) };
  }

  async function sweep(s) {
    return runCredentialInvariantSweep({
      accountWorkspaceStore: s.accountWorkspaceStore, accountStore: s.accountStore, ownerCredentialStore: s.ownerCredentialStore,
      lifecycleEventStore: { async recordEvent() {} }, sessionsCollection: s.sessions,
      loadConnectionData: createSweepConnectionDataLoader({ connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore }),
      now: Date.now(),
    });
  }

  test('AFTER (the cutover): 1 mint single-flighted on the connection, both call scopes carry it, 1 connection record, no binding credentials, sweep clean', async () => {
    const s = await seedWitness();
    const mint = mintEndpoint();
    const refreshConnection = createConnectionRefresher({
      connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore,
      resolveProvider: () => new GitHubProvider(), fetchImpl: mint.fetchImpl,
    });
    const access = createConnectionAccess({
      connectionStore: s.connectionStore, ownerCredentialStore: s.ownerCredentialStore, refreshConnection,
      resolveCanonicalAccountId: (id) => s.accountStore.resolveCanonicalAccountId(id),
      selectOwnerSessionRow, normalizeProvider, fingerprintCredential, gate: createRefreshOnResolveGate(),
      bufferMs: TOKEN_REFRESH_BUFFER_MS,
    });
    const sessions = await s.sessions.find({}).toArray();

    // Resolve both workspaces concurrently through the connection-first arm.
    const [a, b] = await Promise.all(s.urlKeys.map(urlKey => access.resolveConnectionBackedAccess({ urlKey, ownerAccountId: s.accountId, sessions })));

    // 1. exactly one mint, single-flighted on the connection.
    assert.equal(mint.calls.length, 1, 'exactly one mintInstallationToken');
    assert.match(mint.calls[0].url, new RegExp(`/app/installations/${INSTALLATION}/access_tokens$`));
    assert.equal(a.result.token, NEW_TOKEN);
    assert.equal(b.result.token, NEW_TOKEN);

    // 2. both workspaces' getWorkspaceCallScope return the new token (the next
    //    request's hydration reads the Connection row).
    const [{ session: stored }] = await s.sessions.find({}).toArray();
    const liveSession = structuredClone(stored);
    await hydrateSession(liveSession, { connectionStore: s.connectionStore, resolveCanonicalAccountId: (id) => s.accountStore.resolveCanonicalAccountId(id) });
    for (const ws of liveSession.workspaces) {
      const scope = getWorkspaceCallScope(ws);
      assert.equal(typeof scope === 'object' ? scope.token : scope, NEW_TOKEN, `${ws.urlKey} call scope`);
    }

    // 3 (Flag A). exactly one connections record, referenced by both; zero
    //    owner-credential records for the GitHub connection.
    const rows = await s.db.collection('connections').find({}).toArray();
    assert.equal(rows.length, 1, 'one Connection');
    assert.equal(rows[0]._id, `${s.accountId}::github::${INSTALLATION}`);
    assert.deepEqual(rows[0].referents.map(r => r.scope).sort(), [REPO_A, REPO_B]);
    assert.equal(rows[0].credentials.token, NEW_TOKEN, 'the rotated credential lives on the Connection');
    assert.equal(await s.db.collection('owner-credentials').countDocuments({}), 0);

    // 4. neither PERSISTED binding has a `credentials` key.
    for (const ws of stored.workspaces) {
      for (const binding of ws.bindings) {
        assert.ok(!('credentials' in binding), `${ws.urlKey}: no credentials on the persisted binding`);
        assert.equal(binding.connectionId, rows[0]._id);
      }
      assert.ok(!('accessToken' in ws) && !('credentials' in ws), 'and no scalar mirror');
    }

    // 5 (Flag B). the sweep: zero violations, zero connection_unreferenced.
    const result = await sweep(s);
    assert.equal(result.checked, 2);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.connectionUnreferenced, []);
  });

  test('BEFORE (the legacy path, CONNECTION_BACKED_WRITES=off): the witness fails as the ticket predicts', async () => {
    process.env.CONNECTION_BACKED_WRITES = 'off';
    const s = await seedWitness();
    const mint = mintEndpoint();
    const sessions = await s.sessions.find({}).toArray();

    // The pre-cutover headless lane refreshes per urlKey: two mints.
    await Promise.all(s.urlKeys.map(urlKey => refreshOwnerWorkspaceToken({
      sessions, urlKey, ownerAccountId: s.accountId, persistSession: async () => {},
      resolveProvider: () => new GitHubProvider(), store: s.ownerCredentialStore, fetchImpl: mint.fetchImpl,
    })));
    assert.equal(mint.calls.length, 2, 'fails assertion 1: two mints, keyed per urlKey');

    // Fails assertion 4: both persisted bindings carry credentials.
    for (const ws of sessions[0].session.workspaces) assert.ok(ws.bindings.every(b => 'credentials' in b));
    // Fails assertion 3's reading: no connection-managed record (LIN-3127 rows, no referents).
    const rows = await s.db.collection('connections').find({}).toArray();
    assert.ok(rows.every(r => r.referents === undefined));
    // Fails assertion 5 (Flag B): both GitHub edges report `missing`.
    const result = await sweep(s);
    assert.deepEqual(result.violations.map(v => v.reason), ['missing', 'missing']);
  });
});
