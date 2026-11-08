/**
 * LIN-4368: the standing size policy reaches every scoping prompt, through both entrances.
 *
 * One loader (lib/workspace-preferences.js loadSizePolicy) reads `sizePolicy`. Two kinds of
 * path render a scoping prompt:
 *   - the routed entrance: prepareRecommendationInput builds the input, and getRecommendation /
 *     getRecommendationStream compose the routed stage's prompt from it
 *     (composeRoutedRecommendation). Both callers of prepareRecommendationInput pass the store;
 *   - the pinned-kind entrances: recommend-and-dispatch with `kind` (lib/dispatch-entrance.js,
 *     the override arm), GET /api/proxy/prompt/:id/:kind and GET /api/proxy/recommend/:id?kind=
 *     (routes/proxy-compute.js);
 *   - the in-app prompt route the UI's "run a step now" and the prompt panel use:
 *     GET /workspace/:urlKey/api/prompt/:issueId/scoping (routes/workspace-api-prompts.js).
 * Each shows the policy when it is set and "no standing policy" when it is not. The routing
 * prompt itself does not carry the policy.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { prepareRecommendationInput } from '../../lib/recommendation-input.js';
import { composeRoutedRecommendation, buildSelectorArgs } from '../../lib/openrouter.js';
import { buildRouterPrompt } from '../../lib/stage-router.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SET = /\*\*Standing size policy:\*\* err larger: take the larger move when the look shows it pays, and when in doubt/;
const UNSET = /\*\*Standing size policy:\*\* no standing policy/;
const ERR_LARGER = { sizePolicy: { value: 'err-larger', setBy: { via: 'page', id: 'u1' }, setAt: '2026-11-07T22:18:14.300Z' } };

const prefsStore = (prefs) => ({ getWorkspacePreferences: async () => prefs });

describe('the routed entrance', () => {
  const issue = { identifier: 'ABC-1', title: 'A ticket', description: 'Do the thing.', state: { name: 'Todo', type: 'unstarted' }, labels: [] };
  const ctx = { parent: null, siblings: [], project: null, children: [], comments: [], attachments: [] };
  const runsStore = { listItems: async () => [], listHistory: async () => ({ items: [] }) };
  const routedScoping = async (prefs) => {
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: runsStore, workspacePreferencesStore: prefsStore(prefs), urlKey: 'acme', identifier: 'ABC-1' });
    const parsed = { reasoning: '→ **scoping**', prompt: null, truncated: false, recommendedAction: 'scoping', deferTo: null, completionTokens: null };
    return { input, prompt: composeRoutedRecommendation(parsed, issue, input).prompt };
  };

  test('shows the policy when set', async () => {
    assert.match((await routedScoping(ERR_LARGER)).prompt, SET);
  });

  test('shows "no standing policy" when not set, or set to ask', async () => {
    assert.match((await routedScoping({})).prompt, UNSET);
    assert.match((await routedScoping({ sizePolicy: { value: 'ask' } })).prompt, UNSET);
  });

  test('the routing prompt does not carry the policy', async () => {
    const { input } = await routedScoping(ERR_LARGER);
    const withPolicy = buildRouterPrompt(buildSelectorArgs(issue, input));
    const without = buildRouterPrompt(buildSelectorArgs(issue, { ...input, sizePolicy: undefined }));
    assert.equal(withPolicy, without);
  });

  test('both callers of prepareRecommendationInput pass the preferences store', () => {
    for (const file of ['routes/proxy.js', 'routes/workspace-api.js']) {
      const calls = readFileSync(join(ROOT, file), 'utf8').match(/prepareRecommendationInput\([^)]*\)/g) || [];
      assert.ok(calls.length > 0, `${file} calls prepareRecommendationInput`);
      for (const c of calls) assert.match(c, /workspacePreferencesStore/, `${file}: ${c}`);
    }
  });
});

describe('the pinned-kind entrances', () => {
  function buildApp(prefs, captured) {
    const app = express();
    app.use(express.json());
    app.use(createProxyRoutes({
      proxyTokenStore: {
        createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
        validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-acme', tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
      },
      proxyEventStore: { recordEvent: async () => {} },
      resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan', expiresAt: Date.now() + 3600_000 }),
      getWorkspaceAccessToken: async () => 'test-token',
      getWorkspaceOpenRouterKey: async () => null,
      agentStatusStore: {},
      recapCacheStore: { get: async () => null, set: async () => {} },
      briefCacheStore: { get: async () => null, set: async () => {} },
      dispatchQueueStore: {
        getGrantDeclaration: async () => ({ state: 'none' }),
        addItem: async (urlKey, item) => { captured.item = item; return { _id: 'disp-1', dispatchedAt: '2026-11-07T00:00:00.000Z', ...item }; }
      },
      workspaceFromUrl: (req, res, next) => next(),
      workspacePreferencesStore: prefsStore(prefs),
      freeTierStore: { tryUse: async () => ({ allowed: true }) }
    }));
    return app;
  }

  async function request(app, method, path, body) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { Authorization: 'Bearer anything', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  const ENTRANCES = {
    'recommend-and-dispatch with kind (the dispatch entrance\'s override arm)': async (prefs) => {
      const captured = {};
      const res = await request(buildApp(prefs, captured), 'POST', '/api/proxy/recommend-and-dispatch', { issueIdentifier: 'TEST-1', kind: 'scoping' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.override, true);
      return captured.item.prompt;
    },
    'GET /api/proxy/prompt/:id/scoping': async (prefs) => {
      const res = await request(buildApp(prefs, {}), 'GET', '/api/proxy/prompt/TEST-1/scoping');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.prompt;
    },
    'GET /api/proxy/recommend/:id?kind=scoping': async (prefs) => {
      const res = await request(buildApp(prefs, {}), 'GET', '/api/proxy/recommend/TEST-1?kind=scoping');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body.prompt;
    }
  };

  for (const [name, render] of Object.entries(ENTRANCES)) {
    test(`${name}: the policy when set, "no standing policy" when not`, async () => {
      assert.match(await render(ERR_LARGER), SET);
      assert.match(await render({}), UNSET);
    });
  }
});

describe('the in-app prompt route (the UI\'s "run a step now" and the prompt panel)', () => {
  const issue = { id: 'size-ui-1', identifier: 'UI-1', title: 'A ticket', description: 'Do the thing.', state: { name: 'Todo', type: 'unstarted' }, labels: [] };
  const providerName = 'fake-size-policy-ui';
  registerProvider({
    name: providerName,
    ui: {},
    supports: () => true,
    fetchIssueContext: async (_scope, issueId) => {
      if (issueId !== issue.id) throw new Error(`Issue not found: ${issueId}`);
      return { issue, parent: null, siblings: [], project: null, children: [], comments: [], attachments: [] };
    }
  });
  // A real (non-test-token) workspace, so the provider branch runs, not the fixtures.
  const workspace = { urlKey: 'acme', provider: providerName, accessToken: 'real-token', bindings: [{ provider: providerName, scope: 'acme', credentials: { token: 'real-token' } }] };

  async function renderScoping(prefs) {
    const app = express();
    app.use(createWorkspaceApiRoutes({
      workspaceFromUrl: (req, _res, next) => { req.workspace = workspace; req.session = { features: {} }; next(); },
      freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
      workspacePreferencesStore: prefsStore(prefs),
      customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {}, reportHistoryStore: {},
      dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {}
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/workspace/acme/api/prompt/${issue.id}/scoping`);
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      return body.prompt;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('GET /workspace/:k/api/prompt/:id/scoping: the policy when set, "no standing policy" when not', async () => {
    assert.match(await renderScoping(ERR_LARGER), SET);
    assert.match(await renderScoping({}), UNSET);
  });
});
