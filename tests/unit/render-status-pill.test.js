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

test('each state adds its color modifier and default glyph (full canonical set)', () => {
  // The canonical union (LIN-757): provider-canonical issue states + autopilot
  // run-states. done-with-warning (LIN-749) and stale MUST survive.
  const glyphs = {
    'in-progress': '◐',
    done: '✓',
    todo: '○',
    backlog: '○',
    failed: '✕',
    'done-with-warning': '✓',
    stale: '○',
  };
  for (const [state, glyph] of Object.entries(glyphs)) {
    const html = renderStatusPill({ state });
    assert.match(html, new RegExp(`^<span class="status-pill status-pill--${state}">`));
    assert.match(html, new RegExp(`<span class="status-pill__char">${glyph}<\\/span>`));
  }
});

test('error is accepted as an alias of failed (normalises to the failed key + glyph)', () => {
  const html = renderStatusPill({ state: 'error' });
  // Normalised to the canonical `failed` modifier class, not a `--error` class.
  assert.match(html, /^<span class="status-pill status-pill--failed">/);
  assert.doesNotMatch(html, /status-pill--error/);
  // …and the failed glyph (✕), so error and failed render identically.
  assert.match(html, /<span class="status-pill__char">✕<\/span>/);
  const failedHtml = renderStatusPill({ state: 'failed', label: 'x' });
  assert.equal(renderStatusPill({ state: 'error', label: 'x' }), failedHtml);
});

test('done-with-warning keeps the done glyph (the warning is carried by the border, LIN-749)', () => {
  const html = renderStatusPill({ state: 'done-with-warning', label: 'done' });
  assert.match(html, /^<span class="status-pill status-pill--done-with-warning">/);
  assert.match(html, /<span class="status-pill__char">✓<\/span>/);
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

test('requires at least one of char, label, or a known state', () => {
  assert.throws(() => renderStatusPill({}), /requires at least one of `char`, `label`, or a known `state`/);
  // An unknown state has no default glyph; with no label/char it is empty → throws.
  assert.throws(() => renderStatusPill({ state: 'mystery' }), /requires at least one/);
  // …but an unknown state with a label is fine (still gets its modifier class).
  assert.doesNotThrow(() => renderStatusPill({ state: 'mystery', label: 'x' }));
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
