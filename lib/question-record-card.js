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
 * no gap.
 * No identifier and no title: no line.
 */
export function questionTaskLine(row, { taskHref = null } = {}) {
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
  return `<p class="sess-qcard-task" data-testid="question-record-card-task">${parts.join(' ')}</p>`;
}

/**
 * LIN-4551: the card's lead, the one-line question. The reader gives every row `short` (lib/open-questions.js: the written field,
 * else the lead derived from `asks` by lib/records/question-short.js), so this is that line. A row that reaches the card with none
 * (no reader writes one) leads with the ask's first line, never with the whole ask.
 */
export function questionLead(row) {
  if (typeof row.short === 'string' && row.short.trim()) return row.short.trim();
  const asks = typeof row.asks === 'string' ? row.asks : '';
  return (asks.split(/\r?\n/).find((line) => line.trim()) || '').trim();
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const CONTINUES = /^\s{2,}\S/;

/**
 * LIN-4551: the full ask as the fold shows it. Escape first, then keep the ask's shape and nothing else: a blank line ends a
 * paragraph, a single break is a <br>, "- " / "* " / "• " lines are a bulleted list and "1. " / "1) " lines a numbered one (an
 * indented line under an item continues it). The only tags out are p, br, ul, ol and li: no link (a markdown link stays its own
 * text), no raw HTML, no image. This leaf imports nothing, so the formatter is its own, not a markdown library.
 * @param {string} asks
 * @returns {string} HTML
 */
export function formatQuestionAsk(asks) {
  const lines = esc(asks).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag: 'ul'|'ol', items: string[][] }
  const flushPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${item.join('<br>')}</li>`).join('')}</${list.tag}>`); list = null; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      flushPara();
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push([(bullet || numbered)[1].trim()]);
      continue;
    }
    if (list && CONTINUES.test(line)) { list.items[list.items.length - 1].push(line.trim()); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out.join('');
}

/**
 * LIN-4551: the full ask behind a closed fold, under the lead. Left out when the ask says no more than the lead (a one-sentence
 * question), so the card never shows the same words twice.
 */
function questionAskFold(row, lead) {
  const asks = typeof row.asks === 'string' ? row.asks.trim() : '';
  if (!asks || asks.replace(/\s+/g, ' ') === lead.replace(/\s+/g, ' ')) return '';
  return `
      <details class="sess-qcard-ask" data-testid="question-record-card-ask">
        <summary class="sess-qcard-ask-summary">the full question</summary>
        <div class="sess-qcard-ask-body" data-testid="question-record-card-ask-body">${formatQuestionAsk(asks)}</div>
      </details>`;
}

/**
 * One question's card. Options are real buttons, one full-width row each in one style; the recommended one (when it names an
 * offered option) comes first and is labelled "recommended". Answer is the primary button, dismiss a quiet one (LIN-4551). Choosing an option and writing your own words are two parts of one answer, sent together. The card leads with its
 * task line (questionTaskLine), then the one-line question (questionLead), then the full ask behind a closed fold (LIN-4551).
 * @param {object} row - a row from openQuestionsFor: {questionId, short, asks, options, recommended, ifUnanswered, state,
 *   interactive, ticket, title}
 * @param {{urlKey: string, taskHref?: (identifier: string) => string}} ctx
 */
export function renderQuestionRecordCard(row, { urlKey, taskHref = null }) {
  const options = Array.isArray(row.options) ? row.options : [];
  const recommended = typeof row.recommended === 'string' && options.includes(row.recommended) ? row.recommended : null;
  const ordered = recommended ? [recommended, ...options.filter((o) => o !== recommended)] : options;
  // LIN-4551: every option is one row in one style; the recommended one comes first and carries its label (the old face made it the
  // main button, so the highlight never moved to another choice). The option's own words come first in the button, so its name
  // reads as the option; the label shows above them (style.css).
  const optionsHtml = ordered.length
    ? `<div class="sess-qcard-options" role="group" aria-label="Answer options" data-testid="question-record-card-options">${ordered.map((o) => `<button type="button" class="btn sess-qcard-option" data-option-id="${esc(o)}" data-testid="question-record-card-option" aria-pressed="false"${o === recommended ? ' data-recommended="true"' : ''}>${esc(o)}${o === recommended ? '<span class="sess-qcard-option-tag" data-testid="question-record-card-recommended">recommended</span>' : ''}</button>`).join('')}</div>`
    : '';
  const lead = questionLead(row);
  const controls = row.interactive === false
    ? `<p class="sess-qcard-readonly" data-testid="question-record-card-readonly">Harbour is still working; you can answer when it pauses.</p>`
    : `${optionsHtml}
      <textarea class="sess-qcard-input" data-testid="question-record-card-input" rows="2" placeholder="your own answer…" aria-label="Your own answer"></textarea>
      <div class="sess-qcard-actions">
        <button type="button" class="btn btn--primary sess-qcard-answer" data-testid="question-record-card-answer">Answer</button>
        <button type="button" class="btn--quiet sess-qcard-dismiss" data-testid="question-record-card-dismiss">this wasn't worth asking</button>
        <span class="sess-qcard-feedback" role="status" aria-live="polite" data-testid="question-record-card-feedback"></span>
      </div>`;
  return `<div class="sess-qcard sess-qrecord" data-testid="question-record-card" data-question-id="${esc(row.questionId)}" data-url-key="${esc(urlKey)}" data-state="${esc(row.state)}">
      ${questionTaskLine(row, { taskHref })}
      <p class="sess-qcard-question" data-testid="question-record-card-question">${esc(lead)}</p>${questionAskFold(row, lead)}
      ${controls}
      <p class="sess-qcard-if-unanswered" data-testid="question-record-card-if-unanswered">if you don't answer: ${esc(questionIfUnanswered(row))}</p>
    </div>`;
}

/**
 * LIN-4551: how a question already ended reads on the card, from the end the route's `ruling-settled` refusal names (`ended`, the
 * question's stored end since LIN-4550): a person's dismissal is "Dismissed"; "Withdrawn" covers both an agent taking its own
 * question back and the ticket closer ending it with its task (both stored `withdrawn`), so its words claim neither cause.
 */
const ENDED_WORDS = Object.freeze({
  answered: 'Answered elsewhere; there is nothing left to send.',
  dismissed: 'Dismissed elsewhere; there is nothing left to send.',
  withdrawn: 'Withdrawn; there is nothing left to send.',
  'handed-on': 'Handed on: the question went to someone else.',
});

/**
 * What the card says once the route has answered. `body` is the route's JSON: `resumed`, and `notResumedBecause` when the run
 * was not resumed (stopped, or no session left); or, for a question already ended, the `ruling-settled` refusal with `ended`.
 * Pure, so the browser and the tests read one wording.
 * @param {'answer'|'dismiss'} action
 * @param {object} body
 */
export function questionOutcomeText(action, body) {
  if (body?.code === 'ruling-settled' && Object.hasOwn(ENDED_WORDS, body.ended ?? '')) return ENDED_WORDS[body.ended];
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
