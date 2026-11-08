/**
 * LIN-4393: the standing size policy is built in (err larger), so every scoping prompt carries
 * it with no stored value, and a value still stored from the retired Settings row is ignored.
 * (LIN-4368 made it a workspace setting whose default was "no standing policy", which stopped
 * every task for a size ruling; LIN-4393 removed the setting and kept John's answer.)
 *
 * The paths that render a scoping prompt:
 *   - the routed entrance: prepareRecommendationInput builds the input, and getRecommendation /
 *     getRecommendationStream compose the routed stage's prompt from it
 *     (composeRoutedRecommendation);
 *   - the pinned-kind entrances: recommend-and-dispatch with `kind` (lib/dispatch-entrance.js,
 *     the override arm), GET /api/proxy/prompt/:id/:kind and GET /api/proxy/recommend/:id?kind=
 *     (routes/proxy-compute.js);
 *   - the in-app prompt route the UI's "run a step now" and the prompt panel use:
 *     GET /workspace/:urlKey/api/prompt/:issueId/scoping (routes/workspace-api-prompts.js).
 * Each renders the err-larger line and never asks for a size `DECISION:`, with no preferences
 * and with a stored `sizePolicy: { value: 'ask' }`. The routing prompt does not carry the policy.
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
const ERR_LARGER_LINE = /\*\*Standing size policy:\*\* err larger: take the larger move when the look shows it pays, and when in doubt; it does not mean inflating every ticket, and a small, clear ticket stays just the task\.\n/;
const CUT_GUARD = 'A size smaller than the ask, or wrong work, is a cut; the standing policy never decides one.';
// What the scoping prompt said when no policy was stored: every task stopped for a size ruling.
const ASKS = [/no standing policy/, /Without one, the size is/, /\(set \d{4}-\d{2}-\d{2}\)/];
// Absent preferences, and the value the retired setting could still have stored.
const PREFS = { 'no stored value': {}, "a stored sizePolicy of 'ask'": { sizePolicy: { value: 'ask', setBy: { via: 'page' }, setAt: '2026-11-06T10:00:00.000Z' } } };

function assertHandsOff(prompt, label) {
  assert.match(prompt, ERR_LARGER_LINE, label);
  assert.ok(prompt.includes(CUT_GUARD), `${label}: the cut sentence is unchanged`);
  for (const re of ASKS) assert.doesNotMatch(prompt, re, label);
}

const prefsStore = (prefs) => ({ getWorkspacePreferences: async () => prefs });

describe('the routed entrance', () => {
  const issue = { identifier: 'ABC-1', title: 'A ticket', description: 'Do the thing.', state: { name: 'Todo', type: 'unstarted' }, labels: [] };
  const ctx = { parent: null, siblings: [], project: null, children: [], comments: [], attachments: [] };
  const runsStore = { listItems: async () => [], listHistory: async () => ({ items: [] }) };
  const routedScoping = async () => {
    const input = await prepareRecommendationInput(ctx, { dispatchQueueStore: runsStore, urlKey: 'acme', identifier: 'ABC-1' });
    const parsed = { reasoning: '→ **scoping**', prompt: null, truncated: false, recommendedAction: 'scoping', deferTo: null, completionTokens: null };
    return { input, prompt: composeRoutedRecommendation(parsed, issue, input).prompt };
  };

  test('renders the built-in err-larger policy with no preferences store at all', async () => {
    assertHandsOff((await routedScoping()).prompt, 'routed');
  });

  test('the input carries no policy, so neither prompt can read one', async () => {
    const { input } = await routedScoping();
    assert.equal('sizePolicy' in input, false);
    const routing = buildRouterPrompt(buildSelectorArgs(issue, input));
    assert.doesNotMatch(routing, /Standing size policy/);
  });

  test('neither caller of prepareRecommendationInput passes a preferences store', () => {
    for (const file of ['routes/proxy.js', 'routes/workspace-api.js']) {
      const calls = readFileSync(join(ROOT, file), 'utf8').match(/prepareRecommendationInput\([^)]*\)/g) || [];
      assert.ok(calls.length > 0, `${file} calls prepareRecommendationInput`);
      for (const c of calls) assert.doesNotMatch(c, /workspacePreferencesStore/, `${file}: ${c}`);
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
    test(`${name}: err larger, with no stored value and with a stored 'ask'`, async () => {
      for (const [label, prefs] of Object.entries(PREFS)) assertHandsOff(await render(prefs), `${name}, ${label}`);
    });
  }
});

describe('the in-app prompt route (the UI\'s "run a step now" and the prompt panel)', () => {
  const issue = { id: 'size-ui-1', identifier: 'UI-1', title: 'A ticket', description: 'Do the thing.', state: { name: 'Todo', type: 'unstarted' }, labels: [] };
  const providerName = 'fake-scoping-ui';
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

  test('GET /workspace/:k/api/prompt/:id/scoping: err larger, with no stored value and with a stored \'ask\'', async () => {
    for (const [label, prefs] of Object.entries(PREFS)) assertHandsOff(await renderScoping(prefs), label);
  });
});
