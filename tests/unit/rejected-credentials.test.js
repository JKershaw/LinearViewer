/**
 * Unit tests for lib/rejected-credentials.js (LIN-1980).
 *
 * This registry is deliberately NOT PR #1099's "unselectable after N
 * consecutive strikes" design — see the module docstring. It marks a
 * credential SUSPECT on a single rejection, purely to decide whether to
 * ATTEMPT a forced refresh; it never makes anything unselectable and is
 * never consulted by selection.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRejectedCredentialRegistry } from '../../lib/rejected-credentials.js';

describe('markSuspect / isSuspect', () => {
  test('a single rejection marks the fingerprint suspect immediately', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    assert.equal(registry.isSuspect('fp-a'), false);
    registry.markSuspect('fp-a');
    assert.equal(registry.isSuspect('fp-a'), true);
  });

  test('fail-open: a falsy fingerprint is never marked and never reads suspect', () => {
    const registry = createRejectedCredentialRegistry();
    registry.markSuspect(null);
    registry.markSuspect(undefined);
    registry.markSuspect('');
    assert.equal(registry.isSuspect(null), false);
    assert.equal(registry.isSuspect(undefined), false);
    assert.equal(registry.isSuspect(''), false);
  });

  test('a mark expires after the TTL', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ suspectTtlMs: 10_000, now: () => now });
    registry.markSuspect('fp-a');
    now += 9_999;
    assert.equal(registry.isSuspect('fp-a'), true, 'still within TTL');
    now += 2;
    assert.equal(registry.isSuspect('fp-a'), false, 'TTL elapsed');
  });

  test('a fresh rejection while already suspect renews the TTL', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ suspectTtlMs: 10_000, now: () => now });
    registry.markSuspect('fp-a');
    now += 9_000;
    registry.markSuspect('fp-a'); // renews from now=10000
    now += 9_000; // now=19000, 9000ms since the renew — still within TTL
    assert.equal(registry.isSuspect('fp-a'), true, 'renewed mark still live');
    now += 2_000; // now=21000, 11000ms since the renew — expired
    assert.equal(registry.isSuspect('fp-a'), false);
  });

  test('two different fingerprints are tracked independently', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.markSuspect('fp-a');
    assert.equal(registry.isSuspect('fp-a'), true);
    assert.equal(registry.isSuspect('fp-b'), false);
  });
});

describe('shouldAttemptRefresh cooldown', () => {
  test('the first check after marking suspect allows an attempt', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.markSuspect('fp-a');
    assert.equal(registry.shouldAttemptRefresh('fp-a'), true);
  });

  test('a second check within the cooldown window is refused', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
    registry.markSuspect('fp-a');
    assert.equal(registry.shouldAttemptRefresh('fp-a'), true, 'first attempt allowed');
    now += 1_000;
    assert.equal(registry.shouldAttemptRefresh('fp-a'), false, 'second attempt within cooldown refused');
  });

  test('an attempt is allowed again once the cooldown elapses', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
    registry.markSuspect('fp-a');
    assert.equal(registry.shouldAttemptRefresh('fp-a'), true);
    now += 60_001;
    assert.equal(registry.shouldAttemptRefresh('fp-a'), true, 'cooldown elapsed');
  });

  test('concurrent/rapid resolves for the same fingerprint trigger at most one attempt per window (LIN-1980 requirement)', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
    registry.markSuspect('fp-a');
    let attempts = 0;
    // Simulate 5 "concurrent" resolves all landing in the same instant.
    for (let i = 0; i < 5; i++) {
      if (registry.shouldAttemptRefresh('fp-a')) attempts++;
    }
    assert.equal(attempts, 1);
  });

  test('an un-marked (never-suspect) fingerprint never allows an attempt', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    assert.equal(registry.shouldAttemptRefresh('fp-never-marked'), false);
  });

  test('fail-open: shouldAttemptRefresh(falsy) is always false', () => {
    const registry = createRejectedCredentialRegistry();
    assert.equal(registry.shouldAttemptRefresh(null), false);
    assert.equal(registry.shouldAttemptRefresh(undefined), false);
  });

  test('re-marking suspect does NOT reset the cooldown clock (only rejections renew suspicion, not the attempt gate)', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
    registry.markSuspect('fp-a');
    assert.equal(registry.shouldAttemptRefresh('fp-a'), true, 'first attempt consumes the window');
    now += 1_000;
    registry.markSuspect('fp-a'); // another rejection arrives, well within cooldown
    assert.equal(registry.shouldAttemptRefresh('fp-a'), false, 'cooldown is still governed by the original attempt time');
  });

  describe('scope-keyed cooldown (LIN-1980 review F1)', () => {
    test('a scope cooldown bounds attempts across DIFFERENT fingerprints sharing the same scope key', () => {
      let now = 1000;
      const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
      registry.markSuspect('fp-a');
      assert.equal(registry.shouldAttemptRefresh('fp-a', 'owner:workspace'), true, 'first attempt for this scope is allowed');
      // fp-a is superseded by a brand-new fingerprint (e.g. a rotated OAuth
      // token) that is ALSO rejected — a fresh mark with no attempt history
      // of its own, the exact shape of the reviewed flaw.
      registry.accept('fp-a');
      registry.markSuspect('fp-b');
      now += 1_000; // still well within the cooldown window
      assert.equal(registry.shouldAttemptRefresh('fp-b', 'owner:workspace'), false, 'the scope cooldown blocks a second attempt this window even though fp-b has no attempt history of its own');
    });

    test('the scope cooldown is per-scope: a DIFFERENT (owner, workspace) scope gets its own independent attempt', () => {
      let now = 1000;
      const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
      registry.markSuspect('fp-a');
      registry.markSuspect('fp-c');
      assert.equal(registry.shouldAttemptRefresh('fp-a', 'owner:workspace-1'), true);
      assert.equal(registry.shouldAttemptRefresh('fp-c', 'owner:workspace-2'), true, 'an unrelated workspace is not blocked by another workspace\'s cooldown');
    });

    test('once the scope cooldown elapses, a churned fingerprint can attempt again', () => {
      let now = 1000;
      const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
      registry.markSuspect('fp-a');
      registry.shouldAttemptRefresh('fp-a', 'owner:workspace');
      registry.accept('fp-a');
      registry.markSuspect('fp-b');
      now += 60_001;
      assert.equal(registry.shouldAttemptRefresh('fp-b', 'owner:workspace'), true, 'cooldown elapsed for the scope');
    });

    test('omitting scopeKey preserves the old per-fingerprint-only behaviour (backward compatible)', () => {
      let now = 1000;
      const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
      registry.markSuspect('fp-a');
      registry.accept('fp-a');
      registry.markSuspect('fp-b');
      assert.equal(registry.shouldAttemptRefresh('fp-b'), true, 'no scopeKey means no scope-level gate');
    });
  });
});

describe('accept', () => {
  test('accept clears a suspect mark so the credential no longer reads suspect', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.markSuspect('fp-a');
    assert.equal(registry.isSuspect('fp-a'), true);
    registry.accept('fp-a');
    assert.equal(registry.isSuspect('fp-a'), false);
  });

  test('accept on an unmarked fingerprint is a harmless no-op', () => {
    const registry = createRejectedCredentialRegistry();
    assert.doesNotThrow(() => registry.accept('fp-never-marked'));
  });

  test('fail-open: accept(falsy) never throws', () => {
    const registry = createRejectedCredentialRegistry();
    assert.doesNotThrow(() => registry.accept(null));
    assert.doesNotThrow(() => registry.accept(undefined));
  });

  test('accepting a replaced credential clears its cooldown too, so a LATER independent suspicion of the same fingerprint gets its own fresh attempt', () => {
    let now = 1000;
    const registry = createRejectedCredentialRegistry({ refreshCooldownMs: 60_000, now: () => now });
    registry.markSuspect('fp-a');
    registry.shouldAttemptRefresh('fp-a'); // consumes the window
    registry.accept('fp-a');
    now += 1_000; // still inside what would have been the old cooldown
    registry.markSuspect('fp-a'); // a fresh, independent rejection
    assert.equal(registry.shouldAttemptRefresh('fp-a'), true, 'accept() reset the cooldown state for this fingerprint');
  });
});

describe('bounded registry', () => {
  test('the registry never grows past its configured limit', () => {
    const registry = createRejectedCredentialRegistry({ limit: 3, now: () => 1000 });
    registry.markSuspect('fp-1');
    registry.markSuspect('fp-2');
    registry.markSuspect('fp-3');
    registry.markSuspect('fp-4');
    const suspectCount = ['fp-1', 'fp-2', 'fp-3', 'fp-4'].filter(fp => registry.isSuspect(fp)).length;
    assert.equal(suspectCount, 3);
    // The oldest (fp-1) is the one evicted.
    assert.equal(registry.isSuspect('fp-1'), false);
    assert.equal(registry.isSuspect('fp-4'), true);
  });
});

// LIN-2327: the fourth, independent `byteIdenticalRejections` map — see the
// module docstring's "BYTE-IDENTICAL-REJECTION COUNTER" section. Fingerprint-
// only key, no TTL, limit-only eviction, deliberate non-de-escalation.
describe('recordByteIdenticalRejection / isPastByteIdenticalThreshold (LIN-2327)', () => {
  test('reaches threshold at exactly the configured count, not before or after', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), false, 'no rejections yet');
    registry.recordByteIdenticalRejection('fp-a');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), false, 'one rejection is not yet past threshold 2');
    registry.recordByteIdenticalRejection('fp-a');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), true, 'second rejection reaches threshold 2');
  });

  test('counts are tracked independently per fingerprint', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.recordByteIdenticalRejection('fp-a');
    registry.recordByteIdenticalRejection('fp-a');
    registry.recordByteIdenticalRejection('fp-b');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), true);
    assert.equal(registry.isPastByteIdenticalThreshold('fp-b', 2), false, 'fp-b has only one rejection');
  });

  test('fail-open: a falsy fingerprint is never recorded and never reads past threshold', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.recordByteIdenticalRejection(null);
    registry.recordByteIdenticalRejection(undefined);
    registry.recordByteIdenticalRejection('');
    assert.equal(registry.isPastByteIdenticalThreshold(null, 1), false);
    assert.equal(registry.isPastByteIdenticalThreshold(undefined, 1), false);
    assert.equal(registry.isPastByteIdenticalThreshold('', 1), false);
  });

  test('LRU eviction: a past-threshold fingerprint can be silently evicted by newer fingerprints once the registry limit is exceeded — reading it does not protect it (limit-only retention, no TTL, no read-refresh)', () => {
    const registry = createRejectedCredentialRegistry({ limit: 3, now: () => 1000 });
    registry.recordByteIdenticalRejection('fp-1');
    registry.recordByteIdenticalRejection('fp-1');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-1', 2), true, 'fp-1 is past threshold before any eviction pressure');
    registry.recordByteIdenticalRejection('fp-2');
    registry.recordByteIdenticalRejection('fp-3');
    // A fourth distinct fingerprint pushes the map past its configured limit
    // of 3 — fp-1 is the oldest WRITE, and the read above did not refresh its
    // position, so it is the one evicted.
    registry.recordByteIdenticalRejection('fp-4');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-1', 2), false, 'fp-1 silently de-escalates back to false once evicted, despite never being de-escalated by accept()/witnessAccepted()');
  });

  test('non-de-escalation: accept() does not clear or reduce the byte-identical-rejection count', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.recordByteIdenticalRejection('fp-a');
    registry.recordByteIdenticalRejection('fp-a');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), true);
    registry.accept('fp-a');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), true, 'accept() clears the suspect mark but must not de-escalate a past-threshold fingerprint');
  });

  test('non-de-escalation: a later witnessAccepted() (real non-401 provider-lane success) does not clear or reduce the byte-identical-rejection count', () => {
    const registry = createRejectedCredentialRegistry({ now: () => 1000 });
    registry.recordByteIdenticalRejection('fp-a');
    registry.recordByteIdenticalRejection('fp-a');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), true);
    registry.witnessAccepted('fp-a');
    assert.equal(registry.isPastByteIdenticalThreshold('fp-a', 2), true, 'a witnessed success must not de-escalate a past-threshold fingerprint — re-auth mints a new fingerprint instead');
  });
});
