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
 *   node lib/linear-cli.js relations <id>  # Get issue relations
 *
 * Write commands:
 *   node lib/linear-cli.js create-issue <teamId> <title> [json-options]
 *   node lib/linear-cli.js update-issue <issueId> <json-updates>
 *   node lib/linear-cli.js comment <issueId> <body>
 *   node lib/linear-cli.js relation <issueId> <type> <relatedIssueId>
 */
import { GraphQLClient, gql } from 'graphql-request';
import { createProxyFetch } from './proxy-fetch.js';

const API_KEY = process.env.LINEAR_API_KEY;

if (!API_KEY) {
  console.error('Error: LINEAR_API_KEY environment variable is not set');
  console.error('Get your API key from: https://linear.app/settings/api');
  process.exit(1);
}

// Parse arguments, extracting flags
const rawArgs = process.argv.slice(2);
const useStdin = rawArgs.includes('--stdin');
const useBase64 = rawArgs.includes('--base64');
const withImages = rawArgs.includes('--with-images');
const fileOutputIndex = rawArgs.findIndex(a => a === '--file');
const fileOutputPath = fileOutputIndex !== -1 ? rawArgs[fileOutputIndex + 1] : null;
const args = rawArgs.filter((a, i) =>
  !['--stdin', '--base64', '--with-images', '--file'].includes(a) &&
  (fileOutputIndex === -1 || i !== fileOutputIndex + 1)
);

const command = args[0];
const arg = args[1];
const arg2 = args[2];
const arg3 = args[3];

/**
 * Extract image URLs from markdown text
 * @param {string} text - Markdown text to parse
 * @returns {Array<{alt: string, url: string}>} Array of image references
 */
function parseMarkdownImages(text) {
  if (!text) return [];
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;
  while ((match = imageRegex.exec(text)) !== null) {
    images.push({ alt: match[1], url: match[2] });
  }
  return images;
}

// Configure proxy-aware fetch if available (for environments behind HTTP proxies)
const customFetch = await createProxyFetch() || fetch;

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
        comments {
          nodes {
            id
            body
            createdAt
            user { name }
          }
        }
        attachments(first: 50) {
          nodes {
            id
            url
            title
            subtitle
            metadata
          }
        }
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
    const stateOrder = { started: 0, unstarted: 1, backlog: 2, completed: 3, canceled: 4, duplicate: 4 };
    siblings = parent.children.nodes
      .filter(child => child.id !== issueId)
      .sort((a, b) => (stateOrder[a.state?.type] ?? 2) - (stateOrder[b.state?.type] ?? 2))
      .slice(0, 5);
  }

  // Process comments - sort by date (oldest first for chronological reading)
  const comments = (issue.comments?.nodes || [])
    .map(c => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: c.user?.name || 'Unknown'
    }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // Process attachments
  const attachments = (issue.attachments?.nodes || []).map(a => ({
    id: a.id,
    url: a.url,
    title: a.title,
    subtitle: a.subtitle,
    metadata: a.metadata
  }));

  // Extract images from markdown in description and comments
  const descriptionImages = parseMarkdownImages(issue.description);
  const commentImages = comments.flatMap(c =>
    parseMarkdownImages(c.body).map(img => ({ ...img, commentId: c.id }))
  );

  // Filter attachments that look like images
  const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i;
  const attachmentImages = attachments.filter(a =>
    a.url && imageExtensions.test(a.url)
  );

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
    children: issue.children?.nodes || [],
    comments,
    attachments,
    images: {
      fromDescription: descriptionImages,
      fromComments: commentImages,
      fromAttachments: attachmentImages
    }
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

async function fetchLabels(teamId = null) {
  const data = await client.request(gql`
    query {
      organization {
        labels {
          nodes {
            id
            name
            color
            description
            team {
              id
              name
            }
          }
        }
      }
    }
  `);

  let labels = data.organization?.labels?.nodes || [];

  // Filter by team if specified
  if (teamId) {
    labels = labels.filter(l => l.team?.id === teamId);
  }

  return labels.map(l => ({
    id: l.id,
    name: l.name,
    color: l.color,
    description: l.description,
    team: l.team ? { id: l.team.id, name: l.team.name } : null,
  }));
}

async function fetchIssueLabels(issueId) {
  const data = await client.request(gql`
    query($id: String!) {
      issue(id: $id) {
        id
        identifier
        labels {
          nodes {
            id
            name
          }
        }
      }
    }
  `, { id: issueId });

  if (!data.issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  return {
    issue: {
      id: data.issue.id,
      identifier: data.issue.identifier,
    },
    labels: data.issue.labels?.nodes || [],
  };
}

async function findLabelByNameOrId(nameOrId) {
  const labels = await fetchLabels();
  const normalized = nameOrId.toLowerCase().trim();

  // Try exact ID match first
  let label = labels.find(l => l.id === nameOrId);
  if (label) return label;

  // Try case-insensitive name match
  label = labels.find(l => l.name.toLowerCase() === normalized);
  if (label) return label;

  throw new Error(`Label not found: ${nameOrId}`);
}

async function addLabelToIssue(issueId, labelNameOrId) {
  // Get current labels
  const { issue, labels: currentLabels } = await fetchIssueLabels(issueId);

  // Find the label to add
  const labelToAdd = await findLabelByNameOrId(labelNameOrId);

  // Check if already has this label
  if (currentLabels.some(l => l.id === labelToAdd.id)) {
    return {
      success: true,
      message: `Issue ${issue.identifier} already has label "${labelToAdd.name}"`,
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        labels: currentLabels.map(l => l.name),
      },
    };
  }

  // Add label to existing labels
  const newLabelIds = [...currentLabels.map(l => l.id), labelToAdd.id];

  // Update issue
  const data = await client.request(gql`
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          labels {
            nodes {
              id
              name
            }
          }
        }
      }
    }
  `, { id: issueId, input: { labelIds: newLabelIds } });

  return {
    success: data.issueUpdate.success,
    message: `Added label "${labelToAdd.name}" to ${data.issueUpdate.issue.identifier}`,
    issue: {
      id: data.issueUpdate.issue.id,
      identifier: data.issueUpdate.issue.identifier,
      labels: data.issueUpdate.issue.labels.nodes.map(l => l.name),
    },
  };
}

async function removeLabelFromIssue(issueId, labelNameOrId) {
  // Get current labels
  const { issue, labels: currentLabels } = await fetchIssueLabels(issueId);

  // Find the label to remove
  const labelToRemove = await findLabelByNameOrId(labelNameOrId);

  // Check if issue has this label
  if (!currentLabels.some(l => l.id === labelToRemove.id)) {
    return {
      success: true,
      message: `Issue ${issue.identifier} does not have label "${labelToRemove.name}"`,
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        labels: currentLabels.map(l => l.name),
      },
    };
  }

  // Remove label from existing labels
  const newLabelIds = currentLabels.filter(l => l.id !== labelToRemove.id).map(l => l.id);

  // Update issue
  const data = await client.request(gql`
    mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          labels {
            nodes {
              id
              name
            }
          }
        }
      }
    }
  `, { id: issueId, input: { labelIds: newLabelIds } });

  return {
    success: data.issueUpdate.success,
    message: `Removed label "${labelToRemove.name}" from ${data.issueUpdate.issue.identifier}`,
    issue: {
      id: data.issueUpdate.issue.id,
      identifier: data.issueUpdate.issue.identifier,
      labels: data.issueUpdate.issue.labels.nodes.map(l => l.name),
    },
  };
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

// Valid relation types for CLI (blocked-by is handled specially)
const RELATION_TYPES = ['blocks', 'blocked-by', 'duplicate', 'related'];

async function createRelation(issueId, type, relatedIssueId) {
  // Validate relation type
  if (!RELATION_TYPES.includes(type)) {
    throw new Error(`Invalid relation type "${type}"\nValid types: ${RELATION_TYPES.join(', ')}`);
  }

  // Handle blocked-by by swapping issue IDs and using blocks type
  // "A blocked-by B" means "B blocks A"
  let apiType = type;
  let sourceId = issueId;
  let targetId = relatedIssueId;

  if (type === 'blocked-by') {
    apiType = 'blocks';
    sourceId = relatedIssueId;
    targetId = issueId;
  }

  const input = {
    issueId: sourceId,
    relatedIssueId: targetId,
    type: apiType,
  };

  const data = await client.request(gql`
    mutation($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) {
        success
        issueRelation {
          id
          type
          issue {
            id
            identifier
            title
          }
          relatedIssue {
            id
            identifier
            title
          }
        }
      }
    }
  `, { input });

  return data.issueRelationCreate;
}

async function fetchRelations(issueId) {
  const data = await client.request(gql`
    query($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        relations {
          nodes {
            id
            type
            relatedIssue {
              id
              identifier
              title
              state { name type }
            }
          }
        }
        inverseRelations {
          nodes {
            id
            type
            issue {
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
  return {
    issue: {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
    },
    relations: (issue.relations?.nodes || []).map(r => ({
      id: r.id,
      type: r.type,
      relatedIssue: {
        id: r.relatedIssue.id,
        identifier: r.relatedIssue.identifier,
        title: r.relatedIssue.title,
        state: r.relatedIssue.state,
      }
    })),
    inverseRelations: (issue.inverseRelations?.nodes || []).map(r => ({
      id: r.id,
      type: r.type,
      issue: {
        id: r.issue.id,
        identifier: r.issue.identifier,
        title: r.issue.title,
        state: r.issue.state,
      }
    })),
  };
}

/**
 * Fetch an image from a URL with Linear API authentication
 * @param {string} imageUrl - The image URL to fetch
 * @param {object} options - Output options
 * @param {boolean} options.base64 - Return as base64 data URI
 * @param {string} options.filePath - Save to file path
 * @returns {Promise<object>} Result with url, contentType, and data/path
 */
async function fetchImage(imageUrl, options = {}) {
  const response = await customFetch(imageUrl, {
    method: 'GET',
    headers: {
      Authorization: API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  // Get content type from response headers
  const contentType = response.headers.get?.('content-type') ||
                      response.headers?.['content-type'] ||
                      'application/octet-stream';

  const buffer = Buffer.from(await response.arrayBuffer());

  if (options.filePath) {
    const fs = await import('fs/promises');
    await fs.writeFile(options.filePath, buffer);
    return {
      url: imageUrl,
      contentType,
      path: options.filePath,
      size: buffer.length
    };
  }

  if (options.base64) {
    const mimeType = contentType.split(';')[0].trim();
    const base64Data = buffer.toString('base64');
    return {
      url: imageUrl,
      contentType: mimeType,
      base64: `data:${mimeType};base64,${base64Data}`,
      size: buffer.length
    };
  }

  // Default: return metadata only
  return {
    url: imageUrl,
    contentType,
    size: buffer.length
  };
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
          console.error('Usage: node lib/linear-cli.js issue <id> [--with-images]');
          process.exit(1);
        }
        const context = await fetchIssueContext(arg);

        // Optionally fetch and embed images as base64
        if (withImages) {
          const allImageUrls = [
            ...context.images.fromDescription.map(i => i.url),
            ...context.images.fromComments.map(i => i.url),
            ...context.images.fromAttachments.map(i => i.url)
          ].filter(Boolean);

          context.embeddedImages = [];
          for (const url of allImageUrls) {
            try {
              const imgData = await fetchImage(url, { base64: true });
              context.embeddedImages.push(imgData);
            } catch (err) {
              context.embeddedImages.push({ url, error: err.message });
            }
          }
        }

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

      case 'relations': {
        if (!arg) {
          console.error('Error: Issue ID required');
          console.error('Usage: node lib/linear-cli.js relations <issueId>');
          process.exit(1);
        }
        const relations = await fetchRelations(arg);
        console.log(JSON.stringify(relations, null, 2));
        break;
      }

      case 'labels': {
        const teamId = arg || null;
        const labels = await fetchLabels(teamId);
        console.log(JSON.stringify(labels, null, 2));
        break;
      }

      case 'add-label': {
        if (!arg || !arg2) {
          console.error('Error: Issue ID and label required');
          console.error('Usage: node lib/linear-cli.js add-label <issueId> <labelName-or-labelId>');
          process.exit(1);
        }
        const addResult = await addLabelToIssue(arg, arg2);
        console.log(JSON.stringify(addResult, null, 2));
        break;
      }

      case 'remove-label': {
        if (!arg || !arg2) {
          console.error('Error: Issue ID and label required');
          console.error('Usage: node lib/linear-cli.js remove-label <issueId> <labelName-or-labelId>');
          process.exit(1);
        }
        const removeResult = await removeLabelFromIssue(arg, arg2);
        console.log(JSON.stringify(removeResult, null, 2));
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
        if (!arg) {
          console.error('Error: Issue ID required');
          console.error('Usage: node lib/linear-cli.js comment <issueId> "comment body"');
          console.error('       echo "comment text" | node lib/linear-cli.js comment <issueId> --stdin');
          process.exit(1);
        }

        let body;
        if (useStdin) {
          const stdinData = await readStdin();
          // readStdin returns '{}' for empty input (JSON default), treat as empty for comments
          body = stdinData === '{}' ? '' : stdinData;
          if (!body) {
            console.error('Error: Empty comment body from stdin');
            process.exit(1);
          }
        } else if (arg2) {
          body = arg2;
        } else {
          console.error('Error: Comment body required (provide as argument or use --stdin)');
          process.exit(1);
        }

        const commented = await addComment(arg, body);
        console.log(JSON.stringify(commented, null, 2));
        break;
      }

      case 'relation': {
        if (!arg || !arg2 || !arg3) {
          console.error('Error: Issue ID, relation type, and related issue ID required');
          console.error('Usage: node lib/linear-cli.js relation <issueId> <type> <relatedIssueId>');
          console.error(`Types: ${RELATION_TYPES.join(', ')}`);
          process.exit(1);
        }
        const relation = await createRelation(arg, arg2, arg3);
        console.log(JSON.stringify(relation, null, 2));
        break;
      }

      case 'fetch-image': {
        if (!arg) {
          console.error('Error: Image URL required');
          console.error('Usage: node lib/linear-cli.js fetch-image <url> [--base64] [--file <path>]');
          process.exit(1);
        }
        const imageResult = await fetchImage(arg, {
          base64: useBase64,
          filePath: fileOutputPath
        });
        console.log(JSON.stringify(imageResult, null, 2));
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
  issue <id>          Get issue details with full context (including comments)
                      Use --with-images to embed base64 image data
  search "query"      Search issues
  states <teamId>     List workflow states for a team
  relations <issueId> Get issue relations (blocks, blocked-by, etc.)
  labels [teamId]     List all labels (optionally filter by team)
  fetch-image <url>   Fetch an image with Linear authentication

Write Commands:
  create-issue <teamId> <title> [json-options]
                      Create a new issue
  update-issue <issueId> <json-updates>
                      Update an existing issue
  comment <issueId> "body"
                      Add a comment to an issue
  relation <issueId> <type> <relatedIssueId>
                      Create a relation between issues
                      Types: blocks, blocked-by, duplicate, related
  add-label <issueId> <label>
                      Add a label to an issue (by name or ID)
  remove-label <issueId> <label>
                      Remove a label from an issue (by name or ID)

Flags:
  --stdin             Read from stdin instead of command line argument
                      (supported by create-issue, update-issue, and comment)
  --with-images       Embed base64 image data in issue output (issue command)
  --base64            Output image as base64 data URI (fetch-image command)
  --file <path>       Save image to file path (fetch-image command)

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
  echo "Comment with special chars" | node lib/linear-cli.js comment issue_id --stdin

  # Relation operations
  node lib/linear-cli.js relations LIN-37
  node lib/linear-cli.js relation LIN-40 blocked-by LIN-39
  node lib/linear-cli.js relation LIN-31 blocks LIN-32
  node lib/linear-cli.js relation LIN-31 duplicate LIN-28

  # Label operations
  node lib/linear-cli.js labels
  node lib/linear-cli.js labels team_abc123
  node lib/linear-cli.js add-label LIN-99 "bug"
  node lib/linear-cli.js add-label LIN-99 label_uuid_123
  node lib/linear-cli.js remove-label LIN-99 "bug"

  # Image operations
  node lib/linear-cli.js issue abc123 --with-images
  node lib/linear-cli.js fetch-image "https://linear.app/uploads/..." --base64
  node lib/linear-cli.js fetch-image "https://linear.app/uploads/..." --file ./screenshot.png
`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
