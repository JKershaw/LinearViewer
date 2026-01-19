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

// Cache prompt labels for rendering
const PROMPT_LABELS = new Set(getPromptLabels())

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
 * @property {string|null} [activeWorkspaceId] - Currently active workspace ID
 * @property {'oauth'|'env'|null} [openRouterSource] - Source of OpenRouter API key
 * @property {Object} [deployInfo] - Heroku deploy information
 * @property {string} [deployInfo.version] - HEROKU_RELEASE_VERSION
 * @property {string} [deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT
 * @property {string} [deployInfo.commit] - HEROKU_BUILD_COMMIT
 */

// Base64-encoded SVG favicon - tree structure icon representing the CLI aesthetic
// To regenerate: create SVG, then base64 encode it
const FAVICON_BASE64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjI2IiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHBhdGggZD0iTTMgMTB2MTJoNiIgc3Ryb2tlPSIjMjIyIiBzdHJva2Utd2lkdGg9IjQiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjEzIiBjeT0iMjIiIHI9IjMuNSIgZmlsbD0iIzIyMiIvPjxyZWN0IHg9IjE4IiB5PSIxMiIgd2lkdGg9IjExIiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHJlY3QgeD0iMTgiIHk9IjIwIiB3aWR0aD0iOSIgaGVpZ2h0PSI0IiByeD0iMSIgZmlsbD0iIzIyMiIvPjwvc3ZnPg=='

/**
 * Render the full HTML page for all project trees
 * @param {ProjectTree[]} projectTrees - Array of project trees with partitioned issues
 * @param {InProgressTree[]} inProgressTrees - Array of in-progress trees grouped by project
 * @param {string} organizationName - The Linear organization name
 * @param {RenderPageOptions} options - Optional settings
 * @returns {string} Full HTML document
 */
export function renderPage(projectTrees, inProgressTrees = [], organizationName = 'Projects', options = {}) {
  const { isLanding = false, teams = [], selectedTeamId = null, workspaces = [], activeWorkspaceId = null, openRouterSource = null, deployInfo = {} } = options
  const inProgressHtml = renderInProgressSection(inProgressTrees, { isLanding, openRouterSource })
  const projectsHtml = projectTrees.map(tree => renderProject(tree, { isLanding, openRouterSource })).join('\n')

  // Navigation bar with workspace/team selectors (authenticated users only)
  const navBarHtml = !isLanding ? renderNavBar({ workspaces, activeWorkspaceId, teams, selectedTeamId, openRouterSource }) : ''

  // Footer with actions and deploy info
  const footerHtml = renderFooter({ isLanding, deployInfo })

  // Get active workspace name for title (fallback to organizationName for landing/unauthenticated)
  const activeWorkspace = workspaces?.find(w => w.id === activeWorkspaceId)
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
    <h1>${escapeHtml(organizationName)}</h1>
  </header>
  <main>
    ${inProgressHtml}
    <section role="region" aria-label="Projects">
      ${projectsHtml}
    </section>
  </main>
  ${footerHtml}
  <script src="/marked.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>`
}

/**
 * Render the unified navigation bar
 * @param {Object} options - Navigation options
 * @param {Workspace[]} options.workspaces - Array of connected workspaces
 * @param {string|null} options.activeWorkspaceId - Currently active workspace ID
 * @param {Team[]} options.teams - Array of teams
 * @param {string|null} options.selectedTeamId - Currently selected team ID
 * @param {'oauth'|'env'|null} options.openRouterSource - Source of OpenRouter API key
 * @returns {string} HTML for navigation bar
 */
function renderNavBar({ workspaces = [], activeWorkspaceId = null, teams = [], selectedTeamId = null, openRouterSource = null }) {
  const workspaceNavItem = renderWorkspaceNavItem(workspaces, activeWorkspaceId)
  const teamNavItem = renderTeamNavItem(teams, selectedTeamId)
  const openRouterNavItem = renderOpenRouterNavItem(openRouterSource)
  const workspaceOptions = renderWorkspaceOptions(workspaces, activeWorkspaceId)
  const teamOptions = renderTeamOptions(teams, selectedTeamId)

  return `
  <nav class="nav-bar" aria-label="Main navigation">
    <div class="nav-filters">
      ${workspaceNavItem}
      ${teamNavItem}
      ${openRouterNavItem}
    </div>
    <div class="nav-actions">
      <a href="/logout" class="nav-action">logout</a>
    </div>
  </nav>
  ${workspaceOptions}
  ${teamOptions}`
}

/**
 * Render workspace nav item (the clickable "workspace: value" text)
 */
function renderWorkspaceNavItem(workspaces, activeWorkspaceId) {
  if (!workspaces?.length) return ''
  const active = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0]

  return `<div class="nav-item" data-selector="workspace">
      <span class="nav-label">workspace:</span>
      <button class="nav-value" id="workspace-toggle" aria-expanded="false" aria-haspopup="listbox" aria-controls="workspace-options">${escapeHtml(active.urlKey)}</button>
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
 */
function renderOpenRouterNavItem(source) {
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

  return `<div class="nav-item" data-selector="openrouter">
      <span class="nav-label">ai:</span>
      <a href="/settings" class="nav-value nav-openrouter-status ${statusClass}" title="OpenRouter: ${statusText}">${statusIcon}</a>
    </div>`
}

/**
 * Render workspace options panel (appears when workspace toggle is clicked)
 * Each workspace on its own row. Current workspace row includes "remove".
 * "+add" appears at the bottom where a new workspace would go.
 * Uses box-drawing characters for CLI aesthetic.
 */
function renderWorkspaceOptions(workspaces, activeWorkspaceId) {
  if (!workspaces?.length) return ''

  const optionsHtml = workspaces.map(ws => {
    const isActive = ws.id === activeWorkspaceId
    const marker = isActive ? '●' : '○'
    const selectedClass = isActive ? ' selected' : ''
    const ariaSelected = isActive ? 'true' : 'false'

    // Only show remove button on the current (active) workspace row
    const removeBtn = isActive
      ? `<form action="/workspace/${ws.id}/remove" method="POST" class="nav-option-form" data-confirm="Remove this workspace?">
          <button type="submit" class="nav-option nav-option-danger">remove</button>
        </form>`
      : ''

    return `<div class="nav-options-row">
      <span class="option-prefix">├─</span>
      <form action="/workspace/${ws.id}/switch" method="POST" class="nav-option-form">
        <button type="submit" class="nav-option${selectedClass}" role="option" aria-selected="${ariaSelected}">
          <span class="option-marker">${marker}</span> ${escapeHtml(ws.urlKey)}
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
 */
function renderTeamOptions(teams, selectedTeamId) {
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

  return `
  <div class="nav-options-panel hidden" id="team-options" role="listbox" aria-label="Select team">
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
 * @returns {string} HTML for in-progress section
 */
function renderInProgressSection(inProgressTrees, options = {}) {
  const { isLanding = false, openRouterSource = null } = options
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
        openRouterSource
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
 * Render a single project with its issues
 * @param {ProjectTree} projectTree - Project tree with partitioned issues
 * @param {Object} options - Rendering options
 * @param {boolean} options.isLanding - If true, skip prompt UI (landing page)
 * @param {'oauth'|'env'|null} options.openRouterSource - Source of OpenRouter API key
 * @returns {string} HTML for project section
 */
function renderProject({ project, incomplete, completed, completedCount }, options = {}) {
  const { isLanding = false, openRouterSource = null } = options
  const description = project.content
    ? renderProjectDescription(project.content, project.id)
    : ''

  const hasDescription = !!project.content
  const projectLinkText = project.linkText || 'View in Linear →'
  const projectTarget = project.sameTab ? '' : ' target="_blank"'
  const projectLink = project.url
    ? `<div class="project-meta${hasDescription ? ' hidden' : ''}"><a href="${project.url}"${projectTarget} class="detail-link">${projectLinkText}</a></div>`
    : ''

  const incompleteHtml = incomplete
    .map(node => renderNode(node, project.id, { isLanding, openRouterSource }))
    .join('\n')

  const completedToggle = completedCount > 0
    ? `<div class="completed-toggle" data-project-id="${project.id}" data-count="${completedCount}">show ${completedCount} completed</div>`
    : ''

  const completedHtml = completed.length > 0
    ? `<div class="tree hidden" data-completed-for="${project.id}">${completed.map(node => renderNode(node, project.id, { isLanding, openRouterSource })).join('\n')}</div>`
    : ''

  const defaultCollapsed = project.collapsed ? ' data-default-collapsed="true"' : ''

  // Wrap incomplete nodes in .tree container for CSS-based tree lines
  const incompleteTree = incomplete.length > 0
    ? `<div class="tree">${incompleteHtml}</div>`
    : ''

  return `
  <div class="project" data-id="${project.id}"${defaultCollapsed}>
    <div class="project-header">${project.collapsed ? '▶' : '▼'} ${escapeHtml(project.name)}</div>
    ${description}
    ${projectLink}
    ${incompleteTree}
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
 * @returns {string} HTML string
 */
function renderNode(node, parentId, options = {}) {
  const { section = 'project', projectName = null, isLanding = false, openRouterSource = null } = options
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

  // Project name badge for in-progress section (only at depth 0)
  const projectBadge = (section === 'in-progress' && depth === 0 && projectName)
    ? `<span class="in-progress-project">(${escapeHtml(projectName)})</span>`
    : ''

  // Child tasks (depth > 0) start hidden - hidden class now on .node wrapper
  const isChildTask = depth > 0
  const lineClasses = ['line', canExpand && 'expandable', hasChildren && 'has-children'].filter(Boolean).join(' ')
  const line = `<div class="${lineClasses}" data-id="${issue.id}" data-parent="${parentId}" data-depth="${depth}" data-section="${section}" style="--depth: ${depth}"><span class="state ${stateClass}" data-status="${stateClass}" aria-label="Status: ${stateLabel}">${stateChar}</span><span class="${titleClass}">${escapeHtml(issue.title)}</span>${projectBadge}${toggle}</div>`

  // Render details section
  const details = hasDetails ? renderDetails(issue, depth, section, isLanding, openRouterSource) : ''

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
 * Render labels with promptable labels as clickable links
 * Also adds a "plan" link for issues in the Ready queue (state-based)
 * Includes "more" toggle to reveal all available prompt templates
 * @param {Issue} issue - The issue object
 * @param {boolean} isLanding - If true, render plain text only (no clickable links)
 * @param {'oauth'|'env'|null} openRouterSource - Source of OpenRouter API key (shows AI suggest when truthy)
 * @returns {string} HTML string of labels or empty string
 */
export function renderLabels(issue, isLanding = false, openRouterSource = null) {
  const labels = issue.labels?.nodes || []
  const issueId = issue.id
  const parts = []
  const visiblePromptKeys = new Set()

  // Add "AI suggest" button at the start (only for authenticated users with OpenRouter configured)
  if (!isLanding && openRouterSource) {
    parts.push(`<a href="#" class="label-prompt suggest-btn" data-issue-id="${issueId}" title="Get AI recommendation">AI suggest</a>`)
  }

  // Render existing labels
  for (const label of labels) {
    const name = escapeHtml(label.name)
    if (!isLanding && PROMPT_LABELS.has(label.name)) {
      // Promptable label - render as clickable link
      parts.push(`<a href="#" class="label-prompt" data-issue-id="${issueId}" data-label="${escapeHtml(label.name)}">${name}</a>`)
      visiblePromptKeys.add(label.name)
    } else {
      // Regular label - just text
      parts.push(name)
    }
  }

  // Add "plan" and "code-review" links for Ready queue issues (even without labels)
  // Skip on landing page - these are interactive features requiring auth
  if (!isLanding && isEligibleForPlan(issue)) {
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
  // Skip on landing page - these are interactive features requiring auth
  // Skip for completed/canceled issues - they don't need action prompts
  const stateType = issue.state?.type?.toLowerCase() || ''
  const isActionable = !['completed', 'canceled'].includes(stateType)

  if (!isLanding && isActionable) {
    for (const label of getUniversalLabels()) {
      if (!visiblePromptKeys.has(label)) {
        parts.push(`<a href="#" class="label-prompt state-prompt" data-issue-id="${issueId}" data-label="${escapeHtml(label)}">${escapeHtml(getPromptDisplayName(label))}</a>`)
        visiblePromptKeys.add(label)
      }
    }
  }

  // Add "more" toggle if there are hidden prompts (only for authenticated users)
  // Skip for completed/canceled issues
  if (!isLanding && isActionable && visiblePromptKeys.size > 0) {
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
 * Render the details section for an issue
 * @param {Issue} issue - The issue object
 * @param {number} depth - Nesting depth
 * @param {'project'|'in-progress'} section - Section type
 * @param {boolean} isLanding - If true, skip prompt UI (landing page)
 * @param {'oauth'|'env'|null} openRouterSource - Source of OpenRouter API key
 * @returns {string} HTML for details section (empty string if no details)
 */
function renderDetails(issue, depth, section = 'project', isLanding = false, openRouterSource = null) {
  const lines = []

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
            lines.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
          }
        }
      }

      // Render prompt block using existing prompt-container styles (consistent with projects page)
      if (promptContent.trim()) {
        lines.push(`<div class="prompt-container"><div class="prompt-text">${escapeHtml(promptContent.trim())}</div></div>`)
      }

      // Render remainder if any
      if (remainder?.trim()) {
        for (const line of remainder.trim().split('\n').slice(0, 2)) {
          if (line.trim()) {
            lines.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
          }
        }
      }
    } else {
      // No prompt block: render normally
      const descLines = desc.split('\n').slice(0, 3) // Max 3 lines
      for (const line of descLines) {
        if (line.trim()) {
          lines.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
        }
      }
    }
  }

  // Metadata line
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
  // Render labels - promptable labels become clickable links (unless on landing page)
  // Also adds plan link for Ready queue issues
  const labelHtml = renderLabels(issue, isLanding, openRouterSource)
  if (labelHtml) {
    meta.push(labelHtml)
  }

  if (meta.length > 0) {
    lines.push(`<div class="detail-line"><span class="detail-meta">${meta.join(' · ')}</span></div>`)
  }

  // Add prompt container for all issues (universal prompts are always available)
  // Skip on landing page - prompt UI requires authentication
  if (!isLanding) {
    lines.push(`<div class="prompt-container hidden" data-prompt-for="${issue.id}"><div class="prompt-header"><span class="prompt-name"></span><button class="prompt-copy">copy</button></div><div class="prompt-text"></div></div>`)
    // Add recommendation container for AI-generated prompts
    // Note: recommend-prompt starts hidden and is revealed only when the prompt is ready
    // Note: recommend-alert is hidden by default, shown when AI detects label mismatch
    lines.push(`<div class="recommend-container hidden" data-recommend-for="${issue.id}"><div class="recommend-header"><span class="recommend-title">AI Suggestion</span><button class="recommend-close">dismiss</button></div><div class="recommend-alert hidden"></div><div class="recommend-reasoning"></div><div class="recommend-prompt hidden"><div class="prompt-header"><span class="prompt-name">Generated Prompt</span><button class="prompt-copy">copy</button></div><div class="prompt-text"></div></div></div>`)
  }

  if (issue.url) {
    const linkText = issue.linkText || 'View in Linear →'
    const target = issue.sameTab ? '' : ' target="_blank"'
    lines.push(`<div class="detail-line"><a href="${issue.url}"${target} class="detail-link">${linkText}</a></div>`)
  }

  if (lines.length === 0) return ''

  return `<div class="details hidden" data-details-for="${issue.id}" data-section="${section}" style="--depth: ${depth}">${lines.join('')}</div>`
}

/**
 * Render the page footer with actions and deploy info
 * @param {Object} options - Footer options
 * @param {boolean} options.isLanding - If true, hide reset/audit links (unauthenticated)
 * @param {Object} options.deployInfo - Heroku deploy information
 * @param {string} [options.deployInfo.version] - HEROKU_RELEASE_VERSION (e.g., "v42")
 * @param {string} [options.deployInfo.createdAt] - HEROKU_RELEASE_CREATED_AT (ISO timestamp)
 * @param {string} [options.deployInfo.commit] - HEROKU_BUILD_COMMIT (full SHA)
 * @returns {string} HTML for footer
 */
function renderFooter(options = {}) {
  const { isLanding = false, deployInfo = {} } = options

  // Build action links (only for authenticated users)
  const actions = []
  if (!isLanding) {
    actions.push('<a href="#" class="footer-action reset-view">reset</a>')
    actions.push('<a href="/settings" class="footer-action">settings</a>')
    actions.push('<a href="/prompts" class="footer-action">prompts</a>')
    actions.push('<a href="/fancy" class="footer-action">audit</a>')
  }
  const actionsHtml = actions.length > 0
    ? `<div class="footer-actions">${actions.join(' · ')}</div>`
    : ''

  // Build deploy info
  let deployHtml = ''
  if (deployInfo.version) {
    const parts = []

    // Version (e.g., "v42")
    parts.push(deployInfo.version)

    // Deploy date/time - render with data attribute for client-side local timezone formatting
    // Initial text is server-rendered fallback, JS will update to include local time
    if (deployInfo.createdAt) {
      const date = new Date(deployInfo.createdAt)
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const fallbackText = `deployed ${months[date.getMonth()]} ${date.getDate()}`
      // Escape timestamp for safe HTML attribute insertion
      parts.push(`<span class="deploy-time" data-timestamp="${escapeHtml(deployInfo.createdAt)}">${fallbackText}</span>`)
    }

    // Commit hash linked to GitHub (e.g., "abc123")
    if (deployInfo.commit) {
      const shortCommit = deployInfo.commit.slice(0, 7)
      parts.push(`<a href="https://github.com/JKershaw/LinearViewer/commit/${deployInfo.commit}" target="_blank" class="footer-link">${shortCommit}</a>`)
    }

    deployHtml = `<div class="footer-deploy">${parts.join(' · ')}</div>`
  } else {
    // Fallback: link to GitHub repo
    deployHtml = '<div class="footer-deploy"><a href="https://github.com/JKershaw/LinearViewer" target="_blank" class="footer-link">github.com/JKershaw/LinearViewer</a></div>'
  }

  return `
  <footer class="page-footer">
    ${actionsHtml}
    ${deployHtml}
  </footer>`
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
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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
