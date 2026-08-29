/**
 * LIN-2350 — the consumer-API-reads backstop: `GET /api/proxy/me` and
 * `GET /api/proxy/issues/:id` decline 422 `CAPABILITY_NOT_SUPPORTED` on a
 * provider that cannot serve `viewer`/`issueDetail`, instead of throwing a raw
 * `provider.viewer is not a function` `TypeError` that surfaces as a 500
 * naming the wrong backend (`"Linear API request failed"` on every provider).
 *
 * Unlike `tests/unit/proxy-route-internal-read-backstop.test.js` (LIN-1559),
 * whose four reads are deliberately kept OFF `PROVIDER_SURFACE` and gated on
 * plain method existence, `viewer`/`projects`/`issues`/`issueDetail` are now
 * declared on the surface (LIN-2350's `apiReads` group) precisely so these two
 * ROUTES can gate on `denyIfUnsupported`/`supports()` — the documented "never
 * 500" capability path. Modeled on that file's real-handler pattern.
 *
 * The fixtures are REAL `ProviderInterface` subclasses, not plain objects, and
 * that is load-bearing (LIN-2350 close-out, review finding F1). A plain object
 * with no `viewer`/`issueDetail` properties fails BOTH gates identically —
 * `supports()` is false and `typeof provider.viewer === 'function'` is also
 * false — so swapping the routes to `denyIfMissingRead` would keep this file
 * green while restoring the original 500 on every real provider. A subclass
 * inherits the throwing `NotImplementedError` stub, so `typeof` is TRUE while
 * `supports()` is FALSE: only the capability gate declines, and the wrong gate
 * now fails this file. The first describe block below pins that divergence
 * directly, so the reason survives even if the routes move.
 *
 * Run with: node --test tests/unit/proxy-api-reads-backstop.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { ProviderInterface } from '../../lib/providers/interface.js';

const PROVIDER_NAME = 'apireads-stub';
const ISSUE_ID = 'LIN-900';

/**
 * A provider that cannot serve `viewer`/`issueDetail`, shaped exactly like the
 * real ones this ticket is about (`GitHubProvider`, `JiraProvider`,
 * `GitHubProjectsProvider`): it extends `ProviderInterface` and overrides
 * neither read, so it INHERITS the throwing `NotImplementedError` stubs.
 *
 * Nothing here is hand-stubbed — `supports()` is the real prototype-derived
 * implementation, and it answers false because `this.viewer === base.viewer`.
 * That is what makes this fixture able to tell the two gates apart.
 */
class IncapableProvider extends ProviderInterface {
  constructor() {
    super();
    this.name = PROVIDER_NAME;
  }
}

/**
 * A provider that implements both reads — the control. Also a real subclass, so
 * `supports()` derives true from the genuine override rather than from a
 * hand-written `supports()` that could agree with the route by accident.
 */
class CapableProvider extends ProviderInterface {
  constructor() {
    super();
    this.name = PROVIDER_NAME;
  }
  async viewer() { return { id: 'u-1', name: 'Someone', email: 'someone@example.test' }; }
  async issueDetail(_token, issueId) { return { id: 'iss-1', identifier: issueId, title: 'x' }; }
}

function buildApp(provider) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: PROVIDER_NAME }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' },
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

/** Assert the shared decline envelope, naming the missing read as the capability. */
function assertDeclined({ status, body }, capability) {
  assert.equal(status, 422, `expected 422, got ${status} (${JSON.stringify(body)})`);
  assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(body.capability, capability);
  assert.equal(body.provider, PROVIDER_NAME);
}

/**
 * The reason the routes use `denyIfUnsupported` (capability) and not
 * `denyIfMissingRead` (existence), asserted directly rather than left implicit
 * in the route tests below. Declaring the four reads on `PROVIDER_SURFACE` is
 * what gives every provider an inherited, callable stub — so from that commit
 * on, existence is TRUE for a provider that cannot serve the read, and only the
 * capability gate still says no.
 */
describe('the capability gate is the distinguishing choice, not an arbitrary one', () => {
  test('an incapable provider has callable-but-unsupported reads', () => {
    const provider = new IncapableProvider();
    for (const method of ['viewer', 'issueDetail']) {
      // What `denyIfMissingRead` keys on — a false pass ever since declaration.
      assert.equal(typeof provider[method], 'function',
        `${method} must be inherited and callable, or this fixture cannot tell the gates apart`);
      // What `denyIfUnsupported` keys on — the honest answer.
      assert.equal(provider.supports(method), false,
        `${method} must report unsupported via real prototype-derived capabilities`);
    }
  });

  test('the capable control reports the reads as supported', () => {
    const provider = new CapableProvider();
    assert.equal(provider.supports('viewer'), true);
    assert.equal(provider.supports('issueDetail'), true);
  });
});

describe('an incapable provider declines the two owned consumer-API reads', () => {
  test('GET /api/proxy/me declines 422 naming viewer', async () => {
    const app = buildApp(new IncapableProvider());
    assertDeclined(await call(app, '/api/proxy/me'), 'viewer');
  });

  test('GET /api/proxy/issues/:id declines 422 naming issueDetail', async () => {
    const app = buildApp(new IncapableProvider());
    assertDeclined(await call(app, `/api/proxy/issues/${ISSUE_ID}`), 'issueDetail');
  });
});

describe('the gate is a no-op for a provider that implements the reads', () => {
  test('GET /api/proxy/me succeeds (control)', async () => {
    const app = buildApp(new CapableProvider());
    const res = await call(app, '/api/proxy/me');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.notEqual(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
  });

  test('GET /api/proxy/issues/:id succeeds (control)', async () => {
    const app = buildApp(new CapableProvider());
    const res = await call(app, `/api/proxy/issues/${ISSUE_ID}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.notEqual(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
  });
});
