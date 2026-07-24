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
 *  - a malformed cursor is classified as a 400, not a 500.
 *
 * That last case had a FALSE PREMISE until LIN-1511's follow-up fix. It used to
 * simulate the failure with a hand-shaped `{ extensions: { statusCode: 400 } }`
 * — a shape Linear never produces for this input — and asserted only
 * `status >= 400`, which 500 satisfies. So the test passed green while the real
 * path returned 500 on every malformed cursor. The fake below now reproduces the
 * error object captured VERBATIM from real Linear (see MALFORMED_CURSOR_ERROR),
 * and the assertion pins the exact status. Reverting the `userError` branch in
 * `graphqlErrorStatus` must turn this test red.
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

/**
 * The error `graphql-request` throws when real Linear is handed a malformed
 * `after`, captured verbatim from the live API (`issues(key, { after:
 * 'not-a-real-cursor' })` against the LIN workspace, 2026-07-24).
 *
 * Two properties are the whole point of this fixture, and both are why the
 * original hand-rolled `{ statusCode: 400 }` stub was worse than no test:
 *  - `response.status` is **200**. Linear does NOT use an HTTP 4xx here; the
 *    caller error rides inside a successful GraphQL envelope.
 *  - there is **no `statusCode`** anywhere in `extensions`. The caller-error
 *    signal is `userError: true` / `code: 'INVALID_INPUT'`.
 * Together they mean `graphqlErrorStatus` sees no status it recognises and,
 * before the fix, fell through to 500.
 */
const MALFORMED_CURSOR_ERROR = {
  status: 200,
  errors: [{
    message: 'Argument Validation Error',
    path: ['issues'],
    locations: [{ line: 3, column: 5 }],
    extensions: {
      code: 'INVALID_INPUT',
      validationErrors: [{
        target: { after: 'not-a-real-cursor', first: 2 },
        value: 'not-a-real-cursor',
        property: 'after',
        children: [],
        constraints: { customValidation: 'after is not a valid pagination cursor identifier' },
      }],
      type: 'invalid input',
      userError: true,
      userPresentableMessage: 'after is not a valid pagination cursor identifier.',
    },
  }],
};

// A fake provider that pages a fixed two-page dataset by opaque cursor and
// records every `after` it is handed, so we can assert the route passes the
// request cursor through verbatim. A sentinel cursor ('boom') throws the real
// Linear error above to exercise the malformed-cursor path.
function makeProvider() {
  const seen = [];
  return {
    seen,
    async issues(token, { teamId = null, first = 50, after = null } = {}) {
      seen.push(after);
      if (after === 'boom') {
        // graphql-request stringifies the whole response into err.message; the
        // structured copy on err.response is what the route's mappers read.
        const err = new Error(`Argument Validation Error: ${JSON.stringify({ response: MALFORMED_CURSOR_ERROR })}`);
        err.response = MALFORMED_CURSOR_ERROR;
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

// A provider whose `issues()` always throws the given error — used to pin the
// blast radius of the shared `graphqlErrorStatus` mapper (LIN-1511).
function makeFailingProvider(response) {
  return {
    async issues() {
      const err = new Error('upstream failed');
      err.response = response;
      throw err;
    },
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

test('a malformed cursor → 400 with Linear\'s actionable message, not a 500', async () => {
  const { status, body } = await get(buildApp(makeProvider()), '/api/proxy/issues?after=boom');
  // EXACTLY 400. A malformed cursor is the caller's mistake and no retry can
  // fix it, so it must not present as a server fault. Asserted exactly, not as
  // `>= 400`, because the bug this test failed to catch WAS a 500 — and 500
  // satisfies `>= 400`. (LIN-1511)
  assert.equal(status, 400, `a malformed cursor must be a 400, got ${status}`);
  assert.equal(body.error, 'Failed to fetch issues');
  // Linear's own userPresentableMessage, not the generic "Argument Validation
  // Error" — the caller is told which param was wrong.
  assert.equal(body.detail, 'after is not a valid pagination cursor identifier.');
});

test('the malformed-cursor 400 leaks nothing: no echoed variables, no stack, no token', async () => {
  const { body } = await get(buildApp(makeProvider()), '/api/proxy/issues?after=boom');
  const wire = JSON.stringify(body);
  // graphql-request packs the full response — including extensions.validationErrors,
  // which echoes the whole `target` variables object — into err.message. Only the
  // single userPresentableMessage string may cross the wire.
  assert.deepEqual(Object.keys(body).sort(), ['detail', 'error']);
  assert.ok(!/validationErrors|customValidation/.test(wire), `internal error internals leaked: ${wire}`);
  assert.ok(!/ws-token|Bearer/.test(wire), `credential leaked: ${wire}`);
  assert.ok(!/\bat \w+ \(|node_modules/.test(wire), `stack trace leaked: ${wire}`);
});

/**
 * Blast-radius guard for the shared mapper (LIN-1511).
 *
 * `graphqlErrorStatus` backs ~20 proxy routes, so teaching it about
 * `userError` is deliberately a whole-surface change. It is safe because the
 * new branch runs LAST: it can only ever turn a would-be 500 into a 400, and
 * every status the mapper already returned still wins. These cases pin that —
 * if the `userError` check ever migrates above the status branches, they go red.
 */
const MAPPING_INVARIANTS = [
  { name: 'auth error still maps to 401 (userError branch cannot steal it)', status: 401,
    response: { status: 401, errors: [{ message: 'Authentication required', extensions: { userError: true } }] } },
  { name: 'not-found still maps to 404', status: 404,
    response: { status: 404, errors: [{ message: 'Entity not found', extensions: { userError: true } }] } },
  { name: 'rate limit still maps to 429', status: 429,
    response: { status: 429, errors: [{ message: 'Ratelimit exceeded', extensions: { userError: true } }] } },
  { name: 'a genuine server fault (no userError flag) still maps to 500', status: 500,
    response: { status: 200, errors: [{ message: 'Internal server error', extensions: { code: 'INTERNAL_ERROR' } }] } },
  { name: 'userError must be exactly true — a truthy string does not open the 400 branch', status: 500,
    response: { status: 200, errors: [{ message: 'nope', extensions: { userError: 'yes' } }] } },
];

for (const { name, status: expected, response } of MAPPING_INVARIANTS) {
  test(`graphqlErrorStatus blast radius — ${name}`, async () => {
    const { status } = await get(buildApp(makeFailingProvider(response)), '/api/proxy/issues');
    assert.equal(status, expected);
  });
}
