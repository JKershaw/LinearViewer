/**
 * Unit tests for the presetConfig/presetName field plumbing (LIN-1390 S4).
 *
 * Mirrors tests/unit/dispatch-store-model.test.js's pattern for the sibling
 * model/harness fields: `presetConfig`/`presetName` are optional, nullable
 * fields the factory (lib/dispatch-factory.js) stamps on kind:'autopilot'
 * rows carrying a selected or inherited dispatch preset. Unlike
 * `bootstrapToken` these are NOT credentials, so — unlike bootstrapToken —
 * they are expected to survive into history and onto every read seam
 * (_formatItem, _formatHistoryItem, getItemStatus), which is exactly the seam
 * inheritance (a child-autopilot follow-up reading its anchor's presetConfig
 * back) depends on.
 *
 * The "echo honesty" and "inherit from an archived anchor" mandatory
 * verification themes (LIN-1390) are pinned here at the real-store level:
 * `getItemStatus` (the seam formatDispatchWatch's route handler AND the
 * factory's anchor-inheritance read both call) must reflect the SAME
 * model/harness/presetConfig/presetName as `_formatItem` (the take/poll
 * seam) — for both a still-queued AND an archived item.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

const PRESET_CONFIG = { model: 'anthropic/claude-opus-4.8', harness: 'opencode' };
const PRESET_NAME = 'My Preset';

test('addItem persists presetConfig/presetName on the stored doc', async () => {
  const store = makeStore();
  const doc = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', presetConfig: PRESET_CONFIG, presetName: PRESET_NAME });
  assert.deepEqual(doc.presetConfig, PRESET_CONFIG);
  assert.equal(doc.presetName, PRESET_NAME);
});

test('addItem defaults presetConfig/presetName to null (not undefined) when absent', async () => {
  const store = makeStore();
  const doc = await store.addItem('acme', { prompt: 'fresh task' });
  assert.strictEqual(doc.presetConfig, null);
  assert.strictEqual(doc.presetName, null);
});

test('the _formatItem seam (poll/listItems) exposes presetConfig/presetName to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', presetConfig: PRESET_CONFIG, presetName: PRESET_NAME });
  const items = await store.pollAvailable('acme');
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].presetConfig, PRESET_CONFIG);
  assert.equal(items[0].presetName, PRESET_NAME);
});

test('takeItem (the other _formatItem path) hands presetConfig/presetName to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', presetConfig: PRESET_CONFIG, presetName: PRESET_NAME });
  const taken = await store.takeItem(created._id, 'acme');
  assert.deepEqual(taken.presetConfig, PRESET_CONFIG);
  assert.equal(taken.presetName, PRESET_NAME);
});

test('presetConfig/presetName are carried into history (watch status + history list)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', kind: 'autopilot', presetConfig: PRESET_CONFIG, presetName: PRESET_NAME });

  // takeItem archives the doc to history — this is the ARCHIVED-anchor path:
  // by the time a descendant dispatches, the kickoff anchor is usually
  // already taken, so getItemStatus must resolve through _formatHistoryItem,
  // not only the still-queued active-collection branch.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.status, 'taken', 'sanity: resolved via the history branch, not the active queue');
  assert.deepEqual(status.presetConfig, PRESET_CONFIG);
  assert.equal(status.presetName, PRESET_NAME);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].presetConfig, PRESET_CONFIG);
  assert.equal(items[0].presetName, PRESET_NAME);
});

test('a dispatch with no preset reads presetConfig/presetName:null at every seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me' });

  const polled = await store.pollAvailable('acme');
  assert.strictEqual(polled[0].presetConfig, null);
  assert.strictEqual(polled[0].presetName, null);

  await store.takeItem(created._id, 'acme');
  const status = await store.getItemStatus('acme', created._id);
  assert.strictEqual(status.presetConfig, null);
  assert.strictEqual(status.presetName, null);

  const { items } = await store.listHistory('acme');
  assert.strictEqual(items[0].presetConfig, null);
  assert.strictEqual(items[0].presetName, null);
});

test('echo honesty: getItemStatus (the watch seam) and _formatItem (the take seam) agree on model/harness/presetConfig — while still queued', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', {
    prompt: 'run me', kind: 'autopilot', model: 'm1', harness: 'h1',
    presetConfig: PRESET_CONFIG, presetName: PRESET_NAME
  });

  const watch = await store.getItemStatus('acme', created._id);
  assert.equal(watch.status, 'queued', 'sanity: resolved via the active-queue branch');
  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(watch.model, taken.model);
  assert.equal(watch.harness, taken.harness);
  assert.deepEqual(watch.presetConfig, taken.presetConfig);
  assert.equal(watch.presetName, taken.presetName);
});

test('echo honesty: getItemStatus and _formatItem agree on model/harness/presetConfig — once archived', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', {
    prompt: 'run me', kind: 'autopilot', model: 'm1', harness: 'h1',
    presetConfig: PRESET_CONFIG, presetName: PRESET_NAME
  });
  const taken = await store.takeItem(created._id, 'acme');
  const watch = await store.getItemStatus('acme', created._id);

  assert.equal(watch.status, 'taken', 'sanity: resolved via the history branch');
  assert.equal(watch.model, taken.model);
  assert.equal(watch.harness, taken.harness);
  assert.deepEqual(watch.presetConfig, taken.presetConfig);
  assert.equal(watch.presetName, taken.presetName);
});
