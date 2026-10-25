// =============================================================================
// Home page renderer (projects / In Progress / Recent activity) and the lazy
// issue-details fragment.
//
// Shape: `renderPage` resolves one per-render context (`ctx`: provider, ui,
// flags, urlKey, landing mode, the shared top-task holder) and hands it to the
// three section renderers; `renderNodeHtml` recurses over issue trees with only
// the per-node facts (`section`, `parentId`, `projectName`) as extra arguments.
// `renderDetailsContent` is the independent lazy fragment (`/api/detail`), built
// from small single-purpose row builders.
// =============================================================================

/**
 * @typedef {import('./tree.js').ProjectTree} ProjectTree
 * @typedef {import('./tree.js').InProgressTree} InProgressTree
 * @typedef {import('./tree.js').TreeNode} TreeNode
 * @typedef {import('./tree.js').InProgressTreeNode} InProgressTreeNode
 * @typedef {import('./tree.js').Issue} Issue
 * @typedef {import('./workspace.js').Workspace} Workspace
 */

import { getPromptLabels } from './prompt-templates.js'
import { getStateDisplay } from './providers/state-map.js'
import { getProvider, getProviderForWorkspace } from './providers/registry.js'
import { issueSource } from './providers/models.js'
import { PERIODICALS_PROJECT_ID, nodeKey } from './tree.js'
import { orderInProgress, buildInProgressCountLine } from './task-board-view.js'
import { escapeHtml } from './utils/html.js'
import { collectTaskImages } from './task-attachments.js'
import { taskPageHref, sourceQuery } from './task-page-href.js'
import { buildPromptOpts } from './render-prompt-opts.js'
import { renderPageFooter } from './components/footer.js'
import { renderNavBar, renderSearchPanel } from './components/navbar.js'
import { renderPage as renderPageShell } from './components/page.js'
import { renderPageHeader } from './components/page-header.js'
import { renderStatusPill } from './components/status-pill.js'
import { renderSection } from './components/section.js'
import { renderRunnerLink } from './components/runner-link.js'

// Standalone page renderers live in render-pages.js; re-exported as the same function objects.
export { renderLoginPage, renderErrorPage, renderUpstreamAwareErrorPage, renderWorkspaceNotFoundPage, renderOpenRouterConsentPage } from './render-pages.js'

// Labels that drive prompt buttons; every other label is shown as plain text in Details.
const PROMPT_LABELS = new Set(getPromptLabels())

// LIN-177 S3: capability-aware rendering. The active workspace's provider drives
// display strings and affordances. `getProviderForWorkspace` falls back to Linear
// for legacy workspaces and the landing page; `DEFAULT_UI` is the final
// Linear-equivalent backstop when no provider resolves at all (a unit test with an
// empty registry), keeping capability gates open rather than blanking the UI.
const DEFAULT_UI = { write: true, comments: true, estimates: true, subtasks: true, attachments: true, displayName: 'Linear' }

function uiOf(provider) {
  return provider?.ui || DEFAULT_UI
}

// One priority vocabulary shared by the task-edit and task-create pages
// (LIN-1565/LIN-1973) and the feedback route's priority text-fold (LIN-1557): a
// forked copy would drift the moment the 0-4 scale changed.
export const PRIORITY_OPTION_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

export function priorityOptionsHtml(selected) {
  const sel = Number(selected)
  return PRIORITY_OPTION_LABELS
    .map((label, value) => `<option value="${value}"${value === sel ? ' selected' : ''}>${label}</option>`)
    .join('')
}

// Linear hosts the LIN-156 `/api/image` relay serves (its SSRF allowlist); keep
// in sync with that endpoint's `allowedHosts`.
const LINEAR_IMAGE_HOSTS = new Set(['uploads.linear.app', 'cdn.linear.app', 'linear.app'])

// LIN-652: the browser `src` for an attachment image. Linear-hosted URLs need the
// session-auth relay (the browser can't send Linear's Bearer token); everything
// else is publicly fetchable and passes through. Mirrors public/app.js's
// description-image rewrite so both surfaces agree on what is proxied.
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

// =============================================================================
// Dates
// =============================================================================

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Local time on purpose: the unit tests assume the UTC the CI runs in.
function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** A `YYYY-MM-DD` day as `D Mon YYYY` (UTC, no zero pad): `2026-03-03` is `3 Mar 2026`. (LIN-3732) */
export function formatDayKey(day) {
  const [year, month, date] = day.split('-').map(Number)
  return `${date} ${MONTHS[month - 1]} ${year}`
}

/** Days a future time is still given as a relative count ("in 89d"), then a date. (LIN-3890) */
const FUTURE_RELATIVE_MAX_DAYS = 120

/**
 * Relative time ("2h ago", "yesterday"); a plain date from 7 days on. A future
 * time reads "in 5m", "in 3h", "in 2d" up to FUTURE_RELATIVE_MAX_DAYS (so a 90-day
 * key expiry reads "in 89d"), then a date. `now` is injectable for tests.
 * (LIN-3890: one formatter for Settings, not a second copy.)
 */
export function formatRelativeTime(dateStr, now = Date.now()) {
  if (!dateStr) return ''
  const diffMs = now - new Date(dateStr)
  if (diffMs < 0) return formatFutureTime(-diffMs, dateStr)
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

function formatFutureTime(untilMs, dateStr) {
  const mins = Math.floor(untilMs / 60000)
  const hours = Math.floor(untilMs / 3600000)
  const days = Math.floor(untilMs / 86400000)
  if (days > FUTURE_RELATIVE_MAX_DAYS) return formatDate(dateStr)
  if (mins < 60) return `in ${Math.max(1, mins)}m`
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.max(1, days)}d`
}

// =============================================================================
// Prompt container (landing "Setup Prompt" and Periodicals rows)
// =============================================================================

/**
 * Dispatch disclosure placeholder: public/common.js initDispatchDisclosures()
 * replaces these divs with the shared window.renderDispatchDisclosure() (LIN-1137).
 */
function renderDispatchDisclosurePlaceholder(idPrefix, isLocalhost) {
  return `<div class="dispatch-disclosure-placeholder" data-disclosure-prefix="${escapeHtml(idPrefix)}" data-localhost="${escapeHtml(isLocalhost ? 'true' : '')}"></div>`
}

/**
 * @param {Object} options
 * @param {string} [options.name] - header text
 * @param {string} [options.content] - body, already escaped; empty hides the container
 * @param {string} [options.urlKey] - stamped as `data-url-key`
 * @param {boolean} [options.dispatchEnabled] - add the dispatch disclosure (needs `optionsId`)
 * @param {boolean} [options.isLocalhost] - localhost-only dispatch target
 * @param {string} [options.kind] - fixed dispatch kind (e.g. 'periodical') instead of deriving it from the name
 * @param {string} [options.periodicalId] - registry template id (LIN-1825), forwarded on dispatch
 * @param {string} [options.optionsId] - disclosure id for rows with no issue id
 * @param {boolean} [options.proxyForce] - make dispatch send `proxyForce:true` (LIN-1279)
 */
function renderPromptContainer({ name = '', content = '', urlKey = '', dispatchEnabled = false, isLocalhost = false, kind = '', periodicalId = '', optionsId = '', proxyForce = false } = {}) {
  const hiddenClass = content ? '' : ' hidden'
  const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
  const kindAttr = kind ? ` data-kind="${escapeHtml(kind)}"` : ''
  const periodicalIdAttr = periodicalId ? ` data-periodical-id="${escapeHtml(periodicalId)}"` : ''
  // The Mint + Autopilot periodical's prompt REQUIRES the proxy (its tail calls the
  // kickoff endpoint), so dispatch attaches proxy context regardless of +proxy.
  const proxyForceAttr = proxyForce ? ' data-proxy-force="true"' : ''
  const disclosure = dispatchEnabled ? renderDispatchDisclosurePlaceholder(optionsId, isLocalhost) : ''
  const actions = `${disclosure}<button class="prompt-copy">copy</button><button class="prompt-download" title="Download prompt as a .md file">download</button>`

  return `<div class="prompt-container${hiddenClass}"${urlKeyAttr}${kindAttr}${periodicalIdAttr}${proxyForceAttr}><div class="prompt-header"><span class="prompt-name">${escapeHtml(name)}</span><div class="prompt-actions">${actions}</div></div><div class="prompt-text">${content}</div></div>`
}

// =============================================================================
// Page
// =============================================================================

/**
 * @typedef {Object} RenderPageOptions
 * @property {boolean} [isLanding] - landing mode: no prompts, nav or lazy details
 * @property {Array} [teams] - team selector entries
 * @property {string|null} [selectedTeamId]
 * @property {string[]} [availableAssignees] - assignee selector names (dashboard-only, LIN-2529)
 * @property {string|null} [selectedAssignee] - 'all', 'me' or a literal name
 * @property {boolean} [canFilterByMe] - render the `me` row (provider.supports('viewer'))
 * @property {Workspace[]} [workspaces]
 * @property {Workspace|null} [workspace] - the route's resolved workspace (req.workspace); absent on landing
 * @property {'oauth'|'env'|'free'|null} [openRouterSource]
 * @property {string|null} [urlKey] - active workspace key (from the URL; multi-tab)
 * @property {Object} [deployInfo] - see lib/deploy-info.js
 * @property {Object} [featureFlags]
 * @property {Array} [customPrompts]
 * @property {string|null} [setupNotice]
 * @property {boolean} [isLocalhost]
 * @property {boolean} [showSource] - per-task source badge (workspace merges >1 provider, LIN-544)
 * @property {string|null} [heroHtml] - raw HTML replacing the page header
 * @property {boolean} [truncated] - the read hit its results cap
 * @property {Array<{provider: string, scope: string}>} [degradedSources] - LIN-3774: secondary sources that failed to load; the board renders without them plus a notice
 * @property {string|null} [topTaskId] - LIN-2944 P1: the ordering pipeline's front card (`nodeKey`)
 * @property {string[]} [topTaskWhy] - its `why` reasons (empty = no reason line)
 * @property {boolean} [topTaskOnboarding] - seed-only workspace hint
 * @property {boolean} [proxyDefault] - account's +proxy default (unset means ON)
 * @property {boolean} [copyFirstCard] - LIN-3833: show the copy-first card (no runner, not yet dismissed)
 */

/**
 * Render the full Home document.
 * @param {ProjectTree[]} projectTrees
 * @param {InProgressTree[]} inProgressTrees
 * @param {import('./tree.js').RecentActivityTree[]} recentActivityTrees
 * @param {string} organizationName
 * @param {RenderPageOptions} options
 * @returns {string}
 */
export function renderPage(projectTrees, inProgressTrees = [], recentActivityTrees = [], organizationName = 'Projects', options = {}) {
  const { isLanding = false, teams = [], selectedTeamId = null, availableAssignees = [], selectedAssignee = null, canFilterByMe = false, workspaces = [], workspace, openRouterSource = null, urlKey = null, deployInfo = {}, featureFlags = {}, customPrompts = [], setupNotice = null, isLocalhost = false, showSource = false, heroHtml = null, truncated = false, degradedSources = [], topTaskId = null, topTaskWhy = [], topTaskOnboarding = false, proxyDefault = true, rowStates = null, copyFirstCard = false } = options

  const provider = getProviderForWorkspace(workspace)

  // LIN-2944 P1 F3: the ordering pipeline's front card is marked once on Home,
  // wherever its row renders (In Progress, Recent, or a project tree: an unstarted
  // blocker can be the top task). This mutable holder dedupes the same issue's two
  // appearances (LIN-732) into one mark; an empty `why` still marks the row.
  const topTask = (!isLanding && topTaskId) ? { key: topTaskId, why: topTaskWhy || [], marked: false } : null
  // LIN-3833: the In Progress row states (task-page-loader's buildRowStates), or null for a page with none.
  const ctx = { isLanding, urlKey, provider, ui: uiOf(provider), featureFlags, isLocalhost, showSource, topTask, rowStates }

  // Order matters: the first matching row in page order takes the top-task mark.
  const inProgressHtml = renderInProgressSection(inProgressTrees, ctx)
  const recentActivityHtml = renderRecentActivitySection(recentActivityTrees, ctx)
  const projectsHtml = projectTrees.map(tree => renderProject(tree, ctx)).join('\n')

  // The assignee selector is gated inside renderNavBar on currentPage === 'projects'.
  const navBarHtml = !isLanding
    ? renderNavBar({ workspaces, teams, selectedTeamId, assignees: availableAssignees, selectedAssignee, canFilterByMe, urlKey, currentPage: 'projects', featureFlags })
    : ''
  const footerHtml = renderPageFooter({
    isLanding,
    deployInfo,
    showReset: true,
    currentPage: isLanding ? '/' : null,
    urlKey,
    openRouterSource,
    featureFlags
  })
  const pageTitle = workspace?.name || organizationName

  // LIN-2944 P3: body flag ProxyToggle (common.js) reads. Landing omits
  // data-proxy-active. (LIN-3849: the proxy-switch attribute is gone, key tools are always on.)
  const bodyAttrs = !isLanding ? `data-proxy-active="${proxyDefault !== false ? 'true' : 'false'}"` : ''

  // LIN-2944 P1: page options for the shared opened-task component, mirroring
  // Swipe's `__SWIPE_DATA__`. Landing has no prompt UI and emits nothing.
  const promptOpts = isLanding ? undefined : {
    globalVar: '__HOME_PROMPT_OPTS__',
    value: { ...buildPromptOpts({ openRouterSource, featureFlags, customPrompts, isLocalhost }), topTaskId, topTaskWhy }
  }

  // LIN-3833: the copy-first card (a viewer with no runner, not yet dismissed) takes the same slot as the
  // seed-only hint: one onboarding line at the top of Home, never two.
  const onboardingHint = (!isLanding && topTaskOnboarding)
    ? `<div class="home-onboarding-hint" data-testid="home-top-task-onboarding">Your workspace is ready. Add your own task to get started — the welcome tasks are just a starting point.</div>`
    : (!isLanding && copyFirstCard)
      ? `<div class="home-onboarding-hint home-copy-first-card" data-testid="home-copy-first-card">`
        + `<p>Open a task and Harbour writes a prompt for its next step. Paste it into Claude Code, Codex or any coding agent, and it has everything it needs.</p>`
        + `<button class="home-copy-first-dismiss" data-testid="home-copy-first-dismiss">Got it</button>`
        + `</div>`
      : ''
  const setupNoticeHtml = setupNotice ? `<div class="setup-notice">
    <p>┌─ Getting started</p>
    <p>│  Set <code>LINEAR_ACCESS_TOKEN</code> in your <code>.env</code> file to log in automatically.</p>
    <p>│  Get a token from <a href="https://linear.app/settings/api">linear.app/settings/api</a></p>
    <p>└─ Or configure OAuth — see <code>.env.example</code> for details.</p>
  </div>` : ''
  const truncatedHtml = truncated ? `<div class="truncation-notice">
    <p>⚠ Some issues could not be loaded — the read hit its results cap. The board below is incomplete.</p>
  </div>` : ''
  // LIN-3774: a secondary source that still failed after one renewal attempt is left out
  // and named here, instead of failing the whole board. Empty/absent renders ''
  // so a single-source page stays byte-identical. Reuses .truncation-notice.
  // Copy: what happened, what still works, what the reader can do
  // (docs/papers/harbour/plain-language.md).
  // The sentence uses the provider's display name; data-source keeps the raw key.
  const degradedHtml = (degradedSources || []).map(({ provider, scope }) => {
    const label = escapeHtml(getProvider(provider)?.ui?.displayName || provider)
    return `<div class="truncation-notice" data-testid="dashboard-source-notice" data-source="${escapeHtml(provider)}">
    <p>⚠ ${label} (${escapeHtml(scope)}) did not load, so its tasks are missing. The rest of this board is up to date. Reload to try again; if it keeps happening, reconnect ${label} in Settings.</p>
  </div>`
  }).join('\n  ')

  return renderPageShell({
    title: `${escapeHtml(pageTitle)} - Projects`,
    stylesheets: isLanding ? ['/style.css'] : ['/style.css', '/swipe.css'],
    htmlComment: 'AI agents: see /llms.txt for navigation guidance',
    bodyClass: isLanding ? 'is-landing' : undefined,
    bodyAttrs: bodyAttrs || undefined,
    nav: navBarHtml,
    embeddedData: promptOpts,
    scripts: ['/common.js', '/purify.min.js', '/marked.min.js', '/prompt-section.js', '/brief.js', '/recap.js', '/scan.js', '/context.js', '/sessions.js', '/app.js'],
    content: `${heroHtml || renderPageHeader({ title: pageTitle })}
  ${!isLanding ? renderSearchPanel() : ''}
  ${onboardingHint}
  ${setupNoticeHtml}
  ${truncatedHtml}${degradedHtml}
  <main>
    ${inProgressHtml}
    ${recentActivityHtml}
    ${renderSection({ attrs: 'role="region" aria-label="Projects"', body: projectsHtml })}
  </main>
  ${footerHtml}
  <!-- common.js must load first: provides escapeHtml() used by app.js -->`
  })
}

// =============================================================================
// Sections
// =============================================================================

function renderInProgressSection(inProgressTrees, ctx) {
  if (!inProgressTrees || inProgressTrees.length === 0) return ''

  // LIN-3833: ranked by the row states (needs you, next, running, rest); project order breaks ties.
  const itemsHtml = orderInProgress(inProgressTrees, ctx.rowStates)
    .map(({ projectName, node }) => renderNodeHtml(node, 'in-progress-root', ctx, { section: 'in-progress', projectName }))
    .join('\n')
  const countLine = ctx.rowStates ? buildInProgressCountLine(inProgressTrees, ctx.rowStates) : null

  return `
  <div class="in-progress-section" role="region" aria-label="In Progress Tasks">
    <div class="in-progress-header">▼ In Progress</div>${countLine ? `
    <div class="in-progress-count" data-testid="in-progress-count">${escapeHtml(countLine)}</div>` : ''}
    <div class="in-progress-items tree">
      ${itemsHtml}
    </div>
  </div>`
}

// A flat list; every node carries its own `projectName`.
function renderRecentActivitySection(recentActivityTrees, ctx) {
  if (!recentActivityTrees || recentActivityTrees.length === 0) return ''

  const itemsHtml = recentActivityTrees
    .flatMap(({ roots }) => roots.map(node => renderNodeHtml(node, 'recent-activity-root', ctx, { section: 'recent-activity' })))
    .join('\n')

  return `
  <div class="recent-activity-section" role="region" aria-label="Recent activity">
    <div class="recent-activity-header">▶ Recent activity</div>
    <div class="recent-activity-items tree hidden">
      ${itemsHtml}
    </div>
  </div>`
}

function renderProject({ project, incomplete, completed, completedCount }, ctx) {
  const { isLanding, urlKey, provider, ui } = ctx

  // LIN-341: the synthetic Periodicals group renders dispatchable template rows, not issues.
  if (project.id === PERIODICALS_PROJECT_ID) {
    return renderPeriodicalProject({ project, incomplete }, ctx)
  }

  const description = project.content ? renderProjectDescription(project.content, project.id) : ''
  const projectTarget = project.sameTab ? '' : ' target="_blank"'
  const viewLink = project.url
    ? `<a href="${project.url}"${projectTarget} class="detail-link">${project.linkText || `View in ${ui.displayName} →`}</a>`
    : ''
  const projectLink = viewLink ? `<div class="project-meta">${viewLink}</div>` : ''

  const renderNodes = nodes => nodes.map(node => renderNodeHtml(node, project.id, ctx, { section: 'project' })).join('\n')
  const incompleteTree = incomplete.length > 0 ? `<div class="tree">${renderNodes(incomplete)}</div>` : ''
  const completedHtml = completed.length > 0
    ? `<div class="tree hidden" data-completed-for="${project.id}">${renderNodes(completed)}</div>`
    : ''
  const completedToggle = completedCount > 0
    ? `<div class="completed-toggle" data-project-id="${project.id}" data-count="${completedCount}">show ${completedCount} completed</div>`
    : ''
  const defaultCollapsed = project.collapsed ? ' data-default-collapsed="true"' : ''

  // Only a *real* project gets an add-task link: synthetic ids ('__periodicals__',
  // '__no_project__') would yield a broken create URL (LIN-341). Gated on the
  // provider's UI capabilities, never a pinned Linear lookup (LIN-177 S3);
  // `ui.write` is true iff the provider overrides getCreateTaskUrl, so the call is safe.
  const createTaskProvider = provider || getProvider('linear')
  const isRealProject = !isLanding && urlKey && project.id && !project.id.startsWith('__')
  // LIN-1553/LIN-1973: providers with session-auth createIssue (ui.inlineCreate)
  // link to the dedicated create page; providers with only an external create
  // affordance (ui.write) keep the original target="_blank" deep-link. The second
  // branch is pinned verbatim by render.test.js (LIN-1973 F2).
  let addTaskLink = ''
  if (isRealProject && ui.inlineCreate) {
    const createHref = `/workspace/${encodeURIComponent(urlKey)}/task/new?projectId=${encodeURIComponent(project.id)}`
    addTaskLink = `<div class="add-task-link" data-testid="create-task"><a href="${createHref}" class="detail-link" data-testid="create-task-trigger">+ Add task</a></div>`
  } else if (isRealProject && ui.write) {
    addTaskLink = `<div class="add-task-link"><a href="${createTaskProvider.getCreateTaskUrl(urlKey, project.id)}" target="_blank" class="detail-link" data-action="create-task">+ Add task</a></div>`
  }

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

// Long descriptions get a "show more" pair, cut at a word boundary.
function renderProjectDescription(description, projectId) {
  const maxLength = 150
  const escaped = escapeHtml(description)

  if (description.length <= maxLength) {
    return `<div class="project-description">${escaped}</div>`
  }

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

// =============================================================================
// Periodicals (LIN-341): template rows, not issues. No "View in Linear", no
// prompt buttons, no add-task link. `data-project-type="periodicals"` drives the
// distinct colour rule in public/style.css.
// =============================================================================

function renderPeriodicalProject({ project, incomplete }, ctx) {
  const rows = incomplete.map(node => renderPeriodicalNode(node, ctx)).join('\n')
  const rowsTree = rows ? `<div class="tree">${rows}</div>` : ''

  return `
  <div class="project" data-id="${escapeHtml(project.id)}" data-project-type="periodicals">
    <div class="project-header">▼ ${escapeHtml(project.name)}</div>
    ${rowsTree}
  </div>`
}

function renderPeriodicalNode({ issue, periodical = {} }, { isLanding, urlKey, isLocalhost, featureFlags }) {
  const id = issue.id
  const title = periodical.title || issue.title || ''
  const mode = periodical.mode || ''

  const modeBadge = mode ? `<span class="periodical-mode">${escapeHtml(mode)}</span>` : ''
  const line = `<div class="line expandable" role="button" tabindex="0" aria-expanded="false" data-id="${escapeHtml(id)}" data-parent="${escapeHtml(PERIODICALS_PROJECT_ID)}" data-depth="0" data-section="project" style="--depth: 0"><span class="state periodical-state" data-status="periodical" aria-label="Periodical">↻</span><span class="title">${escapeHtml(title)}</span>${modeBadge}<span class="toggle">▶</span></div>`

  // The landing page has no dispatch affordance: just the row.
  if (isLanding) {
    return `<div class="node" data-id="${escapeHtml(id)}">${line}</div>`
  }

  // The container carries no issue id: the shared client handler sees the absent issueId and sends `issueless: true`
  // (public/app.js, LIN-345).
  // LIN-3849: the Dispatch disclosure is a run control (it was ungated before).
  const runControls = featureFlags?.runControls === true
  const container = renderPromptContainer({
    name: title,
    content: escapeHtml(periodical.prompt || ''),
    urlKey,
    dispatchEnabled: runControls,
    isLocalhost,
    kind: 'periodical',
    periodicalId: id,
    optionsId: `periodical-options-${id}`
  })

  // LIN-1279: "Mint + Autopilot" dispatches the same prompt plus the
  // autopilot-handoff tail with proxy context forced on. Always rendered
  // (LIN-3849: key tools have no switch).
  const autopilotContainer = renderPromptContainer({
    name: `${title} + Autopilot`,
    content: escapeHtml(periodical.autopilotPrompt || ''),
    urlKey,
    dispatchEnabled: runControls,
    isLocalhost,
    kind: 'periodical',
    periodicalId: id,
    optionsId: `periodical-autopilot-options-${id}`,
    proxyForce: true
  })

  const details = `<div class="details hidden" data-details-for="${escapeHtml(id)}" data-section="project" style="--depth: 0"><div class="detail-content" data-content="prompts">${container}${autopilotContainer}</div></div>`

  return `<div class="node" data-id="${escapeHtml(id)}">${line}${details}</div>`
}

// =============================================================================
// Issue rows
// =============================================================================

/**
 * One issue node and its children.
 * @param {TreeNode|InProgressTreeNode} node
 * @param {string} parentId - raw, for `data-parent`
 * @param {Object} ctx - per-render context from renderPage
 * @param {{section: string, projectName?: string|null}} where - the section the row renders in
 */
function renderNodeHtml(node, parentId, ctx, where) {
  const { isLanding, urlKey, showSource, topTask } = ctx
  const { section, projectName = null } = where
  const { issue, children, depth } = node

  const { class: stateClass, char: stateChar, label: stateLabel } = getStateDisplay(issue.state?.type || 'unstarted')
  const hasChildren = children.length > 0
  const hasDetails = issue.url || issue.description || issue.assignee || issue.estimate || issue.dueDate || issue.completedAt || (issue.labels?.nodes?.length > 0)
  // Children or details make the row expandable (collapsed, ▶, until clicked).
  const canExpand = hasChildren || hasDetails
  const source = issueSource(issue)

  // Badges after the title, in this order.
  const isFeed = section === 'in-progress' || section === 'recent-activity'
  const feedProjectName = section === 'recent-activity' ? node.projectName : projectName
  const badges = []
  // Recent activity: the node's own activity time/kind (LIN-490); falls back to
  // completedAt for callers that attach no activity metadata.
  const activityAt = section === 'recent-activity' ? (node.activityAt || issue.completedAt) : null
  if (section === 'recent-activity' && depth === 0 && activityAt) {
    const activityWord = node.activityKind ? `${node.activityKind} ` : ''
    badges.push(`<span class="completed-time">${activityWord}${formatRelativeTime(activityAt)}</span>`)
  }
  if (isFeed && depth === 0 && feedProjectName) {
    badges.push(`<span class="in-progress-project">(${escapeHtml(feedProjectName)})</span>`)
  }
  // LIN-903: a nested in-progress subtask whose own project differs from its
  // display group shows it as an inline tag (set by buildInProgressForest only
  // when it differs). Inline span only: the box-drawing scaffold is LIN-850 LOCKED.
  if (section === 'in-progress' && depth > 0 && node.projectTag) {
    badges.push(`<span class="in-progress-project">(${escapeHtml(node.projectTag)})</span>`)
  }
  // LIN-544: where the task came from, only in a workspace merging >1 provider.
  if (showSource) {
    badges.push(`<span class="source-badge" data-testid="issue-source" data-source="${escapeHtml(source)}">${escapeHtml(source)}</span>`)
  }
  if (canExpand) badges.push('<span class="toggle">▶</span>')

  // Search text joins the raw fields so the input matches content, not HTML
  // entities, then is escaped once for the attribute.
  const searchText = escapeHtml([
    issue.title,
    issue.description || '',
    issue.assignee?.name || '',
    issue.identifier || '',
    ...(issue.labels?.nodes || []).map(l => l.name)
  ].join(' ').toLowerCase())

  const lineClasses = ['line', canExpand && 'expandable', hasChildren && 'has-children'].filter(Boolean).join(' ')
  // LIN-566: expandable rows are real keyboard controls; aria-expanded is owned by
  // toggleItem (and applyState on load) in the client.
  const expandableAttrs = canExpand ? ' role="button" tabindex="0" aria-expanded="false"' : ''

  // LIN-2944 P1 F3 / N2: mark Home's top task on the first row whose binding-aware
  // key (`nodeKey` = `source:id`, the key orderIssuesForSwipe uses) matches, not the
  // raw id: with repoA#1 and repoB#1 only the front card's own row is marked. The
  // shared holder is consumed once so the same issue's two appearances (LIN-732)
  // get one mark.
  let topTaskAttrs = ''
  if (topTask && !topTask.marked && nodeKey(issue) === topTask.key) {
    topTask.marked = true
    topTaskAttrs = ` data-top-task="1" data-why="${escapeHtml(JSON.stringify(topTask.why || []))}"`
  }

  const status = renderStatusPill({ state: stateClass, char: stateChar, variant: 'bare', attrs: `data-status="${stateClass}" aria-label="Status: ${stateLabel}"` })
  // LIN-3833: the task's state words, on In Progress rows only. An inline span after the title, so
  // the box-drawing scaffold (LIN-850, locked) is untouched; CSS moves it under the title on a phone.
  const rowWords = section === 'in-progress' ? ctx.rowStates?.get(issue.identifier)?.words : null
  const rowStateHtml = rowWords ? `<span class="row-state" data-testid="issue-row-state">${escapeHtml(rowWords)}</span>` : ''
  const line = `<div class="${lineClasses}"${expandableAttrs} data-id="${issue.id}"${topTaskAttrs} data-testid="issue-line" data-identifier="${escapeHtml(issue.identifier || '')}" data-parent="${parentId}" data-depth="${depth}" data-section="${section}" data-search-text="${searchText}" style="--depth: ${depth}">${status}<span class="${stateClass === 'done' ? 'title done' : 'title'}">${escapeHtml(issue.title)}</span>${rowStateHtml}${badges.join('')}</div>`

  // LIN-442: the signed-in dashboard defers the detail block (the dominant
  // per-issue payload) to `/api/detail/:issueId` on first expand, so the row
  // carries an empty lazy wrapper. The landing page has no such route, so it
  // renders details inline.
  let details = ''
  if (hasDetails) {
    if (isLanding) {
      const content = renderDetailsContent(issue, { isLanding, urlKey, featureFlags: ctx.featureFlags, provider: ctx.provider, section })
      if (content) {
        details = `<div class="details hidden" data-details-for="${issue.id}" data-section="${section}" style="--depth: ${depth}">${content}</div>`
      }
    } else {
      const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
      // LIN-1903: the issue's own provenance goes on the wrapper unconditionally
      // (unlike the badge) so the client can forward it as `/api/detail`'s `source`
      // and resolve THIS issue's binding in a merged multi-binding workspace.
      details = `<div class="details hidden" data-details-for="${issue.id}" data-section="${section}" data-source="${escapeHtml(source)}" data-lazy="1"${urlKeyAttr} style="--depth: ${depth}"></div>`
    }
  }

  const childrenHtml = hasChildren
    ? `<div class="children">${children.map(child => renderNodeHtml(child, issue.id, ctx, where)).join('\n')}</div>`
    : ''

  return `<div class="${depth > 0 ? 'node hidden' : 'node'}" data-id="${issue.id}">${line}${details}${childrenHtml}</div>`
}

// =============================================================================
// Details fragment
// =============================================================================

/** Non-promptable labels as escaped, comma-joined plain text. */
export function renderDisplayLabels(issue) {
  return (issue.labels?.nodes || [])
    .filter(l => !PROMPT_LABELS.has(l.name))
    .map(l => escapeHtml(l.name))
    .join(', ')
}

const detailLine = text => `<div class="detail-line"><span class="detail-text">${escapeHtml(text.trim())}</span></div>`

// Up to `max` non-empty lines as detail lines.
function detailLines(text, max) {
  return text.split('\n').slice(0, max).filter(l => l.trim()).map(detailLine)
}

// The description block. Only the landing page splits `---` delimited prompt
// blocks out as copyable prompts (LIN-151: real issues with markdown `---`
// separators must not become prompt containers).
function descriptionRows(issue, { isLanding, urlKey }) {
  if (!issue.description) return []
  const desc = issue.description.trim()

  const promptBlock = isLanding && desc.match(/^([\s\S]*?)---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/)
  if (promptBlock) {
    const [, intro, promptContent, remainder] = promptBlock
    return [
      ...(intro.trim() ? detailLines(intro.trim(), 3) : []),
      ...(promptContent.trim() ? [renderPromptContainer({ name: 'Setup Prompt', content: escapeHtml(promptContent.trim()) })] : []),
      ...(remainder?.trim() ? detailLines(remainder.trim(), 2) : [])
    ]
  }

  const descLines = desc.split('\n')
  if ((descLines.length > 3 || desc.length > 300) && !isLanding) {
    // LIN-156: long descriptions get show more/less. The raw text rides along as
    // base64 so the client can render markdown from an attribute-safe value.
    const truncatedText = descLines.slice(0, 3).filter(l => l.trim()).map(l => escapeHtml(l.trim())).join('<br>')
    const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''
    return [`<div class="issue-description" data-desc-id="${issue.id}" data-raw-desc="${Buffer.from(desc).toString('base64')}"${urlKeyAttr}>
          <span class="desc-truncated">${truncatedText}${descLines.length > 3 ? '…' : ''} <button class="issue-desc-toggle">show more</button></span>
          <span class="desc-full hidden"><span class="desc-full-content"></span> <button class="issue-desc-toggle">show less</button></span>
        </div>`]
  }
  return detailLines(desc, 3)
}

// "LIN-1 · Ada · 3 pts · due Oct 5 · label". Each provider-supplied item is
// escaped on its own (never the joined string: the labels item is already HTML).
function metaRow(issue, ui) {
  const meta = []
  if (issue.identifier) meta.push(escapeHtml(issue.identifier))
  if (issue.assignee?.name) meta.push(escapeHtml(issue.assignee.name))
  if (issue.estimate && ui.estimates) meta.push(escapeHtml(`${issue.estimate} pts`))
  if (issue.completedAt) {
    meta.push(`completed ${formatDate(issue.completedAt)}`)
  } else if (issue.dueDate) {
    meta.push(`due ${formatDate(issue.dueDate)}`)
  }
  const labelsHtml = renderDisplayLabels(issue)
  if (labelsHtml) meta.push(labelsHtml)
  return meta.length > 0 ? [`<div class="detail-line"><span class="detail-meta">${meta.join(' · ')}</span></div>`] : []
}

// The lazy toggles (LIN-522): each is initialised on first expand by its client
// module (public/app.js loadLazySection). Order is the page order; sessions needs
// the run controls (LIN-3849: no way to run means no sessions can exist).
const LAZY_SECTIONS = [
  { name: 'brief', label: 'Brief' },
  { name: 'recap', label: 'Recap' },
  { name: 'scan', label: 'Scan' }, // LIN-2197: human-triggered; only the status check runs on expand
  { name: 'context', label: 'Context' },
  { name: 'sessions', label: 'Dispatched Sessions', needsFlag: 'runControls' }
]

function lazySectionRows(attrs, featureFlags) {
  return LAZY_SECTIONS
    .filter(({ needsFlag }) => !needsFlag || featureFlags[needsFlag] === true)
    .flatMap(({ name, label }) => [
      `<div class="detail-toggle nested-toggle" data-toggle="${name}"${attrs}>${label} ▶</div>`,
      `<div class="detail-content hidden" data-content="${name}"><div class="${name}-section" data-${name}-placeholder="1"></div></div>`
    ])
}

function attachmentRows(issue, urlKey) {
  const images = collectTaskImages(issue, issue.comments?.nodes || issue.comments || [])
  if (images.length === 0) return []
  const items = images.map(img => {
    const src = imageRelaySrc(img.url, urlKey)
    const titleAttr = img.title ? ` title="${escapeHtml(img.title)}"` : ''
    return `<a class="attachment-item" href="${escapeHtml(src)}" target="_blank" rel="noopener" data-source="${escapeHtml(img.source)}"><img class="attachment-image" src="${escapeHtml(src)}" loading="lazy" alt="${escapeHtml(img.title || 'attachment')}"${titleAttr} data-original-src="${escapeHtml(img.url)}"></a>`
  }).join('')
  return [
    `<div class="detail-toggle nested-toggle" data-toggle="attachments" data-testid="attachments-toggle" data-url-key="${escapeHtml(urlKey)}">Attachments (${images.length}) ▶</div>`,
    `<div class="detail-content hidden" data-content="attachments" data-testid="attachments-content"><div class="attachments-grid">${items}</div></div>`
  ]
}

/**
 * The INNER content of an issue's details block, without the `.details` wrapper
 * ('' when there is nothing to show). The signed-in dashboard serves it lazily
 * (`/api/detail/:issueId`, LIN-442); the landing page inlines it.
 *
 * Position-independent except the dispatch-disclosure ids, which must be unique per
 * render instance: the same issue can appear in two sections at once (LIN-732), so
 * `section` is folded into the instance key.
 *
 * @param {Issue} issue - raw `{ nodes }`-labelled shape
 * @param {Object} [opts]
 * @param {string} [opts.section] - section the instance renders in
 * @returns {string}
 */
/**
 * LIN-3833: the opened task on Home, state first. The facts, then the opened-task control
 * (PromptSection's state block and its step or run control, mounted here), then one links row, then
 * folds: Sessions, Description (with Edit), Comments and Attachments. Folded by default; each opens in
 * place through the shared `.detail-toggle` handler. Brief, Recap, Scan and Context leave Home (they
 * stay on Swipe), and the nine Details toggles and the Prompts toggle are gone. Signed-in only.
 *
 * Viewers without a runner (copy-first) get the quiet "run on my machine ›" line; a run-controls
 * viewer already has a runner, so no runner line is shown to them.
 */
function renderHomeDetailsContent(issue, { urlKey, featureFlags, provider, section }) {
  const ui = uiOf(provider)
  const providerName = provider?.name
  const sourceAttr = providerName ? ` data-source="${escapeHtml(providerName)}"` : ''
  const instanceKey = section ? `${section}-${issue.id}` : issue.id
  const identifier = issue.identifier || issue.id
  const runControls = featureFlags.runControls === true
  const lines = []

  const facts = [identifier, issue.project?.name || null, issue.updatedAt ? `updated ${formatRelativeTime(issue.updatedAt)}` : null]
  lines.push(`<div class="opened-task-facts" data-testid="opened-task-facts">${facts.filter(Boolean).map(f => escapeHtml(f)).join(' \u00b7 ')}</div>`)

  // The opened-task component: the state block and the control come from PromptSection (see
  // public/app.js mountHomePromptSections), so Home and Swipe share them.
  lines.push(`<div class="home-prompt-mount" data-prompt-mount="1"` +
    ` data-issue-id="${escapeHtml(issue.id)}"` +
    ` data-identifier="${escapeHtml(issue.identifier || '')}"` +
    ` data-title="${escapeHtml(issue.title || '')}"` +
    ` data-url="${escapeHtml(issue.url || '')}"` +
    sourceAttr +
    ` data-url-key="${escapeHtml(urlKey || '')}"` +
    ` data-node-key="${escapeHtml(nodeKey(issue))}"` +
    ` data-state-type="${escapeHtml(issue.state?.type || '')}"` +
    ` data-instance-key="${escapeHtml(instanceKey)}"></div>`)

  const links = []
  const taskHref = taskPageHref({ urlKey, identifier, source: providerName })
  if (taskHref) links.push(`<a class="detail-link task-page-link" href="${escapeHtml(taskHref)}" data-testid="issue-task-page-link">Task page \u203A</a>`)
  if (featureFlags.taskChat === true) {
    const chatQuery = sourceQuery(providerName)
    const chatHref = `/workspace/${encodeURIComponent(urlKey)}/task-chat?task=${encodeURIComponent(identifier)}${chatQuery ? `&${chatQuery}` : ''}`
    links.push(`<a class="detail-link" href="${escapeHtml(chatHref)}" data-testid="issue-chat-link">Chat \u2197</a>`)
  }
  if (issue.url) {
    const target = issue.sameTab ? '' : ' target="_blank"'
    const linkText = issue.linkText || `Open in ${ui.displayName} \u2197`
    links.push(`<a href="${escapeHtml(issue.url)}"${target} class="detail-link" data-testid="issue-provider-link">${escapeHtml(linkText)}</a>`)
  }
  if (links.length) lines.push(`<div class="opened-task-links">${links.join('')}</div>`)

  const sectionAttrs = ` data-issue-identifier="${escapeHtml(identifier)}" data-url-key="${escapeHtml(urlKey)}"${sourceAttr}`
  if (runControls) {
    lines.push(`<div class="detail-toggle nested-toggle" data-toggle="sessions" data-testid="sessions-toggle"${sectionAttrs}>Sessions \u25B6</div>`)
    lines.push('<div class="detail-content hidden" data-content="sessions"><div class="sessions-section" data-sessions-placeholder="1"></div></div>')
  }

  const description = [...descriptionRows(issue, { isLanding: false, urlKey }), ...metaRow(issue, ui)]
  if (ui.inlineEdit) {
    const editQuery = sourceQuery(providerName)
    const editHref = `/workspace/${encodeURIComponent(urlKey)}/task/${encodeURIComponent(issue.id)}/edit${editQuery ? '?' + editQuery : ''}`
    description.push(`<a class="detail-toggle nested-toggle" href="${escapeHtml(editHref)}" data-testid="issue-edit-link">Edit \u2197</a>`)
  }
  if (description.length > 0) {
    lines.push('<div class="detail-toggle nested-toggle" data-toggle="description" data-testid="issue-description-toggle">Description \u25B6</div>')
    lines.push(`<div class="detail-content hidden" data-content="description">${description.join('')}</div>`)
  }

  if (ui.comments) {
    lines.push(`<div class="detail-toggle nested-toggle" data-toggle="comments" data-issue-id="${escapeHtml(issue.id)}" data-url-key="${escapeHtml(urlKey)}"${sourceAttr}>Comments \u25B6</div>`)
    lines.push(`<div class="detail-content hidden" data-content="comments">
      <div class="comments-loading hidden">Loading comments...</div>
      <div class="comments-error hidden"></div>
      <div class="comments-list"></div>
    </div>`)
  }
  if (ui.attachments) lines.push(...attachmentRows(issue, urlKey))

  // A copy-first viewer has no runner yet: the quiet setup line. A run-controls viewer has one.
  if (!runControls) lines.push(`<div class="detail-line">${renderRunnerLink(urlKey)}</div>`)

  return lines.join('')
}

export function renderDetailsContent(issue, { isLanding = false, urlKey = null, featureFlags = {}, provider = null, section = '', layout = 'legacy' } = {}) {
  // LIN-3833: the Home layout (state first, folds, one links row) is opt-in: the lazy detail route asks
  // for it. The default, and the landing branch, keep today's markup (C14; lin-3833-landing-details-pin).
  if (layout === 'home' && !isLanding) return renderHomeDetailsContent(issue, { urlKey, featureFlags, provider, section })
  const ui = uiOf(provider)
  const signedIn = !isLanding && !!urlKey
  const instanceKey = section ? `${section}-${issue.id}` : issue.id
  const providerName = provider?.name
  // LIN-1904/LIN-1910: the resolved provider rides along as `?source=` / `data-source`
  // so each fragment resolves THIS issue's own provider, not the workspace's active one.
  const sourceAttr = providerName ? ` data-source="${escapeHtml(providerName)}"` : ''
  const identifier = issue.identifier || issue.id

  const details = [...descriptionRows(issue, { isLanding, urlKey }), ...metaRow(issue, ui)]

  // LIN-1553/LIN-1565: link to the dedicated task-edit page, gated on
  // ui.inlineEdit ONLY (the route re-reads the same flag, so the two never
  // disagree). An <a>, so app.js leaves it as a plain link. Carries the canonical id.
  if (signedIn && ui.inlineEdit) {
    const editQuery = sourceQuery(providerName)
    const editHref = `/workspace/${encodeURIComponent(urlKey)}/task/${encodeURIComponent(issue.id)}/edit${editQuery ? '?' + editQuery : ''}`
    details.push(`<a class="detail-toggle nested-toggle" href="${escapeHtml(editHref)}" data-testid="issue-edit-link">Edit ↗</a>`)
  }

  // LIN-3331: the one entry point to the per-task page. Deliberately outside the
  // inlineEdit gate: the task page is a drill-down with no view-tier flag.
  if (signedIn) {
    const taskHref = taskPageHref({ urlKey, identifier, source: providerName })
    if (taskHref) {
      details.push(`<a class="detail-toggle nested-toggle task-page-link" href="${escapeHtml(taskHref)}" data-testid="issue-task-page-link">task page ↗</a>`)
    }
  }

  // LIN-158: comments live inside Details so users expand the description first.
  if (signedIn && ui.comments) {
    details.push(`<div class="detail-toggle nested-toggle" data-toggle="comments" data-issue-id="${escapeHtml(issue.id)}" data-url-key="${escapeHtml(urlKey)}"${sourceAttr}>Comments ▶</div>`)
    details.push(`<div class="detail-content hidden" data-content="comments">
      <div class="comments-loading hidden">Loading comments...</div>
      <div class="comments-error hidden"></div>
      <div class="comments-list"></div>
    </div>`)
  }

  // LIN-652: hidden gallery of every image attached to the task, only when at
  // least one exists, and only for providers with the `attachments` capability.
  if (signedIn && ui.attachments) {
    details.push(...attachmentRows(issue, urlKey))
  }

  if (signedIn) {
    const sectionAttrs = ` data-issue-identifier="${escapeHtml(identifier)}" data-url-key="${escapeHtml(urlKey)}"${sourceAttr}`
    details.push(...lazySectionRows(sectionAttrs, featureFlags))

    // LIN-1007: flag-gated navigation to the experimental task-chat page with THIS
    // task preselected (`?task=`); the one narrow exception to "experimental
    // surfaces are a Settings link only". Strictly `taskChat === true`.
    if (featureFlags.taskChat === true) {
      const chatQuery = sourceQuery(providerName)
      const chatHref = `/workspace/${encodeURIComponent(urlKey)}/task-chat?task=${encodeURIComponent(identifier)}${chatQuery ? `&${chatQuery}` : ''}`
      details.push(`<a class="detail-toggle nested-toggle" href="${escapeHtml(chatHref)}" data-testid="issue-chat-link">Chat ↗</a>`)
    }
  }

  const lines = []
  if (details.length > 0) {
    lines.push(`<div class="detail-toggle" data-toggle="details">Details ▶</div>`)
    lines.push(`<div class="detail-content hidden" data-content="details">${details.join('')}</div>`)
  }

  // LIN-2944 P1: Home mounts the same `PromptSection` Swipe uses. The server emits
  // one placeholder with the issue's identity, provenance (LIN-1904/LIN-1910) and
  // per-instance key (LIN-732); public/app.js mounts it after the lazy fragment is
  // injected, fed by `window.__HOME_PROMPT_OPTS__`. Always rendered for signed-in
  // users: F9 shows the disabled primary with a reason rather than hiding it.
  if (!isLanding) {
    // N2: `data-node-key` is the binding-aware key, so the client can tell whether
    // THIS opened task is the marked top one.
    const mount = `<div class="home-prompt-mount" data-prompt-mount="1"` +
      ` data-issue-id="${escapeHtml(issue.id)}"` +
      ` data-identifier="${escapeHtml(issue.identifier || '')}"` +
      ` data-title="${escapeHtml(issue.title || '')}"` +
      ` data-url="${escapeHtml(issue.url || '')}"` +
      sourceAttr +
      ` data-url-key="${escapeHtml(urlKey || '')}"` +
      ` data-node-key="${escapeHtml(nodeKey(issue))}"` +
      ` data-instance-key="${escapeHtml(instanceKey)}"></div>`
    lines.push(`<div class="detail-toggle" data-toggle="prompts">Prompts ▶</div>`)
    lines.push(`<div class="detail-content hidden" data-content="prompts">${mount}</div>`)
  }

  // LIN-3098 S4b: "run on my machine ›" sits outside both collapsed sections so it
  // shows as soon as the task opens, whatever the flags say.
  if (signedIn) {
    lines.push(`<div class="detail-line">${renderRunnerLink(urlKey)}</div>`)
  }

  if (issue.url) {
    const linkText = issue.linkText || `View in ${ui.displayName} →`
    const target = issue.sameTab ? '' : ' target="_blank"'
    lines.push(`<div class="detail-line"><a href="${issue.url}"${target} class="detail-link">${linkText}</a></div>`)
  }

  return lines.join('')
}
