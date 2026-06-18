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
import { getStateOrder } from '../state-map.js'
import { selectFocusSubtask } from '../../tree.js'
import { COUSIN_CAP, SIBLING_CAP } from '../../openrouter.js'
import { ProviderInterface } from '../interface.js'
import { registerProvider } from '../registry.js'
import { createAuthRoutes } from '../../../routes/auth.js'
import { classifyUpstreamError } from '../../errors.js'
import { outcomeForStatus } from '../../linear-call-log.js'

const LINEAR_API_ENDPOINT = 'https://api.linear.app/graphql'

// Linear call recorder hook (LIN-538). Set once at startup via
// setLinearCallRecorder so this module stays free of any store dependency
// (mirrors openrouter.js's LLM-call recorder). Each outbound GraphQL request is
// recorded with its outcome, making Linear request volume and failure rate
// visible on /kpis — the surface that stayed up during the "Premature close"
// incident while every Linear call failed.
let _linearCallRecorder = null;

/**
 * Register the per-call recorder. Pass a function (call) => void|Promise, or null
 * to disable. Recording is fire-and-forget; a throw here never affects a fetch.
 * @param {Function|null} fn
 */
export function setLinearCallRecorder(fn) {
  _linearCallRecorder = typeof fn === 'function' ? fn : null;
}

function recordLinearCall(call) {
  if (!_linearCallRecorder) return;
  try {
    const result = _linearCallRecorder(call);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch { /* fire-and-forget */ }
}

/**
 * Wraps the global fetch to record every Linear request's outcome (LIN-538).
 * A resolved response is bucketed by HTTP status; a rejection (the undici
 * "Premature close" failure mode) is classified as upstream/auth/internal via
 * the shared classifier. The response/error is passed through untouched — this
 * is observability only, never behaviour.
 */
async function countingFetch(url, init) {
  const start = Date.now();
  try {
    const res = await fetch(url, init);
    recordLinearCall({ outcome: outcomeForStatus(res.status), status: res.status, durationMs: Date.now() - start });
    return res;
  } catch (err) {
    recordLinearCall({ outcome: classifyUpstreamError(err).category, status: null, durationMs: Date.now() - start });
    throw err;
  }
}

// State ordering for sorting issues by relevance now comes from the canonical
// state-map (LIN-174 Phase 1). Linear's GraphQL response is already canonical
// shape `{ name, type }`, so no normalization is needed at this boundary.

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
    // Route through countingFetch so every Linear request is logged (LIN-538).
    fetch: countingFetch,
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
    issues: allIssues,
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
  return data.issue
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

  /**
   * The Linear OAuth router (LIN-331). Folds routes/auth.js behind the provider:
   * server.js mounts `provider.getAuthRouter(...)` instead of importing
   * createAuthRoutes directly. Single-provider semantics this phase; non-Linear
   * auth is deferred.
   * @param {{sessionStore: Object, userPreferencesStore: Object}} opts
   * @returns {import('express').Router}
   */
  getAuthRouter(opts) { return createAuthRoutes(opts) }

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
