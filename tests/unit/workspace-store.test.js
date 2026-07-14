/**
 * Unit tests for lib/workspace-store.js (LIN-1328).
 *
 * Run with: node --test tests/unit/workspace-store.test.js
 *
 * Against a REAL MangoDB tmpdir instance (precedent: tests/unit/account-store.test.js)
 * — this store's entire claim is durability, so a mock would just encode the
 * assumption instead of testing it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';
import { WorkspaceStore } from '../../lib/workspace-store.js';

function makeSession(initial = {}) {
  const session = {
    ...initial,
    save(cb) { if (cb) cb(); },
    regenerate(cb) {
      // Mirror express-session: wipe data fields, keep the methods.
      for (const k of Object.keys(this)) {
        if (typeof this[k] !== 'function') delete this[k];
      }
      cb();
    },
  };
  return session;
}

function sampleWorkspace(overrides = {}) {
  return {
    id: randomUUID(),
    name: 'Acme Inc',
    urlKey: `acme-${randomUUID().slice(0, 8)}`,
    provider: 'linear',
    bindings: [{ provider: 'linear', scope: 'org-1', credentials: { token: 'tok-1' } }],
    ...overrides
  };
}

describe('workspace-store', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'workspace-store-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`ws_${counter++}`);
    return new WorkspaceStore({ collection: db.collection('workspaces') });
  }

  // W1
  test('createWorkspace persists a workspace retrievable by getWorkspace, keyed on workspace.id', async () => {
    const store = freshStore();
    const ws = sampleWorkspace();

    const created = await store.createWorkspace(ws);
    assert.strictEqual(created._id, ws.id);
    assert.ok(created.createdAt instanceof Date);
    assert.ok(created.updatedAt instanceof Date);

    const fetched = await store.getWorkspace(ws.id);
    assert.ok(fetched, 'workspace should be retrievable after creation');
    assert.strictEqual(fetched._id, ws.id);
    assert.strictEqual(fetched.name, 'Acme Inc');
  });

  // W2
  test('bindings[] survive byte-intact, including a two-binding workspace (same provider, two scopes)', async () => {
    const store = freshStore();
    const ws = sampleWorkspace({
      bindings: [
        { provider: 'github', scope: 'owner/repo', credentials: { token: 'issues-tok' } },
        { provider: 'github', scope: 'org/42', credentials: { token: 'projects-tok' } }
      ]
    });

    await store.createWorkspace(ws);
    const fetched = await store.getWorkspace(ws.id);

    assert.strictEqual(fetched.bindings.length, 2);
    assert.deepStrictEqual(fetched.bindings, ws.bindings);
  });

  // W3
  test('getWorkspaceByUrlKey resolves the matching workspace', async () => {
    const store = freshStore();
    const ws = sampleWorkspace();
    await store.createWorkspace(ws);

    const fetched = await store.getWorkspaceByUrlKey(ws.urlKey);
    assert.ok(fetched);
    assert.strictEqual(fetched._id, ws.id);
  });

  // W4 - durability, cross-instance
  test('durability: a new store instance over the same collection sees the written workspace', async () => {
    const db = client.db(`ws_${counter++}`);
    const storeA = new WorkspaceStore({ collection: db.collection('workspaces') });
    const ws = sampleWorkspace();
    await storeA.createWorkspace(ws);

    const storeB = new WorkspaceStore({ collection: db.collection('workspaces') });
    const fetched = await storeB.getWorkspace(ws.id);
    assert.ok(fetched, 'a fresh store instance over the same collection must see the write');
    assert.strictEqual(fetched._id, ws.id);
  });

  // W5 - durability, cross-client (the real witness)
  test('durability: survives closing and reopening a new MangoClient over the same dbDir', async () => {
    const reopenDir = mkdtempSync(join(tmpdir(), 'workspace-store-reopen-'));
    try {
      const clientA = new MangoClient(reopenDir);
      await clientA.connect();
      const storeA = new WorkspaceStore({ collection: clientA.db('main').collection('workspaces') });
      const ws = sampleWorkspace();
      await storeA.createWorkspace(ws);
      await clientA.close();

      const clientB = new MangoClient(reopenDir);
      await clientB.connect();
      const storeB = new WorkspaceStore({ collection: clientB.db('main').collection('workspaces') });
      const fetched = await storeB.getWorkspace(ws.id);
      assert.ok(fetched, 'a new MangoClient over the same dbDir must see the write');
      assert.strictEqual(fetched._id, ws.id);
      await clientB.close();
    } finally {
      rmSync(reopenDir, { recursive: true, force: true });
    }
  });

  // W6 - regenerate, documentation only (NOT the durability proof)
  test('regenerate documentation: session.workspaces is actually wiped, then the durable store still has the record', async () => {
    const store = freshStore();
    const ws = sampleWorkspace();
    await store.createWorkspace(ws);

    const session = makeSession({ workspaces: [ws], activeWorkspaceId: ws.id });
    await new Promise(resolve => session.regenerate(resolve));

    // Prove the blob was actually wiped — else this test would pass for the
    // wrong reason (a fake that doesn't wipe would still let getWorkspace pass).
    assert.strictEqual(session.workspaces, undefined);

    const fetched = await store.getWorkspace(ws.id);
    assert.ok(fetched, 'durable store record survives session.regenerate()');
  });

  // W7
  test('updateWorkspace bumps updatedAt, preserves _id and bindings', async () => {
    const store = freshStore();
    const ws = sampleWorkspace();
    const created = await store.createWorkspace(ws);

    await new Promise(resolve => setTimeout(resolve, 5));
    const result = await store.updateWorkspace(ws.id, { name: 'Acme Renamed' });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.workspace._id, ws.id);
    assert.strictEqual(result.workspace.name, 'Acme Renamed');
    assert.deepStrictEqual(result.workspace.bindings, ws.bindings);
    assert.ok(result.workspace.updatedAt.getTime() >= created.updatedAt.getTime());

    const fetched = await store.getWorkspace(ws.id);
    assert.strictEqual(fetched.name, 'Acme Renamed');
  });

  // W8
  test('unknown workspace reads/updates return explicit null/result, never throw', async () => {
    const store = freshStore();

    assert.strictEqual(await store.getWorkspace('does-not-exist'), null);
    assert.strictEqual(await store.getWorkspaceByUrlKey('does-not-exist'), null);

    const result = await store.updateWorkspace('does-not-exist', { name: 'x' });
    assert.deepStrictEqual(result, { ok: false, reason: 'unknown-workspace' });
  });
});
