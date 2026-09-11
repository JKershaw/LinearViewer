/**
 * Unit tests for lib/openrouter-catalog.js (LIN-1111 Session 2) — the live
 * OpenRouter model catalog cache.
 *
 * Run with: node --test tests/unit/openrouter-catalog.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getModelCatalog,
  MOCK_CATALOG_MODELS,
  CATALOG_CACHE_TTL_MS,
  isFreeModel,
  buildModelOptions,
  _resetCatalogCacheForTests,
  _setCatalogCacheForTests
} from '../../lib/openrouter-catalog.js';

function mockModelsResponse(ids) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: ids.map(id => ({ id, name: `${id} display name` })) })
  };
}

describe('getModelCatalog', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    _resetCatalogCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    _resetCatalogCacheForTests();
  });

  test('mock:true returns the canned catalog without touching the network', async () => {
    global.fetch = () => { throw new Error('must not be called'); };
    const models = await getModelCatalog({ mock: true });
    assert.deepEqual(models, MOCK_CATALOG_MODELS.map(m => ({ id: m.id, name: m.name, pricing: m.pricing ?? null })));
  });

  test('mock:true entries satisfy the same normalized {id, name, pricing} shape as the real path (LIN-2384 F2)', async () => {
    global.fetch = () => { throw new Error('must not be called'); };
    const models = await getModelCatalog({ mock: true });
    assert.ok(models.length > 0);
    for (const model of models) {
      assert.strictEqual(typeof model.id, 'string');
      assert.strictEqual(typeof model.name, 'string');
      assert.ok('pricing' in model, 'entry must carry a pricing key, even if null');
    }
  });

  // LIN-2719 S1: the fixture pins all three states a free-model picker needs
  // to be observable under NODE_ENV=test (routes/workspace-api.js's
  // shouldMockAi gate forces this path) — free, priced, and unknown.
  test('mock:true fixture pins a free, a priced, and a pricing:null entry (LIN-2719 S1)', async () => {
    global.fetch = () => { throw new Error('must not be called'); };
    const models = await getModelCatalog({ mock: true });
    const byId = Object.fromEntries(models.map(m => [m.id, m]));
    assert.ok(isFreeModel(byId['mock-provider/catalog-model-one']));
    assert.equal(isFreeModel(byId['mock-provider/catalog-model-two']), false);
    assert.equal(byId['mock-provider/catalog-model-three'].pricing, null);
    assert.equal(isFreeModel(byId['mock-provider/catalog-model-three']), false);
  });

  test('mock:true never pollutes the shared cache used by real calls', async () => {
    global.fetch = async () => mockModelsResponse(['real/model-a']);
    await getModelCatalog({ mock: true });
    const real = await getModelCatalog();
    assert.deepEqual(real, [{ id: 'real/model-a', name: 'real/model-a display name', pricing: null }]);
  });

  test('cold cache: fetches, normalizes, and caches the catalog', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return mockModelsResponse(['openai/gpt-x', 'anthropic/claude-x']); };
    const models = await getModelCatalog();
    assert.deepEqual(models, [
      { id: 'openai/gpt-x', name: 'openai/gpt-x display name', pricing: null },
      { id: 'anthropic/claude-x', name: 'anthropic/claude-x display name', pricing: null }
    ]);
    assert.equal(calls, 1);
  });

  test('pricing rides through normalization unmodified (LIN-2384)', async () => {
    const rawPricing = { prompt: '0.000002', completion: '0.00001' };
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'openai/gpt-x', name: 'GPT X', pricing: rawPricing }] })
    });
    const models = await getModelCatalog();
    assert.deepEqual(models, [{ id: 'openai/gpt-x', name: 'GPT X', pricing: rawPricing }]);
  });

  test('a non-object pricing field normalizes to null rather than passing through raw', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'openai/gpt-x', name: 'GPT X', pricing: 'not-an-object' }] })
    });
    const models = await getModelCatalog();
    assert.deepEqual(models, [{ id: 'openai/gpt-x', name: 'GPT X', pricing: null }]);
  });

  test('fresh cache: a second call within the TTL does not refetch', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return mockModelsResponse(['openai/gpt-x']); };
    await getModelCatalog();
    await getModelCatalog();
    assert.equal(calls, 1);
  });

  test('cold cache + fetch failure degrades to [] (never throws)', async () => {
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const models = await getModelCatalog();
    assert.deepEqual(models, []);
  });

  test('cold cache + network error degrades to [] (never throws)', async () => {
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    const models = await getModelCatalog();
    assert.deepEqual(models, []);
  });

  test('stale-but-warm cache: serves the last good snapshot synchronously', async () => {
    _setCatalogCacheForTests({
      at: Date.now() - CATALOG_CACHE_TTL_MS - 1000,
      models: [{ id: 'stale/model', name: 'Stale Model' }]
    });
    let resolveRefresh;
    global.fetch = () => new Promise(resolve => { resolveRefresh = resolve; });
    const models = await getModelCatalog();
    assert.deepEqual(models, [{ id: 'stale/model', name: 'Stale Model' }]);
    // Clean up the still-pending background fetch so it doesn't leak into another test.
    resolveRefresh(mockModelsResponse(['stale/model']));
  });

  test('stale-but-warm cache: a failed background refresh keeps serving the last good snapshot', async () => {
    _setCatalogCacheForTests({
      at: Date.now() - CATALOG_CACHE_TTL_MS - 1000,
      models: [{ id: 'stale/model', name: 'Stale Model' }]
    });
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    const models = await getModelCatalog();
    assert.deepEqual(models, [{ id: 'stale/model', name: 'Stale Model' }]);
    // Let the background refresh's rejection settle before the test exits.
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  test('malformed entries (no id) are filtered out', async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'ok/model' }, { name: 'no id here' }, null, { id: '' }] })
    });
    const models = await getModelCatalog();
    assert.deepEqual(models, [{ id: 'ok/model', name: 'ok/model', pricing: null }]);
  });

  test('a missing/non-array `data` field degrades to []', async () => {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const models = await getModelCatalog();
    assert.deepEqual(models, []);
  });
});

describe('isFreeModel (LIN-2719 S0)', () => {
  test('zero on both tiers, as real per-token strings, is free', () => {
    assert.ok(isFreeModel({ pricing: { prompt: '0', completion: '0' } }));
    assert.ok(isFreeModel({ pricing: { prompt: '0.0', completion: '0.00' } }));
  });

  test('zero on both tiers as numbers is free (coerced via Number(), never string-compared)', () => {
    assert.ok(isFreeModel({ pricing: { prompt: 0, completion: 0 } }));
  });

  test('a non-zero rate on either tier is not free', () => {
    assert.equal(isFreeModel({ pricing: { prompt: '0.000002', completion: '0' } }), false);
    assert.equal(isFreeModel({ pricing: { prompt: '0', completion: '0.00001' } }), false);
  });

  test('empty string reads as unknown, not free (Number("") === 0 trap)', () => {
    assert.equal(isFreeModel({ pricing: { prompt: '', completion: '0' } }), false);
    assert.equal(isFreeModel({ pricing: { prompt: '0', completion: '' } }), false);
  });

  test('null/undefined pricing, and a missing tier, read as unknown, not free', () => {
    assert.equal(isFreeModel({ pricing: null }), false);
    assert.equal(isFreeModel({ pricing: undefined }), false);
    assert.equal(isFreeModel({}), false);
    assert.equal(isFreeModel({ pricing: { prompt: '0' } }), false);
    assert.equal(isFreeModel({ pricing: { completion: '0' } }), false);
  });

  test('a non-numeric rate string reads as unknown, not free', () => {
    assert.equal(isFreeModel({ pricing: { prompt: 'not-a-number', completion: '0' } }), false);
  });
});

describe('buildModelOptions (LIN-2719 S0)', () => {
  test('curated ids come first, in caller order, marked not-free', () => {
    const options = buildModelOptions({ curatedIds: ['a/one', 'b/two'], catalog: [] });
    assert.deepEqual(options, [
      { id: 'a/one', label: 'a/one', free: false },
      { id: 'b/two', label: 'b/two', free: false }
    ]);
  });

  test('catalog entries append after curated ids, free-marked via isFreeModel', () => {
    const options = buildModelOptions({
      curatedIds: ['curated/one'],
      catalog: [
        { id: 'catalog/free', name: 'Free Model', pricing: { prompt: '0', completion: '0' } },
        { id: 'catalog/priced', name: 'Priced Model', pricing: { prompt: '0.00001', completion: '0.00002' } }
      ]
    });
    assert.deepEqual(options, [
      { id: 'curated/one', label: 'curated/one', free: false },
      { id: 'catalog/free', label: 'Free Model', free: true },
      { id: 'catalog/priced', label: 'Priced Model', free: false }
    ]);
  });

  test('de-dupes a catalog entry against the curated list', () => {
    const options = buildModelOptions({
      curatedIds: ['shared/id'],
      catalog: [{ id: 'shared/id', name: 'Shared', pricing: { prompt: '0', completion: '0' } }]
    });
    assert.deepEqual(options, [{ id: 'shared/id', label: 'shared/id', free: false }]);
  });

  test('de-dupes WITHIN the catalog itself (the divergence S0 closes)', () => {
    const options = buildModelOptions({
      curatedIds: [],
      catalog: [
        { id: 'dup/id', name: 'First', pricing: null },
        { id: 'dup/id', name: 'Second', pricing: { prompt: '0', completion: '0' } }
      ]
    });
    assert.deepEqual(options, [{ id: 'dup/id', label: 'First', free: false }]);
  });

  test('a malformed catalog entry (no id) is skipped', () => {
    const options = buildModelOptions({ curatedIds: [], catalog: [null, { name: 'no id' }, { id: '' }] });
    assert.deepEqual(options, []);
  });

  test('falls back to id as the label when name is absent', () => {
    const options = buildModelOptions({ curatedIds: [], catalog: [{ id: 'no/name', pricing: null }] });
    assert.deepEqual(options, [{ id: 'no/name', label: 'no/name', free: false }]);
  });

  test('no curatedIds/catalog defaults to an empty list', () => {
    assert.deepEqual(buildModelOptions(), []);
  });
});
