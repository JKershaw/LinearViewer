/**
 * LIN-2353 — the shared LLM recommendation path (`computeRecommendation` in
 * routes/proxy.js, backing GET /api/proxy/recommend/:identifier with no
 * ?kind= override) called `getRecommendation(...)` with no `providerUi`, so
 * every worker-facing AI-generated dispatch prompt was shaped with the
 * DEFAULT_PROMPT_UI floor (displayName 'Linear') regardless of the resolved
 * workspace's actual provider. This pins the fix: `provider?.ui || null` is
 * now threaded into `getRecommendation`'s options.
 *
 * Follows the established fetch-boundary capture technique from
 * tests/unit/recommend-provider-ui.test.js (LIN-2045, the workspace-api.js
 * sibling of this same defect class): a hand-constructed direct
 * `getRecommendation(..., {providerUi: ...})` call would pass identically
 * before and after the fix — it only proves the already-correct formatter,
 * never the ROUTE's choice of which providerUi object to pass. Instead this
 * mounts the real routes/proxy.js GET /recommend route with a registered fake
 * provider, and asserts on the outbound OpenRouter meta-prompt — captured at
 * the fetch boundary via `setFetchImpl` (LIN-1848 seam) — that it carries the
 * resolved provider's displayName, not the DEFAULT_PROMPT_UI 'Linear' floor.
 */
process.env.NODE_ENV = 'test';

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setFetchImpl } from '../../lib/openrouter.js';
import { guardNetwork } from '../fixtures/network-guard.js';

before(() => { process.env.NODE_ENV = 'test'; });

const FAKE_PROVIDER = 'lin2353-recommend-fake';

// A leaf context (no children) — a single computeRecommendation hop, no
// descent, so the canned LLM reply below need not carry a `defer`.
const LEAF_ISSUE = {
  id: 'gh-leaf-1', identifier: 'GH-1', title: 'Leaf task needing a recommendation',
  description: 'Body.', state: { name: 'Todo', type: 'unstarted' }, labels: [],
  createdAt: '2026-06-01T00:00:00.000Z',
};
const LEAF_CONTEXT = {
  issue: LEAF_ISSUE, parent: null, siblings: [], project: null,
  children: [], comments: [], focusedChild: null, attachments: [],
};

function registerFakeProvider() {
  registerProvider({
    name: FAKE_PROVIDER,
    ui: { write: true, comments: true, estimates: false, subtasks: false, displayName: 'GitHub Issues' },
    supports: () => true,
    async fetchRecommendationContext(_scope, issueId) {
      if (issueId !== LEAF_ISSUE.id) throw new Error(`Issue not found: ${issueId}`);
      return LEAF_CONTEXT;
    },
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' })
    },
    proxyEventStore: { recordEvent: async () => {} },
    // accessToken deliberately NOT 'test-token' so isTestMode is false and the
    // route reaches the real computeRecommendation -> getRecommendation path.
    resolveWorkspaceAccess: async () => ({ token: 'live-access-token', reason: 'ok', provider: FAKE_PROVIDER }),
    getWorkspaceAccessToken: async () => 'live-access-token',
    getWorkspaceOpenRouterKey: async () => 'sk-test-key',
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem: async () => ({ _id: 'disp-1' }) },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer anything' } });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
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

const CANNED_REPLY = '## Reasoning\n**Assessment:**\n- Preparation: ✓ Complete - ready\n- Blockers: ✓ None - none\n- Ready: ✓ Yes - ready\n→ **implement**\n**Next:** Ship it.\n## Prompt\nDo the thing.';

describe('LIN-2353 — GET /api/proxy/recommend threads provider?.ui into the shared LLM path (computeRecommendation)', () => {
  test('a fake-provider-sourced issue is shaped with its own displayName, not the DEFAULT_PROMPT_UI Linear floor', async () => {
    registerFakeProvider();
    const networkGuard = guardNetwork();
    let capturedMetaPrompt = null;
    const openRouterMock = async (url, opts = {}) => {
      assert.ok(typeof url === 'string' && url.includes('openrouter.ai'), `unexpected fetch target: ${url}`);
      capturedMetaPrompt = JSON.parse(opts.body).messages[0].content;
      return mockStreamResponse([CANNED_REPLY]);
    };
    setFetchImpl(openRouterMock);
    try {
      const app = buildApp();
      const { status, body } = await call(app, `/api/proxy/issues/${LEAF_ISSUE.id}/recommend`);

      assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
      assert.ok(capturedMetaPrompt, 'the route must have issued an OpenRouter request carrying a meta-prompt');
      assert.ok(
        capturedMetaPrompt.includes('GitHub Issues'),
        'the meta-prompt must carry the resolved provider\'s displayName'
      );
      assert.ok(
        !capturedMetaPrompt.includes('Linear'),
        'the meta-prompt must NOT carry the DEFAULT_PROMPT_UI Linear floor'
      );
    } finally {
      setFetchImpl(null);
      networkGuard.restore();
      assert.equal(networkGuard.attempts.length, 0, `unexpected http(s).request transport attempts: ${JSON.stringify(networkGuard.attempts)}`);
    }
  });
});
