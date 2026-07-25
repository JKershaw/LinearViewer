/**
 * LIN-1559 — the route-internal-read backstop: a missing guard read is a 422,
 * never a 500.
 *
 * This is the DURABLE half of the fix. Implementing the four reads on
 * GitHubProvider unbreaks GitHub; the backstop protects the NEXT provider that
 * implements a write without them — which is exactly how this bug was born.
 *
 * Why it cannot be `denyIfUnsupported`: the four reads
 * (`issueWriteGuard` / `issueDescription` / `issueLabels` / `updateIssueLabels`)
 * are deliberately OFF the declared PROVIDER_SURFACE, so `supports()` is false
 * for them on EVERY provider, Linear included. Gating on `supports()` would
 * decline every write on every provider. The backstop keys on plain method
 * EXISTENCE — the property the route actually depends on.
 *
 * Each test drives the REAL route handlers with a stub provider that passes the
 * capability gate for the write itself (`supports('updateIssue')` etc. is true)
 * but is missing exactly one read, and asserts the documented 422
 * CAPABILITY_NOT_SUPPORTED envelope naming that read. Before this change every
 * one of these was a 500 "Linear API request failed".
 *
 * Sites covered (the 8 in routes/proxy.js): refuseIfTrashed (1),
 * PATCH inline guard (2), applyDescriptionEdit (3), the attachment
 * description-length precheck (4), POST labels (5, 6), DELETE labels (7, 8).
 *
 * Run with: node --test tests/unit/proxy-route-internal-read-backstop.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';

const PROVIDER_NAME = 'backstop-stub';
const ISSUE_ID = 'LIN-900';
const UUID = '11111111-1111-1111-1111-111111111111';
// Minimal but valid PNG magic bytes (the sniffer requires ≥12), so the
// attachment route gets past image validation and reaches its guard reads.
// Same fixture as tests/unit/proxy-attachment-upload.test.js.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PNG = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

/**
 * A provider that SUPPORTS every declared write but is missing the named
 * route-internal reads. `omit` is the list of reads to leave undefined.
 */
function makeStubProvider(omit = []) {
  const reads = {
    issueWriteGuard: async () => ({ id: 'iss-1', trashed: false, team: { id: 'team-x' } }),
    issueDescription: async () => ({ id: 'iss-1', description: 'body', trashed: false }),
    issueLabels: async () => ({ id: 'iss-1', trashed: false, labels: { nodes: [{ id: 'bug', name: 'bug' }] } }),
    updateIssueLabels: async () => ({ success: true, issue: { id: 'iss-1' } }),
  };
  const provider = {
    name: PROVIDER_NAME,
    // Every DECLARED write is supported — the capability gate is a pass, which is
    // what makes the missing read reachable at all.
    supports: (cap) => ['createIssue', 'updateIssue', 'createComment', 'addLabel',
      'removeLabel', 'uploadFile'].includes(cap),
    async updateIssue() { return { success: true, issue: { id: 'iss-1' } }; },
    async createComment() { return { success: true, comment: { id: 'c-1', body: 'x' } }; },
    async uploadFile() { return 'https://example.test/asset.png'; },
    async labels() { return [{ id: 'bug', name: 'bug' }, { id: 'urgent', name: 'urgent' }]; },
    async states() { return [{ id: 's-1', name: 'Done', type: 'completed' }]; },
  };
  for (const [name, fn] of Object.entries(reads)) {
    if (!omit.includes(name)) provider[name] = fn;
  }
  return provider;
}

function buildApp(provider) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: PROVIDER_NAME }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));
  return app;
}

async function call(app, method, path, body) {
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = {};
    try { parsed = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(r => server.close(r));
  }
}

/** Assert the shared decline envelope, naming the missing read as the capability. */
function assertDeclined({ status, body }, capability) {
  assert.equal(status, 422, `expected 422, got ${status} (${JSON.stringify(body)})`);
  assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
  assert.equal(body.capability, capability);
  assert.equal(body.provider, PROVIDER_NAME);
}

// ---------------------------------------------------------------------------
// issueWriteGuard — sites 1 and 2
// ---------------------------------------------------------------------------
describe('missing issueWriteGuard declines 422 instead of 500', () => {
  const omitted = () => buildApp(makeStubProvider(['issueWriteGuard']));

  test('site 2 — PATCH /api/proxy/issues/:id', async () => {
    assertDeclined(await call(omitted(), 'PATCH', `/api/proxy/issues/${ISSUE_ID}`, { title: 'x' }), 'issueWriteGuard');
  });

  test('site 1 — POST /api/proxy/issues/:id/comments (via refuseIfTrashed)', async () => {
    assertDeclined(await call(omitted(), 'POST', `/api/proxy/issues/${ISSUE_ID}/comments`, { body: 'hi' }), 'issueWriteGuard');
  });

  test('site 1 — the /api/proxy/comments/:id alias shares the same guard', async () => {
    assertDeclined(await call(omitted(), 'POST', `/api/proxy/comments/${ISSUE_ID}`, { body: 'hi' }), 'issueWriteGuard');
  });

  test('site 1 — POST /api/proxy/issues/:id/attachments (refuseIfTrashed, comment target)', async () => {
    assertDeclined(await call(omitted(), 'POST', `/api/proxy/issues/${ISSUE_ID}/attachments`, { image: PNG }), 'issueWriteGuard');
  });
});

// ---------------------------------------------------------------------------
// issueDescription — sites 3 and 4
// ---------------------------------------------------------------------------
describe('missing issueDescription declines 422 instead of 500', () => {
  const omitted = () => buildApp(makeStubProvider(['issueDescription']));

  test('site 3 — POST …/description/append (via applyDescriptionEdit)', async () => {
    assertDeclined(await call(omitted(), 'POST', `/api/proxy/issues/${ISSUE_ID}/description/append`, { block: 'more' }), 'issueDescription');
  });

  test('site 3 — POST …/description/replace shares the same helper', async () => {
    assertDeclined(await call(omitted(), 'POST', `/api/proxy/issues/${ISSUE_ID}/description/replace`,
      { oldString: 'a', newString: 'b' }), 'issueDescription');
  });

  test('site 4 — POST …/attachments with target=description (the length precheck)', async () => {
    // The second, independent issueDescription call — outside applyDescriptionEdit
    // — that the design comment's list missed. Unreachable on GitHub (uploadFile
    // 422s first), but the same defect class for any upload-capable provider, so
    // it is exercised here with a stub that DOES support uploadFile.
    assertDeclined(await call(omitted(), 'POST', `/api/proxy/issues/${ISSUE_ID}/attachments`,
      { image: PNG, target: 'description' }), 'issueDescription');
  });
});

// ---------------------------------------------------------------------------
// issueLabels / updateIssueLabels — sites 5-8
// ---------------------------------------------------------------------------
describe('missing label reads decline 422 instead of 500', () => {
  test('site 5 — POST …/labels with issueLabels missing', async () => {
    const app = buildApp(makeStubProvider(['issueLabels']));
    assertDeclined(await call(app, 'POST', `/api/proxy/issues/${ISSUE_ID}/labels`, { labelId: 'urgent' }), 'issueLabels');
  });

  test('site 6 — POST …/labels with only updateIssueLabels missing', async () => {
    // The read half succeeds, so this proves the guard is per-method rather than
    // one blanket check at the top of the handler.
    const app = buildApp(makeStubProvider(['updateIssueLabels']));
    assertDeclined(await call(app, 'POST', `/api/proxy/issues/${ISSUE_ID}/labels`, { labelId: 'urgent' }), 'updateIssueLabels');
  });

  test('site 7 — DELETE …/labels/:labelId with issueLabels missing', async () => {
    const app = buildApp(makeStubProvider(['issueLabels']));
    assertDeclined(await call(app, 'DELETE', `/api/proxy/issues/${ISSUE_ID}/labels/bug`), 'issueLabels');
  });

  test('site 8 — DELETE …/labels/:labelId with only updateIssueLabels missing', async () => {
    const app = buildApp(makeStubProvider(['updateIssueLabels']));
    assertDeclined(await call(app, 'DELETE', `/api/proxy/issues/${ISSUE_ID}/labels/bug`), 'updateIssueLabels');
  });
});

// ---------------------------------------------------------------------------
// The backstop must be invisible to a provider that HAS the reads.
// ---------------------------------------------------------------------------
describe('the backstop is a no-op for a provider that implements the reads', () => {
  test('a complete provider still writes (no spurious 422)', async () => {
    const app = buildApp(makeStubProvider());
    for (const [method, path, body] of [
      ['PATCH', `/api/proxy/issues/${ISSUE_ID}`, { title: 'x' }],
      ['POST', `/api/proxy/issues/${ISSUE_ID}/comments`, { body: 'hi' }],
      ['POST', `/api/proxy/issues/${ISSUE_ID}/description/append`, { block: 'more' }],
      ['POST', `/api/proxy/issues/${ISSUE_ID}/labels`, { labelId: 'urgent' }],
      ['DELETE', `/api/proxy/issues/${ISSUE_ID}/labels/bug`, undefined],
    ]) {
      const res = await call(app, method, path, body);
      assert.ok(res.status < 300, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
      assert.notEqual(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
    }
  });

  test('a genuinely unsupported WRITE still declines on its own capability, not a read', async () => {
    // The pre-existing denyIfUnsupported contract is untouched: the decline names
    // the write capability, proving the backstop did not swallow that path.
    const provider = makeStubProvider();
    provider.supports = () => false;
    assertDeclined(await call(buildApp(provider), 'PATCH', `/api/proxy/issues/${ISSUE_ID}`, { title: 'x' }), 'updateIssue');
  });

  test('an unsupported relation write is unaffected (control)', async () => {
    const provider = makeStubProvider();
    assertDeclined(await call(buildApp(provider), 'POST', `/api/proxy/issues/${ISSUE_ID}/relations`,
      { type: 'blocks', relatedIssueId: UUID }), 'createRelation');
  });
});
