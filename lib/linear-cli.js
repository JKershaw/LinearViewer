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
import https from 'https';

const API_KEY = process.env.LINEAR_API_KEY;

if (!API_KEY) {
  console.error('Error: LINEAR_API_KEY environment variable is not set');
  console.error('Get your API key from: https://linear.app/settings/api');
  process.exit(1);
}

// Parse arguments, extracting --stdin flag
const rawArgs = process.argv.slice(2);
const useStdin = rawArgs.includes('--stdin');
const args = rawArgs.filter(a => a !== '--stdin');

const command = args[0];
const arg = args[1];
const arg2 = args[2];
const arg3 = args[3];

// Configure proxy-aware fetch if proxy is available
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
let customFetch = fetch;

// Retry configuration for transient proxy/TLS errors
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

/**
 * Check if an error is retryable (transient TLS/connection issues through proxy)
 */
function isRetryableError(error) {
  const message = error.message || '';
  return message.includes('TLS') ||
         message.includes('CERTIFICATE_VERIFY_FAILED') ||
         message.includes('ECONNRESET') ||
         message.includes('ETIMEDOUT') ||
         message.includes('socket hang up');
}

/**
 * Sleep for the specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read all data from stdin asynchronously
 * @returns {Promise<string>} The stdin content as a string
 */
async function readStdin() {
  if (process.stdin.isTTY) {
    throw new Error('--stdin flag requires piped input (e.g., echo \'{"key":"value"}\' | command --stdin)');
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const content = Buffer.concat(chunks).toString('utf8').trim();

  return content || '{}';
}

if (proxyUrl) {
  // Use https-proxy-agent for reliable proxy support
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const agent = new HttpsProxyAgent(proxyUrl);

  // Single request attempt using Node's https module with the proxy agent
  const singleFetch = (url, options = {}) => {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const postData = options.body || '';

      const reqOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        agent: agent,
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // Create a Headers-like object for graphql-request compatibility
          const headers = new Map(Object.entries(res.headers));
          headers.forEach = (callback) => {
            for (const [key, value] of headers) {
              callback(value, key);
            }
          };
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers,
            json: () => Promise.resolve(JSON.parse(data)),
            text: () => Promise.resolve(data)
          });
        });
      });

      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  };

  // Wrap with retry logic for transient proxy/TLS errors
  customFetch = async (url, options = {}) => {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await singleFetch(url, options);

        // Check for 503 responses that contain TLS errors (proxy returns these as HTTP responses)
        if (response.status === 503) {
          const body = await response.text();
          if (body.includes('TLS') || body.includes('CERTIFICATE_VERIFY_FAILED')) {
            if (attempt < MAX_RETRIES) {
              const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
              await sleep(delay);
              continue;
            }
            // Return a failed response on final attempt
            return {
              ok: false,
              status: 503,
              headers: response.headers,
              json: () => Promise.resolve(JSON.parse(body)),
              text: () => Promise.resolve(body)
            };
          }
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES && isRetryableError(error)) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };
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
          console.error('       echo \'{"key":"value"}\' | node lib/linear-cli.js create-issue <teamId> <title> --stdin');
          console.error('Options: {"description": "...", "projectId": "...", "parentId": "...", "stateId": "..."}');
          process.exit(1);
        }

        let options = {};
        if (useStdin) {
          const stdinData = await readStdin();
          try {
            options = JSON.parse(stdinData);
          } catch (e) {
            console.error('Error: Invalid JSON from stdin');
            console.error(e.message);
            process.exit(1);
          }
        } else if (arg3) {
          options = JSON.parse(arg3);
        }

        const created = await createIssue(arg, arg2, options);
        console.log(JSON.stringify(created, null, 2));
        break;
      }

      case 'update-issue': {
        if (!arg) {
          console.error('Error: Issue ID required');
          console.error('Usage: node lib/linear-cli.js update-issue <issueId> <json-updates>');
          console.error('       echo \'{"key":"value"}\' | node lib/linear-cli.js update-issue <issueId> --stdin');
          console.error('Updates: {"title": "...", "description": "...", "stateId": "...", "assigneeId": "..."}');
          process.exit(1);
        }

        let updates;
        if (useStdin) {
          const stdinData = await readStdin();
          try {
            updates = JSON.parse(stdinData);
          } catch (e) {
            console.error('Error: Invalid JSON from stdin');
            console.error(e.message);
            process.exit(1);
          }
        } else if (arg2) {
          updates = JSON.parse(arg2);
        } else {
          console.error('Error: Updates required (provide JSON argument or use --stdin)');
          process.exit(1);
        }

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

Flags:
  --stdin             Read JSON from stdin instead of command line argument
                      (supported by create-issue and update-issue)

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

  # Write operations with stdin (avoids shell escaping issues)
  echo '{"description":"Details"}' | node lib/linear-cli.js create-issue team_id "Title" --stdin
  cat update.json | node lib/linear-cli.js update-issue issue_id --stdin
`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
