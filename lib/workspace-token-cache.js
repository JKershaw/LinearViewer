/**
 * Injected-clock TTL cache for resolved workspace access tokens, with prompt
 * keyed-tombstone eviction (LIN-1507).
 *
 * Replaces the inline `_tokenCache` Map + 30s TTL in server.js's
 * `resolveWorkspaceAccess`. That inline cache made revocation (logout,
 * workspace removal, ...) 30s-fuzzy: a cached token kept being served for up
 * to `ttlMs` after the session row that granted it was gone. `evict(key)`
 * here makes revocation prompt instead — but eviction alone is not a
 * barrier: `resolveWorkspaceAccess` awaits a Mongo read before writing the
 * cache, so a resolve that read sessions BEFORE a logout can still write a
 * live token back AFTER it. `evict(key)` therefore also opens a keyed
 * tombstone window (`blockWindowMs`): `set(key, ...)` on that same key is
 * refused until the window passes. This closes the race without threading a
 * generation counter through `resolveWorkspaceAccess` — the tombstone lives
 * entirely inside the factory and is deterministically testable with an
 * injected clock.
 *
 * Cache key derivation is deliberately kept OUTSIDE the factory. The factory
 * treats `key` as an opaque string it never derives or inspects — callers
 * pass the pre-computed key. `workspaceTokenCacheKey` below is the single
 * shared helper every call site should use instead of re-deriving the
 * format inline, but it is a sibling export, not part of the factory: this
 * is LIN-1366's owner-isolation guarantee (commit `781efd68`), and a factory
 * that re-derived it even slightly differently could silently serve one
 * account another account's cached token.
 *
 * Mirrors the in-repo cache-factory precedents: `lib/task-done-cache.js`,
 * `lib/proxy-dedupe.js`, `lib/sessions-feed-cache.js`.
 */
import { UNSCOPED } from './workspace-token-resolver.js';
import { TOKEN_REFRESH_TIMEOUT_MS, TOKEN_REFRESH_MAX_RETRIES, TOKEN_REFRESH_RETRY_DELAY_MS } from './token-refresh.js';

const DEFAULT_TTL_MS = 30 * 1000; // 30s — matches the inline cache's prior TOKEN_CACHE_TTL_MS

// Must exceed the longest plausible in-flight resolve. That includes the
// LIN-1373 refresh-on-resolve path, which makes a NETWORK call — one attempt
// alone can take up to TOKEN_REFRESH_TIMEOUT_MS (10s), and a network error
// retries TOKEN_REFRESH_MAX_RETRIES more times (2, i.e. 3 attempts total)
// with exponential backoff between them (lib/token-refresh.js). Worst case:
// 3 * 10_000ms + (100ms + 200ms) backoff = 30_300ms. A resolve that reads
// sessions before a logout but finishes its refresh after the tombstone
// expired would cache a freshly-minted, live token for the full TTL after
// the owner logged out — so the window is derived from those constants
// (plus a margin) rather than hand-picked, so the two cannot drift apart.
// The only cost of overshooting is a legitimate post-logout resolve
// declining to cache for a few extra seconds; it simply re-resolves.
export const REFRESH_WORST_CASE_MS =
  (TOKEN_REFRESH_MAX_RETRIES + 1) * TOKEN_REFRESH_TIMEOUT_MS +
  TOKEN_REFRESH_RETRY_DELAY_MS * (2 ** TOKEN_REFRESH_MAX_RETRIES - 1);
export const DEFAULT_BLOCK_WINDOW_MS = REFRESH_WORST_CASE_MS + 5 * 1000; // +5s margin above the derived worst case

/**
 * Build the exact owner-isolation cache key (LIN-1366, commit 781efd68).
 * Verbatim format — every call site should use this instead of re-deriving
 * it, so the security boundary cannot silently drift between call sites.
 *
 * @param {string} urlKey
 * @param {string|symbol} [ownerAccountId=UNSCOPED]
 * @returns {string}
 */
export function workspaceTokenCacheKey(urlKey, ownerAccountId = UNSCOPED) {
  return `${urlKey}::${ownerAccountId === UNSCOPED ? '*' : ownerAccountId}`;
}

/**
 * Evict every cache entry a session destruction for `urlKey`/`ownerAccountId`
 * can leave stale (LIN-1507): the owner-scoped key AND the legacy owner-blind
 * `urlKey::*` key.
 *
 * The owner-blind key is not a theoretical concern — `getWorkspaceAccessToken`
 * (server.js) resolves owner-blind (UNSCOPED) for routes/dashboard.js's lazy
 * hydration, routes/proxy.js, and routes/test.js, and `selectOwnerWorkspaceToken`
 * (lib/workspace-token-resolver.js) scans ALL sessions with no accountId filter
 * when unscoped — so the `::*` entry can genuinely be holding the very token
 * that belonged to the session just destroyed. Evicting only the scoped key
 * would leave that entry free to keep serving a revoked token for up to the
 * full cache TTL, reproducing the defect LIN-1507 exists to close. The only
 * cost of also evicting the unscoped key is that it can drop an entry a
 * DIFFERENT user's session populated — bounded to a re-resolve plus the
 * tombstone's blockWindowMs; correctness is unaffected.
 *
 * No-ops if `evict` is falsy, so callers built without the optional
 * dependency (e.g. directly-constructed routers in existing tests) are safe.
 *
 * @param {(key: string) => void} [evict]
 * @param {string} urlKey
 * @param {string} [ownerAccountId]
 */
export function evictWorkspaceTokenPair(evict, urlKey, ownerAccountId) {
  if (!evict) return;
  evict(workspaceTokenCacheKey(urlKey, ownerAccountId));
  evict(workspaceTokenCacheKey(urlKey));
}

/**
 * Evict every workspace on a session before a WHOLE-session destroy
 * (LIN-1507) — the "capture accountId + workspaces[] before destroy(), then
 * evict" treatment. A thin loop over {@link evictWorkspaceTokenPair}; pulled
 * out because more than one call site needs the exact same loop and a
 * missed one is the defect this ticket exists to close (a session known to
 * hold N workspaces destroyed while only evicting 1 of them leaves the
 * others' cached tokens outliving the session for up to the cache TTL).
 *
 * Only correct for a genuine whole-session destroy where every workspace on
 * the session is about to lose its backing session row. Do NOT use this for
 * a single-workspace removal where the session survives — that path evicts
 * exactly the one removed workspace's pair (see routes/workspace.js's
 * remove-one-of-many branch), never every workspace on the session.
 *
 * @param {(key: string) => void} [evict]
 * @param {Array<{urlKey: string}>} [workspaces]
 * @param {string} [ownerAccountId]
 */
export function evictAllWorkspaceTokens(evict, workspaces, ownerAccountId) {
  for (const workspace of workspaces || []) {
    evictWorkspaceTokenPair(evict, workspace.urlKey, ownerAccountId);
  }
}

/**
 * @param {Object}   [opts]
 * @param {number}   [opts.ttlMs=30000]          - freshness window for a cached entry
 * @param {number}   [opts.blockWindowMs=DEFAULT_BLOCK_WINDOW_MS] - post-eviction window during which `set` on the same key is refused; defaults to the refresh path's derived worst case plus a margin (see DEFAULT_BLOCK_WINDOW_MS above)
 * @param {Function} [opts.now]                  - injectable clock (ms) for tests
 * @returns {{ get: Function, set: Function, evict: Function }}
 */
export function createWorkspaceTokenCache({ ttlMs = DEFAULT_TTL_MS, blockWindowMs = DEFAULT_BLOCK_WINDOW_MS, now = () => Date.now() } = {}) {
  const entries = new Map(); // key -> { value, cachedAt }
  const tombstones = new Map(); // key -> evictedAt

  // Drop tombstones whose block window has fully elapsed. Called on every
  // access so an evicted-then-never-revisited key doesn't linger forever —
  // the inline cache it replaces had zero deletes and grew monotonically;
  // this must not reproduce that.
  function pruneTombstones(currentTime) {
    for (const [key, evictedAt] of tombstones) {
      if (currentTime - evictedAt >= blockWindowMs) tombstones.delete(key);
    }
  }

  /**
   * Fresh cached value for `key`, or `undefined` on a miss/expiry.
   * @param {string} key
   * @returns {*}
   */
  function get(key) {
    const currentTime = now();
    pruneTombstones(currentTime);
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (currentTime - entry.cachedAt >= ttlMs) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Cache `value` under `key`, unless `key` is inside its post-eviction
   * tombstone block window — in which case the write is silently refused
   * (the race mitigation this factory exists for).
   * @param {string} key
   * @param {*} value
   * @returns {boolean} whether the write landed
   */
  function set(key, value) {
    const currentTime = now();
    pruneTombstones(currentTime);
    if (tombstones.has(key)) return false;
    entries.set(key, { value, cachedAt: currentTime });
    return true;
  }

  /**
   * Evict `key` immediately and open its tombstone write-block window.
   * Unrelated keys are untouched.
   * @param {string} key
   */
  function evict(key) {
    const currentTime = now();
    entries.delete(key);
    tombstones.set(key, currentTime);
    pruneTombstones(currentTime);
  }

  return { get, set, evict };
}
