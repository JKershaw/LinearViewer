/**
 * LIN-2044 — the compute-endpoint capability backstop and provider routing.
 *
 * Steps 1-6 re-pointed routes/proxy.js's compute fetchers (stack/prompt/
 * recommend/recap/brief) off a static Linear import onto the request's own
 * ACTIVE provider (`resolveProviderAccess` -> `provider.fetch*`), and Step 4
 * added a `denyIfUnsupported` capability gate at all 11 physically reachable
 * entry points so a provider that doesn't implement a compute fetcher declines
 * cleanly with 422 `CAPABILITY_NOT_SUPPORTED` instead of 500ing or silently
 * falling through to Linear.
 *
 * Neither of those was exercised by a request/response test before this file:
 * the 3 pinning-test updates (beat 3) are source-shape assertions, and the
 * Jira e2e witness (tests/e2e/proxy.spec.js) only ever drives a provider that
 * DOES support every method. This file closes that gap at the fast unit
 * layer, using the existing `injectedProvider` TEST-ONLY seam
 * (`createProxyRoutes({ provider })`) the way
 * tests/unit/proxy-github-credential-scope.test.js and
 * tests/unit/proxy-attachment-relay.test.js already do — a provider that
 * extends `ProviderInterface` and only overrides the methods it's given, so
 * `provider.supports(method)` (prototype-override detection, the same
 * mechanism `denyIfUnsupported` consults in production) reports exactly what
 * each test needs it to.
 *
 * Two things per gated method: (1) a provider that does NOT implement it gets
 * 422 CAPABILITY_NOT_SUPPORTED, and the method is never actually invoked; (2)
 * a provider that DOES implement it is the one actually called — proven by a
 * recorded call plus a distinctive, provider-supplied value round-tripping
 * into the response, not just a 200 status (a silent fallback to some other
 * source could also 200).
 *
 * `resolveWorkspaceAccess` deliberately returns a token that is NOT
 * 'test-token', so these requests take the LIVE path (isTestMode === false)
 * and genuinely reach `provider.fetch*` — the mock-fixture shortcut would
 * bypass the very seam this file exists to test.
 *
 * Run with: node --test tests/unit/proxy-provider-routed-compute.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProviderInterface } from '../../lib/providers/interface.js';

const NON_TEST_TOKEN = 'fake-jira-shaped-token';

/**
 * A minimal injectable provider (LIN-2044): each of `fetchProjects`,
 * `fetchIssueContext`, `fetchRecommendationContext` is set as an instance
 * property ONLY when an implementation is supplied, so
 * `provider.supports(method)` correctly reports false when omitted (it then
 * resolves to the base class's throwing stub, exactly like a real provider
 * that hasn't implemented the capability) — mirrors
 * tests/unit/proxy-attachment-relay.test.js's `FakeAttachmentProvider`.
 * Named `jira` (never `linear`) so a bug that accidentally hardcodes the
 * Linear branch, or falls through to it, cannot coincidentally pass.
 */
class FakeComputeProvider extends ProviderInterface {
  constructor({ name = 'jira', fetchProjects, fetchIssueContext, fetchRecommendationContext } = {}) {
    super();
    this.name = name;
    this.calls = [];
    if (fetchProjects) {
      this.fetchProjects = async (...args) => {
        this.calls.push({ fn: 'fetchProjects', args });
        return fetchProjects(...args);
      };
    }
    if (fetchIssueContext) {
      this.fetchIssueContext = async (...args) => {
        this.calls.push({ fn: 'fetchIssueContext', args });
        return fetchIssueContext(...args);
      };
    }
    if (fetchRecommendationContext) {
      this.fetchRecommendationContext = async (...args) => {
        this.calls.push({ fn: 'fetchRecommendationContext', args });
        return fetchRecommendationContext(...args);
      };
    }
  }
}

function buildApp({ provider, resolveWorkspaceAccess } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: resolveWorkspaceAccess || (async () => ({ token: NON_TEST_TOKEN, reason: 'ok' })),
    getWorkspaceAccessToken: async () => NON_TEST_TOKEN,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, put: async () => {} },
    briefCacheStore: { get: async () => null, put: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return app;
}

// The /prompt route's live path (resolvePromptIssueContext -> withTimeout,
// routes/proxy.js) races the real provider call against a 25s setTimeout via
// Promise.race and — unlike its sibling fetchWithTimeout, whose own doc
// comment contrasts this explicitly — never clears that timer on a fast
// success. Harmless in production (a long-lived server doesn't care about a
// stray 25s reject() on an already-settled race), but it holds this
// short-lived test process open until the real timer fires, which is what
// every OTHER test file exercising this route works around by only ever
// driving it through the isTestMode/mock-fixture shortcut (token ===
// 'test-token') — the one path this file must NOT take, since it exists to
// prove the LIVE provider routing. Unref every timer scheduled during the
// call instead: the timer still fires and still no-ops exactly as it does in
// production, it just no longer blocks process exit.
async function call(app, method, path) {
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (...args) => realSetTimeout(...args).unref?.();
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything' },
    });
    let body = {};
    try { body = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body };
  } finally {
    global.setTimeout = realSetTimeout;
    await new Promise(resolve => server.close(resolve));
  }
}

// A minimal, provider-agnostic canonical issue-context shape — the same shape
// resolvePromptIssueContext's own test-mode mock builder returns (routes/proxy.js),
// which IS the live-path contract every provider's fetchIssueContext/
// fetchRecommendationContext must satisfy.
function fakeContext({ id, identifier, title }) {
  return {
    issue: {
      id, identifier, title,
      description: 'a description', state: { name: 'To Do', type: 'unstarted' },
      labels: [], url: `https://example.atlassian.net/browse/${identifier}`,
    },
    parent: null, siblings: [], project: null, children: [], comments: [], attachments: [],
  };
}

describe('Proxy compute routes decline cleanly when the resolved provider lacks the capability (LIN-2044 Step 4)', () => {
  test('GET /api/proxy/stack: a provider without fetchProjects declines with 422 CAPABILITY_NOT_SUPPORTED', async () => {
    const provider = new FakeComputeProvider();
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/stack');
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'fetchProjects');
    assert.deepEqual(provider.calls, [], 'fetchProjects must never be invoked once the gate declines');
  });

  test('GET .../prompt/:templateKey: a provider without fetchIssueContext declines with 422 CAPABILITY_NOT_SUPPORTED', async () => {
    const provider = new FakeComputeProvider();
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/prompt/implementation');
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'fetchIssueContext');
    assert.deepEqual(provider.calls, []);
  });

  test('GET .../recap: a provider without fetchRecommendationContext declines with 422 CAPABILITY_NOT_SUPPORTED', async () => {
    const provider = new FakeComputeProvider();
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/recap');
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'fetchRecommendationContext');
    assert.deepEqual(provider.calls, []);
  });

  test('GET .../brief: a provider without fetchRecommendationContext declines with 422 CAPABILITY_NOT_SUPPORTED', async () => {
    const provider = new FakeComputeProvider();
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/brief');
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'fetchRecommendationContext');
    assert.deepEqual(provider.calls, []);
  });

  test('GET /api/proxy/issues/:identifier/recommend: a provider missing BOTH gated methods declines on the descent path (fetchRecommendationContext), not a 500', async () => {
    // /recommend gates fetchIssueContext (kind-override branch) AND
    // fetchRecommendationContext (computeRecommendation's default descent) —
    // Note A of the plan-review: the latter is gated at the route's own
    // resolution point since computeRecommendation has no req/res of its own.
    // With no ?kind= override, the descent path runs first, so this provider
    // must decline on fetchRecommendationContext specifically.
    const provider = new FakeComputeProvider();
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/recommend');
    assert.equal(status, 422, JSON.stringify(body));
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.deepEqual(provider.calls, []);
  });
});

describe('Proxy compute routes call the RESOLVED provider\'s own method — never a hardcoded Linear client (LIN-2044 Steps 1-3)', () => {
  test('GET /api/proxy/stack calls provider.fetchProjects with the resolved (non-Linear) access token', async () => {
    const provider = new FakeComputeProvider({
      fetchProjects: async () => ({ projects: [], issues: [] }),
    });
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/stack');
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].fn, 'fetchProjects');
    assert.equal(provider.calls[0].args[0], NON_TEST_TOKEN, 'must receive the resolved access token, not a Linear-specific one');
  });

  test('GET .../prompt/:templateKey calls provider.fetchIssueContext, and the generated prompt is built from THAT provider\'s own data', async () => {
    const distinctiveTitle = 'JIRA-ONLY-TITLE-4f7c2a';
    const provider = new FakeComputeProvider({
      fetchIssueContext: async () => fakeContext({ id: 'jira-uuid-1', identifier: 'ENG-9', title: distinctiveTitle }),
    });
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/prompt/implementation');
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].fn, 'fetchIssueContext');
    assert.equal(provider.calls[0].args[0], NON_TEST_TOKEN);
    assert.equal(provider.calls[0].args[1], 'ENG-9');
    assert.match(body.prompt, new RegExp(distinctiveTitle), 'the rendered prompt must embed the resolved provider\'s own issue title — a fallback to Linear (or to nothing) could not produce this string');
  });

  test('GET .../recap calls provider.fetchRecommendationContext, and the response reflects THAT provider\'s own identifier — never a 401 (the Jira-token-sent-to-Linear symptom)', async () => {
    const provider = new FakeComputeProvider({
      fetchRecommendationContext: async () => fakeContext({ id: 'jira-uuid-1', identifier: 'ENG-9', title: 'irrelevant' }),
    });
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/recap?noRefresh=1');
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].fn, 'fetchRecommendationContext');
    assert.equal(provider.calls[0].args[0], NON_TEST_TOKEN);
    assert.equal(provider.calls[0].args[1], 'ENG-9');
    assert.equal(body.status, 'missing', 'a never-cached issue with noRefresh=1 short-circuits before any LLM call');
    assert.equal(body.identifier, 'ENG-9');
  });

  test('GET .../brief mirrors the recap seam: calls provider.fetchRecommendationContext, reflects that provider\'s own identifier', async () => {
    const provider = new FakeComputeProvider({
      fetchRecommendationContext: async () => fakeContext({ id: 'jira-uuid-2', identifier: 'ENG-10', title: 'irrelevant' }),
    });
    const { status, body } = await call(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-10/brief?noRefresh=1');
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].fn, 'fetchRecommendationContext');
    assert.equal(body.identifier, 'ENG-10');
  });
});
