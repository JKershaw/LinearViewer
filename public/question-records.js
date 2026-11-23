/**
 * LIN-4532 (LIN-4529 P2b): the browser half of a question RECORD card (lib/question-record-card.js is the markup).
 *
 * One delegated listener for every page that loads this module, so cards drawn later (the Rulings page's poll, Home's waiting
 * block) work without a second wiring. A press on an option chooses it; Answer sends the chosen option and the person's own
 * words together to POST /workspace/:urlKey/questions/:id/answer; the dismiss button sends POST .../dismiss. The route's answer
 * is shown on the card (resumed, not resumed because the run was stopped, or no session left) and the card then stays settled.
 * Nothing here posts a comment or dispatches a follow-up: the route does both, once, on the server.
 */
import { questionActionPath, questionOutcomeText } from '../lib/question-record-card.js';

/** The event a settled question card fires (bubbling). Named once here; app.js listens for it on the Home desk. */
export const SETTLED_EVENT = 'harbour:question-record-settled';

const CARD = '[data-testid="question-record-card"]';
const OPTION = '[data-testid="question-record-card-option"]';
const ANSWER = '[data-testid="question-record-card-answer"]';
const DISMISS = '[data-testid="question-record-card-dismiss"]';
const FEEDBACK = '[data-testid="question-record-card-feedback"]';
const INPUT = '[data-testid="question-record-card-input"]';

function setBusy(card, busy) {
  card.querySelectorAll('button, textarea').forEach((el) => { el.disabled = busy; });
}

function say(card, text) {
  const feedback = card.querySelector(FEEDBACK);
  if (feedback) feedback.textContent = text;
}

/**
 * The card is answered: its controls stay off, and the outcome it was given stays on it. It then tells the page it sits on
 * (`harbour:question-record-settled`, bubbling), so a count line can take the open question out of its number (public/app.js).
 */
function settle(card, text) {
  card.dataset.settled = 'true';
  setBusy(card, true);
  say(card, text);
  if (typeof card.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    card.dispatchEvent(new CustomEvent(SETTLED_EVENT, { bubbles: true, detail: { urlKey: card.dataset.urlKey || '', questionId: card.dataset.questionId || '' } }));
  }
}

async function send(card, action, payload) {
  setBusy(card, true);
  let text;
  try {
    const res = await fetch(questionActionPath(card.dataset.urlKey, card.dataset.questionId, action), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return settle(card, questionOutcomeText(action, body));
    text = questionOutcomeText(action, { error: body?.error || 'Could not record it; try again' });
  } catch {
    text = 'Could not reach Harbour; try again';
  }
  setBusy(card, false);
  say(card, text);
  return null;
}

function pickOption(card, button) {
  card.querySelectorAll(OPTION).forEach((b) => b.setAttribute('aria-pressed', b === button ? 'true' : 'false'));
  card.dataset.option = button.dataset.optionId || '';
}

function answer(card) {
  const option = card.dataset.option || '';
  const input = card.querySelector(INPUT);
  const words = input && typeof input.value === 'string' ? input.value.trim() : '';
  if (!option && !words) {
    say(card, 'Choose an option or write your own answer.');
    return null;
  }
  return send(card, 'answer', { option: option || null, words: words || null });
}

/** The delegated listener. Returns the request's promise when a press sends one (the browser ignores it). */
function onClick(ev) {
  const target = ev && ev.target && typeof ev.target.closest === 'function' ? ev.target : null;
  if (!target) return null;
  const card = target.closest(CARD);
  if (!card || card.dataset.settled === 'true' || target.disabled) return null;
  if (target.closest(OPTION)) {
    pickOption(card, target.closest(OPTION));
    return null;
  }
  if (target.closest(ANSWER)) return answer(card);
  if (target.closest(DISMISS)) return send(card, 'dismiss', {});
  return null;
}

if (typeof document !== 'undefined') document.addEventListener('click', onClick);

export { answer, pickOption, settle };
