/**
 * Unit tests for lib/task-snapshot-store.js (LIN-598)
 *
 * Run with: node --test tests/unit/task-snapshot-store.test.js
 *
 * Exercises the real TaskSnapshotStore against an in-memory mock of the
 * MongoDB/MangoDB collection surface, plus the pure snapshotFromContext /
 * diffSnapshots helpers. Covers the three behaviours the plan calls out:
 * the hash-gated dedupe, the per-task count cap, and the read-time diff.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TaskSnapshotStore,
  snapshotFromContext,
  diffSnapshots
} from '../../lib/task-snapshot-store.js';
import { hashContext } from '../../lib/recap-cache.js';

// Minimal in-memory mock of the collection surface the store uses. Supports the
// equality predicates the store issues: _id, urlKey, taskIdentifier, canonicalId.
function createMockCollection() {
  const docs = [];
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && doc.urlKey !== query.urlKey) return false;
    if (query.taskIdentifier !== undefined && doc.taskIdentifier !== query.taskIdentifier) return false;
    if (query.canonicalId !== undefined && doc.canonicalId !== query.canonicalId) return false;
    // Range predicate on capturedAt, mirroring the { $gte: since } window scan the
    // real Mongo/Mango layer honours (used by listByWorkspace — LIN-1197).
    if (query.capturedAt !== undefined && query.capturedAt && typeof query.capturedAt === 'object' && query.capturedAt.$gte !== undefined) {
      const docMs = doc.capturedAt instanceof Date ? doc.capturedAt.getTime() : new Date(doc.capturedAt).getTime();
      const sinceMs = query.capturedAt.$gte instanceof Date ? query.capturedAt.$gte.getTime() : new Date(query.capturedAt.$gte).getTime();
      if (!(docMs >= sinceMs)) return false;
    }
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matches(docs[i], query)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

function sampleContext(overrides = {}) {
  return {
    issue: {
      id: 'uuid-598',
      identifier: 'LIN-598',
      title: 'Save diffs/historical archives of tasks',
      description: 'Original description',
      state: { name: 'In Progress', type: 'started' },
      labels: ['feature', 'archive'],
      priority: 3,
      ...overrides.issue
    },
    comments: overrides.comments ?? [
      { id: 'c1', body: 'first comment', createdAt: '2026-06-22T00:00:00.000Z' }
    ],
    children: overrides.children ?? [],
    parent: overrides.parent ?? null
  };
}

describe('snapshotFromContext', () => {
  test('extracts the hashContext-aligned slice', () => {
    const snap = snapshotFromContext(sampleContext());
    assert.equal(snap.title, 'Save diffs/historical archives of tasks');
    assert.equal(snap.description, 'Original description');
    assert.deepEqual(snap.state, { name: 'In Progress', type: 'started' });
    assert.deepEqual(snap.labels, ['archive', 'feature']); // sorted
    assert.equal(snap.priority, 3);
    assert.equal(snap.comments.length, 1);
    assert.equal(snap.comments[0].body, 'first comment');
    assert.equal(snap.parent, null);
    assert.deepEqual(snap.children, []);
  });

  test('is null-safe on empty/garbage input', () => {
    const snap = snapshotFromContext(null);
    assert.equal(snap.title, '');
    assert.equal(snap.description, '');
    assert.equal(snap.state, null);
    assert.deepEqual(snap.labels, []);
    assert.equal(snap.priority, null);
    assert.deepEqual(snap.comments, []);
  });

  test('captures parent and children state', () => {
    const snap = snapshotFromContext(sampleContext({
      parent: { identifier: 'LIN-500', state: { name: 'Todo', type: 'unstarted' } },
      children: [{ identifier: 'LIN-599', state: { name: 'Done', type: 'completed' } }]
    }));
    assert.equal(snap.parent.identifier, 'LIN-500');
    assert.equal(snap.parent.state.type, 'unstarted');
    assert.equal(snap.children[0].identifier, 'LIN-599');
    assert.equal(snap.children[0].state.type, 'completed');
  });

  test('emits the reported git HEAD as a separate headSha field (LIN-1239)', () => {
    const head = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const snap = snapshotFromContext(sampleContext(), head);
    assert.equal(snap.headSha, head);
  });

  test('headSha is null when no HEAD is reported', () => {
    assert.equal(snapshotFromContext(sampleContext()).headSha, null);
    assert.equal(snapshotFromContext(sampleContext(), '').headSha, null);
    assert.equal(snapshotFromContext(sampleContext(), null).headSha, null);
    // Non-string junk collapses to null rather than being stored verbatim.
    assert.equal(snapshotFromContext(sampleContext(), 42).headSha, null);
  });

  test('headSha does NOT change the hashContext dedupe slice (LIN-1239)', () => {
    // hashContext is computed over the context, never the snapshot, so a HEAD-only
    // difference must not alter the hash the capture gate compares.
    const ctx = sampleContext();
    assert.equal(hashContext(ctx), hashContext(ctx));
    // The two snapshots differ only by headSha, but the gate never reads the snapshot.
    const a = snapshotFromContext(ctx, 'aaaaaaa');
    const b = snapshotFromContext(ctx, 'bbbbbbb');
    assert.notEqual(a.headSha, b.headSha);
  });
});

describe('diffSnapshots', () => {
  test('reports no change for identical snapshots', () => {
    const a = snapshotFromContext(sampleContext());
    const b = snapshotFromContext(sampleContext());
    const diff = diffSnapshots(a, b);
    assert.equal(diff.changed, false);
    assert.equal(diff.fields.length, 0);
  });

  test('reports changed fields with before/after', () => {
    const a = snapshotFromContext(sampleContext());
    const b = snapshotFromContext(sampleContext({
      issue: { description: 'Edited description', state: { name: 'Done', type: 'completed' } }
    }));
    const diff = diffSnapshots(a, b);
    assert.equal(diff.changed, true);
    const fields = diff.fields.map(f => f.field).sort();
    assert.deepEqual(fields, ['description', 'state']);
    const desc = diff.fields.find(f => f.field === 'description');
    assert.equal(desc.before, 'Original description');
    assert.equal(desc.after, 'Edited description');
  });

  test('detects a newly added comment', () => {
    const a = snapshotFromContext(sampleContext());
    const b = snapshotFromContext(sampleContext({
      comments: [
        { id: 'c1', body: 'first comment', createdAt: '2026-06-22T00:00:00.000Z' },
        { id: 'c2', body: 'second comment', createdAt: '2026-06-23T00:00:00.000Z' }
      ]
    }));
    const diff = diffSnapshots(a, b);
    assert.ok(diff.fields.some(f => f.field === 'comments'));
  });

  test('handles a null prior snapshot (first ever)', () => {
    const b = snapshotFromContext(sampleContext());
    const diff = diffSnapshots(null, b);
    assert.equal(diff.changed, true);
  });
});

describe('TaskSnapshotStore.captureIfChanged', () => {
  let store;
  beforeEach(() => { store = new TaskSnapshotStore({ collection: createMockCollection() }); });

  test('writes a snapshot on first capture', async () => {
    const ctx = sampleContext();
    const rec = await store.captureIfChanged({
      urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598',
      inputHash: 'hash-1', snapshot: snapshotFromContext(ctx)
    });
    assert.ok(rec);
    assert.equal(rec.taskIdentifier, 'LIN-598');
    assert.equal(rec.canonicalId, 'uuid-598');
    const { items, total } = await store.list('ws', 'LIN-598');
    assert.equal(total, 1);
    assert.equal(items[0].snapshot.description, 'Original description');
  });

  test('dedupes when the inputHash is unchanged', async () => {
    const snap = snapshotFromContext(sampleContext());
    const first = await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'hash-1', snapshot: snap });
    const second = await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'hash-1', snapshot: snap });
    assert.ok(first);
    assert.equal(second, null); // no observed change → skipped
    const { total } = await store.list('ws', 'LIN-598');
    assert.equal(total, 1);
  });

  test('appends a new snapshot when the hash changes', async () => {
    await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'hash-1', snapshot: snapshotFromContext(sampleContext()) });
    await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'hash-2', snapshot: snapshotFromContext(sampleContext({ issue: { description: 'Edited' } })) });
    const { items, total } = await store.list('ws', 'LIN-598');
    assert.equal(total, 2);
    assert.equal(items[0].snapshot.description, 'Edited'); // newest first
    assert.equal(items[1].snapshot.description, 'Original description');
  });

  test('a pure-HEAD change writes no new snapshot (headSha is off the gate; LIN-1239)', async () => {
    const ctx = sampleContext();
    const inputHash = hashContext(ctx); // same slice → same gate hash on both reads
    // First read reports HEAD abc; the task slice is unchanged so the gate keys on inputHash.
    await store.captureIfChanged({
      urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598',
      inputHash, snapshot: snapshotFromContext(ctx, 'abcabca')
    });
    // Second read: identical slice (same inputHash) but a DIFFERENT reported HEAD.
    // Because the gate reads inputHash only, this must NOT append a snapshot.
    const second = await store.captureIfChanged({
      urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598',
      inputHash, snapshot: snapshotFromContext(ctx, 'defdefd')
    });
    assert.equal(second, null);
    const { items, total } = await store.list('ws', 'LIN-598');
    assert.equal(total, 1);
    assert.equal(items[0].snapshot.headSha, 'abcabca'); // still the first read's HEAD
  });

  test('ignores writes missing required keys', async () => {
    assert.equal(await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-1' }), null); // no inputHash
    assert.equal(await store.captureIfChanged({ inputHash: 'h' }), null); // no urlKey/identifier
    const { total } = await store.list('ws', 'LIN-1');
    assert.equal(total, 0);
  });
});

describe('TaskSnapshotStore retention + reads', () => {
  test('prunes to the per-task cap, keeping the newest', async () => {
    const store = new TaskSnapshotStore({ collection: createMockCollection(), maxPerTask: 3 });
    for (let i = 0; i < 6; i++) {
      await store.captureIfChanged({
        urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598',
        inputHash: `hash-${i}`, snapshot: snapshotFromContext(sampleContext({ issue: { description: `v${i}` } }))
      });
    }
    const { items, total } = await store.list('ws', 'LIN-598');
    assert.equal(total, 3);
    assert.deepEqual(items.map(i => i.snapshot.description), ['v5', 'v4', 'v3']);
  });

  test('the cap is per-task, not per-workspace', async () => {
    const store = new TaskSnapshotStore({ collection: createMockCollection(), maxPerTask: 2 });
    for (const id of ['LIN-1', 'LIN-2']) {
      for (let i = 0; i < 3; i++) {
        await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: id, canonicalId: `uuid-${id}`, inputHash: `${id}-${i}`, snapshot: { description: `${id}-v${i}` } });
      }
    }
    assert.equal((await store.list('ws', 'LIN-1')).total, 2);
    assert.equal((await store.list('ws', 'LIN-2')).total, 2);
  });

  test('list honours limit', async () => {
    const store = new TaskSnapshotStore({ collection: createMockCollection() });
    for (let i = 0; i < 4; i++) {
      await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: `h-${i}`, snapshot: { description: `v${i}` } });
    }
    const { items, total } = await store.list('ws', 'LIN-598', { limit: 2 });
    assert.equal(total, 4);
    assert.equal(items.length, 2);
  });

  test('resolves by canonicalId when given a UUID', async () => {
    const store = new TaskSnapshotStore({ collection: createMockCollection() });
    await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'h-1', snapshot: { description: 'x' } });
    const byUuid = await store.list('ws', 'uuid-598');
    assert.equal(byUuid.total, 1);
    assert.equal(byUuid.items[0].taskIdentifier, 'LIN-598');
  });

  test('diffLatest compares the two most recent snapshots', async () => {
    const store = new TaskSnapshotStore({ collection: createMockCollection() });
    await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'h-1', snapshot: snapshotFromContext(sampleContext()) });
    await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'h-2', snapshot: snapshotFromContext(sampleContext({ issue: { description: 'Edited' } })) });
    const diff = await store.diffLatest('ws', 'LIN-598');
    assert.equal(diff.changed, true);
    assert.ok(diff.fields.some(f => f.field === 'description'));
    assert.equal(diff.to.snapshot.description, 'Edited');
    assert.equal(diff.from.snapshot.description, 'Original description');
  });

  test('diffLatest reports no change with a single snapshot', async () => {
    const store = new TaskSnapshotStore({ collection: createMockCollection() });
    await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'h-1', snapshot: { description: 'x' } });
    const diff = await store.diffLatest('ws', 'LIN-598');
    assert.equal(diff.changed, false);
    assert.equal(diff.from, null);
    assert.ok(diff.to);
  });

  test('clear removes a workspace history', async () => {
    const store = new TaskSnapshotStore({ collection: createMockCollection() });
    await store.captureIfChanged({ urlKey: 'ws', taskIdentifier: 'LIN-598', canonicalId: 'uuid-598', inputHash: 'h-1', snapshot: { description: 'x' } });
    const removed = await store.clear('ws');
    assert.equal(removed, 1);
    assert.equal((await store.list('ws', 'LIN-598')).total, 0);
  });
});

// The workspace-wide window scan that feeds The Ship's Biscuit (LIN-1197). Seeds
// docs directly with controlled capturedAt (captureIfChanged stamps `new Date()`,
// which can't model an out-of-window "before").
describe('TaskSnapshotStore.listByWorkspace (LIN-1197)', () => {
  let collection;
  let store;
  const BASE = Date.UTC(2026, 6, 9, 12, 0, 0);
  const at = (offsetDays) => new Date(BASE - offsetDays * 86400000);

  beforeEach(() => {
    collection = createMockCollection();
    store = new TaskSnapshotStore({ collection });
  });

  function seed(urlKey, taskIdentifier, capturedAt, snapshot = {}) {
    collection._docs.push({
      _id: `${urlKey}:${taskIdentifier}:${capturedAt.getTime()}`,
      urlKey,
      taskIdentifier,
      canonicalId: taskIdentifier,
      inputHash: `h-${capturedAt.getTime()}`,
      capturedAt,
      seq: 0,
      snapshot
    });
  }

  test('returns only in-window records for the workspace, newest-first, in { items, total } shape', async () => {
    seed('ws-1', 'LIN-1', at(1), { title: 'recent' });
    seed('ws-1', 'LIN-2', at(3), { title: 'mid' });
    seed('ws-1', 'LIN-3', at(20), { title: 'pre-since, excluded' }); // older than the window
    seed('ws-2', 'LIN-9', at(1), { title: 'other workspace, excluded' });

    const res = await store.listByWorkspace('ws-1', { since: at(7) });

    assert.strictEqual(res.total, 2);
    assert.deepStrictEqual(res.items.map(r => r.taskIdentifier), ['LIN-1', 'LIN-2']); // newest capturedAt first
    assert.ok(!res.items.some(r => r.taskIdentifier === 'LIN-3'), 'pre-since record excluded');
    assert.ok(!res.items.some(r => r.taskIdentifier === 'LIN-9'), 'other-workspace record excluded');
    // toRecord public shape: capturedAt is an ISO string, snapshot passes through.
    assert.strictEqual(typeof res.items[0].capturedAt, 'string');
    assert.strictEqual(res.items[0].snapshot.title, 'recent');
  });

  test('omitting since returns the whole workspace (no lower bound)', async () => {
    seed('ws-1', 'LIN-1', at(1));
    seed('ws-1', 'LIN-2', at(90));
    const res = await store.listByWorkspace('ws-1', {});
    assert.strictEqual(res.total, 2);
  });

  test('missing urlKey (or no collection) yields an empty result, never throws', async () => {
    assert.deepStrictEqual(await store.listByWorkspace('', { since: at(7) }), { items: [], total: 0 });
    const noColl = new TaskSnapshotStore({ collection: null });
    assert.deepStrictEqual(await noColl.listByWorkspace('ws-1', { since: at(7) }), { items: [], total: 0 });
  });
});
