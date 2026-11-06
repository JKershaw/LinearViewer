/**
 * LIN-3975 (finding 1): a chat proposal reaches the run control without a reload.
 *
 *   - the route: `GET …/api/task/:identifier/proposals` is the owner's only, lists the pending proposals for the
 *     task's runs (status `proposed`, the reason is the prompt's first line), and refuses a member with a 403;
 *   - the fold client (vm): `TaskChat.init` calls its `onProposed` hook on the `proposed` tool frame, and on no other
 *     frame, so the page re-reads the staged list when a turn proposes;
 *   - the page's URL helper: the proposals read sits beside the state read the page polls.
 *
 * The run control's own repaint (`setProposals`) is in lin-3975-task-run-control.test.js, beside its harness.
 *
 * Run with: node --test tests/unit/lin-3975-proposal-refresh.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPageRoutes } from '../../routes/task-page.js';
import { renderTaskChatFold } from '../../lib/render-task-chat.js';
import { loadWorld, clickOn } from './helpers/client-world.js';
import { createTaskPageLoader } from '../../lib/task-page-loader.js';
import { enrichLoop, deriveSessionWaiting } from '../../routes/dashboard.js';

const NOW = new Date('2026-10-06T15:00:00.000Z');
const UUID = '11111111-2222-3333-4444-555555555555';
const flush = () => new Promise((r) => setTimeout(r, 0));

const STORED_LOOP = {
  loopId: 'l1', issueIdentifier: 'LIN-50', issueId: UUID, issueTitle: 'Stored title', kind: 'implementation', target: 'cli', iteration: 1,
  source: 'history', historyStatus: 'taken', agentState: 'done', dispatchedAt: '2026-10-06T14:00:00.000Z',
  takenAt: '2026-10-06T14:01:00.000Z', resolvedAt: '2026-10-06T14:01:00.000Z', terminalStatus: 'done', terminalCompletedAt: '2026-10-06T14:05:00.000Z',
  wakeMarker: null, waitingMessage: null, feedback: [], telemetry: { producedArtifacts: [] }, followUpTo: null,
};

function loader() {
  return createTaskPageLoader({
    dispatchStore: {}, agentStatusStore: {}, enrichLoop, deriveSessionWaiting,
    getLoopsForIssue: async () => [STORED_LOOP], now: () => NOW,
  });
}

/** A store that stages two proposals, one settled, so the filter to pending is observable. */
function proposalStore(calls) {
  return {
    list: async (urlKey, runId) => {
      calls.push({ urlKey, runId });
      return [
        { id: 'p-1', runId, status: 'proposed', prompt: 'Please post a status update.\nWith the details.' },
        { id: 'p-2', runId, status: 'applied', prompt: 'Already done.' },
      ];
    },
  };
}

async function getProposals({ check, store }) {
  const router = createTaskPageRoutes({
    workspaceFromUrl: (req, res, next) => next(),
    getOpenRouterSource: () => 'env',
    getDeployInfo: () => ({}),
    loader: loader(),
    workspaceOwnerCheck: check,
    runProposalsStore: store,
    now: () => NOW,
  });
  const path = '/workspace/:urlKey/api/task/:identifier/proposals';
  const layer = router.stack.find(l => l.route?.path === path && l.route.methods.get);
  assert.ok(layer, 'GET the proposals read is registered');
  const req = {
    session: { workspaces: [], features: {}, accountId: 'acct-1' },
    workspace: { urlKey: 'acme', id: 'ws-1' },
    params: { urlKey: 'acme', identifier: 'LIN-50' },
    query: { issueId: UUID },
    get: () => 'localhost',
  };
  const res = {
    statusCode: 200, jsonBody: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.jsonBody = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
  const stack = layer.route.stack;
  await stack[stack.length - 1].handle(req, res, (err) => { if (err) throw err; });
  return res;
}

const OWNER = async () => ({ status: 'owner' });
const MEMBER = async () => ({ status: 'not-owner' });

describe('LIN-3975 — the staged proposals are the owner\'s, read on their own route', () => {
  test('the owner gets the pending proposals only, each with its reason (the first line of the prompt)', async () => {
    const calls = [];
    const res = await getProposals({ check: OWNER, store: proposalStore(calls) });
    assert.equal(res.statusCode, 200);
    assert.ok(calls.length >= 1, 'the proposals are read from the store, for the task\'s runs');
    assert.deepEqual(res.jsonBody, {
      proposals: [{ id: 'p-1', runId: calls[0].runId, reason: 'Please post a status update.' }],
    }, 'the settled proposal (p-2) is not staged again');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });

  test('a member is refused with a 403, and no proposal is read for them', async () => {
    const calls = [];
    const res = await getProposals({ check: MEMBER, store: proposalStore(calls) });
    assert.equal(res.statusCode, 403);
    assert.equal(res.jsonBody.proposals, undefined, 'the refusal carries no proposal');
    assert.deepEqual(calls, [], 'the store is never read for a member');
  });

  test('a malformed id is a 404 and reads nothing', async () => {
    const calls = [];
    const router = createTaskPageRoutes({
      workspaceFromUrl: (req, res, next) => next(), getOpenRouterSource: () => 'env', getDeployInfo: () => ({}),
      loader: loader(), workspaceOwnerCheck: OWNER, runProposalsStore: proposalStore(calls), now: () => NOW,
    });
    const layer = router.stack.find(l => l.route?.path === '/workspace/:urlKey/api/task/:identifier/proposals');
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } };
    const req = { session: { accountId: 'acct-1' }, workspace: { urlKey: 'acme', id: 'ws-1' }, params: { identifier: 'bad id!' }, query: {} };
    const stack = layer.route.stack;
    await stack[stack.length - 1].handle(req, res, () => {});
    assert.equal(res.statusCode, 404);
    assert.deepEqual(calls, []);
  });
});

// ─── the fold client, on the server's own fold markup ────────────────────────

/**
 * Loads public/task-chat.js on loadWorld, with the server's fold markup (`renderTaskChatFold`, the page's own renderer)
 * as the page root: its hooks are the `<input>`s, `<ul>`, `<p>` and `<button>` the renderer writes, so `hook(name)` is
 * the element the page drew. The shared ChatUI is a stub, as before (its own suite is chat.js's): it builds each bubble as
 * real nodes in the world's document and records the markdown the fold would render. A model reply of `frames` (SSE frames,
 * in order) comes through the shared readSSEStream stub. Returns the fold's send button, so a test presses it as a reader does.
 */
function loadFold({ frames, onProposed, propose = true }) {
  const rendered = [];
  const posts = [];
  const ChatUI = {
    appendMessage(thread, opts) {
      const li = world.document.createElement('li');
      li.className = opts.liClass;
      const who = world.document.createElement('span');
      who.className = 'chat-msg__who';
      const body = world.document.createElement('div');
      body.className = opts.textClass;
      body.textContent = opts.text;
      li.appendChild(who);
      li.appendChild(body);
      thread.appendChild(li);
      return li;
    },
    appendNote(thread, text, opts = {}) {
      const li = world.document.createElement('li');
      li.className = opts.liClass || 'chat-msg';
      li.textContent = text;
      if (opts.before) thread.insertBefore(li, opts.before);
      else thread.appendChild(li);
      return li;
    },
    isPinnedToBottom: () => false,
    renderMarkdownText(el, text) { rendered.push(text); },
    toolBreadcrumbLabel: (e) => `${e.name} ${e.phase}`,
  };
  const world = loadWorld({
    scripts: ['task-chat.js'],
    window: {
      ChatUI,
      api: async () => ({}),
      toast() {},
      escapeHtml: (s) => String(s),
      readSSEStream: async (response, onEvent) => { for (const [type, data] of frames) onEvent(type, data); },
      fetch: async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true }; },
    },
  });
  world.document.body.innerHTML = renderTaskChatFold({ urlKey: 'acme', identifier: 'LIN-50' });
  const root = world.document.querySelector('[data-task-chat-root]');
  const hook = (name) => root.querySelector(`[data-task-chat="${name}"]`);
  hook('question').value = 'Can you follow up?';
  world.window.TaskChat.init(root, { urlKey: 'acme', propose, ...(onProposed ? { onProposed } : {}) });
  return { send: hook('send'), rendered, posts };
}

describe('LIN-3975 — the fold\'s turns go out as propose, and only the fold\'s', () => {
  test('a fold turn is sent with propose: true on the wire', async () => {
    const { send, posts } = loadFold({ frames: [['done', {}]], propose: true });
    await clickOn(send);
    await flush();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.propose, true);
  });

  test('a standalone chat (no propose option) sends no propose flag, so it stays an ordinary chat', async () => {
    const { send, posts } = loadFold({ frames: [['done', {}]], propose: false });
    await clickOn(send);
    await flush();
    assert.equal(posts.length, 1);
    assert.ok(!('propose' in posts[0].body), 'the body carries no propose key');
  });
});

describe('LIN-3975 — the fold tells the page when a turn proposed a follow-up', () => {
  const PROPOSED = { phase: 'proposed', iteration: 1, name: 'send_follow_up', result: 'proposed a follow-up to session s-1' };

  test('the proposed frame calls onProposed once, with the frame; the call frame and the answer do not', async () => {
    const seen = [];
    const { send } = loadFold({
      frames: [
        ['tool', { phase: 'call', iteration: 1, name: 'send_follow_up', arguments: { sessionId: 's-1', prompt: 'x' } }],
        ['tool', PROPOSED],
        ['token', { token: 'Staged it.' }],
        ['done', {}],
      ],
      onProposed: (frame) => seen.push(frame),
    });
    await clickOn(send);
    await flush();
    await flush();
    assert.deepEqual(seen, [PROPOSED], 'exactly the proposed frame reaches the host');
  });

  test('a fold with no onProposed host still streams its turn (the hook is optional)', async () => {
    const { send, rendered } = loadFold({
      frames: [['tool', PROPOSED], ['token', { token: 'ok' }], ['done', {}]],
    });
    await clickOn(send);
    await flush();
    await flush();
    assert.deepEqual(rendered, ['ok'], 'the stream runs on to its done frame past the proposed frame');
  });
});

describe('LIN-3975 — the page names the proposals read beside the state it polls', () => {
  // The page script is an ES module-free IIFE; its helper is read through a vm, as the other client tests do.
  function proposalsUrlOf(stateUrl) {
    const world = loadWorld({ scripts: ['task-page.js'], window: { module: { exports: {} } } });
    return world.window.module.exports.proposalsUrlOf(stateUrl);
  }

  test('the state URL becomes the proposals URL, the same task and query', () => {
    assert.equal(
      proposalsUrlOf('/workspace/acme/api/task/LIN-50/state?issueId=11111111-2222-3333-4444-555555555555'),
      '/workspace/acme/api/task/LIN-50/proposals?issueId=11111111-2222-3333-4444-555555555555',
    );
    assert.equal(proposalsUrlOf('/workspace/acme/api/task/LIN-50/state'), '/workspace/acme/api/task/LIN-50/proposals');
  });

  test('a path that merely contains "state" in its middle is left alone', () => {
    assert.equal(proposalsUrlOf('/workspace/acme/api/task/LIN-50/statex'), '/workspace/acme/api/task/LIN-50/statex');
  });
});
