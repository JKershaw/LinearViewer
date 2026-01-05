const STORAGE_KEY = 'roadmap-state'

const DEFAULT_STATE = {
  expanded: [],
  expandedProjectMeta: [],
  hideCompleted: [],
  collapsedProjects: [],
  inProgressCollapsed: false
}

// DOM helpers
const show = el => el?.classList.remove('hidden')
const hide = el => el?.classList.add('hidden')
const setHidden = (el, hidden) => hidden ? hide(el) : show(el)
const setArrow = (el, expanded) => {
  if (!el) return
  el.textContent = el.textContent.replace(expanded ? '▶' : '▼', expanded ? '▼' : '▶')
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : { ...DEFAULT_STATE }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function resetDOM() {
  // Reset all issue toggles to collapsed (▶)
  document.querySelectorAll('.line .toggle, .in-progress-item .toggle').forEach(t => {
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

function getDescendants(id) {
  const descendants = []
  const queue = [id]

  while (queue.length > 0) {
    const parentId = queue.shift()
    const children = document.querySelectorAll(`[data-parent="${parentId}"]`)
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

function showDescendantsRespectingExpanded(id, expandedIds) {
  const directChildren = document.querySelectorAll(`[data-parent="${id}"]`)
  directChildren.forEach(child => {
    show(child)
    const childId = child.dataset.id

    // Show details only if this child is expanded
    const details = child.nextElementSibling
    if (details && details.dataset.detailsFor === childId && expandedIds.includes(childId)) {
      show(details)
    }

    // Only recurse if this child is expanded
    if (childId && expandedIds.includes(childId)) {
      showDescendantsRespectingExpanded(childId, expandedIds)
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
  state.expanded.forEach(id => {
    // Show this item's own details
    document.querySelectorAll(`[data-details-for="${id}"]`).forEach(show)

    // Show direct children (and recurse for expanded ones)
    const line = document.querySelector(`[data-id="${id}"]`)
    if (line) {
      showDescendantsRespectingExpanded(id, state.expanded)
    }

    // Update toggle arrow
    document.querySelectorAll(`[data-id="${id}"] .toggle`).forEach(toggle => {
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

function init() {
  let state = loadState()
  applyState(state)

  // Reset view to defaults
  const resetBtn = document.querySelector('.reset-view')
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault()
      state = { ...DEFAULT_STATE }
      saveState(state)
      resetDOM()
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
      saveState(state)

      const meta = project.querySelector('.project-meta')
      setHidden(meta, !state.expandedProjectMeta.includes(projectId))
    })
  })

  // Toggle expand/collapse - controls both details AND children
  function toggleItem(line) {
    const id = line.dataset.id
    toggleInArray(state.expanded, id)
    saveState(state)

    const isExpanded = state.expanded.includes(id)
    const details = line.nextElementSibling
    const hasDetails = details && details.dataset.detailsFor === id

    if (isExpanded) {
      if (hasDetails) show(details)
      showDescendantsRespectingExpanded(id, state.expanded)
    } else {
      if (hasDetails) hide(details)
      getDescendants(id).forEach(hide)
    }

    const toggle = line.querySelector('.toggle')
    if (toggle) toggle.textContent = isExpanded ? '▼' : '▶'
  }

  // Arrow click
  document.querySelectorAll('.toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleItem(e.target.closest('[data-id]'))
    })
  })

  // Line click (for expandable items)
  document.querySelectorAll('.line.expandable, .in-progress-item.expandable').forEach(el => {
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
      saveState(state)

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
      saveState(state)

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
      saveState(state)

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
          if (lineId && state.expanded.includes(lineId)) {
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
            if (lineId && state.expanded.includes(lineId)) {
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

document.addEventListener('DOMContentLoaded', () => {
  init()
  initDescriptionToggles()
})
