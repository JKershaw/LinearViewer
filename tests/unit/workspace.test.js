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
