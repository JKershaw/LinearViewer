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

  return {
    // The authenticated user behind the configured token (GET /user). Used by
    // the OAuth login flow (LIN-541) to derive a workspace identity and by the
    // settings refresh/test probe to validate a binding's credential.
    async getAuthenticatedUser() {
      return request('GET', '/user')
    },
    // Repositories the authenticated user can access, most-recently-pushed first
    // (GET /user/repos). Drives the post-OAuth repo picker — a GitHub issues
    // binding is scoped to one `owner/name` repo (LIN-541).
    async listRepos() {
      const repos = await request('GET', '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member')
      return repos || []
    },
    // GitHub's issues list also returns pull requests; filter them out so only
    // real issues reach the canonical model (PRs carry a `pull_request` key).
    async listIssues(repo) {
      const issues = await request('GET', `/repos/${repo}/issues?state=all&per_page=100`)
      return (issues || []).filter(i => !i.pull_request)
    },
    async getIssue(repo, number) {
      return request('GET', `/repos/${repo}/issues/${number}`)
    },
    async listComments(repo, number) {
      return request('GET', `/repos/${repo}/issues/${number}/comments?per_page=100`)
    },
    async listMilestones(repo) {
      return request('GET', `/repos/${repo}/milestones?state=all&per_page=100`)
    },
    async listLabels(repo) {
      return request('GET', `/repos/${repo}/labels?per_page=100`)
    },
    async searchIssues(repo, query) {
      const q = enc(`repo:${repo} is:issue ${query}`)
      const result = await request('GET', `/search/issues?q=${q}`)
      return (result?.items || []).filter(i => !i.pull_request)
    },
    async createIssue(repo, { title, body, labels, milestone } = {}) {
      return request('POST', `/repos/${repo}/issues`, { title, body, labels, milestone })
    },
    async updateIssue(repo, number, patch) {
      return request('PATCH', `/repos/${repo}/issues/${number}`, patch)
    },
    async createComment(repo, number, body) {
      return request('POST', `/repos/${repo}/issues/${number}/comments`, { body })
    },
    async addLabel(repo, number, label) {
      await request('POST', `/repos/${repo}/issues/${number}/labels`, { labels: [label] })
      return true
    },
    async removeLabel(repo, number, label) {
      await request('DELETE', `/repos/${repo}/issues/${number}/labels/${enc(label)}`)
      return true
    },
  }
}
