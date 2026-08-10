// =============================================================================
// In-memory fake Jira client (LIN-1885 reads, LIN-1886 writes) — the test seam.
// =============================================================================
//
// Implements the SAME method surface as createJiraClient (client.js) over an
// in-memory store, so the provider's reads AND writes can be driven end-to-end
// with no network and no auth. It returns Jira-REST-shaped objects
// (`fields.summary`, `fields.status.statusCategory.key`, `fields.project`, ADF
// `description` bodies, etc.) so the provider's mapping code runs unchanged
// against fake and real backends alike. Unit tests run against this, NEVER
// live Jira.
//
// Seed shape:
//   { projects: [jiraProject...], issues: [jiraIssue...], labels: [string...] }
// Each jiraIssue is the REST v3 shape: `{ id, key, fields: {...} }`. Comments
// seed per-issue via `fields._comments` (stripped before the fake returns the
// issue) since Jira's real issue payload does not embed comments inline.
// Available WORKFLOW TRANSITIONS (LIN-1886) seed per-issue via
// `fields._transitions: [{ id, name, to: { statusCategory: { key } }, hasScreen? }]`
// (also stripped before the issue is returned) — an entry with `hasScreen: true`
// simulates a screen-required transition (`updateIssue`'s D2 refusal), matching
// real Jira's unexpanded response (LIN-2020: carries `hasScreen`, never `fields`).
// `doTransition` applies the matched entry's `to` onto the issue's live
// `fields.status`, so a transition genuinely moves the fake issue's status.
// Top-level `labels` seeds the SITE-WIDE label vocabulary `listAllLabels`
// returns; omitted, it derives the distinct label set already present on
// seeded issues (a reasonable stand-in for "every label anyone has used").

function cloneIssue(issue) {
  const { fields = {}, ...rest } = issue
  const { _comments, _transitions, ...restFields } = fields
  return { ...rest, fields: { ...restFields } }
}

/**
 * @param {{ projects?: Array, issues?: Array, labels?: Array<string> }} [seed]
 * @returns {object} a fake client with the createJiraClient method surface.
 */
export function createFakeJiraClient(seed = {}) {
  const projects = (seed.projects || []).map(p => ({ ...p }))
  // Each issue is its own shallow clone with its own `.fields` object — writes
  // reassign `.fields` wholesale (never mutate the seed's shared object), so
  // repeated `createFakeJiraClient(seed)` calls against the same seed literal
  // (every test's `beforeEach`) start from an unmodified seed each time.
  const issues = (seed.issues || []).map(i => ({ ...i, fields: { ...(i.fields || {}) } }))
  // Indexed by BOTH `key` and the immutable `id` — real Jira resolves an issue
  // path segment as either interchangeably, and the provider layer calls
  // fetchIssueComments with the canonical (immutable) `id`, not the key.
  const commentsByIssue = {}
  const transitionsByIssue = {}
  let nextCommentId = 9000
  for (const issue of seed.issues || []) {
    const comments = (issue.fields?._comments || []).map(c => ({ ...c }))
    commentsByIssue[issue.key] = comments
    commentsByIssue[issue.id] = comments
    const transitions = (issue.fields?._transitions || []).map(t => ({ ...t }))
    transitionsByIssue[issue.key] = transitions
    transitionsByIssue[issue.id] = transitions
  }
  const siteLabels = seed.labels
    ? [...seed.labels]
    : [...new Set(issues.flatMap(i => i.fields?.labels || []))]

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

    // Mirrors the real client's `/search/jql` cursor shape (LIN-1885 beat 1):
    // `nextPageToken` in, `{issues, nextPageToken?}` out — no `startAt`, no
    // `total`. The token is just the next offset as a string; real Jira's is
    // opaque, but nothing here or in the provider inspects it, only passes it
    // back verbatim, so the fake's own encoding is unobservable from outside.
    async searchIssues(jql, { nextPageToken, maxResults = 50 } = {}) {
      const matched = matchJql(issues, jql)
      const startAt = nextPageToken ? Number(nextPageToken) : 0
      const page = matched.slice(startAt, startAt + maxResults)
      const nextStart = startAt + page.length
      return {
        issues: page.map(cloneIssue),
        nextPageToken: nextStart < matched.length ? String(nextStart) : undefined,
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

    // -------------------------------------------------------------------------
    // Writes (LIN-1886)
    // -------------------------------------------------------------------------

    /** Mirrors the real client: applies `fields` onto the stored issue and/or a label diff from `update.labels`; real Jira answers 204 → `null`. */
    async updateIssue(issueIdOrKey, body) {
      const issue = findIssue(issueIdOrKey)
      if (!issue) {
        const err = new Error(`Jira API PUT /rest/api/3/issue/${issueIdOrKey} failed: issue not found`)
        err.status = 404
        throw err
      }
      if (body?.fields) {
        issue.fields = { ...issue.fields, ...body.fields }
      }
      if (body?.update?.labels) {
        const current = new Set(issue.fields.labels || [])
        for (const op of body.update.labels) {
          if (op.add != null) current.add(op.add)
          if (op.remove != null) current.delete(op.remove)
        }
        issue.fields = { ...issue.fields, labels: [...current] }
      }
      return null
    },

    /** The seeded `_transitions` list for this issue (stripped from ordinary reads), `{ transitions }` shaped like the real endpoint. */
    async getTransitions(issueIdOrKey) {
      const issue = findIssue(issueIdOrKey)
      if (!issue) {
        const err = new Error(`Jira API GET /rest/api/3/issue/${issueIdOrKey}/transitions failed: issue not found`)
        err.status = 404
        throw err
      }
      return { transitions: (transitionsByIssue[issueIdOrKey] || transitionsByIssue[issue.id] || []).map(t => ({ ...t })) }
    },

    /** Applies the matched seeded transition's `to` onto the issue's live status — a fake transition genuinely moves the issue, mirroring a real Jira workflow move. */
    async doTransition(issueIdOrKey, transitionId) {
      const issue = findIssue(issueIdOrKey)
      if (!issue) {
        const err = new Error(`Jira API POST /rest/api/3/issue/${issueIdOrKey}/transitions failed: issue not found`)
        err.status = 404
        throw err
      }
      const available = transitionsByIssue[issueIdOrKey] || transitionsByIssue[issue.id] || []
      const match = available.find(t => String(t.id) === String(transitionId))
      if (!match) {
        const err = new Error(`Jira API POST /rest/api/3/issue/${issueIdOrKey}/transitions failed: unknown transition id '${transitionId}'`)
        err.status = 400
        throw err
      }
      issue.fields = {
        ...issue.fields,
        status: { name: match.to?.name || 'Unknown', statusCategory: { key: match.to?.statusCategory?.key || null } },
      }
      return null
    },

    /** Stores a new comment (ADF `body`), returning the FULL created comment object — mirrors real Jira's comment-create response (unlike the sparse 204 issue PUT). */
    async createComment(issueIdOrKey, body) {
      const issue = findIssue(issueIdOrKey)
      if (!issue) {
        const err = new Error(`Jira API POST /rest/api/3/issue/${issueIdOrKey}/comment failed: issue not found`)
        err.status = 404
        throw err
      }
      const comment = {
        id: String(nextCommentId++),
        body: body?.body ?? body,
        created: new Date().toISOString(),
        author: { displayName: 'Tester' },
      }
      commentsByIssue[issue.key] = [...(commentsByIssue[issue.key] || []), comment]
      commentsByIssue[issue.id] = [...(commentsByIssue[issue.id] || []), comment]
      return { ...comment }
    },

    /** One page of the site-wide label vocabulary (see the module comment for how `siteLabels` is seeded/derived). */
    async listLabels({ startAt = 0, maxResults = 50 } = {}) {
      const values = siteLabels.slice(startAt, startAt + maxResults)
      return { values, startAt, maxResults, total: siteLabels.length, isLast: startAt + values.length >= siteLabels.length }
    },

    async listAllLabels() {
      return [...siteLabels]
    },
  }
}

// -----------------------------------------------------------------------------
// A deliberately MINIMAL JQL matcher — Phase 1 fake only needs to support the
// shapes the provider actually issues (see index.js): `project = "<key>"`,
// `project in ("<key>",...)` (the beat 1 project-scoped fetchProjects query),
// and `parent = "<key>"`, each optionally `ORDER BY key ASC`. Not a JQL parser.
// -----------------------------------------------------------------------------
function matchJql(allIssues, jql) {
  const query = String(jql || '').trim()
  const projectInMatch = query.match(/project\s+in\s*\(([^)]*)\)/i)
  const projectEqMatch = query.match(/project\s*=\s*"?([\w-]+)"?/i)
  const parentMatch = query.match(/parent\s*=\s*"?([\w-]+)"?/i)
  let matched = allIssues
  if (projectInMatch) {
    const keys = projectInMatch[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
    matched = matched.filter(i => keys.includes(i.fields?.project?.key) || keys.includes(i.fields?.project?.id))
  } else if (projectEqMatch) {
    const key = projectEqMatch[1]
    matched = matched.filter(i => i.fields?.project?.key === key || i.fields?.project?.id === key)
  }
  if (parentMatch) {
    const key = parentMatch[1]
    matched = matched.filter(i => i.fields?.parent?.key === key || i.fields?.parent?.id === key)
  }
  return [...matched].sort((a, b) => (a.key > b.key ? 1 : a.key < b.key ? -1 : 0))
}
