/**
 * Route-level tests for the LIN-3200 file-pointer wiring (P5): each prompt path
 * that can enqueue an implementation dispatch gets a plan block, and the stored
 * prompt carries the pointer. One test per path, each failing independently:
 *   - POST /api/proxy/dispatch                       (proxy-dispatch.js:481)
 *   - POST /api/proxy/recommend-and-dispatch (kind)  (proxy-dispatch.js:946)
 *   - POST /api/proxy/recommend-and-dispatch (LLM)   (proxy-dispatch.js:1234)
 *   - POST /workspace/:urlKey/api/dispatch           (dispatch.js:469)
 *
 * NODE_ENV is set before importing so the test-mode short-circuits apply. The
 * pilot flag is set per-test; the GitHub owner list stays empty so the default
 * PR read never opens a socket (the suite is hermetic).
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { FILE_POINTER_MARKER } from '../../lib/file-pointer.js';

const PLAN_DESCRIPTION = '## Implementation Plan\nlib/plan.js\nroutes/plan-route.js';

function stubProvider(description = PLAN_DESCRIPTION) {
  const issue = {
    id: 'i1',
    identifier: 'LIN-1',
    title: 'A task',
    description,
    state: { name: 'Todo', type: 'started' },
    labels: [],
    url: 'https://example.test/LIN-1'
  };
  return {
    name: 'stub',
    ui: { displayName: 'Stub', write: true, comments: true, estimates: true, subtasks: true },
    supports: () => true,
    fetchIssueContext: async () => ({ issue, project: null }),
    fetchRecommendationContext: async () => ({ issue, parent: null, siblings: [], project: null, children: [], comments: [], focusedChild: null })
  };
}

function capturingStore(captured) {
  return {
    addItem: async (urlKey, item) => {
      captured.item = item;
      return { _id: 'disp-1', dispatchedAt: '2026-06-28T00:00:00.000Z', ...item };
    },
    countPilotEligible: async () => 0
  };
}

function buildProxyApp({ captured, token = 'test-token' }) {
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
    resolveWorkspaceAccess: async () => ({ token, reason: 'ok', provider: 'stub' }),
    getWorkspaceAccessToken: async () => token,
    getWorkspaceOpenRouterKey: async () => null,
    getWorkspaceNorthStar: async () => null,
    reportHistoryStore: {},
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: {},
    llmCallLogStore: {},
    dispatchQueueStore: capturingStore(captured),
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider: stubProvider()
  }));
  return app;
}

async function call(app, method, path, body, token = 'anything') {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: `Bearer ${token}` } };
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

beforeEach(() => { process.env.HARBOUR_FILE_POINTER_PILOT = '1'; });
afterEach(() => { delete process.env.HARBOUR_FILE_POINTER_PILOT; });

describe('file-pointer route wiring — proxy POST /api/proxy/dispatch', () => {
  test('the stored prompt is prepended with the plan-derived pointer', async () => {
    const captured = {};
    const app = buildProxyApp({ captured });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      prompt: 'run me',
      promptName: 'implementation',
      kind: 'implementation',
      issueIdentifier: 'LIN-1',
      appendProxyContext: false
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item.prompt.startsWith(FILE_POINTER_MARKER), captured.item.prompt);
    assert.match(captured.item.prompt, /- lib\/plan\.js/);
  });
});

describe('file-pointer route wiring — proxy verb-override (recommend-and-dispatch)', () => {
  test('the stored prompt is prepended with the plan-derived pointer', async () => {
    const captured = {};
    const app = buildProxyApp({ captured, token: 'real-token' });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'LIN-1',
      kind: 'implementation',
      appendProxyContext: false
    }, 'anything');
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item.prompt.startsWith(FILE_POINTER_MARKER), captured.item.prompt);
  });
});

describe('file-pointer route wiring — proxy LLM arm (recommend-and-dispatch)', () => {
  test('the stored prompt is prepended with the plan-derived pointer', async () => {
    const captured = {};
    const app = buildProxyApp({ captured, token: 'test-token' });
    const res = await call(app, 'post', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'TEST-1',
      noDescend: true,
      appendProxyContext: false
    }, 'anything');
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item.prompt.startsWith(FILE_POINTER_MARKER), captured.item.prompt);
  });
});

describe('file-pointer route wiring — session dispatch route', () => {
  test('the stored prompt is prepended with the plan-derived pointer', async () => {
    const captured = {};
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore: capturingStore(captured),
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: req.params.urlKey, provider: 'stub' };
        req.session = { linearUserId: 'u1' };
        next();
      },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null,
      provider: stubProvider(),
      getWorkspaceAccessToken: async () => 'tok',
      fetchIssueContext: async () => ({ issue: { identifier: 'LIN-1', description: PLAN_DESCRIPTION } })
    }));

    const res = await call(app, 'post', '/workspace/acme/api/dispatch', {
      prompt: 'run me',
      promptName: 'implementation',
      kind: 'implementation',
      issueIdentifier: 'LIN-1'
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(captured.item.prompt.startsWith(FILE_POINTER_MARKER), captured.item.prompt);
  });
});
