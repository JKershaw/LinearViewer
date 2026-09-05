/**
 * tests/unit/flight-companion-proxy-turn-route.test.js — LIN-2620.
 *
 * Route-level tests for `POST /api/proxy/flight-companion/turn`
 * (routes/proxy-flight-companion.js), driven through the REAL
 * `createProxyRoutes` composer over real HTTP (via
 * tests/unit/lib/proxy-fake-deps.js's `buildApp`/`call`, the same harness
 * tests/unit/proxy-endpoint-inventory-witness.test.js and
 * tests/unit/proxy-di-witness.test.js use) — proxy-token auth,
 * `resolveProviderAccess`, and the two named rate limiters all run for real;
 * only the LLM transport (`chatClient`) and the tool catalog factory are
 * test seams, injected via `flightCompanionChatClient`/
 * `flightCompanionCreateToolCatalog`.
 *
 * Covers the ticket's acceptance list:
 *  - the real endpoint's SSE frames match the shared fixture byte-for-byte
 *    against the real `sendSSE` (LIN-2453's discharge)
 *  - a proxy turn never reaches `createDispatchItem`, proven through the
 *    REAL `createChatToolCatalog` (not a fake), by driving an actual
 *    `send_follow_up` tool call and asserting the dispatch store's `addItem`
 *    spy stays at zero and the response carries `proposed: true`
 *  - a message-less proxy turn reserves/commits against its OWN instance key
 *    (`companion:v1:<urlKey>:proxy`), never the browser's
 *    (`companion:v1:<urlKey>`) — proven by sharing one fake
 *    observerStateStore between an HTTP proxy call and a direct
 *    `runFlightCompanionTurn` call standing in for the browser
 *  - a message-less proxy turn that loses its own reservation CAS race
 *    returns `{ spent: false, reason: 'lost-race' }` with no model call
 *  - no response body or frame ever contains the caller's bearer token or
 *    the resolved OpenRouter key
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACME, BASE_DEPS, buildApp, call } from './lib/proxy-fake-deps.js';
import { renderSSEFrames } from '../fixtures/flight-companion-sse-frames.js';
import { sendSSE } from '../../lib/sse.js';
import { COMPANION_SEED_STATE } from '../../lib/flight-companion-gate.js';
import { runFlightCompanionTurn } from '../../lib/flight-companion-turn.js';

const OPENROUTER_KEY = 'sk-secret-openrouter-key-abc';
const BEARER = 'sekret-proxy-token-xyz';

// A generic, multi-instance-key CAS fake — every companion/sweep instance
// this suite touches (companion:v1:acme, companion:v1:acme:proxy,
// sweep:v1:acme) lives in the SAME Map, exactly like the real store's one
// collection, so isolation between the browser's and the proxy's own
// reservation instance is a genuine property of shared state, not an
// artifact of two separate fakes.
function fakeObserverStateStore({ census = null, forcedAdvanceResults = {} } = {}) {
  const docs = new Map();
  const advanceLog = [];
  return {
    docs, advanceLog,
    async ensureSeeded(key, seed) {
      if (!docs.has(key)) docs.set(key, { rev: 1, state: seed });
      const d = docs.get(key);
      return { rev: d.rev, state: d.state };
    },
    async readCurrent(key) {
      if (key.startsWith('sweep:')) return census;
      if (!docs.has(key)) return null;
      const d = docs.get(key);
      return { rev: d.rev, state: d.state, stateHash: JSON.stringify(d.state) };
    },
    async advance(key, expectedRev, nextState) {
      advanceLog.push({ key, expectedRev });
      const queued = forcedAdvanceResults[key];
      if (queued && queued.length) return queued.shift();
      if (!docs.has(key)) docs.set(key, { rev: 1, state: COMPANION_SEED_STATE });
      const d = docs.get(key);
      if (expectedRev !== d.rev) return false;
      d.rev += 1;
      d.state = nextState;
      return true;
    },
  };
}

function censusDoc(hash = 'h1', rev = 5) {
  return {
    rev, stateHash: hash,
    state: { lanes: { working: 1, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 }, attention: [{ id: 'x' }], truncated: false },
  };
}

// Minimal, real-reconstruction-shaped session fixture (mirrors
// tests/unit/chat-tools.test.js's makeMockSessionStores/sessionHistoryItem)
// so send_follow_up's REAL executor (via the REAL createChatToolCatalog)
// resolves an actual session, rather than a stubbed shortcut.
function makeDispatchQueueStore() {
  const calls = [];
  const dispatchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const resolvedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const history = [{
    id: 'hist-1', promptName: 'implementation', prompt: 'prompt body',
    issueId: 'uuid-500', issueIdentifier: 'LIN-500', issueTitle: 'A task',
    issueUrl: 'https://linear.app/x/issue/LIN-500', workspace: { urlKey: ACME },
    dispatchedAt, dispatchedBy: 'user-1', target: 'cli', repo: null,
    status: 'taken', resolvedAt,
    feedback: [{ message: '[done] Task completed in 8s', timestamp: resolvedAt }],
  }];
  return {
    calls,
    async listItems() { return []; },
    async listHistory() { return { items: history, total: history.length }; },
    async addItem(urlKey, item) {
      calls.push({ urlKey, item });
      return { _id: 'queued-1', urlKey, ...item };
    },
    historyTtl: 30 * 24 * 60 * 60,
  };
}

function makeAgentStatusStore() {
  return { async listStatus() { return { items: [], total: 0 }; } };
}

function makeWorkspacePreferencesStore() {
  return { async getWorkspacePreferences() { return {}; } };
}

// The LLM transport seam: `streamChat` (message-bearing/degraded path) and
// `streamChatWithTools` (tool-capable path — DEFAULT_MODEL always is).
// `toolCall`, when given, drives the tool hop through the REAL executor the
// route wired in (`options.executeTool`), so a `send_follow_up` call here
// exercises the actual chat-tools.js decision, not a fake standing in for it.
function makeChatClient({ toolCall } = {}) {
  async function run(onEvent, executeTool) {
    if (toolCall) {
      const { id, name, arguments: args } = toolCall;
      onEvent('tool', { phase: 'call', id, name, arguments: args });
      try {
        const result = await executeTool({ id, name, arguments: args });
        onEvent('tool', { phase: 'result', id, name, result });
      } catch (err) {
        onEvent('tool', { phase: 'error', id, name, error: err.message });
      }
    }
    onEvent('token', { token: 'hi' });
    onEvent('done', { finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 2 } });
  }
  return {
    async streamChat(_m, _o, onEvent) { return run(onEvent, null); },
    async streamChatWithTools(_m, options, onEvent) { return run(onEvent, options.executeTool); },
  };
}

function neverCalledChatClient() {
  const boom = async () => { throw new Error('chatClient must not be called'); };
  return { streamChat: boom, streamChatWithTools: boom };
}

function baseOverrides(extra = {}) {
  return {
    getWorkspaceOpenRouterKey: async () => OPENROUTER_KEY,
    workspacePreferencesStore: makeWorkspacePreferencesStore(),
    agentStatusStore: makeAgentStatusStore(),
    proxyTokenStore: BASE_DEPS().proxyTokenStore,
    ...extra,
  };
}

async function postTurn(overrides, body) {
  return call(buildApp(baseOverrides(overrides)), 'POST', '/api/proxy/flight-companion/turn', {
    body, headers: { Authorization: `Bearer ${BEARER}` },
  });
}

describe('LIN-2620: POST /api/proxy/flight-companion/turn — SSE frames match the shared fixture byte-for-byte', () => {
  test('stream:true yields frames identical to renderSSEFrames, which is itself pinned against the real sendSSE', () => {
    // The pin LIN-2453 needs: renderSSEFrames' OWN output must be exactly
    // what sendSSE writes, for arbitrary frames — not just "looks similar".
    const calls = [];
    const fakeRes = { write: (chunk) => calls.push(chunk) };
    const frames = [['token', { token: 'hi' }], ['tool', { phase: 'call', id: '1', name: 'x' }], ['done', { finishReason: 'stop' }]];
    for (const [type, data] of frames) sendSSE(fakeRes, type, data);
    assert.strictEqual(calls.join(''), renderSSEFrames(frames));
  });

  test('a message-bearing (user-initiated) turn streams the real endpoint\'s SSE body verbatim', async () => {
    const dispatchQueueStore = makeDispatchQueueStore();
    const { status, body, contentType } = await postTurn(
      { dispatchQueueStore, flightCompanionChatClient: makeChatClient() },
      { message: 'hello there', stream: true }
    );
    assert.equal(status, 200);
    assert.match(contentType, /text\/event-stream/);
    assert.equal(body, renderSSEFrames([
      ['token', { token: 'hi' }],
      ['done', { finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 2 }, model: 'openai/gpt-5.4-mini' }],
    ]));
    assert.equal(dispatchQueueStore.calls.length, 0);
  });
});

describe('LIN-2620: a proxy turn never reaches createDispatchItem', () => {
  test('a real send_follow_up tool call, through the REAL createChatToolCatalog, proposes rather than executes', async () => {
    const dispatchQueueStore = makeDispatchQueueStore();
    const toolCall = { id: 'c1', name: 'send_follow_up', arguments: { sessionId: 'hist-1', prompt: 'ship it' } };
    const { status, body } = await postTurn(
      { dispatchQueueStore, flightCompanionChatClient: makeChatClient({ toolCall }) },
      { message: 'please follow up' }
    );
    assert.equal(status, 200);
    assert.equal(dispatchQueueStore.calls.length, 0, 'createDispatchItem (behind addItem) must never run for a proxy turn');
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].phase, 'proposed');
    assert.deepEqual(body.proposals, [{ proposed: true, sessionId: 'hist-1', prompt: 'ship it' }]);
  });
});

describe('LIN-2625: a proxy turn cannot persist a playbook', () => {
  test('a real remember tool call, through the REAL createChatToolCatalog, is refused as not-configured — proves the ROUTE itself passes allowPlaybookWrite: false, not just a unit test calling the turn core directly', async () => {
    const store = fakeObserverStateStore({ census: censusDoc() });
    const toolCall = { id: 'c1', name: 'remember', arguments: { playbook: 'sneaky write from a proxy caller' } };
    const { status, body } = await postTurn(
      { observerStateStore: store, flightCompanionChatClient: makeChatClient({ toolCall }) },
      { message: 'hello' }
    );
    assert.equal(status, 200);
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].phase, 'error');
    assert.match(body.tools[0].error, /not configured/);
    assert.ok(!store.docs.has(`companion:v1:${ACME}`), 'a proxy turn must never write the browser\'s shared playbook record');
  });
});

describe('LIN-2620: reservation isolation — a message-less proxy turn touches ONLY its own instance', () => {
  test('the browser\'s companion:v1:<urlKey> record is untouched by a proxy auto-wake, and still sees the same spendable delta', async () => {
    const store = fakeObserverStateStore({ census: censusDoc() });
    const dispatchQueueStore = makeDispatchQueueStore();

    const { status, body } = await postTurn(
      { observerStateStore: store, dispatchQueueStore, flightCompanionChatClient: makeChatClient() },
      {} // no message -> auto-wake
    );
    assert.equal(status, 200);
    assert.equal(body.spent, true);

    // The proxy's own instance advanced twice (reserve, then commit); the
    // browser's never did.
    assert.ok(store.docs.has(`companion:v1:${ACME}:proxy`));
    assert.ok(!store.docs.has(`companion:v1:${ACME}`), 'a proxy auto-wake must never create/advance the browser\'s own instance');

    // A subsequent BROWSER auto-wake (no instanceKeySuffix), against the
    // SAME store, must still see the delta as spendable — the proxy call
    // did not consume it.
    const browserSeen = [];
    const outcome = await runFlightCompanionTurn({
      workspace: { urlKey: ACME }, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: (t, d) => browserSeen.push([t, d]),
      deps: {
        observerStateStore: store, workspacePreferencesStore: makeWorkspacePreferencesStore(),
        chatClient: makeChatClient(), createToolCatalog: () => ({ tools: [], executeTool: async () => ({}) }),
        getProvider: () => ({}), getScope: () => ({}), buildCensusSeedText: () => 'SEED',
        sessionIsTerminal: () => false,
      },
    });
    assert.equal(outcome.spent, true, 'the browser\'s own instance must still see the census delta as unconsumed');
  });

  test('a lost reservation CAS race returns {spent:false, reason:"lost-race"} with no model call', async () => {
    const store = fakeObserverStateStore({
      census: censusDoc(),
      forcedAdvanceResults: { [`companion:v1:${ACME}:proxy`]: [false] },
    });
    const { status, body } = await postTurn(
      { observerStateStore: store, dispatchQueueStore: makeDispatchQueueStore(), flightCompanionChatClient: neverCalledChatClient() },
      {}
    );
    assert.equal(status, 200);
    assert.equal(body.spent, false);
    assert.equal(body.reason, 'lost-race');
    assert.deepEqual(body.tools, []);
    assert.equal(body.text, '');
  });
});

describe('LIN-2620: no response ever carries a token', () => {
  test('the bearer token and the resolved OpenRouter key never appear in a JSON response', async () => {
    const dispatchQueueStore = makeDispatchQueueStore();
    const toolCall = { id: 'c1', name: 'send_follow_up', arguments: { sessionId: 'hist-1', prompt: 'ship it' } };
    const { body } = await postTurn(
      { dispatchQueueStore, flightCompanionChatClient: makeChatClient({ toolCall }) },
      { message: 'hi' }
    );
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(BEARER), 'response body must never echo the caller\'s bearer token');
    assert.ok(!serialized.includes(OPENROUTER_KEY), 'response body must never echo the resolved OpenRouter key');
  });

  test('the bearer token and the resolved OpenRouter key never appear in an SSE stream', async () => {
    const { body: text } = await postTurn(
      { dispatchQueueStore: makeDispatchQueueStore(), flightCompanionChatClient: makeChatClient() },
      { message: 'hi', stream: true }
    );
    assert.ok(!text.includes(BEARER));
    assert.ok(!text.includes(OPENROUTER_KEY));
  });
});
