/**
 * LIN-3124 PR3 — checkpoint C3: handleUnauthorizedError connection arm, the
 * adopt entrant's connection-keyed read + side-table hydration, and the
 * connection-release census. Dark: no connection-backed binding exists until
 * the write flip.
 *
 * Run: node --test tests/unit/lin-3124-pr3-checkpoint-c3.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const WORKSPACE_API_SRC = readFileSync(join(__dirname, '../../routes/workspace-api.js'), 'utf8');
const CREDENTIAL_SRC = readFileSync(join(__dirname, '../../lib/connection-credential.js'), 'utf8');

const BUFFER = 5 * 60 * 1000;
const future = () => Date.now() + 3_600_000;
const conn = (id, provider, unitId, credentials) => ({ _id: id, accountId: id.split('::')[0], provider, unitId, credentials, referents: [] });

function accessWith(overrides = {}) {
  return createConnectionAccess({
    connectionStore: {
      readConnectionsByReferent: async () => overrides.connections ?? [],
      readConnectionById: async (id) => (overrides.byId ?? {})[id] ?? null,
    },
    ownerCredentialStore: { getByConnection: async () => overrides.record ?? null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
    now: () => Date.now(),
  });
}

function connectionBackedWorkspace(overrides = {}) {
  const binding = { provider: 'linear', scope: 'org', connectionId: 'acct::linear::org', ...overrides.binding };
  return { id: 'w', urlKey: 'u', provider: 'linear', activeBinding: { provider: 'linear', scope: 'org' }, bindings: [binding] };
}

describe('LIN-3124 PR3 checkpoint C3 — adoptConnectionCredential (D7 adopt entrant)', () => {
  test('adopts a differing connection-keyed credential', async () => {
    const access = accessWith({ byId: { 'acct::linear::org': conn('acct::linear::org', 'linear', 'org', { token: 'conn-new', tokenExpiresAt: future() }) } });
    const out = await access.adoptConnectionCredential({ workspace: connectionBackedWorkspace(), ownerAccountId: 'acct', fingerprint: fingerprintCredential('stale') });
    assert.strictEqual(out.token, 'conn-new');
    assert.strictEqual(out.credentialBag.token, 'conn-new');
    assert.strictEqual(out.binding.connectionId, 'acct::linear::org');
  });

  test('never adopts a byte-identical credential', async () => {
    const access = accessWith({ byId: { 'acct::linear::org': conn('acct::linear::org', 'linear', 'org', { token: 'same', tokenExpiresAt: future() }) } });
    assert.strictEqual(await access.adoptConnectionCredential({ workspace: connectionBackedWorkspace(), ownerAccountId: 'acct', fingerprint: fingerprintCredential('same') }), null);
  });

  test('returns null for a legacy (non-connection-backed) workspace', async () => {
    const access = accessWith({});
    const legacy = { id: 'w', urlKey: 'u', provider: 'linear', bindings: [{ provider: 'linear', scope: 'org', credentials: { token: 'x' } }] };
    assert.strictEqual(await access.adoptConnectionCredential({ workspace: legacy, ownerAccountId: 'acct', fingerprint: 'f' }), null);
  });

  test('never adopts another account connection', async () => {
    const access = accessWith({ byId: { 'acct::linear::org': conn('other::linear::org', 'linear', 'org', { token: 'other', tokenExpiresAt: future() }) } });
    assert.strictEqual(await access.adoptConnectionCredential({ workspace: connectionBackedWorkspace(), ownerAccountId: 'acct', fingerprint: 'f' }), null);
  });

  test('returns null when the connection is missing', async () => {
    const access = accessWith({ byId: {} });
    assert.strictEqual(await access.adoptConnectionCredential({ workspace: connectionBackedWorkspace(), ownerAccountId: 'acct', fingerprint: 'f' }), null);
  });
});

describe('LIN-3124 PR3 checkpoint C3 — source-text pins', () => {
  test('handleUnauthorizedError connection arm PRECEDES the legacy durable read', () => {
    const start = SERVER_SRC.indexOf('async function handleUnauthorizedError(');
    const body = SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n}\n', start));
    const armIdx = body.indexOf('if (connectionId) {');
    const legacyReadIdx = body.indexOf('const durableRecord = await ownerCredentialStore.get(session.accountId');
    assert.notEqual(armIdx, -1, 'expected the connection arm in handleUnauthorizedError');
    assert.notEqual(legacyReadIdx, -1, 'expected the legacy durable read');
    assert.ok(armIdx < legacyReadIdx, 'the connection arm must precede the legacy-key durable read (the :1717-class hazard)');
  });

  test('the connection arm deletes the Connection on a definitive revocation (D4)', () => {
    const start = SERVER_SRC.indexOf('async function handleUnauthorizedError(');
    const body = SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n}\n', start));
    const armIdx = body.indexOf('if (connectionId) {');
    const armSlice = body.slice(armIdx, body.indexOf('const durableRecord = await ownerCredentialStore.get(session.accountId'));
    assert.match(armSlice, /releaseConnectionCredential\(\{ connectionStore, ownerCredentialStore, workspace, provider, mode: 'revoke', evict: evictReferentFor\(session\.accountId\) \}\)/);
  });

  test('workspace-api adopt entrant uses the injected connection read + hydrates the side-table', () => {
    assert.match(WORKSPACE_API_SRC, /connectionBackedId\(workspace\)/);
    assert.match(WORKSPACE_API_SRC, /adoptConnectionCredential\(\{/);
    assert.match(WORKSPACE_API_SRC, /setBindingCredential\(adoptedConnection\.binding, adoptedConnection\.credentialBag\)/);
    assert.match(WORKSPACE_API_SRC, /setWorkspaceCredential\(workspace, adoptedConnection\.credentialBag\)/);
  });

  test('the seam exposes adoptConnectionCredential and the workspace-api module imports no connection seam', () => {
    assert.match(CREDENTIAL_SRC, /async function adoptConnectionCredential\(/);
    assert.match(WORKSPACE_API_SRC, /from '\.\.\/lib\/connection-binding\.js'/);
    assert.doesNotMatch(WORKSPACE_API_SRC, /from '\.\.\/lib\/connection-(?:credential|store|lifecycle|access)\.js'/);
  });

  test('N1: the Linear reuse-grace constant is defined once (shared via token-refresh.js)', () => {
    const files = ['lib/token-refresh.js', 'lib/workspace-token-refresh.js', 'lib/connection-credential.js'];
    let defs = 0;
    for (const rel of files) defs += (readFileSync(join(__dirname, '../..', rel), 'utf8').match(/LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS\s*=/g) || []).length;
    assert.equal(defs, 1, 'exactly one definition');
    assert.match(readFileSync(join(__dirname, '../../lib/token-refresh.js'), 'utf8'), /export const LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS = 30 \* 60 \* 1000/);
    assert.match(readFileSync(join(__dirname, '../../lib/workspace-token-refresh.js'), 'utf8'), /LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS \} from '\.\/token-refresh\.js'/);
    assert.match(CREDENTIAL_SRC, /LINEAR_REFRESH_TOKEN_REUSE_GRACE_MS \} from '\.\/token-refresh\.js'/);
  });
});