/**
 * LIN-2353 — the dispatch lane threads no providerUi, so every worker-facing
 * dispatched prompt was shaped with the DEFAULT_PROMPT_UI floor (write/subtasks
 * on, displayName 'Linear') regardless of the resolved workspace's actual
 * provider. This pins the three deterministic `generatePrompt(...)` call sites
 * in routes/proxy.js now threading `provider?.ui`:
 *
 *   1. GET /api/proxy/issues/:identifier/prompt/:templateKey  (:4161)
 *   2. GET /api/proxy/recommend/:identifier?kind=...           (:4507, kind-override)
 *   3. POST /api/proxy/recommend-and-dispatch  {kind: ...}     (:6524, kind-override)
 *
 * `breakdown` is used as the template kind throughout: it renders an "Existing
 * Subtasks" section from `context.children`, so a GitHub-shaped provider
 * (`subtasks: false`) is also exercised on the strip-subtasks branch, not just
 * the displayName rename. TEST-1 (test-mode mock fixture) has TEST-2 as a
 * child, so the section is genuinely present to strip.
 *
 * `resolvePromptIssueContext`'s test-mode branch never calls
 * `provider.fetchIssueContext` — it substitutes fixture data regardless of
 * which provider is resolved — so a bare `{ name, ui }`-shaped fake, or the
 * real registered github/local provider modules, can drive `provider.ui`
 * without needing a working data fetcher.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import '../../lib/providers/github/index.js'; // side effect: self-registers 'github'
import '../../lib/providers/local/index.js'; // side effect: self-registers 'local'

function makeDispatchQueueStore() {
  const items = [];
  return {
    items,
    async addItem(urlKey, item) {
      const doc = { _id: `dispatch-${items.length + 1}`, urlKey, ...item };
      items.push(doc);
      return doc;
    }
  };
}

function buildApp({ providerName, dispatchQueueStore } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    // token === 'test-token' drives isTestMode → the mock issue context
    // (TEST-1, with TEST-2 as its child). `provider` here is a NAME string,
    // resolved to the real registered provider instance by resolveProviderAccess.
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok', provider: providerName }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: dispatchQueueStore || makeDispatchQueueStore(),
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2353 — proxy.js deterministic sites thread provider?.ui into generatePrompt', () => {
  describe('site 1 — GET /api/proxy/issues/:identifier/prompt/:templateKey (:4161)', () => {
    test('a github-backed workspace renders GitHub Issues, not Linear, and strips subtasks', async () => {
      const app = buildApp({ providerName: 'github' });
      const { status, body } = await call(app, '/api/proxy/issues/TEST-1/prompt/breakdown');

      assert.equal(status, 200, JSON.stringify(body));
      assert.ok(body.prompt.includes('GitHub Issues'), 'must render the GitHub displayName');
      assert.ok(!body.prompt.includes('Linear'), 'must carry no literal "Linear"');
      assert.ok(!body.prompt.includes('Existing Subtasks'), 'GitHub has no subtasks — the section must be stripped');
    });

    test('a linear-backed workspace stays byte-identical (write on, subtasks on, displayName Linear)', async () => {
      const app = buildApp({ providerName: 'linear' });
      const { status, body } = await call(app, '/api/proxy/issues/TEST-1/prompt/breakdown');

      assert.equal(status, 200, JSON.stringify(body));
      assert.ok(body.prompt.includes('Linear'));
      assert.ok(body.prompt.includes('Existing Subtasks'), 'Linear models subtasks — the section must survive');
    });

    test('a local-backed workspace renders the intended Local naming change (Linear -> Local)', async () => {
      const app = buildApp({ providerName: 'local' });
      const { status, body } = await call(app, '/api/proxy/issues/TEST-1/prompt/breakdown');

      assert.equal(status, 200, JSON.stringify(body));
      assert.ok(body.prompt.includes('Local'), 'must render the Local displayName');
      assert.ok(!body.prompt.includes('Linear'), 'must carry no literal "Linear"');
      // Local models subtasks (ui.subtasks defaults true, no override) — section survives.
      assert.ok(body.prompt.includes('Existing Subtasks'));
    });
  });

  describe('site 2 — GET /api/proxy/recommend/:identifier?kind=... (:4507, kind-override)', () => {
    test('a github-backed workspace renders GitHub Issues, not Linear, and strips subtasks', async () => {
      const app = buildApp({ providerName: 'github' });
      const { status, body } = await call(app, '/api/proxy/recommend/TEST-1?kind=breakdown');

      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.override, true);
      assert.ok(body.prompt.includes('GitHub Issues'));
      assert.ok(!body.prompt.includes('Linear'));
      assert.ok(!body.prompt.includes('Existing Subtasks'));
    });

    test('a linear-backed workspace stays byte-identical', async () => {
      const app = buildApp({ providerName: 'linear' });
      const { status, body } = await call(app, '/api/proxy/recommend/TEST-1?kind=breakdown');

      assert.equal(status, 200, JSON.stringify(body));
      assert.ok(body.prompt.includes('Linear'));
      assert.ok(body.prompt.includes('Existing Subtasks'));
    });
  });

  describe('site 3 — POST /api/proxy/recommend-and-dispatch {kind: ...} (:6524, kind-override)', () => {
    test('a github-backed workspace queues a dispatch item shaped with GitHub Issues, not Linear', async () => {
      const dispatchQueueStore = makeDispatchQueueStore();
      const app = buildApp({ providerName: 'github', dispatchQueueStore });
      const { status, body } = await call(app, '/api/proxy/recommend-and-dispatch', {
        method: 'POST',
        body: { issueIdentifier: 'TEST-1', kind: 'breakdown', appendProxyContext: false }
      });

      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(dispatchQueueStore.items.length, 1);
      const { prompt } = dispatchQueueStore.items[0];
      assert.ok(prompt.includes('GitHub Issues'));
      assert.ok(!prompt.includes('Linear'));
      assert.ok(!prompt.includes('Existing Subtasks'));
    });

    test('a linear-backed workspace queues a byte-identical dispatch item', async () => {
      const dispatchQueueStore = makeDispatchQueueStore();
      const app = buildApp({ providerName: 'linear', dispatchQueueStore });
      const { status, body } = await call(app, '/api/proxy/recommend-and-dispatch', {
        method: 'POST',
        body: { issueIdentifier: 'TEST-1', kind: 'breakdown', appendProxyContext: false }
      });

      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(dispatchQueueStore.items.length, 1);
      const { prompt } = dispatchQueueStore.items[0];
      assert.ok(prompt.includes('Linear'));
      assert.ok(prompt.includes('Existing Subtasks'));
    });
  });
});
