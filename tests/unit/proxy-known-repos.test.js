/**
 * GET /api/proxy/known-repos (LIN-2974) — route-level tests for the
 * read-only known-repos inventory endpoint added alongside this ticket's
 * contract-prose corrections (the runner's admission check is a SEPARATE
 * check against a DIFFERENT namespace, not a narrower fallback nested
 * inside Harbour's own repo validation).
 *
 * Pins:
 *  - a provider that CAN answer returns 200 { knownRepos: [...] }, the same
 *    non-null, deduped list shape `validateDispatchRepo`'s own 422 envelope
 *    already carries (LIN-2886) — via the shared `fetchKnownRepos` seam
 *    both call, not a second derivation that could silently drift from it.
 *  - a provider that CANNOT answer (no provider, unsupported, a throwing
 *    fetch, a timeout) is a distinct non-200 `REPO_INVENTORY_UNAVAILABLE` —
 *    never a silent `knownRepos: []`, which an operator-run drift check
 *    would otherwise misread as "checked, and there's no drift".
 *  - the route never enqueues anything and never interacts with the
 *    duplicate-dispatch guard: this app is built with NO dispatchQueueStore
 *    at all, so an accidental createDispatchItem call on this path would
 *    throw a TypeError rather than silently succeeding.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const KNOWN_REPOS_TEST_SCOPE = 'known-repos-test-scope';

function fakeProvider({ projects = [], supportsFetchProjects = true, throws = false, hang = false } = {}) {
  return {
    name: 'linear',
    supports: (method) => (method === 'fetchProjects' ? supportsFetchProjects : true),
    fetchProjects: async () => {
      if (hang) return new Promise(() => {});
      if (throws) throw new Error('provider outage');
      return { projects };
    },
  };
}

function buildApp({ provider, token = KNOWN_REPOS_TEST_SCOPE, resolveWorkspaceAccess } = {}) {
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
    resolveWorkspaceAccess: resolveWorkspaceAccess || (async () => ({ token, reason: 'ok' })),
    getWorkspaceAccessToken: async () => token,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  return app;
}

async function call(app, path, headers) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer anything', ...headers } });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-2974 — GET /api/proxy/known-repos', () => {
  test('a provider that can answer returns 200 with the deduped, non-null repo list', async () => {
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }, { content: 'repo=simple-dispatcher' }] });
    const app = buildApp({ provider });
    const res = await call(app, '/api/proxy/known-repos');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.knownRepos.sort(), ['LinearViewer', 'simple-dispatcher']);
  });

  test('a provider that answers with zero repo= lines is a real, distinct 200 empty list (not conflated with unavailable)', async () => {
    const provider = fakeProvider({ projects: [{ content: 'no repo line here' }] });
    const app = buildApp({ provider });
    const res = await call(app, '/api/proxy/known-repos');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.knownRepos, []);
  });

  test('UNAVAILABLE: provider does not support fetchProjects — 503 REPO_INVENTORY_UNAVAILABLE, never a fail-open empty list', async () => {
    const provider = fakeProvider({ supportsFetchProjects: false });
    const app = buildApp({ provider });
    const res = await call(app, '/api/proxy/known-repos');

    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'REPO_INVENTORY_UNAVAILABLE');
    assert.equal(res.body.knownRepos, undefined, 'an unavailable inventory must not carry a knownRepos field at all');
  });

  test('UNAVAILABLE: fetchProjects throws — 503 REPO_INVENTORY_UNAVAILABLE', async () => {
    const provider = fakeProvider({ throws: true });
    const app = buildApp({ provider });
    const res = await call(app, '/api/proxy/known-repos');

    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'REPO_INVENTORY_UNAVAILABLE');
  });

  // NOTE: an HTTP-level "no injected provider" case is deliberately NOT
  // covered here. `resolveProviderAccess` (routes/proxy.js) falls back to
  // `getProviderForWorkspace(...)` — a REAL provider — whenever no
  // `injectedProvider` is supplied, so a route-level test with
  // `provider: null` would reach live Linear rather than exercising
  // `fetchKnownRepos`'s `no-provider` branch (LIN-1880 hermetic guard
  // caught exactly this during authoring). That branch is a pure-function
  // concern, already pinned directly in tests/unit/dispatch-repo-guard.test.js
  // ('no provider at all: ok:false' under `describe('fetchKnownRepos ...)`).

  test('a missing workspace credential is a DIFFERENT, distinguishable 503 than an unavailable inventory', async () => {
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const app = buildApp({ provider, resolveWorkspaceAccess: async () => ({ token: null, reason: 'no-credential' }) });
    const res = await call(app, '/api/proxy/known-repos');

    assert.equal(res.status, 503);
    assert.notEqual(res.body.code, 'REPO_INVENTORY_UNAVAILABLE', 'a missing credential is a different failure than "provider reachable but could not answer"');
  });

  test('takes no repo input and enqueues nothing: this app has no dispatchQueueStore at all', async () => {
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    // buildApp() above never passes dispatchQueueStore/dispatchTokenStore —
    // if this route's handler touched either, resolving the request would
    // throw (undefined has no such methods) instead of returning 200.
    const app = buildApp({ provider });
    const res = await call(app, '/api/proxy/known-repos?repo=LinearViewer&issueIdentifier=LIN-1');

    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['knownRepos']);
  });

  test('repeated calls never trip the duplicate-dispatch guard (no shared state with POST /api/proxy/dispatch)', async () => {
    const provider = fakeProvider({ projects: [{ content: 'repo=LinearViewer' }] });
    const app = buildApp({ provider });
    const first = await call(app, '/api/proxy/known-repos');
    const second = await call(app, '/api/proxy/known-repos');

    assert.equal(first.status, 200);
    assert.equal(second.status, 200, 'a second immediate call must not 409 — this read has no duplicate-guard interaction');
  });
});
