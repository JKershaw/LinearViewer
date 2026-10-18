/**
 * LIN-3424: expired sessions are swept by the hourly cleanup loop.
 *
 * Return shape of MongoSessionStore.cleanup() — the hourly loop logs
 * `removedCount > 0`, so like the other stores' cleanup() it must return the
 * integer deleted count, and 0 when the collection errors (it still swallows
 * and logs).
 *
 * Witness: a session that expires AFTER startup is gone after one run of the
 * hourly cleanup, driven through createHourlyCleanupRun with a real
 * MongoSessionStore over a temporary MangoClient directory. The row must
 * expire after the store exists: a row seeded already-expired is also removed
 * by a wrong fix that sweeps once at boot.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { MongoSessionStore } from '../../lib/session-store.js';
import { createHourlyCleanupRun } from '../../lib/hourly-cleanup.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const noopStore = () => ({ cleanup: async () => 0 });
const quietLogger = () => {
  const logs = [];
  const errors = [];
  return { logs, errors, log: (...a) => logs.push(a), error: (...a) => errors.push(a) };
};
function otherStores() {
  return {
    dispatchQueueStore: noopStore(),
    freeTierStore: noopStore(),
    proxyTokenStore: noopStore(),
    observationSessionsStore: noopStore(),
    harbourFeedbackTokenStore: noopStore(),
    observerStateStore: noopStore(),
    observerShadowLogStore: noopStore(),
    consumerHeartbeatStore: noopStore()
  };
}

describe('MongoSessionStore.cleanup() return shape (LIN-3424)', () => {
  let dir;
  let client;
  let collection;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hourly-cleanup-run-'));
    client = new MangoClient(dir);
    await client.connect();
    collection = client.db('linear-viewer').collection('sessions');
  });

  after(async () => {
    if (client?.close) await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns the integer count of expired rows removed and keeps live rows', async () => {
    const store = new MongoSessionStore({ collection });
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    await collection.insertMany([
      { _id: 'old-1', session: {}, expires: past },
      { _id: 'old-2', session: {}, expires: past },
      { _id: 'live', session: {}, expires: future },
    ]);

    const removed = await store.cleanup();

    assert.strictEqual(removed, 2);
    const left = (await collection.find({}).toArray()).map(d => d._id);
    assert.deepStrictEqual(left, ['live']);
  });

  test('returns 0 when nothing is expired', async () => {
    const store = new MongoSessionStore({ collection });
    assert.strictEqual(await store.cleanup(), 0);
  });

  test('returns 0 (not undefined) and logs when the collection errors', async () => {
    const boom = new Error('db down');
    const store = new MongoSessionStore({ collection: { deleteMany: async () => { throw boom; } } });
    const logged = [];
    const realError = console.error;
    console.error = (...args) => logged.push(args);
    let removed;
    try {
      removed = await store.cleanup();
    } finally {
      console.error = realError;
    }
    assert.strictEqual(removed, 0);
    assert.strictEqual(logged.length, 1);
    assert.strictEqual(logged[0][0], 'Session cleanup error:');
    assert.strictEqual(logged[0][1], boom);
  });
});

describe('hourly cleanup run sweeps expired sessions (LIN-3424 witness)', () => {
  let dir;
  let client;
  let collection;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hourly-cleanup-witness-'));
    client = new MangoClient(dir);
    await client.connect();
    collection = client.db('linear-viewer').collection('sessions');
  });

  after(async () => {
    if (client?.close) await client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('a session that expires after startup is gone after one tick; a live one is kept', async () => {
    const sessionStore = new MongoSessionStore({ collection });
    const run = createHourlyCleanupRun({ ...otherStores(), sessionStore, logger: quietLogger() });

    await collection.insertMany([
      { _id: 'soon-expired', session: {}, expires: new Date(Date.now() + 50) },
      { _id: 'live', session: {}, expires: new Date(Date.now() + 60_000) },
    ]);
    // What a startup-only fix would do: sweep once, before the row has expired.
    await sessionStore.cleanup();
    await sleep(120);

    await run();

    const left = (await collection.find({}).toArray()).map(d => d._id);
    assert.deepStrictEqual(left, ['live']);
  });
});
