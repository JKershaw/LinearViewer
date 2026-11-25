/**
 * LIN-2298 — unit tests for the feedback trigger (`renderFeedbackTrigger`, lib/components/navbar.js) and, crucially, for
 * the GATE CONTRACT it shares with the widget mount (`renderFeedbackMount`, lib/components/footer.js).
 *
 * LIN-2298 split the trigger from the panel (the fixed `.feedback-fab` was a `position: fixed` element over full-width
 * content, which LIN-2272 proved no CSS reserve can clear at every scroll offset). That split brought a failure mode:
 *   - mount without trigger → the panel is rendered but unreachable;
 *   - trigger without mount → a control that does nothing when clicked.
 * Neither throws and neither is visible in CI, so the contract is pinned as a contract.
 *
 * LIN-4568 (LIN-4342 piece 7): the old bar that drew the trigger and the old footer that drew the mount are gone. Both
 * are now drawn by one renderer, the frame (renderFrame draws the trigger at the rail's foot and the mount after the
 * page; renderPublicFrame draws neither), so the cases below read one rendered document per input. That makes the old
 * comment's caveat ("a page that threads featureFlags to the navbar and not the footer is invisible here") moot: there
 * is one call, with one featureFlags.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/navbar-feedback-trigger.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderFrame, renderPublicFrame } from '../../lib/components/frame.js';

const TRIGGER = /data-testid="nav-feedback-trigger"/;
const MOUNT = /data-testid="feedback-widget-root"/;

/** The page a person sees: in a workspace, the frame; with no workspace, the public frame. */
function pageFor({ urlKey, featureFlags }) {
  return urlKey
    ? renderFrame({ place: 'home', urlKey, featureFlags })
    : renderPublicFrame({ title: 'Library', viewer: { signedIn: false, homeHref: null } });
}

const hasTrigger = (opts) => TRIGGER.test(pageFor(opts));

/**
 * Whether the widget is actually USABLE on the page: mounted AND enabled. `public/feedback-widget.js` returns early
 * without building the panel when `data-enabled` is not "true", so a disabled mount is not a usable widget.
 */
function hasUsableWidget(opts) {
  const html = pageFor(opts);
  return MOUNT.test(html) && /id="feedback-widget-root"[^>]*data-enabled="true"/.test(html);
}

describe('the feedback trigger at the rail\'s foot (LIN-2298, LIN-4562)', () => {
  const on = () => pageFor({ urlKey: 'test-ws', featureFlags: { feedbackWidget: true } });

  test('renders a button, not a link, with the disclosure attributes the widget maintains', () => {
    const html = on();
    assert.match(html, /<button type="button" class="frame-rail__feedback nav-feedback-trigger"/);
    // A control, never a navigation target: an <a href> would be a lie about what clicking it does.
    assert.doesNotMatch(html, /<a[^>]*nav-feedback-trigger/);
    // `aria-expanded` starts false and is flipped by public/feedback-widget.js as the panel opens/minimizes.
    assert.match(html, /data-testid="nav-feedback-trigger" aria-expanded="false"/);
    assert.match(html, /aria-label="Give feedback"/);
  });

  test('ships DISABLED, so a click cannot land before the widget script binds it', () => {
    // The button is server-rendered and on screen from first paint while feedback-widget.js is still deferred; a click
    // in that gap would vanish silently (measured: it hung the LIN-2298 e2e run). The widget clears `disabled` right
    // after addEventListener, so the enabled state means "this actually works".
    assert.match(on(), /class="frame-rail__feedback nav-feedback-trigger"[^>]*\sdisabled>/);
  });

  test('sits in the rail\'s foot, after the AI status', () => {
    const html = on();
    const foot = html.slice(html.indexOf('frame-rail__foot'), html.indexOf('</nav>', html.indexOf('frame-rail__foot')));
    assert.ok(foot.indexOf('footer-ai-status') < foot.indexOf('nav-feedback-trigger'));
  });

  test('is absent when the feedbackWidget flag is off — the default', () => {
    assert.equal(hasTrigger({ urlKey: 'test-ws', featureFlags: {} }), false);
  });

  test('gates on strict `=== true`, matching the widget mount rather than truthiness', () => {
    assert.equal(hasTrigger({ urlKey: 'test-ws', featureFlags: { feedbackWidget: 'yes' } }), false);
    assert.equal(hasTrigger({ urlKey: 'test-ws', featureFlags: { feedbackWidget: 1 } }), false);
  });

  test('is absent with no workspace even when the flag is on', () => {
    assert.equal(hasTrigger({ urlKey: null, featureFlags: { feedbackWidget: true } }), false);
  });

  test('the fixed FAB is gone from the rendered chrome entirely', () => {
    assert.doesNotMatch(on(), /feedback-fab/);
  });
});

describe('LIN-2298 gate contract: the trigger and the widget mount agree', () => {
  // The cross-product of every input either gate reads, enumerated rather than spot-checked.
  const CASES = [];
  for (const urlKey of ['test-ws', null]) {
    for (const featureFlags of [{ feedbackWidget: true }, { feedbackWidget: false }, { feedbackWidget: 'yes' }, {}]) {
      CASES.push({ urlKey, featureFlags });
    }
  }

  for (const opts of CASES) {
    const label = `urlKey=${opts.urlKey} flag=${JSON.stringify(opts.featureFlags.feedbackWidget)}`;
    test(`trigger presence matches widget usability (${label})`, () => {
      assert.equal(hasTrigger(opts), hasUsableWidget(opts),
        'a trigger with no usable widget does nothing when clicked; a usable widget with no trigger is unreachable');
    });
  }

  test('the enumeration actually covers both outcomes, so the equality is not vacuous', () => {
    const outcomes = CASES.map(hasTrigger);
    assert.ok(outcomes.includes(true), 'at least one case renders the trigger');
    assert.ok(outcomes.includes(false), 'at least one case does not');
  });
});
