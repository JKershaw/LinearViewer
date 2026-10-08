/**
 * LIN-3329 — routes/task-page.js.
 *
 *   - page: 404 for a malformed id or one the tracker doesn't know (no 400
 *     detail), 503 try-again when the tracker can't be read — stored sessions or
 *     not, there is no stored-only page — 422 binding refusal, 200 with the
 *     owner page otherwise, reading through the issue's own binding;
 *   - `/task/new` and `/task/:id/edit` still resolve to their own pages with the
 *     real routers mounted in server.js order, and server.js mounts this router
 *     AFTER task-create;
 *   - the state endpoint never touches a provider;
 *   - both routes sit behind `workspaceFromUrl` (signed-out → its redirect).
 *
 * Run with: node --test tests/unit/task-page-route.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { createTaskCreateRoutes } from '../../routes/task-create.js';
import { createTaskEditRoutes } from '../../routes/task-edit.js';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';
import { registerProvider } from '../../lib/providers/registry.js';
// Side-effect import: the shared nav resolves the legacy default provider.
import '../../lib/providers/linear/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-10-06T15:00:00.000Z');
const UUID = '11111111-2222-3333-4444-555555555555';

const ISSUE_CTX = {
  issue: { id: UUID, identifier: 'LIN-50', title: 'Build the task page', url: null, state: { name: 'In Progress', type: 'started' }, labels: [], blockedBy: [] },
  parent: null,
  children: [],
  comments: [],
};

const STORED_LOOP = {
  loopId: 'l1', issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'Stored title', kind: 'implementation', iteration: 1,
  source: 'history', historyStatus: 'taken', agentState: 'running', dispatchedAt: '2026-10-06T14:00:00.000Z',
  takenAt: '2026-10-06T14:01:00.000Z', resolvedAt: '2026-10-06T14:01:00.000Z', terminalStatus: null, terminalCompletedAt: null,
  wakeMarker: null, waitingMessage: null, feedback: [], telemetry: { producedArtifacts: [] }, followUpTo: null,
};

let providerSeq = 0;
/** Register a spy provider under a unique name; every call is recorded. */
function spyProvider({ read = async () => ISSUE_CTX } = {}) {
  const name = `fake-task-page-${++providerSeq}`;
  const calls = [];
  const record = (method, fn) => async (...args) => { calls.push(method); return fn(...args); };
  registerProvider({
    name,
    ui: { inlineEdit: false, inlineCreate: false },
    supports: () => true,
    fetchRecommendationContext: record('fetchRecommendationContext', read),
    fetchIssueComments: record('fetchIssueComments', async () => []),
    fetchIssueFields: record('fetchIssueFields', async () => null),
    fetchProjects: record('fetchProjects', async () => ({ projects: [] })),
  });
  return { name, calls };
}

function makeLoader({ loops = [STORED_LOOP], calls = null } = {}) {
  const loader = createTaskPageLoader({
    dispatchStore: {},
    agentStatusStore: {},
    enrichLoop,
    deriveSessionWaiting,
    getLoopsForIssue: async () => loops,
    now: () => NOW,
  });
  if (!calls) return loader;
  return {
    loadTaskPage: (args) => { calls.push(['loadTaskPage', args]); return loader.loadTaskPage(args); },
    loadTaskState: (args) => { calls.push(['loadTaskState', args]); return loader.loadTaskState(args); },
  };
}

function makeRouter(loader, workspaceFromUrl = (req, res, next) => next()) {
  return createTaskPageRoutes({ workspaceFromUrl, getOpenRouterSource: () => 'env', getDeployInfo: () => ({}), loader, now: () => NOW });
}

function handlerFor(router, path) {
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods.get);
  assert.ok(layer, `GET ${path} is registered`);
  return layer.route.stack;
}

async function call(router, path, { provider, params, query = {}, bindings } = {}) {
  const stack = handlerFor(router, path);
  const req = {
    session: { workspaces: [], features: {} },
    workspace: { urlKey: 'acme', provider, accessToken: 'tok', ...(bindings ? { bindings } : {}) },
    params: { urlKey: 'acme', ...params },
    query,
    get: () => 'localhost',
  };
  const res = {
    statusCode: 200, body: null, jsonBody: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
    json(b) { this.jsonBody = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
  await stack[stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
  return res;
}

const PAGE = '/workspace/:urlKey/task/:identifier';
const STATE = '/workspace/:urlKey/api/task/:identifier/state';

describe('GET /workspace/:urlKey/task/:identifier', () => {
  test('renders the owner page, reading through the issue binding', async () => {
    const { name, calls } = spyProvider();
    const res = await call(makeRouter(makeLoader()), PAGE, { provider: name, params: { identifier: 'LIN-50' } });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /data-testid="task-page"/);
    assert.match(res.body, /data-testid="task-page-title">Build the task page</);
    assert.match(res.body, /data-state-url="\/workspace\/acme\/api\/task\/LIN-50\/state\?issueId=11111111-2222-3333-4444-555555555555"/);
    assert.match(res.body, /data-testid="task-page-owner-widgets"/, 'the owner controls render');
    assert.deepEqual(calls.filter(c => c !== 'fetchProjects'), ['fetchRecommendationContext']);
  });

  test('a malformed id is a 404 body, never a 400 detail, and reads nothing', async () => {
    const loaderCalls = [];
    const { name, calls } = spyProvider();
    const res = await call(makeRouter(makeLoader({ calls: loaderCalls })), PAGE, { provider: name, params: { identifier: 'not a/valid id!' } });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /data-testid="task-page-not-found"/);
    assert.deepEqual(loaderCalls, []);
    assert.deepEqual(calls, []);
  });

  test('an unknown id (no sessions, tracker not found) is a 404 page', async () => {
    const { name } = spyProvider({ read: async () => { throw new Error('Issue not found: LIN-404'); } });
    const res = await call(makeRouter(makeLoader({ loops: [] })), PAGE, { provider: name, params: { identifier: 'LIN-404' } });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /data-testid="task-page-not-found"/);
    assert.match(res.body, /LIN-404/);
  });

  test('nothing stored and a tracker error that is not not-found → 503 try-again', async () => {
    const { name } = spyProvider({ read: async () => { throw new Error('upstream 502'); } });
    const res = await call(makeRouter(makeLoader({ loops: [] })), PAGE, { provider: name, params: { identifier: 'LIN-50' } });
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Please try again shortly\./);
  });

  test('stored sessions and a tracker error → still the 503 try-again page, no stored-only page', async () => {
    const { name } = spyProvider({ read: async () => { throw new Error('upstream 502'); } });
    const res = await call(makeRouter(makeLoader()), PAGE, { provider: name, params: { identifier: 'LIN-50' } });
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Please try again shortly\./);
    assert.doesNotMatch(res.body, /data-testid="task-page-track"|Stored title|Tracker details unavailable/, 'nothing stored is rendered');
  });

  test('stored sessions but the tracker says not found → the 404 page', async () => {
    const { name } = spyProvider({ read: async () => { throw new Error('Issue not found: LIN-50'); } });
    const res = await call(makeRouter(makeLoader()), PAGE, { provider: name, params: { identifier: 'LIN-50' } });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /data-testid="task-page-not-found"/);
    assert.doesNotMatch(res.body, /Stored title/);
  });
});

describe('GET /workspace/:urlKey/api/task/:identifier/state', () => {
  test('stored data only: no provider call, the same fragments, never done', async () => {
    const { name, calls } = spyProvider();
    const res = await call(makeRouter(makeLoader()), STATE, { provider: name, params: { identifier: 'LIN-50' }, query: { issueId: UUID } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, [], 'the state endpoint never touches the provider');
    assert.deepEqual(Object.keys(res.jsonBody).sort(), ['contextHtml', 'contextSig', 'headerHtml', 'live', 'status', 'trackHtml']);
    assert.equal(res.jsonBody.status, 'running');
    assert.equal(res.jsonBody.live, true);
    assert.match(res.jsonBody.headerHtml, /data-testid="task-page-status"/);
    assert.match(res.jsonBody.trackHtml, /data-loop-id="l1"/);
    assert.equal(typeof res.jsonBody.contextSig, 'string');
    assert.doesNotMatch(res.jsonBody.contextHtml, /task-page-ask|task-page-owner-widgets/, 'viewer-blind: no owner control is re-sent');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });

  test('a malformed id is a 404 and reads nothing', async () => {
    const loaderCalls = [];
    const res = await call(makeRouter(makeLoader({ calls: loaderCalls })), STATE, { provider: spyProvider().name, params: { identifier: 'bad id!' } });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(loaderCalls, []);
  });

  test('a malformed issueId hint is dropped, not passed to the cache read', async () => {
    const loaderCalls = [];
    await call(makeRouter(makeLoader({ calls: loaderCalls })), STATE, { provider: spyProvider().name, params: { identifier: 'LIN-50' }, query: { issueId: '../../etc' } });
    assert.equal(loaderCalls[0][1].issueId, null);
  });
});

describe('both routes sit behind workspaceFromUrl', () => {
  test('the injected middleware runs before each handler (signed-out → its redirect)', async () => {
    const marker = (req, res) => res.redirect('/');
    const router = makeRouter(makeLoader(), marker);
    for (const path of [PAGE, STATE]) {
      const stack = handlerFor(router, path);
      assert.equal(stack.length, 2);
      assert.equal(stack[0].handle, marker, `${path} runs workspaceFromUrl first`);
    }
  });
});

describe('route collisions: /task/new and /task/:id/edit', () => {
  /** The real routers, mounted in server.js order, on a loopback server. */
  async function withApp(fn) {
    const { name } = spyProvider();
    const loaderCalls = [];
    const app = express();
    const workspaceFromUrl = (req, res, next) => {
      req.workspace = { urlKey: req.params.urlKey, provider: name, accessToken: 'tok' };
      req.session = { workspaces: [], features: {} };
      next();
    };
    const deps = { workspaceFromUrl, getOpenRouterSource: () => 'env', getDeployInfo: () => ({}) };
    app.use(createTaskEditRoutes(deps));
    app.use(createTaskCreateRoutes(deps));
    app.use(createTaskPageRoutes({ ...deps, loader: makeLoader({ calls: loaderCalls }), now: () => NOW }));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      await fn(`http://127.0.0.1:${server.address().port}`, loaderCalls);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }

  test('/task/new is task-create\'s, not a task called "new"', async () => {
    await withApp(async (base, loaderCalls) => {
      const res = await fetch(`${base}/workspace/acme/task/new`, { redirect: 'manual' });
      // task-create redirects a provider without inline create to the dashboard.
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/workspace/acme/');
      assert.deepEqual(loaderCalls, [], 'the task page never saw the request');
    });
  });

  test('/task/:id/edit is task-edit\'s', async () => {
    await withApp(async (base, loaderCalls) => {
      const res = await fetch(`${base}/workspace/acme/task/LIN-50/edit`, { redirect: 'manual' });
      assert.equal(res.status, 302, 'task-edit redirects a provider without inline edit');
      assert.deepEqual(loaderCalls, []);
    });
  });

  test('/task/LIN-50 is the task page', async () => {
    await withApp(async (base, loaderCalls) => {
      const res = await fetch(`${base}/workspace/acme/task/LIN-50`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /data-testid="task-page"/);
      assert.equal(loaderCalls.length, 1);
    });
  });

  test('server.js mounts the task page AFTER task-create', () => {
    const src = readFileSync(join(__dirname, '../../server.js'), 'utf8');
    const create = src.indexOf('app.use(createTaskCreateRoutes(');
    const page = src.indexOf('app.use(createTaskPageRoutes(');
    assert.ok(create > 0 && page > 0, 'both are mounted');
    assert.ok(page > create, 'task page mounts after task-create, or /task/new is shadowed');
  });
});
