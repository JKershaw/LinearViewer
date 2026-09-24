// =============================================================================
// Session-auth durable-comment route (LIN-2154)
//   POST /workspace/:urlKey/api/comments/:issueId
// =============================================================================
//
// Drives the new route end-to-end against a fake provider (mirroring the
// harness in tests/unit/issue-write-routes.test.js), asserting the plan's
// spec:
//   - 201 happy path → { success, comment }, body carries the attribution line
//   - 400 validation: missing body, dangerous chars, over-length
//   - 422 CAPABILITY_NOT_SUPPORTED when createComment / issueWriteGuard is absent
//   - 409 when the target issue is trashed (before any provider write)
//   - 502 when the provider write returns !success
//   - dedupe: an identical resubmission returns the ORIGINAL comment with
//     deduped:true instead of minting a duplicate
//   - cross-lane dedupe salting: an agent-lane create (routes/proxy.js) and a
//     human-lane create (this route) for the SAME text do not collide —
//     confirms the 'human-comment' salt keeps the two lanes' dedupe windows
//     independent, sharing only the cache instance and generation tracker.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { createSessionsFeedCache } from '../../lib/sessions-feed-cache.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROVIDER_NAME = 'comment-write-fake';
const ISSUE_ID = 'LIN-901';

function makeFakeProvider(overrides = {}) {
  const calls = { createComment: [], issueWriteGuard: [] };
  const caps = overrides.caps || { createComment: true };
  const provider = {
    name: PROVIDER_NAME,
    supports: (cap) => caps[cap] === true,
    async createComment(token, issueId, body) {
      calls.createComment.push({ issueId, body });
      if (overrides.createComment) return overrides.createComment(issueId, body);
      return { success: true, comment: { id: `c-${calls.createComment.length}`, body, createdAt: new Date().toISOString(), user: { name: 'Fake' } } };
    },
    ...(overrides.omitIssueWriteGuard ? {} : {
      async issueWriteGuard(token, issueId) {
        calls.issueWriteGuard.push(issueId);
        if (overrides.issueWriteGuard) return overrides.issueWriteGuard(issueId);
        return { id: 'iss-1', trashed: false, team: { id: 'team-x' } };
      },
    }),
  };
  return { provider, calls };
}

function makeFakeDispatchQueueStore(overrides = {}) {
  const calls = { markDecisionAnswered: [] };
  const store = {
    async markDecisionAnswered(itemId, urlKey, decisionId) {
      calls.markDecisionAnswered.push({ itemId, urlKey, decisionId });
      if (overrides.markDecisionAnswered) return overrides.markDecisionAnswered(itemId, urlKey, decisionId);
      return { success: true, feedbackCount: 1 };
    },
  };
  return { store, calls };
}

function makeFakeTaskDecisionsStore(overrides = {}) {
  const calls = { markOutcome: [] };
  const store = {
    async markOutcome({ urlKey, issueId, id, outcome }) {
      calls.markOutcome.push({ urlKey, issueId, id, outcome });
      if (overrides.markOutcome) return overrides.markOutcome({ urlKey, issueId, id, outcome });
      return { id, urlKey, issueId, outcome, outcomeAt: new Date().toISOString() };
    },
  };
  return { store, calls };
}

// =============================================================================
// LIN-2933: session-lane one-shot auth-recovery fixtures.
// =============================================================================
//
// Credential-keyed (not count-keyed — see the ticket's research comment
// `22a3db2b`, which found a count-keyed stub goes green on a client-only
// retry that would have failed 5/5 on the real 2026-09-23 incident). Rejects
// `createComment` for exactly the tokens named `rejectedTokens`, accepting
// every other token. `issueWriteGuard` never rejects on credential grounds —
// it exists so the route's two-call recovery shape (guard, then create) is
// exercised without making guard a second independent credential gate; this
// is what makes the plan's own call-count assertions ("issueWriteGuard/
// createComment each called exactly twice") land exactly.
function makeCredentialKeyedProvider({ name = 'linear', displayName = 'Linear', rejectedTokens = [] } = {}) {
  const calls = { createComment: [], issueWriteGuard: [] };
  const rejects = (token) => rejectedTokens.includes(token);
  const authError = () => {
    const err = new Error('Authentication required, not authenticated');
    err.status = 401;
    return err;
  };
  const provider = {
    name,
    ui: { displayName },
    supports: (cap) => cap === 'createComment',
    async issueWriteGuard(token) {
      calls.issueWriteGuard.push(token);
      return { id: 'iss-1', trashed: false, team: { id: 'team-x' } };
    },
    async createComment(token, issueId, body) {
      calls.createComment.push(token);
      if (rejects(token)) throw authError();
      return { success: true, comment: { id: `c-${calls.createComment.length}`, body, createdAt: new Date().toISOString(), user: { name: displayName } } };
    },
  };
  return { provider, calls };
}

// A fake `ownerCredentialStore`: `.get` always returns the same fixed
// `record` (or `null`), regardless of how many times it's called — the
// caller asserts the CALL COUNT itself to pin one-shot behavior (plan-review
// R1's case (d): call-count-on-guard/create alone can't distinguish "no
// loop" from "a loop that happened to stop here", but `store.get`'s count
// can).
function makeFakeOwnerCredentialStore(record) {
  const calls = [];
  const store = {
    async get(accountId, urlKey, provider) {
      calls.push({ accountId, urlKey, provider });
      return record;
    },
  };
  return { store, calls };
}

function makeRecoverySession({ accountId = 'acct-1', saveError = null } = {}) {
  return { accountId, save: (cb) => cb(saveError) };
}

// LIN-2664 F2: the ORIGINAL create's ledger write fails once, then heals on
// any later attempt — models a transient harbour-comments ledger outage that
// has cleared by the time a dedupe-hit resubmission re-attempts the record.
function makeFlakyHarbourCommentsStore() {
  const calls = [];
  let attempt = 0;
  return {
    calls,
    async record({ urlKey, commentId }) {
      attempt += 1;
      calls.push({ urlKey, commentId, attempt });
      if (attempt === 1) throw new Error('ledger down (first attempt)');
      return { urlKey, commentId, recordedAt: new Date().toISOString() };
    },
  };
}

// A plain (never-fails) harbour-comments ledger spy — LIN-2933 L2, close-out
// ledger item `b1ab28d5`: used to prove a RECOVERED retry still runs the
// shared success tail's ledger write exactly once, carrying the retry's own
// comment id (never the original, failed attempt's).
function makeSpyHarbourCommentsStore() {
  const calls = [];
  return {
    calls,
    async record({ urlKey, commentId }) {
      calls.push({ urlKey, commentId });
      return { urlKey, commentId, recordedAt: new Date().toISOString() };
    },
  };
}

function buildApp({ provider, session, dispatchQueueStore, taskDecisionsStore, harbourCommentsStore, sessionsFeedCache, ownerCredentialStore, workspaceOverrides } = {}) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());

  const workspaceRouter = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token', ...workspaceOverrides };
      req.session = session || { accountId: 'acct-1' };
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: dispatchQueueStore || {}, agentStatusStore: {}, promptTraceStore: {},
    taskDecisionsStore,
    harbourCommentsStore,
    // LIN-2755 beat 2: NOT YET a real parameter of createWorkspaceApiRoutes
    // (beat 1's sweep found this) — passed here so the RED tests below are
    // ready for beat 3 to wire it in; today it is silently ignored by the
    // destructure, which is exactly why those tests are red.
    sessionsFeedCache,
    // LIN-2933: the session-lane one-shot auth-recovery store. null by
    // default (every existing test above is unaffected — recovery is simply
    // never eligible without one), injected explicitly by the recovery
    // describe block below.
    ownerCredentialStore,
  });
  app.use(workspaceRouter);

  // Mount the agent-lane proxy routes too, sharing the SAME provider instance,
  // for the cross-lane dedupe-salt test below.
  const proxyRouter = createProxyRoutes({
    provider,
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: PROVIDER_NAME }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {}, recapCacheStore: {}, briefCacheStore: {}, dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  });
  app.use(proxyRouter);

  return app;
}

async function call(app, method, path, payload) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const postComment = (app, issueId, payload, urlKey = 'acme') =>
  call(app, 'POST', `/workspace/${urlKey}/api/comments/${issueId}`, payload);

async function callWithAuth(app, method, path, payload) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer anything' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

describe('POST /workspace/:urlKey/api/comments/:issueId (LIN-2154)', () => {
  test('201 happy path → { success, comment }; body carries the attribution line', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'ship it' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.match(body.comment.body, /^ship it\n\n/);
    assert.match(body.comment.body, /Ruling recorded via Harbour/);
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(calls.createComment[0].issueId, ISSUE_ID);
  });

  test('400 when body is missing', async () => {
    const { provider, calls } = makeFakeProvider();
    const { status, body } = await postComment(buildApp({ provider }), ISSUE_ID, {});
    assert.strictEqual(status, 400);
    assert.match(body.error, /body is required/i);
    assert.strictEqual(calls.createComment.length, 0);
  });

  test('400 dangerous characters', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postComment(buildApp({ provider }), ISSUE_ID, { body: 'bad\x00body' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /invalid characters/i);
  });

  test('400 over-length body', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postComment(buildApp({ provider }), ISSUE_ID, { body: 'x'.repeat(50001) });
    assert.strictEqual(status, 400);
    assert.match(body.error, /exceeds maximum length/i);
  });

  test('400 invalid issue id format', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postComment(buildApp({ provider }), 'bad id with spaces', { body: 'hi' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /Invalid issue ID format/i);
  });

  test('422 CAPABILITY_NOT_SUPPORTED when the provider cannot create comments', async () => {
    const { provider, calls } = makeFakeProvider({ caps: { createComment: false } });
    const { status, body } = await postComment(buildApp({ provider }), ISSUE_ID, { body: 'hi' });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(body.capability, 'createComment');
    assert.strictEqual(calls.createComment.length, 0);
  });

  test('422 CAPABILITY_NOT_SUPPORTED (issueWriteGuard) when the capability gate passes but the internal read is absent', async () => {
    const { provider } = makeFakeProvider({ omitIssueWriteGuard: true });
    const { status, body } = await postComment(buildApp({ provider }), ISSUE_ID, { body: 'hi' });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(body.capability, 'issueWriteGuard');
  });

  test('409 when the target issue is trashed — no write attempted', async () => {
    const { provider, calls } = makeFakeProvider({
      issueWriteGuard: () => ({ id: 'iss-1', trashed: true, team: { id: 'team-x' } }),
    });
    const { status, body } = await postComment(buildApp({ provider }), ISSUE_ID, { body: 'hi' });
    assert.strictEqual(status, 409);
    assert.match(body.error, /trashed/i);
    assert.strictEqual(calls.createComment.length, 0);
  });

  test('502 when the provider write is rejected', async () => {
    const { provider } = makeFakeProvider({ createComment: () => ({ success: false }) });
    const { status, body } = await postComment(buildApp({ provider }), ISSUE_ID, { body: 'hi' });
    assert.strictEqual(status, 502);
    assert.match(body.error, /not created/i);
  });

  test('dedupe: an identical resubmission returns the original comment, deduped:true, no second write', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const first = await postComment(app, ISSUE_ID, { body: 'the same text' });
    assert.strictEqual(first.status, 201);

    const second = await postComment(app, ISSUE_ID, { body: 'the same text' });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true);
    assert.strictEqual(second.body.comment.id, first.body.comment.id);
    assert.strictEqual(calls.createComment.length, 1); // no second provider write
  });

  test('cross-lane dedupe salt: an agent-lane create and a human-lane create of the SAME text do not collide', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const agentResult = await callWithAuth(app, 'POST', `/api/proxy/issues/${ISSUE_ID}/comments`, { body: 'identical text' });
    assert.strictEqual(agentResult.status, 201);

    const humanResult = await postComment(app, ISSUE_ID, { body: 'identical text' });
    // Not deduped against the agent lane's entry — the human-lane call mints
    // its own comment (attributed), proving the 'human-comment' salt keeps the
    // two lanes' digest streams independent even though they share one cache
    // instance and one generation tracker.
    assert.strictEqual(humanResult.status, 201);
    assert.notStrictEqual(humanResult.body.comment.id, agentResult.body.comment.id);
    assert.strictEqual(calls.createComment.length, 2);
  });
});

// =============================================================================
// LIN-1728 Phase 2: optional decision-answer stamp params on the same route.
// =============================================================================
describe('POST /workspace/:urlKey/api/comments/:issueId — decision-answer stamp (LIN-1728)', () => {
  test('both params present → markDecisionAnswered is called with the right args, and the comment still 201s', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeDispatchQueueStore();
    const app = buildApp({ provider, dispatchQueueStore: store });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'ship it — decision stamp both-present', decisionLoopId: 'loop-1', decisionId: 'd-1' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.markDecisionAnswered.length, 1);
    assert.deepStrictEqual(calls.markDecisionAnswered[0], { itemId: 'loop-1', urlKey: 'acme', decisionId: 'd-1' });
  });

  test('params absent → markDecisionAnswered is never called; unchanged 201 behavior', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeDispatchQueueStore();
    const app = buildApp({ provider, dispatchQueueStore: store });

    const { status } = await postComment(app, ISSUE_ID, { body: 'ship it — decision stamp absent' });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.markDecisionAnswered.length, 0);
  });

  test('only one of the pair present → markDecisionAnswered is never called (not a half-stamp)', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeDispatchQueueStore();
    const app = buildApp({ provider, dispatchQueueStore: store });

    const { status } = await postComment(app, ISSUE_ID, { body: 'ship it — decision stamp half-present', decisionLoopId: 'loop-1' });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.markDecisionAnswered.length, 0);
  });

  test('stamp failure (store throws) does not fail the comment response', async () => {
    const { provider } = makeFakeProvider();
    const { store } = makeFakeDispatchQueueStore({
      markDecisionAnswered: () => { throw new Error('store down'); },
    });
    const app = buildApp({ provider, dispatchQueueStore: store });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'ship it — decision stamp throws', decisionLoopId: 'loop-1', decisionId: 'd-1' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
  });

  test('stamp returning null (no matching item) does not fail the comment response', async () => {
    const { provider } = makeFakeProvider();
    const { store } = makeFakeDispatchQueueStore({ markDecisionAnswered: () => null });
    const app = buildApp({ provider, dispatchQueueStore: store });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'ship it — decision stamp returns null', decisionLoopId: 'loop-1', decisionId: 'd-1' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
  });

  test('a deduped resubmission does not re-stamp', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeDispatchQueueStore();
    const app = buildApp({ provider, dispatchQueueStore: store });

    const first = await postComment(app, ISSUE_ID, { body: 'the same text — decision stamp dedupe', decisionLoopId: 'loop-1', decisionId: 'd-1' });
    assert.strictEqual(first.status, 201);
    assert.strictEqual(calls.markDecisionAnswered.length, 1);

    const second = await postComment(app, ISSUE_ID, { body: 'the same text — decision stamp dedupe', decisionLoopId: 'loop-1', decisionId: 'd-1' });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true);
    assert.strictEqual(calls.markDecisionAnswered.length, 1, 'no second stamp on a deduped resubmission');
  });

  // LIN-2208: reproduces the failure-then-immediate-identical-retry sequence
  // from close-out on PR #1170 — a failed stamp followed by the one natural
  // retry (Save again, IDENTICAL text) must actually re-stamp, not be
  // swallowed by the comment-dedupe short-circuit. This is the failure path;
  // the test above it is the success path and must stay proof of THAT case
  // only (per the ticket's own constraint), not be repurposed here.
  test('LIN-2208: a failed stamp is retried on an identical-text dedupe resubmission, and a further identical retry does not double-stamp once it succeeds', async () => {
    const { provider } = makeFakeProvider();
    let attempt = 0;
    const { store, calls } = makeFakeDispatchQueueStore({
      markDecisionAnswered: () => {
        attempt += 1;
        return attempt === 1 ? null : { success: true, feedbackCount: 1 };
      },
    });
    const app = buildApp({ provider, dispatchQueueStore: store });

    const payload = { body: 'the same text — decision stamp retry', decisionLoopId: 'loop-1', decisionId: 'd-1' };
    const first = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(first.status, 201);
    assert.strictEqual(calls.markDecisionAnswered.length, 1, 'first attempt fails (no matching item yet)');

    // Pre-LIN-2208: the dedupe short-circuit returned {deduped:true} before
    // ever reaching the stamp block, so a failed stamp could never self-heal
    // within the 5-minute TTL via the one obvious retry. The comment write
    // itself must STILL be deduped (no second comment) — only the stamp
    // attempt bypasses the short-circuit.
    const second = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true, 'the comment write is still deduped — no second comment');
    assert.strictEqual(calls.markDecisionAnswered.length, 2, 'the retry reached the stamp block and re-attempted');

    // A third identical retry must NOT stamp a third time now that one has
    // already succeeded — the pre-existing success-path guarantee, unaffected
    // by this fix.
    const third = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(third.status, 200);
    assert.strictEqual(calls.markDecisionAnswered.length, 2, 'no further stamp once one has already succeeded');
  });
});

describe('POST /workspace/:urlKey/api/comments/:issueId — task-decision answer stamp (LIN-2197 Phase 5, L4)', () => {
  test('both params present → markOutcome is called with outcome: "answered", and the comment still 201s', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeTaskDecisionsStore();
    const app = buildApp({ provider, taskDecisionsStore: store });

    const { status, body } = await postComment(app, ISSUE_ID, {
      body: 'ship it — task-decision stamp both-present',
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
      taskDecisionIssueId: '11111111-2222-3333-4444-555555555555',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.markOutcome.length, 1);
    assert.deepStrictEqual(calls.markOutcome[0], {
      urlKey: 'acme', issueId: '11111111-2222-3333-4444-555555555555', id: 'scan_11111111_aaaaaaaaaaaa', outcome: 'answered',
    });
  });

  test('params absent → markOutcome is never called; unchanged 201 behavior', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeTaskDecisionsStore();
    const app = buildApp({ provider, taskDecisionsStore: store });

    const { status } = await postComment(app, ISSUE_ID, { body: 'ship it — task-decision stamp absent' });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.markOutcome.length, 0);
  });

  test('only one of the pair present → markOutcome is never called (not a half-stamp)', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeTaskDecisionsStore();
    const app = buildApp({ provider, taskDecisionsStore: store });

    const { status } = await postComment(app, ISSUE_ID, {
      body: 'ship it — task-decision stamp half-present', taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(calls.markOutcome.length, 0);
  });

  test('no taskDecisionsStore configured → route still 201s (optional dependency, never a hard failure)', async () => {
    const { provider } = makeFakeProvider();
    const app = buildApp({ provider }); // taskDecisionsStore omitted entirely

    const { status, body } = await postComment(app, ISSUE_ID, {
      body: 'ship it — no store configured',
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
      taskDecisionIssueId: '11111111-2222-3333-4444-555555555555',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
  });

  test('stamp failure (store throws) does not fail the comment response', async () => {
    const { provider } = makeFakeProvider();
    const { store } = makeFakeTaskDecisionsStore({
      markOutcome: () => { throw new Error('store down'); },
    });
    const app = buildApp({ provider, taskDecisionsStore: store });

    const { status, body } = await postComment(app, ISSUE_ID, {
      body: 'ship it — task-decision stamp throws',
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
      taskDecisionIssueId: '11111111-2222-3333-4444-555555555555',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
  });

  test('stamp returning null (no matching row) does not fail the comment response', async () => {
    const { provider } = makeFakeProvider();
    const { store } = makeFakeTaskDecisionsStore({ markOutcome: () => null });
    const app = buildApp({ provider, taskDecisionsStore: store });

    const { status, body } = await postComment(app, ISSUE_ID, {
      body: 'ship it — task-decision stamp returns null',
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
      taskDecisionIssueId: '11111111-2222-3333-4444-555555555555',
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
  });

  test('a deduped resubmission does not re-stamp', async () => {
    const { provider } = makeFakeProvider();
    const { store, calls } = makeFakeTaskDecisionsStore();
    const app = buildApp({ provider, taskDecisionsStore: store });

    const payload = {
      body: 'the same text — task-decision stamp dedupe',
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
      taskDecisionIssueId: '11111111-2222-3333-4444-555555555555',
    };
    const first = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(first.status, 201);
    assert.strictEqual(calls.markOutcome.length, 1);

    const second = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true);
    assert.strictEqual(calls.markOutcome.length, 1, 'no second stamp on a deduped resubmission');
  });

  // LIN-2208, task-decision sibling of the loop-decision case above.
  test('LIN-2208: a failed stamp is retried on an identical-text dedupe resubmission, and a further identical retry does not double-stamp once it succeeds', async () => {
    const { provider } = makeFakeProvider();
    let attempt = 0;
    const { store, calls } = makeFakeTaskDecisionsStore({
      markOutcome: ({ id, urlKey, issueId, outcome }) => {
        attempt += 1;
        return attempt === 1 ? null : { id, urlKey, issueId, outcome, outcomeAt: new Date().toISOString() };
      },
    });
    const app = buildApp({ provider, taskDecisionsStore: store });

    const payload = {
      body: 'the same text — task-decision stamp retry',
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
      taskDecisionIssueId: '11111111-2222-3333-4444-555555555555',
    };
    const first = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(first.status, 201);
    assert.strictEqual(calls.markOutcome.length, 1, 'first attempt fails (no matching row yet)');

    const second = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true, 'the comment write is still deduped — no second comment');
    assert.strictEqual(calls.markOutcome.length, 2, 'the retry reached the stamp block and re-attempted');

    const third = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(third.status, 200);
    assert.strictEqual(calls.markOutcome.length, 2, 'no further stamp once one has already succeeded');
  });
});

// =============================================================================
// LIN-2664 F2: dedupe-hit harbour-comments ledger repair on this seam
// (routes/workspace-api.js POST /workspace/:urlKey/api/comments/:issueId).
// =============================================================================
describe('POST /workspace/:urlKey/api/comments/:issueId — harbour-comments ledger repair (LIN-2664 F2)', () => {
  test('a dedupe-hit repairs the ledger after the original create\'s record() failed', async () => {
    const { provider, calls } = makeFakeProvider();
    const harbourCommentsStore = makeFlakyHarbourCommentsStore();
    const app = buildApp({ provider, harbourCommentsStore });

    const payload = { body: 'the same text — ledger repair' };
    const first = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(first.status, 201);
    assert.strictEqual(harbourCommentsStore.calls.length, 1, 'the original create attempted (and failed) its ledger record');

    const second = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true, 'still served from the dedupe cache — no second comment minted');
    assert.strictEqual(calls.createComment.length, 1, 'no second provider write on the dedupe hit');
    assert.strictEqual(harbourCommentsStore.calls.length, 2, 'the dedupe hit re-attempted the ledger record');
    assert.strictEqual(
      harbourCommentsStore.calls[1].commentId,
      first.body.comment.id,
      'the repair attempt targets the SAME comment id the original create minted'
    );
  });
});

// =============================================================================
// LIN-2755 beat 2: ruling-write cache invalidation (RED until beat 3).
// =============================================================================
//
// This route's stamp block (`stampDecisionAnswers`, routes/workspace-api.js)
// is TWO of the ticket's 11 write sites in one request:
//   - the loop half (`markDecisionAnswered`, workspace-api.js:262) — writes
//     into data the sessions-feed cache actually holds (mergeLoops
//     reconstructs from dispatchQueueStore), so it gets BOTH the
//     invalidation+bound witness AND the stronger stale-row witness (2),
//     same as dashboard.js's dismiss route.
//   - the task-decision half (`markOutcome`, workspace-api.js:275) — writes
//     to taskDecisionsStore, read LIVE on every rulings poll (per beat 1's
//     sweep), so invalidation+bound only.
//
// Beat 1's sweep also found that `createWorkspaceApiRoutes` does not yet
// accept `sessionsFeedCache` at all — mounting THIS route's app and
// `createDashboardRoutes`'s rulings GET side by side, sharing one real cache
// instance and one real dispatchQueueStore, is what makes that gap
// observable: today the shared cache is warmed by the GET side and never
// invalidated by a write through this route, because nothing here even
// receives it yet.
describe('POST /workspace/:urlKey/api/comments/:issueId — ruling-write cache invalidation (LIN-2755)', () => {
  const CACHE_URL_KEY = 'acme';
  const CACHE_DECISION_ID = 'd-cache-1';

  // A single loop, `listHistory`-backed, that starts decision-bearing and
  // flips to answered once `markDecisionAnswered` is called — same technique
  // as the equivalent WITNESS 2 test in tests/unit/dashboard-routes.test.js.
  function makeSharedLoopStore() {
    let discharged = false;
    let historyReads = 0;
    return {
      historyReads: () => historyReads,
      dispatchQueueStore: {
        async listItems() { return []; },
        async listHistory() {
          historyReads++;
          const nowIso = new Date().toISOString();
          const feedback = [
            { message: '[blocked] need a decision', timestamp: nowIso },
            { kind: 'decision', message: JSON.stringify({ decision_id: CACHE_DECISION_ID, question: 'Proceed?' }), timestamp: nowIso },
          ];
          if (discharged) feedback.push({ kind: 'decision-answer', message: JSON.stringify({ decision_id: CACHE_DECISION_ID }), timestamp: nowIso });
          return {
            items: [{
              id: 'loop-1', issueIdentifier: 'LIN-99', issueTitle: 'Title LIN-99', promptName: 'implementation',
              prompt: 'p', dispatchedAt: nowIso, resolvedAt: nowIso, status: 'taken', feedback,
            }],
          };
        },
        async markDecisionAnswered() { discharged = true; return { success: true, feedbackCount: 3 }; },
      },
    };
  }

  function makeSharedTaskDecisionsStore() {
    const calls = [];
    return {
      calls,
      async listUnansweredForWorkspaces() { return []; }, // this half's write is exercised in isolation below
      async listNewestScanPerTask() { return {}; },
      async markOutcome(args) { calls.push(args); return { ...args, outcomeAt: new Date().toISOString() }; },
    };
  }

  // Mounts the SAME workspace-api app `buildApp` builds, plus a
  // dashboard.js router sharing the same dispatchQueueStore/taskDecisionsStore
  // and ONE real sessionsFeedCache instance — mirroring how server.js wires a
  // single process-wide cache into both route factories.
  function buildCrossRouterApp({ dispatchQueueStore, taskDecisionsStore, sessionsFeedCache }) {
    const { provider } = makeFakeProvider();
    const app = buildApp({ provider, dispatchQueueStore, taskDecisionsStore, sessionsFeedCache });

    const dashboardRouter = createDashboardRoutes({
      workspaceFromUrl: (req, res, next) => next(),
      dispatchQueueStore: dispatchQueueStore || {},
      agentStatusStore: { async listStatus() { return { items: [] }; } },
      runSummaryCacheStore: new InMemoryRunSummaryCacheStore(),
      freeTierStore: { async tryUse() { return { allowed: true }; } },
      getWorkspaceAccessToken: async () => 'token',
      fetchIssueContext: async () => ({}),
      getOpenRouterSource: () => 'env',
      getDeployInfo: () => ({}),
      sessionsFeedCache,
      taskDecisionsStore,
    });
    // A tiny dedicated mount that seeds req.session.workspaces the way real
    // session auth would — dashboard.js's rulings route reads it directly.
    app.use((req, res, next) => {
      req.session = req.session || {};
      req.session.workspaces = [{ urlKey: CACHE_URL_KEY, name: 'Acme' }];
      next();
    }, dashboardRouter);

    return app;
  }

  async function getRulings(app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/workspace/${CACHE_URL_KEY}/api/dashboard/rulings`);
      return await res.json();
    } finally {
      await new Promise(r => server.close(r));
    }
  }

  test('the loop half (markDecisionAnswered, workspace-api.js:262) invalidates the rulings cache — witness 1+3', async () => {
    const { dispatchQueueStore, historyReads } = makeSharedLoopStore();
    const app = buildCrossRouterApp({ dispatchQueueStore, sessionsFeedCache: createSessionsFeedCache() });

    const warm = await getRulings(app);
    assert.equal(warm.count, 1, 'sanity: the ruling is visible before any write');
    assert.equal(historyReads(), 1, 'sanity: the first poll always reconstructs');

    const stillWarm = await getRulings(app);
    assert.equal(stillWarm.count, 1);
    assert.equal(historyReads(), 1, 'sanity: a second poll within the 5s TTL is still served from cache');

    const write = await postComment(app, ISSUE_ID, {
      body: 'ship it — cache invalidation loop half', decisionLoopId: 'loop-1', decisionId: CACHE_DECISION_ID,
    }, CACHE_URL_KEY);
    assert.strictEqual(write.status, 201);

    const afterWrite = await getRulings(app);
    assert.equal(historyReads(), 2,
      'THE RED: the next poll after a successful stamp must reconstruct — only true if the write invalidated the cache');

    const afterWriteAgain = await getRulings(app);
    assert.equal(historyReads(), 2, 'bound (LIN-2227): one write costs at most one reconstruction, not two');
  });

  test('WITNESS 2 (stale-row, loop-backed): the loop half actually excludes the discharged row on the next poll', async () => {
    const { dispatchQueueStore, historyReads } = makeSharedLoopStore();
    const app = buildCrossRouterApp({ dispatchQueueStore, sessionsFeedCache: createSessionsFeedCache() });

    const before = await getRulings(app);
    assert.equal(before.count, 1, 'the ruling is present before the stamp');

    const write = await postComment(app, ISSUE_ID, {
      body: 'ship it — cache invalidation stale row', decisionLoopId: 'loop-1', decisionId: CACHE_DECISION_ID,
    }, CACHE_URL_KEY);
    assert.strictEqual(write.status, 201);

    const after = await getRulings(app);
    assert.equal(after.count, 0,
      'THE RED: the discharged row must actually be gone on the next poll, without waiting out the 5s TTL');
    assert.equal(historyReads(), 2, 'the row only disappeared because the cache was invalidated and re-read');
  });

  test('the task-decision half (markOutcome, workspace-api.js:275) invalidates the rulings cache — witness 1+3', async () => {
    // No loop-backed rows at all — isolates this half from the loop half above.
    let historyReads = 0;
    const dispatchQueueStore = {
      async listItems() { return []; },
      async listHistory() { historyReads++; return { items: [] }; },
    };
    const taskDecisionsStore = makeSharedTaskDecisionsStore();
    const app = buildCrossRouterApp({ dispatchQueueStore, taskDecisionsStore, sessionsFeedCache: createSessionsFeedCache() });

    const warm = await getRulings(app);
    assert.equal(warm.count, 0);
    assert.equal(historyReads, 1, 'sanity: the first poll always reconstructs');

    const stillWarm = await getRulings(app);
    assert.equal(historyReads, 1, 'sanity: a second poll within the 5s TTL is still served from cache');

    const write = await postComment(app, ISSUE_ID, {
      body: 'ship it — cache invalidation task-decision half',
      taskDecisionId: 'scan_11111111_aaaaaaaaaaaa',
      taskDecisionIssueId: '11111111-2222-3333-4444-555555555555',
    }, CACHE_URL_KEY);
    assert.strictEqual(write.status, 201);
    assert.strictEqual(taskDecisionsStore.calls.length, 1, 'sanity: the write actually reached markOutcome');

    const afterWrite = await getRulings(app);
    assert.equal(historyReads, 2,
      'THE RED: the next poll after a successful stamp must reconstruct — only true if the write invalidated the cache');

    const afterWriteAgain = await getRulings(app);
    assert.equal(historyReads, 2, 'bound (LIN-2227): one write costs at most one reconstruction, not two');
  });
});

// =============================================================================
// LIN-2933: session-lane one-shot auth-recovery, wired into this route's
// catch. Approved plan (revision 3, comment `13cc8aaf`), folding in R1
// (error boundary), R2 (production wiring pin) and R3 (provider attribution)
// from the second plan-review verdict (comment `d3075231`).
// =============================================================================
describe('POST /workspace/:urlKey/api/comments/:issueId — session-lane auth recovery (LIN-2933)', () => {
  const REJECTED_TOKEN = 'session-token-dead';
  const FRESH_TOKEN = 'durable-token-fresh';

  test('(a) a different durable credential exists → adopt, mirror, retry once, 201', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 recovery success' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.deepStrictEqual(calls.issueWriteGuard, [REJECTED_TOKEN, FRESH_TOKEN], 'guard runs on the original attempt and again on the retry');
    assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, FRESH_TOKEN], 'create runs on the original attempt and again on the retry');
    assert.strictEqual(storeCalls.length, 1, 'exactly one durable point-read');
  });

  // LIN-2933 close-out ledger L2 (review `b1ab28d5`): a RECOVERED retry must
  // run the SAME shared success tail (`finishCommentSuccess`) the original
  // attempt would have — dedupe write, ledger record, and decision/task
  // stamp — exactly once, keyed on the retry's own comment id. Mutation M10
  // (the retry returning 201 directly, bypassing the tail) survives every
  // other case in this file without this one.
  test('(a2) L2: a recovered retry runs the shared success tail exactly once — ledger record (retry\'s comment id), one stamp, and dedupe on an identical re-press with no third createComment', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const { store: dispatchQueueStore, calls: stampCalls } = makeFakeDispatchQueueStore();
    const harbourCommentsStore = makeSpyHarbourCommentsStore();
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      dispatchQueueStore, harbourCommentsStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });
    const payload = { body: 'LIN-2933 L2 recovered success tail', decisionLoopId: 'loop-l2', decisionId: 'd-l2' };

    const first = await postComment(app, ISSUE_ID, payload);

    assert.strictEqual(first.status, 201);
    assert.strictEqual(first.body.success, true);
    assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, FRESH_TOKEN], 'the original attempt fails; the recovered retry is what actually creates the comment');
    const retryCommentId = first.body.comment.id;

    assert.strictEqual(harbourCommentsStore.calls.length, 1, 'exactly one ledger record for the recovered write');
    assert.strictEqual(harbourCommentsStore.calls[0].commentId, retryCommentId, 'the ledger record must carry the RETRY\'s comment id, never a stale/absent original-attempt id');

    assert.strictEqual(stampCalls.markDecisionAnswered.length, 1, 'exactly one decision stamp for the recovered write');
    assert.deepStrictEqual(stampCalls.markDecisionAnswered[0], { itemId: 'loop-l2', urlKey: 'acme', decisionId: 'd-l2' });

    // An identical resubmission must hit the dedupe cache the recovered
    // retry just populated — 200/deduped:true, no third provider write, and
    // no second recovery attempt (no second durable point-read either).
    const second = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true);
    assert.strictEqual(second.body.comment.id, retryCommentId);
    assert.strictEqual(calls.createComment.length, 2, 'the identical resubmission must not mint a third comment');
    assert.strictEqual(storeCalls.length, 1, 'the dedupe hit must not attempt a second durable-credential read');
    assert.strictEqual(stampCalls.markDecisionAnswered.length, 1, 'a deduped resubmission must not re-stamp — the recovered write already stamped it');
  });

  test('(b) the durable store holds the SAME dead credential → no recovery, classified 500, retryable:false', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: REJECTED_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 persistent auth failure' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.error, 'Failed to create comment');
    assert.strictEqual(body.code, 'LINEAR_AUTH');
    assert.strictEqual(body.category, 'auth');
    assert.strictEqual(body.retryable, false, 'a final auth failure must never read as retryable — the client must not auto-resend it');
    assert.match(body.detail, /Linear/);
    assert.ok(!('message' in body), 'the raw upstream err.message must never be exposed');
    assert.strictEqual(calls.issueWriteGuard.length, 1);
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 1, 'adopt was attempted — it just found nothing different');
  });

  test('(c) a `?source=` query param excludes recovery even when a different durable credential exists', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await call(app, 'POST', `/workspace/acme/api/comments/${ISSUE_ID}?source=linear`, { body: 'LIN-2933 source exclusion' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.code, 'LINEAR_AUTH');
    assert.strictEqual(calls.issueWriteGuard.length, 1);
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 0, 'a `?source`-bound request never attempts recovery, regardless of what the durable store holds');
  });

  test('(d) the durable store holds a DIFFERENT credential that is ALSO rejected → one-shot recovery, classified 500, store.get called exactly once', async () => {
    const ALSO_DEAD_TOKEN = 'durable-token-also-dead';
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN, ALSO_DEAD_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: ALSO_DEAD_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 different-but-still-rejected' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.code, 'LINEAR_AUTH');
    assert.strictEqual(body.retryable, false);
    assert.deepStrictEqual(calls.issueWriteGuard, [REJECTED_TOKEN, ALSO_DEAD_TOKEN]);
    assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, ALSO_DEAD_TOKEN]);
    assert.strictEqual(storeCalls.length, 1, 'a second rejection must not trigger a second adopt attempt — one-shot is structural, not counted on the retry');
  });

  test('(e) a failing session.save aborts the retry → classified 500, not a hang; guard/create called once (original only)', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider,
      session: makeRecoverySession({ saveError: new Error('session store down') }),
      ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 failed session save' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.error, 'Failed to create comment');
    // Not necessarily LINEAR_AUTH — a session-store failure is not an
    // upstream-auth shape. classifyUpstreamError's INTERNAL_ERROR/internal/
    // retryable:false fallback is expected and acceptable here (plan-review
    // case (e)); the load-bearing assertion is that a response is sent at
    // all, never a hang.
    assert.strictEqual(body.category, 'internal');
    assert.strictEqual(body.retryable, false);
    assert.strictEqual(calls.issueWriteGuard.length, 1, 'the retry never runs — the save that must precede it failed');
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 1);
  });

  test("(f) a non-Linear provider's 401 names its own provider, never Linear, and recovery is skipped", async () => {
    const JIRA_TOKEN = 'jira-token-dead';
    const { provider, calls } = makeCredentialKeyedProvider({ name: 'comment-write-fake-jira', displayName: 'Jira', rejectedTokens: [JIRA_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: 'jira-token-fresh', tokenExpiresAt: Date.now() + 3600_000, provider: 'comment-write-fake-jira',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'comment-write-fake-jira', accessToken: JIRA_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 non-Linear provider attribution' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.code, 'LINEAR_AUTH', 'the code vocabulary is provider-agnostic by design — only the human string varies');
    assert.match(body.detail, /Jira/);
    assert.doesNotMatch(body.detail, /Linear/);
    assert.strictEqual(calls.issueWriteGuard.length, 1);
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 0, 'recovery is gated to provider.name === "linear" — never attempted for a non-Linear provider');
  });

  // Plan-review implementation note 4 (not blocking, folded in anyway): a
  // retried guard that reports the issue trashed gets the same 409 the main
  // path gives, not a classified 500.
  test('a retry whose guard reports the issue trashed gets the same 409 as the main path', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    provider.issueWriteGuard = async (token) => {
      calls.issueWriteGuard.push(token);
      return { id: 'iss-1', trashed: true, team: { id: 'team-x' } };
    };
    const { store: ownerCredentialStore } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    // The original attempt's guard reports trashed too — a direct 409, no
    // provider auth rejection, so recovery is never even reached. Route the
    // ORIGINAL attempt's failure through createComment instead, so recovery
    // is entered, and only the RETRY's guard reports trashed.
    let guardCalls = 0;
    provider.issueWriteGuard = async (token) => {
      guardCalls += 1;
      calls.issueWriteGuard.push(token);
      return guardCalls === 1
        ? { id: 'iss-1', trashed: false, team: { id: 'team-x' } }
        : { id: 'iss-1', trashed: true, team: { id: 'team-x' } };
    };

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 retried guard trashed' });

    assert.strictEqual(status, 409);
    assert.match(body.error, /trashed/i);
    assert.strictEqual(guardCalls, 2);
    assert.strictEqual(calls.createComment.length, 1, 'the retry never reaches createComment — the retried guard already terminated it');
  });
});

describe('server.js production wiring pin (LIN-2933, plan-review R2)', () => {
  const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

  test('server.js must wire ownerCredentialStore into createWorkspaceApiRoutes — otherwise recovery ships fully tested and permanently inert in production', () => {
    assert.match(
      SERVER_SRC,
      /app\.use\(createWorkspaceApiRoutes\(\{[^}]*\bownerCredentialStore\b[^}]*\}\)\)/,
      'server.js must wire ownerCredentialStore into createWorkspaceApiRoutes'
    );
  });
});
