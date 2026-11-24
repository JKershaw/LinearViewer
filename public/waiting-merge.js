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
 * LIN-4552: the keyed merge both of Home's live groups use, the question cards (mergeWaitingCards) and the notes
 * (public/waiting-notes.js): keep the items the page and the server agree on as the same nodes (never re-rendered or moved, so a
 * focused control keeps focus), take out an item the server no longer lists unless the one keep-a-card rule holds it
 * (public/question-records.js holdsCard), and insert a new one at its server-order position: before the next fresh item already on
 * the page, else before `tail` (an element after the group in the same parent), else at the end. A key settled on this page is
 * never re-added. Returns the keys removed.
 * @param {{container: Element, onPage: Element[], fresh: Array<{key: string, el: Element}>, keyOf: (el: Element) => string,
 *   holds: (el: Element) => boolean, settled: Set<string>, tail?: Element|null}} args
 * @returns {string[]}
 */
export function mergeKeyed({ container, onPage, fresh, keyOf, holds, settled, tail = null }) {
  const removed = [];
  const wanted = [];
  const freshKeys = new Set();
  for (const item of fresh) {
    if (!item.key || freshKeys.has(item.key) || settled.has(item.key)) continue;
    freshKeys.add(item.key);
    wanted.push(item);
  }
  const kept = new Map();
  for (const el of onPage) {
    const key = keyOf(el);
    if (freshKeys.has(key) || holds(el)) { kept.set(key, el); continue; }
    // Not remembered as settled: an item that leaves one response may return in a later one (a live run comes and goes).
    removed.push(key);
    el.remove();
  }
  wanted.forEach((item, i) => {
    if (kept.has(item.key)) return;
    let before = null;
    for (let j = i + 1; j < wanted.length && !before; j++) before = kept.get(wanted[j].key) || null;
    container.insertBefore(item.el, before || (tail && tail.parentNode === container ? tail : null));
    kept.set(item.key, item.el);
  });
  return removed;
}

/**
 * Merge a fresh server section into the live `.waiting-body`: keeps the cards the page and the server agree on, adds new ones in
 * server order, and removes the ones the server no longer lists, except a card the one rule holds. Returns the cards now in the
 * body and the keys removed (the caller says "Answered elsewhere"). LIN-4552: a new card goes in above "Notes for you", the body's
 * last group (public/waiting-notes.js merges that group).
 * @param {Element|null} body - the live `.waiting-body`
 * @param {string} freshHtml - the server's section markup (`{ html }` from /api/home-waiting)
 * @returns {{count: number, removed: string[]}}
 */
export function mergeWaitingCards(body, freshHtml) {
  if (!body) return { count: 0, removed: [] };
  const template = body.ownerDocument.createElement('template');
  template.innerHTML = freshHtml || '';
  const found = template.content ? template.content.querySelectorAll(`.${WRAPPER}`) : [];
  const removed = mergeKeyed({
    container: body,
    onPage: wrappersIn(body),
    fresh: [...found].map((el) => ({ key: wrapperKeyOf(el), el })),
    keyOf: wrapperKeyOf,
    holds: (wrapper) => holdsCard(wrapper.querySelector(CARD)),
    settled: settledKeys,
    tail: [...(body.children || [])].find((el) => el.classList && el.classList.contains('waiting-notes')) || null,
  });
  return { count: wrappersIn(body).length, removed };
}
