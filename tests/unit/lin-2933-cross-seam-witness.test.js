/**
 * LIN-2933 committed cross-seam witness (approved plan step 7 — the
 * research's scratch harness, comment `22a3db2b` §2, made permanent).
 *
 * The ticket's research found that NO existing test crosses the real
 * client → route seam for a ruling reply: tests/unit/reply-delivery-
 * contract.test.js exercises the real public/common.js but against a
 * stubbed fetch, and the Observation row's own suite (retired with the row,
 * LIN-4541) exercised the page with window.ReplyDelivery itself stubbed out.
 * Both individually-real halves can hide a defect at
 * the seam between them — which is exactly what the ticket's own
 * originally-proposed COUNT-keyed witness did (it passed a client-only
 * retry that would have failed 5/5 on the real 2026-09-23 incident; see the
 * research comment for the decisive experiment).
 *
 * This file combines, for real, the client and the route: the real `window.ReplyDelivery.postComment` (public/common.js,
 * unstubbed, the write every reply surface goes through) and a real HTTP round-trip to the real Express comment route
 * (routes/workspace-api-issue-write.js, registered by createWorkspaceApiRoutes) — against a CREDENTIAL-KEYED fake Linear
 * provider, not a count-keyed one, per the research's own correction.
 *
 * LIN-4541: the witness used to start from the Observation ruling row's press handler (`deliverRulingReply`) and read its
 * feedback line. That row and its handler retired with the ruling machinery (a question is answered on its question
 * record's card, through its own route), so the witness now starts one step in, at the shared client write, and reads the
 * `{ok, status, data}` it hands every caller and the Error `errorFromResult` builds from it. The route-level recovery cases
 * (a)-(f) live in tests/unit/comment-write-route.test.js; this file's job is the one cross-seam proof step 7 calls for.
 *
 * Two cases, mirroring the research's own decisive experiment (§2):
 *  - credential-keyed recovery → the write lands (201).
 *  - persistent dead credential → the named LINEAR_AUTH cause reaches the client's Error, and the comment is never recorded.
 *
 * common.js is a classic script that must run in the realm (it is what puts window.ReplyDelivery on the global), so it is
 * run once per file with `runClassic`: its top-level const and let bindings cannot be declared twice in one realm.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { registerProvider } from '../../lib/providers/registry.js';
import { harnessModelsBlock } from '../../lib/model-routing-harnesses.js';
import { importWorld } from './helpers/import-world.js';

// ─── World: the REAL common.js + the REAL observation.js, sharing one window ───

// The real fetch, captured before importWorld installs the relative-URL stub below, which calls it.
const realFetch = globalThis.fetch;

// The origin of the server the current test started. `window.ReplyDelivery.postComment` builds `/workspace/...` paths,
// and the world's `fetch` resolves them against this origin, so the call is a real round-trip. It is read through
// a getter and a closure, so the one common.js run below serves every test.
let origin = '';

// common.js runs once for the file, in this realm. `__HARNESS_MODELS__` is the block a rendered page carries (common.js
// reads it at load). Stubs go on the global first, as a page's own window is set before its scripts run.
const world = await importWorld({
  window: {
    __HARNESS_MODELS__: harnessModelsBlock(),
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
    location: { get origin() { return origin; } },
  },
  globals: {
    confirm: () => true,
    localStorage: { getItem: () => null, setItem() {} },
    escapeHtml: (str) => (str === undefined || str === null ? '' : String(str)),
    relativeTime: (ts) => (ts ? `stub-relative-time(${ts})` : ''),
    console: { warn() {}, error() {}, log() {} },
    // Relative-URL fetch, real network — window.ReplyDelivery.postComment
    // builds `/workspace/...` paths, and native fetch needs an absolute URL.
    fetch(url, opts) {
      const absolute = typeof url === 'string' && url.startsWith('/') ? origin + url : url;
      return realFetch(absolute, opts);
    },
  },
});
world.runClassic('common.js');
after(() => world.restore());

// ─── Credential-keyed fake Linear provider + owner-credential store ───────

function authError() {
  const err = new Error('Authentication required, not authenticated');
  err.status = 401;
  return err;
}

function makeCredentialKeyedProvider(rejectedTokens) {
  const calls = { createComment: [] };
  const provider = {
    name: 'linear',
    ui: { displayName: 'Linear' },
    supports: (cap) => cap === 'createComment',
    async issueWriteGuard() { return { id: 'iss-1', trashed: false, team: { id: 'team-x' } }; },
    async createComment(token, issueId, body) {
      calls.createComment.push(token);
      if (rejectedTokens.includes(token)) throw authError();
      return { success: true, comment: { id: `c-${calls.createComment.length}`, body, createdAt: new Date().toISOString(), user: { name: 'Linear' } } };
    },
  };
  return { provider, calls };
}

function makeOwnerCredentialStore(record) {
  const calls = [];
  return { store: { async get(accountId, urlKey, providerName) { calls.push({ accountId, urlKey, providerName }); return record; } }, calls };
}

async function startApp({ provider, ownerCredentialStore, accessToken }) {
  registerProvider(provider);
  const app = express();
  app.use(express.json());
  const session = { accountId: 'acct-witness', save: (cb) => cb(null) };
  app.use(createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: URL_KEY, provider: 'linear', accessToken };
      req.session = session;
      next();
    },
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    customPromptsStore: {},
    reportHistoryStore: {}, dispatchQueueStore: {}, agentStatusStore: {}, promptTraceStore: {},
    harbourCommentsStore: null,
    ownerCredentialStore,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  return server;
}

const URL_KEY = 'the-witness-workspace';
const REJECTED_TOKEN = 'session-token-dead';
const FRESH_TOKEN = 'durable-token-fresh';

const ISSUE_ID = '11111111-2222-3333-4444-555555555555';

describe('LIN-2933 cross-seam witness: real window.ReplyDelivery.postComment → real comment route', () => {
  test('credential-keyed recovery: the write lands, provider called original+retry', async () => {
    const { provider, calls } = makeCredentialKeyedProvider([REJECTED_TOKEN]);
    const { store: ownerCredentialStore } = makeOwnerCredentialStore({ token: FRESH_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear' });
    const server = await startApp({ provider, ownerCredentialStore, accessToken: REJECTED_TOKEN });
    try {
      origin = `http://127.0.0.1:${server.address().port}`;
      // Distinct text from the other case below — the route's dedupe cache is keyed on (urlKey, issueId, body, generation)
      // and is a MODULE-LEVEL cache shared across every test in this process; an identical body would make the second
      // case a cache hit instead of a real write.
      const result = await world.window.ReplyDelivery.postComment(URL_KEY, ISSUE_ID, 'Approve — recovery case');
      assert.equal(result.ok, true, `the write lands once the server has adopted a different credential: ${JSON.stringify(result.data)}`);
      assert.equal(result.status, 201);
      assert.deepStrictEqual(calls.createComment, [REJECTED_TOKEN, FRESH_TOKEN], 'the original attempt used the dead session token; the recovered retry used the adopted one');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('persistent dead credential: the named LINEAR_AUTH cause reaches the client, and no comment is ever recorded', async () => {
    const { provider, calls } = makeCredentialKeyedProvider([REJECTED_TOKEN]);
    const { store: ownerCredentialStore } = makeOwnerCredentialStore({ token: REJECTED_TOKEN, tokenExpiresAt: Date.now() + 3600_000, provider: 'linear' });
    const server = await startApp({ provider, ownerCredentialStore, accessToken: REJECTED_TOKEN });
    try {
      origin = `http://127.0.0.1:${server.address().port}`;
      const result = await world.window.ReplyDelivery.postComment(URL_KEY, ISSUE_ID, 'Approve — persistent-failure case');
      assert.equal(result.ok, false);
      const err = world.window.ReplyDelivery.errorFromResult(result);
      assert.equal(err.code, 'LINEAR_AUTH', 'the classified cause reaches the client, not a bare "Failed to create comment"');
      assert.strictEqual(calls.createComment.length, 1, 'no comment is ever recorded for a write that never succeeded');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
