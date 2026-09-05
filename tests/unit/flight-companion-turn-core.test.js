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

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { runFlightCompanionTurn, sumUsage } from '../../lib/flight-companion-turn.js';

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
