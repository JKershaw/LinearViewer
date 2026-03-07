/**
 * Swipe Page Renderer
 *
 * Generates HTML for the mobile-first task swipe page.
 * Embeds issue data as JSON for client-side card rendering.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { getPromptLabels, getPromptDisplayName } from './prompt-templates.js';

// Default prompts shown for every actionable issue
const DEFAULT_PROMPT_KEYS = ['look-into', 'research', 'plan', 'implementation'];

// All additional prompt keys behind "more"
const MORE_PROMPT_KEYS = getPromptLabels().filter(k => !new Set(DEFAULT_PROMPT_KEYS).has(k));

/**
 * Build prompt metadata for client-side rendering
 * @returns {Object} Prompt key → display name mapping
 */
function buildPromptMeta() {
  const meta = {};
  for (const key of [...DEFAULT_PROMPT_KEYS, ...MORE_PROMPT_KEYS]) {
    meta[key] = getPromptDisplayName(key);
  }
  return meta;
}

/**
 * Map an issue tree node to a flat card-data object.
 * @param {Object} issue - Issue from tree node
 * @param {string} projectName - Project name for display
 * @param {string} section - Section type ('project' | 'in-progress' | 'recent-activity')
 * @returns {Object} Flat issue object for client-side rendering
 */
function issueToCard(issue, projectName, section) {
  return {
    id: issue.id,
    identifier: issue.identifier || '',
    title: issue.title,
    description: issue.description || '',
    priority: issue.priority || 0,
    url: issue.url || '',
    stateType: issue.state?.type || 'unstarted',
    stateName: issue.state?.name || '',
    labels: (issue.labels?.nodes || []).map(l => l.name),
    projectName,
    completedAt: issue.completedAt || null,
    dueDate: issue.dueDate || null,
    section
  };
}

/**
 * Flatten tree nodes into a flat issue array, preserving project info.
 * @param {Array} trees - Project trees or in-progress trees
 * @param {string} type - 'project' | 'in-progress' | 'recent-activity'
 * @returns {Array} Flat array of card-data objects
 */
function flattenTrees(trees, type) {
  const items = [];

  function walkAll(node, projectName) {
    items.push(issueToCard(node.issue, projectName, type));
    for (const child of node.children || []) {
      walkAll(child, projectName);
    }
  }

  function walkInProgress(node, projectName) {
    if (node.isInProgress) {
      items.push(issueToCard(node.issue, projectName, 'in-progress'));
    }
    for (const child of node.children || []) {
      walkInProgress(child, projectName);
    }
  }

  if (type === 'project') {
    for (const { project, incomplete } of trees) {
      for (const node of incomplete) {
        walkAll(node, project.name);
      }
    }
  } else if (type === 'in-progress') {
    for (const { projectName, roots } of trees) {
      for (const node of roots) {
        if (node.isInProgress) {
          walkAll(node, projectName);
        } else {
          for (const child of node.children || []) {
            walkInProgress(child, projectName);
          }
        }
      }
    }
  } else if (type === 'recent-activity') {
    for (const { roots, projectName } of trees) {
      for (const node of roots) {
        items.push(issueToCard(node.issue, node.projectName || projectName || '', 'recent-activity'));
      }
    }
  }

  return items;
}

/**
 * Build filter groups from the flattened issue list.
 * @param {Array} allIssues - All deduplicated issues
 * @returns {Array<{key: string, label: string, count: number}>} Filter groups
 */
function buildFilterGroups(allIssues) {
  const groups = [];

  // In Progress
  const inProgressIds = allIssues
    .filter(i => i.stateType === 'started')
    .map(i => i.id);
  if (inProgressIds.length > 0) {
    groups.push({ key: 'in-progress', label: 'In Progress', count: inProgressIds.length });
  }

  // Recent Activity
  const recentIds = allIssues
    .filter(i => i.section === 'recent-activity')
    .map(i => i.id);
  if (recentIds.length > 0) {
    groups.push({ key: 'recent-activity', label: 'Recently Completed', count: recentIds.length });
  }

  // Per project
  const projectNames = [...new Set(allIssues.map(i => i.projectName).filter(Boolean))];
  for (const name of projectNames) {
    const count = allIssues.filter(i => i.projectName === name && i.section === 'project').length;
    if (count > 0) {
      groups.push({ key: `project:${name}`, label: name, count });
    }
  }

  return groups;
}

/**
 * Renders the swipe page.
 *
 * @param {Object} data - Page data
 * @param {Array} data.projectTrees - Project trees from fetchAndPrepareProjects
 * @param {Array} data.inProgressTrees - In-progress trees
 * @param {Array} data.recentActivityTrees - Recent activity trees
 * @param {string} data.organizationName - Organization name
 * @param {Object} options - Page options
 * @returns {string} Complete HTML document
 */
export function renderSwipePage(data, options = {}) {
  const { projectTrees = [], inProgressTrees = [], recentActivityTrees = [] } = data;
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'swipe', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/swipe',
    urlKey,
    openRouterSource,
    featureFlags
  });

  // Flatten all issues for client-side use
  const projectIssues = flattenTrees(projectTrees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  // Deduplicate by id (in-progress issues also appear in project trees)
  const seenIds = new Set();
  const allIssues = [];
  // Add in-progress first (they're the default view)
  for (const issue of inProgressIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id);
      allIssues.push(issue);
    }
  }
  for (const issue of recentIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id);
      allIssues.push(issue);
    }
  }
  for (const issue of projectIssues) {
    if (!seenIds.has(issue.id)) {
      seenIds.add(issue.id);
      allIssues.push(issue);
    }
  }

  const filterGroups = buildFilterGroups(allIssues);
  const promptMeta = buildPromptMeta();

  const swipeData = {
    issues: allIssues,
    filters: filterGroups,
    promptMeta,
    defaultPromptKeys: DEFAULT_PROMPT_KEYS,
    morePromptKeys: MORE_PROMPT_KEYS,
    urlKey: urlKey || '',
    hasAI: !!openRouterSource,
    dispatchEnabled: featureFlags.dispatch === true
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Swipe - Tasks</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/swipe.css">
</head>
<body>
  ${navBarHtml}
  <main class="swipe-page" data-url-key="${encodedUrlKey}">
    <div class="swipe-filter-bar">
      <select class="swipe-filter-select" aria-label="Filter tasks">
        ${filterGroups.map((g, i) => `<option value="${escapeHtml(g.key)}"${i === 0 ? ' selected' : ''}>${escapeHtml(g.label)} (${g.count})</option>`).join('\n        ')}
      </select>
    </div>

    <div class="swipe-card-area">
      <button class="swipe-arrow swipe-arrow-left" aria-label="Previous task" disabled>&#8592;</button>
      <div class="swipe-card-container">
        <div class="swipe-card" id="swipe-card">
          <div class="swipe-card-empty">No tasks to display</div>
        </div>
      </div>
      <button class="swipe-arrow swipe-arrow-right" aria-label="Next task">&#8594;</button>
    </div>

    <div class="swipe-counter" id="swipe-counter"></div>

    <div class="swipe-prompts" id="swipe-prompts">
      <div class="swipe-prompt-buttons" id="swipe-prompt-buttons"></div>
      <div class="swipe-prompt-result hidden" id="swipe-prompt-result">
        <div class="swipe-prompt-header">
          <span class="swipe-prompt-name" id="swipe-prompt-name"></span>
          <div class="swipe-prompt-actions" id="swipe-prompt-actions">
            <button class="swipe-prompt-copy">copy</button>
          </div>
        </div>
        <div class="swipe-prompt-text" id="swipe-prompt-text"></div>
      </div>
    </div>
  </main>
  ${footerHtml}
  <script>window.__SWIPE_DATA__ = ${JSON.stringify(swipeData).replace(/</g, '\\u003c')};</script>
  <script src="/common.js"></script>
  <script src="/purify.min.js"></script>
  <script src="/marked.min.js"></script>
  <script src="/swipe.js"></script>
</body>
</html>`;
}
