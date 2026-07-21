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
 *
 * Run with: node --test tests/unit/workspace-token-refresh.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

  test('D5 [no Linear contamination]: a GitHub workspace never gains a refreshToken after refresh, even though updateWorkspaceTokens is never called for it', async () => {
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const provider = fakeMintProvider({ token: 'ghs_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '987' }, []);
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => ({ access_token: 'WRONG', refresh_token: 'WRONG', expires_in: 3600 });
    const persisted = [];
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };

    await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider });

    const persistedWs = persisted[0].session.workspaces[0];
    // A GitHub-shaped patch ({token, tokenExpiresAt, installationId}) fed to the
    // Linear-wire-shaped updateWorkspaceTokens (access_token/refresh_token/
    // expires_in) would set refreshToken=undefined and tokenExpiresAt=NaN. The
    // real assertion is simpler and stronger: refreshToken must still be
    // undefined, and tokenExpiresAt must be the real minted number, not NaN.
    assert.equal(persistedWs.refreshToken, undefined);
    assert.equal(persistedWs.tokenExpiresAt, NOW + FAR_FUTURE_MS);
    assert.equal(Number.isNaN(persistedWs.tokenExpiresAt), false);
  });

  test('D6 [seam load-bearing, LIN-1499 item 4]: {fetchImpl, now} passed into refreshOwnerWorkspaceToken reach provider.refreshCredential unchanged', async () => {
    // This is the plumbing proof that beat 1's remintActiveCredential passthrough
    // is load-bearing: if that passthrough were reverted (provider.refreshCredential(active)
    // called with no second argument), the fake provider below would receive
    // `opts === undefined`, and the strict-equal identity assertions on
    // receivedOpts.fetchImpl/now would fail. A test that only checked the
    // refresh SUCCEEDED would still pass with the passthrough reverted (the fake
    // ignores unused args) — asserting on referential identity of the received
    // opts is what makes this a real proof, not a decorative one.
    const sessions = [
      githubSessionRow('sid-1', 'account-A', 'acme-gh', { accessToken: 'stale-gh', expiresAt: NOW + PAST_MS, installationId: '987' }),
    ];
    const calls = [];
    const provider = fakeMintProvider({ token: 'ghs_fresh', tokenExpiresAt: NOW + FAR_FUTURE_MS, installationId: '987' }, calls);
    const resolveProvider = () => provider;
    const refreshAccessToken = async () => ({});
    const persistSession = async () => {};
    const fetchImpl = async () => { throw new Error('never actually invoked — this test only checks wiring'); };
    const now = () => 999;

    await refreshOwnerWorkspaceToken({
      sessions, urlKey: 'acme-gh', ownerAccountId: 'account-A', refreshAccessToken, persistSession, resolveProvider, fetchImpl, now
    });

    assert.equal(calls.length, 1);
    assert.strictEqual(calls[0].opts.fetchImpl, fetchImpl, 'the exact fetchImpl instance must reach provider.refreshCredential');
    assert.strictEqual(calls[0].opts.now, now, 'the exact now instance must reach provider.refreshCredential');
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
      sessionRow('sid-1', 'account-A', 'acme', { accessToken: 'stale', expiresAt: NOW + PAST_MS, refreshToken: 'refresh-A', provider: 'linear' }),
    ];
    const refreshAccessToken = async (refreshToken) => {
      assert.equal(refreshToken, 'refresh-A');
      return { access_token: 'fresh-token', refresh_token: 'refresh-A-rotated', expires_in: 3600 };
    };
    const persisted = [];
    const persistSession = async (sid, session) => { persisted.push({ sid, session }); };

    // No resolveProvider passed at all — the Linear arm must never call it.
    const result = await refreshOwnerWorkspaceToken({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', refreshAccessToken, persistSession });

    assert.equal(result.token, 'fresh-token');
    assert.equal(result.provider, 'linear');
    assert.equal(persisted[0].session.workspaces[0].refreshToken, 'refresh-A-rotated');
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
    const conditionLine = SERVER_SRC.split('\n').find(l => l.includes("await remintActiveCredential(workspace, getProviderForWorkspace(workspace))"));
    assert.ok(conditionLine, 'expected to find the remintActiveCredential call site in server.js');
    // Walk back to find the `if (...)` guarding this call.
    const lines = SERVER_SRC.split('\n');
    const callIdx = lines.indexOf(conditionLine);
    const ifLine = lines.slice(0, callIdx).reverse().find(l => l.trim().startsWith('if ('));
    assert.ok(ifLine, 'expected an `if (...)` guarding the remintActiveCredential call');
    assert.match(ifLine, /provider === 'github'/);
    assert.match(ifLine, /provider === 'github-projects'/, "D2 regression guard: the branch must not narrow back to 'github' only");
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
