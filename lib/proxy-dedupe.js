/**
 * Deterministic short-window dedupe for non-idempotent proxy creates (LIN-399).
 *
 * The transport layer (lib/proxy-fetch.js) no longer replays mutations, which
 * closes the in-process retry that minted byte-identical duplicate comments.
 * This cache closes the *other* layer: a consumer (or its infra) that retries
 * a create as a fresh HTTP request after a lost response. Keyed by
 * workspace + issue + a hash of the body, an identical create that arrives
 * within the TTL window collapses to the first result instead of minting a
 * second write — so a confirming retry is safe rather than duplicating.
 *
 * Scope is intentionally narrow: an in-process map covering the realistic
 * retry window (transport backoff is seconds; an agent's "retry once" is
 * seconds). It is best-effort for truly concurrent or cross-process retries;
 * the authoritative guarantees are the transport no-replay plus the clearer
 * response contract that tells consumers not to blind-retry creates.
 */
import { createHash, randomUUID } from 'crypto';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_GEN_LIMIT = 4096;

/**
 * Build a stable dedupe key from arbitrary string parts. Each part is encoded
 * as a netstring-style `<length>:<content>` token before hashing. The decimal
 * length (terminated by the `:`) tells the reader exactly how many content
 * bytes follow, so the boundary between parts is unambiguous and they cannot
 * collide across it (e.g. ["ab","c"] -> "2:ab1:c" vs ["a","bc"] -> "1:a2:bc").
 *
 * The length-prefix is the *whole* collision guarantee — no extra delimiter
 * byte between tokens is needed. (An earlier revision appended a trailing
 * separator here, a literal NUL (U+0000), as a secondary delimiter; it was
 * redundant given the length-prefix, and the control byte also made this
 * whole source file classify as binary to grep/diff/code-review. It has been
 * dropped — see LIN-440.)
 */
export function dedupeKey(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    const str = String(part ?? '');
    hash.update(`${str.length}:${str}`);
  }
  return hash.digest('hex');
}

/**
 * Create an in-memory TTL dedupe cache.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs] window during which an identical key collapses
 * @param {() => number} [opts.now] clock injection for tests
 * @returns {{ get(key): any|undefined, set(key, value): void, size: number }}
 */
export function createDedupeCache({ ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const entries = new Map(); // key -> { value, expiresAt }

  function prune(currentTime) {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  }

  return {
    /** Return the remembered value for key if still within the window, else undefined. */
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },

    /** Remember value under key for the TTL window. */
    set(key, value) {
      const currentTime = now();
      prune(currentTime);
      entries.set(key, { value, expiresAt: currentTime + ttlMs });
    },

    get size() {
      prune(now());
      return entries.size;
    }
  };
}

/**
 * Create an invalidation-generation tracker (LIN-1160, widened by LIN-2005).
 *
 * Pairs with `createDedupeCache`/`dedupeKey` above: fold `current(key)` into a
 * `dedupeKey(...)` call so a `bump(key)` mints a new tag and every dedupe
 * entry computed under the old tag silently stops matching (cache miss ->
 * fresh mint), without `createDedupeCache` needing a delete/invalidate method
 * of its own.
 *
 * Eviction danger: on a bounded Map, evicting a key's generation must NOT
 * make `current(key)` fall back to the pre-eviction (i.e. pre-any-bump)
 * value — that resurrects a dedupe entry that a bump was meant to kill,
 * silently reintroducing a stale-success bug. That fallback is safe ONLY for
 * a diagnostics-only consumer (nothing gates a response on a lost entry);
 * this primitive is not that, so `limit` must be sized to the caller's real
 * key cardinality (effectively unreachable), not copied from a smaller,
 * diagnostics-sized bound.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit] max distinct keys retained before the oldest
 *   is evicted (LRU by touch order, same discipline as createDedupeCache's
 *   TTL pruning). Defaults far above any realistic key cardinality; inject a
 *   small value in tests to exercise the eviction path directly.
 * @returns {{ current(key): string, bump(key): void, size: number }}
 */
export function createGenerationTracker({ limit = DEFAULT_GEN_LIMIT } = {}) {
  const generations = new Map(); // key -> generation tag

  return {
    /** Return the current generation tag for key, '' if never bumped. */
    current(key) {
      return generations.get(key) ?? '';
    },

    /** Mint a fresh generation tag for key, invalidating its prior dedupe entries. */
    bump(key) {
      // Re-insert so the most recently used key moves to the back of the
      // eviction order; without the delete, a hot key keeps its original
      // position and can be evicted while cold keys survive.
      generations.delete(key);
      generations.set(key, randomUUID());
      if (generations.size > limit) {
        generations.delete(generations.keys().next().value);
      }
    },

    get size() {
      return generations.size;
    }
  };
}
