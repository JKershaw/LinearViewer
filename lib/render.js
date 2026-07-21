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
import { getStateDisplay } from './providers/state-map.js'
import { getProvider, getProviderForWorkspace } from './providers/registry.js'
import { issueSource } from './providers/models.js'
import { PERIODICALS_PROJECT_ID } from './tree.js'
import { escapeHtml } from './utils/html.js'
import { collectTaskImages } from './task-attachments.js'
import { renderPageFooter } from './components/footer.js'
import { renderNavBar, renderSearchPanel } from './components/navbar.js'
import { renderPage as renderPageShell } from './components/page.js'
import { renderPageHeader } from './components/page-header.js'
import { renderStatusPill } from './components/status-pill.js'
import { renderSection } from './components/section.js'

// Re-export standalone page renderers from render-pages.js
export { renderLoginPage, renderErrorPage, renderUpstreamAwareErrorPage, renderWorkspaceNotFoundPage } from './render-pages.js'

// Cache prompt labels for rendering
const PROMPT_LABELS = new Set(getPromptLabels())

// LIN-177 S3: capability-aware rendering. The dashboard reads the active
// workspace's provider so display strings and affordances adapt instead of
// hard-coding Linear.
//
// `getProviderForWorkspace` (registry) falls back to the Linear provider for
// legacy workspaces (which have no `provider` field) and the unauthenticated
// landing page, so a Linear workspace renders byte-identically to before.
// `DEFAULT_UI` is a final Linear-equivalent backstop for the impossible case
// where no provider resolves (e.g. a unit test rendering without a workspace
// and an empty registry) — it keeps capability gates open rather than blanking
// the Linear UI.
const DEFAULT_UI = { write: true, comments: true, estimates: true, subtasks: true, attachments: true, displayName: 'Linear' }

function uiOf(provider) {
  return provider?.ui || DEFAULT_UI
}

// Linear hosts the LIN-156 `/api/image` relay will serve (its SSRF allowlist).
// Kept in sync with that endpoint's `allowedHosts` so we only route URLs the
// relay can actually fetch.
const LINEAR_IMAGE_HOSTS = new Set(['uploads.linear.app', 'cdn.linear.app', 'linear.app'])

// Resolve the browser `src` for an attachment image (LIN-652). Linear-hosted
// URLs need the session-auth relay (the browser can't send Linear's Bearer
// token); everything else is already publicly fetchable and passes through
// untouched. Mirrors the description-image rewrite in public/app.js so the two
// surfaces agree on what gets proxied.
function imageRelaySrc(url, urlKey) {
  try {
    if (LINEAR_IMAGE_HOSTS.has(new URL(url).hostname)) {
      return `/workspace/${encodeURIComponent(urlKey)}/api/image?url=${encodeURIComponent(url)}`
    }
  } catch {
    // Non-absolute / unparseable URL: leave as-is rather than guess.
  }
  return url
}

// Prompts shown by default for every actionable issue
const DEFAULT_PROMPT_KEYS = ['look-into', 'research', 'plan', 'implementation']
const DEFAULT_PROMPT_KEY_SET = new Set(DEFAULT_PROMPT_KEYS)

/**
 * Dispatch disclosure placeholder — rendered client-side by initDispatchDisclosures()
 * in public/common.js, which scans these divs and replaces them with the shared
 * window.renderDispatchDisclosure() output (LIN-1137).
 * @param {string} idPrefix - Unique prefix for this instance
 * @param {string} isLocalhost - Whether to include the localhost-only harbour target
 * @returns {string} Placeholder div HTML
 */
function renderDispatchDisclosurePlaceholder(idPrefix, isLocalhost) {
  return `<div class="dispatch-disclosure-placeholder" data-disclosure-prefix="${escapeHtml(idPrefix)}" data-localhost="${escapeHtml(isLocalhost ? 'true' : '')}"></div>`;
}

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
function renderPromptContainer({ name = '', content = '', issueId = '', urlKey = '', dispatchEnabled = false, proxyEnabled = false, isLocalhost = false, kind = '', optionsId = '', proxyForce = false } = {}) {
  const hiddenClass = content ? '' : ' hidden'
  const issueAttr = issueId ? ` data-prompt-for="${escapeHtml(issueId)}"` : ''
  const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
  // data-kind lets the shared dispatch handler tag the item with a fixed kind
  // (e.g. 'periodical') instead of deriving it from promptName — same pattern as
  // the autopilot container. optionsId disambiguates the dispatch disclosure when
  // there is no issueId to key it on (synthetic rows like periodicals).
  const kindAttr = kind ? ` data-kind="${escapeHtml(kind)}"` : ''
  // data-proxy-force makes the shared dispatch handler send `proxyForce:true`
  // (LIN-1279): the dispatch attaches workspace-API proxy context regardless of
  // the +proxy toggle, for surfaces whose prompt REQUIRES the proxy (the
  // Mint + Autopilot periodical variant, whose tail calls the kickoff endpoint).
  const proxyForceAttr = proxyForce ? ' data-proxy-force="true"' : ''
  const disclosureId = optionsId || `prompt-options-${issueId}`
  const proxyToggle = proxyEnabled ? '<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>' : ''
  const actionButtons = dispatchEnabled
    ? renderDispatchDisclosurePlaceholder(disclosureId, isLocalhost) + '<button class="prompt-copy">copy</button><button class="prompt-download" title="Download prompt as a .md file">download</button>' + proxyToggle
    : '<button class="prompt-copy">copy</button><button class="prompt-download" title="Download prompt as a .md file">download</button>' + proxyToggle

  return `<div class="prompt-container${hiddenClass}"${issueAttr}${urlKeyAttr}${kindAttr}${proxyForceAttr}><div class="prompt-header"><span class="prompt-name">${escapeHtml(name)}</span><div class="prompt-actions">${actionButtons}</div></div><div class="prompt-text">${content}</div></div>`
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
 * @property {Object} [deployInfo] - Deploy information (see lib/deploy-info.js)
 * @property {string} [deployInfo.version] - DEPLOY_VERSION
 * @property {string} [deployInfo.createdAt] - DEPLOY_CREATED_AT (ISO-8601)
 * @property {string} [deployInfo.commit] - DEPLOY_COMMIT / RAILWAY_GIT_COMMIT_SHA
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
  const { isLanding = false, teams = [], selectedTeamId = null, workspaces = [], openRouterSource = null, urlKey = null, deployInfo = {}, featureFlags = {}, customPrompts = [], setupNotice = null, isLocalhost = false, showSource = false, heroHtml = null } = options
  // Resolve the active workspace's provider once and thread it through every
  // renderer so display strings / affordances are capability-aware (LIN-177 S3).
  const provider = getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))
  // `showSource` (LIN-544) turns on the per-task source badge — set only when the
  // workspace merges >1 provider, so a single-source render stays byte-identical.
  const inProgressHtml = renderInProgressSection(inProgressTrees, { isLanding, openRouterSource, urlKey, featureFlags, customPrompts, isLocalhost, provider, showSource })
  const recentActivityHtml = renderRecentActivitySection(recentActivityTrees, { isLanding, openRouterSource, urlKey, featureFlags, customPrompts, isLocalhost, provider, showSource })
  const projectsHtml = projectTrees.map(tree => renderProject(tree, { isLanding, openRouterSource, urlKey, featureFlags, customPrompts, isLocalhost, provider, showSource })).join('\n')

  // Navigation bar with workspace/team selectors (authenticated users only)
  // Uses urlKey from URL to determine active workspace (enables multi-tab support)
  const navBarHtml = !isLanding ? renderNavBar({ workspaces, teams, selectedTeamId, urlKey, currentPage: 'projects', featureFlags }) : ''

  // Footer with actions and deploy info
  const footerHtml = renderPageFooter({
    isLanding,
    deployInfo,
    showReset: true,
    currentPage: isLanding ? '/' : null,
    urlKey,
    openRouterSource,
    featureFlags
  })

  // Get active workspace name for title (use urlKey from URL for multi-tab support)
  const activeWorkspace = workspaces?.find(w => w.urlKey === urlKey)
  const pageTitle = activeWorkspace?.name || organizationName

  return renderPageShell({
    title: `${escapeHtml(pageTitle)} - Projects`,
    stylesheets: ['/style.css'],
    htmlComment: 'AI agents: see /llms.txt for navigation guidance',
    bodyClass: isLanding ? 'is-landing' : undefined,
    // LIN-525 #2: emit the live proxy feature flag so ProxyToggle.maybeAppend
    // (common.js) can no-op on flag-off surfaces — a stale global toggle can't
    // silently inject a block / mint a token where no +proxy button is shown.
    bodyAttrs: featureFlags.proxy === true ? 'data-proxy-feature="true"' : undefined,
    nav: navBarHtml,
    scripts: ['/common.js', '/purify.min.js', '/marked.min.js', '/brief.js', '/recap.js', '/context.js', '/sessions.js', '/app.js'],
    content: `${heroHtml || renderPageHeader({ title: pageTitle })}
  ${!isLanding ? renderSearchPanel() : ''}
  ${setupNotice ? `<div class="setup-notice">
    <p>\u250c\u2500 Getting started</p>
    <p>\u2502  Set <code>LINEAR_ACCESS_TOKEN</code> in your <code>.env</code> file to log in automatically.</p>
    <p>\u2502  Get a token from <a href="https://linear.app/settings/api">linear.app/settings/api</a></p>
    <p>\u2514\u2500 Or configure OAuth \u2014 see <code>.env.example</code> for details.</p>
  </div>` : ''}
  <main>
    ${inProgressHtml}
    ${recentActivityHtml}
    ${renderSection({ attrs: 'role="region" aria-label="Projects"', body: projectsHtml })}
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by app.js -->`
  })
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
  const { isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {}, customPrompts = [], isLocalhost = false, provider = null, showSource = false } = options
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
        featureFlags,
        customPrompts,
        isLocalhost,
        provider,
        showSource
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
  const { isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {}, customPrompts = [], isLocalhost = false, provider = null, showSource = false } = options
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
      featureFlags,
      customPrompts,
      isLocalhost,
      provider,
      showSource
    }))
  ).join('\n')

  return `
  <div class="recent-activity-section" role="region" aria-label="Recent activity">
    <div class="recent-activity-header">▶ Recent activity</div>
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
  const { isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {}, customPrompts = [], isLocalhost = false, provider = null, showSource = false } = options
  const ui = uiOf(provider)

  // LIN-341: the synthetic Periodicals group renders dispatchable template rows,
  // not Linear issues — delegate to a dedicated renderer.
  if (project.id === PERIODICALS_PROJECT_ID) {
    return renderPeriodicalProject({ project, incomplete }, { isLanding, urlKey, isLocalhost, featureFlags })
  }

  const description = project.content
    ? renderProjectDescription(project.content, project.id)
    : ''

  const hasDescription = !!project.content
  const projectTarget = project.sameTab ? '' : ' target="_blank"'

  // Build Linear action links (authenticated users only)
  const viewLink = project.url
    ? `<a href="${project.url}"${projectTarget} class="detail-link">${project.linkText || `View in ${ui.displayName} →`}</a>`
    : ''

  const projectLink = viewLink
    ? `<div class="project-meta">${viewLink}</div>`
    : ''

  const incompleteHtml = incomplete
    .map(node => renderNode(node, project.id, { isLanding, openRouterSource, urlKey, featureFlags, customPrompts, provider, showSource }))
    .join('\n')

  const completedToggle = completedCount > 0
    ? `<div class="completed-toggle" data-project-id="${project.id}" data-count="${completedCount}">show ${completedCount} completed</div>`
    : ''

  const completedHtml = completed.length > 0
    ? `<div class="tree hidden" data-completed-for="${project.id}">${completed.map(node => renderNode(node, project.id, { isLanding, openRouterSource, urlKey, featureFlags, customPrompts, provider, showSource })).join('\n')}</div>`
    : ''

  const defaultCollapsed = project.collapsed ? ' data-default-collapsed="true"' : ''

  // Wrap incomplete nodes in .tree container for CSS-based tree lines
  const incompleteTree = incomplete.length > 0
    ? `<div class="tree">${incompleteHtml}</div>`
    : ''

  // Guard on a *real* project id: synthetic ids (e.g. '__periodicals__',
  // '__no_project__') are not real projects, so building a create-task URL for
  // them yields a broken link. Requiring !startsWith('__') suppresses the
  // link for all synthetic groups (LIN-341; also fixes the latent __no_project__ bug).
  // The link is gated on the provider's UI `write` capability and resolves its
  // URL from the active provider rather than a pinned Linear lookup (LIN-177 S3).
  // `ui.write` and `getCreateTaskUrl` are coupled by design (S0): write is true
  // iff the provider overrides getCreateTaskUrl, so the call is always safe here.
  const createTaskProvider = provider || getProvider('linear')
  const addTaskLink = !isLanding && ui.write && urlKey && project.id && !project.id.startsWith('__')
    ? `<div class="add-task-link"><a href="${createTaskProvider.getCreateTaskUrl(urlKey, project.id)}" target="_blank" class="detail-link" data-action="create-task">+ Add task</a></div>`
    : ''

  return `
  <div class="project" data-id="${escapeHtml(project.id)}" data-testid="project" data-project-name="${escapeHtml(project.name)}"${defaultCollapsed}>
    <div class="project-header" data-testid="project-header">${project.collapsed ? '▶' : '▼'} ${escapeHtml(project.name)}</div>
    ${description}
    ${projectLink}
    ${incompleteTree}
    ${addTaskLink}
    ${completedHtml}
    ${completedToggle}
  </div>`
}

/**
 * Render the synthetic Periodicals group (LIN-341).
 *
 * Unlike a Linear project, this group contains periodical *template* rows, not
 * issues: no "View in Linear", no AI-suggest/autopilot prompt buttons, no add-task
 * link. Each row expands (reusing the standard .line/.details toggle) to reveal a
 * pre-filled, dispatchable prompt whose dispatch is tagged `kind: 'periodical'`.
 * The `data-project-type="periodicals"` hook on the wrapper drives the distinct
 * colour rule in public/style.css.
 *
 * @param {{project: Object, incomplete: Array}} tree - project + periodical nodes
 * @param {Object} options
 * @returns {string} HTML for the periodicals group
 */
function renderPeriodicalProject({ project, incomplete }, options = {}) {
  const { isLanding = false, urlKey = null, isLocalhost = false, featureFlags = {} } = options
  const rows = incomplete.map(node => renderPeriodicalNode(node, { isLanding, urlKey, isLocalhost, featureFlags })).join('\n')
  const rowsTree = rows ? `<div class="tree">${rows}</div>` : ''

  return `
  <div class="project" data-id="${escapeHtml(project.id)}" data-project-type="periodicals">
    <div class="project-header">▼ ${escapeHtml(project.name)}</div>
    ${rowsTree}
  </div>`
}

/**
 * Render a single periodical template row.
 *
 * @param {{issue: Object, periodical: Object}} node - periodical tree node
 * @param {Object} options
 * @returns {string} HTML for one periodical row
 */
function renderPeriodicalNode(node, options = {}) {
  const { isLanding = false, urlKey = null, isLocalhost = false, featureFlags = {} } = options
  const { issue, periodical = {} } = node
  const id = issue.id
  const title = periodical.title || issue.title || ''
  const mode = periodical.mode || ''

  const modeBadge = mode ? `<span class="periodical-mode">${escapeHtml(mode)}</span>` : ''
  const line = `<div class="line expandable" role="button" tabindex="0" aria-expanded="false" data-id="${escapeHtml(id)}" data-parent="${escapeHtml(PERIODICALS_PROJECT_ID)}" data-depth="0" data-section="project" style="--depth: 0"><span class="state periodical-state" data-status="periodical" aria-label="Periodical">↻</span><span class="title">${escapeHtml(title)}</span>${modeBadge}<span class="toggle">▶</span></div>`

  // On the landing page there is no dispatch affordance — render just the row.
  if (isLanding) {
    return `<div class="node" data-id="${escapeHtml(id)}">${line}</div>`
  }

  // Dispatch is the only action for a periodical, so the container is always
  // dispatch-enabled (independent of the per-user dispatch feature flag) and
  // carries no issue id — the dispatch posts prompt + kind:'periodical' with no
  // issue fields. The shared client handler detects the absent issueId and opts
  // out of the issue-link contract via `issueless: true` (see public/app.js,
  // LIN-345); the endpoint accepts the issue-less payload end-to-end.
  const container = renderPromptContainer({
    name: title,
    content: escapeHtml(periodical.prompt || ''),
    urlKey,
    dispatchEnabled: true,
    isLocalhost,
    kind: 'periodical',
    optionsId: `periodical-options-${id}`
  })

  // LIN-1279: a distinct "Mint + Autopilot" action beside the plain Mint above.
  // It dispatches the SAME periodical prompt plus the autopilot-handoff tail, with
  // proxy context forced on (the tail calls the kickoff endpoint, so the agent
  // needs a workspace-API token). Gated behind BOTH the `periodicals` workspace
  // flag (which already governs whether this whole group renders) AND the per-user
  // `proxy` flag — `proxy` is load-bearing here, not cosmetic. When it is off, only
  // the plain Mint container renders, byte-identical to before this ticket.
  const autopilotContainer = featureFlags.proxy === true
    ? renderPromptContainer({
      name: `${title} + Autopilot`,
      content: escapeHtml(periodical.autopilotPrompt || ''),
      urlKey,
      dispatchEnabled: true,
      isLocalhost,
      kind: 'periodical',
      optionsId: `periodical-autopilot-options-${id}`,
      proxyForce: true
    })
    : ''

  const details = `<div class="details hidden" data-details-for="${escapeHtml(id)}" data-section="project" style="--depth: 0"><div class="detail-content" data-content="prompts">${container}${autopilotContainer}</div></div>`

  return `<div class="node" data-id="${escapeHtml(id)}">${line}${details}</div>`
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
  const { section = 'project', projectName = null, isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {}, customPrompts = [], isLocalhost = false, provider = null, showSource = false } = options
  const { issue, children, depth } = node

  // Determine state
  const stateType = issue.state?.type || 'unstarted'
  const { class: stateClass, char: stateChar, label: stateLabel } = getStateDisplay(stateType)

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

  // LIN-903: a nested (depth>0) in-progress subtask whose OWN project differs from
  // its display group (its parent's project) shows that project as an inline tag —
  // "project acts as a tag, not a group" in the feeds. `node.projectTag` is set by
  // buildInProgressForest only when it differs, so this never fires for same-group
  // rows. Inline <span> only — the box-drawing tree scaffold stays untouched
  // (render.js is LIN-850 "box-drawing LOCKED"). Recent-activity is a flat depth-0
  // list, so this is in-progress-only by construction.
  const projectTagBadge = (section === 'in-progress' && depth > 0 && node.projectTag)
    ? `<span class="in-progress-project">(${escapeHtml(node.projectTag)})</span>`
    : ''

  // Activity badge for recent-activity section (only at depth 0). Keys on the
  // node's own activity timestamp/kind (LIN-490) so created/edited rows show the
  // right time and a kind word, not an assumed completion time. Falls back to
  // completedAt for any caller that hasn't attached activity metadata.
  const activityAt = section === 'recent-activity' ? (node.activityAt || issue.completedAt) : null
  const activityWord = node.activityKind ? `${node.activityKind} ` : ''
  const timeBadge = (section === 'recent-activity' && depth === 0 && activityAt)
    ? `<span class="completed-time">${activityWord}${formatRelativeTime(activityAt)}</span>`
    : ''

  // Source badge (LIN-544): in a workspace that merges >1 provider, flag each
  // task with where it came from. Suppressed (empty) for a single-source
  // workspace so the Linear-only render stays byte-identical.
  const source = issueSource(issue)
  const sourceBadge = showSource
    ? `<span class="source-badge" data-testid="issue-source" data-source="${escapeHtml(source)}">${escapeHtml(source)}</span>`
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
  // LIN-566: make expandable rows real keyboard-operable controls. aria-expanded
  // is owned by toggleItem (and applyState on load) so all input modalities stay in sync.
  const expandableAttrs = canExpand ? ' role="button" tabindex="0" aria-expanded="false"' : ''
  const line = `<div class="${lineClasses}"${expandableAttrs} data-id="${issue.id}" data-testid="issue-line" data-identifier="${escapeHtml(issue.identifier || '')}" data-parent="${parentId}" data-depth="${depth}" data-section="${section}" data-search-text="${searchText}" style="--depth: ${depth}">${renderStatusPill({ state: stateClass, char: stateChar, variant: 'bare', attrs: `data-status="${stateClass}" aria-label="Status: ${stateLabel}"` })}<span class="${titleClass}">${escapeHtml(issue.title)}</span>${timeBadge}${projectBadge}${projectTagBadge}${sourceBadge}${toggle}</div>`

  // Render details section.
  // LIN-442: on the authenticated dashboard the detail block (description +
  // prompt/autopilot containers) is the dominant per-issue payload, so
  // it is deferred — renderNode emits only an empty, lazy `.details` wrapper and
  // the client fetches the rendered content from `/api/detail/:issueId` on first
  // expand (mirroring the comments lazy-load). The landing page has no fetch
  // route (unauthenticated, no urlKey) so it keeps rendering details inline.
  let details = ''
  if (hasDetails) {
    if (isLanding) {
      details = renderDetails(issue, depth, section, isLanding, openRouterSource, urlKey, featureFlags, customPrompts, isLocalhost, provider)
    } else {
      const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
      details = `<div class="details hidden" data-details-for="${issue.id}" data-section="${section}" data-lazy="1"${urlKeyAttr} style="--depth: ${depth}"></div>`
    }
  }

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
export function renderPromptButtons(issue, isLanding = false, openRouterSource = null, customPrompts = [], featureFlags = {}) {
  if (isLanding) return ''

  const issueId = issue.id
  const parts = []

  // AI suggest button (only for authenticated users with OpenRouter configured)
  if (openRouterSource) {
    parts.push(`<a href="#" class="label-prompt suggest-btn" data-issue-id="${issueId}" title="Get AI recommendation">AI suggest</a>`)
  }

  // Autopilot button (proxy feature) — sibling to AI suggest: launches an
  // autonomous run pinned to this task, ready for copy or dispatch.
  if (featureFlags.proxy === true) {
    parts.push(`<a href="#" class="label-prompt autopilot-btn" data-issue-id="${issueId}" title="Run on autopilot until this task is done — dispatches work to a separate worker and watches the loop">Autopilot</a>`)
    // LIN-836: sibling button for the stepper variant (LIN-791). Same proxy gate
    // and same container; the `data-variant` marker is the only difference —
    // app.js reads it and appends `?variant=stepper` to the kickoff fetch.
    parts.push(`<a href="#" class="label-prompt autopilot-btn" data-issue-id="${issueId}" data-variant="stepper" title="Run on autopilot in stepped mode — drips ordered beats into one warm session, judging each before advancing">Autopilot · stepped</a>`)
  }

  // Default prompts — shown for every issue, including completed/canceled ones
  // (a finished task can still warrant a retro look-back, for instance)
  for (const key of DEFAULT_PROMPT_KEYS) {
    parts.push(`<a href="#" class="label-prompt" data-issue-id="${issueId}" data-label="${key}">${escapeHtml(getPromptDisplayName(key))}</a>`)
  }

  // Custom prompts — visible alongside defaults
  for (const cp of customPrompts) {
    parts.push(`<a href="#" class="label-prompt custom-prompt-btn" data-issue-id="${issueId}" data-label="custom:${escapeHtml(cp.id)}">${escapeHtml(cp.name)}</a>`)
  }

  // Remaining built-in prompts behind "more"
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
 * @param {Object|null} provider - Active workspace provider (LIN-177 S3); drives capability-aware display
 * @returns {string} HTML for details section (empty string if no details)
 */
function renderDetails(issue, depth, section = 'project', isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {}, customPrompts = [], isLocalhost = false, provider = null) {
  const content = renderDetailsContent(issue, { isLanding, openRouterSource, urlKey, featureFlags, customPrompts, isLocalhost, provider, section })
  if (!content) return ''
  return `<div class="details hidden" data-details-for="${issue.id}" data-section="${section}" style="--depth: ${depth}">${content}</div>`
}

/**
 * Render the INNER content of an issue's details block (description, metadata,
 * comments shell, prompt/autopilot containers, View-in link) — without
 * the outer `.details` wrapper. Returns '' when there is nothing to show.
 *
 * Split out of `renderDetails` for LIN-442: the authenticated dashboard defers
 * this block to a per-issue fetch (`/api/detail/:issueId` → renderDetailsContent),
 * while `renderNode` emits only the empty wrapper. Depth/section live on the
 * wrapper, so the content is position-independent — EXCEPT the dispatch
 * disclosure panel ids, which must be unique per render instance. The same issue
 * can appear in two sections at once (e.g. In Progress + its project tree); a
 * panel id keyed on issue id alone would then collide in the DOM and the second
 * appearance's "Dispatch ▾" would resolve (via aria-controls → getElementById)
 * to the first appearance's panel and look broken (LIN-732). `section` is folded
 * into those ids to disambiguate per instance; the lazy fetch forwards it as a
 * query param and the route passes it back here.
 *
 * @param {Issue} issue - The issue object (raw `{ nodes }`-labelled shape)
 * @param {Object} [opts]
 * @param {string} [opts.section] - Section the instance renders in (disambiguates dispatch panel ids)
 * @returns {string} Inner HTML for the details block, or '' if empty
 */
export function renderDetailsContent(issue, { isLanding = false, openRouterSource = null, urlKey = null, featureFlags = {}, customPrompts = [], isLocalhost = false, provider = null, section = '' } = {}) {
  const lines = []
  const ui = uiOf(provider)
  // Per-render-instance key for the dispatch disclosure panel ids. When `section`
  // is absent (single-render / landing) this is just the issue id, so the emitted
  // ids — and thus the whole block — stay byte-identical to the pre-LIN-732 output.
  const instanceKey = section ? `${section}-${issue.id}` : issue.id

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
  if (issue.estimate && ui.estimates) {
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
  if (!isLanding && urlKey && ui.comments) {
    const urlKeyAttr = ` data-url-key="${escapeHtml(urlKey)}"`
    detailsContent.push(`<div class="detail-toggle nested-toggle" data-toggle="comments" data-issue-id="${escapeHtml(issue.id)}"${urlKeyAttr}>Comments ▶</div>`)
    detailsContent.push(`<div class="detail-content hidden" data-content="comments">
      <div class="comments-loading hidden">Loading comments...</div>
      <div class="comments-error hidden"></div>
      <div class="comments-list"></div>
    </div>`)
  }

  // ==========================================================================
  // Attachments section (nested inside Details) — LIN-652 / parent LIN-612.
  // Hidden-by-default gallery of every image attached to the task: formal
  // attachment nodes + markdown images in the description + markdown images in
  // each comment. Gated on the provider's `attachments` capability (Linear-only
  // today; LIN-649) so providers without attachment support hide it cleanly.
  //
  // The image bytes are fetched through the existing LIN-156 session-auth relay
  // (`/api/image`) — the browser can't send Linear auth, exactly as for inline
  // description images — so Linear-hosted URLs are rewritten to the relay here
  // and non-Linear URLs left direct (mirrors public/app.js's description
  // rewrite + the relay's own host allowlist). `loading="lazy"` keeps the bytes
  // off the wire until the hidden section is expanded, giving the comments-style
  // load-on-demand without a second client fetch path; the only client work is
  // attaching per-image error fallbacks on first expand (see public/app.js).
  // Rendered only when ≥1 image exists, so attachment-free issues stay
  // byte-identical to before.
  // ==========================================================================
  if (!isLanding && urlKey && ui.attachments) {
    const images = collectTaskImages(issue, issue.comments?.nodes || issue.comments || [])
    if (images.length > 0) {
      const urlKeyAttr = ` data-url-key="${escapeHtml(urlKey)}"`
      const items = images.map(img => {
        const src = imageRelaySrc(img.url, urlKey)
        const alt = escapeHtml(img.title || 'attachment')
        const titleAttr = img.title ? ` title="${escapeHtml(img.title)}"` : ''
        return `<a class="attachment-item" href="${escapeHtml(src)}" target="_blank" rel="noopener" data-source="${escapeHtml(img.source)}"><img class="attachment-image" src="${escapeHtml(src)}" loading="lazy" alt="${alt}"${titleAttr} data-original-src="${escapeHtml(img.url)}"></a>`
      }).join('')
      detailsContent.push(`<div class="detail-toggle nested-toggle" data-toggle="attachments" data-testid="attachments-toggle"${urlKeyAttr}>Attachments (${images.length}) ▶</div>`)
      detailsContent.push(`<div class="detail-content hidden" data-content="attachments" data-testid="attachments-content"><div class="attachments-grid">${items}</div></div>`)
    }
  }

  // ==========================================================================
  // Brief / Recap / Dispatched Sessions (nested inside Details) — LIN-522
  // Mirror the swipe view's on-card sections. Each is a lazy toggle: the shared
  // client module (BriefSection / RecapSection / SessionsSection) is init()'d on
  // first expand (public/app.js, loadLazySection). Endpoints are issue-scoped
  // and generic, so the identifier (LIN-123 or id) is all the module needs.
  // Sessions is gated behind the dispatch flag — no dispatch means no sessions
  // can exist.
  // ==========================================================================
  if (!isLanding && urlKey) {
    const identifier = issue.identifier || issue.id
    const sectionAttrs = ` data-issue-identifier="${escapeHtml(identifier)}" data-url-key="${escapeHtml(urlKey)}"`

    detailsContent.push(`<div class="detail-toggle nested-toggle" data-toggle="brief"${sectionAttrs}>Brief ▶</div>`)
    detailsContent.push(`<div class="detail-content hidden" data-content="brief"><div class="brief-section" data-brief-placeholder="1"></div></div>`)

    detailsContent.push(`<div class="detail-toggle nested-toggle" data-toggle="recap"${sectionAttrs}>Recap ▶</div>`)
    detailsContent.push(`<div class="detail-content hidden" data-content="recap"><div class="recap-section" data-recap-placeholder="1"></div></div>`)

    detailsContent.push(`<div class="detail-toggle nested-toggle" data-toggle="context"${sectionAttrs}>Context ▶</div>`)
    detailsContent.push(`<div class="detail-content hidden" data-content="context"><div class="context-section" data-context-placeholder="1"></div></div>`)

    if (featureFlags.dispatch === true) {
      detailsContent.push(`<div class="detail-toggle nested-toggle" data-toggle="sessions"${sectionAttrs}>Dispatched Sessions ▶</div>`)
      detailsContent.push(`<div class="detail-content hidden" data-content="sessions"><div class="sessions-section" data-sessions-placeholder="1"></div></div>`)
    }

    // Per-task Chat deep-link (LIN-1007) — a flag-gated navigation affordance to
    // the experimental task-chat page with THIS task preselected via the existing
    // `?task=<identifier>` contract (routes/task-chat.js). Unlike the sibling lazy
    // toggles above it is an <a> (navigation, not an in-place section), so no
    // data-toggle attribute and app.js leaves it as a plain link. Strictly gated
    // on `taskChat === true` (mirroring the `dispatch === true` gate above) so the
    // first-class page stays byte-identical for non-flag-holders. This is the
    // deliberate, narrow, flag-held exception to the View Tiers "experimental →
    // Settings link only" policy scoped in the ticket.
    if (featureFlags.taskChat === true) {
      const chatHref = `/workspace/${encodeURIComponent(urlKey)}/task-chat?task=${encodeURIComponent(identifier)}`
      detailsContent.push(`<a class="detail-toggle nested-toggle" href="${escapeHtml(chatHref)}" data-testid="issue-chat-link">Chat ↗</a>`)
    }
  }

  // ==========================================================================
  // Collect Prompts content (prompt buttons + containers)
  // Only for authenticated users (not landing page)
  // ==========================================================================
  const promptsContent = []

  if (!isLanding && featureFlags.promptButtons !== false) {
    // Prompt buttons row (suppress AI suggest when aiRecommendations is off)
    const effectiveOpenRouterSource = featureFlags.aiRecommendations !== false ? openRouterSource : null
    const promptButtonsHtml = renderPromptButtons(issue, isLanding, effectiveOpenRouterSource, customPrompts, featureFlags)
    if (promptButtonsHtml) {
      promptsContent.push(`<div class="detail-line"><span class="detail-prompts">${promptButtonsHtml}</span></div>`)
    }

    // Interactive prompt container (populated via JS when prompt button clicked)
    promptsContent.push(renderPromptContainer({ issueId: issue.id, urlKey, dispatchEnabled: featureFlags.dispatch === true, proxyEnabled: featureFlags.proxy === true, isLocalhost, optionsId: `prompt-options-${instanceKey}` }))

    // Recommendation container for AI-generated prompts (only when aiRecommendations is on)
    if (featureFlags.aiRecommendations !== false) {
      const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
      const recommendProxyToggle = featureFlags.proxy === true ? '<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>' : ''
      const recommendActions = featureFlags.dispatch === true
        ? renderDispatchDisclosurePlaceholder(`recommend-options-${instanceKey}`, isLocalhost) + '<button class="prompt-copy">copy</button><button class="prompt-download" title="Download prompt as a .md file">download</button>' + recommendProxyToggle
        : '<button class="prompt-copy">copy</button><button class="prompt-download" title="Download prompt as a .md file">download</button>' + recommendProxyToggle
      promptsContent.push(`<div class="recommend-container hidden" data-recommend-for="${issue.id}"${urlKeyAttr}><div class="recommend-header"><span class="recommend-title">AI Suggestion</span><div class="recommend-header-actions"><button class="reasoning-toggle">show reasoning</button><button class="recommend-close">dismiss</button></div></div><div class="streaming-phase hidden"></div><div class="recommend-reasoning hidden"></div><div class="recommend-prompt hidden"><div class="prompt-header"><span class="prompt-name">Generated Prompt</span><div class="prompt-actions">${recommendActions}</div></div><div class="prompt-text"></div></div></div>`)
    }

    // Autopilot container: parallel to the AI recommendation container but
    // non-streaming. Rendered when the proxy feature is on. data-kind is baked
    // in so the shared dispatch handler tags the item as the 'autopilot' meta-loop.
    if (featureFlags.proxy === true) {
      const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
      const autopilotProxyToggle = '<button class="prompt-proxy-toggle" title="Append proxy API instructions to prompt">+proxy</button>'
      const autopilotActions = featureFlags.dispatch === true
        ? renderDispatchDisclosurePlaceholder(`autopilot-options-${instanceKey}`, isLocalhost) + '<button class="prompt-copy">copy</button><button class="prompt-download" title="Download prompt as a .md file">download</button>' + autopilotProxyToggle
        : '<button class="prompt-copy">copy</button><button class="prompt-download" title="Download prompt as a .md file">download</button>' + autopilotProxyToggle
      promptsContent.push(`<div class="autopilot-container prompt-container hidden" data-autopilot-for="${issue.id}" data-kind="autopilot"${urlKeyAttr}><div class="prompt-header"><span class="prompt-name">Autopilot</span><div class="prompt-actions">${autopilotActions}</div></div><div class="prompt-text"></div></div>`)
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
  // "View in {provider}" link (outside both sections) — provider-aware (LIN-177 S3)
  // ==========================================================================
  if (issue.url) {
    const linkText = issue.linkText || `View in ${ui.displayName} →`
    const target = issue.sameTab ? '' : ' target="_blank"'
    lines.push(`<div class="detail-line"><a href="${issue.url}"${target} class="detail-link">${linkText}</a></div>`)
  }

  if (lines.length === 0) return ''

  return lines.join('')
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

