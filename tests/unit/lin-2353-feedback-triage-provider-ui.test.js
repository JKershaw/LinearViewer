/**
 * LIN-2353 — `enqueueFeedbackTriage` (routes/workspace-api.js:2862) is a
 * dispatch-queue producer, not an in-app render: it calls `generatePrompt(...)`
 * with no `featureFlags`/`providerUi` arguments at all, so every triage prompt
 * it queues was shaped with the DEFAULT_PROMPT_UI floor (displayName 'Linear')
 * regardless of the workspace's actual provider. This pins the fix: the site
 * now passes `{}` for featureFlags (so the positional providerUi arg lands
 * correctly) and `getProviderForWorkspace(workspace)?.ui || null` for
 * providerUi.
 *
 * Modeled on tests/unit/feedback-route.test.js's harness (the route this
 * function is reached through, POST /workspace/:urlKey/api/feedback with
 * `action: 'triage'`), with a GitHub-shaped fake provider substituted so the
 * queued dispatch item's prompt can be inspected for the displayName swap.
 * The existing feature-flag-gated enqueue behaviour (triage only when
 * `action === 'triage'` or the `feedbackTriage` flag is on) is untouched by
 * this fix and is covered by feedback-route.test.js — not re-asserted here.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const PROVIDER_NAME = 'lin2353-feedback-github-fake';

function makeGithubShapedProvider() {
  return makeProvider(PROVIDER_NAME, { write: true, comments: true, estimates: false, subtasks: false, displayName: 'GitHub Issues' });
}

/**
 * LIN-2353 close-out (implementation-review ledger item 4): sites 1-3 each got a
 * Linear parity case, but this site (#5) originally had only the GitHub case plus
 * the flag-gate case — no Linear-side and no bare-fixture counterpart. `ui`
 * omitted entirely reproduces the pre-fix path exactly: `getProviderForWorkspace(
 * workspace)?.ui || null` -> null -> DEFAULT_PROMPT_UI.
 */
function makeProvider(name, ui) {
  return {
    name,
    ...(ui ? { ui } : {}),
    supports: () => true,
    apiWriteFields: () => ['title', 'description', 'projectId'],
    async fetchTeams() { return [{ id: 'team-default', name: 'Default' }]; },
    async createIssue(token, input) {
      return { success: true, issue: { id: 'iss-1', identifier: 'GH-900', title: input.title, url: 'https://github.com/acme/repo/issues/900', state: { name: 'Todo', type: 'unstarted' } } };
    }
  };
}

const LINEAR_SHAPED_NAME = 'lin2353-feedback-linear-fake';
const BARE_NAME = 'lin2353-feedback-bare-fake';
// Identical on every key resolvePromptUi/applyPromptCapabilities reads, matching
// the real registered Linear provider's ui (verified in the implementation review).
const LINEAR_SHAPED_UI = { write: true, comments: true, estimates: true, subtasks: true, displayName: 'Linear' };

function fakeProxyTokenStore(token = 'minted-rw-token') {
  return { async createToken(urlKey, options) { return { token, scope: options?.scope }; } };
}

function capturingDispatchStore() {
  const items = [];
  return { items, addItem: async (urlKey, item) => { items.push({ urlKey, item }); return { _id: 'd1', ...item }; } };
}

function buildApp({ provider, dispatchQueueStore, features = {} }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: provider.name, accessToken: 'ws-token' };
      req.session = { linearUserId: 'user-1', features };
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

async function submit(app, urlKey, payload) {
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

describe('LIN-2353 — enqueueFeedbackTriage (workspace-api.js:2862) threads provider?.ui into the queued dispatch prompt', () => {
  test('a github-backed workspace queues a triage prompt shaped with GitHub Issues, not Linear', async () => {
    const provider = makeGithubShapedProvider();
    const dispatch = capturingDispatchStore();
    const app = buildApp({ provider, dispatchQueueStore: dispatch, features: { feedbackTriage: true } });

    const { status } = await submit(app, 'acme', { message: 'Something is broken' });

    assert.strictEqual(status, 201);
    assert.strictEqual(dispatch.items.length, 1);
    const { prompt } = dispatch.items[0].item;
    // The queued prompt is `generatePrompt(...)`'s body PLUS an unconditionally
    // appended proxy-context preamble (attachProxyContext, lib/proxy-preamble.js)
    // whose own "backed by Linear" line is a distinct, hand-built prose surface —
    // out of THIS ticket's scope (see LIN-2354). Scope the assertion to the body
    // this fix actually shapes, not the preamble appended after it.
    const body = prompt.split('You have a workspace API proxy')[0];
    assert.match(body, /Triage/);
    assert.ok(body.includes('GitHub Issues'), 'must render the GitHub displayName');
    assert.ok(!body.includes('Linear'), 'must carry no literal "Linear" in the generated body');
  });

  test('the existing feature-flag gate is untouched: triage is not enqueued with the flag off and no explicit action', async () => {
    const provider = makeGithubShapedProvider();
    const dispatch = capturingDispatchStore();
    const app = buildApp({ provider, dispatchQueueStore: dispatch, features: {} });

    const { status } = await submit(app, 'acme', { message: 'Something is broken' });

    assert.strictEqual(status, 201);
    assert.strictEqual(dispatch.items.length, 0, 'triage is opt-in — no flag, no explicit action, nothing enqueued');
  });

  // --- LIN-2353 close-out, ledger item 4: the missing Linear + bare-fixture pair ---

  test('a linear-shaped workspace still renders Linear in the queued triage prompt', async () => {
    const dispatch = capturingDispatchStore();
    const app = buildApp({
      provider: makeProvider(LINEAR_SHAPED_NAME, LINEAR_SHAPED_UI),
      dispatchQueueStore: dispatch,
      features: { feedbackTriage: true }
    });

    const { status } = await submit(app, 'acme', { message: 'Something is broken' });

    assert.strictEqual(status, 201);
    assert.strictEqual(dispatch.items.length, 1);
    const body = dispatch.items[0].item.prompt.split('You have a workspace API proxy')[0];
    assert.match(body, /Triage/);
    assert.ok(body.includes('Linear'), 'a Linear workspace must still say Linear');
    assert.ok(!body.includes('GitHub Issues'), 'no other tracker name may leak in');
  });

  test('byte parity: a linear-shaped provider queues the same bytes as the DEFAULT_PROMPT_UI fallback', async () => {
    async function queuedPrompt(provider) {
      const dispatch = capturingDispatchStore();
      const app = buildApp({ provider, dispatchQueueStore: dispatch, features: { feedbackTriage: true } });
      const { status } = await submit(app, 'acme', { message: 'Something is broken' });
      assert.strictEqual(status, 201);
      assert.strictEqual(dispatch.items.length, 1);
      return dispatch.items[0].item.prompt;
    }

    // `ui` threaded (real-Linear-shaped) vs no `ui` at all (the pre-fix fallback).
    const threaded = await queuedPrompt(makeProvider(LINEAR_SHAPED_NAME, LINEAR_SHAPED_UI));
    const fallback = await queuedPrompt(makeProvider(BARE_NAME, null));

    assert.strictEqual(threaded, fallback, 'threading Linear ui must be a no-op for a Linear workspace');

    // Not vacuous: the GitHub shape must genuinely diverge from that same fallback.
    const github = await queuedPrompt(makeGithubShapedProvider());
    assert.notStrictEqual(github, fallback, 'if these matched, the parity assertion would prove nothing');
  });
});
