/**
 * Unit tests for `resolveRoutingFromConfig` (LIN-1390 S2) — the pure routing
 * resolver extracted from `resolveDispatchDefaults`. Network-free: exercises
 * the precedence logic directly against plain config objects, independent of
 * any store.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoutingFromConfig, WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';

// Minimal in-memory Mongo/Mango-shaped collection, just enough for
// WorkspacePreferencesStore's read/write (mirrors the fixture used by
// tests/unit/dispatch-factory.test.js).
function createMockCollection() {
  const docs = [];
  return {
    async findOne(query) { return docs.find(d => d._id === query._id) || null; },
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

describe('resolveRoutingFromConfig', () => {
  test('empty/absent config resolves both fields to null', () => {
    assert.deepEqual(resolveRoutingFromConfig(null, 'implementation'), { model: null, harness: null, effort: null });
    assert.deepEqual(resolveRoutingFromConfig(undefined, 'implementation'), { model: null, harness: null, effort: null });
    assert.deepEqual(resolveRoutingFromConfig({}, 'implementation'), { model: null, harness: null, effort: null });
  });

  test('top-level default is used when no byKind override exists', () => {
    const resolved = resolveRoutingFromConfig({ model: 'anthropic/claude-opus-4.8', harness: 'opencode' }, 'implementation');
    assert.deepEqual(resolved, { model: 'anthropic/claude-opus-4.8', harness: 'opencode', effort: null });
  });

  test('byKind override beats the top-level default for a DISPATCH_DEFAULT_KINDS kind', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation'), { model: 'anthropic/claude-sonnet-5', harness: 'claude-code', effort: null });
  });

  test('byKind is honored for autopilot (a DISPATCH_DEFAULT_KINDS member)', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { autopilot: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'autopilot'), { model: 'anthropic/claude-sonnet-5', harness: 'claude-code', effort: null });
  });

  test('byKind is ignored for a kind NOT in DISPATCH_DEFAULT_KINDS (e.g. custom)', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { custom: { model: 'should-never-be-read', harness: 'should-never-be-read' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'custom'), { model: 'anthropic/claude-opus-4.8', harness: 'opencode', effort: null });
  });

  test('byKind is ignored when kind is omitted, falling through to the top-level default', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      harness: 'opencode',
      byKind: { implementation: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
    };
    assert.deepEqual(resolveRoutingFromConfig(config), { model: 'anthropic/claude-opus-4.8', harness: 'opencode', effort: null });
  });

  test('fields resolve independently across byKind and top-level levels', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8',
      // no top-level harness
      byKind: { implementation: { harness: 'claude-code' } } // no per-kind model
    };
    assert.deepEqual(resolveRoutingFromConfig(config, 'implementation'), { model: 'anthropic/claude-opus-4.8', harness: 'claude-code', effort: null });
  });
});

// LIN-1694 — row-atomic model eligibility. The bug: `model` and `harness` resolved as two fully
// independent chains, so an explicit `harness` could pair with a `model` configured on a row scoped
// to a DIFFERENT harness. `harnessInForce` is how the caller (dispatch-factory) tells this resolver
// which engine actually won, so a row scoped elsewhere is skipped instead of donating its model.
describe('resolveRoutingFromConfig — row-atomic model eligibility (LIN-1694)', () => {
  const workspaceConfig = {
    byKind: { implementation: { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' } }
  };

  test('omitting harnessInForce keeps the pre-LIN-1694 behavior exactly', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation'),
      { model: 'deepseek/deepseek-v4-pro', harness: 'opencode', effort: null }
    );
  });

  test('THE BUG: an opencode-scoped row does not donate its model when claude-code is in force', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: 'claude-code' }),
      { model: null, harness: 'opencode', effort: null },
      'the row still reports its own harness; it just may not lend its model to another engine'
    );
  });

  test('a row scoped to the harness in force donates normally', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: 'opencode' }),
      { model: 'deepseek/deepseek-v4-pro', harness: 'opencode', effort: null }
    );
  });

  test('a blank-harness row is unscoped and donates to any harness (blank = inherit)', () => {
    const config = { byKind: { implementation: { model: 'anthropic/claude-sonnet-5' } } };
    assert.equal(resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'claude-code' }).model, 'anthropic/claude-sonnet-5');
    assert.equal(resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'opencode' }).model, 'anthropic/claude-sonnet-5');
  });

  test('an ineligible per-kind row is SKIPPED — the workspace-wide row still answers', () => {
    const config = {
      model: 'anthropic/claude-opus-4.8', // unscoped workspace-wide row
      byKind: { implementation: { model: 'deepseek/deepseek-v4-pro', harness: 'opencode' } }
    };
    assert.deepEqual(
      resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'claude-code' }),
      { model: 'anthropic/claude-opus-4.8', harness: 'opencode', effort: null }
    );
  });

  test('the reverse cross is blocked too — a claude-code row does not donate to opencode', () => {
    const config = { byKind: { implementation: { model: 'opus', harness: 'claude-code' } } };
    assert.equal(resolveRoutingFromConfig(config, 'implementation', { harnessInForce: 'opencode' }).model, null);
  });

  test('a null harnessInForce disables the check — the row is then the harness source itself', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: null }),
      { model: 'deepseek/deepseek-v4-pro', harness: 'opencode', effort: null }
    );
  });
});

// LIN-2615 — row-atomic EFFORT eligibility, mirroring the LIN-1694 model witness above exactly.
// Effort mirrors model's shape (row-atomic harness scoping, no anchor tier), so an opencode-scoped
// row's effort must not donate to a claude-code resolution either.
describe('resolveRoutingFromConfig — row-atomic effort eligibility (LIN-2615)', () => {
  const workspaceConfig = {
    byKind: { implementation: { effort: 'xhigh', harness: 'opencode' } }
  };

  test('omitting harnessInForce keeps effort donating like every other field', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation'),
      { model: null, harness: 'opencode', effort: 'xhigh' }
    );
  });

  test('an opencode-scoped row does not donate its effort when claude-code is in force', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: 'claude-code' }),
      { model: null, harness: 'opencode', effort: null },
      'the row still reports its own harness; it just may not lend its effort to another engine'
    );
  });

  test('a row scoped to the harness in force donates its effort normally', () => {
    assert.deepEqual(
      resolveRoutingFromConfig(workspaceConfig, 'implementation', { harnessInForce: 'opencode' }),
      { model: null, harness: 'opencode', effort: 'xhigh' }
    );
  });
});

// LIN-2615 — F2 gate-widening witness. Deliberately a SEPARATE case from the row-atomic witness
// above: that one supplies no explicit model/harness in the request, so lib/dispatch-factory.js's
// :435 workspace-tier gate is true either way and cannot catch a narrower gate. This test supplies
// BOTH model and harness explicitly — the only way to exercise the actual disjunct
// `!resolvedModel || !resolvedHarness || !resolvedEffort` and prove the gate still opens for effort
// alone.
describe('createDispatchItem — F2 gate widening for workspace-wide effort (LIN-2615)', () => {
  test('workspace-wide dispatchDefaults.effort still donates when model AND harness are both explicit', async () => {
    const captured = {};
    const store = {
      addItem: async (urlKey, item) => {
        captured.urlKey = urlKey;
        captured.item = item;
        return { _id: 'item-1', ...item };
      }
    };
    const prefs = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await prefs.saveWorkspacePreferences('acme', { dispatchDefaults: { effort: 'high' } });

    await createDispatchItem({
      store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation',
      model: 'explicit-model', harness: 'explicit-harness', prompt: 'x'
    });

    assert.equal(captured.item.model, 'explicit-model', 'the explicit model still wins');
    assert.equal(captured.item.harness, 'explicit-harness', 'the explicit harness still wins');
    assert.equal(captured.item.effort, 'high', 'the workspace-wide effort default still donates through the widened gate');
  });

  // Review finding I: the gate-widening test above supplies no explicit
  // `effort`, so it cannot pin the TOP of the precedence chain — an explicit
  // per-call `effort` must beat a workspace-wide default, not just donate
  // when nothing was supplied.
  test('an explicit request effort beats the workspace-wide default', async () => {
    const captured = {};
    const store = {
      addItem: async (urlKey, item) => {
        captured.urlKey = urlKey;
        captured.item = item;
        return { _id: 'item-2', ...item };
      }
    };
    const prefs = new WorkspacePreferencesStore({ collection: createMockCollection() });
    await prefs.saveWorkspacePreferences('acme', { dispatchDefaults: { effort: 'high' } });

    await createDispatchItem({
      store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation',
      model: 'explicit-model', harness: 'explicit-harness', effort: 'low', prompt: 'x'
    });

    assert.equal(captured.item.effort, 'low', 'the explicit per-call effort wins over the workspace-wide default');
  });
});
