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
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';

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

function buildApp({ provider, session, dispatchQueueStore, taskDecisionsStore, harbourCommentsStore } = {}) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());

  const workspaceRouter = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token' };
      req.session = session || { accountId: 'acct-1' };
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: dispatchQueueStore || {}, agentStatusStore: {}, promptTraceStore: {},
    taskDecisionsStore,
    harbourCommentsStore,
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
