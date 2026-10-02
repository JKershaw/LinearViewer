const STORAGE_KEY = 'linear-projects-state'
// TEAM_STORAGE_KEY and the team-selection helpers now live in common.js
// (alongside initNavBar) so the workspace switcher works on every page — LIN-288.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Queue badge polling state
let queuePollIntervalId = null
const QUEUE_POLL_INTERVAL_MS = 1000

// Rulings badge polling (LIN-1728 Phase 3) now lives in common.js — see
// initRulingsBadge there for why (LIN-1728 review F7: it must be reachable
// from the Observation page, which loads common.js but not app.js).

// Proxy-toggle logic (state, token mint/cache, block append) now lives in a
// single shared module: window.ProxyToggle in common.js (LIN-525 #7). The
// copy/download/dispatch call sites below use the back-compat global
// maybeAppendProxyBlock(text, urlKey, opts) that common.js exposes; `opts.force`
// forces the append (LIN-3079).

/**
 * Strip markdown code block fences from prompt text.
 * AI models sometimes wrap generated prompts in backtick fences.
 * @param {string} text - Text that may be wrapped in code block markers
 * @returns {string} Text with outer code block markers removed
 */
function stripCodeBlockFences(text) {
  if (!text) return text
  return text.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '').trim()
}

/**
 * Slugify a value into a filesystem-safe token for a download filename.
 * Mirrors slugifyForFilename in lib/prompt-formatters.js.
 * @param {string} value
 * @returns {string} Lower-cased, dash-separated slug
 */
function slugifyForFilename(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

/**
 * Build a `<identifier>-<promptName>.md` filename for a downloaded prompt.
 * @param {string} identifier - Issue identifier (e.g. LIN-316), may be empty
 * @param {string} promptName - Prompt name (e.g. "Retro")
 * @returns {string} Safe filename ending in `.md`
 */
function buildPromptFilename(identifier, promptName) {
  const id = slugifyForFilename(identifier)
  const name = slugifyForFilename(promptName) || 'prompt'
  const base = id ? `${id}-${name}` : name
  return `${base}.md`
}

/**
 * Trigger a client-side markdown download of the given text.
 * @param {string} text - File contents
 * @param {string} filename - Download filename
 */
function downloadMarkdown(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Release the object URL on the next tick so the download can start first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ==========================================================================
// Markdown Rendering (using marked.js library)
// ==========================================================================

// renderMarkdown + relativeTime are canonical in common.js (window.*, LIN-421);
// called here via the bare globals (same convention as escapeHtml). renderMarkdown
// converges onto the superset (whole-string fence strip + marked-absent fallback);
// relativeTime is the same "Behavior B" format this page's local copy seeded.

/**
 * LIN-3240: the `?source=...&bindingScope=...` query for an issue-scoped fetch.
 * `bindingScope` is the row's own binding stamp (`data-binding-scope`); it is
 * forwarded only when present, so an unstamped single-binding/legacy request
 * stays byte-identical to the pre-slice `?source=...`.
 * @param {string} [source] - resolved provider name
 * @param {string} [bindingScope] - binding selector stamp
 * @returns {string} a leading-`?` query string, or ''
 */
function sourceBindingQuery(source, bindingScope) {
  const parts = []
  if (source) parts.push(`source=${encodeURIComponent(source)}`)
  if (bindingScope) parts.push(`bindingScope=${encodeURIComponent(bindingScope)}`)
  return parts.length ? `?${parts.join('&')}` : ''
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
  // LIN-1904: forward the resolved provider (stamped server-side in
  // lib/render.js) so the fetch resolves THIS issue's own binding instead of
  // the workspace's active provider. LIN-3240: forward its binding stamp too.
  const source = toggle.dataset.source
  const bindingScope = toggle.dataset.bindingScope

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
    const sourceQuery = sourceBindingQuery(source, bindingScope)
    const data = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/comments/${encodeURIComponent(issueId)}${sourceQuery}`)
    const comments = (data && data.comments) || []

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
        const timeStr = relativeTime(comment.createdAt)
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

/**
 * Wire error fallbacks for a task-detail attachments gallery on first expand.
 * LIN-652: the gallery HTML (and its `/api/image`-relayed `<img loading="lazy">`
 * tags) is server-rendered, so there is no metadata fetch here — only an error
 * handler per image, attached once, mirroring the description-image fallback. A
 * relay miss (revoked token, deleted upload) swaps the broken image for a small
 * "[Image failed to load]" note instead of a browser-default broken icon.
 * @param {HTMLElement} content - The attachments `.detail-content` container
 */
function initAttachmentImages(content) {
  // Idempotent: a later collapse/expand must not re-bind handlers.
  content.dataset.loaded = 'true'
  content.querySelectorAll('img.attachment-image').forEach(img => {
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
}

/**
 * Lazy-mount a shared on-card section (Brief / Recap / Scan / Dispatched
 * Sessions) on first expand of its nested toggle. LIN-522: mirrors
 * public/swipe.js, reusing the view-agnostic BriefSection / RecapSection /
 * ScanSection (LIN-2197 Phase 5) / SessionsSection modules. The issue
 * identifier and workspace url key are read from the toggle's data
 * attributes (set server-side in lib/render.js).
 * @param {'brief'|'recap'|'scan'|'sessions'} type - Which section to mount
 * @param {HTMLElement} toggle - The nested toggle carrying the data attributes
 * @param {HTMLElement} content - The content container holding the placeholder
 */
function loadLazySection(type, toggle, content) {
  const identifier = toggle.dataset.issueIdentifier
  const urlKey = toggle.dataset.urlKey
  // LIN-1910: forward the resolved provider (stamped server-side in
  // lib/render.js) so Brief/Recap resolve THIS issue's own binding instead of
  // the workspace's active provider. LIN-3240: forward its binding stamp too.
  const source = toggle.dataset.source
  const bindingScope = toggle.dataset.bindingScope
  if (!identifier || !urlKey) return

  // Guard against re-init on a later expand (init is idempotent but a re-fetch
  // is wasteful; the modules expose their own refresh button for that).
  content.dataset.loaded = 'true'

  if (type === 'brief') {
    const placeholder = content.querySelector('[data-brief-placeholder="1"]')
    if (placeholder && window.BriefSection) {
      placeholder.removeAttribute('data-brief-placeholder')
      window.BriefSection.init(placeholder, { urlKey, identifier, source, bindingScope })
    }
  } else if (type === 'recap') {
    const placeholder = content.querySelector('[data-recap-placeholder="1"]')
    if (placeholder && window.RecapSection) {
      placeholder.removeAttribute('data-recap-placeholder')
      window.RecapSection.init(placeholder, { urlKey, identifier, source, bindingScope })
    }
  } else if (type === 'scan') {
    const placeholder = content.querySelector('[data-scan-placeholder="1"]')
    if (placeholder && window.ScanSection) {
      placeholder.removeAttribute('data-scan-placeholder')
      window.ScanSection.init(placeholder, { urlKey, identifier, source, bindingScope })
    }
  } else if (type === 'sessions') {
    const placeholder = content.querySelector('[data-sessions-placeholder="1"]')
    if (placeholder && window.SessionsSection) {
      placeholder.removeAttribute('data-sessions-placeholder')
      window.SessionsSection.init(placeholder, { urlKey, identifier })
    }
  } else if (type === 'context') {
    const placeholder = content.querySelector('[data-context-placeholder="1"]')
    if (placeholder && window.ContextSection) {
      placeholder.removeAttribute('data-context-placeholder')
      // LIN-3240 (review F3): forward the row's provider + binding stamp so the
      // context read resolves THIS issue's own binding, not the active one.
      window.ContextSection.init(placeholder, { urlKey, identifier, source, bindingScope })
    }
  }
}

/**
 * Load and inject an issue's detail block on first expand.
 * LIN-442: the dashboard ships collapsed lines only; the detail block
 * (description, metadata, comments shell, prompt/autopilot containers)
 * is fetched here from /api/detail and injected into the empty `.details`
 * wrapper. Mirrors loadComments; guards against double-fetch via data-loaded.
 * @param {HTMLElement} details - The lazy `.details` wrapper element
 */
async function loadDetails(details) {
  const issueId = details.dataset.detailsFor
  const urlKey = details.dataset.urlKey
  if (!issueId || !urlKey) return
  // 'loading' or 'true' — already fetched or in flight; don't refetch.
  if (details.dataset.loaded) return

  // Forward the wrapper's section so the rendered dispatch disclosure panel ids
  // are unique per render instance. The same issue can be expanded in two
  // sections at once (In Progress + project tree); without this the second
  // appearance's "Dispatch ▾" resolves to the first's panel (LIN-732).
  const section = details.dataset.section || ''
  // Forward the issue's own provenance too (LIN-1903), so the server can
  // resolve THIS issue's own binding in a merged multi-binding workspace
  // instead of always resolving the workspace's active provider. LIN-3240 adds
  // the binding stamp beside it (absent for an unstamped row).
  const source = details.dataset.source || ''
  const bindingScope = details.dataset.bindingScope || ''
  const params = new URLSearchParams()
  if (section) params.set('section', section)
  if (source) params.set('source', source)
  if (bindingScope) params.set('bindingScope', bindingScope)
  const query = params.toString()
  const detailQuery = query ? `?${query}` : ''

  details.dataset.loaded = 'loading'
  try {
    const data = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/detail/${encodeURIComponent(issueId)}${detailQuery}`)
    // Tear down any component mounted from a previous fragment before replacing
    // it (a retry after an earlier failure re-fetches this wrapper).
    destroyHomePromptSections(details)
    details.innerHTML = (data && data.html) || ''
    details.dataset.loaded = 'true'
    // The fetched fragment's dispatch panels (prompt/recommend/autopilot) need
    // the shared disclosures too — the initial page-load pass (LIN-1096) only
    // covers placeholders present in the static HTML (e.g. periodicals). The
    // client-side initDispatchDisclosures now renders full disclosures with exec
    // controls, replacing the old two-step render+inject pattern (LIN-1137).
    initDispatchDisclosures(details)
    // LIN-2944 P1: mount the shared opened-task component on the injected
    // fragment (Home's retired inline renderer is replaced by this one).
    mountHomePromptSections(details)
  } catch (error) {
    console.error('Failed to load detail:', error)
    details.innerHTML = '<div class="detail-line"><span class="detail-text">Failed to load details</span></div>'
    // Clear the flag so a later expand can retry.
    delete details.dataset.loaded
  }
}

/**
 * Mount the shared opened-task component (LIN-2944 P1) on Home's lazy detail
 * fragment. The server emits one `[data-prompt-mount]` placeholder per opened
 * task carrying its identity, provenance and per-render instance key; the
 * page-level options arrive once as `window.__HOME_PROMPT_OPTS__` (mirroring
 * Swipe's `__SWIPE_DATA__`). Home and Swipe therefore render the SAME component
 * from the SAME vocabulary — Home has no second opened-task renderer.
 * @param {ParentNode} [root=document] - Subtree to scan
 */
function mountHomePromptSections(root) {
  const page = window.__HOME_PROMPT_OPTS__
  if (!page || !window.PromptSection) return
  ;(root || document).querySelectorAll('[data-prompt-mount]').forEach((el) => {
    if (el.dataset.mounted) return
    const id = el.dataset.issueId
    if (!id) return
    const issue = {
      id,
      identifier: el.dataset.identifier || '',
      title: el.dataset.title || '',
      url: el.dataset.url || '',
      // LIN-1904/LIN-1910: thread the resolved provider so the template and
      // Autopilot fetches resolve THIS issue's own binding, exactly as before.
      source: el.dataset.source || undefined,
      // LIN-3240: carry the row's binding stamp so the component's fetches and
      // per-task memory resolve THIS issue's own binding in a multi-binding workspace.
      bindingScope: el.dataset.bindingScope || undefined
    }
    el.dataset.mounted = 'true'
    el._promptSectionHandle = window.PromptSection.init(el, {
      urlKey: el.dataset.urlKey || page.urlKey || undefined,
      issue,
      // LIN-2942: where the ladder press happened, carried on its mode record.
      surface: 'home',
      // LIN-2944 F3: only the ordering pipeline's front card advertises a
      // ranking reason; every other opened task renders no why line. N2: match on
      // the binding-aware node key, not the raw id.
      why: el.dataset.nodeKey === page.topTaskId ? (page.topTaskWhy || []) : [],
      hasAI: page.hasAI,
      aiState: page.aiState,
      freeTier: page.freeTier,
      promptButtons: page.promptButtons,
      hasAutopilot: page.hasAutopilot,
      dispatchEnabled: page.dispatchEnabled,
      proxyEnabled: page.proxyEnabled,
      isLocalhost: page.isLocalhost,
      customPrompts: page.customPrompts,
      defaultPromptKeys: page.defaultPromptKeys,
      morePromptKeys: page.morePromptKeys,
      promptMeta: page.promptMeta,
      // LIN-732: a caller-supplied dispatch-disclosure id prefix so the same
      // issue in In Progress AND its project tree gets disjoint panel ids.
      idPrefix: el.dataset.instanceKey || `home-${id}`
    })
    // LIN-2944 P1 R2: the marked top task's Prompts section opens by default, so
    // the Home flow is open the top row → ✦ next step → copy (3 clicks). Other
    // rows stay collapsed. The ✦ primary is still click-gated, so this spends
    // nothing.
    if (el.dataset.nodeKey === page.topTaskId) {
      expandPromptsSection(el)
    }
  })
}

/** Expand a detail fragment's Prompts disclosure (R2) without a click. */
function expandPromptsSection(mountEl) {
  const details = mountEl.closest('.details')
  const toggle = details?.querySelector('.detail-toggle[data-toggle="prompts"]')
  const content = details?.querySelector('.detail-content[data-content="prompts"]')
  if (!toggle || !content) return
  content.classList.remove('hidden')
  toggle.textContent = toggle.textContent.replace('\u25B6', '\u25BC')
}

/** Tear down any mounted opened-task component under `root` (before re-fetch). */
function destroyHomePromptSections(root) {
  ;(root || document).querySelectorAll('[data-prompt-mount]').forEach((el) => {
    if (el._promptSectionHandle && typeof el._promptSectionHandle.destroy === 'function') {
      el._promptSectionHandle.destroy()
    }
  })
}

/**
 * Fetch any lazy `.details` blocks that are actually visible and not yet loaded
 * (e.g. after restoring persisted expand state or re-expanding a project).
 * loadDetails itself guards against duplicate fetches.
 * @param {ParentNode} [root=document] - Subtree to scan
 */
function loadVisibleLazyDetails(root) {
  (root || document).querySelectorAll('.details[data-lazy]').forEach(details => {
    if (details.dataset.loaded) return
    if (details.classList.contains('hidden')) return
    // offsetParent === null ⇒ hidden by a collapsed ancestor (.node/.project).
    if (details.offsetParent === null) return
    loadDetails(details)
  })
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
    show(project.querySelector('.project-meta'))
    show(project.querySelector('.completed-toggle'))
    show(project.querySelector('.add-task-link'))
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
  state.hideCompleted = state.hideCompleted || []
  state.inProgressCollapsed = state.inProgressCollapsed || false
  state.recentActivityCollapsed = state.recentActivityCollapsed || false

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

    // LIN-566: keep aria-expanded in sync when restoring persisted state on load
    document.querySelectorAll(`[data-section="${section}"][data-id="${id}"].line[aria-expanded]`).forEach(row => {
      row.setAttribute('aria-expanded', 'true')
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
    const children = project.querySelectorAll('.node, .project-description, .project-meta, .completed-toggle, [data-completed-for], .add-task-link')
    children.forEach(hide)
  })

  // LIN-442: hydrate detail blocks for any items restored to an expanded,
  // visible state. Runs last so collapsed-project nodes (now hidden) are skipped.
  loadVisibleLazyDetails(document)
}

// Get default collapsed project IDs from HTML data attributes
function getDefaultCollapsedProjects() {
  const ids = []
  document.querySelectorAll('.project[data-default-collapsed="true"]').forEach(el => {
    ids.push(el.dataset.id)
  })
  return ids
}

// Union stored collapsed-project ids with the page's default-collapsed ones
// (LIN-2514). An empty project's default must override stale/absent stored
// state whenever state is (re)applied, since the storage key is global and
// not workspace-scoped — a first-load-only union would never reach a
// returning user carrying unrelated stored state. `storedIds` may be
// undefined/missing (legacy or partial `linear-projects-state` shapes).
function unionDefaultCollapsedProjects(storedIds) {
  return [...new Set([...(storedIds || []), ...getDefaultCollapsedProjects()])]
}

// Shared in-memory UI state, owned by init() but also reapplied by
// initSearch()'s clearSearchState() on a search round trip (LIN-2514 review
// F-A). Both must mutate/reassign this SAME object rather than a detached
// loadState() result, or the DOM (driven by whichever object applyState was
// last called with) and the state object toggleItem/handleProjectHeaderClick
// close over can disagree about a project's collapsed id, silently
// swallowing the next header click.
let state

function init() {
  const isLanding = document.body.classList.contains('is-landing')

  // On landing page, always use defaults (no persistence)
  // On authenticated page, load from localStorage
  if (isLanding) {
    state = getDefaultState()
    state.collapsedProjects = getDefaultCollapsedProjects()
  } else {
    state = loadState()
    // Empty-project defaults always win over restored state (union, not
    // replace), since a global localStorage key would otherwise permanently
    // block the default for any returning user (LIN-2514).
    state.collapsedProjects = unionDefaultCollapsedProjects(state.collapsedProjects)
  }

  // Wrap saveState to be a no-op on landing. Also strip default-derived
  // collapsed ids before writing (LIN-2514 review F2): state.collapsedProjects
  // is the union of stored + default ids, but a default is nothing the user
  // chose — persisting it would immortalize the default the moment any
  // unrelated toggle calls persistState, leaving a project collapsed with no
  // user intent once it later gains its first issue (the default itself
  // disappears then, since it's derived fresh from the page each load).
  const persistState = isLanding
    ? () => {}
    : (s) => {
        const defaults = getDefaultCollapsedProjects()
        saveState({ ...s, collapsedProjects: s.collapsedProjects.filter(id => !defaults.includes(id)) })
      }

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
      // LIN-442: fetch this node's (and any now-visible expanded descendants')
      // lazy detail blocks.
      loadVisibleLazyDetails(node)
    } else {
      if (details) hide(details)
      // Both sections can have children
      getDescendants(id, section).forEach(hide)
    }

    const toggle = line.querySelector('.toggle')
    if (toggle) toggle.textContent = nowExpanded ? '▼' : '▶'

    // LIN-566: aria-expanded is owned here so mouse click, arrow click, and
    // keyboard activation all announce the same state.
    if (line.hasAttribute('aria-expanded')) {
      line.setAttribute('aria-expanded', String(nowExpanded))
    }
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
      project.querySelectorAll('.node, .project-description, .project-meta, .completed-toggle, [data-completed-for], .add-task-link')
        .forEach(hide)
    } else {
      // Show project description, meta, and completed toggle
      show(project.querySelector('.project-description'))
      show(project.querySelector('.project-meta'))
      show(project.querySelector('.completed-toggle'))
      show(project.querySelector('.add-task-link'))

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

    // LIN-442: when a project is re-expanded, hydrate detail blocks for any of
    // its now-visible expanded nodes.
    if (!isCollapsed) loadVisibleLazyDetails(project)
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

        // LIN-652: Attachments gallery is server-rendered (images already point
        // at the /api/image relay with loading="lazy", so the bytes load when the
        // section becomes visible). On first expand we only wire per-image error
        // fallbacks — no fetch path of our own.
        if (toggleType === 'attachments' && !isHidden && !content.dataset.loaded) {
          initAttachmentImages(content)
        }

        // LIN-522: Lazy-mount the shared Brief / Recap / Sessions sections on
        // first expand (mirrors the swipe accordion's placeholder pattern).
        if (
          (toggleType === 'brief' || toggleType === 'recap' || toggleType === 'scan' || toggleType === 'context' || toggleType === 'sessions') &&
          !isHidden &&
          !content.dataset.loaded
        ) {
          loadLazySection(toggleType, detailToggle, content)
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

    // 4. Line click (expand issue details) - skip if clicking a link
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

  // LIN-566: keyboard activation for expandable rows. Mirrors the click
  // delegation above — Enter/Space on a focused .line.expandable (or its .toggle
  // arrow) routes through the same toggleItem path, so all input modalities stay
  // in sync. Space is prevented from scrolling the page.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return

    const row = e.target.closest('.line.expandable')
    if (!row) return
    // Let links and form controls inside the row handle their own keys.
    if (e.target.closest('a, button, input, textarea, select')) return

    e.preventDefault()
    toggleItem(row)
  })
}

// initNavBar() (workspace/team selectors) now lives in common.js so the
// switcher is interactive on every authenticated page — LIN-288.

// ==========================================================================
// Prompt Generation for Labels
// ==========================================================================

/**
 * Initialize the page-wide prompt handlers (copy / download / dispatch). These
 * still serve the periodical Mint, Mint + Autopilot and Setup Prompt containers
 * (LIN-2944 P1 F1); the opened-task surface is now the shared PromptSection.
 */
function initPrompts() {
  // Handle copy button clicks
  document.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.prompt-copy')
    if (!copyBtn) return

    e.preventDefault()
    e.stopPropagation()

    // LIN-191: Ignore clicks on disabled buttons
    if (copyBtn.disabled) return

    const promptContainer = copyBtn.closest('.prompt-container')
    const promptText = promptContainer?.querySelector('.prompt-text')
    if (!promptText) return

    // Use raw markdown from data attribute, fall back to textContent
    // Strip any backtick code fences the AI may have wrapped the prompt in
    let textToCopy = stripCodeBlockFences(promptText.dataset.rawPrompt || promptText.textContent)
    const urlKey = promptContainer.dataset.urlKey || promptContainer.closest('[data-url-key]')?.dataset.urlKey

    try {
      // Append the proxy block (if +proxy is on) inside the try so a failed
      // token mint surfaces as "failed" instead of silently copying a bare prompt.
      // LIN-3079: a container marked data-proxy-force (home/Autopilot, periodical
      // Mint+Autopilot) forces the append regardless of the +proxy toggle.
      const forceProxy = promptContainer.dataset.proxyForce === 'true'
      textToCopy = await maybeAppendProxyBlock(textToCopy, urlKey, { force: forceProxy })
      await navigator.clipboard.writeText(textToCopy)
      const originalText = copyBtn.textContent
      copyBtn.textContent = 'copied!'
      setTimeout(() => {
        copyBtn.textContent = originalText
      }, 1500)
    } catch (error) {
      console.error('Failed to copy:', error)
      // LIN-3136: say why (e.g. a driver copy refused for a non-owner), not just 'failed'.
      if (typeof window.toast === 'function') window.toast(error.message, { type: 'error' })
      copyBtn.textContent = 'failed'
      setTimeout(() => {
        copyBtn.textContent = 'copy'
      }, 1500)
    }
  })

  // Handle download button clicks — mirrors copy, but writes the prompt to a
  // .md file instead of the clipboard (LIN-316). Retro/epic prompts can exceed
  // clipboard practicality, so a download is the escape hatch. The file MUST
  // byte-match what copy yields, so we apply the same fence-strip + +proxy block.
  document.addEventListener('click', async (e) => {
    const downloadBtn = e.target.closest('.prompt-download')
    if (!downloadBtn) return

    e.preventDefault()
    e.stopPropagation()

    if (downloadBtn.disabled) return

    const promptContainer = downloadBtn.closest('.prompt-container')
    const promptText = promptContainer?.querySelector('.prompt-text')
    if (!promptText) return

    let textToDownload = stripCodeBlockFences(promptText.dataset.rawPrompt || promptText.textContent)
    const urlKey = promptContainer.dataset.urlKey || promptContainer.closest('[data-url-key]')?.dataset.urlKey
    const promptName = promptContainer.querySelector('.prompt-name')?.textContent || 'prompt'
    // Identifier lives on the issue's tree line, not the prompt container.
    const identifier = promptContainer.closest('.node')?.querySelector('.line')?.dataset.identifier || ''

    try {
      // Append the proxy block (if +proxy is on) inside the try so a failed
      // token mint surfaces as "failed" instead of silently saving a bare prompt.
      // LIN-3079: honour data-proxy-force (home/Autopilot, periodical
      // Mint+Autopilot) so the downloaded .md always carries the forced block.
      const forceProxy = promptContainer.dataset.proxyForce === 'true'
      textToDownload = await maybeAppendProxyBlock(textToDownload, urlKey, { force: forceProxy })
      downloadMarkdown(textToDownload, buildPromptFilename(identifier, promptName))
      const originalText = downloadBtn.textContent
      downloadBtn.textContent = 'saved!'
      setTimeout(() => {
        downloadBtn.textContent = originalText
      }, 1500)
    } catch (error) {
      console.error('Failed to download:', error)
      // LIN-3136: say why (e.g. a driver copy refused for a non-owner), not just 'failed'.
      if (typeof window.toast === 'function') window.toast(error.message, { type: 'error' })
      downloadBtn.textContent = 'failed'
      setTimeout(() => {
        downloadBtn.textContent = 'download'
      }, 1500)
    }
  })

  // Handle dispatch button clicks
  document.addEventListener('click', async (e) => {
    const dispatchBtn = e.target.closest('.prompt-dispatch')
    if (!dispatchBtn) return

    e.preventDefault()
    e.stopPropagation()

    // LIN-191: Ignore clicks on disabled buttons
    if (dispatchBtn.disabled) return

    const promptContainer = dispatchBtn.closest('.prompt-container')
    const promptText = promptContainer?.querySelector('.prompt-text')
    const promptNameEl = promptContainer?.querySelector('.prompt-name')
    if (!promptText) return

    // Get the prompt content, stripping any backtick code fences
    let prompt = stripCodeBlockFences(promptText.dataset.rawPrompt || promptText.textContent)
    const promptName = promptNameEl?.textContent || 'Prompt'

    // Read target from button's data-target attribute (defaults to 'cli')
    const target = dispatchBtn.dataset.target || 'cli'
    const originalLabel = dispatchBtn.textContent

    // Get issue ID and workspace URL key. The surviving page-wide containers
    // are the periodical Mint / Mint+Autopilot and Setup Prompt rows, which are
    // issue-less (`renderPromptContainer` emits no `data-prompt-for`), so a
    // missing id resolves to `issueless: true` below.
    const issueId = promptContainer.dataset.promptFor
    const urlKey = promptContainer.dataset.urlKey ||
      promptContainer.closest('[data-url-key]')?.dataset.urlKey

    if (!urlKey) {
      console.error('No workspace URL key found for dispatch')
      dispatchBtn.textContent = 'failed'
      setTimeout(() => { dispatchBtn.textContent = originalLabel }, 1500)
      return
    }

    // Get issue context from the DOM. The .line carries data-id and
    // data-identifier; the surrounding .node wrapper shares data-id, so query
    // the line specifically to read the identifier (the pipeline-loops join key).
    const lineEl = issueId ? document.querySelector(`.line[data-id="${issueId}"]`) : null
    const issueTitle = lineEl?.querySelector('.title, .title-dim')?.textContent || null
    const issueIdentifier = lineEl?.dataset.identifier || null

    // Get repo from prompt/recommend container (set by prompt API response)
    const repo = promptContainer.dataset.repo || null
    // Explicit kind for meta-loops (e.g. Autopilot) — set on the container by
    // its fetch handler; absent for ordinary prompts, where the server derives
    // kind from promptName.
    const kind = promptContainer.dataset.kind || undefined
    // Periodical-template join key (LIN-1825): set on the container by
    // renderPeriodicalNode's data-periodical-id, absent for ordinary prompts.
    const periodicalId = promptContainer.dataset.periodicalId || undefined

    // LIN-1279: surfaces whose prompt REQUIRES workspace-API proxy context (the
    // Mint + Autopilot periodical variant, whose tail calls the kickoff endpoint)
    // mark their container with data-proxy-force. It forces attachProxy on regardless
    // of the +proxy toggle, so the dispatched agent always receives a proxy token.
    const proxyForce = promptContainer.dataset.proxyForce === 'true'

    // LIN-345: some rows that share this handler are issue-less by design — the
    // synthetic Periodicals group (kind=periodical) dispatches a template prompt
    // with no Linear issue behind it, so no data-prompt-for / data-identifier is
    // present and issueId resolves to undefined. Opt out of the issue-link
    // contract explicitly (mirroring the custom-prompt page) rather than passing
    // an `issue` object full of null fields, which dispatchPrompt rejects.
    const issueless = !issueId

    try {
      dispatchBtn.textContent = 'sending...'

      // Proxy-context appending is now handled internally by dispatchPrompt()
      // (LIN-1137). The exec controls still live in the dispatch options panel.

      const { model, harness } = window.readDispatchExecControls(dispatchBtn.closest('.prompt-options'))

      await dispatchPrompt({
        urlKey,
        prompt,
        promptName,
        ...(issueless
          ? { issueless: true }
          : { issue: { id: issueId, identifier: issueIdentifier, title: issueTitle } }),
        target,
        repo: repo || undefined,
        kind,
        periodicalId,
        model,
        harness,
        proxyForce
      })

      dispatchBtn.textContent = 'dispatched!'
      dispatchBtn.classList.add('dispatched')

      setTimeout(() => {
        dispatchBtn.textContent = originalLabel
        dispatchBtn.classList.remove('dispatched')
      }, 1500)
    } catch (error) {
      console.error('Failed to dispatch:', error)
      // LIN-3136: say why (e.g. a driver copy refused for a non-owner), not just 'failed'.
      if (typeof window.toast === 'function') window.toast(error.message, { type: 'error' })
      dispatchBtn.textContent = 'failed'
      setTimeout(() => {
        dispatchBtn.textContent = originalLabel
      }, 1500)
    }
  })
}

// =============================================================================
// Dispatch Disclosure Initialization — LIN-1137
// =============================================================================
//
// The server formerly rendered dispatch toggle + target buttons inline, then
// initDispatchExecControls injected model/harness controls separately — a
// fragile two-step pattern. Now the server emits placeholder divs
// (.dispatch-disclosure-placeholder), and this function scans them and injects
// the shared window.renderDispatchDisclosure() output, which composes the full
// disclosure (toggle, exec controls, and target buttons) in one call.
// Replaces the old initDispatchExecControls() (LIN-1096).

/**
 * Scans `.dispatch-disclosure-placeholder` elements under `root` and replaces
 * each with window.renderDispatchDisclosure() output. Re-running is safe:
 * placeholders are replaced, so subsequent passes find nothing to do.
 *
 * Periodical rows render their placeholders eagerly in the static HTML, so the
 * initial document-wide pass at load covers those. Every other issue's detail
 * block (including its prompt/recommend/autopilot dispatch panels) is fetched
 * lazily on first expand (LIN-442) — loadDetails() re-runs this scoped to the
 * freshly injected `.details` subtree.
 *
 * @param {ParentNode} [root=document] - Subtree to scan
 */
function initDispatchDisclosures(root) {
  (root || document).querySelectorAll('.dispatch-disclosure-placeholder').forEach((placeholder) => {
    const idPrefix = placeholder.dataset.disclosurePrefix;
    const isLocalhost = placeholder.dataset.localhost === 'true';
    placeholder.insertAdjacentHTML('afterend', window.renderDispatchDisclosure({ idPrefix, isLocalhost }));
    placeholder.remove();
  });
}

// =============================================================================
// Queue Badge Management
// =============================================================================

/**
 * Update the queue badge count for a workspace
 */
async function updateQueueBadge(urlKey) {
  try {
    // Deliberately raw fetch (NOT window.api): this is a 1s background poller that
    // must silently swallow failures — it must never redirect to /logout or toast
    // on a transient error. (api() carve-out: pollers stay on raw fetch.)
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
    const { items } = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch`)
    renderQueueItems(panel, items, urlKey)
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

  // Shared row markup (LIN-1244): the nav-badge popover and the /dispatch Queue
  // list render identical `.queue-item*` rows via window.renderQueueRow so the
  // two twin renderers cannot drift. The popover omits the `.card` wrapper.
  container.innerHTML = items.map(item => window.renderQueueRow(item, urlKey)).join('')
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
    await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      toastOnError: true
    })

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
      // on401:false — auth failures fall through to the catch (which redirects
      // to /logout for both 401 and 403); other non-2xx/network errors fall back
      // to a full form POST so the server can render the error.
      const data = await window.api(form.action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams(new FormData(form)),
        on401: false
      })

      // Server returns JSON for AJAX requests: { ok, feature, enabled }
      if (!data || !data.ok) {
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
        // Map each parent feature to the children container it controls.
        const childSelector = {
          codeReview: '.children.code-review-options',
          feedbackWidget: '.children.feedback-widget-options'
        }[featureLine.dataset.feature]
        if (childSelector) {
          const childrenDiv = nodeDiv.querySelector(childSelector)
          if (childrenDiv) childrenDiv.hidden = !data.enabled
        }
      }
    } catch (err) {
      // Auth failure — redirect to re-authenticate (covers 401 and 403).
      if (err.status === 401 || err.status === 403) {
        window.location.href = '/logout'
        return
      }
      // Validation / server / network error — fall back to standard form POST.
      console.warn('Feature toggle AJAX failed, falling back to form POST:', err)
      form.submit()
    } finally {
      btn.disabled = false
    }
  })
}

// ==========================================================================
// Footer AI status helpers
// ==========================================================================

/**
 * Fill the footer model indicator with the workspace's configured LLM model.
 * @param {string} modelName - Friendly model name (e.g. 'GPT-5.4 Mini')
 */
function updateFooterModel(modelName) {
  const el = document.querySelector('[data-ai-model]')
  if (!el || !modelName) return
  el.textContent = modelName
  el.title = `Workspace model: ${modelName}`
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
    // LIN-2514: fold in default-collapsed empty projects the same way init()
    // does — raw loadState() alone would leave an empty project rendered
    // expanded (▼) with its children still hidden by the collapse logic below.
    // Review F-A: reassign the SAME `state` object init() owns (module-scope,
    // shared with toggleItem/handleProjectHeaderClick) rather than a detached
    // loadState() result — otherwise the DOM this applyState call paints and
    // the in-memory state a subsequent header click reads from disagree about
    // whether the project is collapsed, swallowing that first click.
    state = loadState()
    state.collapsedProjects = unionDefaultCollapsedProjects(state.collapsedProjects)
    applyState(state)
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

// Cleanup polling on page unload. Rulings-badge cleanup registers itself
// from common.js now, alongside its own init (LIN-1728 review F7).
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
 * Initialize footer AI status on page load.
 * Fetches the recommend/status endpoint for the workspace's configured model
 * name, and (when the settings usage slot is present) S1's own-counts run-quota
 * endpoint for the free tier's runs-per-day allowance (LIN-3239). The retired
 * daily prompt quota is never shown.
 */
async function initFreeTierStatus() {
  // Check for any element the status fetch can populate
  const settingsUsage = document.querySelector('[data-free-tier-usage]')
  const modelEl = document.querySelector('[data-ai-model]')
  if (!settingsUsage && !modelEl) return

  // Get urlKey from footer link or current page URL
  let urlKey = getUrlKeyFromFooter()
  if (!urlKey) {
    const pathMatch = window.location.pathname.match(/\/workspace\/([^/]+)/)
    urlKey = pathMatch ? pathMatch[1] : null
  }
  if (!urlKey) return

  // on401:false — a background status fetch must not bounce the page to /logout.
  try {
    const data = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/recommend/status`, { on401: false })
    if (data && data.modelName) updateFooterModel(data.modelName)
  } catch (e) {
    // Silently fail - the model indicator shows its default
  }

  if (!settingsUsage) return
  try {
    // LIN-3239: the allowance is runs per account per UTC day, read from the
    // session account's own quota (never instance-wide). `limited:false` (not
    // free tier, or no attributable account) means no daily run cap.
    const quota = await window.api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/quota`, { on401: false })
    if (quota && quota.limited && quota.runsUsed != null
      && typeof quota.remaining === 'number' && typeof quota.limit === 'number') {
      settingsUsage.textContent = `${quota.remaining} of ${quota.limit} runs left today`
    } else {
      settingsUsage.textContent = 'No daily run limit'
    }
  } catch (e) {
    settingsUsage.textContent = 'Unable to load usage'
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init()
  // initNavBar() runs from common.js's DOMContentLoaded handler (LIN-288);
  // initRulingsBadge() runs from there too now (LIN-1728 review F7)
  initSearch()
  initPrompts()
  initDispatchDisclosures()
  initQueuePanel()
  initFeatureToggles()
  initFreeTierStatus()
  // +proxy toggle is wired by window.ProxyToggle.init() in common.js (LIN-525)
})
