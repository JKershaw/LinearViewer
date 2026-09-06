/**
 * Unit tests for llm-call-log.js (LIN-418)
 *
 * Run with: node --test tests/unit/llm-call-log.test.js
 *
 * Covers the append-only record contract: every call is stored with the
 * captured metadata, non-numeric fields are coerced to null, listing is
 * workspace-scoped and newest-first, and recording never throws (fire-and-forget).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { LlmCallLogStore } from '../../lib/llm-call-log.js';

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
    assert.ok(doc.expiresAt instanceof Date);
    assert.ok(doc.expiresAt > doc.timestamp);
    assert.ok(typeof doc._id === 'string' && doc._id.length > 0);
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

describe('LlmCallLogStore.listCalls', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('is workspace-scoped and newest-first', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', model: 'm1' });
    await new Promise(r => setTimeout(r, 2));
    await store.record({ urlKey: 'acme', feature: 'brief', model: 'm2' });
    await store.record({ urlKey: 'other', feature: 'recap', model: 'm3' });

    const { items, total } = await store.listCalls('acme');
    assert.strictEqual(total, 2);
    assert.strictEqual(items[0].feature, 'brief'); // newest first
    assert.strictEqual(items[1].feature, 'recommend');
    assert.ok(items.every(i => i.model && typeof i.timestamp === 'string'));
  });

  test('returns empty for unknown workspace or missing urlKey', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend' });
    assert.deepStrictEqual(await store.listCalls('nope'), { items: [], total: 0 });
    assert.deepStrictEqual(await store.listCalls(), { items: [], total: 0 });
  });
});

describe('LlmCallLogStore.summarize', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('totals calls/cost/tokens and breaks down by feature (busiest first)', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', cost: 0.01, totalTokens: 100 });
    await store.record({ urlKey: 'acme', feature: 'recommend', cost: 0.02, totalTokens: 200 });
    await store.record({ urlKey: 'acme', feature: 'brief', cost: 0.005, totalTokens: 50 });
    await store.record({ urlKey: 'other', feature: 'recap', cost: 1, totalTokens: 999 }); // different workspace

    const s = await store.summarize('acme');
    assert.strictEqual(s.totalCalls, 3);
    assert.ok(Math.abs(s.totalCost - 0.035) < 1e-9);
    assert.strictEqual(s.totalTokens, 350);
    assert.strictEqual(s.byFeature[0].feature, 'recommend'); // busiest first
    assert.strictEqual(s.byFeature[0].calls, 2);
    assert.ok(Math.abs(s.byFeature[0].cost - 0.03) < 1e-9);
    assert.strictEqual(s.byFeature[1].feature, 'brief');
    assert.ok(s.lastCallAt);
  });

  test('records missing cost/tokens are skipped, not counted as zero understatement', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', cost: 0.01, totalTokens: 100 });
    await store.record({ urlKey: 'acme', feature: 'task-chat' }); // no cost/tokens reported
    const s = await store.summarize('acme');
    assert.strictEqual(s.totalCalls, 2);
    assert.ok(Math.abs(s.totalCost - 0.01) < 1e-9);
    assert.strictEqual(s.totalTokens, 100);
  });

  test('empty for unknown workspace, missing urlKey, or no collection', async () => {
    const empty = { totalCalls: 0, totalCost: 0, totalTokens: 0, byFeature: [], lastCallAt: null, latencyByFeatureModel: [] };
    assert.deepStrictEqual(await store.summarize('nope'), empty);
    assert.deepStrictEqual(await store.summarize(), empty);
    assert.deepStrictEqual(await new LlmCallLogStore({}).summarize('acme'), empty);
  });

  test('aggregates durationMs by feature × model with count/p50Ms/p90Ms/maxMs (nearest-rank)', async () => {
    // Deterministic 10-value array: 100,200,...,1000ms, sorted ascending already.
    const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    for (const durationMs of durations) {
      await store.record({ urlKey: 'acme', feature: 'recommend', model: 'openai/gpt-5.4-mini', durationMs });
    }
    const s = await store.summarize('acme');
    assert.strictEqual(s.latencyByFeatureModel.length, 1);
    const row = s.latencyByFeatureModel[0];
    assert.strictEqual(row.feature, 'recommend');
    assert.strictEqual(row.model, 'openai/gpt-5.4-mini');
    assert.strictEqual(row.count, 10);
    // Nearest-rank, 1-indexed ceiling: p50 -> index ceil(0.5*10)-1=4 -> 500; p90 -> ceil(0.9*10)-1=8 -> 900.
    assert.strictEqual(row.p50Ms, 500);
    assert.strictEqual(row.p90Ms, 900);
    assert.strictEqual(row.maxMs, 1000);
  });

  test('missing durationMs is skipped from the latency group, not counted as zero or as a call', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', model: 'openai/gpt-5.4-mini', durationMs: 1000 });
    await store.record({ urlKey: 'acme', feature: 'recommend', model: 'openai/gpt-5.4-mini' }); // no durationMs
    const s = await store.summarize('acme');
    assert.strictEqual(s.totalCalls, 2); // summarize()'s own count still includes both
    assert.strictEqual(s.latencyByFeatureModel.length, 1);
    const row = s.latencyByFeatureModel[0];
    assert.strictEqual(row.count, 1);
    assert.strictEqual(row.p50Ms, 1000);
    assert.strictEqual(row.maxMs, 1000);
  });

  test('a feature/model group where every call lacks durationMs produces no row', async () => {
    await store.record({ urlKey: 'acme', feature: 'brief', model: 'anthropic/claude-opus-5' }); // no durationMs
    const s = await store.summarize('acme');
    assert.strictEqual(s.totalCalls, 1);
    assert.deepStrictEqual(s.latencyByFeatureModel, []);
  });

  test('groups by (feature, model) pair, not feature alone', async () => {
    await store.record({ urlKey: 'acme', feature: 'recommend', model: 'openai/gpt-5.4-mini', durationMs: 100 });
    await store.record({ urlKey: 'acme', feature: 'recommend', model: 'anthropic/claude-opus-5', durationMs: 5000 });
    const s = await store.summarize('acme');
    assert.strictEqual(s.latencyByFeatureModel.length, 2);
    const pairs = s.latencyByFeatureModel.map(r => `${r.feature}|${r.model}`).sort();
    assert.deepStrictEqual(pairs, ['recommend|anthropic/claude-opus-5', 'recommend|openai/gpt-5.4-mini']);
  });

  test('rows sort descending by p90Ms, ties broken by feature then model', async () => {
    await store.record({ urlKey: 'acme', feature: 'recap', model: 'model-a', durationMs: 100 });
    await store.record({ urlKey: 'acme', feature: 'brief', model: 'model-b', durationMs: 5000 });
    await store.record({ urlKey: 'acme', feature: 'brief', model: 'model-a', durationMs: 5000 }); // tie on p90Ms with above
    const s = await store.summarize('acme');
    assert.strictEqual(s.latencyByFeatureModel.length, 3);
    // Two 5000ms rows outrank the 100ms row; among the tie, feature 'brief' is equal so model breaks it: 'model-a' < 'model-b'.
    assert.deepStrictEqual(
      s.latencyByFeatureModel.map(r => `${r.feature}|${r.model}`),
      ['brief|model-a', 'brief|model-b', 'recap|model-a']
    );
  });
});

describe('LlmCallLogStore.summarizeByIssue', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('filters by both urlKey and issueIdentifier', async () => {
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'recommend', cost: 0.01 });
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-2', feature: 'recommend', cost: 0.02 }); // other issue
    await store.record({ urlKey: 'other', issueIdentifier: 'LIN-1', feature: 'recommend', cost: 0.03 }); // other workspace

    const s = await store.summarizeByIssue('acme', 'LIN-1');
    assert.strictEqual(s.calls, 1);
    assert.ok(Math.abs(s.costUsd - 0.01) < 1e-9);
  });

  test('groups by feature (busiest first)', async () => {
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'recommend', cost: 0.01 });
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'recommend', cost: 0.02 });
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'brief', cost: 0.005 });

    const s = await store.summarizeByIssue('acme', 'LIN-1');
    assert.strictEqual(s.calls, 3);
    assert.strictEqual(s.byFeature[0].feature, 'recommend');
    assert.strictEqual(s.byFeature[0].calls, 2);
    assert.ok(Math.abs(s.byFeature[0].costUsd - 0.03) < 1e-9);
    assert.strictEqual(s.byFeature[1].feature, 'brief');
  });

  test('a null cost is counted in unpricedCalls, never folded to 0', async () => {
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'recap', cost: 0.01 });
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'recap' }); // no cost reported

    const s = await store.summarizeByIssue('acme', 'LIN-1');
    assert.strictEqual(s.calls, 2);
    assert.strictEqual(s.unpricedCalls, 1);
    assert.ok(Math.abs(s.costUsd - 0.01) < 1e-9); // the unpriced call contributes nothing, not 0-as-priced
  });

  test('empty for unknown issue, missing args, or no collection', async () => {
    const empty = { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] };
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'recommend', cost: 0.01 });
    assert.deepStrictEqual(await store.summarizeByIssue('acme', 'LIN-999'), empty);
    assert.deepStrictEqual(await store.summarizeByIssue('acme'), empty);
    assert.deepStrictEqual(await store.summarizeByIssue(undefined, 'LIN-1'), empty);
    assert.deepStrictEqual(await new LlmCallLogStore({}).summarizeByIssue('acme', 'LIN-1'), empty);
  });
});

describe('LlmCallLogStore.summarizeByFeature (LIN-2702)', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('zero rows in window -> unknown:true, meanUsd:null, calls:0', async () => {
    const s = await store.summarizeByFeature('acme', 'scan');
    assert.deepStrictEqual(s, { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true });
  });

  test('rows present but all unpriced -> unknown:true, meanUsd:null, but calls still reports the row count', async () => {
    await store.record({ urlKey: 'acme', feature: 'scan' }); // no cost reported
    await store.record({ urlKey: 'acme', feature: 'scan' }); // no cost reported

    const s = await store.summarizeByFeature('acme', 'scan');
    assert.strictEqual(s.calls, 2); // "2 unpriced calls" stays distinguishable from "no calls"
    assert.strictEqual(s.pricedCalls, 0);
    assert.strictEqual(s.meanUsd, null);
    assert.strictEqual(s.unknown, true);
  });

  // The single most important test in the ticket: cost:0 rows are genuinely
  // priced (Number.isFinite(0) is true), so a window that is all real zeros
  // must report a known $0.00, never the unknown carrier.
  test('priced rows averaging exactly zero -> meanUsd:0, unknown:false (never unknown)', async () => {
    await store.record({ urlKey: 'acme', feature: 'scan', cost: 0 });
    await store.record({ urlKey: 'acme', feature: 'scan', cost: 0 });

    const s = await store.summarizeByFeature('acme', 'scan');
    assert.strictEqual(s.calls, 2);
    assert.strictEqual(s.pricedCalls, 2);
    assert.strictEqual(s.meanUsd, 0);
    assert.strictEqual(s.unknown, false);
  });

  test('mixed priced/unpriced -> mean computed over priced rows only, not calls', async () => {
    await store.record({ urlKey: 'acme', feature: 'scan', cost: 0.02 });
    await store.record({ urlKey: 'acme', feature: 'scan', cost: 0.04 });
    await store.record({ urlKey: 'acme', feature: 'scan' }); // unpriced

    const s = await store.summarizeByFeature('acme', 'scan');
    assert.strictEqual(s.calls, 3);
    assert.strictEqual(s.pricedCalls, 2);
    // Dividing by calls (3) would give 0.02; dividing by pricedCalls (2) gives 0.03.
    assert.ok(Math.abs(s.meanUsd - 0.03) < 1e-9);
    assert.strictEqual(s.unknown, false);
  });

  test('rows whose expiresAt has passed are excluded from the window (aged-out-only -> unknown)', async () => {
    const now = Date.now();
    collection._docs.push({
      _id: 'expired', urlKey: 'acme', feature: 'scan', cost: 0.05,
      timestamp: new Date(now - 1000 * 60 * 60), expiresAt: new Date(now - 1000)
    });

    const s = await store.summarizeByFeature('acme', 'scan');
    assert.deepStrictEqual(s, { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true });
  });

  test('feature scoping: a different feature or a different urlKey is excluded', async () => {
    await store.record({ urlKey: 'acme', feature: 'scan', cost: 0.01 });
    await store.record({ urlKey: 'acme', feature: 'recommend', cost: 99 }); // other feature
    await store.record({ urlKey: 'other', feature: 'scan', cost: 99 }); // other workspace

    const s = await store.summarizeByFeature('acme', 'scan');
    assert.strictEqual(s.calls, 1);
    assert.ok(Math.abs(s.meanUsd - 0.01) < 1e-9);
  });

  test('guard: missing urlKey, missing feature, or no collection all return the unknown shape', async () => {
    const empty = { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true };
    await store.record({ urlKey: 'acme', feature: 'scan', cost: 0.01 });
    assert.deepStrictEqual(await store.summarizeByFeature(undefined, 'scan'), empty);
    assert.deepStrictEqual(await store.summarizeByFeature('acme', undefined), empty);
    assert.deepStrictEqual(await new LlmCallLogStore({}).summarizeByFeature('acme', 'scan'), empty);
  });

  test('catch path: a collection error returns the unknown shape, never meanUsd:0', async () => {
    const flaky = new LlmCallLogStore({
      collection: { find() { throw new Error('mongo down'); } }
    });
    const s = await flaky.summarizeByFeature('acme', 'scan');
    assert.deepStrictEqual(s, { calls: 0, pricedCalls: 0, meanUsd: null, unknown: true });
  });
});

// Unintended-side-effect coverage (LIN-2702): summarize() and
// summarizeByIssue() must not have moved when the same rows are also read by
// summarizeByFeature() — the new honest-unknown convention must not leak into
// the two methods that deliberately do not use it.
describe('summarize()/summarizeByIssue() are unaffected by summarizeByFeature (LIN-2702)', () => {
  let store;
  let collection;

  beforeEach(() => {
    collection = createMockCollection();
    store = new LlmCallLogStore({ collection });
  });

  test('summarize() empty case still carries totalCost:0 with no `unknown` key', async () => {
    const s = await store.summarize('acme');
    assert.deepStrictEqual(s, { totalCalls: 0, totalCost: 0, totalTokens: 0, byFeature: [], lastCallAt: null, latencyByFeatureModel: [] });
    assert.strictEqual('unknown' in s, false);
  });

  test('summarizeByIssue() empty case is still the literal zero shape, not the unknown carrier', async () => {
    const s = await store.summarizeByIssue('acme', 'LIN-1');
    assert.deepStrictEqual(s, { calls: 0, costUsd: 0, unpricedCalls: 0, byFeature: [] });
    assert.strictEqual('unknown' in s, false);
  });

  test('summarize() and summarizeByIssue() are unchanged over rows summarizeByFeature also reads', async () => {
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'scan', cost: 0.02 });
    await store.record({ urlKey: 'acme', issueIdentifier: 'LIN-1', feature: 'scan' }); // unpriced

    const byFeature = await store.summarizeByFeature('acme', 'scan');
    assert.strictEqual(byFeature.pricedCalls, 1);

    const summary = await store.summarize('acme');
    assert.strictEqual(summary.totalCalls, 2);
    assert.ok(Math.abs(summary.totalCost - 0.02) < 1e-9); // unpriced row folds to 0 here, unlike summarizeByFeature
    assert.strictEqual(summary.byFeature[0].feature, 'scan');
    assert.strictEqual(summary.byFeature[0].calls, 2);

    const byIssue = await store.summarizeByIssue('acme', 'LIN-1');
    assert.strictEqual(byIssue.calls, 2);
    assert.strictEqual(byIssue.unpricedCalls, 1);
    assert.ok(Math.abs(byIssue.costUsd - 0.02) < 1e-9);
  });
});
