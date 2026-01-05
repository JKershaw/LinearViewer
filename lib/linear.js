import { GraphQLClient, gql } from 'graphql-request'

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

export async function fetchProjects(apiKey) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: {
      Authorization: apiKey,
    },
  })

  // Fetch projects (single request)
  const projectsData = await client.request(PROJECTS_QUERY)

  // Fetch all issues with pagination
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
