/**
 * lib/waiting-section.js — Home's "Waiting on you" section, one renderer for the page and the live fragment (LIN-4242).
 *
 * `lib/render.js` draws the section inside Home's document, and `GET /workspace/:urlKey/api/home-waiting` draws the same
 * section for the live refresh. Both call this function over the same reduction (`createWaitingStanding`,
 * lib/home-row-states.js), so the cards cannot differ between the page and a refresh. The page also passes the owner's
 * open records (LIN-4494), which the live fragment does not carry, so they are drawn on the page load only. Open question
 * records (LIN-4532) are in the fragment too: the live merge keys each by its question id (finding-dca7ac9d).
 */

import { taskPageHref } from './task-page-href.js';
import { escapeHtml } from './utils/html.js';
import { renderWaitingRecordLine } from './render-task-records.js';
import { renderQuestionRecordCard } from './question-record-card.js';

// LIN-4549: Home's own task line (waitingTaskLine) is gone: the card draws its task line itself (lib/question-record-card.js
// questionTaskLine), the same on every surface. Home's state words on that line, "needs you" (LIN-4009's shared look: the same
// words and tone as a row), are Home's alone, so they are given to the card here, in one place.
const NEEDS_YOU = Object.freeze({ words: 'needs you', tone: 'needs-you' });

/**
 * LIN-4114: Home's "Waiting on you", the first desk section. One card per open question (`waiting.questions`, nothing capped),
 * each through the question record card (lib/question-record-card.js), which leads with its task line (LIN-4549). A row with
 * no task is labelled as the workspace. Owner only: a member gets no section at all. No `data-identifier` here, so a
 * waiting task is not counted twice on Home (the duplicate check reads `data-identifier`).
 *
 * LIN-4242: for the owner the section is always drawn, hidden when nothing is open, so a question asked after load
 * has a section to land in and the live refresh (public/waiting-merge.js, public/app.js) never has to create one. The
 * `waiting-body` is the live region the refresh merges into; the `.hidden` class is the empty hide reason, and search
 * sets its own reason on the same element (public/app.js), so the two never overwrite each other.
 *
 * @param {{rows?: Array<Object>, questions?: Array<Object>, records?: Array<Object>}|null|undefined} waiting - the reduction's
 *   rows, the open questions (lib/open-questions.js rows, each with its task's `title` when the caller's lookup knew it) and the
 *   owner's records
 * @param {{urlKey: string, owner: boolean}} opts
 * @returns {string} the section's markup, or '' for a non-owner
 */
export function renderWaitingSection(waiting, { urlKey, owner }) {
  if (!owner) return '';
  // LIN-4494: the person's open records, after the questions in the same body. They are not `.waiting-question` wrappers, so the
  // live merge (public/waiting-merge.js) never touches them: they are drawn on the page load.
  const records = waiting?.records || [];
  const recordsHtml = records.map(view => renderWaitingRecordLine(view, { urlKey })).join('\n');
  // LIN-4532 (P2b): an open question record is a card in a `.waiting-question` wrapper, keyed by its question id in the live merge
  // (public/waiting-merge.js). Its answer and dismissal go through the one route each (public/question-records.js). LIN-4549: the
  // card draws its own task line (identifier linked to the task page, title, and Home's "needs you"); a question with no task is
  // labelled as the workspace, as Home's line always did.
  const questions = waiting?.questions || [];
  const taskHref = (identifier) => taskPageHref({ urlKey, identifier, source: null });
  const questionsHtml = questions.map(row => {
    const card = row.ticket ? row : { ...row, title: row.title || 'Workspace' };
    return `<div class="waiting-question" data-testid="waiting-question">${renderQuestionRecordCard(card, { urlKey, taskHref, taskState: row.ticket ? NEEDS_YOU : null })}</div>`;
  }).join('\n');
  // LIN-4538 (P7a): the standing's rows are the open questions themselves (lib/ruling-standing.js), and they are drawn as the
  // question cards above, through the one answer and dismiss routes (the old ruling card retired with its route, LIN-4541).
  const hidden = records.length === 0 && questions.length === 0 ? ' hidden' : '';
  return `
  <div class="waiting-section${hidden}" role="region" aria-label="Waiting on you" data-testid="waiting-on-you" data-url-key="${escapeHtml(urlKey)}">
    <div class="waiting-header" data-testid="waiting-header">▼ Waiting on you</div>
    <div class="waiting-body" data-testid="waiting-body">
      ${questionsHtml}${recordsHtml ? `\n${recordsHtml}` : ''}
    </div>
  </div>`;
}
