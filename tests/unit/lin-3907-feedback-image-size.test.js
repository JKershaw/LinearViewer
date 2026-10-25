/**
 * LIN-3907 — feedback image size: one stated policy, and the handler's 413 is
 * reachable over HTTP. The 7 MiB image cap (equal to the widget's cap) is the
 * single policy; the text/plain body parser limit is derived from it, so the
 * 'image too large' arm answers before the parser does. Stubbed provider only;
 * no network.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import * as feedbackIntake from '../../routes/workspace-api-feedback.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { clientErrorStatus, clientErrorMessage } from '../../lib/errors.js';

// feedbackSubmitLimiter skips only under NODE_ENV=test; this file posts the route
// more than its 5-per-window budget.
process.env.NODE_ENV = 'test';

const MiB = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PROVIDER_NAME = 'lin-3907-fake';

// A PNG-headed buffer of exactly `bytes` decoded bytes. A non-raster payload is
// refused with 400 by parseFeedbackImage before the size check, so the header must
// be a real raster signature for the 413 to be the answer under test.
function pngOfSize(bytes) {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(bytes - PNG_SIGNATURE.length)]);
}

function pngDataUrl(bytes) {
  return `data:image/png;base64,${pngOfSize(bytes).toString('base64')}`;
}

function buildApp(calls) {
  registerProvider({
    name: PROVIDER_NAME,
    supports: (cap) => ['createIssue', 'uploadFile', 'fetchTeams'].includes(cap),
    apiWriteFields: () => ['title', 'description', 'teamId', 'projectId', 'priority'],
    async fetchTeams() { return [{ id: 't', name: 'Default' }]; },
    async uploadFile(token, bytes) {
      calls.uploads.push(bytes.length);
      return 'https://uploads.linear.app/ws/abc/shot.png';
    },
    async createIssue(token, input) {
      calls.creates.push(input);
      return { success: true, issue: { id: 'i1', identifier: 'LIN-1', title: input.title, url: 'u', state: { name: 'Todo', type: 'unstarted' } } };
    },
  });
  const app = express();
  app.use(express.json({ limit: '250kb' }));
  app.use((req, res, next) => {
    req.session = { linearUserId: 'u' };
    next();
  });
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'tok' };
      next();
    },
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    dispatchQueueStore: { addItem: async () => ({ _id: 'd1' }) },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, agentStatusStore: {}, promptTraceStore: {},
  }));
  // Mirrors the real server.js catch-all: a client error the parser already carries
  // is honored as JSON, not defaulted to 500 (LIN-1158).
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = clientErrorStatus(err);
    if (status !== null) return res.status(status).json({ error: clientErrorMessage(status, err) });
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(r => server.close(r)); }
}

async function post(base, message, image) {
  const res = await fetch(`${base}/workspace/acme/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ message, image }),
  });
  return { status: res.status, body: await res.json() };
}

const newCalls = () => ({ uploads: [], creates: [] });

describe('feedback image cap is the one stated policy (LIN-3907)', () => {
  beforeEach(() => { process.env.NODE_ENV = 'test'; });

  test('a PNG of 7 MiB + 1 byte is refused 413 by the handler arm, with no upload and no ticket', async () => {
    const calls = newCalls();
    await withServer(buildApp(calls), async (base) => {
      const r = await post(base, 'hello there', pngDataUrl(7 * MiB + 1));
      assert.strictEqual(r.status, 413);
      assert.deepStrictEqual(r.body, { error: 'image too large' });
      assert.strictEqual(calls.uploads.length, 0);
      assert.strictEqual(calls.creates.length, 0);
    });
  });

  test('a PNG of exactly 7 MiB is accepted (the cap is inclusive)', async () => {
    const calls = newCalls();
    await withServer(buildApp(calls), async (base) => {
      const r = await post(base, 'hello there', pngDataUrl(7 * MiB));
      assert.strictEqual(r.status, 201);
      assert.deepStrictEqual(calls.uploads, [7 * MiB]);
      assert.strictEqual(calls.creates.length, 1);
    });
  });

  test('a PNG of exactly 7 MiB with a 10,000-character message that JSON-escapes is accepted', async () => {
    const calls = newCalls();
    await withServer(buildApp(calls), async (base) => {
      const r = await post(base, '"'.repeat(10_000), pngDataUrl(7 * MiB));
      assert.strictEqual(r.status, 201);
      assert.strictEqual(calls.creates.length, 1);
    });
  });

  test('a PNG of 9 MiB is refused by the parser, and its body is the generic JSON 413', async () => {
    const calls = newCalls();
    await withServer(buildApp(calls), async (base) => {
      const r = await post(base, 'hello there', pngDataUrl(9 * MiB));
      assert.strictEqual(r.status, 413);
      assert.deepStrictEqual(r.body, { error: 'Request body too large' });
      assert.strictEqual(calls.uploads.length, 0);
      assert.strictEqual(calls.creates.length, 0);
    });
  });
});

describe('the parser limit is derived from the image cap (LIN-3907)', () => {
  test('the body limit is a byte count that admits a cap-sized base64 image and a worst-case message', () => {
    const cap = feedbackIntake.MAX_FEEDBACK_IMAGE_BYTES;
    const limit = feedbackIntake.FEEDBACK_BODY_LIMIT;
    assert.strictEqual(typeof limit, 'number');
    // base64 of the cap, plus a 10,000-character message at its worst JSON escape
    // (\uXXXX, six bytes a character). Below this, the handler arm is dead again.
    assert.ok(limit >= Math.ceil(cap * 4 / 3) + 6 * 10_000, `limit ${limit} too small for cap ${cap}`);
  });

  test('and no more than 1 MiB above that, so the buffer stays near the cap (LIN-669 M3)', () => {
    const cap = feedbackIntake.MAX_FEEDBACK_IMAGE_BYTES;
    const limit = feedbackIntake.FEEDBACK_BODY_LIMIT;
    assert.ok(limit <= Math.ceil(cap * 4 / 3) + 1024 * 1024, `limit ${limit} buffers well past cap ${cap}`);
  });
});

describe('widget and server agree on the image cap (LIN-3907)', () => {
  test('the widget MAX_IMAGE_BYTES equals the server MAX_FEEDBACK_IMAGE_BYTES', () => {
    const src = readFileSync(new URL('../../public/feedback-widget.js', import.meta.url), 'utf8');
    const m = /const MAX_IMAGE_BYTES = (\d+) \* 1024 \* 1024;/.exec(src);
    assert.ok(m, 'widget MAX_IMAGE_BYTES literal not found');
    assert.strictEqual(Number(m[1]) * MiB, feedbackIntake.MAX_FEEDBACK_IMAGE_BYTES);
  });
});
