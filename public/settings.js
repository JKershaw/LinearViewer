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

// Matches a per-kind row's harness-select/model-input `name` attribute, e.g.
// `preset__<id>__kind__review__HarnessSelect` or
// `newDispatchPreset__kind__review__Model` — captures the kind in between.
const DISPATCH_PRESET_KIND_FIELD_RE = /__kind__(.+)__(?:HarnessSelect|Model|Effort)$/

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
  const modelInput = topLevel ? topLevel.querySelector('.dispatch-model-input') : null
  const effortInput = topLevel ? topLevel.querySelector('.dispatch-effort-input') : null

  const byKind = {}
  container.querySelectorAll('.dispatch-preset-kind-overrides .harness-select').forEach((select) => {
    const match = select.name.match(DISPATCH_PRESET_KIND_FIELD_RE)
    if (!match) return
    const kind = match[1]
    const row = select.closest('.dispatch-default-row')
    const modelField = row ? row.querySelector('.dispatch-model-input') : null
    const effortField = row ? row.querySelector('.dispatch-effort-input') : null
    const model = modelField ? modelField.value.trim() : ''
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
    model: modelInput ? modelInput.value.trim() : '',
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

document.addEventListener('DOMContentLoaded', () => {
  initDispatchPresets()
})
