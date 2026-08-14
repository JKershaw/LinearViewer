/**
 * LIN-777 — route/meta-level regression: the LLM recommendation paths must forward
 * `context.attachments` into getRecommendation/getRecommendationStream so the
 * worker-facing `## Attachments` section is surfaced in the META-PROMPT sent to the
 * model. This is the sibling of LIN-776, which closed the same class on the
 * deterministic generatePrompt paths.
 *
 * Why a ROUTE/META test and not a library test: the existing both-paths PARITY
 * tests pass `context` (with attachments) DIRECTLY into the library seam, so they
 * prove formatAttachmentsSection, not the route wiring. The bug lived purely in the
 * route layer — the handlers destructured `context` then rebuilt a reduced object
 * that DROPPED `attachments` before calling the recommendation helpers. To catch
 * that, this test drives the in-app streaming recommendation route end to end
 *   GET /workspace/:urlKey/api/recommend/:issueId/stream
 * through a fake provider whose fetchRecommendationContext carries top-level
 * attachments (mirroring LIN-772/773), and asserts the META-PROMPT the route hands
 * the model (captured at the OpenRouter fetch boundary) contains `## Attachments`.
 *
 * getRecommendationStream issues its request through native `global.fetch` (only
 * the non-stream getRecommendation uses the import-bound customFetch), so mocking
 * global.fetch captures the request body — i.e. the meta-prompt — directly. The
 * fixture is a LEAF (children: []), so the route takes the terminal
 * getRecommendationStream branch (routes/workspace-api.js) — the LIN-777 site.
 * Without the destructure fix this fails even though the provider supplies
 * attachments, so it guards exactly the regression.
 */
process.env.NODE_ENV = 'test';

import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { guardNetwork } from '../fixtures/network-guard.js';

const PROVIDER_NAME = 'recommend-stream-fake';

// A leaf context that carries top-level `attachments` exactly as
// fetchRecommendationContext does post-LIN-772/773. Each attachment needs an `id`
// (formatAttachmentsSection filters on it); the title anchors the assertion on the
// real collector output, not an empty header.
function buildContext() {
  return {
    issue: {
      id: 'iss-748',
      identifier: 'LIN-748',
      title: 'Task with inline uploads',
      description: 'Body referencing screenshots.',
      state: { name: 'Todo', type: 'unstarted' },
      labels: [],
      createdAt: '2026-06-01T00:00:00.000Z'
    },
    parent: null,
    siblings: [],
    project: null,
    children: [],
    comments: [],
    focusedChild: null,
    attachments: [
      { id: 'att-abc123', title: 'Screenshot', kind: 'image', contentType: 'image/png' }
    ]
  };
}

function makeFakeProvider(context) {
  return {
    name: PROVIDER_NAME,
    // Linear-equivalent capability floor → the capability post-pass is a no-op,
    // matching how a real Linear workspace would render the section.
    ui: { write: true, comments: true, estimates: true, subtasks: true, displayName: 'Linear' },
    supports: () => true,
    async fetchRecommendationContext() {
      return context;
    }
  };
}

// Minimal OpenRouter streaming response, modelled on openrouter.test.js's
// mockStreamResponse: an async-iterable body of SSE chunks the stream parser reads.
//
// LIN-1848: also usable as the NON-streaming shape (json()) — under HTTPS_PROXY
// getRecommendationStream's useStreaming flips false and it falls through to
// getRecommendation(), which reads response.json() instead of .body. One canned
// response must satisfy either branch so this test proves the fix regardless
// of which branch a proxy env selects.
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
    json: () => Promise.resolve({ choices: [{ message: { content: fullText }, finish_reason: 'stop' }], usage: { completion_tokens: 12 } })
  };
}

function buildApp(context) {
  registerProvider(makeFakeProvider(context));
  const app = express();
  app.use(express.json());
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      // accessToken !== 'test-token' and provider !== 'local' → neither the DATA
      // mock (isTestMode) nor the AI mock (mockAi) fire, so the route reaches the
      // real getRecommendationStream call whose wiring is under test.
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token' };
      // A session OpenRouter key makes isRecommendationEnabled true and is the
      // apiKey threaded into getRecommendationStream.
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
    agentStatusStore: {},
    promptTraceStore: {}
  });
  app.use(router);
  return app;
}

// Drive the SSE route and drain the body so the handler runs to completion.
async function streamRecommend(app, urlKey, issueId) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/${urlKey}/api/recommend/${issueId}/stream`);
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    await new Promise(r => server.close(r));
  }
}

// LIN-1848 close-out F3: this suite is parameterized over BOTH proxy states
// rather than pinned to proxy-set only. Forcing HTTPS_PROXY unconditionally
// (the original LIN-1848 fix) flips getRecommendationStream's `useStreaming`
// flag false, falling the request through to getRecommendation() — whose
// OWN meta-prompt build (openrouter.js's getRecommendation, ~:1774) served
// the captured request body instead of getRecommendationStream's streaming
// meta-prompt build (~:959), the actual LIN-777 site this test is named for
// and was written to guard. Running both conditions keeps that LIN-777
// regression coverage on the real streaming code path AND retains the
// LIN-1848 proxy-hermeticity proof on the non-streaming fallback path — a
// regression in either meta-prompt build now fails a test again.
for (const proxyOn of [false, true]) {
  const label = proxyOn
    ? 'with HTTPS_PROXY set (getRecommendation fallback path, LIN-1848 hermeticity)'
    : 'with no proxy configured (getRecommendationStream streaming path, LIN-777 original coverage)';

  describe(`LIN-777 — LLM streaming recommendation surfaces ## Attachments in the meta-prompt — ${label}`, () => {
    let originalFetch;
    let networkGuard;
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
      networkGuard = guardNetwork();
    });

    afterEach(() => {
      if (originalFetch) global.fetch = originalFetch;
      originalFetch = undefined;
      setFetchImpl(null);
      networkGuard.restore();
      for (const [k, v] of Object.entries(savedProxyEnv)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      assert.equal(networkGuard.attempts.length, 0, `unexpected http(s).request transport attempts: ${JSON.stringify(networkGuard.attempts)}`);
    });

    test('GET /api/recommend/:id/stream sends a meta-prompt containing the Attachments section', async () => {
      originalFetch = global.fetch;

      let capturedMetaPrompt = null;
      // getRecommendationStream posts to OpenRouter via native global.fetch (or,
      // under a proxy, getRecommendation's resolved transport — see above);
      // capture the meta-prompt from the request body either way, then return a
      // valid response. The test client also drives the express server through
      // fetch, so delegate every non-OpenRouter request to the real fetch.
      const openRouterMock = async (url, opts = {}) => {
        if (typeof url === 'string' && url.includes('openrouter.ai')) {
          capturedMetaPrompt = JSON.parse(opts.body).messages[0].content;
          return mockStreamResponse(['## Reasoning\n→ **research**\nLook into it.\n## Prompt\nDo the thing.']);
        }
        return originalFetch(url, opts);
      };
      global.fetch = openRouterMock;
      setFetchImpl(openRouterMock);

      const app = buildApp(buildContext());
      const res = await streamRecommend(app, 'acme', 'iss-748');

      assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.text}`);
      assert.ok(capturedMetaPrompt, 'the route must have issued an OpenRouter request carrying a meta-prompt');
      assert.ok(
        capturedMetaPrompt.includes('## Attachments'),
        'the LLM streaming recommendation meta-prompt must render the ## Attachments section when the context has attachments'
      );
      // Anchor on the fixture attachment so the assertion proves the real collector
      // output flowed through the route wiring, not an empty header.
      assert.ok(
        capturedMetaPrompt.includes('Screenshot') && capturedMetaPrompt.includes('att-abc123'),
        'the rendered Attachments section must list the fixture attachment (title + opaque handle)'
      );
    });
  });
}
