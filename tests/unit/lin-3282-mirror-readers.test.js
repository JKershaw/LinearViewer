/**
 * LIN-3282 commit 3 — mirror readers read the authoritative owner record.
 *
 * The single-source invariant LIN-3278 fixed for the proxy arm was still
 * half-applied to two sibling read paths:
 *   - `resolveConnectionBackedWorkspace` (title lane) judged liveness and
 *     served on `chosen.credentials` — the row MIRROR, which D9 says "may be
 *     stale";
 *   - `adoptConnectionCredential` (browser adopt entrant) compared the request's
 *     rejected fingerprint against the mirror.
 *
 * Commit 3 overlays `authoritativeConnection` before the liveness check / the
 * fingerprint comparison, for refresh-token kinds. This file pins the stale-
 * mirror/healthy-record divergence and the unchanged behaviour where the mirror
 * and the record agree or the provider is a non-refresh kind.
 */
process.env.NODE_ENV = 'test';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const ACCT = 'acct-3282';
const BUFFER = 5 * 60 * 1000;
const future = () => Date.now() + 3_600_000;
const past = () => Date.now() - 1_000;
const conn = (id, provider, unitId, credentials) => ({
  _id: id, accountId: id.split('::')[0], provider, unitId, credentials, referents: [],
});

const OWNER_ROW = { session: { workspaces: [{ id: 'w', provider: 'linear' }] }, workspaceIndex: 0 };

function connectionBackedWorkspace() {
  return {
    id: 'w', urlKey: 'u', provider: 'linear',
    activeBinding: { provider: 'linear', scope: 'org' },
    bindings: [{ provider: 'linear', scope: 'org', connectionId: `${ACCT}::linear::org` }],
  };
}

function accessWith({ connections = [], byId = {}, records = {}, mirrorImpl } = {}) {
  const mirrorCalls = [];
  const access = createConnectionAccess({
    connectionStore: {
      readConnectionsByReferent: async () => connections,
      readConnectionById: async (id) => byId[id] ?? null,
      mirrorCredentialIfToken: mirrorImpl || (async (id, observed, next) => {
        mirrorCalls.push({ id, observed, next });
        return true;
      }),
    },
    ownerCredentialStore: { getByConnection: async (id) => records[id] ?? null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => OWNER_ROW,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
    now: () => Date.now(),
  });
  return { access, mirrorCalls };
}

describe('LIN-3282: resolveConnectionBackedWorkspace (title lane) serves the record', () => {
  test('a stale-expired mirror does not disqualify a live record; the record is served', async () => {
    const recExpiry = future();
    const c = conn(`${ACCT}::linear::org`, 'linear', 'org', { token: 'STALE', tokenExpiresAt: past() });
    const { access, mirrorCalls } = accessWith({
      connections: [c],
      records: { [c._id]: { token: 'HEALTHY', tokenExpiresAt: recExpiry } },
    });

    const ws = await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: ACCT, sessions: [] });
    assert.ok(ws, 'the title lane must serve the Connection whose RECORD is live');
    assert.equal(ws.accessToken, 'HEALTHY');
    assert.equal(ws.tokenExpiresAt, recExpiry);
    assert.equal(ws.bindings[0].credentials.token, 'HEALTHY');
    assert.equal(mirrorCalls.length, 1, 'the stale mirror is CAS-repaired to the record');
    assert.equal(mirrorCalls[0].next.token, 'HEALTHY');
  });

  test('mirror == record stays byte-identical and triggers no repair', async () => {
    const recExpiry = future();
    const c = conn(`${ACCT}::linear::org`, 'linear', 'org', { token: 'SAME', tokenExpiresAt: recExpiry });
    const { access, mirrorCalls } = accessWith({
      connections: [c],
      records: { [c._id]: { token: 'SAME', tokenExpiresAt: recExpiry } },
    });

    const ws = await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: ACCT, sessions: [] });
    assert.equal(ws.accessToken, 'SAME');
    assert.equal(mirrorCalls.length, 0, 'an agreeing mirror is not rewritten');
  });

  test('a non-refresh kind (github) reads the mirror unchanged, no record overlay', async () => {
    const c = conn(`${ACCT}::github::99`, 'github', '99', { token: 'GH-MIRROR', installationId: '99', tokenExpiresAt: future() });
    const { access, mirrorCalls } = accessWith({
      connections: [c],
      records: { [c._id]: { token: 'GH-RECORD', tokenExpiresAt: future() } },
    });

    const ws = await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: ACCT, sessions: [] });
    assert.equal(ws.accessToken, 'GH-MIRROR', 'non-refresh kinds keep today\'s mirror behavior');
    assert.equal(mirrorCalls.length, 0);
  });

  test('a failed CAS repair still returns the record view (best-effort repair)', async () => {
    const c = conn(`${ACCT}::linear::org`, 'linear', 'org', { token: 'STALE', tokenExpiresAt: past() });
    const { access } = accessWith({
      connections: [c],
      records: { [c._id]: { token: 'HEALTHY', tokenExpiresAt: future() } },
      mirrorImpl: async () => { throw new Error('repair boom'); },
    });

    const ws = await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: ACCT, sessions: [] });
    assert.equal(ws.accessToken, 'HEALTHY');
  });
});

describe('LIN-3282: adoptConnectionCredential compares/serves the record', () => {
  test('a stale mirror equal to the rejected fingerprint still adopts the healthy record', async () => {
    const recExpiry = future();
    const c = conn(`${ACCT}::linear::org`, 'linear', 'org', { token: 'STALE', tokenExpiresAt: past() });
    const { access, mirrorCalls } = accessWith({
      byId: { [c._id]: c },
      records: { [c._id]: { token: 'HEALTHY', tokenExpiresAt: recExpiry } },
    });

    const out = await access.adoptConnectionCredential({
      workspace: connectionBackedWorkspace(), ownerAccountId: ACCT, fingerprint: fingerprintCredential('STALE'),
    });
    assert.ok(out, 'the record differs from the rejected (stale-mirror) fingerprint, so it is adopted');
    assert.equal(out.token, 'HEALTHY');
    assert.equal(out.expiresAt, recExpiry);
    assert.equal(out.credentialBag.token, 'HEALTHY');
    assert.equal(mirrorCalls.length, 1);
  });

  test('a fingerprint equal to the RECORD is never re-adopted', async () => {
    const c = conn(`${ACCT}::linear::org`, 'linear', 'org', { token: 'STALE', tokenExpiresAt: past() });
    const { access } = accessWith({
      byId: { [c._id]: c },
      records: { [c._id]: { token: 'HEALTHY', tokenExpiresAt: future() } },
    });

    const out = await access.adoptConnectionCredential({
      workspace: connectionBackedWorkspace(), ownerAccountId: ACCT, fingerprint: fingerprintCredential('HEALTHY'),
    });
    assert.equal(out, null, 'the record already IS the rejected credential');
  });

  test('mirror == record keeps today\'s behavior (adopts a different rejected credential)', async () => {
    const c = conn(`${ACCT}::linear::org`, 'linear', 'org', { token: 'SAME', tokenExpiresAt: future() });
    const { access, mirrorCalls } = accessWith({
      byId: { [c._id]: c },
      records: { [c._id]: { token: 'SAME', tokenExpiresAt: c.credentials.tokenExpiresAt } },
    });

    const out = await access.adoptConnectionCredential({
      workspace: connectionBackedWorkspace(), ownerAccountId: ACCT, fingerprint: fingerprintCredential('other'),
    });
    assert.equal(out.token, 'SAME');
    assert.equal(mirrorCalls.length, 0);
  });

  test('a non-refresh kind (github) is unchanged: compares the mirror, not the record', async () => {
    const c = conn(`${ACCT}::github::99`, 'github', '99', { token: 'GH-MIRROR', installationId: '99', tokenExpiresAt: future() });
    const workspace = {
      id: 'w', urlKey: 'u', provider: 'github',
      activeBinding: { provider: 'github', scope: 'octo/repoA' },
      bindings: [{ provider: 'github', scope: 'octo/repoA', connectionId: c._id }],
    };
    const { access } = accessWith({
      byId: { [c._id]: c },
      records: { [c._id]: { token: 'GH-RECORD', tokenExpiresAt: future() } },
    });

    const out = await access.adoptConnectionCredential({
      workspace, ownerAccountId: ACCT, fingerprint: fingerprintCredential('GH-MIRROR'),
    });
    assert.equal(out, null, 'the mirror IS the rejected credential; github keeps the mirror comparison');
  });
});
