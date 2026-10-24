// LIN-3882: tool capability, the reasoning split and the pricing hint come from the
// cached OpenRouter catalog first, curated defaults second. All catalog data is a
// fake seeded into the module cache; nothing here touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_MODELS, FREE_TIER_MODEL_IDS, DEFAULT_MODEL, isToolCapableModel, isReasoningModel,
  resolveReasoningBudget, resolveFreeTierModel, getModelPricingHint,
} from '../../lib/openrouter.js';
import {
  _setCatalogCacheForTests, _resetCatalogCacheForTests, getCachedCatalogModel, getModelCatalog,
} from '../../lib/openrouter-catalog.js';
import { resolveRoadmapModelOverride } from '../../routes/workspace-api-roadmap.js';

const entry = (id, extra = {}) => ({
  id, name: id, pricing: null, supported_parameters: null, reasoning: null, ...extra,
});
const seed = (...models) => _setCatalogCacheForTests({ at: Date.now(), models });
const NEW_ID = 'openai/gpt-6.1-sol';

beforeEach(() => _resetCatalogCacheForTests());
afterEach(() => { _resetCatalogCacheForTests(); delete process.env.OPENROUTER_FREE_TIER_MODEL; });

test('a catalog-only model listing tools is tool-capable; one without is not', () => {
  seed(entry(NEW_ID, { supported_parameters: ['tools', 'max_tokens'] }),
    entry('x/no-tools', { supported_parameters: ['max_tokens'] }));
  assert.equal(isToolCapableModel(NEW_ID), true);
  assert.equal(isToolCapableModel('x/no-tools'), false);
  assert.equal(isToolCapableModel('x/absent'), false);
});

test('an entry without a supported_parameters array is no signal: curated models keep tools', () => {
  seed(entry(DEFAULT_MODEL, { supported_parameters: null }));
  assert.equal(isToolCapableModel(DEFAULT_MODEL), true);
});

test('cold or failing catalog: every curated id keeps tools and prefix reasoning', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  const realErr = console.error; console.error = () => {};
  try {
    assert.deepEqual(await getModelCatalog(), []);
  } finally { globalThis.fetch = realFetch; console.error = realErr; }
  for (const m of AVAILABLE_MODELS) {
    assert.equal(isToolCapableModel(m.id), true, m.id);
    assert.equal(isReasoningModel(m.id), /^openai\/(gpt-5|o[134])/.test(m.id), m.id);
  }
});

test('reasoning split follows catalog default_enabled / mandatory, not supported_parameters', () => {
  seed(
    entry(NEW_ID, { supported_parameters: ['reasoning'], reasoning: { mandatory: false, default_enabled: true, supports_max_tokens: true } }),
    entry('x/mandatory', { reasoning: { mandatory: true, default_enabled: false, supports_max_tokens: true } }),
    entry('x/optional', { supported_parameters: ['reasoning'], reasoning: { mandatory: false, default_enabled: false, supports_max_tokens: true } }),
  );
  assert.equal(isReasoningModel(NEW_ID), true);
  assert.equal(isReasoningModel('x/mandatory'), true);
  assert.equal(isReasoningModel('x/optional'), false, 'accepting a reasoning config is not reasoning by default');
  assert.equal(isReasoningModel('openai/gpt-5.4-mini'), true, 'prefix half kept');
  const b = resolveReasoningBudget({ model: NEW_ID, proseTokens: 4000 });
  assert.ok(b.reasoning && b.maxTokens > 4000, 'split applied to 6.1 Sol');
  assert.equal(resolveReasoningBudget({ model: 'x/optional', proseTokens: 4000 }).reasoning, undefined);
});

test('an empty or malformed catalog response never replaces a non-empty snapshot', async () => {
  const realFetch = globalThis.fetch;
  seed(entry('x/keep'));
  _setCatalogCacheForTests({ at: Date.now() - 2 * 60 * 60 * 1000, models: [entry('x/keep')] });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
  try {
    await getModelCatalog();
    await new Promise(r => setImmediate(r));
  } finally { globalThis.fetch = realFetch; }
  assert.ok(getCachedCatalogModel('x/keep'));
});

test('a cold empty response is not cached (so it cannot block a refetch)', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, json: async () => ({ data: [] }) }; };
  try { await getModelCatalog(); await getModelCatalog(); } finally { globalThis.fetch = realFetch; }
  assert.equal(calls, 2);
});

test('normalizeModel keeps supported_parameters and the reasoning object', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
    { id: 'x/a', supported_parameters: ['tools', 7], reasoning: { mandatory: false, default_enabled: true, other: 1 } },
    { id: 'x/b' },
  ] }) });
  try { await getModelCatalog(); } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(getCachedCatalogModel('x/a').supported_parameters, ['tools']);
  assert.deepEqual(getCachedCatalogModel('x/a').reasoning, { mandatory: false, default_enabled: true, supports_max_tokens: false });
  assert.equal(getCachedCatalogModel('x/b').supported_parameters, null);
  assert.equal(getCachedCatalogModel('x/b').reasoning, null);
});

test('free tier stays fail-closed even when the catalog lists the model', () => {
  seed(entry(NEW_ID, { supported_parameters: ['tools'] }));
  process.env.OPENROUTER_FREE_TIER_MODEL = NEW_ID;
  assert.equal(resolveFreeTierModel(), DEFAULT_MODEL);
  for (const m of AVAILABLE_MODELS) assert.ok(FREE_TIER_MODEL_IDS.includes(m.id), m.id);
});

test('paid roadmap override accepts a catalog id outside the suggestions; free tier and cold cache do not', () => {
  assert.equal(resolveRoadmapModelOverride(NEW_ID, DEFAULT_MODEL, false), DEFAULT_MODEL, 'cold cache fails closed');
  seed(entry(NEW_ID));
  assert.equal(resolveRoadmapModelOverride(NEW_ID, DEFAULT_MODEL, false), NEW_ID);
  assert.equal(resolveRoadmapModelOverride(NEW_ID, DEFAULT_MODEL, true), DEFAULT_MODEL);
  assert.equal(resolveRoadmapModelOverride('x/not-listed', DEFAULT_MODEL, false), DEFAULT_MODEL);
});

test('pricing hint falls back to the catalog and rejects variable (-1) pricing', () => {
  seed(entry(NEW_ID, { pricing: { prompt: '0.000004', completion: '0.00002' } }),
    entry('x/router', { pricing: { prompt: '-1', completion: '-1' } }));
  assert.equal(getModelPricingHint(NEW_ID), '$4.00 in / $20.00 out per 1M tokens');
  assert.equal(getModelPricingHint('x/router'), null);
  assert.equal(getModelPricingHint('x/absent'), null);
});
