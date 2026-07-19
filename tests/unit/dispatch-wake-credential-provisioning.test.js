/**
 * LIN-1430 (S2) — wake-follow-up credential provisioning.
 *
 * A wake follow-up (lib/dispatch-wake.js `buildWakeFollowUp`) is enqueued
 * INSIDE `DispatchQueueStore#addFeedback` by calling `addItem` directly,
 * bypassing `createDispatchItem` entirely — so, pre-fix, `bootstrapToken` was
 * structurally always null on this path and a resumed claude-code session had
 * no credential to write back with (LIN-1428).
 *
 * The fix is a route-injected `provisionWakeCredential` callback
 * (routes/dispatch.js, in the feedback handler) that the store calls between
 * building the wake descriptor and the LIN-1357 CAS/witness update. The store
 * resolves the DONOR (the parent session, via `getItemStatus`) and stays a
 * mechanism; the route owns provisioning policy (mint args, the
 * claude-code-only gate, the fail-closed catch).
 *
 * Do NOT write the bare `bootstrapToken !== null` assertion — LIN-1429's
 * commit 247e603 established that a mint missing `createdBy` PASSES and only
 * dies later at exchange (LIN-1366/1376's null-owner guard), which is exactly
 * the LIN-1428 failure mode. The honest witness (test 1 below) is a real
 * mint -> exchange -> validate chain with no stubs on the exchange path.
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DispatchQueueStore } from '../../lib/dispatch-store.js';
import { createDispatchRoutes } from '../../routes/dispatch.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { DispatchTokenStore } from '../../lib/dispatch-tokens.js';
import { applyDefaultDispatchHarness, shouldUseMcpTokenField } from '../../lib/proxy-preamble.js';
import { createMockCollection } from '../fixtures/mock-collection.js';

const URL_KEY = 'acme';

function makeStore() {
  const collection = createMockCollection();
  const historyCollection = createMockCollection();
  const store = new DispatchQueueStore({ collection, historyCollection });
  return { store, collection, historyCollection };
}

// Mirrors dispatch-wake.test.js's takenChild, but with a configurable take
// token label (needed to align with a real consumer dispatch token in the
// end-to-end chain test below, where `takenByTokenLabel` must match the
// Bearer token's own label for addFeedback's ownership filter to match).
async function takenChild(store, overrides = {}, tokenLabel = 'token-a') {
  const child = await store.addItem(URL_KEY, {
    prompt: 'do the thing',
    kind: 'implementation',
    issueIdentifier: 'LIN-42',
    subscription: 'terminal-only',
    ...overrides
  });
  await store.takeItem(child._id, URL_KEY, tokenLabel);
  return child;
}

function wakeItems(collection, historyCollection) {
  return [...collection._docs, ...historyCollection._docs].filter(d => d.kind === 'wake');
}

// ── Test 1: the honest witness — a real mint -> exchange -> validate chain ──

function buildApp({ dispatchQueueStore, dispatchTokenStore, proxyTokenStore }) {
  const app = express();
  app.use(express.json());
  app.use(createDispatchRoutes({
    dispatchQueueStore,
    dispatchTokenStore,
    workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; next(); },
    userPreferencesStore: {},
    harbourFeedbackTokenStore: null,
    proxyTokenStore
  }));
  return app;
}

async function call(app, method, path, body, bearerToken) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const opts = { method: method.toUpperCase(), headers: {} };
    if (bearerToken) opts.headers['Authorization'] = `Bearer ${bearerToken}`;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
    const text = await res.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('LIN-1430 S2 — the honest witness: real mint -> exchange -> validate on the wake path', () => {
  test('a wake follow-up mints its OWN bootstrap; createdBy survives exchange + validate', async () => {
    const { store: dispatchQueueStore, collection, historyCollection } = makeStore();
    const proxyTokenStore = new ProxyTokenStore({ collection: createMockCollection() });
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });

    // The consumer's own dispatch token, owned by account-A (LIN-1397 shape) —
    // this is req.dispatchTokenOwner, threaded into the wake mint as createdBy.
    const { token: consumerToken } = await dispatchTokenStore.createToken(URL_KEY, 'consumer', 'account-A');

    // Parent session resumes on claude-code -> shouldUseMcpTokenField gates the
    // mint on. The child's own harness is irrelevant to the donor decision
    // (pinned separately in the donor-rule describe block below).
    const parent = await dispatchQueueStore.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await takenChild(dispatchQueueStore, { sessionId: parent._id }, 'consumer');

    const app = buildApp({ dispatchQueueStore, dispatchTokenStore, proxyTokenStore });
    const res = await call(app, 'post', `/api/dispatch/feedback/${child._id}`, { message: '[done] shipped' }, consumerToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'the wake enqueued exactly once');
    const wake = wakes[0];
    assert.ok(wake.bootstrapToken, 'the wake carries its OWN minted bootstrap — distinct from the consumer token used to authenticate');

    // Exchange the WAKE's own bootstrap (not the consumer token) and validate —
    // the exact path a resumed claude-code session walks. No stubs.
    const working = await proxyTokenStore.exchangeBootstrapToken(wake.bootstrapToken);
    assert.ok(working?.token, 'the wake bootstrap exchanges for a working token');

    const validated = await proxyTokenStore.validateToken(working.token);
    assert.ok(validated, 'the working token validates on data endpoints');
    assert.equal(
      validated.createdBy,
      'account-A',
      'createdBy must survive BOTH hops: consumer token owner -> wake bootstrap mint -> exchanged working token — ' +
      'a mint missing createdBy would pass this far and only fail later at real use (LIN-1429)'
    );
  });

  test('ownerless caller (harbour-feedback auth branch): wake STILL enqueues, token-less — never suppressed (LIN-1447 parity)', async () => {
    const { store: dispatchQueueStore, collection, historyCollection } = makeStore();
    const proxyTokenStore = new ProxyTokenStore({ collection: createMockCollection() });
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    // A harbour feedback token store whose validateAndConsume sets urlKey/label
    // only — mirrors authenticateFeedbackToken's branch 1, which never sets
    // req.dispatchTokenOwner (routes/dispatch.js:194-197).
    const harbourFeedbackTokenStore = {
      validateAndConsume: async (token, itemId) =>
        token === 'harbour-token' ? { urlKey: URL_KEY } : null
    };

    const parent = await dispatchQueueStore.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await takenChild(dispatchQueueStore, { sessionId: parent._id }, 'harbour');

    const app = express();
    app.use(express.json());
    app.use(createDispatchRoutes({
      dispatchQueueStore,
      dispatchTokenStore,
      workspaceFromUrl: (req, res, next) => { req.workspace = { urlKey: req.params.urlKey }; next(); },
      userPreferencesStore: {},
      harbourFeedbackTokenStore,
      proxyTokenStore
    }));

    const res = await call(app, 'post', `/api/dispatch/feedback/${child._id}`, { message: '[done] shipped' }, 'harbour-token');
    assert.equal(res.status, 200, JSON.stringify(res.body));

    // STRUCTURAL miss, not a transient failure: there is no owner to stamp and no
    // retry can produce one. The wake must still fire — suppressing it here is what
    // the LIN-1430 review blocked, because it contradicts LIN-1447 (which stopped
    // POST /api/dispatch/broker-token 503ing for exactly this ownerless legacy
    // token) and reproduces the LIN-1428 stall: a parent that never wakes at all.
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'the wake still enqueues for an ownerless caller — tolerate, never suppress (LIN-1447)');
    assert.equal(
      wakes[0].bootstrapToken,
      null,
      'and carries NO token: an ownerless bootstrap mints and exchanges fine but is dead at every data endpoint ' +
      '(LIN-1366 owner-scoped selection fails closed on a null owner), so minting one would only disguise the miss'
    );
  });

  test('no proxy token store: wake STILL enqueues, token-less — structural, not transient', async () => {
    const { store: dispatchQueueStore, collection, historyCollection } = makeStore();
    const dispatchTokenStore = new DispatchTokenStore({ collection: createMockCollection() });
    const { token: consumerToken } = await dispatchTokenStore.createToken(URL_KEY, 'consumer', 'account-A');

    const parent = await dispatchQueueStore.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await takenChild(dispatchQueueStore, { sessionId: parent._id }, 'consumer');

    // proxyTokenStore null — the workspace has no proxy configured at all.
    const app = buildApp({ dispatchQueueStore, dispatchTokenStore, proxyTokenStore: null });
    const res = await call(app, 'post', `/api/dispatch/feedback/${child._id}`, { message: '[done] shipped' }, consumerToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'the wake still enqueues with no proxy token store — retrying cannot conjure one');
    assert.equal(wakes[0].bootstrapToken, null, 'token-less');
  });
});

// ── Test 2: donor rule — the PARENT's stored harness decides, never the child ──

describe('LIN-1430 S2 — donor rule: parent stored harness decides, never the child', () => {
  // A stub that exercises the REAL policy functions (applyDefaultDispatchHarness,
  // shouldUseMcpTokenField) so the donor RESOLUTION is pinned for real, while
  // avoiding a real mint (test 1 above already proves the mint chain end to end).
  function makeCallback() {
    const calls = [];
    const fn = async (parentHarness) => {
      calls.push(parentHarness);
      const resolved = applyDefaultDispatchHarness(parentHarness);
      if (!shouldUseMcpTokenField(resolved)) return { token: null, reason: null };
      return { token: 'synthetic-wake-token', reason: null };
    };
    return { calls, fn };
  }

  test('parent claude-code + child opencode -> token required (mismatched pair pins the donor)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await takenChild(store, { sessionId: parent._id, harness: 'opencode' });
    const { calls, fn } = makeCallback();

    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a', fn);

    assert.deepEqual(calls, ['claude-code'], 'the donor is the PARENT stored harness, never the finished child');
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].bootstrapToken, 'synthetic-wake-token');
  });

  test('parent opencode + child claude-code -> token forbidden, wake still enqueues (matched-pair confusion pinned)', async () => {
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'opencode' });
    const child = await takenChild(store, { sessionId: parent._id, harness: 'claude-code' });
    const { calls, fn } = makeCallback();

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a', fn);

    assert.deepEqual(calls, ['opencode']);
    assert.ok(res && res.success, 'feedback still written');
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'the wake still enqueues, with no credential');
    assert.equal(wakes[0].bootstrapToken, null, 'a prose-harness donor gets no token, even though the child is claude-code');
  });

  test('explicit opencode parent, no child harness override -> no token', async () => {
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'opencode' });
    const child = await takenChild(store, { sessionId: parent._id });
    const { fn } = makeCallback();

    await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a', fn);

    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].bootstrapToken, null);
  });

  // DELIBERATE — the row most likely to be "corrected" by a future reader. A
  // null stored parent harness must fail TOWARD provisioning: Simple
  // Dispatcher's own consumer fallback for an unspecified harness is
  // claude-code (dispatcher.js:519), so treating null as "no token needed"
  // would silently reproduce the LIN-1428 stall.
  test('DELIBERATE: null stored parent harness -> token REQUIRED (fail toward provisioning)', async () => {
    const { store, collection, historyCollection } = makeStore();
    // No parent seeded at all -> getItemStatus(urlKey, sessionId) resolves
    // null, identically to a stored-but-null harness (parentStatus?.harness ?? null).
    const child = await takenChild(store, { sessionId: 'unseeded-parent-S1' });
    const { calls, fn } = makeCallback();

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a', fn);

    assert.deepEqual(calls, [null], 'the store passes null straight through — never fabricates a default itself');
    assert.ok(res && res.success);
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].bootstrapToken, 'synthetic-wake-token', 'null resolves toward claude-code and mints');
  });

  test('no callback provided (existing callers) -> byte-identical to pre-S2: no donor lookup side effect on bootstrapToken', async () => {
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await takenChild(store, { sessionId: parent._id });

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a');

    assert.ok(res && res.success);
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].bootstrapToken, null, 'no callback -> no provisioning, exactly like before S2');
  });
});

// ── Test 3: provisioning failure is retryable, never loses the feedback write ──

describe('LIN-1430 S2 — provisioning failure is retryable, never loses feedback', () => {
  test('TRANSIENT mint failure: feedback still written, CAS witness NOT set, no wake, reason logged, retry re-enters', async (t) => {
    const logMock = t.mock.method(console, 'log', () => {});
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await takenChild(store, { sessionId: parent._id });

    // A genuine TRANSIENT failure — the mint was reachable, attempted, and threw.
    // Only this class withdraws the wake. A STRUCTURAL miss (ownerless caller, no
    // proxy token store) returns `degraded` instead and still enqueues; that is the
    // LIN-1447 parity the review blocked on, pinned in the describe block above.
    const failingCallback = async () => ({ token: null, reason: 'wake-provision-failed:ECONNREFUSED', degraded: null });

    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a', failingCallback);

    assert.ok(res && res.success, 'the feedback entry is still written despite the provisioning failure');
    assert.equal(res.feedbackCount, 1);

    assert.equal(wakeItems(collection, historyCollection).length, 0, 'no wake enqueued with no credential');

    // This child has no followUpTo, so it IS its own edge doc — the CAS witness
    // must NOT be set on a failed provision, or the terminal could never re-win
    // its election on retry (the lost-wake window this ordering exists to close).
    const edgeAfter = historyCollection._docs.find(d => d._id === child._id);
    assert.ok(!(edgeAfter.terminalWakeItems || []).includes(child._id), 'CAS witness NOT set on a failed provision');

    const logged = logMock.mock.calls.map(c => c.arguments[0]);
    assert.ok(
      logged.some(m => typeof m === 'string' && m.includes('[dispatch-wake]') && m.includes('wake-provision-failed:ECONNREFUSED')),
      'the failure reason is recorded via the existing null-wake observability log'
    );

    // Retryability: a re-report of the SAME terminal beat re-enters provisioning
    // (the witness was never durably set) rather than being suppressed as
    // "already-woke-for-this-item".
    let secondCallInvoked = false;
    const succeedingCallback = async () => { secondCallInvoked = true; return { token: 'retry-token', reason: null }; };
    const res2 = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped (re-reported)' }, 'token-a', succeedingCallback);

    assert.ok(res2 && res2.success);
    assert.ok(secondCallInvoked, 'the retry re-enters provisioning — self-heals from a transient mint failure');
    const wakesAfterRetry = wakeItems(collection, historyCollection);
    assert.equal(wakesAfterRetry.length, 1, 'the retry succeeds and enqueues the wake');
    assert.equal(wakesAfterRetry[0].bootstrapToken, 'retry-token');
  });

  test('STRUCTURAL degrade: wake enqueues token-less AND burns its CAS witness (not retryable, must not re-fire)', async (t) => {
    const logMock = t.mock.method(console, 'log', () => {});
    const { store, collection, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'claude-code' });
    const child = await takenChild(store, { sessionId: parent._id });

    const degradingCallback = async () => ({ token: null, reason: null, degraded: 'no-token-owner' });
    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped' }, 'token-a', degradingCallback);

    assert.ok(res && res.success);
    const wakes = wakeItems(collection, historyCollection);
    assert.equal(wakes.length, 1, 'the wake enqueues despite having no credential');
    assert.equal(wakes[0].bootstrapToken, null);

    // The counterpart of the transient case above: a degraded wake DID fire, so the
    // once-only witness must be set. Otherwise a re-report would enqueue a second
    // wake for the same terminal — trading the suppressed-wake bug for a
    // duplicate-wake one, and breaking the LIN-1357 once-only guarantee.
    const edgeAfter = historyCollection._docs.find(d => d._id === child._id);
    assert.ok(
      (edgeAfter.terminalWakeItems || []).includes(child._id),
      'CAS witness IS set for a degraded-but-enqueued wake — once-only still holds'
    );

    const logged = logMock.mock.calls.map(c => c.arguments[0]);
    assert.ok(
      logged.some(m => typeof m === 'string' && m.includes('provisioned-without-credential') && m.includes('no-token-owner')),
      'the degrade is self-attributing in the log rather than a silent token-less wake'
    );

    // And a re-report is suppressed by the witness, not re-enqueued.
    const res2 = await store.addFeedback(child._id, URL_KEY, { message: '[done] re-reported' }, 'token-a', degradingCallback);
    assert.ok(res2 && res2.success);
    assert.equal(wakeItems(collection, historyCollection).length, 1, 'no duplicate wake on re-report');
  });

  test('already-woke-for-this-item still suppresses correctly with a provisioning callback present (LIN-1357 coverage preserved)', async () => {
    const { store, historyCollection } = makeStore();
    const parent = await store.addItem(URL_KEY, { prompt: 'parent work', kind: 'implementation', harness: 'opencode' });
    const child = await takenChild(store, { sessionId: parent._id });

    // Simulate a concurrent duplicate terminal having already won the CAS by
    // pre-setting the witness directly on the archived doc.
    await historyCollection.updateOne({ _id: child._id }, { $addToSet: { terminalWakeItems: child._id } });

    let callbackInvoked = false;
    const trackingCallback = async () => { callbackInvoked = true; return { token: null, reason: null }; };
    const res = await store.addFeedback(child._id, URL_KEY, { message: '[done] shipped again' }, 'token-a', trackingCallback);

    assert.ok(res && res.success, 'feedback still written under the pre-existing LIN-1357 guard');
    assert.ok(!callbackInvoked, 'provisioning never runs when the store already suppressed the wake before reaching it');
  });
});
