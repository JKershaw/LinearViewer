/**
 * lib/waiting-section.js — Home's "Waiting on you" section, one renderer for the page and the live fragment (LIN-4242).
 *
 * `lib/render.js` draws the section inside Home's document, and `GET /workspace/:urlKey/api/home-waiting` draws the same
 * section for the live refresh. Both call this function over the same reduction (`createWaitingStanding`,
 * lib/home-row-states.js), so the cards cannot differ between the page and a refresh. The page also passes the owner's
 * open records (LIN-4494) and open question records (LIN-4532); the live fragment does not, so both are drawn on the page
 * load only (the fragment's count still includes the questions).
 */

import { taskPageHref } from './task-page-href.js';
import { renderDecisionCard } from './question-card.js';
import { escapeHtml } from './utils/html.js';
import { renderWaitingRecordLine } from './render-task-records.js';
import { renderQuestionRecordCard } from './question-record-card.js';

/**
 * The task line above a Waiting card (a ruling's or a question's): the task's identifier as a link to its task page, its title
 * and the needs-you state, which reads on the line as it does on a row (the shared look, LIN-4009: the same words and tone).
 * With no task the line names the workspace and has no link.
 */
function waitingTaskLine({ urlKey, identifier, title, source }) {
  if (!identifier) return `<div class="waiting-task-line" data-testid="waiting-task-line"><span class="waiting-task-title">${escapeHtml(title)}</span></div>`;
  const href = taskPageHref({ urlKey, identifier, source });
  const stateWords = `<span class="row-state" data-tone="needs-you" data-testid="issue-row-state">needs you</span>`;
  return `<div class="waiting-task-line" data-testid="waiting-task-line"><a class="waiting-task-link" href="${escapeHtml(href)}">${escapeHtml(identifier)}</a> <span class="waiting-task-title">${escapeHtml(title)}</span> ${stateWords}</div>`;
}

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
  // LIN-4494: the person's open records, after the rulings in the same body. They are not `.waiting-card` wrappers, so the
  // live merge (public/question-cards.js mergeWaitingCards) never touches them: they are drawn on the page load.
  const records = waiting?.records || [];
  const recordsHtml = records.map(view => renderWaitingRecordLine(view, { urlKey })).join('\n');
  // LIN-4532 (P2b): an open question record is a card, drawn the same way as a record (not a `.waiting-card`, so the live merge
  // leaves it alone), under its task line. Its answer and dismissal go through the one route each (public/question-records.js).
  const questions = waiting?.questions || [];
  const questionsHtml = questions.map(row => {
    const identifier = row.ticket || '';
    const line = waitingTaskLine({ urlKey, identifier, title: identifier ? (titles[identifier] || identifier) : 'Workspace', source: null });
    return `<div class="waiting-question" data-testid="waiting-question">${line}${renderQuestionRecordCard(row, { urlKey })}</div>`;
  }).join('\n');
  const cards = rows.map(row => {
    const anchor = row.anchor || {};
    const identifier = anchor.issueIdentifier || '';
    const title = identifier ? (titles[identifier] || anchor.issueTitle || identifier) : 'Workspace';
    const line = waitingTaskLine({ urlKey, identifier, title, source: anchor.source || null });
    return `<div class="waiting-card">${line}${renderDecisionCard(row, { urlKey, canReply: true, sessionTerminal: false, sessionWaiting: false })}</div>`;
  }).join('\n');
  const hidden = rows.length === 0 && records.length === 0 && questions.length === 0 ? ' hidden' : '';
  return `
  <div class="waiting-section${hidden}" role="region" aria-label="Waiting on you" data-testid="waiting-on-you" data-url-key="${escapeHtml(urlKey)}">
    <div class="waiting-header" data-testid="waiting-header">▼ Waiting on you</div>
    <div class="waiting-body" data-testid="waiting-body">
      ${cards}${questionsHtml ? `\n${questionsHtml}` : ''}${recordsHtml ? `\n${recordsHtml}` : ''}
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
