/**
 * LIN-3335 — one source per kind: the server-side pair plumbing is gone, but the
 * kept behaviours must still hold:
 *
 *   1. `resolveIssueBinding` is source-only again: on a Linear-primary workspace
 *      with a Jira source, a Jira row (kind-only `issueSource: 'jira'`) resolves
 *      to Jira, not Linear and not a 422.
 *   2. dispatching, waking and following up on that Jira task are accepted and
 *      read Jira (the session referent guard probes Jira, which is unguarded, so
 *      the dispatch is allowed; an UNSTAMPED dispatch probes the active Linear
 *      binding and is refused, proving the source is what routes it).
 *   3. the four former latent TypeError sites no longer destructure an error
 *      result: `routes/dashboard.js` ~1468 (pr-state) / ~1698 (run-evidence) and
 *      `routes/workspace-api.js` ~1808 (comment retry) / ~4474 (run-evidence)
 *      all resolve a usable `{provider, callScope}` on a workspace that holds two
 *      same-kind connection-backed bindings (an old, un-migrated row shape).
 *
 * Run with: node --test tests/unit/lin-3335-one-source-per-kind.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerProvider } from '../../lib/providers/registry.js';
import { setBindingCredential, setWorkspaceCredential } from '../../lib/connection-binding.js';
import { resolveIssueBinding, linkProvider } from '../../lib/workspace.js';
import { buildWakeFollowUp } from '../../lib/dispatch-wake.js';
import { createDispatchItem } from '../../lib/dispatch-factory.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const FUTURE = Date.now() + 3_600_000;
const LINEAR_TOKEN = 'lin-active-token';
const JIRA_TOKEN = 'jira-tok';

// ── Fake providers ───────────────────────────────────────────────────────────

function installProviders({ linearGuardReturns = null } = {}) {
  const calls = { linearGuard: [], jiraGuard: [], linearComments: [] };
  registerProvider({
    name: 'linear',
    ui: { displayName: 'Linear' },
    supports: () => true,
    // The real guard allow-list includes 'linear'; returning null is "definitively
    // absent", which is what turns an unstamped dispatch into a 422.
    issueWriteGuard: async (callScope, id) => { calls.linearGuard.push({ callScope, id }); return linearGuardReturns; },
    fetchIssueComments: async (callScope, id) => { calls.linearComments.push({ callScope, id }); return []; },
    fetchRecommendationContext: async (callScope, id) => ({ issue: { id }, comments: [] }),
  });
  registerProvider({
    name: 'jira',
    ui: { displayName: 'Jira' },
    supports: () => true,
    // Deliberately NO `issueWriteGuard`: Jira is not a GUARDED_PROVIDER, so the
    // dispatch referent guard fails open and the Jira task stays dispatchable.
    fetchIssueComments: async () => [],
    fetchRecommendationContext: async (callScope, id) => ({ issue: { id }, comments: [] }),
  });
  return calls;
}

/** Linear-primary workspace with a Jira source beside it (legacy inline credentials). */
function linearPrimaryWithJira() {
  const workspace = { id: 'ws-1', urlKey: 'acme', bindings: [] };
  linkProvider(workspace, 'linear', 'lin-org', { token: LINEAR_TOKEN, tokenExpiresAt: FUTURE });
  linkProvider(workspace, 'jira', 'https://site', { token: JIRA_TOKEN, authType: 'oauth', cloudId: 'c1' });
  return workspace;
}

/** The old-row shape that made `selectIssueBinding` refuse: two connection-backed same-kind bindings. */
function twoConnectionBackedLinear() {
  const bindings = [
    { provider: 'linear', scope: 'org-a', connectionId: 'conn-1' },
    { provider: 'linear', scope: 'org-b', connectionId: 'conn-1' },
  ];
  setBindingCredential(bindings[0], { token: 'tok-a', tokenExpiresAt: FUTURE });
  setBindingCredential(bindings[1], { token: 'tok-b', tokenExpiresAt: FUTURE });
  const workspace = { urlKey: 'acme', provider: 'linear', bindings, activeBinding: { provider: 'linear', scope: 'org-a' } };
  setWorkspaceCredential(workspace, { token: 'tok-a', tokenExpiresAt: FUTURE });
  return workspace;
}

// ── 1. source-only resolution ────────────────────────────────────────────────

describe('LIN-3335 — resolveIssueBinding is source-only again', () => {
  test('a Jira source on a Linear-primary workspace resolves to Jira, never a 422', () => {
    installProviders();
    const binding = resolveIssueBinding(linearPrimaryWithJira(), 'jira');
    assert.ok(!binding.error, 'no pair-era refusal');
    assert.equal(binding.provider.name, 'jira');
    assert.deepEqual(binding.callScope, { authType: 'oauth', accessToken: JIRA_TOKEN, cloudId: 'c1', site: 'https://site' });
  });

  test('no source (or an unmatched one) falls back to the workspace active binding', () => {
    installProviders();
    const workspace = linearPrimaryWithJira();
    assert.equal(resolveIssueBinding(workspace, null).provider.name, 'linear');
    assert.equal(resolveIssueBinding(workspace, 'nope').provider.name, 'linear');
  });

  test('a two-same-kind connection-backed workspace no longer refuses (the latent-TypeError cause)', () => {
    installProviders();
    const binding = resolveIssueBinding(twoConnectionBackedLinear(), null);
    assert.ok(!binding.error, 'the pair-era BINDING_REQUIRED refusal is gone');
    assert.equal(binding.provider.name, 'linear');
    assert.ok(binding.callScope, 'a call scope is always produced');
  });
});

// ── 2. dispatch / wake / follow-up on a Jira task ────────────────────────────

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
  return new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
}

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

describe('LIN-3335 — a Jira task on a Linear-primary workspace', () => {
  test('dispatching it is accepted and probes Jira, never the active Linear binding', async () => {
    const calls = installProviders();
    const store = freshStore();
    const app = buildSessionApp(linearPrimaryWithJira(), store);
    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run the jira task',
      promptName: 'implementation',
      issueIdentifier: 'ABC-12',
      issueSource: 'jira',
    }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(calls.linearGuard, [], 'the referent guard must not probe the active Linear binding');
    const doc = store.collection._docs[0];
    assert.equal(doc.issueSource, 'jira', 'the kind-only source is stamped on the row');
    assert.ok(!('issueBindingScope' in doc), 'the pair-era scope is gone');
  });

  test('without its source the same task falls to Linear and is refused (the source is what routes it)', async () => {
    const calls = installProviders();
    const store = freshStore();
    const app = buildSessionApp(linearPrimaryWithJira(), store);
    const res = await withServer(app, req => req('POST', '/workspace/acme/api/dispatch', {
      prompt: 'run it',
      promptName: 'implementation',
      issueIdentifier: 'ABC-12',
    }));
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'ISSUE_NOT_FOUND');
    assert.equal(calls.linearGuard.length, 1, 'the unstamped dispatch probes the active Linear binding');
    assert.equal(store.collection._docs.length, 0, 'a refused dispatch enqueues nothing');
  });

  test('its wake descriptor carries the kind-only source (no pair)', () => {
    const wake = buildWakeFollowUp({
      id: 'child-1',
      sessionId: 'parent-S1',
      subscription: 'terminal-only',
      kind: 'implementation',
      issueIdentifier: 'ABC-12',
      issueSource: 'jira',
    }, [{ message: 'started' }, { message: '[done] shipped', timestamp: 't' }]);
    assert.ok(wake, 'a terminal child yields a wake');
    assert.equal(wake.issueSource, 'jira');
    assert.ok(!('issueBindingScope' in wake), 'no pair field on the wake descriptor');
  });

  test('a follow-up inherits the anchor\'s Jira source in the factory', async () => {
    installProviders();
    const captured = {};
    const store = {
      addItem: async (urlKey, item) => { captured.urlKey = urlKey; captured.item = item; return { _id: 'follow-1', ...item }; },
      getItemStatus: async (_urlKey, id) => (id === 'anchor-1'
        ? { id: 'anchor-1', issueId: 'uuid-1', issueIdentifier: 'ABC-12', issueTitle: 'Jira task', issueSource: 'jira' }
        : null),
    };
    await createDispatchItem({
      store, urlKey: 'acme', prompt: 'one more thing',
      fields: { followUpTo: 'anchor-1', target: 'cli' },
    });
    assert.equal(captured.item.issueSource, 'jira', 'the tail row keeps the lineage\'s Jira source');
    assert.ok(!('issueBindingScope' in captured.item), 'no pair field on the follow-up row');
  });
});

// ── 3. the four former latent TypeError sites ────────────────────────────────

describe('LIN-3335 — former latent TypeError sites tolerate an old two-same-kind row', () => {
  // Each asserts the exact expression at the named site destructures a usable
  // provider (the old code destructured an `{error}` refusal and threw).

  test('routes/dashboard.js ~1468 (pr-state) — resolveIssueBinding(workspace, null)', () => {
    installProviders();
    const { provider, callScope } = resolveIssueBinding(twoConnectionBackedLinear(), null);
    assert.equal(provider.name, 'linear');
    assert.ok(callScope, 'fetchIssueComments is callable');
  });

  test('routes/dashboard.js ~1698 (run-evidence) — resolveIssueBinding(workspace, null)', () => {
    installProviders();
    const { provider, callScope } = resolveIssueBinding(twoConnectionBackedLinear(), null);
    assert.equal(provider.name, 'linear');
    assert.ok(callScope);
  });

  test('routes/workspace-api.js ~1808 (comment retry) — resolveIssueBinding(workspace, requestedSource)', () => {
    installProviders();
    const retried = resolveIssueBinding(twoConnectionBackedLinear(), 'linear');
    assert.equal(retried.provider.name, 'linear');
    assert.ok(retried.callScope);
  });

  test('routes/workspace-api.js ~4474 (run-evidence) — resolveIssueBinding(workspace, requestedSource)', () => {
    installProviders();
    const { provider, callScope } = resolveIssueBinding(twoConnectionBackedLinear(), null);
    assert.equal(provider.name, 'linear');
    assert.ok(callScope);
  });
});
