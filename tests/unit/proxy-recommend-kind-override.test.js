/**
 * LIN-839 — GET /recommend honors a ?kind= override.
 *
 * The shared GET recommend handler (serving both
 *   GET /api/proxy/issues/:identifier/recommend  and
 *   GET /api/proxy/recommend/:identifier)
 * historically ignored req.query.kind: the engine's chosen verb always won, so a
 * consumer that correctly judged the recommended verb wrong had no way to ask for
 * the right-kind grounded prompt and fell back to hand-authoring beats (bypassing
 * the grounding post-passes). This pins the fix:
 *
 *  1. ?kind=implementation returns the implementation-kind grounded prompt
 *     (recommendedAction === 'implementation', override:true) with the grounding
 *     sections present — NOT the LLM-recommended verb.
 *  2. An invalid ?kind=… → clean 400 (validated via hasPrompt / PROMPT_TEMPLATES,
 *     so non-generatable meta-kinds like `defer` are rejected, not 500'd).
 *  3. ?format=md mirrors automatically through the same override branch (markdown
 *     body, not JSON).
 *  4. The override path runs even when AI recommendations are NOT configured and
 *     does not meter free-tier — it makes no LLM call.
 *  5. No ?kind= leaves the default path untouched.
 *
 * Drives the test-mode mock context (token === 'test-token' → TEST-1 fixture).
 * Set NODE_ENV before importing the routes so the test-mode short-circuit and the
 * module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

// `aiConfigured` toggles whether an OpenRouter key is resolvable. The override
// path must work with NO key (it makes no LLM call); the default path 503s.
// `freeTier.tryUse` records whether metering was attempted.
function buildApp({ aiConfigured = false, freeTierCalls } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    // token === 'test-token' drives isTestMode → the mock issue context (TEST-1).
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => (aiConfigured ? 'sk-test-key' : null),
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: { addItem: async () => ({ _id: 'disp-1' }) },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: {
      tryUse: async () => { if (freeTierCalls) freeTierCalls.count++; return { allowed: true }; }
    }
  }));
  return app;
}

async function call(app, path, { accept } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const headers = { Authorization: 'Bearer anything' };
    if (accept) headers.Accept = accept;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed, text, contentType: res.headers.get('content-type') };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-839 — GET /recommend honors ?kind= override', () => {
  test('?kind=implementation returns the requested kind\'s grounded prompt (not the recommended verb)', async () => {
    const app = buildApp();
    const res = await call(app, '/api/proxy/recommend/TEST-1?kind=implementation');

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.recommendedAction, 'implementation',
      'override must pin recommendedAction to the requested kind');
    assert.equal(res.body.kind, 'implementation', 'dispatch kind derives from the override verb');
    assert.equal(res.body.override, true, 'override responses are explicitly flagged');
    assert.ok(typeof res.body.prompt === 'string' && res.body.prompt.length > 0,
      'override returns a generated prompt body');
    // Grounding post-pass preserved: generatePrompt runs appendGroundingSections,
    // so the staleness section the LIN-830 agent lost by hand-authoring is present.
    assert.ok(res.body.prompt.includes('## Re-ground the Ticket (staleness check)'),
      'override prompt must carry the grounding staleness section');
  });

  test('both endpoint forms (canonical + flat alias) honor the override identically', async () => {
    const app = buildApp();
    const canonical = await call(app, '/api/proxy/issues/TEST-1/recommend?kind=implementation');
    const alias = await call(app, '/api/proxy/recommend/TEST-1?kind=implementation');
    assert.equal(canonical.status, 200);
    assert.equal(alias.status, 200);
    assert.deepEqual(canonical.body, alias.body, 'one shared handler → identical override payloads');
  });

  test('invalid ?kind= → clean 400 (non-generatable meta-kind rejected, not 500)', async () => {
    const app = buildApp();
    const bogus = await call(app, '/api/proxy/recommend/TEST-1?kind=not-a-real-kind');
    assert.equal(bogus.status, 400, `expected 400, got ${bogus.status}: ${JSON.stringify(bogus.body)}`);

    // `defer` is a valid dispatch kind but NOT a generatable template — it must be
    // rejected here (validated via hasPrompt), never fall through to generatePrompt null.
    const defer = await call(app, '/api/proxy/recommend/TEST-1?kind=defer');
    assert.equal(defer.status, 400, 'non-generatable meta-kind `defer` must 400, not 500');
  });

  test('?format=md mirrors the override through the same branch (markdown, not JSON)', async () => {
    const app = buildApp();
    const res = await call(app, '/api/proxy/recommend/TEST-1?kind=implementation&format=md');
    assert.equal(res.status, 200);
    assert.ok((res.contentType || '').includes('text/markdown'),
      `expected markdown content-type, got ${res.contentType}`);
    assert.ok(res.text.includes('## Re-ground the Ticket (staleness check)'),
      'md override body must carry the same grounded prompt');
  });

  test('override path works without AI configured and does not meter free-tier (no LLM call)', async () => {
    const freeTierCalls = { count: 0 };
    // aiConfigured:false → the default path would 503; the override must succeed.
    const app = buildApp({ aiConfigured: false, freeTierCalls });
    const res = await call(app, '/api/proxy/recommend/TEST-1?kind=implementation');
    assert.equal(res.status, 200, 'override bypasses the recommendation-enabled 503 gate');
    assert.equal(freeTierCalls.count, 0, 'override makes no LLM call → must not charge free-tier');
  });

  test('no ?kind= leaves the default (engine-recommended) path intact', async () => {
    // No kind → the engine path runs as before (test mode short-circuits to the
    // mock recommendation). The `override` flag is present ONLY on the kind path,
    // so its absence here proves the default response stays byte-identical.
    const app = buildApp();
    const res = await call(app, '/api/proxy/recommend/TEST-1');
    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(!('override' in res.body), 'default no-kind response must not carry the override flag');
    assert.ok('recommendedAction' in res.body && 'deferredVia' in res.body,
      'default response keeps its engine-path shape (recommendedAction, deferredVia)');
  });
});
