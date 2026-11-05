/**
 * LIN-4243 — the placement policy (public/home-placement.js), witnessed without a browser.
 *
 * `blockedBy` decides when a swap of Running and Up next must wait; `createHomePlacement().check` decides when the Home
 * document is read. Both run in a vm sandbox, as question-cards does (lin-4242-waiting-merge). Each test names the change
 * that makes it fail.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(join(REPO, 'public/home-placement.js'), 'utf8');

function load() {
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(SRC, sandbox);
  return sandbox.module.exports;
}
const HP = load();

const quiet = { openedTask: false, openFold: false, fieldFocused: false, cardHoldsInput: false };
const free = { search: false, dispatchesInFlight: 0, sections: [quiet, quiet] };

describe('blockedBy: what holds a swap', () => {
  test('nothing open, nothing typed: the swap may run', () => {
    assert.equal(HP.blockedBy(free), null);
    assert.equal(HP.blockedBy({}), null);
  });

  // Witness: drop the search check, and a search-hidden desk is swapped under its results.
  test('a search being typed in blocks (the desk is hidden behind its results)', () => {
    assert.equal(HP.blockedBy({ ...free, search: true }), 'search');
  });

  // Witness: drop the dispatch check, and a swap destroys an opened task whose press has not replied.
  test('a dispatch in flight blocks', () => {
    assert.equal(HP.blockedBy({ ...free, dispatchesInFlight: 1 }), 'dispatch');
  });

  // Witness: drop the opened-task check, and an open task is re-rendered under the reader.
  test('an opened task in either section blocks, even collapsed (its details are still mounted)', () => {
    assert.equal(HP.blockedBy({ ...free, sections: [{ ...quiet, openedTask: true }, quiet] }), 'opened-task');
    assert.equal(HP.blockedBy({ ...free, sections: [quiet, { ...quiet, openedTask: true }] }), 'opened-task');
  });

  // Witness: drop the opened-fold check, and a "show N more" list is lost on the swap.
  test('an opened "show N more" list blocks', () => {
    assert.equal(HP.blockedBy({ ...free, sections: [{ ...quiet, openFold: true }, quiet] }), 'opened-fold');
  });

  // Witness: treat any focus in the desk as a blocker, and a clicked row (tabindex=0) blocks too. Only a field blocks.
  test('focus in a field blocks; the desk without a field focused does not', () => {
    assert.equal(HP.blockedBy({ ...free, sections: [quiet, { ...quiet, fieldFocused: true }] }), 'focus');
  });

  // Witness: drop the card check, and typed text in a question card is swapped away (the collapsed-task path).
  test('a question card holding input (typed text, focus, or an answer in flight) blocks', () => {
    assert.equal(HP.blockedBy({ ...free, sections: [{ ...quiet, cardHoldsInput: true }, quiet] }), 'input');
  });

  test('the first reason in order wins: search, dispatch, opened task, fold, focus, input', () => {
    const everything = {
      search: true,
      dispatchesInFlight: 2,
      sections: [{ openedTask: true, openFold: true, fieldFocused: true, cardHoldsInput: true }],
    };
    assert.equal(HP.blockedBy(everything), 'search');
    assert.equal(HP.blockedBy({ ...everything, search: false }), 'dispatch');
    assert.equal(HP.blockedBy({ ...everything, search: false, dispatchesInFlight: 0 }), 'opened-task');
    assert.equal(HP.blockedBy({ sections: [{ openFold: true, fieldFocused: true, cardHoldsInput: true }] }), 'opened-fold');
    assert.equal(HP.blockedBy({ sections: [{ fieldFocused: true, cardHoldsInput: true }] }), 'focus');
  });

  test('every reason that can block has a live-region message, and the dispatch reason stays silent', () => {
    for (const reason of ['search', 'opened-task', 'opened-fold', 'focus', 'input']) {
      assert.match(HP.DEFER_MESSAGE[reason], /^Home changed\./, reason);
    }
    assert.equal(HP.DEFER_MESSAGE.dispatch, undefined);
  });
});

describe('createHomePlacement: when the Home document is read', () => {
  function fakes({ initial = ['a'], facts = free, doc = { id: 'doc' }, failRead = false, applyThrows = false } = {}) {
    const log = { reads: 0, applied: [], announced: [], counts: [] };
    const placement = HP.createHomePlacement({
      initialKeys: initial,
      facts: () => facts,
      read: async () => { log.reads++; return failRead ? null : doc; },
      apply: (d) => { if (applyThrows) throw new Error('boom'); log.applied.push(d); },
      announce: (text) => log.announced.push(text),
      setCount: (n) => log.counts.push(n),
    });
    return { placement, log, set: (f) => { facts = f; } };
  }

  // Witness: read on every call rather than only on a change, and the unchanged tick reads.
  test('an unchanged key set reads nothing, however many ticks come', async () => {
    const { placement, log } = fakes({ initial: ['a', 'b'] });
    assert.equal(await placement.check(['a', 'b']), 'same');
    assert.equal(await placement.check(['a', 'b']), 'same');
    assert.equal(log.reads, 0);
    assert.deepEqual(log.applied, []);
  });

  // Witness: skip the read-once rule (apply without reading, or read twice), and the counts or swaps differ.
  test('a changed set reads once, swaps once, sets the count, and then reads nothing more for that set', async () => {
    const { placement, log } = fakes({ initial: ['a'] });
    assert.equal(await placement.check(['a', 'b']), 'swapped');
    assert.equal(log.reads, 1);
    assert.equal(log.applied.length, 1);
    assert.deepEqual(log.counts, [2]);
    assert.equal(await placement.check(['a', 'b']), 'same');
    assert.equal(log.reads, 1);
  });

  // Witness: a deferral that reads anyway (ignoring blockedBy), and the open task is swapped under the reader.
  test('an open task defers: no read, no swap, and one announcement across the ticks that wait', async () => {
    const { placement, log, set } = fakes({ initial: ['a'], facts: { ...free, sections: [{ ...quiet, openedTask: true }, quiet] } });
    assert.equal(await placement.check(['a', 'b']), 'deferred:opened-task');
    assert.equal(await placement.check(['a', 'b']), 'deferred:opened-task');
    assert.equal(log.reads, 0);
    assert.deepEqual(log.applied, []);
    assert.equal(log.announced.length, 1);
    assert.match(log.announced[0], /close what you have open/);
    set(free);
    assert.equal(await placement.check(['a', 'b']), 'swapped');
    assert.equal(log.reads, 1);
  });

  // Witness: announce on every deferral tick, and the reader's live region is re-read on each refresh.
  test('a change of the reason the swap waits for is announced again; the same reason is not', async () => {
    const { placement, log, set } = fakes({ initial: ['a'], facts: { ...free, search: true } });
    await placement.check(['a', 'b']);
    await placement.check(['a', 'b']);
    set({ ...free, dispatchesInFlight: 0, sections: [{ ...quiet, cardHoldsInput: true }, quiet] });
    await placement.check(['a', 'b']);
    assert.equal(log.announced.length, 2);
    assert.match(log.announced[0], /search/);
    assert.match(log.announced[1], /answer you are typing/);
  });

  // Witness: announce for a dispatch, and a press that clears in seconds speaks in the reader's live region.
  test('a dispatch in flight defers without announcing', async () => {
    const { placement, log, set } = fakes({ initial: ['a'], facts: { ...free, dispatchesInFlight: 1 } });
    assert.equal(await placement.check(['a', 'b']), 'deferred:dispatch');
    assert.deepEqual(log.announced, []);
    set(free);
    assert.equal(await placement.check(['a', 'b']), 'swapped');
  });

  // Witness: swap without re-checking after the read, and a reader who opened a task during the read sees it swapped.
  test('the reader opening something while the read is out defers the swap; no swap is applied', async () => {
    let current = free;
    const log = { applied: [], announced: [], reads: 0 };
    const placement = HP.createHomePlacement({
      initialKeys: ['a'],
      facts: () => current,
      read: async () => { log.reads++; current = { ...free, sections: [{ ...quiet, openedTask: true }, quiet] }; return {}; },
      apply: (d) => log.applied.push(d),
      announce: (t) => log.announced.push(t),
      setCount: () => {},
    });
    assert.equal(await placement.check(['a', 'b']), 'deferred:opened-task');
    assert.equal(log.reads, 1);
    assert.deepEqual(log.applied, []);
  });

  // Witness: advance the placed keys on a failed read, and the swap is never retried for that set.
  test('a failed read changes nothing, and the next tick reads again', async () => {
    const failing = fakes({ initial: ['a'], failRead: true });
    assert.equal(await failing.placement.check(['a', 'b']), 'failed');
    assert.deepEqual(failing.log.applied, []);
    assert.deepEqual(failing.log.counts, []);
  });

  // Witness: let a throw from apply escape, and the refresh's silent catch hides a half-swapped desk with no record.
  test('a swap that throws is reported as failed, and the set is not recorded as placed', async () => {
    const { placement, log } = fakes({ initial: ['a'], applyThrows: true });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await placement.check(['a', 'b']), 'failed');
    } finally {
      console.error = original;
    }
    assert.deepEqual(log.counts, []);
  });
});

// sectionFacts reads the DOM, so these run against stub elements: each stub answers only the selector its fact reads, and
// records nothing else. A fact that is read from the wrong selector, or hard-wired, fails here. (Review of LIN-4243: the
// policy tests above give blockedBy ready-made facts and so never reach this half.)
describe('sectionFacts: the DOM facts that make the swap wait', () => {
  const FIELD_SELECTORS = 'input, textarea, select, [contenteditable="true"]';

  /** A section stub: `present` lists the selectors that match something; `cards` are the question-card stubs. */
  function section({ present = [], cards = [], contains = () => false } = {}) {
    return {
      querySelector: (sel) => (present.includes(sel) ? {} : null),
      querySelectorAll: (sel) => (sel === '[data-testid="session-question-card"]' ? cards : []),
      contains,
    };
  }
  /** An active-element stub that matches only the given selector text. */
  const active = (matchesField) => ({ matches: (sel) => matchesField && sel === FIELD_SELECTORS });
  const none = () => false;

  test('a quiet section reads all four facts false', () => {
    // (spread: the facts object is made in the vm realm, so compare a same-realm copy)
    assert.deepEqual({ ...HP.sectionFacts(section(), null, none) }, { openedTask: false, openFold: false, fieldFocused: false, cardHoldsInput: false });
  });

  // Witness: hard-wire openedTask to false, or read it from another selector.
  test('openedTask is true from a shown .details, and only that', () => {
    assert.equal(HP.sectionFacts(section({ present: ['.details:not(.hidden)'] }), null, none).openedTask, true);
    assert.equal(HP.sectionFacts(section({ present: ['.home-fetched'] }), null, none).openedTask, false);
  });

  // Witness: hard-wire openFold to false, and an opened "show N more" list is lost on the swap.
  test('openFold is true from a .home-fetched list, and only that', () => {
    const facts = HP.sectionFacts(section({ present: ['.home-fetched'] }), null, none);
    assert.equal(facts.openFold, true);
    assert.equal(facts.openedTask, false);
    assert.equal(HP.sectionFacts(section({ present: ['.details:not(.hidden)'] }), null, none).openFold, false);
  });

  // Witness: hard-wire fieldFocused to false, and a swap lands under the reader's cursor.
  test('fieldFocused is true for a field inside the section, not for a field elsewhere', () => {
    const inside = section({ contains: () => true });
    const outside = section({ contains: () => false });
    assert.equal(HP.sectionFacts(inside, active(true), none).fieldFocused, true);
    assert.equal(HP.sectionFacts(outside, active(true), none).fieldFocused, false);
    assert.equal(HP.sectionFacts(inside, null, none).fieldFocused, false);
  });

  // The spike's false blocker: a clicked row keeps focus (tabindex=0). It is not a field, so it must not hold the swap.
  test('a focused tabindex=0 row (not a field) is fieldFocused: false', () => {
    const matched = [];
    const row = { matches: (sel) => { matched.push(sel); return false; } };
    assert.equal(HP.sectionFacts(section({ contains: () => true }), row, none).fieldFocused, false);
    assert.deepEqual(matched, [FIELD_SELECTORS]);
  });

  // Witness: hard-wire cardHoldsInput to false, and typed text in a question card is swapped away. The cards are found in
  // the section whether or not the task around them is shown, so a closed task (.details.hidden, card still mounted) counts.
  test('cardHoldsInput is true when any question card holds input, including a card in a closed task', () => {
    const typing = { id: 'typing' };
    const idle = { id: 'idle' };
    const holds = (card) => card === typing;
    // The closed task: its details are hidden (openedTask false), but the card is still in the section and holds text.
    const closedTask = section({ cards: [idle, typing] });
    const facts = HP.sectionFacts(closedTask, null, holds);
    assert.equal(facts.openedTask, false);
    assert.equal(facts.cardHoldsInput, true);
    assert.equal(HP.sectionFacts(section({ cards: [idle] }), null, holds).cardHoldsInput, false);
    // blockedBy then waits, and says the reader is typing.
    assert.equal(HP.blockedBy({ search: false, dispatchesInFlight: 0, sections: [facts] }), 'input');
  });
});
