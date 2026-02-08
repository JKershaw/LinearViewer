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

import { getPromptLabels, getPromptDisplayName } from './prompt-templates.js'
import { escapeHtml, FAVICON_BASE64 } from './utils/html.js'
import { renderPageFooter } from './components/footer.js'
import { renderNavBar } from './components/navbar.js'

// Cache prompt labels for rendering
const PROMPT_LABELS = new Set(getPromptLabels())

// Prompts shown by default for every actionable issue
const DEFAULT_PROMPT_KEYS = ['look-into', 'research', 'plan', 'implementation']
const DEFAULT_PROMPT_KEY_SET = new Set(DEFAULT_PROMPT_KEYS)

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
function renderPromptContainer({ name = '', content = '', issueId = '', urlKey = '', dispatchEnabled = false } = {}) {
  const hiddenClass = content ? '' : ' hidden'
  const issueAttr = issueId ? ` data-prompt-for="${escapeHtml(issueId)}"` : ''
  const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
  const dispatchBtn = dispatchEnabled ? '<button class="prompt-dispatch dispatch-btn">dispatch</button>' : ''

  return `<div class="prompt-container${hiddenClass}"${issueAttr}${urlKeyAttr}><div class="prompt-header"><span class="prompt-name">${escapeHtml(name)}</span><div class="prompt-actions">${dispatchBtn}<button class="prompt-copy">copy</button></div></div><div class="prompt-text">${content}</div></div>`
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
  const { isLanding = false, teams = [], selectedTeamId = null, workspaces = [], openRouterSource = null, urlKey = null, deployInfo = {}, featureFlags = {} } = options
  const inProgressHtml = renderInProgressSection(inProgressTrees, { isLanding, openRouterSource, urlKey, featureFlags })
  const recentActivityHtml = renderRecentActivitySection(recentActivityTrees, { isLanding, openRouterSource, urlKey, featureFlags })
  const projectsHtml = projectTrees.map(tree => renderProject(tree, { isLanding, openRouterSource, urlKey, featureFlags })).join('\n')

  // Navigation bar with workspace/team selectors (authenticated users only)
  // Uses urlKey from URL to determine active workspace (enables multi-tab support)
  const navBarHtml = !isLanding ? renderNavBar({ workspaces, teams, selectedTeamId, urlKey, currentPage: 'projects', featureFlags }) : ''

  // Footer with actions and deploy info
  const footerHtml = renderPageFooter({
    isLanding,
    deployInfo,
    showReset: true,
    urlKey,
    openRouterSource
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
  <!-- common.js must load first: provides escapeHtml() used by app.js -->
  <script src="/common.js"></script>
  <script src="/purify.min.js"></script>
  <script src="/marked.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>`
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
  const { isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {} } = options
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
        urlKey,
        featureFlags
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
  const { isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {} } = options
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
      urlKey,
      featureFlags
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
  const { isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {} } = options
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
    .map(node => renderNode(node, project.id, { isLanding, openRouterSource, urlKey, featureFlags }))
    .join('\n')

  const completedToggle = completedCount > 0
    ? `<div class="completed-toggle" data-project-id="${project.id}" data-count="${completedCount}">show ${completedCount} completed</div>`
    : ''

  const completedHtml = completed.length > 0
    ? `<div class="tree hidden" data-completed-for="${project.id}">${completed.map(node => renderNode(node, project.id, { isLanding, openRouterSource, urlKey, featureFlags })).join('\n')}</div>`
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
  const { section = 'project', projectName = null, isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {} } = options
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
  } else if (stateType === 'backlog') {
    stateClass = 'backlog'
    stateChar = '◌'
    stateLabel = 'Backlog'
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

  // Build search text from all searchable fields (lowercased for case-insensitive matching)
  // Join raw fields first so search input matches actual content (not HTML entities),
  // then escape once for safe HTML attribute insertion
  const searchParts = [
    issue.title,
    issue.description || '',
    issue.assignee?.name || '',
    issue.identifier || '',
    ...(issue.labels?.nodes || []).map(l => l.name)
  ]
  const searchText = escapeHtml(searchParts.join(' ').toLowerCase())

  // Child tasks (depth > 0) start hidden - hidden class now on .node wrapper
  const isChildTask = depth > 0
  const lineClasses = ['line', canExpand && 'expandable', hasChildren && 'has-children'].filter(Boolean).join(' ')
  const line = `<div class="${lineClasses}" data-id="${issue.id}" data-parent="${parentId}" data-depth="${depth}" data-section="${section}" data-search-text="${searchText}" style="--depth: ${depth}"><span class="state ${stateClass}" data-status="${stateClass}" aria-label="Status: ${stateLabel}">${stateChar}</span><span class="${titleClass}">${escapeHtml(issue.title)}</span>${timeBadge}${projectBadge}${toggle}</div>`

  // Render details section
  const details = hasDetails ? renderDetails(issue, depth, section, isLanding, openRouterSource, urlKey, featureFlags) : ''

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
  if (isLanding) return ''

  const issueId = issue.id
  const parts = []

  // AI suggest button (only for authenticated users with OpenRouter configured)
  if (openRouterSource) {
    parts.push(`<a href="#" class="label-prompt suggest-btn" data-issue-id="${issueId}" title="Get AI recommendation">AI suggest</a>`)
  }

  // No prompts for completed/canceled issues
  const stateType = issue.state?.type?.toLowerCase() || ''
  if (['completed', 'canceled'].includes(stateType)) return parts.join(' ')

  // Default prompts — same for every actionable issue
  for (const key of DEFAULT_PROMPT_KEYS) {
    parts.push(`<a href="#" class="label-prompt" data-issue-id="${issueId}" data-label="${key}">${escapeHtml(getPromptDisplayName(key))}</a>`)
  }

  // Everything else behind "more"
  const hiddenKeys = getPromptLabels().filter(k => !DEFAULT_PROMPT_KEY_SET.has(k))
  if (hiddenKeys.length > 0) {
    const hiddenLinks = hiddenKeys.map(key =>
      `<a href="#" class="label-prompt" data-issue-id="${issueId}" data-label="${escapeHtml(key)}">${escapeHtml(getPromptDisplayName(key))}</a>`
    ).join(' ')

    parts.push(
      `<a href="#" class="label-prompt more-toggle" data-issue-id="${issueId}">more</a>` +
      `<span class="more-prompts hidden" data-more-for="${issueId}">${hiddenLinks}</span>`
    )
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
function renderDetails(issue, depth, section = 'project', isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {}) {
  const lines = []

  // ==========================================================================
  // Collect Details content (description + metadata with display labels)
  // ==========================================================================
  const detailsContent = []

  // Description (can be multiple lines)
  // Check for --- delimited prompt blocks (ONLY on landing page for copyable prompts)
  // LIN-151: Previously this matched all descriptions, causing real Linear issues
  // with --- markdown separators to incorrectly render as prompt containers
  if (issue.description) {
    const desc = issue.description.trim()
    const promptBlockMatch = isLanding && desc.match(/^([\s\S]*?)---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/)

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
      // LIN-156: Add show more/less for long descriptions
      // Truncate if > 3 lines or > 300 chars, with expansion capability
      const descLines = desc.split('\n')
      const needsTruncation = descLines.length > 3 || desc.length > 300

      if (needsTruncation && !isLanding) {
        // Show truncated with "show more" button
        // Take first 3 non-empty lines for truncated view
        const truncatedLines = descLines.slice(0, 3).filter(l => l.trim())
        const truncatedText = truncatedLines.map(l => escapeHtml(l.trim())).join('<br>')

        // Store raw description as data attribute for client-side markdown rendering
        // Use base64 encoding to safely embed in HTML attribute
        const rawDescBase64 = Buffer.from(desc).toString('base64')
        const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''

        detailsContent.push(`<div class="issue-description" data-desc-id="${issue.id}" data-raw-desc="${rawDescBase64}"${urlKeyAttr}>
          <span class="desc-truncated">${truncatedText}${descLines.length > 3 ? '…' : ''} <button class="issue-desc-toggle">show more</button></span>
          <span class="desc-full hidden"><span class="desc-full-content"></span> <button class="issue-desc-toggle">show less</button></span>
        </div>`)
      } else {
        // Short description or landing page: render normally without expansion
        for (const line of descLines.slice(0, 3)) {
          if (line.trim()) {
            detailsContent.push(`<div class="detail-line"><span class="detail-text">${escapeHtml(line.trim())}</span></div>`)
          }
        }
      }
    }
  }

  // Metadata line (with display labels only, no prompt buttons)
  const meta = []
  if (issue.identifier) {
    meta.push(issue.identifier)
  }
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
  // Comments section (nested inside Details)
  // LIN-158: Moved inside Details content so users must expand description first
  // ==========================================================================
  if (!isLanding && urlKey) {
    const urlKeyAttr = ` data-url-key="${escapeHtml(urlKey)}"`
    detailsContent.push(`<div class="detail-toggle nested-toggle" data-toggle="comments" data-issue-id="${escapeHtml(issue.id)}"${urlKeyAttr}>Comments ▶</div>`)
    detailsContent.push(`<div class="detail-content hidden" data-content="comments">
      <div class="comments-loading hidden">Loading comments...</div>
      <div class="comments-error hidden"></div>
      <div class="comments-list"></div>
    </div>`)
  }

  // ==========================================================================
  // Collect Prompts content (prompt buttons + containers)
  // Only for authenticated users (not landing page)
  // ==========================================================================
  const promptsContent = []

  if (!isLanding && featureFlags.promptButtons !== false) {
    // Prompt buttons row (suppress AI suggest when aiRecommendations is off)
    const effectiveOpenRouterSource = featureFlags.aiRecommendations !== false ? openRouterSource : null
    const promptButtonsHtml = renderPromptButtons(issue, isLanding, effectiveOpenRouterSource)
    if (promptButtonsHtml) {
      promptsContent.push(`<div class="detail-line"><span class="detail-prompts">${promptButtonsHtml}</span></div>`)
    }

    // Interactive prompt container (populated via JS when prompt button clicked)
    promptsContent.push(renderPromptContainer({ issueId: issue.id, urlKey, dispatchEnabled: featureFlags.dispatch === true }))

    // Recommendation container for AI-generated prompts (only when aiRecommendations is on)
    if (featureFlags.aiRecommendations !== false) {
      const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
      const recommendDispatchBtn = featureFlags.dispatch === true ? '<button class="prompt-dispatch dispatch-btn">dispatch</button>' : ''
      promptsContent.push(`<div class="recommend-container hidden" data-recommend-for="${issue.id}"${urlKeyAttr}><div class="recommend-header"><span class="recommend-title">AI Suggestion</span><div class="recommend-header-actions"><button class="reasoning-toggle">show reasoning</button><button class="recommend-close">dismiss</button></div></div><div class="recommend-reasoning hidden"></div><div class="recommend-prompt hidden"><div class="prompt-header"><span class="prompt-name">Generated Prompt</span><div class="prompt-actions">${recommendDispatchBtn}<button class="prompt-copy">copy</button></div></div><div class="prompt-text"></div></div></div>`)
    }
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
