/**
 * Route-level tests for the LIN-2444 consumer-API rulings routes
 * (GET /api/proxy/rulings, POST /api/proxy/rulings/:decisionId/suggest-dismissal).
 *
 * Mounts the REAL router with a REAL DismissalSuggestionsStore over an
 * in-memory collection — the "mount-the-real-router" pattern used by
 * tests/unit/scan-routes.test.js — so the propose path is proved end to end
 * through a real HTTP round trip.
 *
 * The most important assertions here are NEGATIVE. John's ruling is that an
 * agent may recommend a dismissal and never perform one, so the tests pin what
 * this surface must NOT be able to do: no dismiss route exists, and proposing
 * leaves the ruling exactly as unanswered as it was.
 *
 * Run with: node --test tests/unit/proxy-rulings-routes.test.js
 */
import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import { createRulingsRoutes } from '../../routes/proxy-rulings.js';
import { DismissalSuggestionsStore } from '../../lib/dismissal-suggestions-store.js';

const URL_KEY = 'test-workspace';
const DECISION_ID = 'd-1';

function createMockCollection() {
  const docs = [];
  function matchesField(docValue, queryValue) {
    if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
      return queryValue.$in.includes(docValue);
    }
    return docValue === queryValue;
  }
  function matches(doc, query) {
    if (query._id !== undefined && doc._id !== query._id) return false;
    if (query.urlKey !== undefined && !matchesField(doc.urlKey, query.urlKey)) return false;
    return true;
  }
  return {
    _docs: docs,
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async deleteMany() { return { deletedCount: 0 }; },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { Object.assign(docs[idx], update.$set || {}); return { matchedCount: 1 }; }
      if (opts.upsert) { docs.push({ ...(update.$set || {}) }); return { matchedCount: 0 }; }
      return { matchedCount: 0 };
    }
  };
}

/** A taken history item carrying a `kind:'decision'` feedback entry. */
function decisionItem(id, identifier, decisionId) {
  const nowIso = new Date().toISOString();
  return {
    id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`,
    promptName: 'implementation', prompt: 'p', dispatchedAt: nowIso, resolvedAt: nowIso,
    status: 'taken',
    feedback: [
      { message: '[blocked] need a decision', timestamp: nowIso },
      { kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Proceed?' }), timestamp: nowIso }
    ]
  };
}

let server, baseUrl, collection, suggestionsStore, tokenScope, historyItems;

before(async () => {
  process.env.NODE_ENV = 'test';
  const app = express();
  app.use(express.json());

  const dispatchQueueStore = {
    async listItems() { return []; },
    async listHistory() { return { items: historyItems }; }
  };
  const agentStatusStore = { async listStatus() { return { items: [] }; } };

  collection = createMockCollection();
  suggestionsStore = new DismissalSuggestionsStore({ collection });

  app.use(createRulingsRoutes({
    proxyLimiter: (req, res, next) => next(),
    authenticateProxyToken: (req, res, next) => {
      req.proxyUrlKey = URL_KEY;
      req.proxyTokenScope = tokenScope;
      req.proxyCreatedBy = 'account-123';
      req.proxyTokenLabel = 'a-label';
      next();
    },
    requireWriteScope: (req, res, next) => {
      if (req.proxyTokenScope !== 'readWrite') {
        return res.status(403).json({ error: 'This endpoint requires a read-write token' });
      }
      next();
    },
    logEvent: () => {},
    dispatchQueueStore,
    agentStatusStore,
    taskDecisionsStore: null,
    shelvedRulingsStore: null,
    dismissalSuggestionsStore: suggestionsStore
  }));

  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

beforeEach(() => {
  collection._docs.length = 0;
  tokenScope = 'readWrite';
  historyItems = [decisionItem('loop-1', 'LIN-1', DECISION_ID)];
});

async function req(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  let parsed = null;
  try { parsed = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: parsed };
}

describe('GET /api/proxy/rulings', () => {
  test("returns the token workspace's unanswered decisions", async () => {
    const { status, body } = await req('GET', '/api/proxy/rulings');
    assert.equal(status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.rulings[0].decision.decision_id, DECISION_ID);
    assert.equal(body.rulings[0].anchor.workspaceUrlKey, URL_KEY);
  });

  test('a ruling with no standing proposal reports suggestedDismissal: null', async () => {
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.rulings[0].suggestedDismissal, null);
  });

  test('a standing proposal is attached to its ruling', async () => {
    await suggestionsStore.suggest({
      urlKey: URL_KEY, decisionId: DECISION_ID, reason: 'the task shipped', suggestedBy: 'lane-e'
    });
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.rulings[0].suggestedDismissal.reason, 'the task shipped');
    assert.equal(body.rulings[0].suggestedDismissal.suggestedBy, 'lane-e');
  });

  test('a WITHDRAWN proposal is not attached — Keep means it stops being offered', async () => {
    await suggestionsStore.suggest({ urlKey: URL_KEY, decisionId: DECISION_ID, reason: 'r', suggestedBy: 'x' });
    await suggestionsStore.withdraw({ urlKey: URL_KEY, decisionId: DECISION_ID });
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.rulings[0].suggestedDismissal, null);
  });

  test('a proposal for a DIFFERENT decision does not leak onto this ruling', async () => {
    await suggestionsStore.suggest({ urlKey: URL_KEY, decisionId: 'other-decision', reason: 'r', suggestedBy: 'x' });
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.rulings[0].suggestedDismissal, null);
  });

  test('a read-scoped token can read', async () => {
    tokenScope = 'read';
    const { status } = await req('GET', '/api/proxy/rulings');
    assert.equal(status, 200);
  });

  test('no unanswered decisions is an empty list, not an error', async () => {
    historyItems = [];
    const { status, body } = await req('GET', '/api/proxy/rulings');
    assert.equal(status, 200);
    assert.equal(body.count, 0);
    assert.deepEqual(body.rulings, []);
  });
});

describe('POST /api/proxy/rulings/:decisionId/suggest-dismissal', () => {
  test('records a proposal and says on the wire that it is not a dismissal', async () => {
    const { status, body } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, {
      reason: 'the task shipped in #1384'
    });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.suggestion.reason, 'the task shipped in #1384');
    assert.match(body.note, /SUGGESTION only/);
    assert.match(body.note, /still unanswered/);
  });

  test('THE RULING STAYS UNANSWERED — proposing discharges nothing', async () => {
    // The whole point of the ticket. After a proposal the decision must still
    // appear in the unanswered feed, exactly as before.
    await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, { reason: 'r' });
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.count, 1, 'the ruling is still unanswered');
    assert.equal(body.rulings[0].decision.decision_id, DECISION_ID);
  });

  test('the suggestion row carries no outcome/answer field of any kind', async () => {
    await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, { reason: 'r' });
    const doc = collection._docs[0];
    for (const forbidden of ['outcome', 'outcomeAt', 'answered', 'answeredDecisionId']) {
      assert.ok(!(forbidden in doc), `must never carry '${forbidden}'`);
    }
  });

  test('attribution comes from the TOKEN, never from the request body', async () => {
    // A caller must not be able to propose in someone else's name.
    const { body } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, {
      reason: 'r', suggestedBy: 'somebody-else'
    });
    assert.equal(body.suggestion.suggestedBy, 'account-123');
  });

  test('a reason is REQUIRED — 400 without one', async () => {
    for (const reason of [undefined, '', '   ', 42]) {
      const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, { reason });
      assert.equal(status, 400);
    }
    assert.equal(collection._docs.length, 0, 'nothing is written on a refused proposal');
  });

  test('an over-long reason is refused rather than truncated', async () => {
    const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, {
      reason: 'x'.repeat(501)
    });
    assert.equal(status, 400);
  });

  test('a read-scoped token cannot propose', async () => {
    tokenScope = 'read';
    const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, { reason: 'r' });
    assert.equal(status, 403);
  });
});

describe('LIN-1728 is not weakened: there is no proxy dismiss', () => {
  test('the router exposes NO route that could discharge a ruling', async () => {
    // Pinned structurally rather than by reading the source: the original
    // LIN-2444 proposal included a proxy dismiss, John's ruling dropped it,
    // and a later well-meaning edit must not quietly reinstate one.
    for (const path of [
      `/api/proxy/rulings/${DECISION_ID}/dismiss`,
      '/api/proxy/rulings/dismiss',
      `/api/proxy/rulings/${DECISION_ID}/answer`
    ]) {
      const { status } = await req('POST', path, { reason: 'r' });
      assert.equal(status, 404, `${path} must not exist`);
    }
  });

  test('the rulings router never CALLS the dispatch store\'s answer writer', async () => {
    // Scanned rather than asserted behaviourally because the guarantee is an
    // absence, and an absence has no call path to exercise. Matched on the
    // call/import shape, not on any mention of the name — the module's own
    // docstring discusses `decision-answer` at length, and a scan that
    // tripped on prose would push the next author into deleting the
    // explanation to get green, which is the opposite of what this pins.
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = await readFile(join(here, '..', '..', 'routes', 'proxy-rulings.js'), 'utf-8');
    assert.ok(!/markDecisionAnswered\s*\(/.test(src), 'must never call markDecisionAnswered');
    assert.ok(!/from\s+['\"][^'\"]*dispatch-store\.js['\"]/.test(src), 'must not import the dispatch store at all');
    assert.ok(!/kind:\s*['\"]decision-answer['\"]/.test(src), 'must never write a decision-answer stamp');
  });
});

describe('degrade paths', () => {
  test('an unconfigured suggestions store 503s the propose route rather than silently no-oping', async () => {
    const app = express();
    app.use(express.json());
    app.use(createRulingsRoutes({
      proxyLimiter: (req, res, next) => next(),
      authenticateProxyToken: (req, res, next) => { req.proxyUrlKey = URL_KEY; req.proxyTokenScope = 'readWrite'; next(); },
      requireWriteScope: (req, res, next) => next(),
      logEvent: () => {},
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      dismissalSuggestionsStore: null
    }));
    const s = http.createServer(app);
    await new Promise(r => s.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/proxy/rulings/d-1/suggest-dismissal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'r' })
    });
    assert.equal(res.status, 503);
    s.close();
  });
});
