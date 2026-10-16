/**
 * Pins for the four behaviour fixes made when the dispatch factory was rebuilt
 * (LIN-3580). Each fix brings the code in line with what its own comments and
 * docs already promised; each is a failure-path change, so every pin states what
 * it loosens AND asserts that the closed direction still holds.
 *
 *   1. A store read that throws synchronously, or returns a plain value, acts
 *      like a rejection / its value, at all four reads that used to split
 *      (the run row, the anchor row, the distinct-task count, the preset get).
 *   2. A distinct-task count resolving `undefined` is unreadable, like `null`.
 *   3. A duplicate prior whose `dispatchedAt` is `null` does not refuse.
 *   4. Any rejection of the consumer-stamp read stamps `null` and the dispatch
 *      still enqueues. The cause (lib/consumer-poll-warning.js) is LIN-3581.
 *
 * All four are unreachable with the real async stores; they matter to a store
 * written against the published fail-open invariants.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDispatchItem,
  BUDGET_EXHAUSTED_CODE,
  TASK_SESSION_RUNAWAY_CODE,
  DUPLICATE_DISPATCH_CODE,
  MAX_FRESH_SESSIONS_PER_TASK
} from '../../lib/dispatch-factory.js';

const NOW = Date.parse('2026-10-16T12:00:00.000Z');

/** A store that records what reached it. `reads` overrides any store method. */
function makeStore(reads = {}) {
  const calls = { addItem: 0, finalize: 0 };
  const store = {
    calls,
    async addItem(_urlKey, item) { calls.addItem += 1; calls.item = item; return { id: 'item-1' }; },
    ...reads
  };
  return store;
}

function dispatch(store, extra = {}) {
  let finalized = 0;
  const promise = createDispatchItem({
    store,
    urlKey: 'acme',
    now: () => NOW,
    finalizePrompt: async () => { finalized += 1; return { prompt: 'P', bootstrapToken: 'tok' }; },
    fields: { issueIdentifier: 'LIN-1', sessionId: 'run-1' },
    ...extra
  });
  return { promise, finalizedCount: () => finalized };
}

const syncThrow = () => { throw new Error('sync read failure'); };

describe('fix 1: a sync throw acts as a rejection, a plain return as its value', () => {
  const reject = async () => { throw new Error('async read failure'); };

  test('run-row read: sync throw = rejection (the run reads as absent)', async () => {
    const thrown = makeStore({ getItemStatus: syncThrow, countDistinctTasksForSession: async () => ({ count: 0, taskDispatches: 0 }) });
    const rejected = makeStore({ getItemStatus: reject, countDistinctTasksForSession: async () => ({ count: 0, taskDispatches: 0 }) });
    await dispatch(thrown).promise;
    await dispatch(rejected).promise;
    assert.equal(thrown.calls.addItem, 1);
    assert.deepEqual(thrown.calls.item, rejected.calls.item);
  });

  test('run-row read: a sync throw skips the close-out refusal exactly as a rejection does', async () => {
    const runRow = { stopAt: 'pr' };
    const readable = makeStore({ getItemStatus: async () => runRow });
    await assert.rejects(dispatch(readable, { kind: 'close-out' }).promise, (err) => err.closeOutRefusal?.code === 'CLOSE_OUT_IS_THE_PERSONS');
    const thrown = makeStore({ getItemStatus: syncThrow });
    const rejected = makeStore({ getItemStatus: reject });
    await dispatch(thrown, { kind: 'close-out' }).promise;
    await dispatch(rejected, { kind: 'close-out' }).promise;
    assert.equal(thrown.calls.addItem, 1);
    assert.equal(rejected.calls.addItem, 1);
  });

  test('anchor read: sync throw = rejection (no inheritance), plain return = its value', async () => {
    const anchor = { issueIdentifier: 'LIN-9', harness: 'opencode' };
    const fields = { followUpTo: 'anchor-1' };
    const thrown = makeStore({ getItemStatus: syncThrow });
    const rejected = makeStore({ getItemStatus: reject });
    const plain = makeStore({ getItemStatus: () => anchor });
    const asyncValue = makeStore({ getItemStatus: async () => anchor });
    for (const s of [thrown, rejected, plain, asyncValue]) await dispatch(s, { fields }).promise;
    assert.deepEqual(thrown.calls.item, rejected.calls.item);
    assert.equal(thrown.calls.item.issueIdentifier, undefined);
    assert.deepEqual(plain.calls.item, asyncValue.calls.item);
    assert.equal(plain.calls.item.issueIdentifier, 'LIN-9');
  });

  test('count read: a sync throw with no maxTasks admits (the failsafe fails open), like a rejection', async () => {
    const thrown = makeStore({ getItemStatus: async () => ({}), countDistinctTasksForSession: syncThrow });
    const rejected = makeStore({ getItemStatus: async () => ({}), countDistinctTasksForSession: reject });
    await dispatch(thrown).promise;
    await dispatch(rejected).promise;
    assert.equal(thrown.calls.addItem, 1);
    assert.equal(rejected.calls.addItem, 1);
  });

  test('preset read: sync throw = rejection (no preset), plain return = its value', async () => {
    const preset = { config: { harness: 'opencode', model: 'm' }, name: 'P' };
    const thrown = makeStore();
    const rejected = makeStore();
    const plain = makeStore();
    const asyncValue = makeStore();
    const via = (get) => ({ dispatchPresetsStore: { get }, presetId: 'p1' });
    await dispatch(thrown, via(syncThrow)).promise;
    await dispatch(rejected, via(reject)).promise;
    await dispatch(plain, via(() => preset)).promise;
    await dispatch(asyncValue, via(async () => preset)).promise;
    assert.deepEqual(thrown.calls.item, rejected.calls.item);
    assert.deepEqual(plain.calls.item, asyncValue.calls.item);
    assert.equal(plain.calls.item.harness, 'opencode');
  });

  describe('closed direction survives: a declared maxTasks still refuses what it refused', () => {
    const runRow = async () => ({ maxTasks: 3 });

    for (const [label, count] of [
      ['a sync throw', syncThrow],
      ['a plain null return', () => null],
      ['a null resolve', async () => null],
      ['a rejection', async () => { throw new Error('count failure'); }]
    ]) {
      test(`${label} from the count -> 409 BUDGET_EXHAUSTED, count null, no mint, no row`, async () => {
        const store = makeStore({ getItemStatus: runRow, countDistinctTasksForSession: count });
        const { promise, finalizedCount } = dispatch(store);
        await assert.rejects(promise, (err) => {
          assert.equal(err.status, 409);
          assert.equal(err.budgetExhausted.code, BUDGET_EXHAUSTED_CODE);
          assert.equal(err.budgetExhausted.count, null);
          assert.equal(err.budgetExhausted.maxTasks, 3);
          return true;
        });
        assert.equal(finalizedCount(), 0, 'no bootstrap credential is minted on a refusal');
        assert.equal(store.calls.addItem, 0);
      });
    }

    test('a count at the maxTasks bound for a new task still refuses', async () => {
      const store = makeStore({ getItemStatus: runRow, countDistinctTasksForSession: async () => ({ count: 3, alreadyCounted: false, taskDispatches: 0 }) });
      await assert.rejects(dispatch(store).promise, (err) => err.budgetExhausted?.count === 3);
      assert.equal(store.calls.addItem, 0);
    });

    test('the same count for an already-counted task admits', async () => {
      const store = makeStore({ getItemStatus: runRow, countDistinctTasksForSession: async () => ({ count: 3, alreadyCounted: true, taskDispatches: 0 }) });
      await dispatch(store).promise;
      assert.equal(store.calls.addItem, 1);
    });

    test('taskDispatches 29 admits and 30 refuses with TASK_SESSION_RUNAWAY', async () => {
      assert.equal(MAX_FRESH_SESSIONS_PER_TASK, 30);
      const at = (taskDispatches) => makeStore({ getItemStatus: async () => ({}), countDistinctTasksForSession: async () => ({ count: 1, alreadyCounted: true, taskDispatches }) });
      const admitted = at(29);
      await dispatch(admitted).promise;
      assert.equal(admitted.calls.addItem, 1);
      const refused = at(30);
      await assert.rejects(dispatch(refused).promise, (err) => err.taskSessionRunaway?.code === TASK_SESSION_RUNAWAY_CODE);
      assert.equal(refused.calls.addItem, 0);
    });
  });
});

describe('fix 2: a count resolving undefined is unreadable, like null', () => {
  test('with no maxTasks the failsafe fails open: admitted, no TypeError', async () => {
    const store = makeStore({ getItemStatus: async () => ({}), countDistinctTasksForSession: async () => undefined });
    await dispatch(store).promise;
    assert.equal(store.calls.addItem, 1);
    assert.equal(store.calls.item.budgetPosition, undefined);
  });

  test('with maxTasks declared it fails closed: 409 BUDGET_EXHAUSTED, count null, no mint', async () => {
    const store = makeStore({ getItemStatus: async () => ({ maxTasks: 2 }), countDistinctTasksForSession: async () => undefined });
    const { promise, finalizedCount } = dispatch(store);
    await assert.rejects(promise, (err) => err.budgetExhausted?.code === BUDGET_EXHAUSTED_CODE && err.budgetExhausted.count === null);
    assert.equal(finalizedCount(), 0);
    assert.equal(store.calls.addItem, 0);
  });
});

describe('fix 3: a duplicate prior with a null dispatchedAt does not refuse', () => {
  const prior = (dispatchedAt) => makeStore({ findRecentFreshDispatch: async () => ({ id: 'prev', dispatchedAt }) });
  const fresh = { fields: { issueIdentifier: 'LIN-1' } };

  test('null admits', async () => {
    const store = prior(null);
    await dispatch(store, fresh).promise;
    assert.equal(store.calls.addItem, 1);
  });

  test('an absent dispatchedAt admits (the control: base already did)', async () => {
    const store = makeStore({ findRecentFreshDispatch: async () => ({ id: 'prev' }) });
    await dispatch(store, fresh).promise;
    assert.equal(store.calls.addItem, 1);
  });

  test('0 is a readable epoch instant and still refuses with the unchanged body', async () => {
    const store = prior(0);
    await assert.rejects(dispatch(store, fresh).promise, (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.duplicateDispatch.code, DUPLICATE_DISPATCH_CODE);
      assert.equal(err.duplicateDispatch.id, 'prev');
      assert.equal(err.duplicateDispatch.dispatchedAt, '1970-01-01T00:00:00.000Z');
      assert.equal(err.duplicateDispatch.retryAfter, 1);
      return true;
    });
    assert.equal(store.calls.addItem, 0);
  });

  test('a real in-window instant still refuses, telling the caller when the window clears', async () => {
    const store = prior(new Date(NOW - 60 * 1000));
    await assert.rejects(dispatch(store, fresh).promise, (err) => {
      assert.equal(err.duplicateDispatch.code, DUPLICATE_DISPATCH_CODE);
      assert.equal(err.duplicateDispatch.retryAfter, 240);
      return true;
    });
    assert.equal(store.calls.addItem, 0);
  });
});

describe('fix 4: any rejection of the consumer-stamp read stamps null and still enqueues', () => {
  const list = [{ lastUsedAt: '2026-10-15T00:00:00.000Z' }];

  for (const [label, listTokens] of [
    ['a sync throw', syncThrow],
    ['a plain (non-promise) return', () => list],
    ['a resolved non-iterable', async () => ({})]
  ]) {
    test(`${label} from the dispatch token store`, async () => {
      const store = makeStore();
      const { promise, finalizedCount } = dispatch(store, { dispatchTokenStore: { listTokens } });
      await promise;
      assert.equal(finalizedCount(), 1, 'the credential is minted once and the row is written');
      assert.equal(store.calls.addItem, 1);
      assert.equal(store.calls.item.consumerLastSeenAt, null);
    });

    test(`${label} from the proxy token store`, async () => {
      const store = makeStore();
      await dispatch(store, {
        dispatchTokenStore: { listTokens: async () => list },
        proxyTokenStore: { listTokens }
      }).promise;
      assert.equal(store.calls.addItem, 1);
      assert.equal(store.calls.item.consumerLastSeenAt, null);
    });
  }

  test('control: a rejection from one store with the other readable keeps the other\'s stamp', async () => {
    const store = makeStore();
    await dispatch(store, {
      dispatchTokenStore: { listTokens: async () => list },
      proxyTokenStore: { listTokens: async () => { throw new Error('proxy store down'); } }
    }).promise;
    assert.equal(store.calls.item.consumerLastSeenAt, '2026-10-15T00:00:00.000Z');
  });
});
