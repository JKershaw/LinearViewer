// =============================================================================
// GET /workspace/:urlKey/api/audit — behaviour tests for the two untested arms (LIN-3885)
// =============================================================================
//
// Two arms of routes/workspace-api-audit.js had no unit witness, so both
// mutants survived the whole unit suite (LIN-3883 review, M3 and M4):
//
//   M3  the catch arm's `failureOf(error, 'Audit failed', { notFound: false })`
//       flipped to `notFound: true`. A "not found" failure from runAudit must
//       still answer 500 with the audit envelope, not be suppressed into 404.
//   M4  `runAudit(getWorkspaceToken(workspace))` flipped to
//       `runAudit(workspace.accessToken)`. For an UNHYDRATED connection-backed
//       Linear workspace getWorkspaceToken returns undefined on purpose (fail
//       closed); the stray scalar mirror must never be sent to api.linear.app
//       (the LIN-1899 class). A hydrated workspace must send its hydrated token.
//
// SEAM. runAudit is a module-level import of the route, and the suite does not
// pass --experimental-test-module-mocks, so it cannot be swapped out. The seam
// is therefore the network boundary runAudit reaches: globalThis.fetch, the
// same seam audit-route-provider-guard.test.js uses. Every https call is
// recorded and answered in-process, so nothing leaves the test. The token
// argument is observed as the Authorization header of the outbound request;
// runAudit forwards its argument verbatim, and graphql-request drops a header
// whose value is undefined, so "no header" is what `runAudit(undefined)` looks
// like on the wire.
//
// WHY THESE ARE NOT STATUS-ONLY. M4 changes no status code on its own in a
// test where the stub accepts any token, so the assertion that matters is the
// outbound Authorization header. M3 is observable through the status, because
// the not-found failure is a GraphQL error the stub produces on purpose.
//
// The route is built through createWorkspaceApiRoutes, as in the sibling audit
// tests, so the moved route is exercised where it is registered.
//
// Run with: node --test tests/unit/lin-3885-audit-route-behaviour.test.js

import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { setWorkspaceCredential } from '../../lib/connection-binding.js';

// Tokens are assembled at run time, not written as literals, because
// lib/secret-scan.js reads test files too.
const HYDRATED = ['hydrated', 'linear', 'token', 'A'].join('-');
const STRAY_LEGACY = ['stray', 'legacy', 'mirror', 'B'].join('-');

// A connection-backed Linear workspace whose connection has not been hydrated
// into the per-request side-table: the active binding names a connection, and
// the scalar mirror holds a stray credential that must not be used.
function unhydratedConnectionWorkspace() {
  return {
    provider: 'linear',
    accessToken: STRAY_LEGACY,
    activeBinding: { provider: 'linear', scope: 'org-1' },
    bindings: [{ provider: 'linear', scope: 'org-1', connectionId: 'conn-org-1' }],
  };
}

// One response that satisfies all five audit queries: the three single-shot
// ones read `teams`/`projects`/`workflowStates`, and the two paginated ones
// read `issueLabels`/`issues` and stop on hasNextPage: false.
function auditGraphQLResponse() {
  const empty = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  return new Response(
    JSON.stringify({
      data: { teams: empty, projects: empty, workflowStates: empty, issueLabels: empty, issues: empty },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

// A GraphQL error the way Linear reports one: HTTP 200 with an `errors` array.
// graphql-request turns it into a ClientError whose message carries the text.
function notFoundGraphQLResponse() {
  return new Response(
    JSON.stringify({ errors: [{ message: 'Entity not found' }], data: null }),
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

// `hydrated` is the token lib/connection-credential.js would have written for
// this workspace's active binding; the route reads it back through
// getWorkspaceToken, so setting it here is the same seam production uses.
function buildApp(workspace, { hydrated } = {}) {
  const app = express();
  const router = createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, ...workspace };
      if (hydrated !== undefined) setWorkspaceCredential(req.workspace, { token: hydrated });
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

describe('GET /api/audit — the token handed to runAudit (LIN-3885, M4)', () => {
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

  test('an unhydrated connection-backed Linear workspace calls runAudit with undefined, so no credential leaves', async () => {
    process.env.NODE_ENV = 'development';
    const res = await getAudit(buildApp(unhydratedConnectionWorkspace()));

    assert.equal(res.status, 200);
    assert.ok(outbound.length > 0, 'the audit must still reach Linear');
    assert.ok(outbound.every(c => c.url.startsWith('https://api.linear.app/graphql')));
    for (const call of outbound) {
      assert.equal(call.auth, undefined, 'runAudit must get undefined: no Authorization header');
      assert.notEqual(call.auth, STRAY_LEGACY, 'the stray scalar mirror must never reach api.linear.app');
    }
  });

  test('a hydrated connection-backed Linear workspace calls runAudit with its hydrated token', async () => {
    process.env.NODE_ENV = 'development';
    const res = await getAudit(buildApp(unhydratedConnectionWorkspace(), { hydrated: HYDRATED }));

    assert.equal(res.status, 200);
    assert.ok(outbound.length > 0, 'the audit must still reach Linear');
    for (const call of outbound) {
      assert.equal(call.auth, HYDRATED, 'runAudit must get the hydrated token, not the scalar mirror');
    }
  });
});

describe('GET /api/audit — a not-found runAudit failure (LIN-3885, M3)', () => {
  let realFetch;
  let realNodeEnv;
  let errorLog;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realNodeEnv = process.env.NODE_ENV;
    // The route logs every failure with console.error; keep the TAP output readable.
    errorLog = mock.method(console, 'error', () => {});
  });

  afterEach(() => {
    errorLog.mock.restore();
    globalThis.fetch = realFetch;
    if (realNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = realNodeEnv;
  });

  // Every Linear query answers with a "not found" GraphQL error, so runAudit
  // rejects with a message containing "not found" and the route's catch arm
  // decides the status.
  function stubLinearNotFound() {
    globalThis.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input?.url || '';
      if (u.startsWith('https://')) return Promise.resolve(notFoundGraphQLResponse());
      return realFetch(input, init);
    };
  }

  test('a runAudit "not found" failure answers 500 with the audit envelope, not 404', async () => {
    process.env.NODE_ENV = 'development';
    stubLinearNotFound();
    const res = await getAudit(buildApp({ provider: 'linear', accessToken: 'lin-token' }));

    assert.equal(res.status, 500, 'a not-found outcome from runAudit must not be suppressed into 404');
    assert.equal(res.body.error, 'Audit failed');
    assert.match(res.body.message, /not found/);
  });

  test('a runAudit failure without "not found" also answers 500 (the catch arm, not a not-found branch)', async () => {
    process.env.NODE_ENV = 'development';
    globalThis.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input?.url || '';
      if (u.startsWith('https://')) {
        return Promise.resolve(new Response(
          JSON.stringify({ errors: [{ message: 'Something broke upstream' }], data: null }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        ));
      }
      return realFetch(input, init);
    };
    const res = await getAudit(buildApp({ provider: 'linear', accessToken: 'lin-token' }));

    assert.equal(res.status, 500);
    assert.equal(res.body.error, 'Audit failed');
  });
});
