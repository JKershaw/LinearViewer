/**
 * LIN-4549 (LIN-4546 piece 1, finding-06d241d4): Home's live "Waiting on you" merge (LIN-4242), a module public/app.js imports.
 *
 * It lived in the classic public/question-cards.js, which also keyed `.waiting-card` wrappers (a waiting run's reply card) that no
 * renderer has drawn since LIN-4538; those branches are gone. The merge unit is the `.waiting-question` wrapper (lib/waiting-section.js),
 * keyed by its card's question id. A kept wrapper is never re-rendered or moved: moving a focused textarea blurs it. A wrapper the
 * server no longer lists is taken out unless the one keep-a-card rule holds its card (public/question-records.js holdsCard: typed
 * words, a chosen option, focus, a control off, an answer in flight, or settled). Questions settled on this page are remembered
 * (noteSettled), so a response requested before the answer never re-adds one.
 *
 * Question record cards need no binding: public/question-records.js answers them through one delegated listener.
 */
import { holdsCard } from './question-records.js';

const WRAPPER = 'waiting-question';
const CARD = '[data-testid="question-record-card"]';

// The questions answered or dismissed on this page (by question id). Module state: one page, one set.
const settledKeys = new Set();

/** A question card's key in the merge and in Home's placement: its question id ('' for anything else). */
export function questionKeyOf(card) {
  return (card && card.dataset && card.dataset.questionId) || '';
}

/** A wrapper's key: the question id of the card it holds. */
function wrapperKeyOf(wrapper) {
  return questionKeyOf(wrapper.querySelector(CARD));
}

/** The question wrappers directly in `body`, in page order. */
function wrappersIn(body) {
  return [...(body.children || [])].filter((el) => el.classList && el.classList.contains(WRAPPER));
}

/** Remembers a question settled on this page (answered or dismissed here), so no later response re-adds it. */
export function noteSettled(questionId) {
  if (questionId) settledKeys.add(questionId);
}

/**
 * Merge a fresh server section into the live `.waiting-body`: keeps the cards the page and the server agree on, adds new ones in
 * server order, and removes the ones the server no longer lists, except a card the one rule holds. Returns the cards now in the
 * body and the keys removed (the caller says "Answered elsewhere").
 * @param {Element|null} body - the live `.waiting-body`
 * @param {string} freshHtml - the server's section markup (`{ html }` from /api/home-waiting)
 * @returns {{count: number, removed: string[]}}
 */
export function mergeWaitingCards(body, freshHtml) {
  const removed = [];
  if (!body) return { count: 0, removed };
  const template = body.ownerDocument.createElement('template');
  template.innerHTML = freshHtml || '';
  const fresh = [];
  const freshKeys = new Set();
  const found = template.content ? template.content.querySelectorAll(`.${WRAPPER}`) : [];
  for (const el of found) {
    const key = wrapperKeyOf(el);
    if (!key || freshKeys.has(key) || settledKeys.has(key)) continue;
    freshKeys.add(key);
    fresh.push({ key, el });
  }
  // Take out what the server no longer lists, unless the reader's place is on it.
  for (const wrapper of wrappersIn(body)) {
    const key = wrapperKeyOf(wrapper);
    if (freshKeys.has(key) || holdsCard(wrapper.querySelector(CARD))) continue;
    // Not remembered as settled: a card that leaves one response may return in a later one (a live run comes and goes).
    removed.push(key);
    wrapper.remove();
  }
  // Insert what is new at its server-order position: before the next fresh card already on the page, else at the end.
  const onPage = new Map(wrappersIn(body).map((w) => [wrapperKeyOf(w), w]));
  fresh.forEach((item, i) => {
    if (onPage.has(item.key)) return;
    let before = null;
    for (let j = i + 1; j < fresh.length && !before; j++) before = onPage.get(fresh[j].key) || null;
    body.insertBefore(item.el, before);
    onPage.set(item.key, item.el);
  });
  return { count: wrappersIn(body).length, removed };
}
