/**
 * Pinned reply cards (LIN-3252 S2), shared by the session page and the task
 * page (LIN-3499). One module renders the waiting message, "why is Harbour asking",
 * own-answer box, Answer and "if you don't answer"; the client half is
 * public/question-cards.js. Pure: no I/O.
 */

import { escapeHtml } from './utils/html.js';

const joinAttrs = (list) => list.filter(Boolean).join(' ');
const esc = (v) => escapeHtml(String(v || ''));

/**
 * "If you don't answer" line (S2.3ii), worded by whether the session has ENDED (`sessionTerminal`).
 */
export function ifUnansweredText(sessionTerminal) {
  return sessionTerminal
    ? 'Nothing further runs; the run has ended.'
    : 'Harbour keeps waiting for your answer.';
}

/**
 * One pinned reply card. `case` chunks render verbatim, each its own node, inside an expandable "why is Harbour asking? ›"
 * (a chunk may carry a baked-in `(recap i/n)` header — never re-derived here). A non-interactive card says Harbour is still
 * working and offers no input. The card carries its reply target (`data-loop-id`, the followUpTo anchor).
 *
 * LIN-4541: a reply is a comment and a resume, never an answer to a ruling, so the card carries no ruling ids (decision id,
 * stamp loops, task decision id), no effect or record target, no options and no dismiss: a question is a question record's
 * card (lib/question-record-card.js), answered and dismissed through its own route.
 */
export function renderQuestionCard(card) {
  const attrs = joinAttrs([
    'data-testid="session-question-card"',
    `data-url-key="${escapeHtml(card.urlKey || '')}"`,
    `data-loop-id="${esc(card.followUpTo)}"`,
    `data-target="${escapeHtml(card.target || 'cli')}"`,
    `data-issue-id="${esc(card.issueId)}"`,
    `data-issue-identifier="${esc(card.issueIdentifier)}"`,
    // LIN-3126 residual: the anchor's provider-kind source, so the card's
    // reply forwards the issue's provider. Sparse.
    card.source ? `data-source="${esc(card.source)}"` : '',
    `data-session-waiting="${!!card.sessionWaiting}"`
  ]);

  const chunks = Array.isArray(card.case) ? card.case : [];
  const whyHtml = chunks.length
    ? `<details class="sess-qcard-why" data-testid="session-question-card-why">
        <summary class="sess-qcard-why-summary">why is Harbour asking? ›</summary>
        <div class="sess-qcard-case">${chunks.map(chunk => `<p class="sess-qcard-case-chunk" data-testid="session-question-card-why-chunk">${escapeHtml(String(chunk))}</p>`).join('')}</div>
      </details>`
    : '';

  const controlHtml = !card.interactive
    ? `<p class="sess-qcard-readonly" data-testid="session-question-card-readonly">Harbour is still working; you can answer when it pauses.</p>`
    : `<textarea class="sess-qcard-input" data-testid="session-question-card-input" rows="2" placeholder="your own answer…" aria-label="Your own answer"></textarea>
      <ul class="chat-thread" data-testid="session-question-card-thread" hidden></ul>
      <div class="sess-qcard-actions">
        <button type="button" class="action-btn sess-qcard-answer" data-testid="session-question-card-answer">Answer</button>
        <span class="sess-qcard-feedback sess-reply-feedback" role="status" aria-live="polite"></span>
      </div>`;

  return `<div class="sess-qcard" ${attrs}>
      <p class="sess-qcard-question" data-testid="session-question-card-question">${escapeHtml(String(card.question))}</p>
      ${whyHtml}
      ${controlHtml}
      <p class="sess-qcard-if-unanswered" data-testid="session-question-card-if-unanswered">if you don't answer: ${escapeHtml(card.ifUnanswered)}</p>
    </div>`;
}

/**
 * A bare `[blocked]` waiting loop with no question record (S2.7): free-text box and one verb, "Answer" (the session is
 * waiting, so it forces the resume). `producer` is the waiting loop: its own reply target and issue (never a hard-defaulted
 * cli target) and its latest assistant text as the "why" fallback when there is no `decisionCase` (an old run's DECISION:
 * block case, kept as history).
 */
export function renderBareBlockedCard({ waitingMessage, decisionCase, producer, urlKey, canReply, sessionTerminal }) {
  const p = producer || {};
  const chunks = Array.isArray(decisionCase) && decisionCase.length
    ? decisionCase
    : (Array.isArray(p.case) ? p.case : []);
  return renderQuestionCard({
    urlKey,
    followUpTo: p.loopId || '',
    target: p.target || 'cli',
    issueId: p.issueId || '',
    issueIdentifier: p.issueIdentifier || '',
    source: p.issueSource || '',
    sessionWaiting: true,
    question: String(waitingMessage),
    case: chunks,
    ifUnanswered: ifUnansweredText(sessionTerminal),
    interactive: canReply
  });
}

/**
 * The pinned cards above the steps when a session waits on a `[blocked]` loop with no question record of its own (LIN-4538:
 * the open questions are the records' cards, rendered beside these, so this is the fallback only). `covered` is true when the
 * page already shows an open question record for the session; then the bare-blocked card is not repeated.
 */
export function renderQuestionCards({ waiting, waitingMessage, decision, decisionCase, producer, urlKey, canReply, sessionTerminal, covered = false }) {
  const cards = [];
  if (!covered && waiting && waitingMessage && !decision) {
    cards.push(renderBareBlockedCard({ waitingMessage, decisionCase, producer, urlKey, canReply, sessionTerminal }));
  }
  return cards.length ? `<div class="sess-qcards">${cards.join('')}</div>` : '';
}
