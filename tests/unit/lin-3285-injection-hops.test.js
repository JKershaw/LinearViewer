// LIN-3285 (review R1): every route / plumbing hop that carries the owner-installation
// seam is witnessed through its real factory, so deleting one hop turns a test red
// instead of shipping a silent anonymous fallback (fail-open hides it in production).
//
// One test per row of the plan's injection table. Each drives the REAL route or
// factory with a Linear-bound workspace and the shared fakes (`fakeGitHub`,
// `makeSeam`), then asserts the PR reads that reached the GitHub fake carried the
// minted installation token. The mutation each one guards is named beside it.
//
// Run with: node --test tests/unit/lin-3285-injection-hops.test.js

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { clearFailOpenPrStatus } from '../../lib/github-pr-status.js';
import { clearPrStateCache, createPrStateStore } from '../../lib/pr-state-store.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { setProxyFetchImpl } from '../../lib/proxy-fetch.js';
import { readRunEvidence } from '../../lib/run-evidence.js';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { createTickWorkspaceResolver, createCiWakeSweepRun } from '../../lib/ci-wake-sweep.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { COMPANION_SEED_STATE } from '../../lib/flight-companion-gate.js';
import { createDashboardRoutes, enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { createTaskShareRoutes } from '../../routes/task-share.js';
import { createTaskChatRoutes } from '../../routes/task-chat.js';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';
import { createProxyFlightCompanionRoutes } from '../../routes/proxy-flight-companion.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';
import { createMockCollection } from '../fixtures/mock-collection.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { findRouteLayer } from './lib/route-layer.js';
import {
  PR_URL, MINTED_AUTH, OWNER, WS, installAppKey, fakeGitHub, connection, makeSeam,
} from '../fixtures/lin-3285-seam.js';

const URL_KEY = 'ws-a';
const COMMENTS = [{ id: 'c1', body: `opened ${PR_URL}`, createdAt: '2026-10-19T11:00:00.000Z' }];
const reviewBody = '## Review\n\nReviewed head `aaaaaaa1111111`.\n\n### What CI Did Not Prove\n| # | Claim | In/Out | Discharge |\n| --- | --- | --- | --- |\n| 1 | one claim | In | none |\n\n**Verdict: Approve**';
const CLOSE_OUT_COMMENTS = [...COMMENTS, { id: 'c2', body: reviewBody, createdAt: '2026-10-19T11:30:00.000Z' }];

// Registered under the real name: the routes below resolve a Linear workspace's
// provider through the registry, and `provider.name` is what selects the seam.
const linear = {
  name: 'linear',
  supports: () => true,
  ui: { displayName: 'Linear' },
  async fetchIssueComments() { return CLOSE_OUT_COMMENTS; },
  async fetchRecommendationContext(scope, issueId) {
    return {
      issue: { id: 'issue-1', identifier: issueId, title: 'T', url: 'https://x', state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [], description: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' },
      parent: null, siblings: [], project: null, children: [], comments: COMMENTS, focusedChild: null, stateTransitions: [],
    };
  },
};
registerProvider(linear);

const workspaceRecord = (over = {}) => ({ id: WS, urlKey: URL_KEY, provider: 'linear', accessToken: 'lin_key', ...over });

before(installAppKey);
beforeEach(() => { clearFailOpenPrStatus(); clearPrStateCache(); });

/** The owner's installation covers the repo; `github` is the one fake every read lands in. */
function owned() {
  const seam = makeSeam({ rows: [connection(OWNER, 'github', 'inst-1')] });
  const asks = [];
  const installationTokenFor = async (args) => { asks.push(args); return seam.installationTokenFor(args); };
  return { github: seam.github, installationTokenFor, asks };
}

/** Every PR read reached the fake, and every one carried the minted token. */
function assertAuthenticated(github, what) {
  const reads = github.prCalls();
  assert.ok(reads.length > 0, `${what}: the PR was read`);
  assert.ok(reads.every(c => c.auth === MINTED_AUTH), `${what}: every PR read carried the minted installation token`);
}

function getHandler(router, method, path) {
  const layer = findRouteLayer(router, method, path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200, jsonBody: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.jsonBody = b; return this; },
    send(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
    end() { return this; },
  };
}

/**
 * While `fn` runs, the chat catalog's default GitHub transport (`createProxyFetch()`, which the
 * hermetic proxy-env arm makes non-null) is the fake. The catalog's own `githubFetch` seam is not
 * reachable through the routes, which is the point: the route -> agent turn -> catalog path is real.
 */
async function withGitHubTransport(github, fn) {
  setProxyFetchImpl(github);
  try { return await fn(); } finally { setProxyFetchImpl(null); }
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

// ─── 1. Dashboard: the run page's pr-state route (guards M7) ──────────────────

describe('hop 1: routes/dashboard.js', () => {
  function dashboardRouter({ installationTokenFor, github, readRunEvidenceFn = null }) {
    return createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
      runParagraphStore: new InMemoryRunParagraphStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      fetchWorkspaceIssues: async () => [],
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      readRunEvidence: readRunEvidenceFn,
      installationTokenFor,
      prState: {
        now: () => Date.now(),
        cache: new Map(),
        bucket: [],
        resolveProvider: () => ({ provider: linear, callScope: 'lin_key' }),
        loadRun: async () => ({ issueIdentifier: 'LIN-1', evidenceUrls: [] }),
        githubFetch: github,
      },
    });
  }

  test('GET run pr-state on a Linear workspace reads with the minted token', async () => {
    const { github, installationTokenFor } = owned();
    const handler = getHandler(dashboardRouter({ installationTokenFor, github }), 'get', '/workspace/:urlKey/api/run/:runId/pr-state');
    const res = makeRes();
    await handler({ session: { features: {} }, workspace: workspaceRecord(), params: { urlKey: URL_KEY, runId: 'run-1' }, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.state, 'open', JSON.stringify(res.jsonBody));
    assertAuthenticated(github, 'run pr-state');
  });
});

// ─── 2. Workspace API: evidence, close-out check, close-out press (guards M8, M10) ─

describe('hop 2: routes/workspace-api.js', () => {
  const EVIDENCE = '/workspace/:urlKey/api/run-evidence/:issueIdentifier';
  const CHECK = `${EVIDENCE}/check`;
  const PRESS = `${EVIDENCE}/close-out-press`;

  function router({ installationTokenFor, github }) {
    return createWorkspaceApiRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      installationTokenFor,
      // Neither `readPrStatus` nor `markDone` is overridden: the real default reader runs.
      runEvidence: { resolveProvider: () => ({ provider: linear, callScope: 'lin_key' }), githubFetch: github },
      closeOut: {
        resolveProvider: () => ({ provider: linear, callScope: 'lin_key' }),
        githubFetch: github,
        isStopAtRun: async () => 'pr',
        runnerReady: () => true,
        markDone: async () => {},
      },
      closeOutEventsStore: {
        async findMergedByPr() { return null; },
        async hasMergedEvent() { return false; },
        async record() { return { _id: 'e1', by: 'press', dispatchId: 'd-1', prUrl: PR_URL, headSha: 'abc1234' }; },
      },
    });
  }
  const req = (body = {}) => ({
    session: { accountId: 'acct-1', workspaces: [URL_KEY] },
    workspace: workspaceRecord(),
    params: { urlKey: URL_KEY, issueIdentifier: 'LIN-1' },
    query: {},
    body,
  });

  test('GET run-evidence reads with the minted token', async () => {
    const { github, installationTokenFor } = owned();
    const res = makeRes();
    await getHandler(router({ installationTokenFor, github }), 'get', EVIDENCE)(req(), res, (e) => { if (e) throw e; });
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assertAuthenticated(github, 'evidence route');
  });

  test('POST close-out check reads with the minted token (stop-at-PR)', async () => {
    const { github, installationTokenFor } = owned();
    const res = makeRes();
    await getHandler(router({ installationTokenFor, github }), 'post', CHECK)(req(), res, (e) => { if (e) throw e; });
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assertAuthenticated(github, 'close-out check');
  });

  test('POST close-out press guard reads with the minted token (stop-at-PR)', async () => {
    const { github, installationTokenFor } = owned();
    const res = makeRes();
    await getHandler(router({ installationTokenFor, github }), 'post', PRESS)(req({ prUrl: PR_URL, headSha: 'abc1234', dispatchId: 'd-1' }), res, (e) => { if (e) throw e; });
    // The reviewed head differs from the fake's open head, so the guard refuses; the read it made is the witness.
    assert.ok([201, 409].includes(res.statusCode), JSON.stringify(res.jsonBody));
    assertAuthenticated(github, 'close-out press');
  });
});

// ─── 3. Dispatch: the close-out guard on the session lane (guards M3, M4, M10) ──

describe('hop 3: routes/dispatch.js → enterSessionDispatch → closeOutNotReady', () => {
  test('a stop-at-PR close-out dispatch reads the PR with the minted token', async () => {
    const { github, installationTokenFor } = owned();
    const store = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });
    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      dispatchQueueStore: store,
      dispatchTokenStore: {},
      workspaceFromUrl: (req, res, next) => {
        req.workspace = workspaceRecord();
        req.session = { accountId: 'u1', linearUserId: 'u1' };
        next();
      },
      userPreferencesStore: {},
      harbourFeedbackTokenStore: null,
      installationTokenFor,
      closeOut: {
        resolveProvider: () => ({ provider: linear, callScope: 'lin_key' }),
        githubFetch: github,
        isStopAtRun: async () => 'pr',
      },
    }));
    const { base, close } = await listen(app);
    try {
      const res = await fetch(`${base}/workspace/${URL_KEY}/api/dispatch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'close it out', kind: 'close-out', issueIdentifier: 'LIN-1' }),
      });
      await res.text();
      assert.ok([201, 409].includes(res.status), `status ${res.status}`);
    } finally { await close(); }
    assertAuthenticated(github, 'close-out dispatch guard');
  });
});

// ─── 4. Task page: owner route authenticated, guest route never asks (guards M6) ─

describe('hop 4: routes/task-page.js and routes/task-share.js', () => {
  function loaderFor(github, installationTokenFor) {
    return createTaskPageLoader({
      dispatchStore: {}, agentStatusStore: {},
      briefCacheStore: { async get() { return null; } },
      recapCacheStore: { async get() { return null; } },
      readRunEvidence,
      prStateStore: createPrStateStore({ cache: new Map(), bucket: [], githubFetch: github }),
      installationTokenFor, enrichLoop, deriveSessionWaiting,
      getLoopsForIssue: async () => [],
      now: () => new Date('2026-10-19T12:00:00.000Z'),
    });
  }

  test('owner task page: the route hands the loader the workspace id, so the PR read is authenticated', async () => {
    const { github, installationTokenFor, asks } = owned();
    const router = createTaskPageRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
      loader: loaderFor(github, installationTokenFor),
    });
    const res = makeRes();
    await getHandler(router, 'get', '/workspace/:urlKey/task/:identifier')({
      session: { workspaces: [], features: {} }, workspace: workspaceRecord(),
      params: { urlKey: URL_KEY, identifier: 'LIN-1' }, query: {}, get: () => 'localhost',
    }, res, (e) => { if (e) throw e; });
    assert.equal(res.statusCode, 200, String(res.body).slice(0, 300));
    assert.ok(asks.length > 0 && asks.every(a => a.workspaceId === WS), 'the seam was asked with the workspace id');
    assertAuthenticated(github, 'owner task page');
  });

  test('guest /t/:token: zero installation asks, and the read stays anonymous', async () => {
    const { github, installationTokenFor, asks } = owned();
    const NOW = new Date('2026-10-19T12:00:00.000Z');
    const TOKEN = 'A'.repeat(43);
    const record = {
      _id: 'share-1', tokenHash: 'hash', urlKey: URL_KEY, workspaceId: WS, ownerAccountId: OWNER,
      issueIdentifier: 'LIN-1', issueId: 'issue-1', source: 'linear', createdAt: NOW, revokedAt: null,
    };
    const app = express();
    app.use(createTaskShareRoutes({
      taskShareStore: { async getByToken() { return record; } },
      loader: loaderFor(github, installationTokenFor),
      workspaceFromUrl: (req, res, next) => next(),
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      guestAccess: async () => ({ provider: linear, callScope: 'lin_key' }),
      getDeployInfo: () => ({}),
      now: () => NOW,
    }));
    const { base, close } = await listen(app);
    try {
      const res = await fetch(`${base}/t/${TOKEN}`);
      await res.text();
      assert.equal(res.status, 200);
    } finally { await close(); }
    assert.deepEqual(asks, [], 'the guest route never resolves an installation token');
    assert.ok(github.prCalls().length > 0, 'the guest page did read the PR');
    assert.ok(github.prCalls().every(c => c.auth === null), 'and only anonymously');
  });
});

// ─── 5. Chat routes: Task Chat, Flight Companion turn + boot (guards M2, M9) ────

describe('hop 5: get_pr_status through the chat routes', () => {
  const callGetPrStatus = (outcome) => ({
    async streamChat() { throw new Error('streamChat must not be used: the default model is tool-capable'); },
    async streamChatWithTools(messages, opts, onEvent) {
      try {
        outcome.result = await opts.executeTool({ id: 'call-1', name: 'get_pr_status', arguments: { repo: 'acme/widget', number: 12 } });
      } catch (err) {
        outcome.error = err;
      }
      onEvent('done', {});
    },
  });

  test('Task Chat: the route injects the seam and the workspace id reaches the catalog', async () => {
    const { github, installationTokenFor } = owned();
    const outcome = {};
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { features: { taskChat: true }, accountId: 'acct-1', openRouterApiKey: 'sk-test-paid-key' }; next(); });
    app.use(createTaskChatRoutes({
      workspaceFromUrl: (req, res, next) => { req.workspace = workspaceRecord(); next(); },
      dispatchQueueStore: {
        getGrantDeclaration: async () => ({ state: 'none' }),
        async listItems() { return []; },
        async listHistory() { return { items: [], total: 0 }; },
        async getItemStatus() { return null; },
      },
      agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
      chatClient: callGetPrStatus(outcome),
      workspaceOwnerCheck: async () => ({ status: 'owner' }),
      installationTokenFor,
    }));
    const { base, close } = await listen(app);
    try {
      await withGitHubTransport(github, async () => {
        const res = await fetch(`${base}/workspace/${URL_KEY}/api/task-chat/LIN-500`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'where is the PR?' }),
        });
        await res.text();
        assert.equal(res.status, 200);
      });
    } finally { await close(); }
    assert.equal(outcome.error, undefined, String(outcome.error));
    assertAuthenticated(github, 'task chat get_pr_status');
  });

  function flightCompanionApp({ github, installationTokenFor, outcome }) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.session = { features: { flightCompanion: true }, workspaces: [{ urlKey: URL_KEY }], openRouterApiKey: 'sk-test-paid-key' }; next(); });
    let rev = 1; let state = COMPANION_SEED_STATE;
    app.use(createFlightCompanionRoutes({
      workspaceFromUrl: (req, res, next) => { req.workspace = workspaceRecord(); next(); },
      getOpenRouterSource: () => null,
      getDeployInfo: () => ({}),
      getModelCatalog: async () => [],
      observerStateStore: {
        async ensureSeeded(key) { return { _id: key, rev, state }; },
        async readCurrent(key) { return key.startsWith('sweep:v1:') ? null : { _id: key, rev, state, stateHash: JSON.stringify(state) }; },
        async advance(key, expectedRev, next) { if (expectedRev !== rev) return false; rev += 1; state = next; return true; },
      },
      freeTierStore: { async tryUse() { throw new Error('a paid session key is present'); } },
      chatClient: callGetPrStatus(outcome),
      installationTokenFor,
    }));
    return app;
  }

  for (const [name, path, body] of [
    ['turn', '/workspace/ws-a/api/flight-companion/turn', { message: 'what is the PR state?' }],
    ['boot', '/workspace/ws-a/api/flight-companion/boot', {}],
  ]) {
    test(`Flight Companion ${name}: the route injects the seam into its agent turn`, async () => {
      const { github, installationTokenFor } = owned();
      const outcome = {};
      const { base, close } = await listen(flightCompanionApp({ github, installationTokenFor, outcome }));
      try {
        await withGitHubTransport(github, async () => {
          const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          await res.text();
          assert.equal(res.status, 200);
        });
      } finally { await close(); }
      assert.equal(outcome.error, undefined, String(outcome.error));
      assertAuthenticated(github, `flight companion ${name} get_pr_status`);
    });
  }
});

// ─── 6. CI wake sweep (guards M5; witness 14) ───────────────────────────────────

describe('hop 6: lib/ci-wake-sweep.js', () => {
  const harness = createMangoTmpdir('lin-3285-sweep-');
  before(() => harness.connect());
  after(() => harness.close());

  const SWEEP_URL_KEY = 'ws-sweep';
  const PR_1 = 'https://github.com/acme/widget/pull/12';
  const PR_2 = 'https://github.com/acme/widget/pull/13';

  async function runSweep({ github, installationTokenFor }) {
    const db = harness.freshDb();
    const store = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history'), ttl: 86400 });
    for (const [issue, pr] of [['LIN-1', PR_1], ['LIN-2', PR_2]]) {
      const worker = await store.addItem(SWEEP_URL_KEY, { prompt: 'implement', promptName: 'implementation', kind: 'implementation', issueIdentifier: issue, dispatchedBy: OWNER, target: 'cli' });
      await store.takeItem(worker._id, SWEEP_URL_KEY);
      const past = new Date(Date.now() - 30 * 60 * 1000);
      await store.historyCollection.updateOne({ _id: worker._id, urlKey: SWEEP_URL_KEY }, { $set: { dispatchedAt: past, resolvedAt: past } });
      await store.addFeedback(worker._id, SWEEP_URL_KEY, { message: `[pending] Unit jobs are still pending on ${pr}` }, null);
    }
    const posted = [];
    const resolver = createTickWorkspaceResolver({
      sessionsCollection: { find: () => ({ toArray: async () => [{ session: JSON.stringify({ workspaces: [{ id: WS, urlKey: SWEEP_URL_KEY, provider: 'linear' }] }) }] }) },
      resolveWorkspaceAccess: async () => ({ token: 'lin_key', scope: 'lin_key', provider: 'linear', reason: 'ok' }),
      getProviderByName: () => linear,
    });
    await createCiWakeSweepRun({
      dispatchStore: store,
      agentStatusStore: { listStatus: async () => ({ items: [] }) },
      proxyTokenStore: {},
      workspacePreferencesStore: {},
      ownerCheck: async () => ({ status: 'owner' }),
      resolver,
      baseUrl: 'https://harbour.test',
      now: () => Date.now(),
      // `readStatuses` is the real `readPrStatuses`: nothing between the sweep and the fake GitHub is stubbed.
      seam: { githubFetch: github },
      installationTokenFor,
      enqueue: async (args) => { posted.push(args); return { status: 200, body: { queued: true } }; },
    })();
    return posted;
  }

  test('with the seam, the sweep reads both parked PRs authenticated and wakes both', async () => {
    const { github, installationTokenFor } = owned();
    const posted = await runSweep({ github, installationTokenFor });
    assertAuthenticated(github, 'ci wake sweep');
    assert.equal(posted.length, 2);
  });

  test('witness 14: without the seam the read 403s and that reason still stops the tick after one PR (tick.rateLimited)', async () => {
    const { github } = owned();
    const posted = await runSweep({ github, installationTokenFor: null });
    const prsRead = new Set(github.prCalls().map(c => c.url.match(/\/pulls\/(\d+)/)?.[1]).filter(Boolean));
    assert.ok(github.prCalls().length > 0 && github.prCalls().every(c => c.auth === null), 'anonymous');
    assert.equal(posted.length, 0, 'an unreadable PR wakes nobody');
    assert.equal(github.prCalls().length, 1, 'the 403 set tick.rateLimited, so the second PR was never read');
    assert.ok(prsRead.size <= 1);
  });
});

// ─── 7. Proxy chat stays anonymous (witness 24) ─────────────────────────────────

describe('hop 7: the worker proxy chat never resolves an installation', () => {
  test('a grant-less worker token through createProxyFlightCompanionRoutes: zero asks, anonymous read', async () => {
    const { github, installationTokenFor, asks } = owned();
    const outcome = {};
    const pass = (req, res, next) => next();
    const app = express();
    app.use(express.json());
    app.use(createProxyFlightCompanionRoutes({
      proxyLimiter: pass,
      authenticateProxyToken: (req, res, next) => { req.proxyUrlKey = URL_KEY; req.proxyCreatedBy = 'acct-1'; next(); },
      resolveProviderAccess: async () => ({ token: 'lin_key', provider: linear }),
      workspaceUnavailable: (req, res) => res.status(503).json({}),
      logEvent: () => {},
      logOpenRouterCredentialSource: () => {},
      getWorkspaceOpenRouterKey: async () => 'sk-test-paid-key',
      chargeFreeTierOrReject: async () => null,
      observerStateStore: {
        async ensureSeeded(key) { return { _id: key, rev: 1, state: COMPANION_SEED_STATE }; },
        async readCurrent(key) { return key.startsWith('sweep:v1:') ? null : { _id: key, rev: 1, state: COMPANION_SEED_STATE, stateHash: JSON.stringify(COMPANION_SEED_STATE) }; },
        async advance() { return true; },
      },
      workspacePreferencesStore: undefined,
      dispatchQueueStore: {}, agentStatusStore: {}, proxyTokenStore: {},
      chatClient: {
        async streamChat() { throw new Error('streamChat must not be used'); },
        async streamChatWithTools(messages, opts, onEvent) {
          try {
            outcome.result = await opts.executeTool({ id: 'call-1', name: 'get_pr_status', arguments: { repo: 'acme/widget', number: 12 } });
          } catch (err) { outcome.error = err; }
          onEvent('done', {});
        },
      },
      // Unused today. If a future change threads a seam into the proxy turn AND a workspace id,
      // this spy sees the ask and the assertion below goes red.
      installationTokenFor,
    }));
    const { base, close } = await listen(app);
    try {
      await withGitHubTransport(github, async () => {
        const res = await fetch(`${base}/api/proxy/flight-companion/turn`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'pr state?' }),
        });
        await res.text();
        assert.equal(res.status, 200);
      });
    } finally { await close(); }
    // Anonymous is the point: the fake 403s a read without a Bearer, exactly as GitHub does.
    assert.equal(outcome.error?.status, 403, String(outcome.error));
    assert.deepEqual(asks, []);
    assert.ok(github.prCalls().length > 0 && github.prCalls().every(c => c.auth === null), 'read anonymously');
  });
});
