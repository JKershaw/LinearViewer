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
 *   - proxy-off drops "run the whole task" → `__HOME_PROMPT_OPTS__.proxyEnabled`
 *   - promptButtons-off hides templates  → `__HOME_PROMPT_OPTS__.promptButtons`
 * No assertion was deleted or loosened; each moved. The client-side half of the
 * F9 conditions is covered by `tests/unit/prompt-section-p0.test.js`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { renderPage, renderDetailsContent } from '../../lib/render.js';

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
  const m = html.match(/window\.__HOME_PROMPT_OPTS__ = (.*?);<\/script>/s);
  assert.ok(m, '__HOME_PROMPT_OPTS__ embedded');
  return JSON.parse(m[1]);
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
  test('AI off by choice keeps the templates catalog but drops the AI primary (K4/K5)', () => {
    const opts = homeOpts({ featureFlags: { aiRecommendations: false } });
    assert.equal(opts.promptButtons, true, 'templates stay enabled');
    assert.ok(opts.defaultPromptKeys.includes('implementation'), 'default template catalog present');
    assert.ok(opts.morePromptKeys.includes('retro'), 'more template catalog present');
    assert.equal(opts.aiState, 'off', 'AI primary reasons as off-by-choice');
    assert.equal(opts.hasAI, false, 'AI primary is not runnable');
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

  test('proxy off drops the run-whole-task rung (K6)', () => {
    assert.equal(homeOpts({ featureFlags: { proxy: false } }).proxyEnabled, false);
    assert.equal(homeOpts({ featureFlags: { proxy: false } }).hasAutopilot, false);
  });

  test('promptButtons off hides the templates (K7)', () => {
    assert.equal(homeOpts({ featureFlags: { promptButtons: false } }).promptButtons, false);
  });

  test('landing pages emit no Home prompt options (no prompt UI)', () => {
    const html = renderPage([], [], [], 'Org', { isLanding: true });
    assert.ok(!html.includes('__HOME_PROMPT_OPTS__'), 'no embedded options on landing');
  });
});
