/**
 * Route tests for the effort read-out (LIN-2641), on records (LIN-4519): the gate verdicts and the plan facts come from the
 * records store, and the route asks no provider for comments. Hermetic: the store is a fixture object exposing only the
 * methods this route calls, which is also how the read BOUNDS are asserted (the test captures the options each call got).
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDashboardRoutes as createDashboardRoutes__unplumbed } from '../../routes/dashboard.js';
import { stubLineageIdentity } from '../fixtures/lineage-identity.js';
import { NO_REQUEST_RECORDS, withDefaults } from '../fixtures/request-usage-loader.js';
// LIN-4201: these tests read snapshot-only lineages, so they pass "no request records" explicitly (plumbing only).
const createDashboardRoutes = withDefaults(createDashboardRoutes__unplumbed, 0, { requestUsageLoader: NO_REQUEST_RECORDS });


before(() => { process.env.NODE_ENV = 'test'; });

function doneRow({ id, issueIdentifier, kind, dispatchedAt, completedAt, resolvedAt }) {
  return {
    id, issueId: `uuid-${issueIdentifier}`, issueIdentifier, kind, status: 'taken',
    dispatchedAt, resolvedAt: resolvedAt || completedAt,
    feedback: [{ message: '[done] complete', timestamp: completedAt }],
  };
}

/**
 * A store fixture that records the options each read received, so the tests can assert what the route actually asked for
 * rather than what it claims.
 */
function fakeStore({ liveRows = [], historyRows = [], historyTotal, identityOnly = [] } = {}) {
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
    // The founder lookup is uncapped: `identityOnly` holds a founder the 200-row read does not return.
    lineageIdentityRows: stubLineageIdentity(() => [...liveRows, ...historyRows, ...identityOnly]),
  };
}

/**
 * The records the route reads, as fixtures. `verdicts` maps a ticket to its verdict views (`at` is the first write);
 * `plans` maps a ticket to its plan facts. `asked` captures every batched read; `fail` makes every read throw.
 */
function fakeRecords({ verdicts = {}, plans = null, fail = null } = {}) {
  const asked = { verdicts: [], plans: [] };
  return {
    asked,
    async verdictFactsForTickets(urlKey, tickets) {
      asked.verdicts.push([urlKey, tickets]);
      if (fail) throw fail;
      return new Map(tickets.map((t) => [t, { measured: true, taskId: `task-${t}`, verdicts: verdicts[t] || [] }]));
    },
    async planFactsForTickets(urlKey, tickets) {
      asked.plans.push([urlKey, tickets]);
      if (fail) throw fail;
      return new Map(tickets.map((t) => [t, plans ? plans(t) : { measured: true, reviewAsked: true, everPlanned: true }]));
    },
  };
}

function buildApp({ store, recordsStore = null }) {
  const workspace = { urlKey: 'ws-1', name: 'Workspace One', provider: 'local', accessToken: 'tok' };
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
    recordsStore,
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

// Before the verdict cutover (2026-11-21): these rows' gate verdicts read not measured.
const LINEAGE = [
  doneRow({ id: 'r1', issueIdentifier: 'LIN-1', kind: 'plan', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
  doneRow({ id: 'r2', issueIdentifier: 'LIN-1', kind: 'plan-review', dispatchedAt: '2026-09-01T01:00:00.000Z', completedAt: '2026-09-01T01:30:00.000Z' }),
  doneRow({ id: 'r3', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-09-01T02:00:00.000Z', completedAt: '2026-09-01T02:30:00.000Z' }),
  doneRow({ id: 'r4', issueIdentifier: 'LIN-1', kind: 'review', dispatchedAt: '2026-09-01T03:00:00.000Z', completedAt: '2026-09-01T03:30:00.000Z' }),
];

// After the cutover: the same four rows a week later.
const LATE_LINEAGE = [
  doneRow({ id: 'r1', issueIdentifier: 'LIN-1', kind: 'plan', dispatchedAt: '2026-11-25T00:00:00.000Z', completedAt: '2026-11-25T00:30:00.000Z' }),
  doneRow({ id: 'r2', issueIdentifier: 'LIN-1', kind: 'plan-review', dispatchedAt: '2026-11-25T01:00:00.000Z', completedAt: '2026-11-25T01:30:00.000Z' }),
  doneRow({ id: 'r3', issueIdentifier: 'LIN-1', kind: 'implementation', dispatchedAt: '2026-11-25T02:00:00.000Z', completedAt: '2026-11-25T02:30:00.000Z' }),
  doneRow({ id: 'r4', issueIdentifier: 'LIN-1', kind: 'review', dispatchedAt: '2026-11-25T03:00:00.000Z', completedAt: '2026-11-25T03:30:00.000Z' }),
];

// Approvals as verdict records: each gate's judgement, written inside that gate's own window.
const LATE_VERDICTS = {
  'LIN-1': [
    { id: 'v1', judgement: 'plan-review', outcome: 'approve', at: '2026-11-25T01:30:00.000Z', state: 'stands', in: 'task-LIN-1', on: [] },
    { id: 'v2', judgement: 'review', outcome: 'approve', at: '2026-11-25T03:30:00.000Z', state: 'stands', in: 'task-LIN-1', on: [] },
  ],
};

describe('the happy path reads both survival rows from verdict records', () => {
  test('verdict records after the cutover give a populated plan card, read in one batched call', async () => {
    const store = fakeStore({ historyRows: LATE_LINEAGE });
    const recordsStore = fakeRecords({ verdicts: LATE_VERDICTS });
    const { status, body } = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);
    const planCard = json.perKind.find((k) => k.kind === 'plan');
    assert.equal(planCard.survival.state, 'computed');
    assert.equal(planCard.survival.rate, 1);
    assert.equal(planCard.survival.verdictNotMeasured, 0);
    assert.deepEqual(recordsStore.asked.verdicts, [['ws-1', ['LIN-1']]], 'one batched verdict read for every scored issue');
    assert.equal(json.completeness.complete, true);
  });

  test('the page route renders HTML with the per-kind cards', async () => {
    const store = fakeStore({ historyRows: LATE_LINEAGE });
    const { status, body } = await get(buildApp({ store, recordsStore: fakeRecords({ verdicts: LATE_VERDICTS }) }), '/workspace/ws-1/effort-readout');
    assert.equal(status, 200);
    assert.match(body, /data-testid="effort-card-plan"/);
    assert.match(body, /Effort Self-Assessment/);
  });

  test('a gate row dispatched before the cutover reads verdict not measured, never a figure from a comment', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const recordsStore = fakeRecords({ verdicts: LATE_VERDICTS });
    const { status, body } = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const planCard = JSON.parse(body).perKind.find((k) => k.kind === 'plan');
    assert.equal(planCard.survival.rate, null, 'no verdict is read for a gate before the cutover');
    assert.equal(planCard.survival.denominator, 0);
    assert.equal(planCard.survival.verdictNotMeasured, 1);
    assert.match(JSON.parse(body).notes.verdictRecordsCoverage, /from 2026-11-21 08:06Z/);
  });

  // LIN-2830: the page must show an opencode run as its own row — harness `opencode`, model `z-ai/glm-5.3`, and a visible
  // "—" where claude-code would show a realised effort level (opencode posts no effort field).
  test('the page renders the harness/model/effort breakdown rows, with "—" for a missing effort (LIN-2830)', async () => {
    const historyRows = [
      doneRow({ id: 'r1', issueIdentifier: 'LIN-1', kind: 'plan', dispatchedAt: '2026-09-01T00:00:00.000Z', completedAt: '2026-09-01T00:30:00.000Z' }),
      {
        id: 'r2', issueId: 'uuid-LIN-2', issueIdentifier: 'LIN-2', kind: 'implementation', status: 'taken',
        dispatchedAt: '2026-09-02T00:00:00.000Z', resolvedAt: '2026-09-02T00:40:00.000Z',
        feedback: [
          { kind: 'usage', message: `[usage] ${JSON.stringify({ schema: 1, harness: 'opencode', model: 'z-ai/glm-5.3', inputTokens: 100, outputTokens: 50, costUsd: 0.42, lane: 'openrouter' })}` },
          { message: '[done] complete', timestamp: '2026-09-02T00:30:00.000Z' },
        ],
      },
    ];
    const store = fakeStore({ historyRows });
    const recordsStore = fakeRecords();
    const { status, body } = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/effort-readout');
    assert.equal(status, 200);
    assert.match(body, /data-testid="effort-card-rows-implementation"/, 'the implementation card carries the rows breakdown');
    const rowsBlock = body.match(/data-testid="effort-card-rows-implementation"[\s\S]*?<div class="effort-card-footnote/)?.[0]
      || body.slice(body.indexOf('effort-card-rows-implementation'));
    assert.ok(rowsBlock.includes('opencode'), 'the row names its harness');
    assert.ok(rowsBlock.includes('z-ai/glm-5.3'), 'the row names its model');
    assert.ok(/>—<\/span>/.test(rowsBlock), 'a missing effort renders as the visible "—" placeholder');
    // The JSON route carries the same breakdown.
    const jsonRes = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/api/effort-readout');
    const json = JSON.parse(jsonRes.body);
    const implCard = json.perKind.find((k) => k.kind === 'implementation');
    assert.equal(implCard.rows.length, 1);
    assert.equal(implCard.rows[0].harness, 'opencode');
    assert.equal(implCard.rows[0].model, 'z-ai/glm-5.3');
    assert.equal(implCard.rows[0].effort, null);
  });
});

describe('H1 — the two reads carry their two REAL bounds', () => {
  test('listItems is called with NO limit and every live row comes back; listHistory carries limit 200', async () => {
    const liveRows = Array.from({ length: 10 }, (_, i) => ({
      id: `live-${i}`, issueId: 'uuid-LIN-9', issueIdentifier: 'LIN-9', kind: 'implementation',
      dispatchedAt: '2026-09-05T00:00:00.000Z',
    }));
    // 250 history rows whose resolvedAt order is DELIBERATELY the reverse of their dispatchedAt order, so a read that
    // sorted by the wrong clock would return a different 200.
    const historyRows = Array.from({ length: 250 }, (_, i) => doneRow({
      id: `h-${i}`, issueIdentifier: `LIN-${i}`, kind: 'plan',
      dispatchedAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
      completedAt: new Date(Date.UTC(2026, 0, 2) + i * 60000).toISOString(),
      resolvedAt: new Date(Date.UTC(2026, 5, 1) - i * 60000).toISOString(),
    }));
    const store = fakeStore({ liveRows, historyRows, historyTotal: 250 });
    const { status, body } = await get(buildApp({ store, recordsStore: fakeRecords() }), '/workspace/ws-1/api/effort-readout');
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
    // Row A resolved most recently but was dispatched FIRST; row B is the opposite. Both fit inside the 200 bound, so both
    // issues are scored; the point pinned is that the STORE was asked to sort by resolvedAt.
    const historyRows = [
      doneRow({ id: 'A', issueIdentifier: 'LIN-A', kind: 'plan', dispatchedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T01:00:00.000Z', resolvedAt: '2026-06-01T00:00:00.000Z' }),
      doneRow({ id: 'B', issueIdentifier: 'LIN-B', kind: 'plan', dispatchedAt: '2026-05-01T00:00:00.000Z', completedAt: '2026-05-01T01:00:00.000Z', resolvedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const store = fakeStore({ historyRows });
    const recordsStore = fakeRecords();
    await get(buildApp({ store, recordsStore }), '/workspace/ws-1/api/effort-readout');
    assert.deepEqual([...recordsStore.asked.verdicts[0][1]].sort(), ['LIN-A', 'LIN-B']);
  });
});

describe('the cost read is wired to the founder lookup (LIN-4177)', () => {
  test('a straddler whose founder is outside the 200-row read is costed under its true kind on the JSON readout', async () => {
    // The founder (an implementation, 40 days old) is outside the history read; its in-window follow-up is a review
    // on another issue, priced at its whole running total. Only the wired route names the lineage's kind.
    const usageOf = (costUsd) => ({ kind: 'usage', timestamp: '2026-10-30T10:01:00.000Z', message: `[usage] ${JSON.stringify({ model: 'anthropic/claude-sonnet-5', harness: 'claude-code', costUsd })}` });
    const followUp = { ...doneRow({ id: 'st-2', issueIdentifier: 'LIN-99', kind: 'review', dispatchedAt: '2026-10-30T10:00:00.000Z', completedAt: '2026-10-30T10:05:00.000Z' }), rootItemId: 'st' };
    followUp.feedback = [usageOf(4), ...followUp.feedback];
    // A priced implementation of its own, in the read, so the implementation row exists in the population.
    const own = doneRow({ id: 'impl-1', issueIdentifier: 'LIN-5', kind: 'implementation', dispatchedAt: '2026-10-29T10:00:00.000Z', completedAt: '2026-10-29T10:05:00.000Z' });
    own.feedback = [usageOf(1), ...own.feedback];
    const founder = { id: 'st', _id: 'st', rootItemId: 'st', status: 'taken', abort: false, kind: 'implementation', issueIdentifier: 'LIN-42', dispatchedAt: '2026-09-20T10:00:00.000Z', feedback: [] };
    const store = fakeStore({ historyRows: [followUp, own], identityOnly: [founder] });
    const { status, body } = await get(buildApp({ store, recordsStore: fakeRecords() }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);
    const implementation = json.perKind.find(row => row.kind === 'implementation');
    assert.ok(implementation, 'an implementation row exists');
    assert.equal(implementation.costUsd, 5, 'its own $1 plus the straddler\'s $4, under its true kind');
    assert.equal(implementation.costUnpricedCount, 0);
  });
});

describe('LIN-4504 / LIN-4519: the records the route reads, and what a failed read says', () => {
  test('the plan facts are read from the records store, once for every scored issue; no figure from a description', async () => {
    const store = fakeStore({ historyRows: LINEAGE });
    const recordsStore = fakeRecords({ verdicts: LATE_VERDICTS });
    const { status, body } = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    assert.deepEqual(recordsStore.asked.plans, [['ws-1', ['LIN-1']]], 'one batched read');
    const planCard = JSON.parse(body).perKind.find((k) => k.kind === 'plan');
    assert.equal(planCard.survival.gateNotMeasured, 1, 'this history predates the cutover (PLAN_RECORDS_SINCE, 2026-11-20): not measured');
    assert.match(JSON.parse(body).notes.planRecordsCoverage, /not measured/);
    const page = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/effort-readout');
    assert.match(page.body, /plan-review gate due\/honoured: not measured for 1 \(no plan records before 2026-11-20\)/);
  });

  test('a records store whose verdict read fails leaves survival unavailable, and the read-out still renders', async () => {
    const store = fakeStore({ historyRows: LATE_LINEAGE });
    const recordsStore = fakeRecords({ fail: new Error('db down') });
    const origError = console.error;
    console.error = () => {};
    try {
      const { status, body } = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/api/effort-readout');
      assert.equal(status, 200);
      const json = JSON.parse(body);
      assert.equal(json.perKind.find((k) => k.kind === 'plan').survival.state, 'unavailable_records');
      assert.match(json.notes.survivalUnavailable, /verdict records/);
    } finally {
      console.error = origError;
    }
  });

  test('a records store whose plan read fails leaves the gate not measured, and the read-out still renders', async () => {
    const store = fakeStore({ historyRows: LATE_LINEAGE });
    const recordsStore = {
      verdictFactsForTickets: async (urlKey, tickets) => new Map(tickets.map((t) => [t, { measured: true, taskId: null, verdicts: LATE_VERDICTS[t] || [] }])),
      planFactsForTickets: async () => { throw new Error('db down'); },
    };
    const origError = console.error;
    console.error = () => {};
    try {
      const { status, body } = await get(buildApp({ store, recordsStore }), '/workspace/ws-1/api/effort-readout');
      assert.equal(status, 200);
      const plan = JSON.parse(body).perKind.find((k) => k.kind === 'plan');
      assert.equal(plan.survival.gateNotMeasured, 1);
      assert.equal(plan.survival.rate, 1, 'the verdict read is independent of the plan read');
    } finally {
      console.error = origError;
    }
  });

  test('no records store at all: survival unavailable, and nothing is read from a provider', async () => {
    const store = fakeStore({ historyRows: LATE_LINEAGE });
    const { status, body } = await get(buildApp({ store, recordsStore: null }), '/workspace/ws-1/api/effort-readout');
    assert.equal(status, 200);
    const json = JSON.parse(body);
    assert.equal(json.perKind.find((k) => k.kind === 'plan').survival.state, 'unavailable_records');
    assert.equal(json.perKind.find((k) => k.kind === 'implementation').survival.state, 'unavailable_records');
  });
});
