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
 *
 * What ISN'T covered by execution here, and why: once a turn clears every
 * gate above, the handler calls straight into `streamChat`/
 * `streamChatWithTools` (live OpenRouter calls, not dependency-injected —
 * same as `routes/task-chat.js`). Live-invocation arg capture isn't
 * available without opting the whole unit suite into Node's
 * `--experimental-test-module-mocks` flag (no test in this repo currently
 * uses it — confirmed absent even on Node 25). Matching
 * tests/unit/task-chat-route.test.js's own established idiom for exactly
 * this class of problem, those properties (the `isToolCapableModel` degrade
 * to plain `streamChat`, and the `followUpMode` wiring per turn shape) are
 * pinned as structural assertions against the route's own source text
 * instead — see the 'source-text wiring' describe block below. The deeper
 * guarantee those source assertions rely on — that `followUpMode: 'propose'`
 * really can never reach `createDispatchItem` — is proven by REAL executable
 * tests already, in tests/unit/chat-tools.test.js's
 * "LIN-2432 §A.4: send_follow_up followUpMode" block (asserts on a
 * dispatchQueueStore spy). This file's job is only to pin that the route
 * wires the right mode for the right turn shape.
 *
 * LIN-2432 beat 3 adds: §A.12 server.js wiring (structural, against
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

function buildApp({ observerStateStore, freeTierStore, flightCompanionEnabled = true, session = {} } = {}) {
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

describe('Flight Companion turn endpoint — source-text wiring (untestable without live network, see file header)', () => {
  test('branches on isToolCapableModel and degrades honestly to plain streamChat for an unknown-capability model', () => {
    assert.match(ROUTE_SRC, /isToolCapableModel\s*\(\s*selectedModel\s*\)/);
    assert.match(ROUTE_SRC, /streamChatWithTools\s*\(/);
    assert.match(ROUTE_SRC, /streamChat\s*\(/);
    assert.match(ROUTE_SRC, /model:\s*selectedModel/);
  });

  test('wires followUpMode: execute for user-initiated, propose for auto-wake — the ONE line withholding execute-mode writes from an auto-wake turn', () => {
    const start = ROUTE_SRC.indexOf('createChatToolCatalog({');
    assert.ok(start > 0, 'expected the createChatToolCatalog call site to exist');
    const end = ROUTE_SRC.indexOf('});', start);
    const callSrc = ROUTE_SRC.slice(start, end);

    assert.match(callSrc, /followUpEnabled:\s*true/, 'the model must still be able to reason about/request a follow-up on BOTH turn shapes');
    assert.match(
      callSrc,
      /followUpMode:\s*turnKind\s*===\s*'user-initiated'\s*\?\s*'execute'\s*:\s*'propose'/,
      'followUpMode must be derived from the SAME server-side turnKind everything else uses — never a second, independently-computed flag'
    );
    // sessionIsTerminal must be wired for BOTH turn shapes: chat-tools.js's
    // shared "not configured" guard gates propose mode too, even though
    // propose mode never calls it (LIN-2432 beat 1 report) — an auto-wake-only
    // catalog missing this would throw "not configured" on every wake.
    assert.match(callSrc, /sessionIsTerminal,/);
  });

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
