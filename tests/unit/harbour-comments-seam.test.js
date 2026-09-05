/**
 * LIN-2648 beat 3 — wiring tests for the three `provider.createComment` seams
 * into the Harbour-comments ledger (lib/harbour-comments-store.js, covered on
 * its own terms in tests/unit/harbour-comments-store.test.js). This file is
 * about the WIRING only: does a successful create record the id, and — the
 * load-bearing property — does a ledger-write failure leave the comment
 * write's own response completely untouched.
 *
 * Seams (verified against HEAD, plan-cited locations):
 *   1. routes/proxy-writes.js :541  POST /api/proxy/issues/:issueId/comments
 *   2. routes/proxy-writes.js :771  POST /api/proxy/issues/:issueId/attachments (comment target)
 *   3. routes/workspace-api.js :1565 POST /workspace/:urlKey/api/comments/:issueId
 *
 * Run with: node --test tests/unit/harbour-comments-seam.test.js
 */

process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { ProviderInterface } from '../../lib/providers/interface.js';
import { HarbourCommentsStore } from '../../lib/harbour-comments-store.js';

const ISSUE_ID = '11111111-1111-1111-1111-111111111111';
// Minimal but valid PNG magic bytes (≥12 bytes), matching the fixtures in
// tests/unit/proxy-attachment-upload.test.js.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

let commentCounter = 0;

class FakeWriteProvider extends ProviderInterface {
  constructor({ name }) {
    super();
    this.name = name;
    this.calls = { createComment: [], uploadFile: [] };
    this.createComment = async (token, issueId, body) => {
      commentCounter += 1;
      const comment = { id: `comment-${commentCounter}`, body, createdAt: new Date().toISOString(), user: { name: 'Agent' } };
      this.calls.createComment.push({ issueId, body, comment });
      return comment;
    };
    this.uploadFile = async (token, bytes, meta) => {
      this.calls.uploadFile.push({ bytes, meta });
      return 'https://uploads.linear.app/fake-asset.png';
    };
    this.issueWriteGuard = async () => ({ id: ISSUE_ID, trashed: false, team: { id: 'team-1' } });
  }
}

function makeFakeLedger({ throwOnRecord = false } = {}) {
  const calls = [];
  return {
    calls,
    async record({ urlKey, commentId }) {
      calls.push({ urlKey, commentId });
      if (throwOnRecord) throw new Error('ledger down');
      return { urlKey, commentId, recordedAt: new Date().toISOString() };
    },
  };
}

// LIN-2664 F2: the ORIGINAL create's ledger write fails once, then heals on
// any later attempt — models a transient ledger outage that has cleared by
// the time a dedupe-hit resubmission re-attempts the record.
function makeFlakyLedger() {
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

// Modelled on tests/unit/harbour-comments-store.test.js's mock collection.
function createMockCollection() {
  const docs = [];
  function matchesField(docValue, queryValue) {
    if (queryValue && typeof queryValue === 'object' && Array.isArray(queryValue.$in)) {
      return queryValue.$in.includes(docValue);
    }
    return docValue === queryValue;
  }
  function matches(doc, query) {
    for (const key of Object.keys(query)) {
      if (!matchesField(doc[key], query[key])) return false;
    }
    return true;
  }
  return {
    async findOne(query) { return docs.find(d => matches(d, query)) || null; },
    find(query = {}) {
      const results = docs.filter(d => matches(d, query));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update, opts = {}) {
      const idx = docs.findIndex(d => matches(d, query));
      if (idx >= 0) { Object.assign(docs[idx], update.$set || {}); return { matchedCount: 1, modifiedCount: 1 }; }
      if (opts.upsert) { docs.push({ ...(update.$set || {}), ...(update.$setOnInsert || {}) }); return { matchedCount: 0, modifiedCount: 0 }; }
      return { matchedCount: 0, modifiedCount: 0 };
    }
  };
}

function buildProxyApp({ provider, harbourCommentsStore }) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
    ...(harbourCommentsStore !== undefined ? { harbourCommentsStore } : {}),
  }));
  return app;
}

function buildWorkspaceApp({ provider, harbourCommentsStore }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: provider.name, accessToken: 'ws-token' };
      req.session = { accountId: 'acct-1' };
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {}, recapCacheStore: {}, briefCacheStore: {},
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
    taskDecisionsStore: undefined,
    ...(harbourCommentsStore !== undefined ? { harbourCommentsStore } : {}),
  }));
  return app;
}

async function call(app, method, path, payload, headers = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body = {};
    try { body = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, body };
  } finally {
    await new Promise(r => server.close(r));
  }
}

const postProxyComment = (app, issueId, payload) =>
  call(app, 'POST', `/api/proxy/issues/${issueId}/comments`, payload, { Authorization: 'Bearer anything' });
const postAttachment = (app, issueId, payload) =>
  call(app, 'POST', `/api/proxy/issues/${issueId}/attachments`, payload, { Authorization: 'Bearer anything' });
const postWorkspaceComment = (app, urlKey, issueId, payload) =>
  call(app, 'POST', `/workspace/${urlKey}/api/comments/${issueId}`, payload);

describe('seam 1 — POST /api/proxy/issues/:issueId/comments (routes/proxy-writes.js :541)', () => {
  // commentDedupe (routes/proxy.js) is a module-level singleton shared across
  // every test in this file — each test below uses its own unique body text
  // so it can never dedupe-hit a sibling test's prior create.
  test('a successful create records the id in the ledger, keyed by req.proxyUrlKey', async () => {
    const provider = new FakeWriteProvider({ name: 'seam1-ok' });
    const ledger = makeFakeLedger();
    const app = buildProxyApp({ provider, harbourCommentsStore: ledger });

    const { status, body } = await postProxyComment(app, ISSUE_ID, { body: 'seam1-ok body' });

    assert.strictEqual(status, 201);
    assert.strictEqual(ledger.calls.length, 1);
    assert.strictEqual(ledger.calls[0].urlKey, 'acme');
    assert.strictEqual(ledger.calls[0].commentId, body.comment.id);
  });

  test('LOAD-BEARING: a ledger write that throws does not fail the comment write — the route still 201s with the normal payload', async () => {
    const provider = new FakeWriteProvider({ name: 'seam1-throw' });
    const ledger = makeFakeLedger({ throwOnRecord: true });
    const app = buildProxyApp({ provider, harbourCommentsStore: ledger });

    const { status, body } = await postProxyComment(app, ISSUE_ID, { body: 'seam1-throw body' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.ok(body.comment?.id);
    assert.strictEqual(ledger.calls.length, 1, 'the single (failed) attempt still happened');
  });

  test('no retry: a failed ledger write is attempted exactly once and never re-entered', async () => {
    const provider = new FakeWriteProvider({ name: 'seam1-noretry' });
    const ledger = makeFakeLedger({ throwOnRecord: true });
    const app = buildProxyApp({ provider, harbourCommentsStore: ledger });

    await postProxyComment(app, ISSUE_ID, { body: 'seam1-noretry body' });
    await new Promise(r => setTimeout(r, 20)); // give any stray retry timer a chance to fire

    assert.strictEqual(ledger.calls.length, 1);
  });

  test('no harbourCommentsStore configured → route still 201s (optional dependency, never a hard failure)', async () => {
    const provider = new FakeWriteProvider({ name: 'seam1-nostore' });
    const app = buildProxyApp({ provider, harbourCommentsStore: null });

    const { status } = await postProxyComment(app, ISSUE_ID, { body: 'seam1-nostore body' });
    assert.strictEqual(status, 201);
  });

  // LIN-2664 F2: the failure this fixes — a dedupe-hit resubmission returned
  // the prior comment WITHOUT ever re-attempting the ledger record, so a
  // comment whose original ledger write failed stayed permanently unrecorded.
  test('LIN-2664 F2: a dedupe-hit repairs the ledger after the original create\'s record() failed', async () => {
    const provider = new FakeWriteProvider({ name: 'seam1-repair' });
    const ledger = makeFlakyLedger();
    const app = buildProxyApp({ provider, harbourCommentsStore: ledger });
    const body = 'seam1-repair body';

    const first = await postProxyComment(app, ISSUE_ID, { body });
    assert.strictEqual(first.status, 201);
    assert.strictEqual(ledger.calls.length, 1, 'the original create attempted (and failed) its ledger record');

    const second = await postProxyComment(app, ISSUE_ID, { body });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true, 'still served from the dedupe cache — no second comment minted');
    assert.strictEqual(provider.calls.createComment.length, 1, 'no second provider write on the dedupe hit');
    assert.strictEqual(ledger.calls.length, 2, 'the dedupe hit re-attempted the ledger record');
    assert.strictEqual(
      ledger.calls[1].commentId,
      first.body.comment.id,
      'the repair attempt targets the SAME comment id the original create minted'
    );
  });
});

describe('seam 2 — POST /api/proxy/issues/:issueId/attachments, comment target (routes/proxy-writes.js :771)', () => {
  test('a successful attachment-comment create records the id in the ledger', async () => {
    const provider = new FakeWriteProvider({ name: 'seam2-ok' });
    const ledger = makeFakeLedger();
    const app = buildProxyApp({ provider, harbourCommentsStore: ledger });

    const { status, body } = await postAttachment(app, ISSUE_ID, { image: PNG_DATA_URL });

    assert.strictEqual(status, 201);
    assert.strictEqual(ledger.calls.length, 1);
    assert.strictEqual(ledger.calls[0].urlKey, 'acme');
    assert.strictEqual(ledger.calls[0].commentId, body.comment.id);
  });

  test('LOAD-BEARING: a ledger write that throws does not fail the attachment-comment write', async () => {
    const provider = new FakeWriteProvider({ name: 'seam2-throw' });
    const ledger = makeFakeLedger({ throwOnRecord: true });
    const app = buildProxyApp({ provider, harbourCommentsStore: ledger });

    const { status, body } = await postAttachment(app, ISSUE_ID, { image: PNG_DATA_URL });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(ledger.calls.length, 1);
  });
});

describe('seam 3 — POST /workspace/:urlKey/api/comments/:issueId (routes/workspace-api.js :1565)', () => {
  // Same dedupe-cache-is-shared caveat as seam 1 above — unique body text per test.
  test('a successful create records the id in the ledger, keyed by workspace.urlKey', async () => {
    const provider = new FakeWriteProvider({ name: 'seam3-ok' });
    const ledger = makeFakeLedger();
    const app = buildWorkspaceApp({ provider, harbourCommentsStore: ledger });

    const { status, body } = await postWorkspaceComment(app, 'acme-ws', ISSUE_ID, { body: 'seam3-ok ship it' });

    assert.strictEqual(status, 201);
    assert.strictEqual(ledger.calls.length, 1);
    assert.strictEqual(ledger.calls[0].urlKey, 'acme-ws');
    assert.strictEqual(ledger.calls[0].commentId, body.comment.id);
  });

  test('LOAD-BEARING: a ledger write that throws does not fail the comment write — the route still 201s with the normal payload', async () => {
    const provider = new FakeWriteProvider({ name: 'seam3-throw' });
    const ledger = makeFakeLedger({ throwOnRecord: true });
    const app = buildWorkspaceApp({ provider, harbourCommentsStore: ledger });

    const { status, body } = await postWorkspaceComment(app, 'acme-ws', ISSUE_ID, { body: 'seam3-throw ship it' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.match(body.comment.body, /Ruling recorded via Harbour/);
    assert.strictEqual(ledger.calls.length, 1);
  });

  test('no harbourCommentsStore configured → route still 201s (optional dependency, never a hard failure)', async () => {
    const provider = new FakeWriteProvider({ name: 'seam3-nostore' });
    const app = buildWorkspaceApp({ provider, harbourCommentsStore: null });

    const { status } = await postWorkspaceComment(app, 'acme-ws2', ISSUE_ID, { body: 'seam3-nostore ship it' });
    assert.strictEqual(status, 201);
  });
});

describe('end-to-end — an agent comment written through the proxy is recorded, and is not foreign to wereRecordedByHarbour', () => {
  test('the REAL HarbourCommentsStore, wired at seam 1, reports the new comment id as recorded — and a never-written id as not', async () => {
    const provider = new FakeWriteProvider({ name: 'seam1-e2e' });
    const harbourCommentsStore = new HarbourCommentsStore({ collection: createMockCollection() });
    const app = buildProxyApp({ provider, harbourCommentsStore });

    const { status, body } = await postProxyComment(app, ISSUE_ID, { body: 'agent wrote this' });
    assert.strictEqual(status, 201);
    const newCommentId = body.comment.id;

    const recorded = await harbourCommentsStore.wereRecordedByHarbour('acme', [newCommentId]);
    assert.ok(recorded.has(newCommentId), 'the comment id written through the proxy must read as Harbour-authored');

    const foreignId = 'a-human-typed-this-directly-in-linear';
    const notForeign = await harbourCommentsStore.wereRecordedByHarbour('acme', [foreignId]);
    assert.ok(!notForeign.has(foreignId), 'an unrecorded (human-authored) id must not read as Harbour-authored');
  });
});
