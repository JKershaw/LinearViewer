/**
 * LIN-4532 (LIN-4529 P2b): the rulings feed carries the person's open questions as rows of the same list, so the page, the count
 * and the workspace badge read one set, through HTTP, over the real records store and the real dispatch store.
 *
 * What is pinned, and what it fails without the change:
 *   - an open question addressed to the signed-in person is a `kind: 'question'` row, with its question, options, recommendation,
 *     "if you don't answer", its workspace anchor and whether it can be answered now;
 *   - `count` and `workspaceCount` include the question: they equal the page's row count with a mix of questions and loop rulings;
 *   - a question addressed to someone else is not in this person's feed;
 *   - a question that has ended leaves the feed.
 */
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMangoTmpdir } from '../fixtures/mango-tmpdir.js';
import { RecordsStore, RECORDS_COLLECTION, REFS_COLLECTION, QUERY_LOG_COLLECTION } from '../../lib/records-store.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createRecordWrites } from '../../lib/records/writes.js';
import { isTerminalState } from '../../lib/providers/state-map.js';
import { createDashboardRulingsRoutes } from '../../routes/dashboard-rulings.js';

const URL_KEY = 'lin-4532-feed';
const OWNER = 'acct-owner';
const OTHER = 'acct-other';
const DAY = 86400000;
const PEOPLE = [{ accountId: OWNER, name: 'Owner' }, { accountId: OTHER, name: 'Other' }];
const harness = createMangoTmpdir('lin-4532-feed-');
let records;
let dispatch;
let writes;
let server;
let base;

before(() => harness.connect());
after(() => harness.close());

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

beforeEach(async () => {
  const db = harness.freshDb();
  await db.collection(RECORDS_COLLECTION).createIndex({ urlKey: 1, id: 1, v: 1 }, { unique: true });
  records = new RecordsStore({ records: db.collection(RECORDS_COLLECTION), refs: db.collection(REFS_COLLECTION), queryLog: db.collection(QUERY_LOG_COLLECTION) });
  dispatch = new DispatchQueueStore({ collection: db.collection('dispatch-queue'), historyCollection: db.collection('dispatch-history') });
  writes = createRecordWrites({ recordsStore: records, isTerminalState, readTicket: null, askedText: () => '', stageKinds: ['implementation'], listPeople: async () => PEOPLE });
  await listen();
});

async function listen() {
  const session = { accountId: OWNER, workspaces: [{ urlKey: URL_KEY, name: 'Feed' }] };
  const ctx = {
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY, id: 'ws-feed' }; req.session = session; next(); },
    sessionsFeedCache: { keyFor: (_ws, ns) => ns, get: async (_k, fn) => fn(), clear() {} },
    mergeLoops: async () => [],
    recordsStore: records,
    dispatchQueueStore: dispatch,
    accountStore: { resolveCanonicalAccountId: async (id) => id },
  };
  const app = express();
  app.use(express.json());
  app.use(createDashboardRulingsRoutes(ctx));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function feed() {
  const res = await fetch(`${base}/workspace/${URL_KEY}/api/dashboard/rulings`);
  assert.equal(res.status, 200);
  return res.json();
}

const blocked = (t = new Date()) => [{ message: '[blocked] waiting on the person', timestamp: t.toISOString() }];

async function askingRun(id) {
  await dispatch.collection.insertOne({
    _id: id, urlKey: URL_KEY, prompt: 'work', kind: 'implementation', promptName: null, target: 'cli',
    issueIdentifier: 'LIN-9', dispatchedAt: new Date(Date.now() - DAY), dispatchedBy: OWNER, followUpTo: null,
    abort: false, cascade: false, sessionId: null, rootItemId: id, runRecordId: id, status: 'taken', feedback: blocked(),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  });
  return id;
}

async function askQuestion({ run, to = `person:${OWNER}`, asks }) {
  const snap = await writes.add({
    urlKey: URL_KEY, kind: 'question', by: 'implementation', run,
    input: { asks, options: ['left', 'right'], recommended: 'right', 'if-unanswered': 'pick right', to },
  });
  assert.ok(snap.record, `question refused: ${JSON.stringify(snap.problems)}`);
  return snap.record.id;
}

describe('the rulings feed carries open questions', () => {
  test('a question to the person is a question row, counted in count and workspaceCount', async () => {
    const run = await askingRun('run-feed-1');
    const q = await askQuestion({ run, asks: 'Ship it?' });
    const body = await feed();
    assert.equal(body.rulings.length, 1);
    assert.equal(body.count, 1);
    assert.equal(body.workspaceCount, 1);
    const row = body.rulings[0];
    assert.equal(row.kind, 'question');
    assert.equal(row.questionId, q);
    assert.equal(row.question, 'Ship it?');
    assert.deepEqual(row.options, ['left', 'right']);
    assert.equal(row.recommended, 'right');
    assert.equal(row.ifUnanswered, 'pick right');
    assert.equal(row.interactive, true);
    assert.equal(row.anchor.workspaceUrlKey, URL_KEY);
    assert.equal(row.anchor.runId, run);
  });

  test('a question to someone else is not in this person\'s feed', async () => {
    const run = await askingRun('run-feed-2');
    await askQuestion({ run, to: `person:${OTHER}`, asks: 'Not for you' });
    const body = await feed();
    assert.equal(body.count, 0);
    assert.deepEqual(body.rulings, []);
  });

  test('a question that has ended leaves the feed', async () => {
    const run = await askingRun('run-feed-3');
    const q = await askQuestion({ run, asks: 'Gone soon' });
    await writes.end({ urlKey: URL_KEY, id: q, input: { state: 'withdrawn', reason: 'dismissed' }, by: `person:${OWNER}`, run: null });
    assert.equal((await feed()).count, 0);
  });

  test('count and workspaceCount equal the rows, for a run with one question and a standing question with no run', async () => {
    const run = await askingRun('run-feed-4');
    await askQuestion({ run, asks: 'One' });
    await askQuestion({ run: null, asks: 'Two' });
    const body = await feed();
    assert.equal(body.rulings.length, 2);
    assert.equal(body.count, body.rulings.length);
    assert.equal(body.workspaceCount, body.rulings.filter((r) => r.anchor?.workspaceUrlKey === URL_KEY).length);
    assert.ok(body.rulings.every((r) => r.kind === 'question'));
  });
});
