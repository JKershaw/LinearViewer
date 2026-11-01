/**
 * LIN-4080 review ledger item 2 — a follow-up into a stopped run through `enqueueFollowUp`
 * (Flight Companion approve-follow-up, run-proposal Apply, ci-wake-sweep) is the plain 409
 * RUN_STOPPED the guard raises, never a rethrown generic error (500/502).
 *
 * Distinguishing condition: before the mapping, `dispatchSessionFollowUp` THROWS the factory's
 * tagged refusal; after it, it RETURNS `{ status: 409, body: { code: 'RUN_STOPPED', ... } }`.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { RunProposalsStore } from '../../lib/run-proposals-store.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { dispatchSessionFollowUp, enqueueFollowUp } from '../../lib/follow-up-dispatch.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function makeStore() {
  return new DispatchQueueStore({
    collection: createMockCollection(),
    historyCollection: createMockCollection()
  });
}

async function stoppedRun(store) {
  const run = await store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42', target: 'cli' });
  await store.addItem(URL_KEY, { abort: true, abortTo: run._id, target: 'cli' });
  return run;
}

function rowsOf(store) {
  return [...store.collection._docs, ...store.historyCollection._docs];
}

const common = {
  workspacePreferencesStore: null,
  proxyTokenStore: { async createToken() { return { token: 'minted' }; } },
  urlKey: URL_KEY,
  prompt: 'next beat',
  baseUrl: 'http://127.0.0.1',
  dispatchedBy: 'u1',
  ownerCheck: async () => ({ status: 'owner' }),
  workspaceId: 'ws-1'
};

describe('LIN-4080 — follow-up into a stopped run maps to 409 RUN_STOPPED', () => {
  test('enqueueFollowUp returns 409 RUN_STOPPED with the plain message and writes no row', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);
    const before = rowsOf(store).length;

    const outcome = await enqueueFollowUp({
      ...common,
      dispatchQueueStore: store,
      followUpTo: run._id,
      target: 'cli',
      force: true,
      sessionId: run._id
    });

    assert.equal(outcome.status, 409);
    assert.equal(outcome.body.code, 'RUN_STOPPED');
    assert.equal(outcome.body.id, run._id);
    assert.equal(outcome.body.retryable, false);
    assert.match(outcome.body.error, /run was stopped/i);
    assert.match(outcome.body.error, /new run/i);
    assert.equal(rowsOf(store).length, before, 'nothing is enqueued');
  });

  test('dispatchSessionFollowUp (the shared helper behind approve-follow-up and proposal Apply) returns the 409, not a throw', async () => {
    const store = makeStore();
    const run = await stoppedRun(store);

    const outcome = await dispatchSessionFollowUp({
      ...common,
      dispatchQueueStore: store,
      agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
      sessionId: run._id
    });

    assert.equal(outcome.status, 409);
    assert.equal(outcome.body.code, 'RUN_STOPPED');
    assert.match(outcome.body.error, /run was stopped/i);
  });

  test('a follow-up to a live run is unaffected (still 200)', async () => {
    const store = makeStore();
    const live = await store.addItem(URL_KEY, { prompt: 'run', kind: 'autopilot', issueIdentifier: 'LIN-42', target: 'cli' });

    const outcome = await enqueueFollowUp({
      ...common,
      dispatchQueueStore: store,
      followUpTo: live._id,
      target: 'cli',
      force: true,
      sessionId: live._id
    });

    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.queued, true);
  });
});

describe('LIN-4080 — run-proposal Apply into a stopped run', () => {
  function buildApp({ dispatchStore, runProposalsStore }) {
    const app = express();
    app.use(express.json());
    app.use(createDashboardRoutes({
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      workspaceFromUrl: (req, res, next) => {
        req.workspace = { urlKey: URL_KEY, id: 'ws-acme' };
        req.session = { accountId: 'u1', features: {}, workspaces: [{ urlKey: URL_KEY, name: 'Acme' }] };
        next();
      },
      dispatchQueueStore: dispatchStore,
      agentStatusStore: { listStatus: async () => ({ items: [], total: 0 }) },
      observationSessionsStore: null,
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      briefCacheStore: { async get() { return null; } },
      recapCacheStore: { async get() { return null; } },
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
      runProposalsStore,
      proxyTokenStore: { async createToken() { return { token: 't' }; } }
    }));
    return app;
  }

  async function post(app, path) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: json };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  test('Apply returns 409 RUN_STOPPED (not 502) and the proposal is reverted to proposed', async () => {
    const dispatchStore = makeStore();
    const run = await stoppedRun(dispatchStore);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const proposal = await runProposalsStore.create({ urlKey: URL_KEY, runId: run._id, prompt: 'carry on' });
    const before = rowsOf(dispatchStore).length;

    const res = await post(
      buildApp({ dispatchStore, runProposalsStore }),
      `/workspace/${URL_KEY}/api/run/${run._id}/proposals/${proposal.id}/apply`
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'RUN_STOPPED');
    assert.match(res.body.error, /run was stopped/i);
    assert.equal(rowsOf(dispatchStore).length, before, 'nothing is enqueued');
    const row = await runProposalsStore.get(URL_KEY, run._id, proposal.id);
    assert.equal(row.status, 'proposed', 'the refused Apply is reverted, never stuck applied');
    assert.equal(row.appliedItemId, null);
  });
});
