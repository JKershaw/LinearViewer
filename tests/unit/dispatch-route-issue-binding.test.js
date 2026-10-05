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
import { makeTwoRepoResolver, makeVmResolver, githubConnection, buildProxyApp, callProxy, CONNECTION_ID, BUFFER, OWNER } from './lin-3126-proxy-harness.js';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';

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

// ── F1 (review): the proxy lanes persist only a validated, trimmed pair ──────

describe('LIN-3242 review F1 — the proxy /dispatch stamps only a resolved, trimmed pair', () => {
  function realProxyStore() {
    return new DispatchQueueStore({
      collection: createMockCollection(),
      historyCollection: createMockCollection(),
    });
  }

  test('the persisted pair is the trimmed values the seam matched, not the raw body', async () => {
    const { fn } = makeTwoRepoResolver();
    const store = realProxyStore();
    const { app } = buildProxyApp({
      resolveWorkspaceAccess: fn,
      provider: recordingDispatchProvider(),
      extraDeps: { dispatchQueueStore: store },
    });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run me',
      ...ISSUE,
      issueSource: ' github ',
      issueBindingScope: ` ${REPO_B} `,
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal(doc.issueSource, 'github', 'padded source is stored trimmed');
    assert.equal(doc.issueBindingScope, REPO_B, 'padded scope is stored trimmed');
  });

  test('an issueless dispatch ignores a stray pair of any JSON type (nothing stamped)', async () => {
    const { fn } = makeTwoRepoResolver();
    const store = realProxyStore();
    const { app } = buildProxyApp({
      resolveWorkspaceAccess: fn,
      provider: recordingDispatchProvider(),
      extraDeps: { dispatchQueueStore: store },
    });

    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run me',
      issueSource: { $ne: 1 },
      issueBindingScope: ['a'],
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal('issueSource' in doc, false, 'a non-issue dispatch never stamps a selector');
    assert.equal('issueBindingScope' in doc, false);
  });
});

// ── F2 (review): recommend-and-dispatch + kickoff selector rows ──────────────

describe('LIN-3242 review F2 — recommend-and-dispatch forwards the selector', () => {
  test('a complete pair reaches the seam, resolves repoB, and stamps the row', async () => {
    const { fn } = makeTwoRepoResolver();
    const seen = [];
    const resolveWorkspaceAccess = async (urlKey, ownerAccountId, opts) => {
      const out = await fn(urlKey, ownerAccountId, opts);
      seen.push({ opts, out });
      return out;
    };
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess, provider: recordingDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'GB-1',
      kind: 'implementation',
      issueSource: 'github',
      issueBindingScope: REPO_B,
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(seen.length, 1, 'the seam resolved once');
    assert.deepEqual(seen[0].opts.selector, { source: 'github', bindingScope: REPO_B });
    assert.deepEqual(seen[0].out.scope, { token: 'tok-a', repo: REPO_B });
    assert.equal(captured.item.issueSource, 'github');
    assert.equal(captured.item.issueBindingScope, REPO_B);
  });

  test('an unknown pair is refused 422 UNKNOWN_BINDING, nothing enqueued', async () => {
    const { fn } = makeTwoRepoResolver();
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess: fn, provider: recordingDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/recommend-and-dispatch', {
      issueIdentifier: 'GB-1',
      kind: 'implementation',
      issueSource: 'github',
      issueBindingScope: 'octo/ghost',
    });

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'UNKNOWN_BINDING');
    assert.equal(captured.item, undefined);
  });
});

describe('LIN-3242 review F2 — kickoff forwards the selector', () => {
  test('a complete pair reaches the seam, resolves repoB, and stamps the run row', async () => {
    const { fn } = makeTwoRepoResolver();
    const seen = [];
    const resolveWorkspaceAccess = async (urlKey, ownerAccountId, opts) => {
      const out = await fn(urlKey, ownerAccountId, opts);
      seen.push({ opts, out });
      return out;
    };
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess, provider: recordingDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/autopilot/kickoff', {
      goal: 'walk the stack',
      target: 'cli',
      issueIdentifier: 'GB-1',
      issueSource: 'github',
      issueBindingScope: REPO_B,
    });

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(seen[0].opts.selector, { source: 'github', bindingScope: REPO_B });
    assert.deepEqual(seen[0].out.scope, { token: 'tok-a', repo: REPO_B });
    assert.equal(captured.item.issueSource, 'github');
    assert.equal(captured.item.issueBindingScope, REPO_B);
  });

  test('an unknown pair is refused 422 UNKNOWN_BINDING, nothing enqueued', async () => {
    const { fn } = makeTwoRepoResolver();
    const { app, captured } = buildProxyApp({ resolveWorkspaceAccess: fn, provider: recordingDispatchProvider() });

    const res = await callProxy(app, 'POST', '/api/proxy/autopilot/kickoff', {
      goal: 'walk the stack',
      target: 'cli',
      issueIdentifier: 'GB-1',
      issueSource: 'github',
      issueBindingScope: 'octo/ghost',
    });

    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.code, 'UNKNOWN_BINDING');
    assert.equal(captured.item, undefined);
  });
});

// ── R2 (re-review): every proxy site persists only a validated, trimmed pair ─
//
// The F1 fix was pinned only at `/dispatch`'s ISSUE arm. These pin it per site
// so reverting any one of them to the raw-body write (`issueSource ?? null`)
// turns a test red. A lone `issueSource` must resolve (not 422) for its pin to
// mean anything, so those use a ONE-binding owner, where the source-only hint
// selects that binding (ruling lin3240-f8-default-source-only).

function realProxyStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection(),
  });
}

/** The real vm resolver over the real arm for an arbitrary owner row (null = no session row). */
function makeResolverForOwnerRow(ownerRow) {
  const connectionAccess = createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => [githubConnection()] },
    ownerCredentialStore: { getByConnection: async () => null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => ownerRow,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
  });
  const sessions = ownerRow ? [{ _id: 'sid', session: { accountId: OWNER, workspaces: ownerRow.session.workspaces } }] : [];
  return makeVmResolver({ sessions, connectionAccess }).fn;
}

function oneRepoOwnerRow() {
  return {
    session: {
      workspaces: [{
        urlKey: 'acme',
        provider: 'github',
        bindings: [{ provider: 'github', scope: REPO_B, connectionId: CONNECTION_ID }],
        activeBinding: { provider: 'github', scope: REPO_B },
      }],
    },
    workspaceIndex: 0,
  };
}

function appWithStore(resolveWorkspaceAccess) {
  const store = realProxyStore();
  const { app } = buildProxyApp({
    resolveWorkspaceAccess,
    provider: recordingDispatchProvider(),
    extraDeps: { dispatchQueueStore: store },
  });
  return { app, store };
}

function assertUnstamped(doc, why) {
  assert.ok(doc, 'a row was enqueued');
  assert.equal('issueSource' in doc, false, why);
  assert.equal('issueBindingScope' in doc, false, why);
}

const KICKOFF = '/api/proxy/autopilot/kickoff';
const RAD = '/api/proxy/recommend-and-dispatch';

describe('LIN-3242 review R2 — kickoff persists only a validated, trimmed pair', () => {
  test('a padded valid pair is stored trimmed', async () => {
    const { app, store } = appWithStore(makeTwoRepoResolver().fn);
    const res = await callProxy(app, 'POST', KICKOFF, {
      goal: 'walk the stack', target: 'cli', issueIdentifier: 'GB-1',
      issueSource: ' github ', issueBindingScope: ` ${REPO_B} `,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal(doc.issueSource, 'github', 'padded source is stored trimmed');
    assert.equal(doc.issueBindingScope, REPO_B, 'padded scope is stored trimmed');
  });

  test('a lone issueSource (source-only hint) resolves but stamps nothing', async () => {
    const { app, store } = appWithStore(makeResolverForOwnerRow(oneRepoOwnerRow()));
    const res = await callProxy(app, 'POST', KICKOFF, {
      goal: 'walk the stack', target: 'cli', issueIdentifier: 'GB-1', issueSource: 'github',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'a lone source is a hint, never half a pair');
  });

  test('a goal-only kickoff with a valid string pair stamps nothing', async () => {
    const { app, store } = appWithStore(makeTwoRepoResolver().fn);
    const res = await callProxy(app, 'POST', KICKOFF, {
      goal: 'walk the stack', target: 'cli', issueSource: 'github', issueBindingScope: REPO_B,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'no issue named, so no selector is validated or stamped');
  });
});

describe('LIN-3242 review R2 — recommend-and-dispatch persists only a validated, trimmed pair', () => {
  test('a padded valid pair is stored trimmed', async () => {
    const { app, store } = appWithStore(makeTwoRepoResolver().fn);
    const res = await callProxy(app, 'POST', RAD, {
      issueIdentifier: 'GB-1', kind: 'implementation',
      issueSource: ' github ', issueBindingScope: ` ${REPO_B} `,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal(doc.issueSource, 'github', 'padded source is stored trimmed');
    assert.equal(doc.issueBindingScope, REPO_B, 'padded scope is stored trimmed');
  });

  test('a lone issueSource (source-only hint) resolves but stamps nothing', async () => {
    const { app, store } = appWithStore(makeResolverForOwnerRow(oneRepoOwnerRow()));
    const res = await callProxy(app, 'POST', RAD, {
      issueIdentifier: 'GB-1', kind: 'implementation', issueSource: 'github',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'a lone source is a hint, never half a pair');
  });
});

describe('LIN-3242 review R2 — /dispatch repo-only arm stamps nothing', () => {
  test('a repo-only dispatch with a valid STRING pair stamps nothing', async () => {
    const { app, store } = appWithStore(makeTwoRepoResolver().fn);
    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', {
      prompt: 'run me', repo: 'octo/repoB', issueSource: 'github', issueBindingScope: REPO_B,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'the WORKSPACE arm never sees the selector, so it must not stamp it');
  });
});

// recommend-and-dispatch has a SECOND field block: the recommendation-derived
// (LLM descent) arm, reached with no `kind`. It is driven here through the
// test-token short-circuit in `computeRecommendation` (fixture TEST-14 resolves
// to an `implement` action), while the REAL arm still runs the selection: the
// wrapper only swaps the resolved credential for the hermetic sentinel AFTER the
// seam has validated (or refused) the selector, and keeps every other field.
function withTestTokenAfterSelection(fn) {
  return async (urlKey, ownerAccountId, opts) => {
    const out = await fn(urlKey, ownerAccountId, opts);
    return out?.token ? { ...out, token: 'test-token', scope: undefined } : out;
  };
}

describe('LIN-3242 review R2 — recommend-and-dispatch LLM arm persists only a validated, trimmed pair', () => {
  test('a padded valid pair is stored trimmed', async () => {
    const { app, store } = appWithStore(withTestTokenAfterSelection(makeTwoRepoResolver().fn));
    const res = await callProxy(app, 'POST', RAD, {
      issueIdentifier: 'TEST-14', issueSource: ' github ', issueBindingScope: ` ${REPO_B} `,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = store.collection._docs[0];
    assert.equal(doc.issueIdentifier, 'TEST-14', 'the recommendation-derived arm enqueued the row');
    assert.equal(doc.issueSource, 'github', 'padded source is stored trimmed');
    assert.equal(doc.issueBindingScope, REPO_B, 'padded scope is stored trimmed');
  });

  test('a lone issueSource (source-only hint) resolves but stamps nothing', async () => {
    const { app, store } = appWithStore(withTestTokenAfterSelection(makeResolverForOwnerRow(oneRepoOwnerRow())));
    const res = await callProxy(app, 'POST', RAD, { issueIdentifier: 'TEST-14', issueSource: 'github' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'a lone source is a hint, never half a pair');
  });
});

// ── R3 (re-review): stamp only a pair the seam actually SELECTED ─────────────
//
// With no owner session row (logout / session expiry while a proxy token is
// live), the connection-first arm skips selection entirely (LIN-3241 F1's
// deliberate headless path) and serves the Connection — so `findBindingBySelector`
// never saw the body's pair. The route must not stamp it: the seam reports the
// binding it selected (`selectedBinding`), and only that is persisted.
//
// Fails before (recorded 2026-10-05, at merge head c45f8723 + the R2 tests): all
// four return 201 with the body pair stamped —
//   AssertionError [ERR_ASSERTION]: selection never ran, so the pair is unvalidated
//     actual: true, expected: false
// Mutations after the fix: the seam never reporting `selectedBinding` turns 8
// stamp assertions red (this file + the witness); the helper ignoring it turns
// these 4 red.

describe('LIN-3242 review R3 — no owner session row: the unvalidated pair is never stamped', () => {
  const PAIR = { issueSource: 'github', issueBindingScope: REPO_B };

  test('/api/proxy/dispatch serves headless but stamps nothing', async () => {
    const { app, store } = appWithStore(makeResolverForOwnerRow(null));
    const res = await callProxy(app, 'POST', '/api/proxy/dispatch', { prompt: 'run me', ...ISSUE, ...PAIR });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'selection never ran, so the pair is unvalidated');
  });

  test('kickoff serves headless but stamps nothing', async () => {
    const { app, store } = appWithStore(makeResolverForOwnerRow(null));
    const res = await callProxy(app, 'POST', KICKOFF, { goal: 'walk the stack', target: 'cli', issueIdentifier: 'GB-1', ...PAIR });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'selection never ran, so the pair is unvalidated');
  });

  test('recommend-and-dispatch (verb-override) serves headless but stamps nothing', async () => {
    const { app, store } = appWithStore(makeResolverForOwnerRow(null));
    const res = await callProxy(app, 'POST', RAD, { issueIdentifier: 'GB-1', kind: 'implementation', ...PAIR });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'selection never ran, so the pair is unvalidated');
  });

  test('recommend-and-dispatch (LLM arm) serves headless but stamps nothing', async () => {
    const { app, store } = appWithStore(withTestTokenAfterSelection(makeResolverForOwnerRow(null)));
    const res = await callProxy(app, 'POST', RAD, { issueIdentifier: 'TEST-14', ...PAIR });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assertUnstamped(store.collection._docs[0], 'selection never ran, so the pair is unvalidated');
  });
});
