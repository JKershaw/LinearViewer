/**
 * Theme S1 foundation tests (LIN-785).
 *
 * Covers the centralized theming mechanism: the semantic + status token layer in
 * both themes, the removal of `.theme-amber`, self-hosted font loading, the
 * motion / a11y baseline, the pre-paint shell script, the light-as-default
 * behavior, and the durable theme-preference plumbing in user-preferences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { renderPage } from '../../lib/components/page.js';
import {
  applyUserPreferencesToSession,
  setThemeCookie,
  VALID_THEMES,
  THEME_COOKIE_MAX_AGE_MS
} from '../../lib/user-preferences.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLE_CSS = readFileSync(join(__dirname, '../../public/style.css'), 'utf8');

/** Slice the body of a selector's first rule block (no nested braces in this file). */
function ruleBody(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `expected ${selector} in stylesheet`);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

// --- Token layer ------------------------------------------------------------

const SEMANTIC_TOKENS = [
  '--text', '--muted', '--faint', '--line', '--line-soft',
  '--card', '--card-h', '--raised', '--inset', '--brand', '--shadow'
];
const STATUS_TOKENS = ['--amber', '--amber-dim', '--slate', '--slate-dim', '--green-dim', '--red-dim'];

test(':root defines the semantic and running-status token layer', () => {
  const root = ruleBody(STYLE_CSS, ':root');
  for (const token of [...SEMANTIC_TOKENS, ...STATUS_TOKENS, '--focus']) {
    assert.match(root, new RegExp(`${token}\\s*:`), `:root must define ${token}`);
  }
});

test('.theme-dark re-binds the semantic + status tokens (dark values)', () => {
  const dark = ruleBody(STYLE_CSS, '.theme-dark');
  // Both layers must re-bind in dark so theming a subtree (e.g. the styleguide
  // panel) stays correct, not only when the class sits on <html>.
  for (const token of [...SEMANTIC_TOKENS, ...STATUS_TOKENS, '--focus']) {
    assert.match(dark, new RegExp(`${token}\\s*:`), `.theme-dark must re-bind ${token}`);
  }
});

test('--brand is teal (per LIN-782) in both themes', () => {
  assert.match(ruleBody(STYLE_CSS, ':root'), /--brand:\s*var\(--teal\)/);
  assert.match(ruleBody(STYLE_CSS, '.theme-dark'), /--brand:\s*var\(--teal\)/);
});

test('the .theme-amber variant is fully removed', () => {
  assert.doesNotMatch(STYLE_CSS, /theme-amber/, 'stylesheet must not reference theme-amber');
});

// --- Typography / fonts -----------------------------------------------------

test('self-hosts Inter and JetBrains Mono via @font-face (no build step)', () => {
  assert.match(STYLE_CSS, /@font-face[\s\S]*?font-family:\s*'Inter'[\s\S]*?\/fonts\/inter-400\.woff2/);
  assert.match(STYLE_CSS, /@font-face[\s\S]*?font-family:\s*'JetBrains Mono'[\s\S]*?\/fonts\/jetbrains-mono-400\.woff2/);
  // font-display: swap keeps a slow/blocked load from blanking text.
  assert.match(STYLE_CSS, /font-display:\s*swap/);
  // The loaded faces head their respective stacks.
  assert.match(STYLE_CSS, /--font-structural:\s*'JetBrains Mono'/);
  assert.match(STYLE_CSS, /--font-content:\s*'Inter'/);
});

test('the actual font files are vendored', () => {
  for (const f of ['inter-400.woff2', 'inter-600.woff2', 'jetbrains-mono-400.woff2']) {
    const bytes = readFileSync(join(__dirname, '../../public/fonts', f));
    assert.ok(bytes.length > 1000, `${f} should be a real woff2`);
    assert.equal(bytes.toString('ascii', 0, 4), 'wOF2', `${f} must be a woff2`);
  }
});

// --- Motion + a11y baseline -------------------------------------------------

test('ships motion keyframes, a focus-visible ring, and a reduced-motion baseline', () => {
  assert.match(STYLE_CSS, /@keyframes\s+pulse/);
  assert.match(STYLE_CSS, /@keyframes\s+shimmer/);
  assert.match(STYLE_CSS, /:focus-visible\s*\{[\s\S]*?outline:[\s\S]*?var\(--focus\)/);
  assert.match(STYLE_CSS, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

// --- Pre-paint shell --------------------------------------------------------

test('the shared shell emits a pre-paint theme script before the title', () => {
  const html = renderPage({ title: 'X', content: '<p>hi</p>' });
  // Reads the theme cookie and applies theme-dark to <html> before paint.
  assert.match(html, /document\.cookie/);
  assert.match(html, /theme-dark/);
  assert.match(html, /classList\.add\('theme-dark'\)/);
  // It must run ahead of the title so there is no flash of the light default.
  assert.ok(
    html.indexOf('document.cookie') < html.indexOf('<title>'),
    'pre-paint script must come before <title>'
  );
});

test('default render is light — no theme-dark class on body/html in static markup', () => {
  const html = renderPage({ title: 'X', content: '<p>hi</p>' });
  assert.doesNotMatch(html, /<html[^>]*class="[^"]*theme-dark/);
  assert.doesNotMatch(html, /<body[^>]*class="[^"]*theme-dark/);
});

// --- Persistence chain ------------------------------------------------------

test('applyUserPreferencesToSession rehydrates the theme preference', () => {
  const session = {};
  applyUserPreferencesToSession(session, { theme: 'dark' });
  assert.equal(session.theme, 'dark');

  const noTheme = {};
  applyUserPreferencesToSession(noTheme, { features: {} });
  assert.equal(noTheme.theme, undefined, 'absent preference must not set a theme');
});

test('VALID_THEMES is the light/dark allowlist', () => {
  assert.deepEqual(VALID_THEMES, ['light', 'dark']);
});

test('setThemeCookie writes a durable, client-readable theme cookie', () => {
  const calls = [];
  const res = { cookie: (name, value, opts) => calls.push({ name, value, opts }) };
  setThemeCookie(res, 'dark');
  assert.equal(calls.length, 1);
  const { name, value, opts } = calls[0];
  assert.equal(name, 'theme');
  assert.equal(value, 'dark');
  // Pre-paint script reads it via document.cookie, so it must NOT be httpOnly.
  assert.equal(opts.httpOnly, false);
  assert.equal(opts.sameSite, 'lax');
  assert.equal(opts.maxAge, THEME_COOKIE_MAX_AGE_MS);
  assert.ok(THEME_COOKIE_MAX_AGE_MS > 30 * 24 * 60 * 60 * 1000, 'cookie should outlive a session');
});
