/**
 * LIN-583 — the test-only local-targeting seam for the consumer proxy.
 *
 * Phase B1 routes the proxy read + write data path through the injectable
 * `provider` and gives `LocalProvider` the proxy surface. The remaining piece is
 * reachability: a proxy token minted for the known local workspace must resolve
 * to the LocalProvider (reached with the urlKey as the store partition key),
 * NOT scan sessions for a Linear access token. This proves that seam end-to-end
 * by mounting the real proxy router over a real, seeded LocalStore and asserting
 * reads/writes hit local data — even though `resolveWorkspaceAccess` (the Linear
 * session path) returns no token.
 *
 * The full /api/proxy/* e2e suite against a local workspace is B2 (LIN-584);
 * this is the focused proof that B1's seam works.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { createLocalStore } from '../fixtures/local-harness.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js (and LOCAL_WORKSPACE_URL_KEY).
const LOCAL_URL_KEY = 'local-workspace';
const UUID = '11111111-1111-1111-1111-111111111111';

before(() => { process.env.NODE_ENV = 'test'; });

async function buildLocalApp() {
  const { store } = createLocalStore();
  await store.seed(LOCAL_URL_KEY, {
    projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
    issues: [
      { id: 'i1', identifier: 'LOCAL-1', title: 'Parent', description: 'd1', projectId: 'p1', state: { name: 'In Progress', type: 'started' }, labels: ['bug'] },
      { id: 'i2', identifier: 'LOCAL-2', title: 'Child', projectId: 'p1', parentId: 'i1', state: { name: 'Todo', type: 'unstarted' } },
    ],
  });
  // resolveProviderAccess reads the module-level localProvider singleton.
  localProvider.configure({ store });

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      validateToken: async () => ({
        tokenId: 't1', urlKey: LOCAL_URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1',
      }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    // The Linear session path resolves NOTHING — if the seam didn't bypass it,
    // every call below would 503 instead of reaching the seeded local store.
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    // provider defaults to linearProvider — the seam swaps in localProvider for
    // the local urlKey, so we do NOT pass it here.
  }));
  return { app, store };
}

async function request(app, path, { method = 'GET', body } = {}) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer anything',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('GET /api/proxy/me reaches the synthetic local viewer (not a 503)', async () => {
  const { app } = await buildLocalApp();
  const { status, body } = await request(app, '/api/proxy/me');
  assert.equal(status, 200);
  assert.deepEqual(body, { id: 'local-user', name: 'Local User', email: 'local@localhost' });
});

test('GET /api/proxy/projects returns the seeded local project, url-neutralized', async () => {
  const { app } = await buildLocalApp();
  const { status, body } = await request(app, '/api/proxy/projects');
  assert.equal(status, 200);
  assert.deepEqual(body.projects, [{ id: 'p1', name: 'Alpha', content: 'a' }]);
});

test('GET /api/proxy/issues returns flat-wire local issues', async () => {
  const { app } = await buildLocalApp();
  const { status, body } = await request(app, '/api/proxy/issues');
  assert.equal(status, 200);
  assert.equal(body.issues.length, 2);
  const parent = body.issues.find(i => i.identifier === 'LOCAL-1');
  assert.deepEqual(parent.labels, ['bug']);          // flattened to name strings
  assert.equal(parent.url, undefined);               // backend deep-link stripped
});

test('GET /api/proxy/issues/:id returns the detail shape with flat children', async () => {
  const { app } = await buildLocalApp();
  const { status, body } = await request(app, '/api/proxy/issues/LOCAL-1');
  assert.equal(status, 200);
  assert.equal(body.identifier, 'LOCAL-1');
  assert.equal(Array.isArray(body.children), true);
  assert.equal(body.children[0].identifier, 'LOCAL-2');
});

test('GET /api/proxy/cycles is canonical-empty (local has no cycles)', async () => {
  const { app } = await buildLocalApp();
  const { status, body } = await request(app, '/api/proxy/cycles');
  assert.equal(status, 200);
  assert.deepEqual(body, { cycles: [] });
});

// CLOSED in B2 (LIN-584): the proxy's write *mutations* (create issue/comment/
// relation, update issue) reuse the LIN-356 LocalProvider methods, which return a
// bare canonical object rather than the Linear `{ success, … }` mutation payload
// the route's `writeRejected` requires. B1 left this as a 502 boundary; B2 closes
// it WITHOUT reshaping those shared methods (they stay a real contract for the
// non-proxy local write path: /test/local-create-issue + the LIN-356 write unit
// tests) by normalizing the write result into the `{ success, … }` envelope at
// the route boundary (`normalizeWritePayload`). So a comment now LANDS on local
// and comes back proxy-shaped. The relation DELETE + label-RMW guard methods
// already returned `{ success, … }` directly (see the test below + the unit suite).
test('POST comment lands on local and returns the proxy { success, comment } shape', async () => {
  const { app } = await buildLocalApp();
  const { status, body } = await request(app, '/api/proxy/issues/i1/comments', {
    method: 'POST',
    body: { body: 'hello from the proxy' },
  });
  // Reaches local (not a 503 workspace-unavailable nor a 422 capability decline)
  // AND the route-level normalization gives it the `{ success, comment }` envelope.
  assert.equal(status, 201);
  assert.equal(body.success, true);
  assert.equal(body.comment.body, 'hello from the proxy');
});

test('unknown issue id still validates format before the provider (400)', async () => {
  const { app } = await buildLocalApp();
  const { status } = await request(app, '/api/proxy/issues/not valid!!!');
  assert.equal(status, 400);
});

test('DELETE relation routes to local and reports success on a real relation', async () => {
  const { app, store } = await buildLocalApp();
  // Seed a relation we can delete by its own id.
  await store.addRelation(LOCAL_URL_KEY, 'i1', { type: 'blocks', relatedIssueId: 'i2' });
  const rel = (await store.getIssue(LOCAL_URL_KEY, 'i1')).relations[0];
  const { status, body } = await request(app, `/api/proxy/issues/${UUID}/relations/${rel.id}`, { method: 'DELETE' });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual((await store.getIssue(LOCAL_URL_KEY, 'i1')).relations, []);
});
