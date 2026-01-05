const STORAGE_KEY = 'roadmap-state'

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : { collapsed: [], hideCompleted: [], collapsedProjects: [], expandedDetails: [] }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
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
      queue.push(el.dataset.id)
    })
  }

  return descendants
}

function showDescendantsRespectingCollapsed(id, collapsedIds) {
  const directChildren = document.querySelectorAll(`[data-parent="${id}"]`)
  directChildren.forEach(child => {
    child.classList.remove('hidden')
    const childId = child.dataset.id
    // Only recurse if this child is not collapsed
    if (childId && !collapsedIds.includes(childId)) {
      showDescendantsRespectingCollapsed(childId, collapsedIds)
    }
  })
}

function applyState(state) {
  // Ensure state has all expected properties
  state.collapsedProjects = state.collapsedProjects || []
  state.expandedDetails = state.expandedDetails || []

  // Collapse nodes
  state.collapsed.forEach(id => {
    const descendants = getDescendants(id)
    descendants.forEach(el => el.classList.add('hidden'))

    const toggle = document.querySelector(`[data-id="${id}"] .toggle`)
    if (toggle) toggle.textContent = '▶'
  })

  // Show completed sections (hideCompleted actually stores "shown" projects due to HTML defaulting to hidden)
  state.hideCompleted.forEach(id => {
    const section = document.querySelector(`[data-completed-for="${id}"]`)
    if (section) section.classList.remove('hidden')
    const toggle = document.querySelector(`.completed-toggle[data-project-id="${id}"]`)
    if (toggle) toggle.textContent = '┄ hide completed ┄'
  })

  // Show expanded details
  state.expandedDetails.forEach(id => {
    const details = document.querySelector(`[data-details-for="${id}"]`)
    if (details) details.classList.remove('hidden')
  })

  // Collapse projects
  state.collapsedProjects.forEach(projectId => {
    const project = document.querySelector(`.project[data-id="${projectId}"]`)
    if (!project) return

    const header = project.querySelector('.project-header')
    if (header) {
      header.textContent = header.textContent.replace('▼', '▶')
    }

    const children = project.querySelectorAll('.line, .details, .project-description, .completed-toggle, [data-completed-for]')
    children.forEach(child => child.classList.add('hidden'))
  })
}

function init() {
  const state = loadState()
  applyState(state)

  // Toggle children (arrow click)
  document.querySelectorAll('.toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation() // Prevent triggering details toggle
      const id = e.target.closest('[data-id]').dataset.id
      toggleInArray(state.collapsed, id)
      saveState(state)

      const isCollapsed = state.collapsed.includes(id)
      if (isCollapsed) {
        const descendants = getDescendants(id)
        descendants.forEach(child => child.classList.add('hidden'))
      } else {
        showDescendantsRespectingCollapsed(id, state.collapsed)
      }
      e.target.textContent = isCollapsed ? '▶' : '▼'
    })
  })

  // Toggle details (line click)
  document.querySelectorAll('.line.has-details').forEach(el => {
    el.addEventListener('click', (e) => {
      const id = el.dataset.id
      const details = document.querySelector(`[data-details-for="${id}"]`)
      if (details) {
        toggleInArray(state.expandedDetails, id)
        saveState(state)
        details.classList.toggle('hidden', !state.expandedDetails.includes(id))
      }
    })
  })

  // Toggle completed (hideCompleted actually stores "shown" projects due to HTML defaulting to hidden)
  document.querySelectorAll('.completed-toggle').forEach(el => {
    el.addEventListener('click', (e) => {
      const projectId = e.target.dataset.projectId
      toggleInArray(state.hideCompleted, projectId)
      saveState(state)

      const isShown = state.hideCompleted.includes(projectId)
      const section = document.querySelector(`[data-completed-for="${projectId}"]`)
      if (section) section.classList.toggle('hidden', !isShown)
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
        const children = project.querySelectorAll('.line, .details, .project-description, .completed-toggle, [data-completed-for]')
        children.forEach(child => child.classList.add('hidden'))
      } else {
        // Show project description and completed toggle
        const desc = project.querySelector('.project-description')
        if (desc) desc.classList.remove('hidden')
        const completedToggle = project.querySelector('.completed-toggle')
        if (completedToggle) completedToggle.classList.remove('hidden')

        // Show lines respecting nested collapse state
        showDescendantsRespectingCollapsed(projectId, state.collapsed)

        // Completed section: only show if in hideCompleted (which tracks "shown" projects)
        const completedSection = project.querySelector('[data-completed-for]')
        if (completedSection && state.hideCompleted.includes(projectId)) {
          completedSection.classList.remove('hidden')
          // Show top-level completed lines, respecting nested collapse
          const topLevelCompleted = completedSection.querySelectorAll(`[data-parent="${projectId}"]`)
          topLevelCompleted.forEach(line => {
            line.classList.remove('hidden')
            const lineId = line.dataset.id
            if (lineId && !state.collapsed.includes(lineId)) {
              showDescendantsRespectingCollapsed(lineId, state.collapsed)
            }
          })
        }
      }

      el.textContent = isCollapsed
        ? el.textContent.replace('▼', '▶')
        : el.textContent.replace('▶', '▼')
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
