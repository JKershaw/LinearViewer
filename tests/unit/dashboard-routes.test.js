/**
 * Unit tests for routes/dashboard.js (LIN-509).
 *
 * Run with: node --test tests/unit/dashboard-routes.test.js
 *
 * Exercises the route handlers directly (bypassing the workspaceFromUrl
 * middleware) against mock dispatch/agentStatus stores, asserting the load-bearing
 * contract: feature gating, cross-workspace merge + workspace tagging,
 * active/recent split, the terminal-only run-summary gate, and the deterministic
 * test-mode summary path with caching.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import { createDashboardRoutes, buildTestSummary, buildTestSessionSummary } from '../../routes/dashboard.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';

const NOW_ISO = new Date().toISOString();

// ─── Mock dispatch/agentStatus stores ──────────────────────────────────────────────
// Shaped to drive lib/pipeline-loops.getLoopsForWorkspace deterministically:
//   - a live queue item  → agentState 'queued'  (active)
//   - a taken history item + agentStatus 'completed' → agentState 'complete' (recent)

function makeStores(perWorkspace) {
  return {
    dispatchQueueStore: {
      async listItems(urlKey) { return perWorkspace[urlKey]?.live || []; },
      async listHistory(urlKey) { return { items: perWorkspace[urlKey]?.history || [] }; }
    },
    agentStatusStore: {
      async listStatus(urlKey) { return { items: perWorkspace[urlKey]?.agentStatus || [] }; }
    }
  };
}

function activeItem(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'plan', prompt: 'p', dispatchedAt: NOW_ISO };
}
function historyItem(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: 'pr opened' }] };
}
function agentStatusDone(dispatchId, identifier) {
  return { dispatchId, taskIdentifier: identifier, action: 'implementation', status: 'completed', summary: 'all done', timestamp: NOW_ISO };
}
// A taken run that the runner finished via a [done] feedback marker but with NO
// agentStatus 'completed' entry — pipeline-loops alone derives 'running' for this.
function markerDoneItem(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[done] shipped it', timestamp: NOW_ISO }] };
}

// ─── Handler extraction ─────────────────────────────────────────────────────────

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReqRes({ session = {}, workspace = null, params = {}, query = {} } = {}) {
  session.features = session.features || {};
  const req = { session, workspace, params, query, body: {}, protocol: 'http', get: () => 'localhost' };
  const res = {
    statusCode: 200,
    jsonBody: null,
    redirectedTo: null,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.jsonBody = b; return this; },
    redirect(url) { this.redirectedTo = url; return this; },
    send(b) { this.sentBody = b; return this; },
    end(b) { this.endedWith = b; return this; }
  };
  return { req, res };
}

function makeRouter(perWorkspace, { runSummaryCacheStore, sessionSummaryCacheStore } = {}) {
  const { dispatchQueueStore, agentStatusStore } = makeStores(perWorkspace);
  return createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore,
    agentStatusStore,
    runSummaryCacheStore: runSummaryCacheStore || new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: sessionSummaryCacheStore || new InMemorySessionSummaryCacheStore(),
    freeTierStore: { async tryUse() { return { allowed: true }; } },
    getWorkspaceAccessToken: async () => 'token',
    fetchIssueContext: async () => ({ issue: { state: { name: 'Done', type: 'completed' }, labels: { nodes: [] } } }),
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({})
  });
}

// ─── Session fixtures (drive lib/pipeline-loops.getSessionsForWorkspace) ─────────
// An autopilot orchestrator dispatch (kind:'autopilot') anchors a session; its
// session id is the orchestrator's own dispatch id. Workers carry that id as
// `sessionId`. Terminality is folded in via agentStatus 'completed' / [done].
function autopilotHistoryItem(id, identifier) {
  return { id, kind: 'autopilot', issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'autopilot', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken' };
}
function autopilotLiveItem(id, identifier) {
  return { id, kind: 'autopilot', issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'autopilot', prompt: 'p', dispatchedAt: NOW_ISO };
}
function workerHistoryItem(id, identifier, sessionId) {
  return { id, sessionId, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: 'pr opened' }] };
}

const ENABLED = { features: { dashboard: true } };

// ─── /loops ────────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/loops', () => {
  test('403 when the feature flag is off', async () => {
    const router = makeRouter({});
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const { req, res } = makeReqRes({ session: { workspaces: [] } });
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  test('merges runs across workspaces, tags each, and splits active/recent', async () => {
    const perWorkspace = {
      'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [historyItem('a-hist', 'LIN-2')], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] },
      'ws-b': { live: [], history: [historyItem('b-hist', 'LIN-3')], agentStatus: [agentStatusDone('b-hist', 'LIN-3')] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }, { urlKey: 'ws-b', name: 'Beta' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.jsonBody;
    assert.equal(body.active.length, 1, 'one queued run is active');
    assert.equal(body.active[0].agentState, 'queued');
    assert.equal(body.active[0].workspaceUrlKey, 'ws-a');
    assert.equal(body.active[0].workspaceName, 'Alpha');
    assert.equal(body.recent.length, 2, 'two completed runs are recent');
    assert.ok(body.recent.every(r => r.agentState === 'complete'));
    // Every recent run carries its workspace tag.
    assert.deepEqual(new Set(body.recent.map(r => r.workspaceUrlKey)), new Set(['ws-a', 'ws-b']));
    assert.equal(body.counts.total, 3);
  });

  test('a [done] feedback marker promotes a taken run to recent (not stuck "running")', async () => {
    // Regression for "all sessions appear in progress" (LIN-509): without folding
    // the dispatch terminal marker in, this run would derive agentState 'running'
    // and never leave the active feed.
    const router = makeRouter({ 'ws-a': { live: [], history: [markerDoneItem('m1', 'LIN-7')], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.active.length, 0, 'marker-done run is not active');
    assert.equal(res.jsonBody.recent.length, 1, 'marker-done run is recent');
    assert.equal(res.jsonBody.recent[0].agentState, 'complete');
  });

  test('a [failed] marker maps to an error (terminal) run', async () => {
    const failItem = { id: 'f1', issueIdentifier: 'LIN-8', issueTitle: 'T', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] };
    const router = makeRouter({ 'ws-a': { live: [], history: [failItem], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.jsonBody.recent.length, 1);
    assert.equal(res.jsonBody.recent[0].agentState, 'error');
  });

  test('one failing workspace store does not blank the whole feed', async () => {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return []; },
        async listHistory(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return { items: [historyItem('g', 'LIN-9')] }; }
      },
      agentStatusStore: { async listStatus() { return { items: [agentStatusDone('g', 'LIN-9')] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'bad', name: 'Bad' }, { urlKey: 'good', name: 'Good' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.recent.length, 1, 'good workspace still contributes its run');
  });
});

// ─── run-summary ─────────────────────────────────────────────────────────────

describe('run-summary endpoint', () => {
  test('403 when the feature flag is off', async () => {
    const router = makeRouter({});
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: {}, workspace: { urlKey: 'ws-a' }, params: { loopId: 'x' } });
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  test('404 when the loop is not found', async () => {
    const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'nope' } });
    await handler(req, res);
    assert.equal(res.statusCode, 404);
  });

  test('409 for a non-terminal (active) run', async () => {
    const router = makeRouter({ 'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'a-live' } });
    await handler(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.jsonBody.agentState, 'queued');
  });

  test('a [done]-marker run is summarisable (effective-terminal), not 409', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const router = makeRouter({ 'ws-a': { history: [markerDoneItem('m9', 'LIN-7')], live: [], agentStatus: [] } });
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'm9' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.status, 'fresh');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('GET ?cachedOnly returns 204 on a cache miss (no generation)', async () => {
    const router = makeRouter({ 'ws-a': { history: [historyItem('a-hist', 'LIN-2')], live: [], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'a-hist' }, query: { cachedOnly: '1' } });
    await handler(req, res);
    assert.equal(res.statusCode, 204);
  });

  test('test-mode returns and caches a deterministic summary for a terminal run', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const cache = new InMemoryRunSummaryCacheStore();
      const router = makeRouter(
        { 'ws-a': { history: [historyItem('a-hist', 'LIN-2')], live: [], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] } },
        { runSummaryCacheStore: cache }
      );
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { loopId: 'a-hist' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.status, 'fresh');
      assert.match(res.jsonBody.summary.outcome, /LIN-2/);
      // Cached for next time.
      const cached = await cache.get('ws-a', 'a-hist');
      assert.ok(cached, 'summary is cached');
      assert.deepEqual(cached.summary, res.jsonBody.summary);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

// ─── buildTestSummary (pure) ─────────────────────────────────────────────────

describe('buildTestSummary', () => {
  test('reports completion and folds in summary + feedback', () => {
    const s = buildTestSummary({ issueIdentifier: 'LIN-5', iteration: 3, agentState: 'complete', stage: 'review', agentSummary: 'looked good', feedback: [{ message: 'a' }] });
    assert.match(s.outcome, /LIN-5/);
    assert.match(s.outcome, /completed/);
    assert.ok(s.whatHappened.length >= 1);
    assert.deepEqual(s.blockers, []);
  });

  test('flags an error run as a blocker', () => {
    const s = buildTestSummary({ issueIdentifier: 'LIN-6', iteration: 1, agentState: 'error', feedback: [] });
    assert.match(s.outcome, /error/);
    assert.equal(s.blockers.length, 1);
  });
});

// ─── session-summary ─────────────────────────────────────────────────────────

describe('session-summary endpoint', () => {
  // A terminal session: completed autopilot anchor + one completed worker.
  function terminalSessionWorkspace() {
    return {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-1', 'LIN-100'), workerHistoryItem('w-1', 'LIN-101', 'sess-1')],
        agentStatus: [agentStatusDone('sess-1', 'LIN-100'), agentStatusDone('w-1', 'LIN-101')]
      }
    };
  }

  test('403 when the feature flag is off', async () => {
    const router = makeRouter({});
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: {}, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  test('404 when the session is not found', async () => {
    const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'nope' } });
    await handler(req, res);
    assert.equal(res.statusCode, 404);
  });

  test('test-mode returns and caches a deterministic rollup for a terminal session', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const cache = new InMemorySessionSummaryCacheStore();
      const router = makeRouter(terminalSessionWorkspace(), { sessionSummaryCacheStore: cache });
      const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await handler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.status, 'fresh');
      assert.equal(res.jsonBody.live, false);
      assert.match(res.jsonBody.summary.outcome, /sess-1/);
      assert.match(res.jsonBody.summary.statusLine, /task/);
      // Highlights name the tasks touched (seed first).
      assert.ok(res.jsonBody.summary.highlights.some(h => /LIN-100/.test(h)));
      // Cached for next time.
      const cached = await cache.get('ws-a', 'sess-1');
      assert.ok(cached, 'session summary is cached');
      assert.deepEqual(cached.summary, res.jsonBody.summary);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('GET returns the cached rollup on a hit (no regeneration)', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const cache = new InMemorySessionSummaryCacheStore();
      const router = makeRouter(terminalSessionWorkspace(), { sessionSummaryCacheStore: cache });
      const post = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const r1 = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await post(r1.req, r1.res);
      const get = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
      const r2 = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
      await get(r2.req, r2.res);
      assert.equal(r2.res.statusCode, 200);
      assert.equal(r2.res.jsonBody.status, 'cached');
      assert.deepEqual(r2.res.jsonBody.summary, r1.res.jsonBody.summary);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('GET ?cachedOnly returns 204 on a cache miss (no generation)', async () => {
    const router = makeRouter(terminalSessionWorkspace());
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' }, query: { cachedOnly: '1' } });
    await handler(req, res);
    assert.equal(res.statusCode, 204);
  });

  test('a live session is not cached and returns the latest-completed-child statusLine proxy', async () => {
    // Live anchor (queued) + one completed worker child with a cached run-summary.
    const runCache = new InMemoryRunSummaryCacheStore();
    await runCache.put('ws-a', 'w-1', { inputHash: 'x', summary: { outcome: 'Implemented LIN-101 and opened a PR', whatHappened: [], blockers: [], next: '' }, model: 'm' });
    const sessCache = new InMemorySessionSummaryCacheStore();
    const perWorkspace = {
      'ws-a': {
        live: [autopilotLiveItem('sess-2', 'LIN-200')],
        history: [workerHistoryItem('w-1', 'LIN-101', 'sess-2')],
        agentStatus: [agentStatusDone('w-1', 'LIN-101')]
      }
    };
    const router = makeRouter(perWorkspace, { runSummaryCacheStore: runCache, sessionSummaryCacheStore: sessCache });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-2' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.status, 'live');
    assert.equal(res.jsonBody.live, true);
    assert.equal(res.jsonBody.summary.outcome, '', 'no outcome is asserted for a live session');
    assert.match(res.jsonBody.summary.statusLine, /Implemented LIN-101/);
    assert.equal(res.jsonBody.statusLineSource, 'latest-completed-child');
    assert.equal(res.jsonBody.statusLineLoopId, 'w-1');
    // Nothing was cached for the live session.
    assert.equal(await sessCache.get('ws-a', 'sess-2'), null);
  });
});

// ─── buildTestSessionSummary (pure) ───────────────────────────────────────────

describe('buildTestSessionSummary', () => {
  test('rolls tasks into a present-tense status line and highlights', () => {
    const s = buildTestSessionSummary({ sessionId: 'sess-9', tasksTouched: ['LIN-1', 'LIN-2'] });
    assert.match(s.outcome, /sess-9/);
    assert.match(s.outcome, /2 tasks/);
    assert.match(s.statusLine, /2 tasks/);
    assert.deepEqual(s.highlights, ['Touched LIN-1', 'Touched LIN-2']);
  });

  test('handles a single task and a missing task list', () => {
    assert.match(buildTestSessionSummary({ sessionId: 's', tasksTouched: ['LIN-1'] }).outcome, /1 task\b/);
    assert.match(buildTestSessionSummary({ sessionId: 's' }).outcome, /0 tasks/);
  });
});
