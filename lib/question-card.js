/**
 * Pinned question cards (LIN-3252 S2), shared by the session page and the task
 * page (LIN-3499). One module renders the question, "why is Harbour asking",
 * options, own-answer box, Answer, dismiss and "if you don't answer"; the client
 * half is public/question-cards.js. Pure: no I/O.
 */

import { escapeHtml } from './utils/html.js';

const joinAttrs = (list) => list.filter(Boolean).join(' ');
const esc = (v) => escapeHtml(String(v || ''));

/**
 * "If you don't answer" line (S2.3ii): the agent's own
 * `decision.if_unanswered.summary` when present, else a fallback worded by
 * whether the session has ENDED (`sessionTerminal`), not by the effect.
 */
export function ifUnansweredText(decision, sessionTerminal) {
  const summary = decision && decision.if_unanswered && decision.if_unanswered.summary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  return sessionTerminal
    ? 'Nothing further runs; the run has ended.'
    : 'Harbour keeps waiting for your answer.';
}

/**
 * One pinned question card. `case` chunks render verbatim, each its own node,
 * inside an expandable "why is Harbour asking? ›" (a chunk may carry a baked-in
 * `(recap i/n)` header — never re-derived here). A non-interactive card says
 * Harbour is still working and offers no input.
 *
 * The card carries the reply target (`data-loop-id`, the followUpTo anchor) and
 * the stamp target (`data-stamp-loop-id`) separately — a lineage's decision may
 * be raised on the root while the content loop is a later member.
 */
export function renderQuestionCard(card) {
  const attrs = joinAttrs([
    'data-testid="session-question-card"',
    `data-url-key="${escapeHtml(card.urlKey || '')}"`,
    `data-loop-id="${esc(card.followUpTo)}"`,
    `data-stamp-loop-id="${esc(card.stampLoopId)}"`,
    // LIN-3959: a joined ruling's copies, as JSON, so the answer and dismiss
    // senders stamp every copy. Sparse: a non-joined card adds no attribute.
    Array.isArray(card.stampLoopIds) && card.stampLoopIds.length
      ? `data-stamp-loop-ids="${escapeHtml(JSON.stringify(card.stampLoopIds))}"`
      : '',
    `data-decision-id="${esc(card.decisionId)}"`,
    `data-target="${escapeHtml(card.target || 'cli')}"`,
    `data-issue-id="${esc(card.issueId)}"`,
    `data-issue-identifier="${esc(card.issueIdentifier)}"`,
    // LIN-3126 residual: the anchor's provider-kind source, so the card's
    // answer/dismiss senders forward the issue's provider. Sparse.
    card.source ? `data-source="${esc(card.source)}"` : '',
    `data-disposition="${escapeHtml(card.disposition || '')}"`,
    `data-effect="${escapeHtml(card.effect || '')}"`,
    `data-record-on="${escapeHtml(card.recordOn || '')}"`,
    `data-session-waiting="${!!card.sessionWaiting}"`
  ]);

  const chunks = Array.isArray(card.case) ? card.case : [];
  const whyHtml = chunks.length
    ? `<details class="sess-qcard-why" data-testid="session-question-card-why">
        <summary class="sess-qcard-why-summary">why is Harbour asking? ›</summary>
        <div class="sess-qcard-case">${chunks.map(chunk => `<p class="sess-qcard-case-chunk" data-testid="session-question-card-why-chunk">${escapeHtml(String(chunk))}</p>`).join('')}</div>
      </details>`
    : '';

  let controlHtml;
  if (!card.interactive) {
    controlHtml = `<p class="sess-qcard-readonly" data-testid="session-question-card-readonly">Harbour is still working; you can answer when it pauses.</p>`;
  } else {
    const options = Array.isArray(card.options) ? card.options : [];
    const radioGroup = escapeHtml(String(card.stampLoopId || card.decisionId || 'q'));
    const optionsHtml = options.length
      ? `<ul class="sess-qcard-options" data-testid="session-question-card-options">${options.map(o => `<li class="sess-qcard-option">
            <label class="sess-qcard-option-label">
              <input type="radio" class="sess-qcard-option-input" name="qcard-${radioGroup}" data-option-id="${esc(o.id)}" value="${esc(o.label)}">
              <span class="sess-qcard-option-text" data-testid="session-question-card-option">${esc(o.label)}</span>
            </label>
          </li>`).join('')}</ul>`
      : '';
    controlHtml = `${optionsHtml}
      <textarea class="sess-qcard-input" data-testid="session-question-card-input" rows="2" placeholder="your own answer…" aria-label="Your own answer"></textarea>
      <ul class="chat-thread" data-testid="session-question-card-thread" hidden></ul>
      <div class="sess-qcard-actions">
        <button type="button" class="action-btn sess-qcard-answer" data-testid="session-question-card-answer">Answer</button>
        ${card.dismissable ? '<button type="button" class="sess-qcard-dismiss" data-testid="session-question-card-dismiss">this wasn\'t worth asking</button>' : ''}
        <span class="sess-qcard-feedback sess-reply-feedback" role="status" aria-live="polite"></span>
      </div>`;
  }

  return `<div class="sess-qcard" ${attrs}>
      <p class="sess-qcard-question" data-testid="session-question-card-question">${escapeHtml(String(card.question))}</p>
      ${whyHtml}
      ${controlHtml}
      <p class="sess-qcard-if-unanswered" data-testid="session-question-card-if-unanswered">if you don't answer: ${escapeHtml(card.ifUnanswered)}</p>
    </div>`;
}

/** One decision row → its pinned card. Dismiss is offered on decision cards only (S2.5/C2). */
export function renderDecisionCard(row, { urlKey, canReply, sessionTerminal, sessionWaiting }) {
  const decision = (row && row.decision) || {};
  const anchor = (row && row.anchor) || {};
  const readOnly = row.disposition === 'mid-turn' || row.disposition === 'indeterminate';
  return renderQuestionCard({
    urlKey,
    followUpTo: anchor.loopId || '',
    stampLoopId: row.stampLoopId || anchor.loopId || '',
    // LIN-3959: present only on a joined row (lib/unanswered-decisions.js).
    stampLoopIds: row.stampLoopIds,
    decisionId: decision.decision_id || '',
    target: anchor.target || 'cli',
    issueId: anchor.issueId || '',
    issueIdentifier: anchor.issueIdentifier || '',
    source: anchor.source || '',
    disposition: row.disposition || '',
    effect: row.effect || '',
    recordOn: (decision.on_answer && decision.on_answer.record_on) || '',
    sessionWaiting,
    question: decision.question ? String(decision.question) : 'Harbour needs your input.',
    case: Array.isArray(row.decisionCase) ? row.decisionCase : [],
    options: Array.isArray(decision.options) ? decision.options : [],
    ifUnanswered: ifUnansweredText(decision, sessionTerminal),
    interactive: !readOnly && row.canReply !== false && canReply,
    dismissable: true
  });
}

/**
 * A bare `[blocked]` waiting loop with no `DECISION:` row (S2.7): the second
 * card source. Free-text box and one verb, "Answer" (the session is waiting, so
 * it forces the resume). No dismiss — a blocker has no decision identity to key
 * the KPI on. `producer` is the waiting loop: its own reply target and issue
 * (never a hard-defaulted cli target) and its latest assistant text as the
 * "why" fallback when there is no `decisionCase`.
 */
export function renderBareBlockedCard({ waitingMessage, decisionCase, producer, urlKey, canReply, sessionTerminal }) {
  const p = producer || {};
  const chunks = Array.isArray(decisionCase) && decisionCase.length
    ? decisionCase
    : (Array.isArray(p.case) ? p.case : []);
  return renderQuestionCard({
    urlKey,
    followUpTo: p.loopId || '',
    stampLoopId: p.loopId || '',
    decisionId: '',
    target: p.target || 'cli',
    issueId: p.issueId || '',
    issueIdentifier: p.issueIdentifier || '',
    source: p.issueSource || '',
    disposition: 'resumable',
    effect: 'resume',
    sessionWaiting: true,
    question: String(waitingMessage),
    case: chunks,
    options: [],
    ifUnanswered: ifUnansweredText(null, sessionTerminal),
    interactive: canReply
  });
}

/**
 * The pinned cards above the steps. Primary source is `decisions` (the route's
 * waiting-independent read, so a finished session's decision still shows); the
 * bare-blocked card is the fallback when the session is waiting on a
 * `[blocked]` loop with no ruling row.
 */
export function renderQuestionCards({ decisions, waiting, waitingMessage, decision, decisionCase, producer, urlKey, canReply, sessionTerminal }) {
  const rows = Array.isArray(decisions) ? decisions : [];
  const cards = rows.map(row => renderDecisionCard(row, { urlKey, canReply, sessionTerminal, sessionWaiting: waiting }));
  if (!rows.length && waiting && waitingMessage && !decision) {
    cards.push(renderBareBlockedCard({ waitingMessage, decisionCase, producer, urlKey, canReply, sessionTerminal }));
  }
  return cards.length ? `<div class="sess-qcards">${cards.join('')}</div>` : '';
}
