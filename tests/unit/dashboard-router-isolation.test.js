/**
 * LIN-3742: two routers built by createDashboardRoutes share no default cache.
 *
 * The router's feed cache (`sessionsFeedCache`) and its touched-task done-state
 * cache (`taskDoneCache`) are built per call when none is injected, so one
 * router's warm entries must never answer for another's. The rebuild of
 * createDashboardRoutes moves the code that builds them; this holds the line.
 * It reads behaviour only (store reads, backend reads), never source text.
 *
 * Deliberately NOT asserted: that the default PR-state store is per call. It is
 * not: `createPrStateStore` shares one module-level cache and fetch counter and
 * gives each router only its own budget bucket (lib/pr-state-store.js), and that
 * setup lives in the run-page block, which this rebuild leaves byte-identical.
 *
 * Run with: node --test tests/unit/dashboard-router-isolation.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';

const NOW_ISO = new Date().toISOString();
const SESSIONS_PATH = '/workspace/:urlKey/api/dashboard/sessions';
const WORKSPACES = [{ urlKey: 'ws-iso', name: 'Iso' }];

// Terminal + errored session: the one class the feed hydrates a done-state for.
const history = [
  { id: 'iso-sess', kind: 'autopilot', issueIdentifier: 'LIN-900', issueTitle: 'T', promptName: 'autopilot', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken' },
  { id: 'iso-w', sessionId: 'iso-sess', issueIdentifier: 'LIN-901', issueTitle: 'T', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: '[failed] broke', timestamp: NOW_ISO }] }
];
const agentStatus = [{ id: 'as-iso-sess', dispatchId: 'iso-sess', taskIdentifier: 'LIN-900', action: 'autopilot', status: 'completed', summary: 'done', timestamp: NOW_ISO }];

function countingStores() {
  const counts = { listItems: 0, listHistory: 0 };
  return {
    counts,
    dispatchQueueStore: {
      async listItems() { counts.listItems++; return []; },
      async listHistory() { counts.listHistory++; return { items: withFreshDigests(history) }; }
    },
    agentStatusStore: { async listStatus() { return { items: agentStatus }; } }
  };
}

function build(stores, extra = {}) {
  return createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    observationSessionsStore: null,
    runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
    freeTierStore: { async tryUse() { return { allowed: true }; } },
    getWorkspaceAccessToken: async () => 'token',
    fetchIssueContext: async () => ({ issue: { state: { name: 'Done', type: 'completed' } } }),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({}),
    ...extra
  });
}

function sessionsHandler(router) {
  const matches = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        if (layer.route.path === SESSIONS_PATH && layer.route.methods.get) matches.push(layer);
      } else if (Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  assert.equal(matches.length, 1, 'the sessions route is registered exactly once');
  return matches[0].route.stack[matches[0].route.stack.length - 1].handle;
}

async function poll(router) {
  const req = { session: { workspaces: WORKSPACES, features: {} }, query: {}, params: {}, body: {} };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(b) { this.jsonBody = b; return this; },
    setHeader() { return this; },
    on() { return this; },
    once() { return this; },
    end() { return this; },
    headersSent: false
  };
  await sessionsHandler(router)(req, res);
  assert.equal(res.statusCode, 200);
  return res.jsonBody;
}

describe('LIN-3742: per-call default caches', () => {
  test('(a) a feed read on router A leaves router B\'s feed cache empty (B re-reads the store)', async () => {
    const stores = countingStores();
    const routerA = build(stores);
    const routerB = build(stores);

    await poll(routerA);
    const afterA = stores.counts.listHistory;
    assert.ok(afterA > 0, 'router A paid the store read');

    await poll(routerB);
    assert.ok(stores.counts.listHistory > afterA, 'router B did not reuse router A\'s warm feed entry');
  });

  test('(b) a Done short-circuit cached on router A\'s task-done cache is re-read by router B', async () => {
    const stores = countingStores();
    let reads = 0;
    const fetchIssueContext = async () => { reads++; return { issue: { state: { name: 'Done', type: 'completed' } } }; };
    // Pass-through feed caches so every poll re-enters the merge and only the
    // task-done cache can absorb a repeat backend read.
    const passThrough = () => ({ keyFor: () => 'k', peek: () => undefined, clear() {}, get: async (_k, producer) => producer() });
    const routerA = build(stores, { fetchIssueContext, sessionsFeedCache: passThrough() });
    const routerB = build(stores, { fetchIssueContext, sessionsFeedCache: passThrough() });

    await poll(routerA);
    assert.equal(reads, 1, 'router A read the touched task once');
    await poll(routerA);
    assert.equal(reads, 1, 'router A\'s own repeat poll is a free cache hit');

    await poll(routerB);
    assert.equal(reads, 2, 'router B did not reuse router A\'s cached done-state');
  });
});
