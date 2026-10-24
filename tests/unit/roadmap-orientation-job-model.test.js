/**
 * LIN-3853: `roadmap-orientation` is its own job with its own stored model. Before the
 * model-routing store, `resolveRoadmapLLM` resolved one model and the orientation call
 * borrowed it, so a registry job's setting would have been read by nothing.
 *
 * Drives POST /workspace/:urlKey/api/roadmap/generate with OpenRouter replaced by the
 * `setFetchImpl` seam (no network): the request bodies show which model each layer used.
 * The orientation layer is the last request.
 *
 * Run with: node --test tests/unit/roadmap-orientation-job-model.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRoadmapRoutes } from '../../routes/workspace-api-roadmap.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setFetchImpl, AVAILABLE_MODELS, DEFAULT_MODEL } from '../../lib/openrouter.js';
import { routingFixture } from './helpers/routing-fakes.js';

const URL_KEY = 'acme';
const PROVIDER_NAME = 'roadmap-orientation-fake-provider';
const [MODEL_A, MODEL_B] = AVAILABLE_MODELS.filter((m) => m.id !== DEFAULT_MODEL).map((m) => m.id);

const sse = (text) => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
);

describe('roadmap orientation resolves its own job (LIN-3853)', () => {
  let fx, requests, restoreFetch, savedEnv;
  beforeEach(() => {
    fx = routingFixture();
    requests = [];
    savedEnv = { free: process.env.OPENROUTER_FREE_TIER_KEY, paid: process.env.OPENROUTER_API_KEY };
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY; delete process.env.https_proxy; delete process.env.http_proxy;
    registerProvider({ name: PROVIDER_NAME, fetchTeams: async () => [], fetchProjects: async () => ({ projects: [], issues: [] }) });
    setFetchImpl(async (_url, init) => { requests.push(JSON.parse(init.body)); return sse('ok'); });
    restoreFetch = () => setFetchImpl(null);
  });
  afterEach(() => {
    restoreFetch();
    for (const [k, v] of [['OPENROUTER_FREE_TIER_KEY', savedEnv.free], ['OPENROUTER_API_KEY', savedEnv.paid]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  async function generate({ session = { openRouterApiKey: 'sk-or-paid' }, body = {} } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.session = { features: { roadmap: true }, ...session };
      req.workspace = { urlKey: URL_KEY, provider: PROVIDER_NAME };
      next();
    });
    app.use(createRoadmapRoutes({
      workspaceFromUrl: (_req, _res, next) => next(),
      freeTierStore: { tryUse: async () => ({ allowed: true }) },
      userPreferencesStore: {},
      workspacePreferencesStore: fx.preferencesStore,
      reportHistoryStore: {}
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/${URL_KEY}/api/roadmap/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ northStar: 'Ship the thing', ...body })
      });
      await res.text();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    return requests.map((r) => r.model);
  }
  const ctx = { urlKey: URL_KEY, reason: 'test', actor: { via: 'page', id: 'a' } };

  test('the orientation call uses the roadmap-orientation job\'s model, the narrative layers the roadmap job\'s', async () => {
    await fx.routingStore.changeJob('roadmap', { model: MODEL_A }, ctx);
    await fx.routingStore.changeJob('roadmap-orientation', { model: MODEL_B }, ctx);
    const models = await generate();
    assert.ok(models.length >= 2, 'layers and orientation all called');
    assert.equal(models.at(-1), MODEL_B);
    assert.ok(models.slice(0, -1).every((m) => m === MODEL_A));
  });

  test('with only the Harbour group set, both follow it (nothing changes from before)', async () => {
    await fx.routingStore.changeGroup('harbour-call', 'tell', { model: MODEL_A }, ctx);
    const models = await generate();
    assert.ok(models.every((m) => m === MODEL_A));
  });

  test('the LIN-819 body override still applies to the orientation call', async () => {
    await fx.routingStore.changeJob('roadmap-orientation', { model: MODEL_B }, ctx);
    const models = await generate({ body: { model: MODEL_A } });
    assert.equal(models.at(-1), MODEL_A);
  });

  test('the free tier still clamps it, whatever is stored and whatever the body asks', async () => {
    await fx.routingStore.changeJob('roadmap-orientation', { model: MODEL_B }, ctx);
    process.env.OPENROUTER_FREE_TIER_KEY = 'sk-or-free';
    delete process.env.OPENROUTER_API_KEY;
    const models = await generate({ session: {}, body: { model: MODEL_A } });
    assert.ok(models.length >= 2);
    assert.ok(models.every((m) => m === DEFAULT_MODEL), JSON.stringify(models));
  });
});
