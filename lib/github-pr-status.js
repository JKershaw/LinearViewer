// PR-state reader for the public GitHub REST API (LIN-2624).
//
// LIN-3247: this module is a behaviour-preserving extraction of the
// `get_pr_status` reader that used to be private to `lib/chat-tools.js` (Pass-5
// there). `fetchPrStatus`, `fetchGitHubJson`, `isNotFoundOrThrow`,
// `resolveRepoAllowlist` and the `requireProviderMethod` helper they strictly
// need are moved here verbatim; `lib/chat-tools.js` imports them back, so the
// chat tool's output shape is byte-for-byte unchanged (pinned by the untouched
// tests/unit/chat-tools.test.js). The run-evidence route (LIN-3247) calls the
// same reader through `readPrStatusFailOpen` below — same allowlist, its own
// 60-second cache, and a fail-open "unknown" result when the read throws or a
// repo the workspace names is not readable.

import { knownWorkspaceRepos } from './workspace-repos.js';
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
 * LIN-2624: the repo allowlist for `get_pr_status`, derived fresh at call time
 * so it can never drift from what this workspace actually names — never a
 * model-supplied value. Two sources, both read-only:
 *   1. `knownWorkspaceRepos` over this call's own `provider.fetchProjects`
 *      read (the same `repo=` project-description convention every other
 *      repo-aware surface uses — `lib/workspace-repos.js`).
 *   2. The active GitHub binding's own repo, when `scope` carries one
 *      (`{ token, repo }`/`{ token, scope }`, the GitHub provider families'
 *      shape — see `createChatToolCatalog`'s `scope` JSDoc). A bare string
 *      scope (Linear) contributes nothing here.
 * @param {Object} provider
 * @param {string|Object} scope
 * @returns {Promise<Set<string>>}
 */
export async function resolveRepoAllowlist(provider, scope) {
  requireProviderMethod(provider, 'fetchProjects');
  const { projects } = await provider.fetchProjects(scope);
  const allowlist = new Set(
    knownWorkspaceRepos(projects || [])
      .map(row => row.repo)
      .filter(Boolean)
  );
  const scopeRepo = scope && typeof scope === 'object' ? scope.repo : null;
  if (scopeRepo) allowlist.add(scopeRepo);
  return allowlist;
}

/**
 * LIN-2624: one GET against the public GitHub REST API, returning a uniform
 * `{ ok, status, body }` shape regardless of whether the response is JSON
 * (GitHub always sends JSON, success or error, for the endpoints this tool
 * calls). Never throws on a non-2xx status — the caller decides what a 404 or
 * a 403 means for the specific endpoint it just called.
 * @param {Function} doFetch - fetch-compatible function
 * @param {string} path - e.g. "/repos/owner/name"
 * @returns {Promise<{ok: boolean, status: number, body: Object|null}>}
 */
export async function fetchGitHubJson(doFetch, path) {
  const res = await withTimeout(
    doFetch(`${GITHUB_REST_API_BASE}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }),
    GITHUB_VIEWER_TIMEOUT_MS,
    `GitHub GET ${path}`
  );
  const body = typeof res.json === 'function' ? await res.json() : null;
  return { ok: !!res.ok, status: res.status, body };
}

/**
 * LIN-2624 review finding: a 404 and a 403 (rate-limited/forbidden) must NOT
 * be conflated. Only a genuine 404 is read as "not found" (or, at the repo
 * probe, "private") — every other non-2xx status (403 from the 60/hour
 * unauthenticated budget included) throws a real, distinguishable error
 * rather than being silently misreported as private or as an empty result.
 * @param {{ok: boolean, status: number}} response
 * @param {string} context - human label for the error message
 * @returns {boolean} true when the response was a 404
 */
export function isNotFoundOrThrow(response, context) {
  if (response.ok) return false;
  if (response.status === 404) return true;
  const err = new Error(`GitHub API error ${context}: HTTP ${response.status}`);
  err.status = response.status;
  throw err;
}

/**
 * LIN-2624: the whole `get_pr_status` read, isolated from the executor's
 * validation/allowlist/cache wrapping so each concern can be tested/read on
 * its own. See the Pass-5 header comment above for the private-repo shape.
 * @param {Function} doFetch
 * @param {{repo: string, number?: string|number, sha?: string}} args
 */
export async function fetchPrStatus(doFetch, { repo, number, sha }) {
  const visibility = await fetchGitHubJson(doFetch, `/repos/${repo}`);
  // An unauthenticated GitHub GET returns 404 for BOTH "private" and "does
  // not exist" — it never distinguishes, by design. This tool answers
  // "not readable: private repository" for that shape, because the caller
  // only ever names a repo THIS workspace already vouches for (the allowlist
  // above), so a repo it names that this read cannot see is private, not
  // nonexistent. A 403 (rate limit, or another forbidden reason) is NOT
  // folded into this — `isNotFoundOrThrow` throws for it instead, so a
  // rate-limited readout surfaces honestly rather than as a false "private"
  // claim. `visibility.body?.private` is a belt-and-braces second signal for
  // the (today unreachable, since this fetch is always unauthenticated in
  // V1) case where a 200 response ever carries `private: true`.
  if (isNotFoundOrThrow(visibility, `checking ${repo}`) || visibility.body?.private === true) {
    return { repo, readable: false, reason: 'not readable: private repository' };
  }

  let pr = null;
  if (number !== undefined) {
    const prResponse = await fetchGitHubJson(doFetch, `/repos/${repo}/pulls/${number}`);
    if (isNotFoundOrThrow(prResponse, `fetching PR #${number} in ${repo}`)) {
      throw new Error(`PR #${number} not found in ${repo}`);
    }
    pr = prResponse.body;
  }

  const ref = sha !== undefined ? sha : pr?.head?.sha;
  const [checkRunsResponse, statusResponse] = await Promise.all([
    fetchGitHubJson(doFetch, `/repos/${repo}/commits/${ref}/check-runs`),
    fetchGitHubJson(doFetch, `/repos/${repo}/commits/${ref}/status`),
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

function failOpenCacheKey(repo, number, sha) {
  return `${repo}|${number ?? ''}|${sha ?? ''}`;
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
 * LIN-3247: the fail-open PR-state read the run-evidence route calls. Same
 * allowlist as the chat tool (`resolveRepoAllowlist`), its own 60-second cache,
 * and never throws: a thrown GitHub read (403 rate limit, timeout), a
 * `readable: false` result (a repo the workspace names that the unauthenticated
 * read cannot see), or an allowlist read that cannot be resolved all yield
 * `{ readable: false, state: 'unknown' }` — the page says "not checked" rather
 * than blocking. A readable result passes through unchanged, so its `state`
 * field still means the PR's own open/merged/closed state.
 *
 * @param {Object} args
 * @param {Object} args.provider
 * @param {string|Object} args.scope
 * @param {string} args.repo
 * @param {string|number} [args.number]
 * @param {string} [args.sha]
 * @param {Function} [args.doFetch] - fetch-compatible seam; defaults to the
 *   egress-proxy fetch or the global fetch.
 * @param {Set<string>} [args.allowlist] - an already-resolved repo allowlist
 *   (LIN-3247 route seam); when given, `resolveRepoAllowlist` is not re-read.
 * @param {Map} [args.cache]
 * @param {Function} [args.now]
 * @returns {Promise<Object>}
 */
export async function readPrStatusFailOpen({
  provider,
  scope,
  repo,
  number,
  sha,
  doFetch,
  allowlist: providedAllowlist,
  cache = failOpenPrStatusCache,
  now = Date.now,
} = {}) {
  const cacheKey = failOpenCacheKey(repo, number, sha);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return cached.value;

  let result;
  try {
    const allowlist = providedAllowlist || await resolveRepoAllowlist(provider, scope);
    if (!allowlist.has(repo)) {
      result = unknownPrStatus(repo, `repo "${repo}" is not in this workspace's allowed repo list`);
    } else {
      const fetchImpl = doFetch || (await createProxyFetch()) || globalThis.fetch;
      const raw = await fetchPrStatus(fetchImpl, { repo, number, sha });
      result = raw.readable === false ? unknownPrStatus(repo, raw.reason) : raw;
    }
  } catch (err) {
    result = unknownPrStatus(repo, err?.message || 'not checked');
  }

  cache.set(cacheKey, { value: result, expiresAt: now() + PR_STATUS_CACHE_TTL_MS });
  return result;
}
