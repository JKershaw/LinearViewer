/**
 * Unit tests for the workspace-scoped feature-toggle mechanism (LIN-340).
 *
 * Run with: node --test tests/unit/workspace-features.test.js
 *
 * Exercises the real WorkspacePreferencesStore feature helpers against an
 * in-memory mock of the MongoDB/MangoDB collection surface, plus the workspace
 * feature-defaults exports. The contract under test is that workspace features
 * are genuinely workspace-scoped (via the store) and isolated from the per-user
 * FEATURES / session.features path.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { WorkspacePreferencesStore, getWorkspaceFeatures, isWorkspaceFeatureEnabled, setWorkspaceFeature } from '../../lib/workspace-preferences.js';
import {
  FEATURES,
  FEATURE_KEYS,
  getFeatureFlags,
  WORKSPACE_FEATURES,
  WORKSPACE_FEATURE_DEFAULTS,
  WORKSPACE_FEATURE_KEYS,
  isValidWorkspaceFeatureKey,
  isValidFeatureKey
} from '../../lib/feature-defaults.js';

// Minimal in-memory mock of the collection surface the store uses (findOne / updateOne upsert).
function createMockCollection() {
  const docs = [];
  return {
    _docs: docs,
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
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => d._id === query._id);
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    }
  };
}

describe('workspace feature defaults', () => {
  test('periodicals is a workspace feature, default off', () => {
    assert.strictEqual(WORKSPACE_FEATURES.PERIODICALS, 'periodicals');
    assert.strictEqual(WORKSPACE_FEATURE_DEFAULTS.periodicals, false);
    assert.ok(WORKSPACE_FEATURE_KEYS.includes('periodicals'));
    assert.ok(isValidWorkspaceFeatureKey('periodicals'));
    assert.strictEqual(isValidWorkspaceFeatureKey('linearMcp'), false);
  });

  test('per-user FEATURES set is unchanged and does not contain periodicals', () => {
    // Contract: the workspace path must not leak into the per-user set.
    assert.strictEqual(isValidFeatureKey('periodicals'), false);
    assert.strictEqual(FEATURE_KEYS.includes('periodicals'), false);
    // Spot-check the per-user set still has its known members.
    assert.ok(FEATURE_KEYS.includes(FEATURES.LINEAR_MCP));
    assert.ok(FEATURE_KEYS.includes(FEATURES.PROXY));
  });
});

describe('isWorkspaceFeatureEnabled', () => {
  let store;
  beforeEach(() => { store = new WorkspacePreferencesStore({ collection: createMockCollection() }); });

  test('returns the default when no override is set', async () => {
    const enabled = await isWorkspaceFeatureEnabled({ urlKey: 'ws-1', featureKey: 'periodicals', store });
    assert.strictEqual(enabled, false); // default-off
  });

  test('returns the override when one is set', async () => {
    await setWorkspaceFeature({ urlKey: 'ws-1', featureKey: 'periodicals', enabled: true, store });
    const enabled = await isWorkspaceFeatureEnabled({ urlKey: 'ws-1', featureKey: 'periodicals', store });
    assert.strictEqual(enabled, true);
  });

  test('is workspace-scoped — overriding one workspace does not affect another', async () => {
    await setWorkspaceFeature({ urlKey: 'ws-1', featureKey: 'periodicals', enabled: true, store });
    assert.strictEqual(await isWorkspaceFeatureEnabled({ urlKey: 'ws-1', featureKey: 'periodicals', store }), true);
    assert.strictEqual(await isWorkspaceFeatureEnabled({ urlKey: 'ws-2', featureKey: 'periodicals', store }), false);
  });

  test('returns default when urlKey or store is missing', async () => {
    assert.strictEqual(await isWorkspaceFeatureEnabled({ urlKey: null, featureKey: 'periodicals', store }), false);
    assert.strictEqual(await isWorkspaceFeatureEnabled({ urlKey: 'ws-1', featureKey: 'periodicals', store: null }), false);
  });

  test('is isolated from session.features / getFeatureFlags', async () => {
    await setWorkspaceFeature({ urlKey: 'ws-1', featureKey: 'periodicals', enabled: true, store });
    // A session that has NO periodicals key must not surface it through the per-user path.
    const session = { features: {} };
    const flags = getFeatureFlags(session);
    assert.strictEqual('periodicals' in flags, false);
    // And even a session that tries to set periodicals is filtered out by the per-user validator.
    const tampered = getFeatureFlags({ features: { periodicals: true } });
    assert.strictEqual('periodicals' in tampered, false);
  });
});

describe('getWorkspaceFeatures', () => {
  let store;
  beforeEach(() => { store = new WorkspacePreferencesStore({ collection: createMockCollection() }); });

  test('merges defaults with overrides and drops unknown keys', async () => {
    // Persist a valid override plus a junk key directly via the store.
    await store.saveWorkspacePreferences('ws-1', { features: { periodicals: true, bogusKey: true } });
    const features = await getWorkspaceFeatures({ urlKey: 'ws-1', store });
    assert.strictEqual(features.periodicals, true);
    assert.strictEqual('bogusKey' in features, false);
  });
});

describe('setWorkspaceFeature — shared-store safety', () => {
  let store;
  beforeEach(() => { store = new WorkspacePreferencesStore({ collection: createMockCollection() }); });

  test('preserves other workspace preference keys (e.g. modelId)', async () => {
    // The model handler shares this store and writes modelId.
    await store.saveWorkspacePreferences('ws-1', { modelId: 'anthropic/claude-x' });
    await setWorkspaceFeature({ urlKey: 'ws-1', featureKey: 'periodicals', enabled: true, store });

    const prefs = await store.getWorkspacePreferences('ws-1');
    assert.strictEqual(prefs.modelId, 'anthropic/claude-x'); // untouched
    assert.strictEqual(prefs.features.periodicals, true);
  });

  test('preserves other feature flags when flipping one', async () => {
    await store.saveWorkspacePreferences('ws-1', { features: { periodicals: true, other: true } });
    await setWorkspaceFeature({ urlKey: 'ws-1', featureKey: 'periodicals', enabled: false, store });

    const prefs = await store.getWorkspacePreferences('ws-1');
    assert.strictEqual(prefs.features.periodicals, false);
    assert.strictEqual(prefs.features.other, true); // sibling flag untouched
  });

  test('toggling on then off persists the final state', async () => {
    await setWorkspaceFeature({ urlKey: 'ws-1', featureKey: 'periodicals', enabled: true, store });
    assert.strictEqual(await isWorkspaceFeatureEnabled({ urlKey: 'ws-1', featureKey: 'periodicals', store }), true);
    await setWorkspaceFeature({ urlKey: 'ws-1', featureKey: 'periodicals', enabled: false, store });
    assert.strictEqual(await isWorkspaceFeatureEnabled({ urlKey: 'ws-1', featureKey: 'periodicals', store }), false);
  });
});
