/**
 * LIN-2944 P1 — characterization tests for Home opened-task behaviors.
 *
 * Written BEFORE the Home migration (beat 1) so the P1 change has a safety net.
 * These pin behaviors that P1 KEEPS (not the ones it deliberately retargets, e.g.
 * the F9 `promptButtons`/`aiRecommendations` truth conditions, which get their
 * own explicit retarget in beat 3). They are written against the current
 * unmigrated renderer, so beat 3 must retarget the *selectors* of the ones whose
 * Home markup moves onto the shared `PromptSection` mount — while the truth
 * (source provenance on the opened-task surface, templates surviving AI-off,
 * proxy-gated Autopilot) stays asserted.
 *
 * Behavior table (see the P1 PR / Linear comment for the full one):
 *   K1 source provenance on the manual/recommend/Autopilot containers  -> keep/move
 *   K2 no data-source when no provider resolves                        -> keep
 *   K3 data-url-key on every container                                 -> keep
 *   K4 AI off does not remove the templates                            -> keep
 *   K5 AI off removes the AI suggest + recommend container             -> keep
 *   K6 proxy off removes the Autopilot container                       -> keep
 *   K7 promptButtons off hides the default template links              -> keep (narrowed in F9)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderDetailsContent } from '../../lib/render.js';

function stubIssue() {
  return {
    id: 'i1',
    identifier: 'STB-1',
    title: 'A task',
    state: { type: 'started' },
    labels: { nodes: [] }
  };
}

const STUB_PROVIDER = { name: 'jira', ui: { write: false, comments: true, estimates: true, subtasks: true, displayName: 'Jira' } };

function render(overrides = {}) {
  return renderDetailsContent(stubIssue(), {
    isLanding: false,
    urlKey: 'ws',
    openRouterSource: 'oauth',
    provider: STUB_PROVIDER,
    featureFlags: { dispatch: true, proxy: true },
    ...overrides
  });
}

// Grab the opening tag of a named container so a test asserts on its attributes
// without depending on the surrounding markup.
function containerTag(html, className) {
  const m = html.match(new RegExp(`<div class="${className}[^>]*>`));
  return m ? m[0] : '';
}

describe('Home opened-task characterization: source provenance (LIN-1904/LIN-1910)', () => {
  test('threads the resolved provider name as data-source on all three containers (K1)', () => {
    const html = render();
    assert.match(containerTag(html, 'prompt-container'), /data-source="jira"/, 'manual prompt container carries data-source');
    assert.match(containerTag(html, 'recommend-container'), /data-source="jira"/, 'recommend container carries data-source');
    assert.match(containerTag(html, 'autopilot-container'), /data-source="jira"/, 'Autopilot container carries data-source');
  });

  test('omits data-source when no provider resolves (no-op, K2)', () => {
    const html = render({ provider: null });
    assert.match(containerTag(html, 'prompt-container'), /data-prompt-for="i1"/, 'container still renders');
    assert.ok(!containerTag(html, 'prompt-container').includes('data-source='), 'no data-source attribute');
    assert.ok(!containerTag(html, 'recommend-container').includes('data-source='), 'no data-source attribute');
    assert.ok(!containerTag(html, 'autopilot-container').includes('data-source='), 'no data-source attribute');
  });

  test('carries data-url-key on every container so the client fetch is workspace-scoped (K3)', () => {
    const html = render();
    for (const cls of ['prompt-container', 'recommend-container', 'autopilot-container']) {
      assert.match(containerTag(html, cls), /data-url-key="ws"/, `${cls} carries data-url-key`);
    }
  });
});

describe('Home opened-task characterization: feature-flag truth conditions', () => {
  test('AI off does not remove the manual templates (K4)', () => {
    const html = render({ featureFlags: { dispatch: true, proxy: true, aiRecommendations: false } });
    assert.ok(html.includes('data-label="implementation"'), 'default template links remain');
    assert.ok(containerTag(html, 'prompt-container').length > 0, 'manual prompt container remains');
  });

  test('AI off removes the AI suggest link and the recommend container (K5)', () => {
    const html = render({ featureFlags: { dispatch: true, proxy: true, aiRecommendations: false } });
    assert.ok(!html.includes('suggest-btn'), 'no AI suggest link');
    assert.equal(containerTag(html, 'recommend-container'), '', 'no recommend container');
  });

  test('AI on renders the AI suggest link and the recommend container (K5 baseline)', () => {
    const html = render();
    assert.ok(html.includes('suggest-btn'), 'AI suggest link present');
    assert.ok(containerTag(html, 'recommend-container').length > 0, 'recommend container present');
  });

  test('proxy off removes the Autopilot container (K6)', () => {
    const html = render({ featureFlags: { dispatch: true, proxy: false } });
    assert.equal(containerTag(html, 'autopilot-container'), '', 'no Autopilot container');
  });

  test('promptButtons off hides the default template links (K7)', () => {
    const html = render({ featureFlags: { dispatch: true, proxy: true, promptButtons: false } });
    assert.ok(!html.includes('data-label="implementation"'), 'default template links absent');
    assert.ok(!html.includes('suggest-btn'), 'AI suggest absent');
  });
});
