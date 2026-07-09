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

describe('feedbackTriage feature flag (LIN-733)', () => {
  test('is registered as a valid per-user flag', () => {
    assert.strictEqual(FEATURES.FEEDBACK_TRIAGE, 'feedbackTriage');
    assert.strictEqual(isValidFeatureKey('feedbackTriage'), true);
  });

  test('defaults to off — triage dispatch is opt-in', () => {
    assert.strictEqual(FEATURE_DEFAULTS.feedbackTriage, false);
  });

  test('has a human-readable label for the settings UI', () => {
    assert.ok(FEATURE_LABELS.feedbackTriage);
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
    // mount + link both report disabled
    assert.match(html, /id="feedback-widget-root"[^>]*data-enabled="false"/);
    assert.match(html, /footer-feedback-toggle[^>]*data-enabled="false"/);
  });

  test('reflects the on state when the flag is enabled', () => {
    const html = renderPageFooter({ urlKey: 'acme', featureFlags: { feedbackWidget: true } });
    assert.match(html, /id="feedback-widget-root"[^>]*data-enabled="true"/);
    assert.match(html, /footer-feedback-toggle[^>]*data-enabled="true"/);
  });

  test('renders feedback as a simple link alongside the privacy/terms legal links (LIN-641)', () => {
    const html = renderPageFooter({ urlKey: 'acme', featureFlags: {} });
    // Presented as a plain "feedback" link styled like the legal links, no ●/○ toggle text.
    assert.match(html, /class="footer-legal footer-feedback-toggle"[^>]*>feedback</);
    assert.doesNotMatch(html, /feedback: [●○]/);
    // It lives inside the .footer-deploy legal row, not in a standalone wrap after </footer>.
    assert.doesNotMatch(html, /footer-feedback-toggle-wrap/);
    const deployRow = html.match(/<div class="footer-deploy">([\s\S]*?)<\/div>/);
    assert.ok(deployRow, 'footer-deploy row present');
    assert.match(deployRow[1], /privacy/);
    assert.match(deployRow[1], /terms/);
    assert.match(deployRow[1], /footer-feedback-toggle/);
  });

  // LIN-1132: the widget's model/harness exec-controls read the workspace
  // dispatch default from the mount's data-default-* attrs (the same UX-only
  // placeholder-hint seam the Dispatch page threads through its
  // exec-controls container). This pins the server-rendered mount attributes;
  // the client control render + payload wiring is covered by the E2E spec.
  test('threads the workspace dispatch defaults onto the widget mount (LIN-1132)', () => {
    const html = renderPageFooter({
      urlKey: 'acme', featureFlags: { feedbackWidget: true },
      dispatchDefaults: { model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
    });
    assert.match(html, /id="feedback-widget-root"[^>]*data-default-model="anthropic\/claude-opus-4\.8"/);
    assert.match(html, /id="feedback-widget-root"[^>]*data-default-harness="opencode"/);
  });

  test('renders blank default attrs when no dispatch defaults are configured (LIN-1132)', () => {
    const html = renderPageFooter({ urlKey: 'acme', featureFlags: { feedbackWidget: true } });
    assert.match(html, /id="feedback-widget-root"[^>]*data-default-model=""/);
    assert.match(html, /id="feedback-widget-root"[^>]*data-default-harness=""/);
  });

  test('escapes dispatch default values in the mount attributes (LIN-1132)', () => {
    const html = renderPageFooter({
      urlKey: 'acme', featureFlags: { feedbackWidget: true },
      dispatchDefaults: { model: '"><script>alert(1)</script>', harness: 'claude-code' }
    });
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;/);
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
