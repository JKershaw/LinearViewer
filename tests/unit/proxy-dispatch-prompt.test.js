/**
 * LIN-1128 — GET /api/proxy/dispatch/:id/prompt returns the canonical
 * dispatched prompt so a consuming agent can CONFIRM a task it received (e.g.
 * as in-session conversational text) against the trusted dispatch record.
 *
 * The watch twin (GET .../:id) deliberately omits `prompt`; this targeted
 * single-item read adds it back. Covered here: the prompt is returned, the
 * lookup is workspace-scoped (req.proxyUrlKey is threaded into getItemStatus),
 * an unknown id 404s, and a missing dispatch store 503s.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit and
 * module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const ITEM_ID = '11111111-2222-3333-4444-555555555555';

function buildApp({ store, captured } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' }
    });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1128 — GET /api/proxy/dispatch/:id/prompt', () => {
  test('returns the canonical prompt plus confirmation metadata', async () => {
    const captured = {};
    const store = {
      getItemStatus: async (urlKey, id) => {
        captured.urlKey = urlKey;
        captured.id = id;
        return {
          id,
          prompt: 'Implement the widget as specified in LIN-42.',
          promptName: 'implementation',
          kind: 'implementation',
          issueIdentifier: 'LIN-42',
          issueUrl: 'https://example.com/LIN-42',
          target: 'cli',
          followUpTo: null,
          sessionId: null,
          dispatchedAt: '2026-07-07T00:00:00.000Z',
          status: 'queued',
          feedback: []
        };
      }
    };
    const app = buildApp({ store, captured });
    const res = await call(app, `/api/proxy/dispatch/${ITEM_ID}/prompt`);

    assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.prompt, 'Implement the widget as specified in LIN-42.',
      'the canonical prompt is returned so the agent can confirm the task');
    assert.equal(res.body.id, ITEM_ID);
    assert.equal(res.body.promptName, 'implementation');
    assert.equal(res.body.kind, 'implementation');
    assert.equal(res.body.issueIdentifier, 'LIN-42');
    // Workspace-scoped: the token's urlKey is threaded into the store read, so a
    // token can only read its own workspace's dispatches.
    assert.equal(captured.urlKey, 'acme', 'lookup must be scoped to the token workspace');
    assert.equal(captured.id, ITEM_ID);
  });

  test('unknown id 404s', async () => {
    const store = { getItemStatus: async () => null };
    const app = buildApp({ store });
    const res = await call(app, `/api/proxy/dispatch/${ITEM_ID}/prompt`);
    assert.equal(res.status, 404, `expected 404, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test('a malformed id is rejected with 400', async () => {
    const store = { getItemStatus: async () => { throw new Error('should not be called'); } };
    const app = buildApp({ store });
    const res = await call(app, '/api/proxy/dispatch/bad%00id/prompt');
    assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.body)}`);
  });

  test('503 when the dispatch store is not wired', async () => {
    const app = buildApp({ store: null });
    const res = await call(app, `/api/proxy/dispatch/${ITEM_ID}/prompt`);
    assert.equal(res.status, 503, `expected 503, got ${res.status}: ${JSON.stringify(res.body)}`);
  });
});
