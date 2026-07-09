/**
 * Unit tests for the structured bootstrap-token field plumbing (LIN-1155).
 *
 * Unlike `model`/`harness` (which are carried through EVERY seam incl. history),
 * `bootstrapToken` is a LIVE, single-use credential with a deliberately NARROW
 * exposure: it must reach the consumer on the poll/take response (_formatItem)
 * so the claude-code harness can hand it to a primed MCP tool, but it must NOT
 * be persisted into the 30-day history (_archiveItem / _formatHistoryItem). These
 * tests pin that asymmetry — a future edit that leaks it into history/watch
 * fails here.
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

const TOKEN = 'BOOTSTRAP_TOK_123';

test('addItem persists bootstrapToken on the stored doc', async () => {
  const store = makeStore();
  const doc = await store.addItem('acme', { prompt: 'run me', bootstrapToken: TOKEN });
  assert.equal(doc.bootstrapToken, TOKEN);
});

test('addItem defaults bootstrapToken to null (not undefined) when absent', async () => {
  const store = makeStore();
  const doc = await store.addItem('acme', { prompt: 'fresh task' });
  assert.strictEqual(doc.bootstrapToken, null);
});

test('the _formatItem seam (poll/listItems) exposes bootstrapToken to the consumer', async () => {
  const store = makeStore();
  await store.addItem('acme', { prompt: 'run me', bootstrapToken: TOKEN });
  const items = await store.pollAvailable('acme');
  assert.equal(items.length, 1);
  assert.equal(items[0].bootstrapToken, TOKEN);
});

test('takeItem (the claim response) hands bootstrapToken to the consumer', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', bootstrapToken: TOKEN });
  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.bootstrapToken, TOKEN, 'delivered on the take response');
});

test('bootstrapToken is NOT persisted into history (the security boundary)', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', bootstrapToken: TOKEN });

  // takeItem archives the doc to history. The take RESPONSE still carries the
  // token (read from the live doc before archival), but the archived copy must
  // not — a live credential should not sit in the 30-day history.
  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.bootstrapToken, TOKEN, 'take response has it');

  const status = await store.getItemStatus('acme', created._id);
  assert.strictEqual(status.bootstrapToken, undefined, 'watch/status history read must not carry it');

  const { items } = await store.listHistory('acme');
  assert.equal(items.length, 1);
  assert.strictEqual(items[0].bootstrapToken, undefined, 'history list must not carry it');
});

test('a dispatch with no bootstrapToken reads null on poll/take', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me' });

  const polled = await store.pollAvailable('acme');
  assert.strictEqual(polled[0].bootstrapToken, null);

  const taken = await store.takeItem(created._id, 'acme');
  assert.strictEqual(taken.bootstrapToken, null);
});

test('bootstrapToken coexists with harness on the same item', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'run me', harness: 'claude-code', bootstrapToken: TOKEN });
  const taken = await store.takeItem(created._id, 'acme');
  assert.equal(taken.harness, 'claude-code');
  assert.equal(taken.bootstrapToken, TOKEN);
});
