// Route tests for GET /workspace/:urlKey/api/sessions/:identifier (LIN-3913).
//
// Run with: node --test tests/unit/sessions-route.test.js
//
// Mounts the REAL router with in-memory fake dispatch + agent-status stores, so this
// exercises the actual handler: the 100-char identifier bound, the 503 when a store is
// missing, newest-first ordering, and the noPrompt read projection.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { findRouteLayer } from './lib/route-layer.js';

const PATH = '/workspace/:urlKey/api/sessions/:identifier';

before(() => { process.env.NODE_ENV = 'test'; });

function getHandler(router, method, path) {
  const layer = findRouteLayer(router, method, path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

// Items dispatched N minutes ago, so they sit inside the lookback window.
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const item = (id, minutes) => ({
  id, kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
  dispatchedAt: minutesAgo(minutes), status: 'done', target: 'cli',
});

function fakeDispatchStore({ items = [] } = {}) {
  const reads = { historyOpts: [] };
  return {
    reads,
    async listItems() { return items; },
    async listHistory(_urlKey, opts) { reads.historyOpts.push(opts); return { items: [] }; },
  };
}

const fakeAgentStatusStore = () => ({ async listStatus() { return { items: [] }; } });

function makeRouter({ dispatchQueueStore, agentStatusStore } = {}) {
  return createWorkspaceApiRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    dispatchQueueStore,
    agentStatusStore,
  });
}

async function callRoute(router, identifier = 'LIN-7') {
  const handler = getHandler(router, 'get', PATH);
  const req = { workspace: { urlKey: 'ws' }, params: { urlKey: 'ws', identifier }, query: {} };
  const res = {
    statusCode: 200, jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

describe('GET /api/sessions/:identifier (LIN-3913)', () => {
  test('identifier bound: 100 chars is accepted, 101 is refused with 400', async () => {
    const router = makeRouter({ dispatchQueueStore: fakeDispatchStore(), agentStatusStore: fakeAgentStatusStore() });
    const atBound = await callRoute(router, 'L'.repeat(100));
    assert.equal(atBound.statusCode, 200);

    const overBound = await callRoute(router, 'L'.repeat(101));
    assert.equal(overBound.statusCode, 400);
    assert.equal(overBound.jsonBody.error, 'Invalid issue identifier');
  });

  test('503 when dispatchQueueStore is missing', async () => {
    const res = await callRoute(makeRouter({ agentStatusStore: fakeAgentStatusStore() }));
    assert.equal(res.statusCode, 503);
    assert.equal(res.jsonBody.error, 'Sessions are not available');
  });

  test('503 when agentStatusStore is missing', async () => {
    const res = await callRoute(makeRouter({ dispatchQueueStore: fakeDispatchStore() }));
    assert.equal(res.statusCode, 503);
    assert.equal(res.jsonBody.error, 'Sessions are not available');
  });

  test('newest-first: the most recently dispatched session is first', async () => {
    const dispatchQueueStore = fakeDispatchStore({ items: [item('old', 30), item('newest', 1), item('middle', 10)] });
    const res = await callRoute(makeRouter({ dispatchQueueStore, agentStatusStore: fakeAgentStatusStore() }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody.sessions.map((s) => s.loopId), ['newest', 'middle', 'old']);
  });

  test('noPrompt: the history read drops the prompt projection (LIN-3812)', async () => {
    const dispatchQueueStore = fakeDispatchStore({ items: [item('only', 1)] });
    await callRoute(makeRouter({ dispatchQueueStore, agentStatusStore: fakeAgentStatusStore() }));
    assert.ok(dispatchQueueStore.reads.historyOpts.length > 0);
    for (const opts of dispatchQueueStore.reads.historyOpts) {
      assert.deepEqual(opts.projection, { prompt: 0 });
    }
  });
});
