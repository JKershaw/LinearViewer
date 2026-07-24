// =============================================================================
// Session-auth issue write routes (LIN-1552 / LIN-1504 Session A)
//   POST  /workspace/:urlKey/api/issues
//   PATCH /workspace/:urlKey/api/issues/:issueId
// =============================================================================
//
// Drives both routes end-to-end against a fake provider (mirroring the harness in
// tests/unit/feedback-route.test.js), asserting the spec:
//   - 201 create happy path → { success, issue }, createdBy stamped from accountId
//   - 200 update happy path → { success, issue } (full-body description PATCH)
//   - 400 validation (over-length title, control-char description, bad priority)
//   - 422 CAPABILITY_NOT_SUPPORTED when supports(...) is false (never 500)
//   - 409 when the update target is a trashed issue (before any provider write)
//   - 502 when the provider write returns !success

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const PROVIDER_NAME = 'issue-write-fake';
const TEAM_UUID = '00000000-0000-0000-0000-0000000000aa';
const ISSUE_ID = 'LIN-900';

// A controllable fake provider registered under a dedicated name; the route
// resolves it via getProviderForWorkspace(workspace) when workspace.provider
// matches. Per-test overrides tune capabilities, the write result, and the
// write-guard (trashed) read.
function makeFakeProvider(overrides = {}) {
  const calls = { createIssue: [], updateIssue: [], issueWriteGuard: [] };
  const caps = overrides.caps || { createIssue: true, updateIssue: true };
  const provider = {
    name: PROVIDER_NAME,
    supports: (cap) => caps[cap] === true,
    async createIssue(token, input) {
      calls.createIssue.push(input);
      if (overrides.createIssue) return overrides.createIssue(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'LIN-900', title: input.title, description: input.description ?? null } };
    },
    async updateIssue(token, issueId, input) {
      calls.updateIssue.push({ issueId, input });
      if (overrides.updateIssue) return overrides.updateIssue(issueId, input);
      return { success: true, issue: { id: 'iss-1', identifier: issueId, ...input } };
    },
    async issueWriteGuard(token, issueId) {
      calls.issueWriteGuard.push(issueId);
      if (overrides.issueWriteGuard) return overrides.issueWriteGuard(issueId);
      return { id: 'iss-1', trashed: false, team: { id: 'team-x' } };
    },
  };
  return { provider, calls };
}

function buildApp({ provider, session } = {}) {
  registerProvider(provider);
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token' };
      // Session carries BOTH ids so the createdBy test proves accountId wins.
      req.session = session || { accountId: 'acct-1', linearUserId: 'user-1' };
      next();
    },
    // Factory signature — none used by the issue write routes.
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
  });
  app.use(router);
  return app;
}

async function call(app, method, path, payload) {
  const server = app.listen(0);
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

const postIssue = (app, payload, urlKey = 'acme') => call(app, 'POST', `/workspace/${urlKey}/api/issues`, payload);
const patchIssue = (app, issueId, payload, urlKey = 'acme') => call(app, 'PATCH', `/workspace/${urlKey}/api/issues/${issueId}`, payload);

// ---------------------------------------------------------------------------
// POST /workspace/:urlKey/api/issues
// ---------------------------------------------------------------------------
describe('POST /workspace/:urlKey/api/issues (create)', () => {
  test('201 happy path → { success, issue }; createdBy stamped from accountId, not linearUserId', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status, body } = await postIssue(app, { teamId: TEAM_UUID, title: 'Add a widget', description: 'body', priority: 2 });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.issue.identifier, 'LIN-900');
    assert.strictEqual(calls.createIssue.length, 1);
    const input = calls.createIssue[0];
    assert.strictEqual(input.title, 'Add a widget');
    assert.strictEqual(input.description, 'body');
    assert.strictEqual(input.priority, 2);
    assert.strictEqual(input.teamId, TEAM_UUID);
    // The load-bearing assertion: createdBy comes from session.accountId.
    assert.strictEqual(input.createdBy, 'acct-1');
    assert.notStrictEqual(input.createdBy, 'user-1'); // NOT linearUserId
  });

  test('400 when teamId is missing', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { title: 'no team' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /teamId/i);
  });

  test('400 when title is missing', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID });
    assert.strictEqual(status, 400);
    assert.match(body.error, /title is required/i);
  });

  test('400 over-length title', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'x'.repeat(1001) });
    assert.strictEqual(status, 400);
    assert.match(body.error, /title exceeds maximum length/i);
  });

  test('400 control-char in description', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok', description: 'bad\x00body' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /description contains invalid characters/i);
  });

  test('400 out-of-range priority (driven through the shared validator)', async () => {
    const { provider, calls } = makeFakeProvider();
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok', priority: 9 });
    assert.strictEqual(status, 400);
    assert.match(body.error, /priority must be an integer between 0 and 4/i);
    assert.strictEqual(calls.createIssue.length, 0); // rejected before the provider write
  });

  test('422 CAPABILITY_NOT_SUPPORTED when supports(createIssue) is false — never 500', async () => {
    const { provider } = makeFakeProvider({ caps: { createIssue: false, updateIssue: true } });
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok' });
    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(body.capability, 'createIssue');
    assert.strictEqual(body.provider, PROVIDER_NAME);
  });

  test('502 when the provider write returns !success', async () => {
    const { provider } = makeFakeProvider({ createIssue: () => ({ success: false }) });
    const { status, body } = await postIssue(buildApp({ provider }), { teamId: TEAM_UUID, title: 'ok' });
    assert.strictEqual(status, 502);
    assert.match(body.error, /not created/i);
  });
});

// ---------------------------------------------------------------------------
// PATCH /workspace/:urlKey/api/issues/:issueId
// ---------------------------------------------------------------------------
describe('PATCH /workspace/:urlKey/api/issues/:issueId (update)', () => {
  test('200 happy path → { success, issue }; full-body description PATCH is forwarded', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status, body } = await patchIssue(app, ISSUE_ID, { title: 'renamed', description: 'REPLACED body', priority: 1 });

    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(calls.updateIssue.length, 1);
    const { issueId, input } = calls.updateIssue[0];
    assert.strictEqual(issueId, ISSUE_ID);
    assert.strictEqual(input.title, 'renamed');
    assert.strictEqual(input.description, 'REPLACED body'); // full replace, not append
    assert.strictEqual(input.priority, 1);
  });

  test('400 empty body (no valid fields) — no provider read', async () => {
    const { provider, calls } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, {});
    assert.strictEqual(status, 400);
    assert.match(body.error, /no valid fields/i);
    assert.strictEqual(calls.issueWriteGuard.length, 0);
  });

  test('400 over-length title', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x'.repeat(1001) });
    assert.strictEqual(status, 400);
    assert.match(body.error, /title exceeds maximum length/i);
  });

  test('400 control-char in description', async () => {
    const { provider } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { description: 'bad\x1Fbody' });
    assert.strictEqual(status, 400);
    assert.match(body.error, /description contains invalid characters/i);
  });

  test('400 out-of-range priority', async () => {
    const { provider, calls } = makeFakeProvider();
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { priority: -1 });
    assert.strictEqual(status, 400);
    assert.match(body.error, /priority must be an integer between 0 and 4/i);
    assert.strictEqual(calls.updateIssue.length, 0);
  });

  test('422 CAPABILITY_NOT_SUPPORTED when supports(updateIssue) is false — never 500', async () => {
    const { provider } = makeFakeProvider({ caps: { createIssue: true, updateIssue: false } });
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });
    assert.strictEqual(status, 422);
    assert.notStrictEqual(status, 500);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.strictEqual(body.capability, 'updateIssue');
    assert.strictEqual(body.provider, PROVIDER_NAME);
  });

  test('409 when the update target is trashed — rejected BEFORE any provider write', async () => {
    const { provider, calls } = makeFakeProvider({ issueWriteGuard: () => ({ id: 'iss-1', trashed: true }) });
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });
    assert.strictEqual(status, 409);
    assert.match(body.error, /trashed/i);
    assert.strictEqual(calls.updateIssue.length, 0); // no write happened
  });

  test('502 when the provider write returns !success', async () => {
    const { provider } = makeFakeProvider({ updateIssue: () => ({ success: false }) });
    const { status, body } = await patchIssue(buildApp({ provider }), ISSUE_ID, { title: 'x' });
    assert.strictEqual(status, 502);
    assert.match(body.error, /not updated/i);
  });
});
