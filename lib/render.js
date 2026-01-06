/**
 * Render the full HTML page for all project trees
 * @param {Array} projectTrees - Array of { project, incomplete, completed, completedCount }
 * @param {Array} inProgressIssues - Array of in-progress issues with projectName
 * @param {string} organizationName - The Linear organization name
 * @param {Object} options - Optional settings
 * @param {boolean} options.isLanding - If true, show login link instead of logout
 * @param {Array} options.teams - Array of teams for the team selector
 * @param {string|null} options.selectedTeamId - Currently selected team ID
 * @param {Array} options.workspaces - Array of connected workspaces
 * @param {string|null} options.activeWorkspaceId - Currently active workspace ID
 * @returns {string} Full HTML document
 */
export function renderPage(projectTrees, inProgressIssues = [], organizationName = 'Projects', options = {}) {
  const { isLanding = false, teams = [], selectedTeamId = null, workspaces = [], activeWorkspaceId = null } = options
  const inProgressHtml = renderInProgressSection(inProgressIssues)
  const projectsHtml = projectTrees.map(renderProject).join('\n')
  const teamSelectorHtml = !isLanding && teams.length > 0 ? renderTeamSelector(teams, selectedTeamId) : ''
  const workspaceSwitcherHtml = !isLanding && workspaces.length > 0 ? renderWorkspaceSwitcher(workspaces, activeWorkspaceId) : ''

  const headerNav = isLanding
    ? ''
    : `<nav class="header-actions">
      <a href="#" class="reset-view">reset</a>
      <a href="/logout" class="logout">logout</a>
    </nav>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Projects</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body${isLanding ? ' class="is-landing"' : ''}>
  <header>
    ${workspaceSwitcherHtml}
    <h1>${escapeHtml(organizationName)}</h1>
    ${headerNav}
  </header>
  ${teamSelectorHtml}
  ${inProgressHtml}
  ${projectsHtml}
  <script src="/app.js"></script>
</body>
</html>`
}

/**
 * Render the team selector dropdown
 * @param {Array} teams - Array of teams with id, name, key
 * @param {string|null} selectedTeamId - Currently selected team ID
 * @returns {string} HTML for team selector
 */
function renderTeamSelector(teams, selectedTeamId) {
  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name))
  const optionsHtml = sortedTeams.map(team => {
    const selected = team.id === selectedTeamId ? ' selected' : ''
    return `<option value="${team.id}"${selected}>${escapeHtml(team.name)}</option>`
  }).join('\n      ')

  const allSelected = !selectedTeamId ? ' selected' : ''

  return `
  <div class="team-selector">
    <label for="team-filter">Team:</label>
    <select id="team-filter">
      <option value="all"${allSelected}>All Teams</option>
      ${optionsHtml}
    </select>
  </div>`
}

/**
 * Render the workspace switcher dropdown
 * @param {Array} workspaces - Array of workspaces with id, name, urlKey
 * @param {string|null} activeWorkspaceId - Currently active workspace ID
 * @returns {string} HTML for workspace switcher
 */
function renderWorkspaceSwitcher(workspaces, activeWorkspaceId) {
  if (!workspaces?.length) return '';
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];

  const workspaceItemsHtml = workspaces.map(workspace => {
    const isActive = workspace.id === activeWorkspaceId
    const indicator = isActive ? '●' : '○'
    const activeClass = isActive ? ' active' : ''

    return `<form action="/workspace/${workspace.id}/switch" method="POST" class="workspace-form">
        <button type="submit" class="workspace-item${activeClass}" role="menuitem">
          <span class="workspace-indicator">${indicator}</span> ${escapeHtml(workspace.urlKey)}
        </button>
      </form>`
  }).join('\n      ')

  return `<div class="workspace-switcher" id="workspace-switcher">
    <button class="current-workspace" aria-expanded="false" aria-haspopup="true">
      <span class="workspace-name">${escapeHtml(activeWorkspace.urlKey)}</span>
      <span class="dropdown-arrow">▼</span>
    </button>
    <div class="workspace-dropdown" role="menu">
      ${workspaceItemsHtml}
      <hr>
      <a href="/auth/linear" class="add-workspace" role="menuitem">+ Add Workspace</a>
      <hr>
      <form action="/workspace/${activeWorkspace.id}/remove" method="POST" class="workspace-form" onsubmit="return confirm('Remove this workspace?')">
        <button type="submit" class="remove-workspace" role="menuitem">
          Remove current workspace
        </button>
      </form>
    </div>
  </div>`
}

/**
 * Render the in-progress section
 */
function renderInProgressSection(issues) {
  if (issues.length === 0) return ''

  const itemsHtml = issues.map(issue => {
    const projectPart = issue.projectName
      ? `<span class="in-progress-project">(${escapeHtml(issue.projectName)})</span>`
      : ''
    const assigneePart = issue.assignee?.name
      ? `<span class="in-progress-assignee"> — ${escapeHtml(issue.assignee.name)}</span>`
      : ''

    const hasDetails = issue.url || issue.description || issue.estimate || issue.dueDate || (issue.labels?.nodes?.length > 0)
    const toggle = hasDetails ? `<span class="toggle">▶</span>` : ''

    return `<div class="in-progress-item${hasDetails ? ' expandable' : ''}" data-id="${issue.id}" data-section="in-progress">
      <span class="state in-progress">◐</span>
      <span class="title">${escapeHtml(issue.title)}</span>
      ${projectPart}${assigneePart}${toggle}
    </div>${hasDetails ? renderInProgressDetails(issue) : ''}`
  }).join('\n')

  return `
  <div class="in-progress-section">
    <div class="in-progress-header">▼ In Progress (${issues.length})</div>
    <div class="in-progress-items">
      ${itemsHtml}
    </div>
  </div>`
}

/**
 * Render details for an in-progress item
 */
function renderInProgressDetails(issue) {
  const lines = []

  if (issue.description) {
    const descLines = issue.description.trim().split('\n').slice(0, 3)
    for (const line of descLines) {
      if (line.trim()) {
        lines.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
      }
    }
  }

  const meta = []
  if (issue.estimate) {
    meta.push(`${issue.estimate} pts`)
  }
  if (issue.dueDate) {
    meta.push(`due ${formatDate(issue.dueDate)}`)
  }
  if (issue.labels?.nodes?.length > 0) {
    meta.push(issue.labels.nodes.map(l => l.name).join(', '))
  }

  if (meta.length > 0) {
    lines.push(`<div class="detail-line"><span class="detail-meta">${meta.join(' · ')}</span></div>`)
  }

  if (issue.url) {
    const linkText = issue.linkText || 'View in Linear →'
    const target = issue.sameTab ? '' : ' target="_blank"'
    lines.push(`<div class="detail-line"><a href="${issue.url}"${target} class="detail-link">${linkText}</a></div>`)
  }

  if (lines.length === 0) return ''

  return `<div class="details hidden" data-details-for="${issue.id}" data-section="in-progress">${lines.join('')}</div>`
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
    ? `<div class="completed-toggle" data-project-id="${project.id}" data-count="${completedCount}">┄ show ${completedCount} completed ┄</div>`
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
 * @returns {string} HTML string
 */
function renderNode(node, isLast, ancestors, parentId) {
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
  let stateClass, stateChar
  if (stateType === 'completed' || stateType === 'canceled') {
    stateClass = 'done'
    stateChar = '✓'
  } else if (stateType === 'started') {
    stateClass = 'in-progress'
    stateChar = '◐'
  } else {
    stateClass = 'todo'
    stateChar = '○'
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

  // Child tasks (depth > 0) start hidden
  const isChildTask = depth > 0
  const lineClasses = ['line', canExpand && 'expandable', hasChildren && 'has-children', isChildTask && 'hidden'].filter(Boolean).join(' ')
  const line = `<div class="${lineClasses}" data-id="${issue.id}" data-parent="${parentId}" data-depth="${depth}" data-section="project" style="--depth: ${depth}"><span class="prefix">${prefix}</span><span class="state ${stateClass}">${stateChar}</span><span class="${titleClass}">${escapeHtml(issue.title)}</span>${toggle}</div>`

  // Render details section
  const details = hasDetails ? renderDetails(issue, detailPrefix, depth) : ''

  // Render children
  const childrenHtml = children
    .map((child, i, arr) => renderNode(child, i === arr.length - 1, [...ancestors, isLast], issue.id))
    .join('\n')

  return line + details + childrenHtml
}

/**
 * Render the details section for an issue
 */
function renderDetails(issue, prefix, depth) {
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

  return `<div class="details hidden" data-details-for="${issue.id}" data-section="project" style="--depth: ${depth}">${lines.join('')}</div>`
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
