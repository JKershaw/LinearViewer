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

import { LEDGER_ATTEMPTS } from '../../lib/harbour-comment-post.js';
import { configureCommentIngest } from '../../lib/comment-ingest.js';
import { fixedIdOf } from '../../lib/records/refs.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { createDashboardRoutes } from '../../routes/dashboard.js';
import { createProxyRoutes } from '../../routes/proxy.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { createSessionsFeedCache } from '../../lib/sessions-feed-cache.js';
import { InMemoryRunSummaryCacheStore } from '../../lib/run-summary-cache.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';
import { randomUUID } from 'node:crypto';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { readBindingCredential, readWorkspaceCredential, setWorkspaceCredential } from '../../lib/connection-binding.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// LIN-4541: a dispatch store the comment route must never touch. The route stamps nothing now (answers as comments
// retired), so any call on it is a failure the test reports.
function makeUntouchableDispatchQueueStore() {
  const calls = [];
  const store = new Proxy({}, { get: (_t, name) => (...args) => { calls.push({ name, args }); throw new Error(`the comment route called dispatchQueueStore.${String(name)}`); } });
  return { store, calls };
}

// =============================================================================
// LIN-2933: session-lane one-shot auth-recovery fixtures.
// =============================================================================
//
// Credential-keyed (not count-keyed — see the ticket's research comment
// `22a3db2b`, which found a count-keyed stub goes green on a client-only
// retry that would have failed 5/5 on the real 2026-09-23 incident). Rejects
// `createComment` for exactly the tokens named `rejectedTokens`, accepting
// every other token. `issueWriteGuard` never rejects on credential grounds —
// it exists so the route's two-call recovery shape (guard, then create) is
// exercised without making guard a second independent credential gate; this
// is what makes the plan's own call-count assertions ("issueWriteGuard/
// createComment each called exactly twice") land exactly.
function makeCredentialKeyedProvider({ name = 'linear', displayName = 'Linear', rejectedTokens = [] } = {}) {
  const calls = { createComment: [], issueWriteGuard: [] };
  const rejects = (token) => rejectedTokens.includes(token);
  const authError = () => {
    const err = new Error('Authentication required, not authenticated');
    err.status = 401;
    return err;
  };
  const provider = {
    name,
    ui: { displayName },
    supports: (cap) => cap === 'createComment',
    async issueWriteGuard(token) {
      calls.issueWriteGuard.push(token);
      return { id: 'iss-1', trashed: false, team: { id: 'team-x' } };
    },
    async createComment(token, issueId, body) {
      calls.createComment.push(token);
      if (rejects(token)) throw authError();
      return { success: true, comment: { id: `c-${calls.createComment.length}`, body, createdAt: new Date().toISOString(), user: { name: displayName } } };
    },
  };
  return { provider, calls };
}

// A fake `ownerCredentialStore`: `.get` always returns the same fixed
// `record` (or `null`), regardless of how many times it's called — the
// caller asserts the CALL COUNT itself to pin one-shot behavior (plan-review
// R1's case (d): call-count-on-guard/create alone can't distinguish "no
// loop" from "a loop that happened to stop here", but `store.get`'s count
// can).
function makeFakeOwnerCredentialStore(record) {
  const calls = [];
  const store = {
    async get(accountId, urlKey, provider) {
      calls.push({ accountId, urlKey, provider });
      return record;
    },
  };
  return { store, calls };
}

function makeRecoverySession({ accountId = 'acct-1', saveError = null } = {}) {
  return { accountId, save: (cb) => cb(saveError) };
}

// LIN-2664 F2: the ORIGINAL create's ledger write fails every attempt of its
// bounded retry (LIN-4535), then heals — models a harbour-comments ledger outage
// that has cleared by the time a dedupe-hit resubmission re-attempts the record.
function makeFlakyHarbourCommentsStore() {
  const calls = [];
  let attempt = 0;
  return {
    calls,
    async record({ urlKey, commentId }) {
      attempt += 1;
      calls.push({ urlKey, commentId, attempt });
      if (attempt <= LEDGER_ATTEMPTS) throw new Error('ledger down (the original create\'s attempts)');
      return { urlKey, commentId, recordedAt: new Date().toISOString() };
    },
  };
}

// A plain (never-fails) harbour-comments ledger spy — LIN-2933 L2, close-out
// ledger item `b1ab28d5`: used to prove a RECOVERED retry still runs the
// shared success tail's ledger write exactly once, carrying the retry's own
// comment id (never the original, failed attempt's).
function makeSpyHarbourCommentsStore() {
  const calls = [];
  return {
    calls,
    async record({ urlKey, commentId }) {
      calls.push({ urlKey, commentId });
      return { urlKey, commentId, recordedAt: new Date().toISOString() };
    },
  };
}

function buildApp({ provider, session, dispatchQueueStore, harbourCommentsStore, ownerCredentialStore, workspaceOverrides, adoptConnectionCredential, onWorkspace } = {}) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());

  const workspaceRouter = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: PROVIDER_NAME, accessToken: 'ws-token', ...workspaceOverrides };
      // LIN-3861: a per-request hook (the connection-backed adopt tests hydrate the request's
      // workspace credential here, as lib/connection-credential.js does, and keep the object).
      if (onWorkspace) onWorkspace(req.workspace);
      req.session = session || { accountId: 'acct-1' };
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {},
    reportHistoryStore: {}, dispatchQueueStore: dispatchQueueStore || {}, agentStatusStore: {}, promptTraceStore: {},
    harbourCommentsStore,
    // LIN-2933: the session-lane one-shot auth-recovery store. null by
    // default (every existing test above is unaffected — recovery is simply
    // never eligible without one), injected explicitly by the recovery
    // describe block below.
    ownerCredentialStore,
    // LIN-3861: the connection-backed adopt entrant (LIN-2933 / LIN-3124 D7); optional, so every
    // test that does not pass it is unchanged (the route defaults it to null).
    ...(adoptConnectionCredential ? { adoptConnectionCredential } : {}),
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
    agentStatusStore: {}, dispatchQueueStore: {},
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
  test('201 happy path → { success, comment }; the body is the person\'s words, with no ruling mark (LIN-4541)', async () => {
    const { provider, calls } = makeFakeProvider();
    const app = buildApp({ provider });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'ship it' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.comment.body, 'ship it');
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(calls.createComment[0].issueId, ISSUE_ID);
  });

  // LIN-4541 (LIN-4529 P7b-2): a comment is never an answer. Ruling ids in a body are ignored like any other unknown key:
  // no stamp, no settled-ruling refusal, no 400 for a malformed copy list; the comment is written as the person's words.
  test('LIN-4541: ruling ids in the body are ignored — the comment is written, nothing is stamped or refused', async () => {
    const { provider, calls } = makeFakeProvider();
    const { store: dispatchQueueStore, calls: storeCalls } = makeUntouchableDispatchQueueStore();
    const app = buildApp({ provider, dispatchQueueStore });

    const { status, body } = await postComment(app, ISSUE_ID, {
      body: 'pick b', decisionLoopId: 'loop-1', decisionId: 'd-1', decisionLoopIds: 'not-a-list', optionId: 'b',
      taskDecisionId: 't-1', taskDecisionIssueId: ISSUE_ID, answerAttemptId: 'a-1'
    });

    assert.strictEqual(status, 201, JSON.stringify(body));
    assert.strictEqual(body.comment.body, 'pick b');
    assert.strictEqual(calls.createComment.length, 1);
    assert.deepStrictEqual(storeCalls, [], 'the route never touches the dispatch store');
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
    assert.strictEqual(harbourCommentsStore.calls.length, LEDGER_ATTEMPTS, 'the original create attempted (and failed) its ledger record every time');

    const second = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true, 'still served from the dedupe cache — no second comment minted');
    assert.strictEqual(calls.createComment.length, 1, 'no second provider write on the dedupe hit');
    assert.strictEqual(harbourCommentsStore.calls.length, LEDGER_ATTEMPTS + 1, 'the dedupe hit re-attempted the ledger record');
    assert.strictEqual(
      harbourCommentsStore.calls[1].commentId,
      first.body.comment.id,
      'the repair attempt targets the SAME comment id the original create minted'
    );
  });

  // LIN-4548: a finding writer that fails its first `failFirst` writes, then files.
  function configureFlakyFindings({ failFirst }) {
    const findings = new Map();
    let attempts = 0;
    configureCommentIngest({
      writes: {
        async add({ input, by, via, fixedId }) {
          attempts += 1;
          if (attempts <= failFirst) throw new Error('records down');
          if (!findings.has(fixedId)) findings.set(fixedId, { by, via, in: input.in });
          return { record: { id: fixedId } };
        },
        async end() { return {}; }
      },
      listPeople: async () => [], cutoffOf: async () => null, ledger: { async wereRecordedByHarbour() { return new Set(); } },
      taskForTicket: async (_u, ticket) => (ticket === ISSUE_ID ? 'task-901' : null), taskOfTicket: async () => null
    });
    return findings;
  }

  test('LIN-4548: the first finding write fails; the member\'s identical repeat (a dedupe hit) files exactly one finding, by that member', async () => {
    const findings = configureFlakyFindings({ failFirst: 1 });
    try {
      const { provider } = makeFakeProvider();
      const app = buildApp({ provider, session: { accountId: 'member-4548a' }, harbourCommentsStore: makeSpyHarbourCommentsStore() });
      const payload = { body: 'LIN-4548 reply whose first finding write fails' };
      const first = await postComment(app, ISSUE_ID, payload);
      assert.strictEqual(first.status, 201, 'the comment is written whatever the finding does');
      assert.strictEqual(findings.size, 0, 'the first finding write failed');
      const again = await postComment(app, ISSUE_ID, payload);
      assert.strictEqual(again.status, 200);
      assert.strictEqual(again.body.deduped, true);
      assert.deepStrictEqual([...findings.entries()], [[fixedIdOf('finding', 'comment', first.body.comment.id), { by: 'person:member-4548a', via: 'comment', in: 'task-901' }]]);
    } finally {
      configureCommentIngest(null);
    }
  });

  test('LIN-4548: another member\'s identical reply (a dedupe hit) repairs under the ORIGINAL member, never the one repeating', async () => {
    const findings = configureFlakyFindings({ failFirst: 1 });
    try {
      const { provider } = makeFakeProvider();
      const payload = { body: 'LIN-4548 two members send the same words' };
      const first = await postComment(buildApp({ provider, session: { accountId: 'member-4548a' }, harbourCommentsStore: makeSpyHarbourCommentsStore() }), ISSUE_ID, payload);
      assert.strictEqual(first.status, 201);
      assert.strictEqual(findings.size, 0, 'member A\'s finding write failed');
      const other = await postComment(buildApp({ provider, session: { accountId: 'member-4548b' }, harbourCommentsStore: makeSpyHarbourCommentsStore() }), ISSUE_ID, payload);
      assert.strictEqual(other.status, 200);
      assert.strictEqual(other.body.deduped, true);
      assert.deepStrictEqual([...findings.values()].map(f => f.by), ['person:member-4548a']);
    } finally {
      configureCommentIngest(null);
    }
  });
});

// =============================================================================
// LIN-2933: session-lane one-shot auth-recovery, wired into this route's
// catch. Approved plan (revision 3, comment `13cc8aaf`), folding in R1
// (error boundary), R2 (production wiring pin) and R3 (provider attribution)
// from the second plan-review verdict (comment `d3075231`).
// =============================================================================
describe('POST /workspace/:urlKey/api/comments/:issueId — session-lane auth recovery (LIN-2933)', () => {
  const REJECTED_TOKEN = 'session-token-dead';
  const FRESH_TOKEN = 'durable-token-fresh';

  test('(a) a different durable credential exists → adopt, mirror, retry once, 201', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 recovery success' });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.deepStrictEqual(calls.issueWriteGuard, [REJECTED_TOKEN, FRESH_TOKEN], 'guard runs on the original attempt and again on the retry');
    assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, FRESH_TOKEN], 'create runs on the original attempt and again on the retry');
    assert.strictEqual(storeCalls.length, 1, 'exactly one durable point-read');
  });

  // LIN-2933 close-out ledger L2 (review `b1ab28d5`): a RECOVERED retry must
  // run the SAME shared success tail (`finishCommentSuccess`) the original
  // attempt would have — dedupe write, ledger record, and decision/task
  // stamp — exactly once, keyed on the retry's own comment id. Mutation M10
  // (the retry returning 201 directly, bypassing the tail) survives every
  // other case in this file without this one.
  test('(a2) L2: a recovered retry runs the shared success tail exactly once — ledger record (retry\'s comment id) and dedupe on an identical re-press with no third createComment', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const harbourCommentsStore = makeSpyHarbourCommentsStore();
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      harbourCommentsStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });
    const payload = { body: 'LIN-2933 L2 recovered success tail' };

    const first = await postComment(app, ISSUE_ID, payload);

    assert.strictEqual(first.status, 201);
    assert.strictEqual(first.body.success, true);
    assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, FRESH_TOKEN], 'the original attempt fails; the recovered retry is what actually creates the comment');
    const retryCommentId = first.body.comment.id;

    assert.strictEqual(harbourCommentsStore.calls.length, 1, 'exactly one ledger record for the recovered write');
    assert.strictEqual(harbourCommentsStore.calls[0].commentId, retryCommentId, 'the ledger record must carry the RETRY\'s comment id, never a stale/absent original-attempt id');

    // An identical resubmission must hit the dedupe cache the recovered
    // retry just populated — 200/deduped:true, no third provider write, and
    // no second recovery attempt (no second durable point-read either).
    const second = await postComment(app, ISSUE_ID, payload);
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.deduped, true);
    assert.strictEqual(second.body.comment.id, retryCommentId);
    assert.strictEqual(calls.createComment.length, 2, 'the identical resubmission must not mint a third comment');
    assert.strictEqual(storeCalls.length, 1, 'the dedupe hit must not attempt a second durable-credential read');
  });

  // LIN-4548: the member's finding is filed by the comment seam, so a recovered retry files it once, under the retry's
  // comment id, and an identical re-press (a dedupe hit) files no second one.
  test('(a3) LIN-4548: a recovered retry files the member\'s finding once, under the retry\'s comment id', async () => {
    const findings = new Map();
    configureCommentIngest({
      writes: {
        async add({ input, by, via, fixedId }) {
          if (!findings.has(fixedId)) findings.set(fixedId, { by, via, in: input.in });
          return { record: { id: fixedId } };
        },
        async end() { return {}; }
      },
      listPeople: async () => [], cutoffOf: async () => null, ledger: { async wereRecordedByHarbour() { return new Set(); } },
      taskForTicket: async (_u, ticket) => (ticket === ISSUE_ID ? 'task-901' : null), taskOfTicket: async () => null
    });
    try {
      const { provider } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
      const { store: ownerCredentialStore } = makeFakeOwnerCredentialStore({ token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear' });
      const app = buildApp({
        provider, session: makeRecoverySession({ accountId: 'member-9' }), ownerCredentialStore,
        harbourCommentsStore: makeSpyHarbourCommentsStore(),
        workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
      });
      const payload = { body: 'LIN-4548 recovered reply finding' };
      const first = await postComment(app, ISSUE_ID, payload);
      assert.strictEqual(first.status, 201);
      assert.deepStrictEqual([...findings.entries()], [[fixedIdOf('finding', 'comment', first.body.comment.id), { by: 'person:member-9', via: 'comment', in: 'task-901' }]]);
      const second = await postComment(app, ISSUE_ID, payload);
      assert.strictEqual(second.status, 200);
      assert.strictEqual(findings.size, 1);
    } finally {
      configureCommentIngest(null);
    }
  });

  test('(b) the durable store holds the SAME dead credential → no recovery, classified 500, retryable:false', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: REJECTED_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 persistent auth failure' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.error, 'Failed to create comment');
    assert.strictEqual(body.code, 'LINEAR_AUTH');
    assert.strictEqual(body.category, 'auth');
    assert.strictEqual(body.retryable, false, 'a final auth failure must never read as retryable — the client must not auto-resend it');
    assert.match(body.detail, /Linear/);
    assert.ok(!('message' in body), 'the raw upstream err.message must never be exposed');
    assert.strictEqual(calls.issueWriteGuard.length, 1);
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 1, 'adopt was attempted — it just found nothing different');
  });

  test('(c) a `?source=` query param excludes recovery even when a different durable credential exists', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await call(app, 'POST', `/workspace/acme/api/comments/${ISSUE_ID}?source=linear`, { body: 'LIN-2933 source exclusion' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.code, 'LINEAR_AUTH');
    assert.strictEqual(calls.issueWriteGuard.length, 1);
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 0, 'a `?source`-bound request never attempts recovery, regardless of what the durable store holds');
  });

  test('(d) the durable store holds a DIFFERENT credential that is ALSO rejected → one-shot recovery, classified 500, store.get called exactly once', async () => {
    const ALSO_DEAD_TOKEN = 'durable-token-also-dead';
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN, ALSO_DEAD_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: ALSO_DEAD_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 different-but-still-rejected' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.code, 'LINEAR_AUTH');
    assert.strictEqual(body.retryable, false);
    assert.deepStrictEqual(calls.issueWriteGuard, [REJECTED_TOKEN, ALSO_DEAD_TOKEN]);
    assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, ALSO_DEAD_TOKEN]);
    assert.strictEqual(storeCalls.length, 1, 'a second rejection must not trigger a second adopt attempt — one-shot is structural, not counted on the retry');
  });

  test('(e) a failing session.save aborts the retry → classified 500, not a hang; guard/create called once (original only)', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider,
      session: makeRecoverySession({ saveError: new Error('session store down') }),
      ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 failed session save' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.error, 'Failed to create comment');
    // Not necessarily LINEAR_AUTH — a session-store failure is not an
    // upstream-auth shape. classifyUpstreamError's INTERNAL_ERROR/internal/
    // retryable:false fallback is expected and acceptable here (plan-review
    // case (e)); the load-bearing assertion is that a response is sent at
    // all, never a hang.
    assert.strictEqual(body.category, 'internal');
    assert.strictEqual(body.retryable, false);
    assert.strictEqual(calls.issueWriteGuard.length, 1, 'the retry never runs — the save that must precede it failed');
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 1);
  });

  test("(f) a non-Linear provider's 401 names its own provider, never Linear, and recovery is skipped", async () => {
    const JIRA_TOKEN = 'jira-token-dead';
    const { provider, calls } = makeCredentialKeyedProvider({ name: 'comment-write-fake-jira', displayName: 'Jira', rejectedTokens: [JIRA_TOKEN] });
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore({
      token: 'jira-token-fresh', tokenExpiresAt: Date.now() + 3600_000, provider: 'comment-write-fake-jira',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'comment-write-fake-jira', accessToken: JIRA_TOKEN },
    });

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 non-Linear provider attribution' });

    assert.strictEqual(status, 500);
    assert.strictEqual(body.code, 'LINEAR_AUTH', 'the code vocabulary is provider-agnostic by design — only the human string varies');
    assert.match(body.detail, /Jira/);
    assert.doesNotMatch(body.detail, /Linear/);
    assert.strictEqual(calls.issueWriteGuard.length, 1);
    assert.strictEqual(calls.createComment.length, 1);
    assert.strictEqual(storeCalls.length, 0, 'recovery is gated to provider.name === "linear" — never attempted for a non-Linear provider');
  });

  // Plan-review implementation note 4 (not blocking, folded in anyway): a
  // retried guard that reports the issue trashed gets the same 409 the main
  // path gives, not a classified 500.
  test('a retry whose guard reports the issue trashed gets the same 409 as the main path', async () => {
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [REJECTED_TOKEN] });
    provider.issueWriteGuard = async (token) => {
      calls.issueWriteGuard.push(token);
      return { id: 'iss-1', trashed: true, team: { id: 'team-x' } };
    };
    const { store: ownerCredentialStore } = makeFakeOwnerCredentialStore({
      token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear',
    });
    const app = buildApp({
      provider, session: makeRecoverySession(), ownerCredentialStore,
      workspaceOverrides: { provider: 'linear', accessToken: REJECTED_TOKEN },
    });

    // The original attempt's guard reports trashed too — a direct 409, no
    // provider auth rejection, so recovery is never even reached. Route the
    // ORIGINAL attempt's failure through createComment instead, so recovery
    // is entered, and only the RETRY's guard reports trashed.
    let guardCalls = 0;
    provider.issueWriteGuard = async (token) => {
      guardCalls += 1;
      calls.issueWriteGuard.push(token);
      return guardCalls === 1
        ? { id: 'iss-1', trashed: false, team: { id: 'team-x' } }
        : { id: 'iss-1', trashed: true, team: { id: 'team-x' } };
    };

    const { status, body } = await postComment(app, ISSUE_ID, { body: 'LIN-2933 retried guard trashed' });

    assert.strictEqual(status, 409);
    assert.match(body.error, /trashed/i);
    assert.strictEqual(guardCalls, 2);
    assert.strictEqual(calls.createComment.length, 1, 'the retry never reaches createComment — the retried guard already terminated it');
  });
});

// =============================================================================
// LIN-3861: the connection-backed adopt entrant (LIN-2933 / LIN-3124 D7), driven over HTTP.
// This replaces the four source-text regexes on routes/workspace-api.js that
// tests/unit/lin-3124-pr3-checkpoint-c3.test.js used to carry: a connection-backed
// workspace adopts through the injected `adoptConnectionCredential({ workspace,
// ownerAccountId, fingerprint })`, then hydrates the binding (`setBindingCredential`) and
// the workspace (`setWorkspaceCredential`), because `applyAccessTokenToWorkspace` no-ops
// for it. Each construct has its own failing mutation (see the PR): (a) the adopt call
// replaced by null, (b) the setBindingCredential line deleted, (c) the setWorkspaceCredential
// line deleted, (d) `activeConnectionBackedBinding(workspace)?.connectionId` replaced by null.
// Credentials are built at run time (no token-shaped literal; lib/secret-scan.js reads tests too).
// =============================================================================
describe('POST /workspace/:urlKey/api/comments/:issueId — connection-backed adopt entrant (LIN-3861, was lin-3124-pr3-checkpoint-c3)', () => {
  const runtimeToken = (label) => `${label}-${randomUUID()}`;

  // A connection-backed active Linear binding; the request's workspace is hydrated with
  // the stale credential (the side-table is the only place a connection-backed
  // workspace's credential lives). `session.accountId` is the owner the spy must see.
  function connectionBackedFixture({ adopted = true } = {}) {
    const staleToken = runtimeToken('stale');
    const adoptedToken = runtimeToken('adopted');
    const events = [];
    const binding = { provider: 'linear', scope: 'acme', connectionId: `conn-${randomUUID()}` };
    const adoptedBag = { token: adoptedToken, tokenExpiresAt: Date.now() + 3600_000 };
    const adoptCalls = [];
    const adoptConnectionCredential = async (args) => {
      adoptCalls.push(args);
      events.push('adopt');
      return adopted ? { binding, credentialBag: adoptedBag, token: adoptedToken, expiresAt: adoptedBag.tokenExpiresAt } : null;
    };
    const workspaces = [];
    const onWorkspace = (workspace) => {
      workspaces.push(workspace);
      setWorkspaceCredential(workspace, { token: staleToken, tokenExpiresAt: Date.now() + 3600_000 });
    };
    const { provider, calls } = makeCredentialKeyedProvider({ rejectedTokens: [staleToken] });
    const createComment = provider.createComment;
    provider.createComment = async (token, ...rest) => {
      events.push(token === staleToken ? 'create:stale' : 'create:other');
      return createComment.call(provider, token, ...rest);
    };
    // A durable-store the legacy path would read: never consulted by the connection arm, and
    // present because the recovery's eligibility needs one. It holds nothing to adopt.
    const { store: ownerCredentialStore, calls: storeCalls } = makeFakeOwnerCredentialStore(null);
    const session = makeRecoverySession({ accountId: `acct-${randomUUID()}` });
    const app = buildApp({
      provider, session, ownerCredentialStore, adoptConnectionCredential, onWorkspace,
      workspaceOverrides: { provider: 'linear', accessToken: undefined, activeBinding: { provider: 'linear', scope: 'acme' }, bindings: [binding] },
    });
    return { app, provider, calls, binding, adoptedBag, adoptedToken, staleToken, adoptCalls, events, storeCalls, session, workspaces };
  }

  test('a rejected write on a connection-backed workspace adopts through the injected seam, hydrates binding and workspace, retries with the adopted token, 201', async () => {
    const f = connectionBackedFixture();

    const { status, body } = await postComment(f.app, ISSUE_ID, { body: 'LIN-3861 connection-backed adopt' });

    // Positive control: the first write was attempted with the stale credential and refused,
    // before the adopt ran; a fixture that stops short of the 401 catch cannot pass this.
    assert.deepStrictEqual(f.events, ['create:stale', 'adopt', 'create:other'], 'stale write refused, then adopt, then the retry');
    assert.deepStrictEqual(f.calls.createComment, [f.staleToken, f.adoptedToken], 'the retry carries the adopted token');
    assert.deepStrictEqual(f.calls.issueWriteGuard, [f.staleToken, f.adoptedToken], 'the retried guard carries the adopted token too');

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(f.adoptCalls.length, 1, 'the adopt seam is called once');
    const [args] = f.adoptCalls;
    assert.strictEqual(args.ownerAccountId, f.session.accountId, 'the owner is the session account');
    assert.strictEqual(args.fingerprint, fingerprintCredential(f.staleToken), 'the fingerprint is that of the credential that was refused');
    assert.strictEqual(args.workspace, f.workspaces[0], 'the request workspace is handed to the seam');
    assert.strictEqual(f.storeCalls.length, 0, 'the legacy durable store is not consulted for a connection-backed workspace');

    assert.strictEqual(readBindingCredential(f.binding), f.adoptedBag, 'the binding holds the adopted bag');
    assert.strictEqual(readWorkspaceCredential(f.workspaces[0]), f.adoptedBag, 'the workspace holds the adopted bag');
    assert.strictEqual(f.workspaces[0].accessToken, undefined, 'no scalar mirror is written onto a connection-backed workspace');
  });

  test('nothing newer to adopt: the seam is asked once, nothing is hydrated, and there is no retry', async () => {
    const f = connectionBackedFixture({ adopted: false });

    const { status } = await postComment(f.app, ISSUE_ID, { body: 'LIN-3861 connection-backed, nothing to adopt' });

    assert.deepStrictEqual(f.events, ['create:stale', 'adopt'], 'refused once, adopt asked, no retry');
    assert.strictEqual(f.adoptCalls.length, 1);
    assert.deepStrictEqual(f.calls.createComment, [f.staleToken]);
    assert.notStrictEqual(status, 201);
    assert.strictEqual(readBindingCredential(f.binding), undefined, 'nothing was hydrated onto the binding');
    assert.notStrictEqual(readWorkspaceCredential(f.workspaces[0])?.token, f.adoptedToken);
  });
});

describe('server.js production wiring pin (LIN-2933, plan-review R2)', () => {
  const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

  test('server.js must wire ownerCredentialStore into createWorkspaceApiRoutes — otherwise recovery ships fully tested and permanently inert in production', () => {
    assert.match(
      SERVER_SRC,
      /app\.use\(createWorkspaceApiRoutes\(\{[^}]*\bownerCredentialStore\b[^}]*\}\)\)/,
      'server.js must wire ownerCredentialStore into createWorkspaceApiRoutes'
    );
  });
});
