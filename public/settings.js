/**
 * Settings Page Client-Side Logic
 *
 * Dispatch presets CRUD (LIN-1391 S7), plus the area controls added in
 * LIN-3846 (theme choice, the +proxy JSON switch, key revoke and New key, old
 * fragments). Every other Settings control is a plain server-rendered
 * `<form method="POST">` and needs no client JS. Presets are a growable list, so create/edit/delete go through
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

  })
}

// ---------------------------------------------------------------------------
// LIN-3846: the areas. Everything below binds to elements the server rendered
// (LIN-3401), never by a page-wide class listener.
// ---------------------------------------------------------------------------

// Old fragments (#dispatch-presets, #ai-model, #dispatch-defaults) lived on the one long
// page; they are on the Models page now.
function redirectOldFragments() {
  const hash = window.location.hash
  const onModels = /\/settings\/models(?:[/?#]|$)/.test(window.location.pathname)
  if (!hash || onModels || /\/settings\/[a-z-]+/.test(window.location.pathname)) return
  if (['#dispatch-presets', '#ai-model', '#dispatch-defaults'].includes(hash)) {
    window.location.replace(window.location.pathname.replace(/\/settings\/?$/, '/settings/models') + hash)
  }
}

// A short inline Undo beside a just-changed row. No popup. (LIN-3890: found by its
// data attribute, not a class, so the markup can change its look without touching this.)
function offerUndo(row, redo) {
  const old = row.querySelector('[data-settings-undo]')
  if (old) old.remove()
  const undo = document.createElement('button')
  undo.type = 'button'
  undo.setAttribute('data-settings-undo', '')
  undo.textContent = 'Undo'
  undo.setAttribute('data-testid', 'settings-undo-inline')
  const timer = setTimeout(() => undo.remove(), 6000)
  undo.addEventListener('click', () => { clearTimeout(timer); undo.remove(); redo() })
  row.appendChild(undo)
}

// The theme: two visible choices posting the existing route. Works with no script
// (a plain form post); with script it applies at once, with Undo.
function initThemeChoices() {
  const row = document.querySelector('[data-testid="settings-theme"]')
  if (!row) return
  const buttons = Array.from(row.querySelectorAll('[data-theme-choice]'))
  const select = (theme) => buttons.forEach((b) => {
    const on = b.dataset.themeChoice === theme
    b.classList.toggle('is-selected', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
  buttons.forEach((btn) => btn.addEventListener('click', (e) => {
    if (!window.applyTheme) return // falls back to the form POST
    e.preventDefault()
    const previous = document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light'
    const next = btn.dataset.themeChoice
    if (next === previous) return
    select(window.applyTheme(next, btn.dataset.urlKey))
    offerUndo(row, () => select(window.applyTheme(previous, btn.dataset.urlKey)))
  }))
  // The server knows the cookie/session theme; the class on <html> is what is really applied.
  select(document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light')
}

// The +proxy default posts JSON (the route accepts only a boolean).
function initJsonToggles() {
  document.querySelectorAll('form[data-settings-json]').forEach((form) => {
    const btn = form.querySelector('button')
    const row = form.closest('[data-feature]')
    const field = form.dataset.settingsJson
    const paint = (on) => {
      form.dataset.value = on ? 'true' : 'false'
      btn.classList.toggle('toggle-on', on)
      btn.classList.toggle('toggle-off', !on)
      btn.setAttribute('aria-checked', on ? 'true' : 'false')
      const state = btn.querySelector('.toggle-state')
      if (state) state.textContent = on ? '● on' : '○ off'
    }
    const save = async (on) => {
      try {
        await window.api(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: JSON.stringify({ [field]: on }),
          on401: false
        })
        paint(on)
        return true
      } catch (err) {
        toast('Failed to save: ' + err.message, { type: 'error' })
        return false
      }
    }
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      const was = form.dataset.value === 'true'
      if (await save(!was) && row) offerUndo(row, () => save(was))
    })
  })
}

// Ask in place (LIN-3890): Cancel closes the panel where it is open. Without
// script the Cancel link reloads the area, which closes it the same way. Each
// control is bound to the element Harbour rendered (LIN-3401), never a page-wide listener.
function initAskCancel() {
  document.querySelectorAll('[data-settings-ask-cancel]').forEach((cancel) => cancel.addEventListener('click', (e) => {
    e.preventDefault()
    const panel = cancel.closest('details')
    if (panel) panel.removeAttribute('open')
  }))
}

// A script-transport ask (LIN-3890): its Confirm sends the method to the route the
// row names. Used for key revoke, through today's DELETE routes (their owner rules
// apply, and a non-owner row renders no Confirm at all). `on401: false` keeps a
// refused session in place: the failure is toasted, not a redirect to the landing page.
function initAskConfirm() {
  document.querySelectorAll('[data-settings-ask-route]').forEach((confirm) => confirm.addEventListener('click', async (e) => {
    e.preventDefault()
    confirm.disabled = true
    try {
      await window.api(confirm.dataset.settingsAskRoute, { method: confirm.dataset.settingsAskMethod, on401: false })
      window.location.reload()
    } catch (err) {
      confirm.disabled = false
      toast('Failed: ' + (err.message || 'refused'), { type: 'error' })
    }
  }))
}

// New key: read, or read and update; the secret is shown once, in place.
function initNewKey() {
  const form = document.querySelector('[data-testid="settings-newkey-form"]')
  if (!form) return
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const submit = form.querySelector('.settings-newkey-submit')
    const out = form.querySelector('.settings-newkey-secret')
    submit.disabled = true
    try {
      const data = await window.api(form.dataset.newkeyRoute, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.querySelector('.settings-newkey-label').value.trim() || undefined,
          scope: form.querySelector('input[name="scope"]:checked').value
        }),
        on401: false
      })
      out.textContent = 'Copy this now, it is shown once: ' + (data.token || '')
      out.hidden = false
      submit.hidden = true
    } catch (err) {
      submit.disabled = false
      toast('Failed to create key: ' + (err.message || 'refused'), { type: 'error' })
    }
  })
}

document.addEventListener('DOMContentLoaded', () => {
  redirectOldFragments()
  initDispatchPresets()
  initThemeChoices()
  initJsonToggles()
  initAskCancel()
  initAskConfirm()
  initNewKey()
})
