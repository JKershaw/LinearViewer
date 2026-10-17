// =============================================================================
// routes/workspace-api.js — the two fixes of the design-first rebuild (LIN-3596)
// =============================================================================
//
// Both were inputs that escaped the route's own error contract and reached the
// final handler as a plain 500 `{ error: 'Internal server error' }`:
//
//   1. A throwing `adoptConnectionCredential` in the comment route's recovery
//      branch. The route promises one exit from its `catch`: the classified 500
//      (`detail`/`code`/`category`/`retryable` from the classifier alone). The adopt
//      call sat outside the inner error boundary, so its throw skipped the
//      classifier.
//   2. A repeated `/image?url=` (Express parses it to an array). `startsWith` threw a
//      TypeError, a 500, where every other invalid image URL is a 400 (LIN-1158: bad
//      input must not surface as a 500).
//
// The app installs async error forwarding and a final handler like server.js does
// (against the old router the escaping rejection would otherwise leave the request
// hanging), so each test fails by assertion, not by timeout.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { installAsyncErrorForwarding } from '../../lib/async-errors.js';

installAsyncErrorForwarding();

const realFetch = globalThis.fetch;

function buildApp({ workspace, session, adoptConnectionCredential }) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = workspace;
      req.session = session;
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
    proxyTokenStore: {}, taskDecisionsStore: {},
    ownerCredentialStore: { get: async () => null },
    adoptConnectionCredential,
  }));
  // server.js's final handler, reduced to what these tests read.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function request(app, method, path, payload) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('comment recovery: a throwing adoptConnectionCredential is classified (LIN-3596)', () => {
  test('answers the classified 500, never echoes the throw, and neither mutates nor saves the session', async () => {
    registerProvider({
      name: 'linear',
      ui: { displayName: 'Linear' },
      supports: (capability) => capability === 'createComment',
      async issueWriteGuard() { return { id: 'iss-1', trashed: false }; },
      async createComment() {
        const rejected = new Error('Authentication required, not authenticated');
        rejected.status = 401;
        throw rejected;
      },
    });

    // A connection-backed active binding: the recovery branch adopts from its Connection.
    const workspace = {
      id: 'ws-1',
      urlKey: 'acme',
      provider: 'linear',
      accessToken: 'ws-token',
      activeBinding: { provider: 'linear', scope: 'org-1' },
      bindings: [{ provider: 'linear', scope: 'org-1', connectionId: 'conn-1', credentials: { token: 'ws-token' } }],
    };
    let saves = 0;
    const session = { accountId: 'acct-1', save: (done) => { saves += 1; done(null); } };
    let adoptCalls = 0;

    const app = buildApp({
      workspace,
      session,
      adoptConnectionCredential: async () => {
        adoptCalls += 1;
        throw new Error('connection authorisation exploded: SECRET-UPSTREAM-DETAIL');
      },
    });

    const { status, body } = await request(app, 'POST', '/workspace/acme/api/comments/LIN-901', { body: 'ship it' });

    assert.equal(adoptCalls, 1, 'recovery was attempted once');
    assert.equal(status, 500);
    assert.equal(body.error, 'Failed to create comment', 'the route\'s own classified 500, not the final handler\'s');
    assert.equal(body.category, 'internal');
    assert.equal(body.retryable, false);
    assert.ok(body.code && body.detail, 'code and detail come from the classifier');
    assert.ok(!JSON.stringify(body).includes('SECRET-UPSTREAM-DETAIL'), 'the thrown message is never echoed');
    assert.equal(saves, 0, 'no session save: the mutation path was never reached');
    assert.equal(workspace.accessToken, 'ws-token', 'the workspace credential is untouched');
  });
});

describe('image proxy: a repeated ?url= is a 400 (LIN-3596)', () => {
  test('answers 400 Invalid image URL format and makes no fetch', async () => {
    const outbound = [];
    globalThis.fetch = (url, ...rest) => {
      if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, ...rest);
      outbound.push(String(url));
      return Promise.reject(new Error('the image route must not fetch for a malformed url'));
    };
    try {
      const app = buildApp({
        workspace: { id: 'ws-1', urlKey: 'acme', provider: 'linear', accessToken: 'ws-token' },
        session: { accountId: 'acct-1' },
      });

      const { status, body } = await request(app, 'GET',
        '/workspace/acme/api/image?url=https://uploads.linear.app/a.png&url=https://uploads.linear.app/b.png');

      assert.equal(status, 400);
      assert.equal(body.error, 'Invalid image URL format');
      assert.deepEqual(outbound, [], 'no upstream fetch, so no credential left the system');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
