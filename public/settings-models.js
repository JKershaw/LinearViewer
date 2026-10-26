/**
 * Settings › Models, the client (LIN-3855, LIN-3952). The page works without this file: every field is a plain form control,
 * and the server judges every save (lib/model-routing-edit.js). This file keeps the page's own duties:
 *
 *  - the count of staged fields, and the pending bar that stays in view while anything is staged (its Discard resets them);
 *  - a staged row's pending value, shown in the row's summary, so a closed row says what will change;
 *  - a closed "Show N more" fold opens when a field inside it changes, so no staged value hides;
 *  - at phone width an open row's sheet, which traps Tab and closes on Escape.
 *
 * The decision panel's own choices (suggestions, effort, the OpenRouter-only switch) are public/decision-panel.js's.
 * Loads after decision-panel.js.
 */
(function () {
  const form = document.querySelector('[data-models-form]');
  if (!form) return;
  const staged = form.querySelector('[data-models-staged]');
  const bar = form.querySelector('[data-models-bar]');
  const fields = () => form.querySelectorAll('select[name^="c__"], input[name^="c__"]');
  const initial = new Map();
  fields().forEach((el) => initial.set(el.name, el.value));

  /** A field counts as staged while its value differs from the one the page rendered. */
  const isStaged = (el) => initial.get(el.name) !== el.value;

  /** What a staged field will save, in the words the row shows: an option's text, a suggested model's name, or the value. */
  function pendingLabel(el) {
    if (!el.value) return 'follow the group';
    if (el.tagName === 'SELECT') return el.options[el.selectedIndex].text;
    const list = el.getAttribute('list') && document.getElementById(el.getAttribute('list'));
    const option = list && [...list.options].find((o) => o.value === el.value);
    return option ? option.textContent : el.value;
  }

  /** The row a field belongs to, and the pending value shown in it: the last staged field of the row, or none. */
  function syncRow(row) {
    const slot = row.querySelector('[data-models-pending]');
    if (!slot) return;
    const changed = [...row.querySelectorAll('select[name^="c__"], input[name^="c__"]')].filter(isStaged);
    row.classList.toggle('is-staged', changed.length > 0);
    slot.hidden = changed.length === 0;
    slot.textContent = changed.length ? `→ ${pendingLabel(changed[changed.length - 1])}` : '';
  }

  function countStaged() {
    const n = [...fields()].filter(isStaged).length;
    if (staged) staged.textContent = n ? `${n} change${n === 1 ? '' : 's'} staged` : 'No changes yet.';
    if (bar) bar.classList.toggle('is-idle', n === 0);
    form.querySelectorAll('[data-models-row]').forEach(syncRow);
  }

  /** Discard puts every field back to what the page rendered. The link it replaces still works without this script. */
  function discard(event) {
    event.preventDefault();
    fields().forEach((el) => { el.value = initial.get(el.name); });
    countStaged();
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
    const fold = event.target.closest('details[data-models-fold]');
    if (fold && !fold.open) fold.open = true;
    countStaged();
  });
  form.addEventListener('input', countStaged);
  const discardLink = form.querySelector('[data-models-discard]');
  if (discardLink) discardLink.addEventListener('click', discard);
  countStaged();
})();
