import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStyleguide } from '../../lib/render-styleguide.js';
import { readSheets, appliedDecls, rulesFor } from '../helpers/css-rules.js';

// What applies to a selector in style.css, asked of the helper (LIN-4015). A selector with no rule throws, so a
// missing :root or .theme-dark cannot pass as an empty list.
const STYLE = readSheets(['/style.css']);
const rootTokenNames = () => [...appliedDecls(STYLE, ':root').keys()].filter((prop) => prop.startsWith('--'));

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
  // The token input still has no builder, so the page keeps linking the shared token stylesheet.
  assert.match(html, /<link rel="stylesheet" href="\/common-actions.css">/);
  assert.match(html, /class="token-label-input"/);
});

test('renders the Buttons section and the theme panels from renderButton (LIN-3950)', () => {
  const html = renderStyleguide();
  // Each live look is the builder's own class string: the quiet look without `btn`, the tones, and
  // the bordered red confirm. No hand-written `action-btn` sample remains on the page.
  for (const cls of ['btn', 'btn btn--primary', 'btn btn--ghost', 'btn btn--red', 'btn--quiet',
    'btn--quiet btn--green', 'btn--quiet btn--blue', 'btn--quiet btn--red']) {
    assert.match(html, new RegExp(`class="${cls}"`), `missing the ${cls} look`);
  }
  assert.doesNotMatch(html, /class="action-btn/);
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

test('the shared .tag primitive is an uppercase micro-label (LIN-862)', () => {
  // The base `.tag` rule, not .tag__count / .tag--<tone>: the helper asks for exactly this selector.
  const body = appliedDecls(STYLE, '.tag');
  // LIN-748 locked decision + the in-repo micro-label precedent
  // (.recap-section-title / .context-node-tag / .brief-content h2): uppercase,
  // 0.05em tracking, on the sans content face (NOT mono, NOT 0.08em).
  assert.equal(body.get('text-transform'), 'uppercase', '.tag must render uppercase (micro-label contract)');
  assert.equal(body.get('letter-spacing'), '0.05em', '.tag must use the 0.05em micro-label tracking');
  assert.equal(body.get('font-family'), 'var(--font-content)', '.tag stays on the sans content face');
});

test('the .theme-amber variant is fully removed (LIN-785)', () => {
  const html = renderStyleguide();
  assert.doesNotMatch(html, /theme-amber/, 'styleguide must not reference theme-amber');
  assert.deepEqual(rulesFor(STYLE, '.theme-amber', { media: 'any' }), [], 'stylesheet must not define .theme-amber');
});

test('the .theme-dark hook exists in the stylesheet and only overrides tokens', () => {
  // The theme class the page demonstrates must be a real, reusable hook.
  assert.ok(rulesFor(STYLE, '.theme-dark').length > 0, 'stylesheet defines .theme-dark');
  // A theme may only restate EXISTING :root token names (no new tokens), so the
  // "exercises EVERY :root token" guarantee and page byte-stability both hold.
  const rootTokens = new Set(rootTokenNames());
  for (const prop of appliedDecls(STYLE, '.theme-dark').keys()) {
    if (!prop.startsWith('--')) continue;
    assert.ok(
      rootTokens.has(prop),
      `.theme-dark declares ${prop} which is not a :root token — themes must only override existing tokens`
    );
  }
});

test('footer marks no current page action and hides authed nav', () => {
  const html = renderStyleguide();
  assert.match(html, /class="page-footer"/);
  // isLanding => no authenticated action links.
  assert.doesNotMatch(html, /class="footer-actions"/);
});
