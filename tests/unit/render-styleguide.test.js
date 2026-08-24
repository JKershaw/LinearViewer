import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderStyleguide } from '../../lib/render-styleguide.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = join(__dirname, '../../public/style.css');

/**
 * Slice the body of a selector's first rule block (no nested braces in this file).
 *
 * LIN-2274 (same class as LIN-2247's ruleBody fix in theme.test.js): a plain
 * `css.indexOf(selector)` matches the selector text inside a PRECEDING comment
 * just as readily as the real rule — `.theme-dark` is named in a doc comment near
 * the top of style.css, well before the real `.theme-dark {` rule, so the naive
 * version silently sliced `:root`'s own body instead (the next `{` after that
 * comment). `:root` happens to define the same token *names* as `.theme-dark`
 * restates, so the "only overrides existing tokens" assertion below stayed green
 * checking `:root` against itself — a tautology — regardless of what `.theme-dark`
 * actually declared (proven: injecting a `.theme-dark`-only, non-`:root` token
 * left the naive version green). Requiring the selector be immediately followed
 * by `{` fixes that class of false match.
 */
function ruleBody(css, selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
  const m = re.exec(css);
  assert.notEqual(m, null, `expected ${selector} { ... } in stylesheet`);
  const open = m.index + m[0].length - 1;
  return css.slice(open + 1, css.indexOf('}', open));
}

/** Extract every custom-property name declared in the first :root {} block. */
function rootTokenNames() {
  const css = readFileSync(STYLE_CSS, 'utf8');
  return [...ruleBody(css, ':root').matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(m => m[1]);
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

test('the shared .tag primitive is an uppercase micro-label (LIN-862)', () => {
  const css = readFileSync(STYLE_CSS, 'utf8');
  // Isolate the base `.tag {}` rule (not .tag__count / .tag--<tone>).
  const start = css.search(/\.tag\s*\{/);
  assert.notEqual(start, -1, 'stylesheet must define a base .tag rule');
  const body = css.slice(start + css.slice(start).indexOf('{') + 1, start + css.slice(start).indexOf('}'));
  // LIN-748 locked decision + the in-repo micro-label precedent
  // (.recap-section-title / .context-node-tag / .brief-content h2): uppercase,
  // 0.05em tracking, on the sans content face (NOT mono, NOT 0.08em).
  assert.match(body, /text-transform:\s*uppercase/, '.tag must render uppercase (micro-label contract)');
  assert.match(body, /letter-spacing:\s*0\.05em/, '.tag must use the 0.05em micro-label tracking');
  assert.match(body, /font-family:\s*var\(--font-content\)/, '.tag stays on the sans content face');
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
  const body = ruleBody(css, '.theme-dark');
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
