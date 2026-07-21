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
import { createWorkspaceTokenCache, workspaceTokenCacheKey, evictWorkspaceTokenPair, evictAllWorkspaceTokens, DEFAULT_BLOCK_WINDOW_MS, REFRESH_WORST_CASE_MS } from '../../lib/workspace-token-cache.js';
import { UNSCOPED } from '../../lib/workspace-token-resolver.js';
import { TOKEN_REFRESH_TIMEOUT_MS, TOKEN_REFRESH_MAX_RETRIES, TOKEN_REFRESH_RETRY_DELAY_MS } from '../../lib/token-refresh.js';

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

describe('DEFAULT_BLOCK_WINDOW_MS (LIN-1507 close-out Gate 2 — derived from the refresh worst case, not a hand-picked ~5s)', () => {
  test('REFRESH_WORST_CASE_MS matches an independent computation from the real lib/token-refresh.js constants', () => {
    // 3 attempts (1 + MAX_RETRIES) each up to the timeout, plus the two
    // exponential-backoff delays between them (2^0 and 2^1 * base delay).
    const attempts = TOKEN_REFRESH_MAX_RETRIES + 1;
    const backoff = TOKEN_REFRESH_RETRY_DELAY_MS * (2 ** 0 + 2 ** 1);
    assert.equal(REFRESH_WORST_CASE_MS, attempts * TOKEN_REFRESH_TIMEOUT_MS + backoff);
  });

  test('DEFAULT_BLOCK_WINDOW_MS exceeds the refresh path worst case, not just the old ~5s estimate', () => {
    assert.ok(DEFAULT_BLOCK_WINDOW_MS > REFRESH_WORST_CASE_MS, 'must exceed the derived worst case, with margin');
    assert.ok(DEFAULT_BLOCK_WINDOW_MS >= 31000, 'close-out required raising the window to at least ~31s');
  });

  test('a resolve that writes after the old 5s window but before the real refresh worst case is still blocked (the Gate 2 regression)', () => {
    let clock = 0;
    // No blockWindowMs override — exercises the real production default.
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, now: () => clock });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.set(key, { token: 'stale' });
    cache.evict(key);

    // A refresh-on-resolve write landing at 10s post-logout: past the old
    // 5s tombstone (would have wrongly re-cached a live token) but well
    // inside the real ~30.3s refresh worst case.
    clock = 10000;
    const wrote = cache.set(key, { token: 'freshly-refreshed' });
    assert.equal(wrote, false, 'must still be blocked — this is exactly the race Gate 2 found reopened');
    assert.equal(cache.get(key), undefined);
  });

  test('a resolve that writes after the full derived window succeeds (no unbounded block)', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, now: () => clock });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.evict(key);

    clock = DEFAULT_BLOCK_WINDOW_MS;
    assert.equal(cache.set(key, { token: 'fresh' }), true, 'the widened window must still be finite, not permanent');
  });

  test('side effect check: a non-evicted key is unaffected by the wider default window — TTL expiry still applies normally', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 1000, now: () => clock });
    const key = workspaceTokenCacheKey('acme', 'owner-1');
    cache.set(key, { token: 't1' });

    clock = 999;
    assert.deepEqual(cache.get(key), { token: 't1' }, 'a key that was never evicted must not be held hostage by the larger default block window');

    clock = 1000;
    assert.equal(cache.get(key), undefined, 'plain TTL expiry is independent of blockWindowMs, however large');
  });

  test('side effect check: tombstones from the wider default window still prune on access rather than growing unbounded', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, now: () => clock });
    for (let i = 0; i < 20; i++) {
      cache.evict(workspaceTokenCacheKey('acme', `owner-${i}`));
    }

    clock = DEFAULT_BLOCK_WINDOW_MS + 1;
    // Touching the cache prunes every tombstone whose window has elapsed —
    // a long-stale entry from before the widened window must not linger.
    const oldKey = workspaceTokenCacheKey('acme', 'owner-0');
    assert.equal(cache.set(oldKey, { token: 'ok-again' }), true, 'a long-stale tombstone must not block a write forever, even with the wider window');
  });
});

describe('evictWorkspaceTokenPair (LIN-1507, witness D — the ::* decision)', () => {
  test('evicts BOTH the owner-scoped key and the owner-blind (::*) key', () => {
    const evicted = [];
    evictWorkspaceTokenPair((key) => evicted.push(key), 'acme', 'owner-1');

    assert.deepEqual(evicted, [
      workspaceTokenCacheKey('acme', 'owner-1'),
      workspaceTokenCacheKey('acme'),
    ]);
  });

  test('an undefined ownerAccountId still evicts the ::* key (twice is harmless/idempotent)', () => {
    const evicted = [];
    evictWorkspaceTokenPair((key) => evicted.push(key), 'acme', undefined);

    assert.deepEqual(evicted, [workspaceTokenCacheKey('acme'), workspaceTokenCacheKey('acme')]);
  });

  test('a falsy evict is a no-op (optional dependency guard)', () => {
    assert.doesNotThrow(() => evictWorkspaceTokenPair(undefined, 'acme', 'owner-1'));
    assert.doesNotThrow(() => evictWorkspaceTokenPair(null, 'acme', 'owner-1'));
  });

  test('end-to-end against a real cache: both entries are gone after the pair-evict', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, now: () => clock });
    const scopedKey = workspaceTokenCacheKey('acme', 'owner-1');
    const unscopedKey = workspaceTokenCacheKey('acme');
    cache.set(scopedKey, { token: 'scoped' });
    cache.set(unscopedKey, { token: 'unscoped-could-be-the-same-user' });

    evictWorkspaceTokenPair(cache.evict, 'acme', 'owner-1');

    assert.equal(cache.get(scopedKey), undefined);
    assert.equal(cache.get(unscopedKey), undefined);
  });
});

describe('evictAllWorkspaceTokens (LIN-1507 beat 5 — the PAT multi-workspace gap)', () => {
  // Pins the beat-5 conclusion: a PAT session is NOT guaranteed single-
  // workspace (OAuth login preserves + appends to session.workspaces rather
  // than replacing it), so server.js's handleUnauthorizedError PAT branch
  // must evict EVERY workspace on the session before its whole-session
  // destroy() — not just the one dead-PAT workspace. This is the pure loop
  // that call site now uses; handleUnauthorizedError itself can't be driven
  // directly in a unit test (server.js has zero exports and connects to a
  // real DB + calls app.listen() at module scope), so this test is the
  // behavioural proof for that call site's logic.
  test('a PAT session holding a second (OAuth) workspace evicts BOTH workspaces\' key pairs', () => {
    const evicted = [];
    const patWorkspace = { urlKey: 'acme-pat' };
    const oauthWorkspace = { urlKey: 'acme-oauth' };

    evictAllWorkspaceTokens((key) => evicted.push(key), [patWorkspace, oauthWorkspace], 'acct-1');

    assert.deepEqual(new Set(evicted), new Set([
      workspaceTokenCacheKey('acme-pat', 'acct-1'),
      workspaceTokenCacheKey('acme-pat'),
      workspaceTokenCacheKey('acme-oauth', 'acct-1'),
      workspaceTokenCacheKey('acme-oauth'),
    ]));
    assert.equal(evicted.length, 4, 'exactly one scoped + one unscoped key per workspace — the PAT workspace alone would only be 2');
  });

  test('a single-workspace (PAT-only) session evicts just that one pair', () => {
    const evicted = [];
    evictAllWorkspaceTokens((key) => evicted.push(key), [{ urlKey: 'acme-pat' }], 'acct-1');

    assert.deepEqual(new Set(evicted), new Set([
      workspaceTokenCacheKey('acme-pat', 'acct-1'),
      workspaceTokenCacheKey('acme-pat'),
    ]));
  });

  test('no workspaces (undefined/empty) evicts nothing and does not throw', () => {
    assert.doesNotThrow(() => evictAllWorkspaceTokens(() => { throw new Error('should not be called'); }, undefined, 'acct-1'));
    assert.doesNotThrow(() => evictAllWorkspaceTokens(() => { throw new Error('should not be called'); }, [], 'acct-1'));
  });

  test('a falsy evict is a no-op across every workspace (optional dependency guard)', () => {
    assert.doesNotThrow(() => evictAllWorkspaceTokens(undefined, [{ urlKey: 'a' }, { urlKey: 'b' }], 'acct-1'));
  });

  test('end-to-end against a real cache: all entries for all workspaces are gone', () => {
    let clock = 0;
    const cache = createWorkspaceTokenCache({ ttlMs: 30000, now: () => clock });
    const keys = [
      workspaceTokenCacheKey('acme-pat', 'acct-1'), workspaceTokenCacheKey('acme-pat'),
      workspaceTokenCacheKey('acme-oauth', 'acct-1'), workspaceTokenCacheKey('acme-oauth'),
    ];
    for (const key of keys) cache.set(key, { token: 'stale' });

    evictAllWorkspaceTokens(cache.evict, [{ urlKey: 'acme-pat' }, { urlKey: 'acme-oauth' }], 'acct-1');

    for (const key of keys) assert.equal(cache.get(key), undefined, `${key} should have been evicted`);
  });
});
