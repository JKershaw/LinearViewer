// LIN-3956: the rows list moved out of group() so a Plain page's `rows` section can share it. Settings
// output must stay byte-identical. The expected strings below were captured from group() at the base
// commit (28da5680), before the extraction, and the head renders the same bytes for the same inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { group, rowsList } from '../../lib/components/settings-group.js';
import { staticRow, switchRow, actionRow } from '../../lib/components/settings-row.js';

test('group() with static rows renders the base bytes', () => {
  const html = group({ title: 'For you', rowsHtml: staticRow({ label: 'Name', valueHtml: 'Sample' }) });
  assert.equal(html, "\n    <section class=\"settings-group-block settings-section \">\n      <h2 class=\"settings-group-title settings-header\">For you</h2>\n      <div class=\"settings-rows\">\n      <div class=\"settings-row settings-row-static\">\n        <span class=\"settings-row-label\">Name</span>\n        <span class=\"settings-row-value\">Sample</span>\n      </div>\n      </div>\n    </section>");
});

test('group() with a switch, an action, a note, a testid, an id and a class renders the base bytes', () => {
  const html = group({
    title: 'Runs',
    rowsHtml: switchRow({ key: 'a', label: 'Keep copies', on: true, action: '#' }) + actionRow({ label: 'Stop', tone: 'red', action: '#' }),
    note: 'A note.',
    testid: 'settings-section-runs',
    id: 'runs',
    className: 'x',
  });
  assert.equal(html, "\n    <section class=\"settings-group-block settings-section x\" data-testid=\"settings-section-runs\" id=\"runs\">\n      <h2 class=\"settings-group-title settings-header\" data-testid=\"settings-section-runs-title\">Runs</h2>\n      <div class=\"settings-rows\">\n      <div class=\"settings-row settings-row-switch\" data-feature=\"a\" data-testid=\"settings-toggle-a\">\n        <span class=\"settings-row-label\">Keep copies</span>\n        <form action=\"#\" method=\"POST\" class=\"settings-form feature-form\">\n          <input type=\"hidden\" name=\"feature\" value=\"a\">\n          <input type=\"hidden\" name=\"enabled\" value=\"false\">\n          <button type=\"submit\" class=\"settings-switch toggle-on\" role=\"switch\" aria-checked=\"true\" aria-label=\"Keep copies\"><span class=\"toggle-state\">● on</span></button>\n        </form>\n      </div>\n      <form action=\"#\" method=\"POST\" class=\"settings-form settings-row-form\">\n        <button type=\"submit\" class=\"settings-row settings-row-action settings-action-red\">Stop</button>\n      </form>\n      </div>\n      <p class=\"settings-note\">A note.</p>\n    </section>");
});

test('rowsList is the group body: group() wraps exactly what rowsList returns', () => {
  const rowsHtml = staticRow({ label: 'Name', valueHtml: 'Sample' });
  const body = rowsList({ rowsHtml, note: 'n' });
  assert.equal(body, '<div class="settings-rows">' + rowsHtml + '\n      </div>\n      <p class="settings-note">n</p>');
  assert.ok(group({ title: 'T', rowsHtml, note: 'n' }).includes(`      ${body}\n    </section>`));
});
