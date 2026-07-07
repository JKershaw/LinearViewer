/**
 * Unit tests for the execution-model field plumbing (LIN-438).
 *
 * `model` is an optional, nullable, opaque string carried alongside `repo`: it
 * names the EXECUTION model the consumer/runner should pass to its own CLI
 * (e.g. `claude --model`) to RUN the dispatched prompt — NOT the server-side
 * generation model that WRITES prompts. The store records and forwards it
 * blindly; these tests pin that the field survives every seam a consumer reads
 * — addItem persistence, the _formatItem seam that poll/take hand to the
 * consumer, and the history records — and that it defaults to null (never
 * undefined) so a null value preserves the consumer's current default.
 *
 * `harness` (LIN-1084) is the sibling execution field naming which harness
 * (e.g. 'claude-code', 'opencode') should run the prompt; it mirrors `model`'s
 * plumbing exactly, so the same seams are pinned here.
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

const MODEL = 'anthropic/claude-opus-4.8';
const HARNESS = 'opencode';

test('addItem persists model on the stored doc', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'run me', model: MODEL });

  assert.equal(doc.model, MODEL);
});

test('addItem defaults model to null (not undefined) when absent', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.strictEqual(doc.model, null);
});

test('addItem coerces a falsy/omitted model to null', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task', model: '' });

  assert.strictEqual(doc.model, null);
});

test('the _formatItem seam (poll/listItems) exposes model to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'run me', model: MODEL });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].model, MODEL);
});

test('takeItem (the other _formatItem path) hands model to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', model: MODEL });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.model, MODEL);
});

test('model is carried into history (watch status + history list)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', model: MODEL });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.model, MODEL);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].model, MODEL);
});

test('a dispatch with no model reads model:null at every seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me' });

  const polled = await store.pollAvailable('acme');
  assert.strictEqual(polled[0].model, null);

  const taken = await store.takeItem(created._id, 'acme');
  assert.strictEqual(taken.model, null);

  const { items } = await store.listHistory('acme');
  assert.strictEqual(items[0].model, null);
});

test('model is opaque — an OpenRouter-style id with a slash and dots survives verbatim', async () => {
  const store = makeStore();
  // The store must not parse, normalize, or registry-check the value; the
  // consumer owns translation to its own CLI flag.
  const created = await store.addItem('acme', { prompt: 'run me', model: 'openai/gpt-5.4-mini' });

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.model, 'openai/gpt-5.4-mini');
});

test('addItem persists harness on the stored doc', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'run me', harness: HARNESS });

  assert.equal(doc.harness, HARNESS);
});

test('addItem defaults harness to null (not undefined) when absent', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task' });

  assert.strictEqual(doc.harness, null);
});

test('addItem coerces a falsy/omitted harness to null', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'fresh task', harness: '' });

  assert.strictEqual(doc.harness, null);
});

test('the _formatItem seam (poll/listItems) exposes harness to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'run me', harness: HARNESS });

  const items = await store.pollAvailable('acme');

  assert.equal(items.length, 1);
  assert.equal(items[0].harness, HARNESS);
});

test('takeItem (the other _formatItem path) hands harness to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', harness: HARNESS });

  const taken = await store.takeItem(created._id, 'acme');

  assert.equal(taken.harness, HARNESS);
});

test('harness is carried into history (watch status + history list)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', harness: HARNESS });

  // takeItem archives the doc to history.
  await store.takeItem(created._id, 'acme');

  const status = await store.getItemStatus('acme', created._id);
  assert.equal(status.harness, HARNESS);

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].harness, HARNESS);
});

test('a dispatch with no harness reads harness:null at every seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me' });

  const polled = await store.pollAvailable('acme');
  assert.strictEqual(polled[0].harness, null);

  const taken = await store.takeItem(created._id, 'acme');
  assert.strictEqual(taken.harness, null);

  const { items } = await store.listHistory('acme');
  assert.strictEqual(items[0].harness, null);
});

test('harness is opaque — survives verbatim alongside model', async () => {
  const store = makeStore();
  // The store must not parse, normalize, or registry-check the value.
  const created = await store.addItem('acme', { prompt: 'run me', harness: 'opencode', model: 'openai/gpt-5.4-mini' });

  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.harness, 'opencode');
  assert.equal(taken.model, 'openai/gpt-5.4-mini');
});
