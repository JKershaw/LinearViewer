// =============================================================================
// GET /workspace/:urlKey/api/audit — provider guard on the Linear egress (LIN-1899)
// =============================================================================
//
// The audit route reads the provider-agnostic scalar mirror
// `workspace.accessToken` and hands it straight to a statically Linear-bound
// GraphQL client (lib/audit.js:180 — `new GraphQLClient('https://api.linear.app
// /graphql', { headers: { Authorization: accessToken } })`). For a Jira-active
// workspace that mirror holds the user's raw Jira API token (written by
// linkProvider / mirrorActiveBinding, lib/workspace.js:303 / :417), so the call
// DISCLOSED it to an unrelated third party. That is the defect; the fix is a
// `linear`-only guard immediately before the call.
//
// WHY THESE TESTS ASSERT ON EGRESS, NOT ON STATUS. A status-keyed test is fake
// here: before the fix a Jira-bound audit call ALREADY returned 401 ("Token
// expired or invalid", routes/workspace-api.js) — precisely BECAUSE Linear
// rejected the token it had just been sent. Such a test passes on the
// vulnerable code. The only honest witness is the outbound request itself, so
// every case below counts https calls and reads the Authorization header off
// them, following tests/unit/proxy-attachment-relay.test.js:426-450.
//
// NODE_ENV is set EXPLICITLY per case rather than inherited: `node --test` does
// not set it, the route reads `process.env.NODE_ENV` per request, and the
// production-vs-test split for `provider: 'local'` is the whole point of two of
// these cases.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';

// One response that satisfies all five audit queries at once: the three
// single-shot ones read `teams`/`projects`/`workflowStates`, and the two
// paginated ones read `issueLabels`/`issues` and stop on hasNextPage: false.
function auditGraphQLResponse() {
  const empty = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  return new Response(
    JSON.stringify({
      data: { teams: empty, projects: empty, workflowStates: empty, issueLabels: empty, issues: empty },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

// graphql-request may hand fetch a plain object or a Headers instance; read
// both so the assertion can never pass vacuously on a shape change.
function readAuth(headers) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get('authorization') ?? undefined;
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
  return key ? headers[key] : undefined;
}

function buildApp(workspace) {
  const app = express();
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, ...workspace };
      req.session = { linearUserId: 'user-1' };
      next();
    },
    // Only the factory signature matters here; the audit route uses none of these.
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {},
    briefCacheStore: {}, reportHistoryStore: {}, dispatchQueueStore: {},
    agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {}
  });
  app.use(router);
  return app;
}

async function getAudit(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/ws/api/audit`);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON body stays null */ }
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

describe('GET /api/audit — provider guard (LIN-1899)', () => {
  let realFetch;
  let realNodeEnv;
  let outbound; // every https call the route made, in order

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realNodeEnv = process.env.NODE_ENV;
    outbound = [];
    // The route's upstream call is https; the test client's own call is
    // http://127.0.0.1, so the scheme cleanly separates the two.
    globalThis.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input?.url || '';
      if (u.startsWith('https://')) {
        outbound.push({ url: u, auth: readAuth(init?.headers) });
        return Promise.resolve(auditGraphQLResponse());
      }
      return realFetch(input, init);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = realNodeEnv;
  });

  // ---- the ticket's witness -------------------------------------------------

  test('a Jira-active workspace sends NOTHING to Linear and is refused 422', async () => {
    process.env.NODE_ENV = 'development';
    const res = await getAudit(buildApp({ provider: 'jira', accessToken: 'jira-api-token-abc123' }));

    assert.deepEqual(outbound, [], 'the raw Jira API token must never reach api.linear.app');
    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.equal(res.body.capability, 'audit');
    assert.equal(res.body.provider, 'jira');
  });

  test('a Jira-active workspace is refused under NODE_ENV=test too (the mock does not shield a real token)', async () => {
    // The test-mode mock fires on `accessToken === 'test-token' || provider ===
    // 'local'`, so a realistic Jira fixture falls through to the guard. Pinned
    // so nobody "fixes" a future failure by widening the mock predicate.
    process.env.NODE_ENV = 'test';
    const res = await getAudit(buildApp({ provider: 'jira', accessToken: 'jira-api-token-abc123' }));

    assert.deepEqual(outbound, []);
    assert.equal(res.status, 422);
  });

  // ---- positive controls: the mutation-catchers for a predicate written -----
  // ---- without the `|| 'linear'` legacy fallback ---------------------------

  test('a Linear workspace still reaches the audit and still carries its token', async () => {
    process.env.NODE_ENV = 'development';
    const res = await getAudit(buildApp({ provider: 'linear', accessToken: 'lin-token' }));

    assert.equal(res.status, 200);
    assert.ok(outbound.length > 0, 'a Linear workspace must still call Linear');
    assert.ok(outbound.every(c => c.url.startsWith('https://api.linear.app/graphql')));
    // lib/audit.js sends the bare token (no `Bearer ` prefix) — asserted
    // verbatim so a change to that header shape is visible here.
    assert.equal(outbound[0].auth, 'lin-token');
  });

  test('a LEGACY providerless workspace is treated as Linear and KEEPS its token', async () => {
    // The single most likely regression: writing the predicate as
    // `provider === 'linear'` silently 422s every pre-binding workspace.
    process.env.NODE_ENV = 'development';
    const res = await getAudit(buildApp({ accessToken: 'lin-token' }));

    assert.equal(res.status, 200);
    assert.ok(outbound.length > 0, 'a legacy (providerless) workspace must still reach Linear');
    assert.equal(outbound[0].auth, 'lin-token');
  });

  // ---- provider: 'local' — decided in both directions ----------------------

  test("provider 'local' under NODE_ENV=test still gets the mock report (LIN-412 carve-out survives)", async () => {
    // The guard sits AFTER the mock branch precisely so this keeps working;
    // tests/e2e/audit.spec.js runs its whole authenticated surface on a genuine
    // `provider: 'local'` seed (routes/test.js:856).
    process.env.NODE_ENV = 'test';
    const res = await getAudit(buildApp({ provider: 'local', accessToken: 'ws' }));

    assert.equal(res.status, 200);
    assert.ok(res.body.workspace, 'expected the deterministic mock audit report');
    assert.deepEqual(outbound, [], 'the mock must not touch the network');
  });

  test("provider 'local' in production is refused 422 (deliberate behaviour change)", async () => {
    // Today a local workspace sends its urlKey — its whole "credential" — to
    // Linear and collects a meaningless 401. 422 is the honest answer, and it
    // pins the `linear`-only rule: a predicate widened to `linear || local`
    // turns this red.
    process.env.NODE_ENV = 'development';
    const res = await getAudit(buildApp({ provider: 'local', accessToken: 'ws' }));

    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'CAPABILITY_NOT_SUPPORTED');
    assert.deepEqual(outbound, []);
  });
});
