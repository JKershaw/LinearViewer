/**
 * Settings Page Client-Side Logic
 *
 * Currently just Dispatch presets CRUD (LIN-1391 S7) — every other Settings
 * section is a plain server-rendered `<form method="POST">` and needs no
 * client JS. Presets are a growable list, so create/edit/delete go through
 * JSON endpoints (routes/dispatch.js, following the routes/collective.js
 * preset-CRUD convention) instead. On success this reloads the page rather
 * than re-rendering the list client-side — the config-row markup
 * (renderDispatchDefaultRow, harness-aware model select) lives server-side
 * in lib/render-settings.js and this file deliberately doesn't duplicate it.
 *
 * Loaded only on the /settings page. Requires common.js to be loaded first
 * (provides window.api / window.toast / window.escapeHtml).
 */

// Matches a per-kind row's harness-select/model-input `name` attribute, e.g.
// `preset__<id>__kind__review__HarnessSelect` or
// `newDispatchPreset__kind__review__Model` — captures the kind in between.
const DISPATCH_PRESET_KIND_FIELD_RE = /__kind__(.+)__(?:HarnessSelect|Model|Effort)$/

/**
 * Read a model `<select>` + its paired `other…` escape-hatch input back into
 * one string (LIN-2719 HARD RULE 2). `.value` works identically on an
 * `<input>` and a `<select>`, so this is the one branch the swap to a real
 * `<select>` needed: when the select is on the `other…` sentinel, the model
 * is the free-text escape-hatch input's value, not the literal sentinel
 * string. WITHOUT this branch, saving a preset with `other…` selected would
 * post `model: "__other__"` — `buildDispatchPresetConfig` (routes/dispatch.js)
 * rebuilds preset config purely from the request body with no read-merge, so
 * that value would silently overwrite the preset's real stored model. Shared
 * by both the top-level and per-kind reads below.
 * @param {Element|null} modelSelect
 * @param {Element|null} otherInput
 * @returns {string}
 */
function readDispatchModelSelect(modelSelect, otherInput) {
  if (!modelSelect) return ''
  if (modelSelect.value === window.DISPATCH_MODEL_OTHER_VALUE) {
    return otherInput ? otherInput.value.trim() : ''
  }
  return modelSelect.value
}

/**
 * Read a preset row's `{ name, model, harness, effort, byKind }` out of its DOM.
 * Works for both an existing preset's row (`.dispatch-preset-item`) and the
 * "new preset" create block (`.dispatch-preset-create`) — both carry the
 * same name-input + top-level config row + per-kind overrides shape
 * (LIN-1400).
 *
 * The top-level read is scoped to `.dispatch-preset-toplevel-config` — once
 * per-kind rows exist in the same container, an unscoped first-match
 * `.harness-select`/`.dispatch-model-input` query would read a per-kind row
 * by accident instead of the row's own top-level fields.
 */
function readDispatchPresetRow(container) {
  const nameInput = container.querySelector('.dispatch-preset-name-input')
  const topLevel = container.querySelector('.dispatch-preset-toplevel-config')
  const harnessSelect = topLevel ? topLevel.querySelector('.harness-select') : null
  const modelSelect = topLevel ? topLevel.querySelector('.dispatch-model-input') : null
  const modelOtherInput = topLevel ? topLevel.querySelector('.dispatch-model-input-other') : null
  const effortInput = topLevel ? topLevel.querySelector('.dispatch-effort-input') : null

  const byKind = {}
  container.querySelectorAll('.dispatch-preset-kind-overrides .harness-select').forEach((select) => {
    const match = select.name.match(DISPATCH_PRESET_KIND_FIELD_RE)
    if (!match) return
    const kind = match[1]
    const row = select.closest('.dispatch-default-row')
    const modelField = row ? row.querySelector('.dispatch-model-input') : null
    const modelOtherField = row ? row.querySelector('.dispatch-model-input-other') : null
    const effortField = row ? row.querySelector('.dispatch-effort-input') : null
    const model = readDispatchModelSelect(modelField, modelOtherField)
    const harness = select.value
    const effort = effortField ? effortField.value.trim() : ''
    if (model || harness || effort) {
      byKind[kind] = {}
      if (model) byKind[kind].model = model
      if (harness) byKind[kind].harness = harness
      if (effort) byKind[kind].effort = effort
    }
  })

  return {
    name: nameInput ? nameInput.value.trim() : '',
    harness: harnessSelect ? harnessSelect.value : '',
    model: readDispatchModelSelect(modelSelect, modelOtherInput),
    effort: effortInput ? effortInput.value.trim() : '',
    byKind
  }
}

/**
 * Create a new dispatch preset from the "new preset" block, then reload so
 * the server-rendered list picks it up.
 */
async function createDispatchPreset(urlKey, createBlock, btn) {
  const originalText = btn ? btn.textContent : null

  const { name, model, harness, effort, byKind } = readDispatchPresetRow(createBlock)
  if (!name) {
    toast('Preset name is required', { type: 'error' })
    return
  }

  try {
    if (btn) { btn.textContent = 'saving...'; btn.disabled = true }
    await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        model: model || undefined,
        harness: harness || undefined,
        effort: effort || undefined,
        byKind: Object.keys(byKind).length ? byKind : undefined
      }),
      on401: false
    })
    window.location.reload()
  } catch (e) {
    console.error('Failed to create dispatch preset:', e)
    toast('Failed to create preset: ' + e.message, { type: 'error' })
    if (btn) { btn.textContent = originalText; btn.disabled = false }
  }
}

/**
 * Save (update) an existing dispatch preset's row, then reload.
 */
async function saveDispatchPreset(urlKey, presetId, row) {
  const btn = row.querySelector('.dispatch-preset-save-btn')
  const originalText = btn ? btn.textContent : null

  const { name, model, harness, effort, byKind } = readDispatchPresetRow(row)
  if (!name) {
    toast('Preset name is required', { type: 'error' })
    return
  }

  try {
    if (btn) { btn.textContent = 'saving...'; btn.disabled = true }
    // byKind is always sent (even {}) so the editor is authoritative and
    // clearing a preset's per-kind overrides works — the route preserves
    // existing byKind only when the field is absent from the body (LIN-1400).
    await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/presets/${encodeURIComponent(presetId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model: model || undefined, harness: harness || undefined, effort: effort || undefined, byKind }),
      on401: false
    })
    window.location.reload()
  } catch (e) {
    console.error('Failed to save dispatch preset:', e)
    toast('Failed to save preset: ' + e.message, { type: 'error' })
    if (btn) { btn.textContent = originalText; btn.disabled = false }
  }
}

/**
 * Delete a dispatch preset, then reload.
 */
async function deleteDispatchPreset(urlKey, presetId) {
  try {
    await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/presets/${encodeURIComponent(presetId)}`, {
      method: 'DELETE',
      on401: false
    })
    window.location.reload()
  } catch (e) {
    console.error('Failed to delete dispatch preset:', e)
    toast('Failed to delete preset: ' + e.message, { type: 'error' })
  }
}

/**
 * Wire up the Dispatch presets section: create button, and delegated
 * save/delete handlers on every existing preset row.
 */
function initDispatchPresets() {
  const createForm = document.querySelector('[data-testid="dispatch-preset-create-form"]')
  if (!createForm) return

  const urlKey = createForm.dataset.urlKey
  const createBtn = document.querySelector('.dispatch-preset-create-btn')
  if (createBtn) {
    createBtn.addEventListener('click', (e) => {
      e.preventDefault()
      createDispatchPreset(urlKey, createForm, createBtn)
    })
  }

  const list = document.querySelector('[data-testid="dispatch-preset-list"]')
  if (!list) return

  list.addEventListener('click', (e) => {
    const saveBtn = e.target.closest('.dispatch-preset-save-btn')
    if (saveBtn) {
      e.preventDefault()
      const row = saveBtn.closest('.dispatch-preset-item')
      if (row) saveDispatchPreset(urlKey, saveBtn.dataset.presetId, row)
      return
    }

    const deleteBtn = e.target.closest('.dispatch-preset-delete-btn')
    if (deleteBtn) {
      e.preventDefault()
      // Native confirm() is the ratified destructive-action primitive
      // (LIN-511); see docs/ui-divergences.md.
      if (confirm('Delete this preset? Dispatches already made from it are unaffected.')) {
        deleteDispatchPreset(urlKey, deleteBtn.dataset.presetId)
      }
    }
  })
}

// =============================================================================
// Share links (LIN-3244, Session B of LIN-3073)
//
// Create/list/revoke go through the owner routes in routes/share.js. The
// created `{ token, url }` is displayed once here and never persisted in the
// list; the list only ever carries the opaque management id. Owner-gate and
// validation refusals are mapped to readable messages rather than swallowed.
// =============================================================================

// Route refusal `code` → human sentence. The codes are the shared owner-mint
// vocabulary (lib/owner-mint-refusals.js) plus the share-specific refusals.
const SHARE_REFUSAL_MESSAGES = {
  GRANT_OWNER_ONLY: 'Only this workspace’s owner can manage share links.',
  WORKSPACE_OWNER_UNSET: 'This workspace has no recorded owner, so share links cannot be managed.',
  GRANT_OWNERLESS: 'This session has no account owner, so share links cannot be managed.',
  OWNER_CHECK_UNAVAILABLE: 'Owner verification is temporarily unavailable. Try again shortly.',
  PARENT_SHARES_UNSUPPORTED: 'This workspace’s provider has no subtasks, so a parent share would be empty. Share a label instead.',
  SHARE_SNAPSHOT_UNAVAILABLE: 'Could not read the collection to share; nothing was created. Try again.'
}

function showShareMessage(text) {
  const node = document.querySelector('[data-testid="share-message-node"]')
  const el = document.querySelector('[data-testid="share-message"]')
  if (node) node.hidden = !text
  if (el) el.textContent = text || ''
}

function shareErrorMessage(e) {
  const code = e && e.body && e.body.code
  if (code && SHARE_REFUSAL_MESSAGES[code]) return SHARE_REFUSAL_MESSAGES[code]
  if (e && e.status === 429) return 'Too many share requests — wait a moment and try again.'
  return (e && e.message) || 'Something went wrong.'
}

function renderShareList(container, shares) {
  if (!shares.length) {
    container.innerHTML = '<div class="node"><div class="line"><span class="settings-value share-list-empty" data-testid="share-list-empty">No share links yet</span></div></div>'
    return
  }
  container.innerHTML = shares.map((s) => {
    const created = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ''
    const kind = s.kind === 'parent' ? 'parent task' : 'label'
    const revoked = s.revokedAt ? ' · revoked' : ''
    const revokeBtn = s.revokedAt
      ? ''
      : `<button type="button" class="action-btn share-revoke" data-share-id="${escapeHtml(s.id)}">revoke</button>`
    return `
      <div class="node share-item" data-share-id="${escapeHtml(s.id)}" data-revoked="${s.revokedAt ? 'true' : 'false'}">
        <div class="line">
          <span class="field-label">${escapeHtml(kind)}:</span>
          <span class="settings-value share-subject">${escapeHtml(s.subjectId || '')}</span>
          <span class="share-meta">created ${escapeHtml(created)}${revoked}</span>
          ${revokeBtn}
        </div>
      </div>`
  }).join('')
}

async function loadShareLinks(urlKey) {
  const listEl = document.querySelector('[data-testid="share-list"]')
  if (!listEl) return
  try {
    const { shares } = await api(`/workspace/${encodeURIComponent(urlKey)}/shares`, { on401: false })
    renderShareList(listEl, shares || [])
  } catch (e) {
    console.error('Failed to load share links:', e)
    listEl.innerHTML = `<div class="node"><div class="line"><span class="settings-value share-list-empty">${escapeHtml(shareErrorMessage(e))}</span></div></div>`
  }
}

function showCreatedShare(url) {
  const wrap = document.querySelector('[data-testid="share-created"]')
  const valueEl = document.querySelector('[data-testid="share-created-url"]')
  if (!wrap || !valueEl) return
  valueEl.textContent = url
  wrap.hidden = false
  const copyBtn = document.querySelector('[data-testid="share-copy-btn"]')
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url)
        copyBtn.textContent = 'copied!'
        setTimeout(() => { copyBtn.textContent = 'copy' }, 1500)
      } catch (err) {
        console.error('Failed to copy share link:', err)
        copyBtn.textContent = 'failed'
        setTimeout(() => { copyBtn.textContent = 'copy' }, 1500)
      }
    }
  }
}

async function createShareLink(urlKey, root) {
  const kind = (root.querySelector('.share-kind-select') || {}).value || 'label'
  const input = root.querySelector('.share-subject-input')
  const value = input ? input.value.trim() : ''
  const includeDescriptions = !!(root.querySelector('.share-descriptions-input') || {}).checked
  const btn = root.querySelector('.share-create-btn')

  showShareMessage('')
  if (!value) {
    showShareMessage(kind === 'parent' ? 'Enter the parent task’s id or identifier (e.g. LIN-3057).' : 'Enter a label name.')
    return
  }

  const originalText = btn ? btn.textContent : null
  try {
    if (btn) { btn.textContent = 'creating…'; btn.disabled = true }
    const { url } = await api(`/workspace/${encodeURIComponent(urlKey)}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: { kind, id: value }, includeDescriptions }),
      on401: false
    })
    // Absolute URL so the copied link works from anywhere.
    showCreatedShare(new URL(url, window.location.origin).href)
    if (input) input.value = ''
    await loadShareLinks(urlKey)
  } catch (e) {
    console.error('Failed to create share link:', e)
    showShareMessage(shareErrorMessage(e))
  } finally {
    if (btn) { btn.textContent = originalText; btn.disabled = false }
  }
}

async function revokeShareLink(urlKey, id) {
  showShareMessage('')
  try {
    await api(`/workspace/${encodeURIComponent(urlKey)}/shares/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      on401: false
    })
    await loadShareLinks(urlKey)
  } catch (e) {
    console.error('Failed to revoke share link:', e)
    showShareMessage(shareErrorMessage(e))
  }
}

function initShareLinks() {
  const root = document.querySelector('[data-testid="share-links"]')
  if (!root) return
  const urlKey = root.dataset.urlKey

  loadShareLinks(urlKey)

  const createBtn = root.querySelector('.share-create-btn')
  if (createBtn) {
    createBtn.addEventListener('click', (e) => {
      e.preventDefault()
      createShareLink(urlKey, root)
    })
  }

  // Keep the input's placeholder honest for the selected kind.
  const kindSelect = root.querySelector('.share-kind-select')
  const input = root.querySelector('.share-subject-input')
  if (kindSelect && input) {
    const syncPlaceholder = () => {
      input.placeholder = kindSelect.value === 'parent' ? 'e.g. LIN-3057 or the task id' : 'label name'
    }
    kindSelect.addEventListener('change', syncPlaceholder)
    syncPlaceholder()
  }

  const list = root.querySelector('[data-testid="share-list"]')
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.share-revoke')
      if (!btn) return
      e.preventDefault()
      // Native confirm() is the ratified destructive-action primitive
      // (LIN-511); see docs/ui-divergences.md.
      if (confirm('Revoke this share link? Anyone holding the URL will immediately lose access.')) {
        revokeShareLink(urlKey, btn.dataset.shareId)
      }
    })
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initDispatchPresets()
  initShareLinks()
})
