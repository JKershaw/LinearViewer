/**
 * Unit tests for the up-chain wake auto-enqueue (LIN-826).
 *
 * Two layers:
 *  - PURE CORE: buildWakeFollowUp(child, feedback) → the parent-addressed wake
 *    follow-up descriptor, or null. Asserts the descriptor shape for a subscribed
 *    + sessioned + terminal child, and EVERY loop-guard null case.
 *  - EFFECT: the addFeedback seam in DispatchQueueStore enqueues at most one wake
 *    per child (the durable `wakeEnqueued` once-only guard), and a wake follow-up
 *    never begets another wake (the structural subscribe:false / followUpTo guard).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWakeFollowUp } from '../../lib/dispatch-wake.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// A subscribed worker: edge declared (subscribe), a parent edge (sessionId), a
// distinct id (not self), an ordinary kind, no followUpTo.
function subscribedChild(overrides = {}) {
  return {
    id: 'child-1',
    sessionId: 'parent-S1',
    subscribe: true,
    kind: 'implementation',
    followUpTo: null,
    issueIdentifier: 'LIN-42',
    issueTitle: 'Do the thing',
    issueUrl: 'https://example.test/LIN-42',
    promptName: 'implementation',
    ...overrides
  };
}

const doneFeedback = [{ message: 'started' }, { message: '[done] shipped in 40s', timestamp: 't' }];

describe('buildWakeFollowUp — descriptor shape', () => {
  test('a subscribed + sessioned + terminal child yields the parent-addressed wake', () => {
    const wake = buildWakeFollowUp(subscribedChild(), doneFeedback);
    assert.ok(wake, 'expected a descriptor');
    assert.equal(wake.followUpTo, 'parent-S1', 'addressed to the parent via the sessionId edge');
    assert.equal(wake.sessionId, 'parent-S1', 'stays in the same session');
    assert.equal(wake.queueIfBusy, true, 'waits rather than fails if the parent is mid-judgment');
    assert.equal(wake.subscribe, false, 'a wake is NOT subscribed — this is the structural loop guard');
    assert.equal(wake.kind, 'wake');
    assert.equal(typeof wake.prompt, 'string');
    assert.ok(wake.prompt.includes('LIN-42'), 'carries the child identifier');
    assert.ok(wake.prompt.includes('[done] shipped in 40s'), 'carries the terminal outcome');
  });

  test('every wake marker (incl. [blocked] and [pending]) wakes the parent', () => {
    for (const marker of ['done', 'complete', 'failed', 'aborted', 'blocked', 'pending']) {
      const wake = buildWakeFollowUp(subscribedChild(), [{ message: `[${marker}] x` }]);
      assert.ok(wake, `[${marker}] should produce a wake`);
    }
  });

  test('a [pending] wake is labelled "paused (pending), not done" so the parent never reads it as complete (LIN-843)', () => {
    const wake = buildWakeFollowUp(subscribedChild(), [{ message: '[pending] beat 1 done, beats 2-4 remain' }]);
    assert.ok(wake, 'a [pending] child wakes its parent');
    assert.match(wake.prompt, /paused \(pending\), not done/i, 'the pause is labelled, not presented as a completion');
    assert.ok(!/terminal outcome/i.test(wake.prompt), 'a pause is not described as a terminal outcome');
    assert.ok(wake.prompt.includes('[pending] beat 1 done, beats 2-4 remain'), 'carries the pause detail');
  });

  test('a SUBSCRIBED follow-up (the stepper warm-resume beat) wakes — no followUpTo guard (LIN-843)', () => {
    // The push-rails stepper resumes its warm worker with followUpTo: ROOT and
    // declares the up-chain edge with subscribe: true. That beat MUST wake the
    // orchestrator on every boundary, not just the first fresh beat.
    const beat = subscribedChild({ id: 'beat-2', followUpTo: 'ROOT', sessionId: 'orchestrator-S1' });
    const wake = buildWakeFollowUp(beat, [{ message: '[pending] beat 2 done' }]);
    assert.ok(wake, 'a subscribed follow-up beat wakes its orchestrator');
    assert.equal(wake.followUpTo, 'orchestrator-S1', 'addressed to the orchestrator via sessionId, not ROOT');
    assert.equal(wake.subscribe, false, 'the wake itself is not subscribed — the sole loop guard');
  });
});

describe('buildWakeFollowUp — loop-guard / null cases', () => {
  test('null when child is missing', () => {
    assert.equal(buildWakeFollowUp(null, doneFeedback), null);
    assert.equal(buildWakeFollowUp(undefined, doneFeedback), null);
  });

  test('non-subscribed child → null (no edge declared)', () => {
    assert.equal(buildWakeFollowUp(subscribedChild({ subscribe: false }), doneFeedback), null);
    assert.equal(buildWakeFollowUp(subscribedChild({ subscribe: undefined }), doneFeedback), null);
  });

  test('no sessionId → null (no parent edge to wake)', () => {
    assert.equal(buildWakeFollowUp(subscribedChild({ sessionId: null }), doneFeedback), null);
  });

  test('a wake follow-up (subscribe:false) → null — a wake cannot beget a wake', () => {
    // Shape a descriptor like the one buildWakeFollowUp emits, then prove that
    // feeding ITS terminal event back through never produces another wake. The
    // loop guard rests on the subscribe:false arm alone (LIN-843 removed the
    // followUpTo arm so subscribed stepper beats can wake), and a wake follow-up
    // is always subscribe:false — so it is still excluded.
    const wakeItem = { id: 'wake-1', sessionId: 'parent-S1', subscribe: false, followUpTo: 'parent-S1', kind: 'wake' };
    assert.equal(buildWakeFollowUp(wakeItem, doneFeedback), null);
    // A non-subscribed follow-up (a plain liveness nudge) is likewise excluded by
    // the same subscribe arm — only an explicitly subscribed follow-up wakes.
    const nudge = { id: 'x', sessionId: 'parent-S1', subscribe: false, followUpTo: 'parent-S1', kind: 'implementation' };
    assert.equal(buildWakeFollowUp(nudge, doneFeedback), null);
  });

  test('self (id === sessionId) → null — the run owner must not wake itself', () => {
    assert.equal(buildWakeFollowUp(subscribedChild({ id: 'parent-S1' }), doneFeedback), null);
    // also via _id (the history-doc id field)
    assert.equal(buildWakeFollowUp({ _id: 'parent-S1', sessionId: 'parent-S1', subscribe: true, kind: 'implementation' }, doneFeedback), null);
  });

  test("kind === 'autopilot' → null (the orchestrator is the subscriber, not a subscribed child)", () => {
    assert.equal(buildWakeFollowUp(subscribedChild({ kind: 'autopilot' }), doneFeedback), null);
  });

  test('non-terminal feedback → null', () => {
    assert.equal(buildWakeFollowUp(subscribedChild(), [{ message: 'started' }, { message: '[working] still going' }]), null);
    assert.equal(buildWakeFollowUp(subscribedChild(), []), null);
  });
});

// ── EFFECT: the addFeedback seam ──────────────────────────────────────────────

const URL_KEY = 'acme';
const drain = () => new Promise(resolve => setImmediate(resolve));

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  return { store, collection, historyCollection };
}

// Count every wake dispatch ever created (kind:'wake'), across BOTH the active
// queue and history — a taken wake is archived out of the active collection, so
// counting only `active` would under-count after a take.
function wakeItems(collection, historyCollection) {
  const active = collection._docs.filter(d => d.kind === 'wake');
  const archived = historyCollection ? historyCollection._docs.filter(d => d.kind === 'wake') : [];
  return [...active, ...archived];
}

async function takenChild(store, overrides = {}) {
  const child = await store.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42',
    sessionId: 'parent-S1',
    subscribe: true,
    ...overrides
  });
  await store.takeItem(child._id, URL_KEY, 'token-a');
  return child;
}

describe('addFeedback wake enqueue (effect + once-only)', () => {
  test('a terminal wake event on a subscribed child enqueues exactly one parent-addressed wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await drain();

    assert.ok(res && res.success);
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'exactly one wake enqueued');
    assert.equal(wakes[0].followUpTo, 'parent-S1');
    assert.equal(wakes[0].sessionId, 'parent-S1');
    assert.equal(wakes[0].queueIfBusy, true);
    assert.equal(wakes[0].subscribe, false);
  });

  test('a [pending] pause on a subscribed child enqueues exactly one parent wake, labelled paused-not-done (LIN-843)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[pending] beat 1 done, task not done' }, 'token-a');
    await drain();

    assert.ok(res && res.success);
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'a pause wakes the parent exactly once');
    assert.equal(wakes[0].followUpTo, 'parent-S1');
    assert.equal(wakes[0].subscribe, false);
    assert.match(wakes[0].prompt, /paused \(pending\), not done/i, 'the wake says paused, not done');
  });

  test('once-only: a SECOND wake event after wakeEnqueued:true does NOT enqueue a second wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    await store.addFeedback(child._id, URL_KEY, { message: '[done] first' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[done] still done, re-reported' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 1, 'still exactly one wake despite a second terminal event');

    // The durable guard is on the child history doc.
    const childDoc = await store.historyCollection.findOne({ _id: child._id });
    assert.equal(childDoc.wakeEnqueued, true);
  });

  test('a non-subscribed child never enqueues a wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store, { subscribe: false });

    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 0);
  });

  test('the orchestrator/kickoff (kind:autopilot) never self-enqueues a wake, even if sessioned+subscribed', async () => {
    const { store, collection, historyCollection } = makeStore();
    // Pathological belt-and-suspenders shape: an autopilot dispatch that somehow
    // carries subscribe + a sessionId. The kind==='autopilot' guard must still
    // refuse to wake — the orchestrator is the subscriber, not a subscribed child.
    const kickoff = await store.addItem(URL_KEY, {
      prompt: 'orchestrate', kind: 'autopilot', issueIdentifier: 'LIN-1',
      sessionId: 'some-other-session', subscribe: true
    });
    await store.takeItem(kickoff._id, URL_KEY, 'token-a');

    await store.addFeedback(kickoff._id, URL_KEY, { message: '[done] run complete' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 0, 'autopilot kind produces no wake');
  });

  test('a plain non-sessioned manual dispatch produces no wake (no subscriber edge)', async () => {
    const { store, collection, historyCollection } = makeStore();
    // No sessionId, no subscribe — an ordinary manual dispatch.
    const manual = await store.addItem(URL_KEY, { prompt: 'manual job', kind: 'implementation', issueIdentifier: 'LIN-9' });
    await store.takeItem(manual._id, URL_KEY, 'token-a');

    await store.addFeedback(manual._id, URL_KEY, { message: '[done] finished' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 0);
  });

  test('a non-terminal heartbeat does not enqueue and does not burn the guard', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    await store.addFeedback(child._id, URL_KEY, { message: '[working] heartbeat' }, 'token-a');
    await drain();
    assert.equal(wakeItems(collection, historyCollection).length, 0, 'no wake for a heartbeat');

    const childDoc = await store.historyCollection.findOne({ _id: child._id });
    assert.notEqual(childDoc.wakeEnqueued, true, 'guard not set by a non-terminal event');

    // A later terminal event still wakes once.
    await store.addFeedback(child._id, URL_KEY, { message: '[done] now done' }, 'token-a');
    await drain();
    assert.equal(wakeItems(collection, historyCollection).length, 1);
  });

  test('the enqueued wake follow-up itself never produces a second wake (structural loop guard)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await drain();
    const [wake] = wakeItems(collection, historyCollection);
    assert.ok(wake, 'a wake was enqueued');

    // Drive the wake item through the same lifecycle and terminate IT.
    await store.takeItem(wake._id, URL_KEY, 'token-b');
    await store.addFeedback(wake._id, URL_KEY, { message: '[done] parent reacted' }, 'token-b');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 1, 'the wake did not beget another wake');
  });
});
