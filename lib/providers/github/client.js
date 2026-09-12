// =============================================================================
// GitHub REST client (LIN-178) — the HTTP boundary the provider reads/writes
// through.
// =============================================================================
//
// A thin wrapper over the GitHub REST API (https://api.github.com). It exposes
// HIGH-LEVEL, repo-scoped methods (listIssues, createIssue, …) so the provider
// stays free of URL/verb plumbing and so the in-memory fake (fake-client.js) can
// implement the exact same surface for tests. Every method takes the repo as an
// `owner/name` slug — the value the provider receives as its per-call token.
//
// Auth lives here (the PAT/OAuth token), not on the provider: one configured
// client serves every repo on the account. `fetchImpl` is injectable so the
// proxy-aware fetch (or a stub) can be supplied; it defaults to global fetch.

const GITHUB_API_BASE = 'https://api.github.com'
const PER_PAGE = 100
// Safety cap on a bounded page-number walk (LIN-2820), mirroring Jira's
// listAllProjects (lib/providers/jira/client.js) — a page walk over a
// `{total_count, repositories}` envelope, capped rather than unbounded, with a
// `.truncated` flag attached to the returned array so a capped read is never
// mistaken for "that's every repo".
const DEFAULT_REPO_CAP = 500

/**
 * @param {{ token?: string, baseUrl?: string, fetchImpl?: Function }} [opts]
 * @returns {object} a client with the repo-scoped methods the provider calls.
 */
export function createGitHubClient({ token, baseUrl = GITHUB_API_BASE, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch
  if (!doFetch) throw new Error('createGitHubClient: no fetch implementation available')

  async function request(method, path, body) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (token) headers.Authorization = `Bearer ${token}`
    if (body) headers['Content-Type'] = 'application/json'

    const res = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 204) return null
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) {
      const message = data?.message || res.statusText || `HTTP ${res.status}`
      const err = new Error(`GitHub API ${method} ${path} failed: ${message}`)
      err.status = res.status
      throw err
    }
    return data
  }

  const enc = encodeURIComponent

  // Repo slugs arrive as `owner/name`. Encode each segment SEPARATELY before
  // interpolating into a path so a slug carrying URL-significant characters can't
  // break out of the path or inject query params — while keeping the `/`
  // separator intact (encodeURIComponent on the whole slug would escape it to
  // %2F and 404). Used by every `/repos/${repo}/…` call below (security review
  // M4, LIN-702).
  const encRepo = (slug) => String(slug).split('/').map(enc).join('/')

  // Bounded page-number walk over a `{total_count, repositories}` envelope
  // (LIN-2820). `Link`-header walking is infeasible here: `request()` discards
  // the `Response` and every existing fetch stub omits `headers` — so this
  // walks by page NUMBER instead, keeping page 1's URL byte-identical to the
  // pre-pagination call (`pathForPage(1)` must return the exact same string it
  // always has) while page 2+ appends `&page=N`. Stops on a full read
  // (`out.length >= total_count`), a short page (fewer than `per_page` rows —
  // the honest end-of-list signal when `total_count` is absent/wrong), or the
  // safety cap. `truncated` is decided from whether more rows were known to
  // remain when the walk stopped — NOT from `out.length > cap`: `DEFAULT_REPO_CAP`
  // is an exact multiple of `PER_PAGE`, so the walk lands exactly ON the cap on
  // every production (uncustomized) call, and `>` alone would never fire there.
  // `.truncated` is attached ONLY when true — a complete, uncapped read stays a
  // plain array with no extra own property, so existing exact-array assertions
  // (`assert.deepEqual(repos, [...])`) are unaffected.
  async function walkRepoPages(pathForPage, cap) {
    const out = []
    let totalCount = out.length
    for (let page = 1; ; page++) {
      const data = await request('GET', pathForPage(page))
      const batch = data?.repositories || []
      out.push(...batch)
      totalCount = data?.total_count ?? out.length
      if (out.length >= totalCount || batch.length < PER_PAGE || out.length >= cap) break
    }
    const stoppedAtCapWithMoreRemaining = out.length >= cap && out.length < totalCount
    if (out.length > cap) out.length = cap
    if (stoppedAtCapWithMoreRemaining) out.truncated = true
    return out
  }

  return {
    // The authenticated user behind the configured token (GET /user). Used by
    // the OAuth login flow (LIN-541) to derive a workspace identity and by the
    // settings refresh/test probe to validate a binding's credential.
    async getAuthenticatedUser() {
      return request('GET', '/user')
    },
    // Repositories the App installation was granted (GET /installation/repositories,
    // LIN-710). Under the GitHub App model (LIN-703) the repo picker is constrained
    // to the repos selected at install time, NOT every repo the user can reach — so
    // this reads the installation's repositories with the installation token the
    // client was constructed with, replacing the old OAuth `/user/repos` listing.
    // The endpoint wraps its result in a `{ total_count, repositories: [...] }`
    // envelope (unlike `/user/repos`' bare array), so unwrap `repositories` here and
    // keep returning a bare array — the provider's mapping and the fake client stay
    // unchanged. Drives the post-install repo picker — a GitHub issues binding is
    // scoped to one `owner/name` repo (LIN-541).
    async listRepos({ cap = DEFAULT_REPO_CAP } = {}) {
      const out = await walkRepoPages(
        (page) => page === 1
          ? '/installation/repositories?per_page=100'
          : `/installation/repositories?per_page=100&page=${page}`,
        cap
      )
      if (out.truncated) {
        console.warn(`GitHub listRepos: hit the ${cap}-repo cap with more repositories remaining on the installation — results are truncated, not exhaustive`)
      }
      return out
    },
    // The App installations the AUTHENTICATED USER can administer (GET
    // /user/installations, LIN-728). Distinct from listRepos: this is a
    // user-token read used ONLY by the already-installed re-bind flow to
    // enumerate which installations exist when no fresh `installation_id` comes
    // back (the App is already installed, so GitHub issues an OAuth `code`
    // instead). The endpoint wraps its result in a `{ total_count, installations:
    // [...] }` envelope, so unwrap `installations` and return a bare array. The
    // user token here is for DISCOVERY only — the binding still mints/persists an
    // installation token (LIN-711) at link time.
    async listUserInstallations() {
      const data = await request('GET', '/user/installations?per_page=100')
      return data?.installations || []
    },
    // The repos the authenticated user can reach through ONE installation (GET
    // /user/installations/{id}/repositories, LIN-728). Same `{ total_count,
    // repositories: [...] }` envelope as listRepos' endpoint, so unwrap
    // `repositories`. Paired with listUserInstallations to rebuild the same repo
    // picker for an already-installed App.
    async listUserInstallationRepos(installationId, { cap = DEFAULT_REPO_CAP } = {}) {
      const out = await walkRepoPages(
        (page) => page === 1
          ? `/user/installations/${enc(installationId)}/repositories?per_page=100`
          : `/user/installations/${enc(installationId)}/repositories?per_page=100&page=${page}`,
        cap
      )
      if (out.truncated) {
        console.warn(`GitHub listUserInstallationRepos: hit the ${cap}-repo cap with more repositories remaining on installation ${installationId} — results are truncated, not exhaustive`)
      }
      return out
    },
    // GitHub's issues list also returns pull requests; filter them out so only
    // real issues reach the canonical model (PRs carry a `pull_request` key).
    async listIssues(repo) {
      const issues = await request('GET', `/repos/${encRepo(repo)}/issues?state=all&per_page=100`)
      return (issues || []).filter(i => !i.pull_request)
    },
    async getIssue(repo, number) {
      return request('GET', `/repos/${encRepo(repo)}/issues/${number}`)
    },
    async listComments(repo, number) {
      return request('GET', `/repos/${encRepo(repo)}/issues/${number}/comments?per_page=100`)
    },
    async listMilestones(repo) {
      return request('GET', `/repos/${encRepo(repo)}/milestones?state=all&per_page=100`)
    },
    async listLabels(repo) {
      return request('GET', `/repos/${encRepo(repo)}/labels?per_page=100`)
    },
    async searchIssues(repo, query) {
      const q = enc(`repo:${repo} is:issue ${query}`)
      const result = await request('GET', `/search/issues?q=${q}`)
      return (result?.items || []).filter(i => !i.pull_request)
    },
    async createIssue(repo, { title, body, labels, milestone } = {}) {
      return request('POST', `/repos/${encRepo(repo)}/issues`, { title, body, labels, milestone })
    },
    async updateIssue(repo, number, patch) {
      return request('PATCH', `/repos/${encRepo(repo)}/issues/${number}`, patch)
    },
    async createComment(repo, number, body) {
      return request('POST', `/repos/${encRepo(repo)}/issues/${number}/comments`, { body })
    },
    async addLabel(repo, number, label) {
      await request('POST', `/repos/${encRepo(repo)}/issues/${number}/labels`, { labels: [label] })
      return true
    },
    async removeLabel(repo, number, label) {
      await request('DELETE', `/repos/${encRepo(repo)}/issues/${number}/labels/${enc(label)}`)
      return true
    },
  }
}
