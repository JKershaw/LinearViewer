/**
 * LIN-891 (parent LIN-871, phase 3/3) — Agent-facing attachment upload endpoint.
 *
 * POST /api/proxy/issues/:issueId/attachments lets an external agent attach a
 * base64 raster image to an issue, either as a new comment (default) or
 * appended to the description. It is deliberately NOT the human feedback
 * widget's session-authed `/api/image` route — it is a separate Bearer-token
 * route that reuses the SAME underlying primitives end-to-end:
 *   - `provider.uploadFile()` (LIN-636), capability-gated
 *   - the raster magic-byte sniffing guard (LIN-682, now shared via
 *     lib/attachment-upload.js)
 *   - markdown embedding (`![](assetUrl)`), so the upload is immediately
 *     readable through the EXISTING `md:` read path — no new read-side
 *     plumbing.
 *
 * These tests drive the real handler over HTTP (mirroring proxy-attachment-
 * relay.test.js) with an injectable fake provider so the upload/comment/
 * description-write calls are fully offline and deterministic.
 */

process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProviderInterface } from '../../lib/providers/interface.js';

const ISSUE_ID = '11111111-1111-1111-1111-111111111111';

// Minimal but valid PNG magic bytes (≥12 bytes), matching the fixtures in
// feedback-image.test.js / lib/attachment-upload.js's own guard.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const SVG_DATA_URL = `data:image/svg+xml;base64,${Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64')}`;

// A fake provider exercising the full write path this route touches:
// uploadFile, createComment, updateIssue, plus the two ungated write-guard
// reads (issueWriteGuard/issueDescription) that refuseIfTrashed /
// applyDescriptionEdit call directly (outside the supports() capability
// system — every real provider that supports updateIssue implements them).
// Each capability is opt-in via constructor flags so capability-gate tests
// can omit it and observe the base class's throwing stub correctly reporting
// `supports() === false`.
class FakeUploadProvider extends ProviderInterface {
  constructor({ uploadFile = true, createComment = true, updateIssue = true, trashed = false, description = 'Existing description.' } = {}) {
    super();
    this.name = 'fake';
    this.calls = { uploadFile: [], createComment: [], updateIssue: [] };
    this._description = description;
    if (uploadFile) {
      this.uploadFile = async (token, bytes, meta) => {
        this.calls.uploadFile.push({ token, bytes, meta });
        return 'https://uploads.linear.app/fake-asset.png';
      };
    }
    if (createComment) {
      this.createComment = async (token, issueId, body) => {
        this.calls.createComment.push({ token, issueId, body });
        return { id: 'comment-1', body, createdAt: '2026-07-01T00:00:00.000Z', user: { name: 'Agent' } };
      };
    }
    if (updateIssue) {
      this.updateIssue = async (token, issueId, input) => {
        this.calls.updateIssue.push({ token, issueId, input });
        if (input.description !== undefined) this._description = input.description;
        return { id: issueId, identifier: 'LIN-1', description: this._description };
      };
    }
    this.issueWriteGuard = async () => (trashed ? { trashed: true } : { id: ISSUE_ID, team: { id: 'team-1' } });
    this.issueDescription = async () => ({ description: this._description, trashed });
  }
}

function buildApp({ token = 'ws-token', reason = 'ok', provider, scope = 'readWrite' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: 'acme', label: 'test', scope, createdBy: 'u1'
      })
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token, reason }),
    getWorkspaceAccessToken: async () => token,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    ...(provider ? { provider } : {}),
  }));
  return app;
}

async function postAttachment(app, body, { issueId = ISSUE_ID, headers } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/proxy/issues/${encodeURIComponent(issueId)}/attachments`, {
      method: 'POST',
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('POST /api/proxy/issues/:issueId/attachments (LIN-891)', () => {
  test('default target ("comment"): uploads the image and creates a comment embedding it as markdown', async () => {
    const provider = new FakeUploadProvider();
    const { status, body } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL });
    assert.equal(status, 201);
    assert.equal(body.success, true);
    assert.equal(body.comment.body, '![](https://uploads.linear.app/fake-asset.png)');
    assert.equal(provider.calls.uploadFile.length, 1);
    assert.equal(provider.calls.uploadFile[0].meta.contentType, 'image/png');
    assert.equal(provider.calls.createComment.length, 1);
    assert.equal(provider.calls.createComment[0].issueId, ISSUE_ID);
  });

  test('"comment" target with accompanying body text prepends the text before the markdown image', async () => {
    const provider = new FakeUploadProvider();
    const { status, body } = await postAttachment(buildApp({ provider }), {
      image: PNG_DATA_URL,
      body: 'Before/after screenshot of the fix:',
    });
    assert.equal(status, 201);
    assert.equal(body.comment.body, 'Before/after screenshot of the fix:\n\n![](https://uploads.linear.app/fake-asset.png)');
  });

  test('"description" target uploads the image and appends it to the description via updateIssue', async () => {
    const provider = new FakeUploadProvider({ description: 'Original body.' });
    const { status, body } = await postAttachment(buildApp({ provider }), {
      image: PNG_DATA_URL,
      target: 'description',
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.match(body.issue.description, /Original body\./);
    assert.match(body.issue.description, /!\[\]\(https:\/\/uploads\.linear\.app\/fake-asset\.png\)/);
    assert.equal(provider.calls.uploadFile.length, 1);
    assert.equal(provider.calls.createComment.length, 0);
    assert.equal(provider.calls.updateIssue.length, 1);
  });

  test('an invalid target value is rejected with 400 before any upload', async () => {
    const provider = new FakeUploadProvider();
    const { status } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL, target: 'bogus' });
    assert.equal(status, 400);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('missing image is rejected with 400 before any upload', async () => {
    const provider = new FakeUploadProvider();
    const { status } = await postAttachment(buildApp({ provider }), {});
    assert.equal(status, 400);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('a non-raster payload (SVG mislabeled as an image) is rejected with 400, never uploaded (LIN-682)', async () => {
    const provider = new FakeUploadProvider();
    const { status } = await postAttachment(buildApp({ provider }), { image: SVG_DATA_URL });
    assert.equal(status, 400);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('an oversized image (>10MB decoded) is rejected with 413, never uploaded', async () => {
    const provider = new FakeUploadProvider();
    const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(10 * 1024 * 1024)]);
    const oversizedDataUrl = `data:image/png;base64,${oversized.toString('base64')}`;
    const { status } = await postAttachment(buildApp({ provider }), { image: oversizedDataUrl }, {
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(status, 413);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('a trashed issue is refused with 409 after the upload capability gate but before the upload call', async () => {
    const provider = new FakeUploadProvider({ trashed: true });
    const { status, body } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL });
    assert.equal(status, 409);
    assert.match(body.error, /trashed/i);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('a provider without uploadFile declines with 422 CAPABILITY_NOT_SUPPORTED, not a 500', async () => {
    const provider = new FakeUploadProvider({ uploadFile: false });
    const { status, body } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL });
    assert.equal(status, 422);
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'uploadFile');
  });

  test('a provider without createComment declines with 422 for the default "comment" target', async () => {
    const provider = new FakeUploadProvider({ createComment: false });
    const { status, body } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL });
    assert.equal(status, 422);
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'createComment');
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('a provider without updateIssue declines with 422 for the "description" target', async () => {
    const provider = new FakeUploadProvider({ updateIssue: false });
    const { status, body } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL, target: 'description' });
    assert.equal(status, 422);
    assert.equal(body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(body.capability, 'updateIssue');
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('a read-scoped token is rejected with 403 (requireWriteScope)', async () => {
    const provider = new FakeUploadProvider();
    const { status } = await postAttachment(buildApp({ provider, scope: 'read' }), { image: PNG_DATA_URL });
    assert.equal(status, 403);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('an unavailable workspace token returns the structured 503 envelope, not a 500', async () => {
    const provider = new FakeUploadProvider();
    const { status } = await postAttachment(buildApp({ provider, token: null, reason: 'not_connected' }), { image: PNG_DATA_URL });
    assert.equal(status, 503);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('non-string body field is rejected with 400', async () => {
    const provider = new FakeUploadProvider();
    const { status } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL, body: 42 });
    assert.equal(status, 400);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  test('an invalid issue ID format is rejected with 400', async () => {
    const provider = new FakeUploadProvider();
    const { status } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL }, { issueId: 'a'.repeat(101) });
    assert.equal(status, 400);
    assert.equal(provider.calls.uploadFile.length, 0);
  });

  // Regression for the review-flagged ordering bug: an oversized `body` must be
  // rejected BEFORE uploadFile() runs, on both targets — otherwise every
  // rejected request still burns a real (orphaned) Linear upload.
  test('an oversized body for the "comment" target is rejected with 400 before any upload', async () => {
    const provider = new FakeUploadProvider();
    const oversizedBody = 'x'.repeat(50000); // MAX_COMMENT_LENGTH
    const { status, body } = await postAttachment(buildApp({ provider }), {
      image: PNG_DATA_URL,
      body: oversizedBody,
    });
    assert.equal(status, 400);
    assert.match(body.error, /exceeds maximum length/i);
    assert.equal(provider.calls.uploadFile.length, 0);
    assert.equal(provider.calls.createComment.length, 0);
  });

  test('an oversized body for the "description" target is rejected with 400 before any upload', async () => {
    const provider = new FakeUploadProvider({ description: 'x'.repeat(99900) });
    const oversizedBody = 'x'.repeat(500); // pushes current description + body + reserve over MAX_DESCRIPTION_LENGTH
    const { status, body } = await postAttachment(buildApp({ provider }), {
      image: PNG_DATA_URL,
      target: 'description',
      body: oversizedBody,
    });
    assert.equal(status, 400);
    assert.match(body.error, /exceeds maximum length/i);
    assert.equal(provider.calls.uploadFile.length, 0);
    assert.equal(provider.calls.updateIssue.length, 0);
  });

  test('a missing issue for the "description" target is rejected with 404 before any upload', async () => {
    const provider = new FakeUploadProvider();
    provider.issueDescription = async () => null;
    const { status } = await postAttachment(buildApp({ provider }), { image: PNG_DATA_URL, target: 'description' });
    assert.equal(status, 404);
    assert.equal(provider.calls.uploadFile.length, 0);
  });
});
