/**
 * Linear provider (LIN-176 Phase 2, Subtask 1 — the Contract).
 *
 * Owns the Linear GraphQL boundary (the `GraphQLClient` / `createLinearClient`
 * that previously lived at lib/linear.js:24) and the 9 dashboard read fetchers,
 * moved here VERBATIM from lib/linear.js. `lib/linear.js` is now a thin shim
 * that re-exports these — every existing consumer keeps importing from
 * lib/linear.js and behaves identically (zero behavior change).
 *
 * The fetchers stay module-level functions with their original
 * `(apiKey, ...)` signatures (each creates its own per-call client, because the
 * OAuth token is per-request/per-workspace — a singleton provider cannot hold
 * one client). The `LinearProvider` class wraps them so the registry/interface
 * see a capability-gated object; the class methods simply delegate to these
 * functions, keeping the moved bodies byte-for-byte identical to the originals.
 *
 * Guardrails preserved through the move (do not regress):
 *   - LIN-300: lean `fetchFocusedChild` (FOCUSED_CHILD_QUERY, no parent/sibling
 *     re-traversal) and its keepalive-aligned abortable fetch.
 *   - LIN-284: `siblingsTotal` / `cousinsTotal` pre-truncation counts.
 *   - Abort-signal threading on fetchIssueContext / fetchFocusedChild /
 *     fetchRecommendationContext.
 *   - No deep-flattening of `{nodes:[...]}` shapes (deferred to LIN-306).
 */
import { GraphQLClient, gql } from 'graphql-request'
import { createLinearFetch } from '../../linear-fetch.js'
import { getStateOrder } from '../state-map.js'
import { SOURCE_LINEAR } from '../models.js'
import { selectFocusSubtask } from '../../tree.js'
import { COUSIN_CAP, SIBLING_CAP } from '../../openrouter.js'
import { ProviderInterface, AuthExchangeError } from '../interface.js'
import { registerProvider } from '../registry.js'
import { createAuthRoutes } from '../../../routes/auth.js'

const LINEAR_API_ENDPOINT = 'https://api.linear.app/graphql'

/**
 * Stamp Linear provenance (LIN-561) on a dashboard canonical issue. Linear has
 * no `_toCanonicalIssue` mapper (its GraphQL response is already canonical
 * shape), so this is the stamp seam the local/github providers do inline. It
 * runs ONLY on the dashboard read path (fetchProjects / fetchIssueFields); the
 * route-internal API-surface reads (search / issues / issueDetail) that feed the
 * source-neutral proxy wire are deliberately left un-stamped so that contract
 * stays byte-identical. Mutates in place and returns the node.
 */
function stampLinearSource(issue) {
  if (issue && typeof issue === 'object') issue.source = SOURCE_LINEAR
  return issue
}

// State ordering for sorting issues by relevance now comes from the canonical
// state-map (LIN-174 Phase 1). Linear's GraphQL response is already canonical
// shape `{ name, type }`, so no normalization is needed at this boundary.

/**
 * Resilient fetch for every Linear request: per-attempt timeout + bounded
 * retries on transient connection drops (see lib/linear-fetch.js). A single
 * dropped keep-alive socket ("Premature close" / ECONNRESET) is retried on a
 * fresh connection instead of surfacing as a LINEAR_UNREACHABLE error page;
 * mutations are never replayed (LIN-399). Shared across all per-call clients —
 * it is stateless, so one instance is safe.
 */
const linearFetch = createLinearFetch()

/**
 * Creates a GraphQL client configured for the Linear API.
 * Centralizes client creation to ensure consistent configuration.
 *
 * @param {string} apiKey - OAuth access token or API key
 * @returns {GraphQLClient} Configured GraphQL client
 */
function createLinearClient(apiKey) {
  return new GraphQLClient(LINEAR_API_ENDPOINT, {
    headers: {
      Authorization: apiKey,
    },
    fetch: linearFetch,
  })
}

/**
 * GraphQL fragment containing all issue fields needed for tree display.
 * Shared between filtered and unfiltered issue queries.
 */
const ISSUE_FIELDS_FRAGMENT = gql`
  fragment IssueFields on Issue {
    id
    identifier
    title
    description
    estimate
    priority
    sortOrder
    createdAt
    dueDate
    completedAt
    url
    parent { id }
    project { id name }
    state {
      name
      type
    }
    assignee {
      name
    }
    labels {
      nodes {
        name
      }
    }
    relations {
      nodes {
        type
        relatedIssue { id }
      }
    }
  }
`

/**
 * Homepage-scoped slim fragment (LIN-442).
 *
 * Byte-for-byte `IssueFields` MINUS `description`. The dashboard list view never
 * shows the description until a node is expanded (detail is now lazy-loaded via
 * `fetchIssueFields`/`/api/detail`), so the homepage no longer pays to fetch —
 * or to embed in `data-search-text` — the description bytes for every issue.
 *
 * Deliberately a SEPARATE fragment, not a mutation of `ISSUE_FIELDS_FRAGMENT`:
 * that shared fragment still feeds swim/ship/swipe/pipeline/workspace-api/proxy,
 * which must keep `description`. Keep this list in sync with the shared fragment
 * (sans `description`). `relations` is intentionally retained for now — its
 * removal is gated on a collapsed-view consumer audit (LIN-442 follow-up).
 */
const ISSUE_FIELDS_SLIM_FRAGMENT = gql`
  fragment IssueFieldsSlim on Issue {
    id
    identifier
    title
    estimate
    priority
    sortOrder
    createdAt
    dueDate
    completedAt
    url
    parent { id }
    project { id name }
    state {
      name
      type
    }
    assignee {
      name
    }
    labels {
      nodes {
        name
      }
    }
    relations {
      nodes {
        type
        relatedIssue { id }
      }
    }
  }
`

/**
 * GraphQL query to fetch all teams in the workspace.
 * Used for the team filter dropdown.
 */
const TEAMS_QUERY = gql`
  query {
    teams {
      nodes {
        id
        name
        key
      }
    }
  }
`

/**
 * GraphQL query to fetch organization details.
 * Used to identify workspace after OAuth callback.
 */
const ORGANIZATION_QUERY = gql`
  query {
    organization {
      id
      name
      urlKey
    }
  }
`

/**
 * GraphQL query to fetch the current authenticated user.
 * Used to get the Linear user ID for preference persistence.
 */
const VIEWER_QUERY = gql`
  query {
    viewer {
      id
    }
  }
`

/**
 * GraphQL query to fetch the organization name and all "started" projects.
 * Projects in other states (planned, paused, completed, canceled) are excluded
 * to focus on active work.
 */
const PROJECTS_QUERY = gql`
  query {
    organization {
      name
    }
    projects(filter: { state: { eq: "started" } }) {
      nodes {
        id
        name
        content
        url
        sortOrder
      }
    }
  }
`

/**
 * GraphQL query to fetch issues with team filter.
 * Uses cursor-based pagination to handle workspaces with many issues.
 */
const ISSUES_QUERY = gql`
  ${ISSUE_FIELDS_FRAGMENT}
  query($first: Int!, $after: String, $teamId: ID) {
    issues(first: $first, after: $after, filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        ...IssueFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

/**
 * GraphQL query to fetch all issues without team filter.
 * Uses cursor-based pagination to handle workspaces with many issues.
 */
const ISSUES_QUERY_ALL = gql`
  ${ISSUE_FIELDS_FRAGMENT}
  query($first: Int!, $after: String) {
    issues(first: $first, after: $after) {
      nodes {
        ...IssueFields
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

/**
 * Homepage-scoped slim variants (LIN-442) — identical to the queries above but
 * on the description-less `IssueFieldsSlim`. Only the dashboard fetch opts into
 * these (via `fetchProjects(apiKey, teamId, { slim: true })`).
 */
const ISSUES_QUERY_SLIM = gql`
  ${ISSUE_FIELDS_SLIM_FRAGMENT}
  query($first: Int!, $after: String, $teamId: ID) {
    issues(first: $first, after: $after, filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        ...IssueFieldsSlim
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

const ISSUES_QUERY_ALL_SLIM = gql`
  ${ISSUE_FIELDS_SLIM_FRAGMENT}
  query($first: Int!, $after: String) {
    issues(first: $first, after: $after) {
      nodes {
        ...IssueFieldsSlim
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

/**
 * Single-issue query for the lazy dashboard detail surface (LIN-442). Reuses the
 * full `ISSUE_FIELDS_FRAGMENT` so the one expanded issue carries every field
 * `renderDetailsContent` needs (description, assignee, estimate, dates, labels) —
 * paid once, on expand, instead of for all 600 issues up front.
 */
const ISSUE_DETAIL_FIELDS_QUERY = gql`
  ${ISSUE_FIELDS_FRAGMENT}
  query($id: String!) {
    issue(id: $id) {
      ...IssueFields
    }
  }
`

/**
 * GraphQL query to fetch a single issue with full details for prompt generation.
 * Includes identifier (e.g., "LIN-123") for display in prompts.
 * Also fetches project info, labels, children, and comments for richer context.
 */
const ISSUE_DETAIL_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      trashed
      state {
        name
        type
      }
      project {
        id
        name
        content
      }
      labels {
        nodes {
          name
        }
      }
      comments {
        nodes {
          id
          body
          createdAt
          user {
            name
          }
        }
      }
      children {
        nodes {
          id
          identifier
          title
          state {
            name
            type
          }
          labels {
            nodes {
              name
            }
          }
          inverseRelations {
            nodes {
              type
              issue {
                id
                identifier
                state {
                  type
                }
              }
            }
          }
          # Grandchildren WITH their own blocked-ness (state +
          # inverseRelations — blocked-ness is the blocking relationship, not a
          # label, since LIN-357), so the transitive dead-end guard in selectFocusSubtask
          # (LIN-444: hasOpenFrontier) can tell a child whose subtree dead-ends in
          # blocked work (HAR-497 → blocked HAR-502) from one with an open frontier
          # (HAR-545 → HAR-616). Without this depth the grandchildren read as
          # actionable leaves and the guard stays inert — which is why the single-hop
          # LIN-433 fix was insufficient for HAR-149. One level deep is enough for the
          # documented shape; great-grandchildren stay ids-only (subtask-count signal).
          children {
            nodes {
              id
              identifier
              title
              state {
                name
                type
              }
              labels {
                nodes {
                  name
                }
              }
              inverseRelations {
                nodes {
                  type
                  issue {
                    id
                    identifier
                    state {
                      type
                    }
                  }
                }
              }
              children {
                nodes {
                  id
                }
              }
            }
          }
        }
      }
      parent {
        id
        identifier
        title
        state {
          name
          type
        }
        children {
          nodes {
            id
            identifier
            title
            state {
              name
              type
            }
            labels {
              nodes {
                name
              }
            }
            inverseRelations {
              nodes {
                type
                issue {
                  id
                  identifier
                  state {
                    type
                  }
                }
              }
            }
            children {
              nodes {
                id
                identifier
                title
                state {
                  name
                  type
                }
              }
            }
          }
        }
      }
    }
  }
`

/**
 * Fetches all teams from Linear for the authenticated user's organization.
 *
 * @param {string} apiKey - OAuth access token (passed as 'Bearer {token}' or raw token)
 * @returns {Promise<Array>} Array of teams with id, name, key
 * @throws {Error} If the API request fails (e.g., 401 for invalid/expired token)
 */
export async function fetchTeams(apiKey) {
  const client = createLinearClient(apiKey)
  const data = await client.request(TEAMS_QUERY)
  return data.teams?.nodes || []
}

/**
 * Fetches organization details from Linear for the authenticated user.
 * Used to identify the workspace after OAuth callback.
 *
 * @param {string} apiKey - OAuth access token
 * @returns {Promise<{id: string, name: string, urlKey: string}>} Organization details
 * @throws {Error} If the API request fails (e.g., 401 for invalid/expired token)
 */
export async function fetchOrganization(apiKey) {
  const client = createLinearClient(apiKey)
  const data = await client.request(ORGANIZATION_QUERY)
  return data.organization
}

/**
 * Fetches the current authenticated user from Linear.
 * Used to get the Linear user ID for preference persistence.
 *
 * @param {string} apiKey - OAuth access token
 * @returns {Promise<{id: string}>} Viewer (current user) details
 * @throws {Error} If the API request fails (e.g., 401 for invalid/expired token)
 */
export async function fetchViewer(apiKey) {
  const client = createLinearClient(apiKey)
  const data = await client.request(VIEWER_QUERY)
  return data.viewer
}

/**
 * Fetches the list of active projects (without issues).
 * Lightweight alternative to fetchProjects() for cases where only project metadata is needed.
 *
 * @param {string} apiKey - OAuth access token
 * @returns {Promise<Array>} Array of active projects with id, name, content, url, sortOrder
 */
export async function fetchProjectsList(apiKey) {
  const client = createLinearClient(apiKey)
  const data = await client.request(PROJECTS_QUERY)
  return data.projects.nodes
}

/**
 * Fetches all projects and issues from Linear for the authenticated user's organization.
 *
 * @param {string} apiKey - OAuth access token (passed as 'Bearer {token}' or raw token)
 * @param {string|null} teamId - Optional team ID to filter issues by
 * @returns {Promise<{organizationName: string, projects: Array, issues: Array}>}
 *   - organizationName: The Linear workspace/organization name
 *   - projects: Array of active ("started") projects with id, name, content, url, sortOrder
 *   - issues: Array of all issues (or filtered by team) with full metadata for tree building
 * @throws {Error} If the API request fails (e.g., 401 for invalid/expired token)
 */
export async function fetchProjects(apiKey, teamId = null, { slim = false } = {}) {
  const client = createLinearClient(apiKey)

  // Fetch projects (single request)
  const projectsData = await client.request(PROJECTS_QUERY)

  // Fetch all issues using cursor-based pagination.
  // Linear's API limits each request to 250 items max, so we loop until exhausted.
  // Use filtered query if teamId provided, otherwise fetch all issues.
  // `slim` (LIN-442) drops `description` for the homepage, which lazy-loads it.
  let allIssues = []
  let hasNextPage = true
  let cursor = null
  const query = teamId
    ? (slim ? ISSUES_QUERY_SLIM : ISSUES_QUERY)
    : (slim ? ISSUES_QUERY_ALL_SLIM : ISSUES_QUERY_ALL)

  while (hasNextPage) {
    const variables = teamId
      ? { first: 250, after: cursor, teamId }
      : { first: 250, after: cursor }
    const data = await client.request(query, variables)
    allIssues.push(...data.issues.nodes)
    hasNextPage = data.issues.pageInfo.hasNextPage
    cursor = data.issues.pageInfo.endCursor
  }

  return {
    organizationName: projectsData.organization.name,
    projects: projectsData.projects.nodes,
    issues: allIssues.map(stampLinearSource), // provenance stamp (LIN-561)
  }
}

/**
 * Fetches a single issue's canonical fields for the lazy dashboard detail
 * surface (LIN-442). Returns the raw `IssueFields` node — the SAME shape
 * `fetchProjects` emits per issue — so `renderDetailsContent` renders it with no
 * adaptation (labels stay `{ nodes: [{ name }] }`, not the flat array
 * `fetchIssueContext` produces).
 *
 * @param {string} apiKey - OAuth access token
 * @param {string} issueId - The issue ID (UUID or identifier like LIN-123)
 * @returns {Promise<Object>} The issue node (description, assignee, estimate, …)
 * @throws {Error} If the API request fails or the issue is not found
 */
export async function fetchIssueFields(apiKey, issueId, { signal } = {}) {
  const client = createLinearClient(apiKey)
  const data = await client.request({ document: ISSUE_DETAIL_FIELDS_QUERY, variables: { id: issueId }, signal })
  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  return stampLinearSource(data.issue) // provenance stamp (LIN-561)
}

/**
 * Fetches a single issue with context for prompt generation.
 * Returns the issue details plus parent, sibling, project, children, and comments.
 *
 * @param {string} apiKey - OAuth access token
 * @param {string} issueId - The issue ID to fetch
 * @returns {Promise<Object>} Context object with:
 *   - issue: The issue with id, identifier, title, description, state, url, labels
 *   - parent: Parent issue details or null if top-level
 *   - siblings: Up to SIBLING_CAP most relevant sibling issues (prioritizing in-progress and todo)
 *   - siblingsTotal: Pre-truncation count of siblings (so callers can compute "N not shown")
 *   - parentChildCount: Total number of parent's children (siblings + 1), pre-slice; null when no parent
 *   - cousins: Flattened grandchildren via siblings, de-duped, sorted, capped at COUSIN_CAP
 *   - cousinsTotal: Pre-truncation count of cousins (so callers can compute "N not shown")
 *   - project: Project name and description or null
 *   - children: Array of existing child issues
 *   - comments: Array of comments with body, createdAt, and user name
 * @throws {Error} If the API request fails or issue not found
 */
export async function fetchIssueContext(apiKey, issueId, { signal } = {}) {
  const client = createLinearClient(apiKey)
  const data = await client.request({ document: ISSUE_DETAIL_QUERY, variables: { id: issueId }, signal })

  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`)
  }

  // LIN-401: Linear soft-deletes — a trashed issue still resolves by ID with a
  // stale pre-deletion state. Refuse it here so the context fetchers that feed
  // recommend/recap/brief/prompt never distil or recommend work on a ghost. The
  // 'not found' message reuses each consumer's existing not-found → 404 branch.
  // (This guards the DIRECTLY-named target; nested children/parent already drop
  // trash, and a descended terminal node is caught by the recommend guard.)
  if (data.issue.trashed) {
    throw new Error(`Issue not found (trashed): ${issueId}`)
  }

  const issue = data.issue
  const parent = issue.parent || null

  // Get siblings (other children of the same parent), excluding this issue
  let siblings = []
  let siblingsTotal = 0
  let parentChildCount = null
  let cousins = []
  let cousinsTotal = 0
  if (parent?.children?.nodes) {
    const parentChildren = parent.children.nodes
    parentChildCount = parentChildren.length

    const allSiblings = parentChildren.filter(child => child.id !== issueId)

    // Sort siblings by relevance: in-progress first, then todo, then completed
    allSiblings.sort((a, b) => {
      const aOrder = getStateOrder(a.state?.type) ?? 2
      const bOrder = getStateOrder(b.state?.type) ?? 2
      return aOrder - bOrder
    })

    // Take top SIBLING_CAP most relevant; siblingsTotal preserves the pre-slice
    // count so formatIssueContext can surface silent truncation (LIN-284).
    siblingsTotal = allSiblings.length
    siblings = allSiblings.slice(0, SIBLING_CAP)

    // Flatten cousins (children of all siblings), de-duplicate by id, sort, then cap.
    // Use the full sibling list (not the top-5 slice) so the cousin view reflects the
    // whole epic, not just the most-relevant siblings — that's the whole point of the
    // epic-shaped-parent heuristic in formatIssueContext.
    const seen = new Set()
    const flatCousins = []
    for (const sibling of allSiblings) {
      const grandchildren = sibling.children?.nodes || []
      for (const cousin of grandchildren) {
        if (!cousin?.id || seen.has(cousin.id)) continue
        seen.add(cousin.id)
        flatCousins.push({
          id: cousin.id,
          identifier: cousin.identifier,
          title: cousin.title,
          state: cousin.state
        })
      }
    }

    // Sort cousins: in-progress → todo → done, then alphabetical by identifier
    flatCousins.sort((a, b) => {
      const aOrder = getStateOrder(a.state?.type) ?? 2
      const bOrder = getStateOrder(b.state?.type) ?? 2
      if (aOrder !== bOrder) return aOrder - bOrder
      return (a.identifier || '').localeCompare(b.identifier || '')
    })

    cousinsTotal = flatCousins.length
    cousins = flatCousins.slice(0, COUSIN_CAP)
  }

  // Extract label names
  const labels = (issue.labels?.nodes || []).map(l => l.name)

  // Get existing children and sort by relevance (same as siblings)
  const children = [...(issue.children?.nodes || [])]
  children.sort((a, b) => {
    const aOrder = getStateOrder(a.state?.type) ?? 2
    const bOrder = getStateOrder(b.state?.type) ?? 2
    return aOrder - bOrder
  })

  // Get comments (sorted by date, oldest first for chronological reading)
  const comments = (issue.comments?.nodes || [])
    .map(c => ({
      body: c.body,
      createdAt: c.createdAt,
      user: c.user?.name || 'Unknown'
    }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  return {
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      url: issue.url,
      state: issue.state,
      labels
    },
    parent: parent ? {
      id: parent.id,
      identifier: parent.identifier,
      title: parent.title,
      state: parent.state
    } : null,
    siblings,
    siblingsTotal,
    parentChildCount,
    cousins,
    cousinsTotal,
    project: issue.project ? {
      name: issue.project.name,
      description: issue.project.content
    } : null,
    children,
    comments
  }
}

/**
 * Lightweight query for a parent's focused subtask.
 *
 * fetchRecommendationContext used to re-run the full ISSUE_DETAIL_QUERY for the
 * focused child, which traverses back up to the parent and re-fetches the whole
 * sibling/cousin subtree we already loaded for the parent — a redundant, heavy
 * second round-trip on large epics. The recommendation only consumes the child's
 * own issue fields and comments (see formatIssueContext's focusedChild branch),
 * so this query fetches exactly that and nothing else.
 */
const FOCUSED_CHILD_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      state {
        name
        type
      }
      labels {
        nodes {
          name
        }
      }
      comments {
        nodes {
          id
          body
          createdAt
          user {
            name
          }
        }
      }
    }
  }
`

/**
 * GraphQL query to fetch just comments for an issue.
 * LIN-156: Lightweight endpoint for comments-only fetching.
 */
const ISSUE_COMMENTS_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      comments {
        nodes {
          id
          body
          createdAt
          user {
            name
          }
        }
      }
    }
  }
`

/**
 * Fetches comments for a single issue.
 * LIN-156: Lightweight alternative to fetchIssueContext when only comments are needed.
 *
 * @param {string} apiKey - OAuth access token
 * @param {string} issueId - The issue ID to fetch comments for
 * @returns {Promise<Array>} Array of comments with body, createdAt, and user name
 * @throws {Error} If the API request fails or issue not found
 */
export async function fetchIssueComments(apiKey, issueId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(ISSUE_COMMENTS_QUERY, { id: issueId })

  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`)
  }

  return (data.issue.comments?.nodes || [])
    .map(c => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      user: c.user?.name || 'Unknown'
    }))
    .sort((a, b) => {
      // Parse dates with validation to prevent sort failures on invalid data
      const dateA = new Date(a.createdAt)
      const dateB = new Date(b.createdAt)
      const timeA = isNaN(dateA.getTime()) ? 0 : dateA.getTime()
      const timeB = isNaN(dateB.getTime()) ? 0 : dateB.getTime()
      return timeA - timeB
    })
}

/**
 * Fetch just the focused subtask's own detail (description, labels, comments).
 *
 * Returns the same { issue, comments } slice that formatIssueContext and
 * hashContext read from focusedChild, without the parent/sibling/cousin/project
 * subtree that the full fetchIssueContext would re-fetch and then discard.
 *
 * @param {string} apiKey - OAuth access token
 * @param {string} issueId - The focused subtask's ID
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Aborts the underlying request
 * @returns {Promise<{issue: Object, comments: Array}>}
 */
export async function fetchFocusedChild(apiKey, issueId, { signal } = {}) {
  const client = createLinearClient(apiKey)
  const data = await client.request({ document: FOCUSED_CHILD_QUERY, variables: { id: issueId }, signal })

  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`)
  }

  const issue = data.issue
  const labels = (issue.labels?.nodes || []).map(l => l.name)
  const comments = (issue.comments?.nodes || [])
    .map(c => ({
      body: c.body,
      createdAt: c.createdAt,
      user: c.user?.name || 'Unknown'
    }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  return {
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      url: issue.url,
      state: issue.state,
      labels
    },
    comments
  }
}

/**
 * Fetch issue context optimized for AI recommendations.
 * For parent tasks with children, also fetches focused subtask details.
 *
 * @param {string} apiKey - OAuth access token
 * @param {string} issueId - The issue ID to fetch
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Aborts both underlying requests
 * @param {boolean} [options.noDescend] - Leaf-target lever (LIN-365). When true, a
 *   parent is returned WITHOUT a focusedChild, so the recommender frames it as a leaf
 *   and recommends its OWN work instead of being biased to defer into a child. The
 *   deterministic non-descent guarantee lives in resolveRecommendation; this just keeps
 *   the SUGGESTED-NEXT defer pointer out of the prompt so the model's own-work framing isn't fighting it.
 * @returns {Promise<Object>} Context object with optional focusedChild for parent tasks
 */
export async function fetchRecommendationContext(apiKey, issueId, { signal, noDescend = false } = {}) {
  const context = await fetchIssueContext(apiKey, issueId, { signal })

  // Leaf task - return as-is
  if (!context.children?.length) {
    return context
  }

  // noDescend (LIN-365): caller wants the parent's own work, so skip focus selection
  // entirely — frame the parent as a leaf (no focusedChild, no defer pointer).
  if (noDescend) {
    return context
  }

  // Parent task - select and fetch focused subtask
  const focusChild = selectFocusSubtask(context.children)
  if (!focusChild) {
    return context  // All children complete
  }

  // Lightweight focused-child fetch (own fields + comments only) — avoids a
  // redundant full ISSUE_DETAIL_QUERY that would re-traverse the parent subtree.
  const focusedChildContext = await fetchFocusedChild(apiKey, focusChild.id, { signal })
  return {
    ...context,
    focusedChild: focusedChildContext
  }
}

// =============================================================================
// API-surface reads + writes (LIN-307)
// =============================================================================
//
// The methods the *consumer API* needs that the dashboard reads above do not.
// LIN-176 declared these on the interface as headroom (reads) and first-class
// writes; this step wires them on the Linear provider so LIN-308/309 can
// re-point the proxy handlers onto the provider layer.
//
// Each query/mutation below is MOVED, not invented — copied from the inline
// GraphQL `routes/proxy.js` already runs, so the eventual re-point is a pure
// relocation with no behaviour change. The two exceptions are `updateComment`
// /`deleteComment`: their commentUpdate/commentDelete mutations have no proxy
// endpoint today and are added here to complete the write surface per LIN-307's
// scope expansion (the parent ticket's "comment edit/delete" note).
//
// Faithful to this file's convention, these stay module-level `(apiKey, …)`
// functions (each makes its own per-call client) and the class methods below
// merely delegate. HTTP concerns the proxy layers on top — status codes, the
// LIN-401 trashed-write guard, the LIN-399 comment dedupe — deliberately stay
// in the route and are NOT duplicated here; they re-attach when callers move.

const SEARCH_QUERY = gql`
  query($query: String!, $first: Int) {
    searchIssues(term: $query, first: $first) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        assignee { name }
        labels { nodes { id name color } }
        project { id name }
        cycle { id name number }
        parent { id identifier }
      }
    }
  }
`

const STATES_QUERY = gql`
  query($teamId: ID!) {
    workflowStates(filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id name type position
      }
    }
  }
`

const CYCLES_QUERY = gql`
  query($teamId: ID) {
    cycles(filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id
        name
        number
        startsAt
        endsAt
        team { id name }
      }
    }
  }
`

const CYCLES_QUERY_ALL = gql`
  query {
    cycles {
      nodes {
        id
        name
        number
        startsAt
        endsAt
        team { id name }
      }
    }
  }
`

const CYCLE_DETAIL_QUERY = gql`
  query($id: String!) {
    cycle(id: $id) {
      id
      name
      number
      description
      startsAt
      endsAt
      completedAt
      progress
      scopeHistory
      completedScopeHistory
      team { id name }
      issues {
        nodes {
          id
          identifier
          title
          state { name type }
          assignee { name }
          priority
        }
      }
    }
  }
`

const LABELS_QUERY = gql`
  query {
    issueLabels {
      nodes {
        id name color
        team { id name }
      }
    }
  }
`

const LABELS_BY_TEAM_QUERY = gql`
  query($teamId: ID!) {
    issueLabels(filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id name color
      }
    }
  }
`

const RELATIONS_QUERY = gql`
  query($issueId: String!) {
    issue(id: $issueId) {
      trashed
      relations {
        nodes {
          id
          type
          relatedIssue { id identifier title state { name type } }
        }
      }
      inverseRelations {
        nodes {
          id
          type
          issue { id identifier title state { name type } }
        }
      }
    }
  }
`

// LIN-308: API-surface read queries relocated verbatim from routes/proxy.js so
// the proxy route no longer owns inline GraphQL. These mirror the proxy's exact
// field selection and are deliberately kept separate from the dashboard issue
// queries above (ISSUES_QUERY / ISSUE_DETAIL_QUERY), which use a different,
// fragment-based / deep-traversal shape and would change the wire output.
const API_VIEWER_QUERY = gql`
  query {
    viewer {
      id
      name
      email
    }
  }
`

// Mirrors the proxy's PROJECTS_QUERY exactly. Deliberately NOT `fetchProjectsList`
// (PROJECTS_QUERY above), which also selects `sortOrder` (+ top-level
// `organization`) for dashboard sorting — `neutralizeProject` only strips `url`,
// so reusing it would leak `sortOrder` into the wire response (LIN-308).
const API_PROJECTS_QUERY = gql`
  query {
    projects(filter: { state: { eq: "started" } }) {
      nodes {
        id
        name
        content
        url
      }
    }
  }
`

const API_ISSUES_QUERY = gql`
  query($first: Int!, $after: String, $teamId: ID) {
    issues(first: $first, after: $after, filter: { team: { id: { eq: $teamId } } }) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        assignee { name }
        labels { nodes { id name color } }
        priority
        dueDate
        parent { id identifier }
        project { id name }
        cycle { id name number }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

const API_ISSUES_QUERY_ALL = gql`
  query($first: Int!, $after: String) {
    issues(first: $first, after: $after) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        assignee { name }
        labels { nodes { id name color } }
        priority
        dueDate
        parent { id identifier }
        project { id name }
        cycle { id name number }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

const API_ISSUE_DETAIL_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      state { name type }
      trashed
      assignee { name }
      labels { nodes { id name color } }
      priority
      estimate
      dueDate
      createdAt
      completedAt
      project { id name }
      cycle { id name number startsAt endsAt }
      parent { id identifier title }
      children {
        nodes {
          id identifier title
          state { name type }
        }
      }
      comments {
        nodes {
          id body createdAt
          user { name }
        }
      }
      relations {
        nodes {
          id
          type
          relatedIssue { id identifier title state { name type } }
        }
      }
      inverseRelations {
        nodes {
          id
          type
          issue { id identifier title state { name type } }
        }
      }
    }
  }
`

const CREATE_ISSUE_MUTATION = gql`
  mutation($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id identifier title url
        state { name type }
      }
    }
  }
`

const UPDATE_ISSUE_MUTATION = gql`
  mutation($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id identifier title url
        state { name type }
      }
    }
  }
`

const CREATE_COMMENT_MUTATION = gql`
  mutation($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment {
        id body createdAt
        user { name }
      }
    }
  }
`

// LIN-307 scope expansion: comment edit/delete have no proxy endpoint yet, so
// these two mutations are the only NEW GraphQL in this step (everything else is
// relocated). Standard Linear commentUpdate/commentDelete.
const UPDATE_COMMENT_MUTATION = gql`
  mutation($id: String!, $input: CommentUpdateInput!) {
    commentUpdate(id: $id, input: $input) {
      success
      comment {
        id body createdAt updatedAt
        user { name }
      }
    }
  }
`

const DELETE_COMMENT_MUTATION = gql`
  mutation($id: String!) {
    commentDelete(id: $id) {
      success
    }
  }
`

const CREATE_RELATION_MUTATION = gql`
  mutation($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      issueRelation {
        type
        issue { id identifier }
        relatedIssue { id identifier }
      }
    }
  }
`

const DELETE_RELATION_MUTATION = gql`
  mutation($id: String!) {
    issueRelationDelete(id: $id) {
      success
    }
  }
`

const ISSUE_LABELS_QUERY = gql`
  query($issueId: String!) {
    issue(id: $issueId) {
      id
      trashed
      labels { nodes { id name } }
    }
  }
`

// Lightweight read for description edits — the full issue-detail read is far
// heavier than a read-modify-write of the body needs (relocated from the proxy
// route in LIN-309).
const ISSUE_DESCRIPTION_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      description
      trashed
    }
  }
`

// LIN-401: a lightweight trashed-only probe for write handlers that don't
// otherwise read the issue (PATCH, comments, relation create). Linear still
// resolves trashed issues by ID, so without this a write would silently mutate
// a soft-deleted ghost. Relocated from the proxy route in LIN-309.
// LIN-556: also returns the issue's team so a PATCH can scope a symbolic state
// reference (e.g. `done`) to the correct team without a second read.
const TRASHED_GUARD_QUERY = gql`
  query($id: String!) {
    issue(id: $id) {
      id
      trashed
      team { id }
    }
  }
`

const UPDATE_ISSUE_LABELS_MUTATION = gql`
  mutation($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id identifier
        labels { nodes { id name } }
      }
    }
  }
`

/**
 * Full-text search over issues (max `first`, default 50 — the proxy's cap).
 * @param {string} apiKey
 * @param {string} query - Search term
 * @param {{first?: number}} [options]
 * @returns {Promise<Array>} Matching issue nodes (same shape as the list reads)
 */
export async function search(apiKey, query, { first = 50 } = {}) {
  const client = createLinearClient(apiKey)
  const data = await client.request(SEARCH_QUERY, { query, first })
  return data.searchIssues?.nodes || []
}

/**
 * Workflow states for a team, sorted by board position (an ID-based lookup).
 * @param {string} apiKey
 * @param {string} teamId
 * @returns {Promise<Array>} States ({ id, name, type, position }) in board order
 */
export async function states(apiKey, teamId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(STATES_QUERY, { teamId })
  return (data.workflowStates?.nodes || []).sort((a, b) => a.position - b.position)
}

/**
 * Issue labels, optionally scoped to a team.
 * @param {string} apiKey
 * @param {string|null} [teamId] - When set, only that team's labels
 * @returns {Promise<Array>} Labels ({ id, name, color, … })
 */
export async function labels(apiKey, teamId = null) {
  const client = createLinearClient(apiKey)
  const query = teamId ? LABELS_BY_TEAM_QUERY : LABELS_QUERY
  const variables = teamId ? { teamId } : {}
  const data = await client.request(query, variables)
  return data.issueLabels?.nodes || []
}

/**
 * Cycles, optionally scoped to a team.
 * @param {string} apiKey
 * @param {string|null} [teamId]
 * @returns {Promise<Array>} Cycles ({ id, number, startsAt, endsAt, … })
 */
export async function cycles(apiKey, teamId = null) {
  const client = createLinearClient(apiKey)
  const query = teamId ? CYCLES_QUERY : CYCLES_QUERY_ALL
  const variables = teamId ? { teamId } : {}
  const data = await client.request(query, variables)
  return data.cycles?.nodes || []
}

/**
 * A single cycle's detail (issues, progress, scope history); null if missing.
 * @param {string} apiKey
 * @param {string} cycleId
 * @returns {Promise<Object|null>}
 */
export async function cycleDetail(apiKey, cycleId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(CYCLE_DETAIL_QUERY, { id: cycleId })
  return data.cycle || null
}

/**
 * An issue's relations and inverse relations, in Linear's {nodes:[…]} shape;
 * null when the issue does not resolve. `trashed` flags a soft-deleted target
 * (LIN-401) — the relations are still returned so a consumer can see what a now-
 * deleted issue was related to.
 * @param {string} apiKey
 * @param {string} issueId
 * @returns {Promise<{trashed: boolean, relations: {nodes: Array}, inverseRelations: {nodes: Array}}|null>}
 */
export async function relations(apiKey, issueId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(RELATIONS_QUERY, { issueId })
  if (!data.issue) return null
  return {
    trashed: !!data.issue.trashed,
    relations: { nodes: data.issue.relations?.nodes || [] },
    inverseRelations: { nodes: data.issue.inverseRelations?.nodes || [] },
  }
}

/**
 * The authenticated user as the API surface exposes it ({ id, name, email }) —
 * a wider selection than the id-only `fetchViewer` used for preference keys.
 * Mirrors the proxy's VIEWER_QUERY verbatim (LIN-308).
 * @param {string} apiKey
 * @returns {Promise<{id: string, name: string, email: string}>}
 */
export async function viewer(apiKey) {
  const client = createLinearClient(apiKey)
  const data = await client.request(API_VIEWER_QUERY)
  return data.viewer
}

/**
 * Active ("started") projects in the API surface's exact field shape
 * ({ id, name, content, url }), before wire neutralization. Distinct from
 * `fetchProjectsList`, which selects a wider set (`sortOrder`, organization) the
 * route would otherwise leak. (LIN-308)
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function projects(apiKey) {
  const client = createLinearClient(apiKey)
  const data = await client.request(API_PROJECTS_QUERY)
  return data.projects?.nodes || []
}

/**
 * A single page of issues for the API surface, optionally team-scoped, in the
 * proxy's exact field shape. Returns `{ nodes, pageInfo }` (raw — the route owns
 * pageInfo normalization). Distinct from `fetchProjects`, which loops every page
 * and returns no cursor. (LIN-308)
 * @param {string} apiKey
 * @param {{teamId?: string|null, first?: number, after?: string|null}} [options]
 * @returns {Promise<{nodes: Array, pageInfo: Object}>}
 */
export async function issues(apiKey, { teamId = null, first = 50, after = null } = {}) {
  const client = createLinearClient(apiKey)
  const query = teamId ? API_ISSUES_QUERY : API_ISSUES_QUERY_ALL
  const variables = teamId ? { first, after, teamId } : { first, after }
  const data = await client.request(query, variables)
  return {
    nodes: data.issues?.nodes || [],
    pageInfo: data.issues?.pageInfo || {},
  }
}

/**
 * A single issue in the API surface's detail shape (assignee / priority /
 * estimate / dates + nested children, comments, relations), or null when it does
 * not resolve. Mirrors the proxy's ISSUE_DETAIL_QUERY verbatim — deliberately not
 * `fetchIssueContext`, which uses a different field set and transformed shape.
 * Comment sorting and the LIN-401 trashed override stay in the route. (LIN-308)
 * @param {string} apiKey
 * @param {string} issueId - UUID or identifier (e.g. "LIN-123")
 * @returns {Promise<Object|null>}
 */
export async function issueDetail(apiKey, issueId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(API_ISSUE_DETAIL_QUERY, { id: issueId })
  return data.issue || null
}

/**
 * Create an issue. `input` is Linear's IssueCreateInput (teamId + title required).
 * @param {string} apiKey
 * @param {Object} input
 * @returns {Promise<Object>} The issueCreate payload ({ success, issue })
 */
export async function createIssue(apiKey, input) {
  const client = createLinearClient(apiKey)
  const data = await client.request(CREATE_ISSUE_MUTATION, { input })
  return data.issueCreate
}

/**
 * Update an issue. `input` is Linear's IssueUpdateInput.
 * @param {string} apiKey
 * @param {string} issueId
 * @param {Object} input
 * @returns {Promise<Object>} The issueUpdate payload ({ success, issue })
 */
export async function updateIssue(apiKey, issueId, input) {
  const client = createLinearClient(apiKey)
  const data = await client.request(UPDATE_ISSUE_MUTATION, { id: issueId, input })
  return data.issueUpdate
}

/**
 * Add a comment to an issue.
 * @param {string} apiKey
 * @param {string} issueId
 * @param {string} body
 * @returns {Promise<Object>} The commentCreate payload ({ success, comment })
 */
export async function createComment(apiKey, issueId, body) {
  const client = createLinearClient(apiKey)
  const data = await client.request(CREATE_COMMENT_MUTATION, { input: { issueId, body } })
  return data.commentCreate
}

/**
 * Edit an existing comment's body (LIN-307 scope expansion).
 * @param {string} apiKey
 * @param {string} commentId
 * @param {string} body - New body
 * @returns {Promise<Object>} The commentUpdate payload ({ success, comment })
 */
export async function updateComment(apiKey, commentId, body) {
  const client = createLinearClient(apiKey)
  const data = await client.request(UPDATE_COMMENT_MUTATION, { id: commentId, input: { body } })
  return data.commentUpdate
}

/**
 * Delete a comment (LIN-307 scope expansion).
 * @param {string} apiKey
 * @param {string} commentId
 * @returns {Promise<Object>} The commentDelete payload ({ success })
 */
export async function deleteComment(apiKey, commentId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(DELETE_COMMENT_MUTATION, { id: commentId })
  return data.commentDelete
}

/**
 * Create a relation between two issues. `blocked-by` is sugar for an inverse
 * `blocks` (issue IDs swapped) — matching the proxy and the Linear CLI.
 * @param {string} apiKey
 * @param {string} issueId
 * @param {{type: string, relatedIssueId: string}} relation
 * @returns {Promise<Object>} The issueRelationCreate payload
 */
export async function createRelation(apiKey, issueId, { type, relatedIssueId } = {}) {
  const client = createLinearClient(apiKey)
  const input = type === 'blocked-by'
    ? { issueId: relatedIssueId, relatedIssueId: issueId, type: 'blocks' }
    : { issueId, relatedIssueId, type }
  const data = await client.request(CREATE_RELATION_MUTATION, { input })
  return data.issueRelationCreate
}

/**
 * Delete a relation by its own IssueRelation id (exposed on relation nodes).
 * @param {string} apiKey
 * @param {string} relationId
 * @returns {Promise<Object>} The issueRelationDelete payload ({ success })
 */
export async function deleteRelation(apiKey, relationId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(DELETE_RELATION_MUTATION, { id: relationId })
  return data.issueRelationDelete
}

/**
 * Add a label to an issue. Linear has no atomic label add, so this is a
 * read-modify-write of the full label-id set (same race caveat as the proxy).
 * Idempotent: an already-present label is a no-op, returned as
 * `{ success: true, alreadyPresent: true }` without a mutation.
 * @param {string} apiKey
 * @param {string} issueId
 * @param {string} labelId
 * @returns {Promise<Object>} The issueUpdate payload, or the no-op marker
 */
export async function addLabel(apiKey, issueId, labelId) {
  const client = createLinearClient(apiKey)
  const issueData = await client.request(ISSUE_LABELS_QUERY, { issueId })
  if (!issueData.issue) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  const currentLabelIds = (issueData.issue.labels?.nodes || []).map(l => l.id)
  if (currentLabelIds.includes(labelId)) {
    return { success: true, alreadyPresent: true }
  }
  const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
    id: issueId,
    input: { labelIds: [...currentLabelIds, labelId] },
  })
  return data.issueUpdate
}

/**
 * Remove a label from an issue (read-modify-write, same caveat as addLabel).
 * Idempotent: removing an absent label is a no-op, returned as
 * `{ success: true, notPresent: true }` without a mutation.
 * @param {string} apiKey
 * @param {string} issueId
 * @param {string} labelId
 * @returns {Promise<Object>} The issueUpdate payload, or the no-op marker
 */
export async function removeLabel(apiKey, issueId, labelId) {
  const client = createLinearClient(apiKey)
  const issueData = await client.request(ISSUE_LABELS_QUERY, { issueId })
  if (!issueData.issue) {
    throw new Error(`Issue not found: ${issueId}`)
  }
  const currentLabelIds = (issueData.issue.labels?.nodes || []).map(l => l.id)
  const filtered = currentLabelIds.filter(id => id !== labelId)
  if (filtered.length === currentLabelIds.length) {
    return { success: true, notPresent: true }
  }
  const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
    id: issueId,
    input: { labelIds: filtered },
  })
  return data.issueUpdate
}

// ---------------------------------------------------------------------------
// Write-path guard reads + the label read-modify-write primitive (LIN-309).
//
// These mirror the proxy route's exact write-guard selections, relocated here
// so the consumer-API write endpoints own no GraphQL. Like the LIN-308 api-read
// helpers (viewer/projects/issues/issueDetail), they are deliberately kept OFF
// the declared PROVIDER_SURFACE: they are route-internal data-fetch the proxy
// orchestrates (404/409/dedupe/flatten stay in the route), not first-class
// capabilities, so the capability descriptor and non-Linear providers are
// undisturbed. Each returns the raw `issue` (or null) / mutation payload so the
// route keeps its existing post-processing verbatim.
// ---------------------------------------------------------------------------

/**
 * Trashed-only probe (`{ id, trashed }` or null) for write handlers that do not
 * otherwise read the issue. Null means Linear could not resolve the id.
 * @param {string} apiKey
 * @param {string} issueId
 * @returns {Promise<Object|null>}
 */
export async function issueWriteGuard(apiKey, issueId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(TRASHED_GUARD_QUERY, { id: issueId })
  return data.issue || null
}

/**
 * Lightweight description read (`{ id, description, trashed }` or null) for the
 * description append/replace read-modify-write.
 * @param {string} apiKey
 * @param {string} issueId
 * @returns {Promise<Object|null>}
 */
export async function issueDescription(apiKey, issueId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(ISSUE_DESCRIPTION_QUERY, { id: issueId })
  return data.issue || null
}

/**
 * Read the issue's current label set + trashed flag (`{ id, trashed, labels }`
 * or null) for the label add/remove read-modify-write.
 * @param {string} apiKey
 * @param {string} issueId
 * @returns {Promise<Object|null>}
 */
export async function issueLabels(apiKey, issueId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(ISSUE_LABELS_QUERY, { issueId })
  return data.issue || null
}

/**
 * Write a full label-id set onto an issue (the second half of the label RMW the
 * proxy orchestrates). Returns the issueUpdate payload.
 * @param {string} apiKey
 * @param {string} issueId
 * @param {string[]} labelIds
 * @returns {Promise<Object>}
 */
export async function updateIssueLabels(apiKey, issueId, labelIds) {
  const client = createLinearClient(apiKey)
  const data = await client.request(UPDATE_ISSUE_LABELS_MUTATION, {
    id: issueId,
    input: { labelIds },
  })
  return data.issueUpdate
}

/**
 * The Linear provider. Wraps the module-level fetchers above so the registry
 * and interface see a capability-gated object. Reads are wired this phase;
 * declared writes and headroom reads inherit the base's NotImplemented decline.
 *
 * `getAuthRouter()` is intentionally NOT overridden this phase — the Linear auth
 * wiring (routes/auth.js) lands in LIN-331 (Subtask 2).
 */
export class LinearProvider extends ProviderInterface {
  constructor() {
    super()
    this.name = 'linear'
  }

  fetchProjects(apiKey, teamId = null, opts) { return fetchProjects(apiKey, teamId, opts) }
  fetchProjectsList(apiKey) { return fetchProjectsList(apiKey) }
  fetchTeams(apiKey) { return fetchTeams(apiKey) }
  fetchOrganization(apiKey) { return fetchOrganization(apiKey) }
  fetchViewer(apiKey) { return fetchViewer(apiKey) }
  fetchIssueContext(apiKey, issueId, opts) { return fetchIssueContext(apiKey, issueId, opts) }
  fetchIssueComments(apiKey, issueId) { return fetchIssueComments(apiKey, issueId) }
  fetchIssueFields(apiKey, issueId, opts) { return fetchIssueFields(apiKey, issueId, opts) }
  fetchFocusedChild(apiKey, issueId, opts) { return fetchFocusedChild(apiKey, issueId, opts) }
  fetchRecommendationContext(apiKey, issueId, opts) { return fetchRecommendationContext(apiKey, issueId, opts) }

  // API-surface reads + writes (LIN-307). Delegate to the module-level
  // functions above, mirroring the dashboard-read pattern. Declared on the
  // interface as headroom/first-class writes since LIN-176; wired here.
  search(apiKey, query, opts) { return search(apiKey, query, opts) }
  states(apiKey, teamId) { return states(apiKey, teamId) }
  labels(apiKey, teamId = null) { return labels(apiKey, teamId) }
  cycles(apiKey, teamId = null) { return cycles(apiKey, teamId) }
  cycleDetail(apiKey, cycleId) { return cycleDetail(apiKey, cycleId) }
  relations(apiKey, issueId) { return relations(apiKey, issueId) }

  // API-surface issue reads relocated from the proxy route (LIN-308). Kept off
  // the declared PROVIDER_SURFACE so the capability descriptor (and non-Linear
  // providers) are undisturbed; the proxy consumes these as module functions.
  viewer(apiKey) { return viewer(apiKey) }
  projects(apiKey) { return projects(apiKey) }
  issues(apiKey, opts) { return issues(apiKey, opts) }
  issueDetail(apiKey, issueId) { return issueDetail(apiKey, issueId) }

  // Write-path guard reads + label RMW primitive (LIN-309). Off the declared
  // surface, like the api reads above — route-internal data-fetch, not a
  // capability.
  issueWriteGuard(apiKey, issueId) { return issueWriteGuard(apiKey, issueId) }
  issueDescription(apiKey, issueId) { return issueDescription(apiKey, issueId) }
  issueLabels(apiKey, issueId) { return issueLabels(apiKey, issueId) }
  updateIssueLabels(apiKey, issueId, labelIds) { return updateIssueLabels(apiKey, issueId, labelIds) }

  createIssue(apiKey, input) { return createIssue(apiKey, input) }
  updateIssue(apiKey, issueId, input) { return updateIssue(apiKey, issueId, input) }
  createComment(apiKey, issueId, body) { return createComment(apiKey, issueId, body) }
  updateComment(apiKey, commentId, body) { return updateComment(apiKey, commentId, body) }
  deleteComment(apiKey, commentId) { return deleteComment(apiKey, commentId) }
  createRelation(apiKey, issueId, opts) { return createRelation(apiKey, issueId, opts) }
  deleteRelation(apiKey, relationId) { return deleteRelation(apiKey, relationId) }
  addLabel(apiKey, issueId, labelId) { return addLabel(apiKey, issueId, labelId) }
  removeLabel(apiKey, issueId, labelId) { return removeLabel(apiKey, issueId, labelId) }

  /**
   * The Linear OAuth router (LIN-331). Folds routes/auth.js behind the provider:
   * server.js mounts `provider.getAuthRouter(...)` instead of importing
   * createAuthRoutes directly. Single-provider semantics this phase; non-Linear
   * auth is deferred.
   * @param {{sessionStore: Object, userPreferencesStore: Object}} opts
   * @returns {import('express').Router}
   */
  getAuthRouter(opts) { return createAuthRoutes({ ...opts, provider: this }) }

  /**
   * Build Linear's OAuth authorization redirect URL (LIN-562). The `state` is an
   * opaque CSRF nonce minted and stored in session by the auth route; intent
   * (new vs add-source) stays server-side, NOT encoded here. Byte-identical to
   * the params the `/auth/linear` route previously inlined.
   * @param {{ state: string }} args
   * @returns {string} The `https://linear.app/oauth/authorize?...` URL.
   */
  beginAuth({ state }) {
    const params = new URLSearchParams({
      client_id: process.env.LINEAR_CLIENT_ID,
      redirect_uri: process.env.LINEAR_REDIRECT_URI,
      response_type: 'code',
      scope: 'read,write',
      state,
      prompt: 'consent',
    })
    return `https://linear.app/oauth/authorize?${params}`
  }

  /**
   * Exchange an OAuth authorization code for Linear credentials (LIN-562). This
   * is the token exchange the `/auth/callback` route previously inlined, moved
   * behind the provider so the callback is provider-agnostic. Byte-identical
   * request; throws {@link AuthExchangeError} on a non-2xx response so the
   * shared callback renders the same 400 "Authentication Failed" page as before.
   * @param {string} code - The authorization code from the OAuth redirect.
   * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}>}
   */
  async completeAuth(code) {
    const response = await fetch('https://api.linear.app/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.LINEAR_CLIENT_ID,
        client_secret: process.env.LINEAR_CLIENT_SECRET,
        redirect_uri: process.env.LINEAR_REDIRECT_URI,
        code,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new AuthExchangeError(data.error, this.name)
    return data
  }

  /**
   * Build the Linear deep link for creating a task in a project.
   * Byte-identical to the URL render.js previously inlined.
   * @param {string} urlKey - Workspace urlKey
   * @param {string} projectId - Project id
   * @returns {string}
   */
  getCreateTaskUrl(urlKey, projectId) {
    return `https://linear.app/${encodeURIComponent(urlKey)}/new?project=${encodeURIComponent(projectId)}`
  }

  /**
   * UI/prompt capability surface (LIN-332). Overrides only the abstract bits:
   * `write`/`comments` auto-derive from the base getter (Linear overrides
   * getCreateTaskUrl and implements fetchIssueComments), so only `estimates`
   * (the `estimate` field is in ISSUE_FIELDS_FRAGMENT), `subtasks` (children/
   * parent are fetched), and the human `displayName` are set here. `displayName`
   * ('Linear') is intentionally distinct from the machine `name` ('linear').
   * @returns {{write: boolean, comments: boolean, estimates: boolean, subtasks: boolean, displayName: string}}
   */
  get ui() {
    return { ...super.ui, estimates: true, subtasks: true, displayName: 'Linear' }
  }
}

/** Singleton Linear provider instance. */
export const linearProvider = new LinearProvider()

// Module-load self-registration (see registry.js header for the lifecycle
// rationale). Importing this module — which the lib/linear.js shim does — is
// what populates the registry; there is no explicit startup registration.
registerProvider(linearProvider)
