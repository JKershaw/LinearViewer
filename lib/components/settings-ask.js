/**
 * Ask in place (LIN-3890, moved from lib/render-settings-shell.js). The panel
 * says what will happen, optionally asks why (required, at most
 * REASON_MAX_LENGTH), then confirms or cancels. The one confirm pattern for
 * every Settings area rebuilt by LIN-3890: no native `confirm()`.
 *
 * Two transports, one look:
 *  - `form` (default): the Confirm submits a form to `action` with `method`
 *    POST. Works with no script. A GET or other method is refused here, so a
 *    browser can never fall back to GET on a write.
 *  - `script`: the Confirm is a `type="button"` that public/settings.js sends
 *    with `fetch(route, { method })` (`data-settings-ask-route`,
 *    `data-settings-ask-method`). Used where the write is a DELETE (key revoke):
 *    the existing DELETE routes stay the only write path.
 *
 * Cancel is a link to `cancelHref` (the area's own URL, so with no script the
 * page reloads closed) and public/settings.js closes the panel in place when it
 * runs. Confirm is `btn btn--primary`, or `btn btn--red` for a stop, removal or
 * revoke. Cancel is `btn--quiet`.
 */

import { escapeHtml } from '../utils/html.js';
import { attr, hiddenInputs } from './settings-row.js';

/** Matches MAX_REASON_LENGTH in lib/model-routing-store.js (the reason cap everyone-changes share). */
export const REASON_MAX_LENGTH = 500;

const TRANSPORT_METHODS = Object.freeze({ form: ['POST'], script: ['DELETE'] });

/**
 * @param {Object} opts
 * @param {string} opts.summary - the row's label while closed
 * @param {string} opts.willHappen - what will happen, in plain words
 * @param {boolean} [opts.askWhy] - ask for a reason (required)
 * @param {string} [opts.action] - form transport: the route the form posts to
 * @param {string} [opts.method] - form transport: must be POST; script transport: DELETE
 * @param {'form'|'script'} [opts.transport]
 * @param {Array<[string, string]>} [opts.fields] - hidden fields (form transport)
 * @param {string} [opts.confirmLabel]
 * @param {'teal'|'red'} [opts.tone]
 * @param {string} [opts.cancelHref] - the area's URL; Cancel links here
 * @param {string} [opts.testid]
 */
export function askInPlace({
  summary, willHappen, askWhy = false, action = '', method = 'POST', transport = 'form',
  fields = [], confirmLabel = 'Confirm', tone = 'red', cancelHref = '', testid = ''
}) {
  const red = tone === 'red';
  const confirmClass = `btn ${red ? 'btn--red' : 'btn--primary'} settings-ask-confirm`;
  if (!TRANSPORT_METHODS[transport]) throw new Error(`askInPlace: unknown transport "${transport}"`);
  if (!TRANSPORT_METHODS[transport].includes(method)) {
    throw new Error(`askInPlace: ${transport} transport takes ${TRANSPORT_METHODS[transport].join(' or ')}, not "${method}"`);
  }
  const reasonHtml = askWhy
    ? `
          <label class="settings-ask-label">Why?
            <textarea name="reason" required maxlength="${REASON_MAX_LENGTH}" rows="2" class="settings-ask-reason"${attr('data-testid', testid ? `${testid}-reason` : '')}></textarea>
          </label>`
    : '';
  const cancelHtml = `<a class="btn--quiet settings-ask-cancel" href="${escapeHtml(cancelHref || '#')}" data-settings-ask-cancel${attr('data-testid', testid ? `${testid}-cancel` : '')}>Cancel</a>`;
  const actions = `
          <div class="settings-ask-actions">${transport === 'script'
            ? `<button type="button" class="${confirmClass}" data-settings-ask-route="${escapeHtml(action)}" data-settings-ask-method="${escapeHtml(method)}"${attr('data-testid', testid ? `${testid}-confirm` : '')}>${escapeHtml(confirmLabel)}</button>`
            : `<button type="submit" class="${confirmClass}"${attr('data-testid', testid ? `${testid}-confirm` : '')}>${escapeHtml(confirmLabel)}</button>`}
            ${cancelHtml}
          </div>`;
  const body = `
          <p class="settings-ask-text">${escapeHtml(willHappen)}</p>${hiddenInputs(fields)}${reasonHtml}${actions}`;
  const inner = transport === 'script'
    ? `<div class="settings-form settings-ask-form">${body}</div>`
    : `<form action="${escapeHtml(action)}" method="${method}" class="settings-form settings-ask-form">${body}
        </form>`;
  return `
      <details class="settings-row settings-ask settings-action-${red ? 'red' : 'teal'}"${attr('data-testid', testid)}>
        <summary class="settings-row-summary"><span class="settings-row-label">${escapeHtml(summary)}</span></summary>
        ${inner}
      </details>`;
}
