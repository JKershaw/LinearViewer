const STORAGE_KEY = 'linear-projects-state'
const TEAM_STORAGE_KEY = 'linear-projects-selected-team'
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Queue badge polling state
let queuePollIntervalId = null
const QUEUE_POLL_INTERVAL_MS = 1000

// ==========================================================================
// Markdown Rendering (using marked.js library)
// ==========================================================================

/**
 * Render markdown to HTML for display using marked.js
 * @param {string} markdown - Raw markdown text
 * @returns {string} HTML string (sanitized with DOMPurify for defense-in-depth)
 */
function renderMarkdown(markdown) {
  if (!markdown) return ''
  // Use marked library for markdown parsing, then DOMPurify for XSS protection.
  // While marked v17+ sanitizes by default and prompts are server-generated,
  // DOMPurify provides defense-in-depth against any future changes.
  const html = marked.parse(markdown)
  // DOMPurify may not be loaded on all pages, check before using
  return typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(html) : html
}

/**
 * Format a date as relative time (e.g., "2h ago", "yesterday")
 * LIN-156: Used for comment timestamps
 * @param {string} dateStr - ISO date string
 * @returns {string} Human-readable relative time
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

  // Fallback to short date format
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getDate()}`
}

/**
 * Load and render comments for an issue
 * LIN-156: Fetches comments from API on first expand
 * @param {HTMLElement} toggle - The toggle element containing issue ID and urlKey
 * @param {HTMLElement} content - The content container to render into
 */
async function loadComments(toggle, content) {
  const issueId = toggle.dataset.issueId
  const urlKey = toggle.dataset.urlKey

  if (!issueId || !urlKey) {
    console.error('Missing issueId or urlKey for comments')
    return
  }

  const loadingEl = content.querySelector('.comments-loading')
  const errorEl = content.querySelector('.comments-error')
  const listEl = content.querySelector('.comments-list')

  // Show loading state
  loadingEl?.classList.remove('hidden')
  errorEl?.classList.add('hidden')

  try {
    const response = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/comments/${encodeURIComponent(issueId)}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status}`)
    }

    const data = await response.json()
    const comments = data.comments || []

    // Mark as loaded (don't re-fetch on toggle)
    content.dataset.loaded = 'true'

    // Update toggle to show count
    const currentText = toggle.textContent
    if (!currentText.includes('(')) {
      toggle.textContent = currentText.replace('Comments', `Comments (${comments.length})`)
    }

    // Render comments
    if (comments.length === 0) {
      listEl.innerHTML = '<div class="comments-empty">No comments yet</div>'
    } else {
      listEl.innerHTML = comments.map(comment => {
        const bodyHtml = renderMarkdown(comment.body)
        const timeStr = formatRelativeTime(comment.createdAt)
        return `<div class="comment">
          <div class="comment-meta">${escapeHtml(comment.user)} · ${timeStr}</div>
          <div class="comment-body">${bodyHtml}</div>
        </div>`
      }).join('')
    }
  } catch (error) {
    console.error('Failed to load comments:', error)
    if (errorEl) {
      errorEl.textContent = 'Failed to load comments'
      errorEl.classList.remove('hidden')
    }
  } finally {
    loadingEl?.classList.add('hidden')
  }
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
    inProgressCollapsed: false,
    recentActivityCollapsed: true  // Start collapsed by default
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
  state.recentActivityCollapsed = state.recentActivityCollapsed || false

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

  // Apply recent activity section collapsed state (always set explicitly since HTML starts collapsed)
  const recentActivityHeader = document.querySelector('.recent-activity-header')
  const recentActivityItems = document.querySelector('.recent-activity-items')
  if (recentActivityHeader && recentActivityItems) {
    if (state.recentActivityCollapsed) {
      setArrow(recentActivityHeader, false)
      hide(recentActivityItems)
    } else {
      setArrow(recentActivityHeader, true)
      show(recentActivityItems)
    }
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

    // 1b. Issue description toggle (show more/less with markdown) - LIN-156
    if (e.target.closest('.issue-desc-toggle')) {
      e.stopPropagation()
      const container = e.target.closest('.issue-description')
      if (!container) return

      const truncated = container.querySelector('.desc-truncated')
      const full = container.querySelector('.desc-full')
      const fullContent = container.querySelector('.desc-full-content')

      // Render markdown on first expansion
      if (fullContent && !fullContent.dataset.rendered) {
        const rawDescBase64 = container.dataset.rawDesc
        if (rawDescBase64) {
          try {
            // Decode base64 with validation
            let rawDesc
            try {
              rawDesc = atob(rawDescBase64)
            } catch (decodeErr) {
              console.error('Failed to decode description:', decodeErr)
              fullContent.textContent = '[Error decoding description]'
              fullContent.dataset.rendered = 'true'
              truncated.classList.toggle('hidden')
              full.classList.toggle('hidden')
              return
            }

            const urlKey = container.dataset.urlKey
            let html = renderMarkdown(rawDesc)

            // Rewrite Linear image URLs to use proxy (LIN-156)
            // Only rewrite for valid urlKey and proper image URLs
            if (urlKey && /^[a-zA-Z0-9_-]+$/.test(urlKey)) {
              const tempDiv = document.createElement('div')
              tempDiv.innerHTML = html

              // Find all images and rewrite Linear URLs
              tempDiv.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src') || ''
                if (src.match(/^https:\/\/(uploads\.linear\.app|cdn\.linear\.app)\//)) {
                  const proxyUrl = `/workspace/${encodeURIComponent(urlKey)}/api/image?url=${encodeURIComponent(src)}`
                  img.setAttribute('src', proxyUrl)
                  img.setAttribute('loading', 'lazy')
                  // Add error handler safely via event listener (not inline)
                  img.dataset.originalSrc = src
                }
              })

              html = tempDiv.innerHTML
            }

            fullContent.innerHTML = html

            // Add error handlers to images after inserting into DOM
            fullContent.querySelectorAll('img[data-original-src]').forEach(img => {
              img.addEventListener('error', function() {
                this.style.display = 'none'
                const errorSpan = document.createElement('span')
                errorSpan.className = 'img-error'
                errorSpan.textContent = '[Image failed to load]'
                if (this.parentNode) {
                  this.parentNode.insertBefore(errorSpan, this.nextSibling)
                }
              })
            })

            fullContent.dataset.rendered = 'true'
          } catch (err) {
            console.error('Failed to render description:', err)
            fullContent.textContent = '[Error rendering description]'
            fullContent.dataset.rendered = 'true'
          }
        }
      }

      truncated.classList.toggle('hidden')
      full.classList.toggle('hidden')
      return
    }

    const detailToggle = e.target.closest('.detail-toggle')
    if (detailToggle) {
      e.stopPropagation()
      const toggleType = detailToggle.dataset.toggle // 'details', 'prompts', or 'comments'
      const detailsContainer = detailToggle.closest('.details')
      const content = detailsContainer?.querySelector(`[data-content="${toggleType}"]`)

      if (content && detailsContainer) {
        const isHidden = content.classList.toggle('hidden')
        // Update arrow: ▶ when collapsed, ▼ when expanded
        detailToggle.textContent = detailToggle.textContent.replace(
          isHidden ? '▼' : '▶',
          isHidden ? '▶' : '▼'
        )

        // LIN-156: Load comments on first expand
        if (toggleType === 'comments' && !isHidden && !content.dataset.loaded) {
          loadComments(detailToggle, content)
        }
      }
      return
    }

    // 3. Toggle arrow click (expand/collapse children)
    const toggle = e.target.closest('.toggle')
    if (toggle) {
      e.stopPropagation()
      toggleItem(toggle.closest('[data-id]'))
      return
    }

    // 4. Project description click (show/hide meta)
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

    // 5. Line click (expand issue details) - skip if clicking a link
    const line = e.target.closest('.line.expandable')
    if (line && !e.target.closest('a')) {
      toggleItem(line)
      return
    }

    // 6. Completed toggle click
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

    // 7. Project header click (collapse project)
    const header = e.target.closest('.project-header')
    if (header) {
      handleProjectHeaderClick(header)
      return
    }

    // 8. In-progress header click
    const inProgressHeader = e.target.closest('.in-progress-header')
    if (inProgressHeader) {
      state.inProgressCollapsed = !state.inProgressCollapsed
      persistState(state)
      const items = document.querySelector('.in-progress-items')
      setHidden(items, state.inProgressCollapsed)
      setArrow(inProgressHeader, !state.inProgressCollapsed)
      return
    }

    // 9. Recent activity header click
    const recentActivityHeader = e.target.closest('.recent-activity-header')
    if (recentActivityHeader) {
      state.recentActivityCollapsed = !state.recentActivityCollapsed
      persistState(state)
      const items = document.querySelector('.recent-activity-items')
      setHidden(items, state.recentActivityCollapsed)
      setArrow(recentActivityHeader, !state.recentActivityCollapsed)
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

  // Create overlay element for mobile dropdown backdrop
  let dropdownOverlay = document.querySelector('.nav-dropdown-overlay')
  if (!dropdownOverlay) {
    dropdownOverlay = document.createElement('div')
    dropdownOverlay.className = 'nav-dropdown-overlay hidden'
    document.body.appendChild(dropdownOverlay)
  }

  // Track currently open selector
  let openSelector = null

  function closeAllSelectors() {
    ;[workspaceToggle, teamToggle].forEach(btn => {
      if (btn) btn.setAttribute('aria-expanded', 'false')
    })
    ;[workspaceOptions, teamOptions].forEach(panel => {
      if (panel) panel.classList.add('hidden')
    })
    if (dropdownOverlay) dropdownOverlay.classList.add('hidden')
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
      if (dropdownOverlay) dropdownOverlay.classList.remove('hidden')
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
      // Get workspace URL key from data attribute (workspace-prefixed URLs)
      const urlKey = teamOptions.dataset.urlKey
      const workspacePrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      const url = teamId === 'all' ? `${workspacePrefix}/` : `${workspacePrefix}/?team=${teamId}`
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

  // Close on overlay click (mobile backdrop)
  if (dropdownOverlay) {
    dropdownOverlay.addEventListener('click', closeAllSelectors)
  }

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
      // Get workspace URL key from data attribute (workspace-prefixed URLs)
      const urlKey = teamOptions?.dataset.urlKey
      const workspacePrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      window.location.href = `${workspacePrefix}/?team=${savedTeam}`
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
 * Hide all prompt containers for an issue (ensures only one visible at a time)
 * @param {Element} detailsContainer - The .details element containing prompt UI
 * @param {string} issueId - The issue ID
 */
function hideIssuePromptUI(detailsContainer, issueId) {
  // Hide manual prompt container and reset its state
  const promptContainer = detailsContainer?.querySelector(`[data-prompt-for="${issueId}"]`)
  if (promptContainer) {
    promptContainer.classList.add('hidden')
    promptContainer.dataset.activeLabel = ''
  }

  // Hide AI recommendation container
  const recommendContainer = detailsContainer?.querySelector(`[data-recommend-for="${issueId}"]`)
  if (recommendContainer) {
    recommendContainer.classList.add('hidden')
  }
}

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

    // Hide any other prompt UI for this issue (AI suggestion)
    hideIssuePromptUI(detailsContainer, issueId)

    // Show loading state
    const promptText = promptContainer.querySelector('.prompt-text')
    const promptName = promptContainer.querySelector('.prompt-name')
    promptText.textContent = 'Loading...'
    promptName.textContent = ''
    promptContainer.classList.remove('hidden')
    promptContainer.dataset.activeLabel = labelName

    try {
      // Get workspace URL key from data attribute (workspace-prefixed URLs)
      const urlKey = promptContainer.dataset.urlKey
      const apiPrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      const response = await fetch(
        `${apiPrefix}/api/prompt/${issueId}/${encodeURIComponent(labelName)}`,
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

  // Handle dispatch button clicks
  document.addEventListener('click', async (e) => {
    const dispatchBtn = e.target.closest('.prompt-dispatch')
    if (!dispatchBtn) return

    e.preventDefault()
    e.stopPropagation()

    const promptContainer = dispatchBtn.closest('.prompt-container, .recommend-prompt')
    const promptText = promptContainer?.querySelector('.prompt-text')
    const promptNameEl = promptContainer?.querySelector('.prompt-name')
    if (!promptText) return

    // Get the prompt content
    const prompt = promptText.dataset.rawPrompt || promptText.textContent
    const promptName = promptNameEl?.textContent || 'Prompt'

    // Read target from button's data-target attribute (defaults to 'cli')
    const target = dispatchBtn.dataset.target || 'cli'
    const originalLabel = dispatchBtn.textContent

    // Get issue ID and workspace URL key
    const issueId = promptContainer.dataset.promptFor ||
      promptContainer.closest('[data-recommend-for]')?.dataset.recommendFor
    const urlKey = promptContainer.dataset.urlKey ||
      promptContainer.closest('[data-url-key]')?.dataset.urlKey

    if (!urlKey) {
      console.error('No workspace URL key found for dispatch')
      dispatchBtn.textContent = 'failed'
      setTimeout(() => { dispatchBtn.textContent = originalLabel }, 1500)
      return
    }

    // Get issue title from the DOM if available
    const issueEl = issueId ? document.querySelector(`[data-id="${issueId}"]`) : null
    const issueTitle = issueEl?.querySelector('.title, .title-dim')?.textContent || null

    try {
      dispatchBtn.textContent = 'sending...'

      const response = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          promptName,
          issueId: issueId || null,
          issueTitle,
          target
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Dispatch failed')
      }

      dispatchBtn.textContent = 'dispatched!'
      dispatchBtn.classList.add('dispatched')

      // Update queue badge if exists
      updateQueueBadge(urlKey)

      setTimeout(() => {
        dispatchBtn.textContent = originalLabel
        dispatchBtn.classList.remove('dispatched')
      }, 1500)
    } catch (error) {
      console.error('Failed to dispatch:', error)
      dispatchBtn.textContent = 'failed'
      setTimeout(() => {
        dispatchBtn.textContent = originalLabel
      }, 1500)
    }
  })
}

// =============================================================================
// Queue Badge Management
// =============================================================================

/**
 * Update the queue badge count for a workspace
 */
async function updateQueueBadge(urlKey) {
  try {
    const response = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/count`)
    if (!response.ok) return

    const { count } = await response.json()
    const badge = document.querySelector(`[data-queue-badge][data-url-key="${urlKey}"]`)
    if (badge) {
      const countEl = badge.querySelector('.queue-count')
      if (countEl) countEl.textContent = count
      badge.classList.toggle('hidden', count === 0)
    }
  } catch (e) {
    console.error('Failed to update queue badge:', e)
  }
}

/**
 * Start polling for queue badge updates
 */
function startQueuePolling(urlKey) {
  if (queuePollIntervalId) return

  queuePollIntervalId = setInterval(() => {
    if (!document.hidden) {
      updateQueueBadge(urlKey)
    }
  }, QUEUE_POLL_INTERVAL_MS)
}

/**
 * Stop polling for queue badge updates
 */
function stopQueuePolling() {
  if (queuePollIntervalId) {
    clearInterval(queuePollIntervalId)
    queuePollIntervalId = null
  }
}

/**
 * Initialize queue panel functionality
 */
function initQueuePanel() {
  // Initialize badge count on page load and start polling
  const badge = document.querySelector('[data-queue-badge]')
  if (badge) {
    const urlKey = badge.dataset.urlKey
    updateQueueBadge(urlKey)
    startQueuePolling(urlKey)

    // Fetch immediately when tab becomes visible (data may be stale)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        updateQueueBadge(urlKey)
      }
    })
  }

  // Handle badge click to show queue panel
  document.addEventListener('click', async (e) => {
    const badgeBtn = e.target.closest('[data-queue-badge]')
    if (!badgeBtn) return

    e.preventDefault()
    e.stopPropagation()

    const urlKey = badgeBtn.dataset.urlKey
    await showQueuePanel(urlKey)
  })

  // Handle close button and overlay clicks
  document.addEventListener('click', (e) => {
    if (e.target.closest('.queue-panel-close') || e.target.closest('.queue-panel-overlay')) {
      hideQueuePanel()
    }
  })

  // Handle remove button clicks
  document.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('.queue-item-remove')
    if (!removeBtn) return

    e.preventDefault()
    e.stopPropagation()

    const itemId = removeBtn.dataset.itemId
    const urlKey = removeBtn.dataset.urlKey
    await removeQueueItem(urlKey, itemId)
  })

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideQueuePanel()
    }
  })
}

/**
 * Show the queue panel with items
 */
async function showQueuePanel(urlKey) {
  // Remove any existing panel
  hideQueuePanel()

  // Create overlay
  const overlay = document.createElement('div')
  overlay.className = 'queue-panel-overlay'
  document.body.appendChild(overlay)

  // Create panel
  const panel = document.createElement('div')
  panel.className = 'queue-panel'
  panel.dataset.urlKey = urlKey
  panel.innerHTML = `
    <div class="queue-panel-header">
      <span>Dispatch Queue</span>
      <button class="queue-panel-close" aria-label="Close">×</button>
    </div>
    <div class="queue-panel-items">
      <div class="queue-panel-empty">Loading...</div>
    </div>
  `
  document.body.appendChild(panel)

  // Load items
  try {
    const r = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch`)
    if (r.ok) {
      const { items } = await r.json()
      renderQueueItems(panel, items, urlKey)
    } else {
      throw new Error('Failed to load queue')
    }
  } catch (e) {
    console.error('Failed to load queue items:', e)
    panel.querySelector('.queue-panel-items').innerHTML =
      '<div class="queue-panel-empty">Failed to load queue</div>'
  }
}

/**
 * Render queue items in the panel
 */
function renderQueueItems(panel, items, urlKey) {
  const container = panel.querySelector('.queue-panel-items')

  if (items.length === 0) {
    container.innerHTML = '<div class="queue-panel-empty">Queue is empty</div>'
    return
  }

  container.innerHTML = items.map(item => {
    const time = new Date(item.dispatchedAt).toLocaleString()
    const title = item.issueTitle || item.promptName || 'Prompt'
    const target = item.target || 'cli'
    const metaParts = [item.issueIdentifier, target, time].filter(Boolean)
    const meta = metaParts.join(' \u00b7 ')

    return `
      <div class="queue-item" data-item-id="${escapeHtml(item.id)}">
        <div class="queue-item-header">
          <span class="queue-item-title">${escapeHtml(title)}</span>
          <button class="queue-item-remove" data-item-id="${escapeHtml(item.id)}" data-url-key="${escapeHtml(urlKey)}">remove</button>
        </div>
        <div class="queue-item-meta">${escapeHtml(meta)}</div>
      </div>
    `
  }).join('')
}


/**
 * Hide the queue panel
 */
function hideQueuePanel() {
  document.querySelector('.queue-panel')?.remove()
  document.querySelector('.queue-panel-overlay')?.remove()
}

/**
 * Remove an item from the queue
 */
async function removeQueueItem(urlKey, itemId) {
  // Validate itemId format to prevent CSS selector injection
  if (!itemId || !UUID_REGEX.test(itemId)) {
    console.error('Invalid itemId format')
    return
  }

  try {
    const response = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/${encodeURIComponent(itemId)}`, {
      method: 'DELETE'
    })

    if (!response.ok) throw new Error('Failed to remove item')

    // Remove item from DOM (itemId validated as UUID above, safe for selector)
    document.querySelector(`.queue-item[data-item-id="${itemId}"]`)?.remove()

    // Update badge
    await updateQueueBadge(urlKey)

    // Check if queue is now empty
    const panel = document.querySelector('.queue-panel')
    if (panel && panel.querySelectorAll('.queue-item').length === 0) {
      panel.querySelector('.queue-panel-items').innerHTML =
        '<div class="queue-panel-empty">Queue is empty</div>'
    }
  } catch (e) {
    console.error('Failed to remove queue item:', e)
  }
}

// =============================================================================
// Feature Toggle AJAX (Settings Page)
// =============================================================================

/**
 * Initialize AJAX-based feature toggle saves on the settings page.
 * Intercepts form submissions, POSTs via fetch, and updates UI inline
 * without a full page reload. Falls back to standard form POST on error.
 */
function initFeatureToggles() {
  const toggleBtns = document.querySelectorAll('.settings-section .toggle-btn')
  if (!toggleBtns.length) return // Not on settings page

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.settings-section .toggle-btn')
    if (!btn) return

    e.preventDefault()
    const form = btn.closest('form')
    if (!form) return

    // Prevent rapid double-clicks from causing race conditions
    if (btn.disabled) return
    btn.disabled = true

    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams(new FormData(form))
      })

      // Auth errors — redirect to re-authenticate
      if (res.status === 401 || res.status === 403) {
        window.location.href = '/logout'
        return
      }

      // Validation or server error — fall back to form POST for error display
      if (!res.ok) {
        form.submit()
        return
      }

      // Server returns JSON for AJAX requests: { ok, feature, enabled }
      const data = await res.json()
      if (!data.ok) {
        form.submit()
        return
      }

      // Toggle visual state inline
      const stateSpan = btn.querySelector('.toggle-state')
      const featureLine = btn.closest('.feature-toggle')
      const hiddenEnabled = form.querySelector('input[name="enabled"]')

      if (hiddenEnabled.value === 'true') {
        // Was off, now on
        btn.classList.remove('toggle-off')
        btn.classList.add('toggle-on')
        if (stateSpan) stateSpan.textContent = '● on'
        hiddenEnabled.value = 'false' // Next click will turn off
      } else {
        // Was on, now off
        btn.classList.remove('toggle-on')
        btn.classList.add('toggle-off')
        if (stateSpan) stateSpan.textContent = '○ off'
        hiddenEnabled.value = 'true' // Next click will turn on
      }

      // Show inline ✓ feedback
      if (featureLine) {
        let feedback = featureLine.querySelector('.save-feedback')
        if (!feedback) {
          feedback = document.createElement('span')
          feedback.className = 'save-feedback'
          featureLine.appendChild(feedback)
          feedback.textContent = '✓'
        }
        // Force a DOM reflow between removing and re-adding the class so
        // the CSS opacity transition restarts even on rapid successive saves
        feedback.classList.remove('visible')
        void feedback.offsetWidth
        feedback.classList.add('visible')
        setTimeout(() => feedback.classList.remove('visible'), 1500)
      }

      // Show/hide sub-toggles when a parent feature with children is toggled
      const nodeDiv = featureLine.closest('.node')
      if (nodeDiv) {
        const childrenDiv = nodeDiv.querySelector('.children.code-review-options')
        if (childrenDiv && featureLine.dataset.feature === 'codeReview') {
          childrenDiv.hidden = !data.enabled
        }
      }
    } catch (err) {
      // Network error — fall back to standard form submission
      console.warn('Feature toggle AJAX failed, falling back to form POST:', err)
      form.submit()
    } finally {
      btn.disabled = false
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

    // Find the more-prompts span within the same details context as the clicked toggle
    // This is important because the same issue can appear in both the "In Progress"
    // section and its project tree, each with its own set of prompt links
    const detailsContainer = moreToggle.closest('.details')
    const moreSpan = detailsContainer?.querySelector(`[data-more-for="${issueId}"]`)

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
 * Show free tier usage info below a recommendation container
 * @param {Element} recommendContainer - The recommendation container element
 * @param {Object} freeTier - Free tier usage data
 */
function showFreeTierInfo(recommendContainer, freeTier) {
  // Remove existing info if present
  const existing = recommendContainer.querySelector('.free-tier-info')
  if (existing) existing.remove()

  const info = document.createElement('div')
  info.className = 'free-tier-info'
  info.setAttribute('data-testid', 'free-tier-info')
  info.textContent = `free tier \u00b7 ${freeTier.remaining} of ${freeTier.limit} daily prompts remaining \u00b7 resets midnight UTC`
  recommendContainer.appendChild(info)
}

/**
 * Update the footer AI status with free tier remaining count
 * @param {Object} freeTier - Free tier usage data
 */
function updateFooterFreeTier(freeTier) {
  const footerStatus = document.querySelector('.footer-ai-status[data-ai-source="free"]')
  if (!footerStatus) return

  footerStatus.textContent = `ai: \u25cf free (${freeTier.remaining}/${freeTier.limit})`
  if (freeTier.remaining === 0) {
    footerStatus.classList.remove('free')
    footerStatus.classList.add('disconnected')
    footerStatus.title = 'Free tier: daily limit reached'
  }
}

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

    // Hide any other prompt UI for this issue (manual prompts)
    hideIssuePromptUI(detailsContainer, issueId)

    // Show loading state
    const reasoning = recommendContainer.querySelector('.recommend-reasoning')
    const promptDiv = recommendContainer.querySelector('.recommend-prompt')
    const promptText = promptDiv?.querySelector('.prompt-text')
    const toggleBtn = recommendContainer.querySelector('.reasoning-toggle')

    reasoning.textContent = 'Analyzing task context...'
    reasoning.classList.remove('hidden') // Show reasoning during loading
    if (toggleBtn) toggleBtn.classList.add('hidden') // Hide toggle during loading
    if (promptText) promptText.textContent = ''
    // Keep prompt section hidden during loading - only show reasoning
    if (promptDiv) promptDiv.classList.add('hidden')
    recommendContainer.classList.remove('hidden')

    // Add loading class to button
    suggestBtn.classList.add('loading')

    try {
      // Get workspace URL key from data attribute (workspace-prefixed URLs)
      const urlKey = recommendContainer.dataset.urlKey
      const apiPrefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : ''
      const response = await fetch(
        `${apiPrefix}/api/recommend/${issueId}`,
        { signal: abortController.signal }
      )

      if (!response.ok) {
        const errorData = await response.json()
        // Handle rate limit (429) with free tier info
        if (response.status === 429 && errorData.freeTier) {
          throw Object.assign(new Error(errorData.error), { freeTier: errorData.freeTier })
        }
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
        if (toggleBtn) {
          toggleBtn.classList.remove('hidden') // Show toggle after loading
          toggleBtn.textContent = 'show reasoning'
        }
        if (promptText && data.prompt) {
          // Store raw markdown for copy, render HTML for display
          promptText.dataset.rawPrompt = data.prompt
          promptText.innerHTML = renderMarkdown(data.prompt)
          // Show the prompt section now that the prompt is ready
          if (promptDiv) promptDiv.classList.remove('hidden')
        }

        // Show free tier usage info if applicable
        if (data.freeTier) {
          showFreeTierInfo(recommendContainer, data.freeTier)
          updateFooterFreeTier(data.freeTier)
        }
      }
    } catch (error) {
      // Ignore abort errors (user clicked away)
      if (error.name === 'AbortError') return

      // Show free tier limit exceeded with helpful message
      if (error.freeTier) {
        const urlKey = recommendContainer.dataset.urlKey
        const settingsUrl = urlKey ? `/workspace/${encodeURIComponent(urlKey)}/settings` : '/settings'
        reasoning.innerHTML = `<span class="free-tier-limit-reached">${escapeHtml(error.message)}</span><br>` +
          `<a href="${escapeHtml(settingsUrl)}">Connect your OpenRouter account</a> for unlimited prompts.`
        reasoning.classList.remove('hidden')
        updateFooterFreeTier(error.freeTier)
      } else {
        reasoning.textContent = `Error: ${error.message}`
        reasoning.classList.remove('hidden') // Ensure visible for error
      }
      // Reasoning stays visible with error, so toggle should say "hide"
      const toggleBtn = recommendContainer.querySelector('.reasoning-toggle')
      if (toggleBtn) {
        toggleBtn.classList.remove('hidden') // Show toggle after loading
        toggleBtn.textContent = 'hide reasoning'
      }
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
// Search Feature
// ==========================================================================

/**
 * Initialize search functionality for filtering issues by keyword.
 * LIN-145: Client-side filtering using data-search-text attributes.
 */
function initSearch() {
  const searchToggle = document.querySelector('.search-toggle')
  const searchPanel = document.getElementById('search-panel')
  const searchInput = document.getElementById('search-input')
  const searchClear = document.getElementById('search-clear')
  const noResults = document.getElementById('search-no-results')

  if (!searchToggle || !searchPanel || !searchInput) return

  let searchActive = false

  function openSearch() {
    searchPanel.classList.remove('hidden')
    searchToggle.setAttribute('aria-expanded', 'true')
    searchInput.focus()
  }

  function clearSearchState() {
    if (!searchActive) return
    searchActive = false
    // Remove all search-driven hidden classes before applyState restores normal view.
    // applyState/resetDOM handle .node visibility by depth but don't touch projects/sections
    // (which are normally never hidden), so we must clean those up explicitly.
    document.querySelectorAll('.project.hidden').forEach(p => p.classList.remove('hidden'))
    document.querySelectorAll('.in-progress-section.hidden').forEach(s => s.classList.remove('hidden'))
    document.querySelectorAll('.recent-activity-section.hidden').forEach(s => s.classList.remove('hidden'))
    // Also ensure all .node elements are visible before resetDOM re-applies depth-based visibility,
    // in case search left nodes hidden that resetDOM wouldn't otherwise reach (e.g. in completed sections)
    document.querySelectorAll('.node.hidden').forEach(n => n.classList.remove('hidden'))
    applyState(loadState())
  }

  function closeSearch() {
    searchPanel.classList.add('hidden')
    searchToggle.setAttribute('aria-expanded', 'false')
    searchInput.value = ''
    if (noResults) noResults.classList.add('hidden')
    clearSearchState()
  }

  function performSearch(term) {
    const lowerTerm = term.toLowerCase().trim()

    if (!lowerTerm) {
      clearSearchState()
      if (noResults) noResults.classList.add('hidden')
      return
    }

    searchActive = true

    // Hide all nodes first
    document.querySelectorAll('.node').forEach(n => n.classList.add('hidden'))

    // Hide all details during search
    document.querySelectorAll('.details').forEach(d => d.classList.add('hidden'))

    // Find matching lines and show their nodes + ancestors
    let matchCount = 0
    document.querySelectorAll('.line[data-search-text]').forEach(line => {
      if (!line.dataset.searchText.includes(lowerTerm)) return
      matchCount++

      // Show this node and all ancestor nodes
      let node = line.closest('.node')
      while (node) {
        node.classList.remove('hidden')
        // Walk up: .node → .children → .node
        node = node.parentElement?.closest('.node')
      }
    })

    // Show/hide projects based on whether they contain matches
    document.querySelectorAll('.project').forEach(project => {
      const hasMatch = project.querySelector('.node:not(.hidden)')
      project.classList.toggle('hidden', !hasMatch)
    })

    // Show/hide in-progress section
    const ipSection = document.querySelector('.in-progress-section')
    if (ipSection) {
      const ipItems = ipSection.querySelector('.in-progress-items')
      const hasMatch = ipItems?.querySelector('.node:not(.hidden)')
      ipSection.classList.toggle('hidden', !hasMatch)
      // Ensure the items container is visible if section has matches
      if (hasMatch && ipItems) ipItems.classList.remove('hidden')
    }

    // Show/hide recent activity section
    const raSection = document.querySelector('.recent-activity-section')
    if (raSection) {
      const raItems = raSection.querySelector('.recent-activity-items')
      const hasMatch = raItems?.querySelector('.node:not(.hidden)')
      raSection.classList.toggle('hidden', !hasMatch)
      if (hasMatch && raItems) raItems.classList.remove('hidden')
    }

    // Also check completed sections for matches
    document.querySelectorAll('[data-completed-for]').forEach(completedSection => {
      const hasMatch = completedSection.querySelector('.node:not(.hidden)')
      completedSection.classList.toggle('hidden', !hasMatch)
    })

    // Show/hide "no results" message
    if (noResults) noResults.classList.toggle('hidden', matchCount > 0)
  }

  // Toggle search panel
  searchToggle.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const isOpen = searchToggle.getAttribute('aria-expanded') === 'true'
    if (isOpen) {
      closeSearch()
    } else {
      openSearch()
    }
  })

  // Filter on input
  searchInput.addEventListener('input', () => {
    performSearch(searchInput.value)
  })

  // Clear button
  searchClear.addEventListener('click', (e) => {
    e.stopPropagation()
    closeSearch()
  })

  // Escape key closes search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearch()
    }
  })

  // "/" keyboard shortcut to open search (when no input is focused)
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]')) {
      e.preventDefault()
      openSearch()
    }
  })
}

// Cleanup polling on page unload
window.addEventListener('beforeunload', stopQueuePolling)

/**
 * Get the workspace urlKey from the footer settings link.
 * @returns {string|null} The workspace urlKey or null
 */
function getUrlKeyFromFooter() {
  const footerStatus = document.querySelector('.footer-ai-status[data-ai-source="free"]')
  if (!footerStatus) return null
  const href = footerStatus.getAttribute('href') || ''
  const match = href.match(/\/workspace\/([^/]+)\/settings/)
  return match ? match[1] : null
}

/**
 * Initialize free tier footer status on page load.
 * Fetches current usage from the recommend/status endpoint and updates the footer.
 * Also populates the settings page free tier usage display.
 */
async function initFreeTierStatus() {
  // Check both footer and settings page for free tier elements
  const footerStatus = document.querySelector('.footer-ai-status[data-ai-source="free"]')
  const settingsUsage = document.querySelector('[data-free-tier-usage]')
  if (!footerStatus && !settingsUsage) return

  // Get urlKey from footer link or settings page URL
  let urlKey = getUrlKeyFromFooter()
  if (!urlKey) {
    const pathMatch = window.location.pathname.match(/\/workspace\/([^/]+)/)
    urlKey = pathMatch ? pathMatch[1] : null
  }
  if (!urlKey) return

  try {
    const response = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/recommend/status`)
    if (!response.ok) return

    const data = await response.json()
    if (data.freeTier) {
      if (footerStatus) updateFooterFreeTier(data.freeTier)
      if (settingsUsage) {
        settingsUsage.textContent = `${data.freeTier.remaining} of ${data.freeTier.limit} daily prompts remaining`
      }
    }
  } catch (e) {
    // Silently fail - elements will show defaults
    if (settingsUsage) settingsUsage.textContent = 'Unable to load usage'
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init()
  initNavBar()
  initSearch()
  initPrompts()
  initMorePrompts()
  initRecommendations()
  initQueuePanel()
  initFeatureToggles()
  initFreeTierStatus()
})
