// =============================================================================
// LIN-3124 PR1 (S0) — characterization tests (T1, T2, T3)
// =============================================================================
//
// PR1 is behaviour-neutral in production. S0 adds two identity accessors in
// lib/workspace.js — `getWorkspaceMirrorToken(ws) = ws?.accessToken` and
// `getWorkspaceTokenExpiry(ws) = ws?.tokenExpiresAt` (the raw scalar mirror,
// "E2") — and converts EXACTLY three read sites to them:
//
//   routes/workspace-api.js:401  runAudit(workspace.accessToken)      (audit egress)
//   routes/workspace-api.js:3400 `Bearer ${workspace.accessToken}`    (image relay)
//   server.js:953                workspace.tokenExpiresAt             (ensureValidToken expiry)
//
// `getWorkspaceToken` (E1 = `credentials?.token ?? accessToken`, credentials
// PREFERRED) is deliberately UNCHANGED. The two accessors must therefore track
// the raw mirror, not E1 — see the "diverged" state below, where the headless
// mirror (`lib/workspace-token-refresh.js:201-202`) has refreshed
// `accessToken`/`tokenExpiresAt` while `credentials.token` still holds the
// superseded grant.
//
// These are CHARACTERIZATION tests: they pin today's behaviour so the S0
// conversion cannot drift it. They pass on the unchanged code and stay green
// after S0. The accessor-equality assertions are written to bind as soon as the
// two exports exist (characterization first); before S0 the grid still pins the
// literal pre-change expression goldens.
//
// T1 is the accessor identity grid. T2 is the three call-site cases in the
// diverged state (the ensureValidToken case lives in its existing node:vm slice
// harness, tests/unit/lin-2110-ensure-valid-token-refresh-gate.test.js). T3
// pins the known diverged-state defect as-is — "characterization of a known
// defect; update deliberately".
//
// Run with: node --test tests/unit/lin-3124-pr1-s0-characterization.test.js

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as workspaceModule from '../../lib/workspace.js';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { mirrorRefreshedCredentialIntoOwnerRows } from '../../lib/workspace-token-refresh.js';

const { getWorkspaceToken } = workspaceModule;
// Added by S0. Absent before the accessors exist; bound into the assertions
// the moment they do (see assertAccessorGolden).
const getWorkspaceMirrorToken = workspaceModule.getWorkspaceMirrorToken;
const getWorkspaceTokenExpiry = workspaceModule.getWorkspaceTokenExpiry;

// The literal pre-change expressions. S0's accessors must reproduce these
// exactly; a conversion to E1 precedence (or any other shape) turns T1 red.
const mirrorExpr = (ws) => ws?.accessToken;
const expiryExpr = (ws) => ws?.tokenExpiresAt;

// =============================================================================
// T1 — accessor identity grid (E1/E2, diverged state)
// =============================================================================

// Goldens captured at the pre-change SHA. `e1` is getWorkspaceToken (unchanged);
// `mirror`/`expiry` are the raw-mirror accessors S0 will add.
const GRID = [
  {
    name: 'fresh mirror',
    ws: { id: 'w-1', accessToken: 'A-fresh', tokenExpiresAt: 1_000 },
    mirror: 'A-fresh',
    expiry: 1_000,
    e1: 'A-fresh',
  },
  {
    name: 'diverged: accessToken NEW, credentials.token OLD (headless mirror)',
    ws: { id: 'w-2', provider: 'jira', credentials: { token: 'OLD-credential' }, accessToken: 'NEW-mirror', tokenExpiresAt: 2_000 },
    mirror: 'NEW-mirror',
    expiry: 2_000,
    e1: 'OLD-credential',
  },
  {
    name: 'no credentials',
    ws: { id: 'w-3', accessToken: 'A2', tokenExpiresAt: 3_000 },
    mirror: 'A2',
    expiry: 3_000,
    e1: 'A2',
  },
  {
    name: 'no accessToken (credentials only)',
    ws: { id: 'w-4', provider: 'linear', credentials: { token: 'C-only' } },
    mirror: undefined,
    expiry: undefined,
    e1: 'C-only',
  },
  {
    name: 'two same-provider bindings (mirror ignores bindings)',
    ws: {
      id: 'w-5',
      provider: 'github',
      accessToken: 'MIRROR',
      tokenExpiresAt: 4_000,
      bindings: [
        { provider: 'github', scope: 'owner/a', credentials: { token: 'B1' } },
        { provider: 'github', scope: 'owner/b', credentials: { token: 'B2' } },
      ],
    },
    mirror: 'MIRROR',
    expiry: 4_000,
    e1: 'MIRROR',
  },
  {
    name: 'expiry undefined',
    ws: { id: 'w-6', accessToken: 'x' },
    mirror: 'x',
    expiry: undefined,
    e1: 'x',
  },
  {
    name: 'expiry NaN',
    ws: { id: 'w-7', accessToken: 'x', tokenExpiresAt: NaN },
    mirror: 'x',
    expiry: NaN,
    e1: 'x',
  },
  {
    name: 'expiry sentinel (MAX_SAFE_INTEGER)',
    ws: { id: 'w-8', accessToken: 'x', tokenExpiresAt: Number.MAX_SAFE_INTEGER },
    mirror: 'x',
    expiry: Number.MAX_SAFE_INTEGER,
    e1: 'x',
  },
  {
    name: 'null workspace',
    ws: null,
    mirror: undefined,
    expiry: undefined,
    e1: undefined,
  },
  {
    name: 'undefined workspace',
    ws: undefined,
    mirror: undefined,
    expiry: undefined,
    e1: undefined,
  },
];

// Assert the accessor reproduces the golden. S0 has landed, so the export MUST
// exist — a missing accessor is a hard failure (PR3 checkpoint B hardening;
// before it, this silently skipped and hid a dropped export).
function assertAccessorGolden(name, accessor, ws, golden) {
  assert.strictEqual(typeof accessor, 'function', `${name} must be exported (S0 landed)`);
  assert.strictEqual(accessor(ws), golden, `${name} must reproduce the pre-change golden (raw mirror precedence)`);
}

describe('LIN-3124 PR1 T1 — S0 accessor identity grid (E1/E2, diverged state)', () => {
  for (const c of GRID) {
    test(`raw-mirror golden: ${c.name}`, () => {
      // The literal pre-change expressions.
      assert.strictEqual(mirrorExpr(c.ws), c.mirror, `mirrorExpr golden for ${c.name}`);
      assert.strictEqual(expiryExpr(c.ws), c.expiry, `expiryExpr golden for ${c.name}`);
      // E1 stays unchanged.
      assert.strictEqual(getWorkspaceToken(c.ws), c.e1, `getWorkspaceToken (E1) golden for ${c.name}`);
      // The two S0 accessors must equal the raw-mirror expression.
      assertAccessorGolden('getWorkspaceMirrorToken', getWorkspaceMirrorToken, c.ws, c.mirror);
      assertAccessorGolden('getWorkspaceTokenExpiry', getWorkspaceTokenExpiry, c.ws, c.expiry);
    });
  }

  test('diverged state: E2 raw mirror and E1 credential disagree (the property S0 must not lose)', () => {
    const diverged = GRID.find(c => c.name.startsWith('diverged')).ws;
    assert.strictEqual(mirrorExpr(diverged), 'NEW-mirror');
    assert.strictEqual(getWorkspaceToken(diverged), 'OLD-credential');
    assert.notStrictEqual(mirrorExpr(diverged), getWorkspaceToken(diverged),
      'E2 (raw mirror) and E1 (credentials-preferred) must stay distinguishable — this is the whole reason S0 adds a new accessor rather than reusing getWorkspaceToken');
  });

  test('does not throw on null/undefined', () => {
    assert.doesNotThrow(() => mirrorExpr(null));
    assert.doesNotThrow(() => expiryExpr(undefined));
    if (typeof getWorkspaceMirrorToken === 'function') {
      assert.doesNotThrow(() => getWorkspaceMirrorToken(null));
      assert.doesNotThrow(() => getWorkspaceTokenExpiry(undefined));
    }
  });
});

// =============================================================================
// T2 — call-site diverged-state tests
// =============================================================================
//
// The third site (server.js:953, ensureValidToken's expiry read) is covered in
// its VM-slice harness: tests/unit/lin-2110-ensure-valid-token-refresh-gate.test.js
// ("LIN-3124 PR1 T2 — ensureValidToken reads the raw tokenExpiresAt mirror").

const DIVERGED = Object.freeze({
  provider: 'linear',
  accessToken: 'NEW-mirror',
  credentials: { token: 'OLD-credential' },
  tokenExpiresAt: Date.now() + 3_600_000,
});

// ---- T2(a): audit egress (routes/workspace-api.js:401) ----------------------

function auditGraphQLResponse() {
  const empty = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  return new Response(
    JSON.stringify({
      data: { teams: empty, projects: empty, workflowStates: empty, issueLabels: empty, issues: empty },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

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
    freeTierStore: {}, getOpenRouterSource: () => null, userPreferencesStore: {},
    workspacePreferencesStore: {}, customPromptsStore: {}, recapCacheStore: {},
    briefCacheStore: {}, reportHistoryStore: {}, dispatchQueueStore: {},
    agentStatusStore: {}, promptTraceStore: {}, proxyTokenStore: {},
  });
  app.use(router);
  return app;
}

describe('LIN-3124 PR1 T2(a) — audit egress uses the raw mirror (routes/workspace-api.js:401)', () => {
  let realFetch;
  let realNodeEnv;
  let outbound;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    outbound = [];
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

  test('a diverged Linear workspace audits with accessToken (NEW), never credentials.token (OLD)', async () => {
    const app = buildApp(DIVERGED);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address();
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${port}/workspace/ws/api/audit`);
    } finally {
      server.close();
    }
    assert.strictEqual(res.status, 200);
    assert.ok(outbound.length > 0, 'a Linear workspace must still call Linear');
    // lib/audit.js sends the bare token (no Bearer prefix).
    assert.strictEqual(outbound[0].auth, 'NEW-mirror',
      'the audit egress must use the raw accessToken mirror, not the E1 credentials.token');
  });
});

// ---- T2(b): image relay header (routes/workspace-api.js:3400) ---------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

function fakeUpstream(body = PNG) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'image/png' : null) },
    async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); },
  };
}

describe('LIN-3124 PR1 T2(b) — image relay header uses the raw mirror (routes/workspace-api.js:3400)', () => {
  let realFetch;
  let sawInit;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    sawInit = null;
    globalThis.fetch = (input, init) => {
      const u = typeof input === 'string' ? input : input?.url || '';
      if (u.startsWith('https://')) {
        sawInit = init;
        return Promise.resolve(fakeUpstream());
      }
      return realFetch(input, init);
    };
  });

  afterEach(() => { globalThis.fetch = realFetch; });

  test('a diverged Linear workspace relays with accessToken (NEW), never credentials.token (OLD)', async () => {
    const app = buildApp(DIVERGED);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const { port } = server.address();
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${port}/workspace/ws/api/image?url=${encodeURIComponent('https://uploads.linear.app/abc/shot.png')}`);
    } finally {
      server.close();
    }
    assert.strictEqual(res.status, 200);
    assert.strictEqual(sawInit.headers.Authorization, 'Bearer NEW-mirror',
      'the image relay must use the raw accessToken mirror, not the E1 credentials.token');
  });
});

// =============================================================================
// T3 — headless mirror then resolve, pinned as-is
// =============================================================================
//
// CHARACTERIZATION OF A KNOWN DEFECT; UPDATE DELIBERATELY.
//
// The headless mirror (lib/workspace-token-refresh.js:201-202) updates ONLY
// `accessToken`/`tokenExpiresAt`; it does not touch `credentials` or the
// bindings. Jira's call scope is built from the E1 credential
// (getWorkspaceToken -> selectActiveBinding), so after a headless refresh it
// carries the OLD token. This divergence is pre-existing (credential-defect
// cluster: LIN-2639/2642/2640/2530/2394), cited by LIN-3124, and NOT fixed by
// PR1. PR1's accessors must NOT be changed to "fix" it.

describe('LIN-3124 PR1 T3 — headless mirror then resolve, pinned as-is (characterization of a known defect)', () => {
  function jiraWorkspace() {
    const old = 'OLD-oauth-access';
    return {
      id: 'w-jira',
      provider: 'jira',
      accessToken: old,
      tokenExpiresAt: Date.now() - 10_000,
      credentials: { token: old, authType: 'oauth', cloudId: 'cloud-1' },
      bindings: [
        { provider: 'jira', scope: 'https://acme.atlassian.net', credentials: { token: old, authType: 'oauth', cloudId: 'cloud-1' } },
      ],
    };
  }

  // PR3 checkpoint B hardening: drive the REAL mirror loop
  // (`mirrorRefreshedCredentialIntoOwnerRows`) instead of hand-copying its two
  // assignment lines, so T3 notices if the loop drifts.
  function ownerSessions(workspace) {
    return [{ _id: 'sid-1', session: { accountId: 'acct-1', workspaces: [workspace] } }];
  }

  test('after the real headless mirror loop the raw E2 accessors see NEW, but Jira call scope / E1 still carry OLD', async () => {
    const ws = jiraWorkspace();
    ws.urlKey = 'jira-ws';
    const persisted = [];
    let ownerWorkspace;
    try {
      ownerWorkspace = await mirrorRefreshedCredentialIntoOwnerRows({
        sessions: ownerSessions(ws),
        urlKey: 'jira-ws',
        ownerAccountId: 'acct-1',
        token: 'NEW-oauth-access',
        expiresAt: Date.now() + 3_600_000,
        persistSession: async (sid) => { persisted.push(sid); },
      });
    } catch (err) {
      assert.fail(`the real mirror loop must run: ${err.message}`);
    }
    assert.strictEqual(ownerWorkspace, ws, 'the mirrored workspace is returned');
    assert.deepStrictEqual(persisted, ['sid-1'], 'the row is persisted once');

    // E2 raw mirror: refreshed.
    assert.strictEqual(mirrorExpr(ws), 'NEW-oauth-access');
    assert.strictEqual(expiryExpr(ws), ws.tokenExpiresAt);
    assertAccessorGolden('getWorkspaceMirrorToken', getWorkspaceMirrorToken, ws, 'NEW-oauth-access');

    // E1 credential and the binding: stale (the known defect).
    assert.strictEqual(getWorkspaceToken(ws), 'OLD-oauth-access');
    const scope = workspaceModule.getWorkspaceCallScope(ws);
    assert.strictEqual(scope.accessToken, 'OLD-oauth-access',
      'known defect: the Jira call scope carries the superseded token after a headless mirror');
    assert.strictEqual(scope.cloudId, 'cloud-1');
  });
});
