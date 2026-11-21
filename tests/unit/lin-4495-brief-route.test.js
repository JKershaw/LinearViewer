/**
 * LIN-4495 (piece 4): the route `GET /api/proxy/brief/:identifier` (routes/proxy-compute.js), through the real
 * handler with a real RecordsStore. Without `run` the response is byte-identical to today's distilled brief; with
 * `run` the run's records parts come first and today's brief follows, unchanged. An ended record is gone on the
 * next read. The three refusals (a blind read, another run's credential, no store) are one-line notes above the
 * distilled brief, never a silent omission.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4495-brief-route.test.js
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createComputeRoutes } from '../../routes/proxy-compute.js';
import { hashContext } from '../../lib/recap-cache.js';
import { TOKEN_ORIGIN, WRITES } from '../../lib/stage-writes.js';

const URL_KEY = 'brief-route-workspace';
const TICKET = 'LIN-9201';
const T0 = '2026-11-19T10:00:00.000Z';
const at = (minute) => new Date(Date.UTC(2026, 10, 19, 10, minute)).toISOString();
const TICKET_ROW = { identifier: TICKET, title: 'A task', closed: false };

// Today's distilled brief, as the cache holds it: the route must return it after any records parts, unchanged.
const DISTILLED = '# Task brief\n\n## Where it stands\n\nThe distilled present-tense brief, byte for byte.\n';
const CONTEXT = { issue: { id: 'uuid-9201', identifier: TICKET, title: 'A task', description: '' }, comments: [], children: [] };
const CACHED = { brief: DISTILLED, inputHash: hashContext(CONTEXT), generatedAt: T0, model: 'test-model' };
// Not the hermetic 'test-token', so the route takes its real provider path (the fake provider below).
const ACCESS_TOKEN = 'real-token-for-route-test';

const harness = createMangoTmpdir('lin-4495-brief-route-');
let db;
let store;

before(() => harness.connect());
after(() => harness.close());
beforeEach(async () => {
  db = harness.freshDb();
  for (const collection of [RECORDS_COLLECTION, REFS_COLLECTION]) {
    for (const spec of INDEX_SPECS.filter((x) => x.collection === collection && x.options?.unique)) {
      await db.collection(collection).createIndex(spec.keySpec, spec.options);
    }
  }
  store = new RecordsStore({
    records: db.collection(RECORDS_COLLECTION),
    refs: db.collection(REFS_COLLECTION),
    queryLog: db.collection(QUERY_LOG_COLLECTION),
    now: () => new Date(T0),
  });
});

// The route handler: the last layer of GET /api/proxy/brief/:identifier, after the limiter and the token check (which
// this test sets up on the request directly).
function briefHandler({ recordsStore }) {
  const noop = (req, res, next) => next();
  const router = createComputeRoutes({
    recordsStore,
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
  // The route is registered on an array of paths (the canonical and the flat alias), so match its path list.
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

// One GET through the real handler. `as` sets the credential the limiter and token check would have stamped.
async function getBrief({ recordsStore = store, query = {}, as = {} } = {}) {
  const handler = briefHandler({ recordsStore });
  const req = {
    params: { identifier: TICKET },
    query,
    headers: {},
    proxyUrlKey: URL_KEY,
    proxyCreatedBy: 'person-1',
    proxyWrites: WRITES.WORK,
    proxyOrigin: TOKEN_ORIGIN.PERSON,
    proxyRunRecordId: null,
    ...as,
  };
  const res = makeRes();
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

async function seedRun(runId) {
  const task = await store.ensureTask(URL_KEY, TICKET_ROW, { by: 'Harbour', at: at(1) });
  await store.openRun(URL_KEY, { id: runId, stage: 'close-out', taskId: task.id, lineage: task.id, at: at(2) });
  const finding = await store.add(URL_KEY, {
    kind: 'finding', state: 'open', fields: { says: 'The footer count is off by one.', how: 'count the rows' }, links: {}, in: task.id, to: 'close-out',
  }, { by: 'review', run: null, at: at(3) });
  return { task, finding };
}

describe('GET /api/proxy/brief/:identifier with ?run= (LIN-4495)', () => {
  test('without run the body is today\'s distilled brief, byte for byte, and nothing is read from records', async () => {
    const { finding } = await seedRun('run-route-0');
    const res = await getBrief({ query: {} });
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.status, 'fresh');
    assert.equal(res.jsonBody.brief, DISTILLED);
    assert.doesNotMatch(res.jsonBody.brief, new RegExp(finding.id), 'no records parts without run');
  });

  test('with run the records parts come first, the finding in full, and today\'s brief follows unchanged', async () => {
    const { finding } = await seedRun('run-route-1');
    const res = await getBrief({ query: { run: 'run-route-1' }, as: { proxyOrigin: TOKEN_ORIGIN.DISPATCH, proxyRunRecordId: 'run-route-1' } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    const { brief } = res.jsonBody;
    assert.match(brief, new RegExp(finding.id), 'the finding is in the records parts');
    assert.match(brief, /The footer count is off by one\./, 'in full, with its words');
    assert.notEqual(brief, DISTILLED);
    assert.equal(brief.slice(-DISTILLED.length), DISTILLED, 'today\'s brief is kept after the records parts, unchanged');
    assert.equal(brief.indexOf(finding.id) < brief.indexOf(DISTILLED), true, 'the records parts come first');
  });

  test('an ended finding is gone from the next read at once', async () => {
    const { finding } = await seedRun('run-route-2');
    const as = { proxyOrigin: TOKEN_ORIGIN.DISPATCH, proxyRunRecordId: 'run-route-2' };
    assert.match((await getBrief({ query: { run: 'run-route-2' }, as })).jsonBody.brief, new RegExp(finding.id));
    await store.end(URL_KEY, finding.id, { state: 'done', reason: 'fixed' }, { by: 'close-out', at: at(9) });
    const after = (await getBrief({ query: { run: 'run-route-2' }, as })).jsonBody.brief;
    assert.doesNotMatch(after, new RegExp(finding.id), 'an ended record is gone at once');
    assert.equal(after.slice(-DISTILLED.length), DISTILLED);
  });

  test('a blind-read credential gets a one-line refusal above the unchanged brief, never the records', async () => {
    const { finding } = await seedRun('run-route-3');
    const res = await getBrief({ query: { run: 'run-route-3' }, as: { proxyWrites: WRITES.BLIND_COMMENT } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    assert.equal(res.jsonBody.brief, `(records parts: a blind read may not read records)\n\n${DISTILLED}`);
    assert.doesNotMatch(res.jsonBody.brief, new RegExp(finding.id));
  });

  test('a dispatch credential for another run gets a one-line refusal, never that run\'s records', async () => {
    const { finding } = await seedRun('run-route-4');
    const res = await getBrief({ query: { run: 'run-route-4' }, as: { proxyOrigin: TOKEN_ORIGIN.DISPATCH, proxyRunRecordId: 'run-other' } });
    assert.equal(res.jsonBody.brief, `(records parts: a dispatch credential reads only its own run)\n\n${DISTILLED}`);
    assert.doesNotMatch(res.jsonBody.brief, new RegExp(finding.id));
  });

  test('no records store gives a one-line note above the unchanged brief', async () => {
    const res = await getBrief({ recordsStore: null, query: { run: 'run-route-5' } });
    assert.equal(res.jsonBody.brief, `(records parts: the records store is not configured)\n\n${DISTILLED}`);
  });

  test('an unknown run says so instead of guessing, and the brief still follows', async () => {
    const res = await getBrief({ query: { run: 'run-missing' } });
    assert.match(res.jsonBody.brief, /^\(records parts: run 'run-missing' is not on record\)\n\n/);
    assert.equal(res.jsonBody.brief.slice(-DISTILLED.length), DISTILLED);
  });
});
