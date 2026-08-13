/**
 * Unit tests for LIN-1366: Linear-token owner isolation — the Linear-token
 * twin of tests/unit/quota-isolation.test.js (LIN-1353).
 *
 * Before this fix, `resolveWorkspaceAccess(urlKey)` picked the latest-expiring
 * token from ANY session referencing the workspace — owner-blind. An agent
 * calling the proxy under one connected user's token could silently write to
 * Linear under a DIFFERENT connected user's identity. The fix threads the
 * proxy token's owning account (`req.proxyCreatedBy`) into token resolution
 * and fails closed (never falls back owner-blind) when no token for that
 * owner exists.
 *
 * Block A drives the pure selector directly (lib/workspace-token-resolver.js).
 * Block B drives the real wiring end-to-end over HTTP: a real `ProxyTokenStore`
 * mints tokens with a real `createdBy`, and a recording spy resolver captures
 * the `(urlKey, ownerAccountId)` args every in-scope call site forwards, so the
 * threading itself — not just the pure selector — is proven.
 *
 * Run with: node --test tests/unit/linear-token-isolation.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createProxyRoutes } from '../../routes/proxy.js';
import { ProxyTokenStore } from '../../lib/proxy-tokens.js';
import { selectOwnerWorkspaceToken, detectOwnerAccountMismatch, detectOwnerSignedOut, classifyWorkspaceFailure, describeWorkspaceResolution, UNSCOPED } from '../../lib/workspace-token-resolver.js';
import { OwnerCredentialStore } from '../../lib/owner-credential-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(join(__dirname, '../../server.js'), 'utf8');

// ---------------------------------------------------------------------------
// Block A — pure selector `selectOwnerWorkspaceToken` (7 cases)
// ---------------------------------------------------------------------------

const NOW = Date.now();
const FAR_FUTURE_MS = 10_000_000; // ~2.8h — comfortably past the 5-minute refresh buffer
const FURTHER_FUTURE_MS = 50_000_000; // ~13.9h — a later expiry than FAR_FUTURE_MS
const PAST_MS = -10_000; // already expired

function sessionRow(accountId, urlKey, accessToken, expiresAt, provider = 'linear') {
  return { session: { accountId, workspaces: [{ urlKey, provider, accessToken, tokenExpiresAt: expiresAt }] } };
}

// LIN-1506: a session row for a DIFFERENT workspace than the one under test —
// expresses case (b), which the flat sessionRow() above structurally cannot
// (its single workspaces[] entry always matches the urlKey being tested). This
// is the shape a signed-in owner who simply never connected THIS workspace
// produces: a live session, just not one that references `testedUrlKey`.
// detectOwnerSignedOut is workspace-independent (Q1) and must return false
// against this fixture — only this helper can prove that.
function otherWorkspaceSessionRow(accountId, otherUrlKey, accessToken, expiresAt, provider = 'linear') {
  return { session: { accountId, workspaces: [{ urlKey: otherUrlKey, provider, accessToken, tokenExpiresAt: expiresAt }] } };
}

describe('selectOwnerWorkspaceToken (LIN-1366, Block A — pure selector)', () => {
  test('A1: owner isolation — account A never receives account B\'s token, even though B\'s expires later (the bug removed)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FURTHER_FUTURE_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tokA');
    assert.notEqual(result.token, 'tokB');
    assert.equal(result.reason, 'ok');
  });

  test('A2: no session for the owning account references this workspace -> not_connected (fail closed, no fallback)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, null);
    assert.equal(result.reason, 'not_connected');
  });

  test('A3: owner has a session for this workspace but its token is expired -> session_expired', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, null);
    assert.equal(result.reason, 'session_expired');
  });

  test('A4: legacy null/empty owner fails closed and never borrows another account\'s token', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
      // Even a session with a matching null accountId must not be borrowed.
      { session: { accountId: null, workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'tok-null-owner', tokenExpiresAt: NOW + FAR_FUTURE_MS }] } },
    ];
    // LIN-1448: still fails closed, but under its OWN reason. It used to return
    // `not_connected`, which is indistinguishable from a genuinely disconnected
    // workspace — the ambiguity that cost ~100 minutes on 2026-07-25 (LIN-1576),
    // during which four sessions independently concluded "a human must reconnect
    // the workspace" and the owner acted on that twice, to no effect. Selection
    // itself is unchanged: no token, no borrowing.
    const nullResult = selectOwnerWorkspaceToken(sessions, 'acme', null);
    assert.equal(nullResult.token, null);
    assert.equal(nullResult.reason, 'token_ownerless');

    const emptyResult = selectOwnerWorkspaceToken(sessions, 'acme', '');
    assert.equal(emptyResult.token, null);
    assert.equal(emptyResult.reason, 'token_ownerless');
  });

  test('A4b (LIN-1448): a REAL owner with no session for the workspace still reports not_connected', () => {
    // The counterweight to A4: the new reason must be scoped to "the token has no
    // owner", never widened into "this owner has no session". Otherwise the fix
    // just moves the ambiguity instead of removing it.
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, null);
    assert.equal(result.reason, 'not_connected');
  });

  test('A5: the UNSCOPED sentinel preserves legacy owner-blind selection (latest-expiring across ALL accounts)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FURTHER_FUTURE_MS),
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', UNSCOPED);
    assert.equal(result.token, 'tokB');
    assert.equal(result.reason, 'ok');

    // Omitting the third argument entirely defaults to UNSCOPED.
    const defaulted = selectOwnerWorkspaceToken(sessions, 'acme');
    assert.equal(defaulted.token, 'tokB');
  });

  test('A6: the latest-expiring token is selected only among the owner\'s OWN sessions', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-old', NOW + FAR_FUTURE_MS),
      sessionRow('account-A', 'acme', 'tokA-new', NOW + FURTHER_FUTURE_MS),
      // B's session expires later than BOTH of A's, but must never win for A.
      { session: { accountId: 'account-B', workspaces: [{ urlKey: 'acme', provider: 'linear', accessToken: 'tokB', tokenExpiresAt: NOW + FURTHER_FUTURE_MS + 1_000_000 }] } },
    ];
    const result = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(result.token, 'tokA-new');
  });

  test('A7: fail-closed results still surface `provider` (owner-blind) for the write capability gate', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS, 'linear'),
    ];
    const noMatch = selectOwnerWorkspaceToken(sessions, 'acme', 'account-A');
    assert.equal(noMatch.token, null);
    assert.equal(noMatch.provider, 'linear');

    const expiredOnly = selectOwnerWorkspaceToken(
      [sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS, 'linear')],
      'acme',
      'account-A'
    );
    assert.equal(expiredOnly.token, null);
    assert.equal(expiredOnly.provider, 'linear');
  });

  test('A8 (LIN-1891): `scope` carries the winning row\'s structured provider call scope, additive alongside `token`', () => {
    // Jira: a binding-carrying row (as linkProvider persists one) yields the
    // structured {email, apiToken, site} Basic-auth credential the headless
    // lane previously had no way to surface — resolveWorkspaceAccess handed
    // Jira only the bare `token`, which cannot authenticate.
    const jiraSessions = [{
      session: {
        accountId: 'account-A',
        workspaces: [{
          urlKey: 'acme-jira',
          provider: 'jira',
          accessToken: 'jira-token',
          tokenExpiresAt: NOW + FAR_FUTURE_MS,
          bindings: [{ provider: 'jira', scope: 'acme.atlassian.net', credentials: { email: 'ada@acme.com', token: 'jira-token' } }],
        }],
      },
    }];
    const jiraResult = selectOwnerWorkspaceToken(jiraSessions, 'acme-jira', 'account-A');
    assert.equal(jiraResult.token, 'jira-token');
    // deepStrictEqual (not deepEqual) so an accidental extra key — e.g. a
    // resurrected `refreshToken` — fails this assertion rather than passing.
    assert.deepStrictEqual(jiraResult.scope, { email: 'ada@acme.com', apiToken: 'jira-token', site: 'acme.atlassian.net' });

    // Byte-identity: linear (and local) carry no structured scope, so `scope`
    // is the bare token itself, not a second copy.
    const linearResult = selectOwnerWorkspaceToken(
      [sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS)],
      'acme',
      'account-A'
    );
    assert.equal(linearResult.scope, linearResult.token);
  });
});

// ---------------------------------------------------------------------------
// Block C — detectOwnerAccountMismatch (LIN-1413, pure sibling detector)
// ---------------------------------------------------------------------------

describe('detectOwnerAccountMismatch (LIN-1413, Block C — pure detector)', () => {
  test('C1: owner has an expired row for urlKey, a different account has a live one -> true', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), true);
  });

  test('C2: owner has no row at all, a different account has a live one -> true (the "stale row already gone" variant)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), true);
  });

  test('C3: owner\'s own token is merely expired and nobody else is live -> false (stays LIN-1373\'s case)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), false);
  });

  test('C4: null/empty owner, even with another account live -> false (protects R4/not_connected)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', null), false);
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', ''), false);
  });

  test('C5: UNSCOPED -> false (owner-blind callers have no owner to mismatch against)', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', UNSCOPED), false);
  });

  test('C6: owner is live -> false (never reached in practice via server.js, asserted anyway)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS),
      sessionRow('account-B', 'acme', 'tokB', NOW + FURTHER_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-A'), false);
  });

  // C7 (LIN-1413 review): the review's blocking finding was that this exact
  // fixture shape — structurally identical to C1 — is also produced by two
  // legitimate colleagues sharing one workspace where only the asking
  // account's session has lapsed. The detector has no way to tell that case
  // apart from a genuine account fork (see the docstring above), so it
  // deliberately still fires here too. What changed post-review is NOT this
  // verdict — it's that lib/errors.js's owner_mismatch copy no longer asserts
  // a confident "will not restore it" that would be actively wrong for
  // Alice. This test documents the reachable case by name so the shared
  // verdict is a recorded decision, not a silent gap.
  test('C7: legitimate colleague — Alice\'s own session lapsed while Bob (a different, valid account) is live on the same workspace -> true, same as a genuine fork (indistinguishable; see docstring)', () => {
    const sessions = [
      sessionRow('account-alice', 'acme', 'tok-alice-expired', NOW + PAST_MS),
      sessionRow('account-bob', 'acme', 'tok-bob-live', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerAccountMismatch(sessions, 'acme', 'account-alice'), true);
  });
});

// ---------------------------------------------------------------------------
// Block D — detectOwnerSignedOut (LIN-1506, pure sibling detector)
// ---------------------------------------------------------------------------

describe('detectOwnerSignedOut (LIN-1506, Block D — pure detector)', () => {
  test('D1: owner has no session row anywhere -> true', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerSignedOut(sessions, 'account-A'), true);
  });

  // Q1's alarm: detectOwnerSignedOut is deliberately 2-arg (no urlKey), so this
  // fixture — a live session, just for a DIFFERENT workspace — must NOT read as
  // signed-out. If someone later widens the predicate to take urlKey and match
  // it, this is the test that fails.
  test('D2: owner has a live row for a DIFFERENT workspace (case (b), via otherWorkspaceSessionRow) -> false — a signed-in owner who never connected THIS workspace must not be told to sign in', () => {
    const sessions = [
      otherWorkspaceSessionRow('account-A', 'other-workspace', 'tokA', NOW + FAR_FUTURE_MS),
    ];
    assert.equal(detectOwnerSignedOut(sessions, 'account-A'), false);
  });

  test('D3: null / empty / UNSCOPED ownerAccountId -> false (the first-line guard)', () => {
    const sessions = [];
    assert.equal(detectOwnerSignedOut(sessions, null), false);
    assert.equal(detectOwnerSignedOut(sessions, ''), false);
    assert.equal(detectOwnerSignedOut(sessions, UNSCOPED), false);
  });

  // The detector is about row EXISTENCE, not token liveness — that distinction
  // is selectOwnerWorkspaceToken's job (it already returns session_expired for
  // this exact fixture). An owner with a stale-but-present row is not "signed
  // out" by this predicate's contract.
  test('D4: owner has a row for THIS workspace but its token is expired -> false (existence, not liveness)', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
    ];
    assert.equal(detectOwnerSignedOut(sessions, 'account-A'), false);
  });
});

// ---------------------------------------------------------------------------
// Block E — classifyWorkspaceFailure (LIN-1506, ordering witness)
// ---------------------------------------------------------------------------

describe('classifyWorkspaceFailure (LIN-1506, Block E — ordering witness)', () => {
  // Witness E: this decision had no test at all before this beat. Uses C2's
  // exact fixture — both detectOwnerAccountMismatch AND detectOwnerSignedOut
  // fire on this input (owner has no row anywhere; a different account is
  // live), so only ordering decides the result.
  test('E1 (witness E): C2\'s exact fixture — owner has no row at all, a DIFFERENT account holds a live session -> owner_mismatch, NOT owner_signed_out', () => {
    const sessions = [
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    const result = classifyWorkspaceFailure({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', selectedReason: 'not_connected' });
    assert.equal(result, 'owner_mismatch');
  });

  test('E2: not_connected + owner genuinely signed out (no row anywhere, nobody else live either) -> owner_signed_out', () => {
    const sessions = [];
    const result = classifyWorkspaceFailure({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', selectedReason: 'not_connected' });
    assert.equal(result, 'owner_signed_out');
  });

  test('E3: ok passes through unchanged', () => {
    const sessions = [sessionRow('account-A', 'acme', 'tokA', NOW + FAR_FUTURE_MS)];
    const result = classifyWorkspaceFailure({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', selectedReason: 'ok' });
    assert.equal(result, 'ok');
  });

  test('E4: session_expired passes through unchanged', () => {
    const sessions = [sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS)];
    const result = classifyWorkspaceFailure({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', selectedReason: 'session_expired' });
    assert.equal(result, 'session_expired');
  });

  // Proves the not_connected gate actually matters, not just that
  // detectOwnerSignedOut is false: this fixture has NO row for the owner
  // anywhere (detectOwnerSignedOut would return true in isolation), yet
  // store_unreachable must NOT be reclassified — it isn't the not_connected case.
  test('E5: store_unreachable passes through unchanged, even when the owner has no session row at all', () => {
    const sessions = [];
    const result = classifyWorkspaceFailure({ sessions, urlKey: 'acme', ownerAccountId: 'account-A', selectedReason: 'store_unreachable' });
    assert.equal(result, 'store_unreachable');
  });

  // LIN-1448. Both reclassifiers already return false for a falsy owner (C4 above,
  // and detectOwnerSignedOut's own guard), so this is structurally safe — but it
  // is the whole point of the new reason, so pin it: nothing may relabel
  // `token_ownerless` back into a workspace-shaped reason on its way to the wire.
  test('E6 (LIN-1448): token_ownerless passes through unchanged, even with another account live on the workspace', () => {
    const sessions = [sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS)];
    assert.equal(
      classifyWorkspaceFailure({ sessions, urlKey: 'acme', ownerAccountId: null, selectedReason: 'token_ownerless' }),
      'token_ownerless'
    );
    assert.equal(
      classifyWorkspaceFailure({ sessions: [], urlKey: 'acme', ownerAccountId: '', selectedReason: 'token_ownerless' }),
      'token_ownerless'
    );
  });
});

// ---------------------------------------------------------------------------
// Block F — source-grep wiring witness (LIN-1506, witness C)
// ---------------------------------------------------------------------------

// Extracts the body of `async function resolveWorkspaceAccess` from server.js:
// from the function keyword to the next TOP-LEVEL `\n}` (a newline immediately
// followed by a column-0 closing brace). A plain line-based find() would not
// work here — the call site under test spans multiple lines. This relies on
// the repo's consistent 2-space indentation (CLAUDE.md): every brace that
// closes an inner block (if/try/etc.) is preceded by at least one space, so
// only the function's own closing brace matches the literal substring "\n}".
function extractResolveWorkspaceAccessBody(src) {
  const start = src.indexOf('async function resolveWorkspaceAccess');
  assert.ok(start >= 0, 'async function resolveWorkspaceAccess not found in server.js');
  const end = src.indexOf('\n}', start);
  assert.ok(end >= 0, "could not find resolveWorkspaceAccess's top-level closing brace");
  return src.slice(start, end + 2);
}

describe('resolveWorkspaceAccess wiring (LIN-1506, Block F — witness C, source-grep)', () => {
  // This is the ONLY thing in the suite that catches the classifier never
  // being wired in at all: witness A's detector tests pass because the pure
  // functions exist and are correct, and the envelope tests (beat 4, Block 2)
  // inject the reason directly via buildApp(reason) rather than going through
  // resolveWorkspaceAccess. If the call site here were deleted entirely, the
  // rest of the suite would stay fully green.
  //
  // What this test does NOT prove: reachability (that resolveWorkspaceAccess
  // is actually invoked on a request), argument correctness (that the right
  // sessions/urlKey/ownerAccountId are passed), or that the return value is
  // used by the caller. It is a wiring smoke-detector — text and position —
  // not a behavioural witness. Witness E (Block E, above) is the behavioural
  // witness for the classifier itself, once you already know it's called.
  test('#27 (witness C): classifyWorkspaceFailure is called after refreshOwnerWorkspaceToken, and detectOwnerAccountMismatch no longer appears directly', () => {
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);

    const classifyIdx = body.indexOf('classifyWorkspaceFailure(');
    const refreshIdx = body.indexOf('refreshOwnerWorkspaceToken(');

    assert.ok(classifyIdx >= 0, 'classifyWorkspaceFailure( is not called inside resolveWorkspaceAccess');
    assert.ok(refreshIdx >= 0, 'sanity check failed: refreshOwnerWorkspaceToken( is not called inside resolveWorkspaceAccess');
    assert.ok(
      classifyIdx > refreshIdx,
      'classifyWorkspaceFailure must be called AFTER refreshOwnerWorkspaceToken has had its chance to resolve a token — reclassifying a failure that refresh-on-resolve could still turn into a success would be premature'
    );

    assert.ok(
      !body.includes('detectOwnerAccountMismatch('),
      'detectOwnerAccountMismatch must no longer be called directly inside resolveWorkspaceAccess — it moved inside classifyWorkspaceFailure (lib/workspace-token-resolver.js)'
    );
  });

  test('LIN-1524: UNSCOPED callers never reach refreshOwnerWorkspaceToken (and so never consult the durable store) — the guard is textually attached to the call', () => {
    // The durable store is the ONLY thing refreshOwnerWorkspaceToken's Linear
    // arm reads/writes now (LIN-1524) — so "UNSCOPED never consults the
    // durable store" reduces to "UNSCOPED never reaches this call at all".
    // That's a source-text fact, not a behavioural one (Block A's A5 already
    // proves the pure selector's OWN owner-blind behaviour is unaffected;
    // this proves the call site guarding the durable-refresh attempt).
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
    const callIdx = body.indexOf('refreshOwnerWorkspaceToken(');
    assert.ok(callIdx >= 0, 'expected a refreshOwnerWorkspaceToken( call inside resolveWorkspaceAccess');

    const ifLine = body.slice(0, callIdx).split('\n').reverse().find(l => l.trim().startsWith('if ('));
    assert.ok(ifLine, 'expected an `if (...)` guarding the refreshOwnerWorkspaceToken( call');
    assert.match(ifLine, /ownerAccountId !== UNSCOPED/, 'the durable-refresh attempt must stay gated on a real (non-UNSCOPED) owner — an owner-blind caller must never trigger a durable-store read/write on anyone\'s behalf');
  });

  test('LIN-1891 (witness — text and position, not behaviour): every token-bearing return and cache write carries `scope`', () => {
    // This proves resolveWorkspaceAccess's own copy of the additive `scope`
    // field is textually present at every site the plan requires — it does
    // NOT prove `scope` is populated correctly at runtime (no behavioural
    // test in this suite exercises the real resolveWorkspaceAccess; every
    // caller injects a stub for it, per the plan's own "what this does not
    // deliver" section). A dropped field on one of these sites would
    // slip through every other test in this repo.
    //
    // LIN-1980 widened the site count from 3 to 5 (and cache writes from 2 to
    // 4): the cache-hit and session-scan branches each gained a second
    // success return + cache write for the "a suspect credential was
    // recovered via forced refresh" case, sitting alongside their original
    // "serve what was already selected" return. Both new sites carry
    // `scope: recovered.scope`, same as their neighbours.
    const body = extractResolveWorkspaceAccessBody(SERVER_SRC);
    const lines = body.split('\n');

    // The SUCCESS returns (cache-hit x2, selector x2, refresh-on-resolve) all
    // carry the literal `reason: 'ok'` — unlike the failure-path return
    // further down, which forwards a variable `reason` instead. That literal
    // is what distinguishes them without hard-coding line numbers. Excludes
    // the NODE_ENV=test shortcut's own `reason: 'ok'` return (`'test-token'`)
    // — deliberately out of the plan's edits, a hard-coded Linear-shaped test
    // fixture with no session/cache path to widen.
    const successReturnLines = lines.filter(l => l.includes('return {') && l.includes("reason: 'ok'") && !l.includes("'test-token'"));
    assert.equal(successReturnLines.length, 5, `expected exactly 5 token-bearing success returns, found ${successReturnLines.length}`);
    for (const line of successReturnLines) {
      assert.match(line, /scope:/, `success return missing scope: ${line.trim()}`);
    }

    // All workspaceTokenCache.set(...) calls.
    const cacheWriteLines = lines.filter(l => l.includes('workspaceTokenCache.set('));
    assert.equal(cacheWriteLines.length, 4, `expected exactly 4 cache writes, found ${cacheWriteLines.length}`);
    for (const line of cacheWriteLines) {
      assert.match(line, /scope:/, `cache write missing scope: ${line.trim()}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Block G (LIN-1524) — owner isolation over the DURABLE store itself
// ---------------------------------------------------------------------------
//
// Block A (above) proves the session-side selector never lets one account's
// proxy token resolve to a different account's SESSION token. Now that Linear's
// rotating credential lives in a separate store (lib/owner-credential-store.js,
// keyed on `(accountId, urlKey)`), that same guarantee needs its own direct
// proof at the storage layer: account A's durable record must never resolve
// for account B, and vice versa, even when both hold a record for the exact
// same `urlKey` (the realistic case — a Linear org connected by two different
// Harbour accounts, e.g. two teammates who each connected the same team's
// workspace independently).

function inMemoryCredentialCollection() {
  const docs = new Map();
  return {
    async findOne(query) { return docs.get(query._id) ?? null; },
    async updateOne(query, update) {
      const existing = docs.get(query._id) || { _id: query._id };
      docs.set(query._id, { ...existing, ...(update.$set || {}) });
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const had = docs.has(query._id);
      docs.delete(query._id);
      return { deletedCount: had ? 1 : 0 };
    },
  };
}

describe('OwnerCredentialStore owner isolation over the durable store (LIN-1524, Block G)', () => {
  test('G1: account A\'s durable record is never returned for account B\'s get, even for the identical urlKey', async () => {
    const store = new OwnerCredentialStore({ collection: inMemoryCredentialCollection() });
    await store.put('account-A', 'acme', { provider: 'linear', scope: 'org-1', token: 'a-token', refreshToken: 'a-refresh', tokenExpiresAt: NOW + FAR_FUTURE_MS });
    await store.put('account-B', 'acme', { provider: 'linear', scope: 'org-1', token: 'b-token', refreshToken: 'b-refresh', tokenExpiresAt: NOW + FAR_FUTURE_MS });

    const forA = await store.get('account-A', 'acme');
    const forB = await store.get('account-B', 'acme');

    assert.equal(forA.refreshToken, 'a-refresh');
    assert.equal(forB.refreshToken, 'b-refresh');
    assert.notEqual(forA.refreshToken, forB.refreshToken);
  });

  test('G2: deleting account A\'s record never touches account B\'s, same urlKey', async () => {
    const store = new OwnerCredentialStore({ collection: inMemoryCredentialCollection() });
    await store.put('account-A', 'acme', { provider: 'linear', scope: 'org-1', token: 'a-token', refreshToken: 'a-refresh', tokenExpiresAt: NOW + FAR_FUTURE_MS });
    await store.put('account-B', 'acme', { provider: 'linear', scope: 'org-1', token: 'b-token', refreshToken: 'b-refresh', tokenExpiresAt: NOW + FAR_FUTURE_MS });

    await store.delete('account-A', 'acme');

    assert.equal(await store.get('account-A', 'acme'), null);
    const survived = await store.get('account-B', 'acme');
    assert.ok(survived, 'account B\'s record must survive account A\'s deletion');
    assert.equal(survived.refreshToken, 'b-refresh');
  });

  test('G3: an attacker-shaped accountId cannot collide with a real one via the composite key (no delimiter-injection cross-read)', async () => {
    // The key is a plain template literal `${accountId}::${urlKey}` — verify
    // an accountId value crafted to LOOK like `${real}::${urlKey}` cannot
    // shadow the real owner's record for the same urlKey.
    const store = new OwnerCredentialStore({ collection: inMemoryCredentialCollection() });
    await store.put('account-A', 'acme', { provider: 'linear', scope: 'org-1', token: 'a-token', refreshToken: 'a-refresh', tokenExpiresAt: NOW + FAR_FUTURE_MS });

    const crafted = await store.get('account-A::acme', 'x'); // would collide if the key were naively parsed/split
    assert.equal(crafted, null);
    // And the real owner's record is untouched.
    const real = await store.get('account-A', 'acme');
    assert.equal(real.refreshToken, 'a-refresh');
  });
});

// ---------------------------------------------------------------------------
// Block B — route wiring (4 cases): real ProxyTokenStore + recording spy resolver
// ---------------------------------------------------------------------------

function inMemoryCollection() {
  const docs = [];
  return {
    _docs: docs,
    async insertOne(doc) { docs.push(doc); return { insertedId: doc._id }; },
    async findOne(query) {
      return docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v)) || null;
    },
    find(query = {}) {
      const results = docs.filter(d => Object.entries(query).every(([k, v]) => d[k] === v));
      return { async toArray() { return results.slice(); } };
    },
    async updateOne(query, update, options = {}) {
      let doc = docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 };
        doc = { ...(update.$setOnInsert || {}) };
        Object.entries(query).forEach(([k, v]) => { doc[k] = v; });
        docs.push(doc);
      }
      Object.assign(doc, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async deleteOne(query) {
      const idx = docs.findIndex(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (idx >= 0) { docs.splice(idx, 1); return { deletedCount: 1 }; }
      return { deletedCount: 0 };
    },
    async deleteMany(query) {
      let count = 0;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (Object.entries(query).every(([k, v]) => docs[i][k] === v)) { docs.splice(i, 1); count++; }
      }
      return { deletedCount: count };
    },
  };
}

// A hand-rolled fake, not the real selector (that's Block A's job): success iff
// an owner was actually threaded through, so this proves WIRING, not selection.
function makeRecordingResolver() {
  const calls = [];
  const resolveWorkspaceAccess = async (urlKey, ownerAccountId) => {
    calls.push({ urlKey, ownerAccountId });
    if (!ownerAccountId) {
      // Mirrors the real selector's falsy-owner branch, which LIN-1448 moved off
      // `not_connected` onto its own reason (see A4 / selectOwnerWorkspaceToken).
      // Keep these two in step: this stub exists to thread a REAL reason to the
      // wire, so a stale value here would silently stop testing anything.
      return { token: null, reason: 'token_ownerless', provider: null };
    }
    // 'test-token' also drives /api/proxy/stack's own NODE_ENV=test mock-data
    // shortcut, so R3 never needs a real Linear connection either.
    return { token: 'test-token', reason: 'ok', provider: 'linear' };
  };
  return { calls, resolveWorkspaceAccess };
}

// A fake provider (LIN-581's injectedProvider TEST-ONLY seam) so the read/write
// call sites (R1/R2) never reach a real Linear provider or network call.
function fakeLinearProvider() {
  const calls = [];
  return {
    name: 'linear',
    calls,
    supports(method) { calls.push({ fn: 'supports', method }); return true; },
    // LIN-1557: the create route's optional-field gate consults this
    // unconditionally; a full permissive contract keeps this fixture's
    // existing "everything works" posture.
    apiWriteFields() { return ['title', 'description', 'teamId', 'projectId', 'stateId', 'assigneeId', 'priority', 'parentId', 'cycleId']; },
    async issues() { calls.push({ fn: 'issues' }); return { nodes: [], pageInfo: {} }; },
    async createIssue(token, input) {
      calls.push({ fn: 'createIssue', token, input });
      return { id: 'fake-issue-id', identifier: 'ACME-1', title: input.title };
    },
  };
}

function buildApp({ resolveWorkspaceAccess, provider }) {
  const app = express();
  app.use(express.json());
  const proxyTokenStore = new ProxyTokenStore({ collection: inMemoryCollection() });
  app.use(createProxyRoutes({
    proxyTokenStore,
    proxyEventStore: { recordEvent: async () => {} },
    agentStatusStore: {},
    recapCacheStore: {},
    briefCacheStore: {},
    taskSnapshotStore: {},
    dispatchQueueStore: {},
    workspaceFromUrl: (req, res, next) => next(),
    resolveWorkspaceAccess,
    getWorkspaceAccessToken: async (urlKey) => (await resolveWorkspaceAccess(urlKey)).token,
    getWorkspaceOpenRouterKey: async () => null,
    workspacePreferencesStore: {},
    freeTierStore: { tryUse: async () => ({ allowed: true }) },
    provider,
  }));
  return { app, proxyTokenStore };
}

async function requestJson(app, path, { method = 'GET', token, body } = {}) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

describe('req.proxyCreatedBy route wiring (LIN-1366, Block B)', () => {
  test('R1: read site (GET /api/proxy/issues) threads req.proxyCreatedBy to the resolver', async () => {
    const spy = makeRecordingResolver();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider: fakeLinearProvider() });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read', createdBy: 'account-A' });

    const { status } = await requestJson(app, '/api/proxy/issues', { token });

    assert.equal(status, 200);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].urlKey, 'acme');
    assert.equal(spy.calls[0].ownerAccountId, 'account-A');
  });

  test('R2: write site (POST /api/proxy/issues) threads owner + the capability gate sees the resolved provider', async () => {
    const spy = makeRecordingResolver();
    const provider = fakeLinearProvider();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'readWrite', createdBy: 'account-A' });

    const { status, body } = await requestJson(app, '/api/proxy/issues', {
      method: 'POST',
      token,
      body: { teamId: '00000000-0000-0000-0000-000000000000', title: 'Test issue' },
    });

    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(spy.calls[0].ownerAccountId, 'account-A');
    assert.ok(provider.calls.some(c => c.fn === 'supports' && c.method === 'createIssue'), 'capability gate consulted the resolved provider');
    assert.ok(provider.calls.some(c => c.fn === 'createIssue'), 'write reached the provider using the owner-scoped token');
  });

  test('R3: direct task-automation site (GET /api/proxy/stack) threads req.proxyCreatedBy to the resolver', async () => {
    const spy = makeRecordingResolver();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider: fakeLinearProvider() });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read', createdBy: 'account-A' });

    const { status } = await requestJson(app, '/api/proxy/stack', { token });

    assert.equal(status, 200);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].urlKey, 'acme');
    assert.equal(spy.calls[0].ownerAccountId, 'account-A');
  });

  test('R4 (LIN-1448): anonymous/null-owner proxy token -> 503 TOKEN_HAS_NO_OWNER end-to-end (exact envelope, verbatim)', async () => {
    const spy = makeRecordingResolver();
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess: spy.resolveWorkspaceAccess, provider: fakeLinearProvider() });
    // No createdBy -> legacy/anonymous mint, createdBy: null (LIN-1366's core checkpoint).
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read' });

    const { status, body } = await requestJson(app, '/api/proxy/issues', { token });

    // Still 503, still fail-closed, still non-retryable — only the DIAGNOSIS
    // changed. Before LIN-1448 this was WORKSPACE_NOT_CONNECTED, the same code a
    // genuinely disconnected workspace returns, so a worker reading it could not
    // tell "my credential is broken" from "the workspace is down" (LIN-1576).
    assert.equal(status, 503);
    assert.equal(body.error, 'Workspace not available');
    assert.equal(body.code, 'TOKEN_HAS_NO_OWNER');
    assert.equal(body.category, 'config');
    assert.equal(body.retryable, false);
    assert.equal(body.context.workspaceUrlKey, 'acme');
    assert.equal(spy.calls[0].ownerAccountId, null);
    // The remedy must be in the payload the worker actually reads, and must not
    // send it down the reconnect-the-workspace path that wasted the outage.
    assert.match(body.detail, /token/i);
    assert.doesNotMatch(body.detail, /not connected/i);
  });

  test('R5 (LIN-1413): resolveWorkspaceAccess returning owner_mismatch -> 503 WORKSPACE_OWNER_MISMATCH end-to-end (exact envelope, verbatim)', async () => {
    // Forced-reason resolver: proves the wire threading, mirroring R4's style.
    // The detector itself (Block C) is exercised separately.
    const resolveWorkspaceAccess = async () => ({ token: null, reason: 'owner_mismatch', provider: 'linear' });
    const { app, proxyTokenStore } = buildApp({ resolveWorkspaceAccess, provider: fakeLinearProvider() });
    const { token } = await proxyTokenStore.createToken('acme', { scope: 'read', createdBy: 'account-A' });

    const { status, body } = await requestJson(app, '/api/proxy/issues', { token });

    assert.equal(status, 503);
    assert.equal(body.error, 'Workspace not available');
    assert.equal(body.code, 'WORKSPACE_OWNER_MISMATCH');
    assert.equal(body.category, 'config');
    assert.equal(body.retryable, false);
    assert.equal(body.context.workspaceUrlKey, 'acme');
    // Privacy boundary: the other (live) account's id must never reach the wire.
    assert.ok(!/account-B|accountId/i.test(JSON.stringify(body)));
  });
});

// ---------------------------------------------------------------------------
// describeWorkspaceResolution — secret-safe diagnostic summary for the
// WORKSPACE_NOT_CONNECTED ambiguity. Two genuinely different failures collapse
// into the identical bare `not_connected` reason (a null-owner token vs. an
// owner who is signed in but has no session referencing THIS workspace), and
// resolveWorkspaceAccess logged nothing to tell them apart. This pure summary
// is what server.js logs on every non-ok resolution so the next occurrence is
// self-explanatory — without leaking any other account's id or token bytes.
// ---------------------------------------------------------------------------

describe('describeWorkspaceResolution (diagnostic summary — non-sensitive)', () => {
  test('null-owner token: distinguishes the createdBy:null regression from a real miss', () => {
    const sessions = [
      // A different account is live on the workspace, but the token has no owner.
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    const d = describeWorkspaceResolution(sessions, 'acme', null);
    assert.equal(d.ownerAccountId, '<null>', 'a null owner is surfaced explicitly — the regression signature');
    assert.equal(d.ownerSessionRowCount, 0, 'a null owner owns no rows');
    assert.equal(d.ownerHasRowForWorkspace, false);
  });

  test('signed in, workspace not on the owner session (multi-device fork): rowCount>0, no row for this workspace, another account live', () => {
    const sessions = [
      // The owner IS signed in — but their live session is for a different workspace.
      otherWorkspaceSessionRow('account-A', 'other-ws', 'tokA', NOW + FAR_FUTURE_MS),
      // Meanwhile a different device/account holds this workspace live.
      sessionRow('account-B', 'acme', 'tokB', NOW + FAR_FUTURE_MS),
    ];
    const d = describeWorkspaceResolution(sessions, 'acme', 'account-A');
    assert.equal(d.ownerSessionRowCount, 1, 'the owner has a session — so this is NOT the null/never-signed-in case');
    assert.deepEqual(d.ownerReferencedUrlKeys, ['other-ws'], 'and it references a DIFFERENT workspace than the one requested');
    assert.equal(d.ownerHasRowForWorkspace, false, 'the owner has no row for THIS workspace — the true not_connected shape');
    assert.equal(d.otherAccountLiveForWorkspace, true, 'a different account is live here — the multi-device fork, made visible');
  });

  test('owner token merely expired (session_expired): owner has a row for this workspace, nobody else live', () => {
    const sessions = [
      sessionRow('account-A', 'acme', 'tokA-expired', NOW + PAST_MS),
    ];
    const d = describeWorkspaceResolution(sessions, 'acme', 'account-A');
    assert.equal(d.ownerHasRowForWorkspace, true, 'the expiry case still owns a row for this workspace');
    assert.equal(d.ownerNearestExpiryForWorkspace, NOW + PAST_MS, 'the nearest owner expiry is surfaced for the log');
    assert.equal(d.otherAccountLiveForWorkspace, false);
  });

  test('privacy boundary: never emits another account id or any token bytes', () => {
    const sessions = [
      otherWorkspaceSessionRow('account-A', 'other-ws', 'tokA', NOW + FAR_FUTURE_MS),
      sessionRow('account-B', 'acme', 'tokB-secret', NOW + FAR_FUTURE_MS),
    ];
    const d = describeWorkspaceResolution(sessions, 'acme', 'account-A');
    const serialized = JSON.stringify(d);
    assert.ok(!serialized.includes('account-B'), 'the other account id must never appear in the summary');
    assert.ok(!serialized.includes('tokB-secret'), 'no access token bytes in the summary');
    assert.ok(!serialized.includes('tokA'), 'not even the owner\'s own token bytes');
  });
});
