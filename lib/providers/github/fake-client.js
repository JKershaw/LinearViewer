// =============================================================================
// In-memory fake GitHub client (LIN-178) — the test seam.
// =============================================================================
//
// Implements the SAME repo-scoped surface as createGitHubClient (client.js) over
// an in-memory, mutable store, so the provider's reads AND writes can be driven
// end-to-end with no network and no auth. It returns GitHub-REST-shaped objects
// (snake_case `created_at`/`html_url`/`state_reason`, `labels: [{name}]`,
// `user: {login}`, `milestone: {number,title}`) so the provider's mapping code
// runs unchanged against fake and real backends alike — this is what lets the
// E2E be a genuine second-backend proof rather than a mock short-circuit.
//
// Seed shape (per repo slug):
//   { issues: [ghIssue...], milestones: [ghMilestone...], labels: [ghLabel...] }
// Issue numbers auto-assign on createIssue; comment ids auto-increment.

function htmlUrl(repo, number) {
  return `https://github.com/${repo}/issues/${number}`
}

/**
 * @param {Object<string, {issues?: Array, milestones?: Array, labels?: Array}>} seed
 *   keyed by `owner/name` repo slug.
 * @returns {object} a fake client with the createGitHubClient method surface.
 */
export function createFakeGitHubClient(seed = {}) {
  // Deep-ish clone so callers can reuse a seed literal across tests without the
  // fake mutating it. Each repo gets its own mutable partition.
  const repos = {}
  for (const [slug, data] of Object.entries(seed)) {
    repos[slug] = {
      issues: (data.issues || []).map(i => ({ ...i, labels: (i.labels || []).map(l => (typeof l === 'string' ? { name: l } : { ...l })) })),
      milestones: (data.milestones || []).map(m => ({ ...m })),
      labels: (data.labels || []).map(l => ({ ...l })),
      comments: {}, // number -> [comment]
      _nextNumber: Math.max(0, ...(data.issues || []).map(i => i.number || 0)) + 1,
      _nextCommentId: 1,
    }
    for (const i of data.issues || []) {
      repos[slug].comments[i.number] = (i.comments || []).map(c => ({ ...c }))
    }
  }

  function repo(slug) {
    if (!repos[slug]) {
      repos[slug] = { issues: [], milestones: [], labels: [], comments: {}, _nextNumber: 1, _nextCommentId: 1 }
    }
    return repos[slug]
  }

  function find(slug, number) {
    return repo(slug).issues.find(i => String(i.number) === String(number)) || null
  }

  return {
    async listIssues(slug) {
      return repo(slug).issues.filter(i => !i.pull_request).map(i => ({ ...i }))
    },
    async getIssue(slug, number) {
      const i = find(slug, number)
      return i ? { ...i } : null
    },
    async listComments(slug, number) {
      return (repo(slug).comments[number] || []).map(c => ({ ...c }))
    },
    async listMilestones(slug) {
      return repo(slug).milestones.map(m => ({ ...m }))
    },
    async listLabels(slug) {
      return repo(slug).labels.map(l => ({ ...l }))
    },
    async searchIssues(slug, query) {
      const q = String(query || '').toLowerCase()
      return repo(slug).issues
        .filter(i => !i.pull_request)
        .filter(i => `${i.title} ${i.body || ''}`.toLowerCase().includes(q))
        .map(i => ({ ...i }))
    },
    async createIssue(slug, { title, body = '', labels = [], milestone } = {}) {
      const r = repo(slug)
      const number = r._nextNumber++
      const ms = milestone != null ? r.milestones.find(m => m.number === Number(milestone)) || null : null
      const issue = {
        number,
        title,
        body,
        state: 'open',
        state_reason: null,
        html_url: htmlUrl(slug, number),
        created_at: '2026-01-01T00:00:00Z',
        closed_at: null,
        user: { login: 'tester' },
        assignee: null,
        labels: labels.map(name => ({ name })),
        milestone: ms,
      }
      r.issues.push(issue)
      r.comments[number] = []
      return { ...issue }
    },
    async updateIssue(slug, number, patch = {}) {
      const i = find(slug, number)
      if (!i) return null
      if (patch.title != null) i.title = patch.title
      if (patch.body != null) i.body = patch.body
      if (patch.state) {
        i.state = patch.state
        i.state_reason = patch.state_reason ?? null
        i.closed_at = patch.state === 'closed' ? '2026-02-01T00:00:00Z' : null
      }
      return { ...i }
    },
    async createComment(slug, number, body) {
      const i = find(slug, number)
      if (!i) return null
      const r = repo(slug)
      const comment = { id: r._nextCommentId++, body, created_at: '2026-01-02T00:00:00Z', user: { login: 'tester' } }
      r.comments[number] = r.comments[number] || []
      r.comments[number].push(comment)
      return { ...comment }
    },
    async addLabel(slug, number, label) {
      const i = find(slug, number)
      if (!i) return false
      i.labels = i.labels || []
      if (!i.labels.some(l => l.name === label)) i.labels.push({ name: label })
      return true
    },
    async removeLabel(slug, number, label) {
      const i = find(slug, number)
      if (!i) return false
      i.labels = (i.labels || []).filter(l => l.name !== label)
      return true
    },
  }
}
