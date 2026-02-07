/**
 * Shared Navigation Bar Component
 *
 * Renders the unified navigation bar for all authenticated pages.
 * Supports workspace switching from any page, with team filtering only on projects page.
 */

import { escapeHtml } from '../utils/html.js';

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
 * @property {'projects'|'settings'|'audit'|'prompts'} [currentPage] - Current page identifier
 * @property {Team[]} [teams] - Array of teams (only used on projects page)
 * @property {string|null} [selectedTeamId] - Currently selected team ID (only used on projects page)
 */

/**
 * Render the unified navigation bar
 * @param {NavBarOptions} options - Navigation options
 * @returns {string} HTML for navigation bar
 */
export function renderNavBar({ workspaces = [], urlKey = null, currentPage = 'projects', teams = [], selectedTeamId = null }) {
  // Use urlKey from URL to determine active workspace (enables multi-tab support)
  const workspaceNavItem = renderWorkspaceNavItem(workspaces, urlKey)
  const workspaceOptions = renderWorkspaceOptions(workspaces, urlKey, currentPage)

  // Team selector only on projects page (filtering only makes sense there)
  const teamNavItem = currentPage === 'projects' ? renderTeamNavItem(teams, selectedTeamId) : ''
  const teamOptions = currentPage === 'projects' ? renderTeamOptions(teams, selectedTeamId, urlKey) : ''

  const queueBadge = urlKey ? renderQueueBadge(urlKey) : ''

  // Search toggle only on projects page
  const searchToggle = currentPage === 'projects'
    ? '<a href="#" class="nav-action search-toggle" aria-expanded="false">search</a>'
    : ''

  // Show "projects" link when NOT on projects page
  const projectsLink = currentPage !== 'projects' && urlKey
    ? `<a href="/workspace/${encodeURIComponent(urlKey)}/" class="nav-action">\u2190 projects</a>`
    : ''

  // Search panel (only on projects page)
  const searchPanel = currentPage === 'projects'
    ? `\n  <div class="search-panel hidden" id="search-panel">
    <div class="search-input-row">
      <input type="text" id="search-input" class="search-input" placeholder="search issues..." autocomplete="off" />
      <button class="search-clear" id="search-clear">clear</button>
    </div>
    <div class="search-no-results hidden" id="search-no-results">no matching issues</div>
  </div>`
    : ''

  return `
  <nav class="nav-bar" aria-label="Main navigation">
    <div class="nav-filters">
      ${workspaceNavItem}
      ${teamNavItem}
    </div>
    <div class="nav-actions">
      ${projectsLink}
      ${searchToggle}
      ${queueBadge}
    </div>
  </nav>
  ${workspaceOptions}
  ${teamOptions}
  ${searchPanel}`
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
 * @param {'projects'|'settings'|'audit'|'prompts'} currentPage - Current page to preserve on switch
 * @returns {string} HTML for workspace options panel
 */
function renderWorkspaceOptions(workspaces, urlKey, currentPage = 'projects') {
  if (!workspaces?.length) return ''

  // Determine page suffix for workspace links (preserve current page on switch)
  const pageSuffix = currentPage === 'projects' ? '/' : `/${currentPage}`

  const optionsHtml = workspaces.map(ws => {
    // Compare by urlKey (from URL) for multi-tab support
    const isActive = ws.urlKey === urlKey
    const marker = isActive ? '\u25cf' : '\u25cb'
    const selectedClass = isActive ? ' selected' : ''
    const ariaSelected = isActive ? 'true' : 'false'

    // Only show remove button on the current (active) workspace row
    const removeBtn = isActive
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

  return `
  <div class="nav-options-panel hidden" id="workspace-options" role="listbox" aria-label="Select workspace">
    ${optionsHtml}
    <div class="nav-options-row">
      <span class="option-prefix">\u2514\u2500</span>
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
