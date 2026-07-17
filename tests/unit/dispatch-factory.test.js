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
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { WorkspacePreferencesStore } from '../../lib/workspace-preferences.js';

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

async function prefsWith(defaults) {
  const store = new WorkspacePreferencesStore({ collection: createMockCollection() });
  if (defaults) await store.saveWorkspacePreferences('acme', { dispatchDefaults: defaults });
  return store;
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
    });
    assert.equal(store.captured.urlKey, 'acme');
  });
});
