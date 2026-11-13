/**
 * Unit tests for llm-call-log.js (LIN-418)
 *
 * Run with: node --test tests/unit/llm-call-log.test.js
 *
 * Covers the append-only record contract: every call is stored with the
 * captured metadata, non-numeric fields are coerced to null, and recording never
 * throws (fire-and-forget). The reads are covered further down: the store returns
 * docs (`listInHorizon`), the call telemetry that is not cost is pure (`callTelemetryOf`),
 * and every cost figure is the one calls read (`readCalls`, lib/cost-read-calls.js, LIN-4179, LIN-4457).
 */
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert';
import { LlmCallLogStore, callTelemetryOf } from '../../lib/llm-call-log.js';
import { readCalls, appCallsOf, callsSurfaceOf } from '../../lib/cost-read-calls.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';

// Minimal in-memory mock of the MongoDB/MangoDB collection surface.
function createMockCollection() {
  const docs = [];
  return {
    _docs: docs,
    async insertOne(doc) {
      docs.push(doc);
      return { insertedId: doc._id };
    },
    find(query) {
      const results = docs.filter(doc => {
        if (query.urlKey && doc.urlKey !== query.urlKey) return false;
        if (query.issueIdentifier && doc.issueIdentifier !== query.issueIdentifier) return false;
        if (query.feature && doc.feature !== query.feature) return false;
        if (query.expiresAt?.$gt && !(doc.expiresAt > query.expiresAt.$gt)) return false;
        // LIN-3161: honour the `timestamp` bound (A1's additive read horizon).
        // Without this the double silently ignores the operator and
        // summarizeByIssue's `since` test would pass vacuously.
        if (query.timestamp?.$gte && !(doc.timestamp >= query.timestamp.$gte)) return false;
        if (query.timestamp?.$lt && !(doc.timestamp < query.timestamp.$lt)) return false;
        return true;
      });
      return { async toArray() { return results; } };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        const doc = docs[i];
        let match = true;
        if (query.urlKey && doc.urlKey !== query.urlKey) match = false;
        if (query.expiresAt?.$lt && !(doc.expiresAt < query.expiresAt.$lt)) match = false;
        if (match) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    }
  };
}

describe('LlmCallLogStore.record', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('persists captured metadata', async () => {
    await store.record({
      urlKey: 'acme', feature: 'recommend', issueIdentifier: 'LIN-1',
      model: 'openai/gpt-5.4-mini', provider: 'OpenAI',
      promptTokens: 1200, completionTokens: 300, totalTokens: 1500,
      cost: 0.0042, finishReason: 'stop', durationMs: 1834
    });
    assert.strictEqual(collection._docs.length, 1);
    const doc = collection._docs[0];
    assert.strictEqual(doc.urlKey, 'acme');
    assert.strictEqual(doc.feature, 'recommend');
    assert.strictEqual(doc.model, 'openai/gpt-5.4-mini');
    assert.strictEqual(doc.provider, 'OpenAI');
    assert.strictEqual(doc.cost, 0.0042);
    assert.strictEqual(doc.completionTokens, 300);
    assert.strictEqual(doc.durationMs, 1834);
    assert.ok(doc.timestamp instanceof Date);
    // LIN-3163 (B): the call log is retained for the project's lifetime — no expiry stamp.
    assert.ok(!('expiresAt' in doc), 'a lifetime-retained call row carries no expiresAt stamp');
    assert.ok(typeof doc._id === 'string' && doc._id.length > 0);
  });

  test('stores maxTokens and reasoningTokens when present, null when absent (LIN-3359)', async () => {
    await store.record({ feature: 'flight-companion', finishReason: 'length', maxTokens: 4000, reasoningTokens: 3900 });
    await store.record({ feature: 'flight-companion' });
    assert.strictEqual(collection._docs[0].maxTokens, 4000);
    assert.strictEqual(collection._docs[0].reasoningTokens, 3900);
    assert.strictEqual(collection._docs[1].maxTokens, null);
    assert.strictEqual(collection._docs[1].reasoningTokens, null);
  });

  test('coerces missing/non-numeric fields to null', async () => {
    await store.record({ feature: 'recap' });
    const doc = collection._docs[0];
    assert.strictEqual(doc.urlKey, null);
    assert.strictEqual(doc.model, null);
    assert.strictEqual(doc.provider, null);
    assert.strictEqual(doc.promptTokens, null);
    assert.strictEqual(doc.completionTokens, null);
    assert.strictEqual(doc.cost, null);
    assert.strictEqual(doc.durationMs, null);
  });

  test('NaN/Infinity numbers become null', async () => {
    await store.record({ cost: NaN, promptTokens: Infinity, completionTokens: 'x' });
    const doc = collection._docs[0];
    assert.strictEqual(doc.cost, null);
    assert.strictEqual(doc.promptTokens, null);
    assert.strictEqual(doc.completionTokens, null);
  });

  test('works (and does not throw) without a collection', async () => {
    const noColl = new LlmCallLogStore({});
    const doc = await noColl.record({ feature: 'brief', cost: 0.01 });
    assert.strictEqual(doc.feature, 'brief');
    assert.strictEqual(doc.cost, 0.01);
  });

  test('never throws when the collection insert fails (fire-and-forget)', async () => {
    const flaky = new LlmCallLogStore({
      collection: { async insertOne() { throw new Error('mongo down'); } }
    });
    const doc = await flaky.record({ feature: 'recommend' });
    assert.strictEqual(doc.feature, 'recommend'); // returns the doc despite the error
  });
});

describe('LlmCallLogStore.listInHorizon (LIN-4179: docs only, filtered)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const ago = (days) => new Date(Date.now() - days * DAY_MS);
  let collection;
  let store;

  beforeEach(() => {
    collection = createMockCollection();
    collection._docs.push(
      { _id: 'a', urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'proxy-x', cost: 0.2, timestamp: ago(2) },
      { _id: 'b', urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'review', cost: null, timestamp: ago(3) },
      { _id: 'c', urlKey: 'acme', issueIdentifier: 'LIN-2', feature: 'scan', cost: 0.05, timestamp: ago(1) },
      { _id: 'old', urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'proxy-x', cost: 0.9, timestamp: ago(60) },
      { _id: 'other', urlKey: 'beta', issueIdentifier: 'LIN-1', feature: 'proxy-x', cost: 0.5, timestamp: ago(1) },
    );
    store = new LlmCallLogStore({ collection });
  });

  const ids = (docs) => docs.map(d => d._id).sort();

  test('returns the workspace docs inside the 30-day horizon, raw: a null cost stays null', async () => {
    const docs = await store.listInHorizon('acme');
    assert.deepStrictEqual(ids(docs), ['a', 'b', 'c']);
    assert.strictEqual(docs.find(d => d._id === 'b').cost, null);
  });

  test('filters by issue identifier', async () => {
    assert.deepStrictEqual(ids(await store.listInHorizon('acme', { issueIdentifier: 'LIN-1' })), ['a', 'b']);
  });

  test('filters by feature', async () => {
    assert.deepStrictEqual(ids(await store.listInHorizon('acme', { feature: 'scan' })), ['c']);
  });

  test('an explicit since is the lower bound (the Biscuit window is a parameter)', async () => {
    const since = ago(2.5);
    assert.deepStrictEqual(ids(await store.listInHorizon('acme', { since })), ['a', 'c']);
  });

  test('empty for a missing urlKey, a missing store collection, or an empty issue or feature filter', async () => {
    assert.deepStrictEqual(await store.listInHorizon(undefined), []);
    assert.deepStrictEqual(await new LlmCallLogStore({}).listInHorizon('acme'), []);
    assert.deepStrictEqual(await store.listInHorizon('acme', { issueIdentifier: '' }), []);
    assert.deepStrictEqual(await store.listInHorizon('acme', { feature: null }), []);
  });

  test('a collection error is logged and reads as no calls, never thrown (the page still renders)', async () => {
    const flaky = new LlmCallLogStore({ collection: { find() { throw new Error('boom'); } } });
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.deepStrictEqual(await flaky.listInHorizon('acme'), []);
    } finally {
      console.error = originalError;
    }
  });

  test('the store has no cost fold left: its summary methods are gone (LIN-4179)', () => {
    for (const name of ['summarize', 'summarizeByIssue', 'summarizeByFeature']) {
      assert.strictEqual(typeof LlmCallLogStore.prototype[name], 'undefined', `${name} must be deleted from the store`);
    }
  });
});

describe('callTelemetryOf: the call telemetry that is not cost (pure)', () => {
  const doc = (over) => ({ urlKey: 'acme', feature: 'proxy-x', model: 'm1', timestamp: new Date('2026-11-01T00:00:00Z'), ...over });

  test('counts calls and sums finite tokens; a missing token count adds nothing', () => {
    const t = callTelemetryOf([doc({ totalTokens: 10 }), doc({ totalTokens: null }), doc({ totalTokens: 5 })]);
    assert.strictEqual(t.totalCalls, 3);
    assert.strictEqual(t.totalTokens, 15);
  });

  test('lastCallAt is the latest timestamp, or null with no calls', () => {
    const t = callTelemetryOf([doc({ timestamp: new Date('2026-11-01T00:00:00Z') }), doc({ timestamp: new Date('2026-11-02T00:00:00Z') })]);
    assert.strictEqual(t.lastCallAt, '2026-11-02T00:00:00.000Z');
    assert.strictEqual(callTelemetryOf([]).lastCallAt, null);
  });

  test('latency is nearest-rank per (feature, model); a call with no duration is in no group', () => {
    const docs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(ms => doc({ durationMs: ms * 100 }));
    docs.push(doc({ durationMs: null }));
    const [row] = callTelemetryOf(docs).latencyByFeatureModel;
    assert.deepStrictEqual({ feature: row.feature, model: row.model, count: row.count, p50Ms: row.p50Ms, p90Ms: row.p90Ms, maxMs: row.maxMs },
      { feature: 'proxy-x', model: 'm1', count: 10, p50Ms: 500, p90Ms: 900, maxMs: 1000 });
  });

  test('latency rows sort by p90 descending, then feature, then model', () => {
    const rows = callTelemetryOf([
      doc({ feature: 'b', model: 'm', durationMs: 100 }),
      doc({ feature: 'a', model: 'm', durationMs: 100 }),
      doc({ feature: 'c', model: 'm', durationMs: 900 }),
    ]).latencyByFeatureModel;
    assert.deepStrictEqual(rows.map(r => r.feature), ['c', 'a', 'b']);
  });
});

describe('readCalls: the calls figure (LIN-4179, the figure rule)', () => {
  const doc = (feature, cost) => ({ feature, model: 'm1', cost });

  test('a null cost is counted as unpriced, never added as 0', () => {
    const f = readCalls([doc('scan', 0.03), doc('scan', null), doc('review', 0)]);
    assert.strictEqual(f.calls, 3);
    assert.strictEqual(f.pricedCalls, 2);
    assert.strictEqual(f.unpricedCalls, 1);
    assert.strictEqual(f.pricedUsd, 0.03);
    assert.strictEqual(f.complete, false);
    assert.strictEqual(f.totalUsd, null, 'a partly priced sum publishes no total');
  });

  test('a complete zero is a real total of $0, distinct from no data', () => {
    const zero = readCalls([doc('review', 0)]);
    assert.strictEqual(zero.complete, true);
    assert.strictEqual(zero.totalUsd, 0);
    const none = readCalls([]);
    assert.strictEqual(none.calls, 0);
    assert.strictEqual(none.complete, false, 'no calls is no data, not a complete zero');
    assert.strictEqual(none.totalUsd, null);
  });

  test('byFeature is busiest first, with each feature\'s priced sum and unpriced count', () => {
    const f = readCalls([doc('review', null), doc('scan', 0.05), doc('scan', 0.03), doc('scan', null)]);
    assert.deepStrictEqual(f.byFeature.map(r => r.feature), ['scan', 'review']);
    assert.deepStrictEqual(f.byFeature[0], { feature: 'scan', calls: 3, pricedCalls: 2, unpricedCalls: 1, pricedUsd: 0.08 });
  });
});

describe('appCallsOf and callsSurfaceOf: the wire shape and the surfaces (LIN-4179)', () => {
  test('appCallsOf is the S1 wire shape: calls, costUsd (the priced sum), unpricedCalls, byFeature (feature, calls, costUsd)', () => {
    const app = appCallsOf([
      { feature: 'proxy-x', model: 'm', cost: 0.2 },
      { feature: 'review', model: 'm', cost: null },
    ]);
    assert.deepStrictEqual(Object.keys(app), ['calls', 'costUsd', 'unpricedCalls', 'byFeature']);
    assert.deepStrictEqual(app, {
      calls: 2,
      costUsd: 0.2,
      unpricedCalls: 1,
      byFeature: [
        { feature: 'proxy-x', calls: 1, costUsd: 0.2 },
        { feature: 'review', calls: 1, costUsd: 0 },
      ],
    });
  });

  test('appCallsOf over no calls is the literal zero shape (never the no-data carrier)', () => {
    assert.deepStrictEqual(appCallsOf([]), { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] });
  });

  test('callsSurfaceOf is Health\'s and the Weather line\'s figure: the calls read and the telemetry, with the unpriced count', () => {
    const s = callsSurfaceOf([{ feature: 'scan', model: 'm', cost: 0.04, totalTokens: 7, timestamp: new Date('2026-11-01T00:00:00Z') }, { feature: 'scan', model: 'm', cost: null, totalTokens: 3, timestamp: new Date('2026-11-02T00:00:00Z') }]);
    assert.strictEqual(s.totalCalls, 2);
    assert.strictEqual(s.totalTokens, 10);
    assert.strictEqual(s.lastCallAt, '2026-11-02T00:00:00.000Z');
    assert.strictEqual(s.pricedUsd, 0.04);
    assert.strictEqual(s.unpricedCalls, 1);
    assert.strictEqual(s.totalUsd, null);
    assert.strictEqual(s.complete, false);
  });
});

describe('LlmCallLogStore listInHorizon keys on the read horizon (real MangoDB tmpdir, LIN-3162 A2)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let harness;
  let raw;
  let store;

  before(async () => {
    harness = createMangoTmpdir('lin-3162-llm-summaries-');
    await harness.connect();
  });

  after(async () => {
    await harness.close();
  });

  beforeEach(() => {
    raw = harness.freshDb().collection('llm-call-log');
    store = new LlmCallLogStore({ collection: raw });
  });

  test('the workspace read counts a no-expiresAt row inside the horizon and hides a >30d row with a live stamp (A2)', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'no-stamp', urlKey: 'acme', feature: 'recommend', cost: 0.01, totalTokens: 10, timestamp: new Date(now - 5 * DAY_MS) });
    await raw.insertOne({ _id: 'old-live', urlKey: 'acme', feature: 'recommend', cost: 5, totalTokens: 500, timestamp: new Date(now - 40 * DAY_MS), expiresAt: new Date(now + 365 * DAY_MS) });

    const figure = callsSurfaceOf(await store.listInHorizon('acme'));
    assert.strictEqual(figure.totalCalls, 1, 'only the in-horizon row counts');
    assert.ok(Math.abs(figure.pricedUsd - 0.01) < 1e-9, 'the >30d row must not be folded in');
    assert.strictEqual(figure.totalTokens, 10);
  });

  test('the feature read counts a no-expiresAt row inside the horizon and hides a >30d row with a live stamp (A2)', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'no-stamp', urlKey: 'acme', feature: 'scan', cost: 0.02, timestamp: new Date(now - 5 * DAY_MS) });
    await raw.insertOne({ _id: 'old-live', urlKey: 'acme', feature: 'scan', cost: 5, timestamp: new Date(now - 40 * DAY_MS), expiresAt: new Date(now + 365 * DAY_MS) });

    const docs = await store.listInHorizon('acme', { feature: 'scan' });
    assert.deepStrictEqual(docs.map(d => d._id), ['no-stamp']);
    const figure = readCalls(docs);
    assert.strictEqual(figure.calls, 1);
    assert.strictEqual(figure.pricedCalls, 1);
    assert.ok(Math.abs(figure.pricedUsd / figure.pricedCalls - 0.02) < 1e-9);
  });

  test('the issue read takes a since bound from the caller and reads through the same horizon default (LIN-3161)', async () => {
    const now = Date.now();
    await raw.insertOne({ _id: 'in', urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'proxy-x', cost: 0.1, timestamp: new Date(now - 3 * DAY_MS) });
    await raw.insertOne({ _id: 'before-since', urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'proxy-x', cost: 0.2, timestamp: new Date(now - 10 * DAY_MS) });
    const docs = await store.listInHorizon('acme', { issueIdentifier: 'LIN-1', since: new Date(now - 5 * DAY_MS) });
    assert.deepStrictEqual(docs.map(d => d._id), ['in']);
  });
});

describe('LlmCallLogStore.cleanup is removed (LIN-3163 B)', () => {
  test('the evictor no longer exists — lifetime retention, no cleanup method', () => {
    assert.strictEqual(typeof LlmCallLogStore.prototype.cleanup, 'undefined', 'cleanup must be deleted from the store');
    assert.strictEqual(typeof new LlmCallLogStore({}).cleanup, 'undefined');
  });
});
