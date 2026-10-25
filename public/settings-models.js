/**
 * Settings › Models, the client (LIN-3855). The page works without this file: every field is a plain form
 * control, and the server judges every save (lib/model-routing-edit.js). This file only keeps the choices
 * honest as a row changes: the model options follow the harness the row names, an OpenRouter-only pick
 * switches the harness to OpenCode and clears effort (which OpenCode does not take), the page says
 * how many fields are staged, and at phone width an open row's sheet traps Tab and closes on Escape.
 *
 * Loads after common.js: it uses buildDispatchModelOptionDescriptors and getSettingsModelCatalog from there,
 * so the option set is the one the Dispatch page offers, merged with the same live catalog.
 */
(function () {
  const form = document.querySelector('[data-models-form]');
  if (!form) return;
  const staged = form.querySelector('[data-models-staged]');
  const initial = new Map();
  form.querySelectorAll('select[name^="c__"], input[name^="c__"]').forEach((el) => initial.set(el.name, el.value));

  const panelField = (panel, name) => panel.querySelector(`[data-models-field="${name}"]`);
  const claudeIds = () => (typeof DISPATCH_CLAUDE_MODEL_SUGGESTIONS !== 'undefined' ? DISPATCH_CLAUDE_MODEL_SUGGESTIONS : []);

  /** The option set a row's harness offers: Claude presets only for claude-code; OpenCode's list and the catalog. */
  function offeredFor(harness) {
    const catalog = typeof getSettingsModelCatalog === 'function' ? getSettingsModelCatalog() : [];
    if (harness === 'claude-code') return buildDispatchModelOptionDescriptors('claude-code', []);
    if (harness === 'opencode') return buildDispatchModelOptionDescriptors('opencode', catalog);
    const claude = buildDispatchModelOptionDescriptors('claude-code', []);
    const open = buildDispatchModelOptionDescriptors('opencode', catalog).filter((o) => !claude.some((c) => c.id === o.id));
    return claude.concat(open);
  }

  /** Rebuild a row's model select for its harness, keeping the pick when it is still offered. */
  function rebuildModels(panel) {
    const harness = panelField(panel, 'harness');
    const model = panelField(panel, 'model');
    if (!model) return;
    const keep = model.value;
    const blankLabel = model.options[0] ? model.options[0].textContent : 'Follow the group';
    const offered = offeredFor(harness ? harness.value : '');
    model.innerHTML = '';
    model.add(new Option(blankLabel, ''));
    offered.forEach((o) => {
      const opt = new Option(o.label, o.id);
      if (o.free) opt.setAttribute('data-free', 'true');
      model.add(opt);
    });
    model.value = offered.some((o) => o.id === keep) ? keep : '';
  }

  /** The effort control is shown only where its harness takes effort. */
  function syncEffort(panel) {
    const harness = panelField(panel, 'harness');
    const effortWrap = panel.querySelector('[data-models-effort]');
    if (!effortWrap) return;
    const noEffort = harness && harness.value === 'opencode';
    effortWrap.hidden = !!noEffort;
    if (noEffort) {
      const effort = panelField(panel, 'effort');
      if (effort) effort.value = '';
    }
  }

  function countStaged() {
    let n = 0;
    form.querySelectorAll('select[name^="c__"], input[name^="c__"]').forEach((el) => {
      if (initial.get(el.name) !== el.value) n += 1;
    });
    if (staged) staged.textContent = n ? `${n} change${n === 1 ? '' : 's'} staged. Save to make them one change.` : 'No changes yet.';
  }

  // At phone width an open row is a full-screen sheet (settings.css) laid over the page, so Tab must not
  // reach the rows behind it. Escape closes the sheet and hands focus back to its row. Desktop is untouched.
  const phone = window.matchMedia('(max-width: 640px)');
  const openSheet = () => (phone.matches ? form.querySelector('details.settings-row-open[open]') : null);
  const sheetFocusables = (sheet) => [...sheet.querySelectorAll('summary, a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])')];

  document.addEventListener('keydown', (event) => {
    const sheet = openSheet();
    if (!sheet) return;
    if (event.key === 'Escape') {
      sheet.open = false;
      sheet.querySelector(':scope > summary').focus();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = sheetFocusables(sheet);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!sheet.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  form.addEventListener('change', (event) => {
    const el = event.target;
    const panel = el.closest && el.closest('.settings-change-panel');
    if (!panel) return;
    if (el.getAttribute('data-models-field') === 'harness') {
      rebuildModels(panel);
      syncEffort(panel);
    }
    if (el.getAttribute('data-models-field') === 'model' && el.value) {
      // A model OpenRouter offers but Claude Code does not (only reachable from a row that names no harness)
      // means OpenCode: the harness switches, and effort goes with it.
      const harness = panelField(panel, 'harness');
      if (harness && harness.value !== 'opencode' && !claudeIds().includes(el.value)) {
        harness.value = 'opencode';
        rebuildModels(panel);
        syncEffort(panel);
      }
    }
    countStaged();
  });
})();
