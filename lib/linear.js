/**
 * Linear API client for fetching projects and issues via GraphQL.
 * Uses OAuth access tokens for authentication.
 */
import { GraphQLClient, gql } from 'graphql-request'

/**
 * GraphQL fragment containing all issue fields needed for tree display.
 * Shared between filtered and unfiltered issue queries.
 */
const ISSUE_FIELDS_FRAGMENT = gql`
  fragment IssueFields on Issue {
    id
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
 * Fetches all teams from Linear for the authenticated user's organization.
 *
 * @param {string} apiKey - OAuth access token (passed as 'Bearer {token}' or raw token)
 * @returns {Promise<Array>} Array of teams with id, name, key
 * @throws {Error} If the API request fails (e.g., 401 for invalid/expired token)
 */
export async function fetchTeams(apiKey) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: {
      Authorization: apiKey,
    },
  })

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
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: {
      Authorization: apiKey,
    },
  })

  const data = await client.request(ORGANIZATION_QUERY)
  return data.organization
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
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: {
      Authorization: apiKey,
    },
  })

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
