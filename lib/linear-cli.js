#!/usr/bin/env node
/**
 * Linear CLI for AI agents - read and write operations.
 * Uses LINEAR_API_KEY environment variable for authentication.
 * Supports HTTP_PROXY/HTTPS_PROXY environment variables for proxied environments.
 *
 * Read commands:
 *   node lib/linear-cli.js viewer          # Get current user info
 *   node lib/linear-cli.js teams           # List all teams
 *   node lib/linear-cli.js projects        # List active projects
 *   node lib/linear-cli.js issues [teamId] # List issues (optionally by team)
 *   node lib/linear-cli.js issue <id>      # Get issue details with context
 *   node lib/linear-cli.js search "query"  # Search issues
 *   node lib/linear-cli.js states <teamId> # List workflow states for a team
 *
 * Write commands:
 *   node lib/linear-cli.js create-issue <teamId> <title> [json-options]
 *   node lib/linear-cli.js update-issue <issueId> <json-updates>
 *   node lib/linear-cli.js comment <issueId> <body>
 */
import { GraphQLClient, gql } from 'graphql-request';

const API_KEY = process.env.LINEAR_API_KEY;

if (!API_KEY) {
  console.error('Error: LINEAR_API_KEY environment variable is not set');
  console.error('Get your API key from: https://linear.app/settings/api');
  process.exit(1);
}

const command = process.argv[2];
const arg = process.argv[3];
const arg2 = process.argv[4];
const arg3 = process.argv[5];

// Configure proxy-aware fetch if proxy is available
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
let customFetch = fetch;

if (proxyUrl) {
  // Use undici for proper proxy support with DNS resolution through proxy
  const { ProxyAgent, fetch: undiciFetch } = await import('undici');
  const dispatcher = new ProxyAgent({
    uri: proxyUrl,
    requestTls: { rejectUnauthorized: false }, // Required for some proxy environments
  });
  customFetch = (url, options = {}) => undiciFetch(url, { ...options, dispatcher });
}

const client = new GraphQLClient('https://api.linear.app/graphql', {
  headers: { Authorization: API_KEY },
  fetch: customFetch,
});

async function getViewer() {
  const data = await client.request(gql`{ viewer { id name email } }`);
  return data.viewer;
}

async function fetchOrganization() {
  const data = await client.request(gql`
    query {
      organization {
        id
        name
        urlKey
      }
    }
  `);
  return data.organization;
}

async function fetchTeams() {
  const data = await client.request(gql`
    query {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `);
  return data.teams?.nodes || [];
}

async function fetchProjects(teamId = null) {
  // Fetch projects
  const projectsData = await client.request(gql`
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
  `);

  // Fetch issues with pagination
  const issueFields = `
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
    state { name type }
    assignee { name }
    labels { nodes { name } }
  `;

  let allIssues = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = teamId
      ? gql`query($first: Int!, $after: String, $teamId: ID) {
          issues(first: $first, after: $after, filter: { team: { id: { eq: $teamId } } }) {
            nodes { ${issueFields} }
            pageInfo { hasNextPage endCursor }
          }
        }`
      : gql`query($first: Int!, $after: String) {
          issues(first: $first, after: $after) {
            nodes { ${issueFields} }
            pageInfo { hasNextPage endCursor }
          }
        }`;

    const variables = teamId
      ? { first: 250, after: cursor, teamId }
      : { first: 250, after: cursor };

    const data = await client.request(query, variables);
    allIssues.push(...data.issues.nodes);
    hasNextPage = data.issues.pageInfo.hasNextPage;
    cursor = data.issues.pageInfo.endCursor;
  }

  return {
    organizationName: projectsData.organization.name,
    projects: projectsData.projects.nodes,
    issues: allIssues,
  };
}

async function fetchIssueContext(issueId) {
  const data = await client.request(gql`
    query($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        url
        state { name type }
        project { id name description }
        labels { nodes { name } }
        children {
          nodes {
            id
            identifier
            title
            state { name type }
          }
        }
        parent {
          id
          identifier
          title
          state { name type }
          children {
            nodes {
              id
              identifier
              title
              state { name type }
            }
          }
        }
      }
    }
  `, { id: issueId });

  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  const issue = data.issue;
  const parent = issue.parent || null;

  // Get siblings
  let siblings = [];
  if (parent?.children?.nodes) {
    const stateOrder = { started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 4 };
    siblings = parent.children.nodes
      .filter(child => child.id !== issueId)
      .sort((a, b) => (stateOrder[a.state?.type] ?? 2) - (stateOrder[b.state?.type] ?? 2))
      .slice(0, 5);
  }

  return {
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      url: issue.url,
      state: issue.state,
      labels: (issue.labels?.nodes || []).map(l => l.name)
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
      description: issue.project.description
    } : null,
    children: issue.children?.nodes || []
  };
}

async function searchIssues(term) {
  const data = await client.request(gql`
    query($term: String!) {
      searchIssues(term: $term, first: 20) {
        nodes {
          id
          identifier
          title
          state { name type }
          assignee { name }
          project { name }
        }
      }
    }
  `, { term });
  return data.searchIssues.nodes;
}

async function getWorkflowStates(teamId) {
  const data = await client.request(gql`
    query($teamId: String!) {
      team(id: $teamId) {
        states {
          nodes {
            id
            name
            type
            position
          }
        }
      }
    }
  `, { teamId });
  return data.team?.states?.nodes || [];
}

async function createIssue(teamId, title, options = {}) {
  const input = {
    teamId,
    title,
    ...options,
  };
  const data = await client.request(gql`
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
          state { name }
        }
      }
    }
  `, { input });
  return data.issueCreate;
}

async function updateIssue(issueId, updates) {
  const data = await client.request(gql`
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          title
          url
          state { name }
          assignee { name }
        }
      }
    }
  `, { id: issueId, input: updates });
  return data.issueUpdate;
}

async function addComment(issueId, body) {
  const data = await client.request(gql`
    mutation($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
          body
          createdAt
          user { name }
        }
      }
    }
  `, { input: { issueId, body } });
  return data.commentCreate;
}

async function main() {
  try {
    switch (command) {
      case 'viewer':
      case 'me': {
        const viewer = await getViewer();
        console.log(JSON.stringify(viewer, null, 2));
        break;
      }

      case 'org':
      case 'organization': {
        const org = await fetchOrganization();
        console.log(JSON.stringify(org, null, 2));
        break;
      }

      case 'teams': {
        const teams = await fetchTeams();
        console.log(JSON.stringify(teams, null, 2));
        break;
      }

      case 'projects': {
        const { organizationName, projects } = await fetchProjects();
        console.log(JSON.stringify({ organizationName, projects }, null, 2));
        break;
      }

      case 'issues': {
        const teamId = arg || null;
        const { issues } = await fetchProjects(teamId);
        // Return condensed issue list
        const condensed = issues.map(i => ({
          id: i.id,
          title: i.title,
          state: i.state?.name,
          stateType: i.state?.type,
          assignee: i.assignee?.name,
          project: i.project?.id,
        }));
        console.log(JSON.stringify(condensed, null, 2));
        break;
      }

      case 'issue': {
        if (!arg) {
          console.error('Error: Issue ID required');
          console.error('Usage: node lib/linear-cli.js issue <id>');
          process.exit(1);
        }
        const context = await fetchIssueContext(arg);
        console.log(JSON.stringify(context, null, 2));
        break;
      }

      case 'search': {
        if (!arg) {
          console.error('Error: Search query required');
          console.error('Usage: node lib/linear-cli.js search "query"');
          process.exit(1);
        }
        const results = await searchIssues(arg);
        console.log(JSON.stringify(results, null, 2));
        break;
      }

      case 'states': {
        if (!arg) {
          console.error('Error: Team ID required');
          console.error('Usage: node lib/linear-cli.js states <teamId>');
          process.exit(1);
        }
        const states = await getWorkflowStates(arg);
        console.log(JSON.stringify(states, null, 2));
        break;
      }

      case 'create-issue': {
        if (!arg || !arg2) {
          console.error('Error: Team ID and title required');
          console.error('Usage: node lib/linear-cli.js create-issue <teamId> <title> [json-options]');
          console.error('Options: {"description": "...", "projectId": "...", "parentId": "...", "stateId": "..."}');
          process.exit(1);
        }
        const options = arg3 ? JSON.parse(arg3) : {};
        const created = await createIssue(arg, arg2, options);
        console.log(JSON.stringify(created, null, 2));
        break;
      }

      case 'update-issue': {
        if (!arg || !arg2) {
          console.error('Error: Issue ID and updates required');
          console.error('Usage: node lib/linear-cli.js update-issue <issueId> <json-updates>');
          console.error('Updates: {"title": "...", "description": "...", "stateId": "...", "assigneeId": "..."}');
          process.exit(1);
        }
        const updates = JSON.parse(arg2);
        const updated = await updateIssue(arg, updates);
        console.log(JSON.stringify(updated, null, 2));
        break;
      }

      case 'comment': {
        if (!arg || !arg2) {
          console.error('Error: Issue ID and comment body required');
          console.error('Usage: node lib/linear-cli.js comment <issueId> "comment body"');
          process.exit(1);
        }
        const commented = await addComment(arg, arg2);
        console.log(JSON.stringify(commented, null, 2));
        break;
      }

      default:
        console.log(`Linear CLI - Read and write Linear data from the command line

Usage: node lib/linear-cli.js <command> [args]

Read Commands:
  viewer, me          Get current user info
  org, organization   Get organization info
  teams               List all teams
  projects            List active projects
  issues [teamId]     List all issues (optionally filter by team)
  issue <id>          Get issue details with full context
  search "query"      Search issues
  states <teamId>     List workflow states for a team

Write Commands:
  create-issue <teamId> <title> [json-options]
                      Create a new issue
  update-issue <issueId> <json-updates>
                      Update an existing issue
  comment <issueId> "body"
                      Add a comment to an issue

Environment:
  LINEAR_API_KEY      Your Linear API key (required)
                      Get it from: https://linear.app/settings/api

Examples:
  # Read operations
  node lib/linear-cli.js viewer
  node lib/linear-cli.js projects
  node lib/linear-cli.js issue abc123
  node lib/linear-cli.js search "bug in auth"
  node lib/linear-cli.js states team_abc123

  # Write operations
  node lib/linear-cli.js create-issue team_id "Fix login bug"
  node lib/linear-cli.js create-issue team_id "Add feature" '{"description":"Details here","projectId":"proj_123"}'
  node lib/linear-cli.js update-issue issue_id '{"stateId":"state_done"}'
  node lib/linear-cli.js comment issue_id "This is fixed in PR #42"
`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
