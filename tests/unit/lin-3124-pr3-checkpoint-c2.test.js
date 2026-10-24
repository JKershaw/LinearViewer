/**
 * LIN-3124 PR3 — checkpoint C2: D16 owner-blind lane + title-lane arm (D7).
 * Dark: no connection-backed binding exists until the write flip.
 *
 * Run: node --test tests/unit/lin-3124-pr3-checkpoint-c2.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConnectionAccess } from '../../lib/connection-credential.js';
import { createWorkspaceTitleResolver } from '../../lib/workspace-title-resolver.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { appAround, request } from './lib/entrance-route-sweep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const DASHBOARD_SRC = readFileSync(join(__dirname, '../../routes/dashboard.js'), 'utf8');

const BUFFER = 5 * 60 * 1000;
const future = () => Date.now() + 3_600_000;
const past = () => Date.now() - 1_000;
const conn = (id, provider, unitId, credentials) => ({ _id: id, accountId: id.split('::')[0], provider, unitId, credentials, referents: [] });

function accessWith(overrides = {}) {
  return createConnectionAccess({
    connectionStore: { readConnectionsByReferent: async () => overrides.connections ?? [] },
    ownerCredentialStore: { getByConnection: async () => overrides.record ?? null },
    refreshConnection: async () => null,
    resolveCanonicalAccountId: async (id) => id,
    selectOwnerSessionRow: () => overrides.ownerRow ?? null,
    normalizeProvider: (ws) => ws?.provider || 'linear',
    fingerprintCredential,
    gate: { shouldAttempt: () => true },
    lifecycleEventStore: { recordEvent: async () => {} },
    bufferMs: BUFFER,
    now: () => Date.now(),
  });
}

describe('LIN-3124 PR3 checkpoint C2 — title arm (D7)', () => {
  test('requires the owner session row (no row -> null: no post-logout widening)', async () => {
    const access = accessWith({ ownerRow: null, connections: [conn('acct::linear::org', 'linear', 'org', { token: 't', tokenExpiresAt: future() })] });
    assert.strictEqual(await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] }), null);
  });

  test('serves a live owner connection as a transient workspace (no refresh)', async () => {
    const ownerRow = { session: { workspaces: [{ id: 'w', provider: 'linear' }] }, workspaceIndex: 0 };
    const access = accessWith({ ownerRow, connections: [conn('acct::linear::org', 'linear', 'org', { token: 'conn-tok', tokenExpiresAt: future() })] });
    const ws = await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] });
    assert.strictEqual(ws.accessToken, 'conn-tok');
    assert.strictEqual(ws.provider, 'linear');
    assert.strictEqual(ws.bindings[0].scope, 'org');
    assert.deepStrictEqual(ws.bindings[0].credentials, { token: 'conn-tok', tokenExpiresAt: ws.tokenExpiresAt });
  });

  test('an expired owner connection is NOT served (live only)', async () => {
    const ownerRow = { session: { workspaces: [{ id: 'w', provider: 'linear' }] }, workspaceIndex: 0 };
    const access = accessWith({ ownerRow, connections: [conn('acct::linear::org', 'linear', 'org', { token: 't', tokenExpiresAt: past() })] });
    assert.strictEqual(await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] }), null);
  });

  test('another account connection is never served', async () => {
    const ownerRow = { session: { workspaces: [{ id: 'w', provider: 'linear' }] }, workspaceIndex: 0 };
    const access = accessWith({ ownerRow, connections: [conn('other::linear::org', 'linear', 'org', { token: 't', tokenExpiresAt: future() })] });
    assert.strictEqual(await access.resolveConnectionBackedWorkspace({ urlKey: 'u', ownerAccountId: 'acct', sessions: [] }), null);
  });

  test('the title resolver uses the arm first, then the legacy selector', async () => {
    const sessions = [{ _id: 's', session: { accountId: 'acct', workspaces: [{ urlKey: 'u', provider: 'linear', accessToken: 'legacy-tok', tokenExpiresAt: future() }] } }];
    const legacyRow = { urlKey: 'u', accessToken: 'legacy-tok' };
    const resolver = createWorkspaceTitleResolver({
      sessionsCollection: { find: () => ({ toArray: async () => sessions }) },
      fetchWorkspaceIssues: async () => [],
      resolveConnectionBackedWorkspace: async () => ({ urlKey: 'u', accessToken: 'conn-tok', provider: 'linear' }),
    });
    assert.strictEqual((await resolver.resolveWorkspaceForTitles('u', 'acct')).accessToken, 'conn-tok');

    const legacyResolver = createWorkspaceTitleResolver({
      sessionsCollection: { find: () => ({ toArray: async () => sessions }) },
      fetchWorkspaceIssues: async () => [],
    });
    assert.strictEqual((await legacyResolver.resolveWorkspaceForTitles('u', 'acct')).accessToken, 'legacy-tok');
    assert.ok(legacyRow);
  });
});

// LIN-3840: the behaviour replacement for the routes/dashboard.js source-text pin
// below (D16 on the dashboard). Both tests drive the real router over HTTP and
// require every `getWorkspaceAccessToken` call to arrive carrying the REQUESTING
// session object, wherever in routes/ the code lives.
describe('LIN-3124 PR3 checkpoint C2 — D16 owner-blind threading on the dashboard routes (LIN-3840)', () => {
  const NOW_ISO = new Date().toISOString();

  function dashboardOver({ session, getWorkspaceAccessToken, history = [], agentStatus = [] }) {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, _res, next) => {
        req.session = session;
        req.workspace = { urlKey: 'ws-a', id: 'ws-a-id', provider: 'linear' };
        next();
      },
      dispatchQueueStore: {
        async listItems() { return []; },
        async listHistory() { return { items: withFreshDigests(history) }; }
      },
      agentStatusStore: { async listStatus() { return { items: agentStatus }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken,
      fetchIssueContext: async () => ({ issue: { state: { name: 'In Progress', type: 'started' } } }),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      // Pass-through, so the request really enters mergeSessions.
      sessionsFeedCache: { keyFor: () => 'k', get: async (_k, producer) => producer() }
    });
    return appAround(router);
  }

  test('GET /api/dashboard/sessions threads req.session into the touched-task hydration read', async () => {
    const session = { accountId: 'acct-owner', workspaces: [{ urlKey: 'ws-a', name: 'A' }] };
    const seen = [];
    // A terminal + errored session with a touched task: the only hydration-eligible class.
    const history = [
      { id: 'sess-err', kind: 'autopilot', issueIdentifier: 'LIN-300', issueTitle: 'T', promptName: 'autopilot', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken' },
      { id: 'sess-err-w', sessionId: 'sess-err', issueIdentifier: 'LIN-301', issueTitle: 'T', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] }
    ];
    const agentStatus = [{ id: 'as-sess-err', dispatchId: 'sess-err', taskIdentifier: 'LIN-300', action: 'implementation', status: 'completed', summary: 'done', timestamp: NOW_ISO }];
    const app = dashboardOver({
      session, history, agentStatus,
      getWorkspaceAccessToken: async (urlKey, sess) => { seen.push([urlKey, sess]); return 'workspace-token'; }
    });

    const res = await request(app, 'GET', '/workspace/ws-a/api/dashboard/sessions');
    assert.equal(res.status, 200, res.text);
    // Positive control: the eligible session reached the hydration read at all.
    assert.ok(seen.length >= 1, 'the feed asked for the workspace access token (the session was hydration-eligible)');
    for (const [urlKey, sess] of seen) {
      assert.equal(urlKey, 'ws-a');
      assert.strictEqual(sess, session, 'the token lookup receives the requesting session');
    }
  });

  test('GET /api/dashboard/hydrate/:wsUrlKey/:identifier threads req.session into the token lookup', async () => {
    const session = { accountId: 'acct-owner', workspaces: [{ urlKey: 'ws-a', name: 'A' }] };
    const seen = [];
    const app = dashboardOver({
      session,
      getWorkspaceAccessToken: async (urlKey, sess) => { seen.push([urlKey, sess]); return 'workspace-token'; }
    });

    const res = await request(app, 'GET', '/workspace/ws-a/api/dashboard/hydrate/ws-a/LIN-1');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.hydrated, true);
    assert.ok(seen.length >= 1, 'the hydrate route asked for the workspace access token');
    for (const [urlKey, sess] of seen) {
      assert.equal(urlKey, 'ws-a');
      assert.strictEqual(sess, session, 'the token lookup receives the requesting session');
    }
  });
});

describe('LIN-3124 PR3 checkpoint C2 — D16 owner-blind threading (source-text pins)', () => {
  test('getWorkspaceAccessToken takes a session and consults the side-table only with one', () => {
    assert.match(SERVER_SRC, /async function getWorkspaceAccessToken\(urlKey, session = null\)/);
    const start = SERVER_SRC.indexOf('async function getWorkspaceAccessToken(');
    const body = SERVER_SRC.slice(start, SERVER_SRC.indexOf('\n}', start));
    assert.match(body, /activeBindingIsConnectionBacked\(workspace\)/);
    assert.match(body, /readWorkspaceCredential\(workspace\)/);
    // UNSCOPED fallback is unchanged.
    assert.match(body, /return \(await resolveWorkspaceAccess\(urlKey\)\)\.token/);
  });

  // LIN-3601: this test matched the text `getWorkspaceAccessToken: (k) =>
  // getWorkspaceAccessToken(k, req.session)` in routes/dispatch.js. It now posts a
  // composed-run dispatch (the only path that runs the done-guard) with an injected
  // getWorkspaceAccessToken and requires every call to arrive carrying the SESSION that
  // made the request, so a connection-backed workspace reads the session's own
  // hydrated credential (D16).
  test('routes/dispatch.js threads the session into the done-guard', async () => {
    const session = { accountId: 'acct-owner' };
    const seen = [];
    const router = createDispatchRoutes({
      dispatchQueueStore: { addItem: async (_urlKey, fields) => ({ _id: 'item-1', ...fields }) },
      dispatchTokenStore: {},
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      userPreferencesStore: {},
      getWorkspaceAccessToken: async (urlKey, sess) => { seen.push([urlKey, sess]); return 'workspace-token'; },
      fetchIssueContext: async () => ({ issue: { state: { type: 'started' } } }),
      workspaceFromUrl: (req, _res, next) => {
        req.workspace = { urlKey: 'acme', id: 'ws-acme', provider: 'linear' };
        req.session = session;
        next();
      }
    });
    const res = await request(appAround(router), 'POST', '/workspace/acme/api/dispatch', {
      body: { prompt: 'p', target: 'cli', issueIdentifier: 'LIN-1', composedRunMarker: 'ruling-composed-run' }
    });
    assert.equal(res.status, 201, res.text);
    assert.ok(seen.length >= 1, 'the done-guard asked for the workspace access token');
    for (const [urlKey, sess] of seen) {
      assert.equal(urlKey, 'acme');
      assert.strictEqual(sess, session, 'the token lookup receives the requesting session');
    }
  });

  test('routes/dashboard.js threads the session through mergeSessions and the hydrate route', () => {
    assert.match(DASHBOARD_SRC, /mergeSessions\(workspaces, \{ live = false, session = null \}/);
    assert.match(DASHBOARD_SRC, /getWorkspaceAccessToken\(b\.ws\.urlKey, session\)/);
    assert.match(DASHBOARD_SRC, /getWorkspaceAccessToken\(wsUrlKey, req\.session\)/);
    assert.match(DASHBOARD_SRC, /mergeSessions\(workspaces, \{ live: isSessionsView, session: req\.session \}\)/);
  });

  test('lib/dispatch-factory.js is NOT edited to know about sessions', () => {
    const factory = readFileSync(join(__dirname, '../../lib/dispatch-factory.js'), 'utf8');
    assert.doesNotMatch(factory, /req\.session/);
  });
});