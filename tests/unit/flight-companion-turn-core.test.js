/**
 * tests/unit/flight-companion-turn-core.test.js — LIN-2631.
 *
 * The extracted turn core, driven DIRECTLY rather than through an Express app.
 * That is the point of the extraction and therefore the point of this file: a
 * proxy endpoint (LIN-2620), a boot turn (LIN-2622) and a scheduler tick
 * (LIN-2627) will each call it exactly like this, with no `req`/`res` anywhere.
 *
 * The route's own behavioural suite (flight-companion-turn-route.test.js) still
 * covers the browser path end to end and passes unchanged; this file covers
 * what only a direct caller can reach.
 */

import { test, describe, mock } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { runFlightCompanionTurn, sumUsage } from '../../lib/flight-companion-turn.js';
import { buildTurnRecords, buildCompanionSnapshot, deriveReservationLeaseMs, COMPANION_SEED_STATE } from '../../lib/flight-companion-gate.js';
import { streamChat, streamChatWithTools, setLlmCallRecorder } from '../../lib/openrouter.js';
import { CHAT_TOOL_RESULT_BUDGETS } from '../../lib/chat-tools.js';

const WORKSPACE = { urlKey: 'acme', id: 'ws-1' };

function fakeStore({ companionState = null, companionRev = 1, census = null } = {}) {
  const state = { companion: companionState, rev: companionRev, advances: [] };
  return {
    state,
    async ensureSeeded(_key, seed) {
      if (state.companion === null) state.companion = seed;
      return { rev: state.rev, state: state.companion };
    },
    async readCurrent(key) {
      if (key.startsWith('sweep:')) return census;
      return { rev: state.rev, state: state.companion };
    },
    async advance(key, expectedRev, record, meta) {
      state.advances.push({ key, expectedRev, record, meta });
      if (expectedRev !== state.rev) return false;
      state.rev += 1;
      state.companion = record;
      return true;
    },
  };
}

function censusDoc(hash = 'h1', rev = 5) {
  return {
    rev, stateHash: hash,
    state: {
      lanes: { working: 1, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
      attention: [], truncated: false,
    },
  };
}

function baseDeps(store, chatClient) {
  return {
    observerStateStore: store,
    workspacePreferencesStore: null,
    chatClient,
    createToolCatalog: () => ({ tools: [], executeTool: async () => ({}) }),
    getProvider: () => ({}),
    getScope: () => ({}),
    buildCensusSeedText: () => 'CENSUS SEED',
    sessionIsTerminal: () => false,
    now: () => 1_700_000_000_000,
  };
}

// A chat client that emits a scripted event sequence and nothing else.
function scriptedClient(events) {
  return {
    async streamChat(_m, _o, onEvent) { for (const [t, d] of events) onEvent(t, d); },
    async streamChatWithTools(_m, _o, onEvent) { for (const [t, d] of events) onEvent(t, d); },
  };
}

describe('LIN-2631: the turn core runs without any HTTP at all', () => {
  test('a user-initiated turn streams and reports spent, with no req/res in sight', async () => {
    const seen = [];
    const store = fakeStore({ census: censusDoc() });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'where are we?',
      apiKey: 'sk-test', onEvent: (t, d) => seen.push([t, d]),
      deps: baseDeps(store, scriptedClient([['token', { token: 'hi' }], ['done', { finishReason: 'stop' }]])),
    });
    assert.deepStrictEqual(out, { spent: true, turnKind: 'user-initiated' });
    assert.deepStrictEqual(seen.map(([t]) => t), ['token', 'done']);
    // A user-initiated turn touches no reservation at all.
    assert.strictEqual(store.state.advances.length, 0);
  });

  test('a gate refusal comes back as a VALUE, never as an event — which is what lets a non-streaming caller exist', async () => {
    const seen = [];
    // No census => the gate's `no-census` branch.
    const store = fakeStore({ census: null });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: (t, d) => seen.push([t, d]),
      deps: baseDeps(store, scriptedClient([['done', {}]])),
    });
    assert.strictEqual(out.spent, false);
    assert.strictEqual(out.reason, 'no-census');
    assert.deepStrictEqual(seen, [], 'a refusal must emit nothing');
    assert.strictEqual(store.state.advances.length, 0, 'and must write nothing');
  });

  test('onStreamStart fires exactly once, after every refusal path and before the model call', async () => {
    // The ordering that keeps a model failure a 200-with-error-frame rather
    // than a 500: the caller must have its channel open before the model runs,
    // and must NOT have opened it for a turn that refuses.
    const order = [];
    const store = fakeStore({ census: censusDoc() });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'hi', apiKey: 'sk-test',
      onStreamStart: () => order.push('stream-start'),
      onEvent: (t) => order.push(`event:${t}`),
      deps: baseDeps(store, {
        async streamChat(_m, _o, onEvent) { order.push('model'); onEvent('done', {}); },
        async streamChatWithTools(_m, _o, onEvent) { order.push('model'); onEvent('done', {}); },
      }),
    });
    assert.deepStrictEqual(order, ['stream-start', 'model', 'event:done']);
  });

  test('onBeforeSpend refuses AFTER the gate clears and BEFORE the reservation is written', async () => {
    // LIN-2432 §A.2's ordering is an acceptance criterion, not a preference:
    // the quota must not be touched by a turn the gate already refused, and a
    // quota refusal must not leave a reservation behind.
    const store = fakeStore({ census: censusDoc() });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onBeforeSpend: async () => ({ reason: 'free-tier' }),
      onEvent: () => assert.fail('a refused turn must emit nothing'),
      deps: baseDeps(store, scriptedClient([['done', {}]])),
    });
    assert.strictEqual(out.spent, false);
    assert.strictEqual(out.reason, 'free-tier');
    assert.strictEqual(store.state.advances.length, 0, 'no reservation may survive a quota refusal');
  });

  test('a lost reservation race aborts before the model, never a second billable spend', async () => {
    const store = fakeStore({ census: censusDoc() });
    store.advance = async () => false; // another overlapping turn won
    let modelRan = false;
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat() { modelRan = true; },
        async streamChatWithTools() { modelRan = true; },
      }),
    });
    assert.strictEqual(out.spent, false);
    assert.strictEqual(out.reason, 'lost-race');
    assert.strictEqual(modelRan, false);
  });

  test('a backend error on the reservation denies the spend rather than proceeding', async () => {
    const store = fakeStore({ census: censusDoc() });
    store.advance = async () => null;
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => assert.fail('must not stream'),
      deps: baseDeps(store, scriptedClient([['done', {}]])),
    });
    assert.strictEqual(out.reason, 'advance-error');
  });
});

describe('LIN-2631: the commit is scoped to its own reservation (LIN-2447 item 2, preserved)', () => {
  test('a late commit from turn A never clears turn B\'s live lease', async () => {
    // The acceptance witness. Turn A reserves, then is overtaken: by the time
    // it commits, the record carries turn B's reservationId. Committing onto
    // that would clear B's live lease (A's commit record carries
    // turnReservedUntil: null) and overwrite B's baseline with A's stale one.
    const store = fakeStore({ census: censusDoc('hash-A') });
    let released;
    const held = new Promise((r) => { released = r; });

    const turnA = runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat(_m, _o, onEvent) { await held; onEvent('done', {}); },
        async streamChatWithTools(_m, _o, onEvent) { await held; onEvent('done', {}); },
      }),
    });

    // While A is mid-stream, a successor reserves: overwrite the stored record
    // with B's own live reservation, exactly as B's own advance() would.
    await new Promise((r) => setImmediate(r));
    const bLease = new Date(Date.now() + 900_000).toISOString();
    store.state.companion = {
      v: 1, lastCensusStateHash: 'hash-B', lastCensusSnapshot: {},
      lastTurnAt: new Date().toISOString(), turnReservedUntil: bLease,
      reservationId: 'reservation-B', notes: '',
    };
    store.state.rev += 1;

    released();
    await turnA;

    // B's record is untouched: its lease still live, its baseline still B's.
    assert.strictEqual(store.state.companion.reservationId, 'reservation-B');
    assert.strictEqual(store.state.companion.turnReservedUntil, bLease, 'A must not have cleared B\'s lease');
    assert.strictEqual(store.state.companion.lastCensusStateHash, 'hash-B', 'A must not have written its stale baseline');
    // And the skip is a skip, not a failed write: no commit advance was issued.
    const commits = store.state.advances.filter((a) => a.meta?.reason === 'flight-companion-commit');
    assert.strictEqual(commits.length, 0, 'the commit must be SKIPPED, not attempted and lost');
  });

  test('an uninterrupted turn does commit its new baseline', async () => {
    // The other half — without this, the test above would pass on a core that
    // never commits at all.
    const store = fakeStore({ census: censusDoc('hash-new') });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, scriptedClient([['done', { finishReason: 'stop' }]])),
    });
    assert.strictEqual(store.state.companion.lastCensusStateHash, 'hash-new');
    assert.strictEqual(store.state.companion.turnReservedUntil, null, 'the commit clears the lease');
    assert.strictEqual(store.state.companion.reservationId, null);
  });

  test('a disconnected client leaves the delta unconsumed (LIN-2449, preserved)', async () => {
    const store = fakeStore({ census: censusDoc('hash-new') });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      isClientGone: () => true,
      deps: baseDeps(store, scriptedClient([['done', { finishReason: 'stop' }]])),
    });
    // The reservation landed, but the baseline did NOT move — the next turn
    // re-surfaces the same change rather than losing it.
    assert.notStrictEqual(store.state.companion.lastCensusStateHash, 'hash-new');
    assert.ok(store.state.companion.turnReservedUntil, 'the lease self-expires rather than being released');
  });

  test('no terminal done frame means no commit', async () => {
    const store = fakeStore({ census: censusDoc('hash-new') });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, scriptedClient([['token', { token: 'partial' }]])),
    });
    assert.notStrictEqual(store.state.companion.lastCensusStateHash, 'hash-new');
  });
});

describe('LIN-2631: hop usage is summed onto the final done', () => {
  test('sumUsage adds numeric fields and never invents one', () => {
    assert.deepStrictEqual(
      sumUsage({ prompt_tokens: 10, completion_tokens: 5 }, { prompt_tokens: 3, completion_tokens: 2 }),
      { prompt_tokens: 13, completion_tokens: 7 }
    );
    // A field present on only one side still rides, added to an implicit zero.
    assert.deepStrictEqual(sumUsage({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
    // Neither side carrying usage yields null, not an empty object that would
    // read downstream as "this turn cost nothing".
    assert.strictEqual(sumUsage(null, null), null);
    assert.deepStrictEqual(sumUsage(null, { a: 1 }), { a: 1 });
    // A non-summable field (a model id) takes the later value rather than NaN.
    assert.deepStrictEqual(sumUsage({ model: 'a', t: 1 }, { model: 'b', t: 1 }), { model: 'b', t: 2 });
  });

  test('a tool-using turn reports the WHOLE turn\'s usage, not just its final call', async () => {
    // `streamChatWithTools` bills a model call per hop, but only the final
    // call's usage reaches the terminal frame — every hop's goes to
    // recordLlmCall and is invisible to the event stream. A consumer reading
    // done.usage therefore under-reports a tool-using turn, sometimes by most
    // of its real cost.
    const store = fakeStore({ census: censusDoc() });
    let doneFrame = null;
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'go', apiKey: 'sk-test',
      onEvent: (t, d) => { if (t === 'done') doneFrame = d; },
      deps: baseDeps(store, scriptedClient([
        ['tool', { phase: 'call', id: 'c1', name: 'get_stack' }],
        ['tool', { phase: 'result', id: 'c1', name: 'get_stack', usage: { prompt_tokens: 100, completion_tokens: 20 } }],
        ['tool', { phase: 'result', id: 'c2', name: 'get_session', usage: { prompt_tokens: 40, completion_tokens: 10 } }],
        ['done', { finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } }],
      ])),
    });
    assert.deepStrictEqual(doneFrame.usage, { prompt_tokens: 147, completion_tokens: 33 });
  });

  test('a turn with no usage anywhere reports no usage, rather than a fabricated zero', async () => {
    const store = fakeStore({ census: censusDoc() });
    let doneFrame = null;
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'go', apiKey: 'sk-test',
      onEvent: (t, d) => { if (t === 'done') doneFrame = d; },
      deps: baseDeps(store, scriptedClient([['done', { finishReason: 'stop' }]])),
    });
    assert.strictEqual(doneFrame.usage, undefined);
  });

  test('an auto-wake done carries the gate\'s surface; a user-initiated one never does', async () => {
    const store = fakeStore({ census: censusDoc() });
    let autoDone = null;
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: (t, d) => { if (t === 'done') autoDone = d; },
      deps: baseDeps(store, scriptedClient([['done', { finishReason: 'stop' }]])),
    });
    assert.ok('surface' in autoDone);

    let userDone = null;
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'hi', apiKey: 'sk-test',
      onEvent: (t, d) => { if (t === 'done') userDone = d; },
      deps: baseDeps(fakeStore({ census: censusDoc() }), scriptedClient([['done', { finishReason: 'stop' }]])),
    });
    assert.ok(!('surface' in userDone));
  });
});

describe('LIN-2631: the extraction must not change what the browser receives on failure', () => {
  test('the SSE error frame is a FIXED generic message, never the internal error text', () => {
    // Found by diffing the pre-extraction handler's statements against the new
    // core + route rather than trusting that "the code moved". My first draft
    // sent `{ error: error.message }` — a different payload KEY and a leak of
    // internal error strings to the browser, in a PR whose whole claim is
    // "behaviour byte-identical".
    const ROUTE_SRC = readFileSync(new URL('../../routes/flight-companion.js', import.meta.url), 'utf8');
    assert.match(ROUTE_SRC, /sendSSE\(res, 'error', \{ message: 'Failed to generate a response' \}\)/);
    // The internal text must not reach the wire from the turn handler's catch.
    const turnStart = ROUTE_SRC.indexOf("router.post('/workspace/:urlKey/api/flight-companion/turn'");
    const turnEnd = ROUTE_SRC.indexOf('\n  });\n', turnStart);
    const handler = ROUTE_SRC.slice(turnStart, turnEnd);
    assert.match(handler, /client disconnected mid-turn/, 'the slice must reach the handler\'s own catch');
    assert.doesNotMatch(handler, /sendSSE\([^)]*error\.message/);
  });

  test('a throw before the stream opens still reaches the client as a frame, not a bare 500', () => {
    // The pre-extraction handler wrote its SSE headers up front, so EVERY throw
    // produced an error frame. Answering a pre-stream throw with 500 JSON
    // instead would be a different client contract for a store fault.
    const ROUTE_SRC = readFileSync(new URL('../../routes/flight-companion.js', import.meta.url), 'utf8');
    const turnStart = ROUTE_SRC.indexOf("router.post('/workspace/:urlKey/api/flight-companion/turn'");
    const turnEnd = ROUTE_SRC.indexOf('\n  });\n', turnStart);
    const handler = ROUTE_SRC.slice(turnStart, turnEnd);
    assert.doesNotMatch(handler, /status\(500\)/, 'the turn handler has never answered a throw with 500');
    // The catch opens the stream itself if the throw beat `onStreamStart`.
    assert.match(handler, /startStream\(\);\s*\n\s*sendSSE\(res, 'error'/);
  });
});

describe('LIN-2631 review round 1: the gate is EXTRACTED, not duplicated', () => {
  const ROUTE_SRC = readFileSync(new URL('../../routes/flight-companion.js', import.meta.url), 'utf8');

  test('the route runs no gate of its own — it was duplicated, not moved, in the first draft', () => {
    // The first extraction left the whole auto-wake block in the handler AND
    // added it to the core, so every auto-wake tick did ensureSeeded +
    // readCurrent + shouldSpendTurn TWICE, on a client cadence, per workspace.
    // Worse than the wasted reads: two independent Date.now() gate evaluations
    // meant a turn that lost a race between them reported `turn-in-flight`
    // where it used to report `lost-race` — a wire-visible divergence.
    assert.doesNotMatch(ROUTE_SRC, /shouldSpendTurn\(/, 'the route must not evaluate the gate');
    assert.doesNotMatch(ROUTE_SRC, /observerStateStore\.ensureSeeded\(/, 'nor seed the companion instance');
    assert.doesNotMatch(ROUTE_SRC, /observerStateStore\.advance\(/, 'nor write a reservation');
  });

  test('the config 503 rides in onBeforeSpend, which is what let the duplicate go', () => {
    // The block could not simply be deleted: it was the only thing keeping the
    // gate ahead of the "AI is not configured" 503. Moving that check into the
    // hook the core calls at the right moment is what makes the deletion safe.
    assert.match(ROUTE_SRC, /onBeforeSpend: async \(\) => \{\s*\n\s*if \(!apiKeyToUse\) return \{ reason: 'not-configured' \}/);
    assert.match(ROUTE_SRC, /outcome\.reason === 'not-configured'[\s\S]{0,200}status\(503\)/);
  });

  test('an unconfigured workspace still 503s, and only AFTER the gate has spoken', async () => {
    const order = [];
    // No census => the gate refuses first, so the config check must never run.
    const refused = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: null,
      onBeforeSpend: async () => { order.push('config'); return { reason: 'not-configured' }; },
      onEvent: () => {},
      deps: baseDeps(fakeStore({ census: null }), scriptedClient([['done', {}]])),
    });
    assert.strictEqual(refused.reason, 'no-census');
    assert.deepStrictEqual(order, [], 'a gate refusal must short-circuit before the config check');

    // With a census, the gate clears and the config refusal is what comes back.
    const unconfigured = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: null,
      onBeforeSpend: async () => { order.push('config'); return { reason: 'not-configured' }; },
      onEvent: () => assert.fail('must not stream'),
      deps: baseDeps(fakeStore({ census: censusDoc() }), scriptedClient([['done', {}]])),
    });
    assert.strictEqual(unconfigured.reason, 'not-configured');
    assert.deepStrictEqual(order, ['config']);
  });
});

describe('LIN-2631 review round 1: the smaller hardening', () => {
  test('sumUsage never returns a caller\'s own object, and NaN cannot poison the total', () => {
    const a = { prompt_tokens: 5 };
    const out = sumUsage(null, a);
    assert.notStrictEqual(out, a, 'a returned reference would let later frames mutate an already-read payload');
    out.prompt_tokens = 999;
    assert.strictEqual(a.prompt_tokens, 5);
    // NaN is a number, so a typeof check would let one field poison the rest.
    assert.deepStrictEqual(sumUsage({ t: NaN }, { t: 4 }), { t: 4 });
    assert.deepStrictEqual(sumUsage({ t: 4 }, { t: NaN }), { t: 4 });
  });

  test('a zero iteration budget means the same thing to the lease and to the model call', () => {
    // They disagreed: the lease treated 0 as a real budget (180s) while the
    // model call treated it as falsy and fell back to openrouter's default of
    // 4 — a 600s worst case against a 180s lease.
    const CORE_SRC = readFileSync(new URL('../../lib/flight-companion-turn.js', import.meta.url), 'utf8');
    assert.match(CORE_SRC, /const usableIterations = Number\.isInteger\(budget\.maxIterations\) && budget\.maxIterations > 0/);
    assert.match(CORE_SRC, /deriveReservationLeaseMs\(usableIterations\)/);
    assert.match(CORE_SRC, /usableIterations != null \? \{ maxIterations: usableIterations \}/);
  });

  test('buildTurnRecords refuses a null census or companion doc rather than TypeError-ing', () => {
    // It is public API now precisely so a boot turn can skip the gate's refusal
    // branches — which is where a null arrives.
    assert.throws(
      () => buildTurnRecords({ currentCensusDoc: null, companionDoc: {}, now: 1 }),
      /requires a census doc/
    );
    assert.throws(
      () => buildTurnRecords({ currentCensusDoc: { stateHash: 'h', state: {} }, companionDoc: null, now: 1 }),
      /requires a companion doc/
    );
  });

  test('the lease timeout constant is pinned against openrouter\'s own source, not just asserted', () => {
    // LIN-2447 regexes REQUEST_TIMEOUT_MS out of the source because it is
    // module-private. That pin protects the DEFAULT budget through
    // RESERVATION_LEASE_MS; this one protects every other budget, which is what
    // deriveReservationLeaseMs exists for.
    const OR_SRC = readFileSync(new URL('../../lib/openrouter.js', import.meta.url), 'utf8');
    const m = OR_SRC.match(/const REQUEST_TIMEOUT_MS = (\d+);/);
    assert.ok(m, 'expected REQUEST_TIMEOUT_MS in lib/openrouter.js');
    const live = Number(m[1]);
    const GATE_SRC = readFileSync(new URL('../../lib/flight-companion-gate.js', import.meta.url), 'utf8');
    const g = GATE_SRC.match(/const LEASE_REQUEST_TIMEOUT_MS = ([\d_]+);/);
    assert.ok(g, 'expected LEASE_REQUEST_TIMEOUT_MS in the gate');
    assert.strictEqual(
      Number(g[1].replace(/_/g, '')), live,
      'the derived lease must track openrouter\'s real request timeout, or every non-default budget drifts silently'
    );
  });
});

// LIN-2439 ledger item 2: every streamChat/streamChatWithTools call in the
// rest of the suite is driven by a fake `chatClient` — message shape, the
// 1500 maxTokens budget, callMeta, and toolResultMaxCharsByTool actually
// reaching the wire are unproven by a green suite. This describe block wires
// the REAL lib/openrouter.js functions as the turn core's chatClient, mocks
// only `global.fetch` (the actual HTTP boundary, one level below "the
// provider"), and asserts on the outgoing request bodies — a recorded-fixture
// discharge rather than a live-key manual turn.
describe('LIN-2439 ledger item 2: the real provider call shape, proven over a fixture', () => {
  let originalFetch;
  let savedProxyEnv;
  let calls;

  const beforeEachHook = () => {
    originalFetch = global.fetch;
    savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY, HTTP_PROXY: process.env.HTTP_PROXY,
      https_proxy: process.env.https_proxy, http_proxy: process.env.http_proxy,
    };
    delete process.env.HTTPS_PROXY; delete process.env.HTTP_PROXY;
    delete process.env.https_proxy; delete process.env.http_proxy;
    calls = [];
  };
  const afterEachHook = () => {
    global.fetch = originalFetch;
    setLlmCallRecorder(null);
    for (const [k, v] of Object.entries(savedProxyEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };

  function toolHopResponse(toolCalls) {
    return {
      ok: true,
      json: async () => ({
        model: 'openai/gpt-5.4-mini', provider: 'OpenAI',
        choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 },
      }),
    };
  }

  function finalHopResponse() {
    return {
      ok: true,
      json: async () => ({
        model: 'openai/gpt-5.4-mini', provider: 'OpenAI',
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, cost: 0.0002 },
      }),
    };
  }

  function streamResponse(pieces) {
    const enc = new TextEncoder();
    const blocks = pieces.map(p =>
      `data: ${JSON.stringify({ provider: 'OpenAI', model: 'openai/gpt-5.4-mini', choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
    blocks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, cost: 0.0003 } })}\n\n`);
    blocks.push('data: [DONE]\n\n');
    return { ok: true, body: (async function* () { for (const b of blocks) yield enc.encode(b); })() };
  }

  test('the real streamChatWithTools call carries the turn\'s maxTokens, callMeta, and per-tool truncation to the wire', async () => {
    beforeEachHook();
    try {
      const queue = [
        toolHopResponse([{ id: 'c1', type: 'function', function: { name: 'get_comments', arguments: '{}' } }]),
        finalHopResponse(),
      ];
      global.fetch = mock.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        if (body.stream === true) return streamResponse(['answer']);
        return queue.shift();
      });
      const records = [];
      setLlmCallRecorder((r) => records.push(r));

      const oversized = 'x'.repeat(CHAT_TOOL_RESULT_BUDGETS.get_comments + 500);
      const store = fakeStore({ census: censusDoc() });
      const deps = {
        ...baseDeps(store, { streamChat, streamChatWithTools }),
        createToolCatalog: () => ({
          tools: [{ type: 'function', function: { name: 'get_comments', description: 'x', parameters: { type: 'object', properties: {} } } }],
          executeTool: async () => oversized,
        }),
      };

      const out = await runFlightCompanionTurn({
        workspace: WORKSPACE, turnKind: 'user-initiated', message: 'catch me up',
        apiKey: 'sk-test', onEvent: () => {}, deps,
      });
      assert.strictEqual(out.spent, true);

      // Message shape + the 1500 maxTokens budget reached every hop, not just
      // the first — a per-call default would drift on the second request.
      assert.ok(calls.length >= 2, 'expected at least a tool hop and a final answer');
      for (const body of calls) {
        assert.strictEqual(body.max_tokens, 1500, 'flight-companion-turn.js\'s DEFAULT_MAX_TOKENS must reach every wire request');
        assert.ok(Array.isArray(body.messages) && body.messages.some(m => m.role === 'user'), 'the user message must reach the wire');
      }
      const firstHop = calls[0];
      assert.ok(firstHop.tools && firstHop.tools.some(t => t.function.name === 'get_comments'));

      // toolResultMaxCharsByTool (CHAT_TOOL_RESULT_BUDGETS) must actually clip
      // the oversized tool result before it is appended and re-sent — proving
      // the budget reaches openrouter.js's real truncation, not just that the
      // option object was passed somewhere.
      const withToolMsg = calls.find(b => Array.isArray(b.messages) && b.messages.some(m => m.role === 'tool'));
      assert.ok(withToolMsg, 'expected a follow-up request carrying the tool result');
      const toolMsg = withToolMsg.messages.find(m => m.role === 'tool');
      assert.strictEqual(toolMsg.content.length, CHAT_TOOL_RESULT_BUDGETS.get_comments + '\n… [truncated 500 chars]'.length);
      assert.match(toolMsg.content, /\[truncated 500 chars\]$/);

      // callMeta (urlKey/feature) must reach recordLlmCall on the REAL
      // provider path, not just be threaded through options unread.
      assert.ok(records.length >= 1);
      assert.ok(records.every(r => r.urlKey === 'acme' && r.feature === 'flight-companion'));
    } finally {
      afterEachHook();
    }
  });
});

describe('LIN-2439 ledger item 6: the observerStateStore-omitted degradation path', () => {
  // Unreachable in the wired configuration (every real caller injects the
  // store), so this is a CONTRACT pin, not a production scenario: an
  // auto-wake turn constructed without observerStateStore fails loud
  // (a TypeError from the unguarded `observerStateStore.ensureSeeded` call)
  // rather than silently degrading past the gate. Closing this honestly
  // means proving that today, not asserting an untested "it's fine".
  test('an auto-wake turn with no observerStateStore rejects instead of silently skipping the gate', async () => {
    const deps = baseDeps(undefined, scriptedClient([['done', {}]]));
    await assert.rejects(
      () => runFlightCompanionTurn({
        workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
        onEvent: () => {}, deps,
      }),
      TypeError,
      'an auto-wake turn requires observerStateStore; omitting it must not silently proceed as though the gate passed'
    );
  });
});

// ─── LIN-2625: playbook memory ───────────────────────────────────────────────

// A store keyed by exact instance-key string, so a test can seed/inspect the
// BASE (unsuffixed) companion instance and a SUFFIXED (proxy) one
// independently — the single shared-doc `fakeStore` above cannot express
// "these are two different records", which the base-vs-suffixed playbook
// read/write split is precisely about.
function multiKeyStore(initial = {}) {
  const docs = new Map(Object.entries(initial).map(([k, v]) => [k, { rev: 1, state: v }]));
  const advances = [];
  return {
    docs, advances,
    async ensureSeeded(key, seed) {
      if (!docs.has(key)) docs.set(key, { rev: 1, state: seed });
      const d = docs.get(key);
      return { rev: d.rev, state: d.state };
    },
    async readCurrent(key) {
      const d = docs.get(key);
      return d ? { rev: d.rev, state: d.state } : null;
    },
    async advance(key, expectedRev, record, meta) {
      advances.push({ key, expectedRev, record, meta });
      const d = docs.get(key);
      const currentRev = d ? d.rev : 0;
      if (expectedRev !== currentRev) return false;
      docs.set(key, { rev: currentRev + 1, state: record });
      return true;
    },
  };
}

function catalogCapturing(capture) {
  return (args) => { capture.args = args; return { tools: [], executeTool: async () => ({}) }; };
}

describe('LIN-2625: playbook memory', () => {
  test('a typed (user-initiated) turn persists a remembered playbook on done', async () => {
    const capture = {};
    const store = fakeStore({ census: censusDoc() });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'notes please', apiKey: 'sk-test',
      onEvent: () => {},
      deps: {
        ...baseDeps(store, {
          async streamChat() {},
          async streamChatWithTools(_m, _o, onEvent) {
            capture.args.onRemember('lane G: confirm LIN-1988 at 08:00');
            onEvent('done', {});
          },
        }),
        createToolCatalog: catalogCapturing(capture),
      },
    });
    assert.strictEqual(out.spent, true);
    assert.strictEqual(store.state.companion.notes, 'lane G: confirm LIN-1988 at 08:00');
  });

  test('a second remember call within the same turn keeps the LAST value — replace, never append', async () => {
    const capture = {};
    const store = fakeStore({ census: censusDoc() });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'hi', apiKey: 'sk-test',
      onEvent: () => {},
      deps: {
        ...baseDeps(store, {
          async streamChat() {},
          async streamChatWithTools(_m, _o, onEvent) {
            capture.args.onRemember('first draft');
            capture.args.onRemember('final draft');
            onEvent('done', {});
          },
        }),
        createToolCatalog: catalogCapturing(capture),
      },
    });
    assert.strictEqual(store.state.companion.notes, 'final draft');
  });

  test('an errored typed turn never persists its buffered playbook — the prior value is left intact', async () => {
    const capture = {};
    const store = fakeStore({ census: censusDoc(), companionState: { ...COMPANION_SEED_STATE, notes: 'prior playbook' } });
    await assert.rejects(() => runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'hi', apiKey: 'sk-test',
      onEvent: () => {},
      deps: {
        ...baseDeps(store, {
          async streamChat() {},
          async streamChatWithTools() {
            capture.args.onRemember('half-thought');
            throw new Error('boom');
          },
        }),
        createToolCatalog: catalogCapturing(capture),
      },
    }));
    assert.strictEqual(store.state.companion.notes, 'prior playbook');
    assert.strictEqual(store.state.advances.length, 0, 'no persist write was attempted for an errored turn');
  });

  test('the lease field already on the record is untouched by a typed turn\'s playbook write', async () => {
    const capture = {};
    const leaseUntil = new Date(Date.now() + 60_000).toISOString();
    const store = fakeStore({
      census: censusDoc(),
      companionState: { ...COMPANION_SEED_STATE, turnReservedUntil: leaseUntil, reservationId: 'some-other-reservation', notes: 'old' },
    });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'hi', apiKey: 'sk-test',
      onEvent: () => {},
      deps: {
        ...baseDeps(store, {
          async streamChat() {},
          async streamChatWithTools(_m, _o, onEvent) { capture.args.onRemember('new playbook'); onEvent('done', {}); },
        }),
        createToolCatalog: catalogCapturing(capture),
      },
    });
    assert.strictEqual(store.state.companion.notes, 'new playbook');
    assert.strictEqual(store.state.companion.turnReservedUntil, leaseUntil, 'a typed turn must never touch a lease it does not own');
    assert.strictEqual(store.state.companion.reservationId, 'some-other-reservation');
  });

  test('the next turn\'s system prompt contains a previously-persisted playbook verbatim', async () => {
    const store = fakeStore({ census: censusDoc(), companionState: { ...COMPANION_SEED_STATE, notes: 'lane G: confirm LIN-1988 at 08:00' } });
    let capturedMessages = null;
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'status?', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat() {},
        async streamChatWithTools(m, _o, onEvent) { capturedMessages = m; onEvent('done', {}); },
      }),
    });
    const systemMessage = capturedMessages[0];
    assert.strictEqual(systemMessage.role, 'system');
    assert.ok(systemMessage.content.includes('## Playbook'));
    assert.ok(systemMessage.content.includes('lane G: confirm LIN-1988 at 08:00'));
  });

  test('no playbook persisted yet renders no Playbook section at all', async () => {
    const store = fakeStore({ census: censusDoc() });
    let capturedMessages = null;
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'status?', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat() {},
        async streamChatWithTools(m, _o, onEvent) { capturedMessages = m; onEvent('done', {}); },
      }),
    });
    assert.ok(!capturedMessages[0].content.includes('## Playbook'));
  });

  test('review finding F1: an auto-wake commit never overwrites a newer playbook written mid-flight — it commits the FRESH read, not its own gate-time snapshot', async () => {
    const store = fakeStore({ census: censusDoc('hash-new') });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat(_m, _o, onEvent) { onEvent('done', {}); },
        async streamChatWithTools(_m, _o, onEvent) {
          // A DIFFERENT, overlapping typed turn persists a newer playbook
          // while this auto-wake turn's own model call is mid-flight — a
          // direct store mutation stands in for that concurrent write,
          // preserving the reservation fields this turn's own advance()
          // already wrote so the commit's `stillOurs` check still passes.
          store.state.companion = { ...store.state.companion, notes: 'fresh playbook written mid-flight' };
          onEvent('done', {});
        },
      }),
    });
    assert.strictEqual(store.state.companion.notes, 'fresh playbook written mid-flight');
  });

  test('an auto-wake turn that itself calls remember commits ITS OWN buffered value, not the fresh read', async () => {
    const capture = {};
    const store = fakeStore({ census: censusDoc('hash-new2') });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      deps: {
        ...baseDeps(store, {
          async streamChat(_m, _o, onEvent) { onEvent('done', {}); },
          async streamChatWithTools(_m, _o, onEvent) {
            capture.args.onRemember('buffered playbook from this very turn');
            // A stray concurrent write must NOT win over this turn's own buffer.
            store.state.companion = { ...store.state.companion, notes: 'some other fresh value' };
            onEvent('done', {});
          },
        }),
        createToolCatalog: catalogCapturing(capture),
      },
    });
    assert.strictEqual(store.state.companion.notes, 'buffered playbook from this very turn');
  });

  test('allowPlaybookWrite: false (the proxy shape) never enables the remember tool — no onRemember, playbookEnabled: false', async () => {
    const capture = {};
    const store = fakeStore({ census: censusDoc() });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'hi', apiKey: 'sk-test',
      allowPlaybookWrite: false,
      onEvent: () => {},
      deps: {
        ...baseDeps(store, scriptedClient([['done', {}]])),
        createToolCatalog: catalogCapturing(capture),
      },
    });
    assert.strictEqual(capture.args.playbookEnabled, false);
    assert.strictEqual(capture.args.onRemember, undefined);
  });

  test('a proxy-shaped call (suffixed instance + allowPlaybookWrite:false) reads the BROWSER\'s unsuffixed playbook, never a separate one keyed by its own suffix', async () => {
    const store = multiKeyStore({
      'companion:v1:acme': { ...COMPANION_SEED_STATE, notes: 'browser playbook' },
      'sweep:v1:acme': censusDoc(),
    });
    let capturedMessages = null;
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'user-initiated', message: 'hi', apiKey: 'sk-test',
      instanceKeySuffix: ':proxy', allowPlaybookWrite: false,
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat() {},
        async streamChatWithTools(m, _o, onEvent) { capturedMessages = m; onEvent('done', {}); },
      }),
    });
    assert.ok(capturedMessages[0].content.includes('browser playbook'));
    // And no write of any kind was attempted against either instance key.
    assert.strictEqual(store.advances.length, 0);
  });
});

// LIN-2622 beat 2: the boot turn's seam. A boot skips shouldSpendTurn's
// refusal chain (no-census/hash-identical/floor/no-delta) — a human asked for
// this turn — but not the reservation protocol: it calls buildTurnRecords
// DIRECTLY, exactly the shared record producer LIN-2631 extracted for this.
// The adversarial set (boot-vs-auto-wake race, commit-only-after-done,
// no-commit-on-error/disconnect, the propose->execute mutation witness) is
// beat 3 and deliberately not pulled forward here.
describe('LIN-2622: the boot turn reserves via buildTurnRecords directly', () => {
  test('a boot turn reserves BEFORE the model call, with a lease derived from its OWN budget', async () => {
    const store = fakeStore({ census: censusDoc() });
    const order = [];
    const originalAdvance = store.advance.bind(store);
    store.advance = async (...args) => { order.push('advance'); return originalAdvance(...args); };

    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat(_m, o, onEvent) { order.push('model'); onEvent('done', {}); },
        async streamChatWithTools(_m, o, onEvent) { order.push('model'); onEvent('done', {}); },
      }),
    });

    assert.strictEqual(out.spent, true);
    // The commit write (a THIRD 'advance', after 'done') trails these two —
    // sliced off here since this test is about ordering the RESERVATION
    // ahead of the model call, not about how many advances a full turn makes.
    assert.deepStrictEqual(order.slice(0, 2), ['advance', 'model'], 'the reservation must be written before the model call runs');

    const reserveAdvance = store.state.advances.find((a) => a.meta?.reason === 'flight-companion-turn');
    assert.ok(reserveAdvance, 'expected exactly one reservation write, keyed the same as the auto-wake path');
    // deriveReservationLeaseMs(5) off the boot's own budget, never the
    // default (auto-wake calls this with NO explicit maxIterations, which
    // would derive a different lease for a smaller budget).
    const expectedUntil = new Date(baseDeps(store).now() + deriveReservationLeaseMs(5)).toISOString();
    assert.strictEqual(reserveAdvance.record.turnReservedUntil, expectedUntil);
  });

  test('a boot turn still spends against a hash-identical census — auto-wake would refuse it, boot must not', async () => {
    const census = censusDoc('same-hash');
    const companionState = {
      v: 1,
      lastCensusStateHash: 'same-hash',
      lastCensusSnapshot: buildCompanionSnapshot(census),
      lastTurnAt: new Date(1_699_000_000_000).toISOString(),
      turnReservedUntil: null,
      reservationId: null,
      notes: '',
    };
    const store = fakeStore({ census, companionState });

    // Sanity check: the SAME store/census would refuse an auto-wake turn.
    const autoWakeOut = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'auto-wake', apiKey: 'sk-test',
      onEvent: () => {},
      deps: baseDeps(store, scriptedClient([['done', {}]])),
    });
    assert.strictEqual(autoWakeOut.spent, false);
    assert.strictEqual(autoWakeOut.reason, 'hash-identical');

    // A fresh store (the auto-wake call above may have touched nothing, but
    // isolate anyway) for the actual boot assertion.
    const bootStore = fakeStore({ census, companionState });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(bootStore, scriptedClient([['done', {}]])),
    });
    assert.strictEqual(out.spent, true, 'a boot must not be refused by hash-identical, unlike auto-wake');
    const reservationAdvances = bootStore.state.advances.filter((a) => a.meta?.reason === 'flight-companion-turn');
    assert.strictEqual(reservationAdvances.length, 1, 'the reservation must still be written, not skipped');
  });

  test('a boot turn with no sweep yet skips reservation entirely rather than calling buildTurnRecords blind', async () => {
    const store = fakeStore({ census: null });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(store, scriptedClient([['done', {}]])),
    });
    assert.strictEqual(out.spent, true, 'a boot with no sweep yet must still orient (the model call still runs)');
    assert.strictEqual(store.state.advances.length, 0, 'nothing to reserve against — no advance call at all');
  });

  test('the boot turn\'s own budget (maxTokens 2500) reaches the model call', async () => {
    const store = fakeStore({ census: censusDoc() });
    let capturedOptions = null;
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat(_m, o, onEvent) { capturedOptions = o; onEvent('done', {}); },
        async streamChatWithTools(_m, o, onEvent) { capturedOptions = o; onEvent('done', {}); },
      }),
    });
    assert.strictEqual(out.spent, true);
    assert.ok(capturedOptions);
    assert.strictEqual(capturedOptions.maxTokens, 2500);
    if ('maxIterations' in capturedOptions) {
      assert.strictEqual(capturedOptions.maxIterations, 5);
    }
  });
});

// LIN-2622 beat 3: the adversarial set beat 2 deliberately left — the
// boot-vs-auto-wake race, commit-only-after-`done`, and the commit scoped to
// its own reservation, each re-proven with a BOOT turn on one or both sides
// rather than inherited by assertion from the auto-wake-only coverage above.
describe('LIN-2622 beat 3: boot racing an auto-wake never clears the other\'s lease', () => {
  // Barrier at ensureSeeded — the FIRST store call on EITHER path (boot's own
  // branch and the auto-wake branch both call it first) — forces both turns
  // to read the SAME pre-race rev before either proceeds, mirroring the
  // route-level barrier-forced overlap test (flight-companion-turn-route
  // .test.js, LIN-2442 witness (b)) but for two DIFFERENT turn kinds sharing
  // one store rather than two of the same kind.
  function barrierAtEnsureSeeded(store) {
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
    return store;
  }

  async function runRace(firstKind, secondKind) {
    const store = barrierAtEnsureSeeded(fakeStore({ census: censusDoc('hash-race') }));
    const modelCalls = [];
    const chatClient = {
      async streamChat(_m, _o, onEvent) { modelCalls.push('call'); onEvent('done', {}); },
      async streamChatWithTools(_m, _o, onEvent) { modelCalls.push('call'); onEvent('done', {}); },
    };
    const runOne = (turnKind) => runFlightCompanionTurn({
      workspace: WORKSPACE,
      turnKind,
      message: turnKind === 'boot' ? 'Start' : null,
      apiKey: 'sk-test',
      followUpMode: turnKind === 'boot' ? 'propose' : undefined,
      budget: turnKind === 'boot' ? { maxIterations: 5, maxTokens: 2500 } : {},
      onEvent: () => {},
      deps: baseDeps(store, chatClient),
    });

    // Both calls are started synchronously (before either awaits anything),
    // so `firstKind`'s continuation is registered on the shared barrier
    // before `secondKind`'s — and both paths take an IDENTICAL number of
    // awaits between the barrier and their own reservation `advance()` call
    // (ensureSeeded -> readCurrent -> advance, for both a boot and an
    // auto-wake), so `firstKind` consistently reaches `advance()` first and
    // wins the CAS. Asserted below on the OUTCOME (which result reports
    // `spent`), not assumed silently.
    const [r1, r2] = await Promise.all([runOne(firstKind), runOne(secondKind)]);
    return { r1, r2, store, modelCalls };
  }

  // Neither chatClient fake here pauses (unlike the "late commit" tests
  // below, which use a `held` promise to freeze completion deliberately) —
  // both turns run to natural completion inside the same `Promise.all`, so
  // by the time we inspect `store.state`, the WINNER has also committed
  // normally (its own lease cleared to null, exactly as an uninterrupted
  // turn's own commit always does — see "an uninterrupted boot turn does
  // commit its new baseline" above). The property this test actually proves
  // is narrower and load-bearing regardless: the LOSER's failed reservation
  // CAS must leave the final state exactly as if the loser had never run at
  // all — the winner's own commit, undisturbed.
  test('boot started first wins the reservation; the overlapping auto-wake loses cleanly and never disturbs the winner\'s own commit', async () => {
    const { r1, r2, store, modelCalls } = await runRace('boot', 'auto-wake');
    assert.strictEqual(r1.spent, true, 'boot (started first) must win the race');
    assert.strictEqual(r2.spent, false, 'the overlapping auto-wake must lose');
    assert.strictEqual(r2.reason, 'lost-race');
    assert.strictEqual(modelCalls.length, 1, 'the loser must never reach the model call — no second billable spend');
    assert.strictEqual(store.state.companion.lastCensusStateHash, 'hash-race', 'the winner\'s own baseline must have committed cleanly');
    assert.strictEqual(store.state.companion.turnReservedUntil, null, 'the winner\'s own commit clears its own lease normally — the loser must not have left anything behind');
    assert.strictEqual(store.state.companion.reservationId, null);
    const reservationAdvances = store.state.advances.filter((a) => a.meta?.reason === 'flight-companion-turn');
    assert.strictEqual(reservationAdvances.length, 2, 'both the winner\'s and the loser\'s reservation ATTEMPTS are recorded — only one of them actually landed');
  });

  test('auto-wake started first wins the reservation; the overlapping boot loses cleanly and never disturbs the winner\'s own commit', async () => {
    const { r1, r2, store, modelCalls } = await runRace('auto-wake', 'boot');
    assert.strictEqual(r1.spent, true, 'auto-wake (started first) must win the race');
    assert.strictEqual(r2.spent, false, 'the overlapping boot must lose');
    assert.strictEqual(r2.reason, 'lost-race');
    assert.strictEqual(modelCalls.length, 1, 'the loser must never reach the model call — no second billable spend');
    assert.strictEqual(store.state.companion.lastCensusStateHash, 'hash-race', 'the winner\'s own baseline must have committed cleanly');
    assert.strictEqual(store.state.companion.turnReservedUntil, null, 'the winner\'s own commit clears its own lease normally — the loser must not have left anything behind');
    assert.strictEqual(store.state.companion.reservationId, null);
    const reservationAdvances = store.state.advances.filter((a) => a.meta?.reason === 'flight-companion-turn');
    assert.strictEqual(reservationAdvances.length, 2, 'both the winner\'s and the loser\'s reservation ATTEMPTS are recorded — only one of them actually landed');
  });
});

describe('LIN-2622 beat 3: a boot turn commits only after done, never on error or disconnect', () => {
  test('a disconnected client leaves the delta unconsumed on a boot turn too (LIN-2449 applies here)', async () => {
    const store = fakeStore({ census: censusDoc('hash-new') });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      isClientGone: () => true,
      deps: baseDeps(store, scriptedClient([['done', { finishReason: 'stop' }]])),
    });
    // The reservation landed, but the baseline did NOT move — the next turn
    // re-surfaces the same change rather than losing it.
    assert.notStrictEqual(store.state.companion.lastCensusStateHash, 'hash-new');
    assert.ok(store.state.companion.turnReservedUntil, 'the lease self-expires rather than being released');
  });

  test('a model-call error mid-turn means no commit on a boot turn (the reservation self-expires instead)', async () => {
    const store = fakeStore({ census: censusDoc('hash-error') });
    await assert.rejects(() => runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat() { throw new Error('simulated model failure mid-turn'); },
        async streamChatWithTools() { throw new Error('simulated model failure mid-turn'); },
      }),
    }));
    assert.notStrictEqual(store.state.companion.lastCensusStateHash, 'hash-error', 'a mid-turn throw must never reach the commit');
    assert.ok(store.state.companion.turnReservedUntil, 'the lease self-expires rather than being released on a throw');
  });

  test('no terminal done frame means no commit on a boot turn either', async () => {
    const store = fakeStore({ census: censusDoc('hash-new') });
    await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(store, scriptedClient([['token', { token: 'partial' }]])),
    });
    assert.notStrictEqual(store.state.companion.lastCensusStateHash, 'hash-new');
  });
});

describe('LIN-2622 beat 3: a boot turn\'s commit is scoped to its own reservation (LIN-2447 direction 2)', () => {
  test('a late commit from a BOOT turn never clears a successor\'s live lease', async () => {
    const store = fakeStore({ census: censusDoc('hash-A') });
    let released;
    const held = new Promise((r) => { released = r; });

    const bootTurn = runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(store, {
        async streamChat(_m, _o, onEvent) { await held; onEvent('done', {}); },
        async streamChatWithTools(_m, _o, onEvent) { await held; onEvent('done', {}); },
      }),
    });

    // While the boot is mid-stream, a successor reserves: overwrite the
    // stored record with its own live reservation, exactly as a real
    // overlapping auto-wake's own advance() would.
    await new Promise((r) => setImmediate(r));
    const bLease = new Date(Date.now() + 900_000).toISOString();
    store.state.companion = {
      v: 1, lastCensusStateHash: 'hash-B', lastCensusSnapshot: {},
      lastTurnAt: new Date().toISOString(), turnReservedUntil: bLease,
      reservationId: 'reservation-B', notes: '',
    };
    store.state.rev += 1;

    released();
    await bootTurn;

    // The successor's record is untouched: its lease still live, its
    // baseline still its own.
    assert.strictEqual(store.state.companion.reservationId, 'reservation-B');
    assert.strictEqual(store.state.companion.turnReservedUntil, bLease, 'the boot must not have cleared the successor\'s lease');
    assert.strictEqual(store.state.companion.lastCensusStateHash, 'hash-B', 'the boot must not have written its stale baseline over the successor\'s');
    // And the skip is a skip, not a failed write: no commit advance was issued.
    const commits = store.state.advances.filter((a) => a.meta?.reason === 'flight-companion-commit');
    assert.strictEqual(commits.length, 0, 'the commit must be SKIPPED, not attempted and lost');
  });

  test('an uninterrupted boot turn does commit its new baseline', async () => {
    // The other half — without this, the test above would pass on a boot
    // path that never commits at all.
    const store = fakeStore({ census: censusDoc('hash-new') });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: baseDeps(store, scriptedClient([['done', { finishReason: 'stop' }]])),
    });
    assert.strictEqual(out.spent, true);
    assert.strictEqual(store.state.companion.lastCensusStateHash, 'hash-new');
    assert.strictEqual(store.state.companion.turnReservedUntil, null, 'the commit clears the lease');
    assert.strictEqual(store.state.companion.reservationId, null);
  });
});

describe('LIN-2622 beat 3: propose-only, wired all the way to the tool catalog', () => {
  test('the boot core is handed followUpMode as given — proving the wiring the route\'s hardcoded literal depends on', async () => {
    // This proves the CORE half of the propose-only contract: whatever
    // followUpMode the caller passes really does reach createToolCatalog
    // unchanged, which is what makes the ROUTE's hardcoded 'propose' literal
    // (tests/unit/flight-companion-boot-route.test.js's own mutation-style
    // assertion, capturing the SAME opts.followUpMode) meaningful rather than
    // a value nothing downstream reads.
    let captured = null;
    const store = fakeStore({ census: censusDoc() });
    const out = await runFlightCompanionTurn({
      workspace: WORKSPACE, turnKind: 'boot', message: 'Start', apiKey: 'sk-test',
      followUpMode: 'propose', budget: { maxIterations: 5, maxTokens: 2500 },
      onEvent: () => {},
      deps: {
        ...baseDeps(store, scriptedClient([['done', {}]])),
        createToolCatalog: (opts) => { captured = opts.followUpMode; return { tools: [], executeTool: async () => ({}) }; },
      },
    });
    assert.strictEqual(out.spent, true);
    assert.strictEqual(captured, 'propose');
  });
});
