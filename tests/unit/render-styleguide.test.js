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

test('renders the dark theme side-by-side via the .theme-* hook', () => {
  const html = renderStyleguide();
  assert.match(html, /class="sg-theme-grid"/);
  // The default (light) panel plus the dark theme hook appear, so the page shows
  // the impact of the theme at-a-glance. (LIN-785 removed the amber variant.)
  assert.match(html, /class="sg-theme-panel theme-dark"/);
});

test('demos every S2 primitive (LIN-786)', () => {
  const html = renderStyleguide();
  // Dedicated Primitives + Iconography sections.
  assert.match(html, /Primitives<\/h3>/);
  assert.match(html, /Iconography<\/h3>/);
  // Each primitive class appears at least once.
  for (const cls of [
    'status-pill--dot', 'btn btn--primary', 'btn--ghost', 'icon-btn',
    'tag__name', 'class="chip"', 'accent-bar--running', 'segment-bar__cell',
    'disclosure__summary', 'surface surface--inset'
  ]) {
    assert.ok(html.includes(cls), `styleguide must demo the ${cls} primitive`);
  }
  // Every §10 line icon is present.
  for (const name of ['check', 'caret', 'branch', 'spark', 'error-circle']) {
    assert.match(html, new RegExp(`icon icon--${name}`), `styleguide must demo the ${name} icon`);
  }
});

test('demos the bare status-pill variant used by the project tree (LIN-850)', () => {
  const html = renderStyleguide();
  // The bare variant is the box-less inline glyph the LIN-782-locked tree rows
  // use; the styleguide is its visual-regression baseline, so it must appear.
  assert.ok(html.includes('status-pill--bare'), 'styleguide must demo the bare variant');
  // ...carrying the backlog ◌ glyph (not the pill default ○).
  assert.match(html, /status-pill--backlog status-pill--bare[^>]*>[^<]*<span class="status-pill__char">◌<\/span>/);
});

test('every primitive is demoed in BOTH themes (LIN-786)', () => {
  const html = renderStyleguide();
  // The primitive grid is rendered once standalone and once inside EACH theme
  // panel, so the dark panel must also carry the run-status pill + buttons.
  const darkStart = html.indexOf('sg-theme-panel theme-dark');
  assert.notEqual(darkStart, -1);
  const darkPanel = html.slice(darkStart, html.indexOf('</div>\n      </div>', darkStart) + 1 || html.length);
  for (const cls of ['status-pill--dot', 'btn--primary', 'segment-bar', 'accent-bar', 'surface--inset']) {
    assert.ok(darkPanel.includes(cls), `dark theme panel must demo ${cls}`);
  }
});

test('the .theme-amber variant is fully removed (LIN-785)', () => {
  const html = renderStyleguide();
  const css = readFileSync(STYLE_CSS, 'utf8');
  assert.doesNotMatch(html, /theme-amber/, 'styleguide must not reference theme-amber');
  assert.doesNotMatch(css, /\.theme-amber/, 'stylesheet must not define .theme-amber');
});

test('the .theme-dark hook exists in the stylesheet and only overrides tokens', () => {
  const css = readFileSync(STYLE_CSS, 'utf8');
  // The theme class the page demonstrates must be a real, reusable hook.
  assert.match(css, /\.theme-dark\s*\{/);
  // A theme may only restate EXISTING :root token names (no new tokens), so the
  // "exercises EVERY :root token" guarantee and page byte-stability both hold.
  const rootTokens = new Set(rootTokenNames());
  const block = css.slice(css.indexOf('.theme-dark'));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    assert.ok(
      rootTokens.has(m[1]),
      `.theme-dark declares ${m[1]} which is not a :root token — themes must only override existing tokens`
    );
  }
});

test('footer marks no current page action and hides authed nav', () => {
  const html = renderStyleguide();
  assert.match(html, /class="page-footer"/);
  // isLanding => no authenticated action links.
  assert.doesNotMatch(html, /class="footer-actions"/);
});
