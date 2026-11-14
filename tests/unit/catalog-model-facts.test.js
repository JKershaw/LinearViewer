/**
 * LIN-4358: what Harbour knows about a model comes from the OpenRouter catalog, not from
 * lists. Two halves:
 *
 *   1. "A model released tomorrow is priced, budgeted and offered correctly without anyone
 *      editing a list." A model no list names is seeded into the catalog, and every surface
 *      that used to need a list edit is asked about it.
 *   2. The hand lists that remain hold choices, not facts, and cannot drift into naming a
 *      model that cannot run: every id in them must be listed, priced and tool-capable in
 *      the pinned 8 Nov 2026 catalog.
 *
 * Nothing here touches the network. Run with: node --test tests/unit/catalog-model-facts.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUGGESTED_MODEL_IDS, FREE_TIER_MODEL_IDS, DEFAULT_MODEL, suggestedModels, getModelDisplayName,
  getModelPricingHint, isToolCapableModel, isReasoningModel, resolveReasoningBudget, resolveFreeTierModel,
} from '../../lib/openrouter.js';
import { planCallBudget } from '../../lib/call-budget.js';
import { getModelRate, priceRequest, resolveWorkerModelId } from '../../lib/model-pricing.js';
import { buildModelOptions, getModelCatalog, _seedCatalogFromBodyForTests } from '../../lib/openrouter-catalog.js';
import { DISPATCH_MODEL_SUGGESTIONS, DISPATCH_CLAUDE_ALIAS_MODELS } from '../../lib/model-routing-harnesses.js';
import { resolveRoadmapModelOverride } from '../../routes/workspace-api-roadmap.js';
import { resolveTurnModelOverride } from '../../routes/flight-companion.js';
import { renderLandingPage } from '../../lib/render-landing.js';
import { seedPinnedCatalog, clearCatalog, PINNED_CATALOG_BODY } from './helpers/pinned-catalog.js';

// A model no Harbour list has ever named, in the live /models shape (8 Nov 2026).
const TOMORROW = {
  id: 'newco/tomorrow-1',
  name: 'NewCo: Tomorrow 1',
  context_length: 400000,
  pricing: {
    prompt: '0.0000003', completion: '0.0000012', input_cache_read: '0.00000003',
    overrides: [{ min_prompt_tokens: 200000, prompt: '0.0000006', completion: '0.0000024' }],
  },
  top_provider: { context_length: 400000, max_completion_tokens: 32000 },
  supported_parameters: ['max_tokens', 'reasoning', 'tools', 'tool_choice'],
  reasoning: { mandatory: false, supported_efforts: ['high', 'medium', 'low'], default_effort: 'medium' },
};

function seedWithTomorrow() {
  _seedCatalogFromBodyForTests({ data: [...PINNED_CATALOG_BODY.data, TOMORROW] });
}

describe('a model released tomorrow works on the day it appears, with no list edited', () => {
  beforeEach(() => seedWithTomorrow());
  afterEach(() => clearCatalog());

  test('it is in no hand list', () => {
    for (const list of [SUGGESTED_MODEL_IDS, DISPATCH_MODEL_SUGGESTIONS, FREE_TIER_MODEL_IDS, Object.values(DISPATCH_CLAUDE_ALIAS_MODELS)]) {
      assert.ok(!list.includes(TOMORROW.id));
    }
  });

  test('priced: the picker hint, and a request priced at its tier', () => {
    assert.equal(getModelPricingHint(TOMORROW.id), '$0.30 in / $1.20 out per 1M tokens');
    assert.deepEqual({ ...getModelRate(TOMORROW.id), overrides: undefined }, { prompt: 0.3, completion: 1.2, cacheRead: 0.03, overrides: undefined });
    // 10,000 × 0.30 + 1,000 × 1.20 = 4,200 per 1M; over 200k the override doubles both.
    assert.equal(priceRequest({ model: TOMORROW.id, harness: 'opencode', inputTokens: 10_000, outputTokens: 1_000 }), 0.0042);
    assert.equal(priceRequest({ model: TOMORROW.id, harness: 'opencode', inputTokens: 250_000, outputTokens: 1_000 }), 0.1524);
    assert.equal(resolveWorkerModelId(TOMORROW.id), TOMORROW.id, 'an OpenCode run reporting it is priced as itself');
  });

  test('named: from the catalog, without the provider prefix', () => {
    assert.equal(getModelDisplayName(TOMORROW.id), 'Tomorrow 1');
  });

  test('budgeted: a long brief gets reasoning headroom within the model\'s output limit, and no reasoning field', () => {
    assert.equal(isReasoningModel(TOMORROW.id), false, 'thinking is not on by default, so no explicit split (LIN-1665)');
    const plan = planCallBudget({ model: TOMORROW.id, maxTokens: 3000, promptChars: 33_336 });
    assert.deepEqual(plan, { maxTokens: 6000, reasoning: undefined, proseTokens: 3000, headroom: 3000 });
    const big = planCallBudget({ model: TOMORROW.id, maxTokens: 30000 });
    assert.equal(big.maxTokens, 32000, 'held to top_provider.max_completion_tokens');
  });

  test('tools: read from supported_parameters', () => {
    assert.equal(isToolCapableModel(TOMORROW.id), true);
  });

  test('offered: every picker lists it after the suggestions, and the override paths accept it', async () => {
    const catalog = await getModelCatalog();
    const options = buildModelOptions({ curatedIds: SUGGESTED_MODEL_IDS, catalog });
    assert.deepEqual(options.slice(0, SUGGESTED_MODEL_IDS.length).map(o => o.id), [...SUGGESTED_MODEL_IDS]);
    assert.ok(options.some(o => o.id === TOMORROW.id && o.label === TOMORROW.name));
    assert.equal(resolveRoadmapModelOverride(TOMORROW.id, DEFAULT_MODEL, false), TOMORROW.id);
    assert.deepEqual(await resolveTurnModelOverride(TOMORROW.id, { loadCatalog: getModelCatalog }), { model: TOMORROW.id, error: null });
  });

  test('not allowed on the free tier: spending stays a person\'s ruling', () => {
    const saved = process.env.OPENROUTER_FREE_TIER_MODEL;
    process.env.OPENROUTER_FREE_TIER_MODEL = TOMORROW.id;
    try {
      assert.equal(resolveFreeTierModel(), DEFAULT_MODEL);
      assert.equal(resolveRoadmapModelOverride(TOMORROW.id, DEFAULT_MODEL, true), DEFAULT_MODEL);
    } finally {
      if (saved === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL; else process.env.OPENROUTER_FREE_TIER_MODEL = saved;
    }
  });
});

describe('the reasoning split reads the catalog alone (REASONING_MODEL_PREFIXES is gone)', () => {
  beforeEach(() => seedPinnedCatalog());
  afterEach(() => clearCatalog());

  test('thinking on by default ⇒ explicit split; can reason but off or silent ⇒ headroom from the call layer instead', () => {
    assert.deepEqual(resolveReasoningBudget({ model: 'openai/gpt-6.1-sol', proseTokens: 3000 }), { reasoning: { max_tokens: 3000 }, maxTokens: 6000 });
    // gpt-5.4-mini: catalog says default_enabled false. Before LIN-4358 the OpenAI prefix list sent it
    // an explicit reasoning bound (the LIN-1665 trap). Now it gets no field, and the call layer's headroom.
    assert.deepEqual(resolveReasoningBudget({ model: 'openai/gpt-5.4-mini', proseTokens: 3000 }), { reasoning: undefined, maxTokens: 3000 });
    assert.deepEqual(planCallBudget({ model: 'openai/gpt-5.4-mini', maxTokens: 3000 }), { maxTokens: 6000, reasoning: undefined, proseTokens: 3000, headroom: 3000 });
  });

  test('every model in the pinned catalog plans a long brief inside its own output limit', () => {
    for (const m of PINNED_CATALOG_BODY.data) {
      const plan = planCallBudget({ model: m.id, maxTokens: 3000, promptChars: 33_336 });
      const limit = m.top_provider?.max_completion_tokens;
      assert.ok(plan.maxTokens >= 3000, `${m.id} keeps the prose it asked for`);
      if (limit && limit >= 3000) assert.ok(plan.maxTokens <= limit, `${m.id} stays within ${limit}`);
      if (m.reasoning) assert.ok(plan.headroom > 0 || plan.maxTokens === limit, `${m.id} can reason, so it gets headroom`);
    }
  });
});

describe('the hand lists that remain name models the catalog can run', () => {
  beforeEach(() => seedPinnedCatalog());
  afterEach(() => clearCatalog());

  const lists = {
    SUGGESTED_MODEL_IDS,
    DISPATCH_MODEL_SUGGESTIONS,
    FREE_TIER_MODEL_IDS,
    'DISPATCH_CLAUDE_ALIAS_MODELS (resolved)': Object.values(DISPATCH_CLAUDE_ALIAS_MODELS).map(resolveWorkerModelId),
  };
  for (const [name, ids] of Object.entries(lists)) {
    test(`${name}: every id is listed and priced in the pinned catalog`, () => {
      for (const id of ids) {
        assert.ok(PINNED_CATALOG_BODY.data.some(m => m.id === id), `${id} is listed`);
        assert.ok(getModelRate(id), `${id} is priced`);
      }
    });
  }

  test('every suggested id takes tools in the catalog, so the cold-catalog tools fallback cannot lie', () => {
    for (const id of [...SUGGESTED_MODEL_IDS, ...DISPATCH_MODEL_SUGGESTIONS]) {
      const entry = PINNED_CATALOG_BODY.data.find(m => m.id === id);
      assert.ok(entry.supported_parameters.includes('tools'), `${id} takes tools`);
    }
  });

  test('suggested models carry their catalog name and price', () => {
    const haiku = suggestedModels().find(m => m.id === 'anthropic/claude-haiku-5.5');
    assert.deepEqual(haiku, { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5', pricing: { prompt: 0.1, completion: 0.5 } });
  });
});

describe('a cold catalog: honest unknowns, nothing invented', () => {
  beforeEach(() => clearCatalog());

  test('no price, a slug for a name, tools only for suggested models, a bare cap', () => {
    assert.equal(getModelPricingHint('openai/gpt-6.1-sol'), null);
    assert.equal(getModelDisplayName('openai/gpt-6.1-sol'), 'gpt-6.1-sol');
    assert.equal(isToolCapableModel('openai/gpt-6.1-sol'), true, 'suggested: keeps tools through a catalog outage');
    assert.equal(isToolCapableModel(TOMORROW.id), false, 'unknown is not capable');
    assert.deepEqual(planCallBudget({ model: 'openai/gpt-6.1-sol', maxTokens: 3000 }), { maxTokens: 3000, reasoning: undefined, proseTokens: 3000, headroom: 0 });
    assert.deepEqual(suggestedModels()[0], { id: DEFAULT_MODEL, name: 'gpt-5.4-mini', pricing: null });
  });

  test('the landing page renders without a price line rather than an invented one', () => {
    const html = renderLandingPage({});
    assert.ok(html.includes('data-testid="landing-try"'));
    assert.doesNotMatch(html, /per 1M tokens/);
  });
});
