/**
 * LIN-3124 PR3 — checkpoint C: connection-first read arm (D7/D12), re-keyed
 * LIN-2097 gate (D5) and mixed-case classification (D17). Dark: no
 * connection-backed binding exists until the write flip, so the arm is
 * exercised against fakes and the legacy path is unchanged.
 *
 * Run: node --test tests/unit/lin-3124-pr3-checkpoint-c.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../../lib/providers/index.js';
import { classifyWorkspaceFailure, UNSCOPED } from '../../lib/workspace-token-resolver.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import {
  ownerHeadlessProvider,
  selectBestConnection,
  liveConnections,
  connectionResolveResult,
} from '../../lib/connection-access.js';
import { createConnectionAccess } from '../../lib/connection-credential.js';

const SENTINEL = Number.MAX_SAFE_INTEGER;
const BUFFER = 5 * 60 * 1000;
const future = () => Date.now() + 3_600_000;
const past = () => Date.now() - 1_000;

const conn = (id, provider, unitId, credentials, accountId) => ({ _id: id, accountId: accountId ?? id.split('::')[0], provider, unitId, credentials, referents: [] });

function accessWith(overrides = {}) {
  const calls = { refresh: [], gate: [], events: [], reads: [] };
  const deps = {
    connectionStore: {
      readConnectionsByReferent: async (urlKey, provider) => {
        calls.reads.push({ urlKey, provider });
        return overrides.connections ?? [];
      },
    },
    ownerCredentialStore: {
      getByConnection: async (id) => { calls.recordReads = (calls.recordReads || []); calls.recordReads.push(id); return overrides.record ?? null; },
    },
    refreshConnection: async (id, owner) => { calls.refresh.push({ id, owner }); return overrides.refreshed ?? null; },
    resolveCanonicalAccountId: async (id) => overrides.canonicalize ? overrides.canonicalize(id) : id,
    selectOwnerSessionRow: (sessions) => overrides.ownerRow ?? null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: (key, fp) => { calls.gate.push({ key, fp }); return overrides.gateAllows !== false; } },
    lifecycleEventStore: { recordEvent: async (e) => { calls.events.push(e); } },
    bufferMs: BUFFER,
    now: () => overrides.now ?? Date.now(),
    ...overrides.deps,
  };
  return { access: createConnectionAccess(deps), calls };
}

describe('LIN-3124 PR3 checkpoint C — ownerHeadlessProvider (D12)', () => {
  test('uses the owner session row provider; falls back to linear', () => {
    const ownerRow = { session: { workspaces: [{ provider: 'jira' }] }, workspaceIndex: 0 };
    assert.strictEqual(ownerHeadlessProvider([], 'u', 'a', { selectOwnerSessionRow: () => ownerRow, normalizeProvider: (w) => w.provider }), 'jira');
    assert.strictEqual(ownerHeadlessProvider([], 'u', 'a', { selectOwnerSessionRow: () => null, normalizeProvider: (w) => w.provider }), 'linear');
  });
});

describe('LIN-3124 PR3 checkpoint C — connection selection + result shape (D12/T17)', () => {
  test('selectBestConnection: finite beats sentinel, then later wins', () => {
    const a = conn('c1', 'linear', 'org', { token: 'a', tokenExpiresAt: SENTINEL });
    const b = conn('c2', 'linear', 'org', { token: 'b', tokenExpiresAt: future() });
    assert.strictEqual(selectBestConnection([a, b]), b);
    const c = conn('c3', 'linear', 'org', { token: 'c', tokenExpiresAt: future() + 10_000 });
    assert.strictEqual(selectBestConnection([b, c]), c);
  });

  test('liveConnections filters on the refresh buffer', () => {
    const live = conn('c1', 'linear', 'org', { token: 'a', tokenExpiresAt: future() });
    const dead = conn('c2', 'linear', 'org', { token: 'b', tokenExpiresAt: past() });
    assert.deepStrictEqual(liveConnections([live, dead], { now: Date.now(), bufferMs: BUFFER }), [live]);
  });

  test('connectionResolveResult scope shapes carry no connectionId', () => {
    const linear = connectionResolveResult(conn('acct::linear::org', 'linear', 'org', { token: 'tok', tokenExpiresAt: future() }), { source: 'connection', fingerprintCredential });
    assert.strictEqual(linear.scope, 'tok');
    assert.strictEqual(linear.token, 'tok');
    assert.strictEqual(linear.provider, 'linear');
    assert.ok(!JSON.stringify(linear).includes('acct::linear::org'));

    const gh = connectionResolveResult(conn('acct::github::o/r', 'github', 'o/r', { token: 'gh', tokenExpiresAt: future() }), { source: 'connection', fingerprintCredential });
    assert.deepStrictEqual(gh.scope, { token: 'gh', repo: 'o/r' });
    assert.ok(!JSON.stringify(gh).includes('acct::github::o/r'));

    const jira = connectionResolveResult(conn('acct::jira::https://s', 'jira', 'https://s', { token: 'jt', authType: 'oauth', cloudId: 'c1', tokenExpiresAt: future() }), { source: 'connection', fingerprintCredential });
    assert.deepStrictEqual(jira.scope, { authType: 'oauth', accessToken: 'jt', cloudId: 'c1', site: 'https://s' });
  });
});

describe('LIN-3124 PR3 checkpoint C — resolveConnectionBackedAccess', () => {
  test('no connections -> null (falls through to the legacy scan)', async () => {
    const { access } = accessWith({ connections: [] });
    assert.strictEqual(await access.resolveConnectionBackedAccess({ urlKey: 'u', ownerAccountId: 'a', sessions: [] }), null);
  });

  test('a live owner connection is served, and the provider is the owner row provider', async () => {
    const owner = conn('acct::jira::s', 'jira', 'https://s', { token: 'jt', authType: 'oauth', cloudId: 'c', tokenExpiresAt: future() });
    const ownerRow = { session: { workspaces: [{
      provider: 'jira',
      bindings: [{ provider: 'jira', scope: 'https://s', connectionId: owner._id }],
      activeBinding: { provider: 'jira', scope: 'https://s' },
    }] }, workspaceIndex: 0 };
    const { access, calls } = accessWith({ connections: [owner], ownerRow });
    const out = await access.resolveConnectionBackedAccess({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] });
    assert.deepStrictEqual(calls.reads, [{ urlKey: 'u', provider: 'jira' }]);
    assert.strictEqual(out.result.token, 'jt');
    assert.strictEqual(out.connectionSummary.ownerLive, true);
    assert.strictEqual(out.connectionSummary.ownerCount, 1);
  });

  test('another account live connection -> otherLive, not served', async () => {
    const other = conn('other::linear::org', 'linear', 'org', { token: 'x', tokenExpiresAt: future() });
    const { access, calls } = accessWith({ connections: [other], canonicalize: (id) => (id === 'acct' ? 'acct' : 'other') });
    const out = await access.resolveConnectionBackedAccess({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] });
    assert.strictEqual(out.result, undefined);
    assert.deepStrictEqual(out.connectionSummary, { ownerCount: 0, ownerLive: false, otherLive: true, storeError: false });
    assert.deepStrictEqual(calls.refresh, [], 'never refresh another account connection');
  });

  test('store error -> counts-only storeError summary', async () => {
    const { access } = accessWith({ deps: { connectionStore: { readConnectionsByReferent: async () => { throw new Error('down'); } } } });
    const out = await access.resolveConnectionBackedAccess({ urlKey: 'u', ownerAccountId: 'a', sessions: [] });
    assert.deepStrictEqual(out.connectionSummary, { ownerCount: 0, ownerLive: false, otherLive: false, storeError: true });
  });

  test('expired owner connection -> one refresh under the conn: gate, then served', async () => {
    const dead = conn('acct::linear::org', 'linear', 'org', { token: 'old', tokenExpiresAt: past() });
    const { access, calls } = accessWith({ connections: [dead], record: { token: 'old' }, refreshed: { token: 'new', expiresAt: future(), provider: 'linear' } });
    const out = await access.resolveConnectionBackedAccess({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] });
    assert.deepStrictEqual(calls.gate, [{ key: 'conn:acct::linear::org', fp: fingerprintCredential('old') }]);
    assert.deepStrictEqual(calls.refresh, [{ id: 'acct::linear::org', owner: 'acct' }]);
    assert.strictEqual(out.result.token, 'new');
    assert.strictEqual(out.result.scope, 'new');
  });
});

describe('LIN-3124 PR3 checkpoint C — re-keyed LIN-2097 gate (D5)', () => {
  test('refresh-token kind gates on conn:${id} + the record token; suppressed emits a lifecycle event', async () => {
    const dead = conn('acct::linear::org', 'linear', 'org', { token: 'old', tokenExpiresAt: past() });
    const { access, calls } = accessWith({ connections: [dead], record: { token: 'old' }, gateAllows: false });
    const out = await access.resolveConnectionBackedAccess({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] });
    assert.deepStrictEqual(calls.gate, [{ key: 'conn:acct::linear::org', fp: fingerprintCredential('old') }]);
    assert.deepStrictEqual(calls.refresh, []);
    assert.strictEqual(calls.events.length, 1);
    assert.strictEqual(out.result, undefined);
  });

  test('remint kind is ungated (gate never consulted)', async () => {
    const dead = conn('acct::github::o/r', 'github', 'o/r', { token: 'old', tokenExpiresAt: past() });
    const { access, calls } = accessWith({ connections: [dead], refreshed: { token: 'new', expiresAt: future(), provider: 'github' } });
    const out = await access.resolveConnectionBackedAccess({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] });
    assert.deepStrictEqual(calls.gate, [], 'remint kinds stay ungated');
    assert.strictEqual(out.result.token, 'new');
  });
});

describe('LIN-3124 PR3 checkpoint C — D17 classification (T25)', () => {
  // An owner session row (so detectOwnerSignedOut is false) referencing the urlKey.
  const sessions = [{ _id: 's', session: { accountId: 'a', workspaces: [{ urlKey: 'u' }] } }];
  test('absent connectionSummary is byte-identical to the legacy classifier', () => {
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: 'a', selectedReason: 'not_connected' }), 'not_connected');
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: 'a', selectedReason: 'session_expired' }), 'session_expired');
  });

  test('(b)/(c) another account connection live -> owner_mismatch (checked first)', () => {
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: 'a', selectedReason: 'not_connected', connectionSummary: { ownerCount: 0, ownerLive: false, otherLive: true, storeError: false } }), 'owner_mismatch');
  });

  test('(d) owner connection expired, no one else -> session_expired', () => {
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: 'a', selectedReason: 'session_expired', connectionSummary: { ownerCount: 1, ownerLive: false, otherLive: false, storeError: false } }), 'session_expired');
  });

  test('(e) store error -> store_unreachable, never not_connected', () => {
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: 'a', selectedReason: 'not_connected', connectionSummary: { ownerCount: 0, ownerLive: false, otherLive: false, storeError: true } }), 'store_unreachable');
  });

  test('owner_mismatch is checked FIRST even when a store error is also present', () => {
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: 'a', selectedReason: 'not_connected', connectionSummary: { ownerCount: 0, ownerLive: false, otherLive: true, storeError: true } }), 'owner_mismatch');
  });

  test('ownerLive suppresses owner_mismatch (a live owner connection is not a mismatch)', () => {
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: 'a', selectedReason: 'not_connected', connectionSummary: { ownerCount: 1, ownerLive: true, otherLive: true, storeError: false } }), 'not_connected');
  });

  test('UNSCOPED never classifies owner_mismatch', () => {
    assert.strictEqual(classifyWorkspaceFailure({ sessions, urlKey: 'u', ownerAccountId: UNSCOPED, selectedReason: 'not_connected', connectionSummary: { ownerCount: 0, ownerLive: false, otherLive: true, storeError: false } }), 'not_connected');
  });
});