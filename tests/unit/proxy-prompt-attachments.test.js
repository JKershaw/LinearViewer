/**
 * LIN-776 — route-level regression: the deterministic prompt-dispatch paths must
 * forward `context.attachments` into generatePrompt so the worker-facing
 * `## Attachments` section is surfaced.
 *
 * The library seam (generatePrompt → formatAttachmentsSection) and its both-paths
 * parity are unit-tested elsewhere (prompt-templates / prompt-formatters). The gap
 * this file closes is the ROUTE WIRING: two handlers rebuilt a smaller context
 * object that dropped `attachments`, so the section silently vanished even though
 * fetchIssueContext (LIN-772) carries it. These tests drive
 *   - GET  /api/proxy/prompt/TEST-1/implementation        (deterministic /prompt)
 *   - POST /api/proxy/recommend-and-dispatch  { kind }     (verb-override dispatch)
 * end-to-end through the test-mode mock context (TEST-1 carries a formal
 * attachment node), asserting the rendered prompt contains `## Attachments`.
 * Without the destructure fix in routes/proxy.js these fail even though the mock
 * supplies attachments — so they guard exactly the regression.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit (token
 * === 'test-token') and module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

// Captures the item the verb-override path hands to dispatch — the override
// response never returns the prompt body (server-generated/trusted), so the only
// way to observe the rendered prompt is at the dispatch seam.
function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      // LIN-1175: claude-code (default harness) dispatch now fails closed without a
      // mintable token; give the stub a minting createToken like production.
      createToken: async () => ({ token: "test-bootstrap", kind: "bootstrap", scope: "readWrite" }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    // token === 'test-token' drives isTestMode → the mock issue context (TEST-1).
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-776 — deterministic prompt paths surface ## Attachments', () => {
  test('GET /api/proxy/prompt/TEST-1/implementation includes the Attachments section', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'get', '/api/proxy/prompt/TEST-1/implementation');

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.prompt.includes('## Attachments'),
      'deterministic /prompt route must render the ## Attachments section when the issue has attachments');
    // Anchor on the actual fixture attachment (TEST-1 → formal node att-1) so the
    // assertion proves the real collector output flowed through, not an empty header.
    assert.ok(res.body.prompt.includes('Screenshot'),
      'the rendered Attachments section must list the fixture attachment (Screenshot)');
  });

  test('POST /api/proxy/recommend-and-dispatch (kind override) dispatches a prompt with ## Attachments', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      kind: 'implementation'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item, 'verb-override path must dispatch an item');
    assert.ok(captured.item.prompt.includes('## Attachments'),
      'verb-override dispatch must render the ## Attachments section into the dispatched prompt');
    assert.ok(captured.item.prompt.includes('Screenshot'),
      'the dispatched prompt must list the fixture attachment (Screenshot)');
  });
});
