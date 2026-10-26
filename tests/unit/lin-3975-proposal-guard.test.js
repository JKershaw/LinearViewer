/**
 * LIN-3975 (PR 3, the shared guard F3): a chat proposal is for the run the turn is about, and nothing else.
 *
 * `persistProposal` (routes/task-chat.js) is the one place a proposal is written, and both producers go through it.
 * The model chooses the `sessionId` a `send_follow_up` proposal targets, so a run-scoped chat on run A could stage a
 * proposal for run B, and Apply would then resume run B from run A's page. The guard refuses that before anything is
 * written, and the refusal reaches the reader as the tool-error breadcrumb.
 *
 * Drives the real route (real Express, the LIN-3126 harness) and the real turn core with its real chat-tool catalog;
 * the model is a fake that calls `send_follow_up` once with the session it chose.
 *
 * Run with: node --test tests/unit/lin-3975-proposal-guard.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeSingleRepoWorkspace, buildTaskChatApp, withServer, installGitHubProvider } from './lin-3126-harness.js';

const URL_KEY = 'acme';
const RUN_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_RUN_ID = '66666666-7777-4888-8999-000000000000';
const T_DISPATCHED = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const T_DONE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

/** A terminal cli session on one issue. */
function sessionRow(id, issueIdentifier) {
  return {
    id,
    promptName: 'implementation',
    prompt: 'prompt body',
    issueId: `uuid-${issueIdentifier}`,
    issueIdentifier,
    issueTitle: `Task ${issueIdentifier}`,
    issueUrl: `https://example.test/${issueIdentifier}`,
    workspace: { urlKey: URL_KEY },
    dispatchedAt: T_DISPATCHED,
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: T_DONE,
    kind: 'autopilot',
    feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
  };
}

/** Two terminal sessions in this workspace: the run the chat is about (TEST-1) and another run (TEST-2). */
function twoSessionStores() {
  const history = [sessionRow(RUN_ID, 'TEST-1'), sessionRow(OTHER_RUN_ID, 'TEST-2')];
  return {
    dispatchQueueStore: {
      getGrantDeclaration: async () => ({ state: 'none' }),
      async listItems() { return []; },
      async listHistory() { return { items: history, total: history.length }; },
      async getItemStatus() { return null; },
      async addItem() { throw new Error('a proposal dispatches nothing'); },
    },
    agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
  };
}

function fakeRunProposalsStore() {
  const created = [];
  return { created, async create(doc) { created.push(doc); return { id: 'prop-1', ...doc }; } };
}

/**
 * A model that calls `send_follow_up` once, aimed at `sessionId`, in the turn's propose posture. A throwing tool is a
 * tool-error frame, as lib/openrouter.js emits it (the model is told, the turn goes on), not a failed turn.
 */
function modelProposing(sessionId) {
  return {
    async streamChat() { throw new Error('streamChat must not be used for a tool-capable turn'); },
    async streamChatWithTools(_messages, options, onEvent) {
      const call = { id: 'call-1', name: 'send_follow_up', arguments: { sessionId, prompt: 'do the next thing' } };
      try {
        const raw = await options.executeTool(call);
        onEvent('tool', { phase: 'result', iteration: 1, id: call.id, name: call.name, result: raw });
      } catch (err) {
        onEvent('tool', { phase: 'error', iteration: 1, id: call.id, name: call.name, error: err.message });
      }
      onEvent('done', {});
    },
  };
}

function realAiWorkspace() {
  installGitHubProvider();
  return { ...makeSingleRepoWorkspace(), accessToken: 'live-token' };
}

describe('LIN-3975 — a run-scoped chat proposes only for the run it is about', () => {
  test('a proposal aimed at another run is refused: nothing persisted, and the refusal is the tool-error breadcrumb', async () => {
    const stores = twoSessionStores();
    const runProposalsStore = fakeRunProposalsStore();
    const app = buildTaskChatApp({
      workspace: realAiWorkspace(),
      dispatchQueueStore: stores.dispatchQueueStore,
      agentStatusStore: stores.agentStatusStore,
      proxyTokenStore: { async createToken() { return { token: 'minted' }; } },
      runProposalsStore,
      sessionOverrides: { openRouterApiKey: 'sk-test' },
      freeTierStore: { tryUse: async () => ({ allowed: true }) },
      chatClient: modelProposing(OTHER_RUN_ID),
    });

    const { status, text } = await withServer(app, ({ post }) =>
      post(`/workspace/${URL_KEY}/api/task-chat/TEST-1`, { question: 'please follow up on this', runId: RUN_ID }));

    assert.strictEqual(status, 200);
    assert.strictEqual(runProposalsStore.created.length, 0, 'the other run\'s proposal is not persisted');
    assert.ok(text.includes('"phase":"error"'), 'the refusal reaches the reader as a tool error');
    assert.ok(text.includes(`Proposal targets session ${OTHER_RUN_ID}, not this run`), 'the refusal names the run it was aimed at');
  });

  test('a proposal for the run the turn is about is still persisted, once', async () => {
    const stores = twoSessionStores();
    const runProposalsStore = fakeRunProposalsStore();
    const app = buildTaskChatApp({
      workspace: realAiWorkspace(),
      dispatchQueueStore: stores.dispatchQueueStore,
      agentStatusStore: stores.agentStatusStore,
      proxyTokenStore: { async createToken() { return { token: 'minted' }; } },
      runProposalsStore,
      sessionOverrides: { openRouterApiKey: 'sk-test' },
      freeTierStore: { tryUse: async () => ({ allowed: true }) },
      chatClient: modelProposing(RUN_ID),
    });

    const { text } = await withServer(app, ({ post }) =>
      post(`/workspace/${URL_KEY}/api/task-chat/TEST-1`, { question: 'please follow up on this', runId: RUN_ID }));

    assert.equal(runProposalsStore.created.length, 1);
    assert.equal(runProposalsStore.created[0].runId, RUN_ID);
    assert.ok(text.includes('"phase":"proposed"'));
  });
});
