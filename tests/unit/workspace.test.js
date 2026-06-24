/**
 * Unit tests for lib/workspace.js
 *
 * Run with: node --test tests/unit/workspace.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  getActiveWorkspace,
  upsertWorkspace,
  removeWorkspace,
  updateWorkspaceTokens,
  getWorkspaceToken,
  linkProvider,
  getBindingsForWorkspace,
  saveSession,
  MAX_WORKSPACES
} from '../../lib/workspace.js';

// =============================================================================
// updateWorkspaceTokens Tests
// =============================================================================

describe('updateWorkspaceTokens', () => {
  test('updates workspace with token data', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Test Workspace'
    };
    const tokenData = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600
    };

    updateWorkspaceTokens(workspace, tokenData);

    assert.strictEqual(workspace.accessToken, 'new-access-token');
    assert.strictEqual(workspace.refreshToken, 'new-refresh-token');
    assert.ok(workspace.tokenExpiresAt > Date.now());
    assert.ok(workspace.tokenExpiresAt <= Date.now() + 3600 * 1000);
  });

  test('overwrites existing token data', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Test Workspace',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      tokenExpiresAt: Date.now() - 1000
    };
    const tokenData = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 7200
    };

    updateWorkspaceTokens(workspace, tokenData);

    assert.strictEqual(workspace.accessToken, 'new-access-token');
    assert.strictEqual(workspace.refreshToken, 'new-refresh-token');
    assert.ok(workspace.tokenExpiresAt > Date.now());
  });

  test('preserves non-token workspace properties', () => {
    const workspace = {
      id: 'ws-1',
      name: 'Test Workspace',
      urlKey: 'test-workspace',
      addedAt: 12345,
      customField: 'should-remain'
    };
    const tokenData = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 3600
    };

    updateWorkspaceTokens(workspace, tokenData);

    assert.strictEqual(workspace.id, 'ws-1');
    assert.strictEqual(workspace.name, 'Test Workspace');
    assert.strictEqual(workspace.urlKey, 'test-workspace');
    assert.strictEqual(workspace.addedAt, 12345);
    assert.strictEqual(workspace.customField, 'should-remain');
  });

  test('handles zero expires_in', () => {
    const workspace = {};
    const tokenData = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 0
    };

    updateWorkspaceTokens(workspace, tokenData);

    // Should set tokenExpiresAt close to current time
    assert.ok(Math.abs(workspace.tokenExpiresAt - Date.now()) < 1000);
  });

  test('handles large expires_in value', () => {
    const workspace = {};
    const tokenData = {
      access_token: 'token',
      refresh_token: 'refresh',
      expires_in: 86400 * 30 // 30 days
    };

    updateWorkspaceTokens(workspace, tokenData);

    const expectedExpiry = Date.now() + 86400 * 30 * 1000;
    assert.ok(Math.abs(workspace.tokenExpiresAt - expectedExpiry) < 1000);
  });

  // Provider-aware write shape (LIN-334 / S2)
  test('writes generalized {provider, credentials} shape', () => {
    const workspace = { id: 'ws-1', name: 'Test Workspace' };
    updateWorkspaceTokens(workspace, {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600
    });

    assert.strictEqual(workspace.provider, 'linear');
    assert.deepStrictEqual(workspace.credentials, { token: 'new-access-token' });
  });

  test('written shape reads back through getWorkspaceToken (dual-read round-trip)', () => {
    const workspace = { id: 'ws-1' };
    updateWorkspaceTokens(workspace, {
      access_token: 'round-trip-token',
      refresh_token: 'r',
      expires_in: 3600
    });

    // New canonical seam resolves to credentials.token.
    assert.strictEqual(getWorkspaceToken(workspace), 'round-trip-token');
    // Legacy field is still populated for un-migrated read sites (S3+).
    assert.strictEqual(workspace.accessToken, 'round-trip-token');
  });

  test('refresh rotates credentials.token and preserves other credential fields', () => {
    const workspace = {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'old-token', scope: 'read,write' }
    };
    updateWorkspaceTokens(workspace, {
      access_token: 'rotated-token',
      refresh_token: 'r2',
      expires_in: 3600
    });

    assert.strictEqual(workspace.credentials.token, 'rotated-token');
    assert.strictEqual(workspace.credentials.scope, 'read,write');
    assert.strictEqual(getWorkspaceToken(workspace), 'rotated-token');
  });

  // LIN-562: the refresh middleware shares this writer, so a refreshed token must
  // land inside the active binding too — otherwise bindings[] goes stale.
  test('rotates the active binding in lockstep with the scalar mirror (LIN-562)', () => {
    const workspace = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', {
      token: 'old-token', refreshToken: 'old-ref', tokenExpiresAt: 1
    });

    updateWorkspaceTokens(workspace, {
      access_token: 'fresh-token', refresh_token: 'fresh-ref', expires_in: 3600
    });

    const binding = workspace.bindings.find(b => b.provider === 'linear');
    assert.strictEqual(binding.credentials.token, 'fresh-token');
    assert.strictEqual(binding.credentials.refreshToken, 'fresh-ref');
    assert.strictEqual(binding.credentials.tokenExpiresAt, workspace.tokenExpiresAt);
    // Scalar mirror + per-binding token agree (no drift).
    assert.strictEqual(getWorkspaceToken(workspace), 'fresh-token');
    assert.strictEqual(getWorkspaceToken(workspace, 'linear', 'org-1'), 'fresh-token');
  });

  test('does not synthesize a binding for legacy workspaces on refresh (byte-identical)', () => {
    const workspace = { id: 'ws-1', accessToken: 'old' };
    updateWorkspaceTokens(workspace, { access_token: 'new', refresh_token: 'r', expires_in: 3600 });
    // No bindings[] grown — legacy workspaces stay scalar-only and rely on
    // getBindingsForWorkspace synthesizing on read.
    assert.strictEqual(workspace.bindings, undefined);
  });
});

// =============================================================================
// linkProvider Tests (LIN-562)
// =============================================================================

describe('linkProvider', () => {
  test('attaches a (provider, scope) binding with nested credentials', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', {
      token: 'tok', refreshToken: 'ref', tokenExpiresAt: 999
    });
    assert.deepStrictEqual(ws.bindings, [
      { provider: 'linear', scope: 'org-1', credentials: { token: 'tok', refreshToken: 'ref', tokenExpiresAt: 999 } }
    ]);
  });

  test('writes the legacy scalar mirror for the active binding (readers stay green)', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', {
      token: 'tok', refreshToken: 'ref', tokenExpiresAt: 999
    });
    assert.strictEqual(ws.provider, 'linear');
    assert.deepStrictEqual(ws.credentials, { token: 'tok' });
    assert.strictEqual(ws.accessToken, 'tok');
    assert.strictEqual(ws.refreshToken, 'ref');
    assert.strictEqual(ws.tokenExpiresAt, 999);
    // No-arg getWorkspaceToken stays byte-identical (reads the scalar mirror).
    assert.strictEqual(getWorkspaceToken(ws), 'tok');
  });

  test('defaults active provider when unset; never clobbers an existing one', () => {
    const ws = linkProvider({ id: 'ws-1', provider: 'linear' }, 'local', 'scratch', { token: 'scratch' });
    // provider already set → preserved; local is a second, non-active binding.
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.bindings.length, 1);
    assert.strictEqual(ws.bindings[0].provider, 'local');
  });

  test('a non-active second binding does not clobber the primary scalar mirror', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'linear-tok', refreshToken: 'lr' });
    linkProvider(ws, 'local', 'scratch', { token: 'local-tok' });
    // Scalar mirror still reflects the active (linear) binding.
    assert.strictEqual(getWorkspaceToken(ws), 'linear-tok');
    assert.strictEqual(ws.accessToken, 'linear-tok');
    assert.strictEqual(ws.refreshToken, 'lr');
    // But the local token is reachable by (provider, scope).
    assert.strictEqual(getWorkspaceToken(ws, 'local', 'scratch'), 'local-tok');
    assert.strictEqual(ws.bindings.length, 2);
  });

  test('re-linking the same (provider, scope) upserts (merges) credentials, not duplicates', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 't1', scope: 'read,write' });
    linkProvider(ws, 'linear', 'org-1', { token: 't2' });
    assert.strictEqual(ws.bindings.length, 1);
    assert.strictEqual(ws.bindings[0].credentials.token, 't2');
    // Pre-existing non-token credential fields survive the merge.
    assert.strictEqual(ws.bindings[0].credentials.scope, 'read,write');
  });

  test('same provider, different scope yields two distinct bindings', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'github', 'owner/repo', { token: 'gh' });
    linkProvider(ws, 'github', 'org/5', { token: 'gh' });
    assert.strictEqual(ws.bindings.length, 2);
    assert.deepStrictEqual(ws.bindings.map(b => b.scope), ['owner/repo', 'org/5']);
  });
});

// =============================================================================
// getBindingsForWorkspace Tests (LIN-562)
// =============================================================================

describe('getBindingsForWorkspace', () => {
  test('returns explicit bindings when present', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'tok' });
    assert.strictEqual(getBindingsForWorkspace(ws), ws.bindings);
  });

  test('synthesizes one legacy linear binding for an un-migrated workspace (no migration)', () => {
    const ws = { id: 'org-9', provider: 'linear', accessToken: 'legacy', refreshToken: 'lr', tokenExpiresAt: 42 };
    assert.deepStrictEqual(getBindingsForWorkspace(ws), [
      { provider: 'linear', scope: 'org-9', credentials: { token: 'legacy', refreshToken: 'lr', tokenExpiresAt: 42 } }
    ]);
  });

  test('synthesized binding defaults provider to linear when absent', () => {
    const ws = { id: 'org-9', accessToken: 'legacy' };
    assert.strictEqual(getBindingsForWorkspace(ws)[0].provider, 'linear');
  });

  test('synthesizes a local binding scoped to urlKey (the store partition)', () => {
    const ws = { id: 'uuid-1', provider: 'local', urlKey: 'notes-abcd', accessToken: 'notes-abcd', tokenExpiresAt: Number.MAX_SAFE_INTEGER };
    assert.deepStrictEqual(getBindingsForWorkspace(ws), [
      { provider: 'local', scope: 'notes-abcd', credentials: { token: 'notes-abcd', tokenExpiresAt: Number.MAX_SAFE_INTEGER } }
    ]);
  });

  test('returns [] for null/undefined workspace', () => {
    assert.deepStrictEqual(getBindingsForWorkspace(null), []);
    assert.deepStrictEqual(getBindingsForWorkspace(undefined), []);
  });
});

// =============================================================================
// getWorkspaceToken — widened (provider, scope) form (LIN-562)
// =============================================================================

describe('getWorkspaceToken (provider/scope selection)', () => {
  test('selects a binding token by provider', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin-tok' });
    assert.strictEqual(getWorkspaceToken(ws, 'linear'), 'lin-tok');
  });

  test('selects a binding token by (provider, scope)', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'github', 'owner/repo', { token: 'a' });
    linkProvider(ws, 'github', 'org/5', { token: 'b' });
    assert.strictEqual(getWorkspaceToken(ws, 'github', 'owner/repo'), 'a');
    assert.strictEqual(getWorkspaceToken(ws, 'github', 'org/5'), 'b');
  });

  test('reads through the synthesized legacy binding for un-migrated workspaces', () => {
    const ws = { id: 'org-9', provider: 'linear', accessToken: 'legacy' };
    assert.strictEqual(getWorkspaceToken(ws, 'linear'), 'legacy');
    assert.strictEqual(getWorkspaceToken(ws, 'linear', 'org-9'), 'legacy');
  });

  test('returns undefined when no binding matches', () => {
    const ws = linkProvider({ id: 'ws-1' }, 'linear', 'org-1', { token: 'lin-tok' });
    assert.strictEqual(getWorkspaceToken(ws, 'github'), undefined);
    assert.strictEqual(getWorkspaceToken(ws, 'linear', 'wrong-scope'), undefined);
  });
});

// =============================================================================
// getWorkspaceToken Tests (dual-read accessor — LIN-333)
// =============================================================================

describe('getWorkspaceToken', () => {
  test('returns credentials.token for new-shape workspace', () => {
    const workspace = {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'new-token' }
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'new-token');
  });

  test('falls back to legacy accessToken when no credentials', () => {
    const workspace = {
      id: 'ws-1',
      accessToken: 'legacy-token'
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'legacy-token');
  });

  test('prefers credentials.token over legacy accessToken when both present', () => {
    const workspace = {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'new-token' },
      accessToken: 'legacy-token'
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'new-token');
  });

  test('returns undefined when neither credentials nor accessToken present', () => {
    assert.strictEqual(getWorkspaceToken({ id: 'ws-1' }), undefined);
  });

  test('handles null/undefined workspace without throwing', () => {
    assert.strictEqual(getWorkspaceToken(null), undefined);
    assert.strictEqual(getWorkspaceToken(undefined), undefined);
  });

  test('falls back to accessToken when credentials present but token missing', () => {
    const workspace = {
      id: 'ws-1',
      credentials: {},
      accessToken: 'legacy-token'
    };
    assert.strictEqual(getWorkspaceToken(workspace), 'legacy-token');
  });

  test('round-trips new {provider, credentials} shape through upsert + read', () => {
    const session = {};
    upsertWorkspace(session, {
      id: 'ws-1',
      name: 'New Shape',
      urlKey: 'new-shape',
      provider: 'linear',
      credentials: { token: 'round-trip-token' }
    });

    const stored = getActiveWorkspace({ ...session, activeWorkspaceId: 'ws-1' });
    assert.strictEqual(stored.provider, 'linear');
    assert.deepStrictEqual(stored.credentials, { token: 'round-trip-token' });
    assert.strictEqual(getWorkspaceToken(stored), 'round-trip-token');
  });

  test('round-trips legacy accessToken-shaped workspace through upsert + read', () => {
    const session = {};
    upsertWorkspace(session, {
      id: 'ws-legacy',
      name: 'Legacy',
      urlKey: 'legacy',
      accessToken: 'legacy-round-trip'
    });

    const stored = getActiveWorkspace({ ...session, activeWorkspaceId: 'ws-legacy' });
    assert.strictEqual(stored.provider, undefined);
    assert.strictEqual(stored.credentials, undefined);
    assert.strictEqual(getWorkspaceToken(stored), 'legacy-round-trip');
  });

  test('upsert merge does not drop new credential fields or inject defaults', () => {
    // Legacy workspace already in session; re-auth upserts the new shape on top.
    const session = {
      workspaces: [{ id: 'ws-1', name: 'Test', accessToken: 'legacy-token' }]
    };
    upsertWorkspace(session, {
      id: 'ws-1',
      provider: 'linear',
      credentials: { token: 'upgraded-token' }
    });

    const stored = session.workspaces[0];
    // Spread merge keeps untouched legacy fields and adds the new ones.
    assert.strictEqual(stored.name, 'Test');
    assert.strictEqual(stored.accessToken, 'legacy-token');
    assert.strictEqual(stored.provider, 'linear');
    assert.deepStrictEqual(stored.credentials, { token: 'upgraded-token' });
    // New credentials.token wins over the retained legacy accessToken.
    assert.strictEqual(getWorkspaceToken(stored), 'upgraded-token');
  });
});

// =============================================================================
// getActiveWorkspace Tests
// =============================================================================

describe('getActiveWorkspace', () => {
  test('returns null for empty workspaces', () => {
    const session = { workspaces: [] };
    assert.strictEqual(getActiveWorkspace(session), null);
  });

  test('returns null for undefined workspaces', () => {
    const session = {};
    assert.strictEqual(getActiveWorkspace(session), null);
  });

  test('returns active workspace when ID matches', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-2'
    };
    const result = getActiveWorkspace(session);
    assert.strictEqual(result.id, 'ws-2');
    assert.strictEqual(result.name, 'Second');
  });

  test('syncs to first workspace if activeWorkspaceId is invalid', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-nonexistent'
    };
    const result = getActiveWorkspace(session);
    assert.strictEqual(result.id, 'ws-1');
    assert.strictEqual(session.activeWorkspaceId, 'ws-1');
  });
});

// =============================================================================
// upsertWorkspace Tests
// =============================================================================

describe('upsertWorkspace', () => {
  test('adds new workspace to empty session', () => {
    const session = {};
    const workspace = { id: 'ws-1', name: 'Test' };

    upsertWorkspace(session, workspace);

    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.workspaces[0].id, 'ws-1');
  });

  test('updates existing workspace with same ID', () => {
    const session = {
      workspaces: [{ id: 'ws-1', name: 'Old Name', accessToken: 'old-token' }]
    };
    const workspace = { id: 'ws-1', name: 'New Name', accessToken: 'new-token' };

    upsertWorkspace(session, workspace);

    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.workspaces[0].name, 'New Name');
    assert.strictEqual(session.workspaces[0].accessToken, 'new-token');
  });

  test('throws error when at MAX_WORKSPACES limit', () => {
    const session = {
      workspaces: Array.from({ length: MAX_WORKSPACES }, (_, i) => ({ id: `ws-${i}` }))
    };
    const newWorkspace = { id: 'ws-new' };

    assert.throws(() => upsertWorkspace(session, newWorkspace), /Maximum/);
  });
});

// =============================================================================
// removeWorkspace Tests
// =============================================================================

describe('removeWorkspace', () => {
  test('removes workspace by ID', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-1'
    };

    const remaining = removeWorkspace(session, 'ws-2');

    assert.strictEqual(remaining, 1);
    assert.strictEqual(session.workspaces.length, 1);
    assert.strictEqual(session.workspaces[0].id, 'ws-1');
  });

  test('updates activeWorkspaceId when removing active workspace', () => {
    const session = {
      workspaces: [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' }
      ],
      activeWorkspaceId: 'ws-1'
    };

    const remaining = removeWorkspace(session, 'ws-1');

    assert.strictEqual(remaining, 1);
    assert.strictEqual(session.activeWorkspaceId, 'ws-2');
  });

  test('sets activeWorkspaceId to null when removing last workspace', () => {
    const session = {
      workspaces: [{ id: 'ws-1', name: 'Only' }],
      activeWorkspaceId: 'ws-1'
    };

    const remaining = removeWorkspace(session, 'ws-1');

    assert.strictEqual(remaining, 0);
    assert.strictEqual(session.activeWorkspaceId, null);
  });

  test('returns 0 for undefined workspaces', () => {
    const session = { activeWorkspaceId: 'ws-1' };

    const remaining = removeWorkspace(session, 'ws-1');

    assert.strictEqual(remaining, 0);
  });
});

// =============================================================================
// saveSession Tests
// =============================================================================

describe('saveSession', () => {
  test('resolves when session.save succeeds', async () => {
    const session = {
      save: (callback) => callback()
    };

    await assert.doesNotReject(() => saveSession(session));
  });

  test('rejects when session.save fails', async () => {
    const expectedError = new Error('Save failed');
    const session = {
      save: (callback) => callback(expectedError)
    };

    await assert.rejects(
      () => saveSession(session),
      expectedError
    );
  });

  test('handles async callback timing', async () => {
    let callbackCalled = false;
    const session = {
      save: (callback) => {
        setTimeout(() => {
          callbackCalled = true;
          callback();
        }, 10);
      }
    };

    await saveSession(session);
    assert.strictEqual(callbackCalled, true);
  });
});
