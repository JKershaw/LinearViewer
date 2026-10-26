/**
 * Settings › Models, the client (LIN-3855). The page works without this file: every field is a plain form control,
 * and the server judges every save (lib/model-routing-edit.js). This file keeps the page's own two duties: the count
 * of staged fields, and at phone width an open row's sheet, which traps Tab and closes on Escape.
 *
 * The decision panel's own choices (suggestions, effort, the OpenRouter-only switch) are public/decision-panel.js's.
 * Loads after decision-panel.js.
 */
(function () {
  const form = document.querySelector('[data-models-form]');
  if (!form) return;
  const staged = form.querySelector('[data-models-staged]');
  const initial = new Map();
  form.querySelectorAll('select[name^="c__"], input[name^="c__"]').forEach((el) => initial.set(el.name, el.value));

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

  form.addEventListener('change', countStaged);
})();
