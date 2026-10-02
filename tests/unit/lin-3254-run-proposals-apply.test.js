/**
 * LIN-3254 beat 4 — run page proposals: Apply / Decline, and guest-mode hiding.
 *
 * Two layers:
 *   - the Apply / Decline routes on createDashboardRoutes, driven over real
 *     HTTP with the real RunProposalsStore (mock collection) and a real
 *     dispatch-queue fixture: CAS dispatch-once, stored-prompt-only, derived
 *     followUpTo, revert-on-failed-dispatch, cross-workspace refusal.
 *   - the run page renderer: pending rows show Apply / Decline, decided rows a
 *     quiet state, and the whole block is gated by `canReply` — the same flag
 *     that hides the reply boxes (guest mode).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import crypto from 'node:crypto';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { renderSessionPage } from '../../lib/render-session.js';
import { RunProposalsStore } from '../../lib/run-proposals-store.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';

const URL_KEY = 'acme';
const RUN_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_RUN_ID = '99999999-8888-4777-8666-555555555555';
const T_DISPATCHED = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const T_DONE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

// ── Stores ───────────────────────────────────────────────────────────────────

function historyRow({ id = RUN_ID, target = 'cli', issueIdentifier = 'TEST-1' } = {}) {
  return {
    id,
    promptName: 'implementation',
    prompt: 'prompt body',
    issueId: 'uuid-500',
    issueIdentifier,
    issueTitle: 'A task',
    issueUrl: 'https://example.test/TEST-1',
    workspace: { urlKey: URL_KEY },
    dispatchedAt: T_DISPATCHED,
    dispatchedBy: 'user-1',
    target,
    repo: null,
    status: 'taken',
    resolvedAt: T_DONE,
    kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
  };
}

function makeDispatchStore(rows) {
  const addItemCalls = [];
  return {
    addItemCalls,
    store: {
      async listItems() { return []; },
      async listHistory() { return { items: rows.slice(), total: rows.length }; },
      async getItemStatus(_urlKey, id) { return rows.find(r => r.id === id) || null; },
      async getGrantDeclaration() { return { state: 'none' }; },
      async addItem(urlKey, item) {
        addItemCalls.push({ urlKey, item });
        return { _id: 'disp-new-1', dispatchedAt: new Date().toISOString(), ...item };
      },
    },
  };
}

function createMockCollection() {
  const docs = [];
  function matches(doc, q) {
    if (q._id !== undefined && doc._id !== q._id) return false;
    if (q.urlKey !== undefined && doc.urlKey !== q.urlKey) return false;
    if (q.runId !== undefined && doc.runId !== q.runId) return false;
    if (q.status !== undefined && doc.status !== q.status) return false;
    return true;
  }
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(q) { return docs.find(d => matches(d, q)) || null; },
    find(q = {}) { const r = docs.filter(d => matches(d, q)); return { async toArray() { return r.slice(); } }; },
    async updateOne(q, update) {
      const d = docs.find(x => matches(x, q));
      if (!d) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(d, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteMany(q) { let n = 0; for (let i = docs.length - 1; i >= 0; i--) if (matches(docs[i], q)) { docs.splice(i, 1); n++; } return { deletedCount: n }; },
  };
}

function buildApp({ dispatchStore, runProposalsStore, proxyTokenStore }) {
  const app = express();
  app.use(express.json());
  app.use(createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: URL_KEY };
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
    proxyTokenStore: proxyTokenStore || { async createToken() { return { token: 't' }; } },
  }));
  return app;
}

async function post(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function proposalPath(runId, id, action) {
  return `/workspace/${URL_KEY}/api/run/${runId}/proposals/${id}/${action}`;
}

// ── Apply / Decline routes ───────────────────────────────────────────────────

describe('LIN-3254 — run proposal Apply', () => {
  test('dispatches the stored prompt to the derived lineage tail', async () => {
    const { store: dispatchStore, addItemCalls } = makeDispatchStore([historyRow()]);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const proposal = await runProposalsStore.create({ urlKey: URL_KEY, runId: RUN_ID, stepLoopId: 'loop-1', prompt: 'do the next thing' });

    const res = await post(buildApp({ dispatchStore, runProposalsStore }), proposalPath(RUN_ID, proposal.id, 'apply'));

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.applied, true);
    assert.strictEqual(res.body.itemId, 'disp-new-1');
    assert.strictEqual(addItemCalls.length, 1);
    assert.strictEqual(addItemCalls[0].item.prompt, 'do the next thing');
    assert.strictEqual(addItemCalls[0].item.followUpTo, RUN_ID, 'followUpTo is the lineage tail, not a step');

    const row = await runProposalsStore.get(URL_KEY, RUN_ID, proposal.id);
    assert.strictEqual(row.status, 'applied');
    assert.strictEqual(row.appliedItemId, 'disp-new-1');
    assert.ok(row.decidedAt);
  });

  test('is compare-and-set: a double POST dispatches exactly once', async () => {
    const { store: dispatchStore, addItemCalls } = makeDispatchStore([historyRow()]);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const proposal = await runProposalsStore.create({ urlKey: URL_KEY, runId: RUN_ID, prompt: 'once' });
    const app = buildApp({ dispatchStore, runProposalsStore });

    const first = await post(app, proposalPath(RUN_ID, proposal.id, 'apply'));
    const second = await post(app, proposalPath(RUN_ID, proposal.id, 'apply'));

    assert.strictEqual(first.status, 200);
    assert.strictEqual(second.status, 409);
    assert.strictEqual(addItemCalls.length, 1, 'the second Apply must not dispatch');
  });

  test('ignores a client-supplied prompt — the STORED prompt is dispatched', async () => {
    const { store: dispatchStore, addItemCalls } = makeDispatchStore([historyRow()]);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const proposal = await runProposalsStore.create({ urlKey: URL_KEY, runId: RUN_ID, prompt: 'the real stored prompt' });

    const res = await post(buildApp({ dispatchStore, runProposalsStore }),
      proposalPath(RUN_ID, proposal.id, 'apply'), { prompt: 'evil tampered prompt' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(addItemCalls[0].item.prompt, 'the real stored prompt');
    assert.notStrictEqual(addItemCalls[0].item.prompt, 'evil tampered prompt');
  });

  test('a failed dispatch reverts the row to proposed — never stuck applied with nothing dispatched', async () => {
    // A dash-target run: dispatchSessionFollowUp structurally 422s.
    const { store: dispatchStore, addItemCalls } = makeDispatchStore([historyRow({ target: 'dash' })]);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const proposal = await runProposalsStore.create({ urlKey: URL_KEY, runId: RUN_ID, prompt: 'nope' });

    const res = await post(buildApp({ dispatchStore, runProposalsStore }), proposalPath(RUN_ID, proposal.id, 'apply'));

    assert.strictEqual(res.status, 422);
    assert.strictEqual(addItemCalls.length, 0);
    const row = await runProposalsStore.get(URL_KEY, RUN_ID, proposal.id);
    assert.strictEqual(row.status, 'proposed', 'the failed Apply is reverted, not left applied');
    assert.strictEqual(row.appliedItemId, null);
  });

  test('another workspace\'s proposal is refused', async () => {
    const { store: dispatchStore, addItemCalls } = makeDispatchStore([historyRow()]);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const foreign = await runProposalsStore.create({ urlKey: 'other', runId: RUN_ID, prompt: 'x' });

    const res = await post(buildApp({ dispatchStore, runProposalsStore }), proposalPath(RUN_ID, foreign.id, 'apply'));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(addItemCalls.length, 0);
  });

  test('another workspace\'s run (a session not in this workspace) is refused before claiming', async () => {
    const { store: dispatchStore, addItemCalls } = makeDispatchStore([historyRow({ id: RUN_ID })]);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const proposal = await runProposalsStore.create({ urlKey: URL_KEY, runId: OTHER_RUN_ID, prompt: 'x' });

    const res = await post(buildApp({ dispatchStore, runProposalsStore }), proposalPath(OTHER_RUN_ID, proposal.id, 'apply'));

    assert.strictEqual(res.status, 404);
    assert.strictEqual(addItemCalls.length, 0);
    assert.strictEqual((await runProposalsStore.get(URL_KEY, OTHER_RUN_ID, proposal.id)).status, 'proposed');
  });
});

describe('LIN-3254 — run proposal Decline', () => {
  test('declines once, dispatches nothing', async () => {
    const { store: dispatchStore, addItemCalls } = makeDispatchStore([historyRow()]);
    const runProposalsStore = new RunProposalsStore({ collection: createMockCollection() });
    const proposal = await runProposalsStore.create({ urlKey: URL_KEY, runId: RUN_ID, prompt: 'x' });
    const app = buildApp({ dispatchStore, runProposalsStore });

    const first = await post(app, proposalPath(RUN_ID, proposal.id, 'decline'));
    const second = await post(app, proposalPath(RUN_ID, proposal.id, 'decline'));

    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.declined, true);
    assert.strictEqual(second.status, 409);
    assert.strictEqual(addItemCalls.length, 0);
    assert.strictEqual((await runProposalsStore.get(URL_KEY, RUN_ID, proposal.id)).status, 'declined');
  });
});

// ── Run page rendering ───────────────────────────────────────────────────────

function fixtureSession() {
  return {
    sessionId: RUN_ID,
    seedIssue: 'TEST-1',
    tasksTouched: ['TEST-1'],
    dispatchedAt: T_DISPATCHED,
    completedAt: T_DONE,
    telemetry: { runtime: { ms: 60000 }, metrics: [], producedArtifacts: [] },
    loops: [
      {
        loopId: 'loop-1', issueIdentifier: 'TEST-1', issueId: 'uuid-1', issueTitle: 'Seed task',
        iteration: 1, kind: 'autopilot', dispatchedAt: T_DISPATCHED,
        terminalStatus: 'done', terminalCompletedAt: T_DONE, feedback: [], telemetry: null,
      },
      {
        loopId: 'loop-2', issueIdentifier: 'TEST-2', issueId: 'uuid-2', issueTitle: 'Child task',
        iteration: 2, kind: 'implementation', dispatchedAt: T_DISPATCHED,
        terminalStatus: 'done', terminalCompletedAt: T_DONE, feedback: [], telemetry: null,
      },
    ],
  };
}

function renderProposals(proposals, canReply) {
  return renderSessionPage({
    session: fixtureSession(),
    sessionId: RUN_ID,
    urlKey: URL_KEY,
    issueContext: [],
    canReply,
    proposals,
  });
}

describe('LIN-3254 — run page proposal block', () => {
  const pending = { id: 'p1', runId: RUN_ID, stepLoopId: 'loop-2', prompt: 'add a test', status: 'proposed' };
  const applied = { id: 'p2', runId: RUN_ID, stepLoopId: 'loop-1', prompt: 'ship it', status: 'applied' };
  const declined = { id: 'p3', runId: RUN_ID, stepLoopId: 'no-such-loop', prompt: 'drop it', status: 'declined' };

  test('non-guest: a pending row shows Apply / Decline; decided rows show a quiet state', () => {
    const html = renderProposals([pending, applied, declined], true);

    assert.ok(html.includes('data-testid="session-proposals"'));
    assert.ok(html.includes('Proposed in chat'));
    assert.ok(html.includes('data-proposal-action="apply"'));
    assert.ok(html.includes('data-proposal-action="decline"'));
    // Exactly one pending row → exactly one pair of buttons.
    assert.strictEqual((html.match(/data-proposal-action="apply"/g) || []).length, 1);
    assert.strictEqual((html.match(/data-proposal-action="decline"/g) || []).length, 1);
    // Decided rows carry the state, not buttons.
    assert.ok(html.includes('data-testid="session-proposal-state"'));
    assert.ok(html.includes('>applied<'));
    assert.ok(html.includes('>declined<'));
  });

  test('the prompt is rendered as escaped text', () => {
    const html = renderProposals([{ ...pending, prompt: '<script>alert(1)</script>' }], true);
    assert.ok(!html.includes('<script>alert(1)</script>'), 'the prompt must be escaped');
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('an unmatched stepLoopId falls under the last step', () => {
    const html = renderProposals([declined], true);
    const lastStep = html.slice(html.lastIndexOf('data-testid="session-step"'));
    assert.ok(lastStep.includes('data-proposal-id="p3"'), 'the unmatched proposal renders under the last step');
  });

  test('guest mode (canReply false) hides the proposal block exactly as it hides reply boxes', () => {
    const shown = renderProposals([pending], true);
    assert.ok(shown.includes('data-testid="session-inline-reply"'), 'reply box present when replies are allowed');
    assert.ok(shown.includes('data-testid="session-proposals"'), 'proposal block present when replies are allowed');

    const hidden = renderProposals([pending], false);
    assert.ok(!hidden.includes('data-testid="session-inline-reply"'), 'reply box hidden for a guest');
    assert.ok(!hidden.includes('data-testid="session-proposals"'), 'proposal block hidden for a guest');
    assert.ok(!hidden.includes('data-proposal-action="apply"'), 'no Apply button leaks to a guest');
  });
});
