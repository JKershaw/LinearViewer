/**
 * Unit tests for lib/openrouter-key-resolver.js (LIN-1352).
 *
 * This pins the behavior contract carried over verbatim from the pre-extraction
 * `getWorkspaceOpenRouterKey` in server.js: the success path, the falsy-creatorId
 * short-circuit (and that it never touches the store), and the swallow-and-log
 * throw path. The `NODE_ENV`/'test-workspace' short-circuit is NOT covered here —
 * it stayed in the server.js wrapper (a server/test-env concern outside the
 * mandated `(userPreferencesStore, creatorId)` signature) and has no unit-level
 * seam of its own; see the LIN-1352 beat-3 report for the coverage finding.
 *
 * Run with: node --test tests/unit/openrouter-key-resolver.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getWorkspaceOpenRouterKey } from '../../lib/openrouter-key-resolver.js';

// A fake UserPreferencesStore: records every creatorId it was asked about and
// returns a canned key (or throws), so the resolver can be driven with no real
// store and no server boot — the exact injectability D1b's quota-isolation test
// will rely on.
function fakeUserPreferencesStore({ key = null, throws = null } = {}) {
  const calls = [];
  return {
    calls,
    async getOpenRouterApiKey(creatorId) {
      calls.push(creatorId);
      if (throws) throw throws;
      return key;
    }
  };
}

describe('getWorkspaceOpenRouterKey', () => {
  test('success path: returns exactly what the store resolves, called with creatorId', async () => {
    const store = fakeUserPreferencesStore({ key: 'sk-or-v1-real-key' });

    const result = await getWorkspaceOpenRouterKey(store, 'linear-user-abc');

    assert.equal(result, 'sk-or-v1-real-key');
    assert.deepEqual(store.calls, ['linear-user-abc']);
  });

  test('success path: a store with no key returns null verbatim (store\'s own null, not a guard)', async () => {
    const store = fakeUserPreferencesStore({ key: null });

    const result = await getWorkspaceOpenRouterKey(store, 'linear-user-abc');

    assert.equal(result, null);
    assert.deepEqual(store.calls, ['linear-user-abc']);
  });

  test('falsy creatorId (undefined) returns null WITHOUT consulting the store', async () => {
    const store = fakeUserPreferencesStore({ key: 'sk-or-v1-should-not-be-returned' });

    const result = await getWorkspaceOpenRouterKey(store, undefined);

    assert.equal(result, null);
    assert.deepEqual(store.calls, [], 'the store must not be consulted for a missing creatorId');
  });

  test('falsy creatorId (null / empty string) returns null WITHOUT consulting the store', async () => {
    const store = fakeUserPreferencesStore({ key: 'sk-or-v1-should-not-be-returned' });

    assert.equal(await getWorkspaceOpenRouterKey(store, null), null);
    assert.equal(await getWorkspaceOpenRouterKey(store, ''), null);
    assert.deepEqual(store.calls, []);
  });

  test('a store that throws is swallowed, logged, and yields null rather than propagating', async (t) => {
    const err = new Error('durable store unreachable');
    const store = fakeUserPreferencesStore({ throws: err });
    const errorLog = t.mock.method(console, 'error', () => {});

    const result = await getWorkspaceOpenRouterKey(store, 'linear-user-abc');

    assert.equal(result, null, 'the throw must not propagate');
    assert.deepEqual(store.calls, ['linear-user-abc']);
    assert.equal(errorLog.mock.callCount(), 1);
    assert.deepEqual(errorLog.mock.calls[0].arguments, ['Error looking up workspace OpenRouter key:', err]);
  });
});
