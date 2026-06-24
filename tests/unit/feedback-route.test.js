// =============================================================================
// POST /workspace/:urlKey/api/feedback — widget submit flow (LIN-635)
// =============================================================================
//
// Drives the feedback-submit route end to end against a fake provider + capturing
// dispatch store, asserting the LIN-635 behaviour layered on the LIN-636 route:
//   - priority is forwarded (clamped to Linear's 0-4)
//   - page URL + browser are captured into the ticket body
//   - the team is resolved server-side when the body omits teamId
//   - a triage follow-up is enqueued on the existing dispatch substrate
//   - capability gates still return a clean 422 (never 500)
//   - a failed triage enqueue does not fail the submission

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';

const PROVIDER_NAME = 'feedback-fake';

// A controllable fake provider registered under a dedicated name; the route
// resolves it via getProviderForWorkspace(workspace) when workspace.provider
// matches. Per-test overrides tune capabilities and capture calls.
function makeFakeProvider(overrides = {}) {
  const calls = { createIssue: [], uploadFile: [], fetchTeams: 0 };
  const caps = overrides.caps || { createIssue: true, uploadFile: true, fetchTeams: true };
  const provider = {
    name: PROVIDER_NAME,
    supports: (cap) => caps[cap] === true,
    async fetchTeams() {
      calls.fetchTeams++;
      return overrides.teams ?? [{ id: 'team-default', name: 'Default' }];
    },
    async uploadFile(token, bytes, meta) {
      calls.uploadFile.push({ bytes, meta });
      return overrides.assetUrl ?? 'https://cdn.example/shot.png';
    },
    async createIssue(token, input) {
      calls.createIssue.push(input);
      if (overrides.createIssue) return overrides.createIssue(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'LIN-900', title: input.title, url: 'https://lin/LIN-900', state: { name: 'Todo', type: 'unstarted' } } };
    }
  };
  return { provider, calls };
}

function buildApp({ provider, dispatchQueueStore, token = 'ws-token' }) {
  registerProvider(provider);
  const app = express();
  // Mirror the production global JSON parser (250kb, application/json only) so
  // the route's own permissive parser is what handles our text/plain bodies.
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: token };
      req.session = { linearUserId: 'user-1' };
      next();
    },
    dispatchQueueStore,
    // Unused by the feedback route but part of the factory signature.
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {},
    briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {}
  });
  app.use(router);
  return app;
}

async function submit(app, urlKey, payload, { contentType = 'text/plain' } = {}) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/${urlKey}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: JSON.stringify(payload)
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

function capturingDispatchStore() {
  const items = [];
  return { items, addItem: async (urlKey, item) => { items.push({ urlKey, item }); return { _id: 'd1', ...item }; } };
}

describe('feedback submit (LIN-635)', () => {
  let savedTeamEnv;
  beforeEach(() => { savedTeamEnv = process.env.FEEDBACK_TEAM_ID; delete process.env.FEEDBACK_TEAM_ID; });
  afterEach(() => { if (savedTeamEnv === undefined) delete process.env.FEEDBACK_TEAM_ID; else process.env.FEEDBACK_TEAM_ID = savedTeamEnv; });

  test('files a ticket with priority + captured URL/UA and enqueues triage', async () => {
    const { provider, calls } = makeFakeProvider();
    const dispatch = capturingDispatchStore();
    const app = buildApp({ provider, dispatchQueueStore: dispatch });

    const { status, body } = await submit(app, 'acme', {
      message: 'The swipe view jumps on mobile',
      priority: 2,
      url: 'https://app/workspace/acme/swipe',
      userAgent: 'Mozilla/5.0 (iPhone)'
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.issue.identifier, 'LIN-900');

    // createIssue got the resolved team, priority, and a body carrying URL + UA.
    assert.strictEqual(calls.createIssue.length, 1);
    const input = calls.createIssue[0];
    assert.strictEqual(input.teamId, 'team-default'); // resolved server-side
    assert.strictEqual(input.priority, 2);
    assert.match(input.description, /The swipe view jumps on mobile/);
    assert.match(input.description, /\/workspace\/acme\/swipe/);
    assert.match(input.description, /iPhone/);
    assert.strictEqual(calls.fetchTeams, 1);

    // Triage follow-up enqueued on the dispatch substrate.
    assert.strictEqual(dispatch.items.length, 1);
    assert.strictEqual(dispatch.items[0].urlKey, 'acme');
    assert.strictEqual(dispatch.items[0].item.kind, 'triage');
    assert.strictEqual(dispatch.items[0].item.issueIdentifier, 'LIN-900');
    assert.match(dispatch.items[0].item.prompt, /Triage/);
  });

  test('clamps an out-of-range priority to 0', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider, dispatchQueueStore: capturingDispatchStore() });
    const { status } = await submit(app, 'acme', { message: 'x', priority: 99 });
    assert.strictEqual(status, 201);
    assert.strictEqual(calls.createIssue[0].priority, 0);
  });

  test('uploads an embedded screenshot and embeds its URL', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider, dispatchQueueStore: capturingDispatchStore() });
    const png = Buffer.from('imgbytes').toString('base64');
    const { status } = await submit(app, 'acme', { message: 'see shot', image: `data:image/png;base64,${png}` });
    assert.strictEqual(status, 201);
    assert.strictEqual(calls.uploadFile.length, 1);
    assert.match(calls.createIssue[0].description, /!\[\]\(https:\/\/cdn\.example\/shot\.png\)/);
  });

  test('rejects a missing message with 400', async () => {
    const { provider } = makeFakeProvider();
    const app = buildApp({ provider, dispatchQueueStore: capturingDispatchStore() });
    const { status } = await submit(app, 'acme', { message: '  ' });
    assert.strictEqual(status, 400);
  });

  test('returns 422 when the provider cannot create tickets', async () => {
    const { provider } = makeFakeProvider({ caps: { createIssue: false, uploadFile: false, fetchTeams: true } });
    const app = buildApp({ provider, dispatchQueueStore: capturingDispatchStore() });
    const { status, body } = await submit(app, 'acme', { message: 'hi' });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.code, 'CAPABILITY_NOT_SUPPORTED');
  });

  test('returns 422 with an image when the provider cannot upload', async () => {
    const { provider } = makeFakeProvider({ caps: { createIssue: true, uploadFile: false, fetchTeams: true } });
    const app = buildApp({ provider, dispatchQueueStore: capturingDispatchStore() });
    const png = Buffer.from('x').toString('base64');
    const { status, body } = await submit(app, 'acme', { message: 'hi', image: `data:image/png;base64,${png}` });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.capability, 'uploadFile');
  });

  test('returns 422 when no team can be resolved', async () => {
    const { provider } = makeFakeProvider({ teams: [] });
    const app = buildApp({ provider, dispatchQueueStore: capturingDispatchStore() });
    const { status, body } = await submit(app, 'acme', { message: 'hi' });
    assert.strictEqual(status, 422);
    assert.strictEqual(body.code, 'TEAM_UNRESOLVED');
  });

  test('still succeeds when the triage enqueue throws (best-effort)', async () => {
    const { provider } = makeFakeProvider();
    const failingDispatch = { addItem: async () => { throw new Error('queue down'); } };
    const app = buildApp({ provider, dispatchQueueStore: failingDispatch });
    const { status, body } = await submit(app, 'acme', { message: 'hi' });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
  });
});
