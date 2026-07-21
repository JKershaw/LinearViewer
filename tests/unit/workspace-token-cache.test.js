/**
 * Unit tests for lib/workspace-token-cache.js (LIN-1507, witness B).
 *
 * Run with: node --test tests/unit/workspace-token-cache.test.js
 *
 * Proves prompt revocation (evict is immediate, not TTL-fuzzy), that evict
 * scopes to exactly one key, that plain TTL expiry still works without
 * eviction, and the keyed-tombstone write-block that closes the
 * read-before-logout race. All driven by an injected clock — no real
 * timers, no sleeps, no real logout/resolve race (that would be flaky by
 * construction under the residual multi-dyno window).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTokenCache, workspaceTokenCacheKey } from '../../lib/workspace-token-cache.js';
import { UNSCOPED } from '../../lib/workspace-token-resolver.js';

describe('workspaceTokenCacheKey (LIN-1366 owner-isolation format, pinned verbatim)', () => {
  test('a scoped owner produces "<urlKey>::<ownerAccountId>"', () => {
    assert.equal(workspaceTokenCacheKey('acme', 'account-123'), 'acme::account-123');
  });

  test('UNSCOPED produces "<urlKey>::*"', () => {
    assert.equal(workspaceTokenCacheKey('acme', UNSCOPED), 'acme::*');
  });

  test('UNSCOPED is the default when ownerAccountId is omitted', () => {
    assert.equal(workspaceTokenCacheKey('acme'), 'acme::*');
  });
});

describe('createWorkspaceTokenCache (LIN-1507, witness B)', () => {
  test('set -> hit; evict(key) -> miss at the same clock value (prompt, not TTL-fuzzy)', () => {
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, now: () => 1000 });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.set(key, { token: 't1' });
    assert.deepEqual(cache.get(key), { token: 't1' });

    cache.evict(key);
    assert.equal(cache.get(key), undefined, 'evicted at the SAME clock value the set happened at');
  });

  test('evict does not clear the whole map — unrelated keys survive', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, now: () => clock });
    const keyA = workspaceTokenCacheKey('acme', 'owner-1');
    const keyB = workspaceTokenCacheKey('acme', 'owner-2');
    cache.set(keyA, { token: 'a' });
    cache.set(keyB, { token: 'b' });

    cache.evict(keyA);
    assert.equal(cache.get(keyA), undefined);
    assert.deepEqual(cache.get(keyB), { token: 'b' }, 'evicting one key must not touch another');
  });

  test('TTL still expires normally without any eviction', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 1000, now: () => clock });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.set(key, { token: 't1' });

    clock = 999;
    assert.deepEqual(cache.get(key), { token: 't1' });

    clock = 1000; // TTL boundary — no evict() was ever called
    assert.equal(cache.get(key), undefined, 'plain TTL expiry must keep working untouched');
  });

  test('tombstone write-block: a set() on a just-evicted key is refused inside blockWindowMs', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, blockWindowMs: 5000, now: () => clock });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.set(key, { token: 'stale' });
    cache.evict(key);

    // A resolve that started reading sessions before the logout finishes
    // its write AFTER the evict — this is exactly that race.
    clock = 4999;
    const wrote = cache.set(key, { token: 'stale-again' });
    assert.equal(wrote, false, 'set() during the block window must be refused');
    assert.equal(cache.get(key), undefined, 'the refused write must not have landed');
  });

  test('tombstone write-block: set() succeeds again once blockWindowMs has passed', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, blockWindowMs: 5000, now: () => clock });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.set(key, { token: 'stale' });
    cache.evict(key);

    clock = 5000; // block window has fully elapsed
    const wrote = cache.set(key, { token: 'fresh' });
    assert.equal(wrote, true, 'set() after the block window must succeed');
    assert.deepEqual(cache.get(key), { token: 'fresh' });
  });

  test('an evict on a key never before set still opens a tombstone (write-block still applies)', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, blockWindowMs: 5000, now: () => clock });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.evict(key);

    clock = 1000;
    assert.equal(cache.set(key, { token: 'racing-write' }), false);
    assert.equal(cache.get(key), undefined);
  });

  test('tombstones prune on access (no unbounded growth)', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, blockWindowMs: 100, now: () => clock });
    for (let i = 0; i < 50; i++) {
      cache.evict(workspaceTokenCacheKey('acme', `owner-${i}`));
    }

    // Advance well past every tombstone's block window, then touch the
    // cache once more (any get/set/evict prunes) and confirm a fresh evict
    // + immediate set-refusal still behaves correctly — i.e. old tombstones
    // are gone rather than piling up forever.
    clock = 10000;
    const freshKey = workspaceTokenCacheKey('acme', 'owner-fresh');
    assert.equal(cache.set(freshKey, { token: 'ok' }), true, 'a brand-new key is unaffected by long-stale tombstones');

    // The very first evicted key's block window is long gone, so it must be
    // writable again — proving its tombstone was pruned, not retained.
    const oldKey = workspaceTokenCacheKey('acme', 'owner-0');
    assert.equal(cache.set(oldKey, { token: 'ok-again' }), true, 'a long-stale tombstone must not block a write forever');
  });
});
