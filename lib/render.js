// =============================================================================
// Type Imports (JSDoc)
// =============================================================================

/**
 * @typedef {import('./tree.js').ProjectTree} ProjectTree
 * @typedef {import('./tree.js').InProgressTree} InProgressTree
 * @typedef {import('./tree.js').TreeNode} TreeNode
 * @typedef {import('./tree.js').InProgressTreeNode} InProgressTreeNode
 * @typedef {import('./tree.js').Issue} Issue
 * @typedef {import('./tree.js').Project} Project
 * @typedef {import('./workspace.js').Workspace} Workspace
 */

import { getPromptLabels, isEligibleForPlan, getPromptDisplayName, getUniversalLabels } from './prompt-templates.js'
import { escapeHtml, FAVICON_BASE64 } from './utils/html.js'
import { renderPageFooter } from './components/footer.js'

// Cache prompt labels for rendering
const PROMPT_LABELS = new Set(getPromptLabels())

/**
 * Render a prompt container with consistent HTML structure
 * Used by both landing page (pre-filled) and project view (dynamic)
 * @param {Object} options
 * @param {string} [options.name] - Prompt name to display in header
 * @param {string} [options.content] - Pre-populated content (already escaped)
 * @param {string} [options.issueId] - Issue ID for data-prompt-for attribute
 * @param {string} [options.urlKey] - Workspace URL key for data-url-key attribute
 * @returns {string} HTML string
 */
function renderPromptContainer({ name = '', content = '', issueId = '', urlKey = '' } = {}) {
  const hiddenClass = content ? '' : ' hidden'
  const issueAttr = issueId ? ` data-prompt-for="${escapeHtml(issueId)}"` : ''
  const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''

  return `<div class="prompt-container${hiddenClass}"${issueAttr}${urlKeyAttr}><div class="prompt-header"><span class="prompt-name">${escapeHtml(name)}</span><div class="prompt-actions"><button class="prompt-dispatch">dispatch</button><button class="prompt-copy">copy</button></div></div><div class="prompt-text">${content}</div></div>`
}

/**
 * Team object from Linear API
 * @typedef {Object} Team
 * @property {string} id - Team ID
 * @property {string} name - Team name
 * @property {string} key - Team key (abbreviation)
 */

/**
 * Options for renderPage
 * @typedef {Object} RenderPageOptions
 * @property {boolean} [isLanding] - If true, show login link instead of logout
 * @property {Team[]} [teams] - Array of teams for the team selector
 * @property {string|null} [selectedTeamId] - Currently selected team ID
 * @property {Workspace[]} [workspaces] - Array of connected workspaces
 * @property {'oauth'|'env'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {string} [urlKey] - Current workspace URL key (from URL, determines active workspace)
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [deployInfo.version] - HEROKU_RELEASE_VERSION
 * @property {string} [deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT
 * @property {string} [deployInfo.commit] - HEROKU_BUILD_COMMIT
 */


/**
 * Render the full HTML page for all project trees
 * @param {ProjectTree[]} projectTrees - Array of project trees with partitioned issues
 * @param {InProgressTree[]} inProgressTrees - Array of in-progress trees grouped by project
 * @param {import('./tree.js').RecentActivityTree[]} recentActivityTrees - Array of recent activity trees grouped by project
 * @param {string} organizationName - The Linear organization name
 * @param {RenderPageOptions} options - Optional settings
 * @returns {string} Full HTML document
 */
export function renderPage(projectTrees, inProgressTrees = [], recentActivityTrees = [], organizationName = 'Projects', options = {}) {
  const { isLanding = false, teams = [], selectedTeamId = null, workspaces = [], openRouterSource = null, urlKey = null, deployInfo = {} } = options
  const inProgressHtml = renderInProgressSection(inProgressTrees, { isLanding, openRouterSource, urlKey })
  const recentActivityHtml = renderRecentActivitySection(recentActivityTrees, { isLanding, openRouterSource, urlKey })
  const projectsHtml = projectTrees.map(tree => renderProject(tree, { isLanding, openRouterSource, urlKey })).join('\n')

  // Navigation bar with workspace/team selectors (authenticated users only)
  // Uses urlKey from URL to determine active workspace (enables multi-tab support)
  const navBarHtml = !isLanding ? renderNavBar({ workspaces, teams, selectedTeamId, openRouterSource, urlKey }) : ''

  // Footer with actions and deploy info
  const footerHtml = renderPageFooter({
    isLanding,
    deployInfo,
    showReset: true,
    urlKey
  })

  // Get active workspace name for title (use urlKey from URL for multi-tab support)
  const activeWorkspace = workspaces?.find(w => w.urlKey === urlKey)
  const pageTitle = activeWorkspace?.name || organizationName

  return `<!DOCTYPE html>
<!-- AI agents: see /llms.txt for navigation guidance -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)} - Projects</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
</head>
<body${isLanding ? ' class="is-landing"' : ''}>
  ${navBarHtml}
  <header>
    <h1>${escapeHtml(pageTitle)}</h1>
  </header>
  <main>
    ${inProgressHtml}
    ${recentActivityHtml}
    <section role="region" aria-label="Projects">
      ${projectsHtml}
    </section>
  </main>
  ${footerHtml}
  <script src="/purify.min.js"></script>
  <script src="/marked.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>`
}

/**
 * Render the unified navigation bar
 * @param {Object} options - Navigation options
 * @param {Workspace[]} options.workspaces - Array of connected workspaces
 * @param {Team[]} options.teams - Array of teams
 * @param {string|null} options.selectedTeamId - Currently selected team ID
 * @param {'oauth'|'env'|null} options.openRouterSource - Source of OpenRouter API key
 * @param {string|null} options.urlKey - Current workspace URL key (from URL, determines active workspace)
 * @returns {string} HTML for navigation bar
 */
function renderNavBar({ workspaces = [], teams = [], selectedTeamId = null, openRouterSource = null, urlKey = null }) {
  // Use urlKey from URL to determine active workspace (enables multi-tab support)
  const workspaceNavItem = renderWorkspaceNavItem(workspaces, urlKey)
  const teamNavItem = renderTeamNavItem(teams, selectedTeamId)
  const openRouterNavItem = renderOpenRouterNavItem(openRouterSource, urlKey)
  const workspaceOptions = renderWorkspaceOptions(workspaces, urlKey)
  const teamOptions = renderTeamOptions(teams, selectedTeamId, urlKey)
  const queueBadge = urlKey ? renderQueueBadge(urlKey) : ''

  return `
  <nav class="nav-bar" aria-label="Main navigation">
    <div class="nav-filters">
      ${workspaceNavItem}
      ${teamNavItem}
    </div>
    <div class="nav-actions">
      ${openRouterNavItem}
      ${queueBadge}
      <a href="/logout" class="nav-action">logout</a>
    </div>
  </nav>
  ${workspaceOptions}
  ${teamOptions}`
}

/**
 * Render queue badge for dispatch feature
 * @param {string} urlKey - Current workspace URL key
 * @returns {string} HTML for queue badge
 */
function renderQueueBadge(urlKey) {
  return `<button class="queue-badge hidden" data-queue-badge data-url-key="${escapeHtml(urlKey)}" aria-label="Dispatch queue"><span class="queue-count">0</span> queued</button>`
}

/**
 * Render workspace nav item (the clickable "workspace: value" text)
 * @param {Workspace[]} workspaces - Array of connected workspaces
 * @param {string|null} urlKey - Current workspace URL key from URL
 */
function renderWorkspaceNavItem(workspaces, urlKey) {
  if (!workspaces?.length) return ''
  // Find workspace by urlKey (from URL) for multi-tab support
  const active = workspaces.find(w => w.urlKey === urlKey) || workspaces[0]

  return `<div class="nav-item" data-selector="workspace">
      <span class="nav-label">workspace:</span>
      <button class="nav-value" id="workspace-toggle" aria-expanded="false" aria-haspopup="listbox" aria-controls="workspace-options">${escapeHtml(active.name)}</button>
    </div>`
}

/**
 * Render team nav item (the clickable "team: value" text)
 */
function renderTeamNavItem(teams, selectedTeamId) {
  if (!teams?.length) return ''
  const selected = teams.find(t => t.id === selectedTeamId)
  const displayValue = selected ? selected.name : 'all'

  return `<div class="nav-item" data-selector="team">
      <span class="nav-label">team:</span>
      <button class="nav-value" id="team-toggle" aria-expanded="false" aria-haspopup="listbox" aria-controls="team-options">${escapeHtml(displayValue)}</button>
    </div>`
}

/**
 * Render OpenRouter status nav item
 * Shows connection status with link to connect/configure
 * @param {'oauth'|'env'|null} source - Source of OpenRouter API key
 * @param {string|null} urlKey - Current workspace URL key for generating links
 */
function renderOpenRouterNavItem(source, urlKey = null) {
  let statusClass, statusText, statusIcon
  if (source === 'oauth') {
    statusClass = 'connected'
    statusText = 'connected'
    statusIcon = '●'
  } else if (source === 'env') {
    statusClass = 'env'
    statusText = 'env'
    statusIcon = '●'
  } else {
    statusClass = 'disconnected'
    statusText = 'off'
    statusIcon = '○'
  }

  const settingsUrl = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/settings` : '/settings'

  return `<div class="nav-item" data-selector="openrouter">
      <span class="nav-label">ai:</span>
      <a href="${settingsUrl}" class="nav-value nav-openrouter-status ${statusClass}" title="OpenRouter: ${statusText}">${statusIcon}</a>
    </div>`
}

/**
 * Render workspace options panel (appears when workspace toggle is clicked)
 * Each workspace on its own row. Current workspace row includes "remove".
 * "+add" appears at the bottom where a new workspace would go.
 * Uses box-drawing characters for CLI aesthetic.
 * @param {Workspace[]} workspaces - Array of connected workspaces
 * @param {string|null} urlKey - Current workspace URL key from URL
 */
function renderWorkspaceOptions(workspaces, urlKey) {
  if (!workspaces?.length) return ''

  const optionsHtml = workspaces.map(ws => {
    // Compare by urlKey (from URL) for multi-tab support
    const isActive = ws.urlKey === urlKey
    const marker = isActive ? '●' : '○'
    const selectedClass = isActive ? ' selected' : ''
    const ariaSelected = isActive ? 'true' : 'false'

    // Only show remove button on the current (active) workspace row
    const removeBtn = isActive
      ? `<form action="/workspace/${encodeURIComponent(ws.urlKey)}/remove" method="POST" class="nav-option-form" data-confirm="Remove this workspace?">
          <button type="submit" class="nav-option nav-option-danger">remove</button>
        </form>`
      : ''

    return `<div class="nav-options-row">
      <span class="option-prefix">├─</span>
      <form action="/workspace/${encodeURIComponent(ws.urlKey)}/switch" method="POST" class="nav-option-form">
        <button type="submit" class="nav-option${selectedClass}" role="option" aria-selected="${ariaSelected}">
          <span class="option-marker">${marker}</span> ${escapeHtml(ws.name)}
        </button>
      </form>
      ${removeBtn}
    </div>`
  }).join('\n    ')

  return `
  <div class="nav-options-panel hidden" id="workspace-options" role="listbox" aria-label="Select workspace">
    ${optionsHtml}
    <div class="nav-options-row">
      <span class="option-prefix">└─</span>
      <a href="/auth/linear" class="nav-option nav-option-add"><span class="option-marker-placeholder"></span>+add</a>
    </div>
  </div>`
}

/**
 * Render team options panel (appears when team toggle is clicked)
 * Each team on its own row for consistency with workspace panel.
 * Uses box-drawing characters for CLI aesthetic.
 * @param {Team[]} teams - Array of teams
 * @param {string|null} selectedTeamId - Currently selected team ID
 * @param {string|null} urlKey - Current workspace URL key for client-side navigation
 */
function renderTeamOptions(teams, selectedTeamId, urlKey = null) {
  if (!teams?.length) return ''
  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name))

  const allSelected = !selectedTeamId
  const allMarker = allSelected ? '●' : '○'
  const allClass = allSelected ? ' selected' : ''

  const teamOptionsHtml = sortedTeams.map((team, index) => {
    const isSelected = team.id === selectedTeamId
    const marker = isSelected ? '●' : '○'
    const selectedClass = isSelected ? ' selected' : ''
    const isLast = index === sortedTeams.length - 1
    const prefix = isLast ? '└─' : '├─'
    const displayName = team.name

    return `<div class="nav-options-row">
      <span class="option-prefix">${prefix}</span>
      <button class="nav-option${selectedClass}" role="option" aria-selected="${isSelected}" data-team="${team.id}">
        <span class="option-marker">${marker}</span> ${escapeHtml(displayName)}
      </button>
    </div>`
  }).join('\n    ')

  // Add data-url-key attribute for client-side URL construction
  const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''

  return `
  <div class="nav-options-panel hidden" id="team-options" role="listbox" aria-label="Select team"${urlKeyAttr}>
    <div class="nav-options-row">
      <span class="option-prefix">├─</span>
      <button class="nav-option${allClass}" role="option" aria-selected="${allSelected}" data-team="all">
        <span class="option-marker">${allMarker}</span> all
      </button>
    </div>
    ${teamOptionsHtml}
  </div>`
}

/**
 * Render the in-progress section with tree structure
 * @param {InProgressTree[]} inProgressTrees - Array of in-progress trees grouped by project
 * @param {Object} options - Rendering options
 * @param {boolean} options.isLanding - If true, skip prompt UI (landing page)
 * @param {'oauth'|'env'|null} options.openRouterSource - Source of OpenRouter API key
 * @param {string|null} options.urlKey - Current workspace URL key for API calls
 * @returns {string} HTML for in-progress section
 */
function renderInProgressSection(inProgressTrees, options = {}) {
  const { isLanding = false, openRouterSource = null, urlKey = null } = options
  if (!inProgressTrees || inProgressTrees.length === 0) return ''

  // Count total in-progress issues (not ancestor context issues)
  let totalCount = 0
  function countInProgress(node) {
    let count = node.isInProgress ? 1 : 0
    for (const child of node.children) {
      count += countInProgress(child)
    }
    return count
  }
  for (const { roots } of inProgressTrees) {
    for (const root of roots) {
      totalCount += countInProgress(root)
    }
  }

  // Render trees grouped by project
  const itemsHtml = inProgressTrees.map(({ projectName, roots }) => {
    return roots
      .map(node => renderNode(node, 'in-progress-root', {
        section: 'in-progress',
        projectName,
        isLanding,
        openRouterSource,
        urlKey
      }))
      .join('\n')
  }).join('\n')

  return `
  <div class="in-progress-section" role="region" aria-label="In Progress Tasks">
    <div class="in-progress-header">▼ In Progress</div>
    <div class="in-progress-items tree">
      ${itemsHtml}
    </div>
  </div>`
}

/**
 * Render the recent activity section as a flat list sorted by completion time
 * @param {import('./tree.js').RecentActivityTree[]} recentActivityTrees - Single-element array with flat list
 * @param {Object} options - Rendering options
 * @param {boolean} options.isLanding - If true, skip prompt UI (landing page)
 * @param {'oauth'|'env'|null} options.openRouterSource - Source of OpenRouter API key
 * @param {string|null} options.urlKey - Current workspace URL key for API calls
 * @returns {string} HTML for recent activity section
 */
function renderRecentActivitySection(recentActivityTrees, options = {}) {
  const { isLanding = false, openRouterSource = null, urlKey = null } = options
  if (!recentActivityTrees || recentActivityTrees.length === 0) return ''

  // Count total completed issues
  let totalCount = 0
  for (const { roots } of recentActivityTrees) {
    totalCount += roots.length
  }

  // Render flat list (each node has projectName attached)
  const itemsHtml = recentActivityTrees.flatMap(({ roots }) =>
    roots.map(node => renderNode(node, 'recent-activity-root', {
      section: 'recent-activity',
      isLanding,
      openRouterSource,
      urlKey
    }))
  ).join('\n')

  return `
  <div class="recent-activity-section" role="region" aria-label="Recently Completed Tasks">
    <div class="recent-activity-header">▶ Recently Completed</div>
    <div class="recent-activity-items tree hidden">
      ${itemsHtml}
    </div>
  </div>`
}

/**
 * Render a single project with its issues
 * @param {ProjectTree} projectTree - Project tree with partitioned issues
 * @param {Object} options - Rendering options
 * @param {boolean} options.isLanding - If true, skip prompt UI (landing page)
 * @param {'oauth'|'env'|null} options.openRouterSource - Source of OpenRouter API key
 * @param {string|null} options.urlKey - Current workspace URL key for API calls
 * @returns {string} HTML for project section
 */
function renderProject({ project, incomplete, completed, completedCount }, options = {}) {
  const { isLanding = false, openRouterSource = null, urlKey = null } = options
  const description = project.content
    ? renderProjectDescription(project.content, project.id)
    : ''

  const hasDescription = !!project.content
  const projectTarget = project.sameTab ? '' : ' target="_blank"'

  // Build Linear action links (authenticated users only)
  const viewLink = project.url
    ? `<a href="${project.url}"${projectTarget} class="detail-link">${project.linkText || 'View in Linear →'}</a>`
    : ''

  const projectLink = viewLink
    ? `<div class="project-meta${hasDescription ? ' hidden' : ''}">${viewLink}</div>`
    : ''

  const incompleteHtml = incomplete
    .map(node => renderNode(node, project.id, { isLanding, openRouterSource, urlKey }))
    .join('\n')

  const completedToggle = completedCount > 0
    ? `<div class="completed-toggle" data-project-id="${project.id}" data-count="${completedCount}">show ${completedCount} completed</div>`
    : ''

  const completedHtml = completed.length > 0
    ? `<div class="tree hidden" data-completed-for="${project.id}">${completed.map(node => renderNode(node, project.id, { isLanding, openRouterSource, urlKey })).join('\n')}</div>`
    : ''

  const defaultCollapsed = project.collapsed ? ' data-default-collapsed="true"' : ''

  // Wrap incomplete nodes in .tree container for CSS-based tree lines
  const incompleteTree = incomplete.length > 0
    ? `<div class="tree">${incompleteHtml}</div>`
    : ''

  const addTaskLink = !isLanding && urlKey && project.id
    ? `<div class="add-task-link"><a href="https://linear.app/${encodeURIComponent(urlKey)}/new?project=${encodeURIComponent(project.id)}" target="_blank" class="detail-link" data-action="create-task">+ Add task</a></div>`
    : ''

  return `
  <div class="project" data-id="${project.id}"${defaultCollapsed}>
    <div class="project-header">${project.collapsed ? '▶' : '▼'} ${escapeHtml(project.name)}</div>
    ${description}
    ${projectLink}
    ${incompleteTree}
    ${addTaskLink}
    ${completedHtml}
    ${completedToggle}
  </div>`
}

/**
 * Render a project description with truncation for long text
 */
function renderProjectDescription(description, projectId) {
  const maxLength = 150
  const escaped = escapeHtml(description)

  if (description.length <= maxLength) {
    return `<div class="project-description">${escaped}</div>`
  }

  // Truncate at word boundary
  let truncated = description.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > maxLength - 30) {
    truncated = truncated.slice(0, lastSpace)
  }

  return `<div class="project-description" data-desc-id="${projectId}">
    <span class="desc-truncated">${escapeHtml(truncated)}… <button class="desc-toggle">show more</button></span>
    <span class="desc-full hidden">${escaped} <button class="desc-toggle">show less</button></span>
  </div>`
}

/**
 * Render a single issue node and its children recursively
 * @param {TreeNode|InProgressTreeNode} node - The node to render
 * @param {string} parentId - The parent ID for data-parent attribute
 * @param {Object} options - Rendering options
 * @param {'project'|'in-progress'} options.section - Section type
 * @param {string} [options.projectName] - Project name to show in brackets (in-progress only, depth 0)
 * @param {boolean} [options.isLanding] - If true, skip prompt UI (landing page)
 * @param {'oauth'|'env'|null} [options.openRouterSource] - Source of OpenRouter API key
 * @param {string|null} [options.urlKey] - Current workspace URL key for API calls
 * @returns {string} HTML string
 */
function renderNode(node, parentId, options = {}) {
  const { section = 'project', projectName = null, isLanding = false, openRouterSource = null, urlKey = null } = options
  const { issue, children, depth } = node

  // Determine state
  const stateType = issue.state?.type || 'unstarted'
  let stateClass, stateChar, stateLabel
  if (stateType === 'completed' || stateType === 'canceled') {
    stateClass = 'done'
    stateChar = '✓'
    stateLabel = 'Completed'
  } else if (stateType === 'started') {
    stateClass = 'in-progress'
    stateChar = '◐'
    stateLabel = 'In Progress'
  } else {
    stateClass = 'todo'
    stateChar = '○'
    stateLabel = 'To Do'
  }

  const titleClass = stateClass === 'done' ? 'title done' : 'title'
  const hasChildren = children.length > 0

  // Check if issue has details worth showing
  const hasDetails = issue.url || issue.description || issue.assignee || issue.estimate || issue.dueDate || issue.completedAt || (issue.labels?.nodes?.length > 0)

  // Show toggle if has children OR details (unified expand/collapse)
  const canExpand = hasChildren || hasDetails
  // Start collapsed (▶) - user clicks to expand
  const toggle = canExpand
    ? `<span class="toggle">▶</span>`
    : ''

  // For recent-activity section, get projectName from node (flat list with attached project names)
  const nodeProjectName = section === 'recent-activity' ? node.projectName : projectName

  // Project name badge for in-progress and recent-activity sections (only at depth 0)
  const projectBadge = ((section === 'in-progress' || section === 'recent-activity') && depth === 0 && nodeProjectName)
    ? `<span class="in-progress-project">(${escapeHtml(nodeProjectName)})</span>`
    : ''

  // Time badge for recent-activity section (only at depth 0)
  const timeBadge = (section === 'recent-activity' && depth === 0 && issue.completedAt)
    ? `<span class="completed-time">${formatRelativeTime(issue.completedAt)}</span>`
    : ''

  // Child tasks (depth > 0) start hidden - hidden class now on .node wrapper
  const isChildTask = depth > 0
  const lineClasses = ['line', canExpand && 'expandable', hasChildren && 'has-children'].filter(Boolean).join(' ')
  const line = `<div class="${lineClasses}" data-id="${issue.id}" data-parent="${parentId}" data-depth="${depth}" data-section="${section}" style="--depth: ${depth}"><span class="state ${stateClass}" data-status="${stateClass}" aria-label="Status: ${stateLabel}">${stateChar}</span><span class="${titleClass}">${escapeHtml(issue.title)}</span>${timeBadge}${projectBadge}${toggle}</div>`

  // Render details section
  const details = hasDetails ? renderDetails(issue, depth, section, isLanding, openRouterSource, urlKey) : ''

  // Render children
  const childrenHtml = children
    .map(child => renderNode(child, issue.id, options))
    .join('\n')

  // Wrap in .node container - children go in nested .children div
  const childrenWrapper = children.length > 0
    ? `<div class="children">${childrenHtml}</div>`
    : ''

  const nodeClasses = ['node', isChildTask && 'hidden'].filter(Boolean).join(' ')

  return `<div class="${nodeClasses}" data-id="${issue.id}">${line}${details}${childrenWrapper}</div>`
}

/**
 * Render non-promptable labels as plain text for the Details section
 * @param {Issue} issue - The issue object
 * @returns {string} HTML string of display labels or empty string
 */
export function renderDisplayLabels(issue) {
  const labels = issue.labels?.nodes || []
  const displayLabels = labels.filter(l => !PROMPT_LABELS.has(l.name))
  return displayLabels.map(l => escapeHtml(l.name)).join(', ')
}

/**
 * Render prompt buttons (AI suggest, promptable labels, universal prompts, more toggle)
 * Used in the Prompts section. Returns empty string for landing page.
 * @param {Issue} issue - The issue object
 * @param {boolean} isLanding - If true, return empty (no prompts for landing page)
 * @param {'oauth'|'env'|null} openRouterSource - Source of OpenRouter API key (shows AI suggest when truthy)
 * @returns {string} HTML string of prompt buttons or empty string
 */
export function renderPromptButtons(issue, isLanding = false, openRouterSource = null) {
  // No prompt buttons on landing page
  if (isLanding) return ''

  const labels = issue.labels?.nodes || []
  const issueId = issue.id
  const parts = []
  const visiblePromptKeys = new Set()

  // Add "AI suggest" button at the start (only for authenticated users with OpenRouter configured)
  if (openRouterSource) {
    parts.push(`<a href="#" class="label-prompt suggest-btn" data-issue-id="${issueId}" title="Get AI recommendation">AI suggest</a>`)
  }

  // Render promptable labels as clickable links
  for (const label of labels) {
    if (PROMPT_LABELS.has(label.name)) {
      const name = escapeHtml(label.name)
      parts.push(`<a href="#" class="label-prompt" data-issue-id="${issueId}" data-label="${escapeHtml(label.name)}">${name}</a>`)
      visiblePromptKeys.add(label.name)
    }
  }

  // Add "plan" and "code-review" links for Ready queue issues (even without labels)
  if (isEligibleForPlan(issue)) {
    const hasExistingPlanLabel = labels.some(l => l.name === 'plan')
    if (!hasExistingPlanLabel) {
      parts.push(`<a href="#" class="label-prompt state-prompt" data-issue-id="${issueId}" data-label="plan">${getPromptDisplayName('plan')}</a>`)
      visiblePromptKeys.add('plan')
    }
    const hasExistingCodeReviewLabel = labels.some(l => l.name === 'code-review')
    if (!hasExistingCodeReviewLabel) {
      parts.push(`<a href="#" class="label-prompt state-prompt" data-issue-id="${issueId}" data-label="code-review">${getPromptDisplayName('code-review')}</a>`)
      visiblePromptKeys.add('code-review')
    }
  }

  // Add universal prompts (available for all issues)
  // Skip for completed/canceled issues - they don't need action prompts
  const stateType = issue.state?.type?.toLowerCase() || ''
  const isActionable = !['completed', 'canceled'].includes(stateType)

  if (isActionable) {
    for (const label of getUniversalLabels()) {
      if (!visiblePromptKeys.has(label)) {
        parts.push(`<a href="#" class="label-prompt state-prompt" data-issue-id="${issueId}" data-label="${escapeHtml(label)}">${escapeHtml(getPromptDisplayName(label))}</a>`)
        visiblePromptKeys.add(label)
      }
    }
  }

  // Add "more" toggle if there are hidden prompts
  // Skip for completed/canceled issues
  if (isActionable && visiblePromptKeys.size > 0) {
    const allPromptKeys = getPromptLabels()
    const hiddenPromptKeys = allPromptKeys.filter(k => !visiblePromptKeys.has(k))

    if (hiddenPromptKeys.length > 0) {
      // Build hidden links
      const hiddenLinks = hiddenPromptKeys.map(key =>
        `<a href="#" class="label-prompt" data-issue-id="${issueId}" data-label="${escapeHtml(key)}">${escapeHtml(getPromptDisplayName(key))}</a>`
      ).join(' ')

      // Combine "more" toggle and hidden span as single part (no comma between them)
      parts.push(
        `<a href="#" class="label-prompt more-toggle" data-issue-id="${issueId}">more</a>` +
        `<span class="more-prompts hidden" data-more-for="${issueId}">${hiddenLinks}</span>`
      )
    }
  }

  return parts.join(' ')
}

/**
 * Render labels with promptable labels as clickable links (legacy, combines display + prompts)
 * @deprecated Use renderDisplayLabels() and renderPromptButtons() separately
 * @param {Issue} issue - The issue object
 * @param {boolean} isLanding - If true, render plain text only (no clickable links)
 * @param {'oauth'|'env'|null} openRouterSource - Source of OpenRouter API key (shows AI suggest when truthy)
 * @returns {string} HTML string of labels or empty string
 */
export function renderLabels(issue, isLanding = false, openRouterSource = null) {
  const displayLabels = renderDisplayLabels(issue)
  const promptButtons = renderPromptButtons(issue, isLanding, openRouterSource)

  if (displayLabels && promptButtons) {
    return `${displayLabels} ${promptButtons}`
  }
  return displayLabels || promptButtons
}

/**
 * Render the details section for an issue with toggleable Details and Prompts sections
 * @param {Issue} issue - The issue object
 * @param {number} depth - Nesting depth
 * @param {'project'|'in-progress'} section - Section type
 * @param {boolean} isLanding - If true, skip prompt UI (landing page)
 * @param {'oauth'|'env'|null} openRouterSource - Source of OpenRouter API key
 * @param {string|null} urlKey - Current workspace URL key for API calls
 * @returns {string} HTML for details section (empty string if no details)
 */
function renderDetails(issue, depth, section = 'project', isLanding = false, openRouterSource = null, urlKey = null) {
  const lines = []

  // ==========================================================================
  // Collect Details content (description + metadata with display labels)
  // ==========================================================================
  const detailsContent = []

  // Description (can be multiple lines)
  // Check for --- delimited prompt blocks (used on landing page for copyable prompts)
  if (issue.description) {
    const desc = issue.description.trim()
    const promptBlockMatch = desc.match(/^([\s\S]*?)---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/)

    if (promptBlockMatch) {
      // Has a prompt block: render intro, prompt block, then remainder
      const [, intro, promptContent, remainder] = promptBlockMatch

      // Render intro lines
      if (intro.trim()) {
        for (const line of intro.trim().split('\n').slice(0, 3)) {
          if (line.trim()) {
            detailsContent.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
          }
        }
      }

      // Render prompt block using shared helper (same structure as project view)
      if (promptContent.trim()) {
        detailsContent.push(renderPromptContainer({ name: 'Setup Prompt', content: escapeHtml(promptContent.trim()) }))
      }

      // Render remainder if any
      if (remainder?.trim()) {
        for (const line of remainder.trim().split('\n').slice(0, 2)) {
          if (line.trim()) {
            detailsContent.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
          }
        }
      }
    } else {
      // No prompt block: render normally
      const descLines = desc.split('\n').slice(0, 3) // Max 3 lines
      for (const line of descLines) {
        if (line.trim()) {
          detailsContent.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
        }
      }
    }
  }

  // Metadata line (with display labels only, no prompt buttons)
  const meta = []
  if (issue.assignee?.name) {
    meta.push(issue.assignee.name)
  }
  if (issue.estimate) {
    meta.push(`${issue.estimate} pts`)
  }
  if (issue.completedAt) {
    meta.push(`completed ${formatDate(issue.completedAt)}`)
  } else if (issue.dueDate) {
    meta.push(`due ${formatDate(issue.dueDate)}`)
  }
  // Only display labels (non-promptable) in the Details section
  const displayLabelsHtml = renderDisplayLabels(issue)
  if (displayLabelsHtml) {
    meta.push(displayLabelsHtml)
  }

  if (meta.length > 0) {
    detailsContent.push(`<div class="detail-line"><span class="detail-meta">${meta.join(' · ')}</span></div>`)
  }

  // ==========================================================================
  // Collect Prompts content (prompt buttons + containers)
  // Only for authenticated users (not landing page)
  // ==========================================================================
  const promptsContent = []

  if (!isLanding) {
    // Prompt buttons row
    const promptButtonsHtml = renderPromptButtons(issue, isLanding, openRouterSource)
    if (promptButtonsHtml) {
      promptsContent.push(`<div class="detail-line"><span class="detail-prompts">${promptButtonsHtml}</span></div>`)
    }

    // Interactive prompt container (populated via JS when prompt button clicked)
    promptsContent.push(renderPromptContainer({ issueId: issue.id, urlKey }))

    // Recommendation container for AI-generated prompts
    const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
    promptsContent.push(`<div class="recommend-container hidden" data-recommend-for="${issue.id}"${urlKeyAttr}><div class="recommend-header"><span class="recommend-title">AI Suggestion</span><div class="recommend-header-actions"><button class="reasoning-toggle">show reasoning</button><button class="recommend-close">dismiss</button></div></div><div class="recommend-reasoning hidden"></div><div class="recommend-prompt hidden"><div class="prompt-header"><span class="prompt-name">Generated Prompt</span><div class="prompt-actions"><button class="prompt-dispatch">dispatch</button><button class="prompt-copy">copy</button></div></div><div class="prompt-text"></div></div></div>`)
  }

  // ==========================================================================
  // Render toggleable sections
  // ==========================================================================
  const hasDetailsContent = detailsContent.length > 0
  const hasPromptsContent = promptsContent.length > 0

  // Details toggle + content
  if (hasDetailsContent) {
    lines.push(`<div class="detail-toggle" data-toggle="details">Details ▶</div>`)
    lines.push(`<div class="detail-content hidden" data-content="details">${detailsContent.join('')}</div>`)
  }

  // Prompts toggle + content (authenticated users only)
  if (hasPromptsContent) {
    lines.push(`<div class="detail-toggle" data-toggle="prompts">Prompts ▶</div>`)
    lines.push(`<div class="detail-content hidden" data-content="prompts">${promptsContent.join('')}</div>`)
  }

  // ==========================================================================
  // View in Linear link (outside both sections)
  // ==========================================================================
  if (issue.url) {
    const linkText = issue.linkText || 'View in Linear →'
    const target = issue.sameTab ? '' : ' target="_blank"'
    lines.push(`<div class="detail-line"><a href="${issue.url}"${target} class="detail-link">${linkText}</a></div>`)
  }

  if (lines.length === 0) return ''

  return `<div class="details hidden" data-details-for="${issue.id}" data-section="${section}" style="--depth: ${depth}">${lines.join('')}</div>`
}

/**
 * Format a date string for display
 */
function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getDate()}`
}

/**
 * Format a date as relative time (e.g., "2h ago", "yesterday")
 */
function formatRelativeTime(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(dateStr)
}

/**
 * Render the login page
 * @returns {string} Full HTML document
 */
export function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - Projects</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <h1>Linear Projects Viewer</h1>
  <div class="login-container">
    <p>Sign in to view your Linear projects</p>
    <a href="/auth/linear" class="login-button">Login with Linear</a>
  </div>
</body>
</html>`
}

/**
 * Render a user-friendly error page
 * @param {string} title - Short error title
 * @param {string} message - User-friendly error message
 * @param {Object} options - Optional settings
 * @param {string} options.action - Link text for the action button
 * @param {string} options.actionUrl - URL for the action button
 * @returns {string} Full HTML document
 */
export function renderErrorPage(title, message, options = {}) {
  const { action = 'Go back', actionUrl = '/' } = options;

  const homeLink = actionUrl !== '/'
    ? `<a href="/" class="error-home-link">Go to homepage</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Projects</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>Linear Projects Viewer</h1>
  </header>
  <div class="error-container">
    <div class="error-title">${escapeHtml(title)}</div>
    <p class="error-message">${escapeHtml(message)}</p>
    <a href="${escapeHtml(actionUrl)}" class="login-button">${escapeHtml(action)}</a>
    ${homeLink}
  </div>
</body>
</html>`;
}

/**
 * Render the "workspace not found" error page
 * Shows the invalid urlKey and lists available workspaces to switch to.
 * @param {string} urlKey - The invalid URL key that was attempted
 * @param {import('./workspace.js').Workspace[]} workspaces - Array of user's workspaces
 * @returns {string} Full HTML document
 */
export function renderWorkspaceNotFoundPage(urlKey, workspaces = []) {
  const workspaceListHtml = workspaces.length > 0
    ? `<div class="workspace-list">
        <p>Your workspaces:</p>
        <ul>
          ${workspaces.map(ws => `<li><a href="/workspace/${encodeURIComponent(ws.urlKey)}/">${escapeHtml(ws.name)} (${escapeHtml(ws.urlKey)})</a></li>`).join('')}
        </ul>
      </div>`
    : '';

  const addWorkspaceLink = workspaces.length > 0
    ? `<a href="/auth/linear" class="error-home-link">Connect a new workspace</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workspace Not Found - Projects</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${FAVICON_BASE64}">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>Linear Projects Viewer</h1>
  </header>
  <div class="error-container">
    <div class="error-title">Workspace Not Found</div>
    <p class="error-message">The workspace "${escapeHtml(urlKey)}" was not found in your connected workspaces.</p>
    ${workspaceListHtml}
    <a href="/" class="login-button">Go to homepage</a>
    ${addWorkspaceLink}
  </div>
</body>
</html>`;
}
