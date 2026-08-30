/**
 * Unit tests for lib/openrouter-key-resolver.js's getUnattendedOpenRouterKey
 * (LIN-2412) — the consent-gated, env-free unattended resolver.
 *
 * Coverage:
 *   - C1 tier 1 (dispatchedBy): direct resolution, no workspace/edge lookup.
 *   - C1 tier 2 (urlKey): zero/one/many consented candidates.
 *   - C2 canonical/as-written fallback chain, deterministic multi-alias order.
 *   - resolveCanonicalAccountId throw handling (cycle/max-depth -> miss).
 *   - consent-missing degrades even when a key exists.
 *   - no env/process.env reference anywhere in the module (source census).
 *
 * Run with: node --test tests/unit/openrouter-unattended-key-resolver.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getUnattendedOpenRouterKey } from '../../lib/openrouter-key-resolver.js';

function fakeUserPreferencesStore({ keys = {}, consents = {} } = {}) {
  const calls = { getOpenRouterApiKey: [], getOpenRouterConsent: [] };
  return {
    calls,
    async getOpenRouterApiKey(accountId) {
      calls.getOpenRouterApiKey.push(accountId);
      return keys[accountId] || null;
    },
    async getOpenRouterConsent(accountId) {
      calls.getOpenRouterConsent.push(accountId);
      return consents[accountId] || null;
    }
  };
}

function fakeAccountStore({ mergedInto = {}, throwsFor = [] } = {}) {
  const calls = [];
  return {
    calls,
    async resolveCanonicalAccountId(accountId) {
      calls.push(accountId);
      if (throwsFor.includes(accountId)) {
        throw new Error(`resolveCanonicalAccountId: cycle detected resolving ${accountId}`);
      }
      // Walk mergedInto to a fixed point, mirroring the real store's contract.
      let current = accountId;
      const seen = new Set([current]);
      while (mergedInto[current]) {
        current = mergedInto[current];
        if (seen.has(current)) throw new Error('cycle');
        seen.add(current);
      }
      return current;
    }
  };
}

function fakeAccountWorkspaceStore({ edges = {} } = {}) {
  const calls = [];
  return {
    calls,
    async listAccountsForWorkspace(workspaceId) {
      calls.push(workspaceId);
      return edges[workspaceId] || [];
    }
  };
}

function fakeSessionsCollection(rows) {
  return { find: () => ({ toArray: async () => rows }) };
}

function sessionRow(workspaces) {
  return { session: JSON.stringify({ workspaces }) };
}

const NO_WORKSPACE_DEPS = {
  userPreferencesStore: fakeUserPreferencesStore(),
  sessionsCollection: fakeSessionsCollection([]),
  accountWorkspaceStore: fakeAccountWorkspaceStore(),
  accountStore: fakeAccountStore()
};

describe('getUnattendedOpenRouterKey: C1 tier 1 (dispatchedBy)', () => {
  test('resolves directly on a consented dispatchedBy account, with NO workspace/edge lookup', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-1': 'sk-or-v1-dispatch' },
      consents: { 'acct-1': '2026-08-01T00:00:00.000Z' }
    });
    const accountWorkspaceStore = fakeAccountWorkspaceStore();
    const accountStore = fakeAccountStore();

    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection([]), accountWorkspaceStore, accountStore },
      { dispatchedBy: 'acct-1' }
    );

    assert.equal(result, 'sk-or-v1-dispatch');
    assert.deepEqual(accountWorkspaceStore.calls, [], 'dispatchedBy must never touch the workspace/edge lookup');
  });

  test('a dispatchedBy account with a key but NO consent degrades to null — never falls through to another account', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({ keys: { 'acct-1': 'sk-or-v1-dispatch' }, consents: {} });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection([]), accountWorkspaceStore: fakeAccountWorkspaceStore(), accountStore: fakeAccountStore() },
      { dispatchedBy: 'acct-1' }
    );
    assert.equal(result, null);
  });

  test('dispatchedBy takes priority over urlKey when both are supplied', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-1': 'sk-or-v1-dispatch' },
      consents: { 'acct-1': '2026-08-01T00:00:00.000Z' }
    });
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': ['acct-2'] } });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection([sessionRow([{ id: 'ws-1', urlKey: 'my-workspace' }])]), accountWorkspaceStore, accountStore: fakeAccountStore() },
      { dispatchedBy: 'acct-1', urlKey: 'my-workspace' }
    );
    assert.equal(result, 'sk-or-v1-dispatch');
    assert.deepEqual(accountWorkspaceStore.calls, [], 'urlKey path must not run when dispatchedBy is present');
  });

  test('dispatchedBy through a merge: canonical has no key, falls back to the as-written dispatchedBy id', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-old': 'sk-or-v1-legacy' },
      consents: { 'acct-old': '2026-08-01T00:00:00.000Z' }
    });
    const accountStore = fakeAccountStore({ mergedInto: { 'acct-old': 'acct-new' } });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection([]), accountWorkspaceStore: fakeAccountWorkspaceStore(), accountStore },
      { dispatchedBy: 'acct-old' }
    );
    assert.equal(result, 'sk-or-v1-legacy');
  });

  test('a resolveCanonicalAccountId throw for dispatchedBy is caught and treated as a miss, never propagates', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({ keys: { 'acct-cycle': 'sk-or-v1-x' }, consents: { 'acct-cycle': 'yes' } });
    const accountStore = fakeAccountStore({ throwsFor: ['acct-cycle'] });
    await assert.doesNotReject(async () => {
      const result = await getUnattendedOpenRouterKey(
        { userPreferencesStore, sessionsCollection: fakeSessionsCollection([]), accountWorkspaceStore: fakeAccountWorkspaceStore(), accountStore },
        { dispatchedBy: 'acct-cycle' }
      );
      assert.equal(result, null);
    });
  });
});

describe('getUnattendedOpenRouterKey: C1 tier 2 (urlKey) + C2 dedup', () => {
  const sessions = [sessionRow([{ id: 'ws-1', urlKey: 'acme' }])];

  test('no urlKey and no dispatchedBy -> null, no lookups', async () => {
    const result = await getUnattendedOpenRouterKey(NO_WORKSPACE_DEPS, {});
    assert.equal(result, null);
  });

  test('urlKey unknown to every live session -> null (no workspaceId to resolve against)', async () => {
    const result = await getUnattendedOpenRouterKey(
      { ...NO_WORKSPACE_DEPS, sessionsCollection: fakeSessionsCollection(sessions) },
      { urlKey: 'not-a-real-workspace' }
    );
    assert.equal(result, null);
  });

  test('zero candidate accounts for the workspace -> null', async () => {
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': [] } });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore: fakeUserPreferencesStore(), sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore: fakeAccountStore() },
      { urlKey: 'acme' }
    );
    assert.equal(result, null);
  });

  test('exactly one consented candidate resolves its key', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-1': 'sk-or-v1-solo' },
      consents: { 'acct-1': '2026-08-01T00:00:00.000Z' }
    });
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': ['acct-1'] } });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore: fakeAccountStore() },
      { urlKey: 'acme' }
    );
    assert.equal(result, 'sk-or-v1-solo');
  });

  test('candidates with a key but no consent are excluded — a workspace with only unconsented owners degrades', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({ keys: { 'acct-1': 'sk-or-v1-nope' }, consents: {} });
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': ['acct-1'] } });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore: fakeAccountStore() },
      { urlKey: 'acme' }
    );
    assert.equal(result, null, 'a key with no consent must never be returned');
  });

  test('more than one DISTINCT consented account -> degrade, never pick', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-1': 'sk-or-v1-a', 'acct-2': 'sk-or-v1-b' },
      consents: { 'acct-1': 'yes', 'acct-2': 'yes' }
    });
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': ['acct-1', 'acct-2'] } });
    const warnCalls = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnCalls.push(args);
    try {
      const result = await getUnattendedOpenRouterKey(
        { userPreferencesStore, sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore: fakeAccountStore() },
        { urlKey: 'acme' }
      );
      assert.equal(result, null);
      assert.ok(warnCalls.some((c) => String(c[0]).includes('multiple-consented-accounts')), 'must log a distinct internal reason for the ambiguity');
    } finally {
      console.warn = originalWarn;
    }
  });

  test('a merge collapses two as-written owners to ONE canonical account -> resolves, not a false ambiguity', async () => {
    // acct-1 and acct-1-old both hold edges to ws-1 but acct-1-old was merged
    // into acct-1 — mergeAccounts never removes the merged side's own edges,
    // so listAccountsForWorkspace can return both.
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-1': 'sk-or-v1-canonical' },
      consents: { 'acct-1': 'yes' }
    });
    const accountStore = fakeAccountStore({ mergedInto: { 'acct-1-old': 'acct-1' } });
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': ['acct-1', 'acct-1-old'] } });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore },
      { urlKey: 'acme' }
    );
    assert.equal(result, 'sk-or-v1-canonical', 'a merge must not turn one real owner into a false ambiguity');
  });

  test('canonical has no key/consent -> falls back to each as-written alias in deterministic (sorted) order', async () => {
    // Three as-written ids collapse to one canonical; only the alphabetically
    // second one ('acct-b') actually has a consented key. The canonical id
    // itself and the first alias must be tried and skipped, in sorted order.
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-b': 'sk-or-v1-alias-b' },
      consents: { 'acct-b': 'yes' }
    });
    const accountStore = fakeAccountStore({
      mergedInto: { 'acct-a': 'acct-canonical', 'acct-b': 'acct-canonical', 'acct-c': 'acct-canonical' }
    });
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': ['acct-c', 'acct-a', 'acct-b'] } });
    const result = await getUnattendedOpenRouterKey(
      { userPreferencesStore, sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore },
      { urlKey: 'acme' }
    );
    assert.equal(result, 'sk-or-v1-alias-b');
    // Deterministic order: canonical id first, then aliases sorted (a before c).
    assert.deepEqual(userPreferencesStore.calls.getOpenRouterApiKey, ['acct-canonical', 'acct-a', 'acct-b']);
  });

  test('a resolveCanonicalAccountId throw for one candidate drops only that candidate, not the whole lookup', async () => {
    const userPreferencesStore = fakeUserPreferencesStore({
      keys: { 'acct-ok': 'sk-or-v1-survivor' },
      consents: { 'acct-ok': 'yes' }
    });
    const accountStore = fakeAccountStore({ throwsFor: ['acct-broken'] });
    const accountWorkspaceStore = fakeAccountWorkspaceStore({ edges: { 'ws-1': ['acct-broken', 'acct-ok'] } });
    await assert.doesNotReject(async () => {
      const result = await getUnattendedOpenRouterKey(
        { userPreferencesStore, sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore },
        { urlKey: 'acme' }
      );
      assert.equal(result, 'sk-or-v1-survivor');
    });
  });

  test('a rejecting sessionsCollection.find().toArray() degrades to null rather than throwing', async () => {
    const sessionsCollection = { find: () => ({ toArray: () => Promise.reject(new Error('mongo down')) }) };
    await assert.doesNotReject(async () => {
      const result = await getUnattendedOpenRouterKey(
        { userPreferencesStore: fakeUserPreferencesStore(), sessionsCollection, accountWorkspaceStore: fakeAccountWorkspaceStore(), accountStore: fakeAccountStore() },
        { urlKey: 'acme' }
      );
      assert.equal(result, null);
    });
  });

  test('a rejecting listAccountsForWorkspace degrades to null rather than throwing', async () => {
    const accountWorkspaceStore = { listAccountsForWorkspace: () => Promise.reject(new Error('store down')) };
    await assert.doesNotReject(async () => {
      const result = await getUnattendedOpenRouterKey(
        { userPreferencesStore: fakeUserPreferencesStore(), sessionsCollection: fakeSessionsCollection(sessions), accountWorkspaceStore, accountStore: fakeAccountStore() },
        { urlKey: 'acme' }
      );
      assert.equal(result, null);
    });
  });
});

describe('getUnattendedOpenRouterKey: source census — no env/free-tier fallback of any kind', () => {
  test('the resolver module never references process.env or an OPENROUTER_* env var', () => {
    const modulePath = fileURLToPath(new URL('../../lib/openrouter-key-resolver.js', import.meta.url));
    const src = readFileSync(modulePath, 'utf8');
    assert.doesNotMatch(src, /process\.env/, 'the unattended resolver must never read an env var — env-free by construction');
    assert.doesNotMatch(src, /OPENROUTER_API_KEY|OPENROUTER_FREE_TIER_KEY/, 'the unattended resolver must never name an env-key constant');
  });
});
