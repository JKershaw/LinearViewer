/**
 * LIN-2473 Fix A: adopt-before-exchange on a suspect credential.
 *
 * The diagnosis (LIN-2473 comment, 2026-09-02 ~20:30Z): `attemptSuspectCredentialRefresh`
 * (server.js:2304) had exactly one remedy for a suspect fingerprint — spend a
 * 60s-gated OAuth exchange — and never first re-read the durable owner-credential
 * record to see whether a newer credential was already stored. A lane that had
 * been superseded by a concurrent rotation winner (or a human re-login) could
 * only wait out the cooldown and rotate AGAIN, invalidating whoever superseded
 * it — the self-sustaining 65s rotate/reject/rotate cycle the diagnosis traced.
 *
 * The fix: before the cooldown/exchange, do ONE durable point-read and compare
 * `fingerprintCredential(record.token)` to the rejected fingerprint. Differ ->
 * adopt with no exchange, no cooldown spend. Match, or a miss -> fall through
 * to today's gated exchange unchanged.
 *
 * `attemptSuspectCredentialRefresh` is not exported and server.js is not
 * import-safe (connects to a real database and starts listening at module
 * load — see tests/unit/credential-refusal-non-worsening.test.js's precedent,
 * which this file follows). The mirror below is driven by the REAL
 * `refreshOwnerWorkspaceToken`, `convergeOnStored`, `fingerprintCredential`,
 * and `createRejectedCredentialRegistry` — only the IO (durable store,
 * sessions, refresh HTTP exchange, session persistence) is faked. Anti-drift
 * pins at the bottom grep server.js's real source for the structural markers
 * this mirror assumes.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { UNSCOPED } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken, convergeOnStored } from '../../lib/workspace-token-refresh.js';
import { fingerprintCredential } from '../../lib/credential-diagnostics.js';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

const URL_KEY = 'acme-adopt';
const ACCOUNT = 'account-adopt';
const PROVIDER = 'linear';

const noopLifecycleEventStore = {
  recordedEvents: [],
  async recordEvent(event) { this.recordedEvents.push(event); },
};

/**
 * Mirror of server.js's `attemptSuspectCredentialRefresh`, kept in lockstep
 * with production by the anti-drift pins below rather than by importing it
 * directly (not exported; server.js is not import-safe).
 */
async function attemptSuspectCredentialRefreshMirror({
  fingerprint, urlKey, ownerAccountId, provider, loadSessions, registry, store, refreshAccessToken, persistSession,
}) {
  if (ownerAccountId === UNSCOPED) return null;
  if (!registry.isSuspect(fingerprint)) return null;

  try {
    const durable = await store.get(ownerAccountId, urlKey, provider);
    if (durable?.token) {
      const durableFingerprint = fingerprintCredential(durable.token);
      if (durableFingerprint !== fingerprint) {
        return { ...convergeOnStored(durable), credentialFingerprint: durableFingerprint };
      }
    }
  } catch {
    // store-read failure: fall through to today's gated exchange, unchanged.
  }

  if (!registry.shouldAttemptRefresh(fingerprint, `${ownerAccountId}:${urlKey}`)) return null;
  try {
    const sessions = await loadSessions();
    const refreshed = await refreshOwnerWorkspaceToken({
      sessions, urlKey, ownerAccountId, refreshAccessToken, persistSession,
      resolveProvider: () => ({}), store,
      lifecycleEventStore: noopLifecycleEventStore,
    });
    if (!refreshed) return null;
    const refreshedFingerprint = fingerprintCredential(refreshed.token);
    if (refreshedFingerprint === fingerprint) {
      registry.recordByteIdenticalRejection?.(refreshedFingerprint);
      return null;
    }
    return { ...refreshed, credentialFingerprint: refreshedFingerprint };
  } catch {
    return null;
  }
}

/** Spies on a registry's `shouldAttemptRefresh`/an exchange fn call count without changing behaviour. */
function countCalls(fn) {
  const spy = (...args) => { spy.calls++; return fn(...args); };
  spy.calls = 0;
  return spy;
}

describe('LIN-2473 Fix A: adopt-before-exchange', () => {
  test('durable credential differs -> adopted, no exchange spent, cooldown left untouched', async () => {
    const rejectedFingerprint = fingerprintCredential('stale-token');
    const durableRecord = {
      provider: PROVIDER, token: 'fresh-durable-token', refreshToken: 'refresh-fresh',
      tokenExpiresAt: Date.now() + 3600_000, scope: 'org-scope',
    };
    const store = { get: countCalls(async () => durableRecord) };
    const refreshAccessToken = async () => { throw new Error('must never spend an exchange on the adopt path'); };
    const registry = createRejectedCredentialRegistry();
    registry.markSuspect(rejectedFingerprint, { reason: 'provider-401' });

    const shouldAttemptRefreshSpy = countCalls(registry.shouldAttemptRefresh);
    registry.shouldAttemptRefresh = shouldAttemptRefreshSpy;

    const result = await attemptSuspectCredentialRefreshMirror({
      fingerprint: rejectedFingerprint, urlKey: URL_KEY, ownerAccountId: ACCOUNT, provider: PROVIDER,
      loadSessions: async () => { throw new Error('adoption must not need sessions'); },
      registry, store, refreshAccessToken, persistSession: async () => {},
    });

    assert.ok(result, 'a differing durable credential must be adopted');
    assert.equal(result.token, 'fresh-durable-token');
    assert.equal(result.credentialFingerprint, fingerprintCredential('fresh-durable-token'));
    assert.equal(store.get.calls, 1, 'exactly one durable point-read');
    assert.equal(shouldAttemptRefreshSpy.calls, 0, 'the cooldown gate must never be consulted on the adopt path — never consumed');

    // Cooldown untouched: the ORIGINAL fingerprint's own gate still opens
    // immediately (no lastAttemptAt was ever stamped by the adopt path).
    assert.equal(registry.shouldAttemptRefresh(rejectedFingerprint, `${ACCOUNT}:${URL_KEY}`), true,
      'a real attempt through the untouched gate must still succeed — nothing was consumed by adoption');
  });

  test('durable credential is the SAME rejected fingerprint -> falls through to today\'s gated exchange, unchanged', async () => {
    const sharedToken = 'still-the-same-token';
    const fingerprint = fingerprintCredential(sharedToken);
    let durableRecord = { provider: PROVIDER, token: sharedToken, refreshToken: 'refresh-0', tokenExpiresAt: Date.now() - 1000 };
    const store = {
      get: countCalls(async () => durableRecord),
      async putIfRefreshToken(accountId, urlKey, expected, next) {
        if (!durableRecord || durableRecord.refreshToken !== expected) return false;
        durableRecord = { ...durableRecord, ...next };
        return true;
      },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = countCalls(async () => ({ access_token: 'rotated-token', refresh_token: 'refresh-1', expires_in: 3600 }));
    const registry = createRejectedCredentialRegistry();
    registry.markSuspect(fingerprint, { reason: 'provider-401' });

    const result = await attemptSuspectCredentialRefreshMirror({
      fingerprint, urlKey: URL_KEY, ownerAccountId: ACCOUNT, provider: PROVIDER,
      loadSessions: async () => [],
      registry, store, refreshAccessToken, persistSession: async () => {},
    });

    assert.equal(refreshAccessToken.calls, 1, 'a same-fingerprint durable read must fall through to the gated exchange, which must still run');
    assert.ok(result, 'the gated exchange minted a genuine replacement');
    assert.equal(result.token, 'rotated-token', 'today\'s exchange path is unchanged when there is nothing new to adopt');
  });

  test('durable store miss (no record / no token) -> null, today\'s behaviour resumes', async () => {
    const fingerprint = fingerprintCredential('dead-token');
    const store = {
      get: countCalls(async () => null),
      async putIfRefreshToken() { return false; },
    };
    const refreshAccessToken = async () => { throw new Error('nothing durable to exchange'); };
    const registry = createRejectedCredentialRegistry();
    registry.markSuspect(fingerprint, { reason: 'provider-401' });

    const result = await attemptSuspectCredentialRefreshMirror({
      fingerprint, urlKey: URL_KEY, ownerAccountId: ACCOUNT, provider: PROVIDER,
      loadSessions: async () => [],
      registry, store, refreshAccessToken, persistSession: async () => {},
    });

    assert.ok(store.get.calls >= 1, 'a durable point-read is still attempted on a miss');
    assert.equal(result, null, 'a store miss must return null — today\'s behaviour (fall through to the caller\'s existing selection) resumes');
  });
});

// --- Anti-drift pin: the mirror above must not silently diverge from server.js ---

function extractAttemptSuspectCredentialRefreshBody(src) {
  const start = src.indexOf('async function attemptSuspectCredentialRefresh');
  assert.ok(start >= 0, 'async function attemptSuspectCredentialRefresh not found in server.js');
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, "could not find attemptSuspectCredentialRefresh's top-level closing brace");
  return src.slice(start, end + 2);
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

describe('LIN-2473 anti-drift pin (production source, not the mirror)', () => {
  test('the durable point-read happens BEFORE the shouldAttemptRefresh cooldown gate', () => {
    const flat = stripComments(extractAttemptSuspectCredentialRefreshBody(SERVER_SRC)).replace(/\s+/g, ' ');
    const storeReadIdx = flat.indexOf('ownerCredentialStore.get(ownerAccountId, urlKey, provider)');
    const cooldownGateIdx = flat.indexOf('rejectedCredentialRegistry.shouldAttemptRefresh(fingerprint');
    assert.ok(storeReadIdx >= 0, 'the durable point-read must exist in attemptSuspectCredentialRefresh');
    assert.ok(cooldownGateIdx >= 0, 'the pre-existing cooldown gate must still exist');
    assert.ok(storeReadIdx < cooldownGateIdx, 'the durable point-read must precede the cooldown/exchange gate — an adoption must never cost a rate-limited attempt');
  });

  test('adoption compares fingerprintCredential(durable.token) against the rejected fingerprint and returns convergeOnStored(durable) on a difference', () => {
    const flat = stripComments(extractAttemptSuspectCredentialRefreshBody(SERVER_SRC)).replace(/\s+/g, ' ');
    assert.match(flat, /fingerprintCredential\(durable\.token\)/, 'must fingerprint the durable record\'s own token, not scope or the rejected credential');
    assert.match(flat, /durableFingerprint !== fingerprint/, 'must adopt only on a genuine difference');
    assert.match(flat, /convergeOnStored\(durable\)/, 'must reuse convergeOnStored\'s existing shape rather than hand-rolling a new one');
  });

  test('convergeOnStored is exported from lib/workspace-token-refresh.js for this reuse', () => {
    assert.equal(typeof convergeOnStored, 'function');
    const shaped = convergeOnStored({ token: 't', tokenExpiresAt: 1, refreshToken: 'r', provider: 'linear', scope: 's' });
    assert.deepEqual(shaped, { token: 't', expiresAt: 1, refreshToken: 'r', provider: 'linear', scope: 's' });
  });

  test('the adoption never touches shouldAttemptRefresh or spends an exchange — no cooldown/exchange tokens appear in the durable-read branch', () => {
    const flat = stripComments(extractAttemptSuspectCredentialRefreshBody(SERVER_SRC)).replace(/\s+/g, ' ');
    const storeReadIdx = flat.indexOf('ownerCredentialStore.get(ownerAccountId, urlKey, provider)');
    const cooldownGateIdx = flat.indexOf('rejectedCredentialRegistry.shouldAttemptRefresh(fingerprint');
    const adoptBranch = flat.slice(storeReadIdx, cooldownGateIdx);
    assert.doesNotMatch(adoptBranch, /shouldAttemptRefresh/, 'the adopt branch must not consult or consume the cooldown gate');
    assert.doesNotMatch(adoptBranch, /refreshOwnerWorkspaceToken/, 'the adopt branch must never spend an OAuth exchange');
  });
});
