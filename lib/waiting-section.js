/**
 * lib/waiting-section.js — Home's "Waiting on you" section, one renderer for the page and the live fragment (LIN-4242).
 *
 * `lib/render.js` draws the section inside Home's document, and `GET /workspace/:urlKey/api/home-waiting` draws the same
 * section for the live refresh. Both call this function over the same reduction (`createWaitingStanding`,
 * lib/home-row-states.js), so the cards cannot differ between the page and a refresh. Open question records (LIN-4532) are in
 * the fragment: the live merge keys each by its question id (finding-dca7ac9d). LIN-4552: so are the owner's notes (open
 * findings), keyed `record:<id>` (public/waiting-notes.js), so a note no longer waits for a reload (finding-d4767b81).
 */

import { taskPageHref } from './task-page-href.js';
import { escapeHtml } from './utils/html.js';
import { renderQuestionRecordCard, formatQuestionAsk } from './question-record-card.js';

// LIN-4552: the section says "Waiting on you" once, in its header, so a card's task line carries no state words of its own here
// (the "needs you" LIN-4549 gave it said the header again on every card). The state word stays where a task's state is the point:
// the rows and the task page, which read one table (lib/task-state.js STATE_WORDS).

/** LIN-4552: the notes "Notes for you" shows before its fold; the rest open with "show N more" (the list's `data-shown`). */
export const NOTES_SHOWN = 5;

/** LIN-4552: the key a note's line carries for the live merge (public/waiting-notes.js noteKeyOf reads it back), from its record id. */
export const noteKeyFor = (recordId) => `record:${recordId}`;

/**
 * LIN-4552: one note, a short line: the task's identifier (mono, a machine fact) and title, linking to the task page, then the first
 * sentence of what the finding says (a very long one is shortened, with the whole note behind the fold), and a quiet clear button. A finding whose task
 * claims no ticket reads without the task part: never the raw task record id. No person id and no time are printed.
 * @param {{recordId: string, says?: string, lead?: string, ticket?: string|null, title?: string|null}} note - an openFindingsFor row
 * @param {{urlKey: string, folded?: boolean}} ctx - `folded`: the line is past the fold (shown when the list is expanded)
 */
export function renderNoteLine(note, { urlKey, folded = false }) {
  const ticket = typeof note.ticket === 'string' && note.ticket ? note.ticket : null;
  const title = ticket && typeof note.title === 'string' && note.title.trim() && note.title.trim() !== ticket ? note.title.trim() : null;
  const task = ticket
    ? `<a class="waiting-note-task" href="${escapeHtml(taskPageHref({ urlKey, identifier: ticket, source: null }))}" data-testid="waiting-note-task"><span class="waiting-note-id" data-testid="waiting-note-id">${escapeHtml(ticket)}</span>${title ? ` <span class="waiting-note-title" data-testid="waiting-note-title">${escapeHtml(title)}</span>` : ''}</a>`
    : '';
  const says = typeof note.says === 'string' ? note.says.trim() : '';
  const lead = (typeof note.lead === 'string' && note.lead.trim()) || says.split(/\r?\n/).find((l) => l.trim())?.trim() || 'A note with no words';
  const more = says && says.replace(/\s+/g, ' ') !== lead.replace(/\s+/g, ' ')
    ? `<details class="waiting-note-fold" data-testid="waiting-note-fold"><summary class="waiting-note-fold-summary">more</summary><div class="waiting-note-full" data-testid="waiting-note-full">${formatQuestionAsk(says)}</div></details>`
    : '';
  return `<li class="waiting-note" data-testid="waiting-note" data-key="${escapeHtml(noteKeyFor(note.recordId))}" data-record-id="${escapeHtml(note.recordId)}"${folded ? ' data-folded="true"' : ''}>`
    + `<div class="waiting-note-line">${task}<span class="waiting-note-says" data-testid="waiting-note-says">${escapeHtml(lead)}</span>`
    + `<button type="button" class="btn--quiet waiting-note-clear" data-testid="waiting-note-clear" aria-label="Clear this note">clear</button></div>`
    + `${more}<span class="waiting-note-feedback" role="status" aria-live="polite" data-testid="waiting-note-feedback"></span></li>`;
}

/**
 * LIN-4552: the fold's control, with both of its labels: "show N more" while the list is folded, "show fewer" once it is open. The
 * browser (public/waiting-notes.js syncNotesGroup) writes only the number and shows one label or the other, so the words live here.
 * @param {number} hidden - the notes behind the fold
 */
export function renderNotesMore(hidden) {
  return `<button type="button" class="btn--quiet waiting-notes-more${hidden ? '' : ' hidden'}" data-testid="waiting-notes-more" aria-expanded="false">`
    + `<span data-testid="waiting-notes-more-closed">show <span data-testid="waiting-notes-hidden-count">${hidden}</span> more</span>`
    + `<span class="hidden" data-testid="waiting-notes-more-open">show fewer</span></button>`;
}

/**
 * LIN-4552: "Notes for you", the quieter group under the questions: every note in one list, the first NOTES_SHOWN shown and the rest
 * marked `data-folded`, which the list's own state shows (style.css: `[data-expanded]`), so the live merge never moves a line between
 * two lists. The list carries NOTES_SHOWN as `data-shown`, the one number the browser re-marks by (public/waiting-notes.js). Always
 * drawn for the owner, hidden when empty, so a note that arrives after load has a group to land in.
 * @param {Array<Object>} notes - openFindingsFor rows
 * @param {{urlKey: string}} ctx
 */
export function renderNotesGroup(notes, { urlKey }) {
  const list = Array.isArray(notes) ? notes : [];
  const hidden = Math.max(0, list.length - NOTES_SHOWN);
  return `<div class="waiting-notes${list.length ? '' : ' hidden'}" role="group" aria-label="Notes for you" data-testid="waiting-notes">
      <h3 class="waiting-notes-title" data-testid="waiting-notes-title">Notes for you</h3>
      <ul class="waiting-notes-list" data-testid="waiting-notes-list" data-shown="${NOTES_SHOWN}" data-expanded="false">${list.map((note, i) => renderNoteLine(note, { urlKey, folded: i >= NOTES_SHOWN })).join('')}</ul>
      ${renderNotesMore(hidden)}
    </div>`;
}

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
 * LIN-4552: the questions come first; the owner's open findings follow as "Notes for you" (renderNotesGroup), the last child of the
 * body, which the question merge inserts before. Both the page and the live fragment draw them, so a note added after load appears
 * at the next tick (finding-d4767b81).
 *
 * @param {{questions?: Array<Object>, records?: Array<Object>}|null|undefined} waiting - the reduction's
 *   open questions (lib/open-questions.js rows, each with its task's `title` when the caller's lookup knew it) and the
 *   owner's notes (`records`, lib/open-questions.js openFindingsFor rows)
 * @param {{urlKey: string, owner: boolean}} opts
 * @returns {string} the section's markup, or '' for a non-owner
 */
export function renderWaitingSection(waiting, { urlKey, owner }) {
  if (!owner) return '';
  const notes = waiting?.records || [];
  // LIN-4532 (P2b): an open question record is a card in a `.waiting-question` wrapper, keyed by its question id in the live merge
  // (public/waiting-merge.js). Its answer and dismissal go through the one route each (public/question-records.js). LIN-4549: the
  // card draws its own task line (identifier linked to the task page, then the title); a question with no task is labelled as the
  // workspace, as Home's line always did.
  const questions = waiting?.questions || [];
  const taskHref = (identifier) => taskPageHref({ urlKey, identifier, source: null });
  const questionsHtml = questions.map(row => {
    const card = row.ticket ? row : { ...row, title: row.title || 'Workspace' };
    return `<div class="waiting-question" data-testid="waiting-question">${renderQuestionRecordCard(card, { urlKey, taskHref })}</div>`;
  }).join('\n');
  const hidden = notes.length === 0 && questions.length === 0 ? ' hidden' : '';
  return `
  <div class="waiting-section${hidden}" role="region" aria-label="Waiting on you" data-testid="waiting-on-you" id="waiting-on-you" data-url-key="${escapeHtml(urlKey)}">
    <div class="waiting-header" data-testid="waiting-header">▼ Waiting on you</div>
    <div class="waiting-body" data-testid="waiting-body">
      ${questionsHtml}
      ${renderNotesGroup(notes, { urlKey })}
    </div>
  </div>`;
}

/**
 * LIN-4552: the live fragment's answer (`GET .../api/home-waiting`, server.js), built here beside the section so it can be witnessed:
 * the section's markup and `count`, the number of open questions, the count line's and the badge's number. It was the standing's
 * rows plus the questions, the same questions twice; a note is never in it (finding-68be8578).
 * @param {{questions?: Array<Object>, records?: Array<Object>}} waiting - the reduction (createWaitingStanding)
 * @param {{urlKey: string}} opts
 * @returns {{html: string, count: number}}
 */
export function waitingFragmentOf(waiting, { urlKey }) {
  const questions = waiting?.questions || [];
  return { html: renderWaitingSection({ questions, records: waiting?.records || [] }, { urlKey, owner: true }), count: questions.length };
}
