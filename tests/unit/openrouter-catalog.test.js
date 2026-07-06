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
    assert.deepEqual(models, MOCK_CATALOG_MODELS);
  });

  test('mock:true never pollutes the shared cache used by real calls', async () => {
    global.fetch = async () => mockModelsResponse(['real/model-a']);
    await getModelCatalog({ mock: true });
    const real = await getModelCatalog();
    assert.deepEqual(real, [{ id: 'real/model-a', name: 'real/model-a display name' }]);
  });

  test('cold cache: fetches, normalizes, and caches the catalog', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return mockModelsResponse(['openai/gpt-x', 'anthropic/claude-x']); };
    const models = await getModelCatalog();
    assert.deepEqual(models, [
      { id: 'openai/gpt-x', name: 'openai/gpt-x display name' },
      { id: 'anthropic/claude-x', name: 'anthropic/claude-x display name' }
    ]);
    assert.equal(calls, 1);
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
    assert.deepEqual(models, [{ id: 'ok/model', name: 'ok/model' }]);
  });

  test('a missing/non-array `data` field degrades to []', async () => {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const models = await getModelCatalog();
    assert.deepEqual(models, []);
  });
});
