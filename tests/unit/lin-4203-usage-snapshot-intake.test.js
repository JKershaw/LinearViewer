/**
 * LIN-4203 (LIN-4195 piece 6, D8): the intake counts legacy `kind:'usage'` snapshot posts. It never rejects them,
 * and a counter fault never changes the feedback result.
 */
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { countUsageSnapshotPost, usageSnapshotDayKey, USAGE_SNAPSHOT_INTAKE_COLLECTION } from '../../lib/usage-snapshot-intake.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const NOON = Date.UTC(2026, 10, 4, 12, 0, 0);

describe('LIN-4203: countUsageSnapshotPost', () => {
  test('counts per workspace per UTC day, into one document each', async () => {
    const col = createMockCollection();
    await countUsageSnapshotPost(col, { urlKey: 'acme', now: NOON });
    await countUsageSnapshotPost(col, { urlKey: 'acme', now: NOON + 1000 });
    await countUsageSnapshotPost(col, { urlKey: 'beta', now: NOON });
    await countUsageSnapshotPost(col, { urlKey: 'acme', now: NOON + 24 * 3600 * 1000 });
    assert.equal((await col.findOne({ _id: 'acme:2026-11-04' })).count, 2);
    assert.equal((await col.findOne({ _id: 'beta:2026-11-04' })).count, 1);
    assert.equal((await col.findOne({ _id: 'acme:2026-11-05' })).count, 1);
    assert.equal(usageSnapshotDayKey(NOON), '2026-11-04');
  });

  test('is a no-op without a collection or a workspace key, and never throws', async () => {
    await countUsageSnapshotPost(null, { urlKey: 'acme', now: NOON });
    await countUsageSnapshotPost(createMockCollection(), { urlKey: null, now: NOON });
    assert.equal(USAGE_SNAPSHOT_INTAKE_COLLECTION, 'usage-snapshot-intake');
  });
});

describe('LIN-4203: the feedback intake accepts and counts a legacy usage snapshot', () => {
  async function fixture({ usageSnapshotCollection }) {
    const store = new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection(),
      usageSnapshotCollection,
    });
    const created = await store.addItem('acme', { prompt: 'do the thing' });
    await store.takeItem(created._id, 'acme');
    return { store, id: created._id };
  }

  test('a kind:usage post lands in the feedback and is counted', async () => {
    const counter = createMockCollection();
    const { store, id } = await fixture({ usageSnapshotCollection: counter });
    const res = await store.addFeedback(id, 'acme', { message: '[usage] {"schema":1}', kind: 'usage' }, null);
    assert.equal(res.success, true);
    const doc = await store.getItemFeedback('acme', id);
    assert.equal(doc.feedback.at(-1).kind, 'usage', 'the snapshot is accepted, not rejected (D8)');
    assert.equal((await counter.findOne({ _id: `acme:${usageSnapshotDayKey()}` })).count, 1);
  });

  test('other kinds are not counted', async () => {
    const counter = createMockCollection();
    const { store, id } = await fixture({ usageSnapshotCollection: counter });
    await store.addFeedback(id, 'acme', { message: 'beat', kind: 'heartbeat' }, null);
    assert.equal(await counter.findOne({ _id: `acme:${usageSnapshotDayKey()}` }), null);
  });

  test('a counter fault never changes the feedback result', async () => {
    const broken = { updateOne: async () => { throw new Error('counter down'); } };
    const { store, id } = await fixture({ usageSnapshotCollection: broken });
    const res = await store.addFeedback(id, 'acme', { message: '[usage] {}', kind: 'usage' }, null);
    assert.equal(res.success, true);
  });
});
