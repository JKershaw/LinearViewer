/**
 * LIN-3888 (Free the seam): Settings markup checked through data attributes, test ids, element
 * and role, never a style class. These replace the class-string pins in render-settings-shell,
 * render-settings, lin-1890-jira-entry-surfaces and settings-areas-census, so Consolidate and the
 * Rebuild can move the classes without silently breaking the checks.
 *
 * Run with: node --test tests/unit/settings-seam-markup.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { switchRow, drillRow, group, renderSettingsShell } from '../../lib/render-settings-shell.js';
import { getArea, AREAS } from '../../lib/settings-areas.js';
import { renderSettingsPage } from '../../lib/render-settings.js';
import { agentAccessBody } from '../../lib/render-settings-workspace.js';
import '../../lib/providers/index.js';

const BASE = { urlKey: 'acme', workspaces: [], currentModel: 'openai/gpt-5.4-mini', availableModels: [] };

describe('the three row kinds, by element, role and test id', () => {
  test('a switch row carries its key and state on a switch button, not a class', () => {
    const on = switchRow({ key: 'roadmap', label: 'Narrative roadmap', on: true, action: '/x' });
    assert.match(on, /data-testid="settings-toggle-roadmap"/);
    assert.match(on, /data-feature="roadmap"/);
    assert.match(on, /<button type="submit" [^>]*role="switch" aria-checked="true"/);
    const off = switchRow({ key: 'roadmap', label: 'x', on: false, action: '/x' });
    assert.match(off, /<button type="submit" [^>]*role="switch" aria-checked="false"/);
  });

  test('a drill row is a link to another page, or opens in place', () => {
    assert.match(drillRow({ label: 'Queue', value: 'Dispatch', href: '/d' }), /^\s*<a [^>]*href="\/d"/);
    const open = drillRow({ label: 'New key', value: 'Read', bodyHtml: '<p>form</p>' });
    assert.match(open, /^\s*<details/);
    assert.match(open, /<p>form<\/p>/);
  });
});

describe('group titles and notes, by element and text', () => {
  test('a group heading says who it affects, and carries its title test id when it has one', () => {
    const html = group({ title: 'For everyone in Acme', rowsHtml: '<i></i>', testid: 'settings-section-x' });
    assert.match(html, /<h2[^>]*>For everyone in Acme<\/h2>/);
    assert.match(html, /data-testid="settings-section-x-title"/);
    assert.match(html, /data-testid="settings-section-x-title"[^>]*>For everyone in Acme<\/h2>/);
  });

  test('a group note sits under the rows as a paragraph', () => {
    assert.match(group({ title: 't', rowsHtml: '<i></i>', note: 'A note.' }), /<p[^>]*>A note\.<\/p>/);
  });

  test('a group without a test id gets no title test id', () => {
    assert.doesNotMatch(group({ title: 'For you', rowsHtml: '' }), /data-testid="[^"]*-title"/);
  });
});

describe('the frame and the nav, by test id', () => {
  test('the page pane is a test id of its own', () => {
    const html = renderSettingsShell({ urlKey: 'acme', states: {}, area: getArea('sources'), view: 'area', bodyHtml: '' });
    assert.match(html, /data-testid="settings-pane"/);
  });

  test('a bad state draws its dot under its own test id', () => {
    const html = renderSettingsShell({ urlKey: 'acme', states: { sources: { text: 'Fix', tone: 'bad' } }, area: getArea('sources'), view: 'area', bodyHtml: '' });
    assert.match(html, /data-testid="settings-dot-sources"/);
    assert.doesNotMatch(renderSettingsShell({ urlKey: 'acme', states: { sources: { text: 'Fine', tone: 'ok' } }, area: getArea('sources'), view: 'area', bodyHtml: '' }), /settings-dot-/);
  });

  test('every state renders in the sidebar of every page under its test id', () => {
    const ctx = { defaultModelName: 'Default' };
    const states = Object.fromEntries(AREAS.map(a => [a.id, a.state(ctx)]));
    const html = renderSettingsPage('Acme', { ...BASE, area: 'account', states });
    for (const a of AREAS) assert.match(html, new RegExp(`data-testid="settings-state-${a.id}"`));
  });
});

describe('ask in place, everywhere: no native dialog, confirm or popup in any area', () => {
  const contexts = [
    ['the plain page', BASE],
    ['an OpenRouter connection', { ...BASE, openRouterSource: 'oauth' }],
  ];
  for (const [name, options] of contexts) {
    for (const a of AREAS) {
      test(`${a.id} in ${name} has no dialog, confirm( or window.open`, () => {
        const html = renderSettingsPage('Acme', { ...options, area: a.id });
        // Scoped to the area itself: the nav is outside the check.
        const area = html.slice(html.indexOf(`data-testid="settings-area-${a.id}"`));
        assert.notEqual(html.indexOf(`data-testid="settings-area-${a.id}"`), -1);
        assert.doesNotMatch(area, /<dialog|\bconfirm\(|window\.open|showModal/);
      });
    }
  }
});

describe('the rows that Settings renders in place of class checks', () => {
  test('the OpenRouter connection status is one element with its test id', () => {
    const html = renderSettingsPage('Acme', { ...BASE, area: 'account', openRouterSource: 'oauth' });
    assert.equal((html.match(/data-testid="settings-openrouter-status"/g) || []).length, 1);
    assert.match(html, /data-testid="settings-openrouter-status">● connected<\/span>/);
  });

  test('a disconnected OpenRouter row offers the connect link under its test id', () => {
    const html = renderSettingsPage('Acme', { ...BASE, area: 'account', openRouterSource: null });
    assert.match(html, /data-testid="settings-openrouter-connect"/);
  });

  test('the Proxy key name input carries its test id', () => {
    const html = agentAccessBody({ urlKey: 'acme', keys: [] });
    assert.match(html, /<input [^>]*data-testid="settings-newkey-label"/);
  });

  test('a blocked GitHub add row is found by its test id and says why', () => {
    const html = renderSettingsPage('Acme', { ...BASE, githubEnabled: false });
    const row = html.match(/<div[^>]*data-testid="settings-provider-add-github"[^]*?<\/div>/);
    assert.ok(row, 'expected a github add row');
    assert.match(row[0], /not configured on this server/);
  });

  test('the Sources heading for your own sources is a title test id', () => {
    const html = renderSettingsPage('Acme', { ...BASE, area: 'sources', providerBindings: [] });
    assert.match(html, /data-testid="settings-section-providers-title"[^>]*>Yours<\/h2>/);
  });
});
