/**
 * LIN-1948 fix 2 — the dangling-referent guard on dispatch creation.
 *
 * A dispatch naming an `issueIdentifier` that resolves to no issue is refused
 * with 422 ISSUE_NOT_FOUND before the item is created. This would have stopped
 * all twelve phantom rows in LIN-1946, and the thirteenth that landed on
 * 2026-08-10 while the fix was parked.
 *
 * THE ASSERTION THAT MATTERS IS `addItem` WAS NEVER CALLED. A 422 with a row
 * still written would be a silent regression completely invisible in the
 * response body, so every refusal case checks the store, not just the status.
 *
 * The fail-open cases get equal billing with the refusal: dispatch has never
 * required provider access and must not start now — a Linear outage must never
 * become a dispatch outage. Each is asserted as "the dispatch still succeeds",
 * not merely "no error".
 *
 * Covers both creating lanes: the proxy-token route (surface 2a) and the
 * session-cookie route (surface 2d), which resolve credentials completely
 * differently and so could regress independently.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { isDanglingReferent, ISSUE_NOT_FOUND_CODE } from '../../lib/dispatch-referent-guard.js';

// A provider whose issueWriteGuard resolves identifiers, like Linear's.
function fakeProvider({ resolves = true, throws = false, name = 'linear', omitGuard = false } = {}) {
  const p = { name, supports: () => true };
  if (!omitGuard) {
    p.issueWriteGuard = async (_token, id) => {
      if (throws) throw new Error('provider outage');
      return resolves ? { id, trashed: false, team: { id: 't' } } : null;
    };
  }
  return p;
}

function buildProxyApp(captured, { provider, token = 'test-token' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    provider,
    proxyTokenStore: {
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason: token ? 'ok' : 'no_credential' }),
    getWorkspaceAccessToken: async () => token,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        captured.calls = (captured.calls || 0) + 1;
        captured.item = item;
        return { _id: 'disp-1', dispatchedAt: '2026-08-10T00:00:00.000Z', ...item };
      }
    },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, method, path, body, headers = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: { Authorization: 'Bearer anything', ...headers } };
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

describe('LIN-1948 — the pure predicate fails open on everything non-definitive', () => {
  test('refuses ONLY on a definitive null from the provider lookup', async () => {
    assert.equal(await isDanglingReferent({
      provider: fakeProvider({ resolves: false }), token: 'T', issueIdentifier: 'TEST-1'
    }), true);
  });

  test('allows when the identifier resolves', async () => {
    assert.equal(await isDanglingReferent({
      provider: fakeProvider({ resolves: true }), token: 'T', issueIdentifier: 'LIN-1948'
    }), false);
  });

  test('allows when no identifier was supplied (wakes and identifier-less customs stay legal)', async () => {
    for (const id of [null, undefined, '']) {
      assert.equal(await isDanglingReferent({
        provider: fakeProvider({ resolves: false }), token: 'T', issueIdentifier: id
      }), false, `identifier ${JSON.stringify(id)} must not be checked`);
    }
  });

  test('FAIL-OPEN: no credential resolves', async () => {
    assert.equal(await isDanglingReferent({
      provider: fakeProvider({ resolves: false }), token: null, issueIdentifier: 'TEST-1'
    }), false);
  });

  test('FAIL-OPEN: provider lacks issueWriteGuard — SKIPPED, never refused', async () => {
    // The exact inversion finding E warned about: reusing denyIfMissingRead here
    // would 422 every dispatch on a github-projects-backed workspace.
    assert.equal(await isDanglingReferent({
      provider: fakeProvider({ name: 'github-projects', omitGuard: true }), token: 'T', issueIdentifier: 'TEST-1'
    }), false);
  });

  test('FAIL-OPEN: the probe throws (an outage must never become a dispatch outage)', async () => {
    assert.equal(await isDanglingReferent({
      provider: fakeProvider({ throws: true }), token: 'T', issueIdentifier: 'TEST-1'
    }), false);
  });

  test('FAIL-OPEN: a provider whose lookup does not speak identifiers is not consulted', async () => {
    // GitHub resolves by issue NUMBER, so null there means "not a number", not
    // "no such issue" — it would refuse a perfectly valid LIN-style identifier.
    assert.equal(await isDanglingReferent({
      provider: fakeProvider({ name: 'github', resolves: false }), token: 'T', issueIdentifier: 'LIN-1948'
    }), false);
  });

  test('a null provider allows rather than throwing', async () => {
    assert.equal(await isDanglingReferent({ provider: null, token: 'T', issueIdentifier: 'TEST-1' }), false);
  });
});

describe('LIN-1948 surface 2a — POST /api/proxy/dispatch', () => {
  test('refuses a dangling referent with 422 ISSUE_NOT_FOUND and creates NO item', async () => {
    const captured = {};
    const app = buildProxyApp(captured, { provider: fakeProvider({ resolves: false }) });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'do the thing', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 422);
    assert.equal(res.body.code, ISSUE_NOT_FOUND_CODE);
    assert.equal(res.body.issueIdentifier, 'TEST-1');
    // The whole point: nothing was queued.
    assert.equal(captured.calls, undefined, 'addItem must never be called on a refusal');
  });

  test('allows a referent that resolves', async () => {
    const captured = {};
    const app = buildProxyApp(captured, { provider: fakeProvider({ resolves: true }) });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'real work', issueIdentifier: 'LIN-1948' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.calls, 1);
  });

  test('allows an identifier-less dispatch without consulting the provider at all', async () => {
    const captured = {};
    let probed = false;
    const provider = fakeProvider({ resolves: false });
    const guard = provider.issueWriteGuard;
    provider.issueWriteGuard = async (...a) => { probed = true; return guard(...a); };

    const app = buildProxyApp(captured, { provider });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'a wake, no ticket' });

    assert.equal(res.status, 201);
    assert.equal(captured.calls, 1);
    assert.equal(probed, false, 'no referent named ⇒ no provider round-trip');
  });

  test('FAIL-OPEN at the route: no credential ⇒ the dispatch still succeeds', async () => {
    const captured = {};
    const app = buildProxyApp(captured, { provider: fakeProvider({ resolves: false }), token: null });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'x', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201, 'a missing credential must not block dispatch');
    assert.equal(captured.calls, 1);
  });

  test('FAIL-OPEN at the route: provider without issueWriteGuard ⇒ the dispatch still succeeds', async () => {
    const captured = {};
    const app = buildProxyApp(captured, { provider: fakeProvider({ name: 'github-projects', omitGuard: true }) });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'x', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201, 'a provider lacking the capability must be SKIPPED, not refused');
    assert.equal(captured.calls, 1);
  });

  test('FAIL-OPEN at the route: a throwing probe ⇒ the dispatch still succeeds', async () => {
    const captured = {};
    const app = buildProxyApp(captured, { provider: fakeProvider({ throws: true }) });
    const res = await call(app, 'post', '/api/proxy/dispatch', { prompt: 'x', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201, 'a provider outage must not become a dispatch outage');
    assert.equal(captured.calls, 1);
  });

  test('an abort is never blocked by a dangling referent — a cancel must always land', async () => {
    const captured = {};
    const app = buildProxyApp(captured, { provider: fakeProvider({ resolves: false }) });
    const res = await call(app, 'post', '/api/proxy/dispatch', {
      abort: true, abortTo: '11111111-2222-3333-4444-555555555555', issueIdentifier: 'TEST-1'
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.calls, 1);
  });
});

describe('LIN-1948 surface 2d — POST /workspace/:urlKey/api/dispatch (session-auth lane)', () => {
  function buildSessionApp(captured, { provider, accessToken = 'test-token' } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.session = { accountId: 'acct-1' }; next(); });
    app.use(createDispatchRoutes({
      provider,
      dispatchQueueStore: {
        addItem: async (urlKey, item) => {
          captured.calls = (captured.calls || 0) + 1;
          captured.item = item;
          return { _id: 'disp-2', dispatchedAt: '2026-08-10T00:00:00.000Z', ...item };
        }
      },
      dispatchTokenStore: {},
      workspaceFromUrl: (req, _res, next) => {
        // A credential-bearing workspace: this lane reads its token through
        // getWorkspaceCallScope, NOT through resolveProviderAccess. A workspace
        // without one is the no-credential fail-open case, covered separately
        // below — using it here would make the refusal test silently vacuous.
        req.workspace = { urlKey: req.params.urlKey, id: 'ws-1', accessToken };
        next();
      },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: {},
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      dispatchPresetsStore: {},
      proxyTokenStore: {}
    }));
    return app;
  }

  test('refuses a dangling referent with 422 and creates NO item', async () => {
    const captured = {};
    const app = buildSessionApp(captured, { provider: fakeProvider({ resolves: false }) });
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', { prompt: 'do the thing', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 422, `expected 422, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, ISSUE_NOT_FOUND_CODE);
    assert.equal(captured.calls, undefined, 'addItem must never be called on a refusal');
  });

  test('allows a referent that resolves', async () => {
    const captured = {};
    const app = buildSessionApp(captured, { provider: fakeProvider({ resolves: true }) });
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', { prompt: 'real work', issueIdentifier: 'LIN-1948' });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(captured.calls, 1);
  });

  test('FAIL-OPEN: a throwing probe ⇒ the dispatch still succeeds on this lane too', async () => {
    const captured = {};
    const app = buildSessionApp(captured, { provider: fakeProvider({ throws: true }) });
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', { prompt: 'x', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201);
    assert.equal(captured.calls, 1);
  });

  test('FAIL-OPEN: a workspace with no resolvable credential ⇒ the dispatch still succeeds', async () => {
    const captured = {};
    const app = buildSessionApp(captured, { provider: fakeProvider({ resolves: false }), accessToken: null });
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', { prompt: 'x', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201, 'no credential ⇒ skip the check, never block dispatch');
    assert.equal(captured.calls, 1);
  });

  test('FAIL-OPEN: provider without issueWriteGuard is skipped, not refused', async () => {
    const captured = {};
    const app = buildSessionApp(captured, { provider: fakeProvider({ name: 'github-projects', omitGuard: true }) });
    const res = await call(app, 'post', '/workspace/acme/api/dispatch', { prompt: 'x', issueIdentifier: 'TEST-1' });

    assert.equal(res.status, 201);
    assert.equal(captured.calls, 1);
  });
});
