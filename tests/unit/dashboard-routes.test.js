/**
 * Unit tests for routes/dashboard.js (LIN-509 / LIN-595).
 *
 * Run with: node --test tests/unit/dashboard-routes.test.js
 *
 * Exercises the route handlers directly (bypassing the workspaceFromUrl
 * middleware) against mock dispatch/agentStatus stores, asserting the load-bearing
 * contract: cross-workspace merge + workspace tagging, active/recent split, the
 * sessionId-grouped Observation feed (LIN-595), the terminal-only run-summary
 * gate, and the deterministic test-mode summary path with caching.
 *
 * NOTE: the experimental `dashboard` feature flag was retired in LIN-595 (the page
 * is first-class), so these endpoints are session-authed only — no flag gate.
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

function makeRouter(perWorkspace, { runSummaryCacheStore, sessionSummaryCacheStore, issues } = {}) {
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
    fetchWorkspaceIssues: async () => issues || [],
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

// The page is first-class (LIN-595): no feature flag is required. ENABLED is kept
// as an empty session so the existing spreads (`{ ...ENABLED, workspaces }`) read
// naturally and document that no flag is needed.
const ENABLED = {};

// ─── /loops ────────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/loops', () => {
  test('serves the feed without a feature flag (first-class)', async () => {
    const router = makeRouter({ 'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const { req, res } = makeReqRes({ session: { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.active.length, 1);
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

// ─── Feed memory: lean projection + bounded fan-out (LIN-622) ─────────────────

describe('feed memory (LIN-622)', () => {
  test('/api/dashboard/loops payload carries no promptText nor retained feedback[] (lean reconstruction)', async () => {
    const perWorkspace = {
      'ws-a': { live: [activeItem('a-live', 'LIN-1')], history: [historyItem('a-hist', 'LIN-2')], agentStatus: [agentStatusDone('a-hist', 'LIN-2')] }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/loops');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const all = [...res.jsonBody.active, ...res.jsonBody.recent];
    assert.ok(all.length > 0, 'expected at least one run in the feed');
    for (const run of all) {
      assert.ok(!('promptText' in run), `feed run ${run.loopId} must not carry promptText`);
      // The raw heartbeat/[evidence] log — the dominant per-row bytes — must not
      // be retained on the lean feed; its derived facts ride telemetry + the
      // pre-derived terminal fields instead (LIN-622).
      assert.ok(!Array.isArray(run.feedback) || run.feedback.length === 0,
        `feed run ${run.loopId} must not retain raw feedback[]`);
    }
  });

  test('cross-workspace fan-out reconstructs at most 2 workspaces concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems() { return []; },
        async listHistory() {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise(resolve => setTimeout(resolve, 5));
          inFlight--;
          return { items: [] };
        }
      },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const workspaces = Array.from({ length: 6 }, (_, i) => ({ urlKey: `ws-${i}`, name: `W${i}` }));
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(peak <= 2, `peak concurrent workspace reads ${peak} must be <= 2 (bounded fan-out)`);
    assert.ok(peak > 1, `expected some concurrency, got ${peak}`);
  });
});

// ─── /sessions (Observation feed; LIN-595) ───────────────────────────────────

describe('GET /api/dashboard/sessions', () => {
  test('groups loops into sessions, splits active/recent, and tags each', async () => {
    const perWorkspace = {
      // Terminal session: completed autopilot anchor + one completed worker.
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-1', 'LIN-100'), workerHistoryItem('w-1', 'LIN-101', 'sess-1')],
        agentStatus: [agentStatusDone('sess-1', 'LIN-100'), agentStatusDone('w-1', 'LIN-101')]
      },
      // Live session: queued autopilot anchor (not terminal).
      'ws-b': {
        live: [autopilotLiveItem('sess-2', 'LIN-200')],
        history: [],
        agentStatus: []
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }, { urlKey: 'ws-b', name: 'Beta' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.jsonBody;
    assert.equal(body.active.length, 1, 'the live session is active');
    assert.equal(body.recent.length, 1, 'the terminal session is recent');

    const live = body.active[0];
    assert.equal(live.sessionId, 'sess-2');
    assert.equal(live.status, 'in-progress');
    assert.equal(live.terminal, false);
    assert.equal(live.workspaceUrlKey, 'ws-b');
    assert.equal(live.workspaceName, 'Beta');

    const done = body.recent[0];
    assert.equal(done.sessionId, 'sess-1');
    assert.equal(done.status, 'done');
    assert.equal(done.terminal, true);
    assert.equal(done.seedIssue, 'LIN-100');
    assert.deepEqual(done.tasksTouched, ['LIN-100', 'LIN-101']);
    // One worker run → one progress-bar segment (the anchor is excluded).
    assert.equal(done.runCount, 1);
    assert.equal(done.runs[0].issueIdentifier, 'LIN-101');
    // Telemetry runtime is attached (LIN-594).
    assert.ok(done.runtime, 'session carries a runtime telemetry block');
    assert.equal(body.counts.total, 2);
  });

  test('each run carries its Level-3 drill-down payload (telemetry + recap), Mongo-only', async () => {
    // A worker whose feedback carries a heartbeat (metrics) and an [evidence]
    // marker (produced artifact) — the read-only telemetry the drill-down renders.
    const richWorker = {
      id: 'w-rich', sessionId: 'sess-r', issueIdentifier: 'LIN-501', issueTitle: 'Rich worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [
        { message: '[working] 6 tools/32s · alive', timestamp: NOW_ISO },
        { message: '[evidence] PR opened https://github.com/x/y/pull/1', url: 'https://github.com/x/y/pull/1', urlLabel: 'PR #1', timestamp: NOW_ISO },
        { message: '[done] shipped it', timestamp: NOW_ISO }
      ]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-r', 'LIN-500'), richWorker],
        agentStatus: [agentStatusDone('sess-r', 'LIN-500'), agentStatusDone('w-rich', 'LIN-501')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = res.jsonBody.recent.find(s => s.sessionId === 'sess-r');
    assert.ok(sess, 'session is recent');
    const run = sess.runs.find(r => r.loopId === 'w-rich');
    assert.ok(run, 'worker run is present');
    // Recap fallback + evidence/metrics for the Level-3 node.
    assert.equal(run.agentSummary, 'all done');
    assert.ok(run.runtime && typeof run.runtime === 'object', 'run carries runtime telemetry');
    assert.ok(run.metrics.length >= 1, 'run carries activity metrics');
    assert.equal(run.metrics[0].toolCount, 6);
    assert.equal(run.producedArtifacts.length, 1, 'run carries produced artifacts');
    assert.equal(run.producedArtifacts[0].url, 'https://github.com/x/y/pull/1');
  });

  test('a live session carries a deterministic statusLine from its latest child (no per-poll summary fetch needed)', async () => {
    // A running worker decorated with an agent-status summary, under a live
    // (queued) autopilot anchor — i.e. a non-terminal session. The feed must
    // surface that summary as `statusLine` so the client renders it directly
    // instead of polling /session-summary every 5s (the OOM path).
    const runningWorker = { id: 'w-run', sessionId: 'sess-live', issueIdentifier: 'LIN-811', issueTitle: 'Worker', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO };
    const runningStatus = { dispatchId: 'w-run', taskIdentifier: 'LIN-811', action: 'implementation', status: 'working', summary: 'wiring the new route', timestamp: NOW_ISO };
    const perWorkspace = {
      'ws-a': {
        live: [autopilotLiveItem('sess-live', 'LIN-810'), runningWorker],
        history: [],
        agentStatus: [runningStatus]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.active.find(x => x.sessionId === 'sess-live');
    assert.ok(s, 'live session is active');
    assert.equal(s.terminal, false);
    assert.equal(s.statusLine, 'wiring the new route', 'live status line is served on the feed');
  });

  test('a terminal session serves no statusLine (uses its cached AI summary instead)', async () => {
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-t', 'LIN-820'), workerHistoryItem('w-t', 'LIN-821', 'sess-t')],
        agentStatus: [agentStatusDone('sess-t', 'LIN-820'), agentStatusDone('w-t', 'LIN-821')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.recent.find(x => x.sessionId === 'sess-t');
    assert.ok(s, 'terminal session is recent');
    assert.equal(s.terminal, true);
    assert.equal(s.statusLine, null, 'terminal sessions carry no feed status line');
  });

  test('runs ship a bounded metrics tail plus a precomputed tool peak (not every heartbeat)', async () => {
    // 10 heartbeats with rising tool counts: the feed must trim to the last 6 and
    // expose the peak (10) so a long run cannot bloat the per-poll payload.
    const beats = [];
    for (let i = 1; i <= 10; i++) beats.push({ message: `[working] ${i} tools/${i}s · alive`, timestamp: NOW_ISO });
    const longWorker = {
      id: 'w-long', sessionId: 'sess-long', issueIdentifier: 'LIN-831', issueTitle: 'Long worker',
      promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken',
      feedback: [...beats, { message: '[done] shipped it', timestamp: NOW_ISO }]
    };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-long', 'LIN-830'), longWorker],
        agentStatus: [agentStatusDone('sess-long', 'LIN-830'), agentStatusDone('w-long', 'LIN-831')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const { req, res } = makeReqRes({ session: { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const sess = res.jsonBody.recent.find(s => s.sessionId === 'sess-long');
    const run = sess.runs.find(r => r.loopId === 'w-long');
    assert.ok(run, 'worker run present');
    assert.equal(run.metrics.length, 6, 'metrics trimmed to the recent tail');
    assert.equal(run.toolPeak, 10, 'peak tool count precomputed across ALL heartbeats');
  });

  test('a [failed] worker yields an error-status session', async () => {
    const failWorker = { id: 'wf', sessionId: 'sess-9', issueIdentifier: 'LIN-301', issueTitle: 'T', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] };
    const perWorkspace = {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-9', 'LIN-300'), failWorker],
        agentStatus: [agentStatusDone('sess-9', 'LIN-300')]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.recent.find(x => x.sessionId === 'sess-9');
    assert.ok(s, 'terminal session is recent');
    assert.equal(s.status, 'error');
  });

  test('a non-terminal session idle > 24h is derived stale and bucketed out of Active', async () => {
    // Worker that died without a terminal marker, last seen 2 days ago (Bug 3).
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const staleAnchor = { id: 'sess-stale', kind: 'autopilot', issueIdentifier: 'LIN-700', issueTitle: 'Stale session', promptName: 'autopilot', prompt: 'p', dispatchedAt: OLD_ISO };
    const router = makeRouter({ 'ws-a': { live: [staleAnchor], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.recent.find(x => x.sessionId === 'sess-stale');
    assert.ok(s, 'stale session lands in the archive, not Active');
    assert.equal(s.stale, true);
    assert.equal(s.status, 'stale');
    assert.equal(s.terminal, false, 'stale is derived, never a terminal mutation');
    assert.ok(!res.jsonBody.active.some(x => x.sessionId === 'sess-stale'), 'stale session is not in Active');
  });

  test('recent child activity un-stales an otherwise-old session (stays Active)', async () => {
    const OLD_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const oldAnchor = { id: 'sess-fresh', kind: 'autopilot', issueIdentifier: 'LIN-710', issueTitle: 'Fresh session', promptName: 'autopilot', prompt: 'p', dispatchedAt: OLD_ISO };
    // A worker dispatched just now → recent activity advances the session's clock.
    const liveWorker = { id: 'w-fresh', sessionId: 'sess-fresh', issueIdentifier: 'LIN-711', issueTitle: 'Worker', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO };
    const router = makeRouter({ 'ws-a': { live: [oldAnchor, liveWorker], history: [], agentStatus: [] } });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const s = res.jsonBody.active.find(x => x.sessionId === 'sess-fresh');
    assert.ok(s, 'a later heartbeat keeps the session in Active');
    assert.equal(s.stale, false);
    assert.equal(s.status, 'in-progress');
  });

  test('one failing workspace store does not blank the whole feed', async () => {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return []; },
        async listHistory(urlKey) { if (urlKey === 'bad') throw new Error('store down'); return { items: [autopilotHistoryItem('sess-x', 'LIN-400')] }; }
      },
      agentStatusStore: { async listStatus() { return { items: [agentStatusDone('sess-x', 'LIN-400')] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'bad', name: 'Bad' }, { urlKey: 'good', name: 'Good' }] };
    const { req, res } = makeReqRes({ session });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.counts.total, 1, 'good workspace still contributes its session');
  });

  test('a second poll within the cache TTL is served without re-reading the stores (LIN-617)', async () => {
    // Count how often the slow whole-workspace read actually runs. With the
    // short-TTL feed cache, only the FIRST poll for this workspace set pays it;
    // the second poll is served from the cached merged feed.
    let historyReads = 0;
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: {
        async listItems() { return []; },
        async listHistory() { historyReads++; return { items: [autopilotHistoryItem('sess-c', 'LIN-617')] }; }
      },
      agentStatusStore: { async listStatus() { return { items: [agentStatusDone('sess-c', 'LIN-617')] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/sessions');
    const session = { ...ENABLED, workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] };

    const first = makeReqRes({ session });
    await handler(first.req, first.res);
    assert.equal(first.res.statusCode, 200);
    assert.equal(first.res.jsonBody.counts.total, 1);
    assert.equal(historyReads, 1, 'first poll pays the whole-workspace read');

    const second = makeReqRes({ session });
    await handler(second.req, second.res);
    assert.equal(second.res.statusCode, 200);
    assert.deepEqual(
      second.res.jsonBody.recent.map(s => s.sessionId),
      first.res.jsonBody.recent.map(s => s.sessionId),
      'second poll returns the same feed'
    );
    assert.equal(historyReads, 1, 'second poll within TTL is served from cache (no re-scan)');
  });
});

// ─── run-summary ─────────────────────────────────────────────────────────────

describe('run-summary endpoint', () => {
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

  test('a live session with only a RUNNING child surfaces that child\'s live summary (Bug 2)', async () => {
    // Regression for "tasks in progress don't get summaries" (LIN-608): before the
    // fix, liveStatusLine filtered to terminal children only, so a session whose
    // latest child is still running returned an empty status line forever (the UI
    // showed a permanent "◐ working…"). It must now fall back to the running
    // child's own agentSummary — deterministically, no LLM call.
    const runningWorker = { dispatchId: 'w-run', taskIdentifier: 'LIN-801', action: 'implementation', status: 'working', summary: 'Refactoring the parser', timestamp: NOW_ISO };
    const perWorkspace = {
      'ws-a': {
        live: [autopilotLiveItem('sess-live', 'LIN-800')],
        history: [workerHistoryItem('w-run', 'LIN-801', 'sess-live')],
        agentStatus: [runningWorker]
      }
    };
    const router = makeRouter(perWorkspace);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-live' } });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.status, 'live');
    assert.equal(res.jsonBody.live, true);
    assert.match(res.jsonBody.summary.statusLine, /Refactoring the parser/, 'running child summary is surfaced');
    assert.equal(res.jsonBody.statusLineLoopId, 'w-run');
  });
});

// ─── session-context ───────────────────────────────────────────────────────────

describe('session-context endpoint', () => {
  // Same terminal session as session-summary: autopilot anchor 'sess-1' on LIN-100
  // (seed) + worker 'w-1' on LIN-101. So tasksTouched = [LIN-100, LIN-101].
  function terminalSessionWorkspace() {
    return {
      'ws-a': {
        live: [],
        history: [autopilotHistoryItem('sess-1', 'LIN-100'), workerHistoryItem('w-1', 'LIN-101', 'sess-1')],
        agentStatus: [agentStatusDone('sess-1', 'LIN-100'), agentStatusDone('w-1', 'LIN-101')]
      }
    };
  }

  // An issue set where LIN-101 is a breakdown child of the seed LIN-100, created
  // in the run window (createdAt === dispatchedAt = NOW_ISO) → spun-off.
  function issueSet() {
    const mk = (id, identifier, parentIdent, createdAt) => ({
      id, identifier, title: `Title ${identifier}`, url: `https://x/${identifier}`,
      state: { name: 'In Progress', type: 'started' },
      parent: parentIdent ? { id: parentIdent } : null,
      createdAt,
      relations: { nodes: [] }, inverseRelations: { nodes: [] }
    });
    return [
      mk('LIN-100', 'LIN-100', null, '2020-01-01T00:00:00.000Z'),     // seed, pre-existing
      mk('LIN-101', 'LIN-101', 'LIN-100', NOW_ISO)                    // spun-off in window
    ];
  }

  test('404 when the session is not found', async () => {
    const router = makeRouter({ 'ws-a': { history: [], live: [], agentStatus: [] } }, { issues: issueSet() });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'nope' } });
    await handler(req, res);
    assert.equal(res.statusCode, 404);
  });

  test('returns a provenance-tagged session graph for the touched tasks', async () => {
    const router = makeRouter(terminalSessionWorkspace(), { issues: issueSet() });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: { sessionId: 'sess-1' } });
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const body = res.jsonBody;
    assert.equal(body.sessionId, 'sess-1');
    assert.equal(body.seedIssue, 'LIN-100');
    assert.deepEqual(body.tasksTouched, ['LIN-100', 'LIN-101']);
    // The graph carries one node per touched task, seed first, each tagged.
    const tags = Object.fromEntries(body.graph.tasks.map(t => [t.root.identifier, t.provenance]));
    assert.equal(tags['LIN-100'], 'seed');
    assert.equal(tags['LIN-101'], 'spun-off', 'breakdown child created in-window is spun-off');
    // LIN-101's neighborhood shows its parent is the seed (parent/children edge).
    const child = body.graph.tasks.find(t => t.root.identifier === 'LIN-101');
    assert.equal(child.parent.identifier, 'LIN-100');
  });

  test('400 when sessionId is missing', async () => {
    const router = makeRouter(terminalSessionWorkspace(), { issues: issueSet() });
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/dashboard/session-context/:sessionId');
    const { req, res } = makeReqRes({ session: ENABLED, workspace: { urlKey: 'ws-a' }, params: {} });
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });
});

// ─── Request-layer keepalive on the workspace-wide reads (LIN-615) ────────────
// The /loops and /sessions feeds (and session-context) read the whole-workspace
// loop log with no selective predicate to push down. Instead of capping the
// store read (which the truncation-footgun guard forbids), the handlers arm a
// keepalive heartbeat so a slow bounded request survives Heroku's 30s H12 router
// timeout. These tests drive a deliberately-stalled store with mocked timers and
// assert the heartbeat fires, then the real JSON body still lands.

describe('workspace-wide reads arm a keepalive heartbeat (LIN-615)', () => {
  // A res that records the flushed-heartbeat path (status/setHeader/flushHeaders/
  // write/end) as well as the fast json() path.
  function makeFlushRes() {
    return {
      statusCode: 200,
      headers: {},
      flushedHeaders: false,
      writes: [],
      endedWith: undefined,
      jsonBody: null,
      writableEnded: false,
      destroyed: false,
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; return this; },
      flushHeaders() { this.flushedHeaders = true; return this; },
      write(chunk) { this.writes.push(chunk); return true; },
      json(b) { this.jsonBody = b; return this; },
      end(b) { this.endedWith = b; this.writableEnded = true; return this; }
    };
  }

  // A dispatch store whose listHistory hangs on an externally-resolved promise,
  // so the handler stays pending until we both advance timers AND release it.
  function stallableStores() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    return {
      release: () => release(),
      stores: {
        dispatchQueueStore: {
          async listItems() { return []; },
          async listHistory() { await gate; return { items: [] }; }
        },
        agentStatusStore: { async listStatus() { return { items: [] }; } }
      }
    };
  }

  async function runStalledFeed(t, path) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { release, stores } = stallableStores();
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      ...stores,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const handler = getHandler(router, 'get', path);
    const req = { session: { workspaces: [{ urlKey: 'ws-a', name: 'Alpha' }] }, params: {}, query: {}, protocol: 'http', get: () => 'localhost' };
    const res = makeFlushRes();

    const done = handler(req, res);
    // Past the 25s flush threshold: headers committed as 200 + JSON, no body yet.
    t.mock.timers.tick(25_000);
    assert.equal(res.flushedHeaders, true, 'keepalive flushed headers before the slow read finished');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/json/);
    // One heartbeat interval later: a single whitespace byte (JSON-safe).
    t.mock.timers.tick(15_000);
    assert.ok(res.writes.includes(' '), 'a keepalive heartbeat space was written');

    release();
    await done;

    // The real payload still lands, serialized into res.end (committed status path).
    assert.ok(res.endedWith, 'final JSON body delivered via res.end after the heartbeat');
    return JSON.parse(res.endedWith);
  }

  test('/api/dashboard/loops arms keepalive and still returns the feed', async (t) => {
    const body = await runStalledFeed(t, '/workspace/:urlKey/api/dashboard/loops');
    assert.ok(Array.isArray(body.active) && Array.isArray(body.recent));
    assert.ok(body.counts && typeof body.counts.total === 'number');
  });

  test('/api/dashboard/sessions arms keepalive and still returns the feed', async (t) => {
    const body = await runStalledFeed(t, '/workspace/:urlKey/api/dashboard/sessions');
    assert.ok(Array.isArray(body.active) && Array.isArray(body.recent));
    assert.ok(body.counts && typeof body.counts.total === 'number');
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
