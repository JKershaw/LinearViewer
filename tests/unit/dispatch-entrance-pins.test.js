/**
 * LIN-3592 — pins for the behaviour fixes made while rebuilding the dispatch entrance
 * (routes/dispatch.js, routes/proxy-dispatch.js, routes/proxy-kickoff.js). One test per
 * fix; the replay that found each one is recorded in the PR.
 *
 * Fix 1 — POST /api/proxy/recommend-and-dispatch, verb-override arm (`kind` set):
 * the handler validated `waitForFollowUps` (LIN-797) and its own comment, and the
 * documented body (lib/proxy-instructions.js), say it is "threaded through to the
 * dispatched item", but the override arm's `fields` never carried it, so a pinned-verb
 * dispatch with `waitForFollowUps: true` was queued WITHOUT the completion hold. The
 * recommendation-derived arm and POST /dispatch both stamped it. Nothing pinned the
 * omission.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit
 * (token === 'test-token') and module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

// A store that captures the item handed to addItem.
function buildApp(captured) {
  const store = {
    getGrantDeclaration: async () => ({ state: 'none' }),
    addItem: async (urlKey, item) => {
      captured.item = item;
      return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
    }
  };
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        grants: ['dispatch'], workspaceId: 'ws-acme',
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({
      token: 'test-token', reason: 'ok', provider: 'linear', source: 'session-scan',
      expiresAt: Date.now() + 3600_000
    }),
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

// Bound to 127.0.0.1 and addressed the way it was bound (LIN-2023).
async function post(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const ENDPOINT = '/api/proxy/recommend-and-dispatch';

describe('LIN-3592 fix 1 — recommend-and-dispatch override arm forwards waitForFollowUps', () => {
  test('waitForFollowUps: true reaches the queued item on the verb-override arm', async () => {
    const captured = {};
    const res = await post(buildApp(captured), ENDPOINT, {
      issueIdentifier: 'TEST-1', kind: 'implementation', waitForFollowUps: true
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.override, true, 'this is the verb-override arm');
    assert.strictEqual(captured.item.waitForFollowUps, true, 'the completion hold must be stored, not dropped');
  });

  test('absent or false stays false (only an explicit boolean true opts in)', async () => {
    for (const extra of [{}, { waitForFollowUps: false }]) {
      const captured = {};
      const res = await post(buildApp(captured), ENDPOINT, { issueIdentifier: 'TEST-1', kind: 'implementation', ...extra });
      assert.equal(res.status, 201);
      assert.strictEqual(captured.item.waitForFollowUps, false);
    }
  });

  test('the recommendation-derived arm agrees with the override arm', async () => {
    const captured = {};
    const res = await post(buildApp(captured), ENDPOINT, { issueIdentifier: 'TEST-1', waitForFollowUps: true });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.notEqual(res.body.override, true, 'this is the recommendation-derived arm');
    assert.strictEqual(captured.item.waitForFollowUps, true);
  });
});
