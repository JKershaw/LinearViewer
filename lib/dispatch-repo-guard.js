/**
 * Dispatch `repo` override validation at the Harbour seam (LIN-2886).
 *
 * The real gap this closes: Harbour accepts `repo` as an opaque field
 * (`validateOpaqueDispatchField`, routes/proxy-dispatch.js) and forwards it
 * blindly. A typo, a URL where a basename was meant, or an injected value
 * costs a wasted dispatch, a confusing terminal failure on the runner
 * (simple-dispatcher's `admission.js` rejects an `item.repo` that matches no
 * configured workspace folder basename), and a five-minute duplicate-guard
 * wait before a retry (LIN-2872). This is NOT a clone-arbitrary-URL threat —
 * simple-dispatcher's `dispatcher.js` resolves `item.repo` only against the
 * folder basenames of its configured workspaces (LIN-2172); it never clones
 * anything. The fix is validating against the workspace's own known-repos
 * inventory (LIN-1935, `lib/workspace-repos.js`'s `knownWorkspaceRepos`)
 * BEFORE enqueueing, so a bad value never reaches the runner at all.
 *
 * Accepted here does NOT mean resolvable by the runner (LIN-2974). This checks
 * the TRACKER's namespace (project `repo=` lines). The runner resolves against
 * its HOST's namespace (the folder basenames in `workspaces.json`), and nothing
 * keeps the two in sync. So the runner's own reject (admission.js) is a
 * separate check against a different list, not a narrower net behind this one.
 */

import { knownWorkspaceRepos } from './workspace-repos.js';

/** Programmatic discriminator on the 422 refusal body (LIN-2886). */
export const UNKNOWN_REPO_CODE = 'UNKNOWN_REPO';

/**
 * Bound on the extra `fetchProjects` round-trip this validation adds to a
 * dispatch that carries a `repo` override. A slow/hanging upstream must fail
 * OPEN quickly (see `validateDispatchRepo`'s catch below) rather than holding
 * up the whole dispatch — this is validation-adjacent, not the dispatch's own
 * purpose. Deliberately local rather than routes/proxy.js's own `withTimeout`
 * (module-scope there, not exported) — this module has no other dependency
 * on that file and stays independently testable.
 */
const FETCH_PROJECTS_TIMEOUT_MS = 8_000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('dispatch-repo-guard: fetchProjects timed out')), ms);
  });
  // Clear the timer as soon as either side settles — an uncleared timer keeps
  // the event loop (and, in tests, the process) alive for the full `ms` even
  // after the real call already won the race.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Extracts a candidate basename from a URL or `owner/name` form. Returns the
 * input trimmed and de-suffixed when it is already a bare basename (no `/`
 * or `:`), so calling this on an already-valid basename is a safe no-op.
 *
 * Handles:
 *   - `https://github.com/owner/name`, `.../name.git`, with query/hash/trailing slash
 *   - `git@github.com:owner/name.git` (SCP-like remote)
 *   - `owner/name` (no scheme)
 *
 * @param {string} repo - Raw `repo` value from the dispatch body.
 * @returns {string|null} The extracted basename, or null for an empty input.
 */
export function extractRepoBasename(repo) {
  if (typeof repo !== 'string') return null;
  let value = repo.trim();
  if (!value) return null;

  // Strip a URL's query/hash, then any trailing slash.
  value = value.split(/[?#]/)[0].replace(/\/+$/, '');

  const isUrlLike = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^[\w.-]+@[\w.-]+:/.test(value);
  if (isUrlLike) {
    // Scheme URL or SCP-like remote — take the segment after the LAST '/' or ':'
    // (covers both "https://host/owner/name" and "git@host:owner/name").
    const lastSep = Math.max(value.lastIndexOf('/'), value.lastIndexOf(':'));
    value = lastSep >= 0 ? value.slice(lastSep + 1) : value;
  } else if (value.includes('/')) {
    // Bare "owner/name" form — take the segment after the last '/'.
    value = value.slice(value.lastIndexOf('/') + 1);
  }

  value = value.replace(/\.git$/i, '');
  return value || null;
}

/**
 * Resolves a raw `repo` value against a workspace's known basenames.
 * Tries an exact basename match first (the common case, and the only form
 * that needs no parsing); falls back to extracting a basename from a URL or
 * `owner/name` form. Never widens acceptance beyond "maps to a known
 * basename" — an unrecognized value, or one that maps to a basename the
 * workspace doesn't have, is refused.
 *
 * @param {string} repo - Raw `repo` value.
 * @param {string[]} knownRepos - Known basenames (from `knownWorkspaceRepos`,
 *   excluding the `null` default row).
 * @returns {{ok: true, repo: string} | {ok: false}}
 */
export function resolveKnownRepo(repo, knownRepos) {
  if (knownRepos.includes(repo)) return { ok: true, repo };
  const basename = extractRepoBasename(repo);
  if (basename && knownRepos.includes(basename)) return { ok: true, repo: basename };
  return { ok: false };
}

/**
 * Validates + normalizes a dispatch `repo` override against the workspace's
 * known repos, fetched fresh via the provider (LIN-1935's inventory seam).
 * Read-only telemetry-adjacent, but unlike the poll-recency warning (LIN-2885)
 * this ONE DOES refuse — the ticket's whole point is validating before
 * enqueueing, not merely warning about it.
 *
 * Fails OPEN (skips validation, returns the repo unchanged) when the
 * capability isn't there to check with: no provider, no `fetchProjects`
 * support (`provider.supports('fetchProjects')`), or the fetch itself
 * throws. A capability gap must never turn into a dispatch outage — the
 * runner's own reject (admission.js) still stops an unresolvable value in
 * that case. Only a provider that COULD answer and DID answer "no"
 * produces a refusal.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.repo - The repo value that would be
 *   stored on the dispatch item (already through any caller/derived/inherited
 *   precedence resolution — this is the LAST checkpoint before persistence).
 * @param {Object|null} params.provider - The resolved provider instance.
 * @param {string|Object|null} params.scope - The provider call scope/token
 *   (same value passed to other provider methods on this request).
 * @param {number} [params.timeoutMs] - Override for `FETCH_PROJECTS_TIMEOUT_MS`.
 *   Test-injection seam only — production callers never pass this.
 * @returns {Promise<{ok: true, repo: string|null, validated: boolean} | {ok: false, knownRepos: string[]}>}
 */
export async function validateDispatchRepo({ repo, provider, scope, timeoutMs = FETCH_PROJECTS_TIMEOUT_MS }) {
  if (!repo) return { ok: true, repo: repo || null, validated: false };

  if (!provider || typeof provider.supports !== 'function' || !provider.supports('fetchProjects')) {
    return { ok: true, repo, validated: false };
  }

  let projects;
  try {
    ({ projects } = await withTimeout(provider.fetchProjects(scope), timeoutMs));
  } catch {
    return { ok: true, repo, validated: false };
  }

  const knownRepos = knownWorkspaceRepos(projects || []).map(row => row.repo).filter(Boolean);
  const resolved = resolveKnownRepo(repo, knownRepos);
  if (resolved.ok) return { ok: true, repo: resolved.repo, validated: true };
  return { ok: false, knownRepos };
}
