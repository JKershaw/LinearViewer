/**
 * LIN-3163 (LIN-3157 B): lifetime retention — the dispatch queue's 24 h
 * archive-then-delete is preserved, but the history half of `cleanup()` is
 * removed, so `dispatch-history` rows are never deleted by the hourly tick.
 *
 * Run with: node --test tests/unit/dispatch-store-lifetime-retention.test.js
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeStore() {
  const queue = createMockCollection();
  const history = createMockCollection();
  const store = new DispatchQueueStore({ collection: queue, historyCollection: history });
  return { store, queue, history };
}

describe('DispatchQueueStore.cleanup (LIN-3163 B)', () => {
  let store;
  let queue;
  let history;

  beforeEach(() => {
    ({ store, queue, history } = makeStore());
  });

  test('archives and deletes expired 24 h queue rows (queue half unchanged)', async () => {
    const now = Date.now();
    queue._docs.push({ _id: 'expired', urlKey: 'acme', prompt: 'p', dispatchedAt: new Date(now - 2 * DAY_MS), expiresAt: new Date(now - 1000) });
    queue._docs.push({ _id: 'live', urlKey: 'acme', prompt: 'p', dispatchedAt: new Date(now), expiresAt: new Date(now + DAY_MS) });

    const removed = await store.cleanup();

    assert.equal(removed, 1, 'only the expired queue row is removed');
    assert.deepEqual(queue._docs.map(d => d._id), ['live'], 'the live queue row stays');
    const archived = history._docs.find(d => d._id === 'expired');
    assert.ok(archived, 'the expired queue row is archived into history before deletion');
    assert.equal(archived.status, 'expired');
  });

  test('does NOT delete dispatch-history rows (history half removed)', async () => {
    const now = Date.now();
    history._docs.push({ _id: 'ancient-history', urlKey: 'acme', status: 'taken', historyExpiresAt: new Date(now - 365 * DAY_MS) });

    await store.cleanup();

    assert.deepEqual(history._docs.map(d => d._id), ['ancient-history'], 'a >30d history row must survive cleanup');
  });

  test('newly archived history rows carry no historyExpiresAt stamp (lifetime retention)', async () => {
    const now = Date.now();
    queue._docs.push({ _id: 'expired-no-stamp', urlKey: 'acme', prompt: 'p', dispatchedAt: new Date(now - 2 * DAY_MS), expiresAt: new Date(now - 1000) });

    await store.cleanup();

    const archived = history._docs.find(d => d._id === 'expired-no-stamp');
    assert.ok(archived, 'the row was archived');
    assert.ok(!('historyExpiresAt' in archived), 'a lifetime-retained history row carries no historyExpiresAt stamp');
  });
});
