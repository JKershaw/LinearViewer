/**
 * Dispatch Page Client-Side Logic
 *
 * Handles all dispatch page interactions:
 * - Custom prompt dispatcher (textarea + dispatch buttons)
 * - Queue list (live list of active items with auto-refresh)
 * - Token management (create, list, revoke)
 * - Dispatch history (paginated resolved items)
 *
 * Loaded only on the /dispatch page. Requires common.js and app.js to be loaded first
 * (provides escapeHtml() and updateQueueBadge()).
 */

const UUID_DISPATCH_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Queue list polling state
let queueListPollId = null
const QUEUE_LIST_POLL_MS = 3000

// =============================================================================
// Dispatch Prompt
// =============================================================================

/**
 * Format prompt text with slash command highlighting.
 * Detects /command at the start and wraps it in a styled span.
 */
function formatPromptHtml(text) {
  const match = text.match(/^(\/\S+)(.*)$/s)
  if (match) {
    return `<span class="slash-command">${escapeHtml(match[1])}</span>${escapeHtml(match[2])}`
  }
  return escapeHtml(text)
}

/**
 * Fetch the current favourite prompts as a Set of exact strings (LIN-1011).
 * Used to reflect the ⭐ toggle state on Recent items. Non-fatal: an empty Set
 * on failure just renders every star as un-favourited.
 */
async function fetchFavoritePromptSet(urlKey) {
  try {
    // on401:false — the recents render owns the 401→/logout redirect; this
    // companion fetch must not double-bounce.
    const data = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/favorite-prompts`, { on401: false })
    return new Set((data && data.prompts) || [])
  } catch (e) {
    return new Set()
  }
}

/**
 * Render recent custom prompts into a container element.
 *
 * Each item carries a ⭐ toggle (LIN-1011) reflecting whether that exact string
 * is already favourited. The favourite set is fetched here when not supplied so
 * existing single-arg callers (e.g. the post-dispatch refresh) keep working.
 */
async function renderDispatchRecentPrompts(container, urlKey, favoriteSet = null) {
  if (!container) return

  try {
    // Default on401 — preserves this call's existing 401→/logout redirect.
    const data = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/recent-prompts`)
    const prompts = data && data.prompts
    if (!prompts || prompts.length === 0) {
      container.innerHTML = ''
      return
    }

    const favorites = favoriteSet || await fetchFavoritePromptSet(urlKey)

    container.innerHTML = `
      <div class="queue-recents-label">Recent:</div>
      <div class="queue-recents-list">
        ${prompts.map(p => {
          const isFav = favorites.has(p)
          // The star sits INSIDE the recent item; the delegated handler matches
          // it first and returns early so a star click doesn't also refill.
          const star = `<button class="queue-recent-star${isFav ? ' is-favorite' : ''}" data-prompt="${escapeHtml(p)}" title="${isFav ? 'Remove from favourites' : 'Save to favourites'}" aria-label="${isFav ? 'Remove from favourites' : 'Save to favourites'}" aria-pressed="${isFav}">${isFav ? '★' : '☆'}</button>`
          return `<button class="queue-recent-item" data-prompt="${escapeHtml(p)}">${star}<span class="queue-recent-text">${formatPromptHtml(p)}</span></button>`
        }).join('')}
      </div>
    `
  } catch (e) {
    // Non-fatal: just don't show recents
  }
}

/**
 * Render the durable favourites list into a container element (LIN-1011).
 *
 * A curated list that survives the recents roll-off. Each item refills the
 * textarea on click (like a recent item) and carries a ✕ un-star affordance.
 * The list is fetched here when not supplied.
 */
async function renderDispatchFavoritePrompts(container, urlKey, prompts = null) {
  if (!container) return

  try {
    if (!prompts) {
      // on401:false — the recents render owns the redirect on this page.
      const data = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/favorite-prompts`, { on401: false })
      prompts = (data && data.prompts) || []
    }
    if (!prompts || prompts.length === 0) {
      container.innerHTML = ''
      return
    }

    container.innerHTML = `
      <div class="queue-recents-label">Favourites:</div>
      <div class="queue-recents-list">
        ${prompts.map(p => {
          // The ✕ sits INSIDE the favourite item; the delegated handler matches
          // it first and returns early so a remove click doesn't also refill.
          const remove = `<button class="queue-favorite-remove" data-prompt="${escapeHtml(p)}" title="Remove from favourites" aria-label="Remove from favourites">✕</button>`
          return `<button class="queue-favorite-item" data-prompt="${escapeHtml(p)}">${remove}<span class="queue-recent-text">${formatPromptHtml(p)}</span></button>`
        }).join('')}
      </div>
    `
  } catch (e) {
    // Non-fatal: just don't show favourites
  }
}

/**
 * Refresh both the Favourites and Recent lists together (LIN-1011).
 *
 * Favourite membership drives the ⭐ state on Recent items, so the two lists
 * must re-render as a pair after any favourite mutation. Fetches the favourite
 * set once and threads it into the recents render to avoid a double fetch.
 */
async function refreshDispatchPromptLists(favoritesContainer, recentsContainer, urlKey) {
  const favoriteSet = await fetchFavoritePromptSet(urlKey)
  await renderDispatchFavoritePrompts(favoritesContainer, urlKey, [...favoriteSet])
  await renderDispatchRecentPrompts(recentsContainer, urlKey, favoriteSet)
}

/**
 * Dispatch a custom prompt and update UI feedback
 */
async function dispatchPageCustomPrompt({ urlKey, prompt, target, repo, kind, promptName, btn, textarea, feedbackEl, recentsContainer, execScope, presetScope }) {
  const originalText = btn.textContent
  btn.textContent = 'sending...'
  btn.disabled = true

  try {
    // Proxy-context appending is now handled internally by dispatchPrompt()
    // (LIN-1137). The dispatch.js `typeof maybeAppendProxyBlock` guard and the
    // separate append call are no longer needed.

    const { model, harness } = window.readDispatchExecControls(execScope)
    const presetId = readDispatchPresetPicker(presetScope)

    // Custom prompts are not anchored to a Linear issue — opt out of the
    // issue-link contract explicitly. A loaded Autopilot kickoff carries an
    // explicit kind ('autopilot') and name so it's tagged as the meta-loop.
    await dispatchPrompt({
      urlKey,
      prompt,
      promptName: promptName || 'Custom',
      kind: kind || undefined,
      target,
      repo: repo || undefined,
      issueless: true,
      model,
      harness,
      presetId
    })

    btn.textContent = 'dispatched!'
    if (feedbackEl) {
      feedbackEl.textContent = ''
      feedbackEl.className = 'dispatch-prompt-feedback'
    }

    // Save to recent prompts, then refresh recents list
    // on401:false — a background best-effort save must not bounce the page to /logout.
    try {
      await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/recent-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        on401: false
      })
    } catch (e) {
      // Best-effort
    }

    // Clear textarea
    if (textarea) textarea.value = ''

    // Refresh recents
    if (recentsContainer) {
      renderDispatchRecentPrompts(recentsContainer, urlKey)
    }

    // Update badge and queue list
    if (typeof updateQueueBadge === 'function') updateQueueBadge(urlKey)
    refreshQueueList(urlKey)
  } catch (e) {
    if (e && e.status === 401) {
      window.location.href = '/logout'
      return
    }
    console.error('Failed to dispatch custom prompt:', e)
    btn.textContent = 'failed'
    if (feedbackEl) {
      feedbackEl.textContent = 'dispatch failed'
      feedbackEl.className = 'dispatch-prompt-feedback error'
    }
  }

  setTimeout(() => {
    if (btn.isConnected) {
      btn.textContent = originalText
      btn.disabled = false
    }
  }, 1500)
}

// =============================================================================
// Preset Picker (LIN-1391 S9)
// =============================================================================

/**
 * Fetch the workspace's saved dispatch presets and render a `<select>` picker
 * into the given container. Non-fatal on failure: an empty/failed fetch just
 * leaves the picker with only the "— none —" option, same as an empty preset
 * list — Settings (LIN-1391 S7) is where presets are actually managed.
 */
async function loadDispatchPresetPicker(container) {
  const urlKey = container.dataset.urlKey
  let presets = []
  try {
    // on401:false — this is a background enrichment fetch on a page whose
    // primary content already loaded; it must not bounce the page to /logout.
    const data = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/presets`, { on401: false })
    presets = (data && data.presets) || []
  } catch (e) {
    // Non-fatal: picker just offers "none"
  }

  const optionsHtml = presets.map(p =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
  ).join('')
  container.innerHTML = `<select class="dispatch-preset-select" aria-label="Preset">
    <option value="">&mdash; none &mdash;</option>
    ${optionsHtml}
  </select>`
}

/**
 * Read the selected preset id back out of a preset-picker container (or the
 * select itself). Blank selection reads back `undefined` (never sent), same
 * blank-omitted contract as readDispatchExecControls' model field.
 */
function readDispatchPresetPicker(scopeEl) {
  if (!scopeEl) return undefined
  const select = scopeEl.matches && scopeEl.matches('.dispatch-preset-select')
    ? scopeEl
    : scopeEl.querySelector && scopeEl.querySelector('.dispatch-preset-select')
  return (select && select.value) || undefined
}

/**
 * Initialize dispatch prompt on dispatch page.
 */
function initDispatchPagePrompt() {
  const textarea = document.querySelector('.dispatch-prompt-input')
  if (!textarea) return

  if (textarea.dataset.initialized) return
  textarea.dataset.initialized = 'true'

  const urlKey = textarea.dataset.urlKey
  const section = textarea.closest('.dispatch-section')
  const recentsContainer = section.querySelector('.dispatch-recents-container')
  const favoritesContainer = section.querySelector('.dispatch-favorites-container')
  const feedbackEl = section.querySelector('.dispatch-prompt-feedback')
  const repoSelect = section.querySelector('.dispatch-repo-select')
  const goalInput = section.querySelector('.dispatch-autopilot-goal')

  // Inject the shared model/harness exec controls (LIN-1096) into the
  // server-rendered placeholder container, using the resolved workspace
  // default (if any) as a UX-only placeholder hint (LIN-1094).
  const execContainer = section.querySelector('.dispatch-exec-controls-container')
  if (execContainer) {
    const defaultModel = execContainer.dataset.defaultModel || ''
    const defaultHarness = execContainer.dataset.defaultHarness || ''
    execContainer.innerHTML = window.renderDispatchExecControls('dispatch-page', {
      modelPlaceholder: defaultModel ? `model (default: ${defaultModel})` : 'model',
      harnessDefault: defaultHarness || undefined
    })
  }

  // Inject the preset picker (LIN-1391 S9) into its server-rendered placeholder,
  // alongside the exec controls above. A selected preset's id rides the
  // dispatch POST as `presetId` (routes/dispatch.js already resolves it,
  // LIN-1390 S6); routing/precedence itself is not this page's concern.
  const presetContainer = section.querySelector('.dispatch-preset-picker-container')
  if (presetContainer) {
    loadDispatchPresetPicker(presetContainer)
  }

  // Load favourites + recent prompts (favourite membership drives the ⭐ state
  // on recent items, so render them as a pair) — LIN-1011.
  refreshDispatchPromptLists(favoritesContainer, recentsContainer, urlKey)

  // Prefill the goal from ?goal= so the experimental "next run" page can hand off
  // a chosen goal paragraph to the existing launch path (LIN-603). Empty/absent
  // means "continue until stopped" — no prefill needed.
  if (goalInput) {
    try {
      const goalParam = new URLSearchParams(window.location.search).get('goal')
      if (goalParam) goalInput.value = goalParam.slice(0, 1000)
    } catch (e) {
      // Non-fatal: just don't prefill
    }
  }

  // Fetch the general (stack-walk) Autopilot kickoff and drop it into the
  // textarea, tagged so the next dispatch carries kind=autopilot. A free-text
  // goal (optional, paragraphs fine) focuses the run; an empty goal is the
  // "continue until stopped" open-ended walk. Shared by both the "load Autopilot"
  // and "continue until stopped" buttons (LIN-603).
  // Fetch the general (stack-walk) kickoff for the current goal and drop it
  // into the textarea, tagged so the next dispatch carries kind=autopilot.
  // Button-free so it can be reused both by the buttons (via
  // loadAutopilotKickoff) and the goal-handoff dispatch path (LIN-639), where
  // the send button owns its own state. Throws on fetch failure for the caller
  // to surface.
  async function fillAutopilotKickoff({ forceNoGoal = false, variant = null } = {}) {
    if (forceNoGoal && goalInput) goalInput.value = ''
    // The goal must be baked into the fetched prompt — the textarea's input
    // listener strips dataset.kind/promptName on any keystroke, so it can't be
    // hand-typed in after loading. Append it as ?goal= for buildAutopilotKickoff.
    const goal = goalInput ? goalInput.value.trim() : ''
    const data = await window.fetchAutopilotKickoff({
      urlKey,
      goal: goal || undefined,
      variant: variant || undefined,
      on401: false
    })
    textarea.value = data.prompt
    textarea.dataset.kind = data.kind || 'autopilot'
    textarea.dataset.promptName = data.promptName || 'Autopilot (stack walk)'
  }

  async function loadAutopilotKickoff(btn, { forceNoGoal = false, variant = null } = {}) {
    const original = btn.textContent
    btn.disabled = true
    btn.textContent = 'loading...'
    try {
      await fillAutopilotKickoff({ forceNoGoal, variant })
      textarea.focus()
      btn.textContent = 'loaded ✓'
    } catch (err) {
      btn.textContent = 'failed'
      if (feedbackEl) {
        feedbackEl.textContent = `autopilot load failed: ${err.message}`
        feedbackEl.className = 'dispatch-prompt-feedback error'
      }
    } finally {
      setTimeout(() => {
        if (btn.isConnected) { btn.textContent = original; btn.disabled = false }
      }, 1500)
    }
  }

  // A loaded Autopilot kickoff tags the next dispatch as kind='autopilot'. Any
  // hand-typing afterwards reverts it to a plain custom prompt — the kind is a
  // property of "this is the generated kickoff", not of edited freeform text.
  textarea.addEventListener('input', () => {
    delete textarea.dataset.kind
    delete textarea.dataset.promptName
  })

  // Single delegated handler on the dispatch section
  section.addEventListener('click', async (e) => {
    // Handle proxy toggle clicks (window.ProxyToggle in common.js handles these
    // via document delegation; bail here so this section's other handlers don't fire)
    if (e.target.closest('.prompt-proxy-toggle')) return

    // Handle "load Autopilot" clicks: fetch the general (stack-walk) kickoff,
    // focused by the (optional, paragraph-friendly) goal field, and drop it into
    // the textarea tagged so the next dispatch carries kind=autopilot.
    const loadBtn = e.target.closest('.dispatch-load-autopilot')
    if (loadBtn) {
      e.preventDefault()
      // LIN-836: the stepper sibling carries data-variant="stepper"; classic has none.
      await loadAutopilotKickoff(loadBtn, { variant: loadBtn.dataset.variant || null })
      return
    }

    // Handle "continue until stopped" clicks: the explicit empty-goal affordance.
    // Clears any typed goal and loads the open-ended stack-walk kickoff (LIN-603).
    const continueBtn = e.target.closest('.dispatch-continue-until-stopped')
    if (continueBtn) {
      e.preventDefault()
      await loadAutopilotKickoff(continueBtn, { forceNoGoal: true })
      return
    }

    // Handle dispatch button clicks
    const btn = e.target.closest('.dispatch-prompt-send')
    if (btn) {
      e.preventDefault()
      let prompt = textarea.value.trim()

      // Goal-handoff launch (LIN-639): when the prompt is empty but a goal is
      // set — e.g. arriving via the next-run ?goal= handoff (LIN-603) — the
      // user expects dispatching to launch with that goal, not to be rejected
      // with the misleading "prompt is empty". Bake the goal into an Autopilot
      // kickoff transparently (the same prompt "load Autopilot" would produce),
      // then dispatch it.
      const goal = goalInput ? goalInput.value.trim() : ''
      if (!prompt && goal) {
        try {
          await fillAutopilotKickoff()
          prompt = textarea.value.trim()
        } catch (err) {
          if (feedbackEl) {
            feedbackEl.textContent = `autopilot load failed: ${err.message}`
            feedbackEl.className = 'dispatch-prompt-feedback error'
          }
          return
        }
      }

      if (!prompt) {
        if (feedbackEl) {
          // A goal field (proxy-gated) means either a prompt or a goal is a
          // valid input, so say so rather than naming only the prompt.
          feedbackEl.textContent = goalInput ? 'enter a prompt or a goal' : 'prompt is empty'
          feedbackEl.className = 'dispatch-prompt-feedback error'
          setTimeout(() => { feedbackEl.textContent = '' }, 1500)
        }
        return
      }

      const target = btn.dataset.target || 'cli'
      const repo = repoSelect ? repoSelect.value : ''
      // A loaded Autopilot kickoff sets these; hand-typed prompts leave them undefined.
      const kind = textarea.dataset.kind || undefined
      const promptName = textarea.dataset.promptName || undefined
      await dispatchPageCustomPrompt({ urlKey, prompt, target, repo, kind, promptName, btn, textarea, feedbackEl, recentsContainer, execScope: execContainer, presetScope: presetContainer })
      return
    }

    // LIN-1011: favourite ⭐ toggle on a recent item. Matched BEFORE the parent
    // recent-item refill so a star click toggles the favourite instead of
    // refilling the textarea. Toggle by current state, then re-render both lists.
    const star = e.target.closest('.queue-recent-star')
    if (star) {
      e.preventDefault()
      e.stopPropagation()
      const prompt = star.dataset.prompt
      if (prompt) {
        const isFav = star.classList.contains('is-favorite')
        try {
          await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/favorite-prompts`, {
            method: isFav ? 'DELETE' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            on401: false
          })
        } catch (err) {
          // Best-effort; a failed toggle just leaves the lists as they were.
        }
        await refreshDispatchPromptLists(favoritesContainer, recentsContainer, urlKey)
      }
      return
    }

    // LIN-1011: ✕ un-star on a favourite item. Matched BEFORE the parent
    // favourite-item refill so a remove click doesn't also refill the textarea.
    const favRemove = e.target.closest('.queue-favorite-remove')
    if (favRemove) {
      e.preventDefault()
      e.stopPropagation()
      const prompt = favRemove.dataset.prompt
      if (prompt) {
        try {
          await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/favorite-prompts`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            on401: false
          })
        } catch (err) {
          // Best-effort
        }
        await refreshDispatchPromptLists(favoritesContainer, recentsContainer, urlKey)
      }
      return
    }

    // LIN-1011: clicking a favourite refills the textarea (same as a recent
    // item). The input listener strips dataset.kind, so it behaves as a
    // hand-typed custom prompt — correct for scope A.
    const favItem = e.target.closest('.dispatch-favorites-container .queue-favorite-item')
    if (favItem) {
      e.preventDefault()
      const prompt = favItem.dataset.prompt
      if (prompt) {
        textarea.value = prompt
        textarea.focus()
      }
      return
    }

    // Handle recent prompt clicks
    const item = e.target.closest('.dispatch-recents-container .queue-recent-item')
    if (item) {
      e.preventDefault()
      const prompt = item.dataset.prompt
      if (prompt) {
        textarea.value = prompt
        textarea.focus()
      }
    }
  })
}

/**
 * Initialize the Dispatch options disclosure on the dispatch page.
 *
 * Mirrors the navbar disclosure convention (state owned by the trigger via
 * aria-expanded + a .hidden panel; close on outside-click and Esc) but is
 * self-contained — it does not touch the delegated .dispatch-prompt-send
 * handler in initDispatchPagePrompt().
 *
 * Note: the panel sits inside .dispatch-section, which owns the delegated send
 * handler, so we must NOT stopPropagation on panel clicks (that would prevent
 * the send handler from firing). Instead, the outside-click listener uses a
 * contains() guard to leave in-panel clicks alone.
 */
function initDispatchToggle() {
  const toggle = document.querySelector('.dispatch-toggle')
  const panel = document.getElementById('dispatch-options')
  if (!toggle || !panel) return

  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true'

  function closePanel() {
    toggle.setAttribute('aria-expanded', 'false')
    panel.classList.add('hidden')
  }

  function openPanel() {
    toggle.setAttribute('aria-expanded', 'true')
    panel.classList.remove('hidden')
  }

  toggle.addEventListener('click', () => {
    if (isOpen()) closePanel()
    else openPanel()
  })

  // Close on outside-click. Guard with contains() rather than stopPropagation
  // so clicks on option buttons still reach the delegated send handler.
  document.addEventListener('click', (e) => {
    if (!isOpen()) return
    if (toggle.contains(e.target) || panel.contains(e.target)) return
    closePanel()
  })

  // Close on Esc and return focus to the trigger.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      closePanel()
      toggle.focus()
    }
  })
}

// =============================================================================
// Queue List
// =============================================================================

/**
 * Fetch and render the queue list
 */
async function refreshQueueList(urlKey) {
  const container = document.querySelector('.queue-list')
  if (!container) return

  try {
    // on401:false — this 3s poll surfaces failure inline (empty state below);
    // a transient 401 must not bounce the page to /logout mid-poll.
    const { items } = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch`, { on401: false })
    renderDispatchQueueList(container, items, urlKey)
  } catch (e) {
    console.error('Failed to load queue items:', e)
    container.innerHTML = '<div class="queue-list-empty">Failed to load queue</div>'
  }
}

/**
 * Render queue items in the list section
 */
function renderDispatchQueueList(container, items, urlKey) {
  if (items.length === 0) {
    container.innerHTML = '<div class="queue-list-empty">Queue is empty</div>'
    return
  }

  // Shared row markup (LIN-1244): identical `.queue-item*` rows to the nav-badge
  // popover (app.js) via window.renderQueueRow, so the twins stay in lockstep.
  // `card:true` keeps the /dispatch list's `.card` wrapper.
  container.innerHTML = items.map(item => window.renderQueueRow(item, urlKey, { card: true })).join('')
}

/**
 * Remove a queue item from the dispatch page queue list
 */
async function removeQueueListItem(urlKey, itemId) {
  if (!itemId || !UUID_DISPATCH_REGEX.test(itemId)) {
    console.error('Invalid itemId format')
    return
  }

  try {
    // toastOnError:true + default on401 — mirrors the dashboard's removeQueueItem
    // (app.js); a removal that previously only console.error'd now surfaces.
    await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      toastOnError: true
    })

    // Remove item from DOM
    document.querySelector(`.queue-list .queue-item[data-item-id="${itemId}"]`)?.remove()

    // Update badge
    if (typeof updateQueueBadge === 'function') updateQueueBadge(urlKey)

    // Check if queue is now empty
    const container = document.querySelector('.queue-list')
    if (container && container.querySelectorAll('.queue-item').length === 0) {
      container.innerHTML = '<div class="queue-list-empty">Queue is empty</div>'
    }
  } catch (e) {
    console.error('Failed to remove queue item:', e)
  }
}

/**
 * Initialize queue list with auto-refresh
 */
function initQueueList() {
  const container = document.querySelector('.queue-list')
  if (!container) return

  const urlKey = container.dataset.urlKey
  refreshQueueList(urlKey)

  // Start polling for queue updates
  queueListPollId = setInterval(() => {
    if (!document.hidden) {
      refreshQueueList(urlKey)
    }
  }, QUEUE_LIST_POLL_MS)

  // Handle remove button clicks (delegated)
  container.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('.queue-item-remove')
    if (!removeBtn) return

    e.preventDefault()
    e.stopPropagation()

    const itemId = removeBtn.dataset.itemId
    const itemUrlKey = removeBtn.dataset.urlKey
    await removeQueueListItem(itemUrlKey, itemId)
  })
}

// =============================================================================
// Token Management
// =============================================================================

/**
 * Load and display token list
 */
async function loadDispatchTokenList(urlKey) {
  const listEl = document.querySelector('.token-list')
  if (!listEl) return

  try {
    // on401:false — consistent with the token CRUD calls (no redirect); failure
    // surfaces on the inline empty state below.
    const { tokens } = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/tokens`, { on401: false })
    renderDispatchTokenList(listEl, tokens, urlKey)
  } catch (e) {
    console.error('Failed to load tokens:', e)
    listEl.innerHTML = '<div class="token-list-empty">Failed to load tokens</div>'
  }
}

/**
 * Render token list in container
 */
function renderDispatchTokenList(container, tokens, urlKey) {
  if (tokens.length === 0) {
    container.innerHTML = '<div class="token-list-empty">No tokens yet</div>'
    return
  }

  container.innerHTML = tokens.map(t => {
    const created = new Date(t.createdAt).toLocaleDateString()
    const lastUsed = t.lastUsedAt
      ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
      : 'never used'

    return `
      <div class="card token-item" data-token-id="${escapeHtml(t.tokenId)}">
        <div class="token-info">
          <span class="token-label-text">${escapeHtml(t.label)}</span>
          <div class="token-meta">created ${created} · ${lastUsed}</div>
        </div>
        <button class="action-btn token-revoke" data-token-id="${escapeHtml(t.tokenId)}">revoke</button>
      </div>
    `
  }).join('')
}

/**
 * Create a new dispatch token
 */
async function createDispatchToken(urlKey, label) {
  const submitBtn = document.querySelector('#create-token-form button[type="submit"]')
  const originalText = submitBtn?.textContent

  try {
    if (submitBtn) submitBtn.textContent = 'creating...'

    // on401:false — keep the existing throw→catch→toast path (no redirect) so
    // the button-text reset in `finally` still runs.
    const { token } = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
      on401: false
    })

    // Show token in modal (one-time display)
    showDispatchTokenModal(token)

    // Refresh list
    await loadDispatchTokenList(urlKey)
  } catch (e) {
    console.error('Failed to create token:', e)
    toast('Failed to create token: ' + e.message, { type: 'error' })
  } finally {
    if (submitBtn) submitBtn.textContent = originalText
  }
}

/**
 * Revoke a dispatch token
 */
async function revokeDispatchToken(urlKey, tokenId) {
  try {
    // on401:false — keep the existing throw→catch→toast path (no redirect).
    await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/tokens/${tokenId}`, {
      method: 'DELETE',
      on401: false
    })

    // Remove from DOM
    document.querySelector(`.token-item[data-token-id="${tokenId}"]`)?.remove()

    // Check if list is now empty
    const listEl = document.querySelector('.token-list')
    if (listEl && listEl.querySelectorAll('.token-item').length === 0) {
      listEl.innerHTML = '<div class="token-list-empty">No tokens yet</div>'
    }
  } catch (e) {
    console.error('Failed to revoke token:', e)
    toast('Failed to revoke token: ' + e.message, { type: 'error' })
  }
}

/**
 * Show modal with newly created token (one-time display)
 */
function showDispatchTokenModal(token) {
  const bodyHtml = `
    <p>Copy this token now - it won't be shown again:</p>
    <div class="token-display">
      <span class="token-value">${escapeHtml(token)}</span>
      <button class="token-copy-btn">copy</button>
    </div>
    <div class="token-usage-hint">
      Use in Authorization header:<br>
      <code>Authorization: Bearer &lt;token&gt;</code>
    </div>
  `

  const { modal } = showModal({ className: 'token-modal', title: 'Token Created', bodyHtml })

  const copyBtn = modal.querySelector('.token-copy-btn')
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(token)
      copyBtn.textContent = 'copied!'
      setTimeout(() => { copyBtn.textContent = 'copy' }, 1500)
    } catch (e) {
      console.error('Failed to copy:', e)
      copyBtn.textContent = 'failed'
      setTimeout(() => { copyBtn.textContent = 'copy' }, 1500)
    }
  })
}

/**
 * Initialize token management on dispatch page
 */
function initDispatchTokenManagement() {
  const createForm = document.getElementById('create-token-form')
  if (!createForm) return

  const urlKey = createForm.dataset.urlKey

  // Load existing tokens
  loadDispatchTokenList(urlKey)

  // Handle create form submission
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const label = createForm.label.value.trim() || 'default'
    await createDispatchToken(urlKey, label)
    createForm.reset()
  })

  // Handle revoke clicks (delegated on token-list)
  const tokenList = document.querySelector('.token-list')
  if (tokenList) {
    tokenList.addEventListener('click', async (e) => {
      const revokeBtn = e.target.closest('.token-revoke')
      if (!revokeBtn) return

      e.preventDefault()
      const tokenId = revokeBtn.dataset.tokenId
      // Native confirm() is the ratified destructive-action primitive (LIN-511);
      // see docs/ui-divergences.md.
      if (confirm('Revoke this token? It will immediately stop working.')) {
        await revokeDispatchToken(urlKey, tokenId)
      }
    })
  }
}

// =============================================================================
// Dispatch History
// =============================================================================

/**
 * Format a relative time string for dispatch history.
 * Repointed onto the canonical window.relativeTime (LIN-539); the old 30-day
 * cap converged to canon — no UX reason to retain it on this surface.
 */
function formatDispatchTime(dateStr) {
  return window.relativeTime(dateStr)
}

/**
 * Load and display dispatch history
 */
async function loadDispatchHistory(urlKey, offset) {
  const historyEl = document.querySelector('.history-list')
  if (!historyEl) return

  try {
    // on401:false — best-effort list load; failure surfaces on the inline empty
    // state below rather than redirecting.
    const { items, total } = await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/history?offset=${offset}`, { on401: false })
    renderDispatchHistoryList(historyEl, items, total, offset, urlKey)
  } catch (e) {
    console.error('Failed to load history:', e)
    historyEl.innerHTML = '<div class="history-list-empty">Failed to load history</div>'
  }
}

/**
 * Render feedback entries for a history item
 */
function renderFeedbackEntries(feedback) {
  if (!feedback || feedback.length === 0) return ''

  const entries = feedback.map((f, i) => {
    const isLast = i === feedback.length - 1
    const prefix = isLast ? '\u2514\u2500' : '\u251c\u2500'
    const time = formatDispatchTime(f.timestamp)
    const isSafeUrl = f.url && /^https?:\/\//i.test(f.url)
    const urlHtml = isSafeUrl
      ? ` <a class="feedback-link" href="${escapeHtml(f.url)}" target="_blank">${escapeHtml(f.urlLabel || 'link')}</a>`
      : ''

    return `<div class="feedback-entry"><span class="feedback-prefix">${prefix}</span> ${escapeHtml(f.message)}${urlHtml} <span class="feedback-time">\u00b7 ${time}</span></div>`
  }).join('')

  return `<div class="feedback-list">${entries}</div>`
}

function renderDispatchHistoryList(container, items, total, offset, urlKey) {
  if (items.length === 0 && offset === 0) {
    container.innerHTML = '<div class="history-list-empty">No dispatch history yet</div>'
    return
  }

  // Map each resolved dispatch status onto the shared StatusPill vocabulary
  // (LIN-853): `state` selects the canonical color token, `char` keeps the
  // existing per-status glyph. `taken`/`expired`/`cancelled` are the stored
  // resolutions; `done`/`failed` cover terminal-marker outcomes.
  const STATUS_PILL = {
    taken: { state: 'done', char: '\u2713' }, //     \u2713 green
    done: { state: 'done', char: '\u2713' }, //      \u2713 green
    failed: { state: 'failed', char: '\u2715' }, //  \u2715 red
    expired: { state: 'todo', char: '\u2298' }, //   \u2298 dim
    cancelled: { state: 'failed', char: '\u2715' } // \u2715 red
  }

  const itemsHtml = items.map(item => {
    const pill = STATUS_PILL[item.status] || STATUS_PILL.expired
    // Canonical `.status-pill` markup, hand-mirrored from the server helper
    // lib/components/status-pill.js \u2014 the shared contract is the global CSS
    // class API, which cards can't reach client-side. `history-status` and
    // `status-<status>` ride alongside as the existing E2E + semantic hooks.
    const statusPillHtml = `<span class="history-status status-pill status-pill--${pill.state} status-${escapeHtml(item.status)}">`
      + `<span class="status-pill__char">${pill.char}</span>`
      + `<span class="status-pill__label">${escapeHtml(item.status)}</span></span>`
    const issueHtml = item.issueIdentifier
      ? (item.issueUrl
        ? ` <a class="history-issue" href="${escapeHtml(item.issueUrl)}" target="_blank">${escapeHtml(item.issueIdentifier)}</a>`
        : ` <span class="history-issue">${escapeHtml(item.issueIdentifier)}</span>`)
      : ''

    const dispatched = formatDispatchTime(item.dispatchedAt)
    const resolved = formatDispatchTime(item.resolvedAt)
    const tokenInfo = item.takenByTokenLabel ? ` \u00b7 by ${escapeHtml(item.takenByTokenLabel)}` : ''
    const repoInfo = item.repo ? ` \u00b7 ${escapeHtml(item.repo)}` : ''
    // Display 'local' API value as user-facing 'harbour' label
    const targetDisplay = item.target === 'local' ? 'harbour' : item.target
    const targetInfo = targetDisplay ? ` \u00b7 ${escapeHtml(targetDisplay)}` : ''
    const hasPrompt = item.prompt && item.prompt.trim()
    const hasFeedback = item.feedback && item.feedback.length > 0
    const expandableClass = hasPrompt ? ' expandable' : ''
    const promptHtml = hasPrompt
      ? `<div class="history-prompt">${formatPromptHtml(item.prompt)}</div>`
      : ''
    const feedbackHtml = hasFeedback ? renderFeedbackEntries(item.feedback) : ''

    return `
      <div class="history-item${expandableClass}" data-status="${escapeHtml(item.status)}">
        ${statusPillHtml}
        <div class="history-info">
          <span class="history-name">${escapeHtml(item.promptName || 'Prompt')}</span>${issueHtml}
          <div class="history-meta">dispatched ${dispatched} \u00b7 resolved ${resolved}${tokenInfo}${repoInfo}${targetInfo}</div>${promptHtml}${feedbackHtml}
        </div>
      </div>`
  }).join('')

  // If appending (offset > 0), insert before the show-more button
  if (offset > 0) {
    const btn = container.querySelector('.history-show-more')
    if (btn) btn.remove()
    container.insertAdjacentHTML('beforeend', itemsHtml)
  } else {
    container.innerHTML = itemsHtml
  }

  // Show "show more" button if there are more items
  const loaded = offset + items.length
  if (loaded < total) {
    const showMoreBtn = document.createElement('button')
    showMoreBtn.className = 'history-show-more'
    showMoreBtn.textContent = `show more (${loaded}/${total})`
    showMoreBtn.addEventListener('click', () => loadDispatchHistory(urlKey, loaded))
    container.appendChild(showMoreBtn)
  }
}

/**
 * Initialize dispatch history on dispatch page
 */
function initDispatchHistory() {
  const historyEl = document.querySelector('.history-list')
  if (!historyEl) return

  const urlKey = historyEl.dataset.urlKey
  loadDispatchHistory(urlKey, 0)

  // Set up refresh button
  const refreshBtn = document.querySelector('.history-refresh')
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.textContent = 'refreshing...'
      refreshBtn.disabled = true
      loadDispatchHistory(urlKey, 0).finally(() => {
        refreshBtn.textContent = 'refresh'
        refreshBtn.disabled = false
      })
    })
  }

  // Delegated click handler for expanding history items
  historyEl.addEventListener('click', (e) => {
    // Don't toggle when clicking links
    if (e.target.closest('a')) return

    const item = e.target.closest('.history-item.expandable')
    if (item) {
      item.classList.toggle('expanded')
    }
  })
}

// =============================================================================
// Cleanup
// =============================================================================

window.addEventListener('beforeunload', () => {
  if (queueListPollId) {
    clearInterval(queueListPollId)
    queueListPollId = null
  }
})

// =============================================================================
// Initialization
// =============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initDispatchPagePrompt()
  initDispatchToggle()
  initQueueList()
  initDispatchTokenManagement()
  initDispatchHistory()
})
