/**
 * LIN-1096 — the Dispatch page renders an empty exec-controls placeholder
 * (filled client-side by public/dispatch.js via the shared
 * window.renderDispatchExecControls helper, public/common.js). This pins the
 * server-rendered container: the testid hook E2E selects on, and the
 * data-default-model/data-default-harness attributes that carry the
 * resolved workspace default through to the client-side placeholder nicety
 * (LIN-1094), without ever rendering the model/harness value itself as a
 * pre-filled input (blank must stay blank so it still resolves as "inherit").
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDispatchPage } from '../../lib/render-dispatch.js';

test('renders the exec-controls placeholder container with default data attrs', () => {
  const html = renderDispatchPage('WS', {
    featureFlags: { dispatch: true },
    dispatchDefaults: { model: 'anthropic/claude-opus-4.8', harness: 'opencode' }
  });
  assert.ok(html.includes('data-testid="dispatch-exec-controls-container"'));
  assert.ok(html.includes('data-default-model="anthropic/claude-opus-4.8"'));
  assert.ok(html.includes('data-default-harness="opencode"'));
});

test('renders blank default data attrs when no dispatch defaults are configured', () => {
  const html = renderDispatchPage('WS', { featureFlags: { dispatch: true } });
  assert.ok(html.includes('data-testid="dispatch-exec-controls-container"'));
  assert.ok(html.includes('data-default-model=""'));
  assert.ok(html.includes('data-default-harness=""'));
});

test('escapes dispatch default values in the rendered attributes', () => {
  const html = renderDispatchPage('WS', {
    featureFlags: { dispatch: true },
    dispatchDefaults: { model: '"><script>alert(1)</script>', harness: 'claude-code' }
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
