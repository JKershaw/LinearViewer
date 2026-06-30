/**
 * Theme S2 primitive component tests (LIN-786).
 *
 * The theme-owned, page-agnostic primitives composed by LIN-783: Button,
 * IconButton, Icon, Tag, Chip, AccentBar, SegmentBar, Disclosure, Surface. Each
 * is a pure `render*() → HTML string` helper in the card/status-pill idiom —
 * these tests pin the contract (escaping, required slots, a11y attributes, class
 * structure), not the CSS (that is theme.test.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderButton } from '../../lib/components/button.js';
import { renderIconButton } from '../../lib/components/icon-button.js';
import { renderIcon, ICON_NAMES } from '../../lib/components/icon.js';
import { renderTag, renderChip } from '../../lib/components/tag.js';
import { renderAccentBar } from '../../lib/components/accent-bar.js';
import { renderSegmentBar } from '../../lib/components/segment-bar.js';
import { renderDisclosure } from '../../lib/components/disclosure.js';
import { renderSurface } from '../../lib/components/surface.js';

// --- Button -----------------------------------------------------------------

test('renderButton: default emits a token-styled button with escaped label', () => {
  const html = renderButton({ label: 'save & <go>' });
  assert.match(html, /^<button class="btn" type="button"><span class="btn__label">save &amp; &lt;go&gt;<\/span><\/button>$/);
});

test('renderButton: variant adds .btn--<variant>; never sets outline:none', () => {
  assert.match(renderButton({ label: 'x', variant: 'primary' }), /class="btn btn--primary"/);
  assert.match(renderButton({ label: 'x', variant: 'ghost' }), /class="btn btn--ghost"/);
  assert.doesNotMatch(renderButton({ label: 'x' }), /outline/);
});

test('renderButton: icon slot is raw markup, rendered before the label', () => {
  const html = renderButton({ label: 'go', icon: '<svg></svg>' });
  assert.match(html, /<span class="btn__icon" aria-hidden="true"><svg><\/svg><\/span><span class="btn__label">go<\/span>/);
});

test('renderButton: as:"a" renders an anchor; disabled adds the attribute', () => {
  assert.match(renderButton({ label: 'link', as: 'a', attrs: 'href="/x"' }), /^<a class="btn" href="\/x">/);
  assert.match(renderButton({ label: 'x', disabled: true }), /<button class="btn" type="button" disabled>/);
});

test('renderButton: requires a label or icon', () => {
  assert.throws(() => renderButton({}), /requires at least one of `label` or `icon`/);
});

// --- IconButton -------------------------------------------------------------

test('renderIconButton: requires an icon AND an accessible label', () => {
  assert.throws(() => renderIconButton({ label: 'x' }), /requires an `icon`/);
  assert.throws(() => renderIconButton({ icon: '<svg></svg>' }), /requires a `label`/);
});

test('renderIconButton: exposes the label as aria-label and escapes it', () => {
  const html = renderIconButton({ icon: '<svg></svg>', label: 'approve <x>' });
  assert.match(html, /^<button class="icon-btn" type="button" aria-label="approve &lt;x&gt;">/);
  assert.match(html, /<span class="icon-btn__icon" aria-hidden="true"><svg><\/svg><\/span>/);
  assert.doesNotMatch(html, /outline/);
});

// --- Icon -------------------------------------------------------------------

test('renderIcon: ships the §10 line-icon set, stroked in currentColor', () => {
  assert.deepEqual(ICON_NAMES, ['check', 'caret', 'branch', 'spark', 'error-circle']);
  for (const name of ICON_NAMES) {
    const html = renderIcon({ name, title: name });
    assert.match(html, new RegExp(`class="icon icon--${name}"`));
    assert.match(html, /stroke="currentColor"/);
    assert.match(html, /role="img"/);
    assert.match(html, new RegExp(`<title>${name === 'error-circle' ? 'error-circle' : name}</title>`));
  }
});

test('renderIcon: decorative (no title) is aria-hidden; unknown name throws', () => {
  assert.match(renderIcon({ name: 'check' }), /aria-hidden="true"/);
  assert.throws(() => renderIcon({ name: 'nope' }), /unknown icon/);
});

// --- Tag & Chip -------------------------------------------------------------

test('renderTag: escapes label, renders optional mono count, supports tone', () => {
  assert.match(renderTag({ label: 'a & b' }), /<span class="tag__name">a &amp; b<\/span>/);
  assert.match(renderTag({ label: 'x', count: 3 }), /<span class="tag__count">3<\/span>/);
  assert.match(renderTag({ label: 'x', tone: 'brand' }), /class="tag tag--brand"/);
  assert.throws(() => renderTag({}), /requires a `label`/);
});

test('renderChip: a mono <code> data chip, escaped', () => {
  assert.match(renderChip({ label: 'LIN-786' }), /^<code class="chip">LIN-786<\/code>$/);
  assert.match(renderChip({ label: '<x>' }), /&lt;x&gt;/);
  assert.throws(() => renderChip({}), /requires a `label`/);
});

// --- AccentBar --------------------------------------------------------------

test('renderAccentBar: state modifier; decorative by default, labelled when asked', () => {
  assert.match(renderAccentBar({ state: 'running' }), /class="accent-bar accent-bar--running" aria-hidden="true"/);
  assert.match(renderAccentBar({ state: 'done', label: 'done' }), /role="img" aria-label="done"/);
  assert.throws(() => renderAccentBar({}), /requires a `state`/);
});

// --- SegmentBar -------------------------------------------------------------

test('renderSegmentBar: equal cells expose state via title (never colour-alone)', () => {
  const html = renderSegmentBar({ segments: [{ state: 'done' }, { state: 'running', count: 2 }, {}] });
  assert.match(html, /class="segment-bar__cell segment-bar__cell--done" title="done"/);
  assert.match(html, /class="segment-bar__cell segment-bar__cell--running" title="running"><span class="segment-bar__count">2<\/span>/);
  // A stateless cell falls back to the neutral 'empty' cell with a title.
  assert.match(html, /class="segment-bar__cell segment-bar__cell--empty" title="empty"/);
});

test('renderSegmentBar: ariaLabel names the whole track; empty segments throw', () => {
  assert.match(renderSegmentBar({ ariaLabel: '2 of 3 done', segments: [{ state: 'done' }] }), /role="img" aria-label="2 of 3 done"/);
  assert.throws(() => renderSegmentBar({ segments: [] }), /non-empty `segments`/);
});

// --- Disclosure -------------------------------------------------------------

test('renderDisclosure: native <details>/<summary>, raw slots, open flag', () => {
  const html = renderDisclosure({ summary: 'Log (3)', body: '<p>x</p>', open: true });
  assert.match(html, /^<details class="disclosure" open>/);
  assert.match(html, /<summary class="disclosure__summary"><span class="disclosure__caret" aria-hidden="true"><\/span><span class="disclosure__label">Log \(3\)<\/span><\/summary>/);
  assert.match(html, /<div class="disclosure__body"><p>x<\/p><\/div>/);
  assert.throws(() => renderDisclosure({ body: 'x' }), /requires a `summary`/);
  assert.throws(() => renderDisclosure({ summary: 'x' }), /requires a `body`/);
});

// --- Surface ----------------------------------------------------------------

test('renderSurface: default + inset/raised variants, raw body', () => {
  assert.match(renderSurface({ body: '<p>x</p>' }), /^<div class="surface"><p>x<\/p><\/div>$/);
  assert.match(renderSurface({ body: 'x', variant: 'inset' }), /class="surface surface--inset"/);
  assert.match(renderSurface({ body: 'x', variant: 'raised' }), /class="surface surface--raised"/);
  assert.throws(() => renderSurface({}), /requires a `body`/);
});
