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
import { TaskDecisionsStore } from '../../lib/task-decisions-store.js';

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

/**
 * LIN-2790: the same shape as `decisionItem`, but the DECISION: block
 * declares `options[]` — what `suggest-answer` needs to validate `optionId`
 * against. A free-text decision (no `options` key) is `decisionItem` above.
 */
function decisionItemWithOptions(id, identifier, decisionId, options) {
  const nowIso = new Date().toISOString();
  return {
    id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`,
    promptName: 'implementation', prompt: 'p', dispatchedAt: nowIso, resolvedAt: nowIso,
    status: 'taken',
    feedback: [
      { message: '[blocked] need a decision', timestamp: nowIso },
      { kind: 'decision', message: JSON.stringify({ decision_id: decisionId, question: 'Which approach?', options }), timestamp: nowIso }
    ]
  };
}

let server, baseUrl, collection, suggestionsStore, tokenScope, historyItems, foreignHistoryItems, liveItems;

before(async () => {
  process.env.NODE_ENV = 'test';
  const app = express();
  app.use(express.json());

  // Workspace-AWARE on purpose. The previous mock ignored its urlKey argument,
  // which meant the review could repoint the route at a hardcoded other
  // workspace and the whole suite stayed green — the isolation property these
  // routes exist to hold had zero coverage.
  const dispatchQueueStore = {
    // Empty by default (`beforeEach` below); a per-test `liveItems` override
    // (LIN-2773) drives the `liveDispatchOnAnchor` witness — a live queue
    // item sharing a ruling's own anchor issue. `listHistory` below is what
    // carries the workspace isolation.
    async listItems(urlKey) { return urlKey === URL_KEY ? (liveItems || []) : []; },
    async listHistory(urlKey) { return { items: urlKey === URL_KEY ? historyItems : foreignHistoryItems }; }
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
    dismissalSuggestionsStore: suggestionsStore,
    sessionsFeedCache: null
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
  foreignHistoryItems = [decisionItem('loop-9', 'OTHER-9', 'foreign-decision')];
  liveItems = [];
});

/**
 * A `gone` loop — terminal (`[done]`), well past the 6h reap window — that
 * ALSO declares `on_answer.effect`. Used only by the `liveDispatchOnAnchor`
 * witness below: `gone` (unlike `resumable`) reaches resolveEffect's
 * branch 4, where a declared effect is otherwise honoured, so it is the
 * disposition on which an override is actually observable.
 */
function goneDecisionItem(id, identifier, decisionId, onAnswerEffect) {
  const oldIso = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); // 7h ago, past REAP_INACTIVITY_MS (6h)
  const payload = { decision_id: decisionId, question: 'Proceed?', on_answer: { effect: onAnswerEffect } };
  return {
    id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`,
    promptName: 'implementation', prompt: 'p', dispatchedAt: oldIso, resolvedAt: oldIso,
    status: 'taken',
    feedback: [
      { kind: 'decision', message: JSON.stringify(payload), timestamp: oldIso },
      { message: '[done] shipped it', timestamp: oldIso }
    ]
  };
}

/** A live (queued, non-terminal) dispatch item anchored on `identifier`. */
function liveQueueItem(id, identifier) {
  return { id, issueIdentifier: identifier, issueTitle: `Title ${identifier}`, promptName: 'plan', prompt: 'p', dispatchedAt: new Date().toISOString() };
}

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

  // LIN-2773 Area 4: liveDispatchOnAnchor, threaded from this route's own
  // `loops` read (zero new reads) into resolveEffect's branch 3.
  test('liveDispatchOnAnchor forces effect: "record" on a gone row, even over a declared "dispatch"', async () => {
    historyItems = [goneDecisionItem('loop-gone', 'LIN-50', 'd-gone-1', 'dispatch')];
    liveItems = [liveQueueItem('loop-live', 'LIN-50')]; // same anchor, still queued (non-terminal)
    const { status, body } = await req('GET', '/api/proxy/rulings');
    assert.equal(status, 200);
    const row = body.rulings.find(r => r.decision.decision_id === 'd-gone-1');
    assert.ok(row, 'the gone row is still present');
    assert.equal(row.disposition, 'gone');
    assert.equal(row.declaredEffect, 'dispatch');
    assert.equal(row.effect, 'record', 'a live run on the same anchor forces record, overriding the declared dispatch');
  });

  test('without a live loop on the same anchor, a gone row honours its declared effect (control for the test above)', async () => {
    historyItems = [goneDecisionItem('loop-gone', 'LIN-51', 'd-gone-2', 'dispatch')];
    liveItems = [];
    const { body } = await req('GET', '/api/proxy/rulings');
    const row = body.rulings.find(r => r.decision.decision_id === 'd-gone-2');
    assert.equal(row.effect, 'dispatch');
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

  test('the suggestion row carries no outcome/answer/agreement field of any kind', async () => {
    // LIN-2790: the proxy may never write agreed/agreedAt/acceptedAt on its
    // own proposal row — that boundary is the point of the ticket.
    await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, { reason: 'r' });
    const doc = collection._docs[0];
    for (const forbidden of ['outcome', 'outcomeAt', 'answered', 'answeredDecisionId', 'agreed', 'agreedAt', 'acceptedAt']) {
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

  // LIN-2790 witness 7: existing dismissal-proposal behaviour is unchanged
  // byte-for-byte — the widened store/route are additive only.
  test('LIN-2790: the wire shape gains only the two new, correctly-defaulted fields', async () => {
    const { body } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, {
      reason: 'the task shipped'
    });
    assert.equal(body.suggestion.proposedOutcome, 'dismissed');
    assert.equal(body.suggestion.optionId, null);
    // Every field that existed before this ticket is present and unchanged.
    assert.deepEqual(Object.keys(body.suggestion).sort(), [
      'decisionId', 'decisionLoopId', 'optionId', 'proposedOutcome', 'reason',
      'suggestedAt', 'suggestedBy', 'urlKey', 'withdrawn', 'withdrawnAt'
    ]);
  });
});

// LIN-2790 — Track A: propose-side widening. `suggest-answer` follows the
// SAME shape as `suggest-dismissal` above (this route is a sibling, not a
// rewrite), so this suite only covers what's actually different: `optionId`
// validation, the `proposedOutcome: 'answered'` stamp, and the discharge
// boundary. It reuses `suggest-dismissal`'s own coverage for reason
// validation, attribution, workspace isolation, and the 503 degrade path via
// the SAME `resolveTargetRuling`/`attributionFromToken` helpers.
describe('POST /api/proxy/rulings/:decisionId/suggest-answer (LIN-2790)', () => {
  const OPTIONS = [{ id: 'a', label: 'Option A' }, { id: 'b', label: 'Option B' }];

  test('a readWrite proxy token can propose a valid answer', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    const { status, body } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, {
      optionId: 'a', reason: 'this is the right call'
    });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.suggestion.proposedOutcome, 'answered');
    assert.equal(body.suggestion.optionId, 'a');
    assert.equal(body.suggestion.reason, 'this is the right call');
    assert.match(body.note, /SUGGESTION only/);
    assert.match(body.note, /still unanswered/);
  });

  test('THE RULING STAYS UNANSWERED — proposing an answer discharges nothing (positive readback)', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, { optionId: 'a', reason: 'r' });
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.count, 1, 'the ruling is still unanswered');
    assert.equal(body.rulings[0].decision.decision_id, DECISION_ID);
    assert.equal(body.rulings[0].suggestedDismissal.proposedOutcome, 'answered');
    assert.equal(body.rulings[0].suggestedDismissal.optionId, 'a');
  });

  test('an unknown option id 422s, and writes nothing', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    const { status, body } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, {
      optionId: 'no-such-option', reason: 'r'
    });
    assert.equal(status, 422);
    assert.equal(body.code, 'OPTION_NOT_FOUND');
    assert.equal(collection._docs.length, 0);
  });

  test('an unknown ruling 404s', async () => {
    const { status, body } = await req('POST', '/api/proxy/rulings/no-such-decision/suggest-answer', {
      optionId: 'a', reason: 'r'
    });
    assert.equal(status, 404);
    assert.equal(body.code, 'RULING_NOT_FOUND');
    assert.equal(collection._docs.length, 0);
  });

  test('a missing optionId 400s, and writes nothing', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    for (const optionId of [undefined, '', '   ', 42]) {
      const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, { optionId, reason: 'r' });
      assert.equal(status, 400);
    }
    assert.equal(collection._docs.length, 0);
  });

  test('a free-text decision with no options[] 422s rather than silently accepting the answer', async () => {
    // decisionItem (no `options` key at all) is the plain free-text fixture
    // the rest of this file already uses for suggest-dismissal.
    historyItems = [decisionItem('loop-1', 'LIN-1', DECISION_ID)];
    const { status, body } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, {
      optionId: 'a', reason: 'r'
    });
    assert.equal(status, 422);
    assert.equal(body.code, 'NO_OPTIONS_AVAILABLE');
    assert.equal(collection._docs.length, 0);
  });

  test('a reason is REQUIRED — 400 without one', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    for (const reason of [undefined, '', '   ', 42]) {
      const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, { optionId: 'a', reason });
      assert.equal(status, 400);
    }
    assert.equal(collection._docs.length, 0, 'nothing is written on a refused proposal');
  });

  test('an over-long reason is refused rather than truncated', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, {
      optionId: 'a', reason: 'x'.repeat(501)
    });
    assert.equal(status, 400);
  });

  test('attribution comes from the TOKEN, never from the request body', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    const { body } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, {
      optionId: 'a', reason: 'r', suggestedBy: 'somebody-else'
    });
    assert.equal(body.suggestion.suggestedBy, 'account-123');
  });

  // LIN-2790 witness 2 (the suggest-answer half — the read-scoped/dispatch
  // half is exercised structurally by the "no proxy dismiss or answer" and
  // "forbidden field" suites elsewhere in this file).
  test('a read-scoped token cannot reach suggest-answer', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    tokenScope = 'read';
    const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, { optionId: 'a', reason: 'r' });
    assert.equal(status, 403);
    assert.equal(collection._docs.length, 0);
  });

  test('an unconfigured suggestions store 503s rather than silently no-oping', async () => {
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
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/proxy/rulings/d-1/suggest-answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId: 'a', reason: 'r' })
    });
    assert.equal(res.status, 503);
    s.close();
  });

  test('the suggestion row carries no outcome/answer/agreement field of any kind — the discharge boundary applies to answer proposals too', async () => {
    historyItems = [decisionItemWithOptions('loop-1', 'LIN-1', DECISION_ID, OPTIONS)];
    await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-answer`, { optionId: 'a', reason: 'r' });
    const doc = collection._docs[0];
    for (const forbidden of ['outcome', 'outcomeAt', 'answered', 'answeredDecisionId', 'agreed', 'agreedAt', 'acceptedAt']) {
      assert.ok(!(forbidden in doc), `must never carry '${forbidden}'`);
    }
  });
});

describe('LIN-1728 is not weakened: there is no proxy dismiss or answer', () => {
  test('the router exposes NO route that could discharge a ruling — FORBIDDEN paths 404', async () => {
    // Pinned structurally rather than by reading the source: the original
    // LIN-2444 proposal included a proxy dismiss, John's ruling dropped it,
    // and a later well-meaning edit must not quietly reinstate one or a
    // proxy answer (LIN-2790: `suggest-answer` proposes, it never answers).
    for (const path of [
      `/api/proxy/rulings/${DECISION_ID}/dismiss`,
      '/api/proxy/rulings/dismiss',
      `/api/proxy/rulings/${DECISION_ID}/answer`,
      '/api/proxy/rulings/answer'
    ]) {
      const { status } = await req('POST', path, { reason: 'r' });
      assert.equal(status, 404, `${path} must not exist`);
    }
  });

  test('the two PROPOSE routes exist — must NOT 404', async () => {
    // The positive control for the test above: a bare 404 sweep proves
    // nothing if every path in it would 404 anyway (e.g. a typo in this
    // router's own mount prefix). LIN-2790 adds suggest-answer alongside the
    // pre-existing suggest-dismissal.
    for (const path of [
      `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`,
      `/api/proxy/rulings/${DECISION_ID}/suggest-answer`
    ]) {
      const { status } = await req('POST', path, { reason: 'r', optionId: 'a' });
      assert.notEqual(status, 404, `${path} must exist`);
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


describe('workspace isolation and loop shaping', () => {
  test("only the TOKEN's workspace is read — a foreign workspace's rulings never appear", async () => {
    // Pinned because the previous mock ignored its urlKey, so repointing the
    // route at another workspace left the suite green. A proxy token is scoped
    // to exactly one workspace; that is the property the whole token model
    // rests on.
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.count, 1);
    assert.equal(body.rulings[0].decision.decision_id, DECISION_ID);
    assert.ok(
      !body.rulings.some(r => r.decision.decision_id === 'foreign-decision'),
      "another workspace's ruling must never surface"
    );
  });

  test('a suggestion recorded in ANOTHER workspace never attaches here', async () => {
    await suggestionsStore.suggest({
      urlKey: 'some-other-workspace', decisionId: DECISION_ID, reason: 'r', suggestedBy: 'x'
    });
    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.rulings[0].suggestedDismissal, null);
  });

  test('rows are ENRICHED — disposition and canReply are resolved, not left undefined', async () => {
    // The enrichLoop export from routes/dashboard.js is justified as
    // load-bearing; without it `agentState` is missing and resolveDisposition
    // silently downgrades, so a live mid-turn ruling would report as repliable.
    // Dropping the enrichment previously left the whole suite green.
    const { body } = await req('GET', '/api/proxy/rulings');
    const row = body.rulings[0];
    assert.ok(typeof row.disposition === 'string' && row.disposition.length > 0, 'disposition is resolved');
    assert.equal(typeof row.canReply, 'boolean');
    assert.equal(row.disposition, 'resumable', 'a blocked, non-terminal loop is resumable');
    assert.equal(row.canReply, true);
  });
});

describe('a proposal must name a real unanswered ruling', () => {
  test('an unknown decisionId is 404, and writes nothing', async () => {
    // Otherwise a typo returns 201 {success:true} and leaves a durable, no-TTL
    // orphan row nobody will ever see — a success signal that means nothing.
    const { status, body } = await req('POST', '/api/proxy/rulings/no-such-decision/suggest-dismissal', { reason: 'r' });
    assert.equal(status, 404);
    assert.equal(body.code, 'RULING_NOT_FOUND');
    assert.equal(collection._docs.length, 0);
  });

  test("a decisionId that exists in ANOTHER workspace is still 404 here", async () => {
    const { status } = await req('POST', '/api/proxy/rulings/foreign-decision/suggest-dismissal', { reason: 'r' });
    assert.equal(status, 404);
    assert.equal(collection._docs.length, 0);
  });

  test('a real decisionId still succeeds', async () => {
    const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, { reason: 'r' });
    assert.equal(status, 201);
  });

  test('an over-long reason is measured on the TRIMMED value the store persists', async () => {
    const padded = `  ${'x'.repeat(500)}  `;
    const { status } = await req('POST', `/api/proxy/rulings/${DECISION_ID}/suggest-dismissal`, { reason: padded });
    assert.equal(status, 201, 'whitespace must not push a legal reason over the cap');
  });
});

// LIN-2650 WS0 §7: a direct spot-check of THIS consumer with a real
// TaskDecisionsStore, named explicitly by the plan-review as worth doing
// on its own — it is the one of the four inherited consumers with its own
// dedicated route tests (this file), which could independently regress
// without anyone noticing via the other three (rulings inbox, KPI
// unanswered-age input, Flight Companion's chat tool). The main suite above
// mounts this router with `taskDecisionsStore: null`, so task-bound rows
// never reach it there — this is a SEPARATE, minimal app instance with a
// real store wired in.
describe('GET /api/proxy/rulings — task-bound rows via a real TaskDecisionsStore (LIN-2650 WS0 §7)', () => {
  const TASK_URL_KEY = 'task-ws';
  const ISSUE_UNANSWERED = '11111111-2222-3333-4444-555555555555';
  const ISSUE_SELF_RESOLVED = '66666666-7777-8888-9999-000000000000';
  const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  function createTaskDecisionsMockCollection() {
    const docs = [];
    function matchesField(docValue, queryValue) {
      if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
        return queryValue.$in.includes(docValue);
      }
      if (queryValue && typeof queryValue === 'object' && '$ne' in queryValue) {
        return docValue !== queryValue.$ne;
      }
      return docValue === queryValue;
    }
    function matches(doc, query) {
      if (query._id !== undefined && doc._id !== query._id) return false;
      if (query.urlKey !== undefined && !matchesField(doc.urlKey, query.urlKey)) return false;
      if (query.issueId !== undefined && doc.issueId !== query.issueId) return false;
      if (query.outcome !== undefined && !matchesField(doc.outcome ?? null, query.outcome)) return false;
      if (query.decision !== undefined && !matchesField(doc.decision ?? null, query.decision)) return false;
      return true;
    }
    return {
      _docs: docs,
      async findOne(query) { return docs.find(d => matches(d, query)) || null; },
      find(query = {}) {
        const results = docs.filter(d => matches(d, query));
        return { async toArray() { return results.slice(); } };
      },
      async updateOne(query, update, opts = {}) {
        const idx = docs.findIndex(d => matches(d, query));
        if (idx >= 0) { Object.assign(docs[idx], update.$set || {}); return { matchedCount: 1 }; }
        if (opts.upsert) { docs.push({ ...(update.$set || {}) }); return { matchedCount: 0 }; }
        return { matchedCount: 0 };
      }
    };
  }

  let taskServer, taskBaseUrl, taskDecisionsStore;

  before(async () => {
    const collection = createTaskDecisionsMockCollection();
    taskDecisionsStore = new TaskDecisionsStore({ collection });

    // One live unanswered decision-bearing row, and one self-resolved row —
    // seeded directly via the real store (the retire route that would
    // normally produce the latter lands in a later beat).
    await taskDecisionsStore.recordScan({
      urlKey: TASK_URL_KEY, issueId: ISSUE_UNANSWERED, issueIdentifier: 'LIN-100', inputHash: HASH,
      decision: { decision_id: 'scan_11111111_aaaaaaaaaaaa', question: 'Which approach?', options: [{ id: 'a', label: 'A' }], free_text: false }
    });
    const selfResolvedRaised = await taskDecisionsStore.recordScan({
      urlKey: TASK_URL_KEY, issueId: ISSUE_SELF_RESOLVED, issueIdentifier: 'LIN-200', inputHash: HASH,
      decision: { decision_id: 'scan_66666666_aaaaaaaaaaaa', question: 'Still blocked?', options: [{ id: 'a', label: 'A' }], free_text: false }
    });
    await taskDecisionsStore.markOutcome({
      urlKey: TASK_URL_KEY, issueId: ISSUE_SELF_RESOLVED, id: selfResolvedRaised.id, outcome: 'self-resolved',
      outcomeReason: 'nothing pending', outcomeBasisHash: 'basis-xyz'
    });

    const app = express();
    app.use(express.json());
    app.use(createRulingsRoutes({
      proxyLimiter: (req, res, next) => next(),
      authenticateProxyToken: (req, res, next) => {
        req.proxyUrlKey = TASK_URL_KEY;
        req.proxyTokenScope = 'read';
        req.proxyCreatedBy = 'account-123';
        req.proxyTokenLabel = 'a-label';
        next();
      },
      requireWriteScope: (req, res, next) => next(),
      logEvent: () => {},
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      taskDecisionsStore,
      shelvedRulingsStore: null,
      dismissalSuggestionsStore: null,
      sessionsFeedCache: null
    }));

    taskServer = http.createServer(app);
    await new Promise(resolve => taskServer.listen(0, '127.0.0.1', resolve));
    taskBaseUrl = `http://127.0.0.1:${taskServer.address().port}`;
  });

  after(() => taskServer?.close());

  test('a self-resolved task-bound row is excluded — the unanswered one still appears', async () => {
    const res = await fetch(`${taskBaseUrl}/api/proxy/rulings`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.rulings.length, 1, 'only the unanswered row, not the self-resolved one');
    assert.equal(body.rulings[0].decision.decision_id, 'scan_11111111_aaaaaaaaaaaa');
  });
});

// LIN-2756 — the ticket's live repro, end to end through the real router +
// real DismissalSuggestionsStore: session `74869c9c`'s review loop
// `07509b1e` and close-out loop `0c912018` emit the SAME decision_id in the
// SAME workspace.
describe('two loops sharing a decision_id — per-loop suggest-dismissal (LIN-2756)', () => {
  const SHARED_DECISION_ID = 'lin2384-f6-gate';
  const REVIEW_LOOP = '07509b1e';
  const CLOSEOUT_LOOP = '0c912018';

  test('proposing a dismissal with decisionLoopId only attaches to that one loop’s row', async () => {
    historyItems = [
      decisionItem(REVIEW_LOOP, 'LIN-1', SHARED_DECISION_ID),
      decisionItem(CLOSEOUT_LOOP, 'LIN-1', SHARED_DECISION_ID)
    ];

    const propose = await req('POST', `/api/proxy/rulings/${SHARED_DECISION_ID}/suggest-dismissal`, {
      reason: 'review pass shipped', decisionLoopId: REVIEW_LOOP
    });
    assert.equal(propose.status, 201);

    const { body } = await req('GET', '/api/proxy/rulings');
    assert.equal(body.rulings.length, 2, 'both loops must still render as two distinct rulings');
    const reviewRow = body.rulings.find(r => r.anchor.loopId === REVIEW_LOOP);
    const closeoutRow = body.rulings.find(r => r.anchor.loopId === CLOSEOUT_LOOP);
    assert.equal(reviewRow.suggestedDismissal.reason, 'review pass shipped');
    assert.equal(closeoutRow.suggestedDismissal, null, "the close-out loop's row must not inherit the review loop's suggestion");
  });

  test('proposing a dismissal WITHOUT decisionLoopId (back-compat) fans out to every loop sharing the id', async () => {
    historyItems = [
      decisionItem(REVIEW_LOOP, 'LIN-1', SHARED_DECISION_ID),
      decisionItem(CLOSEOUT_LOOP, 'LIN-1', SHARED_DECISION_ID)
    ];

    const propose = await req('POST', `/api/proxy/rulings/${SHARED_DECISION_ID}/suggest-dismissal`, { reason: 'wide, legacy-shaped proposal' });
    assert.equal(propose.status, 201);

    const { body } = await req('GET', '/api/proxy/rulings');
    for (const r of body.rulings) {
      assert.equal(r.suggestedDismissal.reason, 'wide, legacy-shaped proposal', 'documented back-compat: a decisionId-only proposal applies to every loop carrying it');
    }
  });

  test('a decisionLoopId that names no real row 404s — the same orphan-row guard decisionId already has', async () => {
    historyItems = [decisionItem(REVIEW_LOOP, 'LIN-1', SHARED_DECISION_ID)];
    const { status, body } = await req('POST', `/api/proxy/rulings/${SHARED_DECISION_ID}/suggest-dismissal`, {
      reason: 'r', decisionLoopId: 'no-such-loop'
    });
    assert.equal(status, 404);
    assert.equal(body.code, 'RULING_NOT_FOUND');
    assert.equal(collection._docs.length, 0, 'nothing is written for an unmatched decisionLoopId');
  });

  test('an empty-string decisionLoopId is refused as a bad type, not silently treated as omitted', async () => {
    historyItems = [decisionItem(REVIEW_LOOP, 'LIN-1', SHARED_DECISION_ID)];
    const { status } = await req('POST', `/api/proxy/rulings/${SHARED_DECISION_ID}/suggest-dismissal`, {
      reason: 'r', decisionLoopId: ''
    });
    assert.equal(status, 400);
  });
});
