/**
 * LIN-3856 (D2): the session-summary precompute and the run paragraph take the
 * free-tier clamp and resolve their model from the routing store.
 *
 * Composes the real createMaterializerPrecompute + both real factories + the production
 * `jobModelResolver` (the export server.js wires) over the routing fixture. The generators
 * are fakes capturing `model`; credentials come from the real resolvePrecomputeCredential
 * over a fake env, so nothing here touches a live service.
 *
 * Run with: node --test tests/unit/precompute-model-routing.test.js
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL, AVAILABLE_MODELS } from '../../lib/openrouter.js';
import { jobModelResolver, resolveAiOperationModel } from '../../lib/workspace-preferences.js';
import { resolvePrecomputeCredential, createRunParagraphPrecompute } from '../../lib/run-paragraph-hook.js';
import { createSessionSummaryPrecompute, createMaterializerPrecompute } from '../../lib/session-materializer-precompute.js';
import { routingFixture } from './helpers/routing-fakes.js';

const URL_KEY = 'ws-d2';
const CURATED = AVAILABLE_MODELS.find((m) => m.id !== DEFAULT_MODEL).id;
const CTX = { urlKey: URL_KEY, reason: 'r', actor: { via: 'page', id: 'acct-1' } };
const FREE_ENV = { OPENROUTER_FREE_TIER_KEY: 'free' };
const PAID_ENV = { OPENROUTER_API_KEY: 'paid', OPENROUTER_FREE_TIER_KEY: 'free' };

let savedFreeModel;
beforeEach(() => { savedFreeModel = process.env.OPENROUTER_FREE_TIER_MODEL; });
afterEach(() => {
  if (savedFreeModel === undefined) delete process.env.OPENROUTER_FREE_TIER_MODEL;
  else process.env.OPENROUTER_FREE_TIER_MODEL = savedFreeModel;
});

// LIN-3875: the free cell must pass the hourly gate to reach the model it is testing.
const ALLOWING_STORE = { tryUse: async () => ({ allowed: true }) };

async function setup({ env, stored = {}, resolveModel } = {}) {
  const fx = routingFixture();
  await fx.prefs.insertOne({ _id: URL_KEY, preferences: stored });
  const calls = { paragraph: [], summary: [] };
  const paragraphPuts = [];
  const summaryPuts = [];
  const precomputeRunParagraph = createRunParagraphPrecompute({
    runParagraphStore: { get: async () => null, put: async (...a) => { paragraphPuts.push(a[2]); } },
    buildView: () => ({}),
    resolveModel: resolveModel || jobModelResolver(fx.preferencesStore),
    freeTierStore: ALLOWING_STORE,
    generateParagraph: async (_v, opts) => { calls.paragraph.push(opts.model); return { paragraph: 'p', model: opts.model ?? DEFAULT_MODEL }; },
    logger: { error() {} }
  });
  const precomputeSessionSummary = createSessionSummaryPrecompute({
    sessionSummaryStore: { get: async () => null, put: async (...a) => { summaryPuts.push(a[2]); } },
    isTerminal: () => true,
    hashSessionFn: () => 'h',
    childLoopsFn: () => [],
    resolveModel: resolveModel || jobModelResolver(fx.preferencesStore),
    freeTierStore: ALLOWING_STORE,
    generateSummary: async (_s, opts) => { calls.summary.push(opts.model); return { summary: 's', model: opts.model ?? DEFAULT_MODEL }; }
  });
  const hook = createMaterializerPrecompute({
    precomputeRunParagraph,
    precomputeSessionSummary,
    resolveCredential: () => resolvePrecomputeCredential(env)
  });
  return { fx, hook, calls, paragraphPuts, summaryPuts };
}
const run = (hook) => hook(URL_KEY, { sessionId: 's1' });

describe('precompute model routing (LIN-3856, D2)', () => {
  test('free key + curated OPENROUTER_FREE_TIER_MODEL: both paths call that id, even with a stored setting', async () => {
    process.env.OPENROUTER_FREE_TIER_MODEL = CURATED;
    const { fx, hook, calls, paragraphPuts, summaryPuts } = await setup({ env: FREE_ENV, stored: { modelId: 'anthropic/ws-model' } });
    await run(hook);
    assert.deepEqual(calls, { paragraph: [CURATED], summary: [CURATED] });
    assert.equal(paragraphPuts[0].model, CURATED);
    assert.equal(summaryPuts[0].model, CURATED);
    assert.ok(fx);
  });

  test('paid key: both paths call the job setting (job beats group), and the stored model is the one called', async () => {
    process.env.OPENROUTER_FREE_TIER_MODEL = CURATED;
    const { fx, hook, calls, paragraphPuts, summaryPuts } = await setup({ env: PAID_ENV, stored: { modelId: 'anthropic/ws-model' } });
    await fx.routingStore.changeJob('run-paragraph', { model: 'anthropic/rp-m' }, CTX);
    await fx.routingStore.changeJob('session-summary', { model: 'anthropic/ss-m' }, CTX);
    await run(hook);
    assert.deepEqual(calls, { paragraph: ['anthropic/rp-m'], summary: ['anthropic/ss-m'] });
    assert.equal(paragraphPuts[0].model, 'anthropic/rp-m');
    assert.equal(summaryPuts[0].model, 'anthropic/ss-m');
  });

  test('paid key, group setting only: both paths take the group', async () => {
    const { hook, calls } = await setup({ env: PAID_ENV, stored: { modelId: 'anthropic/ws-model' } });
    await run(hook);
    assert.deepEqual(calls, { paragraph: ['anthropic/ws-model'], summary: ['anthropic/ws-model'] });
  });

  test('nothing stored: DEFAULT_MODEL', async () => {
    delete process.env.OPENROUTER_FREE_TIER_MODEL;
    const { hook, calls } = await setup({ env: PAID_ENV });
    await run(hook);
    assert.deepEqual(calls, { paragraph: [DEFAULT_MODEL], summary: [DEFAULT_MODEL] });
  });

  test('the two jobs do not leak into each other', async () => {
    const { fx, hook, calls } = await setup({ env: PAID_ENV });
    await fx.routingStore.changeJob('run-paragraph', { model: 'only/rp' }, CTX);
    await run(hook);
    assert.deepEqual(calls, { paragraph: ['only/rp'], summary: [DEFAULT_MODEL] });
  });

  test('a store failure writes no summary and does not throw out of the run paragraph', async () => {
    const boom = async () => { throw new Error('store down'); };
    const { hook, paragraphPuts, summaryPuts, calls } = await setup({ env: PAID_ENV, resolveModel: boom });
    await assert.rejects(run(hook), /store down/); // summary path: unchanged, no try (caller isolates)
    assert.deepEqual([paragraphPuts, summaryPuts, calls.summary], [[], [], []]);
  });

  test('unwired resolveModel keeps the generator default', async () => {
    const calls = [];
    const pre = createRunParagraphPrecompute({
      runParagraphStore: { get: async () => null, put: async () => {} },
      buildView: () => ({}),
      generateParagraph: async (_v, o) => { calls.push(o.model); return { paragraph: 'p', model: DEFAULT_MODEL }; }
    });
    await pre(URL_KEY, { sessionId: 's' }, { apiKey: 'k' });
    assert.deepEqual(calls, [undefined]);
  });
});

describe('jobModelResolver (the production mapping)', () => {
  test('jobId reaches resolveAiOperationModel as opKind; isFreeTier clamps whatever is stored', async () => {
    const fx = routingFixture();
    await fx.prefs.insertOne({ _id: URL_KEY, preferences: {} });
    await fx.routingStore.changeJob('run-paragraph', { model: 'x/rp' }, CTX);
    await fx.routingStore.changeJob('session-summary', { model: 'x/ss' }, CTX);
    const resolve = jobModelResolver(fx.preferencesStore);
    assert.equal(await resolve({ urlKey: URL_KEY, jobId: 'run-paragraph', isFreeTier: false }), 'x/rp');
    assert.equal(await resolve({ urlKey: URL_KEY, jobId: 'session-summary', isFreeTier: false }), 'x/ss');
    process.env.OPENROUTER_FREE_TIER_MODEL = CURATED;
    assert.equal(await resolve({ urlKey: URL_KEY, jobId: 'run-paragraph', isFreeTier: true }), CURATED);
    assert.equal(
      await resolve({ urlKey: URL_KEY, jobId: 'session-summary', isFreeTier: true }),
      await resolveAiOperationModel({ urlKey: URL_KEY, workspacePreferencesStore: fx.preferencesStore, opKind: 'session-summary', forceDefault: true })
    );
  });
});
