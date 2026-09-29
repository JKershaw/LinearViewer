/**
 * LIN-3124 PR3 — suspect/refresh entrant connection arms (D7, N3 authorize-first).
 * Dark: no connection-backed binding exists until the write flip.
 *
 * Run: node --test tests/unit/lin-3124-pr3-suspect-connection.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
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