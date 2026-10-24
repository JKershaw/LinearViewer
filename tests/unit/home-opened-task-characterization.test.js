/**
 * LIN-2944 P1 — Home opened-task behavior, at its NEW home.
 *
 * Beat 1 pinned these behaviors against Home's inline renderer. P1 retires that
 * renderer and mounts the shared `PromptSection`; each kept behavior is now
 * asserted where it lives:
 *   - source provenance / data-url-key  → the `[data-prompt-mount]` placeholder
 *   - AI-off keeps templates            → `__HOME_PROMPT_OPTS__` catalog + the
 *                                          component test in prompt-section-p0
 *   - AI-off drops the AI primary        → `__HOME_PROMPT_OPTS__.aiState` + the
 *                                          component test (disabled primary)
 *   - run controls → `__HOME_PROMPT_OPTS__.dispatchEnabled` / `.runSetup` (LIN-3849)
 *   - promptButtons-off hides templates  → removed in LIN-3848 (templates always show)
 * No assertion was deleted or loosened; each moved. The client-side half of the
 * F9 conditions is covered by `tests/unit/prompt-section-p0.test.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderPage, renderDetailsContent } from '../../lib/render.js';
import { extractEmbeddedData, embeddedDataText } from '../helpers/embedded-data.js';

const STUB_PROVIDER = { name: 'jira', ui: { write: false, comments: true, estimates: true, subtasks: true, displayName: 'Jira' } };
const WORKSPACE = { urlKey: 'ws', name: 'WS', provider: 'jira' };

function stubIssue() {
  return { id: 'i1', identifier: 'STB-1', title: 'A task', state: { type: 'started' }, labels: { nodes: [] } };
}

function mountTag(html) {
  return (html.match(/<div class="home-prompt-mount"[^>]*>/) || [''])[0];
}

function homeOpts(overrides = {}) {
  const html = renderPage([], [], [], 'Org', {
    urlKey: 'ws', workspaces: [WORKSPACE], openRouterSource: 'oauth', featureFlags: {}, ...overrides
  });
  return extractEmbeddedData(html, '__HOME_PROMPT_OPTS__');
}

describe('Home opened-task mount: source provenance (LIN-1904/LIN-1910)', () => {
  test('the mount carries the issue id, provider source, url key and instance key (K1/K3)', () => {
    const html = renderDetailsContent(stubIssue(), {
      isLanding: false, urlKey: 'ws', provider: STUB_PROVIDER, featureFlags: { dispatch: true, proxy: true }, section: 'in-progress'
    });
    const tag = mountTag(html);
    assert.match(tag, /data-issue-id="i1"/, 'issue id');
    assert.match(tag, /data-source="jira"/, 'provider source');
    assert.match(tag, /data-url-key="ws"/, 'url key');
    assert.match(tag, /data-instance-key="in-progress-i1"/, 'instance key');
  });

  test('no data-source attribute when no provider resolves (K2)', () => {
    const html = renderDetailsContent(stubIssue(), { isLanding: false, urlKey: 'ws', featureFlags: {} });
    const tag = mountTag(html);
    assert.match(tag, /data-issue-id="i1"/, 'mount still renders');
    assert.ok(!tag.includes('data-source='), 'no data-source attribute');
  });
});

describe('Home opened-task page options: feature-flag truth conditions (F9)', () => {
  test('a stale aiRecommendations=false is ignored: templates and the AI primary stay (K4/K5, LIN-3848)', () => {
    const opts = homeOpts({ featureFlags: { aiRecommendations: false } });
    assert.ok(!('promptButtons' in opts), 'no promptButtons key: templates always show');
    assert.ok(opts.defaultPromptKeys.includes('implementation'), 'default template catalog present');
    assert.ok(opts.morePromptKeys.includes('retro'), 'more template catalog present');
    assert.equal(opts.aiState, 'ready', 'AI primary is always available');
    assert.equal(opts.hasAI, true, 'AI primary is runnable');
  });

  test('AI on resolves aiState ready and hasAI true (K5 baseline)', () => {
    const opts = homeOpts({ featureFlags: {} });
    assert.equal(opts.aiState, 'ready');
    assert.equal(opts.hasAI, true);
  });

  test('AI unconfigured resolves aiState unconfigured (K5 sibling)', () => {
    const opts = homeOpts({ openRouterSource: null });
    assert.equal(opts.aiState, 'unconfigured');
    assert.equal(opts.hasAI, false);
  });

  test('run controls follow the derived bits, not stored switches (K6, LIN-3849)', () => {
    // A stale stored dispatch/proxy value is ignored: only runControls / runSetup count.
    const stale = homeOpts({ featureFlags: { dispatch: true, proxy: false } });
    assert.equal(stale.dispatchEnabled, false);
    assert.equal(stale.runSetup, false);
    assert.ok(!('proxyEnabled' in stale) && !('hasAutopilot' in stale), 'the proxy opts keys are gone');
    const owner = homeOpts({ featureFlags: { runControls: true } });
    assert.equal(owner.dispatchEnabled, true);
    assert.equal(owner.runSetup, false);
    const keyless = homeOpts({ featureFlags: { runSetup: true } });
    assert.equal(keyless.dispatchEnabled, false);
    assert.equal(keyless.runSetup, true);
  });

  test('a stale promptButtons=false is ignored: the templates are always shown (K7, LIN-3848)', () => {
    const opts = homeOpts({ featureFlags: { promptButtons: false } });
    assert.ok(!('promptButtons' in opts));
    assert.ok(opts.defaultPromptKeys.length > 0);
  });

  test('landing pages emit no Home prompt options (no prompt UI)', () => {
    const html = renderPage([], [], [], 'Org', { isLanding: true });
    assert.ok(!html.includes('__HOME_PROMPT_OPTS__'), 'no embedded options on landing');
  });
});
