/**
 * Swim Page Renderer
 *
 * Generates HTML for the swim lanes view.
 * Embeds issue data as JSON for client-side lane rendering.
 * Settings panel allows adjusting grouping, max lanes, etc.
 */

import { escapeHtml, FAVICON_BASE64 } from './utils/html.js';
import { renderPageFooter } from './components/footer.js';
import { renderNavBar } from './components/navbar.js';
import { flattenTrees, sortIssuesForSwipe, applyBlockingOrder } from './render-swipe.js';

/**
 * Renders the swim page.
 *
 * @param {Object} data - Page data
 * @param {Array} data.projectTrees - Project trees from fetchAndPrepareProjects
 * @param {Array} data.inProgressTrees - In-progress trees
 * @param {Array} data.recentActivityTrees - Recent activity trees
 * @param {string} data.organizationName - Organization name
 * @param {Object} options - Page options
 * @returns {string} Complete HTML document
 */
export function renderSwimPage(data, options = {}) {
  const { projectTrees = [], inProgressTrees = [], recentActivityTrees = [] } = data;
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], featureFlags = {} } = options;

  const navBarHtml = renderNavBar({ workspaces, urlKey, currentPage: 'swim', featureFlags });

  const footerHtml = renderPageFooter({
    deployInfo,
    currentPage: '/swim',
    urlKey,
    openRouterSource,
    featureFlags
  });

  // Flatten all issues for client-side use (reuse swipe helpers)
  const projectIssues = flattenTrees(projectTrees, 'project');
  const inProgressIssues = flattenTrees(inProgressTrees, 'in-progress');
  const recentIssues = flattenTrees(recentActivityTrees, 'recent-activity');

  // Deduplicate by id
  const seenIds = new Set();
  const allIssues = [];
  for (const issue of inProgressIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of projectIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }
  for (const issue of recentIssues) {
    if (!seenIds.has(issue.id)) { seenIds.add(issue.id); allIssues.push(issue); }
  }

  // Build parent/subtask relationships
  const cardById = new Map(allIssues.map(i => [i.id, i]));
  for (const issue of allIssues) {
    if (issue.parentId && cardById.has(issue.parentId)) {
      const parent = cardById.get(issue.parentId);
      issue.parentInfo = {
        id: parent.id,
        identifier: parent.identifier,
        title: parent.title,
        stateType: parent.stateType
      };
    }
  }

  // Sort (but don't cluster — swim does its own lane assignment)
  sortIssuesForSwipe(allIssues);
  const sortedIssues = applyBlockingOrder(allIssues);

  // Build project name → sortOrder map for lane ordering
  const projectOrder = {};
  for (const tree of projectTrees) {
    if (tree.project?.name) {
      projectOrder[tree.project.name] = tree.project.sortOrder ?? 0;
    }
  }

  const swimData = {
    issues: sortedIssues,
    projectOrder,
    urlKey: urlKey || ''
  };

  const encodedUrlKey = escapeHtml(urlKey || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Swim - Lanes</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/swim.css">
</head>
<body>
  ${navBarHtml}
  <main class="swim-page" data-url-key="${encodedUrlKey}">
    <div class="swim-settings-panel">
      <button class="swim-settings-toggle" aria-expanded="false">&#9881; settings</button>
      <div class="swim-settings-body hidden">
        <div class="swim-setting">
          <label class="swim-setting-label" for="swim-grouping">Grouping</label>
          <select id="swim-grouping" class="swim-setting-select">
            <option value="dependency" selected>Dependency chains</option>
            <option value="project">By project</option>
            <option value="assignee">By assignee</option>
            <option value="status">By status</option>
          </select>
        </div>
        <div class="swim-setting">
          <label class="swim-setting-label" for="swim-max-lanes">Max lanes <span class="swim-max-lanes-value">6</span></label>
          <input type="range" id="swim-max-lanes" min="1" max="12" value="6" class="swim-setting-range">
        </div>
        <div class="swim-setting">
          <label class="swim-setting-label">
            <input type="checkbox" id="swim-compact" class="swim-setting-checkbox"> Compact boxes
          </label>
        </div>
        <div class="swim-setting">
          <label class="swim-setting-label">
            <input type="checkbox" id="swim-show-completed" class="swim-setting-checkbox"> Show completed
          </label>
        </div>
        <div class="swim-setting">
          <label class="swim-setting-label">
            <input type="checkbox" id="swim-show-blockers" class="swim-setting-checkbox"> Show blockers
          </label>
        </div>
      </div>
    </div>

    <div class="swim-container">
      <div class="swim-lanes" id="swim-lanes">
        <!-- Rendered client-side -->
      </div>
    </div>

    <div class="swim-popover hidden" id="swim-popover">
      <div class="swim-popover-header">
        <span class="swim-popover-id" id="swim-popover-id"></span>
        <button class="swim-popover-close" id="swim-popover-close">&times;</button>
      </div>
      <div class="swim-popover-title" id="swim-popover-title"></div>
      <div class="swim-popover-meta" id="swim-popover-meta"></div>
      <div class="swim-popover-desc" id="swim-popover-desc"></div>
      <a class="swim-popover-link" id="swim-popover-link" target="_blank">View in Linear &rarr;</a>
      <button class="swim-popover-critical-path" id="swim-popover-critical-path">Show critical path</button>
    </div>
  </main>
  ${footerHtml}
  <script>window.__SWIM_DATA__ = ${JSON.stringify(swimData).replace(/</g, '\\u003c')};</script>
  <script src="/common.js"></script>
  <script src="/swim.js"></script>
</body>
</html>`;
}
