/**
 * Shared fake-deps harness for driving the real `createProxyRoutes` composer
 * over HTTP in tests — the exact `BASE_DEPS`/`buildApp`/`call` trio
 * originated in tests/unit/proxy-endpoint-inventory-witness.test.js
 * (LIN-679 PR-0), lifted out here (LIN-2543) so a second consumer
 * (tests/unit/proxy-di-witness.test.js) can reuse it without re-deriving it
 * — and, critically, without importing a `.test.js` file as a module: doing
 * that re-registers every `describe`/`test` in the imported file a second
 * time under Node's per-file test-process isolation, silently doubling that
 * file's test count in the suite. A plain (non-`.test.js`) shared module has
 * no such side effect.
 *
 * Byte-identical in behavior to the original inline definitions — this is a
 * relocation, not a re-model. proxy-endpoint-inventory-witness.test.js now
 * imports from here too, so there is exactly one definition either file can
 * drift from.
 */
import express from 'express';
import { createProxyRoutes } from '../../../routes/proxy.js';

export const ACME = 'acme';

// A comprehensive, always-succeeding fake provider (LIN-581 test-only seam,
// precedent: proxy-route-aliases.test.js). Every method the D/E/F groups'
// deterministic probes can reach is covered; none of it is exercised for
// probes that 400/401/404/503 before reaching the provider.
export function makeFakeProvider() {
  return {
    name: 'fake',
    ui: null,
    supports: () => true,
    createFields: () => ['teamId'],
    apiWriteFields: () => ['projectId', 'stateId', 'assigneeId', 'parentId', 'cycleId', 'priority'],
    viewer: async () => ({ id: 'u1', name: 'Test User' }),
    fetchTeams: async () => ([{ id: 't1', key: 'LIN', name: 'Team' }]),
    projects: async () => ([]),
    issues: async () => ({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }),
    issueDetail: async () => ({ id: 'i1', identifier: 'LIN-1', title: 't', state: { name: 'Todo', type: 'unstarted' }, comments: { nodes: [] } }),
    search: async () => ([]),
    states: async () => ([]),
    labels: async () => ([]),
    cycles: async () => ([]),
    cycleDetail: async (token, id) => ({ id, name: 'Cycle' }),
    relations: async (token, issueId) => ({ id: issueId, relations: { nodes: [] }, inverseRelations: { nodes: [] } }),
    createIssue: async () => ({ issue: { id: 'new1', identifier: 'LIN-2' }, success: true }),
    issueWriteGuard: async () => ({ id: 'i1', state: { type: 'unstarted' }, team: { id: 't1' } }),
    updateIssue: async () => ({ issue: { id: 'i1' }, success: true }),
    createComment: async () => ({ id: 'c1', issueId: 'i1', body: 'x' }),
    deleteComment: async () => ({ success: true }),
    updateComment: async () => ({ id: 'c1' }),
    uploadFile: async () => 'https://example.test/asset.png',
    createRelation: async () => ({ id: 'r1' }),
    deleteRelation: async () => ({ success: true }),
    issueLabels: async () => ({ id: 'i1', labels: { nodes: [] } }),
    updateIssueLabels: async () => ({ issue: { id: 'i1' }, success: true }),
    fetchAttachment: async () => null,
  };
}

export const BASE_DEPS = () => ({
  proxyTokenStore: {
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    listTokens: async () => ([]),
    // LIN-1938 S2: only reached when a caller overrides validateToken to
    // reject — this default bearer is never a recognized token to describe.
    describeRejectionCause: async () => null,
  },
  proxyEventStore: {
    recordEvent: async () => {},
    listEvents: async () => ({ events: [], total: 0 }),
    listCredentialHealth: async () => ({ tokens: [] }),
    listSelfCredentialHealth: async () => ({ occupancy: {}, workspaceAccess: {} }),
  },
  resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
  getWorkspaceAccessToken: async () => 'test-token',
  getWorkspaceOpenRouterKey: async () => null,
  agentStatusStore: {},
  recapCacheStore: { get: async () => null, set: async () => {} },
  briefCacheStore: { get: async () => null, set: async () => {} },
  taskSnapshotStore: { list: async () => ({ items: [], total: 0 }), diffLatest: async () => ({ changed: false }) },
  workspaceFromUrl: (req, res, next) => next(),
  workspacePreferencesStore: {},
  freeTierStore: { tryUse: async () => ({ allowed: true }) },
  provider: makeFakeProvider(),
});

/**
 * Fresh app per probe (mirrors every other proxy test file's per-test
 * buildApp() convention) so one row's deps can never leak into another's.
 */
export function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({ ...BASE_DEPS(), ...overrides }));
  return app;
}

export async function call(app, method, path, { body, headers } = {}) {
  const server = app.listen(0, '127.0.0.1');
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
    return { status: res.status, body: parsed, contentType: res.headers.get('content-type') };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
