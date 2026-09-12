/**
 * LIN-2804 — route-level threading: the proxy preamble and autopilot kickoff
 * pointed every dispatched worker at `/issues/{id}`/`/relations` reads that
 * 422 (`CAPABILITY_NOT_SUPPORTED`) on a GitHub/GitHub-Projects/Jira-backed
 * workspace. `provider.ui.issueDetail`/`.relations` (lib/providers/interface.js)
 * now gate those endpoint hints, and the two threading idioms already
 * established for `providerDisplayName` (LIN-2354) carry the same `ui` object:
 *
 *   - request-scoped bearer-token routes: `req.resolvedProvider.ui`, stamped by
 *     `resolveProviderAccess` (routes/proxy.js) and read via `resolvedProviderUi`
 *     (lib/proxy-graphql-errors.js) — exercised here via the scoped
 *     `POST /api/proxy/autopilot/kickoff` route.
 *   - workspace-scoped session routes: `getProvider(workspace.provider)?.ui`,
 *     exercised here via `enqueueFeedbackTriage` (routes/workspace-api.js),
 *     the same call site tests/unit/lin-2353-feedback-triage-provider-ui.test.js
 *     already covers for `providerDisplayName`.
 *
 * Both idioms are asserted against a GitHub-shaped fake (issueDetail/relations
 * both false) and a Linear-shaped fake (both true, byte-identical to the
 * default/omitted path) so a route that fails to thread `providerUi` degrades
 * to "advertise everything" (today's behavior), never a crash.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

function githubShapedProvider(name) {
  return {
    name,
    ui: { issueDetail: false, relations: false, displayName: 'GitHub Issues' },
    supports: (m) => m === 'fetchIssueContext',
    async fetchIssueContext() {
      return { issue: { id: 'i1', identifier: 'GH-42', title: 'Fix the thing' }, project: null, comments: [], children: [] };
    },
  };
}

function linearShapedProvider(name) {
  return {
    name,
    ui: { issueDetail: true, relations: true, displayName: 'Linear' },
    supports: (m) => m === 'fetchIssueContext',
    async fetchIssueContext() {
      return { issue: { id: 'i1', identifier: 'LIN-42', title: 'Fix the thing' }, project: null, comments: [], children: [] };
    },
  };
}

// --- Request-scoped idiom: req.resolvedProvider.ui (routes/proxy.js) -------

function capturingDispatchStore() {
  const items = [];
  return { items, addItem: async (urlKey, item) => { items.push({ urlKey, item }); return { _id: 'd1', ...item }; } };
}

function buildKickoffApp({ provider, dispatchQueueStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'live-token', reason: 'ok', provider: provider.name }),
    getWorkspaceAccessToken: async () => 'live-token',
    getWorkspaceOpenRouterKey: async () => null,
    provider,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function postKickoff(app, body) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/autopilot/kickoff`, {
      method: 'POST',
      headers: { Authorization: 'Bearer agent-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2804 — request-scoped idiom (req.resolvedProvider.ui via POST /api/proxy/autopilot/kickoff)', () => {
  test('a GitHub-backed scoped kickoff omits /issues/{id} and /relations from the dispatched prompt', async () => {
    const dispatch = capturingDispatchStore();
    const app = buildKickoffApp({ provider: githubShapedProvider('lin2804-gh-kickoff'), dispatchQueueStore: dispatch });

    const { status } = await postKickoff(app, { issueIdentifier: 'GH-42' });

    assert.strictEqual(status, 201);
    assert.strictEqual(dispatch.items.length, 1);
    const { prompt } = dispatch.items[0].item;
    assert.ok(!prompt.includes('GET /issues/GH-42'), 'no scoped first-act /issues/{id} hint');
    assert.ok(!prompt.includes('/api/proxy/issues/GH-42'), 'no preamble /issues/{id} hint');
    assert.ok(!prompt.includes('/relations/GH-42'), 'no preamble /relations hint');
    assert.ok(!/verify `GET \/issues\/\{id\}`/.test(prompt), 'no Setup guide /issues/{id} verify hint');
    assert.ok(prompt.includes('this provider does not support raw issue-detail reads'), 'first-act replacement wording present');
    assert.ok(prompt.includes('/api/proxy/search?q=… to find related tasks by text'), 'preamble search alternative present');
    assert.ok(!prompt.includes('/comments'), 'ticket-fidelity finding: no phantom /comments endpoint anywhere');
  });

  test('a Linear-backed scoped kickoff is byte-identical whether issueDetail/relations are explicit-true or simply absent', async () => {
    // Same provider identity (name/displayName) both times — the only variable
    // under test is whether `ui.issueDetail`/`.relations` are explicitly `true`
    // or simply absent from the `ui` object (undefined), which the `!== false`
    // gate treats identically. A DIFFERENT provider identity would also vary
    // `providerDisplayName` (LIN-2354), an orthogonal concern already pinned by
    // tests/unit/lin-2363-kickoff-provider-attribution.test.js.
    async function queuedPrompt(providerUiOverride) {
      const dispatch = capturingDispatchStore();
      const provider = { ...linearShapedProvider('lin2804-linear-kickoff'), ui: { displayName: 'Linear', ...providerUiOverride } };
      const app = buildKickoffApp({ provider, dispatchQueueStore: dispatch });
      await postKickoff(app, { issueIdentifier: 'LIN-42' });
      assert.strictEqual(dispatch.items.length, 1);
      // Each app listens on its own ephemeral port, embedded in the prompt's
      // baseUrl — normalize that out before the byte-parity comparison.
      return dispatch.items[0].item.prompt.replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://TESTHOST');
    }

    const explicitTrue = await queuedPrompt({ issueDetail: true, relations: true });
    const absent = await queuedPrompt({});

    assert.strictEqual(explicitTrue, absent, 'explicit true vs. absent must be a byte-identical no-op');
    assert.ok(explicitTrue.includes('GET /issues/LIN-42'), 'raw issue detail stays available for Linear');
  });
});

// --- Workspace-scoped idiom: getProvider(workspace.provider)?.ui -----------

function capturingWorkspaceDispatchStore() {
  const items = [];
  return { items, addItem: async (urlKey, item) => { items.push({ urlKey, item }); return { _id: 'd1', ...item }; } };
}

function fakeProxyTokenStore(token = 'minted-rw-token') {
  return { async createToken(urlKey, options) { return { token, scope: options?.scope }; } };
}

function buildFeedbackApp({ provider, dispatchQueueStore }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: provider.name, accessToken: 'ws-token' };
      req.session = { linearUserId: 'user-1', features: { feedbackTriage: true } };
      next();
    },
    dispatchQueueStore,
    proxyTokenStore: fakeProxyTokenStore(),
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {},
    briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {}
  });
  app.use(router);
  return app;
}

async function submitFeedback(app, urlKey, payload) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/${urlKey}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// Feedback submission creates the ticket via createIssue before triage is
// enqueued (mirrors tests/unit/lin-2353-feedback-triage-provider-ui.test.js's
// `makeProvider` helper), so the fake providers below need the full write
// shape, not just fetchIssueContext.
function feedbackCapableProvider(name, ui) {
  return {
    name,
    ...(ui ? { ui } : {}),
    supports: () => true,
    apiWriteFields: () => ['title', 'description', 'projectId'],
    async fetchTeams() { return [{ id: 'team-default', name: 'Default' }]; },
    async createIssue(token, input) {
      return { success: true, issue: { id: 'iss-1', identifier: 'GH-900', title: input.title, url: 'https://github.com/acme/repo/issues/900', state: { name: 'Todo', type: 'unstarted' } } };
    },
  };
}

describe('LIN-2804 — workspace-scoped idiom (getProvider(workspace.provider)?.ui via feedback-triage dispatch)', () => {
  test('a GitHub-backed workspace queues a triage prompt whose appended preamble omits /issues/{id} and /relations', async () => {
    const provider = feedbackCapableProvider('lin2804-gh-triage', { issueDetail: false, relations: false, displayName: 'GitHub Issues' });
    const dispatch = capturingWorkspaceDispatchStore();
    const app = buildFeedbackApp({ provider, dispatchQueueStore: dispatch });

    const { status } = await submitFeedback(app, 'acme', { message: 'Something is broken' });

    assert.strictEqual(status, 201);
    assert.strictEqual(dispatch.items.length, 1);
    const { prompt } = dispatch.items[0].item;
    const preamble = prompt.split('You have a workspace API proxy')[1] ?? '';
    assert.ok(!preamble.includes('/api/proxy/issues/'), 'no /issues/{id} hint in the appended preamble');
    assert.ok(!preamble.includes('/relations/'), 'no /relations hint in the appended preamble');
    assert.ok(preamble.includes('/api/proxy/search?q=… to find related tasks by text'), 'search alternative present');
  });

  test('a Linear-shaped workspace preamble is byte-identical whether issueDetail/relations are explicit-true or simply absent', async () => {
    // Same provider identity/displayName both times (see the identical note on
    // the kickoff byte-parity test above) — only issueDetail/relations vary.
    async function queuedPreamble(uiOverride) {
      const dispatch = capturingWorkspaceDispatchStore();
      const provider = feedbackCapableProvider('lin2804-linear-triage', { displayName: 'Linear', ...uiOverride });
      const app = buildFeedbackApp({ provider, dispatchQueueStore: dispatch });
      const { status } = await submitFeedback(app, 'acme', { message: 'Something is broken' });
      assert.strictEqual(status, 201);
      assert.strictEqual(dispatch.items.length, 1);
      return dispatch.items[0].item.prompt.split('You have a workspace API proxy')[1] ?? '';
    }

    const explicitTrue = await queuedPreamble({ issueDetail: true, relations: true });
    const absent = await queuedPreamble({});

    assert.strictEqual(explicitTrue, absent, 'explicit true vs. absent must be a byte-identical no-op');
    assert.ok(explicitTrue.includes('/api/proxy/issues/'), 'raw issue detail stays available for a full-capability provider');
  });
});
