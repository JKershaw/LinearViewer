/**
 * LIN-3238 — buildRunGate (lib/chat-request.js).
 *
 * A lane derives `isFreeTier` from its own credential resolution and calls
 * `buildRunGate`; the helper returns `null` when the lane is not gated, or an
 * async gate the factory seam invokes. This suite pins the three behaviours the
 * plan requires: null when not free tier; null + a warning when there is no
 * attributable session account; and the merge group resolved once and passed to
 * `freeTierStore.checkRun`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunGate } from '../../lib/chat-request.js';

function spyFreeTierStore(result) {
  const calls = [];
  return {
    calls,
    async checkRun(accountIds) {
      calls.push(accountIds);
      return result;
    }
  };
}

describe('buildRunGate (LIN-3238)', () => {
  test('returns null when not free tier (own key / paid / no free key configured)', () => {
    assert.equal(buildRunGate({ isFreeTier: false, freeTierStore: spyFreeTierStore(null), accountId: 'a' }), null);
  });

  test('returns null and warns on a null account — null attribution is not gated', () => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      assert.equal(buildRunGate({ isFreeTier: true, freeTierStore: spyFreeTierStore(null), accountId: null }), null);
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /null attribution is not gated/);
  });

  test('resolves the merge group once and calls checkRun with it', async () => {
    const freeTierStore = spyFreeTierStore({ allowed: false, reason: 'limit', runsUsed: 10, limit: 10, remaining: 0, resetsAt: 'x' });
    const accountStore = {
      resolveCanonicalAccountId: async (id) => (id === 'stale' ? 'canonical' : id),
      listMergedAccounts: async (id) => (id === 'canonical' ? [{ _id: 'merged' }] : [])
    };
    const gate = buildRunGate({ isFreeTier: true, freeTierStore, accountId: 'stale', accountStore });

    assert.equal(typeof gate, 'function');
    const result = await gate();
    assert.equal(result.reason, 'limit');
    assert.deepEqual(freeTierStore.calls, [['canonical', 'merged', 'stale']]);
  });

  test('with no accountStore, counts the session account alone', async () => {
    const freeTierStore = spyFreeTierStore({ allowed: true, runsUsed: 1, limit: 10, remaining: 9, resetsAt: 'x' });
    const gate = buildRunGate({ isFreeTier: true, freeTierStore, accountId: 'solo' });
    const result = await gate();
    assert.equal(result.allowed, true);
    assert.deepEqual(freeTierStore.calls, [['solo']]);
  });

  test('narrows to the session account when canonicalization fails (never another account)', async () => {
    const freeTierStore = spyFreeTierStore({ allowed: true, runsUsed: 0, limit: 10, remaining: 10, resetsAt: 'x' });
    const accountStore = {
      resolveCanonicalAccountId: async () => { throw new Error('cycle detected'); },
      listMergedAccounts: async () => [{ _id: 'merged' }]
    };
    const gate = buildRunGate({ isFreeTier: true, freeTierStore, accountId: 'acct', accountStore });
    await gate();
    assert.deepEqual(freeTierStore.calls, [['acct']]);
  });
});
