/**
 * lib/waiting-section.js — Home's "Waiting on you" section, one renderer for the page and the live fragment (LIN-4242).
 *
 * `lib/render.js` draws the section inside Home's document, and `GET /workspace/:urlKey/api/home-waiting` draws the same
 * section for the live refresh. Both call this function over the same reduction (`readWaitingStanding`), so the cards
 * cannot differ between the page and a refresh.
 */

import { taskPageHref } from './task-page-href.js';
import { renderDecisionCard } from './question-card.js';
import { escapeHtml } from './utils/html.js';

/**
 * LIN-4114: Home's "Waiting on you", the first desk section. One card per open ruling (`waiting.rows`, nothing capped),
 * each through the shared card renderer (lib/question-card.js), under a task line that links to the task page. A row with
 * no task is labelled as the workspace. Owner only: a member gets no section at all. No `data-identifier` here, so a
 * waiting task is not counted twice on Home (the duplicate check reads `data-identifier`).
 *
 * LIN-4242: for the owner the section is always drawn, hidden when no rulings are open, so a ruling raised after load
 * has a section to land in and the live refresh (public/question-cards.js, public/app.js) never has to create one. The
 * `waiting-body` is the live region the refresh merges into; the `.hidden` class is the empty hide reason, and search
 * sets its own reason on the same element (public/app.js), so the two never overwrite each other.
 *
 * @param {{rows: Array<Object>, titles?: Object<string, string>}|null|undefined} waiting - the reduction's rows and the
 *   task titles the page knows (the live fragment passes `waitingTitlesOf` over the held issue set; with no titles a task
 *   line falls back to `anchor.issueTitle`)
 * @param {{urlKey: string, owner: boolean}} opts
 * @returns {string} the section's markup, or '' for a non-owner
 */
export function renderWaitingSection(waiting, { urlKey, owner }) {
  if (!owner) return '';
  const rows = waiting?.rows || [];
  const titles = waiting?.titles || {};
  const cards = rows.map(row => {
    const anchor = row.anchor || {};
    const identifier = anchor.issueIdentifier || '';
    const title = identifier ? (titles[identifier] || anchor.issueTitle || identifier) : 'Workspace';
    const href = taskPageHref({ urlKey, identifier, source: anchor.source || null });
    // The needs-you state reads on the task line as it does on a row (the shared look, LIN-4009): the same words and tone.
    const stateWords = `<span class="row-state" data-tone="needs-you" data-testid="issue-row-state">needs you</span>`;
    const line = identifier
      ? `<div class="waiting-task-line" data-testid="waiting-task-line"><a class="waiting-task-link" href="${escapeHtml(href)}">${escapeHtml(identifier)}</a> <span class="waiting-task-title">${escapeHtml(title)}</span> ${stateWords}</div>`
      : `<div class="waiting-task-line" data-testid="waiting-task-line"><span class="waiting-task-title">${escapeHtml(title)}</span></div>`;
    return `<div class="waiting-card">${line}${renderDecisionCard(row, { urlKey, canReply: true, sessionTerminal: false, sessionWaiting: false })}</div>`;
  }).join('\n');
  const hidden = rows.length === 0 ? ' hidden' : '';
  return `
  <div class="waiting-section${hidden}" role="region" aria-label="Waiting on you" data-testid="waiting-on-you" data-url-key="${escapeHtml(urlKey)}">
    <div class="waiting-header" data-testid="waiting-header">▼ Waiting on you</div>
    <div class="waiting-body" data-testid="waiting-body">
      ${cards}
    </div>
  </div>`;
}

/**
 * LIN-4242: the task titles a waiting card's task line shows, from the held issue set (`taskFacts.read`'s `issues`), for the
 * identifiers the rulings name. The page reads the same titles from its full trees; the live fragment reads them here, so a
 * card added by a refresh is titled as the page would title it. When the held set is cold, the caller passes no issues and
 * the task line falls back to `anchor.issueTitle`, as before. First match wins, as the page's own walk does.
 *
 * @param {Array<{identifier: string, title?: string}>|null|undefined} issues
 * @param {Array<string>} identifiers
 * @returns {Object<string, string>}
 */
export function waitingTitlesOf(issues, identifiers) {
  const wanted = new Set(identifiers);
  const titles = {};
  for (const issue of issues || []) {
    const id = issue?.identifier;
    if (id && wanted.has(id) && !(id in titles)) titles[id] = issue.title || '';
  }
  return titles;
}
