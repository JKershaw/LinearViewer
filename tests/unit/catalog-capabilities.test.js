// LIN-3882: tool capability, the reasoning split and the pricing hint come from the
// cached OpenRouter catalog first, curated defaults second. All catalog data is a
// fake seeded into the module cache; nothing here touches the network.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABLE_MODELS, FREE_TIER_MODEL_IDS, DEFAULT_MODEL, isToolCapableModel, isReasoningModel,
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

test('pricing hint shows rate-card rows for uncurated ids (LIN-3882)', () => {
  assert.equal(getModelPricingHint(NEW_ID), '$2.00 in / $10.00 out per 1M tokens');
});

test('pricing hint falls back to the catalog and rejects variable (-1) pricing', () => {
  seed(entry('x/catalog-priced', { pricing: { prompt: '0.000004', completion: '0.00002' } }),
    entry('x/router', { pricing: { prompt: '-1', completion: '-1' } }));
  assert.equal(getModelPricingHint('x/catalog-priced'), '$4.00 in / $20.00 out per 1M tokens');
  assert.equal(getModelPricingHint('x/router'), null);
  assert.equal(getModelPricingHint('x/absent'), null);
});

test('pricing hint: a rate-card row wins over a different catalog price', () => {
  seed(entry(NEW_ID, { pricing: { prompt: '0.00009', completion: '0.00009' } }));
  assert.equal(getModelPricingHint(NEW_ID), '$2.00 in / $10.00 out per 1M tokens');
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
