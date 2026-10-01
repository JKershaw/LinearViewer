/**
 * lib/github-pr-files.js — the bounded, fail-open GitHub read behind the
 * LIN-3200 file pointer (P2).
 *
 * A ticket records a PR only as an `[evidence]` URL, never its edited-file
 * list (`producedArtifacts[]`, lib/session-telemetry.js). So the pointer's
 * earlier-PR half is read from GitHub at dispatch time:
 * `GET /repos/{owner}/{repo}/pulls/{n}/files`. No write, no stored shape.
 *
 * Every limit the plan names is enforced here:
 *
 *   - the owner must be in the operator-set allowlist
 *     (`HARBOUR_FILE_POINTER_GITHUB_OWNERS`, comma-separated; EMPTY ⇒ PR files
 *     unavailable, which is the default deployment posture — it is also what
 *     keeps the unit suite hermetic, since no fetch is ever attempted);
 *   - owner/repo/number are matched against fixed patterns BEFORE any URL is
 *     built, and the request goes ONLY to api.github.com;
 *   - at most MAX_PRS_PER_DISPATCH PRs per dispatch, newest first,
 *     `per_page=100`, no pagination;
 *   - a 3 s timeout per request (under GITHUB_VIEWER_TIMEOUT_MS = 8000), and
 *     404/403/timeout/parse failure all degrade to "no files" — NEVER a throw.
 *
 * The cache is per `(owner/repo#n)`: 24 h once merged/closed, 60 s while open.
 */

export const PR_FILES_TIMEOUT_MS = 3000;
export const MAX_PRS_PER_DISPATCH = 3;
export const OPEN_PR_CACHE_TTL_MS = 60 * 1000;
export const CLOSED_PR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const GITHUB_OWNERS_ENV = 'HARBOUR_FILE_POINTER_GITHUB_OWNERS';

const GITHUB_API_HOST = 'api.github.com';
const GITHUB_API_BASE = `https://${GITHUB_API_HOST}`;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const PR_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d+)(?:[?#].*)?$/;

// (owner/repo#n) -> { files, expiresAt }
const prFilesCache = new Map();

/** Test seam: drop the module-level cache between cases. */
export function clearPrFilesCache() {
  prFilesCache.clear();
}

/** Parse the operator-set owner allowlist. Empty env ⇒ empty set (unavailable). */
export function parseGitHubOwnerAllowlist(env = process.env) {
  const raw = env?.[GITHUB_OWNERS_ENV];
  if (typeof raw !== 'string' || raw.trim() === '') return new Set();
  return new Set(
    raw.split(',')
      .map(s => s.trim())
      .filter(s => s !== '' && OWNER_RE.test(s))
  );
}

function isAllowedOwner(owner, allowlist) {
  return !!owner && allowlist instanceof Set && allowlist.has(owner);
}

/**
 * Turn `producedArtifacts[]` entries (from `parseEvidenceArtifacts`) into a
 * deduped, newest-first list of `{ owner, repo, number, url }`. URLs must match
 * the fixed GitHub PR pattern (query/fragment stripped) AND name an allowlisted
 * owner; anything else is dropped. An empty allowlist short-circuits to [].
 *
 * @param {Array<{url?: string, timestamp?: string|null}>} producedArtifacts
 * @param {Object} [options]
 * @param {Set<string>} [options.ownerAllowlist]
 * @returns {Array<{owner: string, repo: string, number: number, url: string, timestamp: string|null}>}
 */
export function parseEvidencePrUrls(producedArtifacts, { ownerAllowlist = parseGitHubOwnerAllowlist() } = {}) {
  if (!Array.isArray(producedArtifacts) || !(ownerAllowlist instanceof Set) || ownerAllowlist.size === 0) {
    return [];
  }
  const candidates = [];
  const seen = new Set();
  for (const artifact of producedArtifacts) {
    const url = typeof artifact?.url === 'string' ? artifact.url.trim() : '';
    if (!url) continue;
    const match = PR_URL_RE.exec(url);
    if (!match) continue;
    const [, owner, repo, number] = match;
    if (!isAllowedOwner(owner, ownerAllowlist)) continue;
    if (!REPO_RE.test(repo)) continue;
    const key = `${owner}/${repo}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ owner, repo, number: Number(number), url, timestamp: artifact?.timestamp ?? null });
  }
  // Newest first; a missing/unparseable timestamp sorts last, preserving input order.
  return candidates
    .map((entry, index) => ({ entry, index, ms: entry.timestamp ? Date.parse(entry.timestamp) : NaN }))
    .sort((a, b) => {
      const aMs = Number.isNaN(a.ms) ? -Infinity : a.ms;
      const bMs = Number.isNaN(b.ms) ? -Infinity : b.ms;
      return (bMs - aMs) || (a.index - b.index);
    })
    .map(x => x.entry);
}

function timeoutValue(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    promise.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

async function fetchGithubJson(doFetch, path, timeoutMs) {
  const request = Promise.resolve().then(() => doFetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }));
  const res = await timeoutValue(request, timeoutMs);
  if (!res) return null;
  let body = null;
  try {
    body = typeof res.json === 'function' ? await timeoutValue(Promise.resolve(res.json()), timeoutMs) : null;
  } catch {
    body = null;
  }
  return { ok: !!res.ok, status: res.status, body };
}

/**
 * Read one PR's edited files. 404/403/timeout/parse failure all return []; the
 * caller records intent-to-treat and keeps the pointer arm.
 *
 * @param {Function} doFetch - fetch-compatible function (injected; tests never hit the network)
 * @param {Object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|string} params.number
 * @param {Set<string>} [params.owners] - owner allowlist; omitted ⇒ env
 * @param {number} [params.timeoutMs]
 * @param {number|Date} [params.now]
 * @returns {Promise<Array<{repo: string, path: string}>>}
 */
export async function fetchPrFiles(doFetch, { owner, repo, number, owners = parseGitHubOwnerAllowlist(), timeoutMs = PR_FILES_TIMEOUT_MS, now = Date.now() } = {}) {
  if (typeof doFetch !== 'function') return [];
  if (!OWNER_RE.test(String(owner || '')) || !REPO_RE.test(String(repo || ''))) return [];
  if (!/^\d+$/.test(String(number))) return [];
  if (!isAllowedOwner(owner, owners)) return [];

  const key = `${owner}/${repo}#${number}`;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const cached = prFilesCache.get(key);
  if (cached && cached.expiresAt > nowMs) return cached.files;

  try {
    const prResponse = await fetchGithubJson(doFetch, `/repos/${owner}/${repo}/pulls/${number}`, timeoutMs);
    if (!prResponse) return [];
    // 404 and 403 both degrade to "no files for that PR" (a private repo, or
    // the shared 60/hour unauthenticated budget) — never a throw. They are
    // distinguished only for the log, mirroring fetchPrStatus's split.
    if (!prResponse.ok) {
      if (prResponse.status === 404 || prResponse.status === 403) {
        prFilesCache.set(key, { files: [], expiresAt: nowMs + OPEN_PR_CACHE_TTL_MS });
      }
      return [];
    }

    const filesResponse = await fetchGithubJson(doFetch, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`, timeoutMs);
    const files = [];
    if (filesResponse?.ok && Array.isArray(filesResponse.body)) {
      for (const file of filesResponse.body) {
        const filename = file?.filename;
        if (typeof filename === 'string' && filename.length > 0) files.push({ repo, path: filename });
      }
    }

    const closed = prResponse.body?.state === 'closed' || !!prResponse.body?.merged_at;
    prFilesCache.set(key, {
      files,
      expiresAt: nowMs + (closed ? CLOSED_PR_CACHE_TTL_MS : OPEN_PR_CACHE_TTL_MS)
    });
    return files;
  } catch {
    return [];
  }
}

/**
 * Collect PR files for a set of artifacts, newest PR first, at most
 * MAX_PRS_PER_DISPATCH. Never throws.
 *
 * @param {Function} doFetch
 * @param {Object} params
 * @param {Array} params.artifacts - `producedArtifacts[]`
 * @param {Set<string>} [params.ownerAllowlist]
 * @param {number} [params.maxPrs]
 * @param {Function} [params.fetchImpl] - test seam; defaults to fetchPrFiles
 * @param {number|Date} [params.now]
 * @returns {Promise<Array<{repo: string, path: string}>>}
 */
export async function collectPrFiles(doFetch, {
  artifacts = [],
  ownerAllowlist = parseGitHubOwnerAllowlist(),
  maxPrs = MAX_PRS_PER_DISPATCH,
  fetchImpl = fetchPrFiles,
  now = Date.now()
} = {}) {
  if (ownerAllowlist instanceof Set && ownerAllowlist.size === 0) return [];
  const prs = parseEvidencePrUrls(artifacts, { ownerAllowlist });
  const out = [];
  for (const pr of prs.slice(0, maxPrs)) {
    try {
      const files = await fetchImpl(doFetch, {
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        owners: ownerAllowlist,
        now
      });
      if (Array.isArray(files)) out.push(...files);
    } catch {
      // fail-open per PR
    }
  }
  return out;
}
