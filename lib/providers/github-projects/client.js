// =============================================================================
// GitHub Projects v2 GraphQL client (LIN-560) — the HTTP boundary the Projects
// provider reads through.
// =============================================================================
//
// A thin wrapper over the GitHub GraphQL API (https://api.github.com/graphql).
// It is a SIBLING to the REST `github/client.js` (GitHub Issues), NOT a reuse of
// it: Projects v2 is GraphQL-only (classic Projects/REST is sunset), so the two
// backends need separate clients and the merge-key separation that follows.
//
// Like the REST client it exposes ONE high-level, board-scoped read method
// (`fetchBoard`) that returns an already-unwrapped, provider-friendly CLEAN shape
// — never the raw GraphQL union/edge envelope. The provider maps that clean shape
// into the canonical model; the in-memory fake (fake-client.js) returns the exact
// same clean shape, so the provider's mapping runs unchanged against fake and
// real backends alike. The GraphQL wire details (union unwrap, Status field
// resolution) are pinned by the captured-fetch unit test, mirroring how the REST
// client's repo-slug encoding is pinned (the fake never exercises them).
//
// Auth lives here (the installation/PAT token), not on the provider, exactly like
// the REST client. `fetchImpl` is injectable (proxy-aware fetch or a stub);
// it defaults to global fetch.
//
// V1 caps board items at the first 100 (no cursor pagination) — a documented
// read-only-V1 bound, consistent with the REST client's `per_page=100` reads.

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'

// One query, two aliased owner branches: a Projects v2 board is owned by either
// an Organization or a User and the `org/number` scope does not say which. We ask
// both and pick whichever resolves — GitHub returns a NOT_FOUND *field* error for
// the wrong owner type while still populating the other branch's `data`, so the
// request helper tolerates per-field errors as long as some data comes back.
const BOARD_QUERY = `
query($login: String!, $number: Int!) {
  organization(login: $login) { ...BoardFields }
  user(login: $login) { ...BoardFields }
}
fragment BoardFields on ProjectV2Owner {
  projectV2(number: $number) {
    id
    number
    title
    url
    shortDescription
    items(first: 100) {
      nodes {
        id
        type
        fieldValueByName(name: "Status") {
          ... on ProjectV2ItemFieldSingleSelectValue { name }
        }
        content {
          ... on Issue {
            number title body url createdAt closedAt
            author { login }
            assignees(first: 10) { nodes { login } }
            labels(first: 20) { nodes { name } }
          }
          ... on PullRequest {
            number title body url createdAt closedAt
            author { login }
            assignees(first: 10) { nodes { login } }
            labels(first: 20) { nodes { name } }
          }
          ... on DraftIssue {
            title body createdAt
          }
        }
      }
    }
  }
}`

// The board list for the live project picker (LIN-560 Session 2). An installation
// account is EITHER an organization OR a user, and the post-install identity does
// not say which, so — exactly like BOARD_QUERY — we ask both aliased branches and
// take whichever resolves. Reads the App installation's Projects v2 boards; an
// empty list most often means the GitHub App lacks the **Projects (read)**
// permission (the operational prerequisite), which the picker surfaces.
const BOARDS_QUERY = `
query($login: String!) {
  organization(login: $login) { projectsV2(first: 100) { nodes { number title url shortDescription closed } } }
  user(login: $login) { projectsV2(first: 100) { nodes { number title url shortDescription closed } } }
}`

/** Parse an `org/projectNumber` board scope into its parts. */
export function parseBoardScope(scope) {
  const [login, number] = String(scope || '').split('/')
  return { login: login || '', number: Number(number) || 0 }
}

/** A single GraphQL projectV2 node → the clean board-summary shape the picker reads. */
function toCleanBoard(node, login) {
  return {
    login,
    number: node?.number ?? null,
    title: node?.title ?? '',
    url: node?.url ?? null,
    shortDescription: node?.shortDescription ?? null,
    closed: !!node?.closed,
  }
}

/** A single GraphQL item node → the provider-friendly clean item shape. */
function toCleanItem(node) {
  const c = node?.content || {}
  return {
    id: node?.id ?? null,
    type: node?.type ?? null, // ISSUE | PULL_REQUEST | DRAFT_ISSUE
    // The board's single-select "Status" option name, or null when the item
    // sits in no column (the provider's heuristic falls back to `unstarted`).
    status: node?.fieldValueByName?.name ?? null,
    content: {
      number: c.number ?? null, // draft items have no number
      title: c.title ?? '',
      body: c.body ?? '',
      url: c.url ?? null, // drafts have no URL
      createdAt: c.createdAt ?? null,
      closedAt: c.closedAt ?? null,
      author: c.author?.login ?? null,
      assignees: (c.assignees?.nodes || []).map(a => a.login),
      labels: (c.labels?.nodes || []).map(l => l.name),
    },
  }
}

/**
 * @param {{ token?: string, baseUrl?: string, fetchImpl?: Function }} [opts]
 * @returns {object} a client with the board-scoped read methods the provider calls.
 */
export function createGitHubProjectsClient({ token, baseUrl = GITHUB_GRAPHQL_URL, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch
  if (!doFetch) throw new Error('createGitHubProjectsClient: no fetch implementation available')

  async function graphql(query, variables) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await doFetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    })
    const text = await res.text()
    const payload = text ? JSON.parse(text) : null
    if (!res.ok) {
      const message = payload?.message || res.statusText || `HTTP ${res.status}`
      const err = new Error(`GitHub GraphQL request failed: ${message}`)
      err.status = res.status
      throw err
    }
    // Per-field NOT_FOUND errors are expected (the wrong owner-type alias), so
    // only fail when NO data came back at all — otherwise the populated alias is
    // a successful read.
    if (!payload?.data) {
      const detail = payload?.errors?.[0]?.message || 'no data returned'
      throw new Error(`GitHub GraphQL request failed: ${detail}`)
    }
    return payload.data
  }

  return {
    /**
     * Read one Projects v2 board by `org/projectNumber` scope into the clean
     * shape: `{ project: {id,number,title,url,shortDescription}|null, items: [...] }`.
     * `project` is null when the board does not exist / is not accessible.
     */
    async fetchBoard(scope) {
      const { login, number } = parseBoardScope(scope)
      const data = await graphql(BOARD_QUERY, { login, number })
      const project = data.organization?.projectV2 || data.user?.projectV2 || null
      if (!project) return { project: null, items: [] }
      return {
        project: {
          id: project.id ?? null,
          number: project.number ?? number,
          title: project.title ?? null,
          url: project.url ?? null,
          shortDescription: project.shortDescription ?? null,
        },
        items: (project.items?.nodes || []).map(toCleanItem),
      }
    },

    /**
     * List the Projects v2 boards owned by `login` (an org or user account), for
     * the live project picker (LIN-560 Session 2). Returns the clean board-summary
     * shape `[{ login, number, title, url, shortDescription, closed }]`. An empty
     * array means either the account has no boards OR — the common cause — the
     * GitHub App installation lacks the **Projects (read)** permission, which the
     * picker surfaces as a prerequisite hint rather than a bare "none found".
     */
    async listBoards(login) {
      const data = await graphql(BOARDS_QUERY, { login: String(login || '') })
      const nodes = data.organization?.projectsV2?.nodes ?? data.user?.projectsV2?.nodes ?? []
      return nodes.map(node => toCleanBoard(node, login))
    },
  }
}
