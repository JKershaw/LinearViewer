/**
 * Render the full HTML page for all project trees
 * @param {Array} projectTrees - Array of { project, incomplete, completed, completedCount }
 * @returns {string} Full HTML document
 */
export function renderPage(projectTrees) {
  const projectsHtml = projectTrees.map(renderProject).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roadmap</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>Platform Roadmap</h1>
    <a href="/logout" class="logout">logout</a>
  </header>
  ${projectsHtml}
  <script src="/app.js"></script>
</body>
</html>`
}

/**
 * Render a single project with its issues
 */
function renderProject({ project, incomplete, completed, completedCount }) {
  const description = project.content
    ? renderProjectDescription(project.content, project.id)
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

  return `
  <div class="project" data-id="${project.id}">
    <div class="project-header">▼ ${escapeHtml(project.name)}</div>
    ${description}
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
  const toggle = hasChildren
    ? `<span class="toggle" data-children="${children.length}">▼</span>`
    : ''

  // Check if issue has details worth showing
  const hasDetails = issue.description || issue.assignee || issue.estimate || issue.dueDate || issue.completedAt || (issue.labels?.nodes?.length > 0)

  const lineClasses = ['line', hasDetails && 'has-details', hasChildren && 'has-children'].filter(Boolean).join(' ')
  const line = `<div class="${lineClasses}" data-id="${issue.id}" data-parent="${parentId}" data-depth="${depth}" style="--depth: ${depth}"><span class="prefix">${prefix}</span><span class="state ${stateClass}">${stateChar}</span><span class="${titleClass}">${escapeHtml(issue.title)}</span>${toggle}</div>`

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

  if (lines.length === 0) return ''

  return `<div class="details hidden" data-details-for="${issue.id}" style="--depth: ${depth}">${lines.join('')}</div>`
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
  <title>Login - Roadmap</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <h1>Platform Roadmap</h1>
  <div class="login-container">
    <p>Sign in to view your Linear roadmap</p>
    <a href="/auth/linear" class="login-button">Login with Linear</a>
  </div>
</body>
</html>`
}
