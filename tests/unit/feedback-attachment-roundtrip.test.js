// =============================================================================
// Workspace-feedback attachment round-trip (LIN-651, parent LIN-612 slice 3/4)
// =============================================================================
//
// Verification-only slice. Two real surfaces already exist independently:
//
//   1. INTAKE — POST /workspace/:urlKey/api/feedback (routes/workspace-api.js,
//      LIN-636) accepts a base64 image, uploads it via provider.uploadFile, and
//      embeds the returned asset URL in the new ticket body as `![](<url>)`.
//   2. EXPOSE — flattenIssue (lib/proxy-wire.js, LIN-649) parses markdown images
//      out of an issue description on GET /api/proxy/issues/:id and surfaces them
//      as the canonical attachment shape `{ id, title, contentType, kind }` with
//      an opaque `md:` handle (no deep-link URL).
//
// LIN-651 (scope: workspace feedback ONLY — dispatch feedback is explicitly out)
// is the test proving these two surfaces compose: a screenshot submitted through
// the feedback intake reads back as a canonical attachment through the proxy
// issue read. The test drives the REAL feedback route to produce the ticket body,
// then feeds that exact body through the REAL proxy expose path — neither end is
// hand-stubbed — so it would catch drift in either surface (e.g. the intake
// embedding a non-image URL, or the expose path failing to recognise it).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { flattenIssue, decodeAttachmentHandle } from '../../lib/proxy-wire.js';

const PROVIDER_NAME = 'feedback-roundtrip-fake';

// Minimal controllable provider, mirroring tests/unit/feedback-route.test.js.
// Self-contained (not shared) to keep this verification slice isolated.
function makeFakeProvider({ assetUrl } = {}) {
  const calls = { createIssue: [], uploadFile: [] };
  const provider = {
    name: PROVIDER_NAME,
    supports: (cap) => ['createIssue', 'uploadFile', 'fetchTeams'].includes(cap),
    async fetchTeams() { return [{ id: 'team-default', name: 'Default' }]; },
    async uploadFile(token, bytes, meta) {
      calls.uploadFile.push({ bytes, meta });
      return assetUrl ?? 'https://uploads.linear.app/ws/abc/shot.png';
    },
    async createIssue(token, input) {
      calls.createIssue.push(input);
      return { success: true, issue: { id: 'iss-1', identifier: 'LIN-900', title: input.title, state: { name: 'Todo', type: 'unstarted' } } };
    },
  };
  return { provider, calls };
}

function buildApp(provider) {
  registerProvider(provider);
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token' };
      req.session = { linearUserId: 'user-1' };
      next();
    },
    dispatchQueueStore: { addItem: async () => ({ _id: 'd1' }) },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {},
    briefCacheStore: {}, reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {},
  });
  app.use(router);
  return app;
}

// Submit feedback through the real route and return the description the route
// asked the provider to persist (i.e. the body that becomes the ticket).
async function submitAndCaptureBody(app, calls, payload) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/acme/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    assert.strictEqual(res.status, 201, 'feedback intake should succeed');
    assert.strictEqual(calls.createIssue.length, 1);
    return calls.createIssue[0].description;
  } finally {
    await new Promise(r => server.close(r));
  }
}

// Model the proxy read: flattenIssue only emits `attachments` when the raw issue
// carries an `{ nodes }` attachments connection (the gate that scopes the field
// to the issue-detail read). A feedback ticket has no FORMAL attachments — the
// screenshot lives in the description markdown — so the connection is empty.
function asProxyRead(description) {
  return { id: 'iss-1', identifier: 'LIN-900', description, attachments: { nodes: [] } };
}

describe('workspace-feedback attachment round-trip (LIN-651)', () => {
  let savedTeamEnv;
  beforeEach(() => { savedTeamEnv = process.env.FEEDBACK_TEAM_ID; delete process.env.FEEDBACK_TEAM_ID; });
  afterEach(() => { if (savedTeamEnv === undefined) delete process.env.FEEDBACK_TEAM_ID; else process.env.FEEDBACK_TEAM_ID = savedTeamEnv; });

  test('a submitted screenshot reads back as a canonical md: attachment', async () => {
    const assetUrl = 'https://uploads.linear.app/ws/abc/shot.png';
    const { provider, calls } = makeFakeProvider({ assetUrl });
    const app = buildApp(provider);

    // INTAKE: drive the real route with an embedded screenshot.
    const png = Buffer.from('imgbytes').toString('base64');
    const description = await submitAndCaptureBody(app, calls, {
      message: 'see attached shot',
      image: `data:image/png;base64,${png}`,
    });
    assert.strictEqual(calls.uploadFile.length, 1, 'image uploaded through provider seam');
    assert.match(description, /!\[\]\(https:\/\/uploads\.linear\.app\/ws\/abc\/shot\.png\)/);

    // EXPOSE: run that exact body through the real proxy read path.
    const issue = asProxyRead(description);
    flattenIssue(issue);

    assert.ok(Array.isArray(issue.attachments), 'attachments exposed on the proxy read');
    assert.strictEqual(issue.attachments.length, 1, 'exactly the embedded screenshot');
    const [att] = issue.attachments;

    // Canonical shape (LIN-649): { id, title, contentType, kind }, no url.
    assert.deepStrictEqual(Object.keys(att).sort(), ['contentType', 'id', 'kind', 'title']);
    assert.strictEqual(att.kind, 'image');
    assert.strictEqual(att.contentType, 'image/png');
    assert.strictEqual('url' in att, false, 'no backend deep-link leaks');

    // The opaque md: handle round-trips back to the asset URL the intake embedded
    // — this is what lets the slice-2 relay (LIN-650) fetch the bytes server-side.
    assert.match(att.id, /^md:/);
    assert.deepStrictEqual(decodeAttachmentHandle(att.id), { type: 'md', value: assetUrl });
  });

  test('survives a signed asset URL with a query string (real Linear uploads)', async () => {
    // Real provider.uploadFile returns a signed URL (`…shot.png?signature=…`);
    // the expose path must still recognise it by extension and round-trip the
    // FULL signed URL through the handle (the relay needs the signature to fetch).
    const assetUrl = 'https://uploads.linear.app/ws/abc/shot.png?signature=deadbeef&expires=1';
    const { provider, calls } = makeFakeProvider({ assetUrl });
    const app = buildApp(provider);

    const png = Buffer.from('x').toString('base64');
    const description = await submitAndCaptureBody(app, calls, {
      message: 'signed url shot',
      image: `data:image/png;base64,${png}`,
    });

    const issue = asProxyRead(description);
    flattenIssue(issue);

    assert.strictEqual(issue.attachments.length, 1);
    const [att] = issue.attachments;
    assert.strictEqual(att.kind, 'image');
    assert.strictEqual(att.contentType, 'image/png');
    assert.deepStrictEqual(decodeAttachmentHandle(att.id), { type: 'md', value: assetUrl });
  });

  test('feedback with no image exposes no attachments (parity)', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp(provider);

    const description = await submitAndCaptureBody(app, calls, { message: 'no screenshot here' });
    assert.strictEqual(calls.uploadFile.length, 0);

    const issue = asProxyRead(description);
    flattenIssue(issue);
    assert.strictEqual('attachments' in issue, false, 'empty ⇒ field absent, not []');
  });
});
