/**
 * Unit tests for the up-chain wake auto-enqueue (LIN-826 / LIN-900 §5).
 *
 * Two layers:
 *  - PURE CORE: buildWakeFollowUp(child, feedback) → the parent-addressed wake
 *    follow-up descriptor, or null. Asserts the descriptor shape and the §5
 *    bubbling matrix: terminals + [blocked] ALWAYS bubble (any subscription level);
 *    [pending] (PENDING-external) bubbles ONLY on an `everything` edge. Plus every
 *    structural null case (loop guard, self-skip, no parent edge).
 *  - EFFECT: the addFeedback seam in DispatchQueueStore resolves the up-chain edge
 *    from the ROOT subscribed dispatch (walking followUpTo) — NOT the possibly
 *    repointed / kind:'wake' feedback item (LIN-1059) — fires once per NEW wake
 *    event (each beat + the terminal), holds a terminal-scoped durable witness
 *    (`terminalWakeEnqueued`) so a terminal wakes at most once, and a wake
 *    follow-up never begets another wake (the structural kind:'wake' loop guard,
 *    trap #1).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWakeFollowUp } from '../../lib/dispatch-wake.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// A child dispatch: a parent edge (sessionId), a distinct id (not self), an
// ordinary kind, no followUpTo. `subscription` defaults to 'terminal-only' (the
// §6 default for an undeclared edge) unless a test overrides it.
function makeChild(overrides = {}) {
  return {
    id: 'child-1',
    sessionId: 'parent-S1',
    subscription: 'terminal-only',
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
  test('a sessioned + terminal child yields the parent-addressed wake', () => {
    const wake = buildWakeFollowUp(makeChild(), doneFeedback);
    assert.ok(wake, 'expected a descriptor');
    assert.equal(wake.followUpTo, 'parent-S1', 'addressed to the parent via the sessionId edge');
    assert.equal(wake.sessionId, 'parent-S1', 'stays in the same session');
    assert.equal(wake.queueIfBusy, true, 'waits rather than fails if the parent is mid-judgment');
    assert.equal(wake.subscription, 'terminal-only', 'the emitted wake carries a schema-valid enum');
    assert.equal(wake.kind, 'wake', 'kind:wake is the structural loop guard');
    assert.equal(typeof wake.prompt, 'string');
    assert.ok(wake.prompt.includes('LIN-42'), 'carries the child identifier');
    assert.ok(wake.prompt.includes('[done] shipped in 40s'), 'carries the terminal outcome');
  });
});

describe('buildWakeFollowUp — the §5 bubbling matrix', () => {
  test('terminals + [blocked] ALWAYS bubble on a terminal-only edge', () => {
    for (const marker of ['done', 'complete', 'failed', 'aborted', 'blocked']) {
      const wake = buildWakeFollowUp(makeChild({ subscription: 'terminal-only' }), [{ message: `[${marker}] x` }]);
      assert.ok(wake, `[${marker}] should bubble on a terminal-only edge`);
    }
  });

  test('terminals + [blocked] ALSO bubble on an everything edge', () => {
    for (const marker of ['done', 'complete', 'failed', 'aborted', 'blocked']) {
      const wake = buildWakeFollowUp(makeChild({ subscription: 'everything' }), [{ message: `[${marker}] x` }]);
      assert.ok(wake, `[${marker}] should bubble on an everything edge`);
    }
  });

  test('an undeclared edge (subscription undefined) is treated as terminal-only — terminals still bubble', () => {
    // Under §6 an undeclared edge defaults to terminal-only; terminals always bubble.
    const wake = buildWakeFollowUp(makeChild({ subscription: undefined }), doneFeedback);
    assert.ok(wake, 'a terminal outcome bubbles even on an undeclared edge');
  });

  test('[pending] is SILENT on a terminal-only edge (the one row subscription controls)', () => {
    assert.equal(
      buildWakeFollowUp(makeChild({ subscription: 'terminal-only' }), [{ message: '[pending] beat 1 done' }]),
      null,
      'PENDING-external does not bubble on a terminal-only edge'
    );
    assert.equal(
      buildWakeFollowUp(makeChild({ subscription: undefined }), [{ message: '[pending] beat 1 done' }]),
      null,
      'and not on an undeclared (default terminal-only) edge'
    );
  });

  test('[pending] BUBBLES on an everything edge, labelled "paused (pending), not done" (LIN-843)', () => {
    const wake = buildWakeFollowUp(makeChild({ subscription: 'everything' }), [{ message: '[pending] beat 1 done, beats 2-4 remain' }]);
    assert.ok(wake, 'a [pending] child wakes its parent on an everything edge');
    assert.match(wake.prompt, /paused \(pending\), not done/i, 'the pause is labelled, not presented as a completion');
    assert.ok(!/terminal outcome/i.test(wake.prompt), 'a pause is not described as a terminal outcome');
    assert.ok(wake.prompt.includes('[pending] beat 1 done, beats 2-4 remain'), 'carries the pause detail');
  });

  test('a stepper warm-resume beat (everything, followUpTo) wakes — no followUpTo guard (LIN-843)', () => {
    // The push-rails stepper resumes its warm worker with followUpTo: ROOT and
    // declares the up-chain edge with subscription: 'everything'. That beat MUST
    // wake the orchestrator on every boundary, incl. [pending], not just the first.
    const beat = makeChild({ id: 'beat-2', subscription: 'everything', followUpTo: 'ROOT', sessionId: 'orchestrator-S1' });
    const wake = buildWakeFollowUp(beat, [{ message: '[pending] beat 2 done' }]);
    assert.ok(wake, 'a subscribed follow-up beat wakes its orchestrator');
    assert.equal(wake.followUpTo, 'orchestrator-S1', 'addressed to the orchestrator via sessionId, not ROOT');
  });
});

describe('buildWakeFollowUp — loop-guard / null cases', () => {
  test('null when child is missing', () => {
    assert.equal(buildWakeFollowUp(null, doneFeedback), null);
    assert.equal(buildWakeFollowUp(undefined, doneFeedback), null);
  });

  test('a wake follow-up (kind:wake) → null — a wake cannot beget a wake (trap #1)', () => {
    // The loop guard is now the structural kind:'wake' field, checked FIRST —
    // because under §5 terminals always bubble, the old subscribe:false off-state
    // no longer exists. A wake follow-up is emitted kind:'wake', so feeding ITS
    // terminal event back through never produces another wake.
    const wakeItem = { id: 'wake-1', sessionId: 'parent-S1', subscription: 'terminal-only', followUpTo: 'parent-S1', kind: 'wake' };
    assert.equal(buildWakeFollowUp(wakeItem, doneFeedback), null);
    // The guard holds even for an `everything` wake and even on a [pending] marker.
    const everythingWake = { id: 'wake-2', sessionId: 'parent-S1', subscription: 'everything', kind: 'wake' };
    assert.equal(buildWakeFollowUp(everythingWake, [{ message: '[pending] x' }]), null);
  });

  test('no sessionId → null (no parent edge to wake)', () => {
    assert.equal(buildWakeFollowUp(makeChild({ sessionId: null }), doneFeedback), null);
  });

  test('self (id === sessionId) → null — the run owner must not wake itself', () => {
    assert.equal(buildWakeFollowUp(makeChild({ id: 'parent-S1' }), doneFeedback), null);
    // also via _id (the history-doc id field)
    assert.equal(buildWakeFollowUp({ _id: 'parent-S1', sessionId: 'parent-S1', subscription: 'terminal-only', kind: 'implementation' }, doneFeedback), null);
  });

  test('a CHILD autopilot (distinct parent sessionId) DOES wake its coordinator (LIN-813)', () => {
    // An autopilot acting as a coordinator dispatches one task-altitude child
    // autopilot per task with sessionId = the coordinator's id; the child MUST wake
    // the coordinator up-chain when it finishes. Terminals bubble on any edge.
    const childAp = makeChild({ id: 'child-ap', kind: 'autopilot', sessionId: 'head-S1' });
    const wake = buildWakeFollowUp(childAp, doneFeedback);
    assert.ok(wake, 'a child autopilot wakes its dispatching coordinator');
    assert.equal(wake.followUpTo, 'head-S1', 'addressed to the coordinator via the sessionId edge');
    assert.equal(wake.kind, 'wake', 'the wake itself is kind:wake — the loop guard');
  });

  test("a coordinator's OWN kickoff never falls through — no sessionId, or sessionId === own id (LIN-813)", () => {
    // A top-level kickoff carries no parent edge → excluded by the sessionId guard.
    assert.equal(buildWakeFollowUp(makeChild({ kind: 'autopilot', sessionId: null }), doneFeedback), null);
    // A run owner that stamped sessionId === its own id → excluded by the self-skip.
    assert.equal(buildWakeFollowUp(makeChild({ id: 'head-S1', kind: 'autopilot', sessionId: 'head-S1' }), doneFeedback), null);
  });

  test('non-terminal feedback → null', () => {
    assert.equal(buildWakeFollowUp(makeChild(), [{ message: 'started' }, { message: '[working] still going' }]), null);
    assert.equal(buildWakeFollowUp(makeChild(), []), null);
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
    subscription: 'everything',
    ...overrides
  });
  await store.takeItem(child._id, URL_KEY, 'token-a');
  return child;
}

describe('addFeedback wake enqueue (effect + once-only)', () => {
  test('a terminal wake event on a sessioned child enqueues exactly one parent-addressed wake', async () => {
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
    assert.equal(wakes[0].subscription, 'terminal-only', 'the emitted wake carries a schema-valid enum');
  });

  test('a [pending] pause on an `everything` child enqueues exactly one parent wake, labelled paused-not-done (LIN-843)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[pending] beat 1 done, task not done' }, 'token-a');
    await drain();

    assert.ok(res && res.success);
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'a pause wakes the parent exactly once on an everything edge');
    assert.equal(wakes[0].followUpTo, 'parent-S1');
    assert.match(wakes[0].prompt, /paused \(pending\), not done/i, 'the wake says paused, not done');
  });

  test('terminal-scoped once-only: a SECOND terminal event does NOT enqueue a second wake (LIN-1059)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    await store.addFeedback(child._id, URL_KEY, { message: '[done] first' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[done] still done, re-reported' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 1, 'still exactly one wake despite a second terminal event');

    // The durable terminal witness is on the edge (here == child) history doc — a
    // terminal-scoped signal ("the parent WAS told the child terminated"), NOT the
    // old generic one-wake-ever `wakeEnqueued`.
    const childDoc = await store.historyCollection.findOne({ _id: child._id });
    assert.equal(childDoc.terminalWakeEnqueued, true);
  });

  test('a terminal-only child DOES wake on a terminal (previously-silent edge now wakes, §5)', async () => {
    const { store, collection, historyCollection } = makeStore();
    // Under §5, terminals bubble regardless of subscription — a terminal-only
    // (undeclared-default) edge that was silent under the old boolean now wakes.
    const child = await takenChild(store, { subscription: 'terminal-only' });

    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 1, 'a terminal bubbles on a terminal-only edge');
  });

  test('a terminal-only child does NOT wake on [pending] (the one gated row, §5)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store, { subscription: 'terminal-only' });

    await store.addFeedback(child._id, URL_KEY, { message: '[pending] paused' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 0, 'PENDING is silent on a terminal-only edge');
    // And the guard is NOT burned — a later terminal still wakes once.
    await store.addFeedback(child._id, URL_KEY, { message: '[done] now done' }, 'token-a');
    await drain();
    assert.equal(wakeItems(collection, historyCollection).length, 1, 'the later terminal still bubbles');
  });

  test('a top-level kickoff (kind:autopilot, no parent sessionId) never self-enqueues a wake', async () => {
    const { store, collection, historyCollection } = makeStore();
    // A top-level coordinator/head kickoff carries no parent edge (sessionId
    // defaults null), so even a terminal outcome produces no wake — there is no one
    // up-chain to wake.
    const kickoff = await store.addItem(URL_KEY, {
      prompt: 'orchestrate', kind: 'autopilot', issueIdentifier: 'LIN-1'
    });
    await store.takeItem(kickoff._id, URL_KEY, 'token-a');

    await store.addFeedback(kickoff._id, URL_KEY, { message: '[done] run complete' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 0, 'a parent-less kickoff produces no wake');
  });

  test('a CHILD autopilot (kind:autopilot, sessioned to a distinct coordinator) wakes it exactly once (LIN-813)', async () => {
    const { store, collection, historyCollection } = makeStore();
    // The coordinator slice: an autopilot dispatches a task-altitude child autopilot
    // with its own id as sessionId + subscription:'everything'. When the child
    // terminates it must wake the coordinator up-chain.
    const childAp = await store.addItem(URL_KEY, {
      prompt: 'drive LIN-2', kind: 'autopilot', issueIdentifier: 'LIN-2',
      sessionId: 'head-S1', subscription: 'everything'
    });
    await store.takeItem(childAp._id, URL_KEY, 'token-a');

    await store.addFeedback(childAp._id, URL_KEY, { message: '[done] task landed' }, 'token-a');
    await drain();

    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'the child autopilot wakes its coordinator exactly once');
    assert.equal(wakes[0].followUpTo, 'head-S1', 'addressed up-chain to the coordinator');
    assert.equal(wakes[0].kind, 'wake', 'the wake is kind:wake — the loop guard');
  });

  test('a plain non-sessioned manual dispatch produces no wake (no parent edge)', async () => {
    const { store, collection, historyCollection } = makeStore();
    // No sessionId — an ordinary manual dispatch has no parent to wake.
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
    assert.notEqual(childDoc.terminalWakeEnqueued, true, 'terminal witness not set by a non-terminal event');

    // A later terminal event still wakes once.
    await store.addFeedback(child._id, URL_KEY, { message: '[done] now done' }, 'token-a');
    await drain();
    assert.equal(wakeItems(collection, historyCollection).length, 1);
  });

  test('the enqueued wake follow-up itself never produces a second wake (structural kind:wake loop guard)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store);

    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');
    await drain();
    const [wake] = wakeItems(collection, historyCollection);
    assert.ok(wake, 'a wake was enqueued');
    assert.equal(wake.kind, 'wake');

    // Drive the wake item through the same lifecycle and terminate IT.
    await store.takeItem(wake._id, URL_KEY, 'token-b');
    await store.addFeedback(wake._id, URL_KEY, { message: '[done] parent reacted' }, 'token-b');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 1, 'the wake did not beget another wake');
  });
});

// ── LIN-1059: edge ownership survives a follow-up repoint ─────────────────────
//
// The confirmed failure mode: a subscribed stepper child is resumed via an
// incoming follow-up, so the runner repoints itemMetadata.itemId onto that
// follow-up item and ALL later feedback — including the stepper's terminal —
// lands on it, not on the edge-bearing root dispatch. Under the old
// `buildWakeFollowUp(doc, …)` seam the terminal was swallowed (the repointed
// item is kind:'wake' and/or carries the wrong sessionId) and the parent
// orchestrator hung forever. The fix resolves the edge from the ROOT dispatch.
describe('addFeedback wake — edge ownership across a follow-up repoint (LIN-1059)', () => {
  // Build the exact three-item topology from the ticket, in history:
  //   ROOT stepper dispatch  (kind:autopilot, edge → grandparent, everything)
  //   grandchild wake item   (kind:wake, followUpTo=ROOT, sessionId=ROOT) ← repoint target
  // The stepper's session is resumed onto the wake item, so its terminal is
  // POSTed there. Returns { rootId, repointId }.
  async function seedRepointTopology(store, { rootSub = 'everything' } = {}) {
    const GRANDPARENT = 'grandparent-S1';
    const root = await store.addItem(URL_KEY, {
      prompt: 'stepper for LIN-1046', kind: 'autopilot', issueIdentifier: 'LIN-1046',
      sessionId: GRANDPARENT, subscription: rootSub
    });
    await store.takeItem(root._id, URL_KEY, 'token-a');

    // A grandchild's wake addressed to the stepper (followUpTo + sessionId = ROOT),
    // which the runner uses to resume the stepper — the repoint target.
    const repoint = await store.addItem(URL_KEY, {
      prompt: 'grandchild wake', kind: 'wake', issueIdentifier: 'LIN-1046',
      followUpTo: root._id, sessionId: root._id, subscription: 'terminal-only'
    });
    await store.takeItem(repoint._id, URL_KEY, 'token-b');

    return { rootId: root._id, repointId: repoint._id, grandparent: GRANDPARENT };
  }

  // Count only the up-chain wakes addressed to a given parent — the seed grandchild
  // `kind:'wake'` item (the repoint target) is itself a wake doc, so a raw
  // wakeItems() count would include it; the real up-chain wakes are the ones
  // addressed to the grandparent.
  const wakesTo = (collection, historyCollection, target) =>
    wakeItems(collection, historyCollection).filter(w => w.followUpTo === target);

  test('the stepper terminal, POSTed to the repointed kind:wake item, wakes the GRANDPARENT via the root edge', async () => {
    const { store, collection, historyCollection } = makeStore();
    const { rootId, repointId, grandparent } = await seedRepointTopology(store);

    // The stepper's own terminal lands on the repointed item (post-repoint ownership).
    await store.addFeedback(repointId, URL_KEY, { message: '[done] LIN-1046 merged 6db03c9' }, 'token-b');
    await drain();

    const wakes = wakesTo(collection, historyCollection, grandparent);
    assert.equal(wakes.length, 1, 'the terminal is NOT swallowed — one wake bubbles up-chain');
    assert.equal(wakes[0].followUpTo, grandparent, 'addressed to the GRANDPARENT (root edge), not the repointed sessionId');
    assert.equal(wakes[0].sessionId, grandparent);
    assert.ok(wakes[0].prompt.includes('LIN-1046'), 'carries the stepper child identifier from the root dispatch');

    // The honest terminal witness lands on the EDGE (root) doc, not the repoint item.
    const rootDoc = await store.historyCollection.findOne({ _id: rootId });
    assert.equal(rootDoc.terminalWakeEnqueued, true, 'the terminal-delivered witness is on the root edge doc');
    const repointDoc = await store.historyCollection.findOne({ _id: repointId });
    assert.notEqual(repointDoc.terminalWakeEnqueued, true, 'not marked on the repointed feedback item');
  });

  test('pre-repoint vs post-repoint ownership: a beat on the root, then the terminal on the repoint, both reach the grandparent', async () => {
    const { store, collection, historyCollection } = makeStore();
    const { rootId, repointId, grandparent } = await seedRepointTopology(store);

    // PRE-repoint: the beat-1 [pending] is posted while ownership is still the root
    // dispatch — bubbles on the everything edge (the one wake that got through in
    // the real run).
    await store.addFeedback(rootId, URL_KEY, { message: '[pending] beat 1/3 done, standing by' }, 'token-a');
    await drain();
    assert.equal(wakesTo(collection, historyCollection, grandparent).length, 1, 'the pre-repoint pending beat wakes the grandparent');

    // POST-repoint: the terminal is posted to the repointed item — under the old
    // code this was silently lost; now it still bubbles to the grandparent.
    await store.addFeedback(repointId, URL_KEY, { message: '[done] all beats complete' }, 'token-b');
    await drain();
    assert.equal(wakesTo(collection, historyCollection, grandparent).length, 2, 'the post-repoint terminal ALSO wakes the grandparent (the fixed edge)');
  });

  test('an `everything` edge wakes on EVERY beat + the terminal — the once-ever cap is gone (LIN-1059 secondary)', async () => {
    const { store, collection, historyCollection } = makeStore();
    // All feedback stays on the root here (no repoint) to isolate the dedup change:
    // multiple beats plus the terminal must each wake, where the old one-wake-ever
    // `wakeEnqueued` would have suppressed everything after beat 1.
    const child = await takenChild(store, { subscription: 'everything' });

    await store.addFeedback(child._id, URL_KEY, { message: '[pending] beat 1 done' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] beat 2 done' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[pending] beat 3 done' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[done] task complete' }, 'token-a');
    await drain();

    assert.equal(wakeItems(collection, historyCollection).length, 4, 'three beats + the terminal each wake the parent');
  });

  test('a later non-wake heartbeat never re-fires the last wake event (per-event firing)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const child = await takenChild(store, { subscription: 'everything' });

    await store.addFeedback(child._id, URL_KEY, { message: '[pending] beat 1 done' }, 'token-a');
    await store.addFeedback(child._id, URL_KEY, { message: '[working] still grinding' }, 'token-a');
    await drain();

    // Only the pending fired; the heartbeat did not re-fire the (still-last) pending.
    assert.equal(wakeItems(collection, historyCollection).length, 1, 'the heartbeat did not re-fire the earlier pending wake');
  });
});
