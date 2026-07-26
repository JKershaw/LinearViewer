/**
 * Unit tests for createDispatchItem (LIN-1139).
 *
 * The factory is the single seam every external dispatch entry point routes
 * through. These tests pin its four responsibilities in isolation from any
 * router: (1) resolve the effective kind, (2) fill blank model/harness from
 * workspace dispatchDefaults, (3) interpose the default harness (with an
 * opt-out), and (4) preserve the harness→finalizePrompt→addItem ordering so a
 * proxy-context append can gate on the resolved harness and carry back a
 * bootstrapToken.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchItem, DUPLICATE_DISPATCH_WINDOW_MS } from '../../lib/dispatch-factory.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection as createDocCollection } from '../fixtures/mock-collection.js';

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

// A store that captures the item verbatim (does NOT null-coerce like the real
// store) so the test sees exactly what the factory built.
function capturingStore() {
  const captured = {};
  return {
    captured,
    addItem: async (urlKey, item) => {
      captured.urlKey = urlKey;
      captured.item = item;
      return { _id: 'item-1', ...item };
    }
  };
}

// A capturing store that also serves getItemStatus lookups from a fixed table of
// prior dispatch items — the shape createDispatchItem's followUpTo inheritance
// (LIN-1292) reads.
function capturingStoreWithItems(items) {
  const store = capturingStore();
  store.getItemStatus = async (_urlKey, id) => items[id] || null;
  return store;
}

// Same as capturingStoreWithItems, plus a call counter on getItemStatus so a
// test can prove the anchor was actually consulted — not just that the test
// would still pass with the inheritance code deleted (LIN-1431's
// vacuous-green trap).
function capturingStoreWithItemsCounted(items) {
  const store = capturingStoreWithItems(items);
  let getItemStatusCalls = 0;
  const rawGetItemStatus = store.getItemStatus;
  store.getItemStatus = async (...args) => {
    getItemStatusCalls++;
    return rawGetItemStatus(...args);
  };
  Object.defineProperty(store, 'getItemStatusCalls', { get: () => getItemStatusCalls });
  return store;
}

async function prefsWith(defaults) {
  const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
  if (defaults) await store.saveWorkspacePreferences('acme', { dispatchDefaults: defaults });
  return store;
}

// A minimal dispatch presets store fake: a fixed id -> { id, name, config } table.
function presetsStoreWith(presets) {
  return { get: async (_urlKey, id) => presets[id] || null };
}

describe('createDispatchItem — guards', () => {
  test('throws without a store', async () => {
    await assert.rejects(() => createDispatchItem({ urlKey: 'acme', prompt: 'x' }), /requires a dispatch store/);
  });
  test('throws without a urlKey', async () => {
    await assert.rejects(() => createDispatchItem({ store: capturingStore(), prompt: 'x' }), /requires a urlKey/);
  });
});

describe('createDispatchItem — kind resolution', () => {
  test('uses an explicit kind verbatim', async () => {
    const store = capturingStore();
    await createDispatchItem({ store, urlKey: 'acme', kind: 'review', prompt: 'x', fields: { promptName: 'anything' } });
    assert.equal(store.captured.item.kind, 'review');
  });
  test('derives kind from promptName when omitted', async () => {
    const store = capturingStore();
    await createDispatchItem({ store, urlKey: 'acme', prompt: 'x', fields: { promptName: 'implementation' } });
    assert.equal(store.captured.item.kind, 'implementation');
  });
  test('falls back to custom for an unrecognized/absent promptName', async () => {
    const store = capturingStore();
    await createDispatchItem({ store, urlKey: 'acme', prompt: 'x', fields: {} });
    assert.equal(store.captured.item.kind, 'custom');
  });
});

describe('createDispatchItem — model/harness resolution', () => {
  test('no prefs store: model null, harness defaults to claude-code', async () => {
    const store = capturingStore();
    await createDispatchItem({ store, urlKey: 'acme', kind: 'implementation', prompt: 'x' });
    assert.strictEqual(store.captured.item.model, null);
    assert.strictEqual(store.captured.item.harness, 'claude-code');
  });

  test('workspace-wide defaults fill blank model/harness', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    await createDispatchItem({ store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation', prompt: 'x' });
    assert.equal(store.captured.item.model, 'ws-model');
    assert.equal(store.captured.item.harness, 'ws-harness');
  });

  test('per-kind override beats the workspace-wide default', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({
      model: 'ws-model', harness: 'ws-harness',
      byKind: { implementation: { model: 'kind-model', harness: 'kind-harness' } }
    });
    await createDispatchItem({ store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation', prompt: 'x' });
    assert.equal(store.captured.item.model, 'kind-model');
    assert.equal(store.captured.item.harness, 'kind-harness');
  });

  test('a per-kind autopilot override is stamped onto the dispatched item (LIN-1278)', async () => {
    // The end-to-end chain a real `kind:'autopilot'` dispatch takes: the factory
    // keys resolveDispatchDefaults on the autopilot kind and stamps the resolved
    // byKind.autopilot model/harness onto the enqueued item — so the dispatch
    // carries the configured pair, on the identical rail already proven for the
    // step-kind rows above. (Downstream execution of item.model/item.harness is
    // the same consumption path as every other kind.)
    const store = capturingStore();
    const prefs = await prefsWith({
      model: 'ws-model', harness: 'ws-harness',
      byKind: { autopilot: { model: 'anthropic/claude-sonnet-5', harness: 'claude-code' } }
    });
    await createDispatchItem({ store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'autopilot', prompt: 'x' });
    assert.equal(store.captured.item.kind, 'autopilot');
    assert.equal(store.captured.item.model, 'anthropic/claude-sonnet-5');
    assert.equal(store.captured.item.harness, 'claude-code');
  });

  test('an explicit model/harness wins over configured defaults', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    await createDispatchItem({
      store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation',
      model: 'explicit-model', harness: 'explicit-harness', prompt: 'x'
    });
    assert.equal(store.captured.item.model, 'explicit-model');
    assert.equal(store.captured.item.harness, 'explicit-harness');
  });

  test('model and harness resolve independently', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    await createDispatchItem({
      store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation',
      model: 'explicit-model', prompt: 'x'
    });
    assert.equal(store.captured.item.model, 'explicit-model');
    assert.equal(store.captured.item.harness, 'ws-harness');
  });
});

describe('createDispatchItem — applyDefaultHarness opt-out', () => {
  test('applyDefaultHarness:false leaves a blank harness null', async () => {
    const store = capturingStore();
    await createDispatchItem({ store, urlKey: 'acme', kind: 'implementation', prompt: 'x', applyDefaultHarness: false });
    assert.strictEqual(store.captured.item.harness, null);
  });

  test('applyDefaultHarness:false still honours a resolved default', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ harness: 'opencode' });
    await createDispatchItem({
      store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation', prompt: 'x', applyDefaultHarness: false
    });
    assert.strictEqual(store.captured.item.harness, 'opencode');
  });
});

describe('createDispatchItem — finalizePrompt ordering', () => {
  test('finalizePrompt receives the RESOLVED harness, before addItem', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ harness: 'ws-harness' });
    let sawHarness;
    await createDispatchItem({
      store, urlKey: 'acme', workspacePreferencesStore: prefs, kind: 'implementation',
      finalizePrompt: (resolvedHarness) => {
        sawHarness = resolvedHarness;
        return { prompt: `final:${resolvedHarness}`, bootstrapToken: 'tok-1' };
      },
      fields: { target: 'cli' }
    });
    // The append saw the resolved workspace harness (not the blank input)...
    assert.equal(sawHarness, 'ws-harness');
    // ...and the returned prompt + bootstrapToken landed on the item.
    assert.equal(store.captured.item.prompt, 'final:ws-harness');
    assert.equal(store.captured.item.bootstrapToken, 'tok-1');
    assert.equal(store.captured.item.harness, 'ws-harness');
  });

  test('finalizePrompt sees the interposed claude-code default when no default is configured', async () => {
    const store = capturingStore();
    let sawHarness;
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation',
      finalizePrompt: (resolvedHarness) => { sawHarness = resolvedHarness; return { prompt: 'p', bootstrapToken: null }; }
    });
    assert.equal(sawHarness, 'claude-code');
  });

  test('no finalizePrompt: the plain prompt passes through, bootstrapToken null', async () => {
    const store = capturingStore();
    await createDispatchItem({ store, urlKey: 'acme', kind: 'custom', prompt: 'plain body', fields: { target: 'cli' } });
    assert.equal(store.captured.item.prompt, 'plain body');
    assert.strictEqual(store.captured.item.bootstrapToken, null);
  });
});

describe('createDispatchItem — followUpTo issue inheritance (LIN-1292)', () => {
  // The reply-box producer (public/session.js) posts only { prompt, followUpTo,
  // target } — no issue* fields. `_buildLoops` requires a truthy issueIdentifier
  // to build a loop at all (its malformed-row guard), so an issue-less follow-up
  // is invisible everywhere — not merely unstitched — unless something backfills
  // it. The factory does that here, from the followUpTo target, without touching
  // the producer.
  test('an issue-less follow-up inherits issueId/issueIdentifier/issueTitle/issueUrl from its followUpTo target', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { id: 'anchor-1', issueId: 'uuid-1', issueIdentifier: 'LIN-1292', issueTitle: 'Standalone repro', issueUrl: 'https://linear.app/x/LIN-1292' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'one more thing', fields: { followUpTo: 'anchor-1', target: 'cli' }
    });
    assert.equal(store.captured.item.issueId, 'uuid-1');
    assert.equal(store.captured.item.issueIdentifier, 'LIN-1292');
    assert.equal(store.captured.item.issueTitle, 'Standalone repro');
    assert.equal(store.captured.item.issueUrl, 'https://linear.app/x/LIN-1292');
  });

  test('an explicit issueIdentifier on the follow-up is never overridden', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { id: 'anchor-1', issueIdentifier: 'LIN-1292', issueTitle: 'Anchor title' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', issueIdentifier: 'LIN-9999', target: 'cli' }
    });
    assert.equal(store.captured.item.issueIdentifier, 'LIN-9999');
    // No ISSUE-field inheritance was attempted once the caller supplied its own
    // issueIdentifier (the anchor lookup itself still runs — LIN-1341's session-
    // group inheritance rides the same lookup regardless of issueIdentifier).
    assert.strictEqual(store.captured.item.issueTitle, undefined);
  });

  test('a follow-up whose target has aged out / is unresolvable stays issue-less (unchanged behavior)', async () => {
    const store = capturingStoreWithItems({});
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x', fields: { followUpTo: 'ghost', target: 'cli' }
    });
    assert.strictEqual(store.captured.item.issueIdentifier, undefined);
  });

  test('a store without getItemStatus (test fakes) is a no-op, never throws', async () => {
    const store = capturingStore(); // no getItemStatus method
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x', fields: { followUpTo: 'anchor-1', target: 'cli' }
    });
    assert.strictEqual(store.captured.item.issueIdentifier, undefined);
  });

  test('no followUpTo: inheritance is never attempted (byte-identical to before)', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': { issueIdentifier: 'LIN-1' } });
    await createDispatchItem({ store, urlKey: 'acme', prompt: 'x', fields: { target: 'cli' } });
    assert.strictEqual(store.captured.item.issueIdentifier, undefined);
  });
});

describe('createDispatchItem — sessionGroupId inheritance (LIN-1341)', () => {
  test('a follow-up inherits its anchor\'s own sessionGroupId', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { id: 'anchor-1', issueIdentifier: 'LIN-1', sessionGroupId: 'grp-root' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'one more thing', fields: { followUpTo: 'anchor-1', target: 'cli' }
    });
    assert.equal(store.captured.item.sessionGroupId, 'grp-root');
  });

  test('a follow-up to an autopilot worker inherits the worker\'s sessionId as the group (composes with sessionId grouping)', async () => {
    // The worker itself predates a followUpTo of its own, so it carries no
    // sessionGroupId yet — the anchor's own sessionId is the next fallback,
    // which equals the orchestrator's session id.
    const store = capturingStoreWithItems({
      'w1': { id: 'w1', issueIdentifier: 'LIN-1', sessionId: 'ap-1', sessionGroupId: null }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'reply', fields: { followUpTo: 'w1', target: 'cli' }
    });
    assert.equal(store.captured.item.sessionGroupId, 'ap-1');
  });

  test('a follow-up to a pre-field (un-stamped) anchor self-heals onto the anchor\'s own dispatch id', async () => {
    const store = capturingStoreWithItems({
      'orig': { id: 'orig', issueIdentifier: 'LIN-1' } // no sessionGroupId, no sessionId — legacy row
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'reply', fields: { followUpTo: 'orig', target: 'cli' }
    });
    assert.equal(store.captured.item.sessionGroupId, 'orig');
  });

  test('session-group inheritance still runs even when the caller supplies its own issueIdentifier', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { id: 'anchor-1', issueIdentifier: 'LIN-1292', sessionGroupId: 'grp-root' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x',
      fields: { followUpTo: 'anchor-1', issueIdentifier: 'LIN-9999', target: 'cli' }
    });
    assert.equal(store.captured.item.sessionGroupId, 'grp-root');
  });

  test('a follow-up whose anchor is unresolvable (aged out) inherits no group — the store mints its own root', async () => {
    const store = capturingStoreWithItems({});
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x', fields: { followUpTo: 'ghost', target: 'cli' }
    });
    assert.strictEqual(store.captured.item.sessionGroupId, undefined);
  });

  test('a store without getItemStatus (test fakes) is a no-op, never throws', async () => {
    const store = capturingStore(); // no getItemStatus method
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x', fields: { followUpTo: 'anchor-1', target: 'cli' }
    });
    assert.strictEqual(store.captured.item.sessionGroupId, undefined);
  });

  test('no followUpTo: no group id is inherited (the store mints its own root)', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': { issueIdentifier: 'LIN-1', sessionGroupId: 'grp-root' } });
    await createDispatchItem({ store, urlKey: 'acme', prompt: 'x', fields: { target: 'cli' } });
    assert.strictEqual(store.captured.item.sessionGroupId, undefined);
  });
});

describe('createDispatchItem — rootItemId inheritance (LIN-1468)', () => {
  test('a follow-up inherits its anchor\'s own rootItemId', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { id: 'anchor-1', issueIdentifier: 'LIN-1', rootItemId: 'root-1' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'one more thing', fields: { followUpTo: 'anchor-1', target: 'cli' }
    });
    assert.equal(store.captured.item.rootItemId, 'root-1');
  });

  // The regression test for the single most likely implementation error: a
  // rootItemId tier on `anchor.sessionId` would collapse every sibling worker
  // an autopilot spawns onto one anchor (LIN-1461's sibling-collapse bug,
  // reinstated in a new field). Unlike sessionGroupId inheritance immediately
  // above, this must NOT fall back to the anchor's sessionId.
  test('a follow-up to an autopilot worker does NOT inherit rootItemId from the worker\'s sessionId', async () => {
    const store = capturingStoreWithItems({
      'w1': { id: 'w1', issueIdentifier: 'LIN-1', sessionId: 'ap-1', rootItemId: null }
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'reply', fields: { followUpTo: 'w1', target: 'cli' }
    });
    assert.notEqual(store.captured.item.rootItemId, 'ap-1');
    assert.equal(store.captured.item.rootItemId, 'w1', 'falls through to the anchor\'s own dispatch id, not its sessionId');
  });

  test('a follow-up to a pre-field (un-stamped) anchor self-heals onto the anchor\'s own dispatch id', async () => {
    const store = capturingStoreWithItems({
      'orig': { id: 'orig', issueIdentifier: 'LIN-1' } // no rootItemId — legacy row
    });
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'reply', fields: { followUpTo: 'orig', target: 'cli' }
    });
    assert.equal(store.captured.item.rootItemId, 'orig');
  });

  test('a follow-up whose anchor is unresolvable (aged out) inherits no anchor — the store mints its own root', async () => {
    const store = capturingStoreWithItems({});
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x', fields: { followUpTo: 'ghost', target: 'cli' }
    });
    assert.strictEqual(store.captured.item.rootItemId, undefined);
  });

  test('a store without getItemStatus (test fakes) is a no-op, never throws', async () => {
    const store = capturingStore(); // no getItemStatus method
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'x', fields: { followUpTo: 'anchor-1', target: 'cli' }
    });
    assert.strictEqual(store.captured.item.rootItemId, undefined);
  });

  test('no followUpTo: no anchor is inherited (the store mints its own root)', async () => {
    const store = capturingStoreWithItems({ 'anchor-1': { issueIdentifier: 'LIN-1', rootItemId: 'root-1' } });
    await createDispatchItem({ store, urlKey: 'acme', prompt: 'x', fields: { target: 'cli' } });
    assert.strictEqual(store.captured.item.rootItemId, undefined);
  });
});

describe('createDispatchItem — field passthrough', () => {
  test('caller fields are spread onto the item, factory-owned fields override', async () => {
    const store = capturingStore();
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'triage', prompt: 'x',
      fields: {
        promptName: 'Triage', issueIdentifier: 'LIN-9', target: 'cli',
        dispatchedBy: 'u1', force: true, waitForFollowUps: true,
      }
    });
    assert.deepEqual(store.captured.item, {
      promptName: 'Triage', issueIdentifier: 'LIN-9', target: 'cli',
      dispatchedBy: 'u1', force: true, waitForFollowUps: true,
      prompt: 'x', kind: 'triage', model: null, harness: 'claude-code', bootstrapToken: null,
      presetConfig: null, presetName: null,
    });
    assert.equal(store.captured.urlKey, 'acme');
  });
});

describe('createDispatchItem — dispatch preset routing precedence (LIN-1390)', () => {
  test('explicit incoming model/harness beats a selected preset', async () => {
    const store = capturingStore();
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'P', config: { model: 'preset-model', harness: 'preset-harness' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      model: 'explicit-model', harness: 'explicit-harness',
      dispatchPresetsStore: presetsStore, presetId: 'p1'
    });
    assert.equal(store.captured.item.model, 'explicit-model');
    assert.equal(store.captured.item.harness, 'explicit-harness');
  });

  test('a selected preset beats workspace dispatchDefaults', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'P', config: { model: 'preset-model', harness: 'preset-harness' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      workspacePreferencesStore: prefs, dispatchPresetsStore: presetsStore, presetId: 'p1'
    });
    assert.equal(store.captured.item.model, 'preset-model');
    assert.equal(store.captured.item.harness, 'preset-harness');
  });

  test('a selected preset blends its own byKind override with its top-level default', async () => {
    const store = capturingStore();
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'P', config: { model: 'top-model', byKind: { implementation: { harness: 'kind-harness' } } } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      dispatchPresetsStore: presetsStore, presetId: 'p1'
    });
    assert.equal(store.captured.item.model, 'top-model');
    assert.equal(store.captured.item.harness, 'kind-harness');
  });

  test('an unknown/invalid presetId resolves to no preset rather than throwing', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    const presetsStore = presetsStoreWith({});
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      workspacePreferencesStore: prefs, dispatchPresetsStore: presetsStore, presetId: 'ghost'
    });
    assert.equal(store.captured.item.model, 'ws-model');
    assert.equal(store.captured.item.harness, 'ws-harness');
  });

  test('inherited anchor presetConfig beats workspace defaults when no preset is selected', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { issueIdentifier: 'LIN-1', presetConfig: { model: 'anchor-model', harness: 'anchor-harness' }, presetName: 'Anchor Preset' }
    });
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      workspacePreferencesStore: prefs, fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.model, 'anchor-model');
    assert.equal(store.captured.item.harness, 'anchor-harness');
  });

  test('a selected preset beats an inherited anchor presetConfig', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { issueIdentifier: 'LIN-1', presetConfig: { model: 'anchor-model', harness: 'anchor-harness' } }
    });
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'P', config: { model: 'preset-model', harness: 'preset-harness' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      dispatchPresetsStore: presetsStore, presetId: 'p1', fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.model, 'preset-model');
    assert.equal(store.captured.item.harness, 'preset-harness');
  });

  test('an anchor with no explicit preset marker falls through to workspace defaults (byte-identical to pre-LIN-1390)', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { issueIdentifier: 'LIN-1' } // no presetConfig — no marker
    });
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      workspacePreferencesStore: prefs, fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.model, 'ws-model');
    assert.equal(store.captured.item.harness, 'ws-harness');
    assert.strictEqual(store.captured.item.presetConfig, null);
  });

  test('a standalone (non-followUpTo) autopilot dispatch degrades to workspace defaults — no anchor to inherit from', async () => {
    const store = capturingStore();
    const prefs = await prefsWith({ model: 'ws-model', harness: 'ws-harness' });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x', workspacePreferencesStore: prefs
    });
    assert.equal(store.captured.item.model, 'ws-model');
    assert.equal(store.captured.item.harness, 'ws-harness');
    assert.strictEqual(store.captured.item.presetConfig, null);
  });
});

describe('createDispatchItem — anchor harness inheritance (LIN-1431)', () => {
  test('a follow-up inherits the anchor\'s harness when none is explicit', async () => {
    const store = capturingStoreWithItemsCounted({
      'anchor-1': { issueIdentifier: 'LIN-1', harness: 'claude-code' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      applyDefaultHarness: false, fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.harness, 'claude-code');
    assert.ok(store.getItemStatusCalls > 0, 'the anchor must actually be consulted');
  });

  test('a blank-harness anchor inherits nothing and stays null (the safety property)', async () => {
    const store = capturingStoreWithItemsCounted({
      'anchor-1': { issueIdentifier: 'LIN-1', harness: null }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      applyDefaultHarness: false, fields: { followUpTo: 'anchor-1' }
    });
    assert.strictEqual(store.captured.item.harness, null);
    assert.ok(store.getItemStatusCalls > 0, 'the anchor must actually be consulted');
  });

  test('an explicit harness beats the anchor', async () => {
    const store = capturingStoreWithItemsCounted({
      'anchor-1': { issueIdentifier: 'LIN-1', harness: 'opencode' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      harness: 'claude-code', applyDefaultHarness: false, fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.harness, 'claude-code');
  });

  test('a selected preset beats the anchor', async () => {
    const store = capturingStoreWithItemsCounted({
      'anchor-1': { issueIdentifier: 'LIN-1', harness: 'opencode' }
    });
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'P', config: { harness: 'preset-harness' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      applyDefaultHarness: false, dispatchPresetsStore: presetsStore, presetId: 'p1',
      fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.harness, 'preset-harness');
  });

  test('the anchor beats the workspace default', async () => {
    const store = capturingStoreWithItemsCounted({
      'anchor-1': { issueIdentifier: 'LIN-1', harness: 'claude-code' }
    });
    const prefs = await prefsWith({ harness: 'ws-harness' });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      applyDefaultHarness: false, workspacePreferencesStore: prefs, fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.harness, 'claude-code');
  });

  test('the anchor\'s presetConfig still beats a plain anchor.harness (LIN-1390 precedence untouched)', async () => {
    const store = capturingStoreWithItemsCounted({
      'anchor-1': { issueIdentifier: 'LIN-1', harness: 'opencode', presetConfig: { harness: 'preset-config-harness' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      applyDefaultHarness: false, fields: { followUpTo: 'anchor-1' }
    });
    assert.equal(store.captured.item.harness, 'preset-config-harness');
  });

  test('a fresh dispatch (no followUpTo) is byte-identical: no anchor lookup, harness resolution unchanged', async () => {
    const store = capturingStoreWithItemsCounted({});
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x', applyDefaultHarness: false
    });
    assert.strictEqual(store.captured.item.harness, null);
    assert.equal(store.getItemStatusCalls, 0, 'no followUpTo means the anchor is never looked up');
  });
});

describe('createDispatchItem — presetConfig/presetName stamping (LIN-1390)', () => {
  test('a selected preset stamps presetConfig/presetName on an autopilot row', async () => {
    const store = capturingStore();
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'My Preset', config: { model: 'preset-model' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      dispatchPresetsStore: presetsStore, presetId: 'p1'
    });
    assert.deepEqual(store.captured.item.presetConfig, { model: 'preset-model' });
    assert.equal(store.captured.item.presetName, 'My Preset');
  });

  test('an inherited anchor presetConfig is stamped on the child autopilot row (transitivity)', async () => {
    // Preset P dispatched on the anchor; a child-autopilot follow-up with no
    // explicit presetId still carries P's config forward, so ITS OWN children
    // (asserted on the child's row, never the parent's) inherit it too.
    const store = capturingStoreWithItems({
      'anchor-1': { issueIdentifier: 'LIN-1', presetConfig: { model: 'preset-model', harness: 'preset-harness' }, presetName: 'P' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x', fields: { followUpTo: 'anchor-1' }
    });
    assert.deepEqual(store.captured.item.presetConfig, { model: 'preset-model', harness: 'preset-harness' });
    assert.equal(store.captured.item.presetName, 'P');
  });

  test('a selected preset on a non-autopilot kind resolves routing but does NOT stamp presetConfig', async () => {
    const store = capturingStore();
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'My Preset', config: { model: 'preset-model', harness: 'preset-harness' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x',
      dispatchPresetsStore: presetsStore, presetId: 'p1'
    });
    assert.equal(store.captured.item.model, 'preset-model', 'routing still resolves through the preset');
    assert.strictEqual(store.captured.item.presetConfig, null, 'non-autopilot rows never stamp presetConfig');
    assert.strictEqual(store.captured.item.presetName, null);
  });

  test('an inherited anchor presetConfig is NOT stamped on a non-autopilot follow-up', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { issueIdentifier: 'LIN-1', presetConfig: { model: 'preset-model' }, presetName: 'P' }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'implementation', prompt: 'x', fields: { followUpTo: 'anchor-1' }
    });
    assert.strictEqual(store.captured.item.presetConfig, null);
    assert.strictEqual(store.captured.item.presetName, null);
  });

  test('a selected preset beats an inherited anchor for STAMPING too (not just routing)', async () => {
    const store = capturingStoreWithItems({
      'anchor-1': { issueIdentifier: 'LIN-1', presetConfig: { model: 'anchor-model' }, presetName: 'Anchor Preset' }
    });
    const presetsStore = presetsStoreWith({
      p1: { id: 'p1', name: 'Selected Preset', config: { model: 'preset-model' } }
    });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      dispatchPresetsStore: presetsStore, presetId: 'p1', fields: { followUpTo: 'anchor-1' }
    });
    assert.deepEqual(store.captured.item.presetConfig, { model: 'preset-model' });
    assert.equal(store.captured.item.presetName, 'Selected Preset');
  });
});

describe('createDispatchItem — presetConfig snapshot semantics (LIN-1390)', () => {
  test('the stamped presetConfig is a deep copy — mutating the store-returned preset never reaches the dispatched item', async () => {
    const store = capturingStore();
    const livePreset = { id: 'p1', name: 'P', config: { model: 'X', byKind: { autopilot: { harness: 'h1' } } } };
    const presetsStore = { get: async () => livePreset };
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      dispatchPresetsStore: presetsStore, presetId: 'p1'
    });
    // Mutate the "live" preset object after dispatch (simulating an update to
    // the store) — the already-dispatched item's snapshot must be unaffected.
    livePreset.config.model = 'Y';
    livePreset.config.byKind.autopilot.harness = 'h2';
    assert.equal(store.captured.item.presetConfig.model, 'X');
    assert.equal(store.captured.item.presetConfig.byKind.autopilot.harness, 'h1');
  });

  test('the stamped presetConfig is not the same object reference as the source config', async () => {
    const store = capturingStore();
    const sourceConfig = { model: 'X' };
    const presetsStore = presetsStoreWith({ p1: { id: 'p1', name: 'P', config: sourceConfig } });
    await createDispatchItem({
      store, urlKey: 'acme', kind: 'autopilot', prompt: 'x',
      dispatchPresetsStore: presetsStore, presetId: 'p1'
    });
    assert.notStrictEqual(store.captured.item.presetConfig, sourceConfig);
    assert.deepEqual(store.captured.item.presetConfig, sourceConfig);
  });
});

/**
 * LIN-1656 — the duplicate-dispatch guard.
 *
 * Two independent orchestrators (the autopilot loop and a human/companion driving
 * the board) can each dispatch the same issue+kind minutes apart, because nothing
 * on the creation path checked whether a live dispatch already existed. The guard
 * refuses a FRESH dispatch when an equivalent one was created inside a 5-minute
 * recency window.
 *
 * THE MATRIX IS WEIGHTED TO THE NEGATIVES ON PURPOSE. Wrong in the permissive
 * direction, this guard merely does nothing; wrong in the restrictive direction it
 * silently blocks legitimate work — the exact failure that got the `status: taken`
 * shape rejected at a measured 9.0% false-refusal rate. So 8 of these 13 cases
 * prove the guard does NOT fire, and they are built so that a maximally
 * restrictive guard would fail them:
 *
 *   - Cases whose discrimination happens in the STORE QUERY (different kind,
 *     different urlKey, an abort row as the prior, the window edges) run against a
 *     REAL DispatchQueueStore over mock collections. A fake that answered "no
 *     duplicate" would pass vacuously; a real store must actually filter.
 *   - Cases whose discrimination happens in the factory's ENTRY GATE (followUpTo
 *     set, abort requested, no issueIdentifier) run against `alwaysDuplicateStore`
 *     — a store that reports a duplicate for EVERY lookup. They can only pass if
 *     the gate short-circuits before the lookup runs, so an "always refuse" guard
 *     fails them by construction.
 */

const PRIOR = { id: 'prior-dispatch-id', dispatchedAt: new Date('2026-07-26T12:00:00.000Z') };

// A capturing store whose duplicate lookup ALWAYS reports a prior, with a call
// counter. Used by the entry-gate negatives: if the gate ever lets the lookup run
// for them, they refuse and the test fails.
function alwaysDuplicateStore() {
  const store = capturingStore();
  let lookupCalls = 0;
  store.findRecentFreshDispatch = async (urlKey, opts) => {
    lookupCalls++;
    store.lastLookup = { urlKey, ...opts };
    return PRIOR;
  };
  Object.defineProperty(store, 'lookupCalls', { get: () => lookupCalls });
  return store;
}

// A real store over mock collections, with addItem call-counted so a refusal can
// be proven to have written nothing.
function realStore() {
  const store = new DispatchQueueStore({
    collection: createDocCollection(),
    historyCollection: createDocCollection()
  });
  let addItemCalls = 0;
  const rawAddItem = store.addItem.bind(store);
  store.addItem = async (...args) => { addItemCalls++; return rawAddItem(...args); };
  Object.defineProperty(store, 'addItemCalls', { get: () => addItemCalls });
  return store;
}

// The ordinary fresh-dispatch shape: an implementation dispatch for one issue.
function freshDispatch(store, over = {}) {
  return createDispatchItem({
    store,
    urlKey: over.urlKey || 'acme',
    kind: over.kind,
    now: over.now,
    prompt: 'x',
    finalizePrompt: over.finalizePrompt,
    fields: { promptName: 'implementation', issueIdentifier: 'LIN-1', ...(over.fields || {}) }
  });
}

describe('createDispatchItem — duplicate-dispatch guard, positives (LIN-1656)', () => {
  // P1
  test('a second fresh dispatch for the same issue+kind inside the window is refused, and nothing is enqueued', async () => {
    const store = realStore();
    await freshDispatch(store);
    assert.equal(store.addItemCalls, 1);

    await assert.rejects(() => freshDispatch(store), err => err.status === 409);
    assert.equal(store.addItemCalls, 1, 'a refused dispatch must not reach addItem');
  });

  // P2
  test('the refusal carries the machine-readable fields a caller branches on', async () => {
    const store = realStore();
    const first = await freshDispatch(store);

    const err = await freshDispatch(store).then(() => null, e => e);
    assert.ok(err, 'expected a refusal');
    assert.equal(err.status, 409);
    assert.equal(err.duplicateDispatch.code, 'DUPLICATE_DISPATCH');
    assert.equal(err.duplicateDispatch.id, first._id,
      'the refusal must name the LIVE dispatch so the caller can watch it instead of re-dispatching');
    assert.equal(err.duplicateDispatch.issueIdentifier, 'LIN-1');
    assert.equal(err.duplicateDispatch.kind, 'implementation');
    assert.equal(err.duplicateDispatch.dispatchedAt, first.dispatchedAt.toISOString());
    assert.ok(err.duplicateDispatch.retryAfter > 0 && err.duplicateDispatch.retryAfter <= 300,
      `retryAfter must be in (0, 300], got ${err.duplicateDispatch.retryAfter}`);
    assert.match(err.message, /created moments ago/);
  });

  // P3 — pins the PLACEMENT: refusing after finalizePrompt would mint and orphan a
  // single-use bootstrap credential nobody can exchange.
  test('the refusal precedes finalizePrompt, so no bootstrap credential is minted', async () => {
    const store = realStore();
    await freshDispatch(store);

    let mints = 0;
    await assert.rejects(
      () => freshDispatch(store, {
        finalizePrompt: () => { mints++; return { prompt: 'x', bootstrapToken: 'tok' }; }
      }),
      err => err.status === 409
    );
    assert.equal(mints, 0, 'finalizePrompt must never run on a refused dispatch');
  });

  // P4 — the COMMON real case: the runner polls every ~5s, so a 2-minute-old
  // dispatch has already been claimed and archived. A queue-only lookup fails here.
  test('a prior that has been taken (and so lives only in history) still refuses', async () => {
    const store = realStore();
    const first = await freshDispatch(store);
    await store.takeItem(first._id, 'acme');
    assert.equal((await store.listItems('acme')).length, 0, 'the prior must have left the queue');

    const err = await freshDispatch(store).then(() => null, e => e);
    assert.ok(err, 'a history-only prior must still refuse');
    assert.equal(err.duplicateDispatch.id, first._id);
  });
});

describe('createDispatchItem — duplicate-dispatch guard, negatives (LIN-1656)', () => {
  // N1 — the normal pipeline runs research → plan → implementation on one issue
  // within minutes. Real store: the `kind` clause in the query must do this.
  test('a different kind for the same issue in the same instant is allowed', async () => {
    const store = realStore();
    await freshDispatch(store, { kind: 'implementation' });
    await freshDispatch(store, { kind: 'plan' });
    await freshDispatch(store, { kind: 'review' });
    assert.equal(store.addItemCalls, 3, 'same-issue different-kind pairs are the normal pipeline');
  });

  // N2 — a follow-up IS the intended second dispatch (beat drips, wakes).
  // alwaysDuplicateStore: only the entry gate can save this.
  test('a followUpTo dispatch with an identical issue+kind is allowed, and never even consults the lookup', async () => {
    const store = alwaysDuplicateStore();
    await freshDispatch(store, { fields: { followUpTo: 'prior-id' } });
    assert.equal(store.captured.item.followUpTo, 'prior-id');
    assert.equal(store.lookupCalls, 0, 'the gate must short-circuit before the lookup');
  });

  // N3, both directions.
  test('an abort dispatch is allowed (a cascade emits one per descendant in the same second)', async () => {
    const store = alwaysDuplicateStore();
    await freshDispatch(store, { fields: { abort: true, abortTo: 'some-session' } });
    assert.equal(store.captured.item.abort, true);
    assert.equal(store.lookupCalls, 0, 'the gate must short-circuit before the lookup');
  });

  test('an existing abort row is never matchable as the prior', async () => {
    const store = realStore();
    await freshDispatch(store, { fields: { abort: true, abortTo: 'some-session' } });
    await freshDispatch(store);
    assert.equal(store.addItemCalls, 2, 'an abort row must not block the real dispatch that follows it');
  });

  // N4 — the window edges, with an injected clock. The store stamps dispatchedAt
  // from its OWN clock, so the prior is seeded directly to control it.
  describe('the recency window edges', () => {
    const t0 = new Date('2026-07-26T12:00:00.000Z');
    const seedPrior = store => store.collection.insertOne({
      _id: 'prior', urlKey: 'acme', issueIdentifier: 'LIN-1', kind: 'implementation',
      followUpTo: null, abort: false, prompt: 'x', dispatchedAt: t0,
      expiresAt: new Date(t0.getTime() + 86_400_000)
    });

    test('299s after the prior is still inside the window and refuses', async () => {
      const store = realStore();
      await seedPrior(store);
      await assert.rejects(
        () => freshDispatch(store, { now: () => t0.getTime() + 299_000 }),
        err => err.status === 409 && err.duplicateDispatch.id === 'prior'
      );
      assert.equal(store.addItemCalls, 0);
    });

    test('301s after the prior is outside the window and dispatches', async () => {
      const store = realStore();
      await seedPrior(store);
      await freshDispatch(store, { now: () => t0.getTime() + 301_000 });
      assert.equal(store.addItemCalls, 1, 'the window is self-clearing — nothing is permanently blocked');
    });

    test('the window is the documented 5 minutes', () => {
      assert.equal(DUPLICATE_DISPATCH_WINDOW_MS, 5 * 60 * 1000);
    });
  });

  // N5 — urlKey is the first clause; a duplicate elsewhere is not a duplicate.
  test('the same issue+kind dispatched to a different workspace is allowed', async () => {
    const store = realStore();
    await freshDispatch(store, { urlKey: 'acme' });
    await freshDispatch(store, { urlKey: 'other-workspace' });
    assert.equal(store.addItemCalls, 2);
  });

  // N6 — collective fan-out and a stack-walk kickoff carry no issue identity.
  test('a dispatch with no issueIdentifier is allowed, and never consults the lookup', async () => {
    const store = alwaysDuplicateStore();
    await freshDispatch(store, { fields: { issueIdentifier: null } });
    await freshDispatch(store, { fields: { issueIdentifier: undefined } });
    assert.equal(store.lookupCalls, 0, 'there is nothing to key on, so the gate must short-circuit');
  });

  // N7 — the documented fail-open. This seam has never hard-required a read
  // capability; failing closed would turn a store-shape mismatch into a total
  // dispatch outage (and every addItem-only route fake would start refusing).
  test('a store without the lookup capability skips the guard and dispatches', async () => {
    const store = capturingStore();  // addItem only — no findRecentFreshDispatch
    await freshDispatch(store);
    await freshDispatch(store);
    assert.equal(store.captured.item.issueIdentifier, 'LIN-1');
  });

  // N8 — the anti-vacuous-green pin (LIN-1431's trap). Without this, every
  // negative above could still pass with the guard deleted entirely.
  test('the ordinary fresh path DOES consult the lookup, with the resolved kind and the window', async () => {
    const store = capturingStore();
    let lookups = 0;
    let seen = null;
    store.findRecentFreshDispatch = async (urlKey, opts) => { lookups++; seen = { urlKey, ...opts }; return null; };

    const now = new Date('2026-07-26T12:00:00.000Z').getTime();
    await freshDispatch(store, { now: () => now });

    assert.equal(lookups, 1, 'the guard must actually run on the ordinary path');
    assert.equal(seen.urlKey, 'acme');
    assert.equal(seen.issueIdentifier, 'LIN-1');
    assert.equal(seen.kind, 'implementation',
      'the RESOLVED kind (derived from promptName), never the callers raw/absent kind');
    assert.equal(seen.since.getTime(), now - DUPLICATE_DISPATCH_WINDOW_MS);
  });

  // The lookup is evidence, not a gate on dispatching at all: a store whose read
  // fails must not take the dispatch path down with it.
  test('a lookup that throws fails OPEN — the dispatch still lands', async () => {
    const store = capturingStore();
    store.findRecentFreshDispatch = async () => { throw new Error('db unavailable'); };
    await freshDispatch(store);
    assert.equal(store.captured.item.issueIdentifier, 'LIN-1');
  });
});
