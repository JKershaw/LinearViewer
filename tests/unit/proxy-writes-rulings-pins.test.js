// LIN-3575 (LIN-3573 rung 4): in-repo pins for the three propose invariants of the
// rebuilt rulings router (routes/proxy-rulings.js) that, before this file, only the
// out-of-repo replay guarded (or, for b, nothing did):
//   a. suggest-dismissal never forwards `optionId` (or `proposedOutcome`) to the
//      store, even when the body carries one.
//   b. suggest-answer checks `optionId` before `reason`: an empty body answers
//      400 `optionId is required`, not the reason message.
//   c. each propose route logs under its own endpoint label.
// Each runs the real createRulingsRoutes over a real DismissalSuggestionsStore.
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createRulingsRoutes } from '../../routes/proxy-rulings.js';
import { DismissalSuggestionsStore } from '../../lib/dismissal-suggestions-store.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';

const URL_KEY = 'pins-workspace';
const DECISION_ID = 'd-1';
const OPTIONS = [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }];

function collection() {
  const docs = [];
  const matches = (doc, q) => (q._id === undefined || doc._id === q._id) && (q.urlKey === undefined || doc.urlKey === q.urlKey);
  return {
    async findOne(q) { return docs.find((d) => matches(d, q)) || null; },
    find(q = {}) { const rows = docs.filter((d) => matches(d, q)); return { async toArray() { return rows.slice(); } }; },
    async deleteMany() { return { deletedCount: 0 }; },
    async updateOne(q, update, opts = {}) {
      const i = docs.findIndex((d) => matches(d, q));
      if (i >= 0) { Object.assign(docs[i], update.$set || {}); return { matchedCount: 1 }; }
      if (opts.upsert) { docs.push({ ...(update.$set || {}) }); return { matchedCount: 0 }; }
      return { matchedCount: 0 };
    }
  };
}

function decisionWithOptions() {
  const nowIso = new Date().toISOString();
  return {
    id: 'loop-1', issueIdentifier: 'LIN-1', issueTitle: 'Title LIN-1',
    promptName: 'implementation', prompt: 'p', dispatchedAt: nowIso, resolvedAt: nowIso, status: 'taken',
    feedback: [
      { message: '[blocked] need a decision', timestamp: nowIso },
      { kind: 'decision', message: JSON.stringify({ decision_id: DECISION_ID, question: 'Which approach?', options: OPTIONS }), timestamp: nowIso }
    ]
  };
}

let server, baseUrl, storeCalls, events;

before(async () => {
  process.env.NODE_ENV = 'test';
  const store = new DismissalSuggestionsStore({ collection: collection() });
  const realSuggest = store.suggest.bind(store);
  store.suggest = async (arg) => { storeCalls.push(arg); return realSuggest(arg); };

  const app = express();
  app.use(express.json());
  app.use(createRulingsRoutes({
    proxyLimiter: (req, res, next) => next(),
    authenticateProxyToken: (req, res, next) => {
      req.proxyUrlKey = URL_KEY;
      req.proxyTokenScope = 'readWrite';
      req.proxyCreatedBy = 'account-123';
      next();
    },
    requireWriteScope: (req, res, next) => next(),
    logEvent: (req, endpoint, status) => { events.push({ endpoint, status }); },
    dispatchQueueStore: {
      async listItems() { return withFreshDigests([]); },
      async listHistory() { return { items: withFreshDigests([decisionWithOptions()]) }; }
    },
    agentStatusStore: { async listStatus() { return { items: [] }; } },
    taskDecisionsStore: null,
    shelvedRulingsStore: { async listForWorkspaces() { return []; } },
    dismissalSuggestionsStore: store,
    sessionsFeedCache: null
  }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

beforeEach(() => { storeCalls = []; events = []; });

async function post(route, body) {
  const res = await fetch(`${baseUrl}/api/proxy/rulings/${DECISION_ID}/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

describe('rulings propose pins (LIN-3575)', () => {
  test('a: suggest-dismissal never forwards optionId or proposedOutcome to the store', async () => {
    const { status } = await post('suggest-dismissal', { reason: 'x', optionId: 'a' });
    assert.equal(status, 201);
    assert.equal(storeCalls.length, 1);
    assert.equal('optionId' in storeCalls[0], false, 'a stray optionId must not reach the store');
    assert.equal('proposedOutcome' in storeCalls[0], false, 'a dismissal writes no proposedOutcome');
  });

  test('b: suggest-answer with an empty body answers 400 optionId is required, before the reason check', async () => {
    const { status, body } = await post('suggest-answer', {});
    assert.equal(status, 400);
    assert.match(body.error, /^optionId is required/);
    assert.equal(storeCalls.length, 0);
  });

  test('c: each propose route logs under its own endpoint label', async () => {
    assert.equal((await post('suggest-answer', { optionId: 'a', reason: 'r' })).status, 201);
    assert.deepEqual(events, [{ endpoint: '/api/proxy/rulings/suggest-answer', status: 201 }]);
    events.length = 0;
    assert.equal((await post('suggest-dismissal', { reason: 'r' })).status, 201);
    assert.deepEqual(events, [{ endpoint: '/api/proxy/rulings/suggest-dismissal', status: 201 }]);
  });
});
