/**
 * LIN-4532 (LIN-4529 P2b): the card for an open question RECORD (lib/open-questions.js), shared by the server pages (Home, the
 * run page, the task page) and the browser (the Rulings page, Flight Companion). Pure: no I/O, so the browser imports it as well
 * (`/lib/question-record-card.js`).
 *
 * The card carries the question's id, its workspace and what the person sees. It sends nothing itself: the browser's handler
 * (public/question-records.js) posts the answer or the dismissal to the one route each (routes/question-answers.js), and shows
 * the outcome the route reports (questionOutcomeText). A run still working is read-only, as the route refuses it.
 */
// A leaf: it imports nothing (tests/unit/shared-modules.test.js), so the escape is its own, the same five characters lib/utils/html.js escapes.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** The "if you don't answer" line: the question's own words, else a fallback worded by whether the run is still waiting. */
export function questionIfUnanswered(row) {
  if (typeof row.ifUnanswered === 'string' && row.ifUnanswered.trim()) return row.ifUnanswered.trim();
  return row.state === 'resumable' ? 'Harbour keeps waiting for your answer.' : 'Nothing further runs; the run has ended.';
}

/**
 * LIN-4549 (LIN-4162): the card's own task line: the task's identifier in mono (a machine fact), then its title in the page face.
 * The identifier links to the task page when the host gives `taskHref` (this leaf imports nothing, so the host owns the URL rule).
 * A title the tracker does not know, or one that only repeats the identifier, is left out: the line is the identifier alone, with
 * no gap. `taskState` is a host's state words on the line ({words, tone}: Home's "needs you", the row look of LIN-4009).
 * No identifier and no title: no line.
 */
export function questionTaskLine(row, { taskHref = null, taskState = null } = {}) {
  const id = typeof row.ticket === 'string' && row.ticket ? row.ticket : null;
  const title = typeof row.title === 'string' && row.title.trim() && row.title.trim() !== id ? row.title.trim() : null;
  if (!id && !title) return '';
  const href = id && typeof taskHref === 'function' ? taskHref(id) : null;
  const parts = [];
  if (id) {
    parts.push(href
      ? `<a class="sess-qcard-task-id" href="${esc(href)}" data-testid="question-record-card-task-id">${esc(id)}</a>`
      : `<span class="sess-qcard-task-id" data-testid="question-record-card-task-id">${esc(id)}</span>`);
  }
  if (title) parts.push(`<span class="sess-qcard-task-title" data-testid="question-record-card-task-title">${esc(title)}</span>`);
  if (taskState && taskState.words) parts.push(`<span class="row-state" data-tone="${esc(taskState.tone)}" data-testid="issue-row-state">${esc(taskState.words)}</span>`);
  return `<p class="sess-qcard-task" data-testid="question-record-card-task">${parts.join(' ')}</p>`;
}

/**
 * One question's card. Options are real buttons; the recommended one (when it names an offered option) is the main button and
 * comes first. Choosing an option and writing your own words are two parts of one answer, sent together. The card leads with its
 * task line (questionTaskLine).
 * @param {object} row - a row from openQuestionsFor: {questionId, asks, options, recommended, ifUnanswered, state, interactive,
 *   ticket, title}
 * @param {{urlKey: string, taskHref?: (identifier: string) => string, taskState?: {words: string, tone: string}}} ctx
 */
export function renderQuestionRecordCard(row, { urlKey, taskHref = null, taskState = null }) {
  const options = Array.isArray(row.options) ? row.options : [];
  const recommended = typeof row.recommended === 'string' && options.includes(row.recommended) ? row.recommended : null;
  const ordered = recommended ? [recommended, ...options.filter((o) => o !== recommended)] : options;
  const optionsHtml = ordered.length
    ? `<div class="sess-qcard-options" role="group" aria-label="Answer options" data-testid="question-record-card-options">${ordered.map((o) => `<button type="button" class="btn${o === recommended ? ' btn--primary' : ''} sess-qcard-option" data-option-id="${esc(o)}" data-testid="question-record-card-option" aria-pressed="false"${o === recommended ? ' data-recommended="true"' : ''}>${esc(o)}</button>`).join('')}</div>`
    : '';
  const controls = row.interactive === false
    ? `<p class="sess-qcard-readonly" data-testid="question-record-card-readonly">Harbour is still working; you can answer when it pauses.</p>`
    : `${optionsHtml}
      <textarea class="sess-qcard-input" data-testid="question-record-card-input" rows="2" placeholder="your own answer…" aria-label="Your own answer"></textarea>
      <div class="sess-qcard-actions">
        <button type="button" class="action-btn sess-qcard-answer" data-testid="question-record-card-answer">Answer</button>
        <button type="button" class="sess-qcard-dismiss" data-testid="question-record-card-dismiss">this wasn't worth asking</button>
        <span class="sess-qcard-feedback" role="status" aria-live="polite" data-testid="question-record-card-feedback"></span>
      </div>`;
  return `<div class="sess-qcard sess-qrecord" data-testid="question-record-card" data-question-id="${esc(row.questionId)}" data-url-key="${esc(urlKey)}" data-state="${esc(row.state)}">
      ${questionTaskLine(row, { taskHref, taskState })}
      <p class="sess-qcard-question" data-testid="question-record-card-question">${esc(row.asks)}</p>
      ${controls}
      <p class="sess-qcard-if-unanswered" data-testid="question-record-card-if-unanswered">if you don't answer: ${esc(questionIfUnanswered(row))}</p>
    </div>`;
}

/**
 * What the card says once the route has answered. `body` is the route's JSON: `resumed`, and `notResumedBecause` when the run
 * was not resumed (stopped, or no session left). Pure, so the browser and the tests read one wording.
 * @param {'answer'|'dismiss'} action
 * @param {object} body
 */
export function questionOutcomeText(action, body) {
  if (body?.error) return body.error;
  const done = action === 'answer' ? 'Answered' : 'Dismissed';
  if (body?.resumed) {
    return action === 'answer' ? 'Answered. The run resumes with your answer.' : 'Dismissed. The run is told and takes its fallback.';
  }
  if (body?.notResumedBecause === 'stopped') return `${done}. The run was stopped, so it was not resumed.`;
  if (body?.notResumedBecause) return `${done}. No session is left to resume; dispatch the next stage to carry it on.`;
  return `${done}.`;
}

/**
 * The question record cards of one list (the run page's pinned cards, the task page's question section): each card in its own
 * wrapper, in the order given. '' for none, so a page with no open questions draws nothing.
 * @param {Array<Object>} rows - rows from openQuestionsFor
 * @param {{urlKey: string, testid?: string, taskHref?: (identifier: string) => string}} ctx
 */
export function renderQuestionRecordCards(rows, { urlKey, testid = 'question-record-cards', taskHref = null }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return '';
  return `<div class="sess-qrecords" data-testid="${esc(testid)}">${list.map((row) => renderQuestionRecordCard(row, { urlKey, taskHref })).join('')}</div>`;
}

/** The route for one question's answer or dismissal, relative to the site root. */
export function questionActionPath(urlKey, questionId, action) {
  return `/workspace/${encodeURIComponent(urlKey)}/questions/${encodeURIComponent(questionId)}/${action}`;
}
