/**
 * Unit tests for `resolveDispatchDefaults` (LIN-1094) — the storage-layer
 * read seam for workspace-scoped dispatch model/harness defaults, shaped as
 * `dispatchDefaults: { model, harness, byKind: { <PROMPT_TEMPLATES key>: { model, harness } } }`.
 *
 * Exercises the real WorkspacePreferencesStore against an in-memory mock of
 * the MongoDB/MangoDB collection surface (mirrors tests/unit/workspace-features.test.js).
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspacePreferencesStore, resolveDispatchDefaults } from '../../lib/workspace-preferences.js';

function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) {
      return docs.find(d => d._id === query._id) || null;
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => d._id === query._id);
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { _id: query._id, ...(update.$setOnInsert || {}) };
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1 };
    }
  };
}

describe('resolveDispatchDefaults — backward compatibility', () => {
  let store;
  beforeEach(() => { store = new WorkspacePreferencesStore({ collection: createMockCollection() }); });

  test('no defaults configured resolves both fields to null', async () => {
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', kind: 'implementation', store });
    assert.deepEqual(resolved, { model: null, harness: null });
  });

  test('resolves to null when urlKey is missing', async () => {
    const resolved = await resolveDispatchDefaults({ urlKey: null, kind: 'implementation', store });
    assert.deepEqual(resolved, { model: null, harness: null });
  });

  test('resolves to null when store is missing', async () => {
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', kind: 'implementation', store: null });
    assert.deepEqual(resolved, { model: null, harness: null });
  });

  test('resolves to null when kind is omitted and only workspace-wide defaults would apply to none', async () => {
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', store });
    assert.deepEqual(resolved, { model: null, harness: null });
  });
});

describe('resolveDispatchDefaults — precedence', () => {
  let store;
  beforeEach(() => { store = new WorkspacePreferencesStore({ collection: createMockCollection() }); });

  test('workspace-wide default beats null when no per-kind override exists', async () => {
    await store.saveWorkspacePreferences('ws-1', {
      dispatchDefaults: { model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
    });
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', kind: 'implementation', store });
    assert.deepEqual(resolved, { model: 'anthropic/claude-opus-4.8', harness: 'opencode' });
  });

  test('per-kind override beats workspace-wide default', async () => {
    await store.saveWorkspacePreferences('ws-1', {
      dispatchDefaults: {
        model: 'anthropic/claude-opus-4.8',
        harness: 'opencode',
        byKind: {
          implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' }
        }
      }
    });
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', kind: 'implementation', store });
    assert.deepEqual(resolved, { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' });
  });

  test('a different kind with no override falls back to the workspace-wide default', async () => {
    await store.saveWorkspacePreferences('ws-1', {
      dispatchDefaults: {
        model: 'anthropic/claude-opus-4.8',
        harness: 'opencode',
        byKind: {
          implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' }
        }
      }
    });
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', kind: 'review', store });
    assert.deepEqual(resolved, { model: 'anthropic/claude-opus-4.8', harness: 'opencode' });
  });

  test('model and harness resolve independently across per-kind and workspace-wide levels', async () => {
    await store.saveWorkspacePreferences('ws-1', {
      dispatchDefaults: {
        model: 'anthropic/claude-opus-4.8',
        // no workspace-wide harness
        byKind: {
          implementation: { harness: 'claude-code' } // no per-kind model
        }
      }
    });
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', kind: 'implementation', store });
    assert.deepEqual(resolved, { model: 'anthropic/claude-opus-4.8', harness: 'claude-code' });
  });

  test('byKind is scoped to PROMPT_TEMPLATES keys only — a non-PROMPT_TEMPLATES kind ignores byKind', async () => {
    await store.saveWorkspacePreferences('ws-1', {
      dispatchDefaults: {
        model: 'anthropic/claude-opus-4.8',
        harness: 'opencode',
        // Not a real PROMPT_TEMPLATES key, but stored data should still be
        // ignored defensively rather than accidentally matched.
        byKind: {
          autopilot: { model: 'should-never-be-read', harness: 'should-never-be-read' }
        }
      }
    });
    const resolved = await resolveDispatchDefaults({ urlKey: 'ws-1', kind: 'autopilot', store });
    // Falls through to the workspace-wide default, not the byKind.autopilot entry.
    assert.deepEqual(resolved, { model: 'anthropic/claude-opus-4.8', harness: 'opencode' });
  });

  test('preserves other workspace preference keys (read-merge-write, shared with modelId/features)', async () => {
    await store.saveWorkspacePreferences('ws-1', { modelId: 'anthropic/claude-x', features: { periodicals: true } });
    const existingPrefs = await store.getWorkspacePreferences('ws-1');
    await store.saveWorkspacePreferences('ws-1', {
      ...existingPrefs,
      dispatchDefaults: { model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
    });

    const prefs = await store.getWorkspacePreferences('ws-1');
    assert.equal(prefs.modelId, 'anthropic/claude-x');
    assert.equal(prefs.features.periodicals, true);
    assert.equal(prefs.dispatchDefaults.model, 'anthropic/claude-opus-4.8');
  });
});
