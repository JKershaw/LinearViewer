/**
 * The dashboard route fixture (LIN-4308): the helpers that drive `createDashboardRoutes` through its handlers. Shared by
 * `tests/unit/dashboard-routes.test.js` and the client suite that paints the rulings badge from this route's JSON
 * (`tests/unit/rulings-badge-client.test.js`). Only helpers used by more than one suite live here; a helper one suite
 * uses stays in that suite.
 *
 * No `test()` and no `describe()` here: importing this module runs nothing. `NOW_ISO` is computed once, when the module
 * first loads, so every importer sees the same value (`decisionItem` reads it).
 */
import assert from 'node:assert';
import { createDashboardRoutes as createDashboardRoutes__unplumbed } from '../../routes/dashboard.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';
import { withFreshDigests } from './with-fresh-digests.js';
import { NO_REQUEST_RECORDS, withDefaults } from './request-usage-loader.js';

export const NOW_ISO = new Date().toISOString();

// LIN-4201: these tests read snapshot-only lineages, so they pass "no request records" explicitly (plumbing only).
export const createDashboardRoutes = withDefaults(createDashboardRoutes__unplumbed, 0, { requestUsageLoader: NO_REQUEST_RECORDS });

export function makeStores(perWorkspace) {
  return {
    dispatchQueueStore: {
      // `withFreshDigests` here too: a handful of fixtures below simulate a
      // still-live item that ALREADY carries feedback (an edge case, since
      // production live items never do — feedback only ever lands on an
      // archived/history row) to exercise a derived field before archival.
      async listItems(urlKey) { return withFreshDigests(perWorkspace[urlKey]?.live || []); },
      async listHistory(urlKey) { return { items: withFreshDigests(perWorkspace[urlKey]?.history || []) }; }
    },
    agentStatusStore: {
      async listStatus(urlKey) { return { items: perWorkspace[urlKey]?.agentStatus || [] }; }
    }
  };
}

// LIN-3840: one finder, structure only. It descends nested routers
// (`layer.handle.stack`) so the test does not care whether createDashboardRoutes
// registers a route directly or through a router it mounts, returns the single
// matching route layer, and fails on zero or more than one match. It loosens no
// guard: every assertion made on the layer or its handler is unchanged.
export function findRouteLayer(router, method, path) {
  const matches = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        if (layer.route.path === path && layer.route.methods[method]) matches.push(layer);
      } else if (Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  assert.ok(matches.length > 0, `${method.toUpperCase()} ${path} route is registered`);
  assert.equal(matches.length, 1, `${method.toUpperCase()} ${path} is registered ${matches.length} times, expected exactly once`);
  return matches[0];
}

export function getHandler(router, method, path) {
  const layer = findRouteLayer(router, method, path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

export function makeReqRes({ session = {}, workspace = null, params = {}, query = {} } = {}) {
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

export function makeRouter(perWorkspace, { runSummaryCacheStore, sessionSummaryCacheStore, runParagraphStore, issues, observationSessionsStore, prState, freeTierStore } = {}) {
  const { dispatchQueueStore, agentStatusStore } = makeStores(perWorkspace);
  return createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore,
    agentStatusStore,
    observationSessionsStore: observationSessionsStore || null,
    runSummaryCacheStore: runSummaryCacheStore || new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: sessionSummaryCacheStore || new InMemorySessionSummaryCacheStore(),
    runParagraphStore: runParagraphStore || new InMemoryRunParagraphStore(),
    prState: prState || null,
    freeTierStore: freeTierStore || { async tryUse() { return { allowed: true }; } },
    getWorkspaceAccessToken: async () => 'token',
    // Default touched-task state is NOT done, so the LIN-1258 bounded feed
    // hydration leaves an eligible (terminal+error) session at 'error' — the
    // pre-hydration feed behaviour these shared tests assert. Tests that want a
    // task hydrated to Done (drill-in, or the done-with-warning upgrade) inject
    // their own `fetchIssueContext` returning a `completed` state.
    fetchIssueContext: async () => ({ issue: { state: { name: 'In Progress', type: 'started' }, labels: { nodes: [] } } }),
    fetchWorkspaceIssues: async () => issues || [],
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({})
  });
}

// A taken history item carrying a `kind:'decision'` feedback entry (the
// same shape `hook.js`'s complete-path emission and a `[blocked]`-parked
// wait both produce) — the input the rulings predicate reads.
export function decisionItem(id, identifier, decisionId, extraFeedback = []) {
  return {
    id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`,
    promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO,
    status: 'taken',
    feedback: [
      { message: '[blocked] need a decision', timestamp: NOW_ISO },
      { kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Proceed?' }), timestamp: NOW_ISO },
      ...extraFeedback
    ]
  };
}
