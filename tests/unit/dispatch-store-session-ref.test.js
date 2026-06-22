/**
 * Unit tests for the autopilot session self-stamp (LIN-599).
 *
 * An autopilot run must forward its own dispatch id as `sessionId` on the worker
 * dispatches it spawns (LIN-591), but the id is minted inside addItem — after the
 * kickoff prompt was built. addItem closes that gap by appending a self-reference
 * block naming `doc._id` to the prompt, gated on `kind === 'autopilot'`. These
 * tests pin that the block carries the minted id, that it reaches the consumer
 * through the poll/take seam, and that every other kind is left byte-identical.
 *
 * (The explicit-link grouping half of LIN-599 is already covered by LIN-591 in
 * tests/unit/pipeline-sessions.test.js — not duplicated here.)
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

test('addItem embeds the minted dispatch id into an autopilot prompt', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', {
    prompt: 'You are Autopilot. Walk the stack.',
    kind: 'autopilot'
  });

  // The original body is preserved...
  assert.ok(doc.prompt.includes('You are Autopilot. Walk the stack.'));
  // ...and the run's own id is appended so it can forward it as sessionId.
  assert.ok(doc.prompt.includes(doc._id));
  assert.ok(doc.prompt.includes('Your autopilot session id'));
  assert.ok(doc.prompt.includes('sessionId'));
});

test('the appended id is the actual minted UUID, available to forward', async () => {
  const store = makeStore();

  const doc = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot' });

  // The id surfaced in the prompt is exactly the doc's own id — i.e. what the
  // autopilot would stamp as sessionId on every worker dispatch it spawns.
  assert.match(doc._id, /^[0-9a-f-]{36}$/);
  const idsInPrompt = doc.prompt.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];
  assert.ok(idsInPrompt.includes(doc._id));
});

test('non-autopilot kinds are left byte-identical', async () => {
  const store = makeStore();
  const prompt = 'Implement the feature. Open a PR.';

  const impl = await store.addItem('acme', { prompt, kind: 'implementation' });
  assert.equal(impl.prompt, prompt);

  // No explicit kind → defaults to 'custom', also untouched.
  const custom = await store.addItem('acme', { prompt });
  assert.equal(custom.kind, 'custom');
  assert.equal(custom.prompt, prompt);
});

test('the appended id reaches the consumer through the poll/take seam', async () => {
  const store = makeStore();
  const created = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot' });

  // Poll (listItems → _formatItem) hands the amended prompt to the consumer.
  const [polled] = await store.pollAvailable('acme');
  assert.ok(polled.prompt.includes(created._id));

  // Take (the other _formatItem path) too.
  const taken = await store.takeItem(created._id, 'acme');
  assert.ok(taken.prompt.includes(created._id));
});

test('a worker dispatch carrying the forwarded sessionId is stored untouched', async () => {
  const store = makeStore();
  const autopilot = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot' });

  // The autopilot now spawns a worker, stamping its own id as sessionId. That
  // worker is an ordinary (non-autopilot) dispatch — its prompt is not amended,
  // and the explicit link is preserved verbatim.
  const workerPrompt = 'Plan LIN-600.';
  const worker = await store.addItem('acme', {
    prompt: workerPrompt,
    kind: 'planning',
    sessionId: autopilot._id
  });

  assert.equal(worker.prompt, workerPrompt);
  assert.equal(worker.sessionId, autopilot._id);
});
