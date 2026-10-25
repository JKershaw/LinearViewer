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
  'decision-panel',        // decision-panel: decisionPanel (LIN-3962)
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

// Review F1/F2 (LIN-3950), narrowed by LIN-3958 (review finding 1): /styleguide is a Plain page whose blocks
// hold live builder output, so the Plain prose rules reach only unclassed prose: unclassed paragraphs, the
// items of unclassed lists, and the terms of unclassed definition lists. A classed element keeps its own
// look, and the page title wears the Plain title class.
test('Plain prose reaches only unclassed p, list items, dd and dt under .plain-page, and links stay unclassed', () => {
  const css = readFileSync(new URL('../../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.plain-page \.section p:not\(\[class\]\),\s*\.plain-page \.section :is\(ul, ol\):not\(\[class\]\) > li,\s*\.plain-page \.section dl:not\(\[class\]\) > :is\(dd, dt\)\s*\{/);
  assert.match(css, /\.plain-page \.section a:not\(\[class\]\)\s*\{/);
  assert.doesNotMatch(css, /\.plain-page \.section :is\(p, li, dd, dt\)/, 'no classed-reaching prose selector remains');
  assert.doesNotMatch(css, /\.plain-page \.section [pa]\s*\{/, 'no bare descendant p/a rule remains');
});

// LIN-3958 (review finding 1): with the Plain rules no longer reaching classed prose, the styleguide's own
// prose classes (the .sg-intro lede and the anatomy labels, which sit in a classed dl) take the sans face here.
test('the styleguide prose classes take the sans face in styleguide.css', () => {
  const css = readFileSync(new URL('../../public/styleguide.css', import.meta.url), 'utf8');
  assert.match(css, /\.styleguide-content \.sg-intro \{[^}]*font-family: var\(--font-content\);/);
  assert.match(css, /\.sg-settings-anatomy dt,\s*\.sg-settings-anatomy dd \{[^}]*font-family: var\(--font-content\);/);
});

// LIN-3958: /styleguide's Plain sample is .plain-page AND .settings-shell, so both phone roots land on one
// element. Both are rem, not em, so they do not compound: the sample takes 1rem, not 1rem squared.
test('the Plain and Settings phone roots are both rem, so the styleguide sample does not compound', () => {
  const plainCss = readFileSync(new URL('../../public/style.css', import.meta.url), 'utf8');
  const settingsCss = readFileSync(new URL('../../public/settings.css', import.meta.url), 'utf8');
  assert.match(plainCss, /@media \(max-width: 400px\) \{\s*\.plain-page \{\s*font-size: 1rem;\s*\}\s*\}/);
  assert.match(settingsCss, /\.settings-shell \{[^}]*font-size: 1rem;/);
  assert.match(renderStyleguide(), /<div class="plain-page settings-shell sg-settings-sample sg-plain-sample" inert>/);
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
