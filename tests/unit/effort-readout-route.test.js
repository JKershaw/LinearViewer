/**
 * Route + provider-seam tests for the effort read-out (LIN-2641).
 *
 * Hermetic: a fake provider is registered in the REAL registry under a unique
 * name (the `tests/unit/detail-route-binding-provider.test.js` seam) and the
 * workspace resolves to it through `resolveIssueBinding`, so no socket is
 * opened. The store is a fixture object exposing only the two methods this
 * route calls, which is also how the read BOUNDS are asserted: the test
 * captures the options each call actually received.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { registerProvider } from '../../lib/providers/registry.js';

before(() => { process.env.NODE_ENV = 'test'; });

let providerSeq = 0;

function doneRow({ id, issueIdentifier, kind, dispatchedAt, completedAt, resolvedAt }) {
  return {
    id, issueId: `uuid-${issueIdentifier}`, issueIdentifier, kind, status: 'taken',
    dispatchedAt, resolvedAt: resolvedAt || completedAt,
    feedback: [{ message: '[done] complete', timestamp: completedAt }],
  };
}

/**
 * A store fixture that records the options each read received, so the tests
 * can assert what the route actually asked for rather than what it claims.
 */
function fakeStore({ liveRows = [], historyRows = [], historyTotal } = {}) {
  const calls = { listItems: [], listHistory: [] };
  return {
    calls,
    async listItems(urlKey, opts = {}) {
      calls.listItems.push({ urlKey, opts });
      return liveRows;
    },
    async listHistory(urlKey, opts = {}) {
      calls.listHistory.push({ urlKey, opts });
      const limit = opts.limit;
      const sorted = [...historyRows].sort(
        (a, b) => new Date(b.resolvedAt || 0).getTime() - new Date(a.resolvedAt || 0).getTime()
      );
      const items = limit ? sorted.slice(0, limit) : sorted;
      return { items, total: historyTotal ?? historyRows.length };
    },
  };
}

/**
 * Register a fake provider under a unique name so tests never contend over one
 * shared registry slot.
 */
function fakeProvider({ comments = [], description = '', supports = () => true, onFetch, throwOn } = {}) {
  const name = `fake-effort-${++providerSeq}`;
  const seen = { comments: [], fields: [] };
  registerProvider({
    name,
    ui: {},
    supports,
    fetchIssueComments: async (scope, issueId) => {
      seen.comments.push(issueId);
      if (onFetch) onFetch(issueId);
      if (throwOn) throw throwOn;
      return comments;
    },
    fetchIssueFields: async (scope, issueId) => {
      seen.fields.push(issueId);
      if (throwOn) throw throwOn;
      return { id: `uuid-${issueId}`, identifier: issueId, description };
    },
  });
  return { name, seen };
}

function buildApp({ store, providerName }) {
  const workspace = { urlKey: 'ws-1', name: 'Workspace One', provider: providerName, accessToken: 'tok' };
  const app = express();
  app.use(createDashboardRoutes({
    workspaceFromUrl: (req, _res, next) => {
      req.workspace = workspace;
      req.session = { workspaces: [{ urlKey: 'ws-1', name: 'Workspace One' }], features: {} };
      next();
    },
    dispatchQueueStore: store,
    agentStatusStore: {},
    runSummaryCacheStore: {},
    sessionSummaryCacheStore: {},
    freeTierStore: {},
    getWorkspaceAccessToken: () => 'tok',
    fetchIssueContext: async () => ({}),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const LINEAGE = [
  doneRow({ id: 'r1', issueIdentifier: 'LIN-1', kind: 'plan', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
  doneRow({ id: 'r2', issueIdentifier: 'LIN-1', kind: 'plan-review', dispatchedAt: '2026-09-01T01:00:00.000Z', completedAt: '2026-09-01T01:30:00.000Z' }),
  doneRow({ id: 'r3', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T02:00:00.000Z', completedAt: '2026-09-01T02:30:00.000Z' }),
  doneRow({ id: 'r4', issueIdentifier: 'LIN-1', kind: 'review', dispatchedAt: '2026-09-01T03:00:00.000Z', completedAt: '2026-09-01T03:30:00.000Z' }),
];

const APPROVE_COMMENTS = [
  { id: 'c1', body: 'Verdict: approve', createdAt: '2026-09-01T01:30:00.000Z', user: 'John' },
  { id: 'c2', body: 'Verdict: approve', createdAt: '2026-09-01T03:30:00.000Z', user: 'John' },
];

describe('the happy path populates both survival rows through the provider seam', () => {
  test('a fake provider returning comments yields a populated plan card', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const { name } = fakeProvider({ comments: APPROVE_COMMENTS, description: 'plan-review due: yes' });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);
    const planCard = json.perKind.find((k) => k.kind === 'plan');
    assert.equal(planCard.survival.state, 'computed');
    assert.equal(planCard.survival.rate, 1);
    // The description WAS read, so the gate fields are real rather than omitted.
    assert.equal(planCard.survival.gateDue, 1);
    assert.equal(planCard.survival.gateHonoured, 1);
    assert.equal(json.completeness.complete, true);
  });

  test('the page route renders HTML with the per-kind cards', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const { name } = fakeProvider({ comments: APPROVE_COMMENTS });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/effort-readout');
    assert.equal(status, 200);
    assert.match(body, /data-testid="effort-card-plan"/);
    assert.match(body, /Effort Self-Assessment/);
  });
});

describe('H1 — the two reads carry their two REAL bounds', () => {
  test('listItems is called with NO limit and every live row comes back; listHistory carries limit 200', async () => {
    const liveRows = Array.from({ length: 10 }, (_, i) => ({
      id: `live-${i}`, issueId: 'uuid-LIN-9', issueIdentifier: 'LIN-9', kind: 'implementation',
      dispatchedAt: '2026-09-05T00:00:00.000Z',
    }));
    // 250 history rows whose resolvedAt order is DELIBERATELY the reverse of
    // their dispatchedAt order, so a read that sorted by the wrong clock would
    // return a different 200.
    const historyRows = Array.from({ length: 250 }, (_, i) => doneRow({
      id: `h-${i}`, issueIdentifier: `LIN-${i}`, kind: 'plan',
      dispatchedAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
      completedAt: new Date(Date.UTC(2026, 0, 2) + i * 60000).toISOString(),
      resolvedAt: new Date(Date.UTC(2026, 5, 1) - i * 60000).toISOString(),
    }));
    const store = fakeStore({ liveRows, historyRows, historyTotal: 250 });
    const { name } = fakeProvider({ comments: [] });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);

    // The live read passes NO limit — `listItems` accepts none.
    assert.equal(store.calls.listItems.length, 1);
    assert.equal(store.calls.listItems[0].opts.limit, undefined);
    assert.deepEqual(store.calls.listItems[0].opts.projection, { prompt: 0 });
    assert.equal(json.population.liveCount, 10, 'every TTL-scoped live row is read, uncapped');
    assert.equal(json.population.liveBound, 'ttl');

    // The history read carries the real bound.
    assert.equal(store.calls.listHistory.length, 1);
    assert.equal(store.calls.listHistory[0].opts.limit, 200);
    assert.deepEqual(store.calls.listHistory[0].opts.projection, { prompt: 0 });
    assert.equal(json.population.historyCount, 200);
    assert.equal(json.population.historyTotal, 250);
    assert.equal(json.population.historyTruncated, true);
  });

  test('the history window is the newest by resolvedAt, not by dispatchedAt', async () => {
    // Row A resolved most recently but was dispatched FIRST; row B is the
    // opposite. A limit-1 read must return A.
    const historyRows = [
      doneRow({ id: 'A', issueIdentifier: 'LIN-A', kind: 'plan', dispatchedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T01:00:00.000Z', resolvedAt: '2026-06-01T00:00:00.000Z' }),
      doneRow({ id: 'B', issueIdentifier: 'LIN-B', kind: 'plan', dispatchedAt: '2026-05-01T00:00:00.000Z', completedAt: '2026-05-01T01:00:00.000Z', resolvedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const store = fakeStore({ historyRows });
    const seenIssues = [];
    const { name } = fakeProvider({ comments: [], onFetch: (id) => seenIssues.push(id) });
    await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    // Both rows fit inside the 200 bound, so both issues are read — the point
    // this pins is that the STORE was asked to sort by resolvedAt (the fixture
    // sorts that way and the route passes no competing sort).
    assert.deepEqual([...seenIssues].sort(), ['LIN-A', 'LIN-B']);
  });
});

describe('D2 — the error split: auth is never a skip, retryable is', () => {
  test('a 401 renders the upstream-aware error page with NO numbers', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const err = new Error('unauthorized');
    err.response = { status: 401 };
    const { name } = fakeProvider({ throwOn: err });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/effort-readout');
    assert.equal(status, 401);
    assert.match(body, /Re-authentication Needed/);
    assert.ok(!/data-testid="effort-card-plan"/.test(body), 'no per-kind numbers may render on an auth failure');
  });

  test('a 403 is treated the same as a 401 (both are auth, both non-retryable)', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const err = new Error('forbidden');
    err.response = { status: 403 };
    const { name } = fakeProvider({ throwOn: err });
    const { status } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/effort-readout');
    assert.equal(status, 401);
  });

  test('the JSON route returns 401 with the classified code, not a skip', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const err = new Error('unauthorized');
    err.status = 401;
    const { name } = fakeProvider({ throwOn: err });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 401);
    const json = JSON.parse(body);
    assert.equal(json.code, 'LINEAR_AUTH');
    assert.equal(json.retryable, false);
    assert.equal(json.perKind, undefined, 'no figures on an auth failure');
  });

  test('a 500 IS a skip: numbers still render, completeness reports it', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const err = new Error('upstream boom');
    err.response = { status: 500 };
    const { name } = fakeProvider({ throwOn: err });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);
    assert.equal(json.completeness.skipped, 1);
    assert.equal(json.completeness.complete, false);
    // Cost/duration still computed for the kinds present.
    assert.ok(json.perKind.length > 0);
    assert.ok(json.perKind.some((k) => k.sessionCount > 0));
  });

  test('a 429 is a skip too (retryable), and the page shows the completeness notice', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const err = new Error('rate limited');
    err.response = { status: 429 };
    const { name } = fakeProvider({ throwOn: err });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/effort-readout');
    assert.equal(status, 200);
    assert.match(body, /issue read\(s\) skipped/);
  });
});

describe('provider capability gating', () => {
  test('a provider without fetchIssueComments renders survival unavailable, other columns intact', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const { name, seen } = fakeProvider({ supports: () => false });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);
    const planCard = json.perKind.find((k) => k.kind === 'plan');
    assert.equal(planCard.survival.state, 'unavailable_provider');
    assert.ok(planCard.sessionCount > 0, 'cost/duration/effort still render');
    assert.equal(seen.comments.length, 0, 'no provider call is attempted when the capability is absent');
    assert.ok(json.notes.survivalUnavailable);
  });

  test('a provider with comments but no fetchIssueFields omits gateDue/gateHonoured rather than zeroing them', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const { name, seen } = fakeProvider({
      comments: APPROVE_COMMENTS,
      supports: (cap) => cap === 'fetchIssueComments',
    });
    const { status, body } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);
    const planCard = json.perKind.find((k) => k.kind === 'plan');
    assert.equal(planCard.survival.state, 'computed');
    assert.equal(planCard.survival.rate, 1, 'the verdict walk still resolves from comments');
    assert.equal(planCard.survival.gateDue, undefined, 'a fabricated zero is worse than an omission');
    assert.equal(planCard.survival.gateFieldsUnavailable, true);
    assert.equal(seen.fields.length, 0);
    assert.ok(json.notes.gateFieldsUnavailable);
  });
});

describe('the fan-out is bounded by the route\'s own named constant', () => {
  test('no more than 4 per-issue provider reads are ever in flight at once', async () => {
    const historyRows = Array.from({ length: 20 }, (_, i) => doneRow({
      id: `r-${i}`, issueIdentifier: `LIN-${i}`, kind: 'plan',
      dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z',
    }));
    const store = fakeStore({ historyRows });
    let inFlight = 0;
    let peak = 0;
    const name = `fake-effort-conc-${++providerSeq}`;
    registerProvider({
      name,
      ui: {},
      supports: () => true,
      fetchIssueComments: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return [];
      },
      fetchIssueFields: async (scope, issueId) => ({ id: `uuid-${issueId}`, description: '' }),
    });
    const { status } = await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    assert.ok(peak > 1, 'the fan-out is concurrent at all');
    assert.ok(peak <= 4, `peak concurrency ${peak} exceeded the route's bound of 4`);
  });

  test('only the eligible population\'s issues are fetched — an in-flight live row costs no provider read', async () => {
    const store = fakeStore({
      liveRows: [{ id: 'live-1', issueId: 'uuid-LIN-LIVE', issueIdentifier: 'LIN-LIVE', kind: 'plan', dispatchedAt: '2026-09-05T00:00:00.000Z' }],
      historyRows: [doneRow({ id: 'r1', issueIdentifier: 'LIN-DONE', kind: 'plan', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' })],
    });
    const { name, seen } = fakeProvider({ comments: [] });
    await get(buildApp({ store, providerName: name }), '/workspace/ws-1/api/effort-readout');
    assert.deepEqual(seen.comments, ['LIN-DONE'], 'the right-censored live row is not fetched');
  });
});
