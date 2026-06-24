// =============================================================================
// Feedback widget — feature flag + footer surface (LIN-635)
// =============================================================================
//
// Covers the two server-rendered seams the widget rides on: the per-user
// `feedbackWidget` feature flag (shared persistence) and the footer-resident
// toggle + widget mount/assets that renderPageFooter emits on authenticated,
// workspace-scoped pages.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURES,
  FEATURE_DEFAULTS,
  FEATURE_LABELS,
  isValidFeatureKey
} from '../../lib/feature-defaults.js';
import { renderPageFooter } from '../../lib/components/footer.js';

describe('feedbackWidget feature flag (LIN-635)', () => {
  test('is registered as a valid per-user flag', () => {
    assert.strictEqual(FEATURES.FEEDBACK_WIDGET, 'feedbackWidget');
    assert.strictEqual(isValidFeatureKey('feedbackWidget'), true);
  });

  test('defaults to off (hidden by default)', () => {
    assert.strictEqual(FEATURE_DEFAULTS.feedbackWidget, false);
  });

  test('has a human-readable label for the settings UI', () => {
    assert.ok(FEATURE_LABELS.feedbackWidget);
  });
});

describe('footer feedback surface (LIN-635)', () => {
  test('renders the toggle and widget mount on an authenticated workspace page', () => {
    const html = renderPageFooter({ urlKey: 'acme', featureFlags: {} });
    assert.match(html, /data-testid="footer-feedback-toggle"/);
    assert.match(html, /data-testid="feedback-widget-root"/);
    assert.match(html, /\/feedback-widget\.js/);
    assert.match(html, /\/feedback-widget\.css/);
    // urlKey is threaded onto both the toggle and the mount.
    assert.match(html, /data-url-key="acme"/);
  });

  test('reflects the off state when the flag is disabled', () => {
    const html = renderPageFooter({ urlKey: 'acme', featureFlags: { feedbackWidget: false } });
    // mount + toggle both report disabled
    assert.match(html, /id="feedback-widget-root"[^>]*data-enabled="false"/);
    assert.match(html, /footer-feedback-toggle[^>]*data-enabled="false"/);
    assert.match(html, /feedback: ○/);
  });

  test('reflects the on state when the flag is enabled', () => {
    const html = renderPageFooter({ urlKey: 'acme', featureFlags: { feedbackWidget: true } });
    assert.match(html, /id="feedback-widget-root"[^>]*data-enabled="true"/);
    assert.match(html, /footer-feedback-toggle[^>]*data-enabled="true"/);
    assert.match(html, /feedback: ●/);
  });

  test('is omitted on the unauthenticated landing footer', () => {
    const html = renderPageFooter({ isLanding: true, currentPage: '/' });
    assert.doesNotMatch(html, /feedback-widget-root/);
    assert.doesNotMatch(html, /footer-feedback-toggle/);
  });

  test('is omitted when there is no workspace urlKey', () => {
    const html = renderPageFooter({ urlKey: null, featureFlags: { feedbackWidget: true } });
    assert.doesNotMatch(html, /feedback-widget-root/);
  });
});
