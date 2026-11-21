/**
 * LIN-4518 review finding ea3ed46b: `GET /api/proxy/brief/:id?run=` refreshes the run's task heads from their PRs before
 * it composes the records parts, as every gating read does (lib/task-standing.js refreshTaskHeads). A push after an
 * approval, with no gate and no verdict write since, must show the approval STALE in the brief the next stage reads, even
 * on a dispatch that skips the selector.
 *
 * Witnesses over the real records store, the real verdict route and the real brief route. The mutation that removes the
 * refreshTaskHeads call from withRunRecords turns the first witness red: the brief then shows no STALE line.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4518-brief-head-refresh.test.js
 */
process.env.NODE_ENV = 'test';

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { createRecordsRouteHarness } from '../helpers/records-route-harness.js';
import { createFakeTracker } from '../helpers/fake-records-tracker.js';
import { setStandingPrReaderFor } from '../../lib/task-standing.js';
import { createComputeRoutes } from '../../routes/proxy-compute.js';
import { hashContext } from '../../lib/recap-cache.js';
import { TOKEN_ORIGIN, WRITES } from '../../lib/stage-writes.js';

const URL_KEY = 'lin-4518-brief-head-refresh';
const TICKET = 'LIN-4518';
const REPO = 'acme/widget';
const T0 = '2026-11-21T10:00:00.000Z';
const prUrl = (n) => `https://github.com/${REPO}/pull/${n}`;

// Today's distilled brief, as the cache holds it: the route returns it after the records parts, unchanged.
const DISTILLED = '# Task brief\n\nThe distilled present-tense brief.\n';
const CONTEXT = { issue: { id: 'uuid-4518', identifier: TICKET, title: 'brief head refresh', description: '' }, comments: [], children: [] };
const CACHED = { brief: DISTILLED, inputHash: hashContext(CONTEXT), generatedAt: T0, model: 'test-model' };
const ACCESS_TOKEN = 'real-token-for-route-test';

const harness = createMangoTmpdir('lin-4518-brief-head-refresh-');
before(() => harness.connect());
after(() => harness.close());

function status(number, { sha, merged = false }) {
  return {
    repo: REPO, number, readable: true, state: merged ? 'closed' : 'open', merged,
    head: { ref: `feat/pr-${number}`, sha }, ref: sha, created_at: T0, merged_at: merged ? T0 : null, checks: [],
  };
}

let rh;
let store;
let taskId;
let prs;
let tokens;
const clock = (iso) => { store.now = () => new Date(iso); };
const readPrStatus = async ({ number }) => {
  const p = prs.get(number);
  return p ? status(number, p) : { readable: false };
};
const post = (token, body) => rh.post('/api/proxy/records', token, body);

// The route handler: the last layer of GET /api/proxy/brief/:identifier, after the limiter and the token check (set up
// on the request directly). Same options as tests/unit/lin-4495-brief-route.test.js: only the records store is real.
function briefHandler() {
  const noop = (req, res, next) => next();
  const router = createComputeRoutes({
    recordsStore: store,
    recapCacheStore: null,
    briefCacheStore: { async get() { return CACHED; } },
    dispatchQueueStore: null,
    llmCallLogStore: null,
    getWorkspaceOpenRouterKey: async () => null,
    getWorkspaceNorthStar: async () => null,
    getNorthStarDocVersionForWorkspace: async () => null,
    reportHistoryStore: null,
    workspacePreferencesStore: null,
    proxyLimiter: noop,
    authenticateProxyToken: noop,
    resolveProviderAccess: async () => ({ token: ACCESS_TOKEN, reason: null, provider: { fetchRecommendationContext: async () => CONTEXT } }),
    denyIfUnsupported: () => false,
    logEvent: () => {},
    logOpenRouterCredentialSource: () => {},
    workspaceUnavailable: () => {},
    graphqlErrorStatus: () => 500,
    captureTaskSnapshot: () => {},
    chargeFreeTierOrReject: async () => null,
    computeRecommendation: async () => { throw new Error('not exercised by this test'); },
    recommendErrorResponse: () => ({ status: 500, body: { error: 'not exercised by this test' } }),
    resolvePromptIssueContext: async () => { throw new Error('not exercised by this test'); },
    withTimeout: async (p) => p,
    LINEAGE_QUERY_LIMIT: 2000,
    RECOMMEND_DESCENT_BUDGET_MS: 180_000,
    LLM_TIMEOUT_MS: 180_000,
    getTestMockData: async () => null,
    fetchWithTimeout: async (workFn) => workFn(new AbortController().signal),
    CONTEXT_FETCH_TIMEOUT_MS: 45_000,
  });
  const layer = router.stack.find((l) => [].concat(l.route?.path ?? []).includes('/api/proxy/brief/:identifier') && l.route.methods.get);
  if (!layer) throw new Error('GET /api/proxy/brief/:identifier is not registered');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    req: { headers: {} },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; this.writableEnded = true; return this; },
    setHeader() { return this; },
    flushHeaders() { return this; },
    write() { return true; },
    end(body) { this.jsonBody = typeof body === 'string' ? JSON.parse(body) : body; this.writableEnded = true; return this; },
    once() { return this; },
  };
}

// One GET through the real handler, as the run's own dispatch credential.
async function getRunBrief(runId) {
  const res = makeRes();
  await briefHandler()({
    params: { identifier: TICKET },
    query: { run: runId },
    headers: {},
    proxyUrlKey: URL_KEY,
    proxyCreatedBy: 'person-1',
    proxyWrites: WRITES.WORK,
    proxyOrigin: TOKEN_ORIGIN.DISPATCH,
    proxyRunRecordId: runId,
  }, res, (err) => { if (err) throw err; });
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
  return res.jsonBody.brief;
}

beforeEach(async () => {
  prs = new Map();
  const tracker = createFakeTracker({
    tickets: [{ identifier: TICKET, title: 'brief head refresh', description: 'Asked.', state: { name: 'In Progress', type: 'started' }, parent: null }],
  });
  rh = await createRecordsRouteHarness({
    harness, urlKey: URL_KEY, tickets: new Map(), people: [], readTicket: tracker.readTicket, tracker: () => tracker.port,
    changePrReaderFor: () => readPrStatus,
  });
  store = rh.store;
  taskId = (await store.ensureTask(URL_KEY, { identifier: TICKET, asked: 'brief head refresh.', closed: false, closedReason: null }, { by: 'Harbour', at: T0 })).id;
  for (const [id, stage] of [['row-impl', 'implementation'], ['row-review', 'review']]) {
    await store.openRun(URL_KEY, { id, stage, lineage: 'row-root', at: '2026-11-19T10:00:00.000Z' });
  }
  // The run the brief is for: it is in the task, so its records parts are the task's.
  await store.openRun(URL_KEY, { id: 'row-brief', stage: 'implementation', taskId, lineage: taskId, at: '2026-11-19T10:00:00.000Z' });
  tokens = { impl: await rh.mintRunToken('row-impl'), review: await rh.mintRunToken('row-review') };
  setStandingPrReaderFor((urlKey) => { assert.equal(urlKey, URL_KEY); return readPrStatus; });
});

afterEach(async () => {
  setStandingPrReaderFor(null);
  if (rh) await rh.close();
  rh = null;
});

async function changeAndApprove(n, sha) {
  prs.set(n, { sha });
  clock('2026-11-21T11:00:00.000Z');
  const c = await post(tokens.impl, { kind: 'change', in: taskId, ref: prUrl(n), head: sha, run: 'row-impl' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const v = await post(tokens.review, {
    kind: 'verdict', judgement: 'review', outcome: 'approve', reasoning: 'read at the head named',
    on: [c.body.id], heads: { [c.body.id]: sha }, run: 'row-review',
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  return c.body.id;
}

describe('witness: the run brief refreshes heads before it reads the standing (finding ea3ed46b)', () => {
  test('a push after the approval, with no gate and no verdict write since, shows the approval STALE in the brief', async () => {
    const changeId = await changeAndApprove(401, 'H1');
    prs.set(401, { sha: 'H2' });
    clock('2026-11-21T11:30:00.000Z');
    const brief = await getRunBrief('row-brief');
    assert.match(brief, new RegExp(`STALE: .*${changeId}`), 'the brief names the approval stale on the change the push moved');
    assert.equal(brief.slice(-DISTILLED.length), DISTILLED, 'today\'s brief still follows the records parts, unchanged');
  });

  test('the same brief with no push shows no STALE line', async () => {
    await changeAndApprove(402, 'H1');
    clock('2026-11-21T11:30:00.000Z');
    const brief = await getRunBrief('row-brief');
    assert.doesNotMatch(brief, /STALE:/);
  });

  test('an unreadable PR does not refuse the brief: the approval stands as recorded (fail open)', async () => {
    await changeAndApprove(403, 'H1');
    prs.delete(403);
    clock('2026-11-21T11:30:00.000Z');
    const brief = await getRunBrief('row-brief');
    assert.doesNotMatch(brief, /STALE:/);
    assert.equal(brief.slice(-DISTILLED.length), DISTILLED);
  });
});
