/**
 * LIN-4080 (ruling lin4080-task-chat-person-force, answered 2026-11-01T15:42:44Z):
 * "Yes, as long as there's a simple indication, a task chat is a human action so
 * can be a forced follow up."
 *
 * The indication is the server-side `personTurn` flag: routes/task-chat.js builds
 * the turn as a session-authenticated, user-initiated chat turn started by the
 * person's own message, and passes `personTurn: true`. The chat-tools executor
 * forwards it to createDispatchItem as `personOriginated`. It is a closure value
 * set by the route, never a tool argument, so the model cannot supply or forge it.
 *
 * Only an execute-mode send reaches createDispatchItem. A run-scoped or propose turn
 * proposes and never enqueues, so it cannot use the flag at all.
 *
 * These tests use a compact fake store. The factory's own admission rules are
 * covered by lin-4080-person-forced-followup.test.js.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createChatToolCatalog } from '../../lib/chat-tools.js';
import { withFreshDigests } from '../fixtures/with-fresh-digests.js';

const URL_KEY = 'ws-key';
const SCOPE = 'workspace-token-abc';
const T_DONE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

/** A TERMINAL autopilot session on LIN-500, cli target: `send_follow_up` derives force:true for it. */
function terminalSessionHistory() {
  return [{
    id: 'sess-done',
    kind: 'autopilot',
    promptName: 'implementation',
    prompt: 'prompt body',
    issueId: 'uuid-500',
    issueIdentifier: 'LIN-500',
    issueTitle: 'A task',
    issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: URL_KEY },
    dispatchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: T_DONE,
    feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
  }];
}

/**
 * A fake store. `stopped` decides what the factory's stopped-run predicate sees for
 * the follow-up target; a recording `addItem` stands in for the queue.
 */
function fakeStore({ stopped }) {
  const calls = [];
  const history = terminalSessionHistory();
  return {
    calls,
    async listItems() { return []; },
    async listHistory(urlKey, options) {
      const id = options?.issueIdentifier;
      const items = withFreshDigests(id ? history.filter(x => x.issueIdentifier === id) : history);
      return { items, total: items.length };
    },
    async isRunStopped() { return stopped; },
    async getGrantDeclaration() { return { state: 'none' }; },
    async addItem(urlKey, item) {
      calls.push({ urlKey, item });
      return { _id: 'queued-item-1', urlKey, ...item };
    },
  };
}

function catalog({ stopped, personTurn }) {
  const dispatchQueueStore = fakeStore({ stopped });
  const { executeTool } = createChatToolCatalog({
    provider: {}, scope: SCOPE, urlKey: URL_KEY,
    dispatchQueueStore,
    agentStatusStore: { async listStatus() { return { items: [], total: 0 }; } },
    sessionIsTerminal: (session) => (session.loops || []).some(l => l.terminalStatus === 'done'),
    followUpEnabled: true,
    dispatchedBy: 'user-1',
    enqueueGuard: async () => null,
    // The route's server-side indication. Omitted = a model-initiated turn with no indication.
    ...(personTurn !== undefined ? { personTurn } : {}),
  });
  return { executeTool, dispatchQueueStore };
}

const RUN_STOPPED = (err) => err.status === 409 && err.runStopped?.code === 'RUN_STOPPED';

describe('LIN-4080 ruling — a person-started Task Chat turn may force a stopped run\'s resume', () => {
  test('with the indication, a forced resume into a stopped run is admitted and stamped personOriginated: true', async () => {
    const { executeTool, dispatchQueueStore } = catalog({ stopped: true, personTurn: true });

    const result = await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });

    assert.equal(result.queued, true);
    assert.equal(result.force, true, 'the terminal tail derives force:true');
    assert.equal(dispatchQueueStore.calls.length, 1, 'the person\'s forced follow-up is enqueued');
    assert.equal(dispatchQueueStore.calls[0].item.personOriginated, true, 'the stored row is stamped');
  });

  test('with the indication, a resume into a run that is NOT stopped is enqueued without the stamp', async () => {
    const { executeTool, dispatchQueueStore } = catalog({ stopped: false, personTurn: true });

    await executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } });

    assert.equal(dispatchQueueStore.calls.length, 1);
    assert.equal('personOriginated' in dispatchQueueStore.calls[0].item, false, 'the stamp marks the exception only');
  });
});

describe('LIN-4080 ruling — without the indication (a model-initiated turn), a stopped run stays refused', () => {
  test('the same forced resume with no indication is refused 409 RUN_STOPPED and enqueues nothing', async () => {
    const { executeTool, dispatchQueueStore } = catalog({ stopped: true });

    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } }),
      RUN_STOPPED
    );
    assert.equal(dispatchQueueStore.calls.length, 0);
  });

  test('a model-supplied personOriginated, personTurn or force argument cannot set the indication', async () => {
    const { executeTool, dispatchQueueStore } = catalog({ stopped: true });

    await assert.rejects(
      () => executeTool({
        name: 'send_follow_up',
        arguments: { sessionId: 'sess-done', prompt: 'ship it', personOriginated: true, personTurn: true, force: true },
      }),
      RUN_STOPPED
    );
    assert.equal(dispatchQueueStore.calls.length, 0, 'the tool arguments never reach the flag');
  });

  test('a turn that does not carry the indication, from any caller, is refused the same way', async () => {
    // A proxy-token or background caller builds the catalog without personTurn; it is the same
    // refusal as above. Passing false explicitly is the same as omitting it.
    const { executeTool, dispatchQueueStore } = catalog({ stopped: true, personTurn: false });

    await assert.rejects(
      () => executeTool({ name: 'send_follow_up', arguments: { sessionId: 'sess-done', prompt: 'ship it' } }),
      RUN_STOPPED
    );
    assert.equal(dispatchQueueStore.calls.length, 0);
  });
});
