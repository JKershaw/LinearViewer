import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderStatusPill } from '../../lib/components/status-pill.js';

test('renders the canonical .status-pill wrapper with a default state glyph + label', () => {
  const html = renderStatusPill({ state: 'done', label: 'done' });
  assert.match(
    html,
    /^<span class="status-pill status-pill--done"><span class="status-pill__char">✓<\/span><span class="status-pill__label">done<\/span><\/span>$/
  );
});

test('each state adds its color modifier and default glyph', () => {
  const glyphs = {
    'in-progress': '◐',
    done: '✓',
    todo: '○',
    backlog: '○',
    failed: '✕',
  };
  for (const [state, glyph] of Object.entries(glyphs)) {
    const html = renderStatusPill({ state });
    assert.match(html, new RegExp(`^<span class="status-pill status-pill--${state}">`));
    assert.match(html, new RegExp(`<span class="status-pill__char">${glyph}<\\/span>`));
  }
});

test('char overrides the state default glyph', () => {
  const html = renderStatusPill({ state: 'done', char: '●', label: 'live' });
  assert.match(html, /<span class="status-pill__char">●<\/span>/);
  assert.doesNotMatch(html, /✓/);
});

test('label-only pill (no state, no char) emits just the label, no glyph', () => {
  const html = renderStatusPill({ label: 'queued' });
  assert.match(html, /^<span class="status-pill"><span class="status-pill__label">queued<\/span><\/span>$/);
  assert.doesNotMatch(html, /status-pill__char/);
});

test('variant adds a second modifier (neutral tag chip)', () => {
  const html = renderStatusPill({ variant: 'tag', label: 'research' });
  assert.match(html, /^<span class="status-pill status-pill--tag">/);
});

test('requires at least one of char, label, dot, or a known state', () => {
  assert.throws(() => renderStatusPill({}), /requires at least one of `char`, `label`, `dot`, or a known `state`/);
  // An unknown state has no default glyph; with no label/char/dot it is empty → throws.
  assert.throws(() => renderStatusPill({ state: 'mystery' }), /requires at least one/);
  // …but an unknown state with a label is fine (still gets its modifier class).
  assert.doesNotThrow(() => renderStatusPill({ state: 'mystery', label: 'x' }));
  // …and a dot alone is a valid marker even without a label (run-status shell).
  assert.doesNotThrow(() => renderStatusPill({ dot: true }));
});

// --- LIN-786 (Theme S2): run-status dot extension ---------------------------

test('the dot variant renders a dot marker instead of a glyph', () => {
  const html = renderStatusPill({ state: 'running', label: 'running', dot: true });
  assert.match(html, /^<span class="status-pill status-pill--dot status-pill--running">/);
  assert.match(html, /<span class="status-pill__dot" aria-hidden="true"><\/span>/);
  // dot wins over a glyph — the two never co-render.
  assert.doesNotMatch(html, /status-pill__char/);
  assert.match(html, /<span class="status-pill__label">running<\/span>/);
});

test('run-status states each add their modifier class', () => {
  for (const state of ['running', 'error', 'queued']) {
    const html = renderStatusPill({ state, label: state, dot: true });
    assert.match(html, new RegExp(`status-pill--${state}`));
  }
});

test('dot wins over a char glyph when both are supplied', () => {
  const html = renderStatusPill({ state: 'done', char: '✓', dot: true, label: 'done' });
  assert.match(html, /status-pill__dot/);
  assert.doesNotMatch(html, /status-pill__char/);
});

test('char and label are escaped (plain text in, like field)', () => {
  const html = renderStatusPill({ char: '<x>', label: 'a & <b>' });
  assert.match(html, /<span class="status-pill__char">&lt;x&gt;<\/span>/);
  assert.match(html, /<span class="status-pill__label">a &amp; &lt;b&gt;<\/span>/);
});

test('className rides alongside .status-pill as a semantic/E2E hook; attrs extend the wrapper', () => {
  const html = renderStatusPill({ state: 'done', label: 'd', className: 'foreman-state', attrs: 'data-state="done"' });
  assert.match(html, /^<span class="status-pill status-pill--done foreman-state" data-state="done">/);
});
