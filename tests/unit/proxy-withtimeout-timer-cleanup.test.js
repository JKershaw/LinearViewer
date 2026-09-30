/**
 * LIN-3158 — the live /prompt path must not leave a long timeout timer armed.
 *
 * `routes/proxy.js`'s `withTimeout(promise, ms)` races the provider call against
 * a `setTimeout(..., ms)` and, unlike its sibling `fetchWithTimeout`, never
 * cleared that timer on a fast settle. The route's live path
 * (`resolvePromptIssueContext` -> `withTimeout(provider.fetchIssueContext(...),
 * GRAPHQL_TIMEOUT_MS)`) therefore left a 25 000 ms `Timeout` ref alive after the
 * response had already been sent, which held the short-lived unit-test process
 * open for the full 25 s. Four live-path files paid that tax per run (LIN-3158).
 *
 * This guard drives ONE real live (non-isTestMode) `/prompt` request through
 * the router — the same harness shape as
 * tests/unit/proxy-provider-routed-compute.test.js — with `global.setTimeout` /
 * `global.clearTimeout` patched to record every long (>=20 s) handle and every
 * handle cleared. When the HTTP response resolves, every long timer created
 * during the request must already be in the cleared set. A second case drives
 * the provider-rejection path and asserts the same, so the cleanup provably runs
 * on both settle paths.
 *
 * The patch returns the REAL, ref'd handle (no `unref`, unlike the workaround in
 * routed-compute) so this test is a genuine witness of the leak; to keep a red
 * run from idling the full 25 s it `unref()`s any still-uncleared recorded
 * handle in its own `finally`, so the assertion failure is reported promptly.
 *
 * Run with: node --test tests/unit/proxy-withtimeout-timer-cleanup.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProviderInterface } from '../../lib/providers/interface.js';

const NON_TEST_TOKEN = 'fake-jira-shaped-token';
const LONG_TIMER_MS = 20_000;

/**
 * A minimal injectable provider whose `fetchIssueContext` is set as an instance
 * property (so `provider.supports('fetchIssueContext')` reports true), and which
 * records its calls. Named `jira` so a bug that falls back to a hardcoded Linear
 * branch cannot coincidentally pass.
 */
class FakeContextProvider extends ProviderInterface {
  constructor({ name = 'jira', fetchIssueContext } = {}) {
    super();
    this.name = name;
    this.calls = [];
    this.fetchIssueContext = async (...args) => {
      this.calls.push({ fn: 'fetchIssueContext', args });
      return fetchIssueContext(...args);
    };
  }
}

function buildApp({ provider }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    // Token is deliberately NOT 'test-token', so the request takes the LIVE path
    // (isTestMode === false) and genuinely reaches resolvePromptIssueContext ->
    // withTimeout. The mock-fixture shortcut would bypass the very seam here.
    resolveWorkspaceAccess: async () => ({ token: NON_TEST_TOKEN, reason: 'ok' }),
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

/** A minimal canonical issue-context shape (the live-path contract). */
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

/**
 * Drive one request with long-timer recording installed. Returns the HTTP
 * status/body plus the recorded handles/clears; on the way out it unrefs any
 * recorded-but-uncleared handle so a red run fails fast instead of idling.
 */
async function request(app, method, path) {
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const created = new Map();
  const cleared = new Set();

  global.setTimeout = (fn, ms, ...rest) => {
    const handle = realSetTimeout(fn, ms, ...rest);
    if (typeof ms === 'number' && ms >= LONG_TIMER_MS) created.set(handle, ms);
    return handle;
  };
  global.clearTimeout = (handle) => {
    cleared.add(handle);
    return realClearTimeout(handle);
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything' },
    });
    let body = {};
    try { body = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body, created, cleared };
  } finally {
    // Fail-fast: a leaked ref'd handle would otherwise hold the test process
    // open for its full ms before the assertion failure is even reported.
    for (const handle of created.keys()) {
      if (!cleared.has(handle)) handle.unref?.();
    }
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    await new Promise(resolve => server.close(resolve));
  }
}

function assertAllLongTimersCleared({ created, cleared }) {
  assert.ok(created.size >= 1, 'expected the live path to arm at least one >=20s timer (guards against a vacuous test)');
  const uncleared = [...created.entries()].filter(([handle]) => !cleared.has(handle));
  assert.equal(
    uncleared.length, 0,
    `live path left ${uncleared.length} long timer(s) uncleared: ` +
      uncleared.map(([, ms]) => `${ms}ms`).join(', ')
  );
}

describe('the live /prompt path clears every long timer it arms (LIN-3158)', () => {
  test('a successful provider response clears the withTimeout timer before the response resolves', async () => {
    const provider = new FakeContextProvider({
      fetchIssueContext: async () => fakeContext({ id: 'jira-uuid-1', identifier: 'ENG-9', title: 't' }),
    });
    const result = await request(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/prompt/implementation');

    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(provider.calls.length, 1);
    assertAllLongTimersCleared(result);
  });

  test('a rejected provider call clears the withTimeout timer before the response resolves', async () => {
    const provider = new FakeContextProvider({
      fetchIssueContext: async () => { throw new Error('upstream exploded'); },
    });
    const result = await request(buildApp({ provider }), 'GET', '/api/proxy/issues/ENG-9/prompt/implementation');

    assert.ok(result.status >= 400, `expected an error status, got ${result.status}`);
    assert.equal(provider.calls.length, 1);
    assertAllLongTimersCleared(result);
  });
});
