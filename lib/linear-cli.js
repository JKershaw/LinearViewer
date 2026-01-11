#!/usr/bin/env node
/**
 * Simple Linear CLI for use with AI agents.
 * Uses LINEAR_API_KEY environment variable for authentication.
 *
 * Usage:
 *   node lib/linear-cli.js viewer          # Get current user info
 *   node lib/linear-cli.js teams           # List all teams
 *   node lib/linear-cli.js projects        # List active projects
 *   node lib/linear-cli.js issues [teamId] # List issues (optionally by team)
 *   node lib/linear-cli.js issue <id>      # Get issue details with context
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

async function getViewer() {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: API_KEY },
  });
  const data = await client.request(gql`{ viewer { id name email } }`);
  return data.viewer;
}

async function searchIssues(query) {
  const client = new GraphQLClient('https://api.linear.app/graphql', {
    headers: { Authorization: API_KEY },
  });
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

      default:
        console.log(`Linear CLI - Query Linear from the command line

Usage: node lib/linear-cli.js <command> [args]

Commands:
  viewer, me          Get current user info
  org, organization   Get organization info
  teams               List all teams
  projects            List active projects
  issues [teamId]     List all issues (optionally filter by team)
  issue <id>          Get issue details with full context
  search "query"      Search issues

Environment:
  LINEAR_API_KEY      Your Linear API key (required)
                      Get it from: https://linear.app/settings/api

Examples:
  node lib/linear-cli.js viewer
  node lib/linear-cli.js projects
  node lib/linear-cli.js issue abc123
  node lib/linear-cli.js search "bug in auth"
`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
