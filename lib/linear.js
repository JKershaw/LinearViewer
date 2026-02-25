/**
 * Linear API client for fetching projects and issues via GraphQL.
 * Uses OAuth access tokens for authentication.
 */
import { GraphQLClient, gql } from 'graphql-request'

const LINEAR_API_ENDPOINT = 'https://api.linear.app/graphql'

/**
 * State type ordering for sorting issues by relevance.
 * In-progress items first, then todo, then completed/canceled.
 */
const STATE_ORDER = { started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 4 }

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
    project { id }
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
export async function fetchProjects(apiKey, teamId = null) {
  const client = createLinearClient(apiKey)

  // Fetch projects (single request)
  const projectsData = await client.request(PROJECTS_QUERY)

  // Fetch all issues using cursor-based pagination.
  // Linear's API limits each request to 250 items max, so we loop until exhausted.
  // Use filtered query if teamId provided, otherwise fetch all issues.
  let allIssues = []
  let hasNextPage = true
  let cursor = null
  const query = teamId ? ISSUES_QUERY : ISSUES_QUERY_ALL

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
 * Fetches a single issue with context for prompt generation.
 * Returns the issue details plus parent, sibling, project, children, and comments.
 *
 * @param {string} apiKey - OAuth access token
 * @param {string} issueId - The issue ID to fetch
 * @returns {Promise<Object>} Context object with:
 *   - issue: The issue with id, identifier, title, description, state, url, labels
 *   - parent: Parent issue details or null if top-level
 *   - siblings: Up to 5 most relevant sibling issues (prioritizing in-progress and todo)
 *   - project: Project name and description or null
 *   - children: Array of existing child issues
 *   - comments: Array of comments with body, createdAt, and user name
 * @throws {Error} If the API request fails or issue not found
 */
export async function fetchIssueContext(apiKey, issueId) {
  const client = createLinearClient(apiKey)
  const data = await client.request(ISSUE_DETAIL_QUERY, { id: issueId })

  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`)
  }

  const issue = data.issue
  const parent = issue.parent || null

  // Get siblings (other children of the same parent), excluding this issue
  let siblings = []
  if (parent?.children?.nodes) {
    const allSiblings = parent.children.nodes.filter(child => child.id !== issueId)

    // Sort siblings by relevance: in-progress first, then todo, then completed
    allSiblings.sort((a, b) => {
      const aOrder = STATE_ORDER[a.state?.type] ?? 2
      const bOrder = STATE_ORDER[b.state?.type] ?? 2
      return aOrder - bOrder
    })

    // Take top 5 most relevant
    siblings = allSiblings.slice(0, 5)
  }

  // Extract label names
  const labels = (issue.labels?.nodes || []).map(l => l.name)

  // Get existing children and sort by relevance (same as siblings)
  const children = [...(issue.children?.nodes || [])]
  children.sort((a, b) => {
    const aOrder = STATE_ORDER[a.state?.type] ?? 2
    const bOrder = STATE_ORDER[b.state?.type] ?? 2
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
    project: issue.project ? {
      name: issue.project.name,
      description: issue.project.content
    } : null,
    children,
    comments
  }
}

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
 * Check if an issue is blocked (by label or by blocking relation).
 * An issue is blocked if:
 * - It has the 'blocked' label, OR
 * - It has an inverse 'blocks' relation from an incomplete issue
 *
 * @param {Object} issue - Issue object with labels and inverseRelations
 * @returns {boolean} True if the issue is blocked
 */
export function isBlocked(issue) {
  // Check for 'blocked' label
  const hasBlockedLabel = Array.isArray(issue.labels?.nodes) &&
    issue.labels.nodes.some(l => l.name?.toLowerCase() === 'blocked')
  if (hasBlockedLabel) return true

  // Check for blocking relations (inverse 'blocks' from incomplete issues)
  const hasBlockingRelation = Array.isArray(issue.inverseRelations?.nodes) &&
    issue.inverseRelations.nodes.some(r =>
      r.type === 'blocks' &&
      r.issue?.state?.type !== 'completed' &&
      r.issue?.state?.type !== 'canceled'
    )
  return hasBlockingRelation
}

/**
 * Select the next subtask to focus on for AI recommendations.
 * Priority: in-progress > first non-blocked todo > first incomplete
 *
 * @param {Array} children - Array of child issues
 * @returns {Object|null} The selected focus subtask or null if none available
 */
export function selectFocusSubtask(children) {
  if (!children?.length) return null

  // 1. Continue in-progress work
  const inProgress = children.find(c => c.state?.type === 'started')
  if (inProgress) return inProgress

  // 2. First non-blocked todo (check both labels and relations)
  const nextTodo = children.find(c =>
    (c.state?.type === 'unstarted' || c.state?.type === 'backlog') &&
    !isBlocked(c)
  )
  if (nextTodo) return nextTodo

  // 3. Fall back to first incomplete
  return children.find(c =>
    c.state?.type !== 'completed' && c.state?.type !== 'canceled'
  )
}

/**
 * Fetch issue context optimized for AI recommendations.
 * For parent tasks with children, also fetches focused subtask details.
 *
 * @param {string} apiKey - OAuth access token
 * @param {string} issueId - The issue ID to fetch
 * @returns {Promise<Object>} Context object with optional focusedChild for parent tasks
 */
export async function fetchRecommendationContext(apiKey, issueId) {
  const context = await fetchIssueContext(apiKey, issueId)

  // Leaf task - return as-is
  if (!context.children?.length) {
    return context
  }

  // Parent task - select and fetch focused subtask
  const focusChild = selectFocusSubtask(context.children)
  if (!focusChild) {
    return context  // All children complete
  }

  const focusedChildContext = await fetchIssueContext(apiKey, focusChild.id)
  return {
    ...context,
    focusedChild: focusedChildContext
  }
}
