/**
 * LIN-2298 — unit tests for the nav-chrome feedback trigger
 * (`renderNavBar`, lib/components/navbar.js) and, crucially, for the GATE
 * CONTRACT it shares with the widget mount (`renderPageFooter`,
 * lib/components/footer.js).
 *
 * Why the two are tested together rather than in separate files. Before this
 * ticket, the trigger and the panel were one blob of markup emitted by one
 * function, so they could not disagree about when to exist. LIN-2298 split them
 * across two components on John's ruling (the fixed `.feedback-fab` was a
 * `position: fixed` element over full-width content, which LIN-2272 proved no
 * CSS reserve can clear at every scroll offset). That split introduced a failure
 * mode that did not exist before:
 *
 *   - mount without trigger → the panel is rendered but unreachable;
 *   - trigger without mount → a control that does nothing when clicked.
 *
 * Neither throws, neither is visible in CI, and both are one forgotten
 * `featureFlags` argument away on any of the ~30 pages that render both
 * components. So the contract is pinned as a contract: for the same
 * `(urlKey, isLanding, featureFlags)` the two renderers must agree.
 *
 * Run with: node --test tests/unit/navbar-feedback-trigger.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderNavBar } from '../../lib/components/navbar.js';
import { renderPageFooter } from '../../lib/components/footer.js';

const WORKSPACES = [{ id: 'w1', name: 'Test WS', urlKey: 'test-ws' }];

const TRIGGER = /data-testid="nav-feedback-trigger"/;
const MOUNT = /data-testid="feedback-widget-root"/;

/** The trigger's own presence for a given nav input. */
function hasTrigger(opts) {
  return TRIGGER.test(renderNavBar({ workspaces: WORKSPACES, ...opts }));
}

/**
 * Whether the widget is actually USABLE on a page rendered with these inputs:
 * the footer must mount it AND the mount must be enabled. `renderFeedbackMount`
 * emits the root on every `!isLanding && urlKey` page regardless of the flag,
 * carrying `data-enabled` — and `public/feedback-widget.js` returns early
 * without building the panel when that is not `"true"`. So a disabled mount is
 * not a usable widget, and the trigger must not render against one.
 */
function hasUsableWidget(opts) {
  const html = renderPageFooter(opts);
  return MOUNT.test(html) && /data-enabled="true"/.test(html);
}

describe('renderNavBar — feedback trigger (LIN-2298)', () => {
  test('renders a button, not a link, with the disclosure attributes the widget maintains', () => {
    const html = renderNavBar({ workspaces: WORKSPACES, urlKey: 'test-ws', featureFlags: { feedbackWidget: true } });
    assert.match(html, TRIGGER);
    assert.match(html, /<button type="button" class="nav-action nav-feedback-trigger"/);
    // A control, never a navigation target: an <a href> here would be a lie
    // about what clicking it does, and would put it in the view-switcher's
    // vocabulary rather than the nav-actions one.
    assert.doesNotMatch(html, /<a[^>]*nav-feedback-trigger/);
    // `aria-expanded` starts false and is flipped by public/feedback-widget.js
    // as the panel opens/minimizes. Without it the button announces as an
    // unlabelled action rather than a disclosure.
    assert.match(html, /data-testid="nav-feedback-trigger" aria-expanded="false"/);
    assert.match(html, /aria-label="Give feedback"/);
  });

  test('ships DISABLED, so a click cannot land before the widget script binds it', () => {
    // Not cosmetic, and not a defensive habit — this is a race the FAB could
    // not have had. The FAB was created BY public/feedback-widget.js, so its
    // existence proved the click handler was attached. This button is
    // server-rendered and interactive from first paint while that script is
    // still deferred, so a click in the gap would find no listener and vanish
    // silently. It was measured, not theorised: it is what made the LIN-2298
    // e2e run hang on a click that opened nothing.
    //
    // `public/feedback-widget.js` clears `disabled` immediately AFTER
    // addEventListener, so the enabled state means "this actually works".
    const html = renderNavBar({ workspaces: WORKSPACES, urlKey: 'test-ws', featureFlags: { feedbackWidget: true } });
    assert.match(html, /class="nav-action nav-feedback-trigger"[^>]*\sdisabled>/);
  });

  test('is absent when the feedbackWidget flag is off — the default', () => {
    assert.equal(hasTrigger({ urlKey: 'test-ws', featureFlags: {} }), false);
  });

  test('gates on strict `=== true`, matching the widget mount rather than truthiness', () => {
    // The mount reads `featureFlags.feedbackWidget === true`. A trigger that
    // gated on truthiness would render against a mount that did not.
    assert.equal(hasTrigger({ urlKey: 'test-ws', featureFlags: { feedbackWidget: 'yes' } }), false);
    assert.equal(hasTrigger({ urlKey: 'test-ws', featureFlags: { feedbackWidget: 1 } }), false);
  });

  test('is absent with no urlKey even when the flag is on', () => {
    // No urlKey means no workspace, and `renderFeedbackMount` is gated on one —
    // so there would be no panel behind the trigger.
    assert.equal(hasTrigger({ urlKey: null, featureFlags: { feedbackWidget: true } }), false);
  });

  test('is absent entirely on the unauthenticated landing nav', () => {
    assert.equal(hasTrigger({ isLanding: true, urlKey: 'test-ws', featureFlags: { feedbackWidget: true } }), false);
  });

  test('trails the queue and rulings badges in nav-actions source order', () => {
    const html = renderNavBar({
      workspaces: WORKSPACES, urlKey: 'test-ws',
      featureFlags: { dispatch: true, feedbackWidget: true }
    });
    const queue = html.indexOf('data-queue-badge');
    const rulings = html.indexOf('data-rulings-badge');
    const feedback = html.indexOf('nav-feedback-trigger');
    assert.ok(queue !== -1 && rulings !== -1 && feedback !== -1, 'all three present');
    assert.ok(queue < rulings, 'queue badge before rulings badge');
    assert.ok(rulings < feedback, 'feedback trigger trails both badges');
  });

  test('the fixed FAB is gone from the rendered chrome entirely', () => {
    // The whole point of the ticket. Asserted on the nav AND the footer so a
    // partial revert that put the FAB back in either place fails here.
    const nav = renderNavBar({ workspaces: WORKSPACES, urlKey: 'test-ws', featureFlags: { feedbackWidget: true } });
    const footer = renderPageFooter({ urlKey: 'test-ws', featureFlags: { feedbackWidget: true } });
    assert.doesNotMatch(nav, /feedback-fab/);
    assert.doesNotMatch(footer, /feedback-fab/);
  });
});

describe('LIN-2298 gate contract: the trigger and the widget mount agree', () => {
  // The cross-product of every input either gate reads. Enumerated rather than
  // spot-checked, because the failure this guards against is exactly a case
  // nobody thought to spot-check.
  const CASES = [];
  for (const urlKey of ['test-ws', null]) {
    for (const isLanding of [false, true]) {
      for (const featureFlags of [{ feedbackWidget: true }, { feedbackWidget: false }, {}]) {
        CASES.push({ urlKey, isLanding, featureFlags });
      }
    }
  }

  for (const opts of CASES) {
    const label = `urlKey=${opts.urlKey} isLanding=${opts.isLanding} flag=${JSON.stringify(opts.featureFlags.feedbackWidget)}`;
    test(`trigger presence matches widget usability (${label})`, () => {
      assert.equal(
        hasTrigger(opts),
        hasUsableWidget(opts),
        'a trigger with no usable widget does nothing when clicked; a usable widget with no trigger is unreachable'
      );
    });
  }

  test('the enumeration actually covers both outcomes, so the equality is not vacuous', () => {
    // Without this, an accident that made BOTH renderers emit nothing for every
    // input would pass every case above.
    const outcomes = CASES.map(hasTrigger);
    assert.ok(outcomes.includes(true), 'at least one case renders the trigger');
    assert.ok(outcomes.includes(false), 'at least one case does not');
  });
});
