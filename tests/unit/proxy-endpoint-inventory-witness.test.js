/**
 * LIN-679 PR-0 — endpoint-inventory / coverage witness.
 *
 * routes/proxy.js is about to be split into router.use() sub-routers, one
 * coherent endpoint group per PR (LIN-679's accepted plan). LIN-2505 removed
 * the five `router.stack`-walking tests that used to prove all 55
 * registrations still resolved to a handler after a refactor — nothing
 * replaced that coverage (LIN-679 research, 2026-09-03: "no test today
 * asserts that all 55 registrations still resolve"). This file is that
 * replacement, landed as PR-0 (no handler moves) before any group is moved.
 *
 * All 65 (method, URL) forms — 55 route registrations, 10 of them
 * array-path aliases (2 URL forms each) — are driven through
 * `createProxyRoutes` over REAL HTTP (an express app + `fetch`, the pattern
 * already established by tests/unit/proxy-route-aliases.test.js), each
 * against a deterministic, offline/network-free input chosen to be the
 * CHEAPEST reachable validation branch past auth (so the probe proves the
 * handler chain resolves and runs its own logic, not just that auth
 * middleware exists). Every row pins an EXACT expected status. A route that
 * silently stopped resolving (wrong path after a future sub-router mount, a
 * shadowed registration, a dropped alias) fails one of these rows with a 404
 * or a mismatched status instead of the split going unnoticed.
 *
 * This file does NOT re-test business logic — the ~9000 other unit tests
 * already do that per-endpoint in depth. It only proves resolution + a known
 * status per URL form, which is the specific coverage `router.stack` used to
 * provide structurally and no longer does.
 *
 * A status-only assertion is vacuous on the 10 rows below that expect 404:
 * Express's own default catch-all ("Cannot GET <path>", text/html) is ALSO a
 * 404, so a dropped/shadowed route would pass one of those rows exactly as
 * green as the real handler's own "not found" response. Each of those rows
 * carries `expectBody` — the handler's actual JSON error shape — and the
 * witness below additionally pins the response content-type to
 * application/json for them, so a route that stops resolving fails loudly
 * instead of silently matching Express's default.
 *
 * Group letters (A-I) in the row comments below are LIN-679's own group
 * labels (see the ticket), matching route registration order 1:1 — this
 * file's own witness (see the "registration count" test below) is what
 * proves the mapping stays accurate, not a hand-maintained comment.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACME = 'acme';

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

// A comprehensive, always-succeeding fake provider (LIN-581 test-only seam,
// precedent: proxy-route-aliases.test.js). Every method the D/E/F groups'
// deterministic probes below can reach is covered; none of it is exercised
// for probes that 400/401/404/503 before reaching the provider.
function makeFakeProvider() {
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

// A minimal but functioning dispatch-queue store: empty results everywhere,
// which is enough to reach 200s on the read paths and a 404 on the by-id
// paths, without needing to fabricate a real dispatch item.
function makeDispatchStore() {
  return {
    listItems: async () => [],
    listHistory: async () => ({ items: [], total: 0 }),
    getItemStatus: async () => null,
    historyTtl: 30 * 24 * 60 * 60, // seconds
  };
}

const BASE_DEPS = () => ({
  proxyTokenStore: {
    validateToken: async () => ({ tokenId: 't1', urlKey: ACME, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    listTokens: async () => ([]),
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
function buildApp(overrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({ ...BASE_DEPS(), ...overrides }));
  return app;
}

async function call(app, method, path, { body, headers } = {}) {
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

function sessionWorkspaceApp(session, overrides = {}) {
  return buildApp({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: ACME };
      req.session = session;
      next();
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 65 URL forms, in routes/proxy.js registration order. `group` is LIN-679's
// own group letter. `run` builds the app + issues the one deterministic
// offline request and returns { status }.
// ---------------------------------------------------------------------------

const ROWS = [
  // --- Group A: user-facing (session-auth) token admin, workspace-prefixed ---
  {
    group: 'A', method: 'POST', url: '/workspace/acme/api/proxy/tokens', expect: 403,
    note: 'feature flag off (:1605)',
    run: () => call(sessionWorkspaceApp({}), 'POST', '/workspace/acme/api/proxy/tokens', { body: {} }),
  },
  {
    group: 'A', method: 'GET', url: '/workspace/acme/api/proxy/tokens', expect: 200,
    note: 'listTokens() (:1691)',
    run: () => call(sessionWorkspaceApp({}, { proxyTokenStore: { listTokens: async () => ([]) } }), 'GET', '/workspace/acme/api/proxy/tokens'),
  },
  {
    group: 'A', method: 'DELETE', url: '/workspace/acme/api/proxy/tokens/not-a-uuid', expect: 400,
    note: 'UUID_REGEX.test(tokenId) (:1707)',
    run: () => call(sessionWorkspaceApp({}), 'DELETE', '/workspace/acme/api/proxy/tokens/not-a-uuid'),
  },
  {
    group: 'A', method: 'GET', url: '/workspace/acme/api/proxy/events', expect: 200,
    note: 'listEvents() (:1733)',
    run: () => call(sessionWorkspaceApp({}), 'GET', '/workspace/acme/api/proxy/events'),
  },
  {
    group: 'A', method: 'GET', url: '/workspace/acme/api/proxy/credential-health', expect: 200,
    note: 'listCredentialHealth() (:1759)',
    run: () => call(sessionWorkspaceApp({}), 'GET', '/workspace/acme/api/proxy/credential-health'),
  },

  // --- Group B: agent instructions (stays in the composer, LIN-679 ruling F7) ---
  {
    group: 'B', method: 'GET', url: '/api/proxy/instructions', expect: 200,
    note: 'never 5xx by design (:1785)',
    run: () => call(buildApp(), 'GET', '/api/proxy/instructions'),
  },

  // --- Group C: token exchange ---
  {
    group: 'C', method: 'POST', url: '/api/proxy/token', expect: 401,
    note: 'missing Bearer (:1830)',
    run: () => call(buildApp(), 'POST', '/api/proxy/token', { headers: { Authorization: '' } }),
  },

  // --- Group D: reads ---
  {
    group: 'D', method: 'GET', url: '/api/proxy/me', expect: 200,
    note: 'provider.viewer() (:1885)',
    run: () => call(buildApp(), 'GET', '/api/proxy/me'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/credential-health', expect: 200,
    note: 'listSelfCredentialHealth() (:1939)',
    run: () => call(buildApp(), 'GET', '/api/proxy/credential-health'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/teams', expect: 200,
    note: 'provider.fetchTeams() (:1959)',
    run: () => call(buildApp(), 'GET', '/api/proxy/teams'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/projects', expect: 200,
    note: 'provider.projects() (:1981)',
    run: () => call(buildApp(), 'GET', '/api/proxy/projects'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/issues', expect: 200,
    note: 'provider.issues() (:2022)',
    run: () => call(buildApp(), 'GET', '/api/proxy/issues'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/issues/bad%20id', expect: 400,
    note: 'isValidIssueId (:2056)',
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/bad%20id'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/search', expect: 400,
    note: 'q required (:2098)',
    run: () => call(buildApp(), 'GET', '/api/proxy/search'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/states/t1', expect: 200,
    note: 'provider.states() (:2141)',
    run: () => call(buildApp(), 'GET', '/api/proxy/states/t1'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/labels', expect: 200,
    note: 'provider.labels() (:2170)',
    run: () => call(buildApp(), 'GET', '/api/proxy/labels'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/cycles', expect: 200,
    note: 'provider.cycles() (:2204)',
    run: () => call(buildApp(), 'GET', '/api/proxy/cycles'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/cycles/not-a-uuid', expect: 400,
    note: 'cycle detail alias, canonical form (:2233)',
    run: () => call(buildApp(), 'GET', '/api/proxy/cycles/not-a-uuid'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/cycle/not-a-uuid', expect: 400,
    note: 'cycle detail alias, flat form (:2224 array path)',
    run: () => call(buildApp(), 'GET', '/api/proxy/cycle/not-a-uuid'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/issues/LIN-77/relations', expect: 200,
    note: 'relations, canonical form (:2260)',
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/LIN-77/relations'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/relations/LIN-77', expect: 200,
    note: 'relations, flat alias form (:2260 array path)',
    run: () => call(buildApp(), 'GET', '/api/proxy/relations/LIN-77'),
  },
  {
    group: 'D', method: 'GET', url: '/api/proxy/attachments/not-a-real-handle', expect: 400,
    note: 'decodeAttachmentHandle (:2379)',
    run: () => call(buildApp(), 'GET', '/api/proxy/attachments/not-a-real-handle'),
  },

  // --- Group E: writes ---
  {
    group: 'E', method: 'POST', url: '/api/proxy/issues', expect: 400,
    note: 'teamId required (:2618, fake provider declares createFields ["teamId"])',
    run: () => call(buildApp(), 'POST', '/api/proxy/issues', { body: {} }),
  },
  {
    group: 'E', method: 'PATCH', url: '/api/proxy/issues/not valid', expect: 400,
    note: 'isValidIssueId (:2757)',
    run: () => call(buildApp(), 'PATCH', '/api/proxy/issues/not%20valid', { body: { title: 'x' } }),
  },
  {
    group: 'E', method: 'POST', url: '/api/proxy/issues/LIN-1/description/append', expect: 400,
    note: 'block required (:2950)',
    run: () => call(buildApp(), 'POST', '/api/proxy/issues/LIN-1/description/append', { body: {} }),
  },
  {
    group: 'E', method: 'POST', url: '/api/proxy/issues/LIN-1/description/replace', expect: 400,
    note: 'oldString required (:2974)',
    run: () => call(buildApp(), 'POST', '/api/proxy/issues/LIN-1/description/replace', { body: {} }),
  },
  {
    group: 'E', method: 'POST', url: '/api/proxy/issues/LIN-1/comments', expect: 400,
    note: 'body required, canonical form (:2998)',
    run: () => call(buildApp(), 'POST', '/api/proxy/issues/LIN-1/comments', { body: {} }),
  },
  {
    group: 'E', method: 'POST', url: '/api/proxy/comments/LIN-1', expect: 400,
    note: 'body required, flat alias form (:2998 array path)',
    run: () => call(buildApp(), 'POST', '/api/proxy/comments/LIN-1', { body: {} }),
  },
  {
    group: 'E', method: 'DELETE', url: '/api/proxy/issues/LIN-1/comments/not-a-uuid', expect: 400,
    note: 'UUID check on commentId (:3092)',
    run: () => call(buildApp(), 'DELETE', '/api/proxy/issues/LIN-1/comments/not-a-uuid'),
  },
  {
    group: 'E', method: 'PATCH', url: '/api/proxy/issues/LIN-1/comments/not-a-uuid', expect: 400,
    note: 'UUID check on commentId (:3128)',
    run: () => call(buildApp(), 'PATCH', '/api/proxy/issues/LIN-1/comments/not-a-uuid', { body: {} }),
  },
  {
    group: 'E', method: 'POST', url: '/api/proxy/issues/LIN-1/attachments', expect: 400,
    note: 'image required (:3226)',
    run: () => call(buildApp(), 'POST', '/api/proxy/issues/LIN-1/attachments', { body: {} }),
  },
  {
    group: 'E', method: 'POST', url: '/api/proxy/issues/LIN-1/relations', expect: 400,
    note: 'type must be valid (:3313)',
    run: () => call(buildApp(), 'POST', '/api/proxy/issues/LIN-1/relations', { body: {} }),
  },
  {
    group: 'E', method: 'DELETE', url: '/api/proxy/issues/LIN-1/relations/not-a-uuid', expect: 400,
    note: 'UUID check on relationId (:3359)',
    run: () => call(buildApp(), 'DELETE', '/api/proxy/issues/LIN-1/relations/not-a-uuid'),
  },
  {
    group: 'E', method: 'POST', url: '/api/proxy/issues/LIN-1/labels', expect: 400,
    note: 'labelId required (:3400)',
    run: () => call(buildApp(), 'POST', '/api/proxy/issues/LIN-1/labels', { body: {} }),
  },
  {
    group: 'E', method: 'DELETE', url: '/api/proxy/issues/LIN-1/labels/11111111-1111-1111-1111-111111111111', expect: 200,
    note: '"Label not present" short-circuit — UUID labelId skips resolveLabelInput\'s lookup, fake issueLabels() has no labels (:3477)',
    run: () => call(buildApp(), 'DELETE', '/api/proxy/issues/LIN-1/labels/11111111-1111-1111-1111-111111111111'),
  },

  // --- Group F: task-automation compute ---
  {
    group: 'F', method: 'GET', url: '/api/proxy/stack', expect: 200,
    note: 'isTestMode → getTestMockData() fixture (:3522)',
    run: () => call(buildApp(), 'GET', '/api/proxy/stack'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/issues/LIN-999999/prompt/implementation', expect: 404,
    note: 'canonical form, isTestMode "Issue not found" (:3553) — templateKey must be a real hasPrompt() key ("implement" 404s earlier, at the template-key check, with a different body)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/LIN-999999/prompt/implementation'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/prompt/LIN-999999/implementation', expect: 404,
    note: 'flat alias form (:3553 array path)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/prompt/LIN-999999/implementation'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/issues/LIN-999999/recommend', expect: 404,
    note: 'canonical form, isTestMode "Issue not found" (:3825)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/LIN-999999/recommend'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/recommend/LIN-999999', expect: 404,
    note: 'flat alias form (:3825 array path)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/recommend/LIN-999999'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/issues/LIN-1/snapshots', expect: 200,
    note: 'taskSnapshotStore.list() (:4032)',
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/LIN-1/snapshots'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/issues/LIN-1/snapshots/diff', expect: 200,
    note: 'taskSnapshotStore.diffLatest() (:4065)',
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/LIN-1/snapshots/diff'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/issues/LIN-1/cost', expect: 200,
    note: 'canonical form, dispatchQueueStore reads (:4110)',
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'GET', '/api/proxy/issues/LIN-1/cost'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/cost/LIN-1', expect: 200,
    note: 'flat alias form (:4110 array path)',
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'GET', '/api/proxy/cost/LIN-1'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/north-star', expect: 503,
    note: '!reportHistoryStore || !getWorkspaceNorthStar, both unconfigured (:4234)',
    run: () => call(buildApp(), 'GET', '/api/proxy/north-star'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/periodicals', expect: 200,
    note: 'dispatchQueueStore reads, empty fold (:4389)',
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'GET', '/api/proxy/periodicals'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/issues/LIN-999999/recap', expect: 404,
    note: 'canonical form, isTestMode "Issue not found" (:4492)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/LIN-999999/recap'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/recap/LIN-999999', expect: 404,
    note: 'flat alias form (:4492 array path)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/recap/LIN-999999'),
  },
  {
    group: 'F', method: 'POST', url: '/api/proxy/recap/bad%20id', expect: 400,
    note: 'isValidIssueId, flat-only form (:4645)',
    run: () => call(buildApp(), 'POST', '/api/proxy/recap/bad%20id', { body: {} }),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/issues/LIN-999999/brief', expect: 404,
    note: 'canonical form, isTestMode "Issue not found" (:4783)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/issues/LIN-999999/brief'),
  },
  {
    group: 'F', method: 'GET', url: '/api/proxy/brief/LIN-999999', expect: 404,
    note: 'flat alias form (:4783 array path)',
    expectBody: { error: 'Issue not found' },
    run: () => call(buildApp(), 'GET', '/api/proxy/brief/LIN-999999'),
  },
  {
    group: 'F', method: 'POST', url: '/api/proxy/brief/bad%20id', expect: 400,
    note: 'isValidIssueId, flat-only form (:4935)',
    run: () => call(buildApp(), 'POST', '/api/proxy/brief/bad%20id', { body: {} }),
  },

  // --- Group G: agent status ---
  {
    group: 'G', method: 'POST', url: '/api/proxy/agent/status', expect: 400,
    note: 'taskIdentifier required, canonical form (:5069)',
    run: () => call(buildApp(), 'POST', '/api/proxy/agent/status', { body: {} }),
  },
  {
    group: 'G', method: 'POST', url: '/api/proxy/foreman/status', expect: 400,
    note: 'deprecated alias form (:5069 array path)',
    run: () => call(buildApp(), 'POST', '/api/proxy/foreman/status', { body: {} }),
  },
  {
    group: 'G', method: 'GET', url: '/api/proxy/agent/status', expect: 400,
    note: 'over-long tokenId, canonical form (:5150)',
    run: () => call(buildApp(), 'GET', `/api/proxy/agent/status?tokenId=${'x'.repeat(1001)}`),
  },
  {
    group: 'G', method: 'GET', url: '/api/proxy/foreman/status', expect: 400,
    note: 'deprecated alias form (:5150 array path)',
    run: () => call(buildApp(), 'GET', `/api/proxy/foreman/status?tokenId=${'x'.repeat(1001)}`),
  },

  // --- Group H: autopilot kickoff / manual / passage-runner prompt ---
  {
    group: 'H', method: 'GET', url: '/api/proxy/autopilot/kickoff', expect: 200,
    note: 'no deps, always 200 text/plain (:5193)',
    run: () => call(buildApp(), 'GET', '/api/proxy/autopilot/kickoff'),
  },
  {
    group: 'H', method: 'POST', url: '/api/proxy/autopilot/kickoff', expect: 400,
    note: 'mode must be valid (:5234)',
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'POST', '/api/proxy/autopilot/kickoff', { body: { mode: 'bogus' } }),
  },
  {
    group: 'H', method: 'GET', url: '/api/proxy/autopilot/manual', expect: 200,
    note: 'no deps, always 200 text/plain (:5539)',
    run: () => call(buildApp(), 'GET', '/api/proxy/autopilot/manual'),
  },
  {
    group: 'H', method: 'GET', url: '/api/proxy/passage-runner/prompt', expect: 200,
    note: 'no deps, always 200 text/plain (:5549)',
    run: () => call(buildApp(), 'GET', '/api/proxy/passage-runner/prompt'),
  },

  // --- Group I: dispatch ---
  {
    group: 'I', method: 'POST', url: '/api/proxy/dispatch', expect: 400,
    note: 'prompt required (:5567)',
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'POST', '/api/proxy/dispatch', { body: {} }),
  },
  {
    group: 'I', method: 'POST', url: '/api/proxy/recommend-and-dispatch', expect: 400,
    note: 'issueIdentifier required (:5889)',
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'POST', '/api/proxy/recommend-and-dispatch', { body: {} }),
  },
  {
    group: 'I', method: 'GET', url: '/api/proxy/dispatch', expect: 200,
    note: 'listItems + listHistory, empty result (:6387)',
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'GET', '/api/proxy/dispatch'),
  },
  {
    group: 'I', method: 'GET', url: '/api/proxy/dispatch/d1', expect: 404,
    note: 'getItemStatus() → null (:6625)',
    expectBody: { error: 'Dispatch item not found' },
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'GET', '/api/proxy/dispatch/d1'),
  },
  {
    group: 'I', method: 'GET', url: '/api/proxy/dispatch/d1/prompt', expect: 404,
    note: 'getItemStatus() → null (:6727)',
    expectBody: { error: 'Dispatch item not found' },
    run: () => call(buildApp({ dispatchQueueStore: makeDispatchStore() }), 'GET', '/api/proxy/dispatch/d1/prompt'),
  },
];

// ---------------------------------------------------------------------------
// Registration-count witness — the mechanical guard `router.stack` used to
// give structurally. If routes/proxy.js gains or loses a registration
// without this table being updated, this fails loudly instead of the table
// silently under- or over-counting the surface.
// ---------------------------------------------------------------------------

describe('LIN-679 PR-0: proxy.js registration count', () => {
  test('routes/proxy.js has exactly 55 router.* registrations (65 URL forms)', () => {
    const src = readFileSync(join(__dirname, '../../routes/proxy.js'), 'utf8');
    const matches = src.match(/^\s{2}router\.(get|post|put|patch|delete)\(/gm) || [];
    assert.equal(matches.length, 55,
      `expected 55 route registrations in routes/proxy.js, found ${matches.length} — ` +
      `this file's 65-row ROWS table must be re-derived from source before trusting it`);
    assert.equal(ROWS.length, 65,
      `this file's ROWS table must cover exactly 65 URL forms (55 registrations + 10 array-path aliases), found ${ROWS.length}`);
  });
});

// ---------------------------------------------------------------------------
// The witness itself.
// ---------------------------------------------------------------------------

describe('LIN-679 PR-0: endpoint inventory witness (all 65 URL forms resolve)', () => {
  for (const row of ROWS) {
    test(`[${row.group}] ${row.method} ${row.url} -> ${row.expect} (${row.note})`, async () => {
      const { status, body, contentType } = await row.run();
      assert.equal(status, row.expect,
        `expected ${row.expect}, got ${status}: ${JSON.stringify(body).slice(0, 300)}`);
      // A dropped/shadowed route also resolves to a bare 404 — Express's own
      // default "Cannot GET <path>" catch-all — so a status-only assertion on
      // an `expect: 404` row is vacuous: it passes identically whether the
      // real handler ran and legitimately reported "not found", or the route
      // simply stopped being registered. `expectBody` pins the row to the
      // handler's own JSON error shape (and, via `contentType`, to `res.json`
      // rather than finalhandler's text/html default) so a dropped route
      // fails this row instead of passing it by accident.
      if (row.expectBody) {
        assert.match(contentType || '', /^application\/json/,
          `expected a JSON response (route resolved and ran its own handler), got content-type ${contentType}: ${JSON.stringify(body).slice(0, 300)}`);
        assert.deepEqual(body, row.expectBody,
          `expected body ${JSON.stringify(row.expectBody)}, got ${JSON.stringify(body).slice(0, 300)}`);
      }
    });
  }
});
