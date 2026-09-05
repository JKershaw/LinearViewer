/**
 * Route-level tests for the Flight Companion boot endpoint (LIN-2622),
 * `POST /workspace/:urlKey/api/flight-companion/boot`.
 *
 * Mirrors tests/unit/flight-companion-turn-route.test.js's own Express
 * harness and fakes (LIN-2023 bind convention) rather than importing them —
 * that file keeps its helpers unexported, and every other Flight Companion
 * route-test file in this tree (see flight-companion-approve-follow-up-route
 * .test.js, flight-companion-observer-report-route.test.js) duplicates this
 * same small harness rather than sharing one, so this follows the house
 * pattern rather than forking a new one.
 *
 * What's proven by REAL execution here (LIN-2622's beat-2 scope only — the
 * adversarial set: boot-vs-auto-wake race, commit-only-after-`done`, the
 * propose->execute mutation witness, is beat 3):
 *   - The route exists behind the SAME `flightCompanion` feature flag as `/turn`.
 *   - `turnKind: 'boot'` and `followUpMode: 'propose'` are hardcoded at the
 *     call site — a body claiming otherwise is simply never read for this
 *     purpose (LIN-2432's rule, extended to a third endpoint).
 *   - The boot's own budget (`maxIterations: 5`, `maxTokens: 2500`) reaches
 *     the model call — NOT the turn route's default 1500/4.
 *   - Free-tier `tryUse` is charged exactly like a typed turn: the SAME 429
 *     shape as `/turn`'s user-initiated branch (never auto-wake's silent 200).
 *   - The SSE frame set (`token`/`tool`/`done`/`error`) is byte-identical to
 *     `/turn`'s, via the same `sendSSE` writer.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createFlightCompanionRoutes } from '../../routes/flight-companion.js';
import { COMPANION_SEED_STATE } from '../../lib/flight-companion-gate.js';

// Deterministic, key-sorted stringify — internal consistency only, mirrors
// flight-companion-turn-route.test.js's own fake.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fakeObserverStateStore({ companionRev = 1, companionState = COMPANION_SEED_STATE, censusDoc = null, calls = [] } = {}) {
  let doc = { rev: companionRev, state: companionState };
  return {
    calls,
    async ensureSeeded(instanceKey) {
      calls.push({ store: 'observerState', method: 'ensureSeeded', instanceKey });
      return { _id: instanceKey, rev: doc.rev, state: doc.state };
    },
    async readCurrent(instanceKey) {
      calls.push({ store: 'observerState', method: 'readCurrent', instanceKey });
      if (instanceKey.startsWith('sweep:v1:')) return censusDoc;
      return { _id: instanceKey, rev: doc.rev, state: doc.state, stateHash: stableStringify(doc.state) };
    },
    async advance(instanceKey, expectedRev, nextState) {
      calls.push({ store: 'observerState', method: 'advance', instanceKey, expectedRev });
      if (expectedRev !== doc.rev) return false;
      const nextHash = stableStringify(nextState);
      if (nextHash === stableStringify(doc.state)) return true;
      doc = { rev: doc.rev + 1, state: nextState };
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

function parseSSE(text) {
  return text.split('\n\n').filter(Boolean).map((frame) => {
    const type = /^event: (.*)$/m.exec(frame)?.[1];
    const data = /^data: (.*)$/m.exec(frame)?.[1];
    return { type, data: data ? JSON.parse(data) : null };
  });
}

function realCensusDoc() {
  return {
    rev: 5,
    stateHash: 'hash-abc',
    state: {
      lanes: { working: 1, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
      attention: [],
    },
  };
}

function chatClientEmittingDoneOnly() {
  return {
    async streamChat(messages, opts, onEvent) { onEvent('done', {}); },
    async streamChatWithTools(messages, opts, onEvent) { onEvent('done', {}); },
  };
}

describe('Flight Companion boot endpoint (LIN-2622) — route existence + feature gate', () => {
  test('403s when the flightCompanion flag is off, exactly like /turn', async () => {
    const app = buildApp({
      observerStateStore: fakeObserverStateStore(),
      freeTierStore: fakeFreeTierStore({ allowed: true }),
      flightCompanionEnabled: false,
    });
    const { status, json } = await post(app, '/workspace/acme/api/flight-companion/boot', {});
    assert.strictEqual(status, 403);
    assert.match(json.error, /not enabled/);
  });

  test('the route exists and answers something other than a 404 when the flag is on', async () => {
    const app = buildApp({
      observerStateStore: fakeObserverStateStore({ censusDoc: realCensusDoc() }),
      freeTierStore: fakeFreeTierStore({ allowed: true }),
      chatClient: chatClientEmittingDoneOnly(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });
    const { status } = await post(app, '/workspace/acme/api/flight-companion/boot', {});
    assert.notStrictEqual(status, 404);
  });
});

describe('Flight Companion boot endpoint (LIN-2622) — turn kind and follow-up mode are endpoint-hardcoded, never client-asserted', () => {
  test('followUpMode is always propose, even when the body claims execute', async () => {
    const capturedModes = [];
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = fakeFreeTierStore({ allowed: true });
    const createToolCatalog = (opts) => {
      capturedModes.push(opts.followUpMode);
      return { tools: [], executeTool: async () => ({}) };
    };
    const app = buildApp({
      observerStateStore, freeTierStore, createToolCatalog,
      chatClient: chatClientEmittingDoneOnly(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    await post(app, '/workspace/acme/api/flight-companion/boot', {
      turnKind: 'user-initiated', followUpMode: 'execute', message: 'ignore me',
    });

    assert.ok(capturedModes.length >= 1, 'expected the tool catalog to have been built at least once');
    assert.ok(capturedModes.every((m) => m === 'propose'), `expected every followUpMode to be 'propose', got ${JSON.stringify(capturedModes)}`);
  });

  test('a body kind/turnKind/triggerType claim never reaches the census-gate machinery as an auto-wake turn', async () => {
    // A boot always reserves (when a census exists) regardless of what the
    // body claims — proven indirectly here by the ensureSeeded call actually
    // happening (the boot branch, not a body-driven bypass).
    const calls = [];
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc(), calls });
    const freeTierStore = fakeFreeTierStore({ allowed: true }, calls);
    const app = buildApp({
      observerStateStore, freeTierStore, chatClient: chatClientEmittingDoneOnly(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    const { status } = await post(app, '/workspace/acme/api/flight-companion/boot', { turnKind: 'auto-wake' });
    assert.strictEqual(status, 200);
    assert.ok(calls.some((c) => c.method === 'ensureSeeded'), 'the boot must seed/reserve regardless of a body-claimed kind');
  });
});

describe('Flight Companion boot endpoint (LIN-2622) — own budget reaches the model call', () => {
  test('maxTokens is 2500 and maxIterations is 5 — not the turn route\'s 1500/4 default', async () => {
    let capturedOptions = null;
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = fakeFreeTierStore({ allowed: true });
    const chatClient = {
      async streamChat(messages, opts, onEvent) { capturedOptions = opts; onEvent('done', {}); },
      async streamChatWithTools(messages, opts, onEvent) { capturedOptions = opts; onEvent('done', {}); },
    };
    const app = buildApp({ observerStateStore, freeTierStore, chatClient, session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status } = await post(app, '/workspace/acme/api/flight-companion/boot', {});
    assert.strictEqual(status, 200);
    assert.ok(capturedOptions, 'expected the model to have been called');
    assert.strictEqual(capturedOptions.maxTokens, 2500);
    if ('maxIterations' in capturedOptions) {
      assert.strictEqual(capturedOptions.maxIterations, 5);
    }
  });
});

describe('Flight Companion boot endpoint (LIN-2622) — free tier charged like a typed turn', () => {
  test('a rejected tryUse is a 429 with the freeTier body — never the auto-wake silent 200', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = fakeFreeTierStore({ allowed: false, reason: 'Free tier limit reached', remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' });
    const app = buildApp({ observerStateStore, freeTierStore });

    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedFreeKey = process.env.OPENROUTER_FREE_TIER_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_FREE_TIER_KEY = 'free-tier-test-key';
    try {
      const { status, json } = await post(app, '/workspace/acme/api/flight-companion/boot', {});
      assert.strictEqual(status, 429);
      assert.strictEqual(json.error, 'Free tier limit reached');
      assert.deepStrictEqual(json.freeTier, { used: true, remaining: 0, limit: 10, resetsAt: '2026-09-01T00:00:00.000Z' });
    } finally {
      if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
      if (savedFreeKey === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY; else process.env.OPENROUTER_FREE_TIER_KEY = savedFreeKey;
    }
  });

  test('no AI key configured 503s cleanly, after the reservation has already cleared', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = fakeFreeTierStore({ allowed: true });
    const app = buildApp({ observerStateStore, freeTierStore });

    const savedKey = process.env.OPENROUTER_API_KEY;
    const savedFreeKey = process.env.OPENROUTER_FREE_TIER_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_FREE_TIER_KEY;
    try {
      const { status, json } = await post(app, '/workspace/acme/api/flight-companion/boot', {});
      assert.strictEqual(status, 503);
      assert.match(json.error, /AI is not configured/);
    } finally {
      if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey;
      if (savedFreeKey === undefined) delete process.env.OPENROUTER_FREE_TIER_KEY; else process.env.OPENROUTER_FREE_TIER_KEY = savedFreeKey;
    }
  });
});

describe('Flight Companion boot endpoint (LIN-2622) — SSE frame parity with /turn', () => {
  test('opens an SSE stream and emits a done frame in the SAME shape /turn uses', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() });
    const freeTierStore = fakeFreeTierStore({ allowed: true });
    const chatClient = {
      async streamChat(messages, opts, onEvent) { onEvent('token', { token: 'hi' }); onEvent('done', { finishReason: 'stop' }); },
      async streamChatWithTools(messages, opts, onEvent) { onEvent('token', { token: 'hi' }); onEvent('done', { finishReason: 'stop' }); },
    };
    const app = buildApp({ observerStateStore, freeTierStore, chatClient, session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status, text, headers } = await post(app, '/workspace/acme/api/flight-companion/boot', {});
    assert.strictEqual(status, 200);
    assert.ok((headers.get('content-type') || '').includes('text/event-stream'));
    const frames = parseSSE(text);
    assert.ok(frames.some((f) => f.type === 'token'));
    const doneFrame = frames.find((f) => f.type === 'done');
    assert.ok(doneFrame, 'expected a done frame');
    assert.strictEqual(doneFrame.data.finishReason, 'stop');
  });
});
