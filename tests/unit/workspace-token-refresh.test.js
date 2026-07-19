/**
 * Unit tests for LIN-1373: proxy-token refresh-on-resolve.
 *
 * Before this fix, `resolveWorkspaceAccess` (server.js) only ever READ
 * sessions via the pure selector `selectOwnerWorkspaceToken` — a headless
 * proxy token stopped resolving the instant its creating human's Linear
 * access token lapsed, because only human web activity (`ensureValidToken`)
 * ever refreshed it, and that middleware structurally no-ops for a
 * session-less agent request.
 *
 * Block A drives the new pure sibling selector `selectExpiredOwnerRow`
 * (lib/workspace-token-resolver.js) directly.
 * Block B drives `refreshOwnerWorkspaceToken` (lib/workspace-token-refresh.js)
 * with fake IO (refreshAccessToken, persistSession) — refresh success,
 * rotation, failure fall-through, missing refresh token, single-flight
 * coalescing, and TTL preservation.
 *
 * Run with: node --test tests/unit/workspace-token-refresh.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { selectExpiredOwnerRow, selectOwnerWorkspaceToken } from '../../lib/workspace-token-resolver.js';
import { refreshOwnerWorkspaceToken, _resetInflightForTests } from '../../lib/workspace-token-refresh.js';
import { TokenRefreshError } from '../../lib/token-refresh.js';

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000; // ~2.8h — comfortably past the 5-minute refresh buffer
const FURTHER_FUTURE_MS = 50_000_000; // ~13.9h — a later expiry than FAR_FUTURE_MS
const PAST_MS = -10_000; // already expired
const FURTHER_PAST_MS = -20_000; // expired even earlier

function sessionRow(sid, accountId, urlKey, { accessToken, expiresAt, refreshToken, provider = 'linear' }) {
  return { _id: sid, session: { accountId, workspaces: [{ urlKey, provider, accessToken, tokenExpiresAt: expiresAt, refreshToken }] } };
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

describe('refreshOwnerWorkspaceToken (LIN-1373, Block B — refresh orchestration)', () => {
  beforeEach(() => {
    _resetInflightForTests();
  });

  test('B1: refreshes the expired owner row, persists to the correct sid, and returns the fresh token', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];
    const persisted = [];
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'refresh-A');
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };

    const result = await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession
    });

    assert.equal(result.token, 'fresh-token');
    assert.ok(result.expiresAt > Date.now());
    assert.equal(result.provider, 'linear');

    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].sid, 'sid-1');
    assert.equal(persisted[0].session.workspaces[0].accessToken, 'fresh-token');
  });

  test('B2: rotation — the NEW refresh_token (not the old) is what gets persisted', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A-old' }),
    ];
    const persisted = [];
    const refreshAccessToken = async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-A-new', expires_in: 3600 });
    const persistSession = async (sid, session) => { persisted.push(session); };

    await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });

    assert.equal(persisted[0].workspaces[0].refreshToken, 'refresh-A-new');
    assert.notEqual(persisted[0].workspaces[0].refreshToken, 'refresh-A-old');
  });

  test('B3: refresh throws EXPIRED -> propagates to the caller, no persist, no swallowing into a fake success', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'dead-refresh' }),
    ];
    let persistCalled = false;
    const refreshAccessToken = async () => { throw new TokenRefreshError('Refresh token expired or invalid', 'EXPIRED'); };
    const persistSession = async () => { persistCalled = true; };

    await assert.rejects(
      () => refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession }),
      TokenRefreshError
    );
    assert.equal(persistCalled, false);
  });

  test('B4: single-flight — two concurrent calls for the same (owner, urlKey) invoke refreshAccessToken exactly once, both resolve to the fresh token', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];
    let callCount = 0;
    let releaseRefresh;
    const gate = new Promise(resolve => { releaseRefresh = resolve; });
    const refreshAccessToken = async () => {
      callCount++;
      await gate;
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persistSession = async () => {};

    const p1 = refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });
    const p2 = refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });

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
      return { access_token: `fresh-token-${callCount}`, refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persistSession = async () => {};

    // Each call gets its own freshly-fetched session snapshot — mirroring real
    // usage, where server.js re-reads sessionsCollection.find({}).toArray() on
    // every resolveWorkspaceAccess call rather than reusing a stale array.
    const freshLapsedSessions = () => [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];

    const r1 = await refreshOwnerWorkspaceToken({ sessions: freshLapsedSessions(), urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });
    const r2 = await refreshOwnerWorkspaceToken({ sessions: freshLapsedSessions(), urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });

    assert.equal(callCount, 2);
    assert.equal(r1.token, 'fresh-token-1');
    assert.equal(r2.token, 'fresh-token-2');
  });

  test('B6: single-flight cleanup after FAILURE — a later independent call still attempts its own refresh (the map entry was removed, not stuck)', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];
    let callCount = 0;
    const refreshAccessToken = async () => {
      callCount++;
      if (callCount === 1) throw new TokenRefreshError('boom', 'NETWORK');
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persistSession = async () => {};

    await assert.rejects(() => refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession }));
    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });

    assert.equal(callCount, 2);
    assert.equal(result.token, 'fresh-token');
  });

  test('B7: TTL preserved — persistSession is called with only the session content; caller (server.js) is responsible for never routing this through the TTL-rolling session store', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A' }),
    ];
    const persistCalls = [];
    const refreshAccessToken = async () => ({ access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 });
    // A fake persistSession that asserts it is called with exactly (sid, session) —
    // no third "options"/"expires" argument that could smuggle a TTL roll in.
    const persistSession = async (...args) => {
      assert.equal(args.length, 2);
      persistCalls.push(args);
    };

    await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });
    assert.equal(persistCalls.length, 1);
  });

  test('B8: missing refreshToken on the owner\'s expired row -> resolves null, no network call, no persist', async () => {
    const sessions = [
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: undefined }),
    ];
    let refreshCalled = false;
    let persistCalled = false;
    const refreshAccessToken = async () => { refreshCalled = true; return {}; };
    const persistSession = async () => { persistCalled = true; };

    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });

    assert.equal(result, null);
    assert.equal(refreshCalled, false);
    assert.equal(persistCalled, false);
  });

  test('B9: no matching session row at all -> resolves null, no network call', async () => {
    const sessions = [];
    let refreshCalled = false;
    const refreshAccessToken = async () => { refreshCalled = true; return {}; };
    const persistSession = async () => {};

    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });

    assert.equal(result, null);
    assert.equal(refreshCalled, false);
  });
});
