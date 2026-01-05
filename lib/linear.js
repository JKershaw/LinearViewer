/**
 * Linear API client for fetching projects and issues via GraphQL.
 * Uses OAuth access tokens for authentication.
 */
import { GraphQLClient, gql } from 'graphql-request'

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
 * GraphQL query to fetch issues with pagination support.
 * Retrieves all fields needed for tree display: hierarchy (parent), project association,
 * state info, assignee, labels, and metadata (dates, estimates, priority).
 * Uses cursor-based pagination to handle workspaces with many issues.
 */
const ISSUES_QUERY = gql`
  query($first: Int!, $after: String) {
    issues(first: $first, after: $after) {
      nodes {
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
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

/**
 * Fetches all projects and issues from Linear for the authenticated user's organization.
 *
 * @param {string} apiKey - OAuth access token (passed as 'Bearer {token}' or raw token)
 * @returns {Promise<{organizationName: string, projects: Array, issues: Array}>}
 *   - organizationName: The Linear workspace/organization name
 *   - projects: Array of active ("started") projects with id, name, content, url, sortOrder
 *   - issues: Array of all issues with full metadata for tree building
 * @throws {Error} If the API request fails (e.g., 401 for invalid/expired token)
 */
export async function fetchProjects(apiKey) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: {
      Authorization: apiKey,
    },
  })

  // Fetch projects (single request)
  const projectsData = await client.request(PROJECTS_QUERY)

  // Fetch all issues using cursor-based pagination.
  // Linear's API limits each request to 250 items max, so we loop until exhausted.
  let allIssues = []
  let hasNextPage = true
  let cursor = null

  while (hasNextPage) {
    const data = await client.request(ISSUES_QUERY, { first: 250, after: cursor })
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
