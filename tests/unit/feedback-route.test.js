// =============================================================================
// POST /workspace/:urlKey/api/feedback — widget submit flow (LIN-635)
// =============================================================================
//
// Drives the feedback-submit route end to end against a fake provider + capturing
// dispatch store, asserting the LIN-635 behaviour layered on the LIN-636 route:
//   - priority is forwarded (clamped to Linear's 0-4)
//   - page URL + browser are captured into the ticket body
//   - the team is resolved server-side when the body omits teamId
//   - a triage follow-up is OPT-IN (default off, LIN-733): not enqueued unless
//     the per-user `feedbackTriage` flag is on
//   - when triage is on, the prompt carries the workspace API proxy details
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

// A fake proxy token store that mints a fixed readWrite token, so the enabled
// triage path can assert the proxy block is appended (LIN-733).
function fakeProxyTokenStore(token = 'minted-rw-token') {
  const calls = [];
  return {
    calls,
    async createToken(urlKey, options) { calls.push({ urlKey, options }); return { token, scope: options?.scope }; }
  };
}

function buildApp({ provider, dispatchQueueStore, token = 'ws-token', features = {}, proxyTokenStore } = {}) {
  registerProvider(provider);
  const app = express();
  // Mirror the production global JSON parser (250kb, application/json only) so
  // the route's own permissive parser is what handles our text/plain bodies.
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: token };
      req.session = { linearUserId: 'user-1', features };
      next();
    },
    dispatchQueueStore,
    proxyTokenStore,
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

  test('files a ticket with priority + captured URL/UA, no triage by default (LIN-733)', async () => {
    const { provider, calls } = makeFakeProvider();
    const dispatch = capturingDispatchStore();
    // No features → feedbackTriage defaults off.
    const app = buildApp({ provider, dispatchQueueStore: dispatch, proxyTokenStore: fakeProxyTokenStore() });

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

    // Triage is OPT-IN — with the flag off, nothing is enqueued.
    assert.strictEqual(dispatch.items.length, 0);
  });

  test('enqueues triage with proxy details when feedbackTriage is on (LIN-733)', async () => {
    const { provider } = makeFakeProvider();
    const dispatch = capturingDispatchStore();
    const proxyTokenStore = fakeProxyTokenStore('rw-tok-123');
    const app = buildApp({
      provider, dispatchQueueStore: dispatch, proxyTokenStore,
      features: { feedbackTriage: true }
    });

    const { status, body } = await submit(app, 'acme', { message: 'Something is broken', priority: 2 });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);

    // Triage follow-up enqueued on the dispatch substrate.
    assert.strictEqual(dispatch.items.length, 1);
    assert.strictEqual(dispatch.items[0].urlKey, 'acme');
    assert.strictEqual(dispatch.items[0].item.kind, 'triage');
    assert.strictEqual(dispatch.items[0].item.issueIdentifier, 'LIN-900');
    const prompt = dispatch.items[0].item.prompt;
    assert.match(prompt, /Triage/);

    // A readWrite token was minted for this dispatch...
    assert.strictEqual(proxyTokenStore.calls.length, 1);
    assert.strictEqual(proxyTokenStore.calls[0].urlKey, 'acme');
    assert.strictEqual(proxyTokenStore.calls[0].options.scope, 'readWrite');

    // ...and the proxy details (Workspace API access block) are appended to the
    // triage prompt, carrying the minted token and the per-issue brief endpoint.
    assert.match(prompt, /Workspace API access/);
    assert.match(prompt, /Authorization: Bearer rw-tok-123/);
    assert.match(prompt, /\/api\/proxy\/brief\/LIN-900/);
  });

  // === Explicit post-create actions (LIN-918) ==============================

  test("action:'save' files only — nothing enqueued even when feedbackTriage is on", async () => {
    const { provider } = makeFakeProvider();
    const dispatch = capturingDispatchStore();
    // Flag ON, but an explicit save must still short-circuit any follow-up.
    const app = buildApp({
      provider, dispatchQueueStore: dispatch,
      proxyTokenStore: fakeProxyTokenStore(), features: { feedbackTriage: true }
    });

    const { status, body } = await submit(app, 'acme', { message: 'just save this', action: 'save' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(dispatch.items.length, 0);
  });

  test("action:'triage' enqueues triage even when the feedbackTriage flag is OFF (decoupled)", async () => {
    const { provider } = makeFakeProvider();
    const dispatch = capturingDispatchStore();
    const proxyTokenStore = fakeProxyTokenStore('rw-tok-triage');
    // No features → flag defaults off; the explicit action must triage anyway.
    const app = buildApp({ provider, dispatchQueueStore: dispatch, proxyTokenStore });

    const { status } = await submit(app, 'acme', { message: 'triage me', priority: 3, action: 'triage' });

    assert.strictEqual(status, 201);
    assert.strictEqual(dispatch.items.length, 1);
    assert.strictEqual(dispatch.items[0].item.kind, 'triage');
    assert.match(dispatch.items[0].item.prompt, /Authorization: Bearer rw-tok-triage/);
  });

  test("action:'autopilot' enqueues a scoped autopilot run with the feedback-origin brief", async () => {
    const { provider } = makeFakeProvider();
    const dispatch = capturingDispatchStore();
    const proxyTokenStore = fakeProxyTokenStore('rw-tok-auto');
    // Flag OFF — autopilot is explicit, never flag-gated.
    const app = buildApp({ provider, dispatchQueueStore: dispatch, proxyTokenStore });

    const { status, body } = await submit(app, 'acme', { message: 'run this end to end', action: 'autopilot' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);

    // One autopilot dispatch on the same substrate, scoped to the new ticket.
    assert.strictEqual(dispatch.items.length, 1);
    const item = dispatch.items[0].item;
    assert.strictEqual(item.kind, 'autopilot');
    assert.strictEqual(item.issueIdentifier, 'LIN-900');
    assert.strictEqual(item.target, 'cli');

    // The kickoff is the scoped Autopilot prompt...
    assert.match(item.prompt, /You're Autopilot/);
    assert.match(item.prompt, /run on autopilot until \*\*LIN-900\*\*/);
    // ...carrying the load-bearing feedback-origin brief...
    assert.match(item.prompt, /filed directly from the in-app feedback widget/);
    // ...and the minted readWrite token / proxy access block for the run.
    assert.strictEqual(proxyTokenStore.calls.length, 1);
    assert.strictEqual(proxyTokenStore.calls[0].options.scope, 'readWrite');
    assert.strictEqual(proxyTokenStore.calls[0].options.label, 'feedback-autopilot');
    assert.match(item.prompt, /Workspace API access/);
    assert.match(item.prompt, /Authorization: Bearer rw-tok-auto/);
    assert.match(item.prompt, /\/api\/proxy\/brief\/LIN-900/);
  });

  test('an unknown action falls back to the legacy plain send (flag-gated triage)', async () => {
    const { provider } = makeFakeProvider();
    const dispatch = capturingDispatchStore();
    // Unknown action + flag OFF → nothing enqueued (legacy default).
    const app = buildApp({ provider, dispatchQueueStore: dispatch, proxyTokenStore: fakeProxyTokenStore() });
    const { status } = await submit(app, 'acme', { message: 'hi', action: 'bogus' });
    assert.strictEqual(status, 201);
    assert.strictEqual(dispatch.items.length, 0);
  });

  test('still succeeds when the autopilot enqueue throws (best-effort)', async () => {
    const { provider } = makeFakeProvider();
    const failingDispatch = { addItem: async () => { throw new Error('queue down'); } };
    const app = buildApp({
      provider, dispatchQueueStore: failingDispatch, proxyTokenStore: fakeProxyTokenStore()
    });
    const { status, body } = await submit(app, 'acme', { message: 'hi', action: 'autopilot' });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
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
    // Valid PNG magic bytes — parseFeedbackImage sniffs the bytes (LIN-682), so
    // the fixture must be a real raster header, not arbitrary text.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]).toString('base64');
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
    // Flag on so the triage path actually runs and hits the failing enqueue.
    const app = buildApp({
      provider, dispatchQueueStore: failingDispatch,
      proxyTokenStore: fakeProxyTokenStore(), features: { feedbackTriage: true }
    });
    const { status, body } = await submit(app, 'acme', { message: 'hi' });
    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
  });
});
