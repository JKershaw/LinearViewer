/**
 * Group pieces (LIN-3890, moved from lib/render-settings-shell.js): the note
 * under a group and the grouped list whose title says who it affects.
 */

import { escapeHtml } from '../utils/html.js';
import { attr } from './settings-row.js';

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
