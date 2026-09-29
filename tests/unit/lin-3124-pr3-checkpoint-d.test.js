/**
 * LIN-3124 PR3 — checkpoint D: the re-keyed, report-only credential invariant
 * sweep (D3/S5, T16). Dark: no connection-backed binding/row is created until
 * the write flip, so legacy edges are unchanged.
 *
 * Run: node --test tests/unit/lin-3124-pr3-checkpoint-d.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkspaceIdMapFromSessions,
  findCredentialInvariantViolations,
  runCredentialInvariantSweep,
} from '../../lib/credential-invariant-sweep.js';
import { createSweepConnectionDataLoader } from '../../lib/connection-credential.js';

const FUTURE = Date.now() + 3_600_000;
const PAST = Date.now() - 1_000;

function sessionsWith(workspace) {
  return [{ session: { accountId: 'acct', workspaces: [workspace] } }];
}

describe('LIN-3124 PR3 checkpoint D — workspaceIdMap captures the active connectionId', () => {
  test('a connection-backed active binding yields connectionId; a legacy one does not', () => {
    const cb = sessionsWith({ id: 'w1', urlKey: 'u1', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org' }, bindings: [{ provider: 'linear', scope: 'org', connectionId: 'acct::linear::org' }] });
    assert.strictEqual(resolveWorkspaceIdMapFromSessions(cb).get('w1').connectionId, 'acct::linear::org');
    const legacy = sessionsWith({ id: 'w2', urlKey: 'u2', provider: 'linear', accessToken: 't' });
    assert.strictEqual(resolveWorkspaceIdMapFromSessions(legacy).get('w2').connectionId, null);
  });
});

describe('LIN-3124 PR3 checkpoint D — kind-aware connection join (D3)', () => {
  const edges = [{ accountId: 'acct', workspaceId: 'w1' }];
  const canonical = new Map([['acct', 'acct']]);
  const now = Date.now();

  function map(connectionId) {
    return new Map([['w1', { urlKey: 'u1', provider: 'linear', connectionId }]]);
  }

  test('refresh-token kind with a live connection-keyed record is clean', () => {
    const connectionData = {
      rows: [{ _id: 'c', provider: 'linear', origin: 'connection', referents: [{ urlKey: 'u1' }] }],
      connectionById: new Map([['c', { _id: 'c', provider: 'linear' }]]),
      connectionRecordsById: new Map([['c', { token: 't', tokenExpiresAt: FUTURE }]]),
    };
    const out = findCredentialInvariantViolations(edges, canonical, map('c'), () => null, now, connectionData);
    assert.deepStrictEqual(out.violations, []);
  });

  test('refresh-token kind with a missing/expired record is a violation', () => {
    const missing = findCredentialInvariantViolations(edges, canonical, map('c'), () => null, now, { connectionById: new Map([['c', {}]]), connectionRecordsById: new Map([['c', null]]) });
    assert.strictEqual(missing.violations[0].reason, 'missing');
    const expired = findCredentialInvariantViolations(edges, canonical, map('c'), () => null, now, { connectionById: new Map([['c', {}]]), connectionRecordsById: new Map([['c', { token: 't', tokenExpiresAt: PAST }]]) });
    assert.strictEqual(expired.violations[0].reason, 'expired');
  });

  test('remint kind needs the Connection row with an installationId (expiry irrelevant)', () => {
    const ghEdges = [{ accountId: 'acct', workspaceId: 'w1' }];
    const ghMap = new Map([['w1', { urlKey: 'u1', provider: 'github', connectionId: 'c' }]]);
    const ok = findCredentialInvariantViolations(ghEdges, canonical, ghMap, () => null, now, { connectionById: new Map([['c', { hasInstallationId: true }]]), connectionRecordsById: new Map() });
    assert.deepStrictEqual(ok.violations, []);
    const bad = findCredentialInvariantViolations(ghEdges, canonical, ghMap, () => null, now, { connectionById: new Map([['c', { hasInstallationId: false }]]), connectionRecordsById: new Map() });
    assert.strictEqual(bad.violations[0].reason, 'missing');
  });

  test('a legacy edge (no connectionId) still uses the legacy credentialLookup', () => {
    const legacyMap = new Map([['w1', { urlKey: 'u1', provider: 'linear', connectionId: null }]]);
    const out = findCredentialInvariantViolations(edges, canonical, legacyMap, () => ({ tokenExpiresAt: FUTURE }), now, { connectionById: new Map() });
    assert.deepStrictEqual(out.violations, []);
  });
});

describe('LIN-3124 PR3 checkpoint D — connection_unreferenced (report-only)', () => {
  const edges = [];
  test('origin connection + referents [] is reported; non-origin and absent are not', () => {
    const connectionData = {
      rows: [
        { _id: 'c1', provider: 'linear', origin: 'connection', referents: [] },
        { _id: 'c2', provider: 'linear', origin: 'connection', referents: [{ urlKey: 'u' }] },
        { _id: 'c3', provider: 'linear', origin: 'legacy', referents: [] },
      ],
      connectionById: new Map(),
      connectionRecordsById: new Map(),
    };
    const out = findCredentialInvariantViolations(edges, new Map(), new Map(), () => null, Date.now(), connectionData);
    assert.deepStrictEqual(out.connectionUnreferenced, [{ connectionId: 'c1', provider: 'linear', reason: 'connection_unreferenced' }]);
  });

  test('without connectionData the result is legacy (no unreferenced, no change)', () => {
    const out = findCredentialInvariantViolations(edges, new Map(), new Map(), () => null, Date.now());
    assert.deepStrictEqual(out.connectionUnreferenced, []);
    assert.deepStrictEqual(out.violations, []);
  });
});

describe('LIN-3124 PR3 checkpoint D — loader + tick wiring', () => {
  test('createSweepConnectionDataLoader reads referents rows + records only for refresh-token kinds', async () => {
    const calls = { records: [] };
    const loader = createSweepConnectionDataLoader({
      connectionStore: { readReferencedConnections: async () => ([
        { _id: 'lin', provider: 'linear', origin: 'connection', referents: [] },
        { _id: 'gh', provider: 'github', origin: 'connection', referents: [{ urlKey: 'u' }] },
      ]) },
      ownerCredentialStore: { getByConnection: async (id) => { calls.records.push(id); return { token: 't', tokenExpiresAt: FUTURE }; } },
    });
    const data = await loader();
    assert.deepStrictEqual(calls.records, ['lin'], 'only refresh-token kinds get a getByConnection read');
    assert.strictEqual(data.recordsById.get('lin').token, 't');
    assert.strictEqual(data.rows.find(r => r._id === 'gh').hasInstallationId, false);
    assert.strictEqual(data.rows.length, 2);
  });

  test('runCredentialInvariantSweep logs connection_unreferenced through the injected loader', async () => {
    const events = [];
    const result = await runCredentialInvariantSweep({
      accountWorkspaceStore: { listAllEdges: async () => [] },
      accountStore: { resolveCanonicalAccountId: async (id) => id },
      ownerCredentialStore: {},
      lifecycleEventStore: { recordEvent: async (e) => { events.push(e); } },
      sessionsCollection: { find: () => ({ toArray: async () => [] }) },
      loadConnectionData: async () => ({ rows: [{ _id: 'orphan', provider: 'jira', origin: 'connection', referents: [] }], recordsById: new Map() }),
      now: Date.now(),
    });
    assert.strictEqual(result.connectionUnreferenced.length, 1);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].detail.reason, 'connection_unreferenced');
  });
});