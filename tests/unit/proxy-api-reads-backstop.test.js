/**
 * LIN-2350 / LIN-2355 — the consumer-API-reads backstop: eight ungated GET
 * routes (`/me`, `/issues/:id`, `/projects`, `/issues`, `/search`,
 * `/states/:teamId`, `/labels`, `/cycles`, `/cycles/:cycleId`,
 * `/issues/:id/relations` — `viewer`+`issueDetail` from LIN-2350, the other
 * eight from LIN-2355) decline 422 `CAPABILITY_NOT_SUPPORTED` on a provider
 * that cannot serve the read, instead of throwing a raw
 * `provider.<method> is not a function` `TypeError` (LIN-2350's two) or an
 * inherited `NotImplementedError` (LIN-2355's eight) that both surfaced as a
 * 500 naming the wrong backend (`"Linear API request failed"` on every
 * provider).
 *
 * Unlike `tests/unit/proxy-route-internal-read-backstop.test.js` (LIN-1559),
 * whose four reads are deliberately kept OFF `PROVIDER_SURFACE` and gated on
 * plain method existence, every method here is declared on the surface
 * (`apiReads`: `viewer`/`projects`/`issues`/`issueDetail`; `readsHeadroom`:
 * `search`/`states`/`labels`/`cycles`/`cycleDetail`/`relations`) precisely so
 * these routes can gate on `denyIfUnsupported`/`supports()` — the documented
 * "never 500" capability path. Modeled on that file's real-handler pattern.
 *
 * The fixtures are REAL `ProviderInterface` subclasses, not plain objects, and
 * that is load-bearing (LIN-2350 close-out, review finding F1). A plain object
 * with no method properties fails BOTH gates identically — `supports()` is
 * false and `typeof provider.<method> === 'function'` is also false — so
 * swapping the routes to `denyIfMissingRead` would keep this file green while
 * restoring the original 500 on every real provider. A subclass inherits the
 * throwing `NotImplementedError` stub, so `typeof` is TRUE while `supports()`
 * is FALSE: only the capability gate declines, and the wrong gate now fails
 * this file. The first describe block below pins that divergence directly, so
 * the reason survives even if the routes move.
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
const CYCLE_ID = '11111111-1111-4111-8111-111111111111';

/** The eight methods LIN-2355 gates, alongside LIN-2350's `viewer`/`issueDetail`. */
const LIN_2355_METHODS = ['projects', 'issues', 'search', 'states', 'labels', 'cycleDetail', 'relations', 'cycles'];

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
  async projects() { return [{ id: 'p-1', name: 'Project One' }]; }
  async issues() { return { nodes: [{ id: 'iss-1', identifier: ISSUE_ID, title: 'x' }], pageInfo: {} }; }
  async search() { return [{ id: 'iss-1', identifier: ISSUE_ID, title: 'x' }]; }
  async states() { return [{ id: 's-1', name: 'Todo', type: 'unstarted' }]; }
  async labels() { return [{ id: 'l-1', name: 'bug' }]; }
  async cycles() { return [{ id: 'c-1', name: 'Cycle 1' }]; }
  async cycleDetail(_token, cycleId) { return { id: cycleId, name: 'Cycle 1' }; }
  async relations(_token, issueId) { return { id: issueId, relations: [], inverseRelations: [] }; }
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
    for (const method of ['viewer', 'issueDetail', ...LIN_2355_METHODS]) {
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
    for (const method of ['viewer', 'issueDetail', ...LIN_2355_METHODS]) {
      assert.equal(provider.supports(method), true, `${method} should be supported`);
    }
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

// LIN-2355: the eight route-level `denyIfUnsupported` gates added to the
// remaining ungated consumer-API reads (six `readsHeadroom` members plus the
// two still-ungated `apiReads` members, `projects`/`issues`).
const LIN_2355_ROUTES = [
  { method: 'projects', path: '/api/proxy/projects' },
  { method: 'issues', path: '/api/proxy/issues' },
  { method: 'search', path: '/api/proxy/search?q=foo' },
  { method: 'states', path: '/api/proxy/states/team-1' },
  { method: 'labels', path: '/api/proxy/labels' },
  { method: 'cycles', path: '/api/proxy/cycles' },
  { method: 'cycleDetail', path: `/api/proxy/cycles/${CYCLE_ID}` },
  { method: 'relations', path: `/api/proxy/issues/${ISSUE_ID}/relations` },
];

describe('an incapable provider declines the eight LIN-2355 headroom/apiReads gates', () => {
  for (const { method, path } of LIN_2355_ROUTES) {
    test(`GET ${path} declines 422 naming ${method}`, async () => {
      const app = buildApp(new IncapableProvider());
      assertDeclined(await call(app, path), method);
    });
  }
});

describe('the LIN-2355 gates are a no-op for a provider that implements the reads', () => {
  for (const { method, path } of LIN_2355_ROUTES) {
    test(`GET ${path} succeeds (control)`, async () => {
      const app = buildApp(new CapableProvider());
      const res = await call(app, path);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.notEqual(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
    });
  }
});

/**
 * A provider that is incapable of `issues` (and every other LIN-2355 read)
 * but DOES implement `fetchTeams` — with a call counter — so the ordering
 * claim (the capability decline fires before the `fetchTeams` team-membership
 * pre-read on `/issues`, `/labels`, `/cycles`) is a positive assertion rather
 * than an accident of `fetchTeams` also being unimplemented.
 */
class FetchTeamsCountingProvider extends IncapableProvider {
  constructor() {
    super();
    this.fetchTeamsCalls = 0;
  }
  async fetchTeams() {
    this.fetchTeamsCalls += 1;
    return [];
  }
}

describe('the capability decline fires before the fetchTeams pre-read', () => {
  test('GET /api/proxy/issues?teamId=... declines without calling fetchTeams', async () => {
    const provider = new FetchTeamsCountingProvider();
    const app = buildApp(provider);
    assertDeclined(await call(app, '/api/proxy/issues?teamId=team-1'), 'issues');
    assert.equal(provider.fetchTeamsCalls, 0,
      'fetchTeams must not be called once the capability gate has already declined');
  });

  test('GET /api/proxy/labels?teamId=... declines without calling fetchTeams', async () => {
    const provider = new FetchTeamsCountingProvider();
    const app = buildApp(provider);
    assertDeclined(await call(app, '/api/proxy/labels?teamId=team-1'), 'labels');
    assert.equal(provider.fetchTeamsCalls, 0,
      'fetchTeams must not be called once the capability gate has already declined');
  });

  test('GET /api/proxy/cycles?teamId=... declines without calling fetchTeams', async () => {
    const provider = new FetchTeamsCountingProvider();
    const app = buildApp(provider);
    assertDeclined(await call(app, '/api/proxy/cycles?teamId=team-1'), 'cycles');
    assert.equal(provider.fetchTeamsCalls, 0,
      'fetchTeams must not be called once the capability gate has already declined');
  });
});
