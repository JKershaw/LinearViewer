/**
 * LIN-3254 beat 3 — run-scoped chat proposes instead of acting.
 *
 * Two layers:
 *   - the agent-turn core: a propose-mode `send_follow_up` result calls
 *     `onProposal` and dispatches nothing, while an ordinary (execute-mode)
 *     turn still dispatches through the factory.
 *   - the task-chat route (mockAi branch, no LLM): a run-scoped turn persists
 *     exactly one proposal and emits a `proposed` frame; a turn with an unknown
 *     or malformed run is refused; a non-run chat behaves exactly as today.
 *
 * Drives the real route through the LIN-3126 harness (real Express, loopback
 * bind, a registered fixture provider) and the real turn core with its real
 * chat-tool catalog.
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentTurn } from '../../lib/agent-turn.js';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { makeSingleRepoWorkspace, buildTaskChatApp, withServer, installGitHubProvider, REPO_A } from './lin-3126-harness.js';

const URL_KEY = 'acme';
const RUN_ID = '11111111-2222-4333-8444-555555555555';
const T_DISPATCHED = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const T_DONE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

function sessionHistoryRow(overrides = {}) {
  return {
    id: 'sess-run',
    promptName: 'implementation',
    prompt: 'prompt body',
    issueId: 'uuid-500',
    issueIdentifier: 'TEST-1',
    issueTitle: 'A task',
    issueUrl: 'https://example.test/TEST-1',
    workspace: { urlKey: URL_KEY },
    dispatchedAt: T_DISPATCHED,
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: T_DONE,
    kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
    ...overrides,
  };
}

/** Stores backing a single terminal cli session, with an addItem spy. */
function makeSessionStores({ sessionId = 'sess-run', target = 'cli' } = {}) {
  const addItemCalls = [];
  const history = [sessionHistoryRow({ id: sessionId, target })];
  const dispatchQueueStore = {
    getGrantDeclaration: async () => ({ state: 'none' }),
    async listItems() { return []; },
    async listHistory() { return { items: history, total: history.length }; },
    async getItemStatus() { return null; },
    async addItem(urlKey, item) {
      addItemCalls.push({ urlKey, item });
      return { _id: 'disp-new-1', dispatchedAt: new Date().toISOString(), ...item };
    },
  };
  const agentStatusStore = { async listStatus() { return { items: [], total: 0 }; } };
  return { dispatchQueueStore, agentStatusStore, addItemCalls };
}

/** A chat client that invokes the catalog's send_follow_up once, then done. */
function followUpClient(sessionId, prompt) {
  return {
    async streamChat() { throw new Error('streamChat must not be used for a tool-capable turn'); },
    async streamChatWithTools(_messages, options, onEvent) {
      const raw = await options.executeTool({
        id: 'call-1', name: 'send_follow_up', arguments: { sessionId, prompt },
      });
      onEvent('tool', { phase: 'result', iteration: 1, id: 'call-1', name: 'send_follow_up', result: raw });
      onEvent('done', {});
    },
  };
}

const PROVIDER = { name: 'fixture', ui: { displayName: 'Fixture' } };

function turnDeps(stores, extra = {}) {
  return {
    observerStateStore: null,
    workspacePreferencesStore: { getWorkspacePreferences: async () => ({}) },
    chatClient: extra.chatClient,
    createToolCatalog: createChatToolCatalog,
    getProvider: () => PROVIDER,
    getScope: () => 'scope',
    buildCensusSeedText: () => 'CENSUS SEED',
    sessionIsTerminal: () => true,
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    proxyTokenStore: { async createToken() { return { token: 'minted' }; } },
    baseUrl: 'http://127.0.0.1',
    dispatchedBy: 'user-1',
    enqueueGuard: async () => null, // LIN-3383: the owner
  };
}

// ── The turn core ────────────────────────────────────────────────────────────

describe('LIN-3254 — run-scoped propose mode at the turn core', () => {
  test('a propose-mode follow-up calls onProposal once, emits a proposed frame, and dispatches nothing', async () => {
    const stores = makeSessionStores();
    const proposals = [];
    const events = [];

    await runAgentTurn({
      workspace: { urlKey: URL_KEY },
      turnKind: 'user-initiated',
      message: 'please follow up',
      apiKey: 'sk-test',
      followUpMode: 'propose',
      onProposal: (p) => proposals.push(p),
      onEvent: (t, d) => events.push([t, d]),
      deps: turnDeps(stores, { chatClient: followUpClient('sess-run', 'do the next thing') }),
    });

    assert.strictEqual(proposals.length, 1, 'exactly one proposal persisted');
    assert.strictEqual(proposals[0].proposed, true);
    assert.strictEqual(proposals[0].sessionId, 'sess-run');
    assert.strictEqual(proposals[0].prompt, 'do the next thing');
    assert.strictEqual(stores.addItemCalls.length, 0, 'propose mode dispatches nothing');

    const phase = events.find(([t, d]) => t === 'tool' && d.phase === 'proposed');
    assert.ok(phase, 'the tool result is emitted with the proposed phase');
  });

  test('an ordinary turn (no followUpMode) still executes — it dispatches through the factory', async () => {
    const stores = makeSessionStores();
    const events = [];

    await runAgentTurn({
      workspace: { urlKey: URL_KEY },
      turnKind: 'user-initiated',
      message: 'please follow up',
      apiKey: 'sk-test',
      onEvent: (t, d) => events.push([t, d]),
      deps: turnDeps(stores, { chatClient: followUpClient('sess-run', 'do the next thing') }),
    });

    assert.strictEqual(stores.addItemCalls.length, 1, 'execute mode dispatches the follow-up');
    assert.strictEqual(stores.addItemCalls[0].item.followUpTo, 'sess-run');
    assert.ok(!events.some(([t, d]) => t === 'tool' && d.phase === 'proposed'), 'no proposed frame on an execute turn');
  });
});

// ── The route (mockAi branch) ────────────────────────────────────────────────

function mockWorkspace() {
  return { ...makeSingleRepoWorkspace(), accessToken: 'test-token' };
}

function makeRouteDeps(stores) {
  return {
    dispatchQueueStore: stores.dispatchQueueStore,
    agentStatusStore: stores.agentStatusStore,
    proxyTokenStore: { async createToken() { return { token: 'minted' }; } },
  };
}

function fakeRunProposalsStore() {
  const created = [];
  return {
    created,
    async create(doc) { created.push(doc); return { id: 'prop-1', ...doc }; },
  };
}

describe('LIN-3254 — run-scoped task-chat turn (mockAi branch)', () => {
  test('a run-scoped follow-up persists exactly one proposal, emits a proposed frame, and dispatches nothing', async () => {
    const stores = makeSessionStores({ sessionId: RUN_ID });
    const runProposalsStore = fakeRunProposalsStore();
    const app = buildTaskChatApp({
      workspace: mockWorkspace(),
      ...makeRouteDeps(stores),
      runProposalsStore,
    });

    const { status, text } = await withServer(app, ({ post }) =>
      post(`/workspace/${URL_KEY}/api/task-chat/TEST-1`, {
        question: 'please follow up on this',
        runId: RUN_ID,
      }));

    assert.strictEqual(status, 200);
    assert.strictEqual(runProposalsStore.created.length, 1, 'exactly one proposal persisted');
    assert.strictEqual(runProposalsStore.created[0].runId, RUN_ID);
    assert.ok(runProposalsStore.created[0].stepLoopId, 'the lineage tail is recorded as the step');
    assert.ok(runProposalsStore.created[0].prompt, 'the proposal carries a prompt');
    assert.ok(text.includes('"phase":"proposed"'), 'the stream reports a proposed result');
    assert.ok(!text.includes('queued a follow-up'), 'nothing is reported as queued');
    assert.strictEqual(stores.addItemCalls.length, 0, 'run-scoped chat dispatches nothing');
  });

  test('a non-run follow-up behaves as today — queued, no proposal, no run-scoped frame', async () => {
    const stores = makeSessionStores();
    const runProposalsStore = fakeRunProposalsStore();
    const app = buildTaskChatApp({
      workspace: mockWorkspace(),
      ...makeRouteDeps(stores),
      runProposalsStore,
    });

    const { status, text } = await withServer(app, ({ post }) =>
      post(`/workspace/${URL_KEY}/api/task-chat/TEST-1`, { question: 'please follow up on this' }));

    assert.strictEqual(status, 200);
    assert.strictEqual(runProposalsStore.created.length, 0, 'a non-run chat never proposes');
    assert.ok(text.includes('queued a follow-up'), 'the mock still reports the queued path');
  });

  test('a non-UUID runId is refused with a 400 before any turn', async () => {
    const stores = makeSessionStores();
    const app = buildTaskChatApp({
      workspace: mockWorkspace(),
      ...makeRouteDeps(stores),
      runProposalsStore: fakeRunProposalsStore(),
    });

    const { status, body } = await withServer(app, ({ post }) =>
      post(`/workspace/${URL_KEY}/api/task-chat/TEST-1`, { question: 'hi', runId: 'not-a-uuid' }));

    assert.strictEqual(status, 400);
    assert.match(body.error, /runId must be a UUID/);
  });

  test('a run id whose session is not in this workspace is refused, nothing persisted', async () => {
    const stores = makeSessionStores();
    const runProposalsStore = fakeRunProposalsStore();
    const app = buildTaskChatApp({
      workspace: mockWorkspace(),
      ...makeRouteDeps(stores),
      runProposalsStore,
    });

    const { status, body } = await withServer(app, ({ post }) =>
      post(`/workspace/${URL_KEY}/api/task-chat/TEST-1`, { question: 'hi', runId: RUN_ID }));

    assert.strictEqual(status, 404);
    assert.match(body.error, /not found in this workspace/);
    assert.strictEqual(runProposalsStore.created.length, 0);
  });
});

// ── The route (REAL AI path) ─────────────────────────────────────────────────
//
// RC2: the mockAi branch above is one path; the real run-scoped turn is the one
// that runs in production. Inject a tool-calling chat client and drive the real
// turn core through the route: the route must spread `followUpMode: 'propose'`
// + `onProposal`, so the catalog returns a proposal (never dispatches) and the
// route persists exactly one row. Mutation M5 (drop that spread) leaves this
// RED while the rest of the suite stays green.

function realAiWorkspace() {
  installGitHubProvider();
  return { ...makeSingleRepoWorkspace(), accessToken: 'live-token' };
}

describe('LIN-3254 — run-scoped task-chat turn (REAL AI path)', () => {
  test('a tool-calling run-scoped turn proposes — dispatches nothing and persists one proposal', async () => {
    const stores = makeSessionStores({ sessionId: RUN_ID });
    const runProposalsStore = fakeRunProposalsStore();
    const app = buildTaskChatApp({
      workspace: realAiWorkspace(),
      ...makeRouteDeps(stores),
      runProposalsStore,
      sessionOverrides: { openRouterApiKey: 'sk-test' },
      freeTierStore: { tryUse: async () => ({ allowed: true }) },
      chatClient: {
        async streamChat() { throw new Error('streamChat must not be used for a tool-capable turn'); },
        async streamChatWithTools(_messages, options, onEvent) {
          const raw = await options.executeTool({
            id: 'call-1', name: 'send_follow_up', arguments: { sessionId: RUN_ID, prompt: 'do the next thing' },
          });
          assert.strictEqual(raw.proposed, true, 'the catalog is in propose mode');
          onEvent('tool', { phase: 'result', iteration: 1, id: 'call-1', name: 'send_follow_up', result: raw });
          onEvent('done', {});
        },
      },
    });

    const { status, text } = await withServer(app, ({ post }) =>
      post(`/workspace/${URL_KEY}/api/task-chat/TEST-1`, {
        question: 'please follow up on this',
        runId: RUN_ID,
      }));

    assert.strictEqual(status, 200);
    assert.strictEqual(stores.addItemCalls.length, 0, 'the real run-scoped path dispatches nothing');
    assert.strictEqual(runProposalsStore.created.length, 1, 'exactly one proposal persisted');
    assert.strictEqual(runProposalsStore.created[0].runId, RUN_ID);
    assert.strictEqual(runProposalsStore.created[0].prompt, 'do the next thing');
    assert.ok(text.includes('"phase":"proposed"'), 'the stream reports the proposed result, not a queued one');
  });
});

// ── LIN-3383: the execute-mode follow-up is owner-only, through the turn core ─

describe('LIN-3383 — send_follow_up in execute mode is owner-only (threaded through runAgentTurn)', () => {
  // Like followUpClient, but records the tool error a real chat client would
  // hand the model instead of letting the throw escape the test.
  const errors = [];
  const guardedClient = (sessionId, prompt) => ({
    async streamChat() { throw new Error('unused'); },
    async streamChatWithTools(_m, options, onEvent) {
      try {
        await options.executeTool({ id: 'call-1', name: 'send_follow_up', arguments: { sessionId, prompt } });
      } catch (err) {
        errors.push(err.message);
      }
      onEvent('done', {});
    },
  });
  const toolResults = () => errors;
  beforeEach(() => { errors.length = 0; });

  async function ordinaryTurn(stores, deps, extra = {}) {
    const events = [];
    await runAgentTurn({
      workspace: { urlKey: URL_KEY },
      turnKind: 'user-initiated',
      message: 'please follow up',
      apiKey: 'sk-test',
      onEvent: (t, d) => events.push([t, d]),
      ...extra,
      deps,
    });
    return events;
  }

  test('a non-owner guard refuses: nothing enqueued, the model sees the coded refusal', async () => {
    const stores = makeSessionStores();
    const seen = [];
    const guard = async ({ target }) => {
      seen.push(target);
      return { code: 'RUNNER_ENQUEUE_OWNER_ONLY', status: 403, retryable: false, error: "Only this workspace's owner can queue work for its runner." };
    };
    const events = await ordinaryTurn(stores, {
      ...turnDeps(stores, { chatClient: guardedClient('sess-run', 'do the next thing') }),
      enqueueGuard: guard,
    });
    assert.strictEqual(stores.addItemCalls.length, 0, 'nothing enqueued');
    assert.deepEqual(seen, ['cli'], 'the guard is asked about the anchor target');
    assert.match(JSON.stringify(toolResults()), /send_follow_up refused \(RUNNER_ENQUEUE_OWNER_ONLY\)/);
  });

  test('an owner guard lets the follow-up through', async () => {
    const stores = makeSessionStores();
    await ordinaryTurn(stores, {
      ...turnDeps(stores, { chatClient: followUpClient('sess-run', 'do the next thing') }),
      enqueueGuard: async () => null,
    });
    assert.strictEqual(stores.addItemCalls.length, 1);
  });

  test('a transient (retryable) refusal relays retry copy, never the owner-only text', async () => {
    const stores = makeSessionStores();
    const events = await ordinaryTurn(stores, {
      ...turnDeps(stores, { chatClient: guardedClient('sess-run', 'do the next thing') }),
      enqueueGuard: async () => ({ code: 'OWNER_CHECK_UNAVAILABLE', status: 503, retryable: true, error: 'Owner verification is temporarily unavailable' }),
    });
    assert.strictEqual(stores.addItemCalls.length, 0);
    assert.match(JSON.stringify(toolResults()), /send_follow_up refused \(OWNER_CHECK_UNAVAILABLE\): retry once shortly/);
  });

  test('execute mode with NO guard wired fails closed', async () => {
    const stores = makeSessionStores();
    const deps = turnDeps(stores, { chatClient: guardedClient('sess-run', 'do the next thing') });
    delete deps.enqueueGuard;
    const events = await ordinaryTurn(stores, deps);
    assert.strictEqual(stores.addItemCalls.length, 0);
    assert.match(JSON.stringify(toolResults()), /send_follow_up refused \(OWNER_CHECK_UNAVAILABLE\)/);
  });

  test('propose mode (run-scoped / auto-wake) never consults the guard and needs none', async () => {
    const stores = makeSessionStores();
    const proposals = [];
    let consulted = 0;
    const deps = {
      ...turnDeps(stores, { chatClient: followUpClient('sess-run', 'do the next thing') }),
      enqueueGuard: async () => { consulted++; return { code: 'RUNNER_ENQUEUE_OWNER_ONLY', status: 403, retryable: false, error: 'x' }; },
    };
    await ordinaryTurn(stores, deps, { followUpMode: 'propose', onProposal: (p) => proposals.push(p) });
    assert.strictEqual(proposals.length, 1);
    assert.strictEqual(consulted, 0);
    assert.strictEqual(stores.addItemCalls.length, 0);

    const bare = turnDeps(stores, { chatClient: followUpClient('sess-run', 'do the next thing') });
    delete bare.enqueueGuard;
    const more = [];
    await ordinaryTurn(stores, bare, { followUpMode: 'propose', onProposal: (p) => more.push(p) });
    assert.strictEqual(more.length, 1, 'propose works with no guard at all');
  });
});
