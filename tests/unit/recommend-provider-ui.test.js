/**
 * LIN-2045 — the recommend / recommend-stream routes shape a foreign-source
 * row's prompt with the ACTIVE provider's capabilities instead of the
 * resolved row's own provider. Sibling of LIN-1913, which closed the same
 * defect class on the `/api/prompt` route; this is the recommend-path half
 * LIN-1913's own description routed away (to LIN-1910, which fixed the
 * *context* half but left the three `providerUi` reads on the active binding).
 *
 * Three sites in routes/workspace-api.js currently read
 * `getProviderForWorkspace(workspace)?.ui` (the workspace's ACTIVE provider)
 * instead of `issueProvider.ui` (the row's OWN resolved binding):
 *   1. `:908`  — GET /api/recommend/:issueId (non-streaming)
 *   2. `:1259` — GET /api/recommend/:issueId/stream, descent hop
 *   3. `:1348` — GET /api/recommend/:issueId/stream, terminal leaf hop
 *
 * Why a ROUTE-level test and not a direct `getRecommendation(...)` call: a
 * test that hand-constructs the call with `providerUi: JIRA_UI` would pass
 * identically before and after the fix — it only proves the already-correct
 * formatter, never the route's *choice* of which `providerUi` object to pass.
 * This mounts the real routes with two registered providers (an `active` one
 * and a `jira-fake` one), requests a `jira-fake`-sourced row via `?source=`,
 * and asserts on the outbound OpenRouter meta-prompt — captured at the fetch
 * boundary via `setFetchImpl` (LIN-1848 seam) — that it carries the FOREIGN
 * binding's `displayName` ('Jira'), not the active binding's ('Local').
 *
 * `applyPromptCapabilities` (lib/prompt-formatters.js) renames every literal
 * "Linear" in the meta-prompt to `caps.displayName` when `caps.write` is true
 * and `caps.displayName !== 'Linear'` — so the wrong `providerUi` object
 * produces a captured prompt naming the ACTIVE provider ('Local'), and the
 * correct one names the row's own foreign provider ('Jira'). That word swap
 * IS the observable this ticket's fix flips.
 *
 * Site 1 always exercises `getRecommendation` (proxy-independent — see
 * lib/openrouter.js's `resolveOpenRouterFetch`, which checks the injected
 * `setFetchImpl` override before any proxy branch). Sites 2/3 are reached via
 * `getRecommendationStream`, whose own internal branch depends on whether the
 * fetched context has children: a leaf context (children: []) takes the
 * terminal-hop branch (site 3, :1348); a context with children takes the
 * descent branch through `resolveRecommendation`'s `computeOne` (site 2,
 * :1259). Both are parameterized over proxy-on/off (LIN-1848 close-out F3),
 * since a configured proxy reroutes `getRecommendationStream` through
 * `getRecommendation`'s own meta-prompt build — a second real code path, not
 * a fallback to skip — mirroring tests/unit/recommend-stream-attachments.test.js's
 * exact meta-prompt-capture technique.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { guardNetwork } from '../fixtures/network-guard.js';

before(() => { process.env.NODE_ENV = 'test'; });

const ACTIVE_PROVIDER = 'recommend-ui-active';
const JIRA_PROVIDER = 'recommend-ui-jira-fake';

// A LEAF context (children: []) — the stream route's terminal-hop branch
// (site 3, :1348). Also used for the non-streaming GET (site 1, :908), whose
// resolveRecommendation-driven descent takes a single hop regardless of
// children, since the canned LLM reply below is never a `defer`.
const LEAF_ISSUE = {
  id: 'jira-leaf-1', identifier: 'JIRA-1', title: 'Leaf task needing a recommendation',
  description: 'Body.', state: { name: 'Todo', type: 'unstarted' }, labels: [],
  createdAt: '2026-06-01T00:00:00.000Z',
};
const LEAF_CONTEXT = {
  issue: LEAF_ISSUE, parent: null, siblings: [], project: null,
  children: [], comments: [], focusedChild: null, attachments: [],
};

// A CONTAINER context (children non-empty) — the stream route's descent
// branch through resolveRecommendation/computeOne (site 2, :1259).
const PARENT_ISSUE = {
  id: 'jira-parent-1', identifier: 'JIRA-2', title: 'Parent task with an open child',
  description: 'Body.', state: { name: 'Todo', type: 'unstarted' }, labels: [],
  createdAt: '2026-06-01T00:00:00.000Z',
};
const PARENT_CONTEXT = {
  issue: PARENT_ISSUE, parent: null, siblings: [], project: null,
  children: [{ id: 'jira-child-1', identifier: 'JIRA-3', state: { type: 'unstarted' } }],
  comments: [], focusedChild: null, attachments: [],
};

const CONTEXTS_BY_ID = { [LEAF_ISSUE.id]: LEAF_CONTEXT, [PARENT_ISSUE.id]: PARENT_CONTEXT };

/**
 * Register a fake provider under a unique name. Both the active and the
 * jira-fake provider get a WORKING fetchRecommendationContext (per the plan:
 * "each with a working fetchRecommendationContext") even though, with
 * `?source=jira-fake` on every request below, `resolveIssueBinding` always
 * resolves the jira-fake binding for context — LIN-1910 already fixed that
 * half. Only `.ui` differs meaningfully between the two: that's the one
 * thing this ticket's fix changes which provider it's read from.
 */
function registerFakeProvider(name, displayName) {
  registerProvider({
    name,
    ui: { write: true, comments: true, estimates: true, subtasks: true, displayName },
    supports: () => true,
    async fetchRecommendationContext(_scope, issueId) {
      const ctx = CONTEXTS_BY_ID[issueId];
      if (!ctx) throw new Error(`Issue not found: ${issueId}`);
      return ctx;
    },
  });
  return name;
}

/** Two-binding workspace: `active` is the workspace's active provider; `jira-fake` is a foreign binding. */
function buildWorkspace() {
  return {
    urlKey: 'acme',
    provider: ACTIVE_PROVIDER,
    accessToken: 'active-token',
    bindings: [
      { provider: ACTIVE_PROVIDER, scope: 'active-scope', credentials: { token: 'active-token' } },
      { provider: JIRA_PROVIDER, scope: 'jira-scope', credentials: { token: 'jira-token' } },
    ],
  };
}

function buildApp(workspace) {
  const app = express();
  app.use(express.json());
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = workspace;
      // accessToken !== 'test-token' and provider !== 'local' → shouldMockAi()
      // is false, so the route reaches the real getRecommendation(Stream) call
      // whose providerUi wiring is under test (not the AI mock short-circuit).
      // A session OpenRouter key makes isRecommendationEnabled() true and is
      // the apiKey threaded through.
      req.session = { openRouterApiKey: 'sk-test', features: {} };
      next();
    },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
  });
  app.use(router);
  return app;
}

function mockStreamResponse(pieces) {
  const enc = new TextEncoder();
  const fullText = pieces.join('');
  const blocks = pieces.map(p =>
    `data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`
  );
  blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 12 } })}\n\n`);
  blocks.push('data: [DONE]\n\n');
  return {
    ok: true,
    body: (async function* () { for (const b of blocks) yield enc.encode(b); })(),
    json: () => Promise.resolve({ choices: [{ message: { content: fullText }, finish_reason: 'stop' }], usage: { completion_tokens: 12 } }),
  };
}

const CANNED_REPLY = '## Reasoning\n**Assessment:**\n- Preparation: ✓ Complete - ready\n- Blockers: ✓ None - none\n- Ready: ✓ Yes - ready\n→ **implement**\n**Next:** Ship it.\n## Prompt\nDo the thing in Linear.';

async function getJson(app, path) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(r => server.close(r));
  }
}

async function streamRecommend(app, urlKey, issueId, query = '') {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const qs = query ? `?${query}` : '';
    const res = await fetch(`http://127.0.0.1:${port}/workspace/${urlKey}/api/recommend/${issueId}/stream${qs}`);
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    await new Promise(r => server.close(r));
  }
}

describe('LIN-2045 — recommend/recommend-stream must read providerUi from the resolved row binding, not the active provider', () => {
  let networkGuard;

  beforeEach(() => {
    registerFakeProvider(ACTIVE_PROVIDER, 'Local');
    registerFakeProvider(JIRA_PROVIDER, 'Jira');
    networkGuard = guardNetwork();
  });

  afterEach(() => {
    setFetchImpl(null);
    networkGuard.restore();
    assert.equal(networkGuard.attempts.length, 0, `unexpected http(s).request transport attempts: ${JSON.stringify(networkGuard.attempts)}`);
  });

  describe('site 1 — GET /api/recommend/:issueId (non-streaming, :908)', () => {
    test('a jira-fake-sourced row is shaped with the Jira displayName, not the active Local one', async () => {
      let capturedMetaPrompt = null;
      const openRouterMock = async (url, opts = {}) => {
        assert.ok(typeof url === 'string' && url.includes('openrouter.ai'), `unexpected fetch target: ${url}`);
        capturedMetaPrompt = JSON.parse(opts.body).messages[0].content;
        return mockStreamResponse([CANNED_REPLY]);
      };
      setFetchImpl(openRouterMock);

      const app = buildApp(buildWorkspace());
      const { status, body } = await getJson(app, `/workspace/acme/api/recommend/${LEAF_ISSUE.id}?source=${JIRA_PROVIDER}`);

      assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(capturedMetaPrompt, 'the route must have issued an OpenRouter request carrying a meta-prompt');
      assert.ok(
        capturedMetaPrompt.includes('Jira'),
        'the meta-prompt for a Jira-sourced row must carry the Jira displayName'
      );
      assert.ok(
        !capturedMetaPrompt.includes('Local'),
        'the meta-prompt for a Jira-sourced row must NOT carry the active workspace provider\'s displayName (Local)'
      );
    });
  });

  for (const proxyOn of [false, true]) {
    const label = proxyOn
      ? 'with HTTPS_PROXY set (getRecommendation fallback path)'
      : 'with no proxy configured (getRecommendationStream streaming path)';

    describe(`sites 2 & 3 — GET /api/recommend/:issueId/stream — ${label}`, () => {
      let savedProxyEnv;

      beforeEach(() => {
        savedProxyEnv = {
          HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
          https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy,
        };
        if (proxyOn) {
          process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
        } else {
          delete process.env.HTTPS_PROXY;
        }
        delete process.env.HTTP_PROXY; delete process.env.https_proxy; delete process.env.http_proxy;
      });

      afterEach(() => {
        for (const [k, v] of Object.entries(savedProxyEnv)) {
          if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
      });

      test('site 3 — a leaf jira-fake-sourced row (terminal hop, :1348) is shaped with Jira, not Local', async () => {
        let capturedMetaPrompt = null;
        const openRouterMock = async (url, opts = {}) => {
          if (typeof url === 'string' && url.includes('openrouter.ai')) {
            capturedMetaPrompt = JSON.parse(opts.body).messages[0].content;
            return mockStreamResponse([CANNED_REPLY]);
          }
          throw new Error(`unexpected fetch target: ${url}`);
        };
        setFetchImpl(openRouterMock);

        const app = buildApp(buildWorkspace());
        const res = await streamRecommend(app, 'acme', LEAF_ISSUE.id, `source=${JIRA_PROVIDER}`);

        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.text}`);
        assert.ok(capturedMetaPrompt, 'the route must have issued an OpenRouter request carrying a meta-prompt');
        assert.ok(capturedMetaPrompt.includes('Jira'), 'the leaf-hop meta-prompt must carry the Jira displayName');
        assert.ok(!capturedMetaPrompt.includes('Local'), 'the leaf-hop meta-prompt must NOT carry the active provider\'s displayName (Local)');
      });

      test('site 2 — a container jira-fake-sourced row (descent hop, :1259) is shaped with Jira, not Local', async () => {
        let capturedMetaPrompt = null;
        const openRouterMock = async (url, opts = {}) => {
          if (typeof url === 'string' && url.includes('openrouter.ai')) {
            capturedMetaPrompt = JSON.parse(opts.body).messages[0].content;
            return mockStreamResponse([CANNED_REPLY]);
          }
          throw new Error(`unexpected fetch target: ${url}`);
        };
        setFetchImpl(openRouterMock);

        const app = buildApp(buildWorkspace());
        const res = await streamRecommend(app, 'acme', PARENT_ISSUE.id, `source=${JIRA_PROVIDER}`);

        assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.text}`);
        assert.ok(capturedMetaPrompt, 'the route must have issued an OpenRouter request carrying a meta-prompt');
        assert.ok(capturedMetaPrompt.includes('Jira'), 'the descent-hop meta-prompt must carry the Jira displayName');
        assert.ok(!capturedMetaPrompt.includes('Local'), 'the descent-hop meta-prompt must NOT carry the active provider\'s displayName (Local)');
      });
    });
  }
});
