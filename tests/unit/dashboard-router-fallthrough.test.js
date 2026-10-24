/**
 * LIN-3742: unmatched dashboard requests fall through to the app's 404.
 *
 * createDashboardRoutes composes flat sub-routers with `router.use(...)`. A
 * sub-router that answers (or hangs on) a request it has no route for would
 * swallow it before the app's 404 handler. This mounts the composed router under
 * a real express app with a sentinel 404 and asserts that, for every module's
 * known path, a wrong method and an extra trailing segment both reach it.
 *
 * Run with: node --test tests/unit/dashboard-router-fallthrough.test.js
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { createDashboardRoutes } from '../../routes/dashboard.js';

const SENTINEL = 'FELL-THROUGH';
const W = '/workspace/ws-ft';

// [path, the one method that path serves, a method it does not]
const KNOWN = [
  ['/observation', 'GET', 'POST'],
  ['/api/dashboard/sessions', 'GET', 'POST'],
  ['/api/dashboard/loops', 'GET', 'DELETE'],
  ['/observation/session/s1', 'GET', 'POST'],
  ['/api/run/r1/pr-state', 'GET', 'POST'],
  ['/api/run/r1/proposals/p1/apply', 'POST', 'GET'],
  ['/api/run/r1/proposals/p1/decline', 'POST', 'GET'],
  ['/dashboard', 'GET', 'POST'],
  ['/api/dashboard/rulings', 'GET', 'POST'],
  ['/escalation-kpis', 'GET', 'POST'],
  ['/api/escalation-kpis', 'GET', 'POST'],
  ['/effort-readout', 'GET', 'POST'],
  ['/api/effort-readout', 'GET', 'POST'],
  ['/api/dashboard/run-summary/l1', 'GET', 'PUT'],
  ['/api/dashboard/session-summary/s1', 'GET', 'PUT'],
  ['/api/dashboard/session-context/s1', 'GET', 'POST'],
  ['/api/dashboard/hydrate/other/LIN-1', 'GET', 'POST']
];

describe('LIN-3742: unmatched dashboard requests reach the 404 handler', () => {
  let server;
  let base;

  before(async () => {
    const router = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({})
    });
    const app = express();
    app.use(router);
    app.use((req, res) => res.status(404).send(SENTINEL));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  async function reachesFallback(method, path) {
    const res = await fetch(base + W + path, { method, signal: AbortSignal.timeout(3000) });
    return res.status === 404 && (await res.text()) === SENTINEL;
  }

  for (const [path, , wrongMethod] of KNOWN) {
    test(`${wrongMethod} ${path} (wrong method) falls through`, async () => {
      assert.ok(await reachesFallback(wrongMethod, path));
    });
    test(`${path}/extra (extra segment) falls through`, async () => {
      assert.ok(await reachesFallback('GET', `${path}/extra`));
      assert.ok(await reachesFallback('POST', `${path}/extra`));
    });
  }
});
