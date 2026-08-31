/**
 * Route-level tests for the Flight Companion approve-follow-up endpoint
 * (LIN-2434 §A.6, `POST /workspace/:urlKey/api/flight-companion/approve-follow-up`).
 *
 * Driven through a real Express app (LIN-2023 bind convention: listen(0,
 * '127.0.0.1'), addressed the same way as
 * tests/unit/flight-companion-turn-route.test.js).
 *
 * Every acceptance criterion the ticket calls out as "asserted by a test, not
 * by inspection" is covered here by REAL execution against a mounted router,
 * not source-text pins:
 *   - R1: the exported `dispatchQueueLimiter` is applied to THIS route (a
 *     behavioral 30-allowed/31st-429 assertion, not a source grep).
 *   - The route's own `!session` guard produces a clean 404, ahead of
 *     `deriveFollowUpDispatch`'s unguarded dereference (LIN-2433 ledger #3).
 *   - `deriveFollowUpDispatch`'s dash/local throw is caught and mapped to a
 *     real client-error status, never a 500 (LIN-2433 ledger #4).
 *   - Body narrowing: a client-supplied target/force/followUpTo never reaches
 *     the enqueued item — the derived values do.
 *   - The enqueue carries factory-only fields (kind/model/harness/
 *     presetConfig/presetName/bootstrapToken), proving it went through
 *     `createDispatchItem`, not a hand-rolled `dispatchQueueStore.addItem`.
 *   - The auth gate (401, nothing enqueued) and feature gate (403, nothing
 *     enqueued).
 *   - No LLM call on the approval path — proven POSITIVELY via a poisoned
 *     `chatClient`/`createToolCatalog` that fails the test if either is ever
 *     invoked while hitting only this route.
 *   - `finalizePrompt`'s two branches (LIN-1431 S3 #2): a bootstrap token is
 *     minted for an MCP-token (claude-code) harness and stays null for a
 *     prose harness.
 */
process.env.NODE_ENV = 'test';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';

const PATH = '/workspace/acme/api/flight-companion/approve-follow-up';
const URL_KEY = 'acme';

// ─── Session fixtures ────────────────────────────────────────────────────
//
// Mirrors the sessionHistoryItem/makeMockSessionStores shape
// tests/unit/chat-tools.test.js already uses (dispatchStore.listItems/
// listHistory + agentStatusStore.listStatus), so the route exercises the
// SAME real getSessionsForWorkspace reconstruction production traffic does —
// never a stubbed shortcut.

const T_DISPATCHED = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const T_DONE = new Date(Date.now() - 30 * 60 * 1000).toISOString();

function sessionHistoryItem(overrides = {}) {
  return {
    id: 'hist-1',
    promptName: 'implementation',
    prompt: 'prompt body',
    issueId: 'uuid-500',
    issueIdentifier: 'LIN-500',
    issueTitle: 'A task',
    issueUrl: 'https://linear.app/x/issue/LIN-500',
    workspace: { urlKey: URL_KEY },
    dispatchedAt: T_DISPATCHED,
    dispatchedBy: 'user-1',
    target: 'cli',
    repo: null,
    status: 'taken',
    resolvedAt: T_DONE,
    feedback: [],
    ...overrides,
  };
}

// A single-loop, TERMINAL, cli-target autopilot session ('sess-done') — the
// bread-and-butter fixture most tests below build on. followUpTo derives to
// 'sess-done' itself (its own single-loop lineage tail), force:true (done),
// target:'cli'.
function terminalCliHistory() {
  return [
    sessionHistoryItem({
      id: 'sess-done', kind: 'autopilot', target: 'cli',
      feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
    }),
  ];
}

function dashAnchorHistory() {
  return [
    sessionHistoryItem({
      id: 'sess-dash', kind: 'autopilot', target: 'dash',
      feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
    }),
  ];
}

function localAnchorHistory() {
  return [
    sessionHistoryItem({
      id: 'sess-local', kind: 'autopilot', target: 'local',
      feedback: [{ message: '[done] Task completed in 8s', timestamp: T_DONE }],
    }),
  ];
}

/**
 * @param {Object} [opts]
 * @param {Array<Object>} [opts.history] - dispatch history rows getSessionsForWorkspace reconstructs from.
 * @param {Object|null} [opts.anchorStatus] - getItemStatus(urlKey, followUpTo) result, controlling
 *   createDispatchItem's harness inheritance (LIN-1431 S3) — the finalizePrompt branch tests use this
 *   to force a resolved 'claude-code' harness without the route accepting a harness param at all.
 * @param {string} [opts.mintedToken] - token string returned by the fake proxyTokenStore's createToken.
 * @returns {{dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls, mintCalls}}
 */
function makeStores({ history = [], anchorStatus = null, mintedToken = 'boot-abc123' } = {}) {
  const addItemCalls = [];
  const mintCalls = [];
  const dispatchQueueStore = {
    async listItems() { return []; },
    async listHistory() { return { items: history, total: history.length }; },
    async getItemStatus() { return anchorStatus; },
    async addItem(urlKey, item) {
      addItemCalls.push({ urlKey, item });
      return { _id: 'disp-new-1', dispatchedAt: new Date().toISOString(), ...item };
    },
  };
  const agentStatusStore = { async listStatus() { return { items: [], total: 0 }; } };
  const proxyTokenStore = {
    async createToken(urlKey, opts) {
      mintCalls.push({ urlKey, opts });
      return { token: mintedToken };
    },
  };
  return { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls, mintCalls };
}

function poisonedChatClient() {
  return {
    streamChat() { throw new Error('streamChat must NEVER be called on the approve-follow-up path'); },
    streamChatWithTools() { throw new Error('streamChatWithTools must NEVER be called on the approve-follow-up path'); },
  };
}

function poisonedCreateToolCatalog() {
  return () => { throw new Error('createToolCatalog must NEVER be called on the approve-follow-up path'); };
}

function buildApp({
  dispatchQueueStore, agentStatusStore, proxyTokenStore,
  session = { accountId: 'u1', features: { flightCompanion: true } },
  chatClient, createToolCatalog,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use(createFlightCompanionRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: URL_KEY }; req.session = session; next(); },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    observerStateStore: null,
    freeTierStore: null,
    workspacePreferencesStore: null,
    recapCacheStore: null,
    briefCacheStore: null,
    dispatchQueueStore,
    agentStatusStore,
    proxyTokenStore,
    ...(chatClient !== undefined ? { chatClient } : {}),
    ...(createToolCatalog !== undefined ? { createToolCatalog } : {}),
  }));
  return app;
}

async function post(app, path, body) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ─── R1 — the ratified operator hazard ─────────────────────────────────────

describe('R1 — dispatchQueueLimiter is applied to this route (behavioral, not source-grep)', () => {
  const realNodeEnv = process.env.NODE_ENV;
  after(() => {
    if (realNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = realNodeEnv;
  });

  test('enforces exactly 30/min — the 31st request in the window is 429, and nothing beyond 30 is enqueued', async () => {
    process.env.NODE_ENV = 'development'; // dispatchQueueLimiter's own skip is NODE_ENV==='test' only
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: terminalCliHistory() });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const statuses = [];
    for (let i = 0; i < 31; i++) {
      const res = await post(app, PATH, { sessionId: 'sess-done', prompt: `p${i}` });
      statuses.push(res.status);
    }
    process.env.NODE_ENV = 'test';

    assert.strictEqual(statuses.filter(s => s !== 429).length, 30,
      'exactly 30 requests per minute must be allowed');
    assert.strictEqual(statuses[30], 429, 'the 31st request must be rate-limited');
    assert.strictEqual(addItemCalls.length, 30,
      'the 31st (rate-limited) request must never reach the enqueue at all');
  });
});

// ─── Missing-session guard (LIN-2433 ledger #3) ────────────────────────────

describe('missing-session guard', () => {
  test('an unknown sessionId is a clean 404, never a 500 from the helper\'s unguarded dereference', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } = makeStores({ history: [] });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const res = await post(app, PATH, { sessionId: 'does-not-exist', prompt: 'p' });

    assert.strictEqual(res.status, 404);
    assert.match(res.json.error, /does-not-exist/);
    assert.strictEqual(addItemCalls.length, 0, 'a 404 must never enqueue anything');
  });
});

// ─── dash/local throw mapping (LIN-2433 ledger #4) ─────────────────────────

describe('dash/local anchor mapping', () => {
  test('a dash-anchored session maps deriveFollowUpDispatch\'s throw to a real client error, never a 500', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: dashAnchorHistory() });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const res = await post(app, PATH, { sessionId: 'sess-dash', prompt: 'p' });

    assert.strictEqual(res.status, 422);
    assert.match(res.json.error, /dash\/local targets are not supported/);
    assert.strictEqual(addItemCalls.length, 0);
  });

  test('a local-anchored session maps the same throw the same way', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: localAnchorHistory() });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const res = await post(app, PATH, { sessionId: 'sess-local', prompt: 'p' });

    assert.strictEqual(res.status, 422);
    assert.match(res.json.error, /dash\/local targets are not supported/);
    assert.strictEqual(addItemCalls.length, 0);
  });
});

// ─── Body narrowing — the guardrail's teeth ────────────────────────────────

describe('body narrowing — only sessionId/prompt are read from the client', () => {
  test('client-supplied target/force/followUpTo are ignored outright — the enqueued item carries the DERIVED values', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: terminalCliHistory() });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const res = await post(app, PATH, {
      sessionId: 'sess-done', prompt: 'do the next thing',
      // A hostile/buggy client asserting fields this route must never read for these purposes.
      target: 'web', force: false, followUpTo: 'evil-injected-id',
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(addItemCalls.length, 1);
    const { item } = addItemCalls[0];
    // Derived from the fixture (terminal, cli-target, single-loop): followUpTo
    // is the session's own loopId, target 'cli', force true — NONE of which
    // match the client's bogus values above.
    assert.strictEqual(item.followUpTo, 'sess-done');
    assert.strictEqual(item.target, 'cli');
    assert.strictEqual(item.force, true);
    assert.notStrictEqual(item.followUpTo, 'evil-injected-id');
    assert.notStrictEqual(item.target, 'web');
    assert.notStrictEqual(item.force, false);
  });
});

// ─── Enqueue via the factory, never the store directly ────────────────────

describe('enqueue goes through createDispatchItem, never dispatchQueueStore.addItem directly', () => {
  test('the enqueued item carries factory-only fields (kind/model/harness/presetConfig/presetName/bootstrapToken) — a hand-rolled addItem call would carry none of these', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: terminalCliHistory() });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const res = await post(app, PATH, { sessionId: 'sess-done', prompt: 'p' });

    assert.strictEqual(res.status, 200);
    const { item } = addItemCalls[0];
    assert.strictEqual(item.kind, 'custom', 'createDispatchItem derives kind from promptName (absent here -> the store default)');
    assert.strictEqual(item.model, null);
    assert.ok('harness' in item, 'harness is a factory-owned field, present even when null');
    assert.strictEqual(item.presetConfig, null);
    assert.strictEqual(item.presetName, null);
    assert.ok('bootstrapToken' in item, 'bootstrapToken is a factory-owned field, present even when null');
    assert.strictEqual(item.prompt, 'p');
    assert.strictEqual(item.dispatchedBy, 'u1');
  });
});

// ─── Auth gate ──────────────────────────────────────────────────────────────

describe('auth gate — attended, session-authed requests only', () => {
  test('no req.session.accountId -> 401, nothing enqueued', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: terminalCliHistory() });
    const app = buildApp({
      dispatchQueueStore, agentStatusStore, proxyTokenStore,
      session: { features: { flightCompanion: true } }, // no accountId
    });

    const res = await post(app, PATH, { sessionId: 'sess-done', prompt: 'p' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(addItemCalls.length, 0);
  });
});

// ─── Feature gate ───────────────────────────────────────────────────────────

describe('feature gate', () => {
  test('flightCompanion flag off -> 403, nothing enqueued', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: terminalCliHistory() });
    const app = buildApp({
      dispatchQueueStore, agentStatusStore, proxyTokenStore,
      session: { accountId: 'u1', features: { flightCompanion: false } },
    });

    const res = await post(app, PATH, { sessionId: 'sess-done', prompt: 'p' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(addItemCalls.length, 0);
  });
});

// ─── No LLM call on the approval path ──────────────────────────────────────

describe('no LLM call is made or re-entered on the approval path', () => {
  test('a poisoned chatClient/createToolCatalog (both throw if ever invoked) is never touched by a successful approval', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls } =
      makeStores({ history: terminalCliHistory() });
    const app = buildApp({
      dispatchQueueStore, agentStatusStore, proxyTokenStore,
      chatClient: poisonedChatClient(),
      createToolCatalog: poisonedCreateToolCatalog(),
    });

    const res = await post(app, PATH, { sessionId: 'sess-done', prompt: 'p' });

    assert.strictEqual(res.status, 200, 'a real model-call throw would have surfaced as a 500 here — it did not');
    assert.strictEqual(addItemCalls.length, 1);
  });
});

// ─── finalizePrompt (LIN-1431 S3 #2) ───────────────────────────────────────

describe('finalizePrompt mirrors send_follow_up\'s own bootstrap-provisioning branch', () => {
  test('an MCP-token (claude-code) resolved harness mints a bootstrap token onto the item', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls, mintCalls } = makeStores({
      history: terminalCliHistory(),
      anchorStatus: { harness: 'claude-code' }, // inherited by createDispatchItem's step 4.5
      mintedToken: 'minted-token-xyz',
    });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const res = await post(app, PATH, { sessionId: 'sess-done', prompt: 'p' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(mintCalls.length, 1, 'shouldUseMcpTokenField(claude-code) must trigger exactly one mint');
    assert.strictEqual(mintCalls[0].opts.createdBy, 'u1');
    assert.strictEqual(addItemCalls[0].item.bootstrapToken, 'minted-token-xyz');
    assert.strictEqual(addItemCalls[0].item.harness, 'claude-code');
  });

  test('a prose (non-claude-code / absent) resolved harness never mints — bootstrapToken stays null', async () => {
    const { dispatchQueueStore, agentStatusStore, proxyTokenStore, addItemCalls, mintCalls } = makeStores({
      history: terminalCliHistory(),
      anchorStatus: null, // no inherited harness -> resolvedHarness stays null
    });
    const app = buildApp({ dispatchQueueStore, agentStatusStore, proxyTokenStore });

    const res = await post(app, PATH, { sessionId: 'sess-done', prompt: 'p' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(mintCalls.length, 0, 'a prose/blank harness must never attempt a mint');
    assert.strictEqual(addItemCalls[0].item.bootstrapToken, null);
    assert.strictEqual(addItemCalls[0].item.harness, null);
  });
});
