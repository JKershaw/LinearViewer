/**
 * Unit tests for GET /workspace/:urlKey/api/detail/:issueId (LIN-1903).
 *
 * The dashboard tree merges issues across ALL of a workspace's bindings
 * (LIN-544), but this route previously always resolved the WORKSPACE's active
 * provider/scope (`getProviderForWorkspace`/`getWorkspaceCallScope`) — so a
 * foreign-source row's id-only drill-down was silently handed to the wrong
 * provider, with the wrong provider's credential. The fix threads the issue's
 * own provenance through as a `source` query param and resolves THAT binding
 * (`getBindingsForWorkspace(workspace).find(b => b.provider === source)` +
 * `getBindingCallScope(binding)`) instead, falling back to the pre-existing
 * workspace-level resolution when `source` is absent or matches no binding.
 *
 * Two fake providers registered in the real registry, one two-binding
 * workspace, matching this ticket's decisive experiment: the only variable
 * between requests is the `source` query param, so the resolved provider is
 * the ONLY thing under test.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

before(() => { process.env.NODE_ENV = 'test'; });

// `renderDetailsContent` (the response body) renders the description, not the
// title (the title lives in the collapsed `.line`, a separate render path) —
// so assertions below match on `description`, a distinct marker per issue.
const ACTIVE_ISSUE = { id: 'active-1', identifier: 'ACT-1', title: 'Active-binding issue', description: 'ACTIVE_BINDING_MARKER', state: { name: 'Todo', type: 'unstarted' } };
const SECONDARY_ISSUE = { id: 'secondary-1', identifier: 'SEC-1', title: 'Secondary-binding issue', description: 'SECONDARY_BINDING_MARKER', state: { name: 'Todo', type: 'unstarted' } };

let providerSeq = 0;

/** Register a fake provider under a unique name, so tests never contend over one shared registry slot. */
function fakeProvider(issue, { seenScopes, seenContextScopes } = {}) {
  const name = `fake-detail-${++providerSeq}`;
  registerProvider({
    name,
    ui: {},
    supports: () => true,
    fetchIssueFields: async (scope, issueId) => {
      if (seenScopes) seenScopes.push(scope);
      if (issueId !== issue.id) throw new Error(`Issue not found: ${issueId}`);
      return issue;
    },
    // LIN-1904: /api/autopilot-prompt resolves through fetchIssueContext, not
    // fetchIssueFields — a separate method on the same fake provider so the
    // route-level test below can assert the SAME binding-scoped-resolution
    // contract on this consumer too.
    fetchIssueContext: async (scope, issueId) => {
      if (seenContextScopes) seenContextScopes.push(scope);
      if (issueId !== issue.id) throw new Error(`Issue not found: ${issueId}`);
      return { issue, project: null };
    },
  });
  return name;
}

/** Mount the workspace-api router with an injected workspace carrying two bindings. */
function buildApp(workspace, { features = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = workspace;
      req.session = { features };
      next();
    },
    freeTierStore: {},
    getOpenRouterSource: () => null,
    userPreferencesStore: {},
    workspacePreferencesStore: {},
    customPromptsStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    reportHistoryStore: {},
    dispatchQueueStore: {},
    agentStatusStore: {},
    promptTraceStore: {},
    proxyTokenStore: {},
  }));
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const get = async (path) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  };
  try {
    return await fn(get);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('GET /workspace/:urlKey/api/detail/:issueId — binding-scoped provider resolution', () => {
  test('no `source` param → unchanged workspace-level resolution (active provider, active scope)', async () => {
    const activeScopes = [];
    const activeName = fakeProvider(ACTIVE_ISSUE, { seenScopes: activeScopes });
    const secondaryName = fakeProvider(SECONDARY_ISSUE);
    const workspace = {
      urlKey: 'test-workspace',
      provider: activeName,
      accessToken: 'active-token',
      bindings: [
        { provider: activeName, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondaryName, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const app = buildApp(workspace);
    const { status, body } = await withServer(app, get => get(`/workspace/test-workspace/api/detail/${ACTIVE_ISSUE.id}`));
    assert.equal(status, 200);
    assert.ok(body.html.includes(ACTIVE_ISSUE.description));
    assert.deepEqual(activeScopes, ['active-token']);
  });

  test('`source` matching the NON-active binding resolves that binding\'s provider + scope, not the active one', async () => {
    const activeScopes = [];
    const secondaryScopes = [];
    const activeName = fakeProvider(ACTIVE_ISSUE, { seenScopes: activeScopes });
    const secondaryName = fakeProvider(SECONDARY_ISSUE, { seenScopes: secondaryScopes });
    const workspace = {
      urlKey: 'test-workspace',
      provider: activeName,
      accessToken: 'active-token',
      bindings: [
        { provider: activeName, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondaryName, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const app = buildApp(workspace);
    const { status, body } = await withServer(app, get => get(`/workspace/test-workspace/api/detail/${SECONDARY_ISSUE.id}?source=${secondaryName}`));
    assert.equal(status, 200);
    assert.ok(body.html.includes(SECONDARY_ISSUE.description));
    // The security-critical assertion: the ACTIVE provider was never called at
    // all, and the secondary provider received ITS OWN binding's scope — never
    // the active binding's already-computed getWorkspaceCallScope credential.
    assert.deepEqual(activeScopes, []);
    assert.deepEqual(secondaryScopes, ['secondary-token']);
  });

  test('the SAME id-only request pre-fix shape (no `source`) 404s on a foreign-source id — proving the red state this fix turns green', async () => {
    const activeName = fakeProvider(ACTIVE_ISSUE);
    const secondaryName = fakeProvider(SECONDARY_ISSUE);
    const workspace = {
      urlKey: 'test-workspace',
      provider: activeName,
      accessToken: 'active-token',
      bindings: [
        { provider: activeName, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondaryName, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const app = buildApp(workspace);
    const { status } = await withServer(app, get => get(`/workspace/test-workspace/api/detail/${SECONDARY_ISSUE.id}`));
    assert.equal(status, 404);
  });

  test('an unmatched `source` (no binding on this workspace carries it) falls back to workspace-level resolution unchanged', async () => {
    const activeScopes = [];
    const activeName = fakeProvider(ACTIVE_ISSUE, { seenScopes: activeScopes });
    const secondaryName = fakeProvider(SECONDARY_ISSUE);
    const workspace = {
      urlKey: 'test-workspace',
      provider: activeName,
      accessToken: 'active-token',
      bindings: [
        { provider: activeName, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondaryName, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const app = buildApp(workspace);
    const { status, body } = await withServer(app, get => get(`/workspace/test-workspace/api/detail/${ACTIVE_ISSUE.id}?source=some-unrelated-provider-name`));
    assert.equal(status, 200);
    assert.ok(body.html.includes(ACTIVE_ISSUE.description));
    assert.deepEqual(activeScopes, ['active-token']);
  });

  test('`source` is bounded to THIS workspace\'s own bindings — never handed to getProvider() directly', async () => {
    // A provider registered globally (so getProvider() would happily resolve it)
    // but NOT bound to this workspace must never be reachable via `source`.
    const activeName = fakeProvider(ACTIVE_ISSUE);
    const unboundName = fakeProvider(SECONDARY_ISSUE); // registered, but not in this workspace's bindings
    const workspace = {
      urlKey: 'test-workspace',
      provider: activeName,
      accessToken: 'active-token',
      bindings: [
        { provider: activeName, scope: 'active-scope', credentials: { token: 'active-token' } },
      ],
    };
    const app = buildApp(workspace);
    const { status } = await withServer(app, get => get(`/workspace/test-workspace/api/detail/${SECONDARY_ISSUE.id}?source=${unboundName}`));
    // Falls back to the active provider, which does not have this issue → 404,
    // never a 200 sourced from the unbound provider.
    assert.equal(status, 404);
  });

  test('a single-binding workspace behaves byte-identically whether or not `source` is sent', async () => {
    const scopes = [];
    const soleName = fakeProvider(ACTIVE_ISSUE, { seenScopes: scopes });
    const workspace = {
      urlKey: 'test-workspace',
      provider: soleName,
      accessToken: 'sole-token',
      bindings: [
        { provider: soleName, scope: 'sole-scope', credentials: { token: 'sole-token' } },
      ],
    };
    const app = buildApp(workspace);
    const withoutSource = await withServer(app, get => get(`/workspace/test-workspace/api/detail/${ACTIVE_ISSUE.id}`));
    const withSource = await withServer(app, get => get(`/workspace/test-workspace/api/detail/${ACTIVE_ISSUE.id}?source=${soleName}`));
    assert.equal(withoutSource.status, 200);
    assert.equal(withSource.status, 200);
    assert.deepEqual(withoutSource.body, withSource.body);
    assert.deepEqual(scopes, ['sole-token', 'sole-token']);
  });
});

// LIN-1904 close-out ledger row 3: `/api/autopilot-prompt` adopted
// `resolveIssueBinding` alongside `/api/detail`, but shipped with no
// assertion anywhere that it actually threads `source` through to a
// binding-scoped `fetchIssueContext` call rather than the active workspace's.
describe('GET /workspace/:urlKey/api/autopilot-prompt/:issueId — binding-scoped provider resolution', () => {
  test('`source` matching the NON-active binding resolves that binding\'s provider + scope, not the active one', async () => {
    const activeContextScopes = [];
    const secondaryContextScopes = [];
    const activeName = fakeProvider(ACTIVE_ISSUE, { seenContextScopes: activeContextScopes });
    const secondaryName = fakeProvider(SECONDARY_ISSUE, { seenContextScopes: secondaryContextScopes });
    const workspace = {
      urlKey: 'test-workspace',
      provider: activeName,
      accessToken: 'active-token',
      bindings: [
        { provider: activeName, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondaryName, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const app = buildApp(workspace, { features: { proxy: true } });
    const { status, body } = await withServer(app, get => get(`/workspace/test-workspace/api/autopilot-prompt/${SECONDARY_ISSUE.id}?source=${secondaryName}`));
    assert.equal(status, 200);
    assert.ok(body.prompt.includes(SECONDARY_ISSUE.identifier));
    // The security-critical assertion: the ACTIVE provider was never called at
    // all, and the secondary provider received ITS OWN binding's scope — never
    // the active binding's already-computed getWorkspaceCallScope credential.
    assert.deepEqual(activeContextScopes, []);
    assert.deepEqual(secondaryContextScopes, ['secondary-token']);
  });

  test('no `source` param → unchanged workspace-level resolution (active provider, active scope)', async () => {
    const activeContextScopes = [];
    const activeName = fakeProvider(ACTIVE_ISSUE, { seenContextScopes: activeContextScopes });
    const secondaryName = fakeProvider(SECONDARY_ISSUE);
    const workspace = {
      urlKey: 'test-workspace',
      provider: activeName,
      accessToken: 'active-token',
      bindings: [
        { provider: activeName, scope: 'active-scope', credentials: { token: 'active-token' } },
        { provider: secondaryName, scope: 'secondary-scope', credentials: { token: 'secondary-token' } },
      ],
    };
    const app = buildApp(workspace, { features: { proxy: true } });
    const { status, body } = await withServer(app, get => get(`/workspace/test-workspace/api/autopilot-prompt/${ACTIVE_ISSUE.id}`));
    assert.equal(status, 200);
    assert.ok(body.prompt.includes(ACTIVE_ISSUE.identifier));
    assert.deepEqual(activeContextScopes, ['active-token']);
  });
});
