/**
 * LIN-3812: lib/dispatch-session-read.js is the one "read ONE session by id" path.
 * It point-reads (issue-scoped, index-backed) and only falls back to the
 * whole-workspace build when asked to and the point read misses.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { readSessionById, pointReadSession } from '../../lib/dispatch-session-read.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function world() {
  const queue = createMockCollection();
  const history = createMockCollection();
  const store = new DispatchQueueStore({ collection: queue, historyCollection: history });
  const agentStatusStore = { listStatus: async () => ({ items: [], total: 0 }) };
  const reads = [];
  const spied = new Proxy(store, {
    get(t, prop) {
      const v = t[prop];
      if (typeof v !== 'function') return v;
      return (...args) => { reads.push([prop, args[1] && typeof args[1] === 'object' ? { ...args[1] } : args[1]]); return v.apply(t, args); };
    }
  });
  return { store, queue, history, spied, reads, deps: { dispatchStore: spied, agentStatusStore } };
}

async function autopilotSession(store) {
  const anchor = await store.addItem(URL_KEY, { prompt: 'anchor', kind: 'autopilot', issueIdentifier: 'LIN-1' });
  await store.takeItem(anchor._id, URL_KEY, 't');
  const worker = await store.addItem(URL_KEY, { prompt: 'worker', issueIdentifier: 'LIN-2', sessionId: anchor._id });
  await store.takeItem(worker._id, URL_KEY, 't');
  return anchor._id;
}

describe('readSessionById', () => {
  test('finds a stamped session by the issue-scoped point read, never the whole-workspace one', async () => {
    const { store, deps, reads } = world();
    const sessionId = await autopilotSession(store);
    reads.length = 0;

    const session = await readSessionById(URL_KEY, sessionId, deps);

    assert.equal(session.sessionId, sessionId);
    assert.deepEqual(new Set(session.loops.map(l => l.issueIdentifier)), new Set(['LIN-1', 'LIN-2']));
    // LIN-3975: a sessionGroupId read is scoped too (the wake-on-another-issue read).
    const scoped = (opts) => opts?.issueIdentifier || opts?.sessionId || opts?.sessionGroupId;
    assert.ok(reads.every(([name, opts]) => name !== 'listHistory' || scoped(opts)), 'every history read is scoped');
    assert.ok(!reads.some(([name, opts]) => ['listItems', 'listHistory', 'listHistoryWithBodies', 'listItemsWithPrompt'].includes(name) && !scoped(opts)));
  });

  test('the session is the non-lean build (raw feedback intact)', async () => {
    const { store, deps } = world();
    const sessionId = await autopilotSession(store);
    await store.addFeedback(sessionId, URL_KEY, { message: '[working] on it' }, 't');
    const session = await readSessionById(URL_KEY, sessionId, deps);
    const anchorLoop = session.loops.find(l => l.loopId === sessionId);
    assert.equal(anchorLoop.feedback.length, 1);
    assert.equal(anchorLoop.promptText.startsWith('anchor'), true);
  });

  test('an unknown id is null; fallback:false never pays the whole-workspace read', async () => {
    const { deps, reads } = world();
    assert.equal(await readSessionById(URL_KEY, 'nope', deps), null);
    reads.length = 0;
    assert.equal(await readSessionById(URL_KEY, 'nope', deps, { fallback: false }), null);
    assert.ok(!reads.some(([name]) => name === 'listHistoryWithBodies' || name === 'listItemsWithPrompt'));
  });

  test('a session the point read cannot reach is found by the fallback, and not with fallback:false', async () => {
    const { store, queue, history, deps } = world();
    const loose = await store.addItem(URL_KEY, { prompt: 'standalone', issueIdentifier: 'LIN-9' });
    await store.takeItem(loose._id, URL_KEY, 't');
    // A pre-LIN-1341 row: no durable group id, so the group read cannot reach it either (LIN-3975).
    await queue.updateOne({ _id: loose._id }, { $set: { sessionGroupId: null } });
    await history.updateOne({ _id: loose._id }, { $set: { sessionGroupId: null } });
    // A store with no point read of the root (the defensive case): nothing to scope by.
    const blind = { ...deps, dispatchStore: new Proxy(deps.dispatchStore, { get: (t, p) => (p === 'getItemStatus' ? undefined : t[p]) }) };

    assert.equal(await pointReadSession(URL_KEY, loose._id, blind), null);
    assert.equal(await readSessionById(URL_KEY, loose._id, blind, { fallback: false }), null);
    const viaFallback = await readSessionById(URL_KEY, loose._id, blind);
    assert.ok(viaFallback, 'the fallback keeps today\'s found result');
    assert.equal(String(viaFallback.sessionId), String(loose._id));
  });
});
