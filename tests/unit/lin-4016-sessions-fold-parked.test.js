/**
 * LIN-4016 — the Sessions fold says "parked" for a waiting session on a parked task, and "waiting on you" for one on a
 * ruling. The route reads the task's decided state (the same reader its row and opened task use) and sends `taskParked`;
 * the fold reads that flag and does not re-derive the park rule.
 *
 * The route is the real one (createWorkspaceApiRoutes), over in-memory stores, the same as sessions-route.test.js. The
 * decided state is a stub: its reader is covered by task-state-agreement.test.js.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { findRouteLayer } from './lib/route-layer.js';
import { escapeHtml } from '../../lib/utils/html.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_SRC = readFileSync(join(__dirname, '../../public/sessions.js'), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));

const PATH = '/workspace/:urlKey/api/sessions/:identifier';

before(() => { process.env.NODE_ENV = 'test'; });

function getHandler(router, method, path) {
  const layer = findRouteLayer(router, method, path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const item = (id, minutes) => ({
  id, kind: 'implementation', promptName: 'implementation', issueIdentifier: 'LIN-7',
  dispatchedAt: minutesAgo(minutes), status: 'done', target: 'cli',
});

// One session that a worker left blocked (its agent status is `blocked`, which reads as waiting).
const blockedSession = () => ({
  dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [item('d-1', 5)] }; } },
  agentStatusStore: { async listStatus() { return { items: [{ dispatchId: 'd-1', taskIdentifier: 'LIN-7', status: 'blocked', issueIdentifier: 'LIN-7', timestamp: minutesAgo(4) }] }; } },
});

async function callRoute(loadTaskState, stores) {
  const router = createWorkspaceApiRoutes({ workspaceFromUrl: (req, res, next) => next(), ...stores, loadTaskState });
  const handler = getHandler(router, 'get', PATH);
  const req = { workspace: { urlKey: 'ws' }, params: { urlKey: 'ws', identifier: 'LIN-7' }, query: {} };
  const res = {
    statusCode: 200, jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
  await handler(req, res, (err) => { if (err) throw err; });
  return res;
}

describe('LIN-4016 — the sessions route says whether a waiting session sits on a parked task', () => {
  test('a waiting session on a parked task: taskParked is true, read from the decided task state', async () => {
    const reads = [];
    const loadTaskState = async (args) => { reads.push(args); return { taskState: { state: 'parked' } }; };
    const res = await callRoute(loadTaskState, blockedSession());
    assert.equal(res.jsonBody.sessions[0].agentState, 'waiting');
    assert.equal(res.jsonBody.taskParked, true);
    assert.deepEqual(reads, [{ urlKey: 'ws', identifier: 'LIN-7' }]);
  });

  test('a waiting session on a ruling: taskParked is false (the fold keeps "waiting on you")', async () => {
    const loadTaskState = async () => ({ taskState: { state: 'needs-you' } });
    const res = await callRoute(loadTaskState, blockedSession());
    assert.equal(res.jsonBody.taskParked, false);
  });

  test('no waiting session: the decided state is not read at all', async () => {
    let reads = 0;
    const loadTaskState = async () => { reads += 1; return { taskState: { state: 'parked' } }; };
    const stores = {
      dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [item('d-2', 5)] }; } },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
    };
    const res = await callRoute(loadTaskState, stores);
    assert.equal(res.jsonBody.sessions[0].agentState, 'running');
    assert.equal(res.jsonBody.taskParked, false);
    assert.equal(reads, 0);
  });
});

// The fold's word for a waiting session: the browser reads the route's flag and paints it (public/sessions.js).
async function foldWordFor(data) {
  const window = { escapeHtml, relativeTime: () => '', runPageHref: () => null, api: async () => data };
  const sandbox = { window, console };
  vm.createContext(sandbox);
  vm.runInContext(SESSIONS_SRC, sandbox, { filename: 'sessions.js' });
  const container = { innerHTML: '', classList: { add() {} }, setAttribute() {}, querySelector: () => null };
  sandbox.window.SessionsSection.init(container, { urlKey: 'acme', identifier: 'LIN-7', home: true, stageWords: {} });
  await flush(); await flush();
  return /<span class="session-state-word">([^<]*)<\/span>/.exec(container.innerHTML)?.[1] ?? null;
}

const waitingSession = { sessionId: 's-1', agentState: 'waiting', stage: 'implementation', dispatchedAt: null, feedback: [] };

describe('LIN-4016 — the Sessions fold paints the word the server decided', () => {
  test('a waiting session on a parked task reads "parked"', async () => {
    assert.equal(await foldWordFor({ sessions: [waitingSession], taskParked: true }), 'parked');
  });

  test('a waiting session on a ruling still reads "waiting on you"', async () => {
    assert.equal(await foldWordFor({ sessions: [waitingSession], taskParked: false }), 'waiting on you');
  });

  test('a running session reads "running" whatever the park flag says', async () => {
    assert.equal(await foldWordFor({ sessions: [{ ...waitingSession, agentState: 'running' }], taskParked: true }), 'running');
  });
});
