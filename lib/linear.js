import { GraphQLClient, gql } from 'graphql-request'

const QUERY = gql`
  query {
    projects(filter: { state: { eq: "started" } }) {
      nodes {
        id
        name
        description
        sortOrder
      }
    }
    issues {
      nodes {
        id
        title
        description
        estimate
        priority
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
    }
  }
`

export async function fetchRoadmap(apiKey) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: {
      Authorization: apiKey,
    },
  })

  const data = await client.request(QUERY)

  return {
    projects: data.projects.nodes,
    issues: data.issues.nodes,
  }
}
