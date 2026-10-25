/**
 * Settings frame (LIN-3890, moved from lib/render-settings-shell.js): the
 * sidebar of areas and the page frame around one area. The frame is the one
 * place the phone list, the "‹ Settings" back link and the area title meet.
 */

import { escapeHtml } from '../utils/html.js';
import { AREAS, AREA_GROUPS, settingsAreaUrl } from '../settings-areas.js';

/** The sidebar. `states` maps area id → `{ text, tone }`. */
export function renderSettingsNav({ urlKey, states, current }) {
  const groups = AREA_GROUPS.map(g => {
    const items = AREAS.filter(a => a.group === g.id).map(a => {
      const st = states[a.id] || { text: '', tone: 'ok' };
      const isCurrent = a.id === current;
      return `
          <li><a class="settings-nav-link${isCurrent ? ' is-current' : ''}" href="${escapeHtml(settingsAreaUrl(urlKey, a.id))}" data-testid="settings-nav-${a.id}"${isCurrent ? ' aria-current="page"' : ''}>
            <span class="settings-nav-label">${escapeHtml(a.label)}</span>
            <span class="settings-state settings-state-${st.tone === 'bad' ? 'bad' : 'ok'}" data-testid="settings-state-${a.id}">${st.tone === 'bad' ? `<span class="settings-dot" aria-hidden="true" data-testid="settings-dot-${a.id}"></span>` : ''}${escapeHtml(st.text)}</span><span class="settings-chevron" aria-hidden="true">›</span>
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
