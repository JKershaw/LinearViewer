// PR-state reader for the GitHub REST API (LIN-2624).
//
// LIN-3247: this module is a behaviour-preserving extraction of the
// `get_pr_status` reader that used to be private to `lib/chat-tools.js` (Pass-5
// there). `fetchPrStatus`, `fetchGitHubJson`, `isNotFoundOrThrow` and the
// `requireProviderMethod` helper they strictly need are moved here verbatim;
// `lib/chat-tools.js` imports them back, so the chat tool's output shape is
// byte-for-byte unchanged.
//
// LIN-3333: the repo allowlist (fed by the retired project `repo=` lines) is
// gone. There is no replacement source: a caller now
// names any `owner/name`, and `isGitHubRepoSlug` (below) is the safety
// check that stops a comment- or model-supplied string becoming an arbitrary
// `api.github.com` path. The run-evidence route (LIN-3247) calls the same
// reader through `readPrStatusFailOpen` below — its own 60-second cache and a
// fail-open "unknown" result when the read throws or a repo is not readable.
//
// LIN-3443: reads are anonymous unless the caller passes a `token`. Anonymous
// calls from Harbour's shared outbound address get HTTP 403 from GitHub, so a
// GitHub-bound workspace reads its own bound repo with the workspace token
// (`prReadToken` below decides who may). Every other repo stays anonymous.

import { createProxyFetch } from './proxy-fetch.js';
import { withTimeout, GITHUB_VIEWER_TIMEOUT_MS } from './providers/github/app-auth.js';

// LIN-2624: restated, not imported, from lib/providers/github/app-auth.js's own
// private `GITHUB_API_BASE` — that const is deliberately not exported (it is
// that module's own internal detail), and this tool talks to the plain public
// REST API, not the App-authenticated surface app-auth.js owns. Restating a
// literal is the same house convention observer-pipeline files use for a
// private prefix (see lib/chat-tools.js's own header, or
// lib/agent-turn.js's COMPANION_INSTANCE_PREFIX).
const GITHUB_REST_API_BASE = 'https://api.github.com';

/** How long a `get_pr_status` result is cached, per (repo, number, sha). */
export const PR_STATUS_CACHE_TTL_MS = 60 * 1000;

/**
 * Guard: ensure the bound provider actually implements the read function a tool
 * needs. A provider without the capability yields a clean error the model can
 * report, instead of a raw "provider.search is not a function" TypeError.
 * @param {Object} provider
 * @param {string} method
 */
export function requireProviderMethod(provider, method) {
  if (typeof provider?.[method] !== 'function') {
    throw new Error(`This workspace's provider does not support ${method}.`);
  }
}

/**
 * LIN-3333: is `repo` a safe GitHub `owner/name` slug? The allowlist used to be
 * the only thing keeping a comment/model-supplied string out of a GitHub path,
 * so with it gone this is the replacement guard: exactly one `/`, both parts
 * non-empty `[A-Za-z0-9_.-]+`, and neither part `.`/`..` (a bare `.`/`..`
 * segment passes the character class but must not reach `api.github.com`).
 * `fetchPrStatus` refuses a non-slug before building any path.
 * @param {string} repo
 * @returns {boolean}
 */
export function isGitHubRepoSlug(repo) {
  if (typeof repo !== 'string') return false;
  const parts = repo.split('/');
  if (parts.length !== 2) return false;
  return parts.every(part =>
    part !== '' && part !== '.' && part !== '..' && /^[A-Za-z0-9_.-]+$/.test(part)
  );
}

/**
 * LIN-3443: the one rule for who may use the workspace's GitHub token to read a
 * PR. Only the GitHub-issues call scope (`{ repo, token }`, from
 * `getBindingCallScope`) qualifies, and only for the repo it is bound to
 * (case-insensitive) — comment text can name any `owner/name`, so any other
 * repo stays anonymous. Linear (string scope), Jira and Projects v2 yield null.
 * @param {*} callScope
 * @param {string} repo - the PR's `owner/name`
 * @returns {string|null}
 */
export function prReadToken(callScope, repo) {
  if (!callScope || typeof callScope !== 'object') return null;
  if (typeof callScope.repo !== 'string' || typeof callScope.token !== 'string' || !callScope.token) return null;
  if (typeof repo !== 'string' || repo.toLowerCase() !== callScope.repo.toLowerCase()) return null;
  return callScope.token;
}

/**
 * LIN-3443: a token is only ever cached under a workspace scope key; a token
 * without one would share a cache entry with anonymous (or another workspace's)
 * reads. A programming error, so it throws rather than failing open.
 */
export function assertTokenHasScopeKey(token, scopeKey) {
  if (token && !scopeKey) {
    throw new Error('PR-state read with a token requires a scopeKey');
  }
}

/**
 * LIN-2624: one GET against the GitHub REST API, returning a uniform
 * `{ ok, status, body, rateRemaining }` shape regardless of whether the response is JSON
 * (GitHub always sends JSON, success or error, for the endpoints this tool
 * calls). Never throws on a non-2xx status — the caller decides what a 404 or
 * a 403 means for the specific endpoint it just called.
 * @param {Function} doFetch - fetch-compatible function
 * @param {string} path - e.g. "/repos/owner/name"
 * @param {{token?: string|null}} [opts] - sent as a Bearer token when present
 * @returns {Promise<{ok: boolean, status: number, body: Object|null, rateRemaining: string|null}>}
 */
export async function fetchGitHubJson(doFetch, path, { token } = {}) {
  const res = await withTimeout(
    doFetch(`${GITHUB_REST_API_BASE}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'harbour',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }),
    GITHUB_VIEWER_TIMEOUT_MS,
    `GitHub GET ${path}`
  );
  const body = typeof res.json === 'function' ? await res.json() : null;
  const rateRemaining = res.headers && typeof res.headers.get === 'function'
    ? res.headers.get('x-ratelimit-remaining') : null;
  return { ok: !!res.ok, status: res.status, body, rateRemaining: rateRemaining ?? null };
}

/**
 * LIN-2624 review finding: a 404 and a 403 (rate-limited/forbidden) must NOT
 * be conflated. Only a genuine 404 is read as "not found" (or, at the repo
 * probe, "private") — every other non-2xx status (403 from the 60/hour
 * unauthenticated budget included) throws a real, distinguishable error
 * rather than being silently misreported as private or as an empty result.
 * @param {{ok: boolean, status: number, body?: Object|null, rateRemaining?: string|null}} response
 * @param {string} context - human label for the error message
 * @returns {boolean} true when the response was a 404
 */
export function isNotFoundOrThrow(response, context) {
  if (response.ok) return false;
  if (response.status === 404) return true;
  // LIN-3443: say why GitHub refused (its message, the remaining quota) so the
  // `Run PR-state read failed:` log line is diagnosable.
  const message = response.body && typeof response.body.message === 'string' ? response.body.message : null;
  const detail = [
    message ? `: ${message}` : '',
    response.rateRemaining != null ? ` (x-ratelimit-remaining ${response.rateRemaining})` : '',
  ].join('');
  const err = new Error(`GitHub API error ${context}: HTTP ${response.status}${detail}`);
  err.status = response.status;
  throw err;
}

/**
 * LIN-2624: the whole `get_pr_status` read, isolated from the executor's
 * validation/cache wrapping so each concern can be tested/read on its own. See
 * the Pass-5 header comment above for the private-repo shape.
 * @param {Function} doFetch
 * @param {{repo: string, number?: string|number, sha?: string, token?: string|null}} args
 */
export async function fetchPrStatus(doFetch, { repo, number, sha, token }) {
  if (!isGitHubRepoSlug(repo)) {
    throw new Error(`Invalid GitHub repo: ${JSON.stringify(repo)} (expected owner/name)`);
  }
  const visibility = await fetchGitHubJson(doFetch, `/repos/${repo}`, { token });
  // An unauthenticated GitHub GET returns 404 for BOTH "private" and "does
  // not exist" — it never distinguishes, by design. LIN-3333: the allowlist
  // that used to vouch for a repo is gone, so this answer is "private **or**
  // unknown" — we can no longer assert the repo was one the workspace names.
  // A 403 (rate limit, or another forbidden reason) is NOT folded into this —
  // `isNotFoundOrThrow` throws for it instead, so a rate-limited readout
  // surfaces honestly rather than as a false "private" claim.
  // `visibility.body?.private` is a belt-and-braces second signal for the
  // (unreachable for an anonymous read) case where a 200 carries `private: true`.
  // LIN-3443: with a token that signal is not applied — a private bound repo is
  // exactly what the workspace's own access is allowed to read. A 404 (token
  // lacks access) still means "not readable".
  if (isNotFoundOrThrow(visibility, `checking ${repo}`) || (!token && visibility.body?.private === true)) {
    return { repo, readable: false, reason: 'not readable: private or unknown repository' };
  }

  let pr = null;
  if (number !== undefined) {
    const prResponse = await fetchGitHubJson(doFetch, `/repos/${repo}/pulls/${number}`, { token });
    if (isNotFoundOrThrow(prResponse, `fetching PR #${number} in ${repo}`)) {
      throw new Error(`PR #${number} not found in ${repo}`);
    }
    pr = prResponse.body;
  }

  const ref = sha !== undefined ? sha : pr?.head?.sha;
  const [checkRunsResponse, statusResponse] = await Promise.all([
    fetchGitHubJson(doFetch, `/repos/${repo}/commits/${ref}/check-runs`, { token }),
    fetchGitHubJson(doFetch, `/repos/${repo}/commits/${ref}/status`, { token }),
  ]);
  // A genuine 404 here (the ref itself doesn't exist) degrades to "no rows"
  // for that endpoint — GitHub itself returns 200-with-empty-array for a
  // real ref with no checks, so a 404 only happens for a bad ref. Anything
  // else non-2xx (403 included) throws via isNotFoundOrThrow, rather than
  // silently reading as "no CI checks", which LIN-2624 review flagged as the
  // same silently-wrong-answer failure mode this file's truncation budgets
  // exist to avoid.
  const checkRuns = isNotFoundOrThrow(checkRunsResponse, `fetching check-runs for ${repo}@${ref}`)
    ? [] : checkRunsResponse.body?.check_runs || [];
  const statuses = isNotFoundOrThrow(statusResponse, `fetching commit status for ${repo}@${ref}`)
    ? [] : statusResponse.body?.statuses || [];
  const checks = [
    ...checkRuns.map(run => ({ name: run.name, conclusion: run.conclusion })),
    ...statuses.map(status => ({ name: status.context, conclusion: status.state })),
  ];

  return {
    repo,
    readable: true,
    ...(pr ? {
      number: Number(number),
      state: pr.state,
      merged: !!pr.merged,
      head: { ref: pr.head?.ref, sha: pr.head?.sha },
      base: { ref: pr.base?.ref },
      mergeable: pr.mergeable ?? null,
    } : {}),
    ref,
    checks,
  };
}

// LIN-3247: the fail-open reader's own cache, deliberately separate from the
// chat tool's (`lib/chat-tools.js`), so a page read and a chat read never share
// entries. Keyed the same way: `repo|number|sha`.
const failOpenPrStatusCache = new Map();

// LIN-3443: an authenticated read is keyed under its workspace `scopeKey`, so
// it never shares an entry with an anonymous read or another workspace's.
function failOpenCacheKey(repo, number, sha, scopeKey) {
  return `${scopeKey ? `${scopeKey}|` : ''}${repo}|${number ?? ''}|${sha ?? ''}`;
}

/**
 * Test seam (LIN-3247): prime the fail-open cache with a scripted PR state so
 * an e2e can exercise the run-evidence page hermetically — no live GitHub read.
 * Not used in production; `clearFailOpenPrStatus` resets between runs.
 */
export function primeFailOpenPrStatus({ repo, number, sha, value, ttlMs = PR_STATUS_CACHE_TTL_MS, now = Date.now } = {}) {
  failOpenPrStatusCache.set(failOpenCacheKey(repo, number, sha), { value, expiresAt: now() + ttlMs });
}

/** Test seam (LIN-3247): clear the fail-open cache. */
export function clearFailOpenPrStatus() {
  failOpenPrStatusCache.clear();
}

function unknownPrStatus(repo, reason) {
  return { repo, readable: false, state: 'unknown', reason };
}

/**
 * LIN-3247: the fail-open PR-state read the run-evidence route calls. Its own
 * 60-second cache, and never throws: a thrown GitHub read (403 rate limit,
 * timeout) or a `readable: false` result (a repo the read cannot
 * see) both yield `{ readable: false, state: 'unknown' }` — the page says "not
 * checked" rather than blocking. A readable result passes through unchanged, so
 * its `state` field still means the PR's own open/merged/closed state.
 *
 * LIN-3333: the allowlist is gone, so this also no longer takes a
 * `provider`/`scope`. `repo` is validated as an `owner/name` slug inside
 * `fetchPrStatus`; a non-slug throws and is folded into the fail-open unknown.
 *
 * @param {Object} args
 * @param {string} args.repo
 * @param {string|number} [args.number]
 * @param {string} [args.sha]
 * @param {string|null} [args.token] - the workspace's GitHub token (from
 *   `prReadToken`); omitted → anonymous. Requires `scopeKey`, else throws.
 * @param {string} [args.scopeKey] - workspace key the cache entry is held under
 * @param {Function} [args.doFetch] - fetch-compatible seam; defaults to the
 *   egress-proxy fetch or the global fetch.
 * @param {Map} [args.cache]
 * @param {Function} [args.now]
 * @returns {Promise<Object>}
 */
export async function readPrStatusFailOpen({
  repo,
  number,
  sha,
  token,
  scopeKey,
  doFetch,
  cache = failOpenPrStatusCache,
  now = Date.now,
} = {}) {
  // Outside the try/catch below on purpose: a swallowed throw would silently
  // become an anonymous-equivalent read.
  assertTokenHasScopeKey(token, scopeKey);
  const cacheKey = failOpenCacheKey(repo, number, sha, token ? scopeKey : undefined);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return cached.value;

  let result;
  try {
    const fetchImpl = doFetch || (await createProxyFetch()) || globalThis.fetch;
    const raw = await fetchPrStatus(fetchImpl, { repo, number, sha, token });
    result = raw.readable === false ? unknownPrStatus(repo, raw.reason) : raw;
  } catch (err) {
    result = unknownPrStatus(repo, err?.message || 'not checked');
  }

  cache.set(cacheKey, { value: result, expiresAt: now() + PR_STATUS_CACHE_TTL_MS });
  return result;
}
