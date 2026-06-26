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
    async listRepos() {
      const data = await request('GET', '/installation/repositories?per_page=100')
      return data?.repositories || []
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
    async listUserInstallationRepos(installationId) {
      const data = await request('GET', `/user/installations/${enc(installationId)}/repositories?per_page=100`)
      return data?.repositories || []
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
