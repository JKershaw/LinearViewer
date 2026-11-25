/**
 * Swim Page Renderer
 *
 * Generates HTML for the swim lanes view.
 * Embeds issue data as JSON for client-side lane rendering.
 * Settings panel allows adjusting grouping, max lanes, etc.
 */

import { escapeHtml } from './utils/html.js';
import { PREVIEW_NOTE } from './components/footer.js';
import { renderFilterLine, renderPreviewSignIn } from './components/navbar.js';
import { renderFrame, renderPublicFrame } from './components/frame.js';
import { renderRunnerLink } from './components/runner-link.js';
import { orderIssuesForSwim } from './task-board-view.js';
import { getProviderForWorkspace } from './providers/registry.js';

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
  const { deployInfo = {}, urlKey = null, openRouterSource = null, workspaces = [], workspace, featureFlags = {}, isLanding = false, teams = [], selectedTeamId = null } = options;

  // Provider-aware popover link text (LIN-356 / LIN-177 S3 carry-forward F1).
  // Landing paths pass no workspace and fall back to 'Linear'.
  const providerDisplayName = getProviderForWorkspace(workspace)?.ui?.displayName || 'Linear';

  const sortedIssues = orderIssuesForSwim({ projectTrees, inProgressTrees, recentActivityTrees });

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

  const content = `<div class="swim-page" data-testid="swim-page" data-url-key="${encodedUrlKey}">
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
          <label class="swim-setting-label" for="swim-orientation">Orientation</label>
          <select id="swim-orientation" class="swim-setting-select">
            <option value="flow" selected>Flow</option>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
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
        <div class="swim-setting">
          <label class="swim-setting-label">
            <input type="checkbox" id="swim-group-subtasks" class="swim-setting-checkbox" checked> Group subtasks
          </label>
        </div>
        <div class="swim-setting">
          <label class="swim-setting-label" for="swim-label-filter">Focus label</label>
          <select id="swim-label-filter" class="swim-setting-select">
            <option value="">All</option>
          </select>
        </div>
      </div>
    </div>

    <div class="swim-container">
      <div class="swim-lanes" id="swim-lanes" data-testid="swim-lanes">
        <!-- Rendered client-side -->
      </div>
    </div>

    <div class="swim-popover hidden" id="swim-popover">
      <div class="swim-popover-header">
        <a class="swim-popover-id" id="swim-popover-id" href="#"></a>
        <button class="swim-popover-close" id="swim-popover-close">&times;</button>
      </div>
      <div class="swim-popover-title" id="swim-popover-title"></div>
      ${urlKey && !isLanding ? `<div class="swim-popover-runner">${renderRunnerLink(urlKey)}</div>` : ''}
      <div class="swim-popover-meta" id="swim-popover-meta"></div>
      <div class="swim-popover-desc" id="swim-popover-desc"></div>
      <a class="swim-popover-link" id="swim-popover-link" target="_blank">View in ${escapeHtml(providerDisplayName)} &rarr;</a>
      <button class="swim-popover-critical-path" id="swim-popover-critical-path">Show critical path</button>
    </div>
  </div>`;
  const page = {
    stylesheets: ['/style.css', '/swim.css'],
    embeddedData: { globalVar: '__SWIM_DATA__', value: swimData },
    scripts: ['/common.js', '/swim.js'],
    content,
  };

  // LIN-4564 (LIN-4342 piece 3): the signed-out preview sits in the public frame; its band carries the preview's sign-in
  // path (renderPreviewSignIn: the sole sign-in path here, `nav-login-*` kept); its way back is the public frame's own,
  // Harbour's front page.
  if (isLanding) {
    return renderPublicFrame({
      ...page,
      title: 'Swim',
      subtitle: PREVIEW_NOTE,
      signIn: renderPreviewSignIn(),
      deployInfo,
    });
  }

  // LIN-4564: a workspace's Swim sits in the frame as the place Swim; the team selector is in the frame's filter line.
  return renderFrame({
    ...page,
    place: 'swim',
    subtitle: 'Dependency-ordered lanes across your work.',
    urlKey,
    workspaces,
    featureFlags,
    openRouterSource,
    deployInfo,
    filters: renderFilterLine({ currentPage: 'swim', urlKey, teams, selectedTeamId }),
  });
}
