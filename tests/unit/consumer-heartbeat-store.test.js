import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MangoClient } from '@jkershaw/mangodb';
import { ConsumerHeartbeatStore, HEARTBEAT_TTL_MS, MAX_LIVE_PER_WORKSPACE } from '../../lib/consumer-heartbeat-store.js';
import { createHourlyCleanupRun } from '../../lib/hourly-cleanup.js';

const beat = (instanceId, extra = {}) => ({
  schema: 1, consumerKind: 'simple-dispatcher', instanceId,
  sentAt: '2026-10-18T12:00:00.000Z', intervalMs: 60000, ...extra
});

describe('ConsumerHeartbeatStore (LIN-1952)', () => {
  let dir, client, collection, store;
  const t0 = new Date('2026-10-18T12:00:05.000Z');

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'consumer-heartbeat-store-'));
    client = new MangoClient(dir);
    await client.connect();
    collection = client.db('linear-viewer').collection('consumer-heartbeats');
  });
  after(async () => {
    if (client?.close) await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await collection.deleteMany({});
    store = new ConsumerHeartbeatStore({ collection });
  });

  test('record stores the documented doc shape', async () => {
    await store.record({ urlKey: 'ws', tokenId: 'tok1', parsed: beat('a', { loadAvg1: 1.5 }), now: t0 });
    const doc = await collection.findOne({ _id: 'ws::a' });
    assert.equal(doc.urlKey, 'ws');
    assert.equal(doc.instanceId, 'a');
    assert.equal(doc.consumerKind, 'simple-dispatcher');
    assert.equal(doc.tokenId, 'tok1');
    assert.deepEqual(doc.receivedAt, t0);
    assert.equal(doc.expiresAt.getTime(), t0.getTime() + HEARTBEAT_TTL_MS);
    assert.equal(HEARTBEAT_TTL_MS, 15 * 60 * 1000);
    assert.equal(doc.clockSkewMs, 5000);
    assert.deepEqual(doc.fields, { schema: 1, sentAt: '2026-10-18T12:00:00.000Z', intervalMs: 60000, loadAvg1: 1.5 });
  });

  test('a second beat replaces the doc for the same (urlKey, instanceId)', async () => {
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('a', { loadAvg1: 1 }), now: t0 });
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('a'), now: new Date(t0.getTime() + 60000) });
    assert.equal(await collection.countDocuments({}), 1);
    const [live] = await store.listLive('ws', new Date(t0.getTime() + 60000));
    assert.equal(live.fields.loadAvg1, undefined, 'replaced, not merged');
  });

  test('same instanceId in different workspaces stays separate', async () => {
    await store.record({ urlKey: 'ws1', tokenId: 't', parsed: beat('a'), now: t0 });
    await store.record({ urlKey: 'ws2', tokenId: 't', parsed: beat('a'), now: t0 });
    assert.equal((await store.listLive('ws1', t0)).length, 1);
    assert.equal(await collection.countDocuments({}), 2);
  });

  test('listLive filters expiresAt > now, newest first, and is workspace-scoped', async () => {
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('old'), now: new Date(t0.getTime() - HEARTBEAT_TTL_MS - 1) });
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('mid'), now: new Date(t0.getTime() - 1000) });
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('new'), now: t0 });
    await store.record({ urlKey: 'other', tokenId: 't', parsed: beat('x'), now: t0 });
    const live = await store.listLive('ws', t0);
    assert.deepEqual(live.map(d => d.instanceId), ['new', 'mid']);
  });

  test('cap: more than 20 live instances evicts the oldest, never the newest', async () => {
    for (let i = 0; i < MAX_LIVE_PER_WORKSPACE + 3; i++) {
      await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat(`i${i}`), now: new Date(t0.getTime() + i * 1000) });
    }
    const live = await store.listLive('ws', new Date(t0.getTime() + 60000));
    assert.equal(MAX_LIVE_PER_WORKSPACE, 20);
    assert.equal(live.length, 20);
    assert.equal(live[0].instanceId, `i${MAX_LIVE_PER_WORKSPACE + 2}`);
    assert.ok(!live.some(d => ['i0', 'i1', 'i2'].includes(d.instanceId)));
  });

  test('cap in one workspace does not evict another workspace', async () => {
    await store.record({ urlKey: 'quiet', tokenId: 't', parsed: beat('q'), now: t0 });
    for (let i = 0; i < 22; i++) {
      await store.record({ urlKey: 'busy', tokenId: 't', parsed: beat(`i${i}`), now: new Date(t0.getTime() + i) });
    }
    assert.equal((await store.listLive('quiet', t0)).length, 1);
  });

  test('cleanup deletes only expired docs and returns the count', async () => {
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('dead'), now: new Date(t0.getTime() - HEARTBEAT_TTL_MS - 1000) });
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('live'), now: t0 });
    assert.equal(await store.cleanup(t0), 1);
    assert.deepEqual((await collection.find({}).toArray()).map(d => d.instanceId), ['live']);
  });

  test('cleanup returns 0 and does not throw when the collection errors', async () => {
    const bad = new ConsumerHeartbeatStore({ collection: { deleteMany: async () => { throw new Error('down'); } } });
    const real = console.error;
    console.error = () => {};
    try { assert.equal(await bad.cleanup(), 0); } finally { console.error = real; }
  });

  test('the hourly cleanup run sweeps the heartbeat store', async () => {
    const noop = { cleanup: async () => 0 };
    await store.record({ urlKey: 'ws', tokenId: 't', parsed: beat('dead'), now: new Date(Date.now() - HEARTBEAT_TTL_MS - 60000) });
    const run = createHourlyCleanupRun({
      dispatchQueueStore: noop, freeTierStore: noop, proxyTokenStore: noop, observationSessionsStore: noop,
      harbourFeedbackTokenStore: noop, observerStateStore: noop, observerShadowLogStore: noop, sessionStore: noop,
      consumerHeartbeatStore: store, logger: { log() {}, error() {} }
    });
    await run();
    assert.equal(await collection.countDocuments({}), 0);
  });
});
