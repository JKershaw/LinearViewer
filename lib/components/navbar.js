/**
 * Shared Navigation Bar Component
 *
 * Renders the unified navigation bar for all authenticated pages.
 * Supports workspace switching from any page, with team filtering only on projects page.
 */

import { escapeHtml } from '../utils/html.js';
import { renderWordmark } from './wordmark.js';
import { renderViewNav } from './view-nav.js';
import { isJiraOAuthConfigured } from '../providers/jira/oauth.js';

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
 * Options for renderNavBar
 * @typedef {Object} NavBarOptions
 * @property {Workspace[]} [workspaces] - Array of connected workspaces
 * @property {string|null} [urlKey] - Current workspace URL key (from URL, determines active workspace)
 * @property {'observation'|'swipe'|'swim'|'projects'|'settings'|'audit'|'prompts'|'dispatch'|'proxy'|'roadmap'} [currentPage] - Current page identifier
 * @property {Team[]} [teams] - Array of teams (only used on projects page)
 * @property {string|null} [selectedTeamId] - Currently selected team ID (only used on projects page)
 * @property {boolean} [minimalNav] - When true (homepage only), suppress the
 *   landing top bar entirely. Default false preserves the shared `isLanding`
 *   sign-in bar the swipe/swim/ship previews depend on (LIN-1508).
 */

/**
 * Render the unified navigation bar
 * @param {NavBarOptions} options - Navigation options
 * @returns {string} HTML for navigation bar
 */
export function renderNavBar({ workspaces = [], urlKey = null, currentPage = 'projects', teams = [], selectedTeamId = null, featureFlags = {}, isLanding = false, minimalNav = false }) {
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
  // LIN-1890 E4 \u2014 why the Jira gate is a CALL, not a threaded option. There is
  // no threading path to this component: `renderNavBar` is invoked from ~7 page
  // renderers, none of which take a provider-config argument, so threading
  // `jiraEnabled` would mean seven edit sites for one link and seven chances for
  // a future page to forget it and silently render a CTA into a 503. Calling the
  // provider-owned predicate directly keeps the promise and the route's actual
  // capability in ONE place. `isJiraOAuthConfigured()` is that predicate
  // (`lib/providers/jira/oauth.js`) \u2014 never an inline `process.env` read, which
  // is the divergence the GitHub line below still represents.
  //
  // The GitHub CTA's inline `process.env.GITHUB_CLIENT_ID` is deliberately LEFT
  // AS IS. Swapping it for `isGitHubConfigured()` is a genuine behaviour change
  // \u2014 that predicate requires all five GITHUB_* vars, so a partially-configured
  // server would stop rendering a CTA it renders today \u2014 and it belongs to
  // GitHub's lane, not this ticket's. Recorded, not taken.
  if (isLanding) {
    const githubCta = process.env.GITHUB_CLIENT_ID
      ? `<a href="/auth/github" class="nav-action login" data-testid="nav-login-github">GitHub \u2192</a>`
      : ''
    const jiraCta = isJiraOAuthConfigured()
      ? `<a href="/auth/jira/oauth?mode=new" class="nav-action login" data-testid="nav-login-jira">Jira \u2192</a>`
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

  // Team selector only on projects page (filtering only makes sense there)
  const teamNavItem = currentPage === 'projects' ? renderTeamNavItem(teams, selectedTeamId) : ''
  const teamOptions = currentPage === 'projects' ? renderTeamOptions(teams, selectedTeamId, urlKey) : ''

  const queueBadge = (urlKey && featureFlags.dispatch === true) ? renderQueueBadge(urlKey) : ''

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
      </div>
      <div class="nav-actions">
        ${searchToggle}
        ${queueBadge}
        ${/* Nav-actions order (LIN-1149): search (page-specific, projects only) before
             queue badge (feature-gated, all pages). When both are present the badge
             trails; on non-projects pages the badge is the sole nav-action. Must not
             leak search onto non-projects pages and must not gate search on dispatch. */''}
      </div>
    </div>
    ${viewNav}
  </nav>
  ${workspaceOptions}
  ${teamOptions}`
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
