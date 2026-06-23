/**
 * Unit tests for routes/pipeline.js (LIN-615).
 *
 * Two contracts:
 *   1. The single-task endpoint pushes the issue scope DOWN into the stores
 *      (getTaskForIssue → getLoopsForIssue), so it never reads the whole
 *      workspace log just to keep one issue's loops. We assert the
 *      `issueIdentifier`/`taskIdentifier` predicates reach listItems/listHistory/
 *      listStatus.
 *   2. The inherently workspace-wide /state read (and the /task read) arm a
 *      request-layer keepalive heartbeat so a slow bounded read survives the 30s
 *      H12 router timeout — bounding the request without a blanket store limit.
 *
 * The handlers resolve their provider via the registry, so we register a tiny
 * fake provider for deterministic, offline `fetchProjects`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createPipelineRoutes } from '../../routes/pipeline.js';
import { registerProvider } from '../../lib/providers/registry.js';

const NOW_ISO = new Date().toISOString();

// A fake provider whose fetchProjects returns a fixed issue set, so the route
// runs fully offline. Registered once under a unique name.
const FAKE_PROVIDER = 'fake-lin615';
registerProvider({
  name: FAKE_PROVIDER,
  fetchProjects: async () => ({
    projects: [{ id: 'p1', name: 'Proj', state: 'started' }],
    issues: [
      { id: 'i1', identifier: 'LIN-1', title: 'One', state: { name: 'In Progress', type: 'started' }, parent: null },
      { id: 'i2', identifier: 'LIN-2', title: 'Two', state: { name: 'In Progress', type: 'started' }, parent: null }
    ]
  })
});
const WORKSPACE = { urlKey: 'ws-a', name: 'Alpha', provider: FAKE_PROVIDER };

function getHandler(router, method, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route is registered`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    flushedHeaders: false,
    writes: [],
    endedWith: undefined,
    jsonBody: null,
    writableEnded: false,
    destroyed: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    flushHeaders() { this.flushedHeaders = true; return this; },
    write(chunk) { this.writes.push(chunk); return true; },
    json(b) { this.jsonBody = b; return this; },
    end(b) { this.endedWith = b; this.writableEnded = true; return this; }
  };
}

function makeRouter(stores) {
  return createPipelineRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    getWorkspaceAccessToken: async () => 'token',
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({}),
    handleUnauthorizedError: null
  });
}

describe('GET /api/pipeline/task/:identifier — issue-scoped store pushdown (LIN-615)', () => {
  test('threads issueIdentifier/taskIdentifier into the stores; no whole-workspace read', async () => {
    const seen = { itemOpts: 'UNSET', historyOpts: 'UNSET', statusOpts: 'UNSET' };
    const stores = {
      dispatchQueueStore: {
        async listItems(_urlKey, opts) { seen.itemOpts = opts; return []; },
        async listHistory(_urlKey, opts) { seen.historyOpts = opts; return { items: [] }; }
      },
      agentStatusStore: {
        async listStatus(_urlKey, opts) { seen.statusOpts = opts; return { items: [] }; }
      }
    };
    const router = makeRouter(stores);
    const handler = getHandler(router, 'get', '/workspace/:urlKey/api/pipeline/task/:identifier');
    const req = { workspace: WORKSPACE, params: { identifier: 'LIN-1' }, query: {} };
    const res = makeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.identifier, 'LIN-1');
    // The selective predicate reached every store read — no unscoped fetch.
    assert.deepEqual(seen.itemOpts, { issueIdentifier: 'LIN-1' });
    assert.deepEqual(seen.historyOpts, { issueIdentifier: 'LIN-1' });
    assert.deepEqual(seen.statusOpts, { taskIdentifier: 'LIN-1' });
  });
});

describe('pipeline reads arm a keepalive heartbeat (LIN-615)', () => {
  function stallableStores() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    return {
      release: () => release(),
      stores: {
        dispatchQueueStore: {
          async listItems() { return []; },
          async listHistory() { await gate; return { items: [] }; }
        },
        agentStatusStore: { async listStatus() { return { items: [] }; } }
      }
    };
  }

  async function runStalled(t, path, params) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const { release, stores } = stallableStores();
    const router = makeRouter(stores);
    const handler = getHandler(router, 'get', path);
    const req = { workspace: WORKSPACE, params, query: {} };
    const res = makeRes();

    const done = handler(req, res);
    t.mock.timers.tick(25_000);
    assert.equal(res.flushedHeaders, true, 'keepalive flushed headers before the slow read finished');
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/json/);
    t.mock.timers.tick(15_000);
    assert.ok(res.writes.includes(' '), 'a keepalive heartbeat space was written');

    release();
    await done;
    assert.ok(res.endedWith, 'final JSON body delivered via res.end after the heartbeat');
    return JSON.parse(res.endedWith);
  }

  test('/api/pipeline/state arms keepalive and still returns the snapshot', async (t) => {
    const body = await runStalled(t, '/workspace/:urlKey/api/pipeline/state', {});
    assert.ok(body && typeof body === 'object', 'snapshot delivered');
  });

  test('/api/pipeline/task/:identifier arms keepalive and still returns the task', async (t) => {
    const body = await runStalled(t, '/workspace/:urlKey/api/pipeline/task/:identifier', { identifier: 'LIN-1' });
    assert.equal(body.identifier, 'LIN-1');
  });
});
