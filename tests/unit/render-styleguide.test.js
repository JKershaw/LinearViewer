import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderStyleguide } from '../../lib/render-styleguide.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = join(__dirname, '../../public/style.css');

/** Extract every custom-property name declared in the first :root {} block. */
function rootTokenNames() {
  const css = readFileSync(STYLE_CSS, 'utf8');
  const block = css.slice(css.indexOf(':root'));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  return [...body.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]);
}

test('renders a complete, public, static HTML document', () => {
  const html = renderStyleguide();
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Style Guide - Harbour<\/title>/);
  assert.match(html, /<link rel="stylesheet" href="\/style.css">/);
  assert.match(html, /<link rel="stylesheet" href="\/styleguide.css">/);
  // Public page chrome (mirrors legal pages): landing body class, header home link.
  assert.match(html, /<body class="is-landing">/);
  assert.match(html, /class="header-link"/);
  // Unlisted: keep it out of search indexes.
  assert.match(html, /<meta name="robots" content="noindex">/);
});

test('exercises EVERY token defined in :root', () => {
  const html = renderStyleguide();
  const tokens = rootTokenNames();
  assert.ok(tokens.length >= 30, `expected to find the :root tokens, got ${tokens.length}`);
  for (const token of tokens) {
    assert.ok(
      html.includes(`var(${token})`),
      `style guide does not exercise ${token} — every :root token must appear as var(${token})`
    );
  }
});

test('is fully deterministic (no per-request variation)', () => {
  assert.equal(renderStyleguide(), renderStyleguide());
});

test('carries no deploy info (stable visual-regression baseline)', () => {
  const html = renderStyleguide();
  // deployInfo is intentionally omitted, so the footer shows the static repo
  // link rather than a version/commit/date that would change per deploy.
  assert.doesNotMatch(html, /class="deploy-time"/);
  assert.match(html, /github\.com\/JKershaw\/LinearViewer/);
});

test('renders the leaf button/input components with the shared stylesheet', () => {
  const html = renderStyleguide();
  // Real shared components must carry their live styles, so the page links the
  // shared action/token stylesheet rather than re-encoding the button look.
  assert.match(html, /<link rel="stylesheet" href="\/common-actions.css">/);
  assert.match(html, /class="action-btn save"/);
  assert.match(html, /class="action-btn disconnect"/);
  assert.match(html, /class="token-label-input"/);
});

test('renders each theme side-by-side via the .theme-* hook', () => {
  const html = renderStyleguide();
  assert.match(html, /class="sg-theme-grid"/);
  // The default (light) panel plus every alternate theme hook appear, so the
  // page shows the impact of different themes at-a-glance.
  assert.match(html, /class="sg-theme-panel theme-dark"/);
  assert.match(html, /class="sg-theme-panel theme-amber"/);
});

test('demos every new LIN-754 primitive inside ALL THREE theme panels', () => {
  const html = renderStyleguide();
  // The three theme panels are the seam the primitives must appear in.
  const panels = html.split(/class="sg-theme-panel/).slice(1);
  assert.equal(panels.length, 3, 'expected exactly three theme panels');

  // Every new primitive from LIN-754 (StatusPill from C + the 7 surface-D
  // primitives) must render once in each panel, so a theme rebind is provably
  // exercised against the full primitive set rather than a subset.
  const PRIMITIVE_MARKERS = [
    'class="tag"',                 // Tag
    'class="chip"',                // Chip
    'class="chip__remove"',        // Chip remove affordance
    'class="btn"',                 // Button (base)
    'class="btn btn--primary"',    // Button (primary)
    'class="btn btn--danger"',     // Button (danger)
    'class="accent-bar"',          // AccentBar
    'class="segment-bar"',         // SegmentBar
    'class="segment" data-state="complete"',  // SegmentBar state
    'class="surface surface--raised"',         // Surface (raised)
    'class="surface surface--inset"',          // Surface (inset)
    'class="disclosure"',          // Disclosure
    'status-pill--done-with-warning',          // StatusPill: retained LIN-749 state
    'status-pill--stale',          // StatusPill: retained stale state
  ];
  for (const panel of panels) {
    for (const marker of PRIMITIVE_MARKERS) {
      assert.ok(
        panel.includes(marker),
        `a theme panel is missing the primitive marker ${marker}`
      );
    }
  }
});

test('alternate theme hooks exist in the stylesheet and only override tokens', () => {
  const css = readFileSync(STYLE_CSS, 'utf8');
  // The theme classes the page demonstrates must be real, reusable hooks.
  assert.match(css, /\.theme-dark\s*\{/);
  assert.match(css, /\.theme-amber\s*\{/);
  // A theme may only restate EXISTING :root token names (no new tokens), so the
  // "exercises EVERY :root token" guarantee and page byte-stability both hold.
  const rootTokens = new Set(rootTokenNames());
  for (const cls of ['.theme-dark', '.theme-amber']) {
    const block = css.slice(css.indexOf(cls));
    const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
    for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
      assert.ok(
        rootTokens.has(m[1]),
        `${cls} declares ${m[1]} which is not a :root token — themes must only override existing tokens`
      );
    }
  }
});

test('footer marks no current page action and hides authed nav', () => {
  const html = renderStyleguide();
  assert.match(html, /class="page-footer"/);
  // isLanding => no authenticated action links.
  assert.doesNotMatch(html, /class="footer-actions"/);
});
