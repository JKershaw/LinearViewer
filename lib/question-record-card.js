/**
 * LIN-4532 (LIN-4529 P2b): the card for an open question RECORD (lib/open-questions.js), shared by the server pages and the
 * Rulings page. Pure: no I/O, so the browser imports it as well (`/lib/question-record-card.js`).
 *
 * The card carries the question's id, its workspace and what the person sees. It sends nothing itself: the browser's handler
 * (public/question-records.js) posts the answer or the dismissal to the one route each (routes/question-answers.js), and shows
 * the outcome the route reports (questionOutcomeText). A run still working is read-only, as the route refuses it.
 */
import { escapeHtml } from './utils/html.js';

const esc = (v) => escapeHtml(String(v ?? ''));

/** The "if you don't answer" line: the question's own words, else a fallback worded by whether the run is still waiting. */
export function questionIfUnanswered(row) {
  if (typeof row.ifUnanswered === 'string' && row.ifUnanswered.trim()) return row.ifUnanswered.trim();
  return row.state === 'resumable' ? 'Harbour keeps waiting for your answer.' : 'Nothing further runs; the run has ended.';
}

/**
 * One question's card. Options are real buttons; the recommended one (when it names an offered option) is the main button and
 * comes first. Choosing an option and writing your own words are two parts of one answer, sent together.
 * @param {object} row - a row from openQuestionsFor: {questionId, asks, options, recommended, ifUnanswered, state, interactive}
 * @param {{urlKey: string}} ctx
 */
export function renderQuestionRecordCard(row, { urlKey }) {
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

/** The route for one question's answer or dismissal, relative to the site root. */
export function questionActionPath(urlKey, questionId, action) {
  return `/workspace/${encodeURIComponent(urlKey)}/questions/${encodeURIComponent(questionId)}/${action}`;
}
