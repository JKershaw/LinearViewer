// =============================================================================
// Feedback widget — feature flag + footer surface (LIN-635)
// =============================================================================
//
// Covers the two server-rendered seams the widget rides on: the per-user
// `feedbackWidget` feature flag (shared persistence) and the widget mount/assets
// on authenticated, workspace-scoped pages. LIN-4568: the old footer that drew
// the mount went with the old bar; the frame (renderFrame) draws it on every
// signed-in page, and the public frame and the landing draw none.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FEATURES,
  FEATURE_DEFAULTS,
  FEATURE_LABELS,
  isValidFeatureKey
} from '../../lib/feature-defaults.js';
import { renderFrame, renderPublicFrame, renderFrameFooter } from '../../lib/components/frame.js';
import { renderLandingPage } from '../../lib/render-landing.js';

/** A signed-in page in the frame, as the old footer's options described it. */
const renderPageFooter = ({ urlKey, featureFlags = {}, dispatchDefaults = {} }) =>
  renderFrame({ place: 'home', urlKey, featureFlags, dispatchDefaults });

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

describe('feedbackTriage feature flag (LIN-733, removed in LIN-3848)', () => {
  test('is no longer a flag: the widget\'s own action picks the lane', () => {
    assert.strictEqual('FEEDBACK_TRIAGE' in FEATURES, false);
    assert.strictEqual(isValidFeatureKey('feedbackTriage'), false);
    assert.ok(!('feedbackTriage' in FEATURE_DEFAULTS));
    assert.ok(!('feedbackTriage' in FEATURE_LABELS));
  });
});

describe('the feedback widget mount on framed pages (LIN-635, LIN-4568)', () => {
  test('renders the widget mount on an authenticated workspace page, with no footer toggle (LIN-3848)', () => {
    const html = renderPageFooter({ urlKey: 'acme', featureFlags: {} });
    assert.match(html, /data-testid="feedback-widget-root"/);
    assert.match(html, /\/feedback-widget\.js/);
    assert.match(html, /\/feedback-widget\.css/);
    assert.match(html, /data-url-key="acme"/);
    assert.doesNotMatch(html, /footer-feedback-toggle/);
    assert.doesNotMatch(html, />feedback</, 'flag off: no trigger');
  });

  test('the mount reflects the flag state', () => {
    const off = renderPageFooter({ urlKey: 'acme', featureFlags: { feedbackWidget: false } });
    assert.match(off, /id="feedback-widget-root"[^>]*data-enabled="false"/);
    const on = renderPageFooter({ urlKey: 'acme', featureFlags: { feedbackWidget: true } });
    assert.match(on, /id="feedback-widget-root"[^>]*data-enabled="true"/);
  });

  test('Settings is the single place to switch the widget (LIN-3848)', () => {
    assert.ok(FEATURE_LABELS.feedbackWidget);
    // The footer is the same on every page: no feedback control in it, whatever the flag.
    const footer = renderFrameFooter({});
    assert.match(footer, /Privacy/);
    assert.match(footer, /Terms/);
    assert.doesNotMatch(footer, /feedback/i);
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

  test('is omitted on the unauthenticated landing', () => {
    const html = renderLandingPage({});
    assert.doesNotMatch(html, /feedback-widget-root/);
    assert.doesNotMatch(html, /footer-feedback-toggle/);
  });

  test('is omitted where there is no workspace: the public frame', () => {
    const html = renderPublicFrame({ title: 'Library', viewer: { signedIn: false, homeHref: null } });
    assert.doesNotMatch(html, /feedback-widget-root/);
  });
});

describe('feedback widget — run-limit refusal message (LIN-3238)', () => {
  test('handles data.triage like data.autopilot so a refused triage shows its message', () => {
    const src = readFileSync(new URL('../../public/feedback-widget.js', import.meta.url), 'utf8');
    // A refused triage must not read as a bare "Filed".
    assert.match(src, /data\.triage && data\.triage\.launched === false/);
    assert.match(src, /Triage was not started: \$\{data\.triage\.message\}/);
    // The autopilot branch is unchanged and still present.
    assert.match(src, /data\.autopilot && data\.autopilot\.launched === false/);
    assert.match(src, /Autopilot was not started: \$\{data\.autopilot\.message\}/);
  });
});
