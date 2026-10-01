/**
 * LIN-3133 (T1) — the enqueue read-scope refusal witness.
 *
 * T1 threads `requireGrant` into the kickoff and dispatch sub-routers inertly
 * (declared, unused). Acceptance criterion (b) says a `scope:'read'` token still
 * gets today's `requireWriteScope` 403 on the three enqueue POSTs, and a
 * `readWrite` token still enqueues. Research found no test that drives a `read`
 * token through any of the three, so this is a pure addition closing that gap.
 *
 * Built through the real composer (`buildApp`/`BASE_DEPS`) with a local
 * `validateToken` override, so the `read`/`readWrite` decision is made where
 * production makes it. The readWrite-no-grants control pins the "no enforcement
 * yet" half of criterion (a): T1 adds no grant gate, so a plain readWrite token
 * (no `grants`) still reaches the queue. This test stays valid after T3 because
 * `requireWriteScope` runs before any grant gate.
 *
 * A `dispatchQueueStore.addItem` spy proves refusal happens BEFORE the enqueue,
 * not merely that the response status is a non-201.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, call, ACME } from './lib/proxy-fake-deps.js';

// `NODE_ENV=test` plus the BASE_DEPS `test-token` workspace access flips the
// routes' own `isTestMode`, so the readWrite control reaches the enqueue
// deterministically without OpenRouter — the same seam every sibling proxy
// test uses. It does not touch `requireWriteScope`, so the read cases are
// unaffected.
before(() => { process.env.NODE_ENV = 'test'; });

const READ_WRITE_TOKEN_ERROR = 'This endpoint requires a read-write token';

const ENQUEUE_ROUTES = [
  {
    name: 'POST /api/proxy/dispatch',
    path: '/api/proxy/dispatch',
    body: { prompt: 'run me', kind: 'implementation' },
  },
  {
    name: 'POST /api/proxy/recommend-and-dispatch',
    path: '/api/proxy/recommend-and-dispatch',
    // TEST-2 is a leaf in the test-mode mock fixtures, so the control's
    // recommendation resolves without an OpenRouter hop (the read cases 403
    // before any resolution, so the identifier value is inert there).
    body: { issueIdentifier: 'TEST-2' },
  },
  {
    name: 'POST /api/proxy/autopilot/kickoff',
    path: '/api/proxy/autopilot/kickoff',
    body: { goal: 'walk the stack' },
  },
];

// Builds the real proxy composer with one local token override and an
// `addItem` spy. `grants` is left undefined for the no-grants cases; the
// readWrite control never declares it either.
function buildEnqueueApp({ scope, grants } = {}) {
  const added = [];
  const app = buildApp({
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    proxyTokenStore: {
      // LIN-1175: a cli-harness dispatch provisions its proxy context by
      // minting a bootstrap token; give the stub a working mint like
      // production so the readWrite control reaches the enqueue.
      createToken: async () => ({ token: 'test-bootstrap', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({
        tokenId: 't1',
        urlKey: ACME,
        label: 'test',
        scope,
        createdBy: 'u1',
        ...(grants === undefined ? {} : { grants }),
      }),
      listTokens: async () => [],
      describeRejectionCause: async () => null,
    },
    dispatchQueueStore: {
      addItem: async (urlKey, item) => {
        added.push({ urlKey, item });
        return { _id: 'disp-1', dispatchedAt: '2026-09-29T00:00:00.000Z', ...item };
      },
    },
  });
  return { app, added };
}

for (const route of ENQUEUE_ROUTES) {
  for (const grants of [undefined, ['take', 'dispatch']]) {
    const grantLabel = grants === undefined ? 'no grants' : "grants ['take','dispatch']";
    test(`${route.name}: a read token (${grantLabel}) is refused with today's requireWriteScope 403`, async () => {
      const { app, added } = buildEnqueueApp({ scope: 'read', grants });
      const { status, body } = await call(app, 'post', route.path, { body: route.body });
      assert.equal(status, 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
      assert.deepEqual(body, { error: READ_WRITE_TOKEN_ERROR });
      assert.equal(added.length, 0, 'a read token must never reach the enqueue');
    });
  }

  if (route.path === '/api/proxy/autopilot/kickoff') {
    // LIN-3136 (ledger A2, kickoff row, advanced to G3): the kickoff now declares
    // the dispatch grant for its child (M1), owner-checked in the workspace the
    // CALLER token was minted for. A grant-less readWrite token carries no such
    // workspace, so the launch fails closed before the enqueue; no grant-less
    // fallback. (G5's gate then refuses it earlier, with DISPATCH_GRANT_REQUIRED.)
    test(`${route.name}: a readWrite token with no grants is refused before the enqueue (M1 fails closed)`, async () => {
      const { app, added } = buildEnqueueApp({ scope: 'readWrite' });
      const { status, body } = await call(app, 'post', route.path, { body: route.body });
      assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(body.code, 'INVALID_GRANTS');
      assert.equal(added.length, 0, 'a grant-less caller never reaches the enqueue');
    });
  } else {
    test(`${route.name}: a readWrite token with no grants still enqueues (no grant gate yet)`, async () => {
      const { app, added } = buildEnqueueApp({ scope: 'readWrite' });
      const { status, body } = await call(app, 'post', route.path, { body: route.body });
      assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
      assert.equal(added.length, 1, 'the readWrite token still reaches the enqueue in T1');
    });
  }
}
