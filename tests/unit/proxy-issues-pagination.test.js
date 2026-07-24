/**
 * LIN-1511 — `GET /api/proxy/issues` cursor pagination.
 *
 * The provider seam `provider.issues(token, { teamId, first, after }) ->
 * { nodes, pageInfo }` already supported an `after` cursor end-to-end; the only
 * gap was the route hardcoding `after: null`, so the `pageInfo.endCursor` it
 * already returned was un-consumable (a workspace larger than the 250 cap could
 * not be paged in full).
 *
 * These tests drive the real route (via the TEST-ONLY `provider` injection seam)
 * and pin the load-bearing behaviours:
 *  - the request `after` (and its `cursor` alias) is threaded through verbatim;
 *  - a non-null cursor returns a DIFFERENT page than page 1 (the LIN-1494
 *    anti-loop guard — a cursor that is silently ignored re-serves page 1
 *    forever);
 *  - an unpaged caller still gets today's first page (`after: null`);
 *  - the `{ issues, pageInfo: { hasNextPage, endCursor } }` response shape is
 *    unchanged;
 *  - a provider error on a malformed cursor is caught into a structured JSON
 *    error, never an unhandled crash.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';

const PAGE1 = [
  { id: 'u1', identifier: 'LIN-1', title: 'one' },
  { id: 'u2', identifier: 'LIN-2', title: 'two' },
];
const PAGE2 = [
  { id: 'u3', identifier: 'LIN-3', title: 'three' },
  { id: 'u4', identifier: 'LIN-4', title: 'four' },
];

// A fake provider that pages a fixed two-page dataset by opaque cursor and
// records every `after` it is handed, so we can assert the route passes the
// request cursor through verbatim. A sentinel cursor ('boom') throws a
// Linear-style GraphQL error to exercise the malformed-cursor error path.
function makeProvider() {
  const seen = [];
  return {
    seen,
    async issues(token, { teamId = null, first = 50, after = null } = {}) {
      seen.push(after);
      if (after === 'boom') {
        const err = new Error('invalid cursor');
        err.response = { errors: [{ message: 'Argument "after" has invalid value', extensions: { statusCode: 400 } }] };
        throw err;
      }
      if (after === 'CUR1') {
        return { nodes: PAGE2, pageInfo: { hasNextPage: false, endCursor: null } };
      }
      // after == null (or anything else) → first page.
      return { nodes: PAGE1, pageInfo: { hasNextPage: true, endCursor: 'CUR1' } };
    },
    // Selection/capability plumbing the route may consult; unused here.
    supports: () => true,
  };
}

function buildApp(provider) {
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'ws-token', reason: 'ok', provider: 'linear' }),
    getWorkspaceAccessToken: async () => 'ws-token',
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider, // TEST-ONLY injection (LIN-581) — wins over registry resolution.
  }));
  return app;
}

async function get(app, path) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: 'Bearer anything' },
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('unpaged request → provider called with after:null and returns page 1 (back-compat)', async () => {
  const provider = makeProvider();
  const { status, body } = await get(buildApp(provider), '/api/proxy/issues?limit=250');
  assert.equal(status, 200);
  assert.deepEqual(provider.seen, [null]);
  assert.deepEqual(body.issues.map(i => i.identifier), ['LIN-1', 'LIN-2']);
  assert.deepEqual(body.pageInfo, { hasNextPage: true, endCursor: 'CUR1' });
});

test('after=<endCursor> is threaded through verbatim and returns a DIFFERENT page than page 1 (LIN-1494 anti-loop guard)', async () => {
  const provider = makeProvider();
  const page1 = await get(buildApp(provider), '/api/proxy/issues?limit=250');
  const cursor = page1.body.pageInfo.endCursor;

  const page2 = await get(buildApp(provider), `/api/proxy/issues?limit=250&after=${cursor}`);
  assert.equal(page2.status, 200);
  // The route handed the cursor straight to the provider…
  assert.equal(provider.seen.at(-1), 'CUR1');
  // …and the second page is genuinely different from the first (not a re-serve).
  const p1 = new Set(page1.body.issues.map(i => i.identifier));
  const p2 = page2.body.issues.map(i => i.identifier);
  assert.deepEqual(p2, ['LIN-3', 'LIN-4']);
  assert.ok(p2.every(id => !p1.has(id)), 'page 2 identifiers must be disjoint from page 1');
  // Terminal page signals the stop deterministically.
  assert.deepEqual(page2.body.pageInfo, { hasNextPage: false, endCursor: null });
});

test('`cursor` is accepted as an alias for `after`', async () => {
  const provider = makeProvider();
  const { status, body } = await get(buildApp(provider), '/api/proxy/issues?limit=250&cursor=CUR1');
  assert.equal(status, 200);
  assert.equal(provider.seen.at(-1), 'CUR1');
  assert.deepEqual(body.issues.map(i => i.identifier), ['LIN-3', 'LIN-4']);
});

test('response shape stays { issues, pageInfo: { hasNextPage, endCursor } } — no extra keys', async () => {
  const { body } = await get(buildApp(makeProvider()), '/api/proxy/issues');
  assert.deepEqual(Object.keys(body).sort(), ['issues', 'pageInfo']);
  assert.deepEqual(Object.keys(body.pageInfo).sort(), ['endCursor', 'hasNextPage']);
});

test('a malformed cursor that the provider rejects → structured JSON error, not an unhandled crash', async () => {
  const { status, body } = await get(buildApp(makeProvider()), '/api/proxy/issues?after=boom');
  // The existing graphqlErrorStatus/Detail path catches it into a structured
  // body (the Linear message passes through) rather than throwing — a garbage
  // cursor is handled gracefully, never a hang or an opaque stack leak.
  assert.ok(status >= 400, `expected an error status, got ${status}`);
  assert.equal(body.error, 'Failed to fetch issues');
  assert.match(body.detail, /invalid value|cursor/i);
});
