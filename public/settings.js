/**
 * Settings Page Client-Side Logic
 *
 * Currently just Dispatch presets CRUD (LIN-1391 S7) — every other Settings
 * section is a plain server-rendered `<form method="POST">` and needs no
 * client JS. Presets are a growable list, so create/edit/delete go through
 * JSON endpoints (routes/dispatch.js, following the routes/collective.js
 * preset-CRUD convention) instead. On success this reloads the page rather
 * than re-rendering the list client-side — the config-row markup
 * (renderDispatchDefaultRow, harness-aware model datalist) lives server-side
 * in lib/render-settings.js and this file deliberately doesn't duplicate it.
 *
 * Loaded only on the /settings page. Requires common.js to be loaded first
 * (provides window.api / window.toast / window.escapeHtml).
 */

/**
 * Read a preset row's { name, model, harness } out of its DOM. Works for both
 * an existing preset's row (`.dispatch-preset-item`) and the "new preset"
 * create block (`.dispatch-preset-create`) — both carry the same
 * name-input + renderDispatchDefaultRow config-row shape.
 */
function readDispatchPresetRow(container) {
  const nameInput = container.querySelector('.dispatch-preset-name-input')
  const harnessSelect = container.querySelector('.harness-select')
  const modelInput = container.querySelector('.dispatch-model-input')
  return {
    name: nameInput ? nameInput.value.trim() : '',
    harness: harnessSelect ? harnessSelect.value : '',
    model: modelInput ? modelInput.value.trim() : ''
  }
}

/**
 * Create a new dispatch preset from the "new preset" block, then reload so
 * the server-rendered list picks it up.
 */
async function createDispatchPreset(urlKey, createBlock, btn) {
  const originalText = btn ? btn.textContent : null

  const { name, model, harness } = readDispatchPresetRow(createBlock)
  if (!name) {
    toast('Preset name is required', { type: 'error' })
    return
  }

  try {
    if (btn) { btn.textContent = 'saving...'; btn.disabled = true }
    await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model: model || undefined, harness: harness || undefined }),
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

  const { name, model, harness } = readDispatchPresetRow(row)
  if (!name) {
    toast('Preset name is required', { type: 'error' })
    return
  }

  try {
    if (btn) { btn.textContent = 'saving...'; btn.disabled = true }
    await api(`/workspace/${encodeURIComponent(urlKey)}/api/dispatch/presets/${encodeURIComponent(presetId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, model: model || undefined, harness: harness || undefined }),
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

document.addEventListener('DOMContentLoaded', () => {
  initDispatchPresets()
})
