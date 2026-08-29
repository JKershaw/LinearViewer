/**
 * Unit tests for `DispatchQueueStore.listObservedWorkspaceKeys()` (LIN-2146) —
 * the read-only, additive method the observer sweep's roster union
 * (`lib/observer-sweep.js` `mergeRosterUnion`) calls through the injected
 * `deps.dispatchStore` to close the "a workspace with no browser session is
 * never swept" gap. This file pins the STORE half of that change; the
 * roster-union/closure half is pinned in tests/unit/observer-sweep.test.js.
 *
 * Coverage:
 *   - real MangoDB tmpdir round trip: deduped union across dispatch-queue
 *     AND dispatch-history (precedent: tests/unit/observer-sweep.test.js's
 *     idempotency section, same MangoClient tmpdir pattern)
 *   - empty store returns []
 *   - fail-soft: a backend fault returns [], never throws
 *   - the mock-collection fallback path (no `.distinct`/`.aggregate`) is what
 *     every OTHER unit test exercising DispatchQueueStore actually relies on,
 *     so it is pinned here explicitly rather than only incidentally
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';

import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

describe('DispatchQueueStore.listObservedWorkspaceKeys (LIN-2146, real MangoDB tmpdir)', () => {
  let dbDir;
  let client;
  let dbCounter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'dispatch-store-observed-keys-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`dsok_${dbCounter++}`);
    return new DispatchQueueStore({
      collection: db.collection('dispatch-queue'),
      historyCollection: db.collection('dispatch-history'),
      ttl: 24 * 60 * 60
    });
  }

  test('returns the deduped union of urlKeys across dispatch-queue and dispatch-history', async () => {
    const store = freshStore();
    const wsQueueOnly = `ws-queue-${randomUUID()}`;
    const wsBoth = `ws-both-${randomUUID()}`;
    const wsHistoryOnly = `ws-history-${randomUUID()}`;

    // wsQueueOnly stays queued (never taken).
    await store.addItem(wsQueueOnly, { prompt: 'p1', issueIdentifier: 'LIN-1', promptName: 'implementation' });

    // wsBoth gets TWO items: one left queued, one taken (which `takeItem`
    // archives to history immediately, atomically removing it from the
    // queue) — so wsBoth's urlKey genuinely appears in BOTH collections via
    // two different rows, and the union must still dedupe it to one entry.
    await store.addItem(wsBoth, { prompt: 'p2a', issueIdentifier: 'LIN-2a', promptName: 'implementation' });
    const bothTakenItem = await store.addItem(wsBoth, { prompt: 'p2b', issueIdentifier: 'LIN-2b', promptName: 'implementation' });
    await store.takeItem(bothTakenItem._id, wsBoth, 'consumer-1');

    // wsHistoryOnly: dispatch then take — `takeItem` atomically removes the
    // queue row and archives it, so this urlKey ends up in history only.
    const historyItem = await store.addItem(wsHistoryOnly, { prompt: 'p3', issueIdentifier: 'LIN-3', promptName: 'implementation' });
    await store.takeItem(historyItem._id, wsHistoryOnly, 'consumer-1');

    const keys = await store.listObservedWorkspaceKeys();
    assert.ok(Array.isArray(keys));
    // wsBoth appears once despite being in both collections.
    assert.deepStrictEqual(
      [...keys].sort(),
      [wsBoth, wsHistoryOnly, wsQueueOnly].sort()
    );
  });

  test('an empty store returns []', async () => {
    const store = freshStore();
    assert.deepStrictEqual(await store.listObservedWorkspaceKeys(), []);
  });

  test('fail-soft: a queue-collection fault returns [] rather than throwing', async () => {
    const store = freshStore();
    store.collection = {
      distinct: () => Promise.reject(new Error('queue backend down')),
      find: () => ({ toArray: () => Promise.reject(new Error('queue backend down')) })
    };
    await assert.doesNotReject(() => store.listObservedWorkspaceKeys());
    assert.deepStrictEqual(await store.listObservedWorkspaceKeys(), []);
  });

  test('fail-soft, partial: a history-collection fault still returns the queue-collected keys (not a whole-discard)', async () => {
    const store = freshStore();
    const urlKey = `ws-partial-${randomUUID()}`;
    await store.addItem(urlKey, { prompt: 'p', issueIdentifier: 'LIN-9', promptName: 'implementation' });
    store.historyCollection = {
      distinct: () => Promise.reject(new Error('history backend down')),
      find: () => ({ toArray: () => Promise.reject(new Error('history backend down')) })
    };
    const keys = await store.listObservedWorkspaceKeys();
    assert.deepStrictEqual(keys, [urlKey], 'a history-side fault must not discard urlKeys already collected from the queue');
  });
});

describe('DispatchQueueStore.listObservedWorkspaceKeys (LIN-2146, mock-collection fallback path)', () => {
  // createMockCollection() has neither .distinct nor .aggregate — this is
  // the path every OTHER unit test exercising DispatchQueueStore actually
  // relies on, so it is pinned here explicitly.
  test('falls back to a projected find({}) when the collection has no .distinct', async () => {
    const collection = createMockCollection();
    const historyCollection = createMockCollection();
    assert.strictEqual(typeof collection.distinct, 'undefined');
    assert.strictEqual(typeof collection.aggregate, 'undefined');

    const store = new DispatchQueueStore({ collection, historyCollection });
    await store.addItem('ws-mock-1', { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });
    await store.addItem('ws-mock-2', { prompt: 'p', issueIdentifier: 'LIN-2', promptName: 'implementation' });
    // Same urlKey again — must dedupe.
    await store.addItem('ws-mock-1', { prompt: 'p2', issueIdentifier: 'LIN-3', promptName: 'implementation' });

    const keys = await store.listObservedWorkspaceKeys();
    assert.deepStrictEqual([...keys].sort(), ['ws-mock-1', 'ws-mock-2']);
  });

  test('a store with no historyCollection reads the queue only, with no throw', async () => {
    const store = new DispatchQueueStore({ collection: createMockCollection() });
    await store.addItem('ws-solo', { prompt: 'p', issueIdentifier: 'LIN-1', promptName: 'implementation' });
    assert.deepStrictEqual(await store.listObservedWorkspaceKeys(), ['ws-solo']);
  });
});
