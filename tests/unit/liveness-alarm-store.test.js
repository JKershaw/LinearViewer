/**
 * Unit tests for lib/liveness-alarm-store.js (LIN-3258).
 *
 * Uses a REAL MangoDB tmpdir (tests/fixtures/mango-tmpdir.js), not the shared
 * mock collection: the store's `$setOnInsert` upsert and `$ne: null` state
 * filter are exactly the operators tests/fixtures/mock-collection.js ignores.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LivenessAlarmStore, livenessAlarmId, LIVENESS_ALARM_RULES } from '../../lib/liveness-alarm-store.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

describe('liveness-alarm-store', () => {
  const harness = createMangoTmpdir('liveness-alarm-store-');
  let db;
  let store;

  before(() => harness.connect());
  after(() => harness.close());
  beforeEach(() => {
    db = harness.freshDb();
    store = new LivenessAlarmStore({ collection: db.collection('liveness-alarms') });
  });

  test('livenessAlarmId is deterministic over sorted members', () => {
    const a = livenessAlarmId({ rule: 'r', shape: 'cycle', members: ['b', 'a'] });
    const b = livenessAlarmId({ rule: 'r', shape: 'cycle', members: ['a', 'b'] });
    assert.equal(a, b);
    assert.equal(a, 'r:cycle:a,b');
  });

  test('open inserts once and confirms on subsequent ticks', async () => {
    const firedAt = new Date('2026-10-02T15:20:00.000Z');
    const doc = await store.open({
      urlKey: 'acme',
      rule: LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT,
      shape: 'cycle',
      members: ['b', 'a'],
      startedAt: '2026-10-02T15:12:57.700Z',
      firedAt,
      detail: { edges: [] }
    });
    assert.equal(doc._id, 'stopped-or-circular-wait:cycle:a,b');
    assert.equal(doc.clearedAt, null);
    assert.equal(doc.missCount, 0);
    assert.equal(doc.startedAt.toISOString(), '2026-10-02T15:12:57.700Z');

    const confirmed = await store.open({
      urlKey: 'acme',
      rule: LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT,
      shape: 'cycle',
      members: ['a', 'b'],
      startedAt: '2026-10-02T15:12:57.700Z',
      firedAt: new Date('2026-10-02T15:30:00.000Z')
    });
    assert.equal(confirmed._id, doc._id);
    // startedAt/firedAt are preserved; only lastSeenAt moves on a confirm.
    assert.equal(confirmed.firedAt.toISOString(), '2026-10-02T15:20:00.000Z');
    assert.equal(confirmed.lastSeenAt.toISOString(), '2026-10-02T15:30:00.000Z');
    assert.equal(confirmed.updatedAt.toISOString(), '2026-10-02T15:20:00.000Z');
    const all = await store.list('acme', { state: 'all' });
    assert.equal(all.length, 1, 'a confirm never mints a second record');
  });

  test('markMiss increments; clear sets clearedAt; state filter/roster read', async () => {
    const doc = await store.open({
      urlKey: 'acme',
      rule: LIVENESS_ALARM_RULES.DISPATCHER_SILENT,
      members: ['acme'],
      startedAt: '2026-10-02T17:25:00.000Z',
      firedAt: new Date('2026-10-02T17:55:00.000Z')
    });
    const missed = await store.markMiss(doc._id, { at: new Date('2026-10-02T18:05:00.000Z') });
    assert.equal(missed.missCount, 1);
    assert.equal((await store.list('acme', { state: 'open' })).length, 1);
    assert.deepEqual(await store.listOpenWorkspaceKeys(), ['acme']);

    await store.clear(doc._id, { clearedAt: new Date('2026-10-02T18:15:00.000Z') });
    assert.equal((await store.list('acme', { state: 'open' })).length, 0);
    assert.equal((await store.list('acme', { state: 'cleared' })).length, 1);
    assert.deepEqual(await store.listOpenWorkspaceKeys(), []);
  });

  test('a recurrence after a clear reopens the same condition row in place', async () => {
    const open = (firedAt) => store.open({
      urlKey: 'acme',
      rule: LIVENESS_ALARM_RULES.STOPPED_OR_CIRCULAR_WAIT,
      shape: 'cycle',
      members: ['a', 'b'],
      startedAt: firedAt,
      firedAt: new Date(firedAt)
    });
    const first = await open('2026-10-02T15:20:00.000Z');
    await store.clear(first._id, { clearedAt: new Date('2026-10-02T18:55:00.000Z') });
    const second = await open('2026-10-02T20:00:00.000Z');
    assert.equal(second._id, first._id);
    assert.equal(second.clearedAt, null);
    assert.equal(second.firedAt.toISOString(), '2026-10-02T20:00:00.000Z');
    assert.equal((await store.list('acme', { state: 'all' })).length, 1);
  });

  test('cleanup removes only cleared alarms older than the retention window', async () => {
    const openDoc = await store.open({ urlKey: 'acme', rule: LIVENESS_ALARM_RULES.DISPATCHER_SILENT, members: ['acme'], firedAt: new Date('2026-09-01T00:00:00.000Z') });
    const oldCleared = await store.open({ urlKey: 'old', rule: LIVENESS_ALARM_RULES.DISPATCHER_SILENT, members: ['old'], firedAt: new Date('2026-09-01T00:00:00.000Z') });
    await store.clear(oldCleared._id, { clearedAt: new Date('2026-09-01T00:00:00.000Z') });
    const removed = await store.cleanup({ now: new Date('2026-10-02T00:00:00.000Z'), retainMs: 30 * 24 * 60 * 60 * 1000 });
    assert.equal(removed, 1);
    assert.ok(await store.getById(openDoc._id), 'an open alarm is never evicted');
    assert.equal(await store.getById(oldCleared._id), null);
  });
});
