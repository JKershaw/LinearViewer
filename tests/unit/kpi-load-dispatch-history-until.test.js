/**
 * LIN-3724: `loadDispatchHistory` / `dispatchHistoryPipeline` gain an optional
 * exclusive upper bound `until`. Absent, the query is exactly what it was
 * (tests/unit/kpi-stats-reads-pin.test.js pins the public page's reads).
 *
 * Run with: node --test tests/unit/kpi-load-dispatch-history-until.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { loadDispatchHistory } from '../../lib/kpi-stats.js';

const since = new Date('2026-10-01T00:00:00.000Z');
const until = new Date('2026-10-03T00:00:00.000Z');

const recording = () => {
  const calls = [];
  return {
    calls,
    aggregate: (pipeline) => { calls.push({ method: 'aggregate', pipeline }); return { toArray: async () => [] }; }
  };
};
const matchOf = (calls) => calls[0].pipeline[0].$match;

test('until adds $lt beside $gte', async () => {
  const col = recording();
  await loadDispatchHistory(col, { since, until });
  assert.deepEqual(matchOf(col.calls), { dispatchedAt: { $gte: since, $lt: until } });
});

test('until with urlKey and no since is a $lt-only range', async () => {
  const col = recording();
  await loadDispatchHistory(col, { until, urlKey: 'ws-a' });
  assert.deepEqual(matchOf(col.calls), { dispatchedAt: { $lt: until }, urlKey: 'ws-a' });
});

test('until alone still produces a leading $match', async () => {
  const col = recording();
  await loadDispatchHistory(col, { until });
  assert.deepEqual(matchOf(col.calls), { dispatchedAt: { $lt: until } });
});

test('absent until the $match is unchanged', async () => {
  const col = recording();
  await loadDispatchHistory(col, { since });
  assert.deepEqual(matchOf(col.calls), { dispatchedAt: { $gte: since } });
  const keyed = recording();
  await loadDispatchHistory(keyed, { since, urlKey: 'ws-a' });
  assert.deepEqual(matchOf(keyed.calls), { dispatchedAt: { $gte: since }, urlKey: 'ws-a' });
  const bare = recording();
  await loadDispatchHistory(bare, {});
  assert.equal(bare.calls[0].pipeline[0].$match, undefined, 'no bounds, no $match');
});

test('the find fallback gets the same range', async () => {
  const filters = [];
  const col = { find: (filter) => { filters.push(filter); return { toArray: async () => [] }; } };
  await loadDispatchHistory(col, { since, until, urlKey: 'ws-a' });
  await loadDispatchHistory(col, { since });
  assert.deepEqual(filters[0], { dispatchedAt: { $gte: since, $lt: until }, urlKey: 'ws-a' });
  assert.deepEqual(filters[1], { dispatchedAt: { $gte: since } });
});

test('on a real engine, until excludes rows dispatched at or after it and since includes its own instant', async () => {
  const harness = createMangoTmpdir('lin-3724-until-');
  await harness.connect();
  try {
    const col = harness.freshDb().collection('dispatch-history');
    const row = (id, iso) => ({ _id: id, urlKey: 'ws-a', status: 'done', dispatchedAt: new Date(iso), feedback: [] });
    await col.insertMany([
      row('before', '2026-09-30T23:59:59.999Z'), row('at-since', '2026-10-01T00:00:00.000Z'),
      row('inside', '2026-10-02T12:00:00.000Z'), row('at-until', '2026-10-03T00:00:00.000Z')
    ]);
    const ids = async (opts) => (await loadDispatchHistory(col, opts)).map((r) => r._id).sort();
    assert.deepEqual(await ids({ since, until }), ['at-since', 'inside']);
    assert.deepEqual(await ids({ since }), ['at-since', 'at-until', 'inside']);
  } finally {
    await harness.close();
  }
});
