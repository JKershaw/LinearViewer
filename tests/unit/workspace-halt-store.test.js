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

  test("G1: server.js's workspace-halt collection feeds new WorkspaceHaltStore(", () => {
    assert.ok(
      /db\.collection\(['"]workspace-halt['"]\)/.test(SERVER_SRC),
      "server.js must construct db.collection('workspace-halt')"
    );
    assert.ok(
      /new WorkspaceHaltStore\(/.test(SERVER_SRC),
      'server.js must construct new WorkspaceHaltStore('
    );
  });
});
