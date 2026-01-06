const STORAGE_KEY = 'linear-projects-state'
const TEAM_STORAGE_KEY = 'linear-projects-selected-team'

// Factory function to create fresh default state (avoids shared array references)
function getDefaultState() {
  return {
    expanded: [],
    expandedProjectMeta: [],
    hideCompleted: [],
    collapsedProjects: [],
    inProgressCollapsed: false
  }
}

// DOM helpers
const show = el => el?.classList.remove('hidden')
const hide = el => el?.classList.add('hidden')
const setHidden = (el, hidden) => hidden ? hide(el) : show(el)
const setArrow = (el, expanded) => {
  if (!el) return
  el.textContent = el.textContent.replace(expanded ? '▶' : '▼', expanded ? '▼' : '▶')
}

// Expanded state helpers (expanded is now array of { id, section } objects)
const findExpanded = (arr, id, section) =>
  arr.find(e => e.id === id && e.section === section)

const isExpanded = (arr, id, section) =>
  arr.some(e => e.id === id && e.section === section)

const toggleExpanded = (arr, id, section) => {
  const idx = arr.findIndex(e => e.id === id && e.section === section)
  if (idx === -1) arr.push({ id, section })
  else arr.splice(idx, 1)
  return idx === -1 // returns true if now expanded
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : getDefaultState()
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function resetDOM() {
  // Reset all issue toggles to collapsed (▶)
  document.querySelectorAll('.line .toggle').forEach(t => {
    t.textContent = '▶'
  })

  // Hide all details
  document.querySelectorAll('.details').forEach(hide)

  // Hide child lines (depth > 0), show top-level lines
  document.querySelectorAll('.line').forEach(line => {
    const depth = parseInt(line.dataset.depth, 10)
    setHidden(line, depth > 0)
  })

  // Expand all projects (show content, ▼ arrow)
  document.querySelectorAll('.project').forEach(project => {
    const header = project.querySelector('.project-header')
    if (header && header.textContent.includes('▶')) {
      setArrow(header, true)
    }
    show(project.querySelector('.project-description'))
    hide(project.querySelector('.project-meta'))
    show(project.querySelector('.completed-toggle'))
  })

  // Hide all completed sections, reset toggle text
  document.querySelectorAll('[data-completed-for]').forEach(hide)
  document.querySelectorAll('.completed-toggle').forEach(toggle => {
    toggle.textContent = `┄ show ${toggle.dataset.count} completed ┄`
  })

  // Expand in-progress section
  const inProgressHeader = document.querySelector('.in-progress-header')
  const inProgressItems = document.querySelector('.in-progress-items')
  if (inProgressHeader && inProgressHeader.textContent.includes('▶')) {
    setArrow(inProgressHeader, true)
  }
  show(inProgressItems)
}

function toggleInArray(arr, id) {
  const idx = arr.indexOf(id)
  if (idx === -1) arr.push(id)
  else arr.splice(idx, 1)
}

function getDescendants(id, section) {
  const descendants = []
  const queue = [id]

  while (queue.length > 0) {
    const parentId = queue.shift()
    const children = document.querySelectorAll(`[data-parent="${parentId}"][data-section="${section}"]`)
    children.forEach(el => {
      descendants.push(el)
      // Also include the details element if it exists
      const details = el.nextElementSibling
      if (details && details.dataset.detailsFor === el.dataset.id) {
        descendants.push(details)
      }
      queue.push(el.dataset.id)
    })
  }

  return descendants
}

function showDescendantsRespectingExpanded(id, expandedArr, section) {
  const directChildren = document.querySelectorAll(`[data-parent="${id}"][data-section="${section}"]`)
  directChildren.forEach(child => {
    show(child)
    const childId = child.dataset.id

    // Show details only if this child is expanded
    const details = child.nextElementSibling
    if (details && details.dataset.detailsFor === childId && isExpanded(expandedArr, childId, section)) {
      show(details)
    }

    // Only recurse if this child is expanded
    if (childId && isExpanded(expandedArr, childId, section)) {
      showDescendantsRespectingExpanded(childId, expandedArr, section)
    }
  })
}

function applyState(state) {
  // Start from clean slate
  resetDOM()

  // Ensure state has all expected properties
  state.collapsedProjects = state.collapsedProjects || []
  state.expanded = state.expanded || []
  state.expandedProjectMeta = state.expandedProjectMeta || []
  state.hideCompleted = state.hideCompleted || []
  state.inProgressCollapsed = state.inProgressCollapsed || false

  // Show expanded project meta
  state.expandedProjectMeta.forEach(projectId => {
    const meta = document.querySelector(`.project[data-id="${projectId}"] .project-meta`)
    show(meta)
  })

  // Apply in-progress section collapsed state
  if (state.inProgressCollapsed) {
    const header = document.querySelector('.in-progress-header')
    const items = document.querySelector('.in-progress-items')
    setArrow(header, false)
    hide(items)
  }

  // Expand nodes (shows both children AND details)
  state.expanded.forEach(({ id, section }) => {
    // Show this item's own details (scoped by section)
    document.querySelectorAll(`[data-section="${section}"][data-details-for="${id}"]`).forEach(show)

    // Show direct children (and recurse for expanded ones) - for both sections
    const line = document.querySelector(`[data-section="${section}"][data-id="${id}"]`)
    if (line) {
      showDescendantsRespectingExpanded(id, state.expanded, section)
    }

    // Update toggle arrow (scoped by section)
    document.querySelectorAll(`[data-section="${section}"][data-id="${id}"] .toggle`).forEach(toggle => {
      toggle.textContent = '▼'
    })
  })

  // Show completed sections
  state.hideCompleted.forEach(id => {
    const section = document.querySelector(`[data-completed-for="${id}"]`)
    show(section)
    const toggle = document.querySelector(`.completed-toggle[data-project-id="${id}"]`)
    if (toggle) toggle.textContent = '┄ hide completed ┄'
  })

  // Collapse projects
  state.collapsedProjects.forEach(projectId => {
    const project = document.querySelector(`.project[data-id="${projectId}"]`)
    if (!project) return

    const header = project.querySelector('.project-header')
    setArrow(header, false)

    const children = project.querySelectorAll('.line, .details, .project-description, .project-meta, .completed-toggle, [data-completed-for]')
    children.forEach(hide)
  })
}

// Get default collapsed project IDs from HTML data attributes
function getDefaultCollapsedProjects() {
  const ids = []
  document.querySelectorAll('.project[data-default-collapsed="true"]').forEach(el => {
    ids.push(el.dataset.id)
  })
  return ids
}

function init() {
  const isLanding = document.body.classList.contains('is-landing')

  // On landing page, always use defaults (no persistence)
  // On authenticated page, load from localStorage
  let state
  if (isLanding) {
    state = getDefaultState()
    state.collapsedProjects = getDefaultCollapsedProjects()
  } else {
    state = loadState()
    // On first load (no saved state), apply default collapsed projects from HTML
    if (!localStorage.getItem(STORAGE_KEY)) {
      state.collapsedProjects = getDefaultCollapsedProjects()
    }
  }

  // Wrap saveState to be a no-op on landing
  const persistState = isLanding ? () => {} : saveState

  applyState(state)

  // Reset view to defaults (including default collapsed projects)
  const resetBtn = document.querySelector('.reset-view')
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault()
      state = getDefaultState()
      state.collapsedProjects = getDefaultCollapsedProjects()
      persistState(state)
      applyState(state)
    })
  }

  // Toggle project meta visibility
  document.querySelectorAll('.project-description').forEach(desc => {
    desc.addEventListener('click', (e) => {
      // Don't toggle if clicking the truncation button
      if (e.target.closest('.desc-toggle')) return

      const project = desc.closest('.project')
      const projectId = project.dataset.id
      toggleInArray(state.expandedProjectMeta, projectId)
      persistState(state)

      const meta = project.querySelector('.project-meta')
      setHidden(meta, !state.expandedProjectMeta.includes(projectId))
    })
  })

  // Toggle expand/collapse - controls both details AND children
  function toggleItem(line) {
    const id = line.dataset.id
    const section = line.dataset.section
    const nowExpanded = toggleExpanded(state.expanded, id, section)
    persistState(state)

    const details = line.nextElementSibling
    const hasDetails = details && details.dataset.detailsFor === id

    if (nowExpanded) {
      if (hasDetails) show(details)
      // Both sections can have children
      showDescendantsRespectingExpanded(id, state.expanded, section)
    } else {
      if (hasDetails) hide(details)
      // Both sections can have children
      getDescendants(id, section).forEach(hide)
    }

    const toggle = line.querySelector('.toggle')
    if (toggle) toggle.textContent = nowExpanded ? '▼' : '▶'
  }

  // Arrow click
  document.querySelectorAll('.toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleItem(e.target.closest('[data-id]'))
    })
  })

  // Line click (for expandable items)
  document.querySelectorAll('.line.expandable').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't toggle if clicking a link
      if (e.target.closest('a')) return
      toggleItem(el)
    })
  })

  // Toggle in-progress section collapse
  const inProgressHeader = document.querySelector('.in-progress-header')
  if (inProgressHeader) {
    inProgressHeader.addEventListener('click', () => {
      state.inProgressCollapsed = !state.inProgressCollapsed
      persistState(state)

      const items = document.querySelector('.in-progress-items')
      setHidden(items, state.inProgressCollapsed)
      setArrow(inProgressHeader, !state.inProgressCollapsed)
    })
  }

  // Toggle completed (hideCompleted actually stores "shown" projects due to HTML defaulting to hidden)
  document.querySelectorAll('.completed-toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      const projectId = e.target.dataset.projectId
      toggleInArray(state.hideCompleted, projectId)
      persistState(state)

      const isShown = state.hideCompleted.includes(projectId)
      const section = document.querySelector(`[data-completed-for="${projectId}"]`)
      setHidden(section, !isShown)
      e.target.textContent = isShown
        ? `┄ hide completed ┄`
        : `┄ show ${e.target.dataset.count} completed ┄`
    })
  })

  // Toggle project collapse
  document.querySelectorAll('.project-header').forEach(el => {
    el.addEventListener('click', (e) => {
      const project = e.target.closest('.project')
      const projectId = project.dataset.id
      toggleInArray(state.collapsedProjects, projectId)
      persistState(state)

      const isCollapsed = state.collapsedProjects.includes(projectId)

      if (isCollapsed) {
        // Hide all project content
        project.querySelectorAll('.line, .details, .project-description, .project-meta, .completed-toggle, [data-completed-for]')
          .forEach(hide)
      } else {
        // Show project description, meta, and completed toggle
        show(project.querySelector('.project-description'))
        show(project.querySelector('.project-meta'))
        show(project.querySelector('.completed-toggle'))

        // Show top-level lines (but keep them collapsed unless explicitly expanded)
        project.querySelectorAll(`[data-parent="${projectId}"]`).forEach(line => {
          show(line)
          const lineId = line.dataset.id
          // Show details and children only if this task is expanded
          if (lineId && isExpanded(state.expanded, lineId, 'project')) {
            const details = line.nextElementSibling
            if (details && details.dataset.detailsFor === lineId) {
              show(details)
            }
            showDescendantsRespectingExpanded(lineId, state.expanded)
            const toggle = line.querySelector('.toggle')
            if (toggle) toggle.textContent = '▼'
          }
        })

        // Completed section: only show if in hideCompleted (which tracks "shown" projects)
        const completedSection = project.querySelector('[data-completed-for]')
        if (completedSection && state.hideCompleted.includes(projectId)) {
          show(completedSection)
          // Show top-level completed lines
          completedSection.querySelectorAll(`[data-parent="${projectId}"]`).forEach(line => {
            show(line)
            const lineId = line.dataset.id
            // Show details and children only if expanded
            if (lineId && isExpanded(state.expanded, lineId, 'project')) {
              const details = line.nextElementSibling
              if (details && details.dataset.detailsFor === lineId) {
                show(details)
              }
              showDescendantsRespectingExpanded(lineId, state.expanded)
            }
          })
        }
      }

      setArrow(el, !isCollapsed)
    })
  })
}

// Toggle project description expand/collapse
function initDescriptionToggles() {
  document.querySelectorAll('.desc-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const container = e.target.closest('.project-description')
      const truncated = container.querySelector('.desc-truncated')
      const full = container.querySelector('.desc-full')
      truncated.classList.toggle('hidden')
      full.classList.toggle('hidden')
    })
  })
}

// Navigation bar interactions (workspace/team selectors)
function initNavBar() {
  const navBar = document.querySelector('.nav-bar')
  if (!navBar) return

  const workspaceToggle = document.getElementById('workspace-toggle')
  const teamToggle = document.getElementById('team-toggle')
  const workspaceOptions = document.getElementById('workspace-options')
  const teamOptions = document.getElementById('team-options')

  // Track currently open selector
  let openSelector = null

  function closeAllSelectors() {
    ;[workspaceToggle, teamToggle].forEach(btn => {
      if (btn) btn.setAttribute('aria-expanded', 'false')
    })
    ;[workspaceOptions, teamOptions].forEach(panel => {
      if (panel) panel.classList.add('hidden')
    })
    openSelector = null
  }

  function toggleSelector(toggle, options, selectorName) {
    const isOpen = toggle.getAttribute('aria-expanded') === 'true'

    if (isOpen) {
      closeAllSelectors()
    } else {
      closeAllSelectors()
      toggle.setAttribute('aria-expanded', 'true')
      options.classList.remove('hidden')
      openSelector = selectorName
    }
  }

  // Workspace toggle
  if (workspaceToggle && workspaceOptions) {
    workspaceToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleSelector(workspaceToggle, workspaceOptions, 'workspace')
    })
  }

  // Team toggle
  if (teamToggle && teamOptions) {
    teamToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleSelector(teamToggle, teamOptions, 'team')
    })
  }

  // Team option selection (workspace uses form submission)
  if (teamOptions) {
    teamOptions.addEventListener('click', (e) => {
      const option = e.target.closest('.nav-option[data-team]')
      if (!option) return

      e.stopPropagation()
      const teamId = option.dataset.team
      localStorage.setItem(TEAM_STORAGE_KEY, teamId)
      const url = teamId === 'all' ? '/' : `/?team=${teamId}`
      window.location.href = url
    })
  }

  // Close on outside click
  document.addEventListener('click', () => {
    if (openSelector) closeAllSelectors()
  })

  // Prevent clicks inside options panels from triggering "close on outside click"
  // Links still navigate, forms still submit - we just don't hide the panel first
  ;[workspaceOptions, teamOptions].forEach(panel => {
    if (panel) {
      panel.addEventListener('click', (e) => e.stopPropagation())
    }
  })

  // Keyboard navigation
  function handleKeyboard(e, toggle, options) {
    if (!options || options.classList.contains('hidden')) return

    const allOptions = [...options.querySelectorAll('.nav-option')]
    const focusedOption = document.activeElement
    const currentIndex = allOptions.indexOf(focusedOption)

    switch (e.key) {
      case 'Escape':
        closeAllSelectors()
        toggle?.focus()
        break
      case 'ArrowDown':
        e.preventDefault()
        if (currentIndex < allOptions.length - 1) {
          allOptions[currentIndex + 1]?.focus()
        } else {
          allOptions[0]?.focus()
        }
        break
      case 'ArrowUp':
        e.preventDefault()
        if (currentIndex > 0) {
          allOptions[currentIndex - 1]?.focus()
        } else {
          allOptions[allOptions.length - 1]?.focus()
        }
        break
    }
  }

  document.addEventListener('keydown', (e) => {
    if (openSelector === 'workspace') {
      handleKeyboard(e, workspaceToggle, workspaceOptions)
    } else if (openSelector === 'team') {
      handleKeyboard(e, teamToggle, teamOptions)
    }
  })

  // Sync team selection with localStorage on initial load
  if (teamToggle) {
    const urlParams = new URLSearchParams(window.location.search)
    const urlTeam = urlParams.get('team')
    const savedTeam = localStorage.getItem(TEAM_STORAGE_KEY)

    // Check if saved team still exists in options
    const teamOptionsAll = document.querySelectorAll('#team-options .nav-option[data-team]')
    const savedTeamExists = savedTeam === 'all' ||
      [...teamOptionsAll].some(opt => opt.dataset.team === savedTeam)

    // If URL has no team but localStorage does (and team still exists), redirect
    if (!urlTeam && savedTeam && savedTeam !== 'all' && savedTeamExists) {
      window.location.href = `/?team=${savedTeam}`
      return
    }

    // Clear invalid saved team
    if (savedTeam && !savedTeamExists) {
      localStorage.removeItem(TEAM_STORAGE_KEY)
    }

    // Save current selection
    localStorage.setItem(TEAM_STORAGE_KEY, urlTeam || 'all')
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init()
  initDescriptionToggles()
  initNavBar()
})
