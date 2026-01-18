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
