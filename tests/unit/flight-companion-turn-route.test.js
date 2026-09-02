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

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { MangoClient } from '@jkershaw/mangodb';
import { createFlightCompanionRoutes, buildCensusSeedText } from '../../routes/flight-companion.js';
import { COMPANION_SEED_STATE, buildCompanionSnapshot, RESERVATION_LEASE_MS, DEFAULT_COMPANION_FLOOR_MS, DEFAULT_SWEEP_LIVENESS_HORIZON_MS } from '../../lib/flight-companion-gate.js';
import { ObserverStateStore } from '../../lib/observer-state-store.js';

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

// Deterministic, key-sorted stringify — enough for this fake's own dedup
// fold below to agree with itself; it does not need bit-for-bit parity with
// lib/observer-state-store.js's own hashState, only internal consistency.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * A fake ObserverStateStore covering BOTH instance families the turn route
 * touches: the companion's own `companion:v1:<urlKey>` (ensureSeeded/advance)
 * and the read-only `sweep:v1:<urlKey>` census (readCurrent). `calls` is a
 * shared array the caller can pass in so gate-store calls and freeTierStore
 * calls interleave in one true call-order timeline.
 *
 * LIN-2442 beat 3: this double GENUINELY tracks the companion record's `rev`
 * and `state` now, mirroring lib/observer-state-store.js's own CAS/hash-dedup
 * semantics (a `readCurrent` after an `advance()` reflects the real write; a
 * rev mismatch loses the CAS; an identical-state write is a true no-op that
 * does not bump `rev`) — before this beat, `readCurrent` returned a
 * hardcoded `null` for every companion-family key, so beat 2's post-`done`
 * commit `readCurrent`/`advance()` degraded through the "instance vanished"
 * skip branch on every single test in this file: the 33/33 green reported
 * then proved nothing about the commit path actually running. `advanceResult`
 * still lets the LIN-2435 tri-state fixtures force a lost-race (`false`) or
 * backend-error (`null`) result — but only for the very next `advance()`
 * call, exactly reproducing what a real lost CAS or backend fault looks like
 * (no state change) rather than a blanket override.
 */
function fakeObserverStateStore({ companionRev = 1, companionState = COMPANION_SEED_STATE, censusDoc = null, calls = [], advanceResult } = {}) {
  let doc = { rev: companionRev, state: companionState };
  let forcedNextResult = advanceResult; // consumed at most once

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
      if (forcedNextResult !== undefined) {
        const result = forcedNextResult;
        forcedNextResult = undefined;
        return result;
      }
      if (expectedRev !== doc.rev) return false; // lost race / stale witness
      const nextHash = stableStringify(nextState);
      if (nextHash === stableStringify(doc.state)) return true; // duplicate no-op, rev unchanged
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

describe('Flight Companion turn endpoint (LIN-2438) — sweep-liveness relabel forwarded on the no-spend JSON', () => {
  test('T14: an auto-wake turn on an unchanged census with a stale sweep stamp answers {spent:false, reason:"sweep-not-seen"} with no model call, no SSE headers and no freeTier tryUse', async () => {
    const calls = [];
    const staleSeenAt = new Date(Date.now() - (DEFAULT_SWEEP_LIVENESS_HORIZON_MS + 1000));
    const staleCensus = { ...realCensusDoc(), lastSeenAt: staleSeenAt };
    // Match the companion's baseline to the census hash so the seven-branch
    // chain lands on hash-identical BEFORE the liveness relabel is applied.
    const companionState = { ...COMPANION_SEED_STATE, lastCensusStateHash: staleCensus.stateHash };
    const observerStateStore = fakeObserverStateStore({ companionState, censusDoc: staleCensus, calls });
    const freeTierStore = fakeFreeTierStore({ allowed: true }, calls);
    const app = buildApp({ observerStateStore, freeTierStore });

    const { status, json, headers } = await post(app, '/workspace/acme/api/flight-companion/turn', {});

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(json, {
      turnKind: 'auto-wake',
      spent: false,
      reason: 'sweep-not-seen',
      sweepLastSeenAt: staleSeenAt.toISOString()
    });
    assert.ok(!(headers.get('content-type') || '').includes('text/event-stream'), 'a gate-silent turn must never open an SSE stream');
    assert.ok(!calls.some((c) => c.store === 'freeTier'), 'a gate-silent turn must never touch the free-tier quota');
    assert.ok(!calls.some((c) => c.method === 'advance'), 'a gate-silent turn must never write — the write-nothing-on-false invariant');
  });

  test('T15: every existing (pre-LIN-2438) fixture shape — a censusDoc built with no lastSeenAt field at all — still answers its original reason', async () => {
    // realCensusDoc() carries no lastSeenAt, exactly like every OTHER test in
    // this file. Route-boundary inertness: the new field being absent must
    // not perturb a decision that pre-dates it.
    const census = realCensusDoc();
    const companionState = { ...COMPANION_SEED_STATE, lastCensusStateHash: census.stateHash };
    const observerStateStore = fakeObserverStateStore({ companionState, censusDoc: census });
    const freeTierStore = fakeFreeTierStore({ allowed: true });
    const app = buildApp({ observerStateStore, freeTierStore });

    const { status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', {});

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(json, { turnKind: 'auto-wake', spent: false, reason: 'hash-identical' });
  });
});

describe('Flight Companion turn endpoint (LIN-2435 Commit 1) — advance() tri-state is consumed, never discarded', () => {
  function chatClientThatMustNotBeCalled() {
    return {
      async streamChat() { throw new Error('streamChat must not be called — advance() denied the spend'); },
      async streamChatWithTools() { throw new Error('streamChatWithTools must not be called — advance() denied the spend'); },
    };
  }

  test('advance() === false (lost race) aborts before SSE/model work with reason: "lost-race"', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc(), advanceResult: false });
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } };
    const app = buildApp({
      observerStateStore, freeTierStore, chatClient: chatClientThatMustNotBeCalled(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    const { status, json, headers } = await post(app, '/workspace/acme/api/flight-companion/turn', {});

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(json, { turnKind: 'auto-wake', spent: false, reason: 'lost-race' });
    assert.doesNotMatch(headers.get('content-type') || '', /text\/event-stream/, 'a lost CAS must abort before SSE headers are set');
  });

  test('advance() === null (backend error) aborts with reason: "advance-error" and logs once, parity with sibling observer callers', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc(), advanceResult: null });
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } };
    const app = buildApp({
      observerStateStore, freeTierStore, chatClient: chatClientThatMustNotBeCalled(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    const originalError = console.error;
    const errorCalls = [];
    console.error = (...args) => { errorCalls.push(args); };
    let status, json;
    try {
      ({ status, json } = await post(app, '/workspace/acme/api/flight-companion/turn', {}));
    } finally {
      console.error = originalError;
    }

    assert.strictEqual(status, 200);
    assert.deepStrictEqual(json, { turnKind: 'auto-wake', spent: false, reason: 'advance-error' });
    assert.strictEqual(errorCalls.length, 1, 'a null advance() must log exactly once');
    assert.match(String(errorCalls[0][0]), /advance\(\) backend error/);
  });

  test('advance() === true (the ordinary case) proceeds to the model call unchanged', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() }); // default advanceResult: true
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } };
    const calls = [];
    const chatClient = {
      async streamChat(messages, opts, onEvent) { calls.push('streamChat'); onEvent('done', {}); },
      async streamChatWithTools(messages, opts, onEvent) { calls.push('streamChatWithTools'); onEvent('done', {}); },
    };
    const app = buildApp({ observerStateStore, freeTierStore, chatClient, session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status } = await post(app, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(status, 200);
    assert.strictEqual(calls.length, 1, 'the model call must have been reached when advance() clears');
  });
});

describe('Flight Companion turn endpoint (LIN-2435 Commit 1) — the gate\'s surface is emitted on the auto-wake done frame', () => {
  function parseSSE(text) {
    return text.split('\n\n').filter(Boolean).map((frame) => {
      const type = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      return { type, data: data ? JSON.parse(data) : null };
    });
  }

  function censusDocWithAttention() {
    return {
      rev: 7,
      stateHash: 'hash-attn',
      state: {
        lanes: { working: 1, silent: 0, blocked: 1, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
        attention: [{ loopId: 'l1', lane: 'blocked', stage: 'plan' }],
      },
    };
  }

  function chatClientEmittingDoneOnly() {
    return {
      async streamChat(messages, opts, onEvent) { onEvent('done', {}); },
      async streamChatWithTools(messages, opts, onEvent) { onEvent('done', {}); },
    };
  }

  test('surface:true — the ordinary case, any later spend with something worth telling the user', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: censusDocWithAttention() });
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called'); } };
    const app = buildApp({ observerStateStore, freeTierStore, chatClient: chatClientEmittingDoneOnly(), session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status, text } = await post(app, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(status, 200);
    const doneFrame = parseSSE(text).find(f => f.type === 'done');
    assert.ok(doneFrame, 'expected a done frame on the SSE stream');
    assert.strictEqual(doneFrame.data.surface, true);
  });

  test('surface:false — the narrow seed-turn edge case (priorSnapshot == null, attentionCount === 0), reachable only via a store double', async () => {
    const observerStateStore = fakeObserverStateStore({ censusDoc: realCensusDoc() }); // attention: []
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called'); } };
    const app = buildApp({ observerStateStore, freeTierStore, chatClient: chatClientEmittingDoneOnly(), session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status, text } = await post(app, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(status, 200);
    const doneFrame = parseSSE(text).find(f => f.type === 'done');
    assert.ok(doneFrame);
    assert.strictEqual(doneFrame.data.surface, false);
  });

  test('a user-initiated done frame carries no surface field at all', async () => {
    const observerStateStore = fakeObserverStateStore();
    const freeTierStore = { async tryUse() { throw new Error('tryUse must not be called'); } };
    const app = buildApp({ observerStateStore, freeTierStore, chatClient: chatClientEmittingDoneOnly(), session: { openRouterApiKey: 'sk-test-paid-key' } });

    const { status, text } = await post(app, '/workspace/acme/api/flight-companion/turn', { message: 'status please' });
    assert.strictEqual(status, 200);
    const doneFrame = parseSSE(text).find(f => f.type === 'done');
    assert.ok(doneFrame);
    assert.ok(!('surface' in doneFrame.data), 'user-initiated done frames must not carry a surface field');
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
        // F2 (plan-review 1591ea1a): production stringifies a tool result
        // (lib/openrouter.js's truncateToolResult) before it ever reaches
        // onEvent — a raw object here would be a false witness the client's
        // JSON.parse-based proposal parser never actually has to handle.
        onEvent('tool', { id: call.id, name: call.name, phase: 'result', result: JSON.stringify(raw) });
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
    assert.deepStrictEqual(JSON.parse(toolFrames[0].data.result), proposal, 'the proposal payload itself is passed through untouched (stringified, matching production)');
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

  test('createDispatchItem is never called from the TURN route\'s own handler — its only door there is deep inside lib/chat-tools.js\'s executor, already proven unreachable in propose mode by tests/unit/chat-tools.test.js', () => {
    // LIN-2434 §A.6 legitimately added a SEPARATE route to this same file —
    // POST .../approve-follow-up — that DOES import and call createDispatchItem
    // directly (a human-approval-gated write, by design; see
    // tests/unit/flight-companion-approve-follow-up-route.test.js for that
    // route's own pins). So the invariant this test protects is scoped to the
    // turn route's own handler body, not "this file never imports it".
    const turnRouteStart = ROUTE_SRC.indexOf("router.post('/workspace/:urlKey/api/flight-companion/turn'");
    assert.ok(turnRouteStart >= 0, 'expected to find the turn route registration in routes/flight-companion.js');
    // The route registration's own closing `  });` (2-space indent, matching
    // the router.post( call's own indent level) — NOT the next route's
    // registration, whose preceding doc comment may legitimately mention
    // createDispatchItem in prose (as approve-follow-up's does).
    const closeIdx = ROUTE_SRC.indexOf('\n  });\n', turnRouteStart);
    assert.ok(closeIdx > turnRouteStart, 'expected to find the turn route\'s own closing `  });`');
    const turnRouteBody = ROUTE_SRC.slice(turnRouteStart, closeIdx);
    // Hardening (LIN-2434 beat 3, Part D): if the `\n  });\n` search above
    // ever matched EARLIER than the turn route's real closing brace (e.g. a
    // future edit adds another 2-space-indented `});` inside the handler
    // body before its end), `turnRouteBody` would silently truncate to a
    // near-empty slice and the doesNotMatch assertion below would pass
    // VACUOUSLY — proving nothing. Pin the slice as non-trivial and as
    // actually reaching the handler's own end, via a marker string that
    // exists ONLY in the turn route's own catch block.
    assert.match(turnRouteBody, /Failed to generate a response/,
      'the extracted slice must reach the turn handler\'s own closing catch block — a truncated/vacuous slice would silently pass the assertion below');
    // A CALL (no space before the paren, this codebase's call style), not a
    // prose mention — the turn route's own comment legitimately names
    // createDispatchItem, parenthetically, when explaining why propose-mode
    // never reaches it ("... createDispatchItem (lib/chat-tools.js, ...)").
    assert.doesNotMatch(turnRouteBody, /createDispatchItem\(/);
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

// ─── LIN-2442 beat 3: acceptance witnesses against a REAL ObserverStateStore ─
//
// Against a REAL MangoDB tmpdir instance (precedent: tests/unit/observer-
// state-store.test.js, tests/unit/owner-credential-store.test.js) — the
// in-memory `fakeObserverStateStore` above is honest about rev/CAS semantics
// now (this beat's own fix), but witness (b) below is a genuine CONCURRENCY
// claim, and a mock collection is atomic by construction (see
// tests/fixtures/mock-collection.js's own header) — it would encode the
// assumption instead of testing it. Witnesses (a) and (c) run on the same
// real store for consistency, not because either needs real concurrency.
describe('Flight Companion turn endpoint (LIN-2442) — acceptance witnesses, mutation-checked', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'flight-companion-lease-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshRealStore() {
    const db = client.db(`fc_lease_${counter++}`);
    return new ObserverStateStore({ collection: db.collection('observer-state') });
  }

  const COMPANION_KEY = 'companion:v1:acme';

  function parseSSE(text) {
    return text.split('\n\n').filter(Boolean).map((frame) => {
      const type = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      return { type, data: data ? JSON.parse(data) : null };
    });
  }

  function censusWithAttention(stateHash, rev) {
    return {
      rev,
      stateHash,
      state: {
        lanes: { working: 1, silent: 0, blocked: 1, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
        attention: [{ loopId: 'loop-lease', lane: 'blocked', stage: 'plan' }],
      },
    };
  }

  function throwingChatClient(message) {
    return {
      async streamChat() { throw new Error(message); },
      async streamChatWithTools() { throw new Error(message); },
    };
  }

  function doneOnlyChatClient() {
    return {
      async streamChat(messages, opts, onEvent) { onEvent('done', {}); },
      async streamChatWithTools(messages, opts, onEvent) { onEvent('done', {}); },
    };
  }

  // The real ObserverStateStore has no seeded sweep:v1: doc in these tests —
  // nothing here ever runs a real sweep — so readCurrent(sweep key) must be
  // pointed at a fixture census, exactly as the fake double's `censusDoc`
  // option does elsewhere in this file. Returns a bound readCurrent that
  // delegates to the real store for every other key (the companion key
  // included), so callers can still read the genuine companion doc through
  // `store.readCurrent(COMPANION_KEY)` unaffected.
  function withCensus(store, census) {
    const original = store.readCurrent.bind(store);
    store.readCurrent = async (instanceKey) => (instanceKey.startsWith('sweep:v1:') ? census : original(instanceKey));
    return store;
  }

  async function waitForCompanionState(store, predicate, { timeoutMs = 2000, intervalMs = 15 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    for (;;) {
      last = await store.readCurrent(COMPANION_KEY);
      if (predicate(last)) return last;
      if (Date.now() > deadline) {
        throw new Error(`waitForCompanionState: timed out; last doc = ${JSON.stringify(last)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // ── (a) the delta survives a post-advance model failure ──────────────────
  //
  // Two sub-cases, both cited by the research as the two ways the pre-fix
  // bug's symptom actually shows up on a LATER turn, depending on whether the
  // sweep ticks again in between: hash-identical (turn 2 sees the exact same
  // census) and no-delta (turn 2 sees a hash-churned but companion-relevant-
  // identical census). Under the FIX, neither must matter — the baseline
  // never moved, so turn 2 must spend again in both cases.
  async function deltaSurvivesFailureCase(turn2Census) {
    const store = freshRealStore();
    const censusA = censusWithAttention('hash-lease-a', 9);
    withCensus(store, censusA);

    const app1 = buildApp({
      observerStateStore: store,
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } },
      chatClient: throwingChatClient('simulated model-call failure after the reservation landed'),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    // Turn 1: seed-turn spend, reservation write lands, the model call throws.
    const turn1 = await post(app1, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(turn1.status, 200);
    const turn1Frames = parseSSE(turn1.text);
    assert.ok(turn1Frames.some((f) => f.type === 'error'), 'turn 1 must surface an error frame');
    assert.ok(!turn1Frames.some((f) => f.type === 'done'), 'no done frame observed => no commit must be attempted');

    const afterTurn1 = await store.readCurrent(COMPANION_KEY);
    assert.strictEqual(afterTurn1.rev, 2, 'the eager reservation write must still bump rev (the double-spend guard stays live)');
    assert.strictEqual(afterTurn1.state.lastCensusStateHash, null, 'the OLD (seed/null) baseline must be untouched by a failed turn');
    assert.ok(afterTurn1.state.turnReservedUntil, 'a reservation lease must be recorded');

    // Fast-forward past BOTH the 180s floor and the 600s lease the same way
    // real elapsed time would read: by writing already-past deadlines
    // through the store's OWN CAS (route has no injectable clock —
    // Date.now() is read directly — this is the same wall-clock-simulation
    // technique as the gate unit tests' floor-boundary cases, one layer up).
    // Skipping the floor rewrite here would leave the (still-fresh)
    // `lastTurnAt` blocking turn 2 on `floor` before the property under test
    // (hash-identical/no-delta re-evaluation) is ever reached.
    const wellPastFloor = new Date(Date.now() - (DEFAULT_COMPANION_FLOOR_MS + 1000)).toISOString();
    const expired = { ...afterTurn1.state, lastTurnAt: wellPastFloor, turnReservedUntil: new Date(Date.now() - 1000).toISOString() };
    const expireWrite = await store.advance(COMPANION_KEY, afterTurn1.rev, expired, { reason: 'test-fast-forward-lease-expiry' });
    assert.strictEqual(expireWrite, true);

    // Turn 2: still the OLD baseline, a genuinely different (or hash-churned
    // but identical) census -> must spend again and actually deliver.
    withCensus(store, turn2Census);
    const app2 = buildApp({
      observerStateStore: store,
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called'); } },
      chatClient: doneOnlyChatClient(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });
    const turn2 = await post(app2, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(turn2.status, 200, 'turn 2 must NOT be short-circuited by hash-identical/no-delta under the fix');
    const doneFrame = parseSSE(turn2.text).find((f) => f.type === 'done');
    assert.ok(doneFrame, 'turn 2 must deliver a done frame — the delta must still be there to report');
    assert.strictEqual(doneFrame.data.surface, true, 'the same genuine change must still surface');

    const committed = await waitForCompanionState(store, (d) => d.state.lastCensusStateHash === turn2Census.stateHash);
    assert.strictEqual(committed.state.lastCensusStateHash, turn2Census.stateHash, 'the baseline finally commits once the report actually lands');

    return { store, censusA };
  }

  test('(a1) hash-identical re-evaluation: turn 2 sees the SAME census turn 1 saw', async () => {
    const censusA = censusWithAttention('hash-lease-a', 9);
    await deltaSurvivesFailureCase(censusA);
  });

  test('(a2) no-delta re-evaluation: turn 2 sees a hash-churned but companion-relevant-IDENTICAL census', async () => {
    // Same lanes/attention as censusA (above), different raw stateHash/rev —
    // exactly the "sweep ticked again, nothing companion-relevant changed"
    // shape the research names as the no-delta branch's real trigger.
    const censusB = censusWithAttention('hash-lease-b', 10);
    await deltaSurvivesFailureCase(censusB);
  });

  // ── (b) overlapping auto-wake turns still cannot both bill ───────────────
  test('(b) barrier-forced overlapping auto-wake turns against a REAL store: exactly one reaches the model call, the loser is lost-race, rev advances exactly once', async () => {
    const store = freshRealStore();
    const census = censusWithAttention('hash-overlap', 3);
    const modelCalls = [];
    const chatClient = {
      async streamChat(messages, opts, onEvent) { modelCalls.push('streamChat'); onEvent('done', {}); },
      async streamChatWithTools(messages, opts, onEvent) { modelCalls.push('streamChatWithTools'); onEvent('done', {}); },
    };

    // Barrier at ensureSeeded — the FIRST store call on the auto-wake path —
    // so BOTH overlapping turns arrive before either proceeds, maximizing the
    // CAS race window (mirrors the research's own barrier-forced overlap
    // methodology against a real MangoDB tmpdir).
    let arrived = 0;
    let releaseBarrier;
    const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
    const originalEnsureSeeded = store.ensureSeeded.bind(store);
    store.ensureSeeded = async (...args) => {
      arrived += 1;
      if (arrived >= 2) releaseBarrier();
      await barrier;
      return originalEnsureSeeded(...args);
    };

    // Reuse the same census doc for both overlapping requests by wiring a
    // trivial sweep-key readCurrent override at the store level (buildApp
    // wires the same store to both apps below).
    const originalReadCurrent = store.readCurrent.bind(store);
    store.readCurrent = async (instanceKey) => (instanceKey.startsWith('sweep:v1:') ? census : originalReadCurrent(instanceKey));

    const app = buildApp({
      observerStateStore: store,
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called — a paid session key is present'); } },
      chatClient,
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });

    const [r1, r2] = await Promise.all([
      post(app, '/workspace/acme/api/flight-companion/turn', {}),
      post(app, '/workspace/acme/api/flight-companion/turn', {}),
    ]);

    const jsonResults = [r1, r2].map((r) => r.json).filter(Boolean);
    assert.strictEqual(jsonResults.length, 1, 'exactly one turn must be denied via the plain-JSON short-circuit');
    assert.strictEqual(jsonResults[0].spent, false);
    assert.strictEqual(jsonResults[0].reason, 'lost-race');

    const sseResults = [r1, r2].filter((r) => !r.json);
    assert.strictEqual(sseResults.length, 1, 'exactly one turn must proceed to the SSE stream');
    const doneFrame = parseSSE(sseResults[0].text).find((f) => f.type === 'done');
    assert.ok(doneFrame, 'the winner must actually deliver a done frame');

    assert.strictEqual(modelCalls.length, 1, 'exactly one model call must have been reached — the double-spend guard');

    const finalDoc = await originalReadCurrent(COMPANION_KEY);
    assert.strictEqual(finalDoc.rev, 2, 'rev must have advanced exactly once, never twice');
  });

  // ── (c) the lease outlasts a slow turn — first-ever run of this witness ──
  test('(c) a turn still in flight past the 180s floor but inside the 600s lease is denied with reason: turn-in-flight', async () => {
    const store = freshRealStore();
    const census = censusWithAttention('hash-c', 4);
    withCensus(store, census);

    const app1 = buildApp({
      observerStateStore: store,
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called'); } },
      chatClient: throwingChatClient('simulated slow/failed turn — functionally identical for this witness to a turn still genuinely running'),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });
    const turn1 = await post(app1, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(turn1.status, 200);

    const afterTurn1 = await store.readCurrent(COMPANION_KEY);
    assert.ok(afterTurn1.state.turnReservedUntil, 'a reservation lease must be recorded');

    // Simulate more than the 180s floor having elapsed since the reservation
    // was made. Both fields are rewritten together, consistently, off the
    // SAME simulated elapsed time and the CURRENT RESERVATION_LEASE_MS
    // constant — never bypassing the CAS, and never hand-waving turnReservedUntil
    // to an arbitrary future value independent of when the reservation was
    // "made". This is what makes the (c) mutation below actually bite: the
    // mutation shortens RESERVATION_LEASE_MS, and this computation reflects
    // whatever that constant is AT TEST-RUN TIME.
    const elapsedMs = DEFAULT_COMPANION_FLOOR_MS + 5000;
    const simulatedLastTurnAt = new Date(Date.now() - elapsedMs).toISOString();
    const simulatedTurnReservedUntil = new Date(Date.now() - elapsedMs + RESERVATION_LEASE_MS).toISOString();
    const stillReserved = { ...afterTurn1.state, lastTurnAt: simulatedLastTurnAt, turnReservedUntil: simulatedTurnReservedUntil };
    const rewrote = await store.advance(COMPANION_KEY, afterTurn1.rev, stillReserved, { reason: 'test-fast-forward-past-floor' });
    assert.strictEqual(rewrote, true);

    const app2 = buildApp({
      observerStateStore: store,
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called — turn-in-flight must deny before quota is ever touched'); } },
      chatClient: throwingChatClient('must not be called — turn-in-flight must deny before any model call'),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });
    const turn2 = await post(app2, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(turn2.status, 200);
    assert.deepStrictEqual(turn2.json, { turnKind: 'auto-wake', spent: false, reason: 'turn-in-flight' });
  });

  // ── beat 3 item 6: the failed-commit consequence, actually verified ──────
  //
  // Makes every commit-tagged advance() (meta.reason: 'flight-companion-
  // commit') return `false`, as if it always lost its CAS, while leaving the
  // eager reservation write genuinely real. Proves beat 2's claim: the
  // report already reached the user regardless, the failure is benign and
  // logged, and the delta is delayed (re-surfaced later, exactly once the
  // reservation's lease clears) rather than dropped.
  function forceCommitFailure(store) {
    const originalAdvance = store.advance.bind(store);
    store.advance = async (instanceKey, expectedRev, nextState, meta) => {
      if (meta && meta.reason === 'flight-companion-commit') return false;
      return originalAdvance(instanceKey, expectedRev, nextState, meta);
    };
    return store;
  }

  test('(consequence) a failed commit is benign — the report still reaches the user, and the still-uncommitted delta re-surfaces later (worst case, after the full lease), never lost', async () => {
    const store = freshRealStore();
    const census = censusWithAttention('hash-consequence', 5);
    withCensus(store, census);
    forceCommitFailure(store);

    const originalError = console.error;
    const errorCalls = [];
    console.error = (...args) => { errorCalls.push(args); };
    let turn1;
    try {
      const app1 = buildApp({
        observerStateStore: store,
        freeTierStore: { async tryUse() { throw new Error('tryUse must not be called'); } },
        chatClient: doneOnlyChatClient(),
        session: { openRouterApiKey: 'sk-test-paid-key' },
      });
      turn1 = await post(app1, '/workspace/acme/api/flight-companion/turn', {});

      // The commit runs AFTER res.end() (same house convention the research
      // names for the pre-fix baseline write) — poll rather than assume it
      // has landed the instant post() resolves. console.error must stay
      // captured for this whole window, or a commit that logs AFTER the
      // capture is torn down would be invisible to the assertion below.
      const deadline = Date.now() + 2000;
      while (!errorCalls.some((args) => /commit advance\(\) did not land/.test(String(args[0]))) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    } finally {
      console.error = originalError;
    }

    // User-visible outcome #1: delivered, not dropped, not surfaced as an error.
    assert.strictEqual(turn1.status, 200);
    const turn1Frames = parseSSE(turn1.text);
    const doneFrame = turn1Frames.find((f) => f.type === 'done');
    assert.ok(doneFrame, 'the done frame must still reach the client even though the commit write is about to fail');
    assert.strictEqual(doneFrame.data.surface, true);
    assert.ok(!turn1Frames.some((f) => f.type === 'error'), 'a failed commit must never surface as a client-visible error');

    // Logged, never thrown, never retried inline (beat 2's own convention).
    assert.ok(
      errorCalls.some((args) => /commit advance\(\) did not land/.test(String(args[0]))),
      'a failed commit must be logged via the existing console.error convention'
    );

    // The baseline never actually moved.
    const afterFailedCommit = await store.readCurrent(COMPANION_KEY);
    assert.notStrictEqual(afterFailedCommit.state.lastCensusStateHash, census.stateHash, 'the NEW baseline must never land when the commit is lost');
    assert.ok(afterFailedCommit.state.turnReservedUntil, 'the reservation from the eager write is still on record');

    // Still within the lease: a second turn is DENIED (turn-in-flight), not
    // silently re-billed and not told the change is gone.
    const stillWithinLease = { ...afterFailedCommit.state, lastTurnAt: new Date(Date.now() - (DEFAULT_COMPANION_FLOOR_MS + 5000)).toISOString() };
    const rewrote = await store.advance(COMPANION_KEY, afterFailedCommit.rev, stillWithinLease, { reason: 'test-simulate-past-floor-still-in-lease' });
    assert.strictEqual(rewrote, true);
    const app2 = buildApp({
      observerStateStore: store,
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called'); } },
      chatClient: doneOnlyChatClient(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });
    const turn2 = await post(app2, '/workspace/acme/api/flight-companion/turn', {});
    assert.deepStrictEqual(turn2.json, { turnKind: 'auto-wake', spent: false, reason: 'turn-in-flight' }, 'still within the lease -> denied, not lost, not double-billed either');

    // Worst case: only once the FULL lease (RESERVATION_LEASE_MS, 600s)
    // elapses does the still-uncommitted delta finally re-surface — delayed
    // by up to the lease's own duration, never permanently lost.
    const afterTurn2 = await store.readCurrent(COMPANION_KEY);
    const leaseExpired = { ...afterTurn2.state, turnReservedUntil: new Date(Date.now() - 1000).toISOString() };
    await store.advance(COMPANION_KEY, afterTurn2.rev, leaseExpired, { reason: 'test-expire-lease' });
    const app3 = buildApp({
      observerStateStore: store,
      freeTierStore: { async tryUse() { throw new Error('tryUse must not be called'); } },
      chatClient: doneOnlyChatClient(),
      session: { openRouterApiKey: 'sk-test-paid-key' },
    });
    const turn3 = await post(app3, '/workspace/acme/api/flight-companion/turn', {});
    assert.strictEqual(turn3.status, 200);
    const turn3Done = parseSSE(turn3.text).find((f) => f.type === 'done');
    assert.ok(turn3Done, 'once the lease fully expires, the still-uncommitted change is finally (re-)delivered — delayed, never lost');
  });
});
