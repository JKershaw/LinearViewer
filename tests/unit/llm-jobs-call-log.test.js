/**
 * LIN-3852: the five Harbour calls that logged a row no reader could return.
 *
 * Every reader of the call log filters by `urlKey` (lib/llm-call-log.js
 * `listCalls`), and these five call paths passed no `callMeta.urlKey`, so their
 * rows were written and never listed: the run summary, the session summary, the
 * session-summary precompute, the run paragraph and the feedback title. Each case
 * drives the real generator with a stubbed fetch (no network, no real key) into a
 * real LlmCallLogStore, then asks `listCalls(urlKey)` for the row and its job id.
 *
 * Run with: node --test tests/unit/llm-jobs-call-log.test.js
 */
import { test, describe, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setLlmCallRecorder, setFetchImpl } from '../../lib/openrouter.js';
import { LlmCallLogStore } from '../../lib/llm-call-log.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { InMemorySessionSummaryCacheStore } from '../../lib/session-summary-cache.js';
import { InMemoryRunParagraphStore } from '../../lib/run-paragraph-store.js';
import { createSessionSummaryPrecompute } from '../../lib/session-materializer-precompute.js';
import { createRunParagraphPrecompute } from '../../lib/run-paragraph-hook.js';
import { generateFeedbackTitle } from '../../lib/feedback-title.js';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { JOB_IDS } from '../../lib/llm-jobs.js';

const URL_KEY = 'ws-a';
const NOW_ISO = new Date().toISOString();
const SUMMARY_JSON = JSON.stringify({ outcome: 'Shipped.', whatHappened: [], blockers: [] });

function sseResponse(text) {
  const enc = new TextEncoder();
  const blocks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.001 } })}\n\n`,
    'data: [DONE]\n\n'
  ];
  return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
}

function getHandler(router, method, path) {
  const hits = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        if (layer.route.path === path && layer.route.methods[method]) hits.push(layer);
      } else if (Array.isArray(layer.handle?.stack)) walk(layer.handle.stack);
    }
  };
  walk(router.stack);
  assert.equal(hits.length, 1, `${method} ${path} registered once`);
  return hits[0].route.stack[hits[0].route.stack.length - 1].handle;
}

function makeReqRes(params) {
  const req = { session: { features: {}, openRouterApiKey: 'test-key-never-sent' }, workspace: { urlKey: URL_KEY }, params, query: {}, body: {}, protocol: 'http', get: () => 'localhost' };
  const res = {
    statusCode: 200, jsonBody: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.jsonBody = b; return this; },
    send() { return this; }, end() { return this; }, redirect() { return this; }
  };
  return { req, res };
}

// One terminal run (a taken dispatch with a completed agent-status row).
function makeSummariesRouter({ observationSessionsStore = null } = {}) {
  const history = [{ id: 'run-1', issueIdentifier: 'LIN-2', issueTitle: 'Title', promptName: 'implementation', prompt: 'p', dispatchedAt: NOW_ISO, resolvedAt: NOW_ISO, status: 'taken', feedback: [{ message: 'pr opened' }] }];
  const status = [{ id: 'as-run-1', dispatchId: 'run-1', taskIdentifier: 'LIN-2', action: 'implementation', status: 'completed', summary: 'all done', timestamp: NOW_ISO }];
  return createDashboardRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore: {
      async listItems() { return []; },
      async listHistory() { return { items: history }; }
    },
    agentStatusStore: { async listStatus() { return { items: status }; } },
    observationSessionsStore,
    runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
    sessionSummaryCacheStore: new InMemorySessionSummaryCacheStore(),
    runParagraphStore: new InMemoryRunParagraphStore(),
    prState: null,
    freeTierStore: { async tryUse() { return { allowed: true }; } },
    getWorkspaceAccessToken: async () => 'token',
    fetchIssueContext: async () => ({ issue: { state: { name: 'In Progress', type: 'started' }, labels: { nodes: [] } } }),
    fetchWorkspaceIssues: async () => [],
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({})
  });
}

const TERMINAL_SESSION = {
  sessionId: 'sess-1', seedIssue: 'LIN-100', tasksTouched: ['LIN-100'],
  dispatchedAt: NOW_ISO, completedAt: NOW_ISO,
  loops: [{ loopId: 'sess-1', kind: 'autopilot', issueIdentifier: 'LIN-100', agentState: 'complete', terminalStatus: 'done', terminalCompletedAt: NOW_ISO }]
};

describe('LIN-3852: every Harbour LLM call writes a row listCalls(urlKey) returns', () => {
  let harness;
  let store;
  let pending;
  const saved = {};

  before(async () => {
    harness = createMangoTmpdir('lin-3852-llm-calls-');
    await harness.connect();
  });
  after(async () => { await harness.close(); });

  beforeEach(() => {
    for (const k of ['NODE_ENV', 'HARBOUR_DISABLE_AI_MOCK']) saved[k] = process.env[k];
    process.env.NODE_ENV = 'test';
    process.env.HARBOUR_DISABLE_AI_MOCK = '1'; // else the summary routes return a canned summary and pass vacuously
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) { saved[k] = process.env[k]; delete process.env[k]; }
    store = new LlmCallLogStore({ collection: harness.freshDb().collection('llm-call-log') });
    pending = [];
    setLlmCallRecorder((call) => { const p = store.record(call); pending.push(p); return p; });
    setFetchImpl(null);
    mock.method(global, 'fetch', async () => sseResponse(SUMMARY_JSON));
  });

  afterEach(() => {
    mock.restoreAll();
    setLlmCallRecorder(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  // The features `listCalls(URL_KEY)` returns: the row is filtered by urlKey, so
  // being listed here is the proof the row carried the workspace's urlKey.
  async function featuresListed() {
    await Promise.all(pending);
    const { items } = await store.listCalls(URL_KEY);
    return items.map((r) => r.feature);
  }

  // The `via` marker each listed row carries (LIN-3864): precompute rows say
  // 'precompute'; on-demand rows carry none, so they read null.
  async function viaListed() {
    await Promise.all(pending);
    const { items } = await store.listCalls(URL_KEY);
    return items.map((r) => r.via);
  }

  test('run summary', async () => {
    const handler = getHandler(makeSummariesRouter(), 'post', '/workspace/:urlKey/api/dashboard/run-summary/:loopId');
    const { req, res } = makeReqRes({ loopId: 'run-1' });
    await handler(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.deepEqual(await featuresListed(), ['run-summary']);
  });

  test('session summary', async () => {
    const router = makeSummariesRouter({ observationSessionsStore: { async getSession() { return TERMINAL_SESSION; } } });
    const handler = getHandler(router, 'post', '/workspace/:urlKey/api/dashboard/session-summary/:sessionId');
    const { req, res } = makeReqRes({ sessionId: 'sess-1' });
    await handler(req, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.deepEqual(await featuresListed(), ['session-summary']);
    assert.deepEqual(await viaListed(), [null], 'the on-demand row carries no precompute marker (LIN-3864)');
  });

  test('session-summary precompute logs as session-summary (it has no job of its own)', async () => {
    const precompute = createSessionSummaryPrecompute({
      sessionSummaryStore: new InMemorySessionSummaryCacheStore(),
      isTerminal: () => true,
      hashSessionFn: () => 'h1',
      childLoopsFn: () => []
    });
    await precompute(URL_KEY, TERMINAL_SESSION, { apiKey: 'test-key-never-sent' });
    assert.deepEqual(await featuresListed(), ['session-summary']);
    assert.deepEqual(await viaListed(), ['precompute'], 'the precompute row is told apart from on-demand (LIN-3864)');
  });

  test('run paragraph', async () => {
    mock.method(global, 'fetch', async () => sseResponse('The run is going well.'));
    const precompute = createRunParagraphPrecompute({
      runParagraphStore: new InMemoryRunParagraphStore(),
      buildView: () => ({ runId: 'r1', title: 'T', steps: [] }),
      isTerminal: () => false,
      logger: { error() {}, warn() {}, log() {} }
    });
    await precompute(URL_KEY, { sessionId: 'sess-1' }, { apiKey: 'test-key-never-sent' });
    assert.deepEqual(await featuresListed(), ['run-paragraph']);
  });

  // The feedback route creates a ticket and cannot be driven offline here, so this
  // calls the helper with the route's callMeta shape (routes/workspace-api.js,
  // `callMeta: { urlKey: workspace.urlKey }`); the census asserts the route passes it.
  test('feedback title (helper with the route callMeta shape)', async () => {
    mock.method(global, 'fetch', async () => sseResponse('A short title'));
    await generateFeedbackTitle('The button does nothing', { apiKey: 'test-key-never-sent', callMeta: { urlKey: URL_KEY } });
    assert.deepEqual(await featuresListed(), ['feedback-title']);
  });

  test('the ids asserted above are registered jobs', () => {
    for (const id of ['run-summary', 'session-summary', 'run-paragraph', 'feedback-title']) assert.ok(JOB_IDS.includes(id), id);
  });
});
