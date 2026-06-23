/**
 * Unit tests for the optional post-write hook seam on DispatchQueueStore and
 * AgentStatusStore (LIN-623). The seam must be byte-identical by default (no-op)
 * and fire-and-forget — never blocking or failing the write it rides on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { AgentStatusStore } from '../../lib/agent-status-store.js';

const URL_KEY = 'acme';
// Drain the fire-and-forget microtask the hook schedules.
const drain = () => new Promise(resolve => setImmediate(resolve));

test('DispatchQueueStore default: no onWrite, writes succeed unchanged', async () => {
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
  const doc = await store.addItem(URL_KEY, { prompt: 'hi', issueIdentifier: 'LIN-1', sessionId: 'S1' });
  await drain();
  assert.ok(doc._id, 'addItem still returns the created doc with no hook wired');
});

test('addItem fires onWrite for an autopilot kickoff with sessionId = its own id', async () => {
  const calls = [];
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: p => calls.push(p) });
  const doc = await store.addItem(URL_KEY, { prompt: 'kickoff', kind: 'autopilot', issueIdentifier: 'LIN-1' });
  await drain();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { urlKey: URL_KEY, sessionId: doc._id, issueIdentifier: 'LIN-1' });
});

test('addItem fires onWrite for a worker with its forwarded sessionId', async () => {
  const calls = [];
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: p => calls.push(p) });
  await store.addItem(URL_KEY, { prompt: 'work', kind: 'implementation', issueIdentifier: 'LIN-2', sessionId: 'S1' });
  await drain();
  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-2' }]);
});

test('addItem does NOT fire for a sessionless manual dispatch (not in the feed)', async () => {
  const calls = [];
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: p => calls.push(p) });
  await store.addItem(URL_KEY, { prompt: 'manual', kind: 'implementation', issueIdentifier: 'LIN-3' });
  await drain();
  assert.equal(calls.length, 0);
});

test('_archiveItem (via takeItem) fires onWrite for a sessioned dispatch', async () => {
  const calls = [];
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: p => calls.push(p) });
  const doc = await store.addItem(URL_KEY, { prompt: 'work', kind: 'implementation', issueIdentifier: 'LIN-2', sessionId: 'S1' });
  calls.length = 0; // ignore the addItem fire
  await store.takeItem(doc._id, URL_KEY, 'token-a');
  await drain();
  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-2' }]);
});

test('addFeedback fires onWrite for the fed-back session', async () => {
  const calls = [];
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: p => calls.push(p) });
  const doc = await store.addItem(URL_KEY, { prompt: 'work', kind: 'implementation', issueIdentifier: 'LIN-2', sessionId: 'S1' });
  await store.takeItem(doc._id, URL_KEY, 'token-a');
  calls.length = 0;
  const res = await store.addFeedback(doc._id, URL_KEY, { message: 'heartbeat' }, 'token-a');
  await drain();
  assert.ok(res && res.success);
  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-2' }]);
});

test('a throwing onWrite never breaks the dispatch write (fire-and-forget)', async () => {
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: () => { throw new Error('boom'); } });
  const doc = await store.addItem(URL_KEY, { prompt: 'work', kind: 'autopilot', issueIdentifier: 'LIN-1' });
  await drain();
  assert.ok(doc._id, 'write succeeded despite the hook throwing');
});

test('AgentStatusStore fires onWrite with the issue identifier; default is a no-op', async () => {
  const calls = [];
  const store = new AgentStatusStore({ collection: createMockCollection(), onWrite: p => calls.push(p) });
  await store.recordStatus({ urlKey: URL_KEY, taskIdentifier: 'LIN-5', action: 'review', status: 'completed', summary: 'ok', dispatchId: 'W9' });
  await drain();
  assert.deepEqual(calls, [{ urlKey: URL_KEY, issueIdentifier: 'LIN-5', dispatchId: 'W9' }]);

  const plain = new AgentStatusStore({ collection: createMockCollection() });
  const doc = await plain.recordStatus({ urlKey: URL_KEY, taskIdentifier: 'LIN-5', action: 'review', status: 'completed', summary: 'ok' });
  await drain();
  assert.ok(doc._id, 'recordStatus still works with no hook wired');
});
