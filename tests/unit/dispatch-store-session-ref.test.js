/**
 * Unit tests for the autopilot session self-stamp (LIN-599).
 *
 * An autopilot run must forward its own dispatch id as `sessionId` on the worker
 * dispatches it spawns (LIN-591), but the id is minted inside addItem — after the
 * kickoff prompt was built. addItem closes that gap by appending a self-reference
 * block naming `doc._id` to the prompt, gated on `kind === 'autopilot'` with no
 * `followUpTo` (LIN-4025: a follow-up is not a run root). These tests pin that the
 * block carries the minted id, that it reaches the consumer through the poll/take
 * seam, and that every other kind is left byte-identical.
 *
 * (The explicit-link grouping half of LIN-599 is already covered by LIN-591 in
 * tests/unit/pipeline-sessions.test.js — not duplicated here.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { buildWakeFollowUp } from '../../lib/dispatch-wake.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// Drain the fire-and-forget microtask the onWrite hook schedules.
const drain = () => new Promise(resolve => setImmediate(resolve));

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

test('the appended block explicitly overrides any earlier-mentioned session id (LIN-1737 B1)', async () => {
  const store = makeStore();
  const standalonePlaceholder = '11111111-1111-1111-1111-111111111111';

  const doc = await store.addItem('acme', {
    prompt: `You are Autopilot. Your session id is \`${standalonePlaceholder}\`, unless dispatched through the queue.`,
    kind: 'autopilot'
  });

  // Both ids are present (the earlier placeholder in the original body, the real
  // minted id in the appended block)...
  assert.ok(doc.prompt.includes(standalonePlaceholder));
  assert.ok(doc.prompt.includes(doc._id));
  // ...and the appended block says, in terms an orchestrator reads, that its id
  // overrides whatever was named earlier — not merely restating a second id.
  assert.match(doc.prompt, /overrides any other session id mentioned earlier/i);
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

// LIN-4025: a note sent to a RUNNING autopilot is a follow-up (`followUpTo` = the
// autopilot's kickoff id), not a new run. It must not mint its own session-id
// block, and its write must not notify the feed under the note's id. Otherwise
// the autopilot is told the note's id is "its" id and stamps its next worker
// with it, so that worker's wake goes to a row no session is behind.

// The session ids named by the "Your autopilot session id" blocks in a prompt.
const blockIds = prompt =>
  [...prompt.matchAll(/## Your autopilot session id[\s\S]*?is `([^`]+)`/g)].map(m => m[1]);

test('LIN-4025: a note to a running autopilot wakes its later workers back to the autopilot', async () => {
  const store = makeStore();
  const kickoff = await store.addItem('acme', {
    prompt: 'You are Autopilot. Walk the stack.',
    kind: 'autopilot',
    issueIdentifier: 'LIN-4024'
  });
  // The autopilot takes its kickoff and starts running.
  const running = await store.takeItem(kickoff._id, 'acme', 'token-a');

  // The operator sends a note while it runs, the way the docs describe.
  await store.addItem('acme', {
    prompt: 'Also check the staging deploy before you wrap up.',
    kind: 'autopilot',
    followUpTo: kickoff._id,
    queueIfBusy: true,
    issueIdentifier: 'LIN-4024'
  });
  const [note] = await store.pollAvailable('acme');
  const delivered = await store.takeItem(note.id, 'acme', 'token-b');

  // The id the autopilot takes as its own = the last id block it was delivered.
  const autopilotId = [...blockIds(running.prompt), ...blockIds(delivered.prompt)].at(-1);
  assert.equal(autopilotId, kickoff._id);

  // Its next worker is stamped with that id, and that worker's wake reaches it.
  const worker = { _id: 'worker-1', sessionId: autopilotId, kind: 'planning', issueIdentifier: 'LIN-4024' };
  const wake = buildWakeFollowUp(worker, [{ message: '[done] plan written' }]);
  assert.equal(wake.followUpTo, kickoff._id);
});

test('LIN-4025: a note to a running autopilot is stored and delivered byte-identical', async () => {
  const store = makeStore();
  const kickoff = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot' });
  await store.takeItem(kickoff._id, 'acme', 'token-a');

  const prompt = 'Also check the staging deploy before you wrap up.';
  const note = await store.addItem('acme', {
    prompt,
    kind: 'autopilot',
    followUpTo: kickoff._id,
    queueIfBusy: true
  });
  assert.equal(note.prompt, prompt);

  const delivered = await store.takeItem(note._id, 'acme', 'token-b');
  assert.equal(delivered.prompt, prompt);
  assert.deepEqual(blockIds(delivered.prompt), []);
});

test('LIN-4025: a fresh autopilot kickoff still gets its own id block, including a child run', async () => {
  const store = makeStore();

  const plain = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot' });
  assert.deepEqual(blockIds(plain.prompt), [plain._id]);

  // A child run carries its parent's sessionId but no followUpTo: still a run root.
  const child = await store.addItem('acme', { prompt: 'child kickoff', kind: 'autopilot', sessionId: 'parent-run-1' });
  assert.deepEqual(blockIds(child.prompt), [child._id]);
});

test('LIN-4025: a note to a taken autopilot notifies the feed under the autopilot, not the note', async () => {
  const calls = [];
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: p => calls.push(p) });
  const kickoff = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', issueIdentifier: 'LIN-4024' });
  await store.takeItem(kickoff._id, 'acme', 'token-a');
  calls.length = 0;

  await store.addItem('acme', { prompt: 'note', kind: 'autopilot', followUpTo: kickoff._id, queueIfBusy: true, issueIdentifier: 'LIN-4024' });
  await drain();
  assert.deepEqual(calls, [{ urlKey: 'acme', sessionId: kickoff._id, issueIdentifier: 'LIN-4024' }]);
});

test('LIN-4025: a note whose target is still queued notifies nothing under the note', async () => {
  const calls = [];
  const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection(), onWrite: p => calls.push(p) });
  const kickoff = await store.addItem('acme', { prompt: 'kickoff', kind: 'autopilot', issueIdentifier: 'LIN-4024' });
  calls.length = 0;

  // The kickoff is not taken yet, so the note resolves to itself: no notify.
  await store.addItem('acme', { prompt: 'note', kind: 'autopilot', followUpTo: kickoff._id, queueIfBusy: true, issueIdentifier: 'LIN-4024' });
  await drain();
  assert.deepEqual(calls, []);
});
