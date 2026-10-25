/**
 * The key row (LIN-3890, ui-pieces.md row 11): one key that can get into a workspace, built on
 * `drillRow`. The name leads, then the kind, the relative expiry and the last use. A problem is
 * flagged on the row itself (no owner, waiting), and Revoke is an ask in place with a real Confirm
 * and Cancel, sent through the DELETE route by the script transport.
 *
 * `now` is injected by the caller so a test can freeze the clock; `cancelHref` is the page Cancel
 * returns to. Styles are owned by public/settings.css.
 */

import { escapeHtml } from '../utils/html.js';
import { formatRelativeTime } from '../render.js';
import { drillRow } from './settings-row.js';
import { askInPlace } from './settings-ask.js';

export function keyRow(k, { now, cancelHref }) {
  const name = k.label || k.kind;
  const expiry = k.expiresAt ? `expires ${formatRelativeTime(k.expiresAt, now)}` : 'no expiry';
  const used = k.lastUsedAt ? `last used ${formatRelativeTime(k.lastUsedAt, now)}` : 'never used';
  const flags = [!k.hasOwner && 'no owner · re-issue', k.waiting && 'waiting to be used'].filter(Boolean);
  const flagHtml = flags.map(f => `<span class="settings-row-flag" data-testid="settings-key-flag">${escapeHtml(f)}</span>`).join('');
  const revoke = k.revoke.allowed
    ? askInPlace({
      summary: 'Revoke this key', willHappen: 'Anything using this key stops working. This cannot be undone.',
      transport: 'script', method: 'DELETE', action: k.revoke.route, confirmLabel: 'Revoke key', tone: 'red',
      cancelHref, testid: 'settings-key-revoke'
    })
    : `<p class="settings-note" data-testid="settings-key-owner-only">${escapeHtml(k.revoke.ownerOnlyNote)}</p>`;
  const body = `
          <p class="settings-ask-text">${escapeHtml(k.can)}${k.label ? ` · ${escapeHtml(k.label)}` : ''}</p>${revoke}`;
  return drillRow({
    label: name,
    value: `${k.kind} · ${expiry} · ${used}`,
    flagHtml,
    bodyHtml: body, testid: `settings-key-${k.source}`
  });
}
