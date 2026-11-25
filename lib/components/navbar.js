/**
 * The parts the page frame (lib/components/frame.js) and its pages draw that are not the frame itself.
 *
 * This file held the old navigation bar (`renderNavBar`, LIN-978 onwards). LIN-4568 (LIN-4342 piece 7) deleted the bar,
 * its view strip (lib/components/view-nav.js) and its workspace menu once every page sat in the frame. What is left:
 *   - `renderFilterLine`: a page's team and assignee selectors, drawn in the frame's `filters` slot (page filters are not
 *     navigation); public/common.js `initFilterLine` drives them;
 *   - `renderPreviewSignIn`: a signed-out preview's sign-in path, in the public frame's band;
 *   - `workspaceAddProviders`: the add rows of the rail's workspace menu;
 *   - `renderFeedbackTrigger`: the feedback control at the rail's foot.
 * The file keeps its name because ~40 files and docs cite it; the classes `nav-item`/`nav-value`/`nav-option…` are the
 * filter line's own markup now, not the bar's.
 */

import { escapeHtml } from '../utils/html.js';
import { getProvider, getAllProviders } from '../providers/index.js';
// LIN-1892 (G2/N6): a zero-import leaf, so it can't grow the provider/auth cycle.
import { isEmailSignInAvailable } from '../email-availability.js';

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
 * selector (LIN-2519). The assignee selector (LIN-2527) is gated on
 * `ASSIGNEE_PAGES` directly, never this set.
 * LIN-4119: `backlog` is the project sections moved off Home, so it filters as Home does.
 */
const FILTERABLE_PAGES = new Set(['projects', 'backlog', 'swipe', 'swim', 'ship', 'roadmap'])

/**
 * Pages whose sections the assignee filter narrows (LIN-2527, LIN-4119). The filter stays with the project sections it
 * filters: Home's (`projects`) and the backlog page's (`backlog`), which are the same sections.
 */
const ASSIGNEE_PAGES = new Set(['projects', 'backlog'])

/**
 * Render the feedback trigger that opens the feedback panel (LIN-2298), at the rail's foot (lib/components/frame.js,
 * LIN-4562; it rode the old bar's actions until LIN-4568 deleted the bar).
 *
 * A plain `<button>` in normal flow, never a fixed FAB: LIN-2298 retired the floating trigger because no reserve clears
 * a fixed element over full-width content at every scroll offset. It is a control, not a place, so it is not in
 * lib/places.js.
 *
 * Carries no `urlKey`: it polls nothing and navigates nowhere. `public/feedback-widget.js` binds it by testid and reads
 * the workspace off the widget mount's own `data-url-key`, so the widget keeps a single source of workspace identity.
 * `aria-expanded` starts `false` and is maintained by the widget as the panel opens and minimizes.
 *
 * SHIPS DISABLED, and public/feedback-widget.js enables it once it has bound the click handler and built the panel: the
 * button is on screen from first paint while `feedback-widget.js` is still a deferred script, and a click in that window
 * would be silently swallowed (measured: it hung the LIN-2298 e2e run). `disabled` makes the gap honest and observable
 * (Playwright's actionability check waits for enabled).
 *
 * @param {string} [className] - the host's layout class
 * @returns {string} HTML for the feedback trigger
 */
export function renderFeedbackTrigger(className = 'frame-rail__feedback') {
  return `<button type="button" class="${className} nav-feedback-trigger" data-testid="nav-feedback-trigger" aria-expanded="false" aria-label="Give feedback" title="Give feedback" disabled>feedback</button>`
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
 * `renderTeamNavItem`. Project-sections-only (LIN-2527, LIN-4119: Home and /backlog) — the caller gates on
 * `ASSIGNEE_PAGES`, not this function.
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
 * The providers a workspace menu offers an add row for (LIN-2802): each that declares an `entryCta` configured on this
 * server, in registry order, with the Linear row hidden in PAT mode. The rail's workspace menu (lib/components/frame.js,
 * LIN-4562) reads it, so a newly registered provider with an entry CTA appears there with no second hand-edit.
 * @param {Workspace[]} workspaces
 * @returns {Array<Object>} provider entries
 */
export function workspaceAddProviders(workspaces = []) {
  const hasPAT = (workspaces || []).some(w => w.isPAT)
  return getAllProviders()
    .filter(p => p.entryCta)
    .filter(p => p.entryCta.isConfigured())
    .filter(p => !(p.name === 'linear' && hasPAT))
}

/**
 * The page filter line (LIN-4562): the team selector on the FILTERABLE_PAGES and the assignee selector on the
 * ASSIGNEE_PAGES, as the frame's `filters` slot draws them at the top of `<main>`. Page filters are not navigation, so
 * they sit on the page they filter. The items and panels keep the markup they had in the old bar (same ids, classes and
 * test hooks); the one client is `initFilterLine` (public/common.js). '' when the page has neither.
 *
 * @param {Object} opts
 * @param {string} opts.currentPage - the page's filter key (`projects`, `backlog`, `swipe`, `swim`, `ship`, `roadmap`)
 * @param {string|null} [opts.urlKey]
 * @param {Team[]} [opts.teams]
 * @param {string|null} [opts.selectedTeamId]
 * @param {string[]} [opts.assignees]
 * @param {string|null} [opts.selectedAssignee]
 * @param {boolean} [opts.canFilterByMe]
 * @returns {string}
 */
export function renderFilterLine({ currentPage, urlKey = null, teams = [], selectedTeamId = null, assignees = [], selectedAssignee = null, canFilterByMe = false } = {}) {
  const team = FILTERABLE_PAGES.has(currentPage)
  const assignee = ASSIGNEE_PAGES.has(currentPage)
  const items = [
    team ? renderTeamNavItem(teams, selectedTeamId) : '',
    assignee ? renderAssigneeNavItem(assignees, selectedAssignee) : '',
  ].filter(Boolean)
  if (items.length === 0) return ''
  const panels = [
    team ? renderTeamOptions(teams, selectedTeamId, urlKey) : '',
    assignee ? renderAssigneeOptions(assignees, selectedAssignee, urlKey, canFilterByMe) : '',
  ].join('')
  return `<div class="frame-filters" data-frame-filters data-testid="frame-filters">
      ${items.join('\n      ')}${panels}
    </div>`
}

/**
 * The sign-in path of a signed-out preview (Swipe, Swim, Ship), drawn in the public frame's band (LIN-4564; the old
 * bar's landing branch drew it until then). It is the SOLE sign-in path on those pages, so every CTA here is
 * load-bearing, and each keeps its `nav-login-*` test id. A local workspace can be started from here too.
 *
 * LIN-1890 E4 — why each gate is a CALL, not a threaded option: calling the provider-owned predicate
 * (`entryCta.isConfigured()`, and for email the one availability predicate, lib/email-availability.js) keeps the promise
 * and the route's actual capability in ONE place, so a half-configured server never renders a CTA into a 503
 * (LIN-2010: the GitHub gate is the provider's own `isGitHubConfigured()`).
 * @returns {string}
 */
export function renderPreviewSignIn() {
  const cta = (href, testid, text) => `<a href="${escapeHtml(href)}" class="frame-public__action login" data-testid="${testid}">${text}</a>`
  const github = getProvider('github')?.entryCta
  const jira = getProvider('jira')?.entryCta
  return [
    `<form action="/workspace/new" method="POST" class="frame-public__form"><button type="submit" class="frame-public__action frame-public__button" data-testid="preview-add-local">+ Local workspace</button></form>`,
    cta('/auth/linear', 'nav-login-linear', 'Sign in \u2192'),
    github?.isConfigured() ? cta(github.href, 'nav-login-github', 'GitHub \u2192') : '',
    jira?.isConfigured() ? cta(jira.href, 'nav-login-jira', 'Jira \u2192') : '',
    isEmailSignInAvailable() ? cta('/auth/email', 'nav-login-email', 'Email \u2192') : '',
  ].filter(Boolean).join('\n      ')
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
