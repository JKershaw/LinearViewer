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
//   { projects: [jiraProject...], issues: [jiraIssue...], labels: [string...],
//     projectStatuses: { <projectKeyOrId>: [issueTypeWithStatus...] },
//     fields: [{ id, name, schema? }...] }
// `fields` (LIN-2011) seeds the site-wide field list `listFields` returns —
// used to discover a company-managed tenant's legacy `Epic Link` custom
// field id. Omitted, it defaults to `[]` (no Epic Link field found, the
// team-managed/already-migrated common case).
// Each jiraIssue is the REST v3 shape: `{ id, key, fields: {...} }`. Comments
// seed per-issue via `fields._comments` (stripped before the fake returns the
// issue) since Jira's real issue payload does not embed comments inline.
// Available WORKFLOW TRANSITIONS (LIN-1886) seed per-issue via
// `fields._transitions: [{ id, name, to: { id, statusCategory: { key } }, hasScreen? }]`
// (also stripped before the issue is returned) — an entry with `hasScreen: true`
// simulates a screen-required transition (`updateIssue`'s D2 refusal), matching
// real Jira's unexpanded response (LIN-2020: carries `hasScreen`, never `fields`).
// `to.id` (LIN-2018) is what the provider's D2 write path now matches EXACTLY
// against a requested `stateId` — omitting it degrades to the old
// first-match-on-category behaviour never being reachable, so a seed exercising
// a real transition should carry one.
// `doTransition` applies the matched entry's `to` onto the issue's live
// `fields.status`, so a transition genuinely moves the fake issue's status.
// Top-level `labels` seeds the SITE-WIDE label vocabulary `listAllLabels`
// returns; omitted, it derives the distinct label set already present on
// seeded issues (a reasonable stand-in for "every label anyone has used").
// `projectStatuses` (LIN-2018) seeds `getProjectStatuses`'s per-project
// response, keyed by EITHER the project's key or its id (mirrors real Jira,
// which resolves either interchangeably) — the REST v3
// `List<IssueTypeWithStatus>` shape: `[{ id, name, subtask, statuses: [{ id,
// name, statusCategory: { key } }, ...] }, ...]`. A project with no entry
// here returns `[]` from `getProjectStatuses`, not a throw (mirrors a project
// with no issue types configured).
// Issue ENTITY PROPERTIES (LIN-4450) seed per-issue via a top-level
// `_properties: { <key>: <value> }` on the seeded issue (stripped, never on the
// issue body). `getIssue(id, { properties: [keys] })` returns the requested keys
// that exist on `properties`, as real Jira's `?properties=` does, and a read that
// does not ask gets no `properties` at all; `updateIssue` stores a body's
// `properties: [{ key, value }]`, as the real edit endpoint does.
// Create METADATA (LIN-4451) seeds per project, keyed by key or id:
// `createMeta: { <projectKeyOrId>: { issueTypes: [{ id, name, subtask, hierarchyLevel }],
// fields: { <issueTypeId>: [{ fieldId, name, required, hasDefaultValue }] } } }`. A project
// with no entry lists no issue types. `createIssue` files an issue against it as real Jira
// does: it refuses an unknown project, an issue type the project does not offer, and a required
// field with no default that the body does not set (400, nothing created). It answers
// `{ id, key, self }`, and the caller re-reads.

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
  // A seeded issue's entity properties ride on its own `_properties` map, never on
  // the issue body: real Jira returns them only when a read asks (`?properties=`).
  const issues = (seed.issues || []).map(({ _properties, ...i }) => ({ ...i, fields: { ...(i.fields || {}) } }))
  const propertiesByIssue = new Map()
  for (const issue of seed.issues || []) {
    propertiesByIssue.set(issue.id, new Map(Object.entries(issue._properties || {})))
  }
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
  const projectStatuses = seed.projectStatuses || {}
  const siteFields = (seed.fields || []).map(f => ({ ...f }))

  function findIssue(idOrKey) {
    return issues.find(i => i.key === idOrKey || i.id === String(idOrKey)) || null
  }

  // Create metadata (LIN-4451) seeds per project, keyed by key or id:
  // `{ issueTypes: [{ id, name, subtask, hierarchyLevel }], fields: { [issueTypeId]: [{ fieldId, name, required, hasDefaultValue }] } }`.
  const createMeta = seed.createMeta || {}
  let nextIssueNumber = 100

  function createMetaFor(projectIdOrKey) {
    const project = projects.find(p => p.key === projectIdOrKey || p.id === String(projectIdOrKey))
    return createMeta[projectIdOrKey] || (project && (createMeta[project.key] || createMeta[project.id])) || null
  }

  function badRequest(message) {
    const err = new Error(`Jira API POST /rest/api/3/issue failed: ${message}`)
    err.status = 400
    return err
  }

  // A create's `parent` as a read would show it: the parent's id, key, summary and type,
  // so an epic parent reads back as an epic (the provider's routing depends on that shape).
  function resolveParent(ref) {
    const parent = findIssue(ref.id ?? ref.key)
    if (!parent) throw badRequest(`parent '${ref.id ?? ref.key}' does not exist`)
    return { id: parent.id, key: parent.key, fields: { summary: parent.fields?.summary, issuetype: parent.fields?.issuetype } }
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

    /** Mirrors `client.js`'s `getProjectStatuses` — a project with no seeded entry returns `[]`, not a 404 (see the module comment). */
    async getProjectStatuses(projectIdOrKey) {
      const p = projects.find(p => p.key === projectIdOrKey || p.id === String(projectIdOrKey))
      const byKey = p && projectStatuses[p.key]
      const byId = p && projectStatuses[p.id]
      return JSON.parse(JSON.stringify(byKey || byId || projectStatuses[projectIdOrKey] || []))
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

    /**
     * Mirrors the real `?properties=` read: the requested keys that exist come back
     * on `properties` (an absent key is omitted, as real Jira omits it). An unrequested
     * key never appears, so a read that forgot to ask cannot pass for one that did.
     */
    async getIssue(issueIdOrKey, { properties } = {}) {
      const issue = findIssue(issueIdOrKey)
      if (!issue) return null
      const copy = cloneIssue(issue)
      if (properties) {
        const stored = propertiesByIssue.get(issue.id) || new Map()
        copy.properties = Object.fromEntries(
          properties.filter(key => stored.has(key)).map(key => [key, structuredClone(stored.get(key))]),
        )
      }
      return copy
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

    /**
     * Mirrors `client.js`'s `searchAllIssues(jql, { cap })` — walk-and-cap,
     * stamping `.truncated = true` when `cap` is hit (LIN-2155; previously
     * this had neither, which the real tiered fetch's cap-hit semantics
     * depend on). `cap` is opt-in: omitted (as most hand-authored test calls
     * do), the fake returns every match, unbounded — only a caller that
     * passes `cap` explicitly (production `_epicsForProjects`, or a test
     * exercising truncation) can trigger it.
     */
    async searchAllIssues(jql, { cap } = {}) {
      const matched = matchJql(issues, jql)
      const capped = cap != null ? matched.slice(0, cap) : matched
      const out = capped.map(cloneIssue)
      out.truncated = cap != null && matched.length > cap
      return out
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

    /** Mirrors `client.js`'s `listFields` — the seeded site-wide field list (see the module comment for `fields` seeding). */
    async listFields() {
      return siteFields.map(f => ({ ...f }))
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
      // Entity properties ride the same PUT (`properties: [{ key, value }]`), as in real Jira.
      if (body?.properties) {
        const stored = propertiesByIssue.get(issue.id) || new Map()
        for (const { key, value } of body.properties) stored.set(key, structuredClone(value))
        propertiesByIssue.set(issue.id, stored)
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
        status: {
          id: match.to?.id != null ? String(match.to.id) : null,
          name: match.to?.name || 'Unknown',
          statusCategory: { key: match.to?.statusCategory?.key || null },
        },
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
    /** Mirrors `client.js`'s listCreateIssueTypes: the seeded `createMeta` issue types for a project, or `[]` when none are seeded. */
    async listCreateIssueTypes(projectIdOrKey) {
      const meta = createMetaFor(projectIdOrKey)
      return JSON.parse(JSON.stringify(meta?.issueTypes || []))
    },

    /** Mirrors `client.js`'s listCreateIssueTypeFields: the seeded create-screen fields for one issue type, or `[]`. */
    async listCreateIssueTypeFields(projectIdOrKey, issueTypeId) {
      const meta = createMetaFor(projectIdOrKey)
      return JSON.parse(JSON.stringify(meta?.fields?.[String(issueTypeId)] || []))
    },

    /**
     * Mirrors `POST /rest/api/3/issue`: files the issue and answers `{ id, key, self }`,
     * as real Jira does (the caller re-reads). Refuses as Jira does: an unknown
     * project, an issue type the project does not offer, a required field with no
     * value and no default (400, nothing created). `fields.parent` is resolved to the
     * parent's summary and type, as a read would show it. Entity properties in
     * `body.properties` are stored as an edit's are.
     */
    async createIssue(body) {
      const input = body?.fields || {}
      const projectRef = input.project?.key ?? input.project?.id
      const project = projects.find(p => p.key === projectRef || p.id === String(projectRef))
      if (!project) throw badRequest(`project '${projectRef}' does not exist`)
      const meta = createMetaFor(project.key) || createMetaFor(project.id)
      const type = (meta?.issueTypes || []).find(t => t.id === String(input.issuetype?.id))
      if (!type) throw badRequest(`issue type '${input.issuetype?.id}' is not available in project ${project.key}`)
      for (const field of meta.fields?.[type.id] || []) {
        if (!field.required || field.hasDefaultValue) continue
        if (field.fieldId in input || ['summary', 'project', 'issuetype', 'description', 'reporter'].includes(field.fieldId)) continue
        throw badRequest(`${field.name} is required`)
      }
      let number = nextIssueNumber
      while (findIssue(`${project.key}-${number}`)) number += 1
      nextIssueNumber = number + 1
      const key = `${project.key}-${number}`
      const id = String(10000 + number)
      const parent = input.parent ? resolveParent(input.parent) : undefined
      const issue = {
        id,
        key,
        fields: {
          ...input,
          summary: input.summary,
          description: input.description ?? null,
          project: { id: project.id, key: project.key, name: project.name },
          issuetype: { id: type.id, name: type.name, subtask: !!type.subtask },
          status: { id: '10000', name: 'To Do', statusCategory: { key: 'new' } },
          labels: [],
          ...(parent ? { parent } : {}),
        },
      }
      issues.push(issue)
      commentsByIssue[key] = []
      commentsByIssue[id] = commentsByIssue[key]
      transitionsByIssue[key] = []
      transitionsByIssue[id] = transitionsByIssue[key]
      if (body?.properties) {
        const stored = new Map()
        for (const { key: propertyKey, value } of body.properties) stored.set(propertyKey, structuredClone(value))
        propertiesByIssue.set(id, stored)
      }
      return { id, key, self: `https://fake.atlassian.net/rest/api/3/issue/${id}` }
    },

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
// A deliberately MINIMAL JQL matcher — the fake only needs to support the
// shapes the provider actually issues (see index.js): `project = "<key>"`,
// `project in ("<key>",...)`, `parent = "<key>"`, and — since LIN-2155's
// tiered fetch — `statusCategory = "<name>"`, `issuetype = Epic`, and
// `resolutiondate >= -<N>d`, ANDed together in any combination, each
// optionally followed by `ORDER BY key ASC` or `ORDER BY updated DESC, key
// ASC`. Not a JQL parser: the query is split on `AND` and each clause must
// match one of the known shapes below, or `matchJql` THROWS — an unhandled
// clause silently matching everything would make the suite false-green
// (LIN-2050), so a gap here is a loud test-authoring signal, not a quiet
// pass-through.
// -----------------------------------------------------------------------------

// Jira's statusCategory NAME (what a JQL `statusCategory = "..."` clause
// matches on) -> the wire `key` seeded issues carry on `fields.status.
// statusCategory.key` (mirrors `index.js`'s `statusCategoryKeyToType`, but
// this direction: name -> key, not key -> canonical type). Jira has exactly
// these three categories.
const JIRA_STATUS_CATEGORY_NAME_TO_KEY = {
  'To Do': 'new',
  'In Progress': 'indeterminate',
  Done: 'done',
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Recognized single-clause matchers. Each entry's `pattern` matches ONE
 * `AND`-split clause (already trimmed); `match(issue, execResult)` decides
 * membership. Order matters only in that `project in (...)` must be tried
 * before the narrower `project = ...` pattern (a `project in (...)` clause
 * would also loosely resemble `project\s*=`'s intent, but not its regex).
 */
const JQL_CLAUSE_MATCHERS = [
  {
    pattern: /^project\s+in\s*\(([^)]*)\)$/i,
    match: (issue, m) => {
      const keys = m[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
      return keys.includes(issue.fields?.project?.key) || keys.includes(issue.fields?.project?.id)
    },
  },
  {
    pattern: /^project\s*=\s*"?([\w-]+)"?$/i,
    match: (issue, m) => issue.fields?.project?.key === m[1] || issue.fields?.project?.id === m[1],
  },
  {
    pattern: /^parent\s*=\s*"?([\w-]+)"?$/i,
    match: (issue, m) => issue.fields?.parent?.key === m[1] || issue.fields?.parent?.id === m[1],
  },
  {
    pattern: /^statusCategory\s*=\s*"([^"]+)"$/i,
    match: (issue, m) => {
      const key = JIRA_STATUS_CATEGORY_NAME_TO_KEY[m[1]]
      return key != null && issue.fields?.status?.statusCategory?.key === key
    },
  },
  {
    pattern: /^issuetype\s*=\s*Epic$/i,
    match: issue => {
      const issuetype = issue.fields?.issuetype
      if (!issuetype) return false
      return issuetype.hierarchyLevel != null ? issuetype.hierarchyLevel === 1 : issuetype.name === 'Epic'
    },
  },
  {
    pattern: /^resolutiondate\s*>=\s*-(\d+)d$/i,
    match: (issue, m) => {
      const resolved = issue.fields?.resolutiondate ? Date.parse(issue.fields.resolutiondate) : NaN
      if (!Number.isFinite(resolved)) return false
      const cutoff = Date.now() - Number(m[1]) * MS_PER_DAY
      return resolved >= cutoff
    },
  },
]

/** `issue.fields.<field>` sort-key lookup for `ORDER BY` support (`key`/`updated`, the only two fields any tier query orders on — LIN-2155). */
function jqlSortValue(issue, field) {
  if (field === 'key') return issue.key || ''
  if (field === 'updated') return issue.fields?.updated || issue.fields?.created || ''
  return ''
}

/** Parses `ORDER BY key ASC` / `ORDER BY updated DESC, key ASC` into `[{field, dir}]` (dir: 1 asc, -1 desc); defaults to `key ASC` when absent, mirroring real Jira's stable-pagination requirement. */
function parseOrderBy(orderByClause) {
  const terms = (orderByClause || 'key ASC').split(',').map(t => t.trim()).filter(Boolean)
  return terms.map(term => {
    const [field, dir] = term.split(/\s+/)
    return { field: (field || '').toLowerCase(), dir: /^desc$/i.test(dir || '') ? -1 : 1 }
  })
}

function matchJql(allIssues, jql) {
  const query = String(jql || '').trim()
  const orderByIndex = query.search(/\border\s+by\s+/i)
  const whereClause = orderByIndex === -1 ? query : query.slice(0, orderByIndex).trim()
  const orderByClause = orderByIndex === -1 ? null : query.slice(orderByIndex).replace(/^order\s+by\s+/i, '').trim()

  const clauseStrings = whereClause.split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean)
  const matchers = clauseStrings.map(clauseStr => {
    for (const clause of JQL_CLAUSE_MATCHERS) {
      const m = clauseStr.match(clause.pattern)
      if (m) return issue => clause.match(issue, m)
    }
    throw new Error(
      `fake-client matchJql: unrecognized JQL clause "${clauseStr}" (full query: "${jql}") — ` +
      'the fake client is not a JQL parser and must be taught this shape explicitly, or the suite would go false-green (LIN-2050)',
    )
  })

  const matched = allIssues.filter(issue => matchers.every(fn => fn(issue)))
  const orderTerms = parseOrderBy(orderByClause)
  return [...matched].sort((a, b) => {
    for (const { field, dir } of orderTerms) {
      const av = jqlSortValue(a, field)
      const bv = jqlSortValue(b, field)
      if (av > bv) return dir
      if (av < bv) return -dir
    }
    return 0
  })
}
