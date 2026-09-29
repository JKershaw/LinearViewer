/**
 * LIN-3124 PR3 — suspect/refresh entrant connection arms (D7, N3 authorize-first).
 * Dark: no connection-backed binding exists until the write flip.
 *
 * Run: node --test tests/unit/lin-3124-pr3-suspect-connection.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { ConnectionStore } from '../../lib/connection-store.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { attemptSuspectCredentialRefresh } from '../../lib/suspect-credential-refresh.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const FUTURE = Date.now() + 3_600_000;
const PAST = Date.now() - 1_000;
const conn = (id, provider, unitId, credentials) => ({ _id: id, accountId: id.split('::')[0], provider, unitId, credentials, referents: [] });

function accessWith(overrides = {}) {
  const calls = { refresh: [] };
  const access = createConnectionAccess({
    connectionStore: {
      readConnectionsByReferent: async () => overrides.connections ?? [],
      readConnectionById: async (id) => (overrides.byId ?? {})[id] ?? null,
    },
    ownerCredentialStore: { getByConnection: async (id) => (overrides.records ?? {})[id] ?? null },
    refreshConnection: async (id, owner) => { calls.refresh.push({ id, owner }); return overrides.refreshed ?? null; },
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: 5 * 60 * 1000,
    now: () => Date.now(),
  });
  return { access, calls };
}

describe('LIN-3124 PR3 — connection suspect/refresh arms', () => {
  test('adoptConnectionCredentialForUrlKey adopts a differing Linear connection record', async () => {
    const { access } = accessWith({
      connections: [conn('acct::linear::org', 'linear', 'org', { token: 'old', tokenExpiresAt: PAST })],
      records: { 'acct::linear::org': { token: 'conn-new', tokenExpiresAt: FUTURE } },
    });
    const out = await access.adoptConnectionCredentialForUrlKey({ urlKey: 'u', ownerAccountId: 'acct', provider: 'linear', fingerprint: fingerprintCredential('stale') });
    assert.strictEqual(out.token, 'conn-new');
  });

  test('adoptConnectionCredentialForUrlKey never adopts the identical fingerprint or a non-Linear provider', async () => {
    const { access } = accessWith({
      connections: [conn('acct::linear::org', 'linear', 'org', { token: 'old', tokenExpiresAt: PAST })],
      records: { 'acct::linear::org': { token: 'same', tokenExpiresAt: FUTURE } },
    });
    assert.strictEqual(await access.adoptConnectionCredentialForUrlKey({ urlKey: 'u', ownerAccountId: 'acct', provider: 'linear', fingerprint: fingerprintCredential('same') }), null);
    assert.strictEqual(await access.adoptConnectionCredentialForUrlKey({ urlKey: 'u', ownerAccountId: 'acct', provider: 'jira', fingerprint: 'f' }), null);
  });

  test('refreshConnectionForSuspect authorizes, refreshes, and returns a scope-bearing result', async () => {
    const { access, calls } = accessWith({
      connections: [conn('acct::linear::org', 'linear', 'org', { token: 'old', tokenExpiresAt: PAST })],
      refreshed: { token: 'new', expiresAt: FUTURE, provider: 'linear' },
    });
    const out = await access.refreshConnectionForSuspect({ urlKey: 'u', ownerAccountId: 'acct', provider: 'linear' });
    assert.deepStrictEqual(calls.refresh, [{ id: 'acct::linear::org', owner: 'acct' }]);
    assert.strictEqual(out.token, 'new');
    assert.strictEqual(out.scope, 'new');
    assert.ok(!JSON.stringify(out).includes('acct::linear::org'));
  });

  test('refreshConnectionForSuspect never touches another account connection', async () => {
    const { access, calls } = accessWith({ connections: [conn('other::linear::org', 'linear', 'org', { token: 't', tokenExpiresAt: FUTURE })] });
    assert.strictEqual(await access.refreshConnectionForSuspect({ urlKey: 'u', ownerAccountId: 'acct', provider: 'linear' }), null);
    assert.deepStrictEqual(calls.refresh, []);
  });
});

describe('LIN-3124 PR3 — attemptSuspectCredentialRefresh uses the connection arms', () => {
  const registry = { isSuspect: () => true, shouldAttemptRefresh: () => true };

  test('remedy 1 prefers the injected connection adopt (no legacy store read)', async () => {
    let legacyRead = 0;
    const out = await attemptSuspectCredentialRefresh({
      fingerprint: 'fp', urlKey: 'u', ownerAccountId: 'acct', provider: 'linear',
      loadSessions: async () => [],
      registry,
      store: { get: async () => { legacyRead++; return null; } },
      lifecycleEventStore: { recordEvent: async () => {} },
      refreshAccessToken: async () => ({}),
      persistSession: async () => {},
      resolveProvider: () => ({}),
      adoptConnectionCredential: async () => ({ token: 'conn-new', expiresAt: FUTURE, provider: 'linear', credentialFingerprint: 'fp2' }),
    });
    assert.strictEqual(out.token, 'conn-new');
    assert.strictEqual(legacyRead, 0, 'the connection adopt short-circuits the legacy read');
  });

  test('remedy 2 prefers the injected connection refresh over refreshOwnerWorkspaceToken', async () => {
    const out = await attemptSuspectCredentialRefresh({
      fingerprint: 'fp', urlKey: 'u', ownerAccountId: 'acct', provider: 'linear',
      loadSessions: async () => [],
      registry,
      store: { get: async () => null },
      lifecycleEventStore: { recordEvent: async () => {} },
      refreshAccessToken: async () => ({}),
      persistSession: async () => {},
      resolveProvider: () => ({}),
      adoptConnectionCredential: async () => null,
      refreshConnection: async () => ({ token: 'conn-refreshed', expiresAt: FUTURE, provider: 'linear', scope: 'conn-refreshed', credentialFingerprint: fingerprintCredential('conn-refreshed') }),
    });
    assert.strictEqual(out.token, 'conn-refreshed');
  });

  test('without the connection arms the legacy path is byte-identical', async () => {
    const out = await attemptSuspectCredentialRefresh({
      fingerprint: 'fp', urlKey: 'u', ownerAccountId: 'acct', provider: 'linear',
      loadSessions: async () => [],
      registry,
      store: { get: async () => ({ token: 'durable-new', tokenExpiresAt: FUTURE, provider: 'linear' }) },
      lifecycleEventStore: { recordEvent: async () => {} },
    });
    assert.strictEqual(out.token, 'durable-new');
  });
});
// ---------------------------------------------------------------------------
// LIN-3124 PR3 review blocker 8 (verdict 96e442c1): when an owner Connection
// MATCHED, the suspect lane never falls back to the legacy durable record — the
// connection-keyed record C and the legacy-keyed record S are different
// credentials (D18 rows 5/6/8: both hold R1; a mixed container: S is another
// binding's). Real stores and the real connection seam.
// ---------------------------------------------------------------------------
describe('LIN-3124 PR3 blocker 8 — the suspect lane never falls back to the legacy record when a Connection matched', () => {
  const ACCT = 'acct-b8';
  const URL_KEY = 'acme';
  const CONNECTION_ID = `${ACCT}::linear::org-1`;
  let dir;
  let client;
  let n = 0;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lin3124-b8-'));
    client = new MangoClient(dir);
    await client.connect();
  });
  after(async () => {
    if (client?.close) await client.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** An owner Connection (C holds R1) and a legacy S at the same urlKey. */
  async function world({ legacyToken = 'A1', legacyRefresh = 'R1', gateAllows = false } = {}) {
    const db = client.db(`b8_${n++}`);
    const connectionStore = new ConnectionStore({ collection: db.collection('connections') });
    const ownerCredentialStore = new OwnerCredentialStore({ collection: db.collection('owner-credentials') });
    await connectionStore.link(ACCT, 'linear', 'org-1', { token: 'A1', tokenExpiresAt: PAST }, { urlKey: URL_KEY, provider: 'linear', scope: 'org-1' });
    await ownerCredentialStore.putByConnection(CONNECTION_ID, { accountId: ACCT, provider: 'linear', scope: 'org-1', token: 'A1', refreshToken: 'R1', tokenExpiresAt: PAST });
    await ownerCredentialStore.put(ACCT, URL_KEY, { provider: 'linear', scope: 'org-1', token: legacyToken, refreshToken: legacyRefresh, tokenExpiresAt: PAST });
    const refreshCalls = [];
    const access = createConnectionAccess({
      connectionStore, ownerCredentialStore,
      refreshConnection: async (id) => { refreshCalls.push(id); return null; },
      resolveCanonicalAccountId: async (id) => id,
      selectOwnerSessionRow: () => null,
      normalizeProvider: (ws) => ws?.provider || 'linear',
      fingerprintCredential,
      gate: { shouldAttempt: () => gateAllows },
      lifecycleEventStore: { recordEvent: async () => {} },
      bufferMs: 5 * 60 * 1000,
    });
    const dump = async () => JSON.stringify(await db.collection('owner-credentials').find({}).sort({ _id: 1 }).toArray());
    return { db, connectionStore, ownerCredentialStore, access, refreshCalls, dump };
  }

  /** attemptSuspectCredentialRefresh wired exactly as server.js wires it. */
  function attempt(w, { fingerprint, registry, spends }) {
    const exchange = async (rt) => { spends.push(rt); return { access_token: 'A2', refresh_token: 'R2', expires_in: 3600 }; };
    return attemptSuspectCredentialRefresh({
      fingerprint, urlKey: URL_KEY, ownerAccountId: ACCT, provider: 'linear',
      loadSessions: async () => [],
      registry,
      store: w.ownerCredentialStore,
      lifecycleEventStore: { recordEvent: async () => {} },
      refreshAccessToken: exchange,
      resolveExchange: () => exchange,
      persistSession: async () => {},
      resolveProvider: () => ({}),
      adoptConnectionCredential: (args) => w.access.adoptConnectionCredentialForUrlKey(args),
      refreshConnection: (args) => w.access.refreshConnectionForSuspect(args),
      // Undefined before the fix, so this file loads at the pre-fix head.
      ownerHasConnection: w.access.ownerHasConnection && ((args) => w.access.ownerHasConnection(args)),
    });
  }

  test('(a) Connection matched + gate suppressing + legacy S holding R1: no exchange, S and C byte-equal, result null', async () => {
    const w = await world();
    const before = await w.dump();
    const spends = [];
    const out = await attempt(w, { fingerprint: fingerprintCredential('A1'), registry: { isSuspect: () => true, shouldAttemptRefresh: () => true }, spends });
    assert.deepStrictEqual(spends, [], 'refreshAccessToken is never called (neither R1 is spent)');
    assert.deepStrictEqual(w.refreshCalls, [], 'the connection refresh itself was gated');
    assert.strictEqual(await w.dump(), before, 'S and C are byte-equal before and after');
    assert.strictEqual(out, null);
  });

  test('(b) Connection matched, nothing to adopt, legacy S holding a DIFFERENT token: not adopted', async () => {
    const w = await world({ legacyToken: 'LEGACY-OTHER', legacyRefresh: 'R-other' });
    const before = await w.dump();
    const spends = [];
    const out = await attempt(w, { fingerprint: fingerprintCredential('A1'), registry: { isSuspect: () => true, shouldAttemptRefresh: () => false }, spends });
    assert.strictEqual(out, null, 'the legacy record is never adopted for the connection-backed request');
    assert.strictEqual(await w.dump(), before);
    assert.deepStrictEqual(spends, []);
  });

  test('server.js injects ownerHasConnection into the suspect lane, beside its connection arms', () => {
    const src = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    assert.match(src, /refreshConnection: \(args\) => connectionAccess\.refreshConnectionForSuspect\(args\),\n\s*ownerHasConnection: \(args\) => connectionAccess\.ownerHasConnection\(args\),/);
  });

  test('no Connection for the owner: the legacy remedies run exactly as before', async () => {
    const w = await world({ legacyToken: 'LEGACY-OTHER', legacyRefresh: 'R-other' });
    await w.db.collection('connections').deleteMany({});
    const out = await attempt(w, { fingerprint: fingerprintCredential('A1'), registry: { isSuspect: () => true, shouldAttemptRefresh: () => false }, spends: [] });
    assert.strictEqual(out.token, 'LEGACY-OTHER', 'the legacy adopt still serves a connection-less workspace');
  });
});
