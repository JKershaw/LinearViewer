/**
 * Unit tests for lib/shelved-rulings-store.js (LIN-1727)
 *
 * Run with: node --test tests/unit/shelved-rulings-store.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ShelvedRulingsStore } from '../../lib/shelved-rulings-store.js';

function createMockCollection() {
  const docs = [];
  function matchesField(docValue, queryValue) {
    if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
      return queryValue.$in.includes(docValue);
    }
    return docValue === queryValue;
  }
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && !matchesField(doc.urlKey, query.urlKey)) return false;
    return true;
  }
  return {
    _docs: docs,
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) {
        Object.assign(docs[idx], update.$set || {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (opts.upsert) {
        docs.push({ ...(update.$set || {}) });
        return { matchedCount: 0, modifiedCount: 0, upsertedId: update.$set?._id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
  };
}

const NOW = new Date('2026-08-23T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

describe('ShelvedRulingsStore.shelve', () => {
  let collection, store;
  beforeEach(() => {
    collection = createMockCollection();
    store = new ShelvedRulingsStore({ collection });
  });

  test('shelves a decision with a reason and a re-surface timer', async () => {
    const record = await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'waiting on legal', resurfaceInMs: HOUR_MS, now: NOW });
    assert.ok(record);
    assert.strictEqual(record.reason, 'waiting on legal');
    assert.strictEqual(record.lapseCount, 0);
    assert.strictEqual(record.resurfaceAt, new Date(NOW.getTime() + HOUR_MS).toISOString());
  });

  test('rejects a missing/blank reason — silent muting is forbidden', async () => {
    assert.strictEqual(await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: '', resurfaceInMs: HOUR_MS, now: NOW }), null);
    assert.strictEqual(await store.shelve({ urlKey: 'acme', decisionId: 'd-1', resurfaceInMs: HOUR_MS, now: NOW }), null);
    assert.strictEqual(await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: '   ', resurfaceInMs: HOUR_MS, now: NOW }), null);
  });

  test('rejects a missing/non-positive resurfaceInMs', async () => {
    assert.strictEqual(await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'x', resurfaceInMs: 0, now: NOW }), null);
    assert.strictEqual(await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'x', resurfaceInMs: -1, now: NOW }), null);
    assert.strictEqual(await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'x', now: NOW }), null);
  });

  test('rejects missing urlKey/decisionId', async () => {
    assert.strictEqual(await store.shelve({ decisionId: 'd-1', reason: 'x', resurfaceInMs: HOUR_MS }), null);
    assert.strictEqual(await store.shelve({ urlKey: 'acme', reason: 'x', resurfaceInMs: HOUR_MS }), null);
  });

  test('re-shelving a STILL-ACTIVE shelf updates reason/timer without incrementing lapseCount', async () => {
    await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'first reason', resurfaceInMs: HOUR_MS, now: NOW });
    const secondNow = new Date(NOW.getTime() + 10 * 60 * 1000); // 10 min later, still within the 1h window
    const record = await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'updated reason', resurfaceInMs: 2 * HOUR_MS, now: secondNow });
    assert.strictEqual(record.reason, 'updated reason');
    assert.strictEqual(record.lapseCount, 0, 'adjusting an active shelf is not a lapse');
  });

  test('re-shelving a LAPSED shelf (resurfaceAt already passed) increments lapseCount', async () => {
    await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'first', resurfaceInMs: HOUR_MS, now: NOW });
    const laterNow = new Date(NOW.getTime() + 2 * HOUR_MS); // past the 1h resurface
    const record = await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'again', resurfaceInMs: HOUR_MS, now: laterNow });
    assert.strictEqual(record.lapseCount, 1);

    const evenLaterNow = new Date(laterNow.getTime() + 2 * HOUR_MS);
    const record2 = await store.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'yet again', resurfaceInMs: HOUR_MS, now: evenLaterNow });
    assert.strictEqual(record2.lapseCount, 2);
  });

  test('an unconfigured store degrades to null, never throws', async () => {
    const unconfigured = new ShelvedRulingsStore({});
    assert.strictEqual(await unconfigured.shelve({ urlKey: 'acme', decisionId: 'd-1', reason: 'x', resurfaceInMs: HOUR_MS }), null);
  });
});

describe('ShelvedRulingsStore.listForWorkspaces', () => {
  let collection, store;
  beforeEach(() => {
    collection = createMockCollection();
    store = new ShelvedRulingsStore({ collection });
  });

  test('an empty workspace set returns an empty list without touching the collection', async () => {
    assert.deepStrictEqual(await store.listForWorkspaces([]), []);
    assert.deepStrictEqual(await store.listForWorkspaces(), []);
  });

  test('spans multiple workspaces, raw rows (active and lapsed alike) — reduction is the predicate\'s job', async () => {
    await store.shelve({ urlKey: 'ws-a', decisionId: 'd-1', reason: 'x', resurfaceInMs: HOUR_MS, now: NOW });
    await store.shelve({ urlKey: 'ws-b', decisionId: 'd-2', reason: 'y', resurfaceInMs: HOUR_MS, now: NOW });
    await store.shelve({ urlKey: 'ws-c', decisionId: 'd-3', reason: 'z', resurfaceInMs: HOUR_MS, now: NOW });

    const rows = await store.listForWorkspaces(['ws-a', 'ws-b']);
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(new Set(rows.map(r => r.urlKey)), new Set(['ws-a', 'ws-b']));
  });

  test('an unconfigured store degrades to an empty list', async () => {
    const unconfigured = new ShelvedRulingsStore({});
    assert.deepStrictEqual(await unconfigured.listForWorkspaces(['ws-a']), []);
  });
});

describe('ShelvedRulingsStore.clear', () => {
  test('clear removes a workspace\'s shelf rows', async () => {
    const collection = createMockCollection();
    const store = new ShelvedRulingsStore({ collection });
    await store.shelve({ urlKey: 'ws-a', decisionId: 'd-1', reason: 'x', resurfaceInMs: HOUR_MS, now: NOW });
    const removed = await store.clear('ws-a');
    assert.strictEqual(removed, 1);
    assert.deepStrictEqual(await store.listForWorkspaces(['ws-a']), []);
  });

  test('an unconfigured store or missing urlKey degrades to 0, never throws', async () => {
    const unconfigured = new ShelvedRulingsStore({});
    assert.strictEqual(await unconfigured.clear('ws-a'), 0);
    const collection = createMockCollection();
    const store = new ShelvedRulingsStore({ collection });
    assert.strictEqual(await store.clear(undefined), 0);
  });
});
