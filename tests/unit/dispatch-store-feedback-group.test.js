/**
 * Unit tests for LIN-1461: getItemStatus resolves a session's full feedback
 * across follow-up repoints via the durable sessionGroupId (LIN-1341), not
 * just the queried item's own doc.
 *
 * The bug: simple-dispatcher keys every feedback/heartbeat POST on the
 * CURRENT (possibly repointed) item id — every follow-up/wake repoints the
 * session onto a new item id. A consumer that dispatched the ORIGINAL item
 * and long-polls `GET /dispatch/{originalId}` (which calls getItemStatus)
 * only ever saw that original item's OWN feedback[], frozen at repoint
 * time — so it read as "gone dark" even while the session kept working
 * under the new ids for another 80+ minutes (the LIN-1461 incident).
 *
 * REWORK (request-changes review on PR #969): merging on `sessionGroupId`
 * ALONE is not safe. `sessionGroupId` falls back to `doc.sessionId`
 * (dispatch-store.js's `addItem`), and every WORKER an autopilot orchestrator
 * spawns carries `sessionId` == the orchestrator's own id — so ALL sibling
 * workers in one autopilot run share ONE sessionGroupId, with no `followUpTo`
 * between them. Merging on sessionGroupId alone therefore pulls a sibling's
 * feedback — including a `[done]` terminal marker — into an unrelated,
 * still-running worker's view (a false-terminal regression, confirmed worse
 * than the original false-stall bug). The fix keeps the cheap indexed
 * `{urlKey, sessionGroupId}` query to fetch CANDIDATE siblings, then scopes
 * the merge to entries whose `rootItemId` matches the queried item's own
 * lineage. `rootItemId` is tagged on every feedback entry by the runner
 * (simple-dispatcher reapers.js/hook.js/feedback.js: `session.rootItemId ||
 * itemMetadata.itemId`) and is per-RUNNER-SESSION: distinct for sibling
 * workers, shared across a single lineage's follow-up repoints.
 *
 * The merge is also now OPT-IN (`getItemStatus(urlKey, id, {
 * includeGroupFeedback: true })`) — every caller that doesn't read `feedback`
 * (the followUpTo anchor lookup, the Observation materializer, the
 * dashboard's issue-scoped point-reads, `GET /api/proxy/dispatch/:id/prompt`)
 * stays on the cheap default (own feedback only), so the extra indexed query
 * + in-memory filter/sort only runs on the watch/poll seam that actually
 * needs it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { deriveTerminalStatus } from '../../lib/dispatch-terminal.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

const TOKEN = 'consumer-1';

// Dispatches + takes + feeds back on a follow-up, inheriting sessionGroupId
// from its anchor exactly like dispatch-factory.js's createDispatchItem seam
// does in production — the store itself never performs this inheritance.
async function dispatchTakenFollowUp(store, urlKey, { prompt, followUpTo, sessionGroupId }) {
  const doc = await store.addItem(urlKey, { prompt, followUpTo, sessionGroupId });
  await store.takeItem(doc._id, urlKey, TOKEN);
  return doc;
}

describe('getItemStatus merges feedback across a session-group, scoped to rootItemId (LIN-1461)', () => {
  test('feedback posted to a REPOINTED follow-up item is retrievable via getItemStatus on the ORIGINAL id', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const original = await store.addItem(urlKey, { prompt: 'do the thing' });
    await store.takeItem(original._id, urlKey, TOKEN);
    // The runner tags every post — including ones after a repoint — with the
    // ORIGINAL dispatch id as rootItemId (simple-dispatcher's session.rootItemId
    // convention). Real production traffic always carries this.
    await store.addFeedback(original._id, urlKey, { message: '[heartbeat] working', rootItemId: original._id }, TOKEN);

    // The follow-up repoints the session onto a NEW item id, but inherits the
    // original's own sessionGroupId (== original._id, since it's the root).
    const followUp = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'now confirm CI is green',
      followUpTo: original._id,
      sessionGroupId: original._id
    });
    await store.addFeedback(followUp._id, urlKey, { message: '[done] all good', rootItemId: original._id }, TOKEN);

    // A caller that dispatched `original` and keeps polling BY THAT id must
    // still see the terminal feedback the runner posted under the repointed
    // follow-up id — not a feedback array frozen at repoint time. This is the
    // watch-seam read, so it opts into the group-feedback merge.
    const status = await store.getItemStatus(urlKey, original._id, { includeGroupFeedback: true });

    assert.equal(status.id, original._id, 'the queried item\'s own identity (id/prompt) is unchanged');
    assert.equal(status.prompt, original.prompt);
    assert.equal(status.feedback.length, 2);
    assert.deepEqual(status.feedback.map(f => f.message), ['[heartbeat] working', '[done] all good']);
  });

  test('a multi-hop chain (A <- B <- C) resolves ALL hops\' feedback via the root id', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const a = await store.addItem(urlKey, { prompt: 'start' });
    await store.takeItem(a._id, urlKey, TOKEN);
    await store.addFeedback(a._id, urlKey, { message: 'beat on a', rootItemId: a._id }, TOKEN);

    const b = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'continue', followUpTo: a._id, sessionGroupId: a._id
    });
    // Every hop's feedback carries the SAME rootItemId — the original launch's
    // id — for the lifetime of the session, per simple-dispatcher's
    // `session.rootItemId || itemMetadata.itemId` convention (set once, never
    // overwritten by a repoint).
    await store.addFeedback(b._id, urlKey, { message: 'beat on b', rootItemId: a._id }, TOKEN);

    // C follows up on B (the immediate predecessor, matching simple-dispatcher's
    // repoint behavior), but per dispatch-factory.js's inheritance rule it still
    // inherits B's own sessionGroupId, which is itself A's id — so the group
    // converges on the true root no matter how the followUpTo hops chain.
    const c = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'finish', followUpTo: b._id, sessionGroupId: b.sessionGroupId
    });
    await store.addFeedback(c._id, urlKey, { message: '[done] beat on c', rootItemId: a._id }, TOKEN);

    const status = await store.getItemStatus(urlKey, a._id, { includeGroupFeedback: true });
    assert.equal(status.feedback.length, 3);
    assert.deepEqual(status.feedback.map(f => f.message), ['beat on a', 'beat on b', '[done] beat on c']);
  });

  test('an unrelated dispatch in a DIFFERENT session-group is never pulled in', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const a = await store.addItem(urlKey, { prompt: 'session A' });
    await store.takeItem(a._id, urlKey, TOKEN);
    await store.addFeedback(a._id, urlKey, { message: 'a beat', rootItemId: a._id }, TOKEN);

    const other = await store.addItem(urlKey, { prompt: 'unrelated session B' });
    await store.takeItem(other._id, urlKey, TOKEN);
    await store.addFeedback(other._id, urlKey, { message: 'unrelated beat', rootItemId: other._id }, TOKEN);

    const status = await store.getItemStatus(urlKey, a._id, { includeGroupFeedback: true });
    assert.equal(status.feedback.length, 1);
    assert.equal(status.feedback[0].message, 'a beat');
  });

  // The failing class the review flagged: this is the shape EVERY autopilot
  // run produces (dispatch-factory.js / docs/autopilot-kickoff.md) — two
  // workers sharing the orchestrator's `sessionId` (and therefore the same
  // `sessionGroupId`, via dispatch-store's fallback), with NO `followUpTo`
  // between them. Each worker is its own runner session, so each tags its own
  // feedback with its OWN id as `rootItemId`. Must FAIL if the merge is scoped
  // to `sessionGroupId` alone (worker A would absorb worker B's `[done]` and
  // read as terminal) and PASS once scoped to `rootItemId`.
  test('sibling workers sharing an autopilot sessionId (no followUpTo) stay isolated — one finishing does not terminate the other', async () => {
    const store = makeStore();
    const urlKey = 'acme';
    const orchestratorSessionId = 'orchestrator-1';

    const workerA = await store.addItem(urlKey, { prompt: 'worker A: long task', sessionId: orchestratorSessionId });
    await store.takeItem(workerA._id, urlKey, TOKEN);
    const workerB = await store.addItem(urlKey, { prompt: 'worker B: short task', sessionId: orchestratorSessionId });
    await store.takeItem(workerB._id, urlKey, TOKEN);

    // Sanity: both really do land in the same session-group (the shape that
    // makes the sessionGroupId-only merge unsafe).
    assert.equal(workerA.sessionGroupId, workerB.sessionGroupId);

    await store.addFeedback(workerA._id, urlKey, { message: '[heartbeat] worker A still working', rootItemId: workerA._id }, TOKEN);
    await store.addFeedback(workerB._id, urlKey, { message: '[done] worker B finished', rootItemId: workerB._id }, TOKEN);

    const statusA = await store.getItemStatus(urlKey, workerA._id, { includeGroupFeedback: true });

    assert.equal(statusA.feedback.length, 1, 'worker A must not absorb worker B\'s feedback');
    assert.equal(statusA.feedback[0].message, '[heartbeat] worker A still working');
    assert.equal(deriveTerminalStatus(statusA.feedback), null, 'worker A must stay non-terminal — worker B\'s [done] must not leak in');

    // Worker B, independently, is unaffected and correctly reads as done.
    const statusB = await store.getItemStatus(urlKey, workerB._id, { includeGroupFeedback: true });
    assert.equal(statusB.feedback.length, 1);
    assert.equal(deriveTerminalStatus(statusB.feedback), 'done');
  });

  test('a rejecting sibling query falls back to the item\'s own feedback, never throws', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const original = await store.addItem(urlKey, { prompt: 'do the thing' });
    await store.takeItem(original._id, urlKey, TOKEN);
    await store.addFeedback(original._id, urlKey, { message: 'own beat', rootItemId: original._id }, TOKEN);

    // A follow-up exists (so sessionGroupId is set and the sibling query would
    // normally run), but the sibling `find()` itself fails — e.g. a live Mongo
    // fault mid-poll.
    await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'follow up', followUpTo: original._id, sessionGroupId: original._id
    });

    const originalFind = store.historyCollection.find.bind(store.historyCollection);
    store.historyCollection.find = (query, opts) => {
      if (query && query.sessionGroupId) {
        return { toArray: async () => { throw new Error('simulated Mongo fault'); } };
      }
      return originalFind(query, opts);
    };

    const status = await store.getItemStatus(urlKey, original._id, { includeGroupFeedback: true });

    assert.equal(status.feedback.length, 1, 'falls back to the item\'s own feedback on a query error');
    assert.equal(status.feedback[0].message, 'own beat');
  });

  test('equal/missing/unparseable timestamps sort deterministically, without a NaN comparator', async () => {
    const store = makeStore();
    const urlKey = 'acme';
    const sharedTime = new Date('2026-07-20T08:00:00.000Z');

    const original = await store.addItem(urlKey, { prompt: 'do the thing' });
    await store.takeItem(original._id, urlKey, TOKEN);
    // Own entries: one at the shared timestamp, one with an unparseable one.
    await store.addFeedback(original._id, urlKey, { message: 'own at shared time', rootItemId: original._id }, TOKEN);
    await store.addFeedback(original._id, urlKey, { message: 'own with bad timestamp', rootItemId: original._id }, TOKEN);
    // Force the timestamps directly on the stored docs (addFeedback always
    // stamps `new Date()`, so overwrite post-hoc to pin exact values/edge cases).
    const ownDoc = await store.historyCollection.findOne({ _id: original._id, urlKey });
    ownDoc.feedback[0].timestamp = sharedTime;
    ownDoc.feedback[1].timestamp = 'not-a-real-timestamp';

    const followUp = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'continue', followUpTo: original._id, sessionGroupId: original._id
    });
    await store.addFeedback(followUp._id, urlKey, { message: 'sibling at shared time', rootItemId: original._id }, TOKEN);
    await store.addFeedback(followUp._id, urlKey, { message: 'sibling missing timestamp', rootItemId: original._id }, TOKEN);
    const siblingDoc = await store.historyCollection.findOne({ _id: followUp._id, urlKey });
    siblingDoc.feedback[0].timestamp = sharedTime;
    delete siblingDoc.feedback[1].timestamp;

    // Two independent reads must return the SAME order every time (determinism),
    // and must not throw / produce an order that silently drops entries.
    const first = await store.getItemStatus(urlKey, original._id, { includeGroupFeedback: true });
    const second = await store.getItemStatus(urlKey, original._id, { includeGroupFeedback: true });

    assert.equal(first.feedback.length, 4);
    assert.deepEqual(first.feedback.map(f => f.message), second.feedback.map(f => f.message));

    // Valid timestamps (the two "at shared time" entries) sort before the
    // invalid/missing ones. Within each tied group the comparator returns 0,
    // so Array#sort's guaranteed stability (ES2019+) preserves this merge's
    // own construction order — the queried item's own entries before its
    // sibling's — on every read, not just this one.
    const messages = first.feedback.map(f => f.message);
    assert.deepEqual(messages, [
      'own at shared time',
      'sibling at shared time',
      'own with bad timestamp',
      'sibling missing timestamp'
    ]);
  });

  test('a pre-LIN-1341 legacy row (no sessionGroupId) falls back to its own feedback only, never throws', async () => {
    const store = makeStore();
    const urlKey = 'acme';
    const now = new Date();

    // Simulates a doc written before sessionGroupId existed, inserted directly.
    await store.historyCollection.insertOne({
      _id: 'legacy-1', urlKey, prompt: 'old', promptName: 'Prompt', kind: 'custom',
      dispatchedAt: now, target: 'cli', status: 'taken', resolvedAt: now,
      feedback: [{ message: 'legacy beat', timestamp: now }]
    });

    const status = await store.getItemStatus(urlKey, 'legacy-1', { includeGroupFeedback: true });
    assert.equal(status.feedback.length, 1);
    assert.equal(status.feedback[0].message, 'legacy beat');
  });

  test('a lone item (no follow-ups) is byte-identical to before — its own feedback, unmodified', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const doc = await store.addItem(urlKey, { prompt: 'solo' });
    await store.takeItem(doc._id, urlKey, TOKEN);
    await store.addFeedback(doc._id, urlKey, { message: 'only beat' }, TOKEN);

    const status = await store.getItemStatus(urlKey, doc._id, { includeGroupFeedback: true });
    assert.equal(status.feedback.length, 1);
    assert.equal(status.feedback[0].message, 'only beat');
  });

  test('the group-feedback merge is opt-in — the default read never queries siblings', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const original = await store.addItem(urlKey, { prompt: 'do the thing' });
    await store.takeItem(original._id, urlKey, TOKEN);
    await store.addFeedback(original._id, urlKey, { message: 'own beat', rootItemId: original._id }, TOKEN);

    const followUp = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'continue', followUpTo: original._id, sessionGroupId: original._id
    });
    await store.addFeedback(followUp._id, urlKey, { message: '[done] all good', rootItemId: original._id }, TOKEN);

    let siblingQueried = false;
    const originalFind = store.historyCollection.find.bind(store.historyCollection);
    store.historyCollection.find = (query, opts) => {
      if (query && query.sessionGroupId) siblingQueried = true;
      return originalFind(query, opts);
    };

    // No options — callers like the followUpTo anchor lookup / Observation
    // materializer / dashboard point-reads / the /prompt endpoint, none of
    // which read `feedback`, must stay on the cheap own-feedback-only path.
    const status = await store.getItemStatus(urlKey, original._id);

    assert.equal(siblingQueried, false, 'the sibling group query must not run unless includeGroupFeedback is requested');
    assert.equal(status.feedback.length, 1);
    assert.equal(status.feedback[0].message, 'own beat');
  });
});
