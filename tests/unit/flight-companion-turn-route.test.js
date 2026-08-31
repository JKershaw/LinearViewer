/**
 * Route-level tests for the Flight Companion SSE turn endpoint
 * (LIN-2432 §A.3, `POST /workspace/:urlKey/api/flight-companion/turn`).
 *
 * Driven through a real Express app (LIN-2023 bind convention: listen(0,
 * '127.0.0.1'), addressed the same way as
 * tests/unit/flight-companion-observer-report-route.test.js).
 *
 * What's covered by REAL execution here — every path below returns before
 * ever reaching a live model call, so no network is touched:
 *   - The turn shape (§A.0) is derived from message presence alone; a client
 *     asserting any other field for this purpose is simply never read.
 *   - An auto-wake turn clears §A.2's `shouldSpendTurn` gate BEFORE the
 *     free-tier `tryUse` check — asserted on call ORDER via one shared spy
 *     array across both fake stores, not merely that both happened.
 *   - `shouldSpendTurn === false` (no-census) short-circuits with no quota
 *     touched and no `advance` write.
 *   - Free-tier `tryUse` rejection is asymmetric: 429 (with the `freeTier`
 *     body) for user-initiated, a silent 200 for auto-wake.
 *   - An unconfigured AI key still 503s cleanly for both turn shapes,
 *     without ever reaching the auto-wake gate machinery on the
 *     user-initiated path.
 *   - §A.4's `phase: 'proposed'` SSE relabel, asserted on the parsed wire
 *     frames: a propose-mode result arrives as 'proposed', an executed one
 *     stays 'result' (LIN-2432 close-out, review ledger item 1).
 *
 * LIN-2432 beat 4, Job 1: beat 2 originally pinned two acceptance-criteria
 * properties as source-text assertions, because the route calls
 * `streamChat`/`streamChatWithTools` directly (live OpenRouter calls) and
 * Node's `mock.module` needs `--experimental-test-module-mocks`, which
 * nothing in this repo opts into (confirmed absent even on Node 25) — the
 * same constraint tests/unit/task-chat-route.test.js documents and works
 * around the same way. Beat 4 closes that gap differently: rather than force
 * module mocking on, it adds ONE narrow, low-risk DI seam to
 * routes/flight-companion.js — `chatClient` ({streamChat, streamChatWithTools})
 * and `createToolCatalog` — both defaulting to the real imports, so every
 * OTHER test in this file (which never passes either) is proof production
 * behavior is unchanged. `isToolCapableModel` needed no seam at all: it's a
 * pure, synchronous allowlist check with no network, so tests call the real
 * one directly via a real (uncurated) model id. See the 'live-model-call
 * seam' describe block below for both now-real executable tests: the
 * `isToolCapableModel` → plain `streamChat` degrade, and the `followUpMode`
 * wiring per turn shape (captured via a fake `createToolCatalog`, not
 * grepped from source). The remaining structural assertions (the
 * createDispatchItem-import guard, the no-dashboard-poll guard, and the
 * "no second turnKind branch" shape of the SSE rewrite) stay source-text —
 * they were never blocked on live invocation, just cheaper to pin that way,
 * matching task-chat-route.test.js's own mix. The `'proposed'` SSE phase
 * rewrite was in that list until close-out: the review showed a source-text
 * regex cannot see the mechanism break (two semantic mutations left it green),
 * and that the beat-4 seams above make it directly executable, so it now has
 * its own describe block below. The deeper guarantee the followUpMode
 * test leans on — that `followUpMode: 'propose'` really can never reach
 * `createDispatchItem` — is proven separately, by REAL executable tests in
 * tests/unit/chat-tools.test.js's "LIN-2432 §A.4: send_follow_up
 * followUpMode" block (asserts on a dispatchQueueStore spy).
 *
 * LIN-2432 beat 3 added: §A.12 server.js wiring (structural, against
 * SERVER_SRC — the same idiom task-chat-route.test.js's own privacy-boundary
 * test uses for exactly this "does the real call site pass the right deps"
 * question) and §A.7's census-seed verbatim guarantee, tested by directly
 * importing the one pure helper the route exports for this reason,
 * `buildCensusSeedText` (see its own doc comment in routes/flight-companion.js
 * for why it — and only it — is exported).
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createFlightCompanionRoutes, buildCensusSeedText } from '../../routes/flight-companion.js';
import { COMPANION_SEED_STATE, buildCompanionSnapshot } from '../../lib/flight-companion-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(join(__dirname, '../../routes/flight-companion.js'), 'utf8');
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

// Set/restore env vars around one async body — mirrors
// tests/unit/free-tier-model.test.js's withVar idiom, generalized to several
// keys at once so `apiKeyToUse` resolution is deterministic regardless of
// ambient .env content (dotenv is only ever loaded by server.js, which this
// file never imports, but a delete/restore keeps the test honest either way).
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/**
 * A fake ObserverStateStore covering BOTH instance families the turn route
 * touches: the companion's own `companion:v1:<urlKey>` (ensureSeeded/advance)
 * and the read-only `sweep:v1:<urlKey>` census (readCurrent). `calls` is a
 * shared array the caller can pass in so gate-store calls and freeTierStore
 * calls interleave in one true call-order timeline.
 */
function fakeObserverStateStore({ companionRev = 1, companionState = COMPANION_SEED_STATE, censusDoc = null, calls = [] } = {}) {
  return {
    calls,
    async ensureSeeded(instanceKey) {
      calls.push({ store: 'observerState', method: 'ensureSeeded', instanceKey });
      return { _id: instanceKey, rev: companionRev, state: companionState };
    },
    async readCurrent(instanceKey) {
      calls.push({ store: 'observerState', method: 'readCurrent', instanceKey });
      return instanceKey.startsWith('sweep:v1:') ? censusDoc : null;
    },
    async advance(instanceKey, expectedRev, nextState, meta) {
      calls.push({ store: 'observerState', method: 'advance', instanceKey, expectedRev });
      return true;
    },
  };
}

function fakeFreeTierStore(result, calls = []) {
  return {
    calls,
    async tryUse(urlKey) {
      calls.push({ store: 'freeTier', method: 'tryUse', urlKey });
      return result;
    },
  };
}

function buildApp({
  observerStateStore, freeTierStore, flightCompanionEnabled = true, session = {},
  chatClient, createToolCatalog, workspacePreferencesStore,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { features: { flightCompanion: flightCompanionEnabled }, workspaces: [{ urlKey: 'acme' }], ...session };
    next();
  });
  app.use(createFlightCompanionRoutes({
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: 'acme' }; next(); },
    getOpenRouterSource: () => null,
    getDeployInfo: () => ({}),
    observerStateStore,
    freeTierStore,
    workspacePreferencesStore,
    // LIN-2432 beat 4: the DI seam — omitted here (undefined) means every
    // OTHER test in this file exercises createFlightCompanionRoutes' REAL
    // default (the live lib/openrouter.js / lib/chat-tools.js functions),
    // proving the seam is inert until a test opts in. Only the
    // 'live-model-call seam' describe block below passes fakes.
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
    try { json = JSON.parse(text); } catch { /* not JSON (SSE) */ }
    return { status: res.status, json, text, headers: res.headers };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// A census doc whose stateHash differs from COMPANION_SEED_STATE's null
// lastCensusStateHash, with empty attention — this is exactly the seed-turn
// shape `shouldSpendTurn` always spends on (no prior snapshot to no-delta
// against), regardless of `surface`. See lib/flight-companion-gate.js's own
// six-branch precedence.
function realCensusDoc() {
  return {
    rev: 5,
    stateHash: 'hash-abc',
    updatedAt: new Date('2026-08-31T12:00:00.000Z'),
    state: {
      lanes: { working: 1, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
      attention: [],
    },
  };
}

describe('Flight Companion turn endpoint (LIN-2432 §A.3) — feature gate', () => {
  test('403s when the flightCompanion flag is off', async () => {
    const app = buildApp({
      observerStateStore: fakeObserverStateStore(),
      freeTierStore: fakeFreeTierStore({ allowed: true }),
      flightCompanionEnabled: false,
    });
    const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', { message: 'hi' });
    assert.strictEqual(status, 403);
    assert.match(json.error, /not enabled/);
  });
});

describe('Flight Companion turn endpoint (LIN-2432 §A.0) — turn shape is server-derived, never client-asserted', () => {
  test('a body claiming user-initiated WITHOUT real user text is treated as auto-wake', async () => {
    // no-census -> shouldSpendTurn returns spend:false, short-circuiting
    // cheaply — but reaching that response at all proves the auto-wake gate
    // machinery ran, which only happens on the auto-wake branch.
    const observerStateStore = fakeObserverStateStore({ censusDoc: null });
    const app = buildApp({ observerStateStore, freeTierStore: fakeFreeTierStore({ allowed: true }) });

    const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', {
      message: '   ', triggerType: 'user-initiated', kind: 'user-initiated', userInitiated: true,
    });

    assert.strictEqual(status, 200);
    assert.strictEqual(json.turnKind, 'auto-wake', 'whitespace-only text must not count as a real message');
    assert.strictEqual(json.spent, false);
    assert.strictEqual(json.reason, 'no-census');
    assert.ok(
      observerStateStore.calls.some(c => c.method === 'ensureSeeded'),
      'the auto-wake gate machinery must have actually run'
    );
  });

  test('an absent message is treated as auto-wake', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: null });
    const app = buildApp({ observerStateStore, freeTierStore: fakeFreeTierStore({ allowed: true }) });
    const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(status, 200);
    assert.strictEqual(json.turnKind, 'auto-wake');
  });

  test('real user text is treated as user-initiated and NEVER touches the auto-wake gate store at all', async () => {
    const observerStateStore = fakeObserverStateStore();
    const app = buildApp({ observerStateStore, freeTierStore: fakeFreeTierStore({ allowed: true }) });

    // No AI key configured anywhere in this fixture -> 503 before ANY store
    // is touched. Reaching 503 (rather than the auto-wake short-circuit
    // shape) already proves the user-initiated branch was taken; the empty
    // calls array proves it skipped the gate machinery entirely.
    await withEnv({ OPENROUTER_API_KEY: undefined, OPENROUTER_FREE_TIER_KEY: undefined }, async () => {
      const { status } = await post(app, '/workspace/acme/api/flight-companion/turn', {
        message: 'what is happening with LIN-1?', triggerType: 'auto-wake',
      });
      assert.strictEqual(status, 503);
    });
    assert.deepStrictEqual(observerStateStore.calls, [], 'user-initiated must never call ensureSeeded/readCurrent on the companion gate store');
  });

  test('message length is validated only on the user-initiated branch', async () => {
    const observerStateStore = fakeObserverStateStore();
    const app = buildApp({ observerStateStore, freeTierStore: fakeFreeTierStore({ allowed: true }) });
    const tooLong = 'x'.repeat(2001);
    const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', { message: tooLong });
    assert.strictEqual(status, 400);
    assert.match(json.error, /2000 characters or fewer/);
    assert.deepStrictEqual(observerStateStore.calls, []);
  });
});

describe('Flight Companion turn endpoint (LIN-2432 §A.2) — auto-wake gate ordering + free-tier asymmetry', () => {
  test('shouldSpendTurn === false short-circuits: no quota consumed, no advance write, no model call', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: null }); // no-census
    const freeTierStore = fakeFreeTierStore({ allowed: true });
    const app = buildApp({ observerStateStore, freeTierStore });

    const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', {});

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(json, { turnKind: 'auto-wake', spent: false, reason: 'no-census' });
    assert.strictEqual(freeTierStore.calls.length, 0, 'tryUse must never be called when the gate says no');
    assert.ok(
      !observerStateStore.calls.some(c => c.method === 'advance'),
      'a false gate must never write — the store\'s own write-nothing-on-false invariant'
    );
  });

  test('on a spend:true gate, shouldSpendTurn clears BEFORE tryUse — asserted on call ORDER, not just that both ran — and an auto-wake tryUse rejection is SILENT (no 429, no error)', async () => {
    const calls = [];
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc(), calls });
    const freeTierStore = fakeFreeTierStore(
      { allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' },
      calls
    );
    const app = buildApp({ observerStateStore, freeTierStore });

    await withEnv({ OPENROUTER_API_KEY: undefined, OPENROUTER_FREE_TIER_KEY: 'free-tier-test-key' }, async () => {
      const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', {});
      assert.strictEqual(status, 200, 'a rejected auto-wake turn must be a plain 200, never a 429');
      assert.deepStrictEqual(json, { turnKind: 'auto-wake', spent: false, reason: 'free-tier' });
    });

    // Real call-order proof: the gate's own store calls (ensureSeeded then
    // readCurrent) precede freeTier.tryUse in the SAME shared timeline.
    const methods = calls.map(c => c.method);
    const tryUseIdx = methods.indexOf('tryUse');
    const ensureSeededIdx = methods.indexOf('ensureSeeded');
    const readCurrentIdx = methods.indexOf('readCurrent');
    assert.ok(tryUseIdx > -1, 'tryUse must have been reached (the gate did spend)');
    assert.ok(ensureSeededIdx > -1 && ensureSeededIdx < tryUseIdx, 'ensureSeeded (the gate) must run before tryUse');
    assert.ok(readCurrentIdx > -1 && readCurrentIdx < tryUseIdx, 'readCurrent (the census read the gate needs) must run before tryUse');
    // A rejected tryUse must never reach the point of persisting the gate's
    // own advance — nothing was actually spent.
    assert.ok(!methods.includes('advance'), 'a rejected tryUse must not mark the floor as spent');
  });

  test('the SAME free-tier rejection is a 429 with the freeTier body on a user-initiated turn', async () => {
    const observerStateStore = fakeObserverStateStore();
    const freeTierStore = fakeFreeTierStore({ allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' });
    const app = buildApp({ observerStateStore, freeTierStore });

    await withEnv({ OPENROUTER_API_KEY: undefined, OPENROUTER_FREE_TIER_KEY: 'free-tier-test-key' }, async () => {
      const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', { message: 'status please' });
      assert.strictEqual(status, 429);
      assert.strictEqual(json.error, 'Free tier limit reached');
      assert.deepStrictEqual(json.freeTier, { used: true, remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' });
    });
    assert.deepStrictEqual(observerStateStore.calls, [], 'user-initiated never touches the gate store');
  });

  test('no AI key configured 503s cleanly on an auto-wake turn too, after the gate has already cleared', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = fakeFreeTierStore({ allowed: true });
    const app = buildApp({ observerStateStore, freeTierStore });

    await withEnv({ OPENROUTER_API_KEY: undefined, OPENROUTER_FREE_TIER_KEY: undefined }, async () => {
      const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', {});
      assert.strictEqual(status, 503);
      assert.match(json.error, /AI is not configured/);
    });
    assert.strictEqual(freeTierStore.calls.length, 0, 'no free-tier key configured means isFreeTier is false, so tryUse is never called');
    assert.ok(!observerStateStore.calls.some(c => c.method === 'advance'), 'a config failure must not mark the floor as spent');
  });
});

describe('Flight Companion turn endpoint (LIN-2432 beat 4) — live-model-call seam (chatClient / createToolCatalog)', () => {
  // LIN-2432 beat 4, Job 1: beat 2 pinned these two acceptance-criteria
  // properties as source-text assertions (mock.module needs
  // --experimental-test-module-mocks, which nothing in this repo opts into —
  // see the file header). This block converts BOTH to real executable tests
  // by adding one narrow DI seam to routes/flight-companion.js: `chatClient`
  // ({streamChat, streamChatWithTools}) and `createToolCatalog`, both
  // defaulting to the real lib/openrouter.js / lib/chat-tools.js exports so
  // production behavior is unchanged when omitted (proven by every OTHER
  // describe block in this file, which never passes either). `isToolCapableModel`
  // itself needs no seam — it's a pure, synchronous allowlist check with no
  // network — so these tests call the REAL one via a real (non-network) model id.
  function fakeChatClient(calls) {
    return {
      async streamChat(messages, opts, onEvent) {
        calls.push({ fn: 'streamChat', model: opts.model, hasTools: false });
        onEvent('token', { token: 'ok' });
        onEvent('done', {});
      },
      async streamChatWithTools(messages, opts, onEvent) {
        calls.push({ fn: 'streamChatWithTools', model: opts.model, hasTools: Array.isArray(opts.tools) && opts.tools.length > 0 });
        onEvent('done', {});
      },
    };
  }

  function fakeCreateToolCatalog(calls) {
    return (opts) => {
      calls.push({
        followUpEnabled: opts.followUpEnabled,
        followUpMode: opts.followUpMode,
        sessionIsTerminalType: typeof opts.sessionIsTerminal,
      });
      return { tools: [{ type: 'function', function: { name: 'noop' } }], executeTool: async () => ({}) };
    };
  }

  test('an unknown-capability model degrades HONESTLY to chatClient.streamChat — never chatClient.streamChatWithTools, and never a silent model swap', async () => {
    const calls = [];
    const chatClient = fakeChatClient(calls);
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present, isFreeTier must be false'); } };
    // A real, non-tool-capable model id (verified against the actual curated
    // AVAILABLE_MODELS allowlist by using something NOT in it) — isToolCapableModel
    // itself is the REAL function here, not faked.
    const workspacePreferencesStore = { async getWorkspacePreferences() { return { modelId: 'some-vendor/uncurated-model' }; } };
    const app = buildApp({
      observerStateStore, freeTierStore, workspacePreferencesStore, chatClient,
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    const { status } = await post(app, '/workspace/acme/api/flight-companion/turn', { message: 'what is the state of things?' });

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(calls, [{ fn: 'streamChat', model: 'some-vendor/uncurated-model', hasTools: false }]);
  });

  test('a tool-capable model wires followUpMode: \'execute\' for a user-initiated turn — captured via a fake createToolCatalog, not source text', async () => {
    const catalogCalls = [];
    const chatClient = fakeChatClient([]);
    const createToolCatalog = fakeCreateToolCatalog(catalogCalls);
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } };
    // No workspacePreferencesStore override -> resolveWorkspaceModel falls
    // back to DEFAULT_MODEL, which IS in the curated tool-capable allowlist.
    const app = buildApp({ observerStateStore, freeTierStore, chatClient, createToolCatalog, session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status } = await post(app, '/workspace/acme/api/flight-companion/turn', { message: 'status please' });

    assert.strictEqual(status, 200);
    assert.strictEqual(catalogCalls.length, 1);
    assert.strictEqual(catalogCalls[0].followUpMode, 'execute');
    assert.strictEqual(catalogCalls[0].followUpEnabled, true, 'the model must still be able to reason about/request a follow-up');
    assert.strictEqual(catalogCalls[0].sessionIsTerminalType, 'function');
  });

  test('a tool-capable model wires followUpMode: \'propose\' for an auto-wake turn — the write-incapable posture, proven live', async () => {
    const catalogCalls = [];
    const chatClient = fakeChatClient([]);
    const createToolCatalog = fakeCreateToolCatalog(catalogCalls);
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() }); // spend:true (seed-turn shape)
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } };
    const app = buildApp({ observerStateStore, freeTierStore, chatClient, createToolCatalog, session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status } = await post(app, '/workspace/acme/api/flight-companion/turn', {}); // no message -> auto-wake

    assert.strictEqual(status, 200);
    assert.strictEqual(catalogCalls.length, 1);
    assert.strictEqual(catalogCalls[0].followUpMode, 'propose');
    assert.strictEqual(catalogCalls[0].followUpEnabled, true, 'auto-wake can still REASON ABOUT a follow-up — only execution is withheld');
    assert.strictEqual(catalogCalls[0].sessionIsTerminalType, 'function', 'the beat-1-flagged coupling: propose mode is gated by the SAME "not configured" check execute mode is');
  });
});

describe('Flight Companion turn endpoint (LIN-2432 §A.4) — the `phase: \'proposed\'` SSE relabel, executable', () => {
  // LIN-2432 close-out, review ledger item 1. §A.4 requires the `tool` SSE
  // event to carry `phase: 'proposed'` (never a new event kind) when
  // send_follow_up returns the propose-mode shape. That was pinned only by a
  // source-text regex, and the review demonstrated the pin is not load-bearing:
  // breaking the relabel two ways (neutering the `phase === 'result'` match, or
  // never registering the call id) left the suite fully green while shipping an
  // SSE stream that still says `phase: "result"` on a proposal. The seams these
  // tests need (`chatClient` / `createToolCatalog`) already exist — added by
  // beat 4 for the block above — so the block-header framing that this was
  // "untestable without live network" stopped being true at beat 4 and is
  // simply exercised here instead.

  // Parse the SSE body into ordered {type, data} frames, so assertions are on
  // the actual wire frames rather than a substring of the whole response.
  function parseSSE(text) {
    return text.split('\n\n').filter(Boolean).map((frame) => {
      const type = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      return { type, data: data ? JSON.parse(data) : null };
    });
  }

  // A tool-capable stream that drives ONE tool call through the route's own
  // executeTool wrapper and then emits the generic `phase: 'result'` frame the
  // real lib/openrouter.js emits — i.e. exactly the input the relabel exists to
  // rewrite. It never emits 'proposed' itself: whatever the client sees on that
  // frame was put there by routes/flight-companion.js and nothing else.
  function fakeToolCallingChatClient(callId) {
    return {
      async streamChat() {
        throw new Error('streamChat must not be called — the model here is tool-capable');
      },
      async streamChatWithTools(messages, opts, onEvent) {
        const call = { id: callId, name: 'send_follow_up', arguments: { sessionId: 'sess-1', prompt: 'keep going' } };
        const raw = await opts.executeTool(call);
        onEvent('tool', { id: call.id, name: call.name, phase: 'result', result: raw });
        onEvent('done', {});
      },
    };
  }

  function catalogReturning(result) {
    return () => ({
      tools: [{ type: 'function', function: { name: 'send_follow_up' } }],
      executeTool: async () => result,
    });
  }

  test('an auto-wake proposal result is relabelled to phase: \'proposed\' on the wire — the client can tell a proposal from an executed write', async () => {
    const proposal = { proposed: true, sessionId: 'sess-1', prompt: 'keep going' };
    const app = buildApp({
      observerStateStore: fakeObserverStateStore({ censusDoc: realCensusDoc() }), // spend:true
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } },
      chatClient: fakeToolCallingChatClient('call_abc'),
      createToolCatalog: catalogReturning(proposal),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    const { status, text } = await post(app, '/workspace/acme/api/flight-companion/turn', {}); // no message -> auto-wake -> followUpMode 'propose'

    assert.strictEqual(status, 200);
    const toolFrames = parseSSE(text).filter(f => f.type === 'tool');
    assert.strictEqual(toolFrames.length, 1);
    assert.strictEqual(toolFrames[0].data.phase, 'proposed',
      'the proposal must NOT arrive as the generic phase: "result" — that is the one distinction §A.4 exists to make');
    assert.strictEqual(toolFrames[0].data.id, 'call_abc', 'the relabel must preserve the frame, rewriting only phase');
    assert.deepStrictEqual(toolFrames[0].data.result, proposal, 'the proposal payload itself is passed through untouched');
    // Belt-and-braces on the raw wire bytes: no consumer can see "result" for
    // this call id, and no NEW event kind was invented for the proposal.
    assert.doesNotMatch(text, /"phase":"result"/);
    assert.match(text, /^event: tool$/m);
    assert.doesNotMatch(text, /^event: proposed$/m);
  });

  test('an executed (non-propose) tool result keeps phase: \'result\' — the relabel keys off the executor\'s return shape, so it cannot fire for a real write', async () => {
    const executed = { ok: true, itemId: 'item-9', sessionId: 'sess-1' }; // no `proposed` key
    const app = buildApp({
      observerStateStore: fakeObserverStateStore({ censusDoc: realCensusDoc() }),
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } },
      chatClient: fakeToolCallingChatClient('call_xyz'),
      createToolCatalog: catalogReturning(executed),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    const { status, text } = await post(app, '/workspace/acme/api/flight-companion/turn', { message: 'send the follow-up' }); // user-initiated -> 'execute'

    assert.strictEqual(status, 200);
    const toolFrames = parseSSE(text).filter(f => f.type === 'tool');
    assert.strictEqual(toolFrames.length, 1);
    assert.strictEqual(toolFrames[0].data.phase, 'result',
      'an executed write must stay the generic result phase — a blanket relabel would make the proposed signal meaningless');
    assert.doesNotMatch(text, /"phase":"proposed"/);
  });
});

describe('Flight Companion turn endpoint — source-text wiring (structural pins, see file header)', () => {
  test('the propose-mode SSE phase rewrite keys off the executor\'s OWN return shape ({proposed:true}), not a second turnKind branch', () => {
    assert.match(ROUTE_SRC, /raw\.proposed\s*===\s*true/);
    assert.match(ROUTE_SRC, /phase:\s*'proposed'/);
    // Never a hand-rolled second dispatch of turnKind through the SSE path —
    // the rewrite must be reachable from data alone.
    assert.doesNotMatch(ROUTE_SRC, /turnKind\s*===\s*'auto-wake'[^}]*phase:\s*'proposed'/s);
  });

  test('createDispatchItem is never imported into this route — the ONLY door to it is deep inside lib/chat-tools.js\'s executor, already proven unreachable in propose mode by tests/unit/chat-tools.test.js', () => {
    assert.doesNotMatch(ROUTE_SRC, /^import\s*\{[^}]*createDispatchItem/m);
  });

  test('no companion path ever issues a /api/dashboard/* request — a proxy-token session 401s there, and it would be a fourth read-model representation', () => {
    // Scoped to an actual call/fetch/URL construction, not any mention in
    // prose (this file's own docblocks explain the constraint by NAME).
    assert.doesNotMatch(ROUTE_SRC, /(fetch|axios|http|url|path)\s*\(\s*[`'"][^`'"]*\/api\/dashboard/i);
    assert.doesNotMatch(ROUTE_SRC, /[`'"]\/api\/dashboard\/(sessions|[a-z-]+)[`'"]/);
  });
});

describe('Flight Companion turn endpoint (LIN-2432 §A.12) — server.js store wiring', () => {
  function flightCompanionCallLine() {
    const line = SERVER_SRC.split('\n').find(l => l.includes('createFlightCompanionRoutes({'));
    assert.ok(line, 'expected the createFlightCompanionRoutes(...) call site to exist in server.js');
    return line;
  }

  test('every store the route needs is actually threaded through at the real call site — a route that would throw on a missing store at request time fails HERE, not in production', () => {
    const line = flightCompanionCallLine();
    for (const store of [
      'observerStateStore', 'freeTierStore', 'workspacePreferencesStore',
      'recapCacheStore', 'briefCacheStore', 'dispatchQueueStore', 'agentStatusStore', 'proxyTokenStore',
    ]) {
      assert.match(line, new RegExp(`\\b${store}\\b`), `${store} must be passed to createFlightCompanionRoutes`);
    }
  });

  test('freeTierStore specifically is wired — closes the beat-2-flagged gap where an isFreeTier:true request would throw on tryUse against an undefined store', () => {
    assert.match(flightCompanionCallLine(), /\bfreeTierStore\b/);
  });

  test('workspacePreferencesStore specifically is wired — without it, a later §A.6 enqueue reached through this catalog would silently lose the LIN-1139 model/harness inheritance send_follow_up\'s own executor gets', () => {
    assert.match(flightCompanionCallLine(), /\bworkspacePreferencesStore\b/);
  });

  test('savedChatStore is deliberately NOT wired here — it belongs to §A.11/LIN-2437, a separate ticket, not silently dropped', () => {
    const line = flightCompanionCallLine();
    assert.doesNotMatch(line, /\bsavedChatStore\b/);
    // The deviation is argued, not silent: routes/flight-companion.js's own
    // JSDoc names LIN-2437 and the reasoning explicitly.
    assert.match(ROUTE_SRC, /LIN-2437/);
  });

  test('createFlightCompanionRoutes creates no new store — every param wired is also a param createTaskChatRoutes already receives (mirrors it, adds nothing new)', () => {
    const flightLine = flightCompanionCallLine();
    const taskChatLine = SERVER_SRC.split('\n').find(l => l.includes('createTaskChatRoutes({'));
    assert.ok(taskChatLine, 'expected the createTaskChatRoutes(...) call site to exist');
    for (const store of ['freeTierStore', 'workspacePreferencesStore', 'recapCacheStore', 'briefCacheStore', 'dispatchQueueStore', 'agentStatusStore', 'proxyTokenStore']) {
      if (new RegExp(`\\b${store}\\b`).test(flightLine)) {
        assert.match(taskChatLine, new RegExp(`\\b${store}\\b`), `${store} is a pre-existing store — createTaskChatRoutes must already receive it too`);
      }
    }
  });
});

describe('Flight Companion turn endpoint (LIN-2432 §A.7) — deterministic census seed, copied verbatim', () => {
  test('renders every lane count, attentionCount, and censusRev straight from buildCompanionSnapshot with no transformation', () => {
    const censusDoc = {
      rev: 12,
      stateHash: 'hash-xyz',
      state: {
        lanes: { working: 3, silent: 1, blocked: 2, terminal: 5, queued: 0, resolved: 7, unknown: 0 },
        attention: [
          { loopId: 'l1', lane: 'blocked', stage: 'plan', since: '2026-08-30T05:00:00.000Z' },
          { loopId: 'l2', lane: 'blocked', stage: 'implement', since: '2026-08-30T06:00:00.000Z' },
        ],
        truncated: false,
      },
    };
    const expectedSnapshot = buildCompanionSnapshot(censusDoc);
    const text = buildCensusSeedText(censusDoc);

    for (const [lane, count] of Object.entries(expectedSnapshot.lanes)) {
      assert.match(text, new RegExp(`${lane}: ${count}\\b`), `lane ${lane} must appear with its exact count`);
    }
    assert.match(text, new RegExp(`attention items: ${expectedSnapshot.attentionCount}\\b`));
    assert.match(text, new RegExp(`census revision: ${expectedSnapshot.censusRev}\\b`));
    // Ground-truth framing must be present — the model is told not to
    // recompute/restate these numbers itself.
    assert.match(text, /authoritative/i);
    assert.match(text, /never recompute or restate/i);
  });

  test('a truncated attention list is noted, not silently dropped', () => {
    const censusDoc = {
      rev: 1, stateHash: 'h',
      state: { lanes: { working: 0, silent: 0, blocked: 12, terminal: 0, queued: 0, resolved: 0, unknown: 0 }, attention: [{ loopId: 'l1', lane: 'blocked', stage: 'x' }], truncated: true },
    };
    const text = buildCensusSeedText(censusDoc);
    assert.match(text, /truncated/i);
  });

  test('an absent census (no sweep has ever run) renders an honest empty state, never a fabricated zero-everything snapshot', () => {
    const text = buildCensusSeedText(null);
    assert.match(text, /not available yet/i);
    assert.doesNotMatch(text, /working: 0/);
  });

  test('the route\'s system message actually embeds buildCensusSeedText\'s own output unmodified, not a re-derived summary', () => {
    // Source-text proof that buildFlightCompanionMessages composes the system
    // content FROM buildCensusSeedText(censusDoc) directly — combined with the
    // direct unit tests above (which prove that function's own output is
    // verbatim), this closes the loop without needing a live model call.
    const start = ROUTE_SRC.indexOf('function buildFlightCompanionMessages(');
    assert.ok(start > 0, 'expected buildFlightCompanionMessages to exist');
    const end = ROUTE_SRC.indexOf('\n}', start);
    const fnSrc = ROUTE_SRC.slice(start, end);
    assert.match(fnSrc, /buildCensusSeedText\(\s*censusDoc\s*\)/);
  });

  test('the turn handler passes a real censusDoc through to message-building on BOTH turn shapes (auto-wake\'s already-read doc, and a fresh read for user-initiated)', () => {
    assert.match(ROUTE_SRC, /buildFlightCompanionMessages\(\{[^}]*censusDoc:\s*currentCensusDoc/s);
    // The user-initiated branch must read it fresh (auto-wake already
    // populated currentCensusDoc via the gate, above).
    assert.match(ROUTE_SRC, /turnKind === 'user-initiated' && observerStateStore/);
  });
});
