/**
 * LIN-4243: Home's placement follows a change of the Waiting set. This file is the policy, so it runs without a browser:
 * when the merged Waiting key set changes, read the Home document once, unless the reader has something open that a swap
 * would destroy or move. Then wait for a later tick and say so in the live region, once. The DOM swap itself is app.js's
 * (createDeskPlacement), where the desk's own helpers live. Loaded by the Home page before app.js (lib/render.js).
 *
 * window.HomePlacement, and module.exports under node for the unit tests (tests/unit/lin-4243-placement.test.js).
 */
(function () {
  const FIELD = 'input, textarea, select, [contenteditable="true"]';

  // What the live region says while a swap waits. `dispatch` says nothing: a press still in flight clears in seconds.
  const DEFER_MESSAGE = {
    search: 'Home changed. Running and Up next will update when the search is cleared.',
    'opened-task': 'Home changed. Running and Up next will update when you close what you have open.',
    'opened-fold': 'Home changed. Running and Up next are not updated while a list you opened is showing. Reload to update them.',
    focus: 'Home changed. Running and Up next will update when you leave the field you are in.',
    input: 'Home changed. Running and Up next will update when the answer you are typing is sent or cleared.',
  };

  /**
   * Why a swap must wait now, or null when it may run. `facts` is what the page reads (see sectionFacts):
   *   search           a search is on (the desk is hidden behind its results)
   *   dispatch         a dispatch is in flight (a swap would destroy the press's opened task before its reply lands)
   *   opened-task      a desk row's task is open, or its details are mounted and shown
   *   opened-fold      a "show N more" list the reader opened is in the desk (the list does not survive a swap)
   *   focus            focus is in a field of the desk. A clicked row (tabindex=0) is not a field, so it does not block.
   *   input            a question card in the desk holds the reader's place: typed text, focus, or an answer in flight
   * @param {{search?: boolean, dispatchesInFlight?: number, sections?: Array<object>}} facts
   * @returns {string|null}
   */
  function blockedBy(facts) {
    if (facts.search) return 'search';
    if (facts.dispatchesInFlight > 0) return 'dispatch';
    const sections = facts.sections || [];
    for (const section of sections) if (section.openedTask) return 'opened-task';
    for (const section of sections) if (section.openFold) return 'opened-fold';
    for (const section of sections) if (section.fieldFocused) return 'focus';
    for (const section of sections) if (section.cardHoldsInput) return 'input';
    return null;
  }

  /**
   * The facts `blockedBy` needs from one desk section element (its wrapper, header and body).
   * @param {Element} el - a `.running-section` or `.up-next-section`
   * @param {Element|null} activeElement - document.activeElement
   * @param {(card: Element) => boolean} cardHoldsInput - QuestionCards.cardHoldsInput
   */
  function sectionFacts(el, activeElement, cardHoldsInput) {
    return {
      openedTask: !!el.querySelector('.details:not(.hidden)'),
      openFold: !!el.querySelector('.home-fetched'),
      fieldFocused: !!activeElement && el.contains(activeElement) && activeElement.matches(FIELD),
      cardHoldsInput: [...el.querySelectorAll('[data-testid="session-question-card"]')].some(card => cardHoldsInput(card)),
    };
  }

  const keyString = keys => (keys || []).join('\n');

  /**
   * The placement policy for one Home page. The page supplies:
   *   initialKeys  the Waiting keys the desk was placed for at load
   *   facts()      the current blockedBy facts
   *   read()       one fetch of the Home document, parsed; null when it failed
   *   apply(doc)   swap the desk from that document (the DOM half)
   *   announce(s)  the live region's text
   *   setCount(n)  the count line's waiting part for n merged cards
   * @returns {{ check: (keys: string[]) => Promise<string> }}
   */
  function createHomePlacement({ initialKeys, facts, read, apply, announce, setCount }) {
    let placed = keyString(initialKeys);
    let announced = null;

    function defer(reason) {
      if (reason === 'dispatch' || reason === announced) return;
      announced = reason;
      announce(DEFER_MESSAGE[reason]);
    }

    /**
     * Called after each Waiting merge with the merged key set. Reads the Home document at most once per change of the set
     * and never on a tick that finds the set unchanged.
     * @returns {Promise<string>} 'same' | 'deferred:<reason>' | 'swapped' | 'failed'
     */
    async function check(keys) {
      const now = keyString(keys);
      if (now === placed) {
        announced = null;
        return 'same';
      }
      const reason = blockedBy(facts());
      if (reason) {
        defer(reason);
        return `deferred:${reason}`;
      }
      const doc = await read();
      if (!doc) return 'failed';
      // The reader may have opened something while the read was out. Wait for the next tick, which reads again.
      const late = blockedBy(facts());
      if (late) {
        defer(late);
        return `deferred:${late}`;
      }
      try {
        apply(doc);
      } catch (error) {
        console.error('Home placement: swap failed', error);
        return 'failed';
      }
      placed = now;
      announced = null;
      setCount(keys.length);
      return 'swapped';
    }

    return { check };
  }

  const api = { blockedBy, sectionFacts, createHomePlacement, DEFER_MESSAGE };
  if (typeof window !== 'undefined') window.HomePlacement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
