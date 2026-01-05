import { readFileSync } from 'fs';

/**
 * Parse a markdown file into Linear-compatible data structure
 * @param {string} filePath - Path to the markdown file
 * @returns {{ organizationName: string, projects: Array, issues: Array }}
 */
export function parseLandingPage(filePath) {
  const content = readFileSync(filePath, 'utf-8');

  // Extract frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = {};
  if (frontmatterMatch) {
    for (const line of frontmatterMatch[1].split('\n')) {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) {
        frontmatter[key.trim()] = rest.join(':').trim();
      }
    }
  }

  // Remove frontmatter from content
  const body = content.replace(/^---\n[\s\S]*?\n---\n*/, '');

  // Split by project headers (# at start of line)
  const projectBlocks = body.split(/^(?=# )/m).filter(b => b.trim());

  const projects = [];
  const issues = [];
  let projectOrder = 0;

  for (const block of projectBlocks) {
    const lines = block.split('\n');

    // First line is the project name
    const nameLine = lines[0];
    const projectName = nameLine.replace(/^# /, '').trim();
    const projectId = `project-${projectOrder}`;

    // Find description (blockquote)
    let description = '';
    let issueStartIndex = 1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('> ')) {
        description = lines[i].replace(/^> /, '').trim();
        issueStartIndex = i + 1;
        break;
      } else if (lines[i].trim() && !lines[i].startsWith('>')) {
        issueStartIndex = i;
        break;
      }
    }

    projects.push({
      id: projectId,
      name: projectName,
      content: description,
      url: null,
      sortOrder: projectOrder
    });

    // Parse issues from remaining lines
    const issueLines = lines.slice(issueStartIndex);
    const projectIssues = parseIssues(issueLines, projectId);
    issues.push(...projectIssues);

    projectOrder++;
  }

  return {
    organizationName: frontmatter.title || 'Roadmap',
    projects,
    issues
  };
}

/**
 * Parse issue list items from lines
 */
function parseIssues(lines, projectId) {
  const issues = [];
  const stack = []; // Stack of { id, depth } for parent tracking
  let issueOrder = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Match list item: spaces/tabs, dash, state marker, title
    const match = line.match(/^(\s*)- ([✓◐○]) (.+)$/);
    if (!match) {
      i++;
      continue;
    }

    const [, indent, stateChar, title] = match;
    const depth = Math.floor(indent.length / 2); // 2 spaces per depth level

    // Determine state
    let state;
    if (stateChar === '✓') {
      state = { type: 'completed', name: 'Done' };
    } else if (stateChar === '◐') {
      state = { type: 'started', name: 'In Progress' };
    } else {
      state = { type: 'unstarted', name: 'Todo' };
    }

    // Collect description lines (indented non-list lines following this item)
    const descLines = [];
    const metadata = {};
    const baseIndent = indent.length + 2; // Issue content is indented past the marker

    let j = i + 1;
    while (j < lines.length) {
      const nextLine = lines[j];

      // Stop if we hit another list item at same or lower depth
      const nextMatch = nextLine.match(/^(\s*)- [✓◐○]/);
      if (nextMatch) {
        const nextDepth = Math.floor(nextMatch[1].length / 2);
        if (nextDepth <= depth) break;
        // It's a child issue, stop description collection
        break;
      }

      // Check if it's indented content (description or metadata)
      const contentMatch = nextLine.match(/^(\s+)(.+)$/);
      if (contentMatch && contentMatch[1].length >= baseIndent) {
        const content = contentMatch[2].trim();

        // Check for @key: value metadata
        const metaMatch = content.match(/^@(\w+):\s*(.+)$/);
        if (metaMatch) {
          metadata[metaMatch[1]] = metaMatch[2];
        } else {
          descLines.push(content);
        }
        j++;
      } else if (nextLine.trim() === '') {
        j++;
      } else {
        break;
      }
    }

    // Find parent from stack
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parentId = stack.length > 0 ? stack[stack.length - 1].id : null;

    const issueId = `${projectId}-issue-${issueOrder}`;

    issues.push({
      id: issueId,
      title: title.trim(),
      description: descLines.join('\n') || null,
      state,
      priority: 0,
      project: { id: projectId },
      parent: parentId ? { id: parentId } : null,
      assignee: metadata.assignee ? { name: metadata.assignee } : null,
      estimate: metadata.estimate ? parseInt(metadata.estimate, 10) : null,
      dueDate: metadata.due || null,
      completedAt: null,
      url: metadata.url || null,
      linkText: metadata.linkText || null,
      sameTab: metadata.sameTab === 'true',
      labels: metadata.labels
        ? { nodes: metadata.labels.split(',').map(l => ({ name: l.trim() })) }
        : { nodes: [] },
      createdAt: new Date().toISOString(),
      sortOrder: issueOrder
    });

    stack.push({ id: issueId, depth });
    issueOrder++;
    i = j;
  }

  return issues;
}
