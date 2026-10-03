/**
 * LIN-3242 (LIN-3126 slice 3) — the dispatch binding contract across the session
 * and proxy dispatch lanes.
 *
 * Seed: one GitHub Connection with TWO bindings on one workspace — repoA active,
 * repoB non-active — both connection-backed, so the id/lookup spaces are
 * indistinguishable without a selector.
 *
 * The pair `issueSource` / `issueBindingScope` is:
 *   - accepted by the session route (`POST /workspace/:urlKey/api/dispatch`),
 *     validated via slice-1's `findBindingBySelector`, persisted SPARSELY on the
 *     row, and used by the session referent guard via `resolveIssueBinding`;
 *   - threaded into the proxy seam's `selector` on the ISSUE arm and persisted on
 *     the enqueued row (`POST /api/proxy/dispatch`).
 *
 * An unstamped issue dispatch on the multi-binding workspace fails closed
 * (`422 BINDING_REQUIRED`) on both lanes rather than guessing repoA.
 *
 * Fails before (recorded 2026-10-02, routes/UI stashed to the unfixed HEAD):
 *   - session lane, UNSTAMPED issue dispatch returned 201 (old guard used
 *     `getWorkspaceCallScope` → repoA; github is unguarded so the probe allowed):
 *       201 !== 422
 *   - proxy lane, STAMPED issue dispatch was refused because the body pair never
 *     reached the seam's `selector`:
 *       {"code":"BINDING_REQUIRED","provider":"github","bindings":["octo/repoA","octo/repoB"]}
 *       422 !== 201
 *   - the stored row carried no `issueSource`/`issueBindingScope`, and the UI
 *     body sent neither key. 6 of the 12 assertions fail before; 12/12 pass after.
 *
 * Run with: node --test tests/unit/dispatch-route-issue-binding.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { installGitHubProvider, makeTwoRepoWorkspace, REPO_A, REPO_B } from './lin-3126-harness.js';
import { makeTwoRepoResolver, buildProxyApp, callProxy } from './lin-3126-proxy-harness.js';

const ISSUE = { promptName: 'implementation', issueIdentifier: 'GB-1' };

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    const req = async (method, path, body) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return { status: res.status, body: parsed };
    };
    return await fn(req);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// ── Session lane ─────────────────────────────────────────────────────────────

function buildSessionApp(workspace, store) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore: store,
    dispatchTokenStore: {},
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = workspace;
      req.session = { linearUserId: 'u1', accountId: 'acct-1' };
      next();
    },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
  }));
  return app;
}

function freshStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection(),
  });
}

describe('LIN-3242 — session dispatch lane carries the binding selector', () => {
  test('a stamped issue dispatch resolves to repoB and persists the pair on the row', async () => {
    installGitHubProvider();
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    const app = buildSessionApp(workspace, store);

    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run me',
      ...ISSUE,
      issueSource: 'github',
      issueBindingScope: REPO_B,
    }));

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal(doc.issueSource, 'github', 'the stored row carries issueSource');
    assert.equal(doc.issueBindingScope, REPO_B, 'the stored row carries issueBindingScope');
  });

  test('an unstamped issue dispatch on the multi-binding workspace fails closed (422 BINDING_REQUIRED)', async () => {
    installGitHubProvider();
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    const app = buildSessionApp(workspace, store);

    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run me',
      ...ISSUE,
    }));

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'BINDING_REQUIRED');
    assert.deepEqual(res.body.bindings, [REPO_A, REPO_B]);
    assert.equal(store.collection._docs.length, 0, 'a refused dispatch must not enqueue');
  });

  test('an unknown selector pair is refused 422 UNKNOWN_BINDING, nothing enqueued', async () => {
    installGitHubProvider();
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    const app = buildSessionApp(workspace, store);

    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run me',
      ...ISSUE,
      issueSource: 'github',
      issueBindingScope: 'octo/ghost',
    }));

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'UNKNOWN_BINDING');
    assert.equal(store.collection._docs.length, 0);
  });

  test('a single-binding workspace stays byte-identical: an unstamped issue dispatch is admitted', async () => {
    installGitHubProvider();
    const binding = { provider: 'github', scope: REPO_A, connectionId: 'conn-1' };
    const { setBindingCredential } = await import('../../lib/connection-binding.js');
    setBindingCredential(binding, { installationId: '99', token: 'tok-a' });
    const workspace = { urlKey: 'acme', provider: 'github', bindings: [binding], activeBinding: { provider: 'github', scope: REPO_A } };
    const store = freshStore();
    const app = buildSessionApp(workspace, store);

    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run me',
      ...ISSUE,
    }));

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal('issueSource' in doc, false, 'an unstamped row adds no key');
    assert.equal('issueBindingScope' in doc, false);
  });

  // Regression (CI e2e): every issue row carries a `source`, but only a stamped
  // row carries a binding scope, so the client sends a lone `issueSource`. That
  // is a legitimate source-only hint, resolved by `resolveIssueBinding`'s §1
  // source-only rule — never a 422.
  test('a lone issueSource (source-only hint) is admitted and stored as no pair', async () => {
    installGitHubProvider();
    const binding = { provider: 'github', scope: REPO_A, connectionId: 'conn-1' };
    const { setBindingCredential } = await import('../../lib/connection-binding.js');
    setBindingCredential(binding, { installationId: '99', token: 'tok-a' });
    const workspace = { urlKey: 'acme', provider: 'github', bindings: [binding], activeBinding: { provider: 'github', scope: REPO_A } };
    const store = freshStore();
    const app = buildSessionApp(workspace, store);

    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run me',
      ...ISSUE,
      issueSource: 'github',
    }));

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal('issueSource' in doc, false, 'a source-only hint is not persisted as a pair');
    assert.equal('issueBindingScope' in doc, false);
  });

  test('a lone issueBindingScope is refused 422 UNKNOWN_BINDING (never a valid selector)', async () => {
    installGitHubProvider();
    const workspace = makeTwoRepoWorkspace();
    const store = freshStore();
    const app = buildSessionApp(workspace, store);

    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run me',
      ...ISSUE,
      issueBindingScope: REPO_B,
    }));

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'UNKNOWN_BINDING');
    assert.equal(store.collection._docs.length, 0);
  });
});

// ── Proxy lane ───────────────────────────────────────────────────────────────

function recordingDispatchProvider() {
  return {
    name: 'github',
    ui: { displayName: 'GitHub', name: 'github' },
    supports: () => true,
    fetchIssueContext: async (scope, issueId) => ({ issue: { id: issueId, identifier: 'GB-1', title: 'repoB' } }),
  };
}

describe('LIN-3242 — proxy dispatch lane forwards the selector into the seam', () => {
  test('a stamped /api/proxy/dispatch resolves through the seam with the pair and persists it', async () => {
    const { fn } = makeTwoRepoResolver();
    const seen = [];
    const resolveWorkspaceAccess = async (urlKey, ownerAccountId, opts) => {
      const out = await fn(urlKey, ownerAccountId, opts);
      seen.push({ opts, out });
      return out;
    };
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess, provider: recordingDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run me',
      ...ISSUE,
      issueSource: 'github',
      issueBindingScope: REPO_B,
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(seen.length, 1, 'the seam resolved once');
    assert.equal(seen[0].opts.intent, 'ISSUE');
    assert.deepEqual(seen[0].opts.selector, { source: 'github', bindingScope: REPO_B });
    assert.deepEqual(seen[0].out.scope, { token: 'tok-a', repo: REPO_B }, 'resolved to repoB, not the active repoA');
    assert.equal(captured.item.issueSource, 'github');
    assert.equal(captured.item.issueBindingScope, REPO_B);
  });

  test('an unstamped /api/proxy/dispatch on the multi-binding workspace fails closed (422 BINDING_REQUIRED)', async () => {
    const { fn } = makeTwoRepoResolver();
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess: fn, provider: recordingDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run me',
      ...ISSUE,
    });

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'BINDING_REQUIRED');
    assert.equal(captured.item, undefined, 'a refused dispatch must not enqueue');
  });

  test('an unknown selector pair is refused (422), nothing enqueued', async () => {
    const { fn } = makeTwoRepoResolver();
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess: fn, provider: recordingDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run me',
      ...ISSUE,
      issueSource: 'github',
      issueBindingScope: 'octo/ghost',
    });

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'UNKNOWN_BINDING');
    assert.equal(captured.item, undefined);
  });
});
