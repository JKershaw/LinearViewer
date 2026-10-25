// LIN-3950: each Settings piece on /styleguide carries a live sample rendered by its own builder,
// beside its anatomy. The sample sits in an `inert` wrapper (its forms and links do nothing) that
// takes the phone root (`.settings-shell`, settings.css), and the page is byte-stable: two renders
// are identical, so the samples cannot drift between runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStyleguide, SETTINGS_PIECES } from '../../lib/render-styleguide.js';

const WRAPPER = '<div class="settings-shell sg-settings-sample" inert>';
const SAMPLE_END = '<!-- /sg-settings-sample -->';

// The class each piece's builder must emit inside its sample, in SETTINGS_PIECES order.
const EXPECTED = [
  'settings-switch',       // switch-row: switchRow
  'settings-row-drill',    // value-row: drillRow, linked
  'settings-row-action',   // action-row: actionRow
  'settings-ask-form',     // ask-in-place: askInPlace
  'settings-flash',        // status-line: statusLine
  'settings-note',         // note: groupNote
  'settings-group-title',  // group-title: group
  'settings-row-open',     // key-row: keyRow (drillRow, opened in place)
  'settings-pane',         // area-frame: renderSettingsShell
  'settings-state-warn',   // sidebar-state: renderSettingsNav
];

test('every Settings piece has one live sample, in an inert phone-root wrapper', () => {
  const html = renderStyleguide();
  assert.equal(EXPECTED.length, SETTINGS_PIECES.length, 'one expected class per piece');
  const samples = html.split(WRAPPER).slice(1);
  assert.equal(samples.length, SETTINGS_PIECES.length, 'one inert sample wrapper per piece');
});

test('each sample is built by its piece\'s builder', () => {
  const html = renderStyleguide();
  const samples = html.split(WRAPPER).slice(1);
  SETTINGS_PIECES.forEach((piece, i) => {
    // Cut at this sample's end marker, so a class in a later piece cannot satisfy it.
    const sample = samples[i].split(SAMPLE_END)[0];
    assert.ok(sample.includes(EXPECTED[i]), `${piece.id} sample carries ${EXPECTED[i]}`);
  });
});

test('the page is byte-stable across renders (the key row is given a fixed clock)', () => {
  assert.equal(renderStyleguide(), renderStyleguide());
});
