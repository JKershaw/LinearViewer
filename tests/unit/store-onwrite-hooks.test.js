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

// LIN-1307: a followUpTo-only write (the reply box — no sessionId, kind !==
// 'autopilot') used to be silently skipped by the feed-relevance gate, so a
// follow-up's own addItem/take/addFeedback never recomputed its session's
// materialized doc. `_notifyWriteForDoc` now resolves the chain root and fires
// under the root's own session, matching `_buildSessions.resolveChainRoot`.

test('addItem with followUpTo pointing at a stamped worker fires onWrite for the worker\'s owning session (LIN-1307)', async () => {
  const calls = [];
  const historyCollection = createMockCollection();
  // Seed the finalized worker row this follow-up resumes (kind !== 'autopilot',
  // carries its spawning session's sessionId).
  historyCollection._docs.push({ _id: 'W1', urlKey: URL_KEY, kind: 'implementation', sessionId: 'S1', followUpTo: null });
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection, onWrite: p => calls.push(p) });

  await store.addItem(URL_KEY, { prompt: 'reply', followUpTo: 'W1', issueIdentifier: 'LIN-9' });
  await drain();

  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-9' }]);
});

test('addItem with followUpTo pointing at an autopilot anchor fires onWrite with the anchor\'s own id (LIN-1307)', async () => {
  const calls = [];
  const historyCollection = createMockCollection();
  historyCollection._docs.push({ _id: 'S1', urlKey: URL_KEY, kind: 'autopilot', sessionId: null, followUpTo: null });
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection, onWrite: p => calls.push(p) });

  await store.addItem(URL_KEY, { prompt: 'reply', followUpTo: 'S1', issueIdentifier: 'LIN-9' });
  await drain();

  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-9' }]);
});

test('addItem with followUpTo resolving to a standalone/manual root does NOT fire onWrite (stays live-only, LIN-1307)', async () => {
  const calls = [];
  const historyCollection = createMockCollection();
  // A standalone dispatch: not autopilot, no sessionId — the M1 case.
  historyCollection._docs.push({ _id: 'M1', urlKey: URL_KEY, kind: 'implementation', sessionId: null, followUpTo: null });
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection, onWrite: p => calls.push(p) });

  await store.addItem(URL_KEY, { prompt: 'reply', followUpTo: 'M1', issueIdentifier: 'LIN-9' });
  await drain();

  assert.equal(calls.length, 0, 'a standalone chain root stays live-only, unmaterialized');
});

test('addItem with a CHAINED followUpTo resolves through intermediate follow-ups to the ultimate root session (LIN-1307)', async () => {
  const calls = [];
  const historyCollection = createMockCollection();
  historyCollection._docs.push({ _id: 'W1', urlKey: URL_KEY, kind: 'implementation', sessionId: 'S1', followUpTo: null });
  // F1 is itself a follow-up of W1, already archived (a prior reply-box round).
  historyCollection._docs.push({ _id: 'F1', urlKey: URL_KEY, kind: 'implementation', sessionId: null, followUpTo: 'W1' });
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection, onWrite: p => calls.push(p) });

  // A second follow-up, resuming F1 (not W1 directly) — the chained case.
  await store.addItem(URL_KEY, { prompt: 'reply 2', followUpTo: 'F1', issueIdentifier: 'LIN-9' });
  await drain();

  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-9' }], 'walks through F1 to W1\'s session S1');
});

test('followUpTo-only writes fire the same way through _archiveItem/takeItem and addFeedback (LIN-1307)', async () => {
  const calls = [];
  const historyCollection = createMockCollection();
  historyCollection._docs.push({ _id: 'W1', urlKey: URL_KEY, kind: 'implementation', sessionId: 'S1', followUpTo: null });
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection, onWrite: p => calls.push(p) });

  const doc = await store.addItem(URL_KEY, { prompt: 'reply', followUpTo: 'W1', issueIdentifier: 'LIN-9' });
  await drain();
  calls.length = 0; // ignore the addItem fire, already covered above

  await store.takeItem(doc._id, URL_KEY, 'token-a');
  await drain();
  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-9' }], 'archive (takeItem) resolves the same chain root');

  calls.length = 0;
  const res = await store.addFeedback(doc._id, URL_KEY, { message: 'heartbeat' }, 'token-a');
  await drain();
  assert.ok(res && res.success);
  assert.deepEqual(calls, [{ urlKey: URL_KEY, sessionId: 'S1', issueIdentifier: 'LIN-9' }], 'addFeedback resolves the same chain root');
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
