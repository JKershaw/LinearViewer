const STORAGE_KEY = 'linear-projects-state'
const TEAM_STORAGE_KEY = 'linear-projects-selected-team'

// ==========================================================================
// Markdown Rendering (using marked.js library)
// ==========================================================================

/**
 * Render markdown to HTML for display using marked.js
 * @param {string} markdown - Raw markdown text
 * @returns {string} HTML string
 */
function renderMarkdown(markdown) {
  if (!markdown) return ''
  // Use marked library loaded via CDN
  // marked.parse() sanitizes by default in recent versions
  return marked.parse(markdown)
}

// Safe localStorage helpers for team selection
function getTeamSelection() {
  try {
    return localStorage.getItem(TEAM_STORAGE_KEY)
  } catch (e) {
    console.warn('Failed to read team selection:', e)
    return null
  }
}

function setTeamSelection(teamId) {
  try {
    localStorage.setItem(TEAM_STORAGE_KEY, teamId)
  } catch (e) {
    console.warn('Failed to save team selection:', e)
  }
}

function clearTeamSelection() {
  try {
    localStorage.removeItem(TEAM_STORAGE_KEY)
  } catch (e) {
    console.warn('Failed to clear team selection:', e)
  }
}

function hasStoredState() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch (e) {
    return false
  }
}

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
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : getDefaultState()
  } catch (e) {
    // Handle corrupted data or localStorage errors
    console.warn('Failed to load state from localStorage:', e)
    return getDefaultState()
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    // Can fail in private browsing or when storage is full
    console.warn('Failed to save state to localStorage:', e)
  }
}

function resetDOM() {
  // Reset all issue toggles to collapsed (▶)
  document.querySelectorAll('.line .toggle').forEach(t => {
    t.textContent = '▶'
  })

  // Hide all details
  document.querySelectorAll('.details').forEach(hide)

  // Hide child nodes (depth > 0), show top-level nodes
  document.querySelectorAll('.node').forEach(node => {
    const line = node.querySelector(':scope > .line')
    const depth = parseInt(line?.dataset.depth, 10)
    setHidden(node, depth > 0)
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
    toggle.textContent = `show ${toggle.dataset.count} completed`
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
  // With nested .node structure, find the parent's .children container
  const line = document.querySelector(`.line[data-id="${id}"][data-section="${section}"]`)
  if (!line) return []

  const node = line.closest('.node')
  const childrenContainer = node?.querySelector(':scope > .children')
  if (!childrenContainer) return []

  // Return all descendant nodes (they contain their own line and details)
  return [...childrenContainer.querySelectorAll('.node')]
}

function showDescendantsRespectingExpanded(id, expandedArr, section) {
  // With nested .node structure, find direct child nodes
  const line = document.querySelector(`.line[data-id="${id}"][data-section="${section}"]`)
  if (!line) return

  const node = line.closest('.node')
  const childrenContainer = node?.querySelector(':scope > .children')
  if (!childrenContainer) return

  // Show direct child nodes
  childrenContainer.querySelectorAll(':scope > .node').forEach(childNode => {
    show(childNode)
    const childId = childNode.dataset.id

    // Show details only if this child is expanded
    if (isExpanded(expandedArr, childId, section)) {
      const details = childNode.querySelector(':scope > .details')
      if (details) show(details)

      // Recurse for expanded children
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
    if (toggle) toggle.textContent = 'hide completed'
  })

  // Collapse projects
  state.collapsedProjects.forEach(projectId => {
    const project = document.querySelector(`.project[data-id="${projectId}"]`)
    if (!project) return

    const header = project.querySelector('.project-header')
    setArrow(header, false)

    // Hide all project content (including .node containers)
    const children = project.querySelectorAll('.node, .project-description, .project-meta, .completed-toggle, [data-completed-for]')
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
    if (!hasStoredState()) {
      state.collapsedProjects = getDefaultCollapsedProjects()
    }
  }

  // Wrap saveState to be a no-op on landing
  const persistState = isLanding ? () => {} : saveState

  applyState(state)

  // Reset view to defaults (including default collapsed projects)
  // Button is in the footer (uses same .reset-view class)
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

  // Toggle expand/collapse - controls both details AND children
  function toggleItem(line) {
    const id = line.dataset.id
    const section = line.dataset.section
    const nowExpanded = toggleExpanded(state.expanded, id, section)
    persistState(state)

    // With nested .node structure, find details within the node
    const node = line.closest('.node')
    const details = node?.querySelector(':scope > .details')

    if (nowExpanded) {
      if (details) show(details)
      // Both sections can have children
      showDescendantsRespectingExpanded(id, state.expanded, section)
    } else {
      if (details) hide(details)
      // Both sections can have children
      getDescendants(id, section).forEach(hide)
    }

    const toggle = line.querySelector('.toggle')
    if (toggle) toggle.textContent = nowExpanded ? '▼' : '▶'
  }

  // Handle project header collapse/expand
  function handleProjectHeaderClick(header) {
    const project = header.closest('.project')
    const projectId = project.dataset.id
    toggleInArray(state.collapsedProjects, projectId)
    persistState(state)

    const isCollapsed = state.collapsedProjects.includes(projectId)

    if (isCollapsed) {
      // Hide all project content (including .node containers)
      project.querySelectorAll('.node, .project-description, .project-meta, .completed-toggle, [data-completed-for]')
        .forEach(hide)
    } else {
      // Show project description, meta, and completed toggle
      show(project.querySelector('.project-description'))
      show(project.querySelector('.project-meta'))
      show(project.querySelector('.completed-toggle'))

      // Show top-level nodes (but keep them collapsed unless explicitly expanded)
      // Nodes are inside a .tree wrapper (not the completed one)
      const incompleteTree = project.querySelector(':scope > .tree:not([data-completed-for])')
      incompleteTree?.querySelectorAll(':scope > .node').forEach(node => {
        show(node)
        const nodeId = node.dataset.id
        // Show details and children only if this task is expanded
        if (nodeId && isExpanded(state.expanded, nodeId, 'project')) {
          const details = node.querySelector(':scope > .details')
          if (details) show(details)
          showDescendantsRespectingExpanded(nodeId, state.expanded, 'project')
          const toggle = node.querySelector('.line .toggle')
          if (toggle) toggle.textContent = '▼'
        }
      })

      // Completed section: only show if in hideCompleted (which tracks "shown" projects)
      const completedSection = project.querySelector('[data-completed-for]')
      if (completedSection && state.hideCompleted.includes(projectId)) {
        show(completedSection)
        // Show top-level completed nodes
        completedSection.querySelectorAll(':scope > .node').forEach(node => {
          show(node)
          const nodeId = node.dataset.id
          // Show details and children only if expanded
          if (nodeId && isExpanded(state.expanded, nodeId, 'project')) {
            const details = node.querySelector(':scope > .details')
            if (details) show(details)
            showDescendantsRespectingExpanded(nodeId, state.expanded, 'project')
          }
        })
      }
    }

    setArrow(header, !isCollapsed)
  }

  // ==========================================================================
  // Delegated click handler - replaces individual event listeners
  // ==========================================================================
  // Using event delegation: one listener on document handles all interactive
  // elements. Order matters - check more specific selectors first.
  document.addEventListener('click', (e) => {
    // 1. Description toggle (show more/less) - must check before .project-description
    if (e.target.closest('.desc-toggle')) {
      e.stopPropagation()
      const container = e.target.closest('.project-description')
      const truncated = container.querySelector('.desc-truncated')
      const full = container.querySelector('.desc-full')
      truncated.classList.toggle('hidden')
      full.classList.toggle('hidden')
      return
    }

    // 2. Toggle arrow click (expand/collapse children)
    const toggle = e.target.closest('.toggle')
    if (toggle) {
      e.stopPropagation()
      toggleItem(toggle.closest('[data-id]'))
      return
    }

    // 3. Project description click (show/hide meta)
    const desc = e.target.closest('.project-description')
    if (desc) {
      const project = desc.closest('.project')
      const projectId = project.dataset.id
      toggleInArray(state.expandedProjectMeta, projectId)
      persistState(state)
      const meta = project.querySelector('.project-meta')
      setHidden(meta, !state.expandedProjectMeta.includes(projectId))
      return
    }

    // 4. Line click (expand issue details) - skip if clicking a link
    const line = e.target.closest('.line.expandable')
    if (line && !e.target.closest('a')) {
      toggleItem(line)
      return
    }

    // 5. Completed toggle click
    const completedToggle = e.target.closest('.completed-toggle')
    if (completedToggle) {
      const projectId = completedToggle.dataset.projectId
      toggleInArray(state.hideCompleted, projectId)
      persistState(state)
      const isShown = state.hideCompleted.includes(projectId)
      const section = document.querySelector(`[data-completed-for="${projectId}"]`)
      setHidden(section, !isShown)
      completedToggle.textContent = isShown
        ? 'hide completed'
        : `show ${completedToggle.dataset.count} completed`
      return
    }

    // 6. Project header click (collapse project)
    const header = e.target.closest('.project-header')
    if (header) {
      handleProjectHeaderClick(header)
      return
    }

    // 7. In-progress header click
    const inProgressHeader = e.target.closest('.in-progress-header')
    if (inProgressHeader) {
      state.inProgressCollapsed = !state.inProgressCollapsed
      persistState(state)
      const items = document.querySelector('.in-progress-items')
      setHidden(items, state.inProgressCollapsed)
      setArrow(inProgressHeader, !state.inProgressCollapsed)
      return
    }
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
      setTeamSelection(teamId)
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

  // Handle forms with confirmation dialogs (replaces inline onsubmit)
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-confirm]')
    if (form && !confirm(form.dataset.confirm)) {
      e.preventDefault()
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
    const savedTeam = getTeamSelection()

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
      clearTeamSelection()
    }

    // Save current selection
    setTeamSelection(urlTeam || 'all')
  }
}

// ==========================================================================
// Prompt Generation for Labels
// ==========================================================================

// Track active fetch to prevent race conditions
let activePromptFetch = null

/**
 * Initialize prompt functionality for clickable labels
 */
function initPrompts() {
  // Handle clicks on promptable labels
  document.addEventListener('click', async (e) => {
    const labelLink = e.target.closest('.label-prompt')
    if (!labelLink || labelLink.classList.contains('more-toggle') || labelLink.classList.contains('suggest-btn')) return

    e.preventDefault()
    e.stopPropagation()

    const issueId = labelLink.dataset.issueId
    const labelName = labelLink.dataset.label

    // Find the prompt container within the same details context as the clicked label
    // This is important because the same issue can appear in both the "In Progress"
    // section and its project tree, each with its own prompt container
    const detailsContainer = labelLink.closest('.details')
    const promptContainer = detailsContainer?.querySelector(`[data-prompt-for="${issueId}"]`)
    if (!promptContainer) return

    // If already visible with same label, toggle off
    if (!promptContainer.classList.contains('hidden') &&
        promptContainer.dataset.activeLabel === labelName) {
      promptContainer.classList.add('hidden')
      promptContainer.dataset.activeLabel = ''
      return
    }

    // Cancel any in-flight request
    if (activePromptFetch) {
      activePromptFetch.abort()
    }

    // Create new abort controller for this request
    const abortController = new AbortController()
    activePromptFetch = abortController

    // Show loading state
    const promptText = promptContainer.querySelector('.prompt-text')
    const promptName = promptContainer.querySelector('.prompt-name')
    promptText.textContent = 'Loading...'
    promptName.textContent = ''
    promptContainer.classList.remove('hidden')
    promptContainer.dataset.activeLabel = labelName

    try {
      const response = await fetch(
        `/api/prompt/${issueId}/${encodeURIComponent(labelName)}`,
        { signal: abortController.signal }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to load prompt')
      }

      const data = await response.json()

      // Only update if this is still the active request
      if (activePromptFetch === abortController) {
        promptName.textContent = data.promptName
        // Store raw markdown for copy, render HTML for display
        promptText.dataset.rawPrompt = data.prompt
        promptText.innerHTML = renderMarkdown(data.prompt)
      }
    } catch (error) {
      // Ignore abort errors (user clicked away)
      if (error.name === 'AbortError') return

      promptText.textContent = `Error: ${error.message}`
      console.error('Failed to fetch prompt:', error)
    } finally {
      // Clear active fetch if this was it
      if (activePromptFetch === abortController) {
        activePromptFetch = null
      }
    }
  })

  // Handle copy button clicks
  document.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.prompt-copy')
    if (!copyBtn) return

    e.preventDefault()
    e.stopPropagation()

    const promptContainer = copyBtn.closest('.prompt-container, .recommend-prompt')
    const promptText = promptContainer?.querySelector('.prompt-text')
    if (!promptText) return

    // Use raw markdown from data attribute, fall back to textContent
    const textToCopy = promptText.dataset.rawPrompt || promptText.textContent

    try {
      await navigator.clipboard.writeText(textToCopy)
      const originalText = copyBtn.textContent
      copyBtn.textContent = 'copied!'
      setTimeout(() => {
        copyBtn.textContent = originalText
      }, 1500)
    } catch (error) {
      console.error('Failed to copy:', error)
      copyBtn.textContent = 'failed'
      setTimeout(() => {
        copyBtn.textContent = 'copy'
      }, 1500)
    }
  })
}

// ==========================================================================
// More Prompts Inline Toggle
// ==========================================================================

/**
 * Initialize "more" toggle for revealing additional prompt options inline
 */
function initMorePrompts() {
  document.addEventListener('click', (e) => {
    const moreToggle = e.target.closest('.more-toggle')
    if (!moreToggle) return

    e.preventDefault()
    e.stopPropagation()

    const issueId = moreToggle.dataset.issueId
    const moreSpan = document.querySelector(`[data-more-for="${issueId}"]`)

    if (moreSpan) {
      // Reveal hidden prompts
      moreSpan.classList.remove('hidden')
      // Remove the "more" link and preceding comma
      moreToggle.remove()
    }
  })
}

// ==========================================================================
// AI Recommendation Feature
// ==========================================================================

// Track active recommendation fetch to prevent race conditions
let activeRecommendFetch = null

/**
 * Initialize AI recommendation functionality
 */
function initRecommendations() {
  // Handle clicks on suggest buttons
  document.addEventListener('click', async (e) => {
    const suggestBtn = e.target.closest('.suggest-btn')
    if (!suggestBtn) return

    e.preventDefault()
    e.stopPropagation()

    const issueId = suggestBtn.dataset.issueId

    // Find the recommendation container within the same details context
    const detailsContainer = suggestBtn.closest('.details')
    const recommendContainer = detailsContainer?.querySelector(`[data-recommend-for="${issueId}"]`)
    if (!recommendContainer) return

    // If already visible, toggle off
    if (!recommendContainer.classList.contains('hidden')) {
      recommendContainer.classList.add('hidden')
      return
    }

    // Cancel any in-flight request
    if (activeRecommendFetch) {
      activeRecommendFetch.abort()
    }

    // Create new abort controller for this request
    const abortController = new AbortController()
    activeRecommendFetch = abortController

    // Show loading state
    const reasoning = recommendContainer.querySelector('.recommend-reasoning')
    const promptDiv = recommendContainer.querySelector('.recommend-prompt')
    const promptText = promptDiv?.querySelector('.prompt-text')

    reasoning.textContent = 'Analyzing task context...'
    reasoning.classList.remove('hidden') // Show reasoning during loading
    if (promptText) promptText.textContent = ''
    // Keep prompt section hidden during loading - only show reasoning
    if (promptDiv) promptDiv.classList.add('hidden')
    recommendContainer.classList.remove('hidden')

    // Add loading class to button
    suggestBtn.classList.add('loading')

    try {
      const response = await fetch(
        `/api/recommend/${issueId}`,
        { signal: abortController.signal }
      )

      if (!response.ok) {
        const errorData = await response.json()
        // Include detailed message if available (e.g., OpenRouter API errors)
        const errorMsg = errorData.message
          ? `${errorData.error}: ${errorData.message}`
          : errorData.error || 'Failed to get recommendation'
        throw new Error(errorMsg)
      }

      const data = await response.json()

      // Only update if this is still the active request
      if (activeRecommendFetch === abortController) {
        // Render reasoning as markdown
        const reasoningText = data.truncated
          ? '[Warning: Response may be incomplete due to length limit]\n\n' + data.reasoning
          : data.reasoning
        reasoning.innerHTML = renderMarkdown(reasoningText)
        // Hide reasoning after loading (user can toggle to show)
        reasoning.classList.add('hidden')
        const toggleBtn = recommendContainer.querySelector('.reasoning-toggle')
        if (toggleBtn) toggleBtn.textContent = 'show reasoning'
        if (promptText && data.prompt) {
          // Store raw markdown for copy, render HTML for display
          promptText.dataset.rawPrompt = data.prompt
          promptText.innerHTML = renderMarkdown(data.prompt)
          // Show the prompt section now that the prompt is ready
          if (promptDiv) promptDiv.classList.remove('hidden')
        }
      }
    } catch (error) {
      // Ignore abort errors (user clicked away)
      if (error.name === 'AbortError') return

      reasoning.textContent = `Error: ${error.message}`
      console.error('Failed to get recommendation:', error)
    } finally {
      // Clear active fetch if this was it
      if (activeRecommendFetch === abortController) {
        activeRecommendFetch = null
      }
      // Remove loading state
      suggestBtn.classList.remove('loading')
    }
  })

  // Handle dismiss button clicks
  document.addEventListener('click', (e) => {
    const dismissBtn = e.target.closest('.recommend-close')
    if (!dismissBtn) return

    e.preventDefault()
    e.stopPropagation()

    const recommendContainer = dismissBtn.closest('.recommend-container')
    if (recommendContainer) {
      recommendContainer.classList.add('hidden')
      // Reset reasoning toggle state when dismissed
      const reasoning = recommendContainer.querySelector('.recommend-reasoning')
      const toggleBtn = recommendContainer.querySelector('.reasoning-toggle')
      if (reasoning) reasoning.classList.add('hidden')
      if (toggleBtn) toggleBtn.textContent = 'show reasoning'
    }
  })

  // Handle reasoning toggle button clicks
  document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.reasoning-toggle')
    if (!toggleBtn) return

    e.preventDefault()
    e.stopPropagation()

    const recommendContainer = toggleBtn.closest('.recommend-container')
    const reasoning = recommendContainer?.querySelector('.recommend-reasoning')
    if (!reasoning) return

    // Toggle visibility
    const isHidden = reasoning.classList.toggle('hidden')
    toggleBtn.textContent = isHidden ? 'show reasoning' : 'hide reasoning'
  })
}

// ==========================================================================
// Deploy Time Formatting
// ==========================================================================

/**
 * Format deploy timestamp in viewer's local timezone
 * Updates .deploy-time elements that have a data-timestamp attribute
 */
function initDeployTime() {
  const deployTimeEl = document.querySelector('.deploy-time[data-timestamp]')
  if (!deployTimeEl) return

  const timestamp = deployTimeEl.dataset.timestamp
  if (!timestamp) return

  try {
    const date = new Date(timestamp)
    if (isNaN(date.getTime())) return

    // Format: "deployed Jan 15, 2:30 PM"
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[date.getMonth()]
    const day = date.getDate()

    // Format time in 12-hour format with AM/PM
    let hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12
    hours = hours || 12 // 0 should be 12
    const minuteStr = String(minutes).padStart(2, '0')

    deployTimeEl.textContent = `deployed ${month} ${day}, ${hours}:${minuteStr} ${ampm}`
  } catch (e) {
    // Keep server-rendered fallback on error
    console.warn('Failed to format deploy time:', e)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init()
  initNavBar()
  initPrompts()
  initMorePrompts()
  initRecommendations()
  initDeployTime()
})
