/**
 * LIN-2354 close-out — F1 discharge.
 *
 * The session-lane provider-identity reads (`routes/dispatch.js:475`,
 * `routes/workspace-api.js:2906`/`:2983`, `routes/collective.js:273`) must use
 * the fallback-free `getProvider(workspace.provider)`, never
 * `getProviderForWorkspace(workspace)` — that helper's `LEGACY_DEFAULT_PROVIDER`
 * fallback (registry.js:88-90) resolves an undeclared workspace to Linear,
 * which would silently reintroduce this ticket's exact defect: a legacy
 * workspace with no `provider` field told "currently backed by Linear" in
 * every dispatched prompt.
 *
 * The review's mutation M4 (swap `getProvider` -> `getProviderForWorkspace` at
 * all four session-lane sites) left the full unit suite green — every existing
 * test drives these routes with a workspace.provider set to a registered name,
 * so the fallback branch was never exercised. This file is the discharge: a
 * workspace object with NO `provider` field, driven through the dispatch,
 * feedback-triage, feedback-autopilot, and collective lanes, asserting the
 * "currently backed by X" clause is OMITTED — never guessed as "Linear" —
 * while a workspace with an explicitly declared (non-Linear) provider keeps
 * naming it, so these tests pin the omit-when-unresolved behaviour rather than
 * merely asserting "no block ever renders".
 *
 * A provider is registered under the literal name 'linear' below because
 * `getProviderForWorkspace`'s fallback key is that exact string
 * (registry.js's LEGACY_DEFAULT_PROVIDER). Without it registered in this
 * file's process, the M4 mutation would resolve to `undefined` instead of
 * "Linear" and these tests would pass for the wrong reason on both sides of
 * the mutation — registering it here (rather than relying on an incidental
 * self-registering import elsewhere) makes the guarded property actually
 * observable.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createCollectiveRoutes } from '../../routes/collective.js';
import { registerProvider } from '../../lib/providers/registry.js';

function makeProvider(name, ui) {
  return {
    name,
    ...(ui ? { ui } : {}),
    supports: () => true,
    apiWriteFields: () => ['title', 'description', 'projectId'],
    async fetchTeams() { return [{ id: 'team-default', name: 'Default' }]; },
    async createIssue(token, input) {
      return {
        success: true,
        issue: {
          id: 'iss-1',
          identifier: 'GH-900',
          title: input.title,
          url: 'https://example.test/issues/900',
          state: { name: 'Todo', type: 'unstarted' }
        }
      };
    }
  };
}

const LINEAR_UI = { write: true, comments: true, estimates: true, subtasks: true, displayName: 'Linear' };
const GITHUB_UI = { write: true, comments: true, estimates: false, subtasks: false, displayName: 'GitHub Issues' };
const DECLARED_NAME = 'lin2354-session-lane-github-fake';

registerProvider(makeProvider('linear', LINEAR_UI));
registerProvider(makeProvider(DECLARED_NAME, GITHUB_UI));

function fakeProxyTokenStore(token = 'minted-rw-token') {
  return { async createToken(urlKey, options) { return { token, kind: 'bootstrap', scope: options?.scope || 'readWrite' }; } };
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch (_) { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function assertNeverGuessesLinear(text, label) {
  assert.ok(!text.includes('currently backed by'), `${label}: must omit the "currently backed by" clause for an undeclared provider`);
  assert.ok(!text.includes('Linear'), `${label}: must never guess "Linear" for an undeclared provider`);
}

// ---------------------------------------------------------------------------
// Lane 1 — routes/dispatch.js:475 (UI dispatch, attachProxy:true)
// ---------------------------------------------------------------------------

describe('LIN-2354 F1 — dispatch lane (routes/dispatch.js)', () => {
  function buildApp(workspace) {
    const captured = {};
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: {
        addItem: async (urlKey, item) => { captured.item = item; return { _id: 'd1', dispatchedAt: '2026-08-29T00:00:00.000Z', ...item }; }
      },
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => { req.workspace = workspace; req.session = { linearUserId: 'u1' }; next(); },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null,
      proxyTokenStore: fakeProxyTokenStore()
    }));
    return { app, captured };
  }

  test('workspace with NO provider field: the queued prompt never claims Linear', async () => {
    const { app, captured } = buildApp({ urlKey: 'acme' }); // no `provider` key at all
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item.prompt.includes('## Workspace API access (auto-appended)'), 'sanity: the block was actually appended');
    assertNeverGuessesLinear(captured.item.prompt, 'dispatch lane, no provider field');
  });

  test('workspace with an explicitly declared non-Linear provider still names it (preserved behaviour)', async () => {
    const { app, captured } = buildApp({ urlKey: 'acme', provider: DECLARED_NAME });
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', {
      prompt: 'do the thing', issueIdentifier: 'LIN-42', harness: 'claude-code', attachProxy: true
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(captured.item.prompt.includes('currently backed by GitHub Issues'), 'a declared provider must still be named');
  });
});

// ---------------------------------------------------------------------------
// Lane 2 — routes/workspace-api.js (feedback triage :2906 and autopilot :2983)
// ---------------------------------------------------------------------------

describe('LIN-2354 F1 — feedback-triage/autopilot lane (routes/workspace-api.js)', () => {
  function buildApp(workspace) {
    const dispatch = { items: [] };
    const app = express();
    app.use(express.json({ limit: '250kb' }));
    const router = createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => {
        req.workspace = workspace;
        req.session = { linearUserId: 'user-1', features: { feedbackTriage: true } };
        next();
      },
      dispatchQueueStore: { addItem: async (urlKey, item) => { dispatch.items.push({ urlKey, item }); return { _id: 'd1', ...item }; } },
      proxyTokenStore: fakeProxyTokenStore(),
      freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      customPromptsStore: {}, recapCacheStore: {},
      briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {}
    });
    app.use(router);
    return { app, dispatch };
  }

  test('triage: workspace with NO provider field never claims Linear in the queued preamble', async () => {
    const { app, dispatch } = buildApp({ urlKey: 'acme', accessToken: 'ws-token' }); // no `provider`
    const res = await call(app, 'post', '/workspace/acme/api/feedback', { message: 'Something is broken', action: 'triage' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(dispatch.items.length, 1);
    const { prompt } = dispatch.items[0].item;
    const preamble = prompt.split('## Workspace API access (auto-appended)')[1];
    assert.ok(preamble, 'sanity: the proxy-context block was actually appended');
    assertNeverGuessesLinear(preamble, 'feedback-triage, no provider field');
  });

  test('triage: workspace with an explicitly declared non-Linear provider still names it (preserved behaviour)', async () => {
    const { app, dispatch } = buildApp({ urlKey: 'acme', provider: DECLARED_NAME, accessToken: 'ws-token' });
    const res = await call(app, 'post', '/workspace/acme/api/feedback', { message: 'Something is broken', action: 'triage' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(dispatch.items.length, 1);
    const { prompt } = dispatch.items[0].item;
    assert.ok(prompt.includes('currently backed by GitHub Issues'), 'a declared provider must still be named');
  });

  test('autopilot: workspace with NO provider field never claims Linear in the queued preamble', async () => {
    const { app, dispatch } = buildApp({ urlKey: 'acme', accessToken: 'ws-token' }); // no `provider`
    const res = await call(app, 'post', '/workspace/acme/api/feedback', { message: 'Something is broken', action: 'autopilot' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(dispatch.items.length, 1);
    const { prompt } = dispatch.items[0].item;
    const preamble = prompt.split('## Workspace API access (auto-appended)')[1];
    assert.ok(preamble, 'sanity: the proxy-context block was actually appended');
    assertNeverGuessesLinear(preamble, 'feedback-autopilot, no provider field');
  });

  test('autopilot: workspace with an explicitly declared non-Linear provider still names it (preserved behaviour)', async () => {
    const { app, dispatch } = buildApp({ urlKey: 'acme', provider: DECLARED_NAME, accessToken: 'ws-token' });
    const res = await call(app, 'post', '/workspace/acme/api/feedback', { message: 'Something is broken', action: 'autopilot' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(dispatch.items.length, 1);
    const { prompt } = dispatch.items[0].item;
    assert.ok(prompt.includes('currently backed by GitHub Issues'), 'a declared provider must still be named');
  });
});

// ---------------------------------------------------------------------------
// Lane 3 — routes/collective.js:273 (collective fan-out, prose Linear-access block)
// ---------------------------------------------------------------------------

describe('LIN-2354 F1 — collective lane (routes/collective.js)', () => {
  function buildApp(workspaces) {
    const captured = [];
    const app = express();
    app.use(express.json());
    app.use(createCollectiveRoutes({
      dispatchQueueStore: {
        addItem: async (urlKey, item) => { captured.push({ urlKey, item }); return { _id: `disp-${captured.length}`, ...item }; }
      },
      // A real (non-null) store, unlike the fan-out characterization harness —
      // this test needs the prose Linear-access block to actually render so the
      // providerDisplayName clause it carries can be inspected.
      proxyTokenStore: fakeProxyTokenStore(),
      yapClient: { baseUrl: 'https://yap.test' },
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey };
        req.session = { accountId: 'u1', features: { collective: true }, workspaces };
        next();
      },
    }));
    return { app, captured };
  }

  test('seat workspace with NO provider field: the queued prompt never claims Linear', async () => {
    const { app, captured } = buildApp([{ urlKey: 'acme', name: 'Acme' }]); // no `provider`
    const res = await call(app, 'post', '/workspace/acme/collective/start', {
      channel: '#test-room',
      characters: [{ workspaceUrlKey: 'acme' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { prompt } = captured[0].item;
    assert.ok(prompt.includes('You have a workspace API proxy'), 'sanity: the Linear-access block was actually appended');
    assertNeverGuessesLinear(prompt, 'collective lane, no provider field');
  });

  test('seat workspace with an explicitly declared non-Linear provider still names it (preserved behaviour)', async () => {
    const { app, captured } = buildApp([{ urlKey: 'acme', name: 'Acme', provider: DECLARED_NAME }]);
    const res = await call(app, 'post', '/workspace/acme/collective/start', {
      channel: '#test-room',
      characters: [{ workspaceUrlKey: 'acme' }],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(captured.length, 1);
    const { prompt } = captured[0].item;
    assert.ok(prompt.includes('currently backed by GitHub Issues'), 'a declared provider must still be named');
  });
});
