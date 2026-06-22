/**
 * Unit tests for lib/session-summary-cache.js (LIN-592).
 *
 * Run with: node --test tests/unit/session-summary-cache.test.js
 *
 * Covers the content hash (invalidates on any child change or task-set change) and
 * the store contract (key, get/put/delete, TTL eviction), mirroring the
 * run-summary-cache tests.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  hashSession,
  SessionSummaryCacheStore,
  InMemorySessionSummaryCacheStore
} from '../../lib/session-summary-cache.js';

function makeSession(overrides = {}) {
  return {
    sessionId: 'sess-1',
    tasksTouched: ['LIN-100', 'LIN-101'],
    loops: [
      { loopId: 'sess-1', kind: 'autopilot', issueIdentifier: 'LIN-100', agentSummary: 'orchestrated', feedback: [] },
      { loopId: 'w-1', issueIdentifier: 'LIN-101', agentSummary: 'shipped', feedback: [{ message: '[done] ok' }] }
    ],
    ...overrides
  };
}

describe('hashSession', () => {
  test('is stable for the same session content', () => {
    assert.equal(hashSession(makeSession()), hashSession(makeSession()));
  });

  test('changes when a child run changes', () => {
    const a = makeSession();
    const b = makeSession();
    b.loops[1].agentSummary = 'shipped something else';
    assert.notEqual(hashSession(a), hashSession(b));
  });

  test('changes when the set of tasks touched changes', () => {
    const a = makeSession();
    const b = makeSession({ tasksTouched: ['LIN-100', 'LIN-101', 'LIN-102'] });
    assert.notEqual(hashSession(a), hashSession(b));
  });

  test('handles a malformed session without throwing', () => {
    assert.equal(typeof hashSession({}), 'string');
    assert.equal(typeof hashSession(null), 'string');
  });
});

describe('SessionSummaryCacheStore.key', () => {
  test('composes workspaceId:sessionId', () => {
    assert.equal(SessionSummaryCacheStore.key('ws', 'sess-1'), 'ws:sess-1');
  });
});

describe('InMemorySessionSummaryCacheStore', () => {
  test('put then get round-trips', async () => {
    const store = new InMemorySessionSummaryCacheStore();
    const summary = { outcome: 'o', statusLine: 's', highlights: ['h'] };
    await store.put('ws', 'sess-1', { inputHash: 'abc', summary, model: 'm' });
    const got = await store.get('ws', 'sess-1');
    assert.equal(got.inputHash, 'abc');
    assert.deepEqual(got.summary, summary);
    assert.equal(got.model, 'm');
  });

  test('delete removes the entry', async () => {
    const store = new InMemorySessionSummaryCacheStore();
    await store.put('ws', 'sess-1', { inputHash: 'abc', summary: {}, model: 'm' });
    await store.delete('ws', 'sess-1');
    assert.equal(await store.get('ws', 'sess-1'), null);
  });

  test('miss returns null', async () => {
    const store = new InMemorySessionSummaryCacheStore();
    assert.equal(await store.get('ws', 'nope'), null);
  });
});

describe('SessionSummaryCacheStore (collection-backed)', () => {
  // Minimal in-memory collection shim implementing the Mongo surface the store uses.
  function makeCollection() {
    const docs = new Map();
    return {
      async findOne(q) { return docs.get(q._id) || null; },
      async updateOne(q, update, opts) {
        const existing = docs.get(q._id) || { _id: q._id };
        docs.set(q._id, { ...existing, ...update.$set });
      },
      async deleteOne(q) { docs.delete(q._id); },
      _docs: docs
    };
  }

  test('evicts entries past the TTL', async () => {
    const collection = makeCollection();
    const store = new SessionSummaryCacheStore({ collection, ttl: 1 });
    await store.put('ws', 'sess-1', { inputHash: 'h', summary: {}, model: 'm' });
    // Backdate generatedAt beyond the 1s TTL.
    const doc = collection._docs.get('ws:sess-1');
    doc.generatedAt = new Date(Date.now() - 5000);
    const got = await store.get('ws', 'sess-1');
    assert.equal(got, null, 'expired entry is evicted on read');
    assert.equal(collection._docs.has('ws:sess-1'), false, 'expired entry is deleted');
  });

  test('returns a fresh entry within the TTL', async () => {
    const collection = makeCollection();
    const store = new SessionSummaryCacheStore({ collection });
    await store.put('ws', 'sess-1', { inputHash: 'h', summary: { outcome: 'o' }, model: 'm' });
    const got = await store.get('ws', 'sess-1');
    assert.equal(got.summary.outcome, 'o');
  });
});
