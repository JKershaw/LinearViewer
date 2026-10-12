/**
 * LIN-3452: `activeConnectionBackedBinding` is the ONE decision point for "which
 * binding is a workspace's active connection-backed one". The sweep map and the
 * adopt entrant used to carry inline copies that omitted its stale-marker guard
 * (marker provider != workspace provider).
 *
 * Run: node --test tests/unit/lin-3452-active-binding-single-predicate.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceIdMapFromSessions } from '../../lib/credential-invariant-sweep.js';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

// A legacy re-login of jira replaced the workspace's provider, but the
// session-resident marker still points at the linear connection-backed binding.
const staleMarkerWorkspace = () => ({
  id: 'w', urlKey: 'u', provider: 'jira',
  activeBinding: { provider: 'linear', scope: 'org' },
  bindings: [{ provider: 'linear', scope: 'org', connectionId: 'acct::linear::org' }],
});
const liveWorkspace = () => ({ ...staleMarkerWorkspace(), provider: 'linear' });

describe('LIN-3452 stale marker: sweep workspace map', () => {
  const idFor = ws => resolveWorkspaceIdMapFromSessions([{ session: { accountId: 'acct', workspaces: [ws] } }]).get('w').connectionId;
  test('a stale marker yields no connectionId', () => assert.strictEqual(idFor(staleMarkerWorkspace()), null));
  test('a live marker still yields the connectionId', () => assert.strictEqual(idFor(liveWorkspace()), 'acct::linear::org'));
});

describe('LIN-3452 stale marker: adoptConnectionCredential', () => {
  let reads;
  const access = () => {
    reads = [];
    return createConnectionAccess({
      connectionStore: {
        readConnectionsByReferent: async () => [],
        readConnectionById: async (id) => { reads.push(id); return { _id: id, accountId: 'acct', provider: 'linear', unitId: 'org', credentials: { token: 'conn-new', tokenExpiresAt: Date.now() + 3_600_000 }, referents: [] }; },
      },
      ownerCredentialStore: { getByConnection: async () => null },
      refreshConnection: async () => null,
      resolveCanonicalAccountId: async id => id,
      selectOwnerSessionRow: () => null,
      normalizeProvider: ws => ws?.provider || 'linear',
      fingerprintCredential,
      gate: { shouldAttempt: () => true },
      lifecycleEventStore: { recordEvent: async () => {} },
      bufferMs: 5 * 60 * 1000,
      now: () => Date.now(),
    });
  };
  test('a stale marker adopts nothing and never reads the connection', async () => {
    const out = await access().adoptConnectionCredential({ workspace: staleMarkerWorkspace(), ownerAccountId: 'acct', fingerprint: fingerprintCredential('old') });
    assert.strictEqual(out, null);
    assert.deepStrictEqual(reads, []);
  });
  test('a live marker still adopts', async () => {
    const out = await access().adoptConnectionCredential({ workspace: liveWorkspace(), ownerAccountId: 'acct', fingerprint: fingerprintCredential('old') });
    assert.strictEqual(out.token, 'conn-new');
  });
});
