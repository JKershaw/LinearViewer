/**
 * LIN-3846: removing a source asks first, in place, and says what happens. The POST is unchanged.
 *
 * Run with: node --test tests/unit/settings-source-remove-confirm.test.js
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSettingsPage } from '../../lib/render-settings.js';
import '../../lib/providers/index.js';

const binding = (over = {}) => ({ provider: 'linear', scope: 'org-1', displayName: 'Linear', token: 'lin_api_abcd1234', active: true, ...over });
const sources = (bindings) => renderSettingsPage('Acme', { urlKey: 'acme', area: 'sources', providerBindings: bindings });
const panel = (html) => html.slice(html.indexOf('data-testid="settings-provider-remove"'), html.indexOf('</details>', html.indexOf('data-testid="settings-provider-remove"')));

describe('Sources: remove asks in place', () => {
  test('the remove form and its submit exist only inside the opened panel', () => {
    const html = sources([binding()]);
    const p = panel(html);
    assert.match(p, /action="\/workspace\/acme\/settings\/providers\/remove"/);
    assert.match(p, /name="provider" value="linear"/);
    assert.match(p, /name="scope" value="org-1"/);
    assert.match(p, /data-testid="settings-provider-remove-confirm"/);
    const outside = html.replace(p, '');
    assert.doesNotMatch(outside, /providers\/remove/, 'no remove form anywhere outside the panel');
  });

  test('it says what will happen; the last source also names the revocations', () => {
    const only = panel(sources([binding()]));
    assert.match(only, /last source/);
    assert.match(only, /keys, queue tokens and share links you made/);
    assert.match(only, /runner key if you are the workspace owner/);
    const two = panel(sources([binding(), binding({ provider: 'github', scope: 'o/r', displayName: 'GitHub Issues', active: false })]));
    assert.match(two, /Your other sources are not affected/);
    assert.doesNotMatch(two, /last source|runner key/);
  });

  test('sources are labelled as yours, not as for everyone', () => {
    const html = sources([binding()]);
    assert.match(html, /Sources are yours/);
    assert.match(html, /data-testid="settings-section-providers-title"[^>]*>Yours<\/h2>/);
    assert.doesNotMatch(html, /For everyone/);
  });

  test('refresh and make-active stay plain one-click actions (they remove nothing)', () => {
    const html = sources([binding(), binding({ provider: 'github', scope: 'o/r', displayName: 'GitHub Issues', active: false })]);
    assert.match(html, /settings-provider-refresh/);
    assert.match(html, /settings-provider-activate/);
  });
});
