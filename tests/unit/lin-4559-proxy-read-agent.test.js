/**
 * LIN-4559 — GET /api/proxy/dispatch/:id names the child agent on an `agent-text` entry.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4559-proxy-read-agent.test.js
 *
 * Found by the post-deploy live check: the stored entry carried `agent`, but the proxy read's own feedback
 * projection dropped it, so a driving session saw child words with no way to tell which child said them.
 * FIX-PROVING: fails against routes/proxy-dispatch.js without the `agent` line.
 */
process.env.NODE_ENV = 'test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createProxyRoutes } from '../../routes/proxy.js';
import { seededStore } from '../fixtures/dispatch-list-store.js';

const T1 = '2026-06-22T10:00:00.000Z';

async function readItem(feedback) {
  const store = await seededStore({
    queued: [],
    history: [{
      id: 'row-1', status: 'taken', promptName: 'close-out', kind: 'close-out', issueIdentifier: 'LIN-4559',
      issueUrl: null, target: 'cli', dispatchedAt: T1, resolvedAt: null, rootItemId: 'row-1', feedback
    }]
  });
  const app = express();
  app.use(express.json());
  app.use(createProxyRoutes({
    proxyTokenStore: { validateToken: async () => ({ tokenId: 't1', urlKey: 'acme', label: 'test', scope: 'read', createdBy: 'u1' }) },
    proxyEventStore: { recordEvent: async () => {} },
    resolveWorkspaceAccess: async () => ({ token: 'test-token', reason: 'ok' }),
    getWorkspaceAccessToken: async () => 'test-token',
    getWorkspaceOpenRouterKey: async () => null,
    agentStatusStore: {},
    dispatchQueueStore: store,
    workspaceFromUrl: (req, res, next) => next(),
    freeTierStore: { tryUse: async () => ({ allowed: true }) }
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/proxy/dispatch/row-1`, { headers: { Authorization: 'Bearer anything' } });
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('an agent-text entry reads back with the agent it names; every other entry keeps its key set', async () => {
  const { status, body } = await readItem([
    { message: 'own words', kind: 'assistant-text', rootItemId: 'row-1', timestamp: T1 },
    { message: 'child words', kind: 'agent-text', agent: 'a36e5480e6d5e7023', timestamp: T1 },
    { message: 'plain', timestamp: T1 }
  ]);
  assert.equal(status, 200);
  const [own, child, plain] = (body.item || body).feedback;
  assert.equal(child.agent, 'a36e5480e6d5e7023');
  assert.equal(child.kind, 'agent-text');
  assert.equal('agent' in own, false, 'sparse: only an agent-text entry carries agent');
  assert.equal('agent' in plain, false);
});
