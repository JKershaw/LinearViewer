/**
 * Settings row pieces (LIN-3890, moved from lib/render-settings-shell.js).
 *
 *  - `switchRow`  a switch (posts the existing toggle form, so the XHR toggle
 *                 client in public/app.js keeps working on it);
 *  - `drillRow`   a row showing its value and ›, opening in place (a native
 *                 `<details>`) or linking to another page;
 *  - `actionRow`  an action, teal, or red when it removes or stops something;
 *  - `staticRow`  a row that states a value and does nothing.
 *
 * Styles are owned by public/settings.css. Markup is unchanged by the move.
 */

import { escapeHtml } from '../utils/html.js';

export const attr = (name, value) => (value === undefined || value === null || value === '' ? '' : ` ${name}="${escapeHtml(String(value))}"`);

export function hiddenInputs(fields = []) {
  return fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
}

/**
 * A switch row. `on` is the current state; the form posts the opposite. With `json` (the
 * +proxy default) the form posts `{ [json]: bool }` as JSON instead, and public/settings.js
 * intercepts it by `data-settings-json`.
 *
 * LIN-3889: the row carries no `line` class (that copy of the key/value row set padding and
 * size on Settings rows: the listed, intended difference) and the switch is `settings-switch`,
 * not `toggle-btn`. The client hooks read `[data-feature]`, `role="switch"` and
 * `data-settings-json`, never those classes.
 */
export function switchRow({ key, label, note = '', on, action, extraFields = [], fieldNames = ['feature', 'enabled'], testid, json = '' }) {
  const [keyField, valueField] = fieldNames;
  const button = `<button type="submit" class="settings-switch ${on ? 'toggle-on' : 'toggle-off'}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${escapeHtml(label)}"><span class="toggle-state">${on ? '● on' : '○ off'}</span></button>`;
  const form = json
    ? `<form action="${escapeHtml(action)}" method="POST" class="settings-form" data-settings-json="${escapeHtml(json)}" data-value="${on ? 'true' : 'false'}">${button}</form>`
    : `<form action="${escapeHtml(action)}" method="POST" class="settings-form feature-form">
          <input type="hidden" name="${keyField}" value="${escapeHtml(key)}">
          <input type="hidden" name="${valueField}" value="${on ? 'false' : 'true'}">${hiddenInputs(extraFields)}
          ${button}
        </form>`;
  return `
      <div class="settings-row settings-row-switch" data-feature="${escapeHtml(key)}" data-testid="${escapeHtml(testid || `settings-toggle-${key}`)}">
        <span class="settings-row-label">${escapeHtml(label)}${note ? `<span class="settings-row-note">${escapeHtml(note)}</span>` : ''}</span>
        ${form}
      </div>`;
}

/**
 * A row that states a value and does nothing. LIN-3889: the one builder for the static rows,
 * which had been written out by hand as copies of each other. `valueHtml` is trusted markup;
 * `label` is text. `extraHtml` sits after the value (a small form, say); `attrs` is raw attributes.
 */
export function staticRow({ label, valueHtml = '', extraHtml = '', testid = '', attrs = '', className = '' }) {
  return `
      <div class="settings-row settings-row-static${className ? ` ${className}` : ''}"${attr('data-testid', testid)}${attrs}>
        <span class="settings-row-label">${escapeHtml(label)}</span>
        <span class="settings-row-value">${valueHtml}</span>${extraHtml}
      </div>`;
}

/**
 * A row with its current value and ›. With `href` it is a link to another
 * page; with `bodyHtml` it opens in place.
 */
export function drillRow({ label, value = '', href = '', bodyHtml = '', open = false, testid = '', id = '', flagHtml = '', attrs = '' }) {
  if (href && !bodyHtml) {
    return `
      <a class="settings-row settings-row-drill" href="${escapeHtml(href)}"${attr('data-testid', testid)}${attr('id', id)}>
        <span class="settings-row-label">${escapeHtml(label)}</span>
        <span class="settings-row-value">${escapeHtml(value)}</span><span class="settings-chevron" aria-hidden="true">›</span>
      </a>`;
  }
  return `
      <details class="settings-row settings-row-open"${open ? ' open' : ''}${attr('data-testid', testid)}${attr('id', id)}${attrs}>
        <summary class="settings-row-summary">
          <span class="settings-row-label">${escapeHtml(label)}${flagHtml ? `<span class="settings-row-flags">${flagHtml}</span>` : ''}</span>
          <span class="settings-row-value">${escapeHtml(value)}</span><span class="settings-chevron" aria-hidden="true">›</span>
        </summary>
        <div class="settings-row-body">${bodyHtml}</div>
      </details>`;
}

/** An action: a link (`href`) or a one-button form (`action`). `tone` is 'teal' or 'red'. */
export function actionRow({ label, tone = 'teal', href = '', action = '', fields = [], testid = '', note = '' }) {
  const cls = `settings-row settings-row-action settings-action-${tone === 'red' ? 'red' : 'teal'}`;
  const noteHtml = note ? `<span class="settings-row-note">${escapeHtml(note)}</span>` : '';
  if (href) {
    return `
      <a class="${cls} settings-action" href="${escapeHtml(href)}"${attr('data-testid', testid)}>${escapeHtml(label)}${noteHtml}</a>`;
  }
  return `
      <form action="${escapeHtml(action)}" method="POST" class="settings-form settings-row-form">${hiddenInputs(fields)}
        <button type="submit" class="${cls}"${attr('data-testid', testid)}>${escapeHtml(label)}${noteHtml}</button>
      </form>`;
}
