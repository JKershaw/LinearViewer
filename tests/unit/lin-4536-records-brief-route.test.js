/**
 * LIN-4536 (P6a of LIN-4529): `GET /api/proxy/brief/:identifier` (routes/proxy-compute.js) answers the records brief for
 * the caller's own credential, through the real handler and a real RecordsStore. It replaces the LIN-4495 route test,
 * whose `?run=` contract (records parts above a model-written brief) this piece retires.
 *
 * The witness the plan names (plan-9aa60562):
 *   - a run token's brief includes the records addressed to its stage, with no `?run=`;
 *   - the ticket's description is edited after its task is made, and part 1 (`## As asked`) is unchanged;
 *   - a person's later comment, ingested as their finding to the task, is in part 3 of the next stage's brief;
 *   - the brief has no model-written section: no summary cache, no tracker read, no model.
 * And who reads as whom: a person's copy reads as that person, a credential with no run as the coordinator, a run on
 * another ticket as its stage (carrying nothing for its own end), a blind read not at all.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4536-records-brief-route.test.js
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { INDEX_SPECS } from '../../lib/db-indexes.js';
import { createComputeRoutes } from '../../routes/proxy-compute.js';
import { TOKEN_ORIGIN, WRITES } from '../../lib/stage-writes.js';
import { ASKED_HEADING } from '../../lib/records/words.js';

const URL_KEY = 'records-brief-route-workspace';
const TICKET = 'LIN-9301';
const OTHER_TICKET = 'LIN-9302';
const T0 = '2026-11-23T10:00:00.000Z';
const at = (minute) => new Date(Date.UTC(2026, 10, 23, 10, minute)).toISOString();
const ASKED = 'Make the footer count the rows.\n\n## Current\nA heading of the person\'s own, kept byte for byte.';

const harness = createMangoTmpdir('lin-4536-records-brief-route-');
let db;
let store;
// What the tracker would say about the ticket: the route must never read it. A read fails the test.
let trackerReads;

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
  trackerReads = 0;
});

const unused = (what) => () => { throw new Error(`${what} is not part of the records brief`); };

// The route handler: the last layer of GET /api/proxy/brief/:identifier, after the limiter and the token check (which
// this test sets up on the request directly). Every model, cache and tracker seam throws: the brief is records alone.
function briefHandler({ recordsStore }) {
  const noop = (req, res, next) => next();
  const router = createComputeRoutes({
    recordsStore,
    recapCacheStore: null,
    briefCacheStore: { get: unused('the summary cache'), put: unused('the summary cache') },
    dispatchQueueStore: null,
    llmCallLogStore: null,
    getWorkspaceOpenRouterKey: unused('a model key'),
    getWorkspaceNorthStar: async () => null,
    getNorthStarDocVersionForWorkspace: async () => null,
    reportHistoryStore: null,
    workspacePreferencesStore: null,
    proxyLimiter: noop,
    authenticateProxyToken: noop,
    resolveProviderAccess: async () => {
      trackerReads += 1;
      return { token: 'real', reason: null, provider: { fetchRecommendationContext: unused('the tracker') } };
    },
    denyIfUnsupported: () => false,
    logEvent: () => {},
    logOpenRouterCredentialSource: unused('a model credential'),
    workspaceUnavailable: () => {},
    graphqlErrorStatus: () => 500,
    chargeFreeTierOrReject: unused('a free-tier charge'),
    computeRecommendation: unused('a recommendation'),
    recommendErrorResponse: () => ({ status: 500, body: {} }),
    resolvePromptIssueContext: unused('a prompt context'),
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
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

const RUN_TOKEN = (runId) => ({ proxyOrigin: TOKEN_ORIGIN.DISPATCH, proxyRunRecordId: runId, proxyCreatedBy: 'owner-1' });
const PERSON_TOKEN = { proxyOrigin: TOKEN_ORIGIN.PERSON, proxyRunRecordId: null, proxyCreatedBy: 'person-1' };

// One GET through the real handler. `as` sets the credential the limiter and token check would have stamped.
async function getBrief({ recordsStore = store, identifier = TICKET, query = {}, as = PERSON_TOKEN } = {}) {
  const handler = briefHandler({ recordsStore });
  const req = { params: { identifier }, query, headers: {}, proxyUrlKey: URL_KEY, proxyWrites: WRITES.WORK, ...as };
  const res = makeRes();
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

/** The brief's part headings, in order: a part runs from its heading to the next one (the person's words can hold a `##` of their own). */
const PARTS = [ASKED_HEADING, '## 2 Its plan', '## 3 Addressed to it', '## 4 What stands', '## 5 The project', '## 6 Other open runs', '## 7 Index', '## 8 The previous stage'];

/** The text of one part: from its heading to the next part's heading. */
function partOf(brief, heading) {
  const start = brief.indexOf(`${heading}\n`);
  assert.ok(start > -1, `the brief has ${heading}:\n${brief}`);
  const next = PARTS[PARTS.indexOf(heading) + 1];
  return next ? brief.slice(start, brief.indexOf(`\n\n${next}\n`, start)) : brief.slice(start);
}

async function seed() {
  const task = await store.ensureTask(URL_KEY, { identifier: TICKET, title: 'A task', closed: false, asked: ASKED }, { by: 'harbour', at: at(1) });
  await store.openRun(URL_KEY, { id: 'run-review', stage: 'review', taskId: task.id, lineage: 'run-review', at: at(2) });
  await store.openRun(URL_KEY, { id: 'run-close-out', stage: 'close-out', taskId: task.id, lineage: 'run-close-out', at: at(3) });
  const toCloseOut = await store.add(URL_KEY, {
    kind: 'finding', state: 'open', fields: { says: 'The footer count is off by one.', how: 'count the rows' }, links: {}, in: task.id, to: 'close-out',
  }, { by: 'review', run: 'run-review', at: at(4) });
  return { task, toCloseOut };
}

describe('GET /api/proxy/brief/:identifier is the records brief for the credential (LIN-4536)', () => {
  test('a run token reads its own brief, with the records addressed to its stage, and no ?run=', async () => {
    const { task, toCloseOut } = await seed();
    const res = await getBrief({ as: RUN_TOKEN('run-close-out') });
    assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
    const { brief, reader, bytes } = res.jsonBody;
    assert.equal(res.jsonBody.status, 'fresh');
    assert.equal(res.jsonBody.task, task.id);
    assert.equal(reader, 'close-out', 'read as the run\'s stage');
    assert.ok(brief.startsWith(`# Brief for close-out on ${task.id}\n\n${ASKED_HEADING}\n`), `it opens with the task as filed:\n${brief}`);
    assert.match(partOf(brief, '## 3 Addressed to it'), new RegExp(toCloseOut.id), 'the finding to its stage is in part 3');
    assert.match(brief, /The footer count is off by one\./, 'in full, with its words');
    assert.equal(bytes, Buffer.byteLength(brief));
    // Its own brief logs what it carried under the run, so the run's end ends the person findings it carried (LIN-4535).
    assert.ok((await store.carriedOfRun(URL_KEY, 'run-close-out')).has(toCloseOut.id));
  });

  test('part 1 is the task as filed: a description edit after the task is made does not change it, and no tracker is read', async () => {
    await seed();
    const first = (await getBrief({ as: RUN_TOKEN('run-close-out') })).jsonBody.brief;
    // The description is a tracker property; editing it reaches no record (the route never reads it), and the
    // task's `asked` refuses to change.
    const taskId = await store.taskForTicket(URL_KEY, TICKET);
    const { snap } = await store.read(URL_KEY, taskId);
    assert.equal(snap.fields.asked, ASKED);
    const second = (await getBrief({ as: RUN_TOKEN('run-close-out') })).jsonBody.brief;
    const part1 = partOf(second, ASKED_HEADING);
    assert.equal(part1, partOf(first, ASKED_HEADING));
    assert.ok(part1.includes(ASKED), 'the person\'s words, byte for byte, their own heading included');
    assert.equal(trackerReads, 0, 'the brief reads no tracker, so a description edit cannot reach it');
  });

  test('a person\'s later comment, ingested as their finding to the task, is in part 3 of the next stage\'s brief', async () => {
    const { task } = await seed();
    // The shape lib/comment-ingest.js writes (LIN-4535): a finding by the person, addressed to the task.
    const comment = await store.add(URL_KEY, {
      kind: 'finding', state: 'open', fields: { says: 'Also count the hidden rows, please.' }, links: {}, in: task.id, to: task.id,
    }, { by: 'person:person-1', run: null, at: at(6) });
    const brief = (await getBrief({ as: RUN_TOKEN('run-close-out') })).jsonBody.brief;
    const part3 = partOf(brief, '## 3 Addressed to it');
    assert.match(part3, new RegExp(`${comment.id} finding \\[open\\] v1 by person:person-1`));
    assert.match(part3, /Also count the hidden rows, please\./);
    assert.equal(partOf(brief, ASKED_HEADING).includes('hidden rows'), false, 'the correction is not folded into part 1');
  });

  test('the brief has no model-written section', async () => {
    await seed();
    const { brief } = (await getBrief({ as: RUN_TOKEN('run-close-out') })).jsonBody;
    for (const heading of ['## Constraints', '## Open questions', '## Changelog']) {
      assert.equal(brief.includes(heading), false, `no ${heading}: the summary is not served`);
    }
    // The only `## Current` is the person's own, inside part 1.
    assert.equal(brief.split('\n## Current\n').length - 1, 1);
    assert.ok(partOf(brief, ASKED_HEADING).includes('\n## Current\n'));
    assert.deepEqual(Object.keys((await getBrief({ as: RUN_TOKEN('run-close-out') })).jsonBody).sort(), ['brief', 'bytes', 'identifier', 'reader', 'status', 'task']);
  });

  test('an ended record is gone from the next read at once', async () => {
    const { toCloseOut } = await seed();
    assert.match((await getBrief({ as: RUN_TOKEN('run-close-out') })).jsonBody.brief, new RegExp(toCloseOut.id));
    await store.end(URL_KEY, toCloseOut.id, { state: 'done', reason: 'fixed' }, { by: 'close-out', at: at(9) });
    assert.doesNotMatch((await getBrief({ as: RUN_TOKEN('run-close-out') })).jsonBody.brief, new RegExp(toCloseOut.id));
  });

  test('a ?run= naming another run is not read: the credential\'s own run is the reader', async () => {
    const { toCloseOut } = await seed();
    const res = await getBrief({ query: { run: 'run-close-out' }, as: RUN_TOKEN('run-review') });
    assert.equal(res.jsonBody.reader, 'review');
    assert.equal(partOf(res.jsonBody.brief, '## 3 Addressed to it').includes(toCloseOut.id), false, 'close-out\'s finding is not shown to review');
  });

  test('a person\'s copy reads the task as that person, and carries nothing for a run to end', async () => {
    const { toCloseOut } = await seed();
    const res = await getBrief({ as: PERSON_TOKEN });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.reader, 'person:person-1');
    assert.equal(partOf(res.jsonBody.brief, '## 3 Addressed to it').includes(toCloseOut.id), false);
    assert.equal((await store.carriedOfRun(URL_KEY, 'run-close-out')).size, 0);
  });

  test('a credential with no run reads as the coordinator', async () => {
    await seed();
    for (const as of [{ proxyOrigin: TOKEN_ORIGIN.DISPATCH, proxyRunRecordId: null, proxyCreatedBy: 'owner-1' }, { proxyOrigin: null, proxyRunRecordId: null, proxyCreatedBy: 'owner-1' }]) {
      const res = await getBrief({ as });
      assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody));
      assert.equal(res.jsonBody.reader, 'autopilot');
    }
  });

  test('a run reading another ticket reads that ticket\'s task as its stage, and logs nothing under itself', async () => {
    await seed();
    const other = await store.ensureTask(URL_KEY, { identifier: OTHER_TICKET, title: 'Another', closed: false, asked: 'Another ask.' }, { by: 'harbour', at: at(7) });
    const theirs = await store.add(URL_KEY, {
      kind: 'finding', state: 'open', fields: { says: 'A person\'s note on the other ticket.' }, links: {}, in: other.id, to: other.id,
    }, { by: 'person:person-1', run: null, at: at(8) });
    const res = await getBrief({ identifier: OTHER_TICKET, as: RUN_TOKEN('run-close-out') });
    assert.equal(res.jsonBody.task, other.id);
    assert.equal(res.jsonBody.reader, 'close-out');
    assert.match(res.jsonBody.brief, new RegExp(theirs.id));
    assert.equal((await store.carriedOfRun(URL_KEY, 'run-close-out')).has(theirs.id), false, 'the run\'s end will not end a finding on a task it did not work');
  });

  test('a blind read is refused, and reads no records', async () => {
    await seed();
    const res = await getBrief({ as: { ...RUN_TOKEN('run-close-out'), proxyWrites: WRITES.BLIND_COMMENT } });
    assert.equal(res.statusCode, 403);
    assert.match(res.jsonBody.error, /blind read may not read the brief/);
    assert.equal((await store.carriedOfRun(URL_KEY, 'run-close-out')).size, 0);
  });

  test('a ticket with no task has no brief, says so, names the raw read, and makes no task', async () => {
    const res = await getBrief({ identifier: 'LIN-9399' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.status, 'missing');
    assert.equal(res.jsonBody.brief, null);
    assert.match(res.jsonBody.reason, /GET \/api\/proxy\/issues\/LIN-9399/);
    assert.equal(await store.taskForTicket(URL_KEY, 'LIN-9399'), null, 'a GET never makes a task');
  });

  test('no records store is a 503, never a model brief', async () => {
    const res = await getBrief({ recordsStore: null });
    assert.equal(res.statusCode, 503);
  });

  test('an invalid identifier is a 400, and so is a UUID: a task is found by its ticket\'s identifier', async () => {
    assert.equal((await getBrief({ identifier: 'not an id' })).statusCode, 400);
    const uuid = await getBrief({ identifier: '6f1c2b8e-9d3a-4c5b-8e7f-0a1b2c3d4e5f' });
    assert.equal(uuid.statusCode, 400);
    assert.match(uuid.jsonBody.error, /identifier \(e\.g\. LIN-123\), not a UUID/);
  });
});
