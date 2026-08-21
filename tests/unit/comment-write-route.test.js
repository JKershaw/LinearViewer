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

function buildApp({ provider, session } = {}) {
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
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
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
