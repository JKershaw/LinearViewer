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
 * The fix does not need simple-dispatcher's `rootItemId` field at all — a
 * follow-up dispatch already inherits the SAME `sessionGroupId` as its
 * anchor (dispatch-factory.js's inheritance seam, transitively all the way
 * back to the root), so getItemStatus can resolve every item in the session
 * with one indexed `sessionGroupId` query instead of walking `followUpTo`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
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

describe('getItemStatus merges feedback across a session-group (LIN-1461)', () => {
  test('feedback posted to a REPOINTED follow-up item is retrievable via getItemStatus on the ORIGINAL id', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const original = await store.addItem(urlKey, { prompt: 'do the thing' });
    await store.takeItem(original._id, urlKey, TOKEN);
    await store.addFeedback(original._id, urlKey, { message: '[heartbeat] working' }, TOKEN);

    // The follow-up repoints the session onto a NEW item id, but inherits the
    // original's own sessionGroupId (== original._id, since it's the root).
    const followUp = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'now confirm CI is green',
      followUpTo: original._id,
      sessionGroupId: original._id
    });
    await store.addFeedback(followUp._id, urlKey, { message: '[done] all good' }, TOKEN);

    // A caller that dispatched `original` and keeps polling BY THAT id must
    // still see the terminal feedback the runner posted under the repointed
    // follow-up id — not a feedback array frozen at repoint time.
    const status = await store.getItemStatus(urlKey, original._id);

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
    await store.addFeedback(a._id, urlKey, { message: 'beat on a' }, TOKEN);

    const b = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'continue', followUpTo: a._id, sessionGroupId: a._id
    });
    await store.addFeedback(b._id, urlKey, { message: 'beat on b' }, TOKEN);

    // C follows up on B (the immediate predecessor, matching simple-dispatcher's
    // repoint behavior), but per dispatch-factory.js's inheritance rule it still
    // inherits B's own sessionGroupId, which is itself A's id — so the group
    // converges on the true root no matter how the followUpTo hops chain.
    const c = await dispatchTakenFollowUp(store, urlKey, {
      prompt: 'finish', followUpTo: b._id, sessionGroupId: b.sessionGroupId
    });
    await store.addFeedback(c._id, urlKey, { message: '[done] beat on c' }, TOKEN);

    const status = await store.getItemStatus(urlKey, a._id);
    assert.equal(status.feedback.length, 3);
    assert.deepEqual(status.feedback.map(f => f.message), ['beat on a', 'beat on b', '[done] beat on c']);
  });

  test('an unrelated dispatch in a DIFFERENT session-group is never pulled in', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const a = await store.addItem(urlKey, { prompt: 'session A' });
    await store.takeItem(a._id, urlKey, TOKEN);
    await store.addFeedback(a._id, urlKey, { message: 'a beat' }, TOKEN);

    const other = await store.addItem(urlKey, { prompt: 'unrelated session B' });
    await store.takeItem(other._id, urlKey, TOKEN);
    await store.addFeedback(other._id, urlKey, { message: 'unrelated beat' }, TOKEN);

    const status = await store.getItemStatus(urlKey, a._id);
    assert.equal(status.feedback.length, 1);
    assert.equal(status.feedback[0].message, 'a beat');
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

    const status = await store.getItemStatus(urlKey, 'legacy-1');
    assert.equal(status.feedback.length, 1);
    assert.equal(status.feedback[0].message, 'legacy beat');
  });

  test('a lone item (no follow-ups) is byte-identical to before — its own feedback, unmodified', async () => {
    const store = makeStore();
    const urlKey = 'acme';

    const doc = await store.addItem(urlKey, { prompt: 'solo' });
    await store.takeItem(doc._id, urlKey, TOKEN);
    await store.addFeedback(doc._id, urlKey, { message: 'only beat' }, TOKEN);

    const status = await store.getItemStatus(urlKey, doc._id);
    assert.equal(status.feedback.length, 1);
    assert.equal(status.feedback[0].message, 'only beat');
  });
});
