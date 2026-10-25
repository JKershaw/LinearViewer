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
 * A status line under a group: the result of an action (`tone` 'ok') or a failure ('bad', which
 * keeps the `settings-flash-error` contract). `actionHtml` is an optional action on the same line.
 */
export function statusLine({ tone = 'ok', text, actionHtml = '', testid = '', className = '' }) {
  const flash = tone === 'bad' ? 'settings-flash settings-flash-error' : 'settings-flash';
  return `<div class="settings-note ${flash}${className ? ` ${className}` : ''}"${attr('data-testid', testid)}><span>${escapeHtml(text)}</span>${actionHtml}</div>`;
}

/**
 * The rows list and its note, without a heading: the part of a group that a
 * Plain page's `rows` section shares with Settings (LIN-3956). The Plain page
 * titles it with its own section heading, so it does not get `group()`'s h2.
 */
export function rowsList({ rowsHtml, note = '' }) {
  return `<div class="settings-rows">${rowsHtml}
      </div>${note ? `\n      ${groupNote(note)}` : ''}`;
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
      ${rowsList({ rowsHtml, note })}
    </section>`;
}
