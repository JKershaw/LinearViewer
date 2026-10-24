/**
 * LIN-3849 — run controls render for the workspace OWNER whose workspace has a
 * live runner key or queue token, and for nobody else; key tools render with no
 * flag set.
 *
 * End to end through the real resolver (lib/run-controls.js) over fake owner and
 * token stores, into the real renderers: the nav (Dispatch link, queue and
 * rulings badges), the opened-task opts (Go / run-step / the set-up rung) and
 * the Dispatch page's send menu. The periodicals' Dispatch and "+ Autopilot" are
 * pinned in tests/unit/render.test.js, and the prompt-section markup in
 * tests/unit/prompt-section-p0.test.js. No live service.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRunControlsResolver } from '../../lib/run-controls.js';
import { renderNavBar } from '../../lib/components/navbar.js';
import { buildPromptOpts } from '../../lib/render-prompt-opts.js';
import { renderDispatchPage } from '../../lib/render-dispatch.js';
import { renderProxyPage } from '../../lib/render-proxy.js';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const iso = (ms) => new Date(NOW + ms).toISOString();
const runnerKey = (o = {}) => ({ grants: ['take', 'dispatch'], consumed: false, expiresAt: iso(3600e3), ...o });
const WS = { id: 'w1', urlKey: 'acme' };

async function flagsFor({ owner = true, proxy = [], queue = [] }) {
  const resolve = createRunControlsResolver({
    ownerCheck: async () => ({ status: owner ? 'owner' : 'not-owner' }),
    proxyTokenStore: { listTokens: async () => proxy },
    dispatchTokenStore: { listTokens: async () => queue },
    now: () => NOW
  });
  return resolve({ workspace: WS, accountId: 'a1' });
}

// The ticket's four cases, plus the queue-token and legacy rows.
const CASES = [
  ['owner with a live runner key', { proxy: [runnerKey()] }, true],
  ['owner with a live queue token', { queue: [{ expiresAt: iso(86400e3) }] }, true],
  ['owner with a legacy no-expiry queue token', { queue: [{ expiresAt: null }] }, true],
  ['member (not the owner) even with a live key', { owner: false, proxy: [runnerKey()] }, false],
  ['owner with no key at all', {}, false],
  ['owner whose only runner key is revoked (row deleted)', { proxy: [] }, false],
  ['owner whose only runner key is expired', { proxy: [runnerKey({ expiresAt: iso(-1) })] }, false],
  ['owner whose only queue token is expired', { queue: [{ expiresAt: iso(-1) }] }, false],
  ['owner whose only key is a driver copy (no take)', { proxy: [runnerKey({ grants: ['dispatch'] })] }, false]
];

describe('run controls render for the owner with a live way to run, and nobody else', () => {
  for (const [name, setup, expected] of CASES) {
    test(`${name} → ${expected ? 'run controls' : 'none'}`, async () => {
      const featureFlags = await flagsFor(setup);
      assert.equal(featureFlags.runControls, expected);

      const nav = renderNavBar({ workspaces: [{ urlKey: 'acme', name: 'Acme' }], urlKey: 'acme', currentPage: 'settings', featureFlags });
      assert.equal(nav.includes('data-testid="nav-view-dispatch"'), expected, 'Dispatch nav link');
      assert.equal(nav.includes('data-queue-badge'), expected, 'queue badge');
      assert.equal(nav.includes('data-rulings-badge'), expected, 'rulings badge');

      const opts = buildPromptOpts({ openRouterSource: 'byok', featureFlags });
      assert.equal(opts.dispatchEnabled, expected, 'Go / run-step enabled');

      const dispatchPage = renderDispatchPage('Acme', { urlKey: 'acme', featureFlags });
      assert.equal(dispatchPage.includes('dispatch-prompt-send'), expected, 'the Dispatch page send targets');
    });
  }

  test('the set-up rung is the keyless owner only', async () => {
    const owner = await flagsFor({ proxy: [runnerKey()] });
    const keyless = await flagsFor({});
    const member = await flagsFor({ owner: false });
    assert.equal(buildPromptOpts({ featureFlags: owner }).runSetup, false);
    assert.equal(buildPromptOpts({ featureFlags: keyless }).runSetup, true);
    assert.equal(buildPromptOpts({ featureFlags: member }).runSetup, false);
  });

  test('a task-share guest page passes no flags, so it gets no run controls', () => {
    const opts = buildPromptOpts({ featureFlags: {} });
    assert.equal(opts.dispatchEnabled, false);
    assert.equal(opts.runSetup, false);
  });
});

describe('key tools render with no flag set', () => {
  test('the Proxy page and its nav link are always there', () => {
    const nav = renderNavBar({ workspaces: [{ urlKey: 'acme', name: 'Acme' }], urlKey: 'acme', currentPage: 'settings', featureFlags: {} });
    assert.ok(nav.includes('data-testid="nav-view-proxy"'));
    const html = renderProxyPage('Acme', { urlKey: 'acme', featureFlags: {}, baseUrl: 'https://h.example' });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
  });

  test('the Dispatch page keeps its Autopilot loaders and +proxy for a member', () => {
    const html = renderDispatchPage('Acme', { urlKey: 'acme', featureFlags: {} });
    assert.ok(html.includes('dispatch-load-autopilot'));
    assert.ok(html.includes('prompt-proxy-toggle'));
    assert.ok(!html.includes('dispatch-prompt-send'), 'but no send targets');
  });
});

describe('the Dispatch page is read-only for a member', () => {
  const page = (featureFlags) => renderDispatchPage('Acme', { urlKey: 'acme', featureFlags });

  test('a member gets no halt buttons but keeps the halt status, and the token form is disabled', () => {
    const html = page({});
    assert.ok(!html.includes('dispatch-halt-pause'));
    assert.ok(!html.includes('dispatch-halt-stop'));
    assert.ok(!html.includes('dispatch-halt-resume'));
    assert.ok(html.includes('data-testid="dispatch-halt-status"'));
    // The form element stays: public/dispatch.js returns early without it and the token list would not load.
    assert.match(html, /id="create-token-form"/);
    assert.match(html, /<button type="submit" class="action-btn save" disabled>/);
    assert.ok(html.includes('only the workspace owner can make a queue token'));
    // LIN-3846: the queue-token list moved to Settings › Agent access, which owns the owner-only revoke.
    assert.ok(html.includes('data-testid="dispatch-keys-link"'));
    assert.ok(!html.includes('class="token-list"'));
  });

  for (const [name, flags] of [['an owner with a way to run', { runControls: true }], ['a keyless owner (runSetup)', { runSetup: true }]]) {
    test(`${name} gets the halt buttons and an enabled token form`, () => {
      const html = page(flags);
      assert.ok(html.includes('data-testid="dispatch-halt-pause"'));
      assert.ok(html.includes('data-testid="dispatch-halt-resume"'));
      assert.match(html, /<button type="submit" class="action-btn save">/);
      assert.ok(!html.includes('only the workspace owner can make a queue token'));
      assert.ok(html.includes('data-testid="dispatch-keys-link"'));
    });
  }
});
