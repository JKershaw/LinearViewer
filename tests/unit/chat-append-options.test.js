/**
 * LIN-1728 Phase 4 — unit tests for `window.ChatUI.appendOptions`
 * (public/chat.js), the option-button chat primitive.
 *
 * chat.js is a browser script (not an ES module). It runs through `loadWorld`
 * (tests/unit/helpers/client-world.js) over the shared fake DOM
 * (tests/unit/helpers/fake-dom.js): appendOptions' own DOM surface (createElement,
 * classList, textContent, setAttribute/dataset, appendChild, addEventListener)
 * is modelled there, and the buttons are real nodes in one document.
 *
 * The targeted regression this file exists for (LIN-1728 constraint: "Build
 * option-button labels as DOM text, not raw HTML; the chat HTML sink is
 * unsafe for agent-authored strings"): a decision option's `label` is
 * agent-authored (it comes straight off another session's `kind: 'decision'`
 * feedback payload) and MUST render as literal text even when it contains
 * markup — never interpreted as HTML.
 *
 * Run with: node --test tests/unit/chat-append-options.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld } from './helpers/client-world.js';

/**
 * A click on a button, as far as the client can see one: the fake has no
 * `click()`, so this calls the handlers the client recorded with
 * `addEventListener('click', ...)`, with the button as the event target.
 */
const press = (btn) => {
  for (const fn of btn.listenersOf('click')) fn({ type: 'click', target: btn });
};

describe('window.ChatUI.appendOptions (LIN-1728 Phase 4)', () => {
  test('renders one button per option as DOM text, never interpreting a markup-bearing label as HTML', () => {
    const { window, document } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const maliciousLabel = '<img src=x onerror="window.__pwned = true">';

    window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: maliciousLabel }],
      disposition: 'resumable',
      onSelect: () => {}
    });

    const btn = container.querySelectorAll('.chat-option-btn')[0];
    assert.ok(btn, 'expected a rendered option button');
    // The label reaches the button as literal text — textContent, not innerHTML —
    // so it can never execute or be re-interpreted as markup by a later read.
    assert.equal(btn.textContent, maliciousLabel);
    assert.equal(window.__pwned, undefined, 'the label must never execute as markup');
  });

  test('marks the recommended option and fires onSelect with (id, label) on click', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    let selected = null;

    window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }, { id: 'b', label: 'Reject' }],
      recommended: 'a',
      disposition: 'resumable',
      onSelect: (id, label) => { selected = { id, label }; }
    });

    const buttons = container.querySelectorAll('.chat-option-btn');
    assert.equal(buttons.length, 2);
    assert.ok(buttons[0].classList.contains('chat-option--recommended'));
    assert.ok(!buttons[1].classList.contains('chat-option--recommended'));

    press(buttons[1]);
    assert.deepEqual(selected, { id: 'b', label: 'Reject' });
  });

  test('resumable disposition captions "Reply & continue"', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'resumable',
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Reply & continue');
  });

  test('gone disposition captions "Reply & start a run" — labelled honestly as a different action', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'gone',
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Reply & start a run');
  });

  for (const disposition of ['mid-turn', 'indeterminate']) {
    test(`${disposition} is read-only — no buttons render, onSelect is never called`, () => {
      const { document, window } = loadWorld({ scripts: ['chat.js'] });
      const container = document.createElement('div');
      let called = false;

      const wrap = window.ChatUI.appendOptions(container, {
        options: [{ id: 'a', label: 'Approve' }],
        disposition,
        onSelect: () => { called = true; }
      });

      assert.ok(wrap.classList.contains('chat-options--readonly'));
      assert.equal(container.querySelectorAll('.chat-option-btn').length, 0);
      assert.equal(called, false);
    });
  }

  test('task-bound disposition (LIN-2215 F2) captions distinctly and is reply-eligible, not read-only', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    let called = false;
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'task-bound',
      onSelect: () => { called = true; }
    });
    assert.equal(wrap.children[0].textContent, 'A task raised a decision — reply to resolve it');
    assert.notEqual(wrap.children[0].textContent, 'no action available yet', 'must not fall back to the indeterminate caption (the pre-fix regression)');
    assert.ok(!wrap.classList.contains('chat-options--readonly'));
    assert.equal(container.querySelectorAll('.chat-option-btn').length, 1);

    press(container.querySelectorAll('.chat-option-btn')[0]);
    assert.equal(called, true);
  });

  test('an unrecognized disposition falls back to the indeterminate caption AND is read-only (fail-safe allow-list, LIN-2215 F2)', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    let called = false;
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'some-future-disposition',
      onSelect: () => { called = true; }
    });
    assert.equal(wrap.children[0].textContent, 'no action available yet');
    assert.ok(wrap.classList.contains('chat-options--readonly'));
    assert.equal(container.querySelectorAll('.chat-option-btn').length, 0);
    assert.equal(called, false);
  });

  test('no options and a repliable disposition still renders read-only (no dispatch attempted with nothing to press)', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [],
      disposition: 'resumable',
      onSelect: () => {}
    });
    assert.equal(container.querySelectorAll('.chat-option-btn').length, 0);
    assert.ok(wrap.classList.contains('chat-options--readonly'));
  });
});

// LIN-2775 Area 5 — effect-first captions, with the disposition table as
// fallback, gated so a read-only row (no buttons) can never claim an effect.
describe('window.ChatUI.appendOptions — effect captions (LIN-2775 Area 5)', () => {
  test('a gone row with a declared effect captions effect-first, not the disposition caption', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'gone',
      effect: 'dispatch',
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Answer & start a run');
  });

  test('a resumable row with effect "resume" captions "Answer & resume" (effect overrides the disposition caption)', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'resumable',
      effect: 'resume',
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Answer & resume');
  });

  test('a task-bound row with effect "record" captions "Record answer" and stays reply-eligible', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'task-bound',
      effect: 'record',
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Record answer');
    assert.ok(!wrap.classList.contains('chat-options--readonly'));
    assert.equal(container.querySelectorAll('.chat-option-btn').length, 1);
  });

  test('no effect (null/undefined) falls back to the disposition caption exactly as before', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    const wrap = window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      disposition: 'gone',
      effect: null,
      onSelect: () => {}
    });
    assert.equal(wrap.children[0].textContent, 'Reply & start a run');
  });

  // The targeted regression this whole Area exists to prevent (S1 handover,
  // LIN-2775): `resolveEffect` resolves a non-null `effect` — commonly
  // `"record"` — even on a read-only mid-turn/indeterminate row (a live run
  // on the row's own necessarily-non-terminal loop self-matches the anchor).
  // A naive `EFFECT_CAPTIONS[effect] || DISPOSITION_CAPTIONS[disposition]`
  // lookup would print "Record answer" on a row with NO buttons at all,
  // silently claiming an action the row cannot take — regressing LIN-2215
  // F2's honesty property. This is the acceptance witness for that property.
  for (const disposition of ['mid-turn', 'indeterminate']) {
    test(`a read-only ${disposition} row with effect "record" does NOT render an action-claiming caption`, () => {
      const { document, window } = loadWorld({ scripts: ['chat.js'] });
      const container = document.createElement('div');
      const wrap = window.ChatUI.appendOptions(container, {
        options: [{ id: 'a', label: 'Approve' }],
        disposition,
        effect: 'record',
        onSelect: () => {}
      });
      assert.notEqual(wrap.children[0].textContent, 'Record answer', 'a row with no buttons must never claim an effect');
      assert.ok(wrap.classList.contains('chat-options--readonly'));
      assert.equal(container.querySelectorAll('.chat-option-btn').length, 0);
    });
  }

  test('window.ChatUI.resolveCaption applies the exact same read-only gate a caller can reuse directly', () => {
    const { window } = loadWorld({ scripts: ['chat.js'] });
    assert.equal(window.ChatUI.resolveCaption('gone', 'dispatch'), 'Answer & start a run');
    assert.equal(window.ChatUI.resolveCaption('mid-turn', 'record'), 'still running — reply disabled');
    assert.notEqual(window.ChatUI.resolveCaption('mid-turn', 'record'), 'Record answer');
  });
});

// LIN-2757 Step 1 — opt-in `opts.recommendedLabel` marker text on the
// recommended option. Flight Companion's `.fc-decision` cards (public/
// flight-companion.js's renderOneDecision) call appendOptions with no
// `recommendedLabel` key at all, so the "absent by default" case below is
// that call site's own guarantee expressed as an assertion, not a
// hypothetical.
describe('window.ChatUI.appendOptions — recommendedLabel marker (LIN-2757 Step 1)', () => {
  test('renders the marker text on the recommended option when recommendedLabel is set', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }, { id: 'b', label: 'Reject' }],
      recommended: 'a',
      recommendedLabel: 'agent recommends',
      disposition: 'resumable',
      onSelect: () => {}
    });

    const buttons = container.querySelectorAll('.chat-option-btn');
    const marker = buttons[0].children.find(c => c.classList.contains('chat-option-recommended-label'));
    assert.ok(marker, 'expected a marker span on the recommended option');
    assert.equal(marker.textContent, 'agent recommends');
    assert.equal(buttons[0].children.length, 1, 'only the marker span, no other new children');

    const nonRecommendedMarker = buttons[1].children.find(c => c.classList.contains('chat-option-recommended-label'));
    assert.equal(nonRecommendedMarker, undefined, 'a non-recommended option never gets the marker');
  });

  test('omitting recommendedLabel (the default) renders byte-identically to today — the Flight Companion guarantee', () => {
    const { document, window } = loadWorld({ scripts: ['chat.js'] });
    const container = document.createElement('div');
    window.ChatUI.appendOptions(container, {
      options: [{ id: 'a', label: 'Approve' }],
      recommended: 'a',
      disposition: 'resumable',
      onSelect: () => {}
    });

    const btn = container.querySelectorAll('.chat-option-btn')[0];
    assert.ok(btn.classList.contains('chat-option--recommended'), 'the existing CSS-star class is unaffected');
    assert.equal(btn.children.length, 0, 'no marker span is added when recommendedLabel is omitted');
    assert.equal(btn.textContent, 'Approve', 'the button label is exactly what it renders today');
  });
});
