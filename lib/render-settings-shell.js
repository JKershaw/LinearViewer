/**
 * Settings shell (LIN-3846): the sidebar of areas, the page frame, and the
 * three kinds of row every area is built from.
 *
 *  - `switchRow`  a switch (posts the existing toggle form, so the XHR toggle
 *                 client in public/app.js keeps working on it);
 *  - `drillRow`   a row showing its value and ›, opening in place (a native
 *                 `<details>`) or linking to another page;
 *  - `actionRow`  an action, teal, or red when it removes or stops something.
 *
 * `group` titles say who a setting affects ("For you", "For everyone in X"),
 * so rows do not repeat it. `askInPlace` is how a destructive or
 * everyone-affecting change asks: a `<details>` holding the real `<form>`; the
 * submit button exists only inside the opened panel, so it cannot be hit by a
 * stray click and works with no script. Nothing here uses a dialog, the
 * browser's confirm box, or a popup.
 */

import { escapeHtml } from './utils/html.js';
import { AREAS, AREA_GROUPS, settingsAreaUrl } from './settings-areas.js';

/** Matches MAX_REASON_LENGTH in lib/model-routing-store.js (the reason cap everyone-changes share). */
export const REASON_MAX_LENGTH = 500;

const attr = (name, value) => (value === undefined || value === null || value === '' ? '' : ` ${name}="${escapeHtml(String(value))}"`);

function hiddenInputs(fields = []) {
  return fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('');
}

/** A switch row. `on` is the current state; the form posts the opposite. */
export function switchRow({ key, label, note = '', on, action, extraFields = [], fieldNames = ['feature', 'enabled'], testid }) {
  const [keyField, valueField] = fieldNames;
  return `
      <div class="settings-row settings-row-switch line feature-toggle" data-feature="${escapeHtml(key)}" data-testid="${escapeHtml(testid || `settings-toggle-${key}`)}">
        <span class="settings-row-label feature-toggle-label">${escapeHtml(label)}${note ? `<span class="settings-row-note">${escapeHtml(note)}</span>` : ''}</span>
        <form action="${escapeHtml(action)}" method="POST" class="settings-form feature-form">
          <input type="hidden" name="${keyField}" value="${escapeHtml(key)}">
          <input type="hidden" name="${valueField}" value="${on ? 'false' : 'true'}">${hiddenInputs(extraFields)}
          <button type="submit" class="toggle-btn ${on ? 'toggle-on' : 'toggle-off'}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${escapeHtml(label)}"><span class="toggle-state">${on ? '● on' : '○ off'}</span></button>
        </form>
      </div>`;
}

/**
 * A row with its current value and ›. With `href` it is a link to another
 * page; with `bodyHtml` it opens in place.
 */
export function drillRow({ label, value = '', href = '', bodyHtml = '', open = false, testid = '', id = '' }) {
  if (href && !bodyHtml) {
    return `
      <a class="settings-row settings-row-drill" href="${escapeHtml(href)}"${attr('data-testid', testid)}${attr('id', id)}>
        <span class="settings-row-label">${escapeHtml(label)}</span>
        <span class="settings-row-value">${escapeHtml(value)}</span><span class="settings-chevron" aria-hidden="true">›</span>
      </a>`;
  }
  return `
      <details class="settings-row settings-row-open"${open ? ' open' : ''}${attr('data-testid', testid)}${attr('id', id)}>
        <summary class="settings-row-summary">
          <span class="settings-row-label">${escapeHtml(label)}</span>
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

/** A note under a group, in place of a description on every row. */
export function groupNote(text) {
  return `<p class="settings-note">${escapeHtml(text)}</p>`;
}

/**
 * A grouped list. `title` carries who it affects. `rowsHtml` is the rows;
 * `note` (plain text) goes under them. `testid` keeps the survivor testids
 * (`settings-section-*`).
 */
export function group({ title, rowsHtml, note = '', testid = '', id = '', className = '' }) {
  return `
    <section class="settings-group-block settings-section ${className}"${attr('data-testid', testid)}${attr('id', id)}>
      <h2 class="settings-group-title settings-header"${attr('data-testid', testid ? `${testid}-title` : '')}>${escapeHtml(title)}</h2>
      <div class="settings-rows">${rowsHtml}
      </div>${note ? `\n      ${groupNote(note)}` : ''}
    </section>`;
}

/**
 * Ask in place. The panel says what will happen, optionally asks why (required,
 * at most REASON_MAX_LENGTH), then confirms. `tone:'red'` for removals/stops.
 */
export function askInPlace({ summary, willHappen, askWhy = false, action, fields = [], confirmLabel = 'Confirm', tone = 'red', testid = '', method = 'POST' }) {
  const reasonHtml = askWhy
    ? `
          <label class="settings-ask-label">Why?
            <textarea name="reason" required maxlength="${REASON_MAX_LENGTH}" rows="2" class="settings-ask-reason"${attr('data-testid', testid ? `${testid}-reason` : '')}></textarea>
          </label>`
    : '';
  return `
      <details class="settings-row settings-ask settings-action-${tone === 'red' ? 'red' : 'teal'}"${attr('data-testid', testid)}>
        <summary class="settings-row-summary"><span class="settings-row-label">${escapeHtml(summary)}</span></summary>
        <form action="${escapeHtml(action)}" method="${method}" class="settings-form settings-ask-form">
          <p class="settings-ask-text">${escapeHtml(willHappen)}</p>${hiddenInputs(fields)}${reasonHtml}
          <button type="submit" class="action-btn settings-ask-confirm"${attr('data-testid', testid ? `${testid}-confirm` : '')}>${escapeHtml(confirmLabel)}</button>
        </form>
      </details>`;
}

/** The sidebar. `states` maps area id → `{ text, tone }`. */
export function renderSettingsNav({ urlKey, states, current }) {
  const groups = AREA_GROUPS.map(g => {
    const items = AREAS.filter(a => a.group === g.id).map(a => {
      const st = states[a.id] || { text: '', tone: 'ok' };
      const isCurrent = a.id === current;
      return `
          <li><a class="settings-nav-link${isCurrent ? ' is-current' : ''}" href="${escapeHtml(settingsAreaUrl(urlKey, a.id))}" data-testid="settings-nav-${a.id}"${isCurrent ? ' aria-current="page"' : ''}>
            <span class="settings-nav-label">${escapeHtml(a.label)}</span>
            <span class="settings-state settings-state-${st.tone === 'bad' ? 'bad' : 'ok'}" data-testid="settings-state-${a.id}">${st.tone === 'bad' ? '<span class="settings-dot" aria-hidden="true" data-testid="settings-dot-${a.id}"></span>' : ''}${escapeHtml(st.text)}</span><span class="settings-chevron" aria-hidden="true">›</span>
          </a></li>`;
    }).join('');
    return `
      <div class="settings-nav-group">
        <h2 class="settings-nav-title">${escapeHtml(g.title)}</h2>
        <ul class="settings-nav-list">${items}
        </ul>
      </div>`;
  }).join('');
  return `<nav class="settings-nav" aria-label="Settings areas" data-testid="settings-nav">${groups}
    </nav>`;
}

/**
 * The page frame. `view` is 'index' (phone shows the list) or 'area' (phone
 * shows the page with "‹ Settings"). Desktop shows both side by side, the
 * area full-width beside the sidebar when `wide`.
 */
export function renderSettingsShell({ urlKey, states, area, view, bodyHtml }) {
  return `<div class="settings-shell" data-view="${view}" data-area="${escapeHtml(area.id)}"${area.wide ? ' data-wide="true"' : ''} data-testid="settings-area-${escapeHtml(area.id)}">
    ${renderSettingsNav({ urlKey, states, current: area.id })}
    <div class="settings-pane" data-testid="settings-pane">
      <a class="settings-back" href="${escapeHtml(settingsAreaUrl(urlKey))}" data-testid="settings-back">‹ Settings</a>
      <h2 class="settings-area-title">${escapeHtml(area.label)}</h2>${bodyHtml}
    </div>
  </div>`;
}
