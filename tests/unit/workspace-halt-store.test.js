import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WorkspaceHaltStore } from '../../lib/workspace-halt.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const URL_KEY = 'test-workspace';

describe('WorkspaceHaltStore', () => {
  test('setWorkspaceHalt upserts the full document shape', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });

    assert.deepStrictEqual(collection._docs, [
      { _id: URL_KEY, mode: 'pause', setAt: now, setBy: 'alice' }
    ]);
  });

  test('a second set overwrites mode/setAt/setBy (last write wins)', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const firstNow = new Date('2026-01-01T00:00:00.000Z');
    const secondNow = new Date('2026-01-02T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now: firstNow });
    await store.setWorkspaceHalt(URL_KEY, { mode: 'stop', setBy: 'bob', now: secondNow });

    assert.deepStrictEqual(collection._docs, [
      { _id: URL_KEY, mode: 'stop', setAt: secondNow, setBy: 'bob' }
    ]);
  });

  test('getWorkspaceHalt returns null when unset', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });

    assert.strictEqual(await store.getWorkspaceHalt(URL_KEY), null);
  });

  test('getWorkspaceHalt returns the doc shape when set', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });
    const halt = await store.getWorkspaceHalt(URL_KEY);

    assert.deepStrictEqual(halt, { _id: URL_KEY, mode: 'pause', setAt: now, setBy: 'alice' });
  });

  test('clearWorkspaceHalt removes the document', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });
    await store.clearWorkspaceHalt(URL_KEY);

    assert.strictEqual(await store.getWorkspaceHalt(URL_KEY), null);
  });

  test('clearWorkspaceHalt on an unset key is harmless', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });

    await assert.doesNotReject(() => store.clearWorkspaceHalt(URL_KEY));
    assert.strictEqual(await store.getWorkspaceHalt(URL_KEY), null);
  });

  test('getWorkspaceHalt propagates a store error', async () => {
    const collection = createMockCollection();
    const sentinel = new Error('sentinel: findOne failed');
    collection.findOne = async () => { throw sentinel; };
    const store = new WorkspaceHaltStore({ collection });

    await assert.rejects(() => store.getWorkspaceHalt(URL_KEY), sentinel);
  });

  test('setWorkspaceHalt propagates a store error', async () => {
    const collection = createMockCollection();
    const sentinel = new Error('sentinel: updateOne failed');
    collection.updateOne = async () => { throw sentinel; };
    const store = new WorkspaceHaltStore({ collection });

    await assert.rejects(() => store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice' }), sentinel);
  });

  test('clearWorkspaceHalt propagates a store error', async () => {
    const collection = createMockCollection();
    const sentinel = new Error('sentinel: deleteOne failed');
    collection.deleteOne = async () => { throw sentinel; };
    const store = new WorkspaceHaltStore({ collection });

    await assert.rejects(() => store.clearWorkspaceHalt(URL_KEY), sentinel);
  });

  test('G2: workspaceHaltStore is wired into both createDispatchRoutes and createProxyRoutes in server.js', () => {
    const dispatchLine = SERVER_SRC.split('\n').find(l => l.includes('createDispatchRoutes({'));
    const proxyLine = SERVER_SRC.split('\n').find(l => l.includes('createProxyRoutes({'));
    assert.ok(dispatchLine && /\bworkspaceHaltStore\b/.test(dispatchLine), 'workspaceHaltStore must be passed to createDispatchRoutes');
    assert.ok(proxyLine && /\bworkspaceHaltStore\b/.test(proxyLine), 'workspaceHaltStore must be passed to createProxyRoutes');
  });

  test("G1: server.js's workspace-halt collection is actually bound into new WorkspaceHaltStore(", () => {
    assert.ok(
      /const workspaceHaltCollection = db\.collection\(['"]workspace-halt['"]\)/.test(SERVER_SRC),
      "server.js must construct workspaceHaltCollection from db.collection('workspace-halt')"
    );
    assert.ok(
      /new WorkspaceHaltStore\(\{\s*collection: workspaceHaltCollection\s*\}\)/.test(SERVER_SRC),
      'server.js must construct new WorkspaceHaltStore({ collection: workspaceHaltCollection }) — the store must receive the workspace-halt collection, not merely appear near it'
    );
  });
});

describe('WorkspaceHaltStore last-known cache seam (LIN-3024)', () => {
  test('getLastKnownHalt is cold (null) before any get/set', () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });

    assert.strictEqual(store.getLastKnownHalt(URL_KEY), null);
  });

  test('a successful setWorkspaceHalt warms the cache with no prior read (write-only warming)', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });

    assert.deepStrictEqual(store.getLastKnownHalt(URL_KEY), { mode: 'pause', setAt: now, setBy: 'alice' });
  });

  test('the warmed cache entry has no _id (contract-shaped projection)', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });

    assert.ok(!('_id' in store.getLastKnownHalt(URL_KEY)));
  });

  test('a successful getWorkspaceHalt also warms the cache', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');
    await collection.updateOne(
      { _id: URL_KEY },
      { $set: { mode: 'stop', setAt: now, setBy: 'carol' } },
      { upsert: true }
    );

    await store.getWorkspaceHalt(URL_KEY);

    assert.deepStrictEqual(store.getLastKnownHalt(URL_KEY), { mode: 'stop', setAt: now, setBy: 'carol' });
  });

  test('set → clear → cache is null (a successful clear records null)', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });
    await store.clearWorkspaceHalt(URL_KEY);

    assert.strictEqual(store.getLastKnownHalt(URL_KEY), null);
  });

  test('set → clear → a failing read still leaves the cache at null (omits the key)', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });
    await store.clearWorkspaceHalt(URL_KEY);

    collection.findOne = async () => { throw new Error('sentinel: findOne failed'); };
    await assert.rejects(() => store.getWorkspaceHalt(URL_KEY));

    assert.strictEqual(store.getLastKnownHalt(URL_KEY), null);
  });

  test('two urlKeys are cached in isolation', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');

    await store.setWorkspaceHalt('workspace-a', { mode: 'pause', setBy: 'alice', now });

    assert.deepStrictEqual(store.getLastKnownHalt('workspace-a'), { mode: 'pause', setAt: now, setBy: 'alice' });
    assert.strictEqual(store.getLastKnownHalt('workspace-b'), null);
  });

  test('a late read cannot overwrite a newer clear (ordering guard)', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');
    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });

    let releaseRead;
    const originalFindOne = collection.findOne.bind(collection);
    collection.findOne = (query) => new Promise((resolve) => {
      releaseRead = () => resolve(originalFindOne(query));
    });

    const staleRead = store.getWorkspaceHalt(URL_KEY);
    await store.clearWorkspaceHalt(URL_KEY);
    releaseRead();
    await staleRead;

    assert.strictEqual(store.getLastKnownHalt(URL_KEY), null);
  });

  test('a late read cannot overwrite a newer write (ordering guard)', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const firstNow = new Date('2026-01-01T00:00:00.000Z');
    const secondNow = new Date('2026-01-02T00:00:00.000Z');
    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now: firstNow });

    let releaseRead;
    const originalFindOne = collection.findOne.bind(collection);
    collection.findOne = (query) => new Promise((resolve) => {
      releaseRead = () => resolve(originalFindOne(query));
    });

    const staleRead = store.getWorkspaceHalt(URL_KEY);
    await store.setWorkspaceHalt(URL_KEY, { mode: 'stop', setBy: 'bob', now: secondNow });
    releaseRead();
    await staleRead;

    assert.deepStrictEqual(store.getLastKnownHalt(URL_KEY), { mode: 'stop', setAt: secondNow, setBy: 'bob' });
  });

  test('getWorkspaceHalt still propagates a store error even with the cache seam in place', async () => {
    const collection = createMockCollection();
    const sentinel = new Error('sentinel: findOne failed');
    collection.findOne = async () => { throw sentinel; };
    const store = new WorkspaceHaltStore({ collection });

    await assert.rejects(() => store.getWorkspaceHalt(URL_KEY), sentinel);
    assert.strictEqual(store.getLastKnownHalt(URL_KEY), null);
  });

  test('setWorkspaceHalt still propagates a store error and does not warm the cache', async () => {
    const collection = createMockCollection();
    const sentinel = new Error('sentinel: updateOne failed');
    collection.updateOne = async () => { throw sentinel; };
    const store = new WorkspaceHaltStore({ collection });

    await assert.rejects(() => store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice' }), sentinel);
    assert.strictEqual(store.getLastKnownHalt(URL_KEY), null);
  });

  test('clearWorkspaceHalt still propagates a store error and does not clear the cache', async () => {
    const collection = createMockCollection();
    const store = new WorkspaceHaltStore({ collection });
    const now = new Date('2026-01-01T00:00:00.000Z');
    await store.setWorkspaceHalt(URL_KEY, { mode: 'pause', setBy: 'alice', now });

    const sentinel = new Error('sentinel: deleteOne failed');
    collection.deleteOne = async () => { throw sentinel; };
    await assert.rejects(() => store.clearWorkspaceHalt(URL_KEY), sentinel);

    assert.deepStrictEqual(store.getLastKnownHalt(URL_KEY), { mode: 'pause', setAt: now, setBy: 'alice' });
  });
});
