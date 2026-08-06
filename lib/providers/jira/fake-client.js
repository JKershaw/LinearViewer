// =============================================================================
// In-memory fake Jira client (LIN-1885) — the test seam.
// =============================================================================
//
// Implements the SAME method surface as createJiraClient (client.js) over an
// in-memory store, so the provider's reads can be driven end-to-end with no
// network and no auth. It returns Jira-REST-shaped objects (`fields.summary`,
// `fields.status.statusCategory.key`, `fields.project`, ADF `description`
// bodies, etc.) so the provider's mapping code runs unchanged against fake and
// real backends alike. Unit tests run against this, NEVER live Jira.
//
// Seed shape:
//   { projects: [jiraProject...], issues: [jiraIssue...] }
// Each jiraIssue is the REST v3 shape: `{ id, key, fields: {...} }`. Comments
// seed per-issue via `fields._comments` (stripped before the fake returns the
// issue) since Jira's real issue payload does not embed comments inline.

function cloneIssue(issue) {
  const { fields = {}, ...rest } = issue
  const { _comments, ...restFields } = fields
  return { ...rest, fields: { ...restFields } }
}

/**
 * @param {{ projects?: Array, issues?: Array }} [seed]
 * @returns {object} a fake client with the createJiraClient method surface.
 */
export function createFakeJiraClient(seed = {}) {
  const projects = (seed.projects || []).map(p => ({ ...p }))
  const issues = (seed.issues || []).map(i => ({ ...i }))
  // Indexed by BOTH `key` and the immutable `id` — real Jira resolves an issue
  // path segment as either interchangeably, and the provider layer calls
  // fetchIssueComments with the canonical (immutable) `id`, not the key.
  const commentsByIssue = {}
  for (const issue of seed.issues || []) {
    const comments = (issue.fields?._comments || []).map(c => ({ ...c }))
    commentsByIssue[issue.key] = comments
    commentsByIssue[issue.id] = comments
  }

  function findIssue(idOrKey) {
    return issues.find(i => i.key === idOrKey || i.id === String(idOrKey)) || null
  }

  return {
    async getProject(projectIdOrKey) {
      const p = projects.find(p => p.key === projectIdOrKey || p.id === String(projectIdOrKey))
      if (!p) {
        const err = new Error(`Jira API GET /rest/api/3/project/${projectIdOrKey} failed: project not found`)
        err.status = 404
        throw err
      }
      return { ...p }
    },

    async listProjects({ startAt = 0, maxResults = 50 } = {}) {
      const values = projects.slice(startAt, startAt + maxResults)
      return {
        values: values.map(p => ({ ...p })),
        startAt,
        maxResults,
        total: projects.length,
        isLast: startAt + values.length >= projects.length,
      }
    },

    async listAllProjects() {
      return projects.map(p => ({ ...p }))
    },

    async getIssue(issueIdOrKey) {
      const issue = findIssue(issueIdOrKey)
      return issue ? cloneIssue(issue) : null
    },

    async searchIssues(jql, { startAt = 0, maxResults = 50 } = {}) {
      const matched = matchJql(issues, jql)
      const page = matched.slice(startAt, startAt + maxResults)
      return {
        issues: page.map(cloneIssue),
        startAt,
        maxResults,
        total: matched.length,
      }
    },

    async searchAllIssues(jql) {
      return matchJql(issues, jql).map(cloneIssue)
    },

    async listComments(issueIdOrKey, { startAt = 0, maxResults = 50 } = {}) {
      const all = commentsByIssue[issueIdOrKey] || []
      const page = all.slice(startAt, startAt + maxResults)
      return { comments: page.map(c => ({ ...c })), startAt, maxResults, total: all.length }
    },

    async listAllComments(issueIdOrKey) {
      return (commentsByIssue[issueIdOrKey] || []).map(c => ({ ...c }))
    },

    async getMyself() {
      return { accountId: 'fake-account', emailAddress: 'tester@example.com', displayName: 'Tester' }
    },
  }
}

// -----------------------------------------------------------------------------
// A deliberately MINIMAL JQL matcher — Phase 1 fake only needs to support the
// two shapes the provider actually issues (see index.js): `project = "<key>"`
// and `parent = "<key>"`, each optionally `ORDER BY key ASC`. Not a JQL parser.
// -----------------------------------------------------------------------------
function matchJql(allIssues, jql) {
  const query = String(jql || '').trim()
  const projectMatch = query.match(/project\s*=\s*"?([\w-]+)"?/i)
  const parentMatch = query.match(/parent\s*=\s*"?([\w-]+)"?/i)
  let matched = allIssues
  if (projectMatch) {
    const key = projectMatch[1]
    matched = matched.filter(i => i.fields?.project?.key === key || i.fields?.project?.id === key)
  }
  if (parentMatch) {
    const key = parentMatch[1]
    matched = matched.filter(i => i.fields?.parent?.key === key || i.fields?.parent?.id === key)
  }
  return [...matched].sort((a, b) => (a.key > b.key ? 1 : a.key < b.key ? -1 : 0))
}
