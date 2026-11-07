/**
 * LIN-4352 (LIN-4345 plan rev 2), witness 5: a whole ticket keeps the words.
 *
 * One ticket on a REAL LocalStore, walked through the REAL proxy routes and the
 * REAL dispatch factory over a REAL DispatchQueueStore:
 *   seed (filed outside Harbour, unsealed)
 *   → first dispatch (sealed by the factory)
 *   → a plan appended below the block (accepted)
 *   → a close-out PATCH that rewrites the body and drops the block (refused 422
 *     AS_ASKED_IMMUTABLE, nothing written)
 *   → a description/below prune (accepted)
 * At the end the filed words are still there, byte for byte, inside the block.
 */
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { localProvider } from '../../lib/providers/local/index.js';
import { sealAsAsked, splitAsAsked } from '../../lib/as-asked.js';
import { createLocalStore } from '../fixtures/local-harness.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

// Must match TEST_LOCAL_URL_KEY in routes/proxy.js: the proxy resolves it to the
// LocalStore-backed provider, with the url key as the store partition.
const URL_KEY = 'local-workspace';
const WORDS = 'Please write a full guide on how to properly configure it.\nCover **both** modes, and say what each one is for.';

test('witness 5: seed → dispatch (sealed) → plan below → close-out PATCH refused → below prune; the words survive', async () => {
  const { store: issues } = createLocalStore();
  await issues.seed(URL_KEY, {
    projects: [{ id: 'p1', name: 'Alpha', content: 'a', sortOrder: 1 }],
    issues: [{ id: 'i1', identifier: 'LOCAL-1', title: 'A full guide', description: WORDS, projectId: 'p1', state: { name: 'Todo', type: 'unstarted' } }],
  });
  localProvider.configure({ store: issues });
  const dispatchStore = new DispatchQueueStore({ collection: createMockCollection(), historyCollection: createMockCollection() });

  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: {
      createToken: async () => ({ token: 'boot', kind: 'bootstrap', scope: 'readWrite' }),
      validateToken: async () => ({ grants: ['dispatch'], workspaceId: 'ws-local', tokenId: 't1', urlKey: URL_KEY, label: 'test', scope: 'readWrite', createdBy: 'u1' }),
    },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: null, reason: 'not_connected' }),
    getWorkspaceAccessToken: async () => null,
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    recapCacheStore: { get: async () => null, set: async () => {} },
    briefCacheStore: { get: async () => null, set: async () => {} },
    dispatchQueueStore: dispatchStore,
    workspaceFromUrl: (req, res, next) => next(),
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const stored = async () => (await issues.getIssue(URL_KEY, 'i1')).description;
  const quiet = console.log;
  console.log = (...args) => { if (!String(args[0]).includes('[as-asked]')) quiet(...args); };

  try {
    // 1. The first dispatch seals the ticket (the factory, through the proxy lane's access).
    const dispatched = await call('POST', '/api/proxy/dispatch', { prompt: 'Plan this ticket.', issueIdentifier: 'LOCAL-1', appendProxyContext: false });
    assert.equal(dispatched.status, 201, JSON.stringify(dispatched.body));
    assert.equal(await stored(), sealAsAsked(WORDS), 'the first dispatch sealed the words as filed');

    // 2. The plan is written below the block.
    const plan = '## Implementation Plan\n\n1. Write the guide.\n\nSession fit: fits one session';
    const appended = await call('POST', '/api/proxy/issues/i1/description/append', { block: plan });
    assert.equal(appended.status, 200, JSON.stringify(appended.body));
    assert.equal(await stored(), `${sealAsAsked(WORDS)}\n\n${plan}`);

    // 3. A close-out that rewrites the whole body, dropping the block, is refused.
    const before = await stored();
    const rewrite = await call('PATCH', '/api/proxy/issues/i1', { description: '## Summary\n\nShipped a guide.' });
    assert.equal(rewrite.status, 422, JSON.stringify(rewrite.body));
    assert.equal(rewrite.body.code, 'AS_ASKED_IMMUTABLE');
    assert.equal(await stored(), before, 'nothing was written');

    // 4. The prune goes through description/below and never re-sends the words.
    const pruned = await call('POST', '/api/proxy/issues/i1/description/below', { body: '## Summary\n\nShipped a guide.' });
    assert.equal(pruned.status, 200, JSON.stringify(pruned.body));

    // The filed words are still there, byte for byte.
    const final = await stored();
    assert.equal(final, `${sealAsAsked(WORDS)}\n\n## Summary\n\nShipped a guide.`);
    assert.equal(splitAsAsked(final).words, WORDS);
  } finally {
    console.log = quiet;
    await new Promise((resolve) => server.close(resolve));
  }
});
