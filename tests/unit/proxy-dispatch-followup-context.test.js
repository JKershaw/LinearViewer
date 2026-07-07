/**
 * LIN-805 — route-level: POST /api/proxy/dispatch must NOT re-append the
 * proxy-context block by default when `followUpTo` is set.
 *
 * A follow-up beat resumes a warm session that already received the
 * "Workspace API access" block on its FIRST beat, so re-appending it on every
 * later beat is redundant and risks confusing the worker. The suppression lives
 * in the route (it adjusts the append default based on followUpTo), so it must
 * be observed at the dispatch seam by inspecting the prompt handed to addItem.
 *
 * Set NODE_ENV before importing the routes so the test-mode short-circuit
 * (token === 'test-token') and module-level rate-limiter skips apply.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

// The marker line emitted by buildProxyContextPreamble (lib/proxy-preamble.js).
const PROXY_CONTEXT_MARKER = '## Workspace API access (auto-appended)';

function buildApp(captured) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
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
  const server = app.listen(0);
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

const FOLLOW_UP_ID = '11111111-2222-3333-4444-555555555555';

function hasProxyContext(prompt) {
  return typeof prompt === 'string' && prompt.includes(PROXY_CONTEXT_MARKER);
}

describe('LIN-805 — proxy-context append on follow-up dispatches', () => {
  test('a fresh dispatch (no followUpTo) appends the proxy-context block by default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'do the thing',
      issueIdentifier: 'TEST-1'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(hasProxyContext(captured.item.prompt),
      'fresh dispatch must keep the default-ON proxy-context append');
  });

  test('a follow-up dispatch (followUpTo set) does NOT append the proxy-context block by default', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.item.followUpTo, FOLLOW_UP_ID, 'followUpTo is forwarded');
    assert.ok(!hasProxyContext(captured.item.prompt),
      'a warm-session follow-up must NOT re-append the proxy-context block');
    assert.equal(captured.item.prompt, 'next beat',
      'the follow-up prompt is forwarded verbatim with nothing appended');
  });

  test('an explicit appendProxyContext:true forces the block back on for a follow-up', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'next beat',
      issueIdentifier: 'TEST-1',
      target: 'cli',
      followUpTo: FOLLOW_UP_ID,
      appendProxyContext: true
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(hasProxyContext(captured.item.prompt),
      'an explicit appendProxyContext:true opts a follow-up back in');
  });

  test('the existing opt-out (appendProxyContext:false) still suppresses on a fresh dispatch', async () => {
    const captured = {};
    const app = buildApp(captured);
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'self-contained prompt',
      issueIdentifier: 'TEST-1',
      appendProxyContext: false
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(!hasProxyContext(captured.item.prompt),
      'appendProxyContext:false still opts a fresh dispatch out');
  });
});
