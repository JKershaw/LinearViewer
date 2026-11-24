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

// ── Keeping a card across a repaint (LIN-4549, finding-7a603e81) ──────────────
// The one rule every host that repaints a question card asks: Home's live Waiting refresh (public/waiting-merge.js,
// which imports holdsCard itself), Observation's rulings poll (public/observation.js) and Home's opened task
// (public/prompt-section.js keepTypedQuestion). It reads either card: a question record's, or the older reply card a run
// parked on a bare `[blocked]` draws (lib/question-card.js). Each host decides first which card is "the same" (by its key);
// this says whether that card holds the reader's place.
const TYPED = `${INPUT}, [data-testid="session-question-card-input"]`;
const PRESSED = `${OPTION}[aria-pressed="true"]`;
// LIN-4551: the full ask's fold, opened. The reader is reading it, so a repaint must not close it under them.
const OPEN_FOLD = '[data-testid="question-record-card-ask"][open]';

/**
 * Focus inside the card. `active` is the element that had focus BEFORE a write that may detach the card (a repaint detaches it,
 * which blurs it, so after the write only the caller can know); omitted, it is the card's document's focus now; null says
 * nothing was focused. The card's own box is not focus inside it (LIN-4293).
 * @param {Element|null} card
 * @param {Element|null} [active]
 */
export function focusInCard(card, active) {
  if (!card) return false;
  const el = active === undefined ? card.ownerDocument?.activeElement ?? null : active;
  return !!el && el !== card && card.contains(el);
}

/**
 * The reader is mid-answer on this card: typed words, a chosen option, focus inside it, or an answer in flight. Home's placement
 * reads this half alone (public/home-placement.js): a settled card holds a place on the page, not the reader's input, so it never
 * holds Running and Up next back.
 * @param {Element|null} card
 * @param {Element|null} [active] - as in focusInCard
 */
export function holdsReaderInput(card, active) {
  if (!card || card.dataset?.settledElsewhere === 'true') return false;
  if (card.dataset?.answerInFlight === 'true') return true;
  const typed = card.querySelector(TYPED);
  if (typed && typeof typed.value === 'string' && typed.value.length > 0) return true;
  // A chosen option is an answer being made only on an open card: a card answered with an option keeps it pressed once settled,
  // and that must not hold Home's placement back (LIN-4243: an answered task returns to Running).
  if (card.dataset?.settled !== 'true' && card.querySelector(PRESSED)) return true;
  return focusInCard(card, active);
}

/**
 * Whether a repaint keeps this card where it is rather than drawing it fresh: the reader is mid-answer on it (holdsReaderInput),
 * a request from it is out (a control is off), it is settled (answered or dismissed here, showing its outcome), or the reader has
 * its full ask open (LIN-4551: a rebuilt card's fold starts closed). The union of what the three hosts each kept before LIN-4549,
 * and the open fold. An open fold holds the card, not Home's placement (holdsReaderInput leaves it out). A card refused as settled
 * elsewhere (`data-settled-elsewhere`) is never held.
 * @param {Element|null} card
 * @param {Element|null} [active] - as in focusInCard
 */
export function holdsCard(card, active) {
  // A card whose answer the route refused as settled elsewhere holds nothing: there is no answer left for it to give.
  if (!card || card.dataset?.settledElsewhere === 'true') return false;
  if (card.dataset?.settled === 'true') return true;
  if ([...card.querySelectorAll('button, textarea')].some((el) => el.disabled)) return true;
  if (card.querySelector(OPEN_FOLD)) return true;
  return holdsReaderInput(card, active);
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
  // The answer is out until the route answers (holdsReaderInput reads it): the same flag the older reply card sets
  // (public/question-cards.js sendReply). Cleared on every outcome, so a settled card is settled, not in flight.
  card.dataset.answerInFlight = 'true';
  let text;
  try {
    const res = await fetch(questionActionPath(card.dataset.urlKey, card.dataset.questionId, action), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    delete card.dataset.answerInFlight;
    if (res.ok) return settle(card, questionOutcomeText(action, body));
    // Answered or dismissed elsewhere (the route's `ruling-settled`, keyed on its code): this card is no longer the reader's to
    // answer, so the keep rule lets it go and the next refresh takes it out ("Answered elsewhere"). It is not settled here.
    if (body?.code === 'ruling-settled') card.dataset.settledElsewhere = 'true';
    // The refusal is passed whole: a `ruling-settled` one names how the question ended (`ended`), which the card words (LIN-4551).
    text = questionOutcomeText(action, { ...body, error: body?.error || 'Could not record it; try again' });
  } catch {
    text = 'Could not reach Harbour; try again';
  }
  delete card.dataset.answerInFlight;
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
