/**
 * Unit tests for LIN-2097's refresh-on-resolve gate
 * (lib/refresh-on-resolve-gate.js).
 *
 * This is the pure, injectable-clock module server.js's `resolveWorkspaceAccess`
 * wires into its `!selected.token && ownerAccountId !== UNSCOPED` branch to
 * bound the OAuth-exchange attempt rate once a frozen-expiry dead credential
 * ages past the refresh buffer (server.js is not import-safe in a unit test —
 * see workspace-token-refresh.test.js's Block E/F docstrings for the same
 * precedent — so the gate's actual suppression behaviour is proven here,
 * directly, rather than only pinned as source text at the call site).
 *
 * Run with: node --test tests/unit/refresh-on-resolve-gate.test.js
 */
process.env.NODE_ENV = 'test';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshOnResolveGate, DEFAULT_REFRESH_ON_RESOLVE_COOLDOWN_MS } from '../../lib/refresh-on-resolve-gate.js';

describe('createRefreshOnResolveGate (LIN-2097)', () => {
  test('J1: first attempt for a (scopeKey, fingerprint) pair is always allowed', () => {
    const gate = createRefreshOnResolveGate({ now: () => 1_000 });
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1'), true);
  });

  test('J2: a second attempt for the SAME (scopeKey, fingerprint) within the cooldown window is suppressed — this is the exact per-request-pump fix', () => {
    const gate = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1', 1_000), true, 'first attempt allowed');
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1', 1_500), false, 'immediate repeat suppressed');
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1', 30_000), false, 'still within the 60s cooldown');
  });

  test('J3: once the cooldown window elapses, the SAME pair is allowed to attempt again', () => {
    const gate = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1', 0), true);
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1', 59_999), false, 'just inside the window');
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1', 60_001), true, 'just outside the window');
  });

  test('J4: a DIFFERENT fingerprint at the same scopeKey is never throttled by a stale fingerprint\'s cooldown — a genuinely new credential (e.g. after re-authorization) always gets its own first attempt', () => {
    const gate = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-dead', 0), true);
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-dead', 1_000), false, 'still cooling on the dead fingerprint');
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-fresh', 1_000), true, 'a new fingerprint at the same scope is unaffected');
  });

  test('J5: a different scopeKey with the SAME fingerprint is independent — no cross-workspace bleed', () => {
    const gate = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1', 0), true);
    assert.equal(gate.shouldAttempt('account-B:acme', 'fp-1', 1_000), true, 'a different owner/workspace scope is never throttled by another scope\'s cooldown');
  });

  test('J6: a null/missing fingerprint always attempts — no durable credential to bound repeated exchanges against', () => {
    const gate = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    assert.equal(gate.shouldAttempt('account-A:acme', null, 0), true);
    assert.equal(gate.shouldAttempt('account-A:acme', null, 1), true, 'still true — a null fingerprint never gets stamped into the cooldown map');
  });

  test('J7: a null/missing scopeKey always attempts', () => {
    const gate = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    assert.equal(gate.shouldAttempt(null, 'fp-1', 0), true);
    assert.equal(gate.shouldAttempt(undefined, 'fp-1', 1), true);
  });

  test('J8: the gate\'s own cooldown budget is independent per instance — mirrors the isolation two separate call sites (this gate vs. rejectedCredentialRegistry\'s scopeAttempts) must have', () => {
    const gateA = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    const gateB = createRefreshOnResolveGate({ cooldownMs: 60_000, now: () => 1_000 });
    assert.equal(gateA.shouldAttempt('account-A:acme', 'fp-1', 0), true);
    assert.equal(gateB.shouldAttempt('account-A:acme', 'fp-1', 1), true, 'a second, independently-constructed gate has never seen this pair before');
  });

  test('J9: default cooldown constant is exported and used when no override is given', () => {
    let calls = 0;
    const now = () => (calls++ === 0 ? 0 : DEFAULT_REFRESH_ON_RESOLVE_COOLDOWN_MS - 1);
    const gate = createRefreshOnResolveGate({ now });
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1'), true);
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-1'), false, 'default cooldown still in effect one ms before it elapses');
  });

  test('J10 [M1]: the map does not grow unboundedly — once enough distinct pairs have aged past cooldown, a periodic sweep reclaims them', () => {
    const cooldownMs = 60_000;
    const gate = createRefreshOnResolveGate({ cooldownMs, now: () => 0 });
    // 250 distinct (scopeKey, fingerprint) pairs, all stamped at t=0 — comfortably
    // past the 200-call sweep interval, so a sweep should have fired mid-loop.
    for (let i = 0; i < 250; i++) {
      gate.shouldAttempt(`account-${i}:acme`, 'fp-1', 0);
    }
    assert.equal(gate._sizeForTests(), 250, 'no entries elapsed cooldown yet (still t=0), so none were swept');

    // A single later call, once every prior entry's cooldown has elapsed, should
    // trigger a sweep that reclaims all 250 stale entries — the map shrinks back
    // down to just the one pair this call itself stamps, not 251.
    gate.shouldAttempt('account-new:acme', 'fp-1', cooldownMs + 1);
    // The sweep only fires every SWEEP_INTERVAL_CALLS (200) calls, so drive enough
    // additional calls (against a single, already-live pair, which never itself
    // ages out at this clock) to cross the next interval boundary.
    for (let i = 0; i < 200; i++) {
      gate.shouldAttempt('account-new:acme', 'fp-1', cooldownMs + 1);
    }
    assert.ok(gate._sizeForTests() < 250, 'the sweep reclaimed the 250 stale entries rather than leaving them to accumulate forever');
  });

  test('J11 [M1]: a sweep never evicts an entry still inside its cooldown window', () => {
    const cooldownMs = 60_000;
    const gate = createRefreshOnResolveGate({ cooldownMs, now: () => 0 });
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-live', 0), true);
    // Drive past the sweep interval with calls that themselves stay well inside
    // fp-live's own cooldown window.
    for (let i = 0; i < 200; i++) {
      gate.shouldAttempt(`account-${i}:other`, 'fp-x', 1_000);
    }
    // fp-live is still within its 60s cooldown at t=1000 — a sweep must not have
    // reclaimed it.
    assert.equal(gate.shouldAttempt('account-A:acme', 'fp-live', 1_000), false, 'still cooling — the sweep did not evict a live entry');
  });
});
