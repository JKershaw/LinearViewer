/**
 * Unit tests for lib/observer-pass.js (LIN-2395, P2-1 of the LIN-2114
 * observer-harness epic).
 *
 * Run with: node --test tests/unit/observer-pass.test.js
 *
 * Coverage:
 *   A. Pure helpers — resolveAuthorityStamp, assessQuietPath, parseObserverPassResponse.
 *   B. runObserverPass — against a REAL MangoDB tmpdir ObserverStateStore
 *      (same precedent as tests/unit/observer-sweep.test.js / observer-state-store.test.js):
 *      memory read-back, deterministic quiet behaviour (no census / empty
 *      fleet / unchanged census), report-to-census reconciliation, staleness
 *      visibility, authority OFF/default and ON-still-report-only, and
 *      negative-capability + network guards.
 *   C. createObserverPassRun — the production tick closure (round-robin,
 *      fail-soft, misconfigured intervalMs, deps.now guard) — mirrors
 *      observer-sweep.test.js's section F for createObserverSweepRun.
 *   D. Static import assertion.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MangoClient } from '@jkershaw/mangodb';

import {
  resolveAuthorityStamp,
  assessQuietPath,
  parseObserverPassResponse,
  buildPassMessages,
  runObserverPass,
  createObserverPassRun,
  PASS_INSTANCE_PREFIX
} from '../../lib/observer-pass.js';
import { ObserverStateStore } from '../../lib/observer-state-store.js';
import { guardNetwork } from '../fixtures/network-guard.js';

// ─── A. Pure helpers ─────────────────────────────────────────────────────

describe('observer-pass: resolveAuthorityStamp', () => {
  test('true -> on-unimplemented, everything else -> off', () => {
    assert.strictEqual(resolveAuthorityStamp(true), 'on-unimplemented');
    assert.strictEqual(resolveAuthorityStamp(false), 'off');
    assert.strictEqual(resolveAuthorityStamp(undefined), 'off');
    assert.strictEqual(resolveAuthorityStamp(null), 'off');
  });
});

describe('observer-pass: assessQuietPath', () => {
  const nonEmptyLanes = { working: 1, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 };
  const emptyLanes = { working: 0, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 };

  test('no census doc at all -> quiet, reason no-census', () => {
    assert.deepStrictEqual(assessQuietPath({ censusDoc: null, lastCensusStateHash: null }), { quiet: true, reason: 'no-census' });
  });

  test('census with every lane at zero -> quiet, reason empty-fleet', () => {
    const censusDoc = { state: { lanes: emptyLanes }, stateHash: 'h1' };
    assert.deepStrictEqual(assessQuietPath({ censusDoc, lastCensusStateHash: null }), { quiet: true, reason: 'empty-fleet' });
  });

  test('census unchanged since the last pass (same stateHash) -> quiet, reason unchanged', () => {
    const censusDoc = { state: { lanes: nonEmptyLanes }, stateHash: 'h1' };
    assert.deepStrictEqual(assessQuietPath({ censusDoc, lastCensusStateHash: 'h1' }), { quiet: true, reason: 'unchanged' });
  });

  test('non-empty census with a different (or first-ever) hash -> NOT quiet', () => {
    const censusDoc = { state: { lanes: nonEmptyLanes }, stateHash: 'h2' };
    assert.deepStrictEqual(assessQuietPath({ censusDoc, lastCensusStateHash: 'h1' }), { quiet: false, reason: null });
    assert.deepStrictEqual(assessQuietPath({ censusDoc, lastCensusStateHash: null }), { quiet: false, reason: null });
  });
});

describe('observer-pass: parseObserverPassResponse — numeric grounding by construction', () => {
  test('reads ONLY narrative/flags — a numeric field the model might invent is never read at all', () => {
    const raw = JSON.stringify({ narrative: 'Two loops are blocked.', flags: ['blocked-cluster'], lanes: { blocked: 999 }, totalLoops: 42 });
    const result = parseObserverPassResponse(raw);
    assert.strictEqual(result.narrative, 'Two loops are blocked.');
    assert.deepStrictEqual(result.flags, ['blocked-cluster']);
    assert.strictEqual(result.degraded, null);
    assert.ok(!('lanes' in result), 'no numeric/lane field from the model reply is ever surfaced by the parser');
    assert.ok(!('totalLoops' in result));
  });

  test('tolerates a fenced code block around the JSON', () => {
    const raw = '```json\n' + JSON.stringify({ narrative: 'ok', flags: [] }) + '\n```';
    assert.deepStrictEqual(parseObserverPassResponse(raw), { narrative: 'ok', flags: [], degraded: null });
  });

  test('unparseable text degrades honestly rather than throwing or fabricating', () => {
    const result = parseObserverPassResponse('not json at all');
    assert.strictEqual(result.narrative, null);
    assert.deepStrictEqual(result.degraded, { reason: 'unparseable' });
  });

  test('valid JSON with no usable narrative degrades with reason missing-narrative', () => {
    const result = parseObserverPassResponse(JSON.stringify({ narrative: '', flags: ['x'] }));
    assert.strictEqual(result.narrative, null);
    assert.deepStrictEqual(result.degraded, { reason: 'missing-narrative' });
  });

  test('flags are deduped and sorted deterministically', () => {
    const raw = JSON.stringify({ narrative: 'ok', flags: ['zeta', 'alpha', 'alpha'] });
    assert.deepStrictEqual(parseObserverPassResponse(raw).flags, ['alpha', 'zeta']);
  });
});

describe('observer-pass: buildPassMessages', () => {
  test('carries the census own updatedAt/rev through untouched, and includes the prior summary for continuity', () => {
    const censusDoc = {
      rev: 3,
      updatedAt: new Date('2026-08-30T06:00:00.000Z'),
      state: {
        lanes: { working: 1, silent: 0, blocked: 1, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
        attention: [{ loopId: 'l1', issue: 'LIN-1', lane: 'blocked', stage: 'implement', since: '2026-08-30T05:00:00.000Z' }],
        truncated: false
      }
    };
    const messages = buildPassMessages({ censusDoc, priorSummary: 'Previously: all quiet.' });
    const userMsg = messages.find((m) => m.role === 'user').content;
    assert.match(userMsg, /2026-08-30T06:00:00\.000Z/, 'the census own updatedAt is carried through, not re-derived');
    assert.match(userMsg, /revision 3/);
    assert.match(userMsg, /LIN-1/);
    assert.match(userMsg, /Previously: all quiet\./, 'pass 2 must see pass 1\'s own summary for continuity');
    const systemMsg = messages.find((m) => m.role === 'system').content;
    assert.match(systemMsg, /never invent/i);
  });
});

// ─── B. runObserverPass — real MangoDB tmpdir ──────────────────────────────

describe('observer-pass: runObserverPass', () => {
  let dbDir;
  let client;
  let counter = 0;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'observer-pass-'));
    client = new MangoClient(dbDir);
    await client.connect();
  });

  after(async () => {
    if (client?.close) await client.close();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  });

  function freshStore() {
    const db = client.db(`op_${counter++}`);
    return new ObserverStateStore({ collection: db.collection('observer-state') });
  }

  function fakeWorkspacePreferencesStore(prefs = {}) {
    return { getWorkspacePreferences: async () => prefs };
  }

  const nonEmptyCensus = {
    v: 1,
    lanes: { working: 2, silent: 0, blocked: 1, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
    attention: [{ loopId: 'loop-1', issue: 'LIN-100', lane: 'blocked', stage: 'implement', since: new Date().toISOString() }],
    truncated: false
  };
  const emptyCensus = {
    v: 1,
    lanes: { working: 0, silent: 0, blocked: 0, terminal: 0, queued: 0, resolved: 0, unknown: 0 },
    attention: [],
    truncated: false
  };

  test('no sweep census yet -> deterministic quiet report, no LLM caller injected at all, no write beyond this instance', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-nocensus-${randomUUID()}`;
    const net = guardNetwork();

    const result = await runObserverPass(urlKey, {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      now: Date.now()
      // Deliberately no streamChatWithTools/getPaidEnvKey injected — the
      // quiet path must never even look for them.
    });

    assert.strictEqual(net.attempts.length, 0);
    net.restore();
    assert.strictEqual(result.quiet, true);
    assert.strictEqual(result.authority, 'off');

    const doc = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);
    assert.ok(doc, 'the pass instance must exist — ensureSeeded runs every tick');
    assert.match(doc.state.report.narrative, /No fleet census/);
    assert.deepStrictEqual(doc.state.report.lanes, {}, 'no census -> no lane numbers to report');
  });

  test('empty fleet census -> quiet report, no LLM call', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-empty-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKey}`, emptyCensus);

    const net = guardNetwork();
    const result = await runObserverPass(urlKey, {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      now: Date.now()
    });
    assert.strictEqual(net.attempts.length, 0);
    net.restore();

    assert.strictEqual(result.quiet, true);
    const doc = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);
    assert.match(doc.state.report.narrative, /census is empty/);
    assert.deepStrictEqual(doc.state.report.lanes, emptyCensus.lanes);
  });

  test('non-empty, never-before-observed census -> calls the injected LLM seam; report.lanes reconciles EXACTLY with the census, never the model', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-real-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKey}`, nonEmptyCensus);

    const calls = [];
    const fakeStreamChatWithTools = async (messages, options, onEvent) => {
      calls.push({ messages, options });
      // The model tries to sneak in numeric lane counts and an invented
      // extra field — parseObserverPassResponse must never surface them.
      onEvent('token', { token: JSON.stringify({ narrative: 'Two loops working, one blocked on a decision.', flags: ['blocked-cluster'], lanes: { blocked: 999 } }) });
      onEvent('done', { finishReason: 'stop' });
    };

    const net = guardNetwork();
    const result = await runObserverPass(urlKey, {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      streamChatWithTools: fakeStreamChatWithTools,
      getPaidEnvKey: () => 'fake-key',
      now: Date.now()
    });
    assert.strictEqual(net.attempts.length, 0, 'the LLM seam is injected/fake — nothing here may touch the real network');
    net.restore();

    assert.strictEqual(result.quiet, false);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].options.callMeta.feature, 'observer-pass', 'callMeta.feature must be the exact literal so cost dashboards can isolate this pass');
    assert.strictEqual(calls[0].options.callMeta.urlKey, urlKey);
    assert.deepStrictEqual(calls[0].options.tools, [], 'P2-1 offers no tools');

    const doc = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);
    assert.deepStrictEqual(doc.state.report.lanes, nonEmptyCensus.lanes, 'lanes are the census\'s own numbers, verbatim — never the model\'s invented 999');
    assert.strictEqual(doc.state.report.narrative, 'Two loops working, one blocked on a decision.');
    assert.deepStrictEqual(doc.state.report.flags, ['blocked-cluster']);
    assert.strictEqual(doc.state.report.censusRev, 1);
    assert.ok(doc.state.report.censusGroundedAt, 'the census own updatedAt is carried through as the grounding stamp');
  });

  test('two consecutive passes: an UNCHANGED census on tick 2 takes the quiet path (no second LLM call), preserves the prior substantive report/summary verbatim, and is a clean no-op; a THIRD unchanged tick does not manufacture yet another transition', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-two-unchanged-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKey}`, nonEmptyCensus);

    let callCount = 0;
    const fakeStreamChatWithTools = async (messages, options, onEvent) => {
      callCount += 1;
      onEvent('token', { token: JSON.stringify({ narrative: 'Steady state.', flags: [] }) });
      onEvent('done', { finishReason: 'stop' });
    };
    const deps = {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      streamChatWithTools: fakeStreamChatWithTools,
      getPaidEnvKey: () => 'fake-key'
    };

    await runObserverPass(urlKey, { ...deps, now: Date.now() });
    assert.strictEqual(callCount, 1);
    const afterFirst = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);

    const net = guardNetwork();
    const secondResult = await runObserverPass(urlKey, { ...deps, now: Date.now() + 1000 });
    assert.strictEqual(net.attempts.length, 0);
    net.restore();

    assert.strictEqual(callCount, 1, 'the census did not change — the second tick must not call the LLM again');
    assert.strictEqual(secondResult.quiet, true);
    const afterSecond = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);
    // LIN-2405: an `unchanged` quiet tick must NOT clobber the last
    // substantive report/summary with the generic quiet placeholder — it
    // carries the prior tick's report/summary forward verbatim, so the
    // resulting state is byte-identical and advance()'s dedup-by-stateHash
    // gate makes this a true no-op (rev does NOT advance).
    assert.strictEqual(afterSecond.rev, afterFirst.rev, 'a genuinely no-op unchanged tick must not manufacture a transition');
    assert.strictEqual(afterSecond.state.report.narrative, afterFirst.state.report.narrative, 'the real narrative survives an unchanged tick');
    assert.strictEqual(afterSecond.state.summary, afterFirst.state.summary, 'the real summary survives an unchanged tick');
    assert.notStrictEqual(afterSecond.state.report.narrative, 'No change in the fleet census since the last observation pass.', 'the generic quiet placeholder must not overwrite the real narrative');

    const thirdResult = await runObserverPass(urlKey, { ...deps, now: Date.now() + 2000 });
    assert.strictEqual(callCount, 1, 'still no LLM call on the third unchanged tick');
    assert.strictEqual(thirdResult.quiet, true);
    const afterThird = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);
    assert.strictEqual(afterThird.rev, afterSecond.rev, 'two consecutive byte-identical quiet reports must not manufacture a fresh transition');
  });

  test('two consecutive passes: a CHANGED census on tick 2 calls the LLM again, and its prompt context carries pass 1\'s own summary', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-two-changed-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKey}`, nonEmptyCensus);

    const seenMessages = [];
    const fakeStreamChatWithTools = async (messages, options, onEvent) => {
      seenMessages.push(messages);
      onEvent('token', { token: JSON.stringify({ narrative: `Observation #${seenMessages.length}.`, flags: [] }) });
      onEvent('done', { finishReason: 'stop' });
    };
    const deps = {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      streamChatWithTools: fakeStreamChatWithTools,
      getPaidEnvKey: () => 'fake-key'
    };

    await runObserverPass(urlKey, { ...deps, now: Date.now() });
    const afterFirst = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);

    // A genuinely different census (a new attention row) — the sweep would
    // write this via its own advance(); we drive it directly here.
    const changedCensus = { ...nonEmptyCensus, lanes: { ...nonEmptyCensus.lanes, working: 3 } };
    const sweepDoc = await observerStateStore.readCurrent(`sweep:v1:${urlKey}`);
    await observerStateStore.advance(`sweep:v1:${urlKey}`, sweepDoc.rev, changedCensus, { reason: 'sweep' });

    await runObserverPass(urlKey, { ...deps, now: Date.now() + 1000 });
    const afterSecond = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);

    assert.strictEqual(seenMessages.length, 2, 'a genuinely changed census must trigger a second LLM call');
    assert.notStrictEqual(afterSecond.rev, afterFirst.rev, 'a genuine transition must advance rev');

    const secondUserMsg = seenMessages[1].find((m) => m.role === 'user').content;
    assert.match(secondUserMsg, /Observation #1\./, "pass 2's own LLM input must carry pass 1's summary — the read-side continuity the write-only tests would miss");
  });

  test('authority default OFF vs ON: writes are otherwise identical — only the stamp differs, and ON is still report-only', async () => {
    const observerStateStore = freshStore();
    const urlKeyOff = `ws-auth-off-${randomUUID()}`;
    const urlKeyOn = `ws-auth-on-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKeyOff}`, nonEmptyCensus);
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKeyOn}`, nonEmptyCensus);

    const fakeStreamChatWithTools = async (messages, options, onEvent) => {
      onEvent('token', { token: JSON.stringify({ narrative: 'Same narrative either way.', flags: [] }) });
      onEvent('done', { finishReason: 'stop' });
    };
    const baseDeps = {
      observerStateStore,
      streamChatWithTools: fakeStreamChatWithTools,
      getPaidEnvKey: () => 'fake-key'
    };

    const resultOff = await runObserverPass(urlKeyOff, { ...baseDeps, workspacePreferencesStore: fakeWorkspacePreferencesStore({ features: { observerAuthority: false } }), now: Date.now() });
    const resultOn = await runObserverPass(urlKeyOn, { ...baseDeps, workspacePreferencesStore: fakeWorkspacePreferencesStore({ features: { observerAuthority: true } }), now: Date.now() });

    assert.strictEqual(resultOff.authority, 'off');
    assert.strictEqual(resultOn.authority, 'on-unimplemented');

    const docOff = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKeyOff}`);
    const docOn = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKeyOn}`);
    // Same everything except the authority stamp — proves ON has no acting
    // branch: the report/summary/lanes/flags are identical either way.
    assert.strictEqual(docOff.state.report.narrative, docOn.state.report.narrative);
    assert.deepStrictEqual(docOff.state.report.lanes, docOn.state.report.lanes);
    assert.strictEqual(docOff.state.authority, 'off');
    assert.strictEqual(docOn.state.authority, 'on-unimplemented');
  });

  test('missing observerAuthority default resolves the same as an explicit false (default-OFF path)', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-auth-default-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKey}`, emptyCensus);
    const result = await runObserverPass(urlKey, {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore({}), // no `features` key at all
      now: Date.now()
    });
    assert.strictEqual(result.authority, 'off');
  });

  test('ensureSeeded is called every tick, independent of whether advance() actually wrote anything (retention liveness)', async () => {
    const realStore = freshStore();
    const urlKey = `ws-liveness-${randomUUID()}`;
    await realStore.ensureSeeded(`sweep:v1:${urlKey}`, emptyCensus);

    let ensureSeededCalls = 0;
    const spyStore = {
      ensureSeeded: (...args) => { ensureSeededCalls += 1; return realStore.ensureSeeded(...args); },
      readCurrent: (...args) => realStore.readCurrent(...args),
      advance: (...args) => realStore.advance(...args)
    };
    const deps = { observerStateStore: spyStore, workspacePreferencesStore: fakeWorkspacePreferencesStore() };

    for (let tick = 0; tick < 3; tick++) {
      await runObserverPass(urlKey, { ...deps, now: Date.now() + tick });
    }
    assert.strictEqual(ensureSeededCalls, 3, 'ensureSeeded must run on every tick, including every quiet no-op tick');
  });

  test('LIN-2412 F1: getPaidEnvKey is genuinely awaited — a deliberately async, single-arg fake that resolves after a timer tick still reaches the model call and the resolved (not Promise) apiKey', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-async-key-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKey}`, nonEmptyCensus);

    const seenApiKeys = [];
    const seenUrlKeys = [];
    // Deliberately async AND single-arg — a regression back to a sync,
    // zero-arg treatment (the pre-LIN-2412 shape) must fail this test: it
    // would receive `undefined` for urlKey and pass a Promise object as
    // apiKey to streamChatWithTools instead of the resolved string below.
    const asyncGetPaidEnvKey = (calledUrlKey) => {
      seenUrlKeys.push(calledUrlKey);
      return new Promise((resolve) => setTimeout(() => resolve('resolved-async-key'), 5));
    };
    const fakeStreamChatWithTools = async (messages, options, onEvent) => {
      seenApiKeys.push(options.apiKey);
      onEvent('token', { token: JSON.stringify({ narrative: 'Reached the model with a resolved key.', flags: [] }) });
      onEvent('done', { finishReason: 'stop' });
    };

    const result = await runObserverPass(urlKey, {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      streamChatWithTools: fakeStreamChatWithTools,
      getPaidEnvKey: asyncGetPaidEnvKey,
      now: Date.now()
    });

    assert.deepStrictEqual(seenUrlKeys, [urlKey], 'getPaidEnvKey must be called with the tick\'s own urlKey');
    assert.strictEqual(seenApiKeys.length, 1, 'the model must actually be called — proves the await did not skip past it');
    assert.strictEqual(seenApiKeys[0], 'resolved-async-key', 'apiKey must be the AWAITED string, never a Promise object');
    assert.strictEqual(result.quiet, false);
  });

  test('LIN-2412 F1: a resolver that resolves to null (async miss) still reaches the llm-unavailable degrade — an un-awaited Promise (truthy) would wrongly let this call through', async () => {
    const observerStateStore = freshStore();
    const urlKey = `ws-async-miss-${randomUUID()}`;
    await observerStateStore.ensureSeeded(`sweep:v1:${urlKey}`, nonEmptyCensus);

    // A real streamChatWithTools IS injected here (unlike the "no caller at
    // all" quiet-degrade cases above) specifically so this test can only pass
    // by way of the awaited apiKey being null — an un-awaited call would hand
    // this fake a truthy Promise object as apiKey and call it regardless.
    const modelCalls = [];
    const fakeStreamChatWithTools = async (messages, options, onEvent) => {
      modelCalls.push(options.apiKey);
      onEvent('token', { token: JSON.stringify({ narrative: 'should not be reached', flags: [] }) });
      onEvent('done', { finishReason: 'stop' });
    };

    const net = guardNetwork();
    const result = await runObserverPass(urlKey, {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      streamChatWithTools: fakeStreamChatWithTools,
      getPaidEnvKey: (calledUrlKey) => new Promise((resolve) => setTimeout(() => resolve(null), 5)),
      now: Date.now()
    });
    assert.strictEqual(net.attempts.length, 0);
    net.restore();

    assert.strictEqual(modelCalls.length, 0, 'the model must NOT be called when the awaited key resolves to null');
    assert.strictEqual(result.quiet, false);
    const doc = await observerStateStore.readCurrent(`${PASS_INSTANCE_PREFIX}${urlKey}`);
    assert.deepStrictEqual(doc.state.report.degraded, { reason: 'llm-unavailable' }, 'a resolved-null key must still degrade honestly, exactly as a synchronous miss would');
  });

  test('deps.now is required — a missing/non-finite clock is refused loudly BEFORE any write, never persisted as a wrong diagnosis', async () => {
    const observerStateStore = freshStore();
    for (const bad of [undefined, null, NaN, '123']) {
      await assert.rejects(
        () => runObserverPass('ws', { observerStateStore, workspacePreferencesStore: fakeWorkspacePreferencesStore(), now: bad }),
        /deps\.now \(epoch ms\) is required/
      );
    }
  });

  test('negative capability: run entirely through a read-only-allowlisted Proxy over observerStateStore, plus guardNetwork on the fake-LLM path', async () => {
    function forbiddenProxy(target, allowedMethods, label) {
      return new Proxy(target, {
        get(obj, prop, receiver) {
          if (typeof prop === 'symbol' || prop === 'then') return Reflect.get(obj, prop, receiver);
          if (allowedMethods.includes(prop)) {
            const value = Reflect.get(obj, prop, receiver);
            return typeof value === 'function' ? value.bind(obj) : value;
          }
          throw new Error(`forbidden intervention path: ${label}.${String(prop)}`);
        }
      });
    }
    const realStore = freshStore();
    const urlKey = `ws-guard-${randomUUID()}`;
    await realStore.ensureSeeded(`sweep:v1:${urlKey}`, nonEmptyCensus);
    const observerStateStore = forbiddenProxy(realStore, ['readCurrent', 'ensureSeeded', 'advance'], 'observerStateStore');

    const net = guardNetwork();
    await runObserverPass(urlKey, {
      observerStateStore,
      workspacePreferencesStore: fakeWorkspacePreferencesStore(),
      streamChatWithTools: async (messages, options, onEvent) => {
        onEvent('token', { token: JSON.stringify({ narrative: 'ok', flags: [] }) });
        onEvent('done', { finishReason: 'stop' });
      },
      getPaidEnvKey: () => 'fake-key',
      now: Date.now()
    });
    assert.strictEqual(net.attempts.length, 0, 'even the real-call path never reaches the network when the LLM seam itself is a fake');
    net.restore();
  });
});

// ─── C. createObserverPassRun — production tick closure ────────────────────

describe('observer-pass: createObserverPassRun — the production tick closure', () => {
  const INTERVAL_MS = 15 * 60 * 1000;

  function sessionsCollectionOf(rows) {
    return { find: () => ({ toArray: async () => rows }) };
  }
  function failingSessionsCollection(err = new Error('backend down')) {
    return { find: () => ({ toArray: () => Promise.reject(err) }) };
  }
  const DISPATCH_STORE_STUB = { id: 'dispatchStore', listObservedWorkspaceKeys: async () => [] };
  const OBSERVER_STATE_STORE_STUB = { id: 'observerStateStore' };
  const WORKSPACE_PREFS_STUB = { id: 'workspacePreferencesStore' };

  function recordingRun(sessionsCollection, { now, intervalMs = INTERVAL_MS, dispatchStore = DISPATCH_STORE_STUB } = {}) {
    const calls = [];
    const run = createObserverPassRun({
      sessionsCollection,
      dispatchStore,
      observerStateStore: OBSERVER_STATE_STORE_STUB,
      workspacePreferencesStore: WORKSPACE_PREFS_STUB,
      intervalMs,
      now,
      pass: async (urlKey, deps) => { calls.push({ urlKey, deps }); }
    });
    return { run, calls };
  }

  const threeWorkspaces = [
    { session: JSON.stringify({ workspaces: [{ urlKey: 'ws-c' }, { urlKey: 'ws-a' }] }) },
    { session: JSON.stringify({ workspaces: [{ urlKey: 'ws-b' }] }) }
  ];

  test('round-robin: one workspace per tick, walking the sorted roster', async () => {
    const selected = [];
    for (let tick = 0; tick < 6; tick++) {
      const now = tick * INTERVAL_MS;
      const { run, calls } = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => now });
      await run();
      assert.strictEqual(calls.length, 1);
      selected.push(calls[0].urlKey);
    }
    assert.deepStrictEqual(selected, ['ws-a', 'ws-b', 'ws-c', 'ws-a', 'ws-b', 'ws-c']);
  });

  test('two ticks landing inside ONE interval select the same workspace', async () => {
    const base = 4 * INTERVAL_MS;
    const early = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => base + 1 });
    const late = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => base + INTERVAL_MS - 1 });
    await early.run();
    await late.run();
    assert.strictEqual(early.calls[0].urlKey, late.calls[0].urlKey);
  });

  test('fail-soft: a rejecting roster read skips the tick — never a thrown job failure', async () => {
    const { run, calls } = recordingRun(failingSessionsCollection(), { now: () => 0 });
    await assert.doesNotReject(run);
    assert.strictEqual(calls.length, 0);
  });

  test('an empty roster sweeps nothing and does not divide by zero', async () => {
    const { run, calls } = recordingRun(sessionsCollectionOf([]), { now: () => 5 * INTERVAL_MS });
    await assert.doesNotReject(run);
    assert.strictEqual(calls.length, 0);
  });

  test('the tick threads ONE clock value, and the exact deps object, into the pass', async () => {
    const now = 3 * INTERVAL_MS + 999;
    const { run, calls } = recordingRun(sessionsCollectionOf(threeWorkspaces), { now: () => now });
    await run();
    assert.deepStrictEqual(calls[0].deps, {
      observerStateStore: OBSERVER_STATE_STORE_STUB,
      workspacePreferencesStore: WORKSPACE_PREFS_STUB,
      streamChatWithTools: undefined,
      getPaidEnvKey: undefined,
      now,
      logger: console
    });
  });

  test('a misconfigured intervalMs is refused at construction, not silently turned into a NaN index', () => {
    for (const bad of [0, -1, undefined, NaN, '900000']) {
      assert.throws(
        () => createObserverPassRun({ sessionsCollection: sessionsCollectionOf([]), dispatchStore: DISPATCH_STORE_STUB, observerStateStore: OBSERVER_STATE_STORE_STUB, workspacePreferencesStore: WORKSPACE_PREFS_STUB, intervalMs: bad }),
        /positive intervalMs/
      );
    }
  });
});

// ─── D. Static import assertion ─────────────────────────────────────────────

describe('observer-pass: static import assertion', () => {
  test('lib/observer-pass.js imports only the documented allowlist — no LLM/provider/dispatch/agent-status module of any kind', () => {
    const modulePath = fileURLToPath(new URL('../../lib/observer-pass.js', import.meta.url));
    const src = readFileSync(modulePath, 'utf8');
    const specifiers = [...src.matchAll(/^import\s+(?:[^;]*?from\s+)?['"](.+?)['"]\s*;?\s*$/gm)].map((m) => m[1]);
    assert.deepStrictEqual(
      specifiers.sort(),
      ['./feature-defaults.js', './observer-sweep.js', './workspace-preferences.js'].sort(),
      'a new import here (e.g. a direct lib/openrouter.js or dispatch-store/agent-status-store import bypassing the injected LLM seam) must be caught by this assertion. ' +
      './observer-sweep.js is imported ONLY for its pure, I/O-free roster-union helpers (resolveRosterFromSessions/mergeRosterUnion) — reused rather than re-derived — never for buildSweepPayload or a fourth fleet summary.'
    );
  });
});
