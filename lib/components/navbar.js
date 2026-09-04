/**
 * Shared Navigation Bar Component
 *
 * Renders the unified navigation bar for all authenticated pages.
 * Supports workspace switching from any page, with team filtering on every
 * page that scopes its provider read by `?team=` (LIN-2519).
 */

import { escapeHtml } from '../utils/html.js';
import { renderWordmark } from './wordmark.js';
import { renderViewNav } from './view-nav.js';
import { getProvider } from '../providers/index.js';

/**
 * @typedef {import('../workspace.js').Workspace} Workspace
 */

/**
 * Team object from Linear API
 * @typedef {Object} Team
 * @property {string} id - Team ID
 * @property {string} name - Team name
 * @property {string} key - Team key (abbreviation)
 */

/**
 * Pages that scope their provider read by `?team=` and so render the team
 * selector (LIN-2519). Reach change only — the workspace switcher stays
 * unconditional and the assignee selector (LIN-2527) is gated on
 * `currentPage === 'projects'` directly, never this set.
 */
const FILTERABLE_PAGES = new Set(['projects', 'swipe', 'swim', 'ship', 'roadmap'])

/**
 * Options for renderNavBar
 * @typedef {Object} NavBarOptions
 * @property {Workspace[]} [workspaces] - Array of connected workspaces
 * @property {string|null} [urlKey] - Current workspace URL key (from URL, determines active workspace)
 * @property {'observation'|'swipe'|'swim'|'projects'|'settings'|'audit'|'prompts'|'dispatch'|'proxy'|'roadmap'} [currentPage] - Current page identifier
 * @property {Team[]} [teams] - Array of teams (only used on the five FILTERABLE_PAGES: projects, swipe, swim, ship, roadmap)
 * @property {string|null} [selectedTeamId] - Currently selected team ID (only used on the five FILTERABLE_PAGES)
 * @property {string[]} [assignees] - Array of assignee display names, sourced from the loaded issue set (dashboard-only, LIN-2527)
 * @property {string|null} [selectedAssignee] - Currently selected assignee: 'all', 'me', or a literal name (dashboard-only)
 * @property {boolean} [canFilterByMe] - Whether the `me` row should render (provider.supports('viewer'))
 * @property {boolean} [minimalNav] - When true (homepage only), suppress the
 *   landing top bar entirely. Default false preserves the shared `isLanding`
 *   sign-in bar the swipe/swim/ship previews depend on (LIN-1508).
 */

/**
 * Render the unified navigation bar
 * @param {NavBarOptions} options - Navigation options
 * @returns {string} HTML for navigation bar
 */
export function renderNavBar({ workspaces = [], urlKey = null, currentPage = 'projects', teams = [], selectedTeamId = null, assignees = [], selectedAssignee = null, canFilterByMe = false, featureFlags = {}, isLanding = false, minimalNav = false }) {
  // Homepage (LIN-1508): the landing hero already carries the primary sign-in
  // CTAs, so the shared top bar there is pure duplication — drop it entirely.
  // Scoped by `minimalNav` (homepage-only) so the SAME `isLanding` bar still
  // renders for the swipe/swim/ship previews below, where it is their ONLY
  // sign-in path (e2e-pinned). Emit nothing so no empty bar chrome remains.
  if (isLanding && minimalNav) {
    return ''
  }

  // Unauthenticated landing pages get a minimal nav with a sign-in CTA. The
  // GitHub CTA appears only when the GitHub OAuth app is configured (LIN-541).
  //
  // This bar is the SOLE sign-in path on the swipe/swim/ship previews, so every
  // CTA here is load-bearing rather than decorative.
  //
  // LIN-1890 E4 \u2014 why both gates are a CALL, not a threaded option. There is
  // no threading path to this component: `renderNavBar` is invoked from ~7 page
  // renderers, none of which take a provider-config argument, so threading
  // `githubEnabled`/`jiraEnabled` would mean seven edit sites per link and seven
  // chances for a future page to forget one and silently render a CTA into a
  // 503. Calling the provider-owned predicate directly keeps the promise and
  // the route's actual capability in ONE place.
  //
  // LIN-2010 acceptance #4: the GitHub CTA's inline `process.env.GITHUB_CLIENT_ID`
  // read is replaced with `getProvider('github').entryCta.isConfigured()` \u2014 the
  // provider-owned predicate (`isGitHubConfigured()`, all five GITHUB_* vars plus
  // a structurally-valid PEM), matching the gate the hero/Settings surfaces
  // already use. This is a real narrowing (a partially-configured server that
  // used to render this CTA no longer does), taken deliberately per the plan.
  if (isLanding) {
    const githubCta = getProvider('github')?.entryCta?.isConfigured()
      ? `<a href="${getProvider('github')?.entryCta?.href}" class="nav-action login" data-testid="nav-login-github">GitHub \u2192</a>`
      : ''
    const jiraCta = getProvider('jira')?.entryCta?.isConfigured()
      ? `<a href="${getProvider('jira')?.entryCta?.href}" class="nav-action login" data-testid="nav-login-jira">Jira \u2192</a>`
      : ''
    return `
  <nav class="nav-bar" aria-label="Main navigation">
    <div class="nav-filters"></div>
    <div class="nav-actions">
      <a href="/" class="nav-action">\u2190 projects</a>
      <form action="/workspace/new" method="POST" class="nav-action-form">
        <button type="submit" class="nav-action">+ local workspace</button>
      </form>
      ${/* LIN-1890 N4: `nav a.login` was the selector two landing e2e specs used
           to assert "the sign-in link". With a second (and now third) CTA
           carrying the same class that selector is ambiguous and strict-mode
           fails. The Linear CTA gains its own testid so specs can name the one
           they mean; the class stays for styling. */''}
      <a href="/auth/linear" class="nav-action login" data-testid="nav-login-linear">Sign in \u2192</a>
      ${githubCta}
      ${jiraCta}
    </div>
  </nav>`
  }

  // Use urlKey from URL to determine active workspace (enables multi-tab support)
  const workspaceNavItem = renderWorkspaceNavItem(workspaces, urlKey)
  const workspaceOptions = renderWorkspaceOptions(workspaces, urlKey, currentPage)

  // Team selector on every page that scopes its provider read by `?team=`
  // (LIN-2519 reach: projects, swipe, swim, ship, roadmap)
  const teamNavItem = FILTERABLE_PAGES.has(currentPage) ? renderTeamNavItem(teams, selectedTeamId) : ''
  const teamOptions = FILTERABLE_PAGES.has(currentPage) ? renderTeamOptions(teams, selectedTeamId, urlKey) : ''

  // Assignee selector — dashboard-only (LIN-2527). Gated on `currentPage ===
  // 'projects'` DIRECTLY, never FILTERABLE_PAGES: John's ruling narrowed the
  // assignee filter's reach to the dashboard alone (/swipe, /swim, /ship,
  // /roadmap keep the team selector but stay assignee-free — LIN-2518).
  // Reusing FILTERABLE_PAGES here would be actively wrong, not just unneeded.
  const assigneeNavItem = currentPage === 'projects' ? renderAssigneeNavItem(assignees, selectedAssignee) : ''
  const assigneeOptions = currentPage === 'projects' ? renderAssigneeOptions(assignees, selectedAssignee, urlKey, canFilterByMe) : ''

  const queueBadge = (urlKey && featureFlags.dispatch === true) ? renderQueueBadge(urlKey) : ''

  // Ambient "waiting on you" rulings count (LIN-1728 Phase 3). Same hidden/
  // feature-gated pattern as the queue badge above (gated on the same
  // `dispatch` flag — the rulings surface is part of the dispatch feature) —
  // deliberately NOT a new flag. `req.session.workspaces`-scoped, never
  // fleet-wide (public/app.js polls GET .../api/dashboard/rulings, which is
  // scoped the same way).
  const rulingsBadge = (urlKey && featureFlags.dispatch === true) ? renderRulingsBadge(urlKey) : ''

  // Header-level view switcher (LIN-978). The tier/flag-gated cross-view links
  // that used to live ONLY in the footer are hoisted here so cross-view
  // navigation is reachable from the sticky header on every workspace page —
  // no page-scroll to the footer on mobile. Sourced from the shared
  // `getViewNavLinks` single source of truth (drift guard), NOT re-implemented.
  const viewNav = renderViewNav({ urlKey, currentPage, featureFlags })

  // Lowercase `harbour` wordmark — the brand treatment for the app chrome
  // (LIN-725). It leads the nav filters so it reads top-left across every
  // authenticated page; links home to the workspace projects view when we have
  // a urlKey, else to the root. The landing nav (handled above) is deliberately
  // left untouched — landing visuals belong to LIN-726.
  const brandWordmark = renderWordmark({
    context: 'nav',
    href: urlKey ? `/workspace/${encodeURIComponent(urlKey)}/` : '/'
  })

  // Search toggle only on projects page. The search panel itself is rendered
  // separately, below the page title, by the projects-page renderer
  // (lib/render.js) via renderSearchPanel() (LIN-1512) — it no longer lives
  // in the nav bar's own output.
  const searchToggle = currentPage === 'projects'
    ? '<a href="#" class="nav-action search-toggle" aria-expanded="false">search</a>'
    : ''

  // Two-row hierarchy (LIN-1058 "Confident CLI tab strip"): row 1 groups
  // brand → workspace/team selectors → actions inside `.nav-primary-row`; row 2
  // is the full-width view tab strip (`${viewNav}`). Wrapping the selectors and
  // actions together lets the tab strip own its own row cleanly (beat 3 styles
  // the strip + active tab). Inner `.nav-filters`/`.nav-actions` and every
  // selector/testid are preserved so existing hooks keep working.
  return `
  <nav class="nav-bar" aria-label="Main navigation">
    <div class="nav-primary-row">
      <div class="nav-filters">
        ${brandWordmark}
        ${workspaceNavItem}
        ${teamNavItem}
        ${assigneeNavItem}
      </div>
      <div class="nav-actions">
        ${searchToggle}
        ${queueBadge}
        ${rulingsBadge}
        ${/* Nav-actions order (LIN-1149, extended LIN-1728): search (page-specific,
             projects only) before the queue badge before the rulings badge (both
             feature-gated, all pages). When all are present the rulings badge
             trails; on non-projects pages the badge(s) are the sole nav-action(s).
             Must not leak search onto non-projects pages and must not gate search
             on dispatch. */''}
      </div>
    </div>
    ${viewNav}
  </nav>
  ${workspaceOptions}
  ${teamOptions}
  ${assigneeOptions}`
}

/**
 * Render the page search panel (projects page only). Rendered by the page
 * renderer immediately below the page title, not by renderNavBar, so the
 * panel appears below the title in the DOM while the `search` toggle stays
 * in `.nav-actions` (LIN-1512). IDs/classes are unchanged so existing CSS
 * (public/style.css) and client bindings (public/app.js) keep working.
 * @returns {string} HTML for the search panel
 */
export function renderSearchPanel() {
  return `
  <div class="search-panel hidden" id="search-panel">
    <div class="search-input-row">
      <input type="text" id="search-input" class="search-input" placeholder="search issues..." autocomplete="off" />
      <button class="search-clear" id="search-clear">clear</button>
    </div>
    <div class="search-no-results hidden" id="search-no-results">no matching issues</div>
  </div>`
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
 * Render the ambient "waiting on you" rulings badge (LIN-1728 Phase 3).
 * Same hidden/feature-gated markup pattern as `renderQueueBadge` above, new
 * classnames (`rulings-badge`/`rulings-count`/`data-rulings-badge`) so the two
 * badges style and poll independently — the rulings badge rides a 5s cadence
 * (`window.updateRulingsBadge`, public/common.js) against
 * `GET .../api/dashboard/rulings`, not the queue badge's 1s
 * `QUEUE_POLL_INTERVAL_MS`.
 *
 * A real link, not a `<button>` (LIN-1728 review F6): the queue badge's
 * button opens an in-page panel, but there is no rulings panel on every
 * page — the surface it announces lives on the Observation page's Rulings
 * tab, so the markup's semantics (a navigable link) now match its actual
 * behaviour instead of a clickable-looking element that did nothing.
 * `?view=rulings` is read by `public/observation.js`'s `init()` as a deep
 * link into the tab.
 * @param {string} urlKey - Current workspace URL key
 * @returns {string} HTML for rulings badge
 */
function renderRulingsBadge(urlKey) {
  return `<a class="rulings-badge hidden" data-rulings-badge data-url-key="${escapeHtml(urlKey)}" href="/workspace/${encodeURIComponent(urlKey)}/observation?view=rulings" aria-label="Waiting on you — go to Rulings"><span class="rulings-count">0</span> waiting on you</a>`
}

/**
 * Render workspace nav item (the clickable "workspace: value" text)
 * @param {Workspace[]} workspaces - Array of connected workspaces
 * @param {string|null} urlKey - Current workspace URL key from URL
 * @returns {string} HTML for workspace nav item
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
 * @param {Team[]} teams - Array of teams
 * @param {string|null} selectedTeamId - Currently selected team ID
 * @returns {string} HTML for team nav item
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
 * Render assignee nav item (the clickable "assignee: value" text), mirroring
 * `renderTeamNavItem`. Dashboard-only (LIN-2527) — the caller gates on
 * `currentPage === 'projects'`, not this function.
 * @param {string[]} assignees - Array of assignee display names
 * @param {string|null} selectedAssignee - 'all', 'me', or a literal name
 * @returns {string} HTML for assignee nav item
 */
function renderAssigneeNavItem(assignees, selectedAssignee) {
  if (!assignees?.length) return ''
  const displayValue = selectedAssignee && selectedAssignee !== 'all' ? selectedAssignee : 'all'

  return `<div class="nav-item" data-selector="assignee">
      <span class="nav-label">assignee:</span>
      <button class="nav-value" id="assignee-toggle" aria-expanded="false" aria-haspopup="listbox" aria-controls="assignee-options">${escapeHtml(displayValue)}</button>
    </div>`
}

/**
 * Render assignee options panel (appears when assignee toggle is clicked),
 * mirroring `renderTeamOptions`' box-drawing layout and `.selected` marking
 * convention. Single-select, `all` default. The `me` row sits directly under
 * `all` and is present only when `canFilterByMe` (provider.supports('viewer')).
 * @param {string[]} assignees - Array of assignee display names
 * @param {string|null} selectedAssignee - 'all', 'me', or a literal name
 * @param {string|null} urlKey - Current workspace URL key for client-side navigation
 * @param {boolean} canFilterByMe - Whether the `me` row should render
 * @returns {string} HTML for assignee options panel
 */
function renderAssigneeOptions(assignees, selectedAssignee, urlKey = null, canFilterByMe = false) {
  if (!assignees?.length) return ''
  const sortedAssignees = [...assignees].sort((a, b) => a.localeCompare(b))

  const allSelected = !selectedAssignee || selectedAssignee === 'all'
  const allMarker = allSelected ? '●' : '○'
  const allClass = allSelected ? ' selected' : ''

  const meSelected = selectedAssignee === 'me'
  const meMarker = meSelected ? '●' : '○'
  const meClass = meSelected ? ' selected' : ''
  const meRow = canFilterByMe
    ? `<div class="nav-options-row">
      <span class="option-prefix">├─</span>
      <button class="nav-option${meClass}" role="option" aria-selected="${meSelected}" data-assignee="me">
        <span class="option-marker">${meMarker}</span> me
      </button>
    </div>`
    : ''

  const assigneeOptionsHtml = sortedAssignees.map((name, index) => {
    const isSelected = name === selectedAssignee
    const marker = isSelected ? '●' : '○'
    const selectedClass = isSelected ? ' selected' : ''
    const isLast = index === sortedAssignees.length - 1
    const prefix = isLast ? '└─' : '├─'

    return `<div class="nav-options-row">
      <span class="option-prefix">${prefix}</span>
      <button class="nav-option${selectedClass}" role="option" aria-selected="${isSelected}" data-assignee="${escapeHtml(name)}">
        <span class="option-marker">${marker}</span> ${escapeHtml(name)}
      </button>
    </div>`
  }).join('\n    ')

  const urlKeyAttr = urlKey ? ` data-url-key="${escapeHtml(urlKey)}"` : ''

  return `
  <div class="nav-options-panel hidden" id="assignee-options" role="listbox" aria-label="Select assignee"${urlKeyAttr}>
    <div class="nav-options-row">
      <span class="option-prefix">├─</span>
      <button class="nav-option${allClass}" role="option" aria-selected="${allSelected}" data-assignee="all">
        <span class="option-marker">${allMarker}</span> all
      </button>
    </div>
    ${meRow}
    ${assigneeOptionsHtml}
  </div>`
}

/**
 * Render workspace options panel (appears when workspace toggle is clicked)
 * Each workspace on its own row. Current workspace row includes "remove".
 * "+add" appears at the bottom where a new workspace would go.
 * Uses box-drawing characters for CLI aesthetic.
 * @param {Workspace[]} workspaces - Array of connected workspaces
 * @param {string|null} urlKey - Current workspace URL key from URL
 * @param {'observation'|'swipe'|'swim'|'projects'|'settings'|'audit'|'prompts'|'dispatch'|'proxy'|'roadmap'} currentPage - Current page to preserve on switch
 * @returns {string} HTML for workspace options panel
 */
function renderWorkspaceOptions(workspaces, urlKey, currentPage = 'projects') {
  if (!workspaces?.length) return ''

  const hasPAT = workspaces.some(w => w.isPAT)

  // Determine page suffix for workspace links (preserve current page on switch)
  // Feature-flagged pages (dispatch, proxy, roadmap) may not be
  // enabled on the target workspace, so fall back to projects for those.
  const featureFlaggedPages = new Set(['dispatch', 'proxy', 'roadmap', 'collective'])
  const pageSuffix = (currentPage === 'projects' || featureFlaggedPages.has(currentPage)) ? '/' : `/${currentPage}`

  const optionsHtml = workspaces.map(ws => {
    // Compare by urlKey (from URL) for multi-tab support
    const isActive = ws.urlKey === urlKey
    const marker = isActive ? '\u25cf' : '\u25cb'
    const selectedClass = isActive ? ' selected' : ''
    const ariaSelected = isActive ? 'true' : 'false'

    // Hide remove button in PAT mode (session restores automatically)
    const removeBtn = (isActive && !hasPAT)
      ? `<form action="/workspace/${encodeURIComponent(ws.urlKey)}/remove" method="POST" class="nav-option-form" data-confirm="Remove this workspace?">
          <button type="submit" class="nav-option nav-option-danger">remove</button>
        </form>`
      : ''

    return `<div class="nav-options-row">
      <span class="option-prefix">\u251c\u2500</span>
      <a href="/workspace/${encodeURIComponent(ws.urlKey)}${pageSuffix}" class="nav-option${selectedClass}" role="option" aria-selected="${ariaSelected}">
        <span class="option-marker">${marker}</span> ${escapeHtml(ws.name)}
      </a>
      ${removeBtn}
    </div>`
  }).join('\n    ')

  // Hide the Linear +add in PAT mode (OAuth may not be configured).
  const linearAddRow = hasPAT ? '' : `
    <div class="nav-options-row">
      <span class="option-prefix">\u251c\u2500</span>
      <a href="/auth/linear" class="nav-option nav-option-add"><span class="option-marker-placeholder"></span>+add</a>
    </div>`

  // Local-workspace create is shown REGARDLESS of PAT/OAuth config \u2014 local
  // onboarding is independent of Linear auth (LIN-377). Always the last row.
  const localAddRow = `
    <div class="nav-options-row">
      <span class="option-prefix">\u2514\u2500</span>
      <form action="/workspace/new" method="POST" class="nav-option-form">
        <button type="submit" class="nav-option nav-option-add-local"><span class="option-marker-placeholder"></span>+local workspace</button>
      </form>
    </div>`

  return `
  <div class="nav-options-panel hidden" id="workspace-options" role="listbox" aria-label="Select workspace">
    ${optionsHtml}
    ${linearAddRow}
    ${localAddRow}
  </div>`
}

/**
 * Render team options panel (appears when team toggle is clicked)
 * Each team on its own row for consistency with workspace panel.
 * Uses box-drawing characters for CLI aesthetic.
 * @param {Team[]} teams - Array of teams
 * @param {string|null} selectedTeamId - Currently selected team ID
 * @param {string|null} urlKey - Current workspace URL key for client-side navigation
 * @returns {string} HTML for team options panel
 */
function renderTeamOptions(teams, selectedTeamId, urlKey = null) {
  if (!teams?.length) return ''
  const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name))

  const allSelected = !selectedTeamId
  const allMarker = allSelected ? '\u25cf' : '\u25cb'
  const allClass = allSelected ? ' selected' : ''

  const teamOptionsHtml = sortedTeams.map((team, index) => {
    const isSelected = team.id === selectedTeamId
    const marker = isSelected ? '\u25cf' : '\u25cb'
    const selectedClass = isSelected ? ' selected' : ''
    const isLast = index === sortedTeams.length - 1
    const prefix = isLast ? '\u2514\u2500' : '\u251c\u2500'
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
      <span class="option-prefix">\u251c\u2500</span>
      <button class="nav-option${allClass}" role="option" aria-selected="${allSelected}" data-team="all">
        <span class="option-marker">${allMarker}</span> all
      </button>
    </div>
    ${teamOptionsHtml}
  </div>`
}
