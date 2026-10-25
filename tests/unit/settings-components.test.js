/**
 * LIN-3846: the three row kinds, ask-in-place, and "nothing pops up".
 *
 * Run with: node --test tests/unit/settings-components.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { switchRow, drillRow, actionRow } from '../../lib/components/settings-row.js';
import { askInPlace, REASON_MAX_LENGTH } from '../../lib/components/settings-ask.js';
import { group } from '../../lib/components/settings-group.js';
import { renderSettingsShell } from '../../lib/components/settings-frame.js';
import { getArea } from '../../lib/settings-areas.js';
import { renderSettingsPage } from '../../lib/render-settings.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the three row kinds', () => {
  test('a feature switch escapes its key into the hidden input (LIN-3889 F6: a key with a quote cannot break out of the attribute)', () => {
    const html = switchRow({ key: 'a"><b>x', label: 'Hostile', on: true, action: '/x' });
    assert.ok(html.includes('value="a&quot;&gt;&lt;b&gt;x"'), 'the key is escaped in value=');
    assert.ok(!html.includes('<b>x'), 'no raw tag from the key reaches the markup');
  });

  test('a switch row posts the opposite of its state and keeps the toggle client\'s hooks', () => {
    const on = switchRow({ key: 'roadmap', label: 'Narrative roadmap', on: true, action: '/x' });
    assert.match(on, /name="enabled" value="false"/);
    assert.match(on, /data-testid="settings-toggle-roadmap"/);
    assert.match(on, /aria-checked="true"/);
    assert.match(switchRow({ key: 'roadmap', label: 'x', on: false, action: '/x' }), /name="enabled" value="true"/);
  });

  test('a drill row is a link to another page, or opens in place', () => {
    const open = drillRow({ label: 'New key', value: 'Read', bodyHtml: '<p>form</p>' });
    assert.match(open, /<details/);
    assert.match(open, /<p>form<\/p>/);
    assert.match(open, /›/);
  });

  test('an action is teal, or red when it removes or stops something', () => {
    assert.match(actionRow({ label: 'Go', href: '/x' }), /settings-action-teal/);
    assert.match(actionRow({ label: 'Stop', tone: 'red', action: '/s' }), /settings-action-red/);
  });

  test('a group carries who it affects in its title, and notes sit under it', () => {
    const html = group({ title: 'For everyone in Acme', rowsHtml: '<i></i>', note: 'A note.' });
    assert.match(html, /<h2[^>]*>For everyone in Acme<\/h2>/);
    assert.match(html, /<p[^>]*>A note\.<\/p>/);
  });
});

describe('ask in place', () => {
  const html = askInPlace({ summary: 'Stop runs', willHappen: 'Running sessions are stopped.', askWhy: true, action: '/halt', fields: [['mode', 'stop']], confirmLabel: 'Stop runs', testid: 'halt-stop' });

  test('the real form, and its submit button, exist only inside the opened panel', () => {
    const details = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    assert.ok(details.includes('<form'), 'the form is inside the details');
    assert.ok(details.includes('type="submit"'));
    assert.equal(html.split('<form').length, 2);
    assert.equal(html.replace(details, '').includes('type="submit"'), false, 'no submit outside the panel');
    assert.doesNotMatch(html, /<details[^>]* open/, 'closed until asked');
  });

  test('it says what will happen, asks why (required, capped), then confirms', () => {
    assert.match(html, /Running sessions are stopped\./);
    assert.match(html, /<textarea name="reason" required maxlength="500"/);
    assert.equal(REASON_MAX_LENGTH, 500);
    assert.match(html, /data-testid="halt-stop-confirm"/);
  });

  test('a change that only affects you does not ask why', () => {
    assert.doesNotMatch(askInPlace({ summary: 's', willHappen: 'w', action: '/x' }), /name="reason"/);
  });
});

describe('the frame and nothing popping up', () => {
  test('desktop shows both the list and the page, and the page has "‹ Settings" for a phone', () => {
    const html = renderSettingsShell({ urlKey: 'acme', states: {}, area: getArea('models'), view: 'area', bodyHtml: '<p>x</p>' });
    assert.match(html, /data-view="area"/);
    assert.match(html, /data-wide="true"/, 'Models gets the full width');
    assert.match(html, /‹ Settings/);
    assert.match(html, /aria-current="page"/);
    assert.doesNotMatch(renderSettingsShell({ urlKey: 'acme', states: {}, area: getArea('sources'), view: 'index', bodyHtml: '' }), /data-wide/);
  });

  test('the new client code asks in place: no dialog, confirm( or window.open (the markup is scanned per area in settings-seam-markup)', () => {
    const client = readFileSync(join(ROOT, 'public/settings.js'), 'utf8');
    const added = client.slice(client.indexOf('LIN-3846: the areas'));
    assert.doesNotMatch(added, /\bconfirm\(|window\.open|showModal|<dialog/);
    // The presets delete keeps its native confirm() (LIN-511): that form is LIN-3855's to retire.
    assert.equal((client.match(/if \(confirm\(/g) || []).length, 1);
  });

  test('every area page renders the sidebar and the frame, in any area', () => {
    for (const id of ['sources', 'models', 'running', 'agent-access', 'health', 'change-log', 'features', 'account']) {
      const html = renderSettingsPage('Acme', { urlKey: 'acme', area: id });
      assert.match(html, new RegExp(`data-testid="settings-area-${id}"`));
      assert.match(html, /data-testid="settings-nav"/);
      assert.doesNotMatch(html, /<dialog/);
    }
  });
});

test('the new client code binds to rendered elements, never a page-wide class listener (LIN-3401)', () => {
  const client = readFileSync(join(ROOT, 'public/settings.js'), 'utf8');
  const added = client.slice(client.indexOf('LIN-3846: the areas'));
  assert.doesNotMatch(added, /document\.addEventListener\('click'/);
});
