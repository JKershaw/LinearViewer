/**
 * Keepalive-body characterization for group F compute (LIN-679 Stage 4 /
 * LIN-2538).
 *
 * All 5 `armKeepalive(res)` sites in routes/proxy-compute.js (recommend, recap
 * GET+POST, brief GET+POST) use the default 25s delayMs with no injection
 * seam, so an HTTP-level request always takes the un-flushed
 * `res.status(status).json(body)` branch in a unit test — the wrong branch to
 * characterize this hazard. This constructs the F sub-router directly via
 * `createComputeRoutes({...})` and pulls a keepalive-guarded handler off its
 * own `router.stack` (POST /api/proxy/recap/:identifier, a string-path
 * registration), per the confirmed in-repo template
 * tests/unit/ship-biscuit-route.test.js:76-140 (mocked timers, a
 * stall-then-release gate, a fake res recording the flushed write/end path).
 *
 * lib/http-keepalive.js's `send()` emits `{...body, statusCode: status}` over
 * a COMMITTED HTTP 200 once flushed — so a characterization of the flushed
 * error branch must assert on the response BODY, never `res.statusCode`
 * (which reads 200 regardless of the logical outcome once flushed).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createComputeRoutes } from '../../routes/proxy-compute.js';

// A res that records both the flushed-heartbeat path (status/setHeader/
// flushHeaders/write/end) and the fast json() path — same shape as the
// ship-biscuit-route.test.js template.
function makeFlushRes() {
  return {
    statusCode: 200,
    headers: {},
    flushedHeaders: false,
    writes: [],
    endedWith: undefined,
    jsonBody: null,
    jsonStatus: null,
    writableEnded: false,
    destroyed: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    flushHeaders() { this.flushedHeaders = true; return this; },
    write(chunk) { this.writes.push(chunk); return true; },
    json(b) { this.jsonBody = b; this.jsonStatus = this.statusCode; return this; },
    end(b) { this.endedWith = b; this.writableEnded = true; return this; }
  };
}

// Grab the actual route handler (last in the route stack, after the
// proxyLimiter/authenticateProxyToken middleware). POST /recap and POST
// /brief are the two string-path (non-array) F registrations.
function getRouteHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Minimal deps for createComputeRoutes, scoped to what POST /recap's
// isTestMode path actually touches. `getTestMockData` is the injected,
// gatable seam this test stalls on (mirrors the LIN-615/LIN-1203 templates'
// stalled store read) — real getTestMockData lazy-loads a fixture module,
// but that indirection is irrelevant to the keepalive branch under test, so a
// direct fake in-memory dataset is used instead.
function buildRouter({ issues }) {
  const noop = (req, res, next) => next();
  const recapDoc = { current: null };
  return createComputeRoutes({
    recapCacheStore: {
      async put(urlKey, canonicalId, doc) { recapDoc.current = { ...doc, generatedAt: new Date('2026-09-05T00:00:00Z') }; },
      async get() { return recapDoc.current; }
    },
    briefCacheStore: null,
    taskSnapshotStore: null,
    dispatchQueueStore: null,
    llmCallLogStore: null,
    getWorkspaceOpenRouterKey: async () => null,
    getWorkspaceNorthStar: async () => null,
    getNorthStarDocVersionForWorkspace: async () => null,
    reportHistoryStore: null,
    workspacePreferencesStore: null,
    proxyLimiter: noop,
    authenticateProxyToken: noop,
    resolveProviderAccess: async () => ({ token: 'test-token', reason: null, provider: {} }),
    denyIfUnsupported: () => false,
    logEvent: () => {},
    logOpenRouterCredentialSource: () => {},
    workspaceUnavailable: () => {},
    graphqlErrorStatus: () => 500,
    captureTaskSnapshot: () => {},
    chargeFreeTierOrReject: async () => null,
    computeRecommendation: async () => { throw new Error('not exercised by this test'); },
    recommendErrorResponse: () => ({ status: 500, body: { error: 'not exercised by this test' } }),
    resolveProxyLLM: () => ({ apiKey: undefined, isFreeTier: false }),
    resolvePromptIssueContext: async () => { throw new Error('not exercised by this test'); },
    withTimeout: async (p) => p,
    LINEAGE_QUERY_LIMIT: 2000,
    RECOMMEND_DESCENT_BUDGET_MS: 180_000,
    LLM_TIMEOUT_MS: 180_000,
    getTestMockData: issues.getTestMockData,
    fetchWithTimeout: async (workFn) => workFn(new AbortController().signal),
    CONTEXT_FETCH_TIMEOUT_MS: 45_000,
  });
}

describe('routes/proxy-compute.js keepalive-body characterization (LIN-2538)', () => {
  test('POST /recap: a >25s test-mode fetch flushes 200 + a heartbeat, then delivers the recap via the flushed res.end body', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const getTestMockData = async () => {
      await gate;
      return {
        // A completed AND an open child (LIN-2538 H3): exercises isTerminalState
        // inside buildMockRecapFromContext's remainingChildren filter — an
        // empty children array would never actually call it, silently
        // masking a dropped `../lib/tree.js` import (ReferenceError, per H3).
        issues: [{
          id: 'iss-1', identifier: 'LIN-1', title: 'Task one', description: 'desc',
          state: { name: 'Todo', type: 'unstarted' }, labels: { nodes: [] }, comments: { nodes: [] },
          children: { nodes: [
            { id: 'iss-2', identifier: 'LIN-2', title: 'Done child', state: { type: 'completed' } },
            { id: 'iss-3', identifier: 'LIN-3', title: 'Open child', state: { type: 'started' } }
          ] }
        }],
        projects: []
      };
    };

    const router = buildRouter({ issues: { getTestMockData } });
    const handler = getRouteHandler(router, 'post', '/api/proxy/recap/:identifier');

    const req = { proxyUrlKey: 'ws-a', proxyCreatedBy: 'acct-1', params: { identifier: 'LIN-1' }, body: {} };
    const res = makeFlushRes();

    const done = handler(req, res);

    // Flush every already-resolved microtask (resolveProviderAccess,
    // getWorkspaceOpenRouterKey) so the handler actually reaches
    // armKeepalive(res) and arms its (mocked) setTimeout before we tick —
    // a bare tick() right after calling the handler would fire too early.
    await new Promise((resolve) => setImmediate(resolve));

    // Past the 25s flush threshold: HTTP 200 + JSON committed, no body yet.
    t.mock.timers.tick(25_000);
    assert.equal(res.flushedHeaders, true, 'keepalive flushed headers before the stalled fixture load finished');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/json/);
    assert.equal(res.endedWith, undefined, 'no body committed yet — still stalled on getTestMockData');

    // One heartbeat interval later: a single JSON-safe whitespace byte.
    t.mock.timers.tick(15_000);
    assert.ok(res.writes.includes(' '), 'a keepalive heartbeat space was written past the H12 cap');

    // Release the stalled fixture load; the recap now rides the *flushed* send path.
    release();
    await done;

    assert.ok(res.endedWith, 'recap delivered via res.end on the committed-200 path');
    const body = JSON.parse(res.endedWith);
    assert.equal(body.status, 'fresh');
    assert.equal(body.identifier, 'LIN-1');
    assert.deepEqual(body.recap, {
      done: [{ item: 'Description documented', evidence: 'Description is present on the issue' }],
      // The completed child is filtered out by isTerminalState; only the open
      // one surfaces as pending — proof isTerminalState actually resolved
      // (an omitted `../lib/tree.js` import would ReferenceError here, H3).
      pending: [{ item: 'Complete subtask LIN-3', predicted: 'Open child' }],
      deviations: []
    }, 'recap body carries the deterministic mock recap shape (one open child pending, no comments, a description)');
    // The fast json() path must NOT have been used — the whole point is the flushed branch.
    assert.equal(res.jsonBody, null, 'recap rode the flushed res.end path, not the fast res.json path');
  });

  test('POST /recap: an issue-not-found error past the flush threshold carries its real status in the BODY, not res.statusCode (which is stuck at 200)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    // No matching issue → buildMockRecapContextFromFixtures resolves to null.
    const getTestMockData = async () => {
      await gate;
      return { issues: [], projects: [] };
    };

    const router = buildRouter({ issues: { getTestMockData } });
    const handler = getRouteHandler(router, 'post', '/api/proxy/recap/:identifier');

    const req = { proxyUrlKey: 'ws-a', proxyCreatedBy: 'acct-1', params: { identifier: 'LIN-999999' }, body: {} };
    const res = makeFlushRes();

    const done = handler(req, res);

    // Flush every already-resolved microtask (resolveProviderAccess,
    // getWorkspaceOpenRouterKey) so the handler actually reaches
    // armKeepalive(res) and arms its (mocked) setTimeout before we tick.
    await new Promise((resolve) => setImmediate(resolve));

    t.mock.timers.tick(25_000);
    assert.equal(res.flushedHeaders, true, 'keepalive flushed headers before the stalled fixture load finished');
    t.mock.timers.tick(15_000);
    assert.ok(res.writes.includes(' '), 'a keepalive heartbeat space was written past the H12 cap');

    release();
    await done;

    // The real outcome is a 404, but HTTP status was already committed to 200
    // by the flush above — armKeepalive.send() cannot change it. The logical
    // status only reaches the caller via the body's own `statusCode` field.
    assert.equal(res.statusCode, 200, 'HTTP status stays 200 — already committed by the flush, cannot be un-committed');
    assert.ok(res.endedWith, 'error delivered via res.end on the committed-200 path');
    const body = JSON.parse(res.endedWith);
    assert.equal(body.statusCode, 404, 'the real outcome rides in the body, not the (already-committed) HTTP status');
    assert.equal(body.error, 'Issue not found');
    assert.equal(res.jsonBody, null, 'error rode the flushed res.end path, not the fast res.json path');
  });
});
