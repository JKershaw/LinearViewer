/**
 * Linear API call logging tests (LIN-538).
 *
 * Pins the observability added after the "Premature close" incident: every
 * outbound Linear request is recorded with its outcome, aggregated by
 * kpi-stats, and surfaced on the public /kpis page — counts only, no secrets.
 *
 *   - outcomeForStatus / store.record: the write path + privacy-safe shape.
 *   - the provider's countingFetch: records ok on a response, upstream on a
 *     thrown network error, and passes the result/error through untouched.
 *   - collectKpiStats: 24h totals, failure rate, by-outcome, hourly buckets,
 *     and graceful behaviour when the collection is absent (older deployments).
 *
 * Run with: node --test tests/unit/linear-call-log.test.js
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert';
import { LinearCallLogStore, outcomeForStatus, LINEAR_CALL_OUTCOMES } from '../../lib/linear-call-log.js';
import { collectKpiStats } from '../../lib/kpi-stats.js';
import { setLinearCallRecorder, fetchTeams } from '../../lib/providers/linear/index.js';

function fakeColl(docs = []) {
  return {
    _d: docs,
    async insertOne(d) { this._d.push(d); return { insertedId: d._id }; },
    find() { const d = this._d; return { toArray: async () => d }; },
    async countDocuments() { return this._d.length; }
  };
}

const emptyCollections = () => Object.fromEntries(
  ['sessions', 'userPreferences', 'workspacePreferences', 'customPrompts', 'localIssues',
    'dispatchQueue', 'dispatchHistory', 'dispatchTokens', 'proxyTokens', 'proxyEvents',
    'agentStatus', 'freeTier', 'recapCache', 'briefCache', 'reportHistory'].map(k => [k, fakeColl()])
);

describe('outcomeForStatus', () => {
  test('maps status ranges to outcome labels', () => {
    assert.strictEqual(outcomeForStatus(200), 'ok');
    assert.strictEqual(outcomeForStatus(204), 'ok');
    assert.strictEqual(outcomeForStatus(401), 'auth');
    assert.strictEqual(outcomeForStatus(403), 'auth');
    assert.strictEqual(outcomeForStatus(404), 'client_error');
    assert.strictEqual(outcomeForStatus(429), 'client_error');
    assert.strictEqual(outcomeForStatus(500), 'server_error');
    assert.strictEqual(outcomeForStatus(503), 'server_error');
  });
});

describe('LinearCallLogStore.record', () => {
  test('writes a privacy-safe row (no token/workspace/content fields)', async () => {
    const coll = fakeColl();
    const store = new LinearCallLogStore({ collection: coll });
    const doc = await store.record({ outcome: 'ok', status: 200, durationMs: 120 });
    assert.ok(doc && doc._id);
    assert.deepStrictEqual(
      Object.keys(doc).sort(),
      ['_id', 'durationMs', 'expiresAt', 'outcome', 'status', 'timestamp'].sort()
    );
    assert.ok(doc.expiresAt instanceof Date && doc.expiresAt > doc.timestamp);
  });

  test('coerces an unknown outcome to internal', async () => {
    const store = new LinearCallLogStore({ collection: fakeColl() });
    const doc = await store.record({ outcome: 'nonsense' });
    assert.strictEqual(doc.outcome, 'internal');
  });

  test('is fire-and-forget — never throws when the collection write fails', async () => {
    const broken = { insertOne() { throw new Error('mongo down'); } };
    const store = new LinearCallLogStore({ collection: broken });
    const doc = await store.record({ outcome: 'ok' });
    assert.strictEqual(doc, null);
  });
});

describe('provider countingFetch (via fetchTeams)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; setLinearCallRecorder(null); });

  test('records ok and returns data on a 200 response', async () => {
    const recorded = [];
    setLinearCallRecorder((c) => { recorded.push(c); });
    globalThis.fetch = async () => new Response(
      JSON.stringify({ data: { teams: { nodes: [{ id: 't1', name: 'Team', key: 'LIN' }] } } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
    const teams = await fetchTeams('Bearer x');
    assert.strictEqual(teams.length, 1);
    assert.strictEqual(recorded.length, 1);
    assert.strictEqual(recorded[0].outcome, 'ok');
    assert.strictEqual(recorded[0].status, 200);
    assert.ok(typeof recorded[0].durationMs === 'number');
  });

  test('records upstream and re-throws on a network failure (Premature close)', async () => {
    const recorded = [];
    setLinearCallRecorder((c) => { recorded.push(c); });
    globalThis.fetch = async () => {
      const e = new Error('Invalid response body while trying to fetch https://api.linear.app/graphql: Premature close');
      e.name = 'FetchError';
      throw e;
    };
    await assert.rejects(() => fetchTeams('Bearer x'));
    assert.strictEqual(recorded.length, 1);
    assert.strictEqual(recorded[0].outcome, 'upstream');
    assert.strictEqual(recorded[0].status, null);
  });
});

describe('collectKpiStats — linear calls', () => {
  test('aggregates 24h totals, failure rate, by-outcome, and hourly buckets', async () => {
    const linearColl = fakeColl();
    const store = new LinearCallLogStore({ collection: linearColl });
    await store.record({ outcome: 'ok', status: 200, durationMs: 100 });
    await store.record({ outcome: 'ok', status: 200, durationMs: 100 });
    await store.record({ outcome: 'upstream', status: null, durationMs: 150 });
    await store.record({ outcome: 'auth', status: 401, durationMs: 80 });

    const collections = emptyCollections();
    collections.linearCalls = linearColl;
    const stats = await collectKpiStats(collections, { dbBackend: 'mangodb' });

    assert.strictEqual(stats.totals.linearCalls24h, 4);
    assert.strictEqual(stats.totals.linearFailures24h, 2);
    assert.strictEqual(stats.linearCalls.failureRatePct, 50);
    assert.strictEqual(stats.linearCalls.total30d, 4);
    assert.strictEqual(stats.linearCalls.byOutcome.ok, 2);
    assert.strictEqual(stats.linearCalls.byOutcome.upstream, 1);
    assert.strictEqual(stats.linearCalls.byOutcome.auth, 1);
    // Hourly window has one bucket per hour; the most recent holds these calls.
    assert.strictEqual(stats.linearCalls.hourly.ok.at(-1), 2);
    assert.strictEqual(stats.linearCalls.hourly.failed.at(-1), 2);
    assert.strictEqual(stats.linearCalls.hourly.hours.length, stats.linearCalls.hourly.ok.length);
  });

  test('is safe when the linearCalls collection is absent (older deployment)', async () => {
    const stats = await collectKpiStats(emptyCollections(), { dbBackend: 'mangodb' });
    assert.strictEqual(stats.totals.linearCalls24h, 0);
    assert.strictEqual(stats.linearCalls.total30d, 0);
    assert.strictEqual(stats.linearCalls.failureRatePct, null);
    // every outcome label present and zeroed
    for (const o of LINEAR_CALL_OUTCOMES) assert.strictEqual(stats.linearCalls.byOutcome[o], 0);
  });
});
