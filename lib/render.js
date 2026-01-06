// Base64-encoded SVG favicon - tree structure icon representing the CLI aesthetic
// To regenerate: create SVG, then base64 encode it
const FAVICON_BASE64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjI2IiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHBhdGggZD0iTTMgMTB2MTJoNiIgc3Ryb2tlPSIjMjIyIiBzdHJva2Utd2lkdGg9IjQiIGZpbGw9Im5vbmUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjxjaXJjbGUgY3g9IjEzIiBjeT0iMjIiIHI9IjMuNSIgZmlsbD0iIzIyMiIvPjxyZWN0IHg9IjE4IiB5PSIxMiIgd2lkdGg9IjExIiBoZWlnaHQ9IjQiIHJ4PSIxIiBmaWxsPSIjMjIyIi8+PHJlY3QgeD0iMTgiIHk9IjIwIiB3aWR0aD0iOSIgaGVpZ2h0PSI0IiByeD0iMSIgZmlsbD0iIzIyMiIvPjwvc3ZnPg=='

/**
 * Render the full HTML page for all project trees
 * @param {Array} projectTrees - Array of { project, incomplete, completed, completedCount }
 * @param {Array} inProgressTrees - Array of { projectId, projectName, roots } for in-progress tree
 * @param {string} organizationName - The Linear organization name
 * @param {Object} options - Optional settings
 * @param {boolean} options.isLanding - If true, show login link instead of logout
 * @param {Array} options.teams - Array of teams for the team selector
 * @param {string|null} options.selectedTeamId - Currently selected team ID
 * @param {Array} options.workspaces - Array of connected workspaces
 * @param {string|null} options.activeWorkspaceId - Currently active workspace ID
 * @returns {string} Full HTML document
 */
export function renderPage(projectTrees, inProgressTrees = [], organizationName = 'Projects', options = {}) {
  const { isLanding = false, teams = [], selectedTeamId = null, workspaces = [], activeWorkspaceId = null } = options
  const inProgressHtml = renderInProgressSection(inProgressTrees)
  const projectsHtml = projectTrees.map(renderProject).join('\n')

  // Navigation bar with workspace/team selectors (authenticated users only)
  const navBarHtml = !isLanding ? renderNavBar({ workspaces, activeWorkspaceId, teams, selectedTeamId }) : ''

  return `<!DOCTYPE html>
<!-- AI agents: see /llms.txt for navigation guidance -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Projects</title>
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
  <script src="/app.js"></script>
</body>
</html>`
}

/**
 * Render the unified navigation bar
 * @param {Object} options - Navigation options
 * @param {Array} options.workspaces - Array of workspaces with id, name, urlKey
 * @param {string|null} options.activeWorkspaceId - Currently active workspace ID
 * @param {Array} options.teams - Array of teams with id, name, key
 * @param {string|null} options.selectedTeamId - Currently selected team ID
 * @returns {string} HTML for navigation bar
 */
function renderNavBar({ workspaces = [], activeWorkspaceId = null, teams = [], selectedTeamId = null }) {
  const workspaceNavItem = renderWorkspaceNavItem(workspaces, activeWorkspaceId)
  const teamNavItem = renderTeamNavItem(teams, selectedTeamId)
  const workspaceOptions = renderWorkspaceOptions(workspaces, activeWorkspaceId)
  const teamOptions = renderTeamOptions(teams, selectedTeamId)

  return `
  <nav class="nav-bar" aria-label="Main navigation">
    <div class="nav-filters">
      ${workspaceNavItem}
      ${teamNavItem}
    </div>
    <div class="nav-actions">
      <a href="#" class="nav-action reset-view">reset</a>
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
 * @param {Array} inProgressTrees - Array of { projectId, projectName, roots }
 */
function renderInProgressSection(inProgressTrees) {
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
      .map((node, i, arr) => renderNode(node, i === arr.length - 1, [], 'in-progress-root', {
        section: 'in-progress',
        projectName
      }))
      .join('\n')
  }).join('\n')

  return `
  <div class="in-progress-section" role="region" aria-label="In Progress Tasks">
    <div class="in-progress-header">▼ In Progress</div>
    <div class="in-progress-items">
      ${itemsHtml}
    </div>
  </div>`
}

/**
 * Render a single project with its issues
 */
function renderProject({ project, incomplete, completed, completedCount }) {
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
    .map((node, i, arr) => renderNode(node, i === arr.length - 1, [], project.id))
    .join('\n')

  const completedToggle = completedCount > 0
    ? `<div class="completed-toggle" data-project-id="${project.id}" data-count="${completedCount}">show ${completedCount} completed</div>`
    : ''

  const completedHtml = completed.length > 0
    ? `<div data-completed-for="${project.id}" class="hidden">${completed.map((node, i, arr) => renderNode(node, i === arr.length - 1, [], project.id)).join('\n')}</div>`
    : ''

  const defaultCollapsed = project.collapsed ? ' data-default-collapsed="true"' : ''

  return `
  <div class="project" data-id="${project.id}"${defaultCollapsed}>
    <div class="project-header">${project.collapsed ? '▶' : '▼'} ${escapeHtml(project.name)}</div>
    ${description}
    ${projectLink}
    ${incompleteHtml}
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
 * @param {Object} node - The node to render
 * @param {boolean} isLast - Whether this is the last sibling
 * @param {Array<boolean>} ancestors - Array of booleans indicating if each ancestor was last
 * @param {string} parentId - The parent ID for data-parent attribute
 * @param {Object} options - Rendering options
 * @param {string} options.section - 'project' or 'in-progress'
 * @param {string} [options.projectName] - Project name to show in brackets (in-progress only, depth 0)
 * @returns {string} HTML string
 */
function renderNode(node, isLast, ancestors, parentId, options = {}) {
  const { section = 'project', projectName = null } = options
  const { issue, children, depth } = node

  // Build prefix string for the main line
  let prefix = ''
  for (let i = 0; i < ancestors.length; i++) {
    prefix += ancestors[i] ? '    ' : '│   '
  }
  prefix += isLast ? '└── ' : '├── '

  // Build continuation prefix for details (no branch char, just continuation)
  let detailPrefix = ''
  for (let i = 0; i < ancestors.length; i++) {
    detailPrefix += ancestors[i] ? '    ' : '│   '
  }
  detailPrefix += isLast ? '    ' : '│   '

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
  const line = `<div class="${lineClasses}" data-id="${issue.id}" data-parent="${parentId}" data-depth="${depth}" data-section="${section}" style="--depth: ${depth}"><span class="prefix">${prefix}</span><span class="state ${stateClass}" data-status="${stateClass}" aria-label="Status: ${stateLabel}">${stateChar}</span><span class="${titleClass}">${escapeHtml(issue.title)}</span>${projectBadge}${toggle}</div>`

  // Render details section
  const details = hasDetails ? renderDetails(issue, detailPrefix, depth, section) : ''

  // Render children
  const childrenHtml = children
    .map((child, i, arr) => renderNode(child, i === arr.length - 1, [...ancestors, isLast], issue.id, options))
    .join('\n')

  // Wrap in .node container - children go in nested .children div
  const childrenWrapper = children.length > 0
    ? `<div class="children">${childrenHtml}</div>`
    : ''

  const nodeClasses = ['node', isChildTask && 'hidden'].filter(Boolean).join(' ')

  return `<div class="${nodeClasses}" data-id="${issue.id}">${line}${details}${childrenWrapper}</div>`
}

/**
 * Render the details section for an issue
 * @param {Object} issue - The issue object
 * @param {string} prefix - Box-drawing prefix for alignment
 * @param {number} depth - Nesting depth
 * @param {string} section - 'project' or 'in-progress'
 */
function renderDetails(issue, prefix, depth, section = 'project') {
  const lines = []

  // Description (can be multiple lines)
  if (issue.description) {
    const descLines = issue.description.trim().split('\n').slice(0, 3) // Max 3 lines
    for (const line of descLines) {
      if (line.trim()) {
        lines.push(`<div class="detail-line"><span class="prefix">${prefix}  </span><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
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
  if (issue.labels?.nodes?.length > 0) {
    meta.push(issue.labels.nodes.map(l => l.name).join(', '))
  }

  if (meta.length > 0) {
    lines.push(`<div class="detail-line"><span class="prefix">${prefix}  </span><span class="detail-meta">${meta.join(' · ')}</span></div>`)
  }

  if (issue.url) {
    const linkText = issue.linkText || 'View in Linear →'
    const target = issue.sameTab ? '' : ' target="_blank"'
    lines.push(`<div class="detail-line"><span class="prefix">${prefix}  </span><a href="${issue.url}"${target} class="detail-link">${linkText}</a></div>`)
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
