/**
 * Ask in place (LIN-3890, moved from lib/render-settings-shell.js). The panel
 * says what will happen, optionally asks why (required, at most
 * REASON_MAX_LENGTH), then confirms. `tone:'red'` for removals and stops.
 * Confirm and Cancel become the real control in group 4 of LIN-3890.
 */

import { escapeHtml } from '../utils/html.js';
import { attr, hiddenInputs } from './settings-row.js';

/** Matches MAX_REASON_LENGTH in lib/model-routing-store.js (the reason cap everyone-changes share). */
export const REASON_MAX_LENGTH = 500;

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
          <button type="submit" class="btn btn--${tone === 'red' ? 'red' : 'teal'} settings-ask-confirm"${attr('data-testid', testid ? `${testid}-confirm` : '')}>${escapeHtml(confirmLabel)}</button>
        </form>
      </details>`;
}
