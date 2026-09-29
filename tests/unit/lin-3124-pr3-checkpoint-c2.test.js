/**
 * LIN-3124 PR3 — checkpoint C2: D16 owner-blind lane + title-lane arm (D7).
 * Dark: no connection-backed binding exists until the write flip.
 *
 * Run: node --test tests/unit/lin-3124-pr3-checkpoint-c2.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { createWorkspaceTitleResolver } from '../../lib/workspace-title-resolver.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const DISPATCH_SRC = readFileSync(join(__dirname, '../../routes/dispatch.js'), 'utf8');
const DASHBOARD_SRC = readFileSync(join(__dirname, '../../routes/dashboard.js'), 'utf8');

const BUFFER = 5 * 60 * 1000;
const future = () => Date.now() + 3_600_000;
const past = () => Date.now() - 1_000;
const conn = (id, provider, unitId, credentials) => ({ _id: id, accountId: id.split('::')[0], provider, unitId, credentials, referents: [] });

function accessWith(overrides = {}) {
  return createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => overrides.connections ?? [] },
    ownerCredentialStore: { getByConnection: async () => overrides.record ?? null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => overrides.ownerRow ?? null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
    now: () => Date.now(),
  });
}

describe('LIN-3124 PR3 checkpoint C2 — title arm (D7)', () => {
  test('requires the owner session row (no row -> null: no post-logout widening)', async () => {
    const access = accessWith({ ownerRow: null, connections: [conn('acct::linear::org', 'linear', 'org', { token: 't', tokenExpiresAt: future() })] });
    assert.strictEqual(await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] }), null);
  });

  test('serves a live owner connection as a transient workspace (no refresh)', async () => {
    const ownerRow = { session: { workspaces: [{ id: 'w', provider: 'linear' }] }, workspaceIndex: 0 };
    const access = accessWith({ ownerRow, connections: [conn('acct::linear::org', 'linear', 'org', { token: 'conn-tok', tokenExpiresAt: future() })] });
    const ws = await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] });
    assert.strictEqual(ws.accessToken, 'conn-tok');
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.bindings[0].scope, 'org');
    assert.deepStrictEqual(ws.bindings[0].credentials, { token: 'conn-tok', tokenExpiresAt: ws.tokenExpiresAt });
  });

  test('an expired owner connection is NOT served (live only)', async () => {
    const ownerRow = { session: { workspaces: [{ id: 'w', provider: 'linear' }] }, workspaceIndex: 0 };
    const access = accessWith({ ownerRow, connections: [conn('acct::linear::org', 'linear', 'org', { token: 't', tokenExpiresAt: past() })] });
    assert.strictEqual(await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] }), null);
  });

  test('another account connection is never served', async () => {
    const ownerRow = { session: { workspaces: [{ id: 'w', provider: 'linear' }] }, workspaceIndex: 0 };
    const access = accessWith({ ownerRow, connections: [conn('other::linear::org', 'linear', 'org', { token: 't', tokenExpiresAt: future() })] });
    assert.strictEqual(await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] }), null);
  });

  test('the title resolver uses the arm first, then the legacy selector', async () => {
    const sessions = [{ _id: 's', session: { accountId: 'acct', workspaces: [{ urlKey: 'u', provider: 'linear', accessToken: 'legacy-tok', tokenExpiresAt: future() }] } }];
    const legacyRow = { urlKey: 'u', accessToken: 'legacy-tok' };
    const resolver = createWorkspaceTitleResolver({
      sessionsCollection: { find: () => ({ toArray: async () => sessions }) },
      fetchWorkspaceIssues: async () => [],
      resolveConnectionBackedWorkspace: async () => ({ urlKey: 'u', accessToken: 'conn-tok', provider: 'linear' }),
    });
    assert.strictEqual((await resolver.resolveWorkspaceForTitles('u', 'acct')).accessToken, 'conn-tok');

    const legacyResolver = createWorkspaceTitleResolver({
      sessionsCollection: { find: () => ({ toArray: async () => sessions }) },
      fetchWorkspaceIssues: async () => [],
    });
    assert.strictEqual((await legacyResolver.resolveWorkspaceForTitles('u', 'acct')).accessToken, 'legacy-tok');
    assert.ok(legacyRow);
  });
});

describe('LIN-3124 PR3 checkpoint C2 — D16 owner-blind threading (source-text pins)', () => {
  test('getWorkspaceAccessToken takes a session and consults the side-table only with one', () => {
    assert.match(SERVER_SRC, /async function getWorkspaceAccessToken\(urlKey, session = null\)/);
    const start = SERVER_SRC.indexOf('async function getWorkspaceAccessToken(');
    const body = SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n}', start));
    assert.match(body, /activeBindingIsConnectionBacked\(workspace\)/);
    assert.match(body, /readWorkspaceCredential\(workspace\)/);
    // UNSCOPED fallback is unchanged.
    assert.match(body, /return \(await resolveWorkspaceAccess\(urlKey\)\)\.token/);
  });

  test('routes/dispatch.js threads the session into the done-guard', () => {
    assert.match(DISPATCH_SRC, /getWorkspaceAccessToken: \(k\) => getWorkspaceAccessToken\(k, req\.session\)/);
  });

  test('routes/dashboard.js threads the session through mergeSessions and the hydrate route', () => {
    assert.match(DASHBOARD_SRC, /mergeSessions\(workspaces, \{ live = false, session = null \}/);
    assert.match(DASHBOARD_SRC, /getWorkspaceAccessToken\(b\.ws\.urlKey, session\)/);
    assert.match(DASHBOARD_SRC, /getWorkspaceAccessToken\(wsUrlKey, req\.session\)/);
    assert.match(DASHBOARD_SRC, /mergeSessions\(workspaces, \{ live: isSessionsView, session: req\.session \}\)/);
  });

  test('lib/dispatch-factory.js is NOT edited to know about sessions', () => {
    const factory = readFileSync(join(__dirname, '../../lib/dispatch-factory.js'), 'utf8');
    assert.doesNotMatch(factory, /req\.session/);
  });
});