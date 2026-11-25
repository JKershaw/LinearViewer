/**
 * LIN-4016 — the Sessions fold says "parked" for a waiting session on a parked task, and "needs you" for one on a
 * ruling. The route reads the task's decided state (the same reader its row and opened task use) and sends `taskParked`;
 * the fold reads that flag and does not re-derive the park rule.
 *
 * The route is the real one (createWorkspaceApiRoutes), over in-memory stores, the same as sessions-route.test.js. The
 * decided state is a stub: its reader is covered by task-state-agreement.test.js.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceApiRoutes } from '../../routes/workspace-api.js';
import { findRouteLayer } from './lib/route-layer.js';
import { escapeHtml } from '../../lib/utils/html.js';
import { loadWorld } from './helpers/client-world.js';

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

  test('a waiting session on a ruling: taskParked is false (the fold keeps "needs you")', async () => {
    const loadTaskState = async () => ({ taskState: { state: 'needs-you' } });
    const res = await callRoute(loadTaskState, blockedSession());
    assert.equal(res.jsonBody.taskParked, false);
  });

  test('the task-state read throws: the sessions still come back (200) and taskParked is false', async () => {
    const loadTaskState = async () => { throw new Error('ruling store down'); };
    const res = await callRoute(loadTaskState, blockedSession());
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.sessions.length, 1);
    assert.equal(res.jsonBody.sessions[0].agentState, 'waiting');
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
  const world = loadWorld({ window: { escapeHtml, relativeTime: () => '', runPageHref: () => null, api: async () => data }, scripts: ['sessions.js'] });
  const container = world.makeContainer();
  world.window.SessionsSection.init(container, { urlKey: 'acme', identifier: 'LIN-7', home: true, stageWords: {} });
  await flush(); await flush();
  return /<span class="session-state-word">([^<]*)<\/span>/.exec(container.innerHTML)?.[1] ?? null;
}

const waitingSession = { sessionId: 's-1', agentState: 'waiting', stage: 'implementation', dispatchedAt: null, feedback: [] };

// LIN-4103 beat 3: the server decides the word a row paints (`sessions[].word`); the fold paints it and decides nothing.
describe('LIN-4016 — the sessions route decides the word the fold paints', () => {
  const waitingStores = () => blockedSession();
  const parked = async (loadTaskState) => (await callRoute(loadTaskState, waitingStores())).jsonBody.sessions[0].word;

  test('a waiting session on a parked task reads "parked"', async () => {
    assert.equal(await parked(async () => ({ taskState: { state: 'parked' } })), 'parked');
  });

  test('a waiting session on a ruling still reads "needs you"', async () => {
    assert.equal(await parked(async () => ({ taskState: { state: 'needs-you' } })), 'needs you');
  });

  test('a running session reads "running" whatever the park flag says', async () => {
    const stores = { dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [item('d-9', 5)] }; } }, agentStatusStore: { async listStatus() { return { items: [] }; } } };
    const res = await callRoute(async () => ({ taskState: { state: 'parked' } }), stores);
    assert.equal(res.jsonBody.sessions[0].word, 'running');
  });

  test('the fold paints the word it is given (the client decides no word)', async () => {
    assert.equal(await foldWordFor({ sessions: [{ ...waitingSession, word: 'parked' }], taskParked: false }), 'parked');
  });
});

// LIN-4070 B (the Sessions fold): the whole life, history not a question, and an incomplete read is safe.
describe('LIN-4070 — the sessions route reads the whole life and words history as history', () => {
  const oldBlockedSession = () => ({
    dispatchQueueStore: { async listItems() { return []; }, async listHistory() { return { items: [item('d-old', 60 * 24 * 40)] }; } },
    agentStatusStore: { async listStatus() { return { items: [{ dispatchId: 'd-old', taskIdentifier: 'LIN-7', status: 'blocked', issueIdentifier: 'LIN-7', timestamp: minutesAgo(60 * 24 * 40 - 1) }] }; } },
  });

  test('a waiting session older than the read window is history: flagged, listed, and never asked as a question', async () => {
    const reads = [];
    const res = await callRoute(async (args) => { reads.push(args); return { taskState: { state: 'parked' } }; }, oldBlockedSession());
    assert.equal(res.jsonBody.sessions.length, 1, 'the whole life lists it (All N equals the list)');
    assert.equal(res.jsonBody.sessions[0].historical, true);
    assert.equal(res.jsonBody.taskParked, false);
    assert.equal(reads.length, 0, 'no state read: nothing in the window waits');
  });

  test('an incomplete state read is taskParked: false, with no warning and no throw', async () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => { warnings.push(args); };
    try {
      const res = await callRoute(async () => ({ model: {}, taskState: null, incomplete: 'cold' }), blockedSession());
      assert.equal(res.statusCode, 200);
      assert.equal(res.jsonBody.taskParked, false);
      assert.equal(warnings.length, 0, 'an incomplete read is not a failure');
    } finally {
      console.warn = original;
    }
  });
});


// LIN-4560 (finding-6ea68b77): a child agent's words reach the fold as the child's, grouped under its agent, never as the
// run's own lines. The route keeps the sparse `agent` each entry names; the fold draws one collapsed group per child.
describe('LIN-4560 — the Sessions fold groups a child agent\'s words under its agent', () => {
  const at = (n) => minutesAgo(n);
  const withFeedback = () => ({
    dispatchQueueStore: {
      async listItems() { return []; },
      async listHistory() {
        return { items: [{ ...item('d-5', 10), feedback: [
          { message: 'Handed the search to an agent.', timestamp: at(9), kind: 'assistant-text' },
          { message: 'Searching lib/.', timestamp: at(8), kind: 'agent-text', agent: 'a1b2c3' },
          { message: 'Waiting on the agent.', timestamp: at(7), kind: 'assistant-text' },
          { message: '[done] found 3 call sites', timestamp: at(6), kind: 'agent-text', agent: 'a1b2c3' },
        ] }] };
      },
    },
    agentStatusStore: { async listStatus() { return { items: [] }; } },
  });

  test('the route keeps the agent a child\'s entry names; the run\'s own entries carry none', async () => {
    const res = await callRoute(async () => ({ taskState: { state: 'needs-you' } }), withFeedback());
    const feedback = res.jsonBody.sessions[0].feedback;
    assert.deepEqual(feedback.map((f) => f.agent ?? null), [null, 'a1b2c3', null, 'a1b2c3']);
    assert.deepEqual(Object.keys(feedback[0]), ['message', 'timestamp'], 'the run\'s own entry keeps its shape');
  });

  test('the fold draws the child\'s lines as one collapsed group at its first line, the run\'s lines as before', async () => {
    const res = await callRoute(async () => ({ taskState: { state: 'needs-you' } }), withFeedback());
    const world = loadWorld({ window: { escapeHtml, relativeTime: () => '', runPageHref: () => null, api: async () => res.jsonBody }, scripts: ['sessions.js'] });
    const container = world.makeContainer();
    world.window.SessionsSection.init(container, { urlKey: 'acme', identifier: 'LIN-7', home: true, stageWords: {} });
    await flush(); await flush();
    const fold = container.querySelector('.session-feedback');
    assert.deepEqual(fold.children.map((el) => el.getAttribute('data-testid') || el.className), ['session-feedback-entry', 'sessions-agent-group', 'session-feedback-entry']);
    const own = fold.children.filter((el) => el.className === 'session-feedback-entry').map((el) => el.textContent.trim());
    assert.deepEqual(own, ['Handed the search to an agent.', 'Waiting on the agent.'], 'the child\'s words are not the run\'s lines');
    const group = fold.querySelector('[data-testid="sessions-agent-group"]');
    assert.equal(group.getAttribute('data-agent'), 'a1b2c3');
    assert.equal(group.hasAttribute('open'), false);
    assert.match(group.querySelector('summary').textContent, /child agent a1b2c3 · 2 lines/);
    assert.deepEqual(group.querySelectorAll('.session-feedback-entry').map((el) => el.textContent.trim()), ['Searching lib/.', '[done] found 3 call sites']);
  });

  test('an agent name is escaped in the summary and the attribute', async () => {
    const data = { sessions: [{ ...waitingSession, word: 'running', feedback: [{ message: 'hi', timestamp: null, agent: 'a"><b>x</b>' }] }], taskParked: false };
    const world = loadWorld({ window: { escapeHtml, relativeTime: () => '', runPageHref: () => null, api: async () => data }, scripts: ['sessions.js'] });
    const container = world.makeContainer();
    world.window.SessionsSection.init(container, { urlKey: 'acme', identifier: 'LIN-7', home: true, stageWords: {} });
    await flush(); await flush();
    const group = container.querySelector('[data-testid="sessions-agent-group"]');
    assert.equal(group.querySelector('summary b'), null);
    assert.equal(group.getAttribute('data-agent'), 'a"><b>x</b>');
  });
});

// LIN-4560: Home's fold masks at read as the run page, Dispatch history and the proxy read do, with piece A's masker, so a
// row stored before intake masking (LIN-4556) shows masked in the fold too. A clean line is unchanged.
describe('LIN-4560 — the Sessions fold masks a row stored before intake masking', () => {
  test('the route sends the secret masked, the clean line as it was, and the fold draws it masked', async () => {
    const { FIXTURE_SECRETS } = await import('../fixtures/secret-scan-fixtures.js');
    const { MASK } = await import('../../lib/mask-secrets.js');
    const stores = {
      dispatchQueueStore: {
        async listItems() { return []; },
        async listHistory() {
          return { items: [{ ...item('d-6', 10), feedback: [
            { message: 'a clean line', timestamp: minutesAgo(9), kind: 'assistant-text' },
            { message: `the token was ${FIXTURE_SECRETS.githubPat} in .env`, timestamp: minutesAgo(8), kind: 'assistant-text' },
          ] }] };
        },
      },
      agentStatusStore: { async listStatus() { return { items: [] }; } },
    };
    const res = await callRoute(async () => ({ taskState: { state: 'needs-you' } }), stores);
    const feedback = res.jsonBody.sessions[0].feedback;
    assert.equal(feedback[0].message, 'a clean line');
    assert.ok(!JSON.stringify(res.jsonBody).includes(FIXTURE_SECRETS.githubPat), 'the secret never leaves the route');
    assert.ok(feedback[1].message.includes(MASK));
    const world = loadWorld({ window: { escapeHtml, relativeTime: () => '', runPageHref: () => null, api: async () => res.jsonBody }, scripts: ['sessions.js'] });
    const container = world.makeContainer();
    world.window.SessionsSection.init(container, { urlKey: 'acme', identifier: 'LIN-7', home: true, stageWords: {} });
    await flush(); await flush();
    assert.ok(container.innerHTML.includes(MASK) && !container.innerHTML.includes(FIXTURE_SECRETS.githubPat));
  });
});
