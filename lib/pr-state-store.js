// PR-state store (LIN-3311): the LIN-3251 run-page PR-state
// cache and upstream budget, lifted out of the closure in
// `createDashboardRoutes` so more than one caller can share ONE instance.
// server.js builds a single store and hands it to the dashboard router, so the
// 36/h GitHub budget and the `owner/repo#number` cache are spent and filled
// once, whoever reads.
//
// Moved, not rewritten: the constants, TTL rule, payload shapes, sliding budget,
// counting fetch and fail-open read are the route's code as it stood at
// `b35d1d8c`. Every cache entry carries `fetchedAt` (ms) — when the value was
// read upstream. `readResult(ref, nowMs)` returns the raw reader result with its
// age and provenance (`via`); `readPayload` is the route's old `readPrState`,
// now a thin wrapper.
//
// LIN-3333: the per-workspace repo-allowlist cache is gone with the `repo=`
// allowlist it fed.

import { fetchPrStatus, assertTokenHasScopeKey } from './github-pr-status.js';
import { summarizeChecks } from './run-evidence.js';
import { createProxyFetch } from './proxy-fetch.js';

// PR-state cache + upstream budget (LIN-3251, S1b of LIN-2948, condition C1).
// The whole reader result is cached per `owner/repo#number`: 15 min while the PR
// is open, 24 h once merged or closed. Run pages share a process-wide budget of
// 36 upstream GitHub calls in any sliding 60-minute span — a log of call
// timestamps, not a fixed window — so the cap holds across window boundaries.
// When it is spent the route serves the stale value or "state not reported" and
// never lets another reader see a 403.
export const PR_STATE_OPEN_TTL_MS = 15 * 60 * 1000;
export const PR_STATE_CLOSED_TTL_MS = 24 * 60 * 60 * 1000;
export const PR_STATE_UPSTREAM_LIMIT = 36;
export const PR_STATE_WINDOW_MS = 60 * 60 * 1000;
// One `fetchPrStatus` read makes up to this many upstream calls (repo probe,
// pull, check-runs, commit status). The precheck reserves the whole read so a
// read that starts is never cut off mid-flight (which would waste its calls).
export const PR_STATE_READ_COST = 4;
export const PR_STATE_BUDGET_EXHAUSTED = 'PR_STATE_BUDGET_EXHAUSTED';

/** How a `readResult` value was obtained. */
export const PR_STATE_VIA = Object.freeze({
  FRESH: 'fresh', // read upstream by this call
  CACHE: 'cache', // a cache entry inside its TTL
  STALE: 'stale', // a cache entry served because a re-read could not run or failed
  UNAVAILABLE: 'unavailable' // nothing cached and no read possible
});

// Test seam (LIN-3251, RC2). The default whole-reader cache is process-wide so
// the NODE_ENV=test `/test/seed-pr-status` route can prime it (reusing LIN-3247's
// existing seed) and an e2e can assert that the primed-cache path made no live
// GitHub call. Unit tests inject their own cache, so this shared map is only
// the real server's. The counter counts every store's upstream calls.
const prStateSharedCache = new Map();
let prStateUpstreamFetches = 0;

/** Prime the whole-reader cache for `owner/repo#number` (test-only caller). */
export function primePrStateCache({ repo, number, value, ttlMs = PR_STATE_CLOSED_TTL_MS, now = Date.now } = {}) {
  const at = now();
  prStateSharedCache.set(`${repo}#${number}`, { value, expiresAt: at + ttlMs, fetchedAt: at });
}

/** Clear the shared whole-reader cache and the live-fetch counter (test-only). */
export function clearPrStateCache() {
  prStateSharedCache.clear();
  prStateUpstreamFetches = 0;
}

/** Real upstream GitHub fetches the pr-state stores have made (test-only read). */
export function prStateUpstreamFetchCount() {
  return prStateUpstreamFetches;
}

/** The C1 TTL for a reader result: 15 min while open, else 24 h. */
export function prStateTtlMs(result) {
  const open = result && result.readable !== false && result.merged !== true && result.state === 'open';
  return open ? PR_STATE_OPEN_TTL_MS : PR_STATE_CLOSED_TTL_MS;
}

/** Shape a reader result into the pr-state route's JSON contract. */
export function prStatePayload(result, ref) {
  const fallbackNumber = ref ? ref.number : null;
  const url = ref ? ref.url : null;
  if (!result || result.readable === false) {
    return { state: 'unknown', number: fallbackNumber, checks: null, url };
  }
  const state = result.merged ? 'merged'
    : result.state === 'open' ? 'open'
    : result.state === 'closed' ? 'closed'
    : 'unknown';
  const summary = summarizeChecks(result.checks);
  const checks = summary === 'pending' ? 'running'
    : (summary === 'passing' || summary === 'failing') ? summary
    : null;
  return { state, number: result.number ?? fallbackNumber, checks, url };
}

export function prStateUnknown(ref) {
  return { state: 'unknown', number: ref ? ref.number : null, checks: null, url: ref ? ref.url : null };
}

/**
 * The run page's one-URL rule, pure: a run-evidence model's resolved PR URLs →
 * the single PR to read, or why there is none. Zero PRs is `none`; more than
 * one is `multiple` (the page withholds rather than picking one silently).
 *
 * @param {Object|null} model - a `buildRunEvidence`/`readRunEvidence` model
 * @returns {{ status: 'none'|'multiple'|'one', ref: ({repo: string, number: number, url: string}|null) }}
 */
export function resolveRunPrRef(model) {
  const urls = (model && model.state && model.state.prUrls) || [];
  if (urls.length === 0) return { status: 'none', ref: null };
  if (urls.length > 1) return { status: 'multiple', ref: null };
  return { status: 'one', ref: { repo: urls[0].repo, number: urls[0].number, url: urls[0].url } };
}

/**
 * Build a PR-state store. Every argument is optional; the defaults are the
 * production ones (the process-wide shared cache, a fresh budget log, the real
 * clock, the proxy-aware fetch).
 *
 * `bucket` is mutated in place (never reassigned), so a caller holding the
 * array — a test, say — sees every spend.
 *
 * @param {Object} [opts]
 * @param {Map} [opts.cache] - `repo#number` → `{ value, expiresAt, fetchedAt? }`
 * @param {number[]} [opts.bucket] - sliding log of upstream-call timestamps (ms), oldest first
 * @param {Function} [opts.now] - () → ms
 * @param {Function|null} [opts.githubFetch] - fetch override (tests); null → proxy fetch, then global fetch
 * @param {Function} [opts.createFetch] - async () → fetch|null (the proxy-aware default)
 */
export function createPrStateStore({
  cache = prStateSharedCache,
  bucket = [],
  now = Date.now,
  githubFetch = null,
  createFetch = createProxyFetch,
} = {}) {
  /**
   * The sliding upstream-call log, pruned to the last 60 minutes. Entries are
   * timestamps (ms), oldest first, capped at the limit. A log — not a fixed
   * `{windowStart, count}` window — is what makes the 36 cap hold in ANY
   * 60-minute span, not just aligned windows.
   */
  function budget(nowMs) {
    const cutoff = nowMs - PR_STATE_WINDOW_MS;
    while (bucket.length && bucket[0] <= cutoff) bucket.shift();
    return bucket;
  }

  /** Upstream calls already made in the trailing 60-minute span. */
  function budgetUsed(nowMs) {
    return budget(nowMs).length;
  }

  /**
   * A fetch wrapper that spends one budget unit per real upstream call and
   * refuses (rather than overruns) once the span's 36 are used. This is the
   * backstop behind the precheck's whole-read reservation; the refusal is a
   * distinct thrown code the caller turns into stale/unknown, never a 403.
   */
  function countingFetch(fetchImpl) {
    return async (url, opts) => {
      const at = now();
      const log = budget(at);
      if (log.length >= PR_STATE_UPSTREAM_LIMIT) {
        const err = new Error('run-page PR-state upstream budget exhausted');
        err.code = PR_STATE_BUDGET_EXHAUSTED;
        throw err;
      }
      log.push(at);
      prStateUpstreamFetches += 1;
      return fetchImpl(url, opts);
    };
  }

  /**
   * The cached read for one resolved PR, with its age and provenance. On a
   * fresh cache hit nothing upstream runs. Before starting a read it reserves
   * room for the whole 4-call read in the trailing 60-minute span; if there is
   * no room it serves the last value (`stale`) or nothing (`unavailable`)
   * without starting a read that could be cut off mid-flight. A failed read is
   * fail-open the same way.
   *
   * LIN-3443: with a `token` (from `prReadToken`) the read is authenticated. It
   * is cached under `scopeKey|repo#number`, never the anonymous key, and skips
   * the anonymous 36/h budget and fetch counter (the installation quota is
   * separate). A token without a `scopeKey` throws before any cache access.
   *
   * @param {{repo: string, number: number}} ref
   * @param {number} nowMs
   * @param {{token?: string|null, scopeKey?: string}} [auth]
   * @returns {Promise<{ result: Object|null, fetchedAt: number|null, via: string }>}
   */
  async function readResult(ref, nowMs, { token, scopeKey } = {}) {
    assertTokenHasScopeKey(token, scopeKey);
    const key = token ? `${scopeKey}|${ref.repo}#${ref.number}` : `${ref.repo}#${ref.number}`;
    const cached = cache.get(key);
    const cachedAt = cached && Number.isFinite(cached.fetchedAt) ? cached.fetchedAt : null;
    if (cached && cached.expiresAt > nowMs) {
      return { result: cached.value, fetchedAt: cachedAt, via: PR_STATE_VIA.CACHE };
    }
    const fallback = () => (cached
      ? { result: cached.value, fetchedAt: cachedAt, via: PR_STATE_VIA.STALE }
      : { result: null, fetchedAt: null, via: PR_STATE_VIA.UNAVAILABLE });
    if (!token && budgetUsed(nowMs) + PR_STATE_READ_COST > PR_STATE_UPSTREAM_LIMIT) {
      return fallback();
    }
    const fetchImpl = githubFetch || (await createFetch()) || globalThis.fetch;
    try {
      const result = await fetchPrStatus(token ? fetchImpl : countingFetch(fetchImpl), {
        repo: ref.repo, number: ref.number, token
      });
      cache.set(key, { value: result, expiresAt: nowMs + prStateTtlMs(result), fetchedAt: nowMs });
      return { result, fetchedAt: nowMs, via: PR_STATE_VIA.FRESH };
    } catch (err) {
      if (err && err.code !== PR_STATE_BUDGET_EXHAUSTED) {
        console.error('Run PR-state read failed:', err.message);
      }
      return fallback();
    }
  }

  /**
   * The route's payload read (LIN-3251's `readPrState`): `readResult` shaped
   * into `{ state, number, checks, url }`. Nothing read → "state not reported".
   */
  async function readPayload(ref, nowMs, auth) {
    const { result } = await readResult(ref, nowMs, auth);
    return result ? prStatePayload(result, ref) : prStateUnknown(ref);
  }

  return {
    cache,
    bucket,
    now,
    budgetUsed,
    readResult,
    readPayload
  };
}
