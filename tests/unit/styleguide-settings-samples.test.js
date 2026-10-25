// LIN-3950: each Settings piece on /styleguide carries a live sample rendered by its own builder,
// beside its anatomy. The sample sits in an `inert` wrapper (its forms and links do nothing) that
// takes the phone root (`.settings-shell`, settings.css), and the page is byte-stable: renders under two
// different clocks are identical, so the samples cannot drift between runs.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderStyleguide, SETTINGS_PIECES } from '../../lib/render-styleguide.js';
import { switchRow } from '../../lib/components/settings-row.js';

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

// The switch-row sample is exactly the builder's output, not hand-written markup carrying its class.
test('the switch-row sample is the switchRow builder\'s exact output', () => {
  const sample = renderStyleguide().split(WRAPPER)[1].split(SAMPLE_END)[0];
  assert.ok(
    sample.includes(switchRow({ key: 'sample', label: 'Keep a copy of changes', on: true, action: '#' })),
    'the sample holds switchRow()\'s output verbatim',
  );
});

// Two renders made milliseconds apart cannot see a wall-clock dependency, so render under two clocks
// 400 days apart: the key row's "expires in ..." / "last used ..." text would differ if it read the clock.
test('the page is byte-stable across renders (the key row is given a fixed clock)', (t) => {
  const T1 = Date.parse('2026-03-01T00:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: T1 });
  const first = renderStyleguide();
  t.mock.timers.setTime(T1 + 400 * 24 * 60 * 60 * 1000);
  const second = renderStyleguide();
  assert.equal(second, first);
});

// Review F1/F2 (LIN-3950): /styleguide is a Plain page whose blocks hold live builder output, so the
// Plain prose rules reach only unclassed prose (a classed <p>/<a> keeps its own component look), and
// the page title wears the Plain title class.
test('Plain prose rules are scoped to unclassed p and a, so builder samples keep their own look', () => {
  const css = readFileSync(new URL('../../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.plain-page \.section p:not\(\[class\]\)\s*\{/);
  assert.match(css, /\.plain-page \.section a:not\(\[class\]\)\s*\{/);
  assert.doesNotMatch(css, /\.plain-page \.section [pa]\s*\{/, 'no bare descendant p/a rule remains');
});

test('the /styleguide title carries the Plain title class', () => {
  assert.match(renderStyleguide(), /<h2 class="plain-title">Style Guide<\/h2>/);
});

// LIN-3950: /styleguide is itself a Plain page, and shows the Plain layout with one sample of every
// section kind, in the Plain section and in each theme panel (light and dark).
test('/styleguide is a Plain page, with every section kind sampled in the page and both theme panels', () => {
  const html = renderStyleguide();
  assert.match(html, /<main class="plain-page styleguide-content">/);
  const plain = '<div class="plain-page settings-shell sg-settings-sample sg-plain-sample" inert>';
  assert.equal(html.split(plain).length - 1, 3, 'one Plain sample in the section and one per theme panel');
  const sample = html.split(plain)[1];
  assert.match(sample, /class="field"/, 'fields kind');
  assert.match(sample, /class="settings-group-block /, 'rows kind');
  assert.match(sample, /class="plain-form"/, 'form kind');
  assert.match(sample, /class="emptyState"/, 'empty kind');
});
