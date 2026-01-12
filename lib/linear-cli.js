#!/usr/bin/env node
/**
 * Linear CLI for AI agents - read and write operations.
 * Uses LINEAR_API_KEY environment variable for authentication.
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
import { fetchTeams, fetchProjects, fetchIssueContext, fetchOrganization } from './linear.js';
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

const client = new GraphQLClient('https://api.linear.app/graphql', {
  headers: { Authorization: API_KEY },
});

async function getViewer() {
  const data = await client.request(gql`{ viewer { id name email } }`);
  return data.viewer;
}

async function searchIssues(query) {
  const data = await client.request(gql`
    query($query: String!) {
      searchIssues(query: $query, first: 20) {
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
  `, { query });
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
        const org = await fetchOrganization(API_KEY);
        console.log(JSON.stringify(org, null, 2));
        break;
      }

      case 'teams': {
        const teams = await fetchTeams(API_KEY);
        console.log(JSON.stringify(teams, null, 2));
        break;
      }

      case 'projects': {
        const { organizationName, projects } = await fetchProjects(API_KEY);
        console.log(JSON.stringify({ organizationName, projects }, null, 2));
        break;
      }

      case 'issues': {
        const teamId = arg || null;
        const { issues } = await fetchProjects(API_KEY, teamId);
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
        const context = await fetchIssueContext(API_KEY, arg);
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
