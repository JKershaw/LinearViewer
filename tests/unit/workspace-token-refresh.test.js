/**
 * Unit tests for LIN-1373: proxy-token refresh-on-resolve, and its LIN-1499
 * Phase 1 provider-aware routing.
 *
 * Before LIN-1373, `resolveWorkspaceAccess` (server.js) only ever READ
 * sessions via the pure selector `selectOwnerWorkspaceToken` — a headless
 * proxy token stopped resolving the instant its creating human's Linear
 * access token lapsed, because only human web activity (`ensureValidToken`)
 * ever refreshed it, and that middleware structurally no-ops for a
 * session-less agent request.
 *
 * Before LIN-1499 Phase 1, that refresh-on-resolve path (and ensureValidToken
 * itself) was Linear-only: a GitHub/github-projects workspace's refreshability
 * predicate required `refreshToken`, which a GitHub-family binding never has
 * by design (it re-mints from `installationId` instead) — so GitHub got no
 * off-session refresh at all (D1), and `github-projects` was actively routed
 * into Linear's `refreshAccessToken(undefined)` on the WEB path, which throws
 * and deletes the workspace/session (D2, destructive).
 *
 * Block A drives the pure sibling selector `selectExpiredOwnerRow`
 * (lib/workspace-token-resolver.js) directly — Linear cases.
 * Block B drives `refreshOwnerWorkspaceToken` (lib/workspace-token-refresh.js)
 * with fake IO (refreshAccessToken, persistSession) — Linear refresh success,
 * rotation, failure fall-through, missing refresh token, single-flight
 * coalescing, and TTL preservation.
 * Block C (LIN-1499) extends Block A's selector coverage to GitHub-family
 * (`installationId`-based) refreshability — proves D1's predicate fix.
 * Block D (LIN-1499) extends Block B's orchestration coverage to GitHub-family
 * routing — proves D2's routing fix, the beat-1 `{fetchImpl, now}` passthrough
 * is load-bearing (not decorative), scalar-mirror rotation, no Linear
 * contamination, and fail-closed behaviour on a real mint failure.
 * Block E (LIN-1499) pins the `ensureValidToken` (server.js) branch widening
 * itself via a source-text regression guard, mirroring the precedent in
 * tests/unit/task-chat-route.test.js — server.js is not import-safe in a unit
 * test (it connects to Mongo and calls app.listen at module load), so this is
 * the same level of testability the codebase already uses for that file's own
 * glue (see also tests/unit/workspace-token-refresh-integration.test.js's
 * docstring, which makes the identical call for resolveWorkspaceAccess).
 * Block G (LIN-1986) drives the pure sibling selector `selectOwnerWorkspaceRow`
 * (lib/workspace-token-resolver.js) directly — the owner-scoped, live,
 * max-expiry **row** selector that replaced `workspace-title-resolver.js`'s own
 * owner-blind scan-and-pick. Same owner-gate/liveness/tie-break shape as Block
 * A/C's `selectExpiredOwnerRow`, sibling to `selectOwnerWorkspaceToken`'s scoped
 * branch, but no UNSCOPED mode and no refreshability filter — it exists purely
 * to answer "the owner's own best live row for this urlKey, or null."
 * Block H (LIN-2097) drives `refreshOwnerCredential` — freezing the recorded
 * expiry on a byte-identical exchange (still true), and — per the B1 review
 * finding on PR #1138 — proving `refreshOwnerCredential` itself stays RAW for
 * a non-live result rather than nulling it out. Block J (LIN-2097, B1) is
 * where that null-check actually lives now: `doRefresh`'s headless arm, one
 * hop downstream, so a non-live result is filtered for the headless proxy
 * caller but still reaches the two human refresh entrants (`ensureValidToken`,
 * `handleTokenRefreshAndRetry`, both in server.js, both calling
 * `refreshOwnerCredential` directly) exactly as it always has — those two were
 * explicitly out of scope for LIN-2097 (research §3 L6), and nulling on the
 * shared seam silently widened into them (a non-null->null flip there is read
 * by server.js as "credential unrefreshable" and removes the workspace/session).
 * Block I (LIN-2097) pins the corresponding refresh-on-resolve gate wiring in
 * server.js (`resolveWorkspaceAccess`'s `!selected.token` branch) as source
 * text — the gate's own suppression behaviour is exercised directly, with a
 * real clock and real state, in tests/unit/refresh-on-resolve-gate.test.js.
 *
 * Run with: node --test tests/unit/workspace-token-refresh.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { selectExpiredOwnerRow, selectOwnerWorkspaceToken, selectOwnerWorkspaceRow } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken, refreshOwnerCredential, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';
import { REFRESH_STRATEGY, refreshStrategyFor } from '../../lib/refresh-strategy.js';

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000; // ~2.8h — comfortably past the 5-minute refresh buffer
const FURTHER_FUTURE_MS = 50_000_000; // ~13.9h — a later expiry than FAR_FUTURE_MS
const PAST_MS = -10_000; // already expired
const FURTHER_PAST_MS = -20_000; // expired even earlier

function sessionRow(sid, accountId, urlKey, { accessToken, expiresAt, refreshToken, provider = 'linear' }) {
  return { _id: sid, session: { accountId, workspaces: [{ urlKey, provider, accessToken, tokenExpiresAt: expiresAt, refreshToken }] } };
}

// LIN-1523/1524: fake durable owner-credential store. `get` is now load-bearing
// for the Linear arm (LIN-1524 point-reads it to find what to refresh), so this
// fake is stateful — a `put` updates what a later `get` sees, mirroring a real
// collection, which matters for tests that refresh the SAME (account, urlKey)
// more than once (e.g. single-flight cleanup).
function fakeStore(seed = {}) {
  const calls = [];
  const records = new Map();
  for (const [key, credential] of Object.entries(seed)) records.set(key, credential);
  return {
    calls,
    // LIN-1887 G4: the fake learns the provider PARTITION, because the real
    // store's `_id` is now `${accountId}::${urlKey}::${provider}` and the CAS
    // witness must land on the same document the read hit. A fake that kept the
    // 2-part key would let the single-flight/CAS specs pass against a shape the
    // real store no longer has.
    async get(accountId, urlKey, provider = 'linear') {
      return records.get(`${accountId}::${urlKey}::${provider}`) ?? null;
    },
    async put(accountId, urlKey, credential) {
      calls.push({ accountId, urlKey, credential });
      records.set(`${accountId}::${urlKey}::${credential.provider || 'linear'}`, credential);
    },
    // LIN-1546: optimistic CAS. Models the real store — writes (and records the
    // landed write into `calls`, so the existing "the durable write landed"
    // assertions keep observing it) ONLY when the stored refreshToken still
    // equals `expected`; a miss returns false and records nothing.
    async putIfRefreshToken(accountId, urlKey, expected, next) {
      const key = `${accountId}::${urlKey}::${next.provider || 'linear'}`;
      const current = records.get(key);
      if (!current || current.refreshToken !== expected) return false;
      calls.push({ accountId, urlKey, credential: { ...next, pendingSpend: null } });
      records.set(key, { ...next, pendingSpend: null });
      return true;
    },
    // LIN-2235 (L4.1): mirrors the real store's `pendingSpend` marker —
    // written before the exchange, cleared by a landed `putIfRefreshToken`
    // (above) or an explicit `clearSpendIntent` (below) — so fault-injection
    // specs can exercise `doOwnerRefresh`'s spend-intent detection against
    // this same fake rather than needing a real Mango store.
    async markSpendIntent(accountId, urlKey, provider, spentRefreshToken) {
      const key = `${accountId}::${urlKey}::${provider || 'linear'}`;
      const current = records.get(key);
      if (!current) return false;
      records.set(key, { ...current, pendingSpend: { refreshToken: spentRefreshToken, attemptedAt: new Date() } });
      return true;
    },
    async clearSpendIntent(accountId, urlKey, provider) {
      const key = `${accountId}::${urlKey}::${provider || 'linear'}`;
      const current = records.get(key);
      if (!current) return false;
      records.set(key, { ...current, pendingSpend: null });
      return true;
    },
  };
}

// GitHub-family session row builder (LIN-1499). `installationId` is
// binding-scoped (never mirrored onto the workspace's legacy scalar fields —
// see lib/workspace.js's linkProvider), so a realistic fixture needs an
// explicit `bindings` array, exactly as a real persisted session carries one
// once linkProvider has run. Passing `installationId: undefined` produces a
// binding with no installationId — the "not yet refreshable" case.
function githubSessionRow(sid, accountId, urlKey, { accessToken, expiresAt, installationId, provider = 'github' }) {
  return {
    _id: sid,
    session: {
      accountId,
      workspaces: [{
        urlKey,
        provider,
        accessToken,
        tokenExpiresAt: expiresAt,
        bindings: [{ provider, scope: 'octocat/repo', credentials: { token: accessToken, installationId } }],
      }],
    },
  };
}

// ---------------------------------------------------------------------------
// Block A — pure sibling selector `selectExpiredOwnerRow`
// ---------------------------------------------------------------------------

describe('selectExpiredOwnerRow (LIN-1373, Block A — pure selector)', () => {
  test('A1: owner has an expired row with a refreshToken -> returns it (sid, refreshToken, session, workspaceIndex)', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];
    const row = selectExpiredOwnerRow(sessions, 'acme', 'account-A');
    assert.equal(row.sid, 'sid-1');
    assert.equal(row.refreshToken, 'refresh-A');
    assert.equal(row.workspaceIndex, 0);
    assert.equal(row.session.accountId, 'account-A');
  });

  test('A2: owner has a LIVE (non-expired) row -> null, nothing to refresh', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'live', expiresAt: NOW + FAR_FUTURE_MS, refreshToken: 'refresh-A' }),
    ];
    assert.equal(selectExpiredOwnerRow(sessions, 'acme', 'account-A'), null);
  });

  test('A3: owner has an expired row but NO refreshToken -> null (nothing refreshable)', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: undefined }),
    ];
    assert.equal(selectExpiredOwnerRow(sessions, 'acme', 'account-A'), null);
  });

  test('A4: no session for this owner/urlKey at all -> null', () => {
    const sessions = [
      sessionRow('sid-1', 'account-B', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-B' }),
    ];
    assert.equal(selectExpiredOwnerRow(sessions, 'acme', 'account-A'), null);
  });

  test('A5: null/empty owner -> null (never scans owner-blind, mirrors selectOwnerWorkspaceToken\'s fail-closed posture)', () => {
    const sessions = [
      sessionRow('sid-1', null, 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-legacy' }),
    ];
    assert.equal(selectExpiredOwnerRow(sessions, 'acme', null), null);
  });

  test('A6: among the owner\'s own multiple expired+refreshable rows, picks the latest-expiring', () => {
    const sessions = [
      sessionRow('sid-old', 'account-A', 'acme', { accessToken: 'stale-old', expiresAt: NOW + FURTHER_PAST_MS, refreshToken: 'refresh-old' }),
      sessionRow('sid-new', 'account-A', 'acme', { accessToken: 'stale-new', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-new' }),
    ];
    const row = selectExpiredOwnerRow(sessions, 'acme', 'account-A');
    assert.equal(row.sid, 'sid-new');
    assert.equal(row.refreshToken, 'refresh-new');
  });

  test('A7: only scans the owner\'s OWN sessions — another account\'s expired+refreshable row never wins', () => {
    const sessions = [
      sessionRow('sid-B', 'account-B', 'acme', { accessToken: 'stale-B', expiresAt: NOW + FURTHER_FUTURE_MS + PAST_MS, refreshToken: 'refresh-B' }),
      sessionRow('sid-A', 'account-A', 'acme', { accessToken: 'stale-A', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];
    const row = selectExpiredOwnerRow(sessions, 'acme', 'account-A');
    assert.equal(row.sid, 'sid-A');
  });

  test('A8: selectOwnerWorkspaceToken itself is untouched by this addition (still session_expired for the same fixture)', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, null);
    assert.equal(result.reason, 'session_expired');
  });
});

// ---------------------------------------------------------------------------
// Block B — refreshOwnerWorkspaceToken (fake IO)
// ---------------------------------------------------------------------------

describe('refreshOwnerWorkspaceToken (LIN-1373/1524, Block B — refresh orchestration)', () => {
  beforeEach(() => {
    _resetInflightForTests();
  });

  test('B1: refreshes from the durable record, mirrors accessToken/tokenExpiresAt into the owner\'s session row, and returns the fresh token', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: undefined }),
    ];
    const persisted = [];
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'refresh-A');
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A', tokenExpiresAt: NOW + PAST_MS } });

    const result = await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store
    });

    assert.equal(result.token, 'fresh-token');
    assert.ok(result.expiresAt > Date.now());
    assert.equal(result.provider, 'linear');

    // LIN-1524: the durable record is what got refreshed and re-persisted —
    // exactly one put, for the right owner/urlKey, with the rotated refreshToken.
    assert.equal(store.calls.length, 1);
    assert.equal(store.calls[0].accountId, 'account-A');
    assert.equal(store.calls[0].urlKey, 'acme');
    assert.equal(store.calls[0].credential.refreshToken, 'refresh-A-rotated');
    assert.equal(store.calls[0].credential.scope, 'org-1');

    // The session row (which exists here) is mirrored — accessToken/tokenExpiresAt
    // only, never the refreshToken.
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].sid, 'sid-1');
    assert.equal(persisted[0].session.workspaces[0].accessToken, 'fresh-token');
    assert.equal(persisted[0].session.workspaces[0].refreshToken, undefined);
  });

  test('B2: rotation — the NEW refresh_token (not the old) is what gets persisted durably', async () => {
    const sessions = [];
    const refreshAccessToken = async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-A-new', expires_in: 3600 });
    const persistSession = async () => {};
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A-old', tokenExpiresAt: NOW + PAST_MS } });

    await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(store.calls[0].credential.refreshToken, 'refresh-A-new');
    assert.notEqual(store.calls[0].credential.refreshToken, 'refresh-A-old');
    // And a subsequent get sees the rotated value (the fake mirrors a real collection).
    const reread = await store.get('account-A', 'acme');
    assert.equal(reread.refreshToken, 'refresh-A-new');
  });

  test('B3: refresh throws EXPIRED -> propagates to the caller, no persist (durable or session), no swallowing into a fake success', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: undefined }),
    ];
    let persistCalled = false;
    const refreshAccessToken = async () => { throw new TokenRefreshError('Refresh token expired or invalid', 'EXPIRED'); };
    const persistSession = async () => { persistCalled = true; };
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'dead-refresh', tokenExpiresAt: NOW + PAST_MS } });

    await assert.rejects(
      () => refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store }),
      TokenRefreshError
    );
    assert.equal(persistCalled, false);
    assert.equal(store.calls.length, 0, 'no durable put on a failed refresh');
  });

  test('B4: single-flight — two concurrent calls for the same (owner, urlKey) invoke refreshAccessToken exactly once, both resolve to the fresh token', async () => {
    const sessions = [];
    let callCount = 0;
    let releaseRefresh;
    const gate = new Promise(resolve => { releaseRefresh = resolve; });
    const refreshAccessToken = async () => {
      callCount++;
      await gate;
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persistSession = async () => {};
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A', tokenExpiresAt: NOW + PAST_MS } });

    const p1 = refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });
    const p2 = refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    releaseRefresh();
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.equal(callCount, 1);
    assert.equal(r1.token, 'fresh-token');
    assert.equal(r2.token, 'fresh-token');
  });

  test('B5: single-flight cleanup — after settling (success), a later independent lapse refreshes again (not permanently coalesced)', async () => {
    let callCount = 0;
    const refreshAccessToken = async () => {
      callCount++;
      return { access_token: `fresh-token-${callCount}`, refresh_token: `refresh-A-rotated-${callCount}`, expires_in: 3600 };
    };
    const persistSession = async () => {};
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A', tokenExpiresAt: NOW + PAST_MS } });

    const r1 = await refreshOwnerWorkspaceToken({ sessions: [], urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });
    const r2 = await refreshOwnerWorkspaceToken({ sessions: [], urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(callCount, 2);
    assert.equal(r1.token, 'fresh-token-1');
    assert.equal(r2.token, 'fresh-token-2');
  });

  test('B6: single-flight cleanup after FAILURE — a later independent call still attempts its own refresh (the map entry was removed, not stuck)', async () => {
    let callCount = 0;
    const refreshAccessToken = async () => {
      callCount++;
      if (callCount === 1) throw new TokenRefreshError('boom', 'NETWORK');
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persistSession = async () => {};
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A', tokenExpiresAt: NOW + PAST_MS } });

    await assert.rejects(() => refreshOwnerWorkspaceToken({ sessions: [], urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store }));
    const result = await refreshOwnerWorkspaceToken({ sessions: [], urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(callCount, 2);
    assert.equal(result.token, 'fresh-token');
  });

  test('B7: TTL preserved — persistSession is called with only the session content; caller (server.js) is responsible for never routing this through the TTL-rolling session store', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: undefined }),
    ];
    const persistCalls = [];
    const refreshAccessToken = async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 });
    // A fake persistSession that asserts it is called with exactly (sid, session) —
    // no third "options"/"expires" argument that could smuggle a TTL roll in.
    const persistSession = async (...args) => {
      assert.equal(args.length, 2);
      persistCalls.push(args);
    };
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A', tokenExpiresAt: NOW + PAST_MS } });

    await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });
    assert.equal(persistCalls.length, 1);
  });

  test('B8: durable record present but with NO refreshToken -> resolves null, no network call, no durable put', async () => {
    const refreshAccessToken = async () => { throw new Error('must not be called'); };
    const persistSession = async () => { throw new Error('must not be called'); };
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: undefined, tokenExpiresAt: NOW + PAST_MS } });

    const result = await refreshOwnerWorkspaceToken({ sessions: [], urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(result, null);
    assert.equal(store.calls.length, 0);
  });

  test('B9a: no durable record at all (never connected) -> resolves null, no network call — fail-closed', async () => {
    let refreshCalled = false;
    const refreshAccessToken = async () => { refreshCalled = true; return {}; };
    const persistSession = async () => {};
    const store = fakeStore(); // empty — no record for this (accountId, urlKey)

    const result = await refreshOwnerWorkspaceToken({ sessions: [], urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(result, null);
    assert.equal(refreshCalled, false);
  });

  test('B9b (LIN-1524\'s actual deliverable): durable record present, NO session row anywhere -> refresh proceeds and succeeds', async () => {
    // The end-to-end proof of the phase: a proxy token resolving a workspace
    // whose owner has fully logged out (zero session rows for this account,
    // anywhere) still refreshes successfully, sourced entirely from the
    // durable record. Before LIN-1524 this was structurally impossible —
    // selectExpiredOwnerRow requires a session row to even look at.
    const sessions = []; // no session rows AT ALL, for any account
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'refresh-A');
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    let persistSessionCalled = false;
    const persistSession = async () => { persistSessionCalled = true; };
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A', tokenExpiresAt: NOW + PAST_MS } });

    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(result.token, 'fresh-token');
    assert.equal(store.calls.length, 1, 'the durable record was rotated');
    assert.equal(store.calls[0].credential.refreshToken, 'refresh-A-rotated');
    // No session row existed, so nothing was mirrored into one — correctly a no-op.
    assert.equal(persistSessionCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Block C (LIN-1499 Phase 1) — selectExpiredOwnerRow, GitHub-family
// refreshability (D1: "GitHub gets no off-session refresh at all")
// ---------------------------------------------------------------------------

describe('selectExpiredOwnerRow (LIN-1499, Block C — GitHub-family provider-awareness)', () => {
  test('C1 [D1 FIXED]: an expired GitHub row with installationId and NO refreshToken is now selected — impossible before this ticket', () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const row = selectExpiredOwnerRow(sessions, 'acme-gh', 'account-A');
    assert.ok(row, 'D1: a GitHub row with installationId must be selected');
    assert.equal(row.sid, 'sid-1');
    assert.equal(row.provider, 'github');
    // The pre-LIN-1499 shape carried refreshToken as the sole refreshability
    // signal; a GitHub row simply never has one, and that must not disqualify it.
    assert.equal(row.refreshToken, undefined);
  });

  test('C2: a github-projects row with installationId is ALSO selected (the family, not just github)', () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-ghp', { accessToken: 'stale-ghp', expiresAt: NOW + PAST_MS, installationId: '555', provider: 'github-projects' }),
    ];
    const row = selectExpiredOwnerRow(sessions, 'acme-ghp', 'account-A');
    assert.ok(row);
    assert.equal(row.provider, 'github-projects');
  });

  test('C3: an expired GitHub row MISSING installationId stays unselectable (fail-closed, not select-then-throw)', () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: undefined }),
    ];
    assert.equal(selectExpiredOwnerRow(sessions, 'acme-gh', 'account-A'), null);
  });

  test('C4: a LIVE (non-expired) GitHub row is not selected, same as Linear', () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'live-gh', expiresAt: NOW + FAR_FUTURE_MS, installationId: '987' }),
    ];
    assert.equal(selectExpiredOwnerRow(sessions, 'acme-gh', 'account-A'), null);
  });

  test('C5: Linear rows are unaffected by the GitHub-family branch — still refreshToken-gated (regression guard on A3)', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: undefined, provider: 'linear' }),
    ];
    assert.equal(selectExpiredOwnerRow(sessions, 'acme', 'account-A'), null);
  });

  test('C6: selectOwnerWorkspaceToken remains untouched for GitHub rows too (byte-identical selector, D1/D2 live only in the sibling)', () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme-gh', 'account-A');
    assert.equal(result.token, null);
    assert.equal(result.reason, 'session_expired');
    assert.equal(result.provider, 'github');
  });
});

// ---------------------------------------------------------------------------
// Block D (LIN-1499 Phase 1) — refreshOwnerWorkspaceToken, GitHub-family
// routing (D1/D2 fixed at the orchestration layer)
// ---------------------------------------------------------------------------

describe('refreshOwnerWorkspaceToken (LIN-1499, Block D — GitHub-family routing)', () => {
  beforeEach(() => {
    _resetInflightForTests();
  });

  // A fake minting provider, shaped like GitHubProvider/GitHubProjectsProvider's
  // real refreshCredential: rotated token + real ms expiry + installationId, no
  // refreshToken. Captures the exact `opts` it was called with so Block D's
  // seam tests can assert on it directly.
  function fakeMintProvider(patch, calls) {
    return {
      async refreshCredential(binding, opts) {
        calls.push({ binding, opts });
        return patch;
      },
    };
  }

  test('D1 [D1 FIXED end-to-end]: an expired GitHub owner row is refreshed via the provider seam, off-session, and returns ok', async () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const calls = [];
    const provider = fakeMintProvider({ token: 'ghs_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '987' }, calls);
    const resolveProvider = () => provider;
    let refreshAccessTokenCalled = false;
    const refreshAccessToken = async () => { refreshAccessTokenCalled = true; return {}; };
    const persisted = [];
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };

    const result = await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider
    });

    assert.equal(result.token, 'ghs_fresh');
    assert.equal(result.provider, 'github');
    assert.ok(result.expiresAt > Date.now());
    // Proves D1: this exact case (installationId, no refreshToken) previously
    // returned null from the selector and never reached this far at all.
    assert.equal(calls.length, 1);
    // Never touches the Linear exchange.
    assert.equal(refreshAccessTokenCalled, false);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].sid, 'sid-1');
  });

  test('D1b (LIN-1891): the refreshed GitHub-family return carries `scope` — the structured {token, repo} call scope, additive alongside `token`/`provider`', async () => {
    // This is the half-fix detector: it fails if only edit 1 (the selector)
    // lands and edit 2 (this refresh arm) does not — a GitHub-family
    // credential that expires and refreshes off-session would otherwise drop
    // back to a bare token with no repo scope for the headless lane.
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const provider = fakeMintProvider({ token: 'ghs_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '987' }, []);
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => ({});
    const persistSession = async () => {};

    const result = await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider
    });

    assert.deepStrictEqual(result.scope, { token: 'ghs_fresh', repo: 'octocat/repo' });
  });

  test('D2 [D2 FIXED at the routing layer]: a github-projects row is refreshed via the provider seam and NEVER handed to refreshAccessToken', async () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-ghp', { accessToken: 'stale-ghp', expiresAt: NOW + PAST_MS, installationId: '555', provider: 'github-projects' }),
    ];
    const calls = [];
    const provider = fakeMintProvider({ token: 'ghp_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '555' }, calls);
    const resolveProvider = () => provider;
    let refreshAccessTokenCalled = false;
    const refreshAccessToken = async () => { refreshAccessTokenCalled = true; return { access_token: 'WRONG-linear-shaped', refresh_token: 'WRONG', expires_in: 3600 }; };
    const persistSession = async () => {};

    const result = await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme-ghp', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider
    });

    assert.equal(result.token, 'ghp_fresh');
    assert.equal(result.provider, 'github-projects');
    assert.equal(calls.length, 1, 'the minting provider was invoked exactly once');
    assert.equal(refreshAccessTokenCalled, false, 'D2: github-projects must NEVER reach the Linear refreshAccessToken exchange');
  });

  test("D3 [D2's destructive mode cannot recur here]: a github-projects refresh never calls anything Linear-shaped, and persists cleanly — no exception to be caught, nothing to remove", async () => {
    // Before the fix, this exact shape (github-projects, no refreshToken) drove
    // refreshAccessToken(undefined), which throws TokenRefreshError('Invalid
    // refresh token','INVALID') — the throw that fed ensureValidToken's catch
    // into removeWorkspace + session.destroy. Proving this call now resolves
    // (not rejects) for a healthy installationId is the orchestration-layer half
    // of "the destructive mode is gone"; Block E pins the server.js branch itself.
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-ghp', { accessToken: 'stale-ghp', expiresAt: NOW + PAST_MS, installationId: '555', provider: 'github-projects' }),
    ];
    const provider = fakeMintProvider({ token: 'ghp_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '555' }, []);
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => { throw new TokenRefreshError('Invalid refresh token', 'INVALID'); };
    const persistSession = async () => {};

    await assert.doesNotReject(() =>
      refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme-ghp', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider })
    );
  });

  test('D4: scalar mirror (accessToken/tokenExpiresAt) rotates in lockstep, persisted to the correct session row', async () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const provider = fakeMintProvider({ token: 'ghs_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '987' }, []);
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => ({});
    const persisted = [];
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };

    await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider });

    const persistedWs = persisted[0].session.workspaces[0];
    assert.equal(persistedWs.accessToken, 'ghs_fresh');
    assert.equal(persistedWs.tokenExpiresAt, NOW + FAR_FUTURE_MS);
    // installationId survives the linkProvider merge onto the binding.
    assert.equal(persistedWs.bindings[0].credentials.installationId, '987');
  });

  test('D5 [LIN-1524 close-out replacement assertion — no Linear contamination]: a GitHub-family re-mint never creates (or touches) a durable Linear credential record', async () => {
    // The original D5 ("a GitHub workspace never gains a refreshToken") is a
    // VACUITY TRAP after LIN-1524: since updateWorkspaceTokens no longer
    // writes refreshToken for ANYONE (Linear included), that assertion would
    // now pass even if a GitHub-family re-mint accidentally started calling
    // `refreshAccessToken` or writing a durable record — it protects nothing
    // post-cutover. The replacement per the ticket's own test plan: assert
    // directly against the durable store, which is Linear-only by design —
    // `store.get(accountId, urlKey)` must still return null after a
    // GitHub-family refresh, and `store.put` must never have been called.
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const provider = fakeMintProvider({ token: 'ghs_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '987' }, []);
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => { throw new Error('must not be called for GitHub-family — this is the Linear-only arm'); };
    const persisted = [];
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };
    const store = fakeStore();

    await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider, store });

    const persistedWs = persisted[0].session.workspaces[0];
    assert.equal(persistedWs.refreshToken, undefined);
    assert.equal(persistedWs.tokenExpiresAt, NOW + FAR_FUTURE_MS);
    assert.equal(Number.isNaN(persistedWs.tokenExpiresAt), false);

    // The actual replacement assertion: the durable store was never touched.
    assert.equal(store.calls.length, 0, 'store.put must never be called for a GitHub-family re-mint');
    assert.equal(await store.get('account-A', 'acme-gh'), null, 'no durable Linear credential may exist for a GitHub-family workspace');
  });

  test('D6 [seam load-bearing, LIN-1499 item 4]: {fetchImpl, now} passed into refreshOwnerWorkspaceToken reach provider.refreshCredential unchanged, and now arrives as a number the provider can do arithmetic on', async () => {
    // This is the plumbing proof that beat 1's remintActiveCredential passthrough
    // is load-bearing: if that passthrough were reverted (provider.refreshCredential(active)
    // called with no second argument), the fake provider below would receive
    // `opts === undefined`, and the strict-equal identity assertions on
    // receivedOpts.fetchImpl/now would fail. A test that only checked the
    // refresh SUCCEEDED would still pass with the passthrough reverted (the fake
    // ignores unused args) — asserting on referential identity of the received
    // opts is what makes this a real proof, not a decorative one.
    //
    // `now` is also actually CONSUMED here (mirroring mintAppJwt's real
    // `Math.floor(now / 1000)` contract, lib/providers/github/app-auth.js:122-125)
    // rather than merely recorded: the fake provider derives tokenExpiresAt from
    // `opts.now + FAR_FUTURE_MS`. If `now` regressed to a function seam (as it
    // was before this fix), `fn + FAR_FUTURE_MS` coerces to a concatenated
    // string, not the expected numeric sum, and the assertion below fails
    // instead of passing silently.
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const calls = [];
    const NOW_MS = 1_700_000_000_000;
    const provider = {
      async refreshCredential(binding, opts) {
        calls.push({ binding, opts });
        return { token: 'ghs_fresh', tokenExpiresAt: opts.now + FAR_FUTURE_MS, installationId: '987' };
      },
    };
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => ({});
    const persistSession = async () => {};
    const fetchImpl = async () => { throw new Error('never actually invoked — this test only checks wiring'); };
    const now = NOW_MS;

    const result = await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider, fetchImpl, now
    });

    assert.equal(calls.length, 1);
    assert.strictEqual(calls[0].opts.fetchImpl, fetchImpl, 'the exact fetchImpl instance must reach provider.refreshCredential');
    assert.strictEqual(calls[0].opts.now, now, 'the exact now value must reach provider.refreshCredential');
    assert.strictEqual(result.expiresAt, NOW_MS + FAR_FUTURE_MS, 'now must arrive as a number, not a function, for the provider to do arithmetic on');
  });

  test('D7 [fail-closed preserved]: a genuine mint failure propagates — no persist, no fabricated success, no workspace removal attempted here', async () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const provider = {
      async refreshCredential() { throw new Error('GitHub credential refresh: installation revoked'); },
    };
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => ({});
    let persistCalled = false;
    const persistSession = async () => { persistCalled = true; };

    await assert.rejects(
      () => refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider }),
      /installation revoked/
    );
    assert.equal(persistCalled, false);
  });

  test('D8 [Linear regression]: an all-Linear session is completely unaffected by resolveProvider being absent (existing callers never pass it for the Linear-only arm)', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: undefined, provider: 'linear' }),
    ];
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'refresh-A');
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persisted = [];
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'refresh-A', tokenExpiresAt: NOW + PAST_MS } });

    // No resolveProvider passed at all — the Linear arm must never call it.
    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(result.token, 'fresh-token');
    assert.equal(result.provider, 'linear');
    // LIN-1524: the session mirror carries accessToken only — refreshToken is
    // durable-store-only and never written back into the session.
    assert.equal(persisted[0].session.workspaces[0].accessToken, 'fresh-token');
    assert.equal(persisted[0].session.workspaces[0].refreshToken, undefined);
  });
});

// ---------------------------------------------------------------------------
// Block E (LIN-1499 Phase 1) — server.js's ensureValidToken branch widening
// (D2's destructive-mode-gone claim, at the level server.js itself supports)
// ---------------------------------------------------------------------------
//
// server.js is not import-safe in a unit test: importing it connects to Mongo
// and calls app.listen() at module load (confirmed by grep — `app.listen(PORT`
// runs unconditionally at the bottom of the file, no require.main guard). The
// codebase's own established answer to this — stated explicitly in this file's
// sibling tests/unit/workspace-token-refresh-integration.test.js's docstring,
// and precedented structurally in tests/unit/task-chat-route.test.js — is a
// source-text regression guard: cheap, deterministic, and it catches exactly
// the regression that matters here (the branch condition narrowing back to
// 'github' only, which is exactly how D2 was introduced/survived before this
// ticket). It does not execute ensureValidToken; Block D above proves the
// primitive the branch now calls (remintActiveCredential via the provider
// seam) behaves correctly for github-projects; this block proves server.js
// actually invokes it for github-projects instead of the Linear arm.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

describe('ensureValidToken branch widening (LIN-1499, Block E — source-text pin)', () => {
  test("E1: the re-mint branch condition covers BOTH 'github' and 'github-projects'", () => {
    // LIN-1887 Step 1 moved this condition OUT of the two dispatches and into
    // one declaration both read, so the guard no longer names the providers —
    // the table does. The D2 regression this test exists to prevent (the branch
    // narrowing back to `github` only) is unchanged in substance and is now
    // asserted where the answer actually lives.
    const conditionLine = SERVER_SRC.split('\n').find(l => l.includes("await remintActiveCredential(workspace, getProviderForWorkspace(workspace))"));
    assert.ok(conditionLine, 'expected to find the remintActiveCredential call site in server.js');
    const lines = SERVER_SRC.split('\n');
    const callIdx = lines.indexOf(conditionLine);
    const ifLine = lines.slice(0, callIdx).reverse().find(l => l.trim().startsWith('if ('));
    assert.ok(ifLine, 'expected an `if (...)` guarding the remintActiveCredential call');
    assert.match(ifLine, /declaration\.strategy === REFRESH_STRATEGY\.REMINT/, 'the re-mint arm must be selected by the shared declaration, not a re-inlined provider list');
    assert.equal(refreshStrategyFor({ provider: 'github' }), REFRESH_STRATEGY.REMINT);
    assert.equal(refreshStrategyFor({ provider: 'github-projects' }), REFRESH_STRATEGY.REMINT, "D2 regression guard: the re-mint set must not narrow back to 'github' only");
  });

  test('E2: the off-session refresh call site passes resolveProvider through to refreshOwnerWorkspaceToken', () => {
    assert.match(SERVER_SRC, /refreshOwnerWorkspaceToken\(\{[\s\S]{0,300}?resolveProvider:\s*getProviderForWorkspace/, 'expected resolveProvider: getProviderForWorkspace in the refreshOwnerWorkspaceToken call options');
  });

  test('E3: the removeWorkspace catch inside ensureValidToken is untouched — exactly one removal call in that function body (no new removal path introduced)', () => {
    // Scoped to ensureValidToken's own body (between its declaration and the
    // next top-level `async function`/`app.use` boundary) rather than the
    // whole file — server.js has a SECOND, unrelated removeWorkspace call site
    // in handleWorkspaceRemoval (the 401-retry path, LIN-1503, out of scope
    // for this ticket), so a whole-file count would conflate the two.
    const startIdx = SERVER_SRC.indexOf('async function ensureValidToken(req, res, next) {');
    assert.notEqual(startIdx, -1, 'expected to find ensureValidToken in server.js');
    const endIdx = SERVER_SRC.indexOf('\n}', SERVER_SRC.indexOf('\n', startIdx) + 1);
    const bodySlice = SERVER_SRC.slice(startIdx, endIdx);
    const removeWorkspaceCalls = (bodySlice.match(/removeWorkspace\(/g) || []).length;
    assert.equal(removeWorkspaceCalls, 1, "removeWorkspace should still be called from exactly one place inside ensureValidToken's catch — this pins that beat 2 did not touch or duplicate it");
  });
});

// ---------------------------------------------------------------------------
// Block F (LIN-1546) — race-safe refresh rotation: the shared single-flight
// seam + durable CAS + re-read recovery, driven directly at
// `refreshOwnerCredential`.
//
// Why the seam and not the human sites: server.js is not import-safe in a unit
// test (it connects to Mongo and listens at module load — see Block E's
// docstring). All three refresh entrants funnel their Linear rotation through
// this ONE seam, so exercising the seam directly with two concurrent callers
// IS the concurrent human×headless witness — and it is the seam's resolve-vs-
// throw contract that decides whether the human catches' LIN-1545 delete guard
// ever fires. A seam that RESOLVES (a race loser converging on the winner's
// token) never reaches a delete; only a seam that THROWS EXPIRED does.
//
// These tests fake Linear's rotation directly: a spent refresh token yields
// `invalid_grant` → TokenRefreshError('EXPIRED'). That premise ("reuse of a
// rotated token → invalid_grant") is Linear-side and asserted nowhere else in
// the repo (the pre-existing I2 witness passes with a SINGLE refresh and cannot
// tell a spurious race-loss from a genuine revocation — the exact gap this
// block closes).
// ---------------------------------------------------------------------------

describe('refreshOwnerCredential (LIN-1546, Block F — race-safe rotation)', () => {
  beforeEach(() => {
    _resetInflightForTests();
  });

  test('F1 [same-process human×headless coalesce]: two concurrent entrants for the same owner+workspace share ONE refresh and ONE durable rotation; both end holding the SAME valid token — there is no loser to delete', async () => {
    let callCount = 0;
    let releaseRefresh;
    const gate = new Promise(resolve => { releaseRefresh = resolve; });
    const refreshAccessToken = async (refreshToken) => {
      callCount++;
      assert.equal(refreshToken, 'R0', 'the shared refresh must spend the read token exactly once');
      await gate;
      return { access_token: 'access-R1', refresh_token: 'R1', expires_in: 3600 };
    };
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });

    // Entrant 1 = the proactive human; entrant 2 = the headless resolve. Same
    // key, launched concurrently — exactly the collision the ticket exists to
    // make safe.
    const human = refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });
    const headless = refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    releaseRefresh();
    const [r1, r2] = await Promise.all([human, headless]);

    assert.equal(callCount, 1, 'the two entrants must coalesce onto a single Linear round-trip, not race to spend R0');
    assert.equal(r1.token, 'access-R1');
    assert.equal(r2.token, 'access-R1');
    assert.equal(r1.refreshToken, 'R1');
    assert.equal(r2.refreshToken, 'R1');
    // Exactly one durable rotation landed (the shared CAS write), and the store
    // holds the winner's healthy R1 — never deleted.
    assert.equal(store.calls.length, 1, 'exactly one durable rotation for the coalesced refresh');
    assert.equal(store.calls[0].credential.refreshToken, 'R1');
    const durable = await store.get('account-A', 'acme');
    assert.equal(durable.refreshToken, 'R1', 'the healthy rotated credential survives — no spurious delete');
  });

  test('F2 [cross-process race loser converges, does NOT surface EXPIRED]: a spurious invalid_grant on a spent token, when the durable record has been rotated by the winner, RESOLVES to the winner\'s token — so no delete is ever triggered', async () => {
    // Cross-dyno: separate processes share no inflight map, so this loser really
    // does reach refreshAccessToken with the now-spent R0. The durable store,
    // however, already holds the winner's R1.
    let getCount = 0;
    const store = {
      calls: [],
      async get() {
        getCount++;
        // First read (the entrant's own): still R0 (it read just before the
        // winner's write landed). Re-read after the spurious EXPIRED: R1.
        return getCount === 1
          ? { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS }
          : { provider: 'linear', scope: 'org-1', token: 'access-R1', refreshToken: 'R1', tokenExpiresAt: NOW + FAR_FUTURE_MS };
      },
      async putIfRefreshToken() { throw new Error('must not be called — the refresh itself failed with invalid_grant'); },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'R0', 'the loser presents the now-spent R0');
      throw new TokenRefreshError('Refresh token expired or invalid', 'EXPIRED');
    };

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    // The seam RESOLVED (did not throw) with the winner's token — the loser
    // converges instead of concluding the credential is dead.
    assert.equal(result.token, 'access-R1');
    assert.equal(result.refreshToken, 'R1');
    assert.equal(getCount, 2, 'the re-read on invalid_grant is what neutralizes the spurious EXPIRED');
  });

  test('F3 [CAS-lost to the 4th writer (OAuth re-login) converges, fails safe]: the network refresh succeeds but the durable record was replaced under us; the CAS misses and the seam converges on the replacement rather than clobbering it', async () => {
    // Models routes/auth.js re-login (mints from an auth code, not a refresh):
    // between our read of R0 and our CAS write, it replaced the record with
    // R_relogin. The CAS on {refreshToken: R0} misses; we must re-read and
    // return the live re-login token, never throw and never overwrite it.
    let getCount = 0;
    const store = {
      casAttempts: [],
      async get() {
        getCount++;
        return getCount === 1
          ? { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS }
          : { provider: 'linear', scope: 'org-1', token: 'access-relogin', refreshToken: 'R_relogin', tokenExpiresAt: NOW + FAR_FUTURE_MS };
      },
      async putIfRefreshToken(accountId, urlKey, expected) {
        this.casAttempts.push(expected);
        return false; // stored refreshToken is no longer R0 → CAS miss (fail safe)
      },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async () => ({ access_token: 'access-R_loser', refresh_token: 'R_loser', expires_in: 3600 });

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.deepEqual(store.casAttempts, ['R0'], 'the CAS is witnessed on the token we actually read');
    assert.equal(result.token, 'access-relogin', 'converges on the re-login token, not our own now-orphaned refresh');
    assert.equal(result.refreshToken, 'R_relogin');
  });

  test('F4 [genuine revocation still surfaces EXPIRED after the re-read]: when nobody rotated the record, a real invalid_grant re-throws EXPIRED so the caller\'s LIN-1545 delete guard can remove a genuinely dead credential', async () => {
    let getCount = 0;
    const store = {
      async get() {
        getCount++;
        // Every read shows the SAME spent token — nobody rotated it. This is a
        // genuine revocation, not a race.
        return { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R_dead', tokenExpiresAt: NOW + PAST_MS };
      },
      async putIfRefreshToken() { throw new Error('must not be called — the refresh failed'); },
      async delete() { throw new Error('the seam must never delete — deletes live in the human catches (LIN-1545)'); },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async () => { throw new TokenRefreshError('Refresh token expired or invalid', 'EXPIRED'); };

    await assert.rejects(
      () => refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store }),
      (err) => {
        assert.ok(err instanceof TokenRefreshError);
        assert.equal(err.code, 'EXPIRED', 'a genuine revocation must still surface EXPIRED, so the caller deletes the dead credential');
        return true;
      }
    );
    assert.equal(getCount, 2, 'the re-read ran (and confirmed the token was unchanged) before concluding the credential is dead');
  });

  test('F5 [CAS miss + nothing to converge on → transient, NOT EXPIRED]: a successful refresh whose durable write is lost (record deleted under us, or a store blip) must fail TRANSIENTLY — never EXPIRED — because the credential is demonstrably alive (we just refreshed it), so the LIN-1545 delete guard must not fire', async () => {
    let getCount = 0;
    const store = {
      async get() {
        getCount++;
        return getCount === 1
          ? { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS }
          : null; // a concurrent disconnect deleted it (or a store blip) before our CAS
      },
      async putIfRefreshToken() { return false; },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async () => ({ access_token: 'access-R_loser', refresh_token: 'R_loser', expires_in: 3600 });

    await assert.rejects(
      () => refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store }),
      (err) => {
        assert.ok(err instanceof TokenRefreshError);
        assert.notEqual(err.code, 'EXPIRED', 'must not be definitive — a live-but-unpersistable credential must never be deleted');
        assert.equal(err.code, 'UNKNOWN', 'a transient code so the caller 503s and keeps the credential + workspace');
        return true;
      }
    );
  });

  test('F6 [transient blip is never re-read]: a NETWORK failure propagates untouched — it is not a race artifact, so the seam must NOT re-read or swallow it (the caller\'s transient-503 branch depends on seeing it)', async () => {
    let getCount = 0;
    const store = {
      async get() { getCount++; return { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS }; },
      async putIfRefreshToken() { throw new Error('must not be called'); },
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async () => { throw new TokenRefreshError('boom', 'NETWORK'); };

    await assert.rejects(
      () => refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store }),
      (err) => { assert.equal(err.code, 'NETWORK'); return true; }
    );
    assert.equal(getCount, 1, 'a transient blip triggers NO re-read — only a definitive EXPIRED does');
  });

  test('F7 [nothing to refresh → null, unchanged]: no durable record (or one without a refreshToken) resolves null without a network call', async () => {
    const store = fakeStore(); // empty
    let refreshCalled = false;
    const refreshAccessToken = async () => { refreshCalled = true; return {}; };

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });
    assert.equal(result, null);
    assert.equal(refreshCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Block G — pure sibling selector `selectOwnerWorkspaceRow`
// ---------------------------------------------------------------------------

describe('selectOwnerWorkspaceRow (LIN-1986, Block G — pure selector)', () => {
  test('G1: owner has a live row for this urlKey -> returns the workspace row', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'live', expiresAt: NOW + FAR_FUTURE_MS, provider: 'linear' }),
    ];
    const ws = selectOwnerWorkspaceRow(sessions, 'acme', 'account-A');
    assert.equal(ws.accessToken, 'live');
    assert.equal(ws.urlKey, 'acme');
    assert.equal(ws.provider, 'linear');
  });

  test('G2: owner has only an EXPIRED row -> null (a live row is required, not merely a matching one)', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS }),
    ];
    assert.equal(selectOwnerWorkspaceRow(sessions, 'acme', 'account-A'), null);
  });

  test('G3: no session for this owner/urlKey at all -> null', () => {
    const sessions = [
      sessionRow('sid-1', 'account-B', 'acme', { accessToken: 'live', expiresAt: NOW + FAR_FUTURE_MS }),
    ];
    assert.equal(selectOwnerWorkspaceRow(sessions, 'acme', 'account-A'), null);
  });

  test('G4: null/empty owner -> null, never scans owner-blind (no UNSCOPED mode here, unlike selectOwnerWorkspaceToken)', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'live', expiresAt: NOW + FAR_FUTURE_MS }),
    ];
    assert.equal(selectOwnerWorkspaceRow(sessions, 'acme', null), null);
    assert.equal(selectOwnerWorkspaceRow(sessions, 'acme', undefined), null);
  });

  test('G5: among the owner\'s own multiple live rows, picks the latest-expiring (plain max-expiry, no provider comparison)', () => {
    const sessions = [
      sessionRow('sid-older', 'account-A', 'acme', { accessToken: 'older-live', expiresAt: NOW + FAR_FUTURE_MS, provider: 'jira' }),
      sessionRow('sid-newer', 'account-A', 'acme', { accessToken: 'newer-live', expiresAt: NOW + FURTHER_FUTURE_MS, provider: 'linear' }),
    ];
    const ws = selectOwnerWorkspaceRow(sessions, 'acme', 'account-A');
    assert.equal(ws.accessToken, 'newer-live', 'later expiry wins even though it is a DIFFERENT provider than the shorter-lived row — deliberate: F1 deleted the provider-matching heuristic rather than repairing it');
  });

  test('G6: only scans the owner\'s OWN sessions — another account\'s live row never wins (the LIN-1986 cross-account exposure this selector closes)', () => {
    const sessions = [
      sessionRow('sid-B', 'account-B', 'acme', { accessToken: 'other-owner-live', expiresAt: NOW + FURTHER_FUTURE_MS }),
      sessionRow('sid-A', 'account-A', 'acme', { accessToken: 'owner-live', expiresAt: NOW + FAR_FUTURE_MS }),
    ];
    const ws = selectOwnerWorkspaceRow(sessions, 'acme', 'account-A');
    assert.equal(ws.accessToken, 'owner-live');
  });

  test('G7: a row within the refresh buffer (not yet expired, but not far enough out) is not usable -> null', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'about-to-expire', expiresAt: NOW + 60_000 }), // < 5min buffer
    ];
    assert.equal(selectOwnerWorkspaceRow(sessions, 'acme', 'account-A'), null);
  });

  test('G8: selectOwnerWorkspaceToken itself is untouched by this addition (still returns a token, not a row, for the same fixture)', () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'live', expiresAt: NOW + FAR_FUTURE_MS }),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'live');
    assert.equal(result.reason, 'ok');
  });
});

// ---------------------------------------------------------------------------
// Block H (LIN-2097) — freeze expiry on a byte-identical exchange, and null
// out a refresh result whose resulting expiry is not (comfortably) live.
//
// Driven directly at `refreshOwnerCredential`, the same seam Block F drives —
// server.js is not import-safe in a unit test (see Block E/F's docstrings).
// ---------------------------------------------------------------------------

describe('refreshOwnerCredential (LIN-2097, Block H — freeze + non-live boundary)', () => {
  beforeEach(() => {
    _resetInflightForTests();
  });

  test('H1 [freeze, still-future stored expiry]: a byte-identical exchange keeps the STORED expiry, not a fresh calculateExpiresAt one, and still rotates refreshToken', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: NOW + FAR_FUTURE_MS } });
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'R0');
      return { access_token: 'access-SAME', refresh_token: 'R1-rotated', expires_in: 3600 };
    };

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.equal(result.expiresAt, NOW + FAR_FUTURE_MS, 'frozen at the stored expiry, not a fresh now+3600s');
    assert.equal(result.refreshToken, 'R1-rotated');
    const durable = await store.get('account-A', 'acme');
    assert.equal(durable.refreshToken, 'R1-rotated', 'the rotated refreshToken is still persisted unconditionally');
    assert.equal(durable.tokenExpiresAt, NOW + FAR_FUTURE_MS);
  });

  test('H2 [B1: freeze + already-past stored expiry -> refreshOwnerCredential returns the RAW frozen result, not null]: the liveness null-check no longer lives on this shared seam — it moved to doRefresh\'s headless call site (see Block J) so a non-live result never reaches the two human refresh entrants (server.js\'s ensureValidToken / handleTokenRefreshAndRetry), which call refreshOwnerCredential directly and would otherwise tear the workspace down on a plain null', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });
    const refreshAccessToken = async () => ({ access_token: 'access-SAME', refresh_token: 'R1-rotated', expires_in: 3600 });

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.notEqual(result, null, 'refreshOwnerCredential itself must stay raw — the non-live check is not its job');
    assert.equal(result.expiresAt, NOW + PAST_MS, 'frozen at the stored (already-past) expiry, unfiltered');
    const durable = await store.get('account-A', 'acme');
    assert.equal(durable.refreshToken, 'R1-rotated', 'the rotated refreshToken is still persisted unconditionally');
    assert.equal(durable.tokenExpiresAt, NOW + PAST_MS, 'the durable record carries the frozen (past) expiry');
  });

  test('H3 [control, unaffected]: DIFFERENT access-token bytes take the ordinary calculateExpiresAt path — Steps 1-2 never fire on ordinary rotation', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-OLD', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });
    const refreshAccessToken = async () => ({ access_token: 'access-NEW', refresh_token: 'R1', expires_in: 3600 });

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.notEqual(result, null);
    assert.equal(result.token, 'access-NEW');
    assert.ok(result.expiresAt > NOW, 'a genuinely rotated credential gets a fresh future expiry, not the old stored one');
    assert.notEqual(result.expiresAt, NOW + PAST_MS);
  });

  test('H4 [regression pin — the production signature]: N repeated forced refreshes returning the SAME bytes against a live stored expiry must yield IDENTICAL, non-null expiry every round — not N distinct advancing values', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: NOW + FAR_FUTURE_MS } });
    let refreshCount = 0;
    const refreshAccessToken = async (refreshToken) => {
      refreshCount++;
      return { access_token: 'access-SAME', refresh_token: `R${refreshCount}-rotated`, expires_in: 3600 };
    };

    const results = [];
    for (let i = 0; i < 5; i++) {
      _resetInflightForTests();
      results.push(await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store }));
    }

    assert.equal(refreshCount, 5);
    for (const result of results) {
      assert.notEqual(result, null);
      assert.equal(result.expiresAt, NOW + FAR_FUTURE_MS, 'frozen — not vacuously null, and not monotonically increasing across rounds');
    }
  });

  test('H5 [F3\'s regression pin, B1-revised]: a CAS-loss convergence onto an already-frozen-past re-read record still resolves the RAW (non-null) convergeOnStored result from refreshOwnerCredential — doRefresh\'s own boundary check (Block J) is what nulls this case out for the headless caller', async () => {
    let getCount = 0;
    const store = {
      async get() {
        getCount++;
        return getCount === 1
          ? { provider: 'linear', scope: 'org-1', token: 'stale', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS }
          : { provider: 'linear', scope: 'org-1', token: 'access-relogin', refreshToken: 'R_relogin', tokenExpiresAt: NOW + PAST_MS };
      },
      async putIfRefreshToken() { return false; }, // CAS miss — the record was replaced under us
      async markSpendIntent() { return true; },
      async clearSpendIntent() { return true; },
    };
    const refreshAccessToken = async () => ({ access_token: 'access-R_loser', refresh_token: 'R_loser', expires_in: 3600 });

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.notEqual(result, null, 'refreshOwnerCredential stays raw for this branch too — F3 (all three doOwnerRefresh success returns) is still structurally covered, just one hop downstream at doRefresh');
    assert.equal(result.token, 'access-relogin');
    assert.equal(result.expiresAt, NOW + PAST_MS);
  });

  test('H6 [M3]: freezing requires a FINITE stored expiry — a byte-identical exchange against a record with a non-numeric tokenExpiresAt falls back to a fresh calculateExpiresAt instead of freezing onto NaN/undefined', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: undefined } });
    const refreshAccessToken = async () => ({ access_token: 'access-SAME', refresh_token: 'R1-rotated', expires_in: 3600 });

    const result = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', refreshAccessToken, store });

    assert.notEqual(result, null);
    assert.ok(Number.isFinite(result.expiresAt), 'must not freeze onto a non-finite stored expiry');
    assert.ok(result.expiresAt > NOW, 'falls back to a fresh future expiry, exactly as a genuinely different credential would');
  });
});

// ---------------------------------------------------------------------------
// Block J (LIN-2097, B1) — the liveness boundary check, relocated. Drives
// `refreshOwnerWorkspaceToken` (doRefresh's headless entrant) to prove it DOES
// null out a non-live frozen result, and drives `refreshOwnerCredential`
// directly (the seam the two human entrants call) to prove it does NOT — the
// exact split the B1 review finding demanded, so a non-live result never
// reaches `ensureValidToken`/`handleTokenRefreshAndRetry` (server.js) and tears
// a workspace/session down on what is, for those callers, an ordinary refresh.
// ---------------------------------------------------------------------------

describe('LIN-2097 (Block J) — the non-live liveness check lives on doRefresh only, not on the refreshOwnerCredential seam shared with the human entrants', () => {
  beforeEach(() => {
    _resetInflightForTests();
  });

  test('J1 [headless nulls]: refreshOwnerWorkspaceToken (doRefresh) resolves null when a byte-identical exchange freezes onto an already-past stored expiry — the exact case H2 shows refreshOwnerCredential itself no longer filters', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });
    const refreshAccessToken = async () => ({ access_token: 'access-SAME', refresh_token: 'R1-rotated', expires_in: 3600 });
    const persistSession = async () => { throw new Error('must not be called — no session row exists for this owner'); };

    const result = await refreshOwnerWorkspaceToken({ sessions: [], urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(result, null, 'the headless caller must not be handed a dead-but-frozen credential as a success');
    const durable = await store.get('account-A', 'acme');
    assert.equal(durable.refreshToken, 'R1-rotated', 'persistence still lands — the null is return-only, mirroring H2');
  });

  test('J2 [headless nulls, session-mirroring case]: when an owner session row DOES exist, a non-live frozen result is neither returned NOR mirrored into it', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'access-SAME', expiresAt: NOW + PAST_MS, refreshToken: undefined }),
    ];
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });
    const refreshAccessToken = async () => ({ access_token: 'access-SAME', refresh_token: 'R1-rotated', expires_in: 3600 });
    const persisted = [];
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };

    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession, store });

    assert.equal(result, null);
    assert.equal(persisted.length, 0, 'a non-live result must not be mirrored into the session row either — that would cache a dead expiry as if it were live');
  });

  test('J3 [human entrant, B1 fix]: refreshOwnerCredential — the seam ensureValidToken/handleTokenRefreshAndRetry call directly — returns the raw frozen-but-past result rather than null, so a plain proactive refresh does NOT throw and tear the workspace down', async () => {
    const store = fakeStore({ 'account-A::acme::linear': { provider: 'linear', scope: 'org-1', token: 'access-SAME', refreshToken: 'R0', tokenExpiresAt: NOW + PAST_MS } });
    const refreshAccessToken = async () => ({ access_token: 'access-SAME', refresh_token: 'R1-rotated', expires_in: 3600 });

    // This mirrors server.js's ensureValidToken/handleTokenRefreshAndRetry: both
    // call refreshOwnerCredential directly and throw a plain Error ONLY on a
    // falsy return, which server.js's destructiveOnFailure branch then treats as
    // grounds to remove the workspace (and, if it's the account's last, destroy
    // the session). A non-null return here means that destructive path is never
    // even reached for this case.
    const refreshed = await refreshOwnerCredential({ ownerAccountId: 'account-A', urlKey: 'acme', provider: 'linear', refreshAccessToken, store });
    assert.notEqual(refreshed, null, 'B1: must not be null — a null here is exactly what server.js reads as "credential unrefreshable" and tears the workspace down for');
    assert.equal(refreshed.token, 'access-SAME');
    assert.equal(refreshed.expiresAt, NOW + PAST_MS);
  });
});

// ---------------------------------------------------------------------------
// Block I (LIN-2097, source-text pin) — server.js is not import-safe in a
// unit test (see Block E's docstring), so the :1865 gate wiring is pinned as
// source text; its actual suppression BEHAVIOUR is proven directly against
// the real module in tests/unit/refresh-on-resolve-gate.test.js.
// ---------------------------------------------------------------------------

describe('resolveWorkspaceAccess refresh-on-resolve gate (LIN-2097, Block I — source-text pin)', () => {
  test("I1: the refresh-on-resolve block fingerprints the stale durable record's TOKEN, not its scope (the Linear org id) — and gates the exchange through refreshOnResolveGate", () => {
    const startIdx = SERVER_SRC.indexOf('if (!selected.token && ownerAccountId !== UNSCOPED) {');
    assert.notEqual(startIdx, -1, 'expected to find the refresh-on-resolve block in server.js');
    const endIdx = SERVER_SRC.indexOf('\n    }', startIdx);
    const blockSlice = SERVER_SRC.slice(startIdx, endIdx);

    assert.match(blockSlice, /ownerCredentialStore\.get\(ownerAccountId, urlKey, selected\.provider\)/, 'expected a durable point-read for the stale record');
    assert.match(blockSlice, /fingerprintCredential\(staleRecord\.token\)/, 'must fingerprint staleRecord.token');
    assert.doesNotMatch(blockSlice, /fingerprintCredential\(staleRecord\.scope/, 'must NOT fingerprint staleRecord.scope — for Linear that is the org id, not the credential');
    assert.match(blockSlice, /refreshOnResolveGate\.shouldAttempt\(/, 'expected the new gate to guard the exchange attempt');
  });

  test('I2: the gate is unconditional — NOT additionally gated on rejectedCredentialRegistry.isSuspect (that mark\'s TTL is shorter than how long this branch must keep applying)', () => {
    const startIdx = SERVER_SRC.indexOf('if (!selected.token && ownerAccountId !== UNSCOPED) {');
    const endIdx = SERVER_SRC.indexOf('\n    }', startIdx);
    const blockSlice = SERVER_SRC.slice(startIdx, endIdx);
    assert.doesNotMatch(blockSlice, /rejectedCredentialRegistry\.isSuspect/, 'this branch must not require isSuspect to still be true');
  });

  test("I3: the new gate uses its OWN scopeKey/state — attemptSuspectCredentialRefresh's own cooldown gate (:1954-ish) is untouched, still calling shouldAttemptRefresh with its pre-existing scopeKey shape", () => {
    assert.match(SERVER_SRC, /rejectedCredentialRegistry\.shouldAttemptRefresh\(fingerprint, `\$\{ownerAccountId\}:\$\{urlKey\}`\)/, "attemptSuspectCredentialRefresh's own gate must still be present, unmodified");
  });

  test('I4: refreshOnResolveGate is constructed once at module scope via createRefreshOnResolveGate, mirroring rejectedCredentialRegistry\'s own single-shared-instance pattern', () => {
    assert.match(SERVER_SRC, /const refreshOnResolveGate = createRefreshOnResolveGate\(\)/);
    assert.match(SERVER_SRC, /import \{ createRefreshOnResolveGate \} from '\.\/lib\/refresh-on-resolve-gate\.js'/);
  });
});
