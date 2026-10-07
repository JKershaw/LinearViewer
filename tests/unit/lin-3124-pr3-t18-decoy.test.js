/**
 * LIN-3124 PR3 checkpoint F — T18: the session-credential rule's BEHAVIOURAL
 * half (D6). The raw session carries a DECOY credential (a stray scalar mirror
 * and a stray `credentials` bag on the connection-backed binding) while the
 * Connection holds the REAL one; every lane that can serve a credential must
 * return the real one, and an UNHYDRATED connection-backed read must fail
 * closed rather than fall back to the decoy.
 *
 * The lane set is `DECOY_LANES` (tests/fixtures/connection-access-guards.js),
 * the same registry T4 pins statically; the coverage meta-check below fails if
 * a registered lane has no probe here (or a probe names an unregistered lane).
 *
 * Also: non-persistence (the sanitizer strips a stray credential on the
 * session-store write path) and pending pre-establish copies are gone after a
 * completed link.
 *
 * Run with: node --test tests/unit/lin-3124-pr3-t18-decoy.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { DECOY_LANES } from '../fixtures/connection-access-guards.js';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { MongoSessionStore } from '../../lib/session-store.js';
import {
  convertToConnectionBacked, hydrateSession, createConnectionAccess,
} from '../../lib/connection-credential.js';
import { activeBindingIsConnectionBacked, readWorkspaceCredential } from '../../lib/connection-binding.js';
import {
  linkProvider, getWorkspaceCallScope, getBindingCallScope, resolveIssueBinding, getWorkspaceToken,
  getWorkspaceByUrlKey, normalizeProvider, getWorkspaceMirrorToken, getWorkspaceTokenExpiry,
} from '../../lib/workspace.js';
import {
  UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, selectOwnerSessionRow,
  classifyWorkspaceFailure, describeWorkspaceResolution,
} from '../../lib/workspace-token-resolver.js';
import { CREDENTIAL_SOURCES, fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { CREDENTIAL_LIFECYCLE_EVENT_KINDS } from '../../lib/credential-lifecycle-events.js';
import { workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';
import { createGitHubAuthRoutes } from '../../routes/github-auth.js';
import { AccountStore } from '../../lib/account-store.js';
import { AccountWorkspaceStore } from '../../lib/account-workspace-store.js';

const SERVER_SRC = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const ACCT = 'acct-decoy';
const REAL_LINEAR = 'REAL-linear-token';
const REAL_GITHUB = 'REAL-github-token';
const DECOY = 'DECOY-session-token';

/** A top-level `[async ]function NAME(` slice of server.js (brace-matched to the top-level close). */
function sliceServerFunction(name) {
  const asyncStart = SERVER_SRC.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : SERVER_SRC.indexOf(`\nfunction ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found in server.js`);
  const end = SERVER_SRC.indexOf('\n}', start);
  return SERVER_SRC.slice(start, end + 2);
}

const tokenOf = (scope) => (scope && typeof scope === 'object' ? (scope.token ?? scope.accessToken) : scope);

describe('LIN-3124 T18 — decoy-token across every lane', () => {
  let dir;
  let client;
  let n = 0;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin3124-t18-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A connection-backed workspace (Linear active, GitHub non-active), produced
   * by the real converter, then POISONED with decoys the way a leak would: a
   * scalar mirror and a stray `credentials` bag on each connection-backed
   * binding. The Connections hold the real, live credentials.
   */
  async function world() {
    const db = client.db(`t18_${n++}`);
    const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
    const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
    const live = Date.now() + 3600_000;
    const session = { accountId: ACCT, workspaces: [{ id: 'ws-1', urlKey: 'acme', bindings: [] }] };
    const ws = session.workspaces[0];
    for (const [provider, scope, credentials, refreshToken] of [
      ['linear', 'org-1', { token: REAL_LINEAR, tokenExpiresAt: live }, 'R-real'],
      ['github', 'o/r', { installationId: '9', token: REAL_GITHUB, tokenExpiresAt: live }, undefined],
    ]) {
      linkProvider(ws, provider, scope, credentials);
      const out = await convertToConnectionBacked({ connectionStore, ownerCredentialStore, session, accountId: ACCT, workspaceId: 'ws-1', provider, scope, credentials, refreshToken, prior: 'none', writesEnabled: true });
      assert.equal(out.connectionBacked, true);
    }
    // A fresh request: a round-tripped copy of the session (no side-table
    // entries), then the decoys.
    const poisoned = structuredClone(session);
    const pw = poisoned.workspaces[0];
    pw.accessToken = DECOY;
    pw.credentials = { token: DECOY };
    pw.tokenExpiresAt = live + 999_000; // a decoy expiry, distinct from the Connection's
    for (const b of pw.bindings) b.credentials = { token: DECOY, installationId: '9', tokenExpiresAt: live };
    return { db, connectionStore, ownerCredentialStore, session: poisoned, realExpiry: live };
  }

  const hydrate = (w) => hydrateSession(w.session, { connectionStore: w.connectionStore });

  /** One behavioural probe per registered lane: returns the token that lane serves. */
  const PROBES = {
    'browser (active binding)': async (w) => tokenOf(getWorkspaceCallScope(w.session.workspaces[0])),
    'per-binding: dashboard fan-out': async (w) => tokenOf(getBindingCallScope(w.session.workspaces[0].bindings.find(b => b.provider === 'github'))),
    'per-binding: resolveIssueBinding': async (w) => tokenOf(resolveIssueBinding(w.session.workspaces[0], 'github').callScope),
    'per-binding: settings probe (3-arg getWorkspaceToken)': async (w) => getWorkspaceToken(w.session.workspaces[0], 'linear', 'org-1'),
    'raw mirror (audit egress / image relay)': async (w) => getWorkspaceMirrorToken(w.session.workspaces[0]),
    // The expiry lane serves an expiry, not a token: map it onto the same
    // REAL / DECOY vocabulary so one assertion covers every lane.
    'expiry (ensureValidToken proactive refresh)': async (w) => {
      const expiry = getWorkspaceTokenExpiry(w.session.workspaces[0]);
      if (expiry === w.realExpiry) return REAL_LINEAR;
      return expiry === w.session.workspaces[0].tokenExpiresAt ? DECOY : expiry;
    },
    'owner-scoped headless': async (w) => {
      // The REAL resolveWorkspaceAccess body, whose connection-first arm is the
      // REAL createConnectionAccess over the real stores; the session rows it
      // scans carry the decoys.
      const connectionAccess = createConnectionAccess({
        connectionStore: w.connectionStore, ownerCredentialStore: w.ownerCredentialStore,
        refreshConnection: async () => null, selectOwnerSessionRow, normalizeProvider, fingerprintCredential,
        gate: { shouldAttempt: () => false }, bufferMs: TOKEN_REFRESH_BUFFER_MS,
      });
      const context = vm.createContext({
        UNSCOPED, TOKEN_REFRESH_BUFFER_MS, selectOwnerWorkspaceToken, classifyWorkspaceFailure, describeWorkspaceResolution,
        CREDENTIAL_SOURCES, fingerprintCredential, CREDENTIAL_LIFECYCLE_EVENT_KINDS, workspaceTokenCacheKey,
        // LIN-3241 (B): the extracted body's cache-bypass decision; these probes
        // call the resolver with no options, so the real predicate returns false.
        accountStore: { resolveCanonicalAccountId: async (id) => id },
        sessionsCollection: { find: () => ({ toArray: async () => [{ _id: 'sid', session: w.session }] }) },
        workspaceTokenCache: { get: () => undefined, set: () => true },
        ownerCredentialStore: { get: async () => null },
        refreshOnResolveGate: { shouldAttempt: () => false },
        credentialLifecycleEventStore: { recordEvent: async () => {} },
        attemptSuspectCredentialRefresh: async () => null,
        connectionAccess,
        console: { log() {}, warn() {}, error() {} },
        process: { env: {} },
      });
      const fn = vm.runInContext(`${sliceServerFunction('resolveWorkspaceAccess')}\nresolveWorkspaceAccess`, context);
      return (await fn('acme', ACCT)).token;
    },
    'owner-blind': async (w) => {
      const context = vm.createContext({
        getWorkspaceByUrlKey, activeBindingIsConnectionBacked, readWorkspaceCredential, TOKEN_REFRESH_BUFFER_MS, Date,
        // The owner-blind scan (UNSCOPED) would see only the session rows' decoys.
        resolveWorkspaceAccess: async () => ({ token: DECOY }),
      });
      const fn = vm.runInContext(`${sliceServerFunction('getWorkspaceAccessToken')}\ngetWorkspaceAccessToken`, context);
      return fn('acme', w.session);
    },
  };

  test('coverage meta-check: exactly one probe per registered DECOY_LANES lane', () => {
    assert.deepEqual(Object.keys(PROBES).sort(), DECOY_LANES.map(l => l.lane).sort());
  });

  for (const { lane } of DECOY_LANES) {
    test(`hydrated: "${lane}" serves the Connection's credential, never the session decoy`, async () => {
      const w = await world();
      await hydrate(w);
      const served = await PROBES[lane](w);
      assert.notEqual(served, DECOY, 'the decoy leaked');
      assert.ok([REAL_LINEAR, REAL_GITHUB].includes(served), `${lane} served ${served}`);
    });
  }

  test('UNHYDRATED: every session-side lane fails closed — no decoy, no fallback', async () => {
    const w = await world();
    for (const lane of ['browser (active binding)', 'per-binding: dashboard fan-out', 'per-binding: resolveIssueBinding', 'per-binding: settings probe (3-arg getWorkspaceToken)', 'owner-blind', 'raw mirror (audit egress / image relay)', 'expiry (ensureValidToken proactive refresh)']) {
      const served = await PROBES[lane](w);
      assert.notEqual(served, DECOY, `${lane} fell back to the decoy`);
      assert.ok(served === undefined || served === null, `${lane} must fail closed, served ${served}`);
    }
    // The headless lane reads the Connection itself, so it is REAL even here.
    assert.equal(await PROBES['owner-scoped headless'](w), REAL_LINEAR);
  });

  test('non-persistence: the session-store write path strips a stray credential from a connection-backed workspace', async () => {
    const w = await world();
    const collection = w.db.collection('sessions');
    const store = new MongoSessionStore({ collection });
    await new Promise((resolve, reject) => store.set('sid-1', structuredClone(w.session), (err) => (err ? reject(err) : resolve())));
    const row = await collection.findOne({ _id: 'sid-1' });
    assert.ok(!JSON.stringify(row).includes(DECOY), 'no stray credential persisted');
    assert.ok(!JSON.stringify(row).includes('REAL-'), 'and no real one either');
    assert.equal(row.session.workspaces[0].bindings.every(b => typeof b.connectionId === 'string' && !('credentials' in b)), true);
    // server.js's TTL-preserving persist path runs the same sanitizer.
    const persistRow = sliceServerFunction('persistSessionRow');
    assert.match(persistRow, /sanitizeSessionForPersist\(/);
  });

  test('pending pre-establish copies are gone after a completed link, and no credential byte is persisted', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const saved = { ...process.env };
    Object.assign(process.env, { GITHUB_CLIENT_ID: 'c', GITHUB_CLIENT_SECRET: 's', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }), GITHUB_APP_SLUG: 'a' });
    try {
      const db = client.db(`t18_pending_${n++}`);
      const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
      const router = createGitHubAuthRoutes({
        provider: { name: 'github' },
        accountStore: new AccountStore({ collection: db.collection('accounts') }),
        accountWorkspaceStore: new AccountWorkspaceStore({ collection: db.collection('account-workspaces') }),
        connectionStore,
      });
      const layer = router.stack.find(l => l.route?.path === '/auth/github/link' && l.route.methods.post);
      const link = layer.route.stack[layer.route.stack.length - 1].handle;
      const session = {
        workspaces: [], githubHumanId: 'h',
        githubPending: { mode: 'new', fresh: true, installationId: '7', token: 'ghs_PENDING_COPY', login: 'o', userId: '1', tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString() },
        save(cb) { cb && cb(); }, regenerate(cb) { for (const k of Object.keys(this)) if (typeof this[k] !== 'function') delete this[k]; cb(); },
      };
      const res = { status() { return this; }, send() { return this; }, redirect(u) { this.to = u; return this; } };
      await link({ body: { repo: 'o/r' }, session }, res);
      assert.match(res.to, /^\/workspace\//);
      assert.equal(session.githubPending, undefined, 'the pending copy is consumed');
      const store = new MongoSessionStore({ collection: db.collection('sessions') });
      const { save, regenerate, ...data } = session;
      await new Promise((resolve, reject) => store.set('sid', data, (err) => (err ? reject(err) : resolve())));
      const persisted = JSON.stringify(await db.collection('sessions').findOne({ _id: 'sid' }));
      assert.ok(!persisted.includes('ghs_PENDING_COPY'), 'no credential byte in the persisted session');
      assert.equal((await connectionStore.readConnectionById(`${session.accountId}::github::7`)).credentials.token, 'ghs_PENDING_COPY', 'it lives on the Connection');
    } finally {
      for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_SLUG']) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  });
});
