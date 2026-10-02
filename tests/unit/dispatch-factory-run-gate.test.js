/**
 * LIN-3238 — the free-tier run-limit guard at the factory seam (step 1.55).
 *
 * A free-tier account may START at most `runLimit` fresh runs per UTC day across
 * its merge group. The gate is a caller-built closure (`buildRunGate`) handed to
 * `createDispatchItem` as `runGate`; the factory owns only the placement and the
 * refusal contract. This suite pins:
 *   - ORDER: the duplicate guard (1.5) runs BEFORE the run gate (1.55), so a
 *     duplicate is refused as a duplicate and never charged.
 *   - PLACEMENT: the run gate refuses before `finalizePrompt` (step 7), so no
 *     bootstrap credential is minted and nothing is enqueued.
 *   - `force: true` does NOT bypass it.
 *   - the Q1 entry gate: a follow-up / sessionId worker / abort / cascade / wake
 *     row never runs the gate (those are continuations, not runs).
 *   - the refusal contract: 429 + RUN_LIMIT_REACHED, `freeTier.used === true`,
 *     numeric `runsUsed`, a `Retry-After` consistent with `resetsAt`; and 503 +
 *     RUN_LIMIT_UNVERIFIED on an unreadable count.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDispatchItem,
  RUN_LIMIT_CODE,
  RUN_LIMIT_UNVERIFIED_CODE
} from '../../lib/dispatch-factory.js';

const RESETS = '2026-10-03T00:00:00.000Z';
const NOW = Date.parse('2026-10-02T12:00:00.000Z'); // 12h before RESETS

function capturingStore() {
  const captured = {};
  return {
    captured,
    addItem: async (urlKey, item) => {
      captured.urlKey = urlKey;
      captured.item = item;
      return { _id: 'item-1', ...item };
    }
  };
}

function freshDispatch(store, over = {}) {
  return createDispatchItem({
    store,
    urlKey: over.urlKey || 'acme',
    kind: over.kind,
    now: over.now,
    prompt: 'x',
    finalizePrompt: over.finalizePrompt,
    runGate: over.runGate,
    fields: { promptName: 'implementation', issueIdentifier: 'LIN-1', ...(over.fields || {}) }
  });
}

function limitGate(extra = {}) {
  return async () => ({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, remaining: 0, resetsAt: RESETS, ...extra });
}

describe('createDispatchItem — run-limit guard, placement and order (LIN-3238)', () => {
  test('a null runGate means the row is not gated', async () => {
    const store = capturingStore();
    await freshDispatch(store);
    assert.ok(store.captured.item, 'an ungated row dispatches unchanged');
  });

  test('order 1.5 → 1.55: a duplicate is refused as DUPLICATE_DISPATCH, and the run gate never runs', async () => {
    const store = capturingStore();
    store.findRecentFreshDispatch = async () => ({ id: 'prior', dispatchedAt: new Date() });
    let gateCalls = 0;
    const runGate = async () => { gateCalls++; return limitGate()(); };

    const err = await freshDispatch(store, { runGate }).then(() => null, e => e);
    assert.equal(err.duplicateDispatch.code, 'DUPLICATE_DISPATCH');
    assert.equal(gateCalls, 0, 'the run gate must not run once the duplicate guard already refused');
    assert.equal(store.captured.item, undefined);
  });

  test('a run-limit refusal enqueues nothing and mints nothing (before step 7)', async () => {
    const store = capturingStore();
    let mints = 0;
    const err = await freshDispatch(store, {
      runGate: limitGate(),
      finalizePrompt: () => { mints++; return { prompt: 'x', bootstrapToken: 'tok' }; }
    }).then(() => null, e => e);

    assert.equal(err.status, 429);
    assert.equal(mints, 0, 'finalizePrompt must never run on a refused dispatch');
    assert.equal(store.captured.item, undefined, 'nothing may be enqueued');
  });

  test('force:true does NOT bypass the run gate', async () => {
    const store = capturingStore();
    const err = await freshDispatch(store, {
      runGate: limitGate(),
      fields: { force: true }
    }).then(() => null, e => e);
    assert.equal(err.runLimit.code, RUN_LIMIT_CODE);
    assert.equal(store.captured.item, undefined);
  });

  test('an admitted gate (allowed:true) dispatches normally', async () => {
    const store = capturingStore();
    await freshDispatch(store, {
      runGate: async () => ({ allowed: true, runsUsed: 3, limit: 10, remaining: 7, resetsAt: RESETS })
    });
    assert.equal(store.captured.item.issueIdentifier, 'LIN-1');
  });

  for (const [name, fields] of [
    ['follow-up', { followUpTo: 'prior' }],
    ['session worker', { sessionId: 'run-1' }],
    ['abort', { abort: true, abortTo: 'some-session' }],
    ['cascade', { cascade: true, abort: true, abortTo: 'some-session' }]
  ]) {
    test(`a ${name} row is a continuation: the gate never runs and the row dispatches`, async () => {
      const store = capturingStore();
      let calls = 0;
      const runGate = async () => { calls++; return limitGate()(); };
      await freshDispatch(store, { runGate, fields });
      assert.equal(calls, 0, `${name} must short-circuit before the gate`);
      assert.ok(store.captured.item, `${name} still dispatches`);
    });
  }

  test('a wake row is a continuation: the gate never runs and the row dispatches', async () => {
    const store = capturingStore();
    let calls = 0;
    const runGate = async () => { calls++; return limitGate()(); };
    await freshDispatch(store, { runGate, kind: 'wake', fields: {} });
    assert.equal(calls, 0);
    assert.equal(store.captured.item.kind, 'wake');
  });
});

describe('createDispatchItem — run-limit refusal contract (LIN-3238)', () => {
  test('the 429 tag carries the machine-readable body and a consistent Retry-After', async () => {
    const store = capturingStore();
    const err = await freshDispatch(store, {
      now: () => NOW,
      runGate: limitGate()
    }).then(() => null, e => e);

    assert.equal(err.status, 429);
    assert.equal(err.runLimit.code, RUN_LIMIT_CODE);
    assert.equal(err.runLimit.freeTier.used, true, 'freeTier.used stays the boolean true');
    assert.equal(typeof err.runLimit.freeTier.runsUsed, 'number', 'the count rides in runsUsed');
    assert.equal(err.runLimit.freeTier.limit, 10);
    assert.equal(err.runLimit.freeTier.remaining, 0);
    assert.equal(err.runLimit.freeTier.resetsAt, RESETS);
    assert.equal(err.runLimit.retryAfter, Math.ceil((Date.parse(RESETS) - NOW) / 1000));
    assert.equal(err.runLimit.retryAfter, 43200);
    assert.equal(err.message, 'Daily run limit reached (10 of 10 today). Resets at midnight UTC.');
    assert.equal(err.runLimit.error, err.message, 'the tag carries the exact response error string');
  });

  test('the refusal message uses the real limit and count', async () => {
    const store = capturingStore();
    const err = await freshDispatch(store, {
      now: () => NOW,
      runGate: async () => ({ allowed: false, reason: 'limit', runsUsed: 5, limit: 5, remaining: 0, resetsAt: RESETS })
    }).then(() => null, e => e);
    assert.match(err.message, /Daily run limit reached \(5 of 5 today\)\. Resets at midnight UTC\./);
  });

  test('an unverified count fails closed with 503 RUN_LIMIT_UNVERIFIED', async () => {
    const store = capturingStore();
    const err = await freshDispatch(store, {
      now: () => NOW,
      runGate: async () => ({ allowed: false, reason: 'unverified', runsUsed: null, limit: 10, remaining: 0, resetsAt: RESETS })
    }).then(() => null, e => e);

    assert.equal(err.status, 503);
    assert.equal(err.runLimit.code, RUN_LIMIT_UNVERIFIED_CODE);
    assert.equal(err.runLimit.freeTier.used, true);
    assert.equal(err.runLimit.freeTier.runsUsed, null);
    assert.equal(store.captured.item, undefined);
  });

  test('a throwing gate is also an unverified 503 (never a 500)', async () => {
    const store = capturingStore();
    const err = await freshDispatch(store, {
      runGate: async () => { throw new Error('merge group exploded'); }
    }).then(() => null, e => e);
    assert.equal(err.status, 503);
    assert.equal(err.runLimit.code, RUN_LIMIT_UNVERIFIED_CODE);
    assert.equal(store.captured.item, undefined);
  });
});
