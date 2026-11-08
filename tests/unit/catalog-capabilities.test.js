// LIN-3882, LIN-4358: tool capability, the reasoning split and the pricing hint come
// from the cached OpenRouter catalog. Since LIN-4358 the only fallback is the tools one
// (a suggested model keeps tools while the catalog has no answer); reasoning and price
// have none. All catalog data is a fake seeded into the module cache; nothing here
// touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUGGESTED_MODEL_IDS, FREE_TIER_MODEL_IDS, DEFAULT_MODEL, isToolCapableModel, isReasoningModel,
  resolveReasoningBudget, resolveFreeTierModel, getModelPricingHint,
} from '../../lib/openrouter.js';
import { runAgentTurn } from '../../lib/agent-turn.js';
import { buildFlightCompanionStripData } from '../../routes/flight-companion.js';
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

test('an entry without a supported_parameters array is no signal: suggested models keep tools', () => {
  seed(entry(DEFAULT_MODEL, { supported_parameters: null }));
  assert.equal(isToolCapableModel(DEFAULT_MODEL), true);
});

test('cold or failing catalog: every suggested id keeps tools; no model gets the explicit split', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  const realErr = console.error; console.error = () => {};
  try {
    assert.deepEqual(await getModelCatalog(), []);
  } finally { globalThis.fetch = realFetch; console.error = realErr; }
  for (const id of SUGGESTED_MODEL_IDS) {
    assert.equal(isToolCapableModel(id), true, id);
    // LIN-4358: the OpenAI prefix list is gone. With no catalog there is no fact to split on.
    assert.equal(isReasoningModel(id), false, id);
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
  // LIN-4358: the prefix half is gone. Unlisted gpt-5.x gets no explicit split.
  assert.equal(isReasoningModel('openai/gpt-5.4-mini'), false, 'no prefix list: an unlisted id gives no signal');
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
  // LIN-4358: the live shape has no supports_max_tokens; efforts are kept, absent ones read null.
  assert.deepEqual(getCachedCatalogModel('x/a').reasoning, { mandatory: false, default_enabled: true, supported_efforts: null, default_effort: null });
  assert.equal(getCachedCatalogModel('x/b').supported_parameters, null);
  assert.equal(getCachedCatalogModel('x/b').reasoning, null);
});

test('free tier stays fail-closed even when the catalog lists the model', () => {
  seed(entry(NEW_ID, { supported_parameters: ['tools'] }));
  process.env.OPENROUTER_FREE_TIER_MODEL = NEW_ID;
  assert.equal(resolveFreeTierModel(), DEFAULT_MODEL);
});

test('paid roadmap override accepts a catalog id outside the suggestions; free tier and cold cache do not', () => {
  // LIN-4358: openai/gpt-6.1-sol is suggested now, so the outside id is one that is not.
  const OUTSIDE_ID = 'openai/gpt-5.6-terra';
  assert.ok(!SUGGESTED_MODEL_IDS.includes(OUTSIDE_ID));
  assert.equal(resolveRoadmapModelOverride(OUTSIDE_ID, DEFAULT_MODEL, false), DEFAULT_MODEL, 'cold cache fails closed');
  seed(entry(OUTSIDE_ID));
  assert.equal(resolveRoadmapModelOverride(OUTSIDE_ID, DEFAULT_MODEL, false), OUTSIDE_ID);
  assert.equal(resolveRoadmapModelOverride(OUTSIDE_ID, DEFAULT_MODEL, true), DEFAULT_MODEL);
  assert.equal(resolveRoadmapModelOverride('x/not-listed', DEFAULT_MODEL, false), DEFAULT_MODEL);
});

test('pricing hint: with no catalog there is no price, for any model (LIN-4358: no rate card)', () => {
  assert.equal(getModelPricingHint(NEW_ID), null);
  assert.equal(getModelPricingHint(DEFAULT_MODEL), null);
});

test('pricing hint falls back to the catalog and rejects variable (-1) pricing', () => {
  seed(entry('x/catalog-priced', { pricing: { prompt: '0.000004', completion: '0.00002' } }),
    entry('x/router', { pricing: { prompt: '-1', completion: '-1' } }));
  assert.equal(getModelPricingHint('x/catalog-priced'), '$4.00 in / $20.00 out per 1M tokens');
  assert.equal(getModelPricingHint('x/router'), null);
  assert.equal(getModelPricingHint('x/absent'), null);
});

test('pricing hint: the catalog price is the price, for suggested models too (LIN-4358)', () => {
  seed(entry(DEFAULT_MODEL, { pricing: { prompt: '0.00009', completion: '0.00009' } }));
  assert.equal(getModelPricingHint(DEFAULT_MODEL), '$90.00 in / $90.00 out per 1M tokens');
});

// Done-when 1 at the consumer level: a catalog-only model listing `tools` gets
// tools in the shared turn core (Task Chat via buildMessages, Flight Companion
// without) and on the Flight Companion strip.
const CATALOG_TOOLS_ID = 'x/catalog-tools-model';

function turnDeps(calls, extra = {}) {
  return {
    observerStateStore: { readCurrent: async () => null, ensureSeeded: async (_k, s) => ({ rev: 1, state: s }), advance: async () => true },
    workspacePreferencesStore: null,
    chatClient: {
      async streamChat(_m, o, onEvent) { calls.push(['streamChat', o.model]); onEvent('done', {}); },
      async streamChatWithTools(_m, o, onEvent) { calls.push(['streamChatWithTools', o.model]); onEvent('done', {}); },
    },
    createToolCatalog: () => ({ tools: [], executeTool: async () => ({}) }),
    getProvider: () => ({}),
    getScope: () => ({}),
    buildCensusSeedText: () => 'CENSUS SEED',
    sessionIsTerminal: () => false,
    now: () => 1_700_000_000_000,
    ...extra,
  };
}

for (const [surface, extra] of [
  ['Flight Companion', {}],
  ['Task Chat', { buildMessages: ({ message }) => [{ role: 'user', content: message }] }],
]) {
  test(`${surface} turn: a catalog-only model listing tools runs streamChatWithTools; without tools, streamChat`, async () => {
    seed(entry(CATALOG_TOOLS_ID, { supported_parameters: ['tools'] }),
      entry('x/catalog-no-tools', { supported_parameters: ['max_tokens'] }));
    for (const [model, expected] of [[CATALOG_TOOLS_ID, 'streamChatWithTools'], ['x/catalog-no-tools', 'streamChat']]) {
      const calls = [];
      await runAgentTurn({
        workspace: { urlKey: 'acme', id: 'ws-1' }, turnKind: 'user-initiated', message: 'hi',
        apiKey: 'sk-test', model, onEvent: () => {}, deps: turnDeps(calls, extra),
      });
      assert.deepEqual(calls, [[expected, model]], `${surface} ${model}`);
    }
  });
}

test('Flight Companion strip: a catalog-only model listing tools is tools-on, as the default and as an option', () => {
  const catalogEntry = entry(CATALOG_TOOLS_ID, { supported_parameters: ['tools'] });
  seed(catalogEntry);
  const strip = buildFlightCompanionStripData({ model: CATALOG_TOOLS_ID, companionDoc: null, censusDoc: null, catalog: [catalogEntry] });
  assert.equal(strip.toolsOn, true);
  const option = strip.modelOptions.find(o => o.id === CATALOG_TOOLS_ID);
  assert.ok(option, 'the catalog model is offered');
  assert.equal(option.curated, false);
  assert.equal(option.toolsOn, true);
});
