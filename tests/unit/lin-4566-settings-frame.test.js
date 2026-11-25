/**
 * LIN-4566 (LIN-4342 piece 5): Settings and Set up on the frame.
 *   - Settings is one place: the index and every area render through renderFrame (lib/components/frame.js) at
 *     `settings`. One h1, "Settings"; the tab `Settings · <Workspace>`; the rail marks Settings once, as the page, with
 *     no "← Settings" (the area list beside it is the page's own sections, not a second rail); no old bar or footer.
 *   - Run on my machine is drilled in under Settings: one h1, its name; Settings marked as the parent; one way back.
 *     The page's state and keys ride on its own wrapper inside the frame's <main> (public/runner-setup.js reads it).
 *   - Removing a workspace is an ask in place on Settings › Sources, posting to the existing
 *     `POST /workspace/:urlKey/remove`; neither workspace menu (the rail's, the old bar's) offers it.
 *
 * Run with: node scripts/run-unit-tests.mjs tests/unit/lin-4566-settings-frame.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSettingsPage } from '../../lib/render-settings.js';
import { renderRunnerSetupPage } from '../../lib/render-runner-setup.js';
import { renderWorkspaceOptions } from '../../lib/components/navbar.js';
import { renderRail } from '../../lib/components/frame.js';
import { AREAS } from '../../lib/settings-areas.js';
import { litPlaceFor } from '../../lib/places.js';

const ONE = [{ urlKey: 'acme', name: 'Acme', id: 'w1' }];
const TWO = [...ONE, { urlKey: 'beta', name: 'Beta', id: 'w2' }];

const VIEWERS = [
  { name: 'owner with a runner', flags: { runControls: true } },
  { name: 'new user without a runner', flags: { runControls: false, runSetup: true } },
];

/** The marked rail items' places, in order. */
const marked = html => [...html.matchAll(/class="frame-rail__item[^"]*"[^>]*data-place="([^"]+)" aria-current="(page|true)"/g)].map(m => ({ place: m[1], current: m[2] }));
const backs = html => [...html.matchAll(/data-testid="frame-back">← ([^<]+)</g)].map(m => m[1]);

const settings = (area, over = {}) => renderSettingsPage('Acme', { area, urlKey: 'acme', workspaces: ONE, ...over });

for (const viewer of VIEWERS) {
  describe(`Settings in the frame, ${viewer.name}`, () => {
    for (const area of [null, ...AREAS.map(a => a.id)]) {
      test(`${area || 'the index'}: one h1 "Settings", the tab names it, Settings is marked once as the page`, () => {
        const html = settings(area, { featureFlags: viewer.flags });
        assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
        assert.match(html, /<h1>Settings<\/h1>/);
        assert.match(html, /<title>Settings · Acme<\/title>/);
        assert.match(html, /<body class="frame-body" data-place="settings"/);
        assert.deepEqual(marked(html), [{ place: 'settings', current: 'page' }]);
        assert.deepEqual(backs(html), [], 'Settings is the place itself: no way back to it');
        // The area list sits inside <main>, after the h1: the page's own sections, beside the area.
        const main = html.slice(html.indexOf('<main id="main"'), html.indexOf('</main>'));
        assert.match(main, /data-testid="settings-nav"/);
        assert.ok(main.indexOf('<h1>') < main.indexOf('data-testid="settings-nav"'), 'the list follows the page heading');
        assert.doesNotMatch(html, /class="nav-bar|class="page-footer/, 'no old bar, no old footer');
        assert.equal((html.match(/data-testid="frame-footer"/g) || []).length, 1, 'the frame footer, once');
        assert.doesNotMatch(html, /settings-page-head/, 'the dead header hook is gone');
      });
    }
  });
}

describe('Run on my machine in the frame', () => {
  for (const viewer of VIEWERS) {
    test(`${viewer.name}: one h1, Settings marked as its parent, one way back to Settings`, () => {
      const html = renderRunnerSetupPage(
        { state: 'owner', urlKey: 'acme', accountId: 'acct-1', prompt: 'P', baseUrl: 'https://h.example' },
        { workspaces: ONE, workspaceName: 'Acme', featureFlags: viewer.flags },
      );
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
      assert.match(html, /<h1>Run on my machine<\/h1>/);
      assert.match(html, /<title>Run on my machine · Acme<\/title>/);
      assert.equal(litPlaceFor('runner', { flags: viewer.flags }).key, 'settings');
      assert.deepEqual(marked(html), [{ place: 'settings', current: 'true' }]);
      assert.deepEqual(backs(html), ['Settings']);
      // The frame owns <main>; the page's data rides on its own wrapper, inside it.
      const main = html.slice(html.indexOf('<main id="main"'), html.indexOf('</main>'));
      assert.match(main, /<div class="runner-setup-page" data-testid="runner-setup-page" data-state="owner" data-url-key="acme" data-account-id="acct-1" data-base-url="https:\/\/h.example">/);
      assert.doesNotMatch(html, /class="nav-bar|class="page-footer/);
    });
  }
});

describe('Remove this workspace: in Settings › Sources, nowhere else', () => {
  test('Sources asks in place and posts to the existing remove route, in red', () => {
    const html = settings('sources', { workspaces: TWO });
    const ask = html.slice(html.indexOf('data-testid="settings-workspace-remove"'));
    assert.match(html, /data-testid="settings-section-workspace-remove"/);
    assert.match(ask, /<form action="\/workspace\/acme\/remove" method="POST"/);
    assert.match(ask, /class="btn btn--red settings-ask-confirm" data-testid="settings-workspace-remove-confirm">Remove workspace</);
    assert.match(ask, /href="\/workspace\/acme\/settings\/sources"[^>]*data-testid="settings-workspace-remove-cancel"/);
    assert.match(ask, /your other workspaces are not affected/);
    assert.doesNotMatch(ask, /signed out/);
  });

  test('the last workspace says removing it signs you out (the route does)', () => {
    const html = settings('sources', { workspaces: ONE });
    assert.match(html, /It is your only workspace, so you are signed out too\./);
  });

  test('a personal-token session is not offered it (the session restores it on its own)', () => {
    const html = settings('sources', { workspaces: [{ ...ONE[0], isPAT: true }] });
    assert.doesNotMatch(html, /settings-workspace-remove/);
    assert.doesNotMatch(html, /\/workspace\/acme\/remove/);
  });

  test('the other areas do not carry it', () => {
    for (const area of AREAS.filter(a => a.id !== 'sources')) {
      assert.doesNotMatch(settings(area.id, { workspaces: TWO }), /\/workspace\/acme\/remove"/, area.id);
    }
  });

  test('neither workspace menu offers remove: the rail\'s and the old bar\'s switch and add only', () => {
    const rail = renderRail({ urlKey: 'acme', workspaces: TWO, featureFlags: {} });
    const bar = renderWorkspaceOptions(TWO, 'acme', 'project');
    for (const [name, html] of [['rail', rail], ['old bar', bar]]) {
      assert.doesNotMatch(html, /\/remove"/, `${name}: no remove form`);
      assert.doesNotMatch(html, /data-confirm|nav-option-danger/, `${name}: no red remove`);
      assert.match(html, /\/workspace\/beta\//, `${name}: still switches`);
    }
  });
});
