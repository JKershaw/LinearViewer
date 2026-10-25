// LIN-3890: every Settings piece is designed in /styleguide before it is built.
// Each piece carries the five anatomy parts (purpose, parts, sizes, states,
// light and dark), and the page links public/settings.css, the one authority
// for Settings styles, rather than moving those rules into style.css.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStyleguide, SETTINGS_PIECES } from '../../lib/render-styleguide.js';

const PARTS = ['Purpose', 'Parts', 'Sizes', 'States', 'Light and dark'];

test('every Settings piece has its five anatomy parts', () => {
  assert.ok(SETTINGS_PIECES.length >= 9, 'the nine pieces the plan names are all designed');
  const html = renderStyleguide();
  for (const piece of SETTINGS_PIECES) {
    assert.ok(html.includes(`data-testid="styleguide-settings-${piece.id}"`), `${piece.id} is on the page`);
    for (const key of ['purpose', 'parts', 'sizes', 'states', 'theme']) {
      assert.ok(piece[key] && piece[key].length > 0, `${piece.id} has ${key}`);
    }
  }
  for (const part of PARTS) {
    assert.ok(html.includes(`<dt>${part}</dt>`), `the anatomy list shows ${part}`);
  }
});

test('/styleguide links public/settings.css and does not inline Settings rules', () => {
  const html = renderStyleguide();
  assert.match(html, /<link[^>]+href="\/settings\.css"/);
});
